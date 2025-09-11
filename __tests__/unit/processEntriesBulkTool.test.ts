// ABOUTME: Unit tests for process_entries_bulk MCP tool method
// ABOUTME: Tests the processEntriesBulk method implementation and its integration with BulkOperationsManager

// Mock MCP SDK dependencies
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => ({
    setRequestHandler: jest.fn()
  }))
}));

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn()
}));

jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ErrorCode: {
    InvalidParams: 'InvalidParams',
    InternalError: 'InternalError',
    MethodNotFound: 'MethodNotFound'
  },
  ListToolsRequestSchema: 'ListToolsRequestSchema',
  McpError: class MockMcpError extends Error {
    constructor(code: string, message: string) {
      super(message);
      this.name = 'McpError';
    }
  }
}));

// Mock utility dependencies
jest.mock('../../utils/dataExporter', () => ({
  DataExporter: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('../../utils/validation', () => ({
  ValidationHelper: jest.fn().mockImplementation(() => ({}))
}));

import { GravityFormsMCPServer } from '../../index';
import { BulkOperationsManager } from '../../utils/bulkOperations';

// Mock the BulkOperationsManager
jest.mock('../../utils/bulkOperations');
const MockBulkOperationsManager = BulkOperationsManager as jest.MockedClass<typeof BulkOperationsManager>;

// Mock fetch for API calls
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock environment variables
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

describe('Process Entries Bulk Tool', () => {
  let server: GravityFormsMCPServer;
  let mockBulkManager: jest.Mocked<BulkOperationsManager>;

  beforeEach(() => {
    // Create mock instance
    mockBulkManager = {
      validateOperation: jest.fn(),
      executeOperation: jest.fn(),
      getBaseUrl: jest.fn().mockReturnValue('https://test.com/wp-json/gf/v2'),
      getAuthHeaders: jest.fn().mockReturnValue({}),
      getMaxEntryLimit: jest.fn().mockReturnValue(100)
    } as any;

    MockBulkOperationsManager.mockImplementation(() => mockBulkManager);
    
    server = new GravityFormsMCPServer();
  });

  describe('Tool Execution - Delete Operations', () => {
    test('should execute bulk delete operation successfully', async () => {
      const mockResult = {
        operation_type: 'delete' as const,
        total_requested: 2,
        successful: 2,
        failed: 0,
        success_ids: ['123', '456'],
        failed_entries: [],
        can_rollback: false,
        operation_summary: 'DELETE operation completed: 2 successful, 0 failed'
      };

      mockBulkManager.validateOperation.mockReturnValue({ isValid: true, errors: [] });
      mockBulkManager.executeOperation.mockResolvedValue(mockResult);

      // Call the method directly since it's a private method, we'll test through public interface
      const result = await (server as any).processEntriesBulk({
        entry_ids: ['123', '456'],
        operation_type: 'delete',
        confirm: true
      });

      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Bulk operation completed successfully');
      expect(result.content[0].text).toContain('2 successful');
      expect(result.content[0].text).toContain('0 failed');
      expect(mockBulkManager.executeOperation).toHaveBeenCalledWith({
        entry_ids: ['123', '456'],
        operation_type: 'delete',
        confirm: true
      });
    });

    test('should handle partial failures in delete operations', async () => {
      const mockResult = {
        operation_type: 'delete' as const,
        total_requested: 3,
        successful: 2,
        failed: 1,
        success_ids: ['123', '789'],
        failed_entries: [
          { entry_id: '456', error: 'Entry not found', error_code: 'NOT_FOUND' }
        ],
        can_rollback: false,
        operation_summary: 'DELETE operation completed: 2 successful, 1 failed'
      };

      mockBulkManager.validateOperation.mockReturnValue({ isValid: true, errors: [] });
      mockBulkManager.executeOperation.mockResolvedValue(mockResult);

      const result = await (server as any).processEntriesBulk({
        entry_ids: ['123', '456', '789'],
        operation_type: 'delete',
        confirm: true
      });

      expect(result.content[0].text).toContain('2 successful, 1 failed');
      expect(result.content[0].text).toContain('Failed entries:');
      expect(result.content[0].text).toContain('456: Entry not found');
    });
  });

  describe('Tool Execution - Update Operations', () => {
    test('should execute bulk update_status operation', async () => {
      const mockResult = {
        operation_type: 'update_status' as const,
        total_requested: 2,
        successful: 2,
        failed: 0,
        success_ids: ['123', '456'],
        failed_entries: [],
        can_rollback: true,
        rollback_data: {
          original_values: [
            { entry_id: '123', original_data: { status: 'active' } },
            { entry_id: '456', original_data: { status: 'active' } }
          ],
          rollback_instructions: 'Use update_entry tool to restore'
        },
        operation_summary: 'UPDATE_STATUS operation completed: 2 successful, 0 failed'
      };

      mockBulkManager.validateOperation.mockReturnValue({ isValid: true, errors: [] });
      mockBulkManager.executeOperation.mockResolvedValue(mockResult);

      const result = await (server as any).processEntriesBulk({
        entry_ids: ['123', '456'],
        operation_type: 'update_status',
        confirm: true,
        data: { status: 'spam' }
      });

      expect(result.content[0].text).toContain('UPDATE_STATUS operation completed');
      expect(result.content[0].text).toContain('Rollback available');
      expect(result.content[0].text).toContain('2 entries can be restored');
    });

    test('should execute bulk update_fields operation', async () => {
      const mockResult = {
        operation_type: 'update_fields' as const,
        total_requested: 1,
        successful: 1,
        failed: 0,
        success_ids: ['123'],
        failed_entries: [],
        can_rollback: true,
        rollback_data: {
          original_values: [
            { entry_id: '123', original_data: { '1': 'John', '3': 'john@example.com' } }
          ],
          rollback_instructions: 'Use update_entry tool to restore'
        },
        operation_summary: 'UPDATE_FIELDS operation completed: 1 successful, 0 failed'
      };

      mockBulkManager.validateOperation.mockReturnValue({ isValid: true, errors: [] });
      mockBulkManager.executeOperation.mockResolvedValue(mockResult);

      const result = await (server as any).processEntriesBulk({
        entry_ids: ['123'],
        operation_type: 'update_fields',
        confirm: true,
        data: { '1': 'Jane', '3': 'jane@example.com' }
      });

      expect(result.content[0].text).toContain('UPDATE_FIELDS operation completed');
      expect(mockBulkManager.executeOperation).toHaveBeenCalledWith({
        entry_ids: ['123'],
        operation_type: 'update_fields',
        confirm: true,
        data: { '1': 'Jane', '3': 'jane@example.com' }
      });
    });
  });

  describe('Safety Mechanisms', () => {
    test('should refuse operations without confirmation', async () => {
      mockBulkManager.validateOperation.mockReturnValue({
        isValid: false,
        errors: ['Bulk operations require explicit confirmation (confirm: true)']
      });

      try {
        await (server as any).processEntriesBulk({
          entry_ids: ['123'],
          operation_type: 'delete',
          confirm: false
        });
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.message).toContain('Validation failed');
        expect(error.message).toContain('confirmation');
      }
    });

    test('should enforce maximum entry limit', async () => {
      const manyEntries = new Array(101).fill(0).map((_, i) => String(i));
      
      mockBulkManager.validateOperation.mockReturnValue({
        isValid: false,
        errors: ['Bulk operations limited to 100 entries maximum']
      });

      try {
        await (server as any).processEntriesBulk({
          entry_ids: manyEntries,
          operation_type: 'delete',
          confirm: true
        });
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.message).toContain('100 entries maximum');
      }
    });

    test('should require data for update operations', async () => {
      mockBulkManager.validateOperation.mockReturnValue({
        isValid: false,
        errors: ['Data is required for update operations']
      });

      try {
        await (server as any).processEntriesBulk({
          entry_ids: ['123'],
          operation_type: 'update_fields',
          confirm: true
        });
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.message).toContain('Data is required');
      }
    });

    test('should validate operation types', async () => {
      mockBulkManager.validateOperation.mockReturnValue({
        isValid: false,
        errors: ['Invalid operation type. Must be delete, update_status, or update_fields']
      });

      try {
        await (server as any).processEntriesBulk({
          entry_ids: ['123'],
          operation_type: 'invalid_operation',
          confirm: true
        });
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.message).toContain('Invalid operation type');
      }
    });
  });

  describe('Error Handling', () => {
    test('should handle network failures gracefully', async () => {
      mockBulkManager.validateOperation.mockReturnValue({ isValid: true, errors: [] });
      mockBulkManager.executeOperation.mockRejectedValue(new Error('Network timeout'));

      try {
        await (server as any).processEntriesBulk({
          entry_ids: ['123'],
          operation_type: 'delete',
          confirm: true
        });
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.message).toContain('Network timeout');
      }
    });

    test('should provide helpful error messages for validation failures', async () => {
      mockBulkManager.validateOperation.mockReturnValue({
        isValid: false,
        errors: ['Entry ID "invalid" must be numeric', 'Too many entries']
      });

      try {
        await (server as any).processEntriesBulk({
          entry_ids: ['invalid'],
          operation_type: 'delete',
          confirm: true
        });
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.message).toContain('Entry ID "invalid" must be numeric');
        expect(error.message).toContain('Too many entries');
      }
    });
  });

  describe('Audit Trail and Reporting', () => {
    test('should include audit trail information in successful operations', async () => {
      const mockResult = {
        operation_type: 'delete' as const,
        total_requested: 2,
        successful: 2,
        failed: 0,
        success_ids: ['123', '456'],
        failed_entries: [],
        can_rollback: false,
        audit_trail: {
          operation_id: 'bulk_12345_abc',
          timestamp: '2024-01-01T12:00:00Z',
          started_at: '2024-01-01T12:00:00Z',
          completed_at: '2024-01-01T12:00:05Z',
          duration_ms: 5000,
          operation_summary: 'DELETE operation: 2 successful, 0 failed',
          affected_entries: ['123', '456'],
          user_confirmation: true
        },
        operation_summary: 'DELETE operation completed: 2 successful, 0 failed'
      };

      mockBulkManager.validateOperation.mockReturnValue({ isValid: true, errors: [] });
      mockBulkManager.executeOperation.mockResolvedValue(mockResult);

      const result = await (server as any).processEntriesBulk({
        entry_ids: ['123', '456'],
        operation_type: 'delete',
        confirm: true
      });

      expect(result.content[0].text).toContain('Operation ID: bulk_12345_abc');
      expect(result.content[0].text).toContain('Duration: 5000ms');
      expect(result.content[0].text).toContain('Timestamp: 2024-01-01T12:00:00Z');
    });

    test('should include detailed failure information', async () => {
      const mockResult = {
        operation_type: 'delete' as const,
        total_requested: 3,
        successful: 1,
        failed: 2,
        success_ids: ['123'],
        failed_entries: [
          { entry_id: '456', error: 'Entry not found', error_code: 'NOT_FOUND' },
          { entry_id: '789', error: 'Permission denied', error_code: 'FORBIDDEN' }
        ],
        can_rollback: false,
        operation_summary: 'DELETE operation completed: 1 successful, 2 failed'
      };

      mockBulkManager.validateOperation.mockReturnValue({ isValid: true, errors: [] });
      mockBulkManager.executeOperation.mockResolvedValue(mockResult);

      const result = await (server as any).processEntriesBulk({
        entry_ids: ['123', '456', '789'],
        operation_type: 'delete',
        confirm: true
      });

      expect(result.content[0].text).toContain('Failed entries:');
      expect(result.content[0].text).toContain('456: Entry not found (NOT_FOUND)');
      expect(result.content[0].text).toContain('789: Permission denied (FORBIDDEN)');
    });

    test('should handle operations without audit trail gracefully', async () => {
      const mockResult = {
        operation_type: 'delete' as const,
        total_requested: 1,
        successful: 1,
        failed: 0,
        success_ids: ['123'],
        failed_entries: [],
        can_rollback: false,
        operation_summary: 'DELETE operation completed: 1 successful, 0 failed'
        // No audit_trail property
      };

      mockBulkManager.validateOperation.mockReturnValue({ isValid: true, errors: [] });
      mockBulkManager.executeOperation.mockResolvedValue(mockResult);

      const result = await (server as any).processEntriesBulk({
        entry_ids: ['123'],
        operation_type: 'delete',
        confirm: true
      });

      expect(result.content[0].text).toContain('DELETE operation completed: 1 successful, 0 failed');
      expect(result.content[0].text).not.toContain('Operation ID:');
    });
  });

  describe('Integration with BulkOperationsManager', () => {
    test('should properly initialize BulkOperationsManager with correct parameters when first used', async () => {
      const mockResult = {
        operation_type: 'delete' as const,
        total_requested: 1,
        successful: 1,
        failed: 0,
        success_ids: ['123'],
        failed_entries: [],
        can_rollback: false,
        operation_summary: 'DELETE operation completed: 1 successful, 0 failed'
      };

      mockBulkManager.validateOperation.mockReturnValue({ isValid: true, errors: [] });
      mockBulkManager.executeOperation.mockResolvedValue(mockResult);

      // Execute an operation to trigger lazy initialization
      await (server as any).processEntriesBulk({
        entry_ids: ['123'],
        operation_type: 'delete',
        confirm: true
      });

      expect(MockBulkOperationsManager).toHaveBeenCalledWith(
        'https://test.com/wp-json/gf/v2',
        expect.objectContaining({
          'Authorization': expect.stringContaining('Basic'),
          'Content-Type': 'application/json'
        })
      );
    });

    test('should pass all parameters correctly to BulkOperationsManager', async () => {
      const mockResult = {
        operation_type: 'update_status' as const,
        total_requested: 1,
        successful: 1,
        failed: 0,
        success_ids: ['123'],
        failed_entries: [],
        can_rollback: false,
        operation_summary: 'UPDATE_STATUS operation completed: 1 successful, 0 failed'
      };

      const params = {
        entry_ids: ['123', '456'],
        operation_type: 'update_status',
        confirm: true,
        data: { status: 'spam', additional_field: 'value' }
      };

      mockBulkManager.validateOperation.mockReturnValue({ isValid: true, errors: [] });
      mockBulkManager.executeOperation.mockResolvedValue(mockResult);

      await (server as any).processEntriesBulk(params);

      expect(mockBulkManager.validateOperation).toHaveBeenCalledWith(params);
      expect(mockBulkManager.executeOperation).toHaveBeenCalledWith(params);
    });
  });
});