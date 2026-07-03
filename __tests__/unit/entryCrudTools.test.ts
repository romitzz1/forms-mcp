// ABOUTME: Unit tests for the entry-CRUD tool handlers (submit_form, create_entry, update_entry, delete_entry)
// ABOUTME: Verifies each handler calls ctx.makeRequest with the expected endpoint/method and returns formatted content

import { submitForm, createEntry, updateEntry, deleteEntry, EntryToolContext } from '../../utils/entryCrudTools';

function createMockContext(response: any): EntryToolContext & { makeRequest: jest.Mock } {
  return {
    makeRequest: jest.fn().mockResolvedValue(response)
  };
}

describe('entryCrudTools', () => {
  describe('submitForm', () => {
    it('submits to /forms/:id/submissions with source_page/target_page defaults', async () => {
      const response = { is_valid: true, entry_id: '42' };
      const ctx = createMockContext(response);

      const result = await submitForm(ctx, {
        form_id: 5,
        field_values: { input_1: 'Bond' }
      });

      expect(ctx.makeRequest).toHaveBeenCalledWith('/forms/5/submissions', 'POST', {
        input_1: 'Bond',
        source_page: 1,
        target_page: 0
      });
      expect(result.content[0].text).toContain('Submission successful! Entry ID: 42');
      expect(result.content[0].text).toContain(JSON.stringify(response, null, 2));
    });

    it('reports validation errors when is_valid is false', async () => {
      const response = {
        is_valid: false,
        validation_messages: { input_1: 'Required' }
      };
      const ctx = createMockContext(response);

      const result = await submitForm(ctx, { form_id: 5, field_values: {} });

      expect(result.content[0].text).toContain('Submission failed - validation errors:');
      expect(result.content[0].text).toContain('Field input_1: Required');
    });
  });

  describe('createEntry', () => {
    it('creates an entry via POST /entries', async () => {
      const response = { id: '99' };
      const ctx = createMockContext(response);

      const result = await createEntry(ctx, {
        form_id: 5,
        field_values: { input_1: 'Bond' },
        entry_meta: { status: 'active' }
      });

      expect(ctx.makeRequest).toHaveBeenCalledWith('/entries', 'POST', {
        form_id: 5,
        input_1: 'Bond',
        status: 'active'
      });
      expect(result.content[0].text).toBe(`Entry Created:\n${JSON.stringify(response, null, 2)}`);
    });
  });

  describe('updateEntry', () => {
    it('updates an entry via PUT /entries/:id', async () => {
      const response = { id: '99', updated: true };
      const ctx = createMockContext(response);

      const result = await updateEntry(ctx, {
        entry_id: 99,
        field_values: { input_1: 'James' }
      });

      expect(ctx.makeRequest).toHaveBeenCalledWith('/entries/99', 'PUT', { input_1: 'James' });
      expect(result.content[0].text).toBe(`Entry Updated:\n${JSON.stringify(response, null, 2)}`);
    });
  });

  describe('deleteEntry', () => {
    it('moves an entry to trash by default (no force flag in endpoint)', async () => {
      const response = { deleted: true };
      const ctx = createMockContext(response);

      const result = await deleteEntry(ctx, { entry_id: 7 });

      expect(ctx.makeRequest).toHaveBeenCalledWith('/entries/7', 'DELETE');
      expect(result.content[0].text).toBe(`Entry Moved to Trash:\n${JSON.stringify(response, null, 2)}`);
    });

    it('permanently deletes an entry when force is true', async () => {
      const response = { deleted: true };
      const ctx = createMockContext(response);

      const result = await deleteEntry(ctx, { entry_id: 7, force: true });

      expect(ctx.makeRequest).toHaveBeenCalledWith('/entries/7?force=true', 'DELETE');
      expect(result.content[0].text).toBe(`Entry Permanently Deleted:\n${JSON.stringify(response, null, 2)}`);
    });
  });
});
