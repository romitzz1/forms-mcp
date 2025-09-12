// ABOUTME: Unit tests for update_form tool in Gravity Forms MCP Server
// ABOUTME: Tests form updating functionality with API integration and error handling

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable jest/prefer-strict-equal */

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

describe('Update Form Tool', () => {
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
    
    // Clear module cache for clean server instances
    delete require.cache[require.resolve('../../index')];
    
    // Reset global fetch mock
    if (global.fetch) {
      (global.fetch as jest.Mock).mockClear();
    }
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    
    // Clean up global mocks
    if (global.fetch && typeof global.fetch === 'function' && 'mockRestore' in global.fetch) {
      (global.fetch as jest.Mock).mockRestore();
    }
  });

  // Test structure will be added in subsequent steps
  describe('Tool Registration', () => {
    it('should list update_form in available tools', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      // Mock the server's request handler for tools/list
      let capturedToolsResponse: any;
      mockServer.setRequestHandler.mockImplementation((schema: any, handler: any) => {
        if (schema === 'ListToolsRequestSchema') {
          capturedToolsResponse = handler;
        }
      });
      
      // Access the actual implementation by re-triggering setup
      server.setupToolHandlers?.() || (() => {
        // If setupToolHandlers is not exposed, create a new instance
        new GravityFormsMCPServer();
      })();
      
      expect(capturedToolsResponse).toBeDefined();
      const response = await capturedToolsResponse({});
      const toolNames = response.tools.map((tool: any) => tool.name);
      
      expect(toolNames).toContain('update_form');
    });

    it('should have correct tool description', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      let capturedToolsResponse: any;
      mockServer.setRequestHandler.mockImplementation((schema: any, handler: any) => {
        if (schema === 'ListToolsRequestSchema') {
          capturedToolsResponse = handler;
        }
      });
      
      new GravityFormsMCPServer();
      
      const response = await capturedToolsResponse({});
      const updateFormTool = response.tools.find((tool: any) => tool.name === 'update_form');
      expect(updateFormTool).toBeDefined();
      expect(updateFormTool.description).toBe('Update an existing form');
    });

    it('should have correct required parameters in input schema', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      let capturedToolsResponse: any;
      mockServer.setRequestHandler.mockImplementation((schema: any, handler: any) => {
        if (schema === 'ListToolsRequestSchema') {
          capturedToolsResponse = handler;
        }
      });
      
      new GravityFormsMCPServer();
      
      const response = await capturedToolsResponse({});
      const updateFormTool = response.tools.find((tool: any) => tool.name === 'update_form');
      expect(updateFormTool).toBeDefined();
      expect(updateFormTool.inputSchema.required).toEqual(expect.arrayContaining(['form_id', 'title', 'fields']));
      expect(updateFormTool.inputSchema.required).toHaveLength(3);
    });

    it('should have proper input schema structure', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      let capturedToolsResponse: any;
      mockServer.setRequestHandler.mockImplementation((schema: any, handler: any) => {
        if (schema === 'ListToolsRequestSchema') {
          capturedToolsResponse = handler;
        }
      });
      
      new GravityFormsMCPServer();
      
      const response = await capturedToolsResponse({});
      const updateFormTool = response.tools.find((tool: any) => tool.name === 'update_form');
      expect(updateFormTool).toBeDefined();
      
      const { properties } = updateFormTool.inputSchema;
      expect(properties.form_id).toEqual({
        type: 'string',
        description: 'ID of the form to update'
      });
      expect(properties.title).toEqual({
        type: 'string',
        description: 'Updated form title'
      });
      expect(properties.fields).toEqual({
        type: 'array',
        description: 'Updated array of field objects'
      });
    });

    it('should have optional parameters defined', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();
      
      let capturedToolsResponse: any;
      mockServer.setRequestHandler.mockImplementation((schema: any, handler: any) => {
        if (schema === 'ListToolsRequestSchema') {
          capturedToolsResponse = handler;
        }
      });
      
      new GravityFormsMCPServer();
      
      const response = await capturedToolsResponse({});
      const updateFormTool = response.tools.find((tool: any) => tool.name === 'update_form');
      expect(updateFormTool).toBeDefined();
      
      const { properties } = updateFormTool.inputSchema;
      expect(properties.description).toBeDefined();
      expect(properties.description.type).toBe('string');
      expect(properties.description.description).toContain('form description');
    });
  });

  describe('Update Form Success', () => {
    beforeEach(() => {
      // Setup global fetch mock for each test
      const mockFetch = jest.fn();
      global.fetch = mockFetch;
    });

    it('should successfully update a form with valid parameters', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      const server = new GravityFormsMCPServer();

      const updateFormData = {
        form_id: '1',
        title: 'Updated Contact Form',
        fields: [
          { id: 1, type: 'text', label: 'Updated First Name', isRequired: true },
          { id: 2, type: 'email', label: 'Updated Email Address', isRequired: true }
        ],
        description: 'Updated form description'
      };

      const mockUpdatedForm = {
        id: '1',
        title: 'Updated Contact Form', 
        description: 'Updated form description',
        fields: updateFormData.fields,
        is_active: '1',
        date_created: '2024-01-01 10:00:00'
      };

      // Mock successful API response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockUpdatedForm
      });

      // Mock the tool handler
      let capturedToolHandler: any;
      mockServer.setRequestHandler.mockImplementation((schema: any, handler: any) => {
        if (schema === 'CallToolRequestSchema') {
          capturedToolHandler = handler;
        }
      });

      new GravityFormsMCPServer();

      const response = await capturedToolHandler({
        params: {
          name: 'update_form',
          arguments: updateFormData
        }
      });

      expect(response.content[0].text).toContain('Successfully updated form');
      expect(response.content[0].text).toContain('Updated Contact Form');
      expect(response.content[0].text).toContain(JSON.stringify(mockUpdatedForm, null, 2));
      
      // Verify the correct API endpoint was called with PUT method
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/forms/1'),
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Authorization': expect.stringMatching(/^Basic /),
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({
            title: 'Updated Contact Form',
            fields: updateFormData.fields,
            description: 'Updated form description'
          })
        })
      );
    });

    it('should make PUT request to correct endpoint', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      
      const updateFormData = {
        form_id: '123',
        title: 'Test Form Update',
        fields: [{ id: 1, type: 'text', label: 'Test Field' }]
      };

      const mockResponse = {
        id: '123',
        title: 'Test Form Update',
        fields: updateFormData.fields
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      let capturedToolHandler: any;
      mockServer.setRequestHandler.mockImplementation((schema: any, handler: any) => {
        if (schema === 'CallToolRequestSchema') {
          capturedToolHandler = handler;
        }
      });

      new GravityFormsMCPServer();

      await capturedToolHandler({
        params: {
          name: 'update_form',
          arguments: updateFormData
        }
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/wp-json/gf/v2/forms/123'),
        expect.objectContaining({
          method: 'PUT'
        })
      );
    });

    it('should include title and fields in request body', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      
      const updateFormData = {
        form_id: '1',
        title: 'Required Title',
        fields: [
          { id: 1, type: 'text', label: 'Required Field' }
        ]
      };

      const mockResponse = {
        id: '1',
        title: 'Required Title',
        fields: updateFormData.fields
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      let capturedToolHandler: any;
      mockServer.setRequestHandler.mockImplementation((schema: any, handler: any) => {
        if (schema === 'CallToolRequestSchema') {
          capturedToolHandler = handler;
        }
      });

      new GravityFormsMCPServer();

      await capturedToolHandler({
        params: {
          name: 'update_form',
          arguments: updateFormData
        }
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          body: JSON.stringify({
            title: 'Required Title',
            fields: [{ id: 1, type: 'text', label: 'Required Field' }]
          })
        })
      );
    });

    it('should return updated form data in response', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      
      const updateFormData = {
        form_id: '5',
        title: 'Response Test Form',
        fields: [
          { id: 1, type: 'text', label: 'Response Field' }
        ]
      };

      const mockUpdatedForm = {
        id: '5',
        title: 'Response Test Form',
        fields: updateFormData.fields,
        is_active: '1',
        date_created: '2024-01-01 12:00:00',
        date_updated: '2024-01-01 15:30:00'
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockUpdatedForm
      });

      let capturedToolHandler: any;
      mockServer.setRequestHandler.mockImplementation((schema: any, handler: any) => {
        if (schema === 'CallToolRequestSchema') {
          capturedToolHandler = handler;
        }
      });

      new GravityFormsMCPServer();

      const response = await capturedToolHandler({
        params: {
          name: 'update_form',
          arguments: updateFormData
        }
      });

      expect(response.content[0].text).toContain('Response Test Form');
      expect(response.content[0].text).toContain('"id": "5"');
      expect(response.content[0].text).toContain('"date_updated": "2024-01-01 15:30:00"');
      expect(response.content[0].text).toContain('Response Field');
    });
  });

  describe('Parameter Validation', () => {
    // Tests will be added in next step
  });

  describe('Error Handling', () => {
    // Tests will be added in next step
  });
});