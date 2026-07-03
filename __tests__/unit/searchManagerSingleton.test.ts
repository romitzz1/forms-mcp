// ABOUTME: Regression test for the duplicate UniversalSearchManager factory bug (audit A2)
// ABOUTME: Ensures every search entry point shares one singleton that JSON-encodes field_filters

import { GravityFormsMocks } from '../mocks/gravityFormsMocks';

describe('UniversalSearchManager singleton consistency (audit A2)', () => {
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

  const mockForm = GravityFormsMocks.getMockForm({ id: '193' });
  const mockEntries = [
    GravityFormsMocks.getMockEntry({ id: '1', form_id: '193', '1': 'John Smith' })
  ];

  function mockFormAndEntriesResponses() {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/entries')) {
        return { ok: true, json: async () => ({ entries: mockEntries }) };
      }
      return { ok: true, json: async () => mockForm };
    });
  }

  function getEntriesSearchCall() {
    const call = mockFetch.mock.calls.find(([url]) => url.includes('/entries'));
    if (!call) {
      throw new Error('Expected an /entries search request to have been made');
    }
    return new URL(call[0]);
  }

  it('search_entries_by_name must issue a JSON-encoded search request, not "[object Object]"', async () => {
    const server = createServer();
    mockFormAndEntriesResponses();

    await (server).searchEntriesByName({
      form_id: '193',
      search_text: 'John Smith'
    });

    const requestUrl = getEntriesSearchCall();

    // The buggy factory (getUniversalSearchManager) flattens field_filters via
    // String(value), which stringifies an array of objects into "[object Object]".
    for (const value of requestUrl.searchParams.values()) {
      expect(value).not.toContain('[object Object]');
    }

    // The correct encoding puts the whole search params object as JSON under `search`.
    const searchParam = requestUrl.searchParams.get('search');
    expect(searchParam).toBeTruthy();
    const parsed = JSON.parse(searchParam as string);
    expect(Array.isArray(parsed.field_filters)).toBe(true);
  });

  it('search_entries_universal must also share the correctly-encoding singleton', async () => {
    const server = createServer();
    mockFormAndEntriesResponses();

    await (server).searchEntriesUniversal({
      form_id: '193',
      search_queries: [{ text: 'John Smith', field_types: ['name'] }]
    });

    const requestUrl = getEntriesSearchCall();

    for (const value of requestUrl.searchParams.values()) {
      expect(value).not.toContain('[object Object]');
    }

    const searchParam = requestUrl.searchParams.get('search');
    expect(searchParam).toBeTruthy();
    const parsed = JSON.parse(searchParam as string);
    expect(Array.isArray(parsed.field_filters)).toBe(true);
  });

  it('memoizes a single UniversalSearchManager regardless of which entry point runs first', async () => {
    const server = createServer();
    mockFormAndEntriesResponses();

    // Exercise the name-search path first...
    await (server).searchEntriesByName({
      form_id: '193',
      search_text: 'John Smith'
    });

    // ...then the get_entries(search_mode: 'universal') path, which must reuse
    // the exact same, correctly-encoding singleton instance.
    mockFetch.mockClear();
    await (server).getEntries({
      form_id: '193',
      search_mode: 'universal',
      search: { field_filters: [{ key: '1', value: 'John' }] }
    });

    const requestUrl = getEntriesSearchCall();
    for (const value of requestUrl.searchParams.values()) {
      expect(value).not.toContain('[object Object]');
    }
    const searchParam = requestUrl.searchParams.get('search');
    expect(searchParam).toBeTruthy();
    JSON.parse(searchParam as string);
  });
});
