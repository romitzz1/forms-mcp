// ABOUTME: Unit tests for getEntries search functionality fixes
// ABOUTME: Tests field_filters array format handling and backward compatibility

import { GravityFormsMocks } from '../mocks/gravityFormsMocks';

// Mock the entire MCP SDK at the module level
const mockServer = {
  setRequestHandler: jest.fn(),
  connect: jest.fn()
};

const mockTransport = jest.fn();

// Mock the modules before importing
jest.doMock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn(() => mockServer)
}));

jest.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: mockTransport
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

describe('getEntries Search Functionality', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let server: any;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Set test environment variables
    process.env.GRAVITY_FORMS_BASE_URL = 'https://test.example.com';
    process.env.GRAVITY_FORMS_CONSUMER_KEY = 'test_key';
    process.env.GRAVITY_FORMS_CONSUMER_SECRET = 'test_secret';
    process.env.GRAVITY_FORMS_AUTH_METHOD = 'basic';

    // Clear module cache and mocks
    jest.clearAllMocks();
    jest.resetModules();

    // Mock fetch globally
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    delete (global as any).fetch;
  });

  function createServer() {
    const { GravityFormsMCPServer } = require('../../index');
    return new GravityFormsMCPServer();
  }

  describe('field_filters array format handling', () => {
    it('should handle single field filter correctly', async () => {
      // Arrange
      const server = createServer();
      const mockEntries = [
        GravityFormsMocks.getMockEntry({ id: '1', form_id: '193', '52': 'John Smith' }),
        GravityFormsMocks.getMockEntry({ id: '2', form_id: '193', '52': 'Jane Doe' })
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockEntries)
      });

      // Act
      const result = await (server as any).getEntries({
        form_id: '193',
        search: {
          field_filters: [{ key: '52', value: 'John' }]
        }
      });

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/forms/193/entries');
      expect(url).toContain('search%5Bfield_filters%5D%5B0%5D%5Bkey%5D=52');
      expect(url).toContain('search%5Bfield_filters%5D%5B0%5D%5Bvalue%5D=John');
      expect(result.content[0].text).toContain('John Smith');
    });

    it('should handle multiple field filters with OR logic', async () => {
      // Arrange 
      const server = createServer();
      const mockEntries = [
        GravityFormsMocks.getMockEntry({ id: '1', form_id: '193', '52': 'John Smith', '54': 'john@test.com' })
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockEntries)
      });

      // Act
      const result = await (server as any).getEntries({
        form_id: '193',
        search: {
          field_filters: [
            { key: '52', value: 'John' },
            { key: '54', value: 'test.com' }
          ]
        }
      });

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('search%5Bfield_filters%5D%5B0%5D%5Bkey%5D=52');
      expect(url).toContain('search%5Bfield_filters%5D%5B0%5D%5Bvalue%5D=John');
      expect(url).toContain('search%5Bfield_filters%5D%5B1%5D%5Bkey%5D=54');
      expect(url).toContain('search%5Bfield_filters%5D%5B1%5D%5Bvalue%5D=test.com');
    });

    it('should handle search with pagination and sorting', async () => {
      // Arrange
      const server = createServer();
      const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockEntries)
      });

      // Act
      await (server as any).getEntries({
        form_id: '193',
        search: {
          field_filters: [{ key: '52', value: 'John' }]
        },
        paging: { current_page: 2, page_size: 10 },
        sorting: { key: 'date_created', direction: 'DESC' }
      });

      // Assert
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('search%5Bfield_filters%5D%5B0%5D%5Bkey%5D=52');
      expect(url).toContain('paging%5Bcurrent_page%5D=2');
      expect(url).toContain('paging%5Bpage_size%5D=10');
      expect(url).toContain('sorting%5Bkey%5D=date_created');
      expect(url).toContain('sorting%5Bdirection%5D=DESC');
    });

    it('should handle invalid field filter formats gracefully', async () => {
      // Arrange
      const server = createServer();
      const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockEntries)
      });

      // Act & Assert - should not crash with malformed field_filters
      const result = await (server as any).getEntries({
        form_id: '193',
        search: {
          field_filters: [
            { key: '52' }, // missing value
            { value: 'John' }, // missing key
            null, // null filter
            { key: '', value: '' } // empty strings
          ]
        }
      });

      // Should handle gracefully without crashing
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should handle mixed search parameters (status + field_filters)', async () => {
      // Arrange
      const server = createServer();
      const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockEntries)
      });

      // Act
      await (server as any).getEntries({
        form_id: '193',
        search: {
          status: 'active',
          field_filters: [{ key: '52', value: 'John' }]
        }
      });

      // Assert
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('search%5Bstatus%5D=active');
      expect(url).toContain('search%5Bfield_filters%5D%5B0%5D%5Bkey%5D=52');
      expect(url).toContain('search%5Bfield_filters%5D%5B0%5D%5Bvalue%5D=John');
    });
  });

  describe('backward compatibility', () => {
    it('should maintain support for existing search parameter formats', async () => {
      // Arrange
      const server = createServer();
      const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockEntries)
      });

      // Act - using old flat object format
      await (server as any).getEntries({
        form_id: '193',
        search: {
          status: 'active',
          created_by: '1'
        }
      });

      // Assert - should still work for non-field_filters parameters
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('search%5Bstatus%5D=active');
      expect(url).toContain('search%5Bcreated_by%5D=1');
    });

    it('should handle empty search parameters', async () => {
      // Arrange
      const server = createServer();
      const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockEntries)
      });

      // Act
      await (server as any).getEntries({
        form_id: '193',
        search: {}
      });

      // Assert
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://test.example.com/wp-json/gf/v2/forms/193/entries');
    });
  });

  describe('URL encoding validation', () => {
    it('should properly encode special characters in field filters', async () => {
      // Arrange
      const server = createServer();
      const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockEntries)
      });

      // Act
      await (server as any).getEntries({
        form_id: '193',
        search: {
          field_filters: [
            { key: '52', value: 'John & Jane' },
            { key: '54', value: 'test@example.com' }
          ]
        }
      });

      // Assert
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('search%5Bfield_filters%5D%5B0%5D%5Bvalue%5D=John+%26+Jane');
      expect(url).toContain('search%5Bfield_filters%5D%5B1%5D%5Bvalue%5D=test%40example.com');
    });
  });
});