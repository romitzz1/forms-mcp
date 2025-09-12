// ABOUTME: Unit tests for response size management in getEntries
// ABOUTME: Tests token estimation, response summarization, and automatic size limiting

import { GravityFormsMocks } from '../mocks/gravityFormsMocks';

const mockServer = {
  setRequestHandler: jest.fn(),
  connect: jest.fn()
};

jest.doMock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn(() => mockServer)
}));

jest.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn()
}));

jest.doMock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ErrorCode: { InvalidParams: 'InvalidParams', MethodNotFound: 'MethodNotFound', InternalError: 'InternalError' },
  ListToolsRequestSchema: 'ListToolsRequestSchema',
  McpError: class McpError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  }
}));

describe('getEntries Response Size Management', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    originalEnv = { ...process.env };
    
    process.env.GRAVITY_FORMS_BASE_URL = 'https://test.example.com';
    process.env.GRAVITY_FORMS_CONSUMER_KEY = 'test_key';
    process.env.GRAVITY_FORMS_CONSUMER_SECRET = 'test_secret';
    process.env.GRAVITY_FORMS_AUTH_METHOD = 'basic';

    jest.clearAllMocks();
    jest.resetModules();

    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    delete (global as any).fetch;
  });

  function createServer() {
    const { GravityFormsMCPServer } = require('../../index');
    return new GravityFormsMCPServer();
  }

  function createLargeEntry(id: string, size: 'normal' | 'large' | 'huge' = 'normal') {
    const base = GravityFormsMocks.getMockEntry({ 
      id, 
      form_id: '193',
      '52': 'John Smith',
      '54': 'john.smith@email.com',
      payment_status: 'Paid'
    });

    if (size === 'large') {
      // Add many fields to make it large (~2k characters)
      for (let i = 60; i < 90; i++) {
        base[i] = `Large field content ${i} with lots of text that makes the response much bigger than normal entries`;
      }
    } else if (size === 'huge') {
      // Add massive fields (~10k characters)
      for (let i = 60; i < 120; i++) {
        base[i] = `Huge field content ${i} `.repeat(100) + ' with massive amounts of text data';
      }
    }

    return base;
  }

  describe('Token Estimation', () => {
    it('should estimate tokens correctly using 4:1 character ratio', async () => {
      const server = createServer();
      
      // Test the token estimation utility directly
      const testText = 'This is a test string with exactly 49 characters!';
      const estimatedTokens = (server).estimateTokenCount(testText);
      
      // 49 characters / 4 = 12.25 tokens, should round up to 13
      expect(estimatedTokens).toBe(13);
    });

    it('should estimate tokens for complex objects correctly', async () => {
      const server = createServer();
      const entry = createLargeEntry('1', 'large');
      const entryJson = JSON.stringify(entry);
      const estimatedTokens = (server).estimateTokenCount(entryJson);
      
      // Should be roughly entryJson.length / 4
      const expectedTokens = Math.ceil(entryJson.length / 4);
      expect(estimatedTokens).toBe(expectedTokens);
      expect(estimatedTokens).toBeGreaterThan(100); // Large entry should have substantial tokens
    });

    it('should handle empty content correctly', async () => {
      const server = createServer();
      expect((server).estimateTokenCount('')).toBe(0);
      expect((server).estimateTokenCount(null)).toBe(0);
      expect((server).estimateTokenCount(undefined)).toBe(0);
    });
  });

  describe('Entry Summarization', () => {
    it('should create summary with essential fields only', async () => {
      const server = createServer();
      const entry = createLargeEntry('12345', 'huge');
      
      const summary = (server).createEntrySummary(entry);
      
      // Should contain essential fields
      expect(summary.id).toBe('12345');
      expect(summary.form_id).toBe('193');
      expect(summary.date_created).toBe(entry.date_created);
      expect(summary.payment_status).toBe('Paid');
      
      // Should contain common name/email fields
      expect(summary['52']).toBe('John Smith'); // Name field
      expect(summary['54']).toBe('john.smith@email.com'); // Email field
      
      // Should NOT contain the huge extra fields
      expect(summary['60']).toBeUndefined();
      expect(summary['100']).toBeUndefined();
      
      // Summary should be much smaller than original
      const originalSize = JSON.stringify(entry).length;
      const summarySize = JSON.stringify(summary).length;
      expect(summarySize).toBeLessThan(originalSize * 0.2); // Less than 20% of original
    });

    it('should preserve all fields when entry is already small', async () => {
      const server = createServer();
      const entry = createLargeEntry('123', 'normal');
      
      const summary = (server).createEntrySummary(entry);
      
      // For normal-sized entries, summary should include more fields
      expect(Object.keys(summary).length).toBeGreaterThan(5);
      expect(summary.id).toBe('123');
      expect(summary['52']).toBe('John Smith');
    });

    it('should handle entries missing common fields gracefully', async () => {
      const server = createServer();
      const entry = {
        id: '999',
        form_id: '193',
        date_created: '2024-01-01 12:00:00',
        // Missing payment_status, name fields, email fields
        '99': 'Some other field'
      };
      
      const summary = (server).createEntrySummary(entry);
      
      expect(summary.id).toBe('999');
      expect(summary.form_id).toBe('193');
      expect(summary.date_created).toBe('2024-01-01 12:00:00');
      expect(summary.payment_status).toBeUndefined(); // Missing is OK
      expect(summary['52']).toBeUndefined(); // Missing is OK
      expect(summary['99']).toBe('Some other field'); // Other fields preserved if small
    });
  });

  describe('Response Mode Handling', () => {
    it('should use full mode by default when response_mode not specified', async () => {
      const server = createServer();
      const smallEntries = [createLargeEntry('1', 'normal'), createLargeEntry('2', 'normal')];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: smallEntries })
      });

      const result = await (server).getEntries({
        form_id: '193'
        // No response_mode specified - should default to 'auto' which uses 'full' for small responses
      });

      expect(result.content[0].text).toContain('John Smith'); // Full entry details
      expect(result.content[0].text).not.toContain('Response summarized'); // Not summarized
    });

    it('should use summary mode when explicitly requested', async () => {
      const server = createServer();
      const entries = [createLargeEntry('1', 'normal')];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: entries })
      });

      const result = await (server).getEntries({
        form_id: '193',
        response_mode: 'summary'
      });

      expect(result.content[0].text).toContain('Response summarized'); // Should indicate summarization
      expect(result.content[0].text).toContain('John Smith'); // Should still show essential info
    });

    it('should use full mode when explicitly requested even for large responses', async () => {
      const server = createServer();
      const largeEntries = Array.from({ length: 5 }, (_, i) => createLargeEntry(`${i + 1}`, 'large'));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: largeEntries })
      });

      const result = await (server).getEntries({
        form_id: '193',
        response_mode: 'full'
      });

      // Should show full entries even though they're large
      expect(result.content[0].text).not.toContain('Response summarized');
      expect(result.content[0].text.length).toBeGreaterThan(5000); // Should be substantial
    });
  });

  describe('Automatic Response Size Limiting', () => {
    it('should automatically summarize when response exceeds 20k tokens', async () => {
      const server = createServer();
      // Create many large entries to exceed 20k tokens
      const hugeEntries = Array.from({ length: 10 }, (_, i) => createLargeEntry(`${i + 1}`, 'huge'));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: hugeEntries })
      });

      const result = await (server).getEntries({
        form_id: '193',
        response_mode: 'auto' // Should auto-detect and summarize
      });

      expect(result.content[0].text).toContain('Response summarized'); // Should indicate auto-summarization
      expect(result.content[0].text).toContain('10 entries'); // Should mention entry count
      
      // Response should be much smaller than full version
      const responseTokens = Math.ceil(result.content[0].text.length / 4);
      expect(responseTokens).toBeLessThan(20000); // Should be under 20k tokens
    });

    it('should handle very large individual entries with reasonable response size', async () => {
      const server = createServer();
      const massiveEntry = createLargeEntry('1', 'huge');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: [massiveEntry] })
      });

      const result = await (server).getEntries({
        form_id: '193',
        response_mode: 'auto'
      });

      // Should have processed the request successfully
      expect(mockFetch).toHaveBeenCalledTimes(1);
      
      // Should still return useful results (will be summarized due to size)
      expect(result.content[0].text).toContain('John Smith');
      expect(result.content[0].text).toContain('Response summarized');
      
      // Should maintain reasonable response size
      const responseTokens = Math.ceil(result.content[0].text.length / 4);
      expect(responseTokens).toBeLessThan(25000); // Should stay reasonable
    });

    it('should handle empty results gracefully', async () => {
      const server = createServer();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: [] })
      });

      const result = await (server).getEntries({
        form_id: '193',
        response_mode: 'auto'
      });

      expect(result.content[0].text).toContain('No entries found');
      expect(result.content[0].text.length).toBeLessThan(100); // Very small response
    });
  });

  describe('Mixed Entry Size Handling', () => {
    it('should handle mix of small and large entries appropriately', async () => {
      const server = createServer();
      const mixedEntries = [
        createLargeEntry('1', 'normal'),
        createLargeEntry('2', 'huge'),
        createLargeEntry('3', 'normal'),
        createLargeEntry('4', 'large'),
        createLargeEntry('5', 'normal')
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: mixedEntries })
      });

      const result = await (server).getEntries({
        form_id: '193',
        response_mode: 'auto'
      });

      // Should handle the mixed sizes and provide reasonable response
      expect(result.content[0].text).toContain('John Smith');
      expect(result.content[0].text).toContain('5 entries'); // Should process all entries
      
      const responseTokens = Math.ceil(result.content[0].text.length / 4);
      expect(responseTokens).toBeLessThan(25000); // Should manage size appropriately
    });
  });

  describe('Backward Compatibility', () => {
    it('should not break existing getEntries calls without response_mode', async () => {
      const server = createServer();
      const normalEntries = [createLargeEntry('1', 'normal')];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: normalEntries })
      });

      // Existing call format - should work exactly as before
      const result = await (server).getEntries({
        form_id: '193',
        search: { status: 'active' },
        paging: { current_page: 1, page_size: 20 },
        sorting: { key: 'date_created', direction: 'DESC' }
      });

      // Should return full results as before (auto mode with small response)
      expect(result.content[0].text).toContain('John Smith');
      expect(result.content[0].text).not.toContain('Response summarized');
      
      // Should maintain same response structure
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0].type).toBe('text');
    });
  });
});