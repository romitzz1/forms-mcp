// ABOUTME: Unit test to verify no parameter duplication in getEntries
// ABOUTME: Ensures backward compatibility doesn't create duplicate URL parameters

import { GravityFormsMocks } from '../mocks/gravityFormsMocks';

// Mock the entire MCP SDK at the module level
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

describe('getEntries Parameter Duplication Prevention', () => {
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

  it('should not duplicate status parameter when using both specific and backward compatibility handling', async () => {
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
        status: 'active',
        field_filters: [{ key: '52', value: 'John' }],
        date_range: { start: '2024-01-01', end: '2024-12-31' },
        created_by: '1', // This should go through backward compatibility
        payment_status: 'Paid' // This should also go through backward compatibility
      }
    });

    // Assert - verify JSON structure contains all parameters without duplication
    const [url] = mockFetch.mock.calls[0];
    const expectedUrl = createExpectedSearchUrl('https://test.example.com', '193', {
      status: 'active',
      field_filters: [{ key: '52', value: 'John', operator: '=' }],
      date_range: { start: '2024-01-01', end: '2024-12-31' },
      created_by: '1',
      payment_status: 'Paid'
    });
    expect(url).toBe(expectedUrl);
    
    // Additional check: parse the JSON to verify structure
    const urlObj = new URL(url);
    const searchParam = urlObj.searchParams.get('search');
    expect(searchParam).toBeTruthy();
    const searchObj = JSON.parse(searchParam!);
    expect(searchObj).toEqual({
      status: 'active',
      field_filters: [{ key: '52', value: 'John', operator: '=' }],
      date_range: { start: '2024-01-01', end: '2024-12-31' },
      created_by: '1',
      payment_status: 'Paid'
    });
  });

  it('should not duplicate field_filters parameter', async () => {
    // Arrange
    const server = createServer();
    const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockEntries)
    });

    // Act - try to trigger potential duplication with field_filters
    await (server).getEntries({
      form_id: '193',
      search: {
        field_filters: [{ key: '52', value: 'John' }],
        other_param: 'test'
      }
    });

    // Assert - verify JSON structure contains proper field_filters
    const [url] = mockFetch.mock.calls[0];
    const expectedUrl = createExpectedSearchUrl('https://test.example.com', '193', {
      field_filters: [{ key: '52', value: 'John', operator: '=' }],
      other_param: 'test'
    });
    expect(url).toBe(expectedUrl);
    
    // Verify JSON structure
    const urlObj = new URL(url);
    const searchParam = urlObj.searchParams.get('search');
    const searchObj = JSON.parse(searchParam!);
    expect(searchObj.field_filters).toEqual([{ key: '52', value: 'John', operator: '=' }]);
    expect(searchObj.other_param).toBe('test');
  });

  it('should not duplicate date_range parameter', async () => {
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
        date_range: { start: '2024-01-01', end: '2024-12-31' },
        other_param: 'test'
      }
    });

    // Assert - verify JSON structure contains proper date_range
    const [url] = mockFetch.mock.calls[0];
    const expectedUrl = createExpectedSearchUrl('https://test.example.com', '193', {
      date_range: { start: '2024-01-01', end: '2024-12-31' },
      other_param: 'test'
    });
    expect(url).toBe(expectedUrl);
    
    // Verify JSON structure
    const urlObj = new URL(url);
    const searchParam = urlObj.searchParams.get('search');
    const searchObj = JSON.parse(searchParam!);
    expect(searchObj.date_range).toEqual({ start: '2024-01-01', end: '2024-12-31' });
    expect(searchObj.other_param).toBe('test');
  });
});