// ABOUTME: Unit tests for the standalone response-size manager module
// ABOUTME: Verifies token estimation and entry/form summarization logic directly

import {
  estimateTokenCount,
  createEntrySummary,
  createFormSummary,
} from '../../utils/responseSizeManager';

describe('responseSizeManager', () => {
  describe('estimateTokenCount', () => {
    it('returns 0 for an empty string', () => {
      expect(estimateTokenCount('')).toBe(0);
    });
  });

  describe('createEntrySummary', () => {
    it('keeps id/form_id and a detected email field but drops huge fields', () => {
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

      expect(summary['60']).toBeUndefined();
      expect(summary['100']).toBeUndefined();
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
