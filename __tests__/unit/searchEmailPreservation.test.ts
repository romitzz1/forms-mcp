// ABOUTME: Regression tests for audit A4 (part 2) - a name-only search must not drop the
// ABOUTME: entry's email field, since search_entries_by_name/universal never match on it directly

// Mock utility dependencies that aren't relevant to search
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

// A form with a composite Name field (id "6", sub-inputs 6.3/6.6) and a
// separate Email field (id "9"). This mirrors real-world forms where name
// and email are never the same field, so a name-only search's matchedFields
// can never contain the email.
const mockFormData = {
  id: '193',
  title: 'Roster Signup',
  fields: [
    {
      id: '6',
      label: 'Name',
      type: 'name',
      inputs: [
        { id: '6.3', label: 'First Name' },
        { id: '6.6', label: 'Last Name' }
      ]
    },
    { id: '9', label: 'Email', type: 'email' }
  ]
};

const mockEntry = {
  id: '555',
  form_id: '193',
  '6.3': 'Amanda',
  '6.6': 'Lee',
  '9': 'amanda@example.com'
};

function mockFetchByUrl() {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/entries')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ entries: [mockEntry] })
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(mockFormData)
    });
  });
}

describe('search tools preserve email fields dropped from matchedFields', () => {
  let server: GravityFormsMCPServer;

  beforeEach(() => {
    server = new GravityFormsMCPServer();
    mockFetchByUrl();
  });

  it('search_entries_by_name renders both the matched name and the unmatched email', async () => {
    // "Amanda Lee" matches both name sub-inputs (6.3, 6.6) but the search
    // never touches the email field (9), so matchedFields will only ever
    // contain the name - the email must still show up via the full entry.
    const result = await server.callTool({
      params: {
        name: 'search_entries_by_name',
        arguments: {
          form_id: '193',
          search_text: 'Amanda Lee',
          output_mode: 'detailed'
        }
      }
    });

    expect(result.isError).toBe(false);
    const text = result.content[0].text;
    expect(text).toContain('Amanda');
    expect(text).toContain('amanda@example.com');
  });

  it('search_entries_by_name renders the unmatched email in summary mode too', async () => {
    const result = await server.callTool({
      params: {
        name: 'search_entries_by_name',
        arguments: {
          form_id: '193',
          search_text: 'Amanda Lee',
          output_mode: 'summary'
        }
      }
    });

    expect(result.isError).toBe(false);
    const text = result.content[0].text;
    expect(text).toContain('Amanda');
    expect(text).toContain('amanda@example.com');
  });

  it('search_entries_universal renders both the matched name and the unmatched email', async () => {
    const result = await server.callTool({
      params: {
        name: 'search_entries_universal',
        arguments: {
          form_id: '193',
          search_queries: [{ text: 'Amanda Lee', field_types: ['name'] }],
          output_options: { mode: 'detailed' }
        }
      }
    });

    expect(result.isError).toBe(false);
    const text = result.content[0].text;
    expect(text).toContain('Amanda');
    expect(text).toContain('amanda@example.com');
  });
});
