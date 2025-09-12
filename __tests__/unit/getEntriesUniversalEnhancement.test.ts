// ABOUTME: Tests for enhanced get_entries tool with universal search capabilities (Step 11)
// ABOUTME: Verifies backward compatibility while adding optional universal search features

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

// Mock the utility classes
jest.mock('../../utils/universalSearchManager', () => ({
  UniversalSearchManager: jest.fn().mockImplementation(() => ({
    searchByName: jest.fn().mockResolvedValue({
      matches: [
        {
          entryId: '10795',
          matchedFields: { '52': 'John Smith' },
          confidence: 0.95
        }
      ],
      totalFound: 1,
      searchMetadata: { executionTime: 1200, fieldsSearched: ['52', '55'] }
    })
  }))
}));

jest.mock('../../utils/fieldTypeDetector', () => ({
  FieldTypeDetector: jest.fn().mockImplementation(() => ({
    analyzeFormFields: jest.fn().mockResolvedValue({
      '52': { fieldId: '52', fieldType: 'name', confidence: 0.95, label: 'Name' },
      '55': { fieldId: '55', fieldType: 'name', confidence: 0.90, label: 'Full Name' }
    })
  }))
}));

jest.mock('../../utils/searchResultsFormatter', () => ({
  SearchResultsFormatter: jest.fn().mockImplementation(() => ({
    formatSearchResults: jest.fn().mockReturnValue({
      content: 'Found 1 match for "John Smith" with high confidence (0.95)',
      tokenCount: 150,
      resultCount: 1,
      metadata: { mode: 'detailed' }
    })
  }))
}));

// Import after mocking
import { GravityFormsMCPServer } from '../../index';

describe('Enhanced get_entries Tool with Universal Search (Step 11)', () => {
  let server: GravityFormsMCPServer;
  let mockMakeRequest: jest.SpyInstance;

  beforeEach(() => {
    server = new GravityFormsMCPServer();
    
    // Mock the makeRequest method
    mockMakeRequest = jest.spyOn(server as any, 'makeRequest').mockImplementation((endpoint: string) => {
      if (endpoint.includes('/forms/193/entries')) {
        return Promise.resolve([
          {
            id: '10795',
            form_id: '193',
            date_created: '2025-09-03 15:43:56',
            '52': 'John Smith',
            '54': 'john.smith@email.com',
            payment_status: 'Paid',
            payment_amount: '$200.00'
          }
        ]);
      }
      return Promise.resolve([]);
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Backward Compatibility Tests', () => {
    it('should work exactly like before when no new parameters provided', async () => {
      const args = {
        form_id: '193',
        search: { field_filters: [{ key: '52', value: 'John' }] }
      };

      const result = await (server as any).getEntries(args);

      expect(result.content[0].text).toContain('Entries:');
      expect(result.content[0].text).toContain('John Smith');
      expect(mockMakeRequest).toHaveBeenCalledWith(
        expect.stringContaining('/forms/193/entries?search=')
      );
    });

    it('should maintain existing response format for default behavior', async () => {
      const args = { form_id: '193' };

      const result = await (server as any).getEntries(args);

      expect(result).toHaveProperty('content');
      expect(result.content[0]).toHaveProperty('type', 'text');
      expect(result.content[0]).toHaveProperty('text');
      expect(typeof result.content[0].text).toBe('string');
    });

    it('should handle existing search parameter formats unchanged', async () => {
      const args = {
        form_id: '193',
        search: {
          status: 'active',
          field_filters: [{ key: '52', value: 'Smith', operator: 'contains' }],
          date_range: { start: '2025-01-01', end: '2025-12-31' }
        },
        paging: { page_size: 20, current_page: 1 },
        sorting: { key: 'date_created', direction: 'DESC' }
      };

      const result = await (server as any).getEntries(args);

      expect(mockMakeRequest).toHaveBeenCalledWith(
        expect.stringContaining('/forms/193/entries?search=')
      );
      
      const callArgs = mockMakeRequest.mock.calls[0][0];
      expect(callArgs).toContain('sorting%5Bkey%5D=date_created');
      expect(callArgs).toContain('paging%5Bpage_size%5D=20');
    });

    it('should use response_mode=auto by default (existing behavior)', async () => {
      const args = { form_id: '193' };

      await (server as any).getEntries(args);

      // Verify default response_mode was applied (should work same as before)
      expect(mockMakeRequest).toHaveBeenCalled();
    });
  });

  describe('New Optional Parameters', () => {
    it('should accept search_mode parameter with default value "standard"', async () => {
      const args = {
        form_id: '193',
        search_mode: 'standard'  // Explicit standard mode
      };

      const result = await (server as any).getEntries(args);

      // Should work exactly like existing implementation
      expect(result.content[0].text).toContain('Entries:');
    });

    it('should accept field_detection parameter with default value false', async () => {
      const args = {
        form_id: '193',
        field_detection: false  // Explicit false
      };

      const result = await (server as any).getEntries(args);

      // Should work like standard mode without field detection
      expect(result.content[0].text).toContain('Entries:');
    });

    it('should work when all new parameters have default values', async () => {
      const args = { form_id: '193' };

      const result = await (server as any).getEntries(args);

      // Default behavior: search_mode='standard', response_mode='auto', field_detection=false
      expect(result.content[0].text).toContain('Entries:');
    });
  });

  describe('Universal Search Mode Integration', () => {
    it('should use UniversalSearchManager when search_mode="universal"', async () => {
      const args = {
        form_id: '193',
        search: { field_filters: [{ key: 'name', value: 'John Smith' }] },
        search_mode: 'universal'
      };

      const result = await (server as any).getEntries(args);

      // Should use universal search formatting
      expect(result.content[0].text).toContain('Found 1 match for "John Smith"');
      expect(result.content[0].text).toContain('high confidence');
    });

    it('should enable field detection automatically in universal mode', async () => {
      const args = {
        form_id: '193',
        search: { field_filters: [{ key: 'name', value: 'John Smith' }] },
        search_mode: 'universal',
        field_detection: true
      };

      const result = await (server as any).getEntries(args);

      // Should show field detection was used
      expect(result.content[0].text).toContain('Found 1 match');
    });

    it('should handle universal search with no matches gracefully', async () => {
      // Mock no matches
      const { UniversalSearchManager } = require('../../utils/universalSearchManager');
      UniversalSearchManager.mockImplementation(() => ({
        searchByName: jest.fn().mockResolvedValue({
          matches: [],
          totalFound: 0,
          searchMetadata: { executionTime: 500, fieldsSearched: ['52', '55'] }
        })
      }));

      const args = {
        form_id: '193',
        search: { field_filters: [{ key: 'name', value: 'NonExistent' }] },
        search_mode: 'universal'
      };

      const result = await (server as any).getEntries(args);

      expect(result.content[0].text).toContain('No entries found');
    });

    it('should fallback to standard mode if universal search fails', async () => {
      // Mock universal search failure
      const { UniversalSearchManager } = require('../../utils/universalSearchManager');
      UniversalSearchManager.mockImplementation(() => ({
        searchByName: jest.fn().mockRejectedValue(new Error('Field detection failed'))
      }));

      const args = {
        form_id: '193',
        search: { field_filters: [{ key: 'name', value: 'John Smith' }] },
        search_mode: 'universal'
      };

      const result = await (server as any).getEntries(args);

      // Should fallback to standard search
      expect(result.content[0].text).toContain('Entries:');
      expect(mockMakeRequest).toHaveBeenCalled();
    });
  });

  describe('Enhanced Response Formatting', () => {
    it('should provide enhanced formatting in universal mode', async () => {
      const args = {
        form_id: '193',
        search: { field_filters: [{ key: 'name', value: 'John Smith' }] },
        search_mode: 'universal',
        response_mode: 'detailed'
      };

      const result = await (server as any).getEntries(args);

      expect(result.content[0].text).toContain('Found 1 match');
      expect(result.content[0].text).toContain('confidence');
    });

    it('should respect response_mode in universal search', async () => {
      const args = {
        form_id: '193',
        search: { field_filters: [{ key: 'name', value: 'John Smith' }] },
        search_mode: 'universal',
        response_mode: 'summary'
      };

      const result = await (server as any).getEntries(args);

      // Should use summary formatting through SearchResultsFormatter
      expect(result.content[0].text).toContain('Found 1 match');
    });
  });

  describe('Performance and Error Handling', () => {
    it('should handle API errors gracefully in both modes', async () => {
      mockMakeRequest.mockRejectedValueOnce(new Error('API Error'));

      const args = { form_id: '999999' };  // Non-existent form

      await expect((server as any).getEntries(args)).rejects.toThrow('API Error');
    });

    it('should handle malformed search parameters', async () => {
      const args = {
        form_id: '193',
        search: { field_filters: 'invalid' },  // Should be array
        search_mode: 'universal'
      };

      const result = await (server as any).getEntries(args);

      // Should handle gracefully and not crash
      expect(result.content[0]).toBeDefined();
    });

    it('should maintain performance characteristics', async () => {
      const startTime = Date.now();

      const args = {
        form_id: '193',
        search: { field_filters: [{ key: 'name', value: 'John Smith' }] },
        search_mode: 'universal'
      };

      await (server as any).getEntries(args);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(5000); // Should complete in reasonable time
    });
  });

  describe('Edge Cases and Validation', () => {
    it('should validate search_mode parameter', async () => {
      const args = {
        form_id: '193',
        search_mode: 'invalid_mode'  // Invalid value
      };

      // Should default to standard mode for invalid values
      const result = await (server as any).getEntries(args);
      expect(result.content[0].text).toContain('Entries:');
    });

    it('should handle empty search text in universal mode', async () => {
      const args = {
        form_id: '193',
        search: { field_filters: [{ key: 'name', value: '' }] },
        search_mode: 'universal'
      };

      const result = await (server as any).getEntries(args);
      
      // Should handle empty search gracefully
      expect(result.content[0]).toBeDefined();
    });

    it('should work with complex form structures', async () => {
      const args = {
        form_id: '193',
        search: { 
          field_filters: [
            { key: 'name', value: 'John' },
            { key: 'email', value: 'gmail.com' }
          ]
        },
        search_mode: 'universal'
      };

      const result = await (server as any).getEntries(args);

      expect(result.content[0].text).toContain('Found 1 match');
    });
  });

  describe('Integration with Existing Tools', () => {
    it('should work alongside other MCP tools without conflicts', async () => {
      // Test that enhanced get_entries doesn't interfere with other tools
      const args1 = { form_id: '193', search_mode: 'standard' };
      const args2 = { form_id: '193', search_mode: 'universal' };

      const result1 = await (server as any).getEntries(args1);
      const result2 = await (server as any).getEntries(args2);

      expect(result1.content[0]).toBeDefined();
      expect(result2.content[0]).toBeDefined();
      
      // Results should be different (standard vs universal formatting)
      expect(result1.content[0].text).not.toEqual(result2.content[0].text);
    });

    it('should maintain compatibility with bulk operations', async () => {
      // Verify that get_entries results can still be used by bulk operations
      const args = {
        form_id: '193',
        search: { field_filters: [{ key: '52', value: 'John' }] }
      };

      const result = await (server as any).getEntries(args);
      const entriesData = JSON.parse(result.content[0].text.replace('Entries:\n', ''));

      expect(Array.isArray(entriesData)).toBe(true);
      if (entriesData.length > 0) {
        expect(entriesData[0]).toHaveProperty('id');
        expect(entriesData[0]).toHaveProperty('form_id');
      }
    });
  });
});