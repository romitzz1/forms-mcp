// ABOUTME: Unit tests for GravityFormsMCPServer class
// ABOUTME: Tests server instantiation, configuration, and basic functionality

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

describe('GravityFormsMCPServer', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Set test environment variables
    process.env.GRAVITY_FORMS_BASE_URL = 'https://test.example.com';
    process.env.GRAVITY_FORMS_CONSUMER_KEY = 'test_key';
    process.env.GRAVITY_FORMS_CONSUMER_SECRET = 'test_secret';
    process.env.GRAVITY_FORMS_AUTH_METHOD = 'basic';

    // Clear module cache to ensure fresh imports
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Server Instantiation', () => {
    it('should create server instance with correct configuration', () => {
      const { GravityFormsMCPServer } = require('../../index');
      
      expect(() => new GravityFormsMCPServer()).not.toThrow();
    });

    it('should load configuration from environment variables', () => {
      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      // Access private config through reflection for testing
      const config = (server).config;
      
      expect(config.baseUrl).toBe('https://test.example.com');
      expect(config.consumerKey).toBe('test_key');
      expect(config.consumerSecret).toBe('test_secret');
      expect(config.authMethod).toBe('basic');
    });

    it('should use default values when environment variables are missing', () => {
      // Clear environment variables
      delete process.env.GRAVITY_FORMS_BASE_URL;
      delete process.env.GRAVITY_FORMS_CONSUMER_KEY;
      delete process.env.GRAVITY_FORMS_CONSUMER_SECRET;
      delete process.env.GRAVITY_FORMS_AUTH_METHOD;

      // Clear module cache to force reload
      delete require.cache[require.resolve('../../dist/index.js')];
      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      const config = (server).config;
      
      expect(config.baseUrl).toBe('');
      expect(config.consumerKey).toBe('');
      expect(config.consumerSecret).toBe('');
      expect(config.authMethod).toBe('basic');
    });
  });

  describe('Authentication', () => {
    it('should generate correct basic auth headers', () => {
      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      const headers = (server).getAuthHeaders();
      
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toMatch(/^Basic /);
      
      // Verify base64 encoding
      const base64Part = headers['Authorization'].replace('Basic ', '');
      const decoded = Buffer.from(base64Part, 'base64').toString();
      expect(decoded).toBe('test_key:test_secret');
    });

    it('should throw error for unsupported auth method', async () => {
      process.env.GRAVITY_FORMS_AUTH_METHOD = 'oauth';
      
      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      // Should fail when trying to use bulk operations (lazy initialization)
      await expect((server).processEntriesBulk({
        entry_ids: ['123'],
        operation_type: 'delete',
        confirm: true
      })).rejects.toThrow('OAuth authentication not implemented yet');
    });
  });

  describe('API Request Methods', () => {
    it('should make successful GET request', async () => {
      const mockResponse = GravityFormsMocks.getMockForms();
      const mockFetch = GravityFormsMocks.createMockFetch(new Map([
        ['GET https://test.example.com/wp-json/gf/v2/forms', mockResponse]
      ]));
      global.fetch = mockFetch;

      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      const result = await (server).makeRequest('/forms');
      
      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com/wp-json/gf/v2/forms',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': expect.stringMatching(/^Basic /),
            'Content-Type': 'application/json'
          })
        })
      );
    });

    it('should make successful POST request with body', async () => {
      const requestBody = { title: 'Test Form' };
      const mockResponse = { id: '1', ...requestBody };
      const mockFetch = GravityFormsMocks.createMockFetch(new Map([
        ['POST https://test.example.com/wp-json/gf/v2/forms', mockResponse]
      ]));
      global.fetch = mockFetch;

      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      const result = await (server).makeRequest('/forms', 'POST', requestBody);
      
      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.example.com/wp-json/gf/v2/forms',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': expect.stringMatching(/^Basic /),
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify(requestBody)
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });
      global.fetch = mockFetch;

      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      await expect((server).makeRequest('/invalid-endpoint'))
        .rejects
        .toThrow('API request failed: HTTP 404: Not Found');
    });

    it('should handle network errors', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'));
      global.fetch = mockFetch;

      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      await expect((server).makeRequest('/forms'))
        .rejects
        .toThrow('API request failed: Network error');
    });
  });

  describe('Server Lifecycle', () => {
    it('should run without errors', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      // Mock the run method dependencies
      const mockConnect = jest.fn().mockResolvedValue(undefined);
      (server).server.connect = mockConnect;

      await expect(server.run()).resolves.toBeUndefined();
      expect(mockConnect).toHaveBeenCalled();
    });
  });

  // =====================================
  // Step 10: Enhanced get_forms Tool Tests
  // =====================================
  
  describe('Step 10: Enhanced get_forms with include_all Support', () => {
    let server: any;

    beforeEach(() => {
      const { GravityFormsMCPServer } = require('../../index');
      server = new GravityFormsMCPServer();
      
      // Mock fetch for API calls
      jest.spyOn(global as any, 'fetch').mockImplementation();
    });

    describe('backward compatibility', () => {
      it('should maintain default behavior when include_all not provided', async () => {
        // Mock API response for forms endpoint
        const mockFormsResponse = [
          { id: '1', title: 'Active Form 1', is_active: '1' },
          { id: '3', title: 'Active Form 3', is_active: '1' }
        ];

        (global as any).fetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockFormsResponse
        });

        const result = await server.getForms({ include_fields: false });
        
        expect(result.content[0].text).toContain(JSON.stringify(mockFormsResponse, null, 2));
        expect((global as any).fetch).toHaveBeenCalledWith(
          expect.stringContaining('/forms'),
          expect.any(Object)
        );
      });

      it('should maintain default behavior when include_all is false', async () => {
        // Mock API response
        const mockFormsResponse = [
          { id: '2', title: 'Active Form 2', is_active: '1' }
        ];

        (global as any).fetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockFormsResponse
        });

        const result = await server.getForms({ 
          include_fields: false,
          include_all: false 
        });
        
        expect(result.content[0].text).toContain(JSON.stringify(mockFormsResponse, null, 2));
        expect((global as any).fetch).toHaveBeenCalledTimes(1);
      });

      it('should work with specific form_id parameter unchanged', async () => {
        const mockFormResponse = { id: '1', title: 'Specific Form', is_active: '1' };

        (global as any).fetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockFormResponse
        });

        const result = await server.getForms({ 
          form_id: '1',
          include_all: false // Should be ignored when form_id is provided
        });
        
        expect(result.content[0].text).toContain(JSON.stringify(mockFormResponse, null, 2));
        expect((global as any).fetch).toHaveBeenCalledWith(
          expect.stringContaining('/forms/1'),
          expect.any(Object)
        );
      });
    });

    describe('include_all=true functionality', () => {
      it('should use cache when include_all=true and cache is fresh', async () => {
        // Mock FormCache to return as if cache exists and is fresh
        const mockCachedForms = [
          { id: 1, title: 'Cached Form 1', is_active: true },
          { id: 2, title: 'Cached Form 2', is_active: false },
          { id: 3, title: 'Cached Form 3', is_active: true }
        ];

        // Mock cache methods
        server.formCache = {
          isReady: jest.fn().mockReturnValue(true),
          isStale: jest.fn().mockResolvedValue(false),
          getAllForms: jest.fn().mockResolvedValue(mockCachedForms)
        };

        const result = await server.getForms({ include_all: true });
        
        expect(result.content[0].text).toContain('Cached Form 1');
        expect(result.content[0].text).toContain('Cached Form 2'); // Inactive form included
        expect(result.content[0].text).toContain('Cached Form 3');
        expect(server.formCache.getAllForms).toHaveBeenCalledTimes(1);
        expect((global as any).fetch).not.toHaveBeenCalled(); // No API call
      });

      it('should perform sync when include_all=true but cache is stale', async () => {
        const mockApiResponse = [
          { id: '1', title: 'API Form 1', is_active: '1' }
        ];

        const mockCachedFormsAfterSync = [
          { id: 1, title: 'API Form 1', is_active: true },
          { id: 2, title: 'Hidden Form 2', is_active: false } // Found via sync
        ];

        // Mock cache as stale, then fresh after sync
        server.formCache = {
          isReady: jest.fn().mockReturnValue(true),
          isStale: jest.fn()
            .mockResolvedValueOnce(true)  // First call: stale
            .mockResolvedValueOnce(false), // After sync: fresh
          performHybridSync: jest.fn().mockResolvedValue({
            discovered: 2,
            updated: 0,
            errors: []
          }),
          getAllForms: jest.fn().mockResolvedValue(mockCachedFormsAfterSync)
        };

        // Mock API call for sync
        (global as any).fetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockApiResponse
        });

        const result = await server.getForms({ include_all: true });
        
        expect(server.formCache.performHybridSync).toHaveBeenCalledTimes(1);
        expect(server.formCache.getAllForms).toHaveBeenCalledTimes(1);
        expect(result.content[0].text).toContain('Hidden Form 2'); // Should include hidden forms
      });

      it('should initialize cache if not ready', async () => {
        const mockApiResponse = [
          { id: '1', title: 'API Form', is_active: '1' }
        ];

        const mockCachedForms = [
          { id: 1, title: 'API Form', is_active: true }
        ];

        // Mock cache as not ready initially
        server.formCache = {
          isReady: jest.fn()
            .mockReturnValueOnce(false) // First call: not ready
            .mockReturnValueOnce(true), // After init: ready
          init: jest.fn().mockResolvedValue(undefined),
          isStale: jest.fn().mockResolvedValue(true),
          performHybridSync: jest.fn().mockResolvedValue({
            discovered: 1,
            updated: 0,
            errors: []
          }),
          getAllForms: jest.fn().mockResolvedValue(mockCachedForms)
        };

        // Mock API call
        (global as any).fetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockApiResponse
        });

        const result = await server.getForms({ include_all: true });
        
        expect(server.formCache.init).toHaveBeenCalledTimes(1);
        expect(server.formCache.performHybridSync).toHaveBeenCalledTimes(1);
        expect(result.content[0].text).toContain('API Form');
      });

      it('should handle sync failures gracefully', async () => {
        server.formCache = {
          isReady: jest.fn().mockReturnValue(true),
          isStale: jest.fn().mockResolvedValue(true),
          performHybridSync: jest.fn().mockRejectedValue(new Error('Sync failed')),
          getAllForms: jest.fn().mockResolvedValue([])
        };

        const result = await server.getForms({ include_all: true });
        
        expect(result.content[0].text).toContain('Error accessing complete form cache');
        expect(result.content[0].text).toContain('Sync failed');
        expect(server.formCache.performHybridSync).toHaveBeenCalledTimes(1);
      });

      it('should handle cache initialization failures', async () => {
        server.formCache = {
          isReady: jest.fn().mockReturnValue(false),
          init: jest.fn().mockRejectedValue(new Error('Cache init failed')),
        };

        const result = await server.getForms({ include_all: true });
        
        expect(result.content[0].text).toContain('Error initializing form cache');
        expect(result.content[0].text).toContain('Cache init failed');
        expect(server.formCache.init).toHaveBeenCalledTimes(1);
      });
    });

    describe('parameter validation', () => {
      it('should validate include_all parameter type', async () => {
        // Mock API response for fallback
        (global as any).fetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [{ id: '1', title: 'Form 1' }]
        });

        // Invalid include_all parameter should default to false (API behavior)
        const result = await server.getForms({ include_all: 'invalid' });
        
        expect(result.content[0].text).toContain('Form 1');
        expect((global as any).fetch).toHaveBeenCalledTimes(1); // Used API, not cache
      });

      it('should combine include_all with include_fields correctly', async () => {
        const mockCachedForms = [
          { 
            id: 1, 
            title: 'Cached Form', 
            is_active: true,
            entry_count: 0,
            form_data: JSON.stringify({ 
              fields: [
                { id: '1', label: 'field1', type: 'text' },
                { id: '2', label: 'field2', type: 'text' }
              ]
            })
          }
        ];

        server.formCache = {
          isReady: jest.fn().mockReturnValue(true),
          isStale: jest.fn().mockResolvedValue(false),
          getAllForms: jest.fn().mockResolvedValue(mockCachedForms)
        };

        const result = await server.getForms({ 
          include_all: true,
          include_fields: true 
        });
        
        expect(result.content[0].text).toContain('Cached Form');
        expect(result.content[0].text).toContain('field1'); // Fields should be included
        expect(server.formCache.getAllForms).toHaveBeenCalledTimes(1);
      });

      it('should ignore include_all when form_id is specified', async () => {
        const mockFormResponse = { id: '1', title: 'Specific Form' };

        (global as any).fetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockFormResponse
        });

        // Even with include_all=true, should use API for specific form
        const result = await server.getForms({ 
          form_id: '1',
          include_all: true 
        });
        
        expect(result.content[0].text).toContain('Specific Form');
        expect((global as any).fetch).toHaveBeenCalledWith(
          expect.stringContaining('/forms/1'),
          expect.any(Object)
        );
      });
    });

    describe('error scenarios', () => {
      it('should handle missing FormCache gracefully', async () => {
        // No FormCache initialized
        server.formCache = null;

        // Mock API fallback
        (global as any).fetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [{ id: '1', title: 'Fallback Form' }]
        });

        const result = await server.getForms({ include_all: true });
        
        expect(result.content[0].text).toContain('Fallback Form');
        expect((global as any).fetch).toHaveBeenCalledTimes(1); // Fell back to API
      });

      it('should handle cache errors and fallback to API', async () => {
        server.formCache = {
          isReady: jest.fn().mockReturnValue(true),
          isStale: jest.fn().mockRejectedValue(new Error('Cache error')),
        };

        // Mock API fallback
        (global as any).fetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [{ id: '1', title: 'API Fallback' }]
        });

        const result = await server.getForms({ include_all: true });
        
        expect(result.content[0].text).toContain('API Fallback');
        expect((global as any).fetch).toHaveBeenCalledTimes(1);
      });
    });

    describe('exclude_trash functionality', () => {
      it('should filter out trashed forms when exclude_trash=true', async () => {
        const mockCachedForms = [
          { id: 1, title: 'Active Non-Trash Form', entry_count: 10, is_active: true, is_trash: false },
          { id: 2, title: 'Inactive Non-Trash Form', entry_count: 5, is_active: false, is_trash: false },
          { id: 3, title: 'Active Trashed Form', entry_count: 0, is_active: true, is_trash: true },
          { id: 4, title: 'Inactive Trashed Form', entry_count: 3, is_active: false, is_trash: true }
        ];

        server.formCache = {
          isReady: jest.fn().mockReturnValue(true),
          init: jest.fn().mockResolvedValue(undefined),
          isStale: jest.fn().mockResolvedValue(false),
          performHybridSync: jest.fn().mockResolvedValue(undefined),
          getAllForms: jest.fn().mockImplementation((activeOnly, excludeTrash) => {
            let filteredForms = mockCachedForms;
            if (excludeTrash === true) {
              filteredForms = mockCachedForms.filter(form => !form.is_trash);
            }
            return Promise.resolve(filteredForms);
          })
        };

        const result = await server.getForms({ include_all: true, exclude_trash: true });
        
        expect(result.content[0].text).toContain('Active Non-Trash Form');
        expect(result.content[0].text).toContain('Inactive Non-Trash Form');
        expect(result.content[0].text).not.toContain('Active Trashed Form');
        expect(result.content[0].text).not.toContain('Inactive Trashed Form');
        expect(server.formCache.getAllForms).toHaveBeenCalledWith(false, true); // activeOnly=false, excludeTrash=true
      });

      it('should include trashed forms when exclude_trash=false', async () => {
        const mockCachedForms = [
          { id: 1, title: 'Active Non-Trash Form', entry_count: 10, is_active: true, is_trash: false },
          { id: 2, title: 'Active Trashed Form', entry_count: 0, is_active: true, is_trash: true }
        ];

        server.formCache = {
          isReady: jest.fn().mockReturnValue(true),
          init: jest.fn().mockResolvedValue(undefined),
          isStale: jest.fn().mockResolvedValue(false),
          performHybridSync: jest.fn().mockResolvedValue(undefined),
          getAllForms: jest.fn().mockResolvedValue(mockCachedForms)
        };

        const result = await server.getForms({ include_all: true, exclude_trash: false });
        
        expect(result.content[0].text).toContain('Active Non-Trash Form');
        expect(result.content[0].text).toContain('Active Trashed Form');
        expect(server.formCache.getAllForms).toHaveBeenCalledWith(false, false); // activeOnly=false, excludeTrash=false
      });

      it('should default to including trashed forms when exclude_trash not specified', async () => {
        const mockCachedForms = [
          { id: 1, title: 'Non-Trash Form', entry_count: 10, is_active: true, is_trash: false },
          { id: 2, title: 'Trashed Form', entry_count: 0, is_active: true, is_trash: true }
        ];

        server.formCache = {
          isReady: jest.fn().mockReturnValue(true),
          init: jest.fn().mockResolvedValue(undefined),
          isStale: jest.fn().mockResolvedValue(false),
          performHybridSync: jest.fn().mockResolvedValue(undefined),
          getAllForms: jest.fn().mockResolvedValue(mockCachedForms)
        };

        const result = await server.getForms({ include_all: true });
        
        expect(result.content[0].text).toContain('Non-Trash Form');
        expect(result.content[0].text).toContain('Trashed Form');
        // Should not pass excludeTrash parameter, so FormCache gets undefined (defaults to false)
        expect(server.formCache.getAllForms).toHaveBeenCalledWith(false, undefined);
      });

      it('should show is_trash status in response when include_all=true', async () => {
        const mockCachedForms = [
          { id: 1, title: 'Non-Trash Form', entry_count: 10, is_active: true, is_trash: false },
          { id: 2, title: 'Trashed Form', entry_count: 0, is_active: true, is_trash: true }
        ];

        server.formCache = {
          isReady: jest.fn().mockReturnValue(true),
          init: jest.fn().mockResolvedValue(undefined),
          isStale: jest.fn().mockResolvedValue(false),
          performHybridSync: jest.fn().mockResolvedValue(undefined),
          getAllForms: jest.fn().mockResolvedValue(mockCachedForms)
        };

        const result = await server.getForms({ include_all: true });
        const responseText = result.content[0].text;
        
        // Should include is_trash field in the response
        expect(responseText).toContain('"is_trash": "0"'); // is_trash false converted to "0"
        expect(responseText).toContain('"is_trash": "1"'); // is_trash true converted to "1"
      });

      it('should combine exclude_trash with other filtering when available', async () => {
        const mockCachedForms = [
          { id: 1, title: 'Active Non-Trash Form', entry_count: 10, is_active: true, is_trash: false }
        ];

        server.formCache = {
          isReady: jest.fn().mockReturnValue(true),
          init: jest.fn().mockResolvedValue(undefined),
          isStale: jest.fn().mockResolvedValue(false),
          performHybridSync: jest.fn().mockResolvedValue(undefined),
          getAllForms: jest.fn().mockResolvedValue(mockCachedForms)
        };

        // Test with both include_all and exclude_trash
        const result = await server.getForms({ 
          include_all: true, 
          exclude_trash: true,
          include_fields: false 
        });
        
        expect(result.content[0].text).toContain('Active Non-Trash Form');
        expect(server.formCache.getAllForms).toHaveBeenCalledWith(false, true);
      });
    });
  });

  // Test Infrastructure for Partial Field Updates
  describe('update_form partial field updates', () => {
    let mockForm: any;
    
    beforeEach(() => {
      // Reset mock form to original state for each test
      mockForm = GravityFormsMocks.getPartialUpdateTestForm();
    });

    // Helper function to verify field preservation
    const verifyFieldPreservation = (result: any, expectedFieldIds: number[]) => {
      const resultText = result.content[0].text;
      
      // Handle the actual response format: "Successfully updated form:\n{json}"
      let formData;
      if (resultText.includes('Successfully updated form:')) {
        formData = JSON.parse(resultText.replace('Successfully updated form:\n', ''));
      } else if (resultText.startsWith('{')) {
        formData = JSON.parse(resultText);
      } else {
        // Try to find JSON within the text
        const jsonMatch = resultText.match(/\{.*\}/s);
        if (jsonMatch) {
          formData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error(`Could not find JSON in response: ${resultText}`);
        }
      }
      
      expect(formData.fields).toHaveLength(expectedFieldIds.length);
      
      expectedFieldIds.forEach(fieldId => {
        const field = formData.fields.find((f: any) => f.id === fieldId);
        expect(field).toBeDefined();
      });
      
      return formData;
    };

    // Verify test fixture is properly set up
    test('should have mock form fixture with expected structure', async () => {
      expect(mockForm).toBeDefined();
      expect(mockForm.id).toBe('217');
      expect(mockForm.fields).toHaveLength(4);
      
      // Verify specific fields exist
      const nameField = mockForm.fields.find((f: any) => f.id === 1);
      const emailField = mockForm.fields.find((f: any) => f.id === 3);
      const checkboxField = mockForm.fields.find((f: any) => f.id === 6);
      const htmlField = mockForm.fields.find((f: any) => f.id === 7);
      
      expect(nameField).toBeDefined();
      expect(nameField.type).toBe('name');
      expect(emailField).toBeDefined();
      expect(emailField.type).toBe('email');
      expect(checkboxField).toBeDefined();
      expect(checkboxField.type).toBe('checkbox');
      expect(checkboxField.choices).toHaveLength(3);
      expect(htmlField).toBeDefined();
      expect(htmlField.type).toBe('html');
    });

    // TDD Test: Should PASS after field merge implementation - preserves existing fields
    test('should preserve other fields when updating single field with partial_update', async () => {
      const { GravityFormsMCPServer } = await import('../../index');
      const server = new GravityFormsMCPServer();
      
      // Mock makeRequest to return existing form for GET, echo back the request body for PUT
      server.makeRequest = jest.fn().mockImplementation((endpoint: string, method: string = 'GET', body?: any) => {
        if (method === 'GET' && endpoint.includes('/forms/217')) {
          return Promise.resolve(mockForm);
        }
        if (method === 'PUT' && endpoint.includes('/forms/217')) {
          // Return the merged form data that was sent in the request body
          return Promise.resolve(body);
        }
        return Promise.reject(new Error('Unexpected request'));
      });

      const result = await (server as any).updateForm({
        form_id: '217',
        partial_update: true,
        fields: [
          {
            id: 6,
            label: 'Updated Checkbox'
          }
        ]
      });

      // Verify all fields are preserved during partial update
      const formData = verifyFieldPreservation(result, [1, 3, 6, 7]);
      
      // Verify field 6 was updated but preserved its choices
      const updatedField6 = formData.fields.find((f: any) => f.id === 6);
      expect(updatedField6.label).toBe('Updated Checkbox');
      expect(updatedField6.choices).toHaveLength(3);
      
      // Verify other fields remain unchanged
      const field1 = formData.fields.find((f: any) => f.id === 1);
      const field3 = formData.fields.find((f: any) => f.id === 3);
      const field7 = formData.fields.find((f: any) => f.id === 7);
      
      expect(field1.label).toBe('Full Name');
      expect(field3.label).toBe('Email');
      expect(field7.type).toBe('html');
    });

    // TDD Test: This should PASS - demonstrates current behavior works correctly
    test('should replace all fields when partial_update is false', async () => {
      const { GravityFormsMCPServer } = await import('../../index');
      const server = new GravityFormsMCPServer();
      
      // Mock makeRequest to return updated form with only field 6
      server.makeRequest = jest.fn().mockResolvedValue({
        ...mockForm,
        fields: [
          {
            id: 6,
            type: 'checkbox',
            label: 'Only Field',
            isRequired: false
          }
        ]
      });

      const result = await (server as any).updateForm({
        form_id: '217',
        partial_update: false,
        title: 'Updated Form',
        fields: [
          {
            id: 6,
            type: 'checkbox',
            label: 'Only Field',
            isRequired: false
          }
        ]
      });

      // This should PASS - only field 6 should exist
      const formData = verifyFieldPreservation(result, [6]);
      expect(formData.fields).toHaveLength(1);
      expect(formData.fields[0].id).toBe(6);
      expect(formData.fields[0].label).toBe('Only Field');
    });

    // Test new field addition during partial update
    test('should add new fields during partial update while preserving existing fields', async () => {
      const { GravityFormsMCPServer } = await import('../../index');
      const server = new GravityFormsMCPServer();
      
      // Mock makeRequest 
      server.makeRequest = jest.fn().mockImplementation((endpoint: string, method: string = 'GET', body?: any) => {
        if (method === 'GET' && endpoint.includes('/forms/217')) {
          return Promise.resolve(mockForm);
        }
        if (method === 'PUT' && endpoint.includes('/forms/217')) {
          return Promise.resolve(body);
        }
        return Promise.reject(new Error('Unexpected request'));
      });

      const result = await (server as any).updateForm({
        form_id: '217',
        partial_update: true,
        fields: [
          {
            id: 6,
            label: 'Updated Checkbox'
          },
          {
            id: 8,
            type: 'text',
            label: 'New Field',
            isRequired: false
          }
        ]
      });

      // Should have all original fields plus new field 8
      const formData = verifyFieldPreservation(result, [1, 3, 6, 7, 8]);
      
      // Verify new field was added
      const newField = formData.fields.find((f: any) => f.id === 8);
      expect(newField).toBeDefined();
      expect(newField.type).toBe('text');
      expect(newField.label).toBe('New Field');
      
      // Verify existing field was updated
      const updatedField6 = formData.fields.find((f: any) => f.id === 6);
      expect(updatedField6.label).toBe('Updated Checkbox');
    });
  });
});