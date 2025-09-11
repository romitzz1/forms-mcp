// ABOUTME: Unit tests for ValidationHelper class and validation schemas
// ABOUTME: Tests input validation, security scenarios, and error handling

import { 
  ValidationHelper, 
  ExportEntriesParams, 
  BulkProcessParams, 
  TemplateParams, 
  ImportExportParams,
  ValidationResult
} from '../../utils/validation';

describe('ValidationHelper', () => {
  let validator: ValidationHelper;

  beforeEach(() => {
    validator = new ValidationHelper();
  });

  describe('Form ID Validation', () => {
    test('should validate valid numeric form IDs', () => {
      const result = validator.validateFormId('123');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should validate string numeric form IDs', () => {
      const result = validator.validateFormId('42');
      expect(result.isValid).toBe(true);
    });

    test('should reject empty form IDs', () => {
      const result = validator.validateFormId('');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Form ID cannot be empty');
    });

    test('should reject null or undefined form IDs', () => {
      const nullResult = validator.validateFormId(null as any);
      const undefinedResult = validator.validateFormId(undefined as any);
      
      expect(nullResult.isValid).toBe(false);
      expect(undefinedResult.isValid).toBe(false);
      expect(nullResult.errors).toContain('Form ID is required');
      expect(undefinedResult.errors).toContain('Form ID is required');
    });

    test('should reject non-numeric form IDs', () => {
      const result = validator.validateFormId('abc123');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Form ID must be numeric');
    });

    test('should reject form IDs with special characters', () => {
      const result = validator.validateFormId('123; DROP TABLE forms;');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Form ID must be numeric');
    });
  });

  describe('Entry ID Validation', () => {
    test('should validate single valid entry ID', () => {
      const result = validator.validateEntryIds('456');
      expect(result.isValid).toBe(true);
      expect(result.sanitizedValue).toBe('456');
    });

    test('should validate array of valid entry IDs', () => {
      const result = validator.validateEntryIds(['123', '456', '789']);
      expect(result.isValid).toBe(true);
      expect(result.sanitizedValue).toEqual(['123', '456', '789']);
    });

    test('should reject empty entry ID arrays', () => {
      const result = validator.validateEntryIds([]);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('At least one entry ID is required');
    });

    test('should reject invalid entry IDs in array', () => {
      const result = validator.validateEntryIds(['123', 'invalid', '789']);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Entry ID "invalid" must be numeric');
    });

    test('should limit entry ID array size for security', () => {
      const largeArray = new Array(1001).fill(0).map((_, i) => String(i));
      const result = validator.validateEntryIds(largeArray);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Too many entry IDs (max 1000 allowed)');
    });

    test('should sanitize entry IDs to prevent injection', () => {
      const result = validator.validateEntryIds('123; DROP TABLE entries;');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Entry ID "123; DROP TABLE entries;" must be numeric');
    });
  });

  describe('Export Format Validation', () => {
    test('should validate supported export formats', () => {
      const csvResult = validator.validateExportFormat('csv');
      const jsonResult = validator.validateExportFormat('json');
      
      expect(csvResult.isValid).toBe(true);
      expect(jsonResult.isValid).toBe(true);
    });

    test('should reject unsupported export formats', () => {
      const result = validator.validateExportFormat('xml');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Export format must be "csv" or "json"');
    });

    test('should reject null or undefined export formats', () => {
      const result = validator.validateExportFormat(undefined as any);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Export format is required');
    });
  });

  describe('Export Entries Parameters Validation', () => {
    test('should validate complete export entries parameters', () => {
      const params: ExportEntriesParams = {
        form_id: '123',
        format: 'csv',
        search: { status: 'active' },
        date_format: 'YYYY-MM-DD'
      };

      const result = validator.validateExportEntriesParams(params);
      expect(result.isValid).toBe(true);
    });

    test('should validate minimal export entries parameters', () => {
      const params: ExportEntriesParams = {
        form_id: '123',
        format: 'json'
      };

      const result = validator.validateExportEntriesParams(params);
      expect(result.isValid).toBe(true);
    });

    test('should reject export entries with missing required fields', () => {
      const params = {
        format: 'csv'
      } as ExportEntriesParams;

      const result = validator.validateExportEntriesParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Form ID is required');
    });

    test('should validate search parameters', () => {
      const params: ExportEntriesParams = {
        form_id: '123',
        format: 'csv',
        search: { 
          field_filters: [{ key: '1', value: 'test' }],
          date_range: { start: '2024-01-01', end: '2024-12-31' }
        }
      };

      const result = validator.validateExportEntriesParams(params);
      expect(result.isValid).toBe(true);
    });

    test('should reject invalid date formats', () => {
      const params: ExportEntriesParams = {
        form_id: '123',
        format: 'csv',
        date_format: 'invalid-format'
      };

      const result = validator.validateExportEntriesParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid date format');
    });
  });

  describe('Bulk Process Parameters Validation', () => {
    test('should validate bulk delete parameters', () => {
      const params: BulkProcessParams = {
        entry_ids: ['123', '456'],
        operation_type: 'delete',
        confirm: true
      };

      const result = validator.validateBulkProcessParams(params);
      expect(result.isValid).toBe(true);
    });

    test('should validate bulk update parameters', () => {
      const params: BulkProcessParams = {
        entry_ids: ['123', '456'],
        operation_type: 'update_status',
        confirm: true,
        data: { status: 'spam' }
      };

      const result = validator.validateBulkProcessParams(params);
      expect(result.isValid).toBe(true);
    });

    test('should require confirmation for bulk operations', () => {
      const params: BulkProcessParams = {
        entry_ids: ['123', '456'],
        operation_type: 'delete',
        confirm: false
      };

      const result = validator.validateBulkProcessParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Bulk operations require explicit confirmation (confirm: true)');
    });

    test('should validate operation types', () => {
      const params: BulkProcessParams = {
        entry_ids: ['123'],
        operation_type: 'invalid_operation' as any,
        confirm: true
      };

      const result = validator.validateBulkProcessParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid operation type');
    });

    test('should require data for update operations', () => {
      const params: BulkProcessParams = {
        entry_ids: ['123'],
        operation_type: 'update_fields',
        confirm: true
      };

      const result = validator.validateBulkProcessParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Data is required for update operations');
    });

    test('should enforce maximum entry limit', () => {
      const manyEntries = new Array(101).fill(0).map((_, i) => String(i));
      const params: BulkProcessParams = {
        entry_ids: manyEntries,
        operation_type: 'delete',
        confirm: true
      };

      const result = validator.validateBulkProcessParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Bulk operations limited to 100 entries maximum');
    });
  });

  describe('Template Parameters Validation', () => {
    test('should validate template creation parameters', () => {
      const params: TemplateParams = {
        source_form_id: '123',
        template_name: 'Contact Form Template',
        field_renames: [
          { original_label: 'Name', new_label: 'Full Name' }
        ]
      };

      const result = validator.validateTemplateParams(params);
      expect(result.isValid).toBe(true);
    });

    test('should validate template name format', () => {
      const params: TemplateParams = {
        source_form_id: '123',
        template_name: 'Valid Template Name'
      };

      const result = validator.validateTemplateParams(params);
      expect(result.isValid).toBe(true);
    });

    test('should reject invalid template names', () => {
      const params: TemplateParams = {
        source_form_id: '123',
        template_name: ''
      };

      const result = validator.validateTemplateParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Template name cannot be empty');
    });

    test('should validate field rename parameters', () => {
      const params: TemplateParams = {
        source_form_id: '123',
        template_name: 'Test Template',
        field_renames: [
          { original_label: 'First Name', new_label: 'Given Name' },
          { original_label: 'Last Name', new_label: 'Family Name' }
        ]
      };

      const result = validator.validateTemplateParams(params);
      expect(result.isValid).toBe(true);
    });

    test('should reject dangerous field renames', () => {
      const params: TemplateParams = {
        source_form_id: '123',
        template_name: 'Test Template',
        field_renames: [
          { original_label: 'Name', new_label: '<script>alert("xss")</script>' }
        ]
      };

      const result = validator.validateTemplateParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Field label contains invalid characters');
    });
  });

  describe('Import/Export Parameters Validation', () => {
    test('should validate form JSON import parameters', () => {
      const params: ImportExportParams = {
        form_json: '{"title": "Test Form", "fields": []}',
        force_import: false
      };

      const result = validator.validateImportExportParams(params);
      expect(result.isValid).toBe(true);
    });

    test('should validate JSON structure', () => {
      const params: ImportExportParams = {
        form_json: 'invalid json',
        force_import: false
      };

      const result = validator.validateImportExportParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid JSON format');
    });

    test('should validate form JSON content', () => {
      const params: ImportExportParams = {
        form_json: '{"invalid": "structure"}',
        force_import: false
      };

      const result = validator.validateImportExportParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Form JSON must contain title and fields');
    });
  });

  describe('Security and Edge Cases', () => {
    test('should sanitize SQL injection attempts', () => {
      const formId = "1'; DROP TABLE forms; --";
      const result = validator.validateFormId(formId);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Form ID must be numeric');
    });

    test('should sanitize XSS attempts in form names', () => {
      const params: TemplateParams = {
        source_form_id: '123',
        template_name: '<script>alert("xss")</script>'
      };

      const result = validator.validateTemplateParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Template name contains invalid characters');
    });

    test('should handle extremely large inputs', () => {
      const largeString = 'a'.repeat(100000);
      const params: TemplateParams = {
        source_form_id: '123',
        template_name: largeString
      };

      const result = validator.validateTemplateParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Template name too long (max 255 characters)');
    });

    test('should handle null and undefined values gracefully', () => {
      const nullResult = validator.validateExportEntriesParams(null as any);
      expect(nullResult.isValid).toBe(false);
      expect(nullResult.errors).toContain('Parameters object is required');

      const undefinedResult = validator.validateBulkProcessParams(undefined as any);
      expect(undefinedResult.isValid).toBe(false);
      expect(undefinedResult.errors).toContain('Parameters object is required');
    });

    test('should validate parameter combinations for logical consistency', () => {
      const params: ExportEntriesParams = {
        form_id: '123',
        format: 'csv',
        search: {
          date_range: { start: '2024-12-31', end: '2024-01-01' } // Invalid range
        }
      };

      const result = validator.validateExportEntriesParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Date range start must be before end date');
    });

    test('should prevent directory traversal attacks', () => {
      const params: ExportEntriesParams = {
        form_id: '123',
        format: 'csv',
        filename: '../../../etc/passwd'
      };

      const result = validator.validateExportEntriesParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Filename contains invalid characters');
    });
  });
});