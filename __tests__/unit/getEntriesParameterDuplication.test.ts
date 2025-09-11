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

  it('should not duplicate status parameter when using both specific and backward compatibility handling', async () => {
    // Arrange
    const server = createServer();
    const mockEntries = [GravityFormsMocks.getMockEntry({ id: '1' })];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockEntries)
    });

    // Act
    await (server as any).getEntries({
      form_id: '193',
      search: {
        status: 'active',
        field_filters: [{ key: '52', value: 'John' }],
        date_range: { start: '2024-01-01', end: '2024-12-31' },
        created_by: '1', // This should go through backward compatibility
        payment_status: 'Paid' // This should also go through backward compatibility
      }
    });

    // Assert - check URL doesn't have duplicate status parameters
    const [url] = mockFetch.mock.calls[0];
    
    // Count occurrences of status parameter
    const statusMatches = url.match(/search%5Bstatus%5D=/g);
    expect(statusMatches).not.toBeNull();
    expect(statusMatches?.length).toBe(1); // Should appear exactly once
    
    // Verify all parameters are present
    expect(url).toContain('search%5Bstatus%5D=active');
    expect(url).toContain('search%5Bfield_filters%5D%5B0%5D%5Bkey%5D=52');
    expect(url).toContain('search%5Bdate_range%5D%5Bstart%5D=2024-01-01');
    expect(url).toContain('search%5Bcreated_by%5D=1');
    expect(url).toContain('search%5Bpayment_status%5D=Paid');
    
    // Count total search parameters to ensure no duplicates
    const allSearchParams = url.match(/search%5B[^%]+%5D=/g) || [];
    const uniqueSearchParams = [...new Set(allSearchParams)];
    expect(allSearchParams.length).toBe(uniqueSearchParams.length);
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
    await (server as any).getEntries({
      form_id: '193',
      search: {
        field_filters: [{ key: '52', value: 'John' }],
        other_param: 'test'
      }
    });

    // Assert - field_filters should only be handled by the specific section
    const [url] = mockFetch.mock.calls[0];
    
    // Should have proper field_filters format
    expect(url).toContain('search%5Bfield_filters%5D%5B0%5D%5Bkey%5D=52');
    
    // Should NOT have flat field_filters parameter from backward compatibility
    expect(url).not.toContain('search%5Bfield_filters%5D=%5Bobject+Object%5D');
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
    await (server as any).getEntries({
      form_id: '193',
      search: {
        date_range: { start: '2024-01-01', end: '2024-12-31' },
        other_param: 'test'
      }
    });

    // Assert
    const [url] = mockFetch.mock.calls[0];
    
    // Should have proper date_range format
    expect(url).toContain('search%5Bdate_range%5D%5Bstart%5D=2024-01-01');
    expect(url).toContain('search%5Bdate_range%5D%5Bend%5D=2024-12-31');
    
    // Should NOT have flat date_range parameter from backward compatibility
    expect(url).not.toContain('search%5Bdate_range%5D=%5Bobject+Object%5D');
  });
});