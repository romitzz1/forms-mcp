// ABOUTME: Unit tests for getEntries edge case handling
// ABOUTME: Tests proper handling of empty strings, zeros, and false values in field filters

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

describe('getEntries Edge Cases', () => {
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

  it('should handle empty string values in field filters', async () => {
    // Arrange
    const server = createServer();
    const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockEntries)
    });

    // Act - search for entries with empty field value
    await (server as any).getEntries({
      form_id: '193',
      search: {
        field_filters: [
          { key: '52', value: '' } // Empty string should be allowed
        ]
      }
    });

    // Assert - empty string search should work
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('search%5Bfield_filters%5D%5B0%5D%5Bkey%5D=52');
    expect(url).toContain('search%5Bfield_filters%5D%5B0%5D%5Bvalue%5D=');
  });

  it('should handle zero values in field filters', async () => {
    // Arrange
    const server = createServer();
    const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockEntries)
    });

    // Act - search for entries with zero value
    await (server as any).getEntries({
      form_id: '193',
      search: {
        field_filters: [
          { key: '52', value: 0 } // Zero should be allowed
        ]
      }
    });

    // Assert - zero value search should work
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('search%5Bfield_filters%5D%5B0%5D%5Bkey%5D=52');
    expect(url).toContain('search%5Bfield_filters%5D%5B0%5D%5Bvalue%5D=0');
  });

  it('should handle false values in field filters', async () => {
    // Arrange
    const server = createServer();
    const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockEntries)
    });

    // Act - search for entries with false value
    await (server as any).getEntries({
      form_id: '193',
      search: {
        field_filters: [
          { key: '52', value: false } // False should be allowed
        ]
      }
    });

    // Assert - false value search should work
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('search%5Bfield_filters%5D%5B0%5D%5Bkey%5D=52');
    expect(url).toContain('search%5Bfield_filters%5D%5B0%5D%5Bvalue%5D=false');
  });

  it('should reject filters with missing key', async () => {
    // Arrange
    const server = createServer();
    const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockEntries)
    });

    // Act - filter with missing key should be ignored
    await (server as any).getEntries({
      form_id: '193',
      search: {
        field_filters: [
          { value: 'John' }, // Missing key - should be ignored
          { key: '52', value: 'Valid' } // Valid filter - should be included
        ]
      }
    });

    // Assert - only valid filter should be in URL
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('search%5Bfield_filters%5D%5B1%5D%5Bkey%5D=52');
    expect(url).toContain('search%5Bfield_filters%5D%5B1%5D%5Bvalue%5D=Valid');
    // Should not contain the invalid filter
    expect(url).not.toContain('search%5Bfield_filters%5D%5B0%5D');
  });

  it('should reject filters with missing value', async () => {
    // Arrange
    const server = createServer();
    const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockEntries)
    });

    // Act - filter with missing value should be ignored
    await (server as any).getEntries({
      form_id: '193',
      search: {
        field_filters: [
          { key: '52' }, // Missing value - should be ignored
          { key: '54', value: 'Valid' } // Valid filter - should be included
        ]
      }
    });

    // Assert - only valid filter should be in URL
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('search%5Bfield_filters%5D%5B1%5D%5Bkey%5D=54');
    expect(url).toContain('search%5Bfield_filters%5D%5B1%5D%5Bvalue%5D=Valid');
    // Should not contain the invalid filter
    expect(url).not.toContain('search%5Bfield_filters%5D%5B0%5D');
  });
});