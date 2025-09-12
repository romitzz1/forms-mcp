// ABOUTME: Comprehensive tests for get_field_mappings MCP tool - TDD implementation for Step 10  
// ABOUTME: Tests MCP server integration, parameter validation, response formatting, and error handling

// Mock MCP SDK dependencies
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => ({
    setRequestHandler: jest.fn()
  }))
}));

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn()
}));

jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ErrorCode: {
    InvalidRequest: 'InvalidRequest',
    InternalError: 'InternalError',
    MethodNotFound: 'MethodNotFound'
  },
  ListToolsRequestSchema: 'ListToolsRequestSchema',
  McpError: class MockMcpError extends Error {
    constructor(code: string, message: string) {
      super(message);
      this.name = 'McpError';
    }
  }
}));

// Mock utility dependencies
jest.mock('../../utils/dataExporter', () => ({
  DataExporter: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('../../utils/validation', () => ({
  ValidationHelper: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('../../utils/bulkOperations', () => ({
  BulkOperationsManager: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('../../utils/templateManager', () => ({
  TemplateManager: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('../../utils/formImporter', () => ({
  FormImporter: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('../../utils/formCache', () => ({
  FormCache: jest.fn().mockImplementation(() => ({}))
}));

import { GravityFormsMCPServer } from '../../index';

// Mock fetch for API calls  
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock environment variables
const originalEnv = process.env;
beforeEach(() => {
  process.env = {
    ...originalEnv,
    GRAVITY_FORMS_BASE_URL: 'https://test.com',
    GRAVITY_FORMS_CONSUMER_KEY: 'test_key',
    GRAVITY_FORMS_CONSUMER_SECRET: 'test_secret',
    GRAVITY_FORMS_AUTH_METHOD: 'basic'
  };
});

afterEach(() => {
  process.env = originalEnv;
  jest.clearAllMocks();
});

describe('get_field_mappings MCP Tool', () => {
  let server: GravityFormsMCPServer;

  const mockSimpleForm = {
    id: "123",
    title: "Simple Contact Form",
    fields: [
      { id: "1", label: "Name", type: "text" },
      { id: "2", label: "Email Address", type: "email" },
      { id: "3", label: "Phone Number", type: "phone" }
    ]
  };

  beforeEach(() => {
    server = new GravityFormsMCPServer();
  });

  describe('parameter validation', () => {
    it('should require form_id parameter', async () => {
      const result = await server.callTool({
        params: {
          name: 'get_field_mappings',
          arguments: {}
        }
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('form_id must be a non-empty string');
    });

    it('should reject empty form_id', async () => {
      const result = await server.callTool({
        params: {
          name: 'get_field_mappings',
          arguments: { form_id: '' }
        }
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('form_id cannot be empty');
    });

    it('should reject non-string form_id', async () => {
      const result = await server.callTool({
        params: {
          name: 'get_field_mappings',
          arguments: { form_id: 123 }
        }
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('form_id must be a non-empty string');
    });

    it('should reject non-boolean include_details', async () => {
      const result = await server.callTool({
        params: {
          name: 'get_field_mappings',
          arguments: { 
            form_id: '123',
            include_details: 'yes' 
          }
        }
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('include_details must be a boolean');
    });

    it('should reject non-boolean refresh_cache', async () => {
      const result = await server.callTool({
        params: {
          name: 'get_field_mappings',
          arguments: { 
            form_id: '123',
            refresh_cache: 'true' 
          }
        }
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('refresh_cache must be a boolean');
    });
  });

  describe('successful field analysis', () => {
    it('should analyze simple form and return field mappings', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSimpleForm)
      });

      const result = await server.callTool({
        params: {
          name: 'get_field_mappings',
          arguments: { form_id: '123' }
        }
      });

      expect(result.isError).toBe(false);
      expect(result.content[0].type).toBe('text');
      
      const responseText = result.content[0].text;
      expect(responseText).toContain('Field Mappings for Form 123');
      expect(responseText).toContain('Simple Contact Form');
      expect(responseText).toContain('NAME FIELDS');
      expect(responseText).toContain('EMAIL FIELDS');  
      expect(responseText).toContain('PHONE FIELDS');
      expect(responseText).toContain('FORM COMPLEXITY');
      expect(responseText).toContain('CACHE STATUS');
    });

    it('should include detailed field analysis when requested', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSimpleForm)
      });

      const result = await server.callTool({
        params: {
          name: 'get_field_mappings',
          arguments: { 
            form_id: '123',
            include_details: true
          }
        }
      });

      expect(result.isError).toBe(false);
      
      const responseText = result.content[0].text;
      expect(responseText).toContain('DETAILED FIELD ANALYSIS');
      expect(responseText).toContain('Label:');
      expect(responseText).toContain('Detected Type:');
      expect(responseText).toContain('Confidence:');
      expect(responseText).toContain('Form Type:');
    });
  });

  describe('error handling', () => {
    it('should handle form not found errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const result = await server.callTool({
        params: {
          name: 'get_field_mappings',
          arguments: { form_id: '999' }
        }
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Form 999 not found|API request failed/);
    });

    it('should handle malformed form response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: null, title: null, fields: null })
      });

      const result = await server.callTool({
        params: {
          name: 'get_field_mappings',
          arguments: { form_id: '123' }
        }
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found or inaccessible');
    });

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await server.callTool({
        params: {
          name: 'get_field_mappings',
          arguments: { form_id: '123' }
        }
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Field mapping analysis failed|API request failed/);
    });
  });

  describe('edge cases', () => {
    it('should handle form with no fields', async () => {
      const emptyForm = {
        id: "empty",
        title: "Empty Form",
        fields: []
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(emptyForm)
      });

      const result = await server.callTool({
        params: {
          name: 'get_field_mappings',
          arguments: { form_id: 'empty' }
        }
      });

      expect(result.isError).toBe(false);
      
      const responseText = result.content[0].text;
      expect(responseText).toContain('Empty Form');
      expect(responseText).toContain('Total fields: 0');
    });

    it('should handle form with conditional logic', async () => {
      const formWithConditionalLogic = {
        id: "conditional",
        title: "Conditional Form",
        fields: [
          { 
            id: "1", 
            label: "Name", 
            type: "text" 
          },
          { 
            id: "2", 
            label: "Email", 
            type: "email",
            conditionalLogic: {
              actionType: "show",
              logicType: "all",
              rules: []
            }
          }
        ]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(formWithConditionalLogic)
      });

      const result = await server.callTool({
        params: {
          name: 'get_field_mappings',
          arguments: { form_id: 'conditional' }
        }
      });

      expect(result.isError).toBe(false);
      
      const responseText = result.content[0].text;
      expect(responseText).toContain('Conditional logic: Detected');
    });
  });

  describe('response format validation', () => {
    it('should return properly formatted MCP response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSimpleForm)
      });

      const result = await server.callTool({
        params: {
          name: 'get_field_mappings',
          arguments: { form_id: '123' }
        }
      });

      expect(result).toHaveProperty('isError', false);
      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toHaveProperty('type', 'text');
      expect(result.content[0]).toHaveProperty('text');
      expect(typeof result.content[0].text).toBe('string');
    });
  });
});