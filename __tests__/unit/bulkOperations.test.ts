// ABOUTME: Unit tests for BulkOperationsManager class
// ABOUTME: Tests bulk operations with safety mechanisms, confirmation, and error handling

import { BulkOperationsManager } from '../../utils/bulkOperations';
import { 
  BulkOperationType, 
  BulkOperationParams, 
  BulkOperationResult,
  BulkOperationPreview 
} from '../../utils/bulkOperations';
import { GravityFormsMocks } from '../mocks/gravityFormsMocks';

// Mock fetch for API calls
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('BulkOperationsManager', () => {
  let bulkManager: BulkOperationsManager;
  const baseUrl = 'https://test.com/wp-json/gf/v2';
  const authHeaders = {
    'Authorization': 'Basic dGVzdDp0ZXN0',
    'Content-Type': 'application/json'
  };

  beforeEach(() => {
    bulkManager = new BulkOperationsManager(baseUrl, authHeaders);
    mockFetch.mockClear();
  });

  describe('Constructor and Initial State', () => {
    test('should create BulkOperationsManager with correct base URL and headers', () => {
      expect(bulkManager).toBeInstanceOf(BulkOperationsManager);
      expect(bulkManager.getBaseUrl()).toBe(baseUrl);
      expect(bulkManager.getAuthHeaders()).toEqual(authHeaders);
    });

    test('should have maximum entry limit set to 100', () => {
      expect(bulkManager.getMaxEntryLimit()).toBe(100);
    });
  });

  describe('Operation Validation', () => {
    test('should validate bulk delete operation', () => {
      const params: BulkOperationParams = {
        entry_ids: ['123', '456'],
        operation_type: 'delete',
        confirm: true
      };

      const result = bulkManager.validateOperation(params);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should validate bulk update_status operation', () => {
      const params: BulkOperationParams = {
        entry_ids: ['123', '456'],
        operation_type: 'update_status',
        confirm: true,
        data: { status: 'spam' }
      };

      const result = bulkManager.validateOperation(params);
      expect(result.isValid).toBe(true);
    });

    test('should validate bulk update_fields operation', () => {
      const params: BulkOperationParams = {
        entry_ids: ['123', '456'],
        operation_type: 'update_fields',
        confirm: true,
        data: { '1': 'Updated Name', '3': 'updated@email.com' }
      };

      const result = bulkManager.validateOperation(params);
      expect(result.isValid).toBe(true);
    });

    test('should require explicit confirmation', () => {
      const params: BulkOperationParams = {
        entry_ids: ['123'],
        operation_type: 'delete',
        confirm: false
      };

      const result = bulkManager.validateOperation(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Bulk operations require explicit confirmation (confirm: true)');
    });

    test('should enforce maximum entry limit', () => {
      const manyEntries = new Array(101).fill(0).map((_, i) => String(i));
      const params: BulkOperationParams = {
        entry_ids: manyEntries,
        operation_type: 'delete',
        confirm: true
      };

      const result = bulkManager.validateOperation(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Bulk operations limited to 100 entries maximum');
    });

    test('should require data for update operations', () => {
      const params: BulkOperationParams = {
        entry_ids: ['123'],
        operation_type: 'update_fields',
        confirm: true
      };

      const result = bulkManager.validateOperation(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Data is required for update operations');
    });

    test('should validate operation types', () => {
      const params: BulkOperationParams = {
        entry_ids: ['123'],
        operation_type: 'invalid_operation' as BulkOperationType,
        confirm: true
      };

      const result = bulkManager.validateOperation(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid operation type. Must be delete, update_status, or update_fields');
    });

    test('should reject empty entry ID arrays', () => {
      const params: BulkOperationParams = {
        entry_ids: [],
        operation_type: 'delete',
        confirm: true
      };

      const result = bulkManager.validateOperation(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('At least one entry ID is required');
    });
  });

  describe('Operation Preview', () => {
    test('should generate preview for delete operation', async () => {
      const params: BulkOperationParams = {
        entry_ids: ['123', '456'],
        operation_type: 'delete',
        confirm: true
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => GravityFormsMocks.getMockEntry({ id: '123' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => GravityFormsMocks.getMockEntry({ id: '456' })
        });

      const preview = await bulkManager.getOperationPreview(params);
      
      expect(preview.operation_type).toBe('delete');
      expect(preview.total_entries).toBe(2);
      expect(preview.entries_found.length).toBe(2);
      expect(preview.entries_not_found.length).toBe(0);
      expect(preview.description).toContain('DELETE 2 entries permanently');
    });

    test('should handle missing entries in preview', async () => {
      const params: BulkOperationParams = {
        entry_ids: ['123', '999'],
        operation_type: 'delete',
        confirm: true
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => GravityFormsMocks.getMockEntry({ id: '123' })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ message: 'Entry not found' })
        });

      const preview = await bulkManager.getOperationPreview(params);
      
      expect(preview.entries_found.length).toBe(1);
      expect(preview.entries_not_found).toContain('999');
      expect(preview.warnings).toContain('Entry 999 not found and will be skipped');
    });

    test('should generate preview for update_status operation', async () => {
      const params: BulkOperationParams = {
        entry_ids: ['123'],
        operation_type: 'update_status',
        confirm: true,
        data: { status: 'spam' }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => GravityFormsMocks.getMockEntry({ id: '123' })
      });

      const preview = await bulkManager.getOperationPreview(params);
      
      expect(preview.operation_type).toBe('update_status');
      expect(preview.description).toContain('UPDATE STATUS to "spam" for 1 entries');
    });

    test('should generate preview for update_fields operation', async () => {
      const params: BulkOperationParams = {
        entry_ids: ['123'],
        operation_type: 'update_fields',
        confirm: true,
        data: { '1': 'New Name', '3': 'new@email.com' }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => GravityFormsMocks.getMockEntry({ id: '123' })
      });

      const preview = await bulkManager.getOperationPreview(params);
      
      expect(preview.operation_type).toBe('update_fields');
      expect(preview.description).toContain('UPDATE FIELDS');
      expect(preview.description).toContain('Field 1, Field 3');
    });
  });

  describe('Bulk Operation Execution', () => {
    test('should execute bulk delete operation successfully', async () => {
      const params: BulkOperationParams = {
        entry_ids: ['123', '456'],
        operation_type: 'delete',
        confirm: true
      };

      // Mock successful delete responses
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ message: 'Entry deleted successfully' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ message: 'Entry deleted successfully' })
        });

      const result = await bulkManager.executeOperation(params);
      
      expect(result.operation_type).toBe('delete');
      expect(result.total_requested).toBe(2);
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.success_ids).toEqual(['123', '456']);
      expect(result.failed_entries).toHaveLength(0);
    });

    test('should handle partial failures in bulk operations', async () => {
      const params: BulkOperationParams = {
        entry_ids: ['123', '456', '789'],
        operation_type: 'delete',
        confirm: true
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ message: 'Entry deleted successfully' })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ message: 'Entry not found' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ message: 'Entry deleted successfully' })
        });

      const result = await bulkManager.executeOperation(params);
      
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.success_ids).toEqual(['123', '789']);
      expect(result.failed_entries).toHaveLength(1);
      expect(result.failed_entries[0].entry_id).toBe('456');
      expect(result.failed_entries[0].error).toContain('Entry not found');
    });

    test('should execute bulk update_status operation', async () => {
      const params: BulkOperationParams = {
        entry_ids: ['123', '456'],
        operation_type: 'update_status',
        confirm: true,
        data: { status: 'spam' }
      };

      mockFetch
        // Mocks for rollback data preparation (GET requests)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => GravityFormsMocks.getMockEntry({ id: '123' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => GravityFormsMocks.getMockEntry({ id: '456' })
        })
        // Mocks for actual update operations (PUT requests)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => GravityFormsMocks.getMockEntry({ id: '123' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => GravityFormsMocks.getMockEntry({ id: '456' })
        });

      const result = await bulkManager.executeOperation(params);
      
      expect(result.operation_type).toBe('update_status');
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(0);
    });

    test('should execute bulk update_fields operation', async () => {
      const params: BulkOperationParams = {
        entry_ids: ['123'],
        operation_type: 'update_fields',
        confirm: true,
        data: { '1': 'Updated Name', '3': 'updated@email.com' }
      };

      mockFetch
        // Mock for rollback data preparation (GET request)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => GravityFormsMocks.getMockEntry({ id: '123' })
        })
        // Mock for actual update operation (PUT request)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => GravityFormsMocks.getMockEntry({ 
            id: '123',
            '1': 'Updated Name',
            '3': 'updated@email.com'
          })
        });

      const result = await bulkManager.executeOperation(params);
      
      expect(result.operation_type).toBe('update_fields');
      expect(result.successful).toBe(1);
      expect(result.success_ids).toContain('123');
    });

    test('should track operation progress', async () => {
      const params: BulkOperationParams = {
        entry_ids: ['123', '456', '789'],
        operation_type: 'delete',
        confirm: true
      };

      // Mock progress callback
      const progressCallback = jest.fn();
      
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ message: 'Success' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ message: 'Success' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ message: 'Success' })
        });

      await bulkManager.executeOperation(params, progressCallback);
      
      expect(progressCallback).toHaveBeenCalledWith({
        processed: 1,
        total: 3,
        current_entry: '123'
      });
      expect(progressCallback).toHaveBeenCalledWith({
        processed: 2,
        total: 3,
        current_entry: '456'
      });
      expect(progressCallback).toHaveBeenCalledWith({
        processed: 3,
        total: 3,
        current_entry: '789'
      });
    });
  });

  describe('Error Handling and Safety', () => {
    test('should refuse operations without confirmation', async () => {
      const params: BulkOperationParams = {
        entry_ids: ['123'],
        operation_type: 'delete',
        confirm: false
      };

      await expect(bulkManager.executeOperation(params))
        .rejects
        .toThrow('Bulk operations require explicit confirmation');
    });

    test('should handle network failures gracefully', async () => {
      const params: BulkOperationParams = {
        entry_ids: ['123'],
        operation_type: 'delete',
        confirm: true
      };

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await bulkManager.executeOperation(params);
      
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.failed_entries[0].error).toContain('Network error');
    });

    test('should handle API errors correctly', async () => {
      const params: BulkOperationParams = {
        entry_ids: ['123'],
        operation_type: 'delete',
        confirm: true
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Internal server error' })
      });

      const result = await bulkManager.executeOperation(params);
      
      expect(result.failed).toBe(1);
      expect(result.failed_entries[0].error).toContain('Internal server error');
    });

    test('should provide operation rollback capabilities for supported operations', async () => {
      const params: BulkOperationParams = {
        entry_ids: ['123', '456'],
        operation_type: 'update_status',
        confirm: true,
        data: { status: 'spam' }
      };

      // Mock original entries for rollback
      const originalEntries = [
        GravityFormsMocks.getMockEntry({ id: '123', status: 'active' }),
        GravityFormsMocks.getMockEntry({ id: '456', status: 'active' })
      ];

      mockFetch
        // Mocks for rollback data preparation (GET requests)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => originalEntries[0]
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => originalEntries[1]
        })
        // Mocks for actual update operations (PUT requests)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ...originalEntries[0], status: 'spam' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ...originalEntries[1], status: 'spam' })
        });

      const result = await bulkManager.executeOperation(params);
      
      expect(result.rollback_data).toBeDefined();
      expect(result.rollback_data?.original_values).toHaveLength(2);
      expect(result.can_rollback).toBe(true);
    });

    test('should not allow rollback for delete operations', async () => {
      const params: BulkOperationParams = {
        entry_ids: ['123'],
        operation_type: 'delete',
        confirm: true
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Deleted' })
      });

      const result = await bulkManager.executeOperation(params);
      
      expect(result.can_rollback).toBe(false);
      expect(result.rollback_data).toBeUndefined();
    });
  });

  describe('Audit Trail', () => {
    test('should generate audit trail for operations', async () => {
      const params: BulkOperationParams = {
        entry_ids: ['123', '456'],
        operation_type: 'delete',
        confirm: true
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ message: 'Success' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ message: 'Success' })
        });

      const result = await bulkManager.executeOperation(params);
      
      expect(result.audit_trail).toBeDefined();
      expect(result.audit_trail?.operation_id).toBeDefined();
      expect(result.audit_trail?.timestamp).toBeDefined();
      expect(result.audit_trail?.operation_summary).toContain('DELETE operation');
      expect(result.audit_trail?.affected_entries).toEqual(['123', '456']);
    });

    test('should include operation timing in audit trail', async () => {
      const params: BulkOperationParams = {
        entry_ids: ['123'],
        operation_type: 'delete',
        confirm: true
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Success' })
      });

      const result = await bulkManager.executeOperation(params);
      
      expect(result.audit_trail?.duration_ms).toBeGreaterThan(0);
      expect(result.audit_trail?.started_at).toBeDefined();
      expect(result.audit_trail?.completed_at).toBeDefined();
    });
  });
});