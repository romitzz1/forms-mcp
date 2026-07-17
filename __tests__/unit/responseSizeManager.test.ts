// ABOUTME: Unit tests for the standalone response-size manager module
// ABOUTME: Verifies token estimation and entry/form summarization logic directly

import {
  estimateTokenCount,
  estimateEntriesResponseSize,
  createEntrySummary,
  createFormSummary,
} from '../../utils/responseSizeManager';

describe('responseSizeManager', () => {
  describe('estimateTokenCount', () => {
    it('returns 0 for an empty string', () => {
      expect(estimateTokenCount('')).toBe(0);
    });
  });

  describe('estimateEntriesResponseSize', () => {
    it('returns 0 for empty input', () => {
      expect(estimateEntriesResponseSize([])).toBe(0);
    });

    it('estimate tracks the pretty-printed output size, not compact JSON (audit A11)', () => {
      // Many fields with SHORT values — the case where indentation/newlines dominate and
      // pretty-printing is dramatically larger than compact JSON (real GF entries with lots
      // of small input_x cells). This is where compact sampling most badly undercounts.
      const entries = Array.from({ length: 40 }, (_, i) => {
        const e: Record<string, string> = { id: String(i), form_id: '1' };
        for (let f = 1; f <= 40; f++) e[`input_${f}`] = '1';
        return e;
      });

      // The response is emitted with JSON.stringify(entries, null, 2), so the estimate must
      // approximate the PRETTY size. Compact sampling undercounts it substantially here.
      const actualPrettyTokens = estimateTokenCount(JSON.stringify(entries, null, 2));
      const estimate = estimateEntriesResponseSize(entries);

      expect(estimate).toBeGreaterThanOrEqual(Math.floor(actualPrettyTokens * 0.9));
    });
  });

  describe('createEntrySummary', () => {
    it('keeps id/form_id and a detected email field, truncating (not dropping) huge fields', () => {
      const entry: any = {
        id: '12345',
        form_id: '193',
        date_created: '2024-01-01 12:00:00',
        payment_status: 'Paid',
        '4': 'john.smith@email.com',
      };

      // Add massive fields to push entry size well past the summarization threshold.
      for (let i = 60; i < 120; i++) {
        entry[i] = `Huge field content ${i} `.repeat(100) + ' with massive amounts of text data';
      }

      const summary = createEntrySummary(entry);

      expect(summary.id).toBe('12345');
      expect(summary.form_id).toBe('193');
      expect(summary['4']).toBe('john.smith@email.com');

      // Huge fields are truncated with a marker rather than silently dropped, and each
      // truncated key is listed so a consumer knows to re-fetch it in full mode.
      expect(summary['60']).toBeDefined();
      expect(String(summary['60']).length).toBeLessThan(entry['60'].length);
      expect(String(summary['60'])).toContain('truncated');
      expect(summary._summary.truncated_fields).toContain('60');
      expect(summary._summary.truncated_fields).toContain('100');
    });

    it('preserves every populated short field for a wide entry (bug report: form 309 / entry 16059)', () => {
      // Reproduces the reported failure: a wide survey entry whose short answer values
      // were dropped by summary mode. Top-level numeric name fields (1/2) and other short
      // answers must survive — the whole point of the fix.
      const entry: any = {
        id: '16059',
        form_id: '309',
        status: 'active',
        '1': 'Jim',
        '2': 'Yanacek',
        '3': 'jimyanacek@gmail.com',
        '8': 'Considering it',
        '17': 'Probably signing up',
        '69.3': 'Wednesday',
        '71': 'Yes',
        '73.2': 'Tuesday Early Social Fun',
      };
      // Pad with more short answer fields so the entry as a whole is well over the old
      // 2000-byte gate that used to trigger wholesale dropping.
      for (let i = 20; i < 70; i++) {
        entry[String(i)] = `Answer value for field ${i} that is a normal short response`;
      }

      const summary = createEntrySummary(entry);

      expect(summary['1']).toBe('Jim');
      expect(summary['2']).toBe('Yanacek');
      expect(summary['3']).toBe('jimyanacek@gmail.com');
      expect(summary['8']).toBe('Considering it');
      expect(summary['17']).toBe('Probably signing up');
      expect(summary['71']).toBe('Yes');
      expect(summary['73.2']).toBe('Tuesday Early Social Fun');
      // Nothing was truncated, so no manifest is attached.
      expect(summary._summary).toBeUndefined();
    });

    it('omits empty and whitespace-only field values but keeps populated ones', () => {
      const entry: any = {
        id: '1',
        form_id: '2',
        '1': 'kept',
        '2': '',
        '3': '   ',
        '4': null,
      };

      const summary = createEntrySummary(entry);

      expect(summary['1']).toBe('kept');
      expect(summary['2']).toBeUndefined();
      expect(summary['3']).toBeUndefined();
      expect(summary['4']).toBeUndefined();
    });
  });

  describe('createFormSummary', () => {
    it('returns a string containing "LARGE FORM SUMMARY"', () => {
      const form = {
        id: '1',
        title: 'Test Form',
        description: 'A test form',
        is_active: '1',
        is_trash: '0',
        date_created: '2024-01-01 12:00:00',
        fields: [],
      };

      const summary = createFormSummary(form);

      expect(summary).toContain('LARGE FORM SUMMARY');
    });
  });
});
