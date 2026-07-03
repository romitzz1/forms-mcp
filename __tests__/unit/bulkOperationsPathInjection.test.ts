// ABOUTME: Regression test for path/URL injection via malformed bulk operation entry IDs
// ABOUTME: Ensures non-numeric entry IDs are rejected before any HTTP request is issued

import { BulkOperationsManager } from '../../utils/bulkOperations';
import type { BulkOperationParams } from '../../utils/bulkOperations';

// Mock fetch for API calls
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('BulkOperationsManager - path injection prevention', () => {
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

  it('rejects a malicious entry_id at validation time', () => {
    const params: BulkOperationParams = {
      entry_ids: ['1/../../users'],
      operation_type: 'delete',
      confirm: true
    };

    const result = bulkManager.validateOperation(params);

    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('numeric'))).toBe(true);
  });

  it('never issues an HTTP request for a malicious entry_id', async () => {
    const params: BulkOperationParams = {
      entry_ids: ['1/../../users'],
      operation_type: 'delete',
      confirm: true
    };

    await expect(bulkManager.executeOperation(params)).rejects.toThrow();

    expect(mockFetch).not.toHaveBeenCalled();

    for (const call of mockFetch.mock.calls) {
      const url = String(call[0]);
      expect(url).not.toContain('../');
      expect(url).not.toContain('1/../../users');
    }
  });

  it('still allows valid numeric entry IDs through validation', () => {
    const params: BulkOperationParams = {
      entry_ids: ['123', '456'],
      operation_type: 'delete',
      confirm: true
    };

    const result = bulkManager.validateOperation(params);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
