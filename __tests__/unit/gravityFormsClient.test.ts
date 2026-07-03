// ABOUTME: Unit tests for the GravityFormsClient HTTP client
// ABOUTME: Verifies request construction, auth headers, and error wrapping against a mocked fetch

import { GravityFormsClient } from '../../utils/gravityFormsClient';

describe('GravityFormsClient', () => {
  const config = {
    baseUrl: 'https://test.example.com',
    consumerKey: 'test_key',
    consumerSecret: 'test_secret',
    authMethod: 'basic' as const
  };

  it('should fetch the built URL with a Basic auth header', async () => {
    const mockResponse = { id: '1' };
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => mockResponse
    });
    global.fetch = mockFetch;

    const client = new GravityFormsClient(config);
    const result = await client.makeRequest('/forms', 'GET');

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

    const authHeader = mockFetch.mock.calls[0][1].headers['Authorization'];
    const decoded = Buffer.from(authHeader.replace('Basic ', ''), 'base64').toString();
    expect(decoded).toBe('test_key:test_secret');
  });

  it('should throw a wrapped error for a non-ok response', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => ''
    });
    global.fetch = mockFetch;

    const client = new GravityFormsClient(config);

    await expect(client.makeRequest('/invalid-endpoint'))
      .rejects
      .toThrow('API request failed: HTTP 404: Not Found');
  });
});
