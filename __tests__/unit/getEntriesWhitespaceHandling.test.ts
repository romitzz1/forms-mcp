// ABOUTME: Unit tests for whitespace and trimming handling in getEntries
// ABOUTME: Ensures proper trimming behavior and edge cases with whitespace

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

describe('getEntries Whitespace Handling', () => {
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

  it('should trim whitespace from keys and values', async () => {
    // Arrange
    const server = createServer();
    const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockEntries)
    });

    // Act - keys and values with whitespace
    await (server as any).getEntries({
      form_id: '193',
      search: {
        field_filters: [
          { key: '  52  ', value: '  John Smith  ' }
        ]
      }
    });

    // Assert - whitespace should be trimmed
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('search%5Bfield_filters%5D%5B0%5D%5Bkey%5D=52'); // trimmed
    expect(url).toContain('search%5Bfield_filters%5D%5B0%5D%5Bvalue%5D=John+Smith'); // trimmed
  });

  it('should reject filters with empty keys after trimming but allow empty values', async () => {
    // Arrange
    const server = createServer();
    const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockEntries)
    });

    // Act - filters with whitespace-only keys should be ignored, empty values allowed
    await (server as any).getEntries({
      form_id: '193',
      search: {
        field_filters: [
          { key: '   ', value: 'John' }, // key becomes empty after trim - should be rejected
          { key: '52', value: '   ' }, // value becomes empty after trim - should be allowed
          { key: '54', value: 'Valid' } // this should work
        ]
      }
    });

    // Assert
    const [url] = mockFetch.mock.calls[0];
    
    // Should not contain filter with empty key after trimming
    expect(url).not.toContain('search%5Bfield_filters%5D%5B0%5D');
    
    // Should contain filter with empty value (searching for empty field values)
    expect(url).toContain('search%5Bfield_filters%5D%5B1%5D%5Bkey%5D=52');
    expect(url).toContain('search%5Bfield_filters%5D%5B1%5D%5Bvalue%5D='); // empty value allowed
    
    // Should contain the normal valid filter
    expect(url).toContain('search%5Bfield_filters%5D%5B2%5D%5Bkey%5D=54');
    expect(url).toContain('search%5Bfield_filters%5D%5B2%5D%5Bvalue%5D=Valid');
  });

  it('should handle mixed whitespace scenarios', async () => {
    // Arrange
    const server = createServer();
    const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockEntries)
    });

    // Act - mix of valid, invalid, and trimmed filters
    await (server as any).getEntries({
      form_id: '193',
      search: {
        field_filters: [
          { key: null, value: 'test' }, // null key - should be rejected
          { key: '   ', value: 'test' }, // whitespace-only key - should be rejected after trim  
          { key: '52', value: '  John  ' }, // valid with whitespace - should be trimmed
          { key: '54', value: '' }, // empty string value - should be allowed
          { key: '  55  ', value: 0 } // numeric value with whitespace key - should work
        ]
      }
    });

    // Assert
    const [url] = mockFetch.mock.calls[0];
    
    // Should contain valid filters (indices 2, 3, 4 but renumbered in URL)
    expect(url).toContain('search%5Bfield_filters%5D%5B2%5D%5Bkey%5D=52');
    expect(url).toContain('search%5Bfield_filters%5D%5B2%5D%5Bvalue%5D=John');
    expect(url).toContain('search%5Bfield_filters%5D%5B3%5D%5Bkey%5D=54');
    expect(url).toContain('search%5Bfield_filters%5D%5B3%5D%5Bvalue%5D=');
    expect(url).toContain('search%5Bfield_filters%5D%5B4%5D%5Bkey%5D=55');
    expect(url).toContain('search%5Bfield_filters%5D%5B4%5D%5Bvalue%5D=0');
  });
});