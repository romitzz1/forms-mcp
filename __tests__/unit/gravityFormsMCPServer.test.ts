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
      const { GravityFormsMCPServer } = require('../../dist/index.js');
      
      expect(() => new GravityFormsMCPServer()).not.toThrow();
    });

    test('should load configuration from environment variables', () => {
      const { GravityFormsMCPServer } = require('../../dist/index.js');
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
      const { GravityFormsMCPServer } = require('../../dist/index.js');
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
      const { GravityFormsMCPServer } = require('../../dist/index.js');
      const server = new GravityFormsMCPServer();
      
      const headers = (server as any).getAuthHeaders();
      
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toMatch(/^Basic /);
      
      // Verify base64 encoding
      const base64Part = headers['Authorization'].replace('Basic ', '');
      const decoded = Buffer.from(base64Part, 'base64').toString();
      expect(decoded).toBe('test_key:test_secret');
    });

    test('should throw error for unsupported auth method', () => {
      process.env.GRAVITY_FORMS_AUTH_METHOD = 'oauth';
      
      // Clear module cache to force reload
      delete require.cache[require.resolve('../../dist/index.js')];
      const { GravityFormsMCPServer } = require('../../dist/index.js');
      const server = new GravityFormsMCPServer();
      
      expect(() => (server as any).getAuthHeaders()).toThrow('OAuth authentication not implemented yet');
    });
  });

  describe('API Request Methods', () => {
    test('should make successful GET request', async () => {
      const mockResponse = GravityFormsMocks.getMockForms();
      const mockFetch = GravityFormsMocks.createMockFetch(new Map([
        ['GET https://test.example.com/wp-json/gf/v2/forms', mockResponse]
      ]));
      global.fetch = mockFetch;

      const { GravityFormsMCPServer } = require('../../dist/index.js');
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

      const { GravityFormsMCPServer } = require('../../dist/index.js');
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

      const { GravityFormsMCPServer } = require('../../dist/index.js');
      const server = new GravityFormsMCPServer();
      
      await expect((server as any).makeRequest('/invalid-endpoint'))
        .rejects
        .toThrow('API request failed: HTTP 404: Not Found');
    });

    test('should handle network errors', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'));
      global.fetch = mockFetch;

      const { GravityFormsMCPServer } = require('../../dist/index.js');
      const server = new GravityFormsMCPServer();
      
      await expect((server as any).makeRequest('/forms'))
        .rejects
        .toThrow('API request failed: Network error');
    });
  });

  describe('Server Lifecycle', () => {
    test('should run without errors', async () => {
      const { GravityFormsMCPServer } = require('../../dist/index.js');
      const server = new GravityFormsMCPServer();
      
      // Mock the run method dependencies
      const mockConnect = jest.fn().mockResolvedValue(undefined);
      (server as any).server.connect = mockConnect;

      await expect(server.run()).resolves.toBeUndefined();
      expect(mockConnect).toHaveBeenCalled();
    });
  });
});