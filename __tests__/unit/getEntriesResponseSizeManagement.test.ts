// ABOUTME: Unit tests for response size management in getEntries
// ABOUTME: Tests token estimation, response summarization, and automatic size limiting

import { GravityFormsMocks } from '../mocks/gravityFormsMocks';

describe('getEntries Response Size Management', () => {
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

  function createLargeEntry(id: string, size: 'normal' | 'large' | 'huge' = 'normal') {
    const base = GravityFormsMocks.getMockEntry({
      id,
      form_id: '193',
      '1.3': 'John',       // GF universal name sub-field (first name)
      '1.6': 'Smith',      // GF universal name sub-field (last name)
      '4': 'john.smith@email.com',  // Email field
      payment_status: 'Paid'
    });

    if (size === 'large') {
      // Add many fields to make it large (~2k characters)
      for (let i = 60; i < 90; i++) {
        base[i] = `Large field content ${i} with lots of text that makes the response much bigger than normal entries`;
      }
    } else if (size === 'huge') {
      // Add massive fields (~10k characters)
      for (let i = 60; i < 120; i++) {
        base[i] = `Huge field content ${i} `.repeat(100) + ' with massive amounts of text data';
      }
    }

    return base;
  }

  describe('Token Estimation', () => {
    it('should estimate tokens correctly using 4:1 character ratio', async () => {
      const server = createServer();
      
      // Test the token estimation utility directly
      const testText = 'This is a test string with exactly 49 characters!';
      const estimatedTokens = (server).estimateTokenCount(testText);
      
      // 49 characters / 4 = 12.25 tokens, should round up to 13
      expect(estimatedTokens).toBe(13);
    });

    it('should estimate tokens for complex objects correctly', async () => {
      const server = createServer();
      const entry = createLargeEntry('1', 'large');
      const entryJson = JSON.stringify(entry);
      const estimatedTokens = (server).estimateTokenCount(entryJson);
      
      // Should be roughly entryJson.length / 4
      const expectedTokens = Math.ceil(entryJson.length / 4);
      expect(estimatedTokens).toBe(expectedTokens);
      expect(estimatedTokens).toBeGreaterThan(100); // Large entry should have substantial tokens
    });

    it('should handle empty content correctly', async () => {
      const server = createServer();
      expect((server).estimateTokenCount('')).toBe(0);
      expect((server).estimateTokenCount(null)).toBe(0);
      expect((server).estimateTokenCount(undefined)).toBe(0);
    });
  });

  describe('Entry Summarization', () => {
    it('keeps all populated short fields and truncates (not drops) huge ones', async () => {
      const server = createServer();
      const entry = createLargeEntry('12345', 'huge');

      const summary = (server).createEntrySummary(entry);

      // Should contain essential fields
      expect(summary.id).toBe('12345');
      expect(summary.form_id).toBe('193');
      expect(summary.date_created).toBe(entry.date_created);
      expect(summary.payment_status).toBe('Paid');

      // Short answer fields are preserved verbatim
      expect(summary['1.3']).toBe('John'); // First name sub-field
      expect(summary['1.6']).toBe('Smith'); // Last name sub-field
      expect(summary['4']).toBe('john.smith@email.com'); // Email field

      // Huge fields are truncated with a marker and flagged, not silently dropped
      expect(summary['60']).toBeDefined();
      expect(String(summary['60']).length).toBeLessThan(entry['60'].length);
      expect(summary._summary.truncated_fields).toContain('60');
      expect(summary._summary.truncated_fields).toContain('100');

      // Summary should still be much smaller than the original
      const originalSize = JSON.stringify(entry).length;
      const summarySize = JSON.stringify(summary).length;
      expect(summarySize).toBeLessThan(originalSize * 0.2); // Less than 20% of original
    });

    it('should preserve all fields when entry is already small', async () => {
      const server = createServer();
      const entry = createLargeEntry('123', 'normal');
      
      const summary = (server).createEntrySummary(entry);
      
      // For normal-sized entries, summary should include more fields
      expect(Object.keys(summary).length).toBeGreaterThan(5);
      expect(summary.id).toBe('123');
      expect(summary['1.3']).toBe('John');
      expect(summary['1.6']).toBe('Smith');
    });

    it('should handle entries missing common fields gracefully', async () => {
      const server = createServer();
      const entry = {
        id: '999',
        form_id: '193',
        date_created: '2024-01-01 12:00:00',
        // Missing payment_status, name fields, email fields
        '99': 'Some other field'
      };
      
      const summary = (server).createEntrySummary(entry);
      
      expect(summary.id).toBe('999');
      expect(summary.form_id).toBe('193');
      expect(summary.date_created).toBe('2024-01-01 12:00:00');
      expect(summary.payment_status).toBeUndefined(); // Missing is OK
      expect(summary['1.3']).toBeUndefined(); // Missing is OK
      expect(summary['99']).toBe('Some other field'); // Other fields preserved if small
    });

    it('includes long free-text fields as truncated values rather than dropping them', async () => {
      const server = createServer();
      // Long free-text answers must survive summary mode — just truncated, and flagged,
      // never silently discarded (that was the reported data-loss bug).
      const prose = 'Please contact me @ the rink. ' + 'x'.repeat(500);
      const entry: any = {
        id: '777',
        form_id: '193',
        date_created: '2024-01-01 12:00:00',
        payment_status: 'Paid',
        '4': 'jane.doe@email.com', // short answer — kept verbatim
        '60': prose,               // long free-text — kept but truncated
        '61': 'y'.repeat(2500),    // long filler — kept but truncated
      };

      const summary = (server).createEntrySummary(entry);

      // Short field kept verbatim
      expect(summary['4']).toBe('jane.doe@email.com');
      // Long fields are kept (truncated) and flagged, not dropped
      expect(summary['60']).toBeDefined();
      expect(String(summary['60'])).toContain('truncated');
      expect(summary['61']).toBeDefined();
      expect(String(summary['61'])).toContain('truncated');
      expect(summary._summary.truncated_fields).toEqual(expect.arrayContaining(['60', '61']));
    });
  });

  describe('Response Mode Handling', () => {
    it('should use full mode by default when response_mode not specified', async () => {
      const server = createServer();
      const smallEntries = [createLargeEntry('1', 'normal'), createLargeEntry('2', 'normal')];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: smallEntries })
      });

      const result = await (server).getEntries({
        form_id: '193'
        // No response_mode specified - should default to 'auto' which uses 'full' for small responses
      });

      expect(result.content[0].text).toContain('John'); // Full entry details
      expect(result.content[0].text).not.toContain('Response summarized'); // Not summarized
    });

    it('projects to only requested field_ids (plus metadata), dropping the rest', async () => {
      const server = createServer();
      // 'large' entry carries name (1.3/1.6), email (field 4) and filler fields 60-89.
      const wideEntry = createLargeEntry('1', 'large');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: [wideEntry] })
      });

      const result = await (server).getEntries({
        form_id: '193',
        field_ids: ['1', '4'], // field 1 keeps composite sub-inputs 1.3/1.6; field 4 = email
        response_mode: 'full'
      });
      const text = result.content[0].text;

      expect(text).toContain('John');                    // 1.3 (composite sub-input kept)
      expect(text).toContain('john.smith@email.com');    // field 4 kept
      expect(text).toContain('"id"');                    // core metadata kept
      expect(text).not.toContain('Large field content 60'); // non-requested field dropped
    });

    it('returns all fields when field_ids is omitted', async () => {
      const server = createServer();
      const wideEntry = createLargeEntry('1', 'large');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: [wideEntry] })
      });

      const result = await (server).getEntries({ form_id: '193', response_mode: 'full' });
      expect(result.content[0].text).toContain('Large field content 60'); // nothing dropped
    });

    it('should use summary mode when explicitly requested', async () => {
      const server = createServer();
      const entries = [createLargeEntry('1', 'normal')];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: entries })
      });

      const result = await (server).getEntries({
        form_id: '193',
        response_mode: 'summary'
      });

      expect(result.content[0].text).toContain('Response summarized'); // Should indicate summarization
      expect(result.content[0].text).toContain('John'); // Should still show name fields
    });

    it('should use full mode when explicitly requested even for large responses', async () => {
      const server = createServer();
      const largeEntries = Array.from({ length: 5 }, (_, i) => createLargeEntry(`${i + 1}`, 'large'));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: largeEntries })
      });

      const result = await (server).getEntries({
        form_id: '193',
        response_mode: 'full'
      });

      // Should show full entries even though they're large
      expect(result.content[0].text).not.toContain('Response summarized');
      expect(result.content[0].text.length).toBeGreaterThan(5000); // Should be substantial
    });
  });

  describe('exclude_empty filtering', () => {
    const filledEntry = {
      id: '1', form_id: '193', date_created: '2026-01-01 00:00:00', status: 'active',
      '1.3': 'Jane', '1.6': 'Doe', '4': 'jane.doe@email.com'
    };
    const emptyEntry = {
      id: '2', form_id: '193', date_created: '2026-01-02 00:00:00', status: 'active',
      '1.3': '', '1.6': '', '4': ''
    };
    const whitespaceEntry = {
      id: '3', form_id: '193', date_created: '2026-01-03 00:00:00', status: 'active',
      '1.3': '   ', '4': '\t'
    };

    it('drops entries whose field values are all empty when exclude_empty=true', async () => {
      const server = createServer();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: [filledEntry, emptyEntry] })
      });

      const result = await (server).getEntries({
        form_id: '193',
        exclude_empty: true,
        response_mode: 'full'
      });
      const text = result.content[0].text;

      expect(text).toContain('Found 1 entry');
      expect(text).toContain('jane.doe@email.com');
      expect(text).not.toContain('"id": "2"');
    });

    it('treats whitespace-only field values as empty', async () => {
      const server = createServer();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: [filledEntry, whitespaceEntry] })
      });

      const result = await (server).getEntries({
        form_id: '193',
        exclude_empty: true,
        response_mode: 'full'
      });

      expect(result.content[0].text).toContain('Found 1 entry');
      expect(result.content[0].text).not.toContain('"id": "3"');
    });

    it('keeps all entries when exclude_empty is omitted', async () => {
      const server = createServer();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: [filledEntry, emptyEntry] })
      });

      const result = await (server).getEntries({ form_id: '193', response_mode: 'full' });
      expect(result.content[0].text).toContain('Found 2 entries');
    });
  });

  describe('pagination guidance on an unpaged first call', () => {
    it('tells the caller how to get more when the first (unpaged) page is not the whole set', async () => {
      const server = createServer();
      // Gravity Forms returns a small default page: 10 of 71, no paging requested.
      const entries = Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), form_id: '302', '1': `E${i}` }));
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ entries, total_count: 71 }) });

      const result = await (server).getEntries({ form_id: '302', response_mode: 'full' });
      const text = result.content[0].text;

      expect(text).toContain('Total entries: 71');
      expect(text).toContain('more not shown');                 // hint appears despite no paging in the request
      expect(text).toContain('"current_page": 2');              // next-page recipe
      expect(text).toContain('To get all 71 in one call');      // all-at-once recipe
    });

    it('does not show the hint when the unpaged page already holds every entry', async () => {
      const server = createServer();
      const entries = Array.from({ length: 3 }, (_, i) => ({ id: String(i + 1), form_id: '5', '1': `E${i}` }));
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ entries, total_count: 3 }) });

      const result = await (server).getEntries({ form_id: '5', response_mode: 'full' });
      expect(result.content[0].text).not.toContain('more not shown');
    });
  });

  describe('single entry fetch by entry_id', () => {
    it('returns the entry when fetched by entry_id (single-object API response)', async () => {
      const server = createServer();
      // The GF /entries/{id} endpoint returns ONE entry object — not an array
      // and not an { entries: [...] } envelope.
      const entry = { id: '16040', form_id: '96', '1.3': 'Jane', '4': 'jane@example.com', status: 'active' };
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(entry) });

      const result = await (server).getEntries({ entry_id: '16040', response_mode: 'full' });
      const text = result.content[0].text;

      expect(text).not.toContain('No entries found');
      expect(text).toContain('Found 1 entry');
      expect(text).toContain('16040');
      expect(text).toContain('jane@example.com');
    });

    it('applies field_ids projection to a single entry_id fetch', async () => {
      const server = createServer();
      const entry = { id: '16040', form_id: '96', '1.3': 'Jane', '4': 'jane@example.com', '9': 'secret', status: 'active' };
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(entry) });

      const result = await (server).getEntries({ entry_id: '16040', field_ids: ['4'], response_mode: 'full' });
      const text = result.content[0].text;

      expect(text).toContain('jane@example.com'); // requested field kept
      expect(text).toContain('16040');            // metadata kept
      expect(text).not.toContain('secret');       // non-requested field dropped
    });
  });

  describe('Automatic Response Size Limiting', () => {
    it('should automatically summarize when response exceeds 20k tokens', async () => {
      const server = createServer();
      // Create many large entries to exceed 20k tokens
      const hugeEntries = Array.from({ length: 10 }, (_, i) => createLargeEntry(`${i + 1}`, 'huge'));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: hugeEntries })
      });

      const result = await (server).getEntries({
        form_id: '193',
        response_mode: 'auto' // Should auto-detect and summarize
      });

      expect(result.content[0].text).toContain('Response summarized'); // Should indicate auto-summarization
      expect(result.content[0].text).toContain('10 entries'); // Should mention entry count

      // Summary preserves every field (truncating huge ones), so it is not silently
      // tiny — but it must still be dramatically smaller than the full payload would be.
      const summaryChars = result.content[0].text.length;
      const fullChars = JSON.stringify(hugeEntries, null, 2).length;
      expect(summaryChars).toBeLessThan(fullChars * 0.2); // < 20% of the full response
    });

    it('should handle very large individual entries with reasonable response size', async () => {
      const server = createServer();
      const massiveEntry = createLargeEntry('1', 'huge');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: [massiveEntry] })
      });

      const result = await (server).getEntries({
        form_id: '193',
        response_mode: 'auto'
      });

      // Should have processed the request successfully
      expect(mockFetch).toHaveBeenCalledTimes(1);
      
      // Should still return useful results (will be summarized due to size)
      expect(result.content[0].text).toContain('John');
      expect(result.content[0].text).toContain('Response summarized');
      
      // Should maintain reasonable response size
      const responseTokens = Math.ceil(result.content[0].text.length / 4);
      expect(responseTokens).toBeLessThan(25000); // Should stay reasonable
    });

    it('should handle empty results gracefully', async () => {
      const server = createServer();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: [] })
      });

      const result = await (server).getEntries({
        form_id: '193',
        response_mode: 'auto'
      });

      expect(result.content[0].text).toContain('No entries found');
      expect(result.content[0].text.length).toBeLessThan(100); // Very small response
    });
  });

  describe('Mixed Entry Size Handling', () => {
    it('should handle mix of small and large entries appropriately', async () => {
      const server = createServer();
      const mixedEntries = [
        createLargeEntry('1', 'normal'),
        createLargeEntry('2', 'huge'),
        createLargeEntry('3', 'normal'),
        createLargeEntry('4', 'large'),
        createLargeEntry('5', 'normal')
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: mixedEntries })
      });

      const result = await (server).getEntries({
        form_id: '193',
        response_mode: 'auto'
      });

      // Should handle the mixed sizes and provide reasonable response
      expect(result.content[0].text).toContain('John');
      expect(result.content[0].text).toContain('5 entries'); // Should process all entries
      
      const responseTokens = Math.ceil(result.content[0].text.length / 4);
      expect(responseTokens).toBeLessThan(25000); // Should manage size appropriately
    });
  });

  describe('Backward Compatibility', () => {
    it('should not break existing getEntries calls without response_mode', async () => {
      const server = createServer();
      const normalEntries = [createLargeEntry('1', 'normal')];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: normalEntries })
      });

      // Existing call format - should work exactly as before
      const result = await (server).getEntries({
        form_id: '193',
        search: { status: 'active' },
        paging: { current_page: 1, page_size: 20 },
        sorting: { key: 'date_created', direction: 'DESC' }
      });

      // Should return full results as before (auto mode with small response)
      expect(result.content[0].text).toContain('John');
      expect(result.content[0].text).not.toContain('Response summarized');
      
      // Should maintain same response structure
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0].type).toBe('text');
    });
  });
});