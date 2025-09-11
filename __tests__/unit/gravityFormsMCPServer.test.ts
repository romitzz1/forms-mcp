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
    test('should create server instance with correct configuration', () => {
      const { GravityFormsMCPServer } = require('../../index');
      
      expect(() => new GravityFormsMCPServer()).not.toThrow();
    });

    test('should load configuration from environment variables', () => {
      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      // Access private config through reflection for testing
      const config = (server as any).config;
      
      expect(config.baseUrl).toBe('https://test.example.com');
      expect(config.consumerKey).toBe('test_key');
      expect(config.consumerSecret).toBe('test_secret');
      expect(config.authMethod).toBe('basic');
    });

    test('should use default values when environment variables are missing', () => {
      // Clear environment variables
      delete process.env.GRAVITY_FORMS_BASE_URL;
      delete process.env.GRAVITY_FORMS_CONSUMER_KEY;
      delete process.env.GRAVITY_FORMS_CONSUMER_SECRET;
      delete process.env.GRAVITY_FORMS_AUTH_METHOD;

      // Clear module cache to force reload
      delete require.cache[require.resolve('../../dist/index.js')];
      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      const config = (server as any).config;
      
      expect(config.baseUrl).toBe('');
      expect(config.consumerKey).toBe('');
      expect(config.consumerSecret).toBe('');
      expect(config.authMethod).toBe('basic');
    });
  });

  describe('Authentication', () => {
    test('should generate correct basic auth headers', () => {
      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      const headers = (server as any).getAuthHeaders();
      
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toMatch(/^Basic /);
      
      // Verify base64 encoding
      const base64Part = headers['Authorization'].replace('Basic ', '');
      const decoded = Buffer.from(base64Part, 'base64').toString();
      expect(decoded).toBe('test_key:test_secret');
    });

    test('should throw error for unsupported auth method', async () => {
      process.env.GRAVITY_FORMS_AUTH_METHOD = 'oauth';
      
      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      // Should fail when trying to use bulk operations (lazy initialization)
      await expect((server as any).processEntriesBulk({
        entry_ids: ['123'],
        operation_type: 'delete',
        confirm: true
      })).rejects.toThrow('OAuth authentication not implemented yet');
    });
  });

  describe('API Request Methods', () => {
    test('should make successful GET request', async () => {
      const mockResponse = GravityFormsMocks.getMockForms();
      const mockFetch = GravityFormsMocks.createMockFetch(new Map([
        ['GET https://test.example.com/wp-json/gf/v2/forms', mockResponse]
      ]));
      global.fetch = mockFetch;

      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      const result = await (server as any).makeRequest('/forms');
      
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

    test('should make successful POST request with body', async () => {
      const requestBody = { title: 'Test Form' };
      const mockResponse = { id: '1', ...requestBody };
      const mockFetch = GravityFormsMocks.createMockFetch(new Map([
        ['POST https://test.example.com/wp-json/gf/v2/forms', mockResponse]
      ]));
      global.fetch = mockFetch;

      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      const result = await (server as any).makeRequest('/forms', 'POST', requestBody);
      
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

    test('should handle API errors gracefully', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });
      global.fetch = mockFetch;

      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      await expect((server as any).makeRequest('/invalid-endpoint'))
        .rejects
        .toThrow('API request failed: HTTP 404: Not Found');
    });

    test('should handle network errors', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'));
      global.fetch = mockFetch;

      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      await expect((server as any).makeRequest('/forms'))
        .rejects
        .toThrow('API request failed: Network error');
    });
  });

  describe('Server Lifecycle', () => {
    test('should run without errors', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      // Mock the run method dependencies
      const mockConnect = jest.fn().mockResolvedValue(undefined);
      (server as any).server.connect = mockConnect;

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
      (global as any).fetch = jest.fn();
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
          performIncrementalSync: jest.fn().mockResolvedValue({
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
        
        expect(server.formCache.performIncrementalSync).toHaveBeenCalledTimes(1);
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
          performIncrementalSync: jest.fn().mockResolvedValue({
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
        expect(server.formCache.performIncrementalSync).toHaveBeenCalledTimes(1);
        expect(result.content[0].text).toContain('API Form');
      });

      it('should handle sync failures gracefully', async () => {
        server.formCache = {
          isReady: jest.fn().mockReturnValue(true),
          isStale: jest.fn().mockResolvedValue(true),
          performIncrementalSync: jest.fn().mockRejectedValue(new Error('Sync failed')),
        };

        const result = await server.getForms({ include_all: true });
        
        expect(result.content[0].text).toContain('Error accessing complete form cache');
        expect(result.content[0].text).toContain('Sync failed');
        expect(server.formCache.performIncrementalSync).toHaveBeenCalledTimes(1);
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
  });
});