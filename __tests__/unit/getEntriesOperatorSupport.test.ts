// ABOUTME: Unit tests for getEntries operator support in field_filters
// ABOUTME: Tests all Gravity Forms supported operators and parameter handling

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

describe('getEntries Operator Support', () => {
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

  function createExpectedSearchUrl(baseUrl: string, formId: string, searchObject: any): string {
    const params = new URLSearchParams();
    params.append('search', JSON.stringify(searchObject));
    return `${baseUrl}/wp-json/gf/v2/forms/${formId}/entries?${params.toString()}`;
  }

  it('should default to equals operator when no operator provided', async () => {
    // Arrange
    const server = createServer();
    const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockEntries)
    });

    // Act
    await (server).getEntries({
      form_id: '193',
      search: {
        field_filters: [
          { key: '52', value: 'John' } // No operator provided
        ]
      }
    });

    // Assert - should default to '=' operator
    const [url] = mockFetch.mock.calls[0];
    const expectedUrl = createExpectedSearchUrl('https://test.example.com', '193', {
      field_filters: [{ key: '52', value: 'John', operator: '=' }]
    });
    expect(url).toBe(expectedUrl);
  });

  it('should handle contains operator', async () => {
    // Arrange
    const server = createServer();
    const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockEntries)
    });

    // Act
    await (server).getEntries({
      form_id: '193',
      search: {
        field_filters: [
          { key: '52', value: 'John', operator: 'contains' }
        ]
      }
    });

    // Assert
    const [url] = mockFetch.mock.calls[0];
    const expectedUrl = createExpectedSearchUrl('https://test.example.com', '193', {
      field_filters: [{ key: '52', value: 'John', operator: 'contains' }]
    });
    expect(url).toBe(expectedUrl);
  });

  it('should handle all supported operators', async () => {
    // Arrange
    const server = createServer();
    const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];
    const supportedOperators = ['=', 'IS', 'CONTAINS', 'IS NOT', 'ISNOT', '<>', 'LIKE', 'NOT IN', 'NOTIN', 'IN'];

    // Mock each call
    supportedOperators.forEach(() => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockEntries)
      });
    });

    // Act - test each operator
    for (const operator of supportedOperators) {
      await (server).getEntries({
        form_id: '193',
        search: {
          field_filters: [
            { key: '52', value: 'test', operator: operator }
          ]
        }
      });
    }

    // Assert - each call should include the correct operator
    expect(mockFetch).toHaveBeenCalledTimes(supportedOperators.length);
    
    supportedOperators.forEach((operator, index) => {
      const [url] = mockFetch.mock.calls[index];
      const expectedUrl = createExpectedSearchUrl('https://test.example.com', '193', {
        field_filters: [{ key: '52', value: 'test', operator: operator }]
      });
      expect(url).toBe(expectedUrl);
    });
  });

  it('should handle multiple field filters with different operators', async () => {
    // Arrange
    const server = createServer();
    const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockEntries)
    });

    // Act
    await (server).getEntries({
      form_id: '193',
      search: {
        field_filters: [
          { key: '52', value: 'John', operator: 'contains' },
          { key: '54', value: 'test@email.com', operator: '=' },
          { key: '56', value: 'exclude', operator: 'IS NOT' }
        ]
      }
    });

    // Assert
    const [url] = mockFetch.mock.calls[0];
    const expectedUrl = createExpectedSearchUrl('https://test.example.com', '193', {
      field_filters: [
        { key: '52', value: 'John', operator: 'contains' },
        { key: '54', value: 'test@email.com', operator: '=' },
        { key: '56', value: 'exclude', operator: 'IS NOT' }
      ]
    });
    expect(url).toBe(expectedUrl);
  });

  it('should trim operator values', async () => {
    // Arrange
    const server = createServer();
    const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockEntries)
    });

    // Act
    await (server).getEntries({
      form_id: '193',
      search: {
        field_filters: [
          { key: '52', value: 'John', operator: '  contains  ' } // Whitespace around operator
        ]
      }
    });

    // Assert - operator should be trimmed
    const [url] = mockFetch.mock.calls[0];
    const expectedUrl = createExpectedSearchUrl('https://test.example.com', '193', {
      field_filters: [{ key: '52', value: 'John', operator: 'contains' }]
    });
    expect(url).toBe(expectedUrl);
  });

  it('should handle case sensitivity in operators', async () => {
    // Arrange
    const server = createServer();
    const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockEntries)
    });

    // Act
    await (server).getEntries({
      form_id: '193',
      search: {
        field_filters: [
          { key: '52', value: 'John', operator: 'Contains' } // Mixed case
        ]
      }
    });

    // Assert - should preserve case as provided
    const [url] = mockFetch.mock.calls[0];
    const expectedUrl = createExpectedSearchUrl('https://test.example.com', '193', {
      field_filters: [{ key: '52', value: 'John', operator: 'Contains' }]
    });
    expect(url).toBe(expectedUrl);
  });

  it('should handle numeric and boolean operators correctly', async () => {
    // Arrange
    const server = createServer();
    const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockEntries)
    });

    // Act
    await (server).getEntries({
      form_id: '193',
      search: {
        field_filters: [
          { key: '52', value: 100, operator: '>' },  // Numeric operator (even though not officially supported, should be converted to string)
          { key: '54', value: true, operator: '=' }   // Boolean value
        ]
      }
    });

    // Assert
    const [url] = mockFetch.mock.calls[0];
    const expectedUrl = createExpectedSearchUrl('https://test.example.com', '193', {
      field_filters: [
        { key: '52', value: '100', operator: '>' },  // Values get converted to strings
        { key: '54', value: 'true', operator: '=' }   // Boolean value converted to string
      ]
    });
    expect(url).toBe(expectedUrl);
  });
});