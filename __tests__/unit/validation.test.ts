// ABOUTME: Unit tests for ValidationHelper class and validation schemas
// ABOUTME: Tests input validation, security scenarios, and error handling

import type { 
  BulkProcessParams, 
  ExportEntriesParams, 
  ImportExportParams, 
  TemplateParams} from '../../utils/validation';
import { 
  ValidationHelper,
  ValidationResult
} from '../../utils/validation';

describe('ValidationHelper', () => {
  let validator: ValidationHelper;

  beforeEach(() => {
    validator = new ValidationHelper();
  });

  describe('Form ID Validation', () => {
    it('should validate valid numeric form IDs', () => {
      const result = validator.validateFormId('123');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate string numeric form IDs', () => {
      const result = validator.validateFormId('42');
      expect(result.isValid).toBe(true);
    });

    it('should reject empty form IDs', () => {
      const result = validator.validateFormId('');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Form ID cannot be empty');
    });

    it('should reject null or undefined form IDs', () => {
      const nullResult = validator.validateFormId(null as any);
      const undefinedResult = validator.validateFormId(undefined as any);
      
      expect(nullResult.isValid).toBe(false);
      expect(undefinedResult.isValid).toBe(false);
      expect(nullResult.errors).toContain('Form ID is required');
      expect(undefinedResult.errors).toContain('Form ID is required');
    });

    it('should reject non-numeric form IDs', () => {
      const result = validator.validateFormId('abc123');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Form ID must be numeric');
    });

    it('should reject form IDs with special characters', () => {
      const result = validator.validateFormId('123; DROP TABLE forms;');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Form ID must be numeric');
    });
  });

  describe('Entry ID Validation', () => {
    it('should validate single valid entry ID', () => {
      const result = validator.validateEntryIds('456');
      expect(result.isValid).toBe(true);
      expect(result.sanitizedValue).toBe('456');
    });

    it('should validate array of valid entry IDs', () => {
      const result = validator.validateEntryIds(['123', '456', '789']);
      expect(result.isValid).toBe(true);
      expect(result.sanitizedValue).toEqual(['123', '456', '789']);
    });

    it('should reject empty entry ID arrays', () => {
      const result = validator.validateEntryIds([]);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('At least one entry ID is required');
    });

    it('should reject invalid entry IDs in array', () => {
      const result = validator.validateEntryIds(['123', 'invalid', '789']);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Entry ID "invalid" must be numeric');
    });

    it('should limit entry ID array size for security', () => {
      const largeArray = new Array(1001).fill(0).map((_, i) => String(i));
      const result = validator.validateEntryIds(largeArray);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Too many entry IDs (max 1000 allowed)');
    });

    it('should sanitize entry IDs to prevent injection', () => {
      const result = validator.validateEntryIds('123; DROP TABLE entries;');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Entry ID "123; DROP TABLE entries;" must be numeric');
    });
  });

  describe('Export Format Validation', () => {
    it('should validate supported export formats', () => {
      const csvResult = validator.validateExportFormat('csv');
      const jsonResult = validator.validateExportFormat('json');
      
      expect(csvResult.isValid).toBe(true);
      expect(jsonResult.isValid).toBe(true);
    });

    it('should reject unsupported export formats', () => {
      const result = validator.validateExportFormat('xml');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Export format must be "csv" or "json"');
    });

    it('should reject null or undefined export formats', () => {
      const result = validator.validateExportFormat(undefined as any);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Export format is required');
    });
  });

  describe('Export Entries Parameters Validation', () => {
    it('should validate complete export entries parameters', () => {
      const params: ExportEntriesParams = {
        form_id: '123',
        format: 'csv',
        search: { status: 'active' },
        date_format: 'YYYY-MM-DD'
      };

      const result = validator.validateExportEntriesParams(params);
      expect(result.isValid).toBe(true);
    });

    it('should validate minimal export entries parameters', () => {
      const params: ExportEntriesParams = {
        form_id: '123',
        format: 'json'
      };

      const result = validator.validateExportEntriesParams(params);
      expect(result.isValid).toBe(true);
    });

    it('should reject export entries with missing required fields', () => {
      const params = {
        format: 'csv'
      } as ExportEntriesParams;

      const result = validator.validateExportEntriesParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Form ID is required');
    });

    it('should validate search parameters', () => {
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

    it('should reject invalid date formats', () => {
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
    it('should validate bulk delete parameters', () => {
      const params: BulkProcessParams = {
        entry_ids: ['123', '456'],
        operation_type: 'delete',
        confirm: true
      };

      const result = validator.validateBulkProcessParams(params);
      expect(result.isValid).toBe(true);
    });

    it('should validate bulk update parameters', () => {
      const params: BulkProcessParams = {
        entry_ids: ['123', '456'],
        operation_type: 'update_status',
        confirm: true,
        data: { status: 'spam' }
      };

      const result = validator.validateBulkProcessParams(params);
      expect(result.isValid).toBe(true);
    });

    it('should require confirmation for bulk operations', () => {
      const params: BulkProcessParams = {
        entry_ids: ['123', '456'],
        operation_type: 'delete',
        confirm: false
      };

      const result = validator.validateBulkProcessParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Bulk operations require explicit confirmation (confirm: true)');
    });

    it('should validate operation types', () => {
      const params: BulkProcessParams = {
        entry_ids: ['123'],
        operation_type: 'invalid_operation' as any,
        confirm: true
      };

      const result = validator.validateBulkProcessParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid operation type');
    });

    it('should require data for update operations', () => {
      const params: BulkProcessParams = {
        entry_ids: ['123'],
        operation_type: 'update_fields',
        confirm: true
      };

      const result = validator.validateBulkProcessParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Data is required for update operations');
    });

    it('should enforce maximum entry limit', () => {
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
    it('should validate template creation parameters', () => {
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

    it('should validate template name format', () => {
      const params: TemplateParams = {
        source_form_id: '123',
        template_name: 'Valid Template Name'
      };

      const result = validator.validateTemplateParams(params);
      expect(result.isValid).toBe(true);
    });

    it('should reject invalid template names', () => {
      const params: TemplateParams = {
        source_form_id: '123',
        template_name: ''
      };

      const result = validator.validateTemplateParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Template name cannot be empty');
    });

    it('should validate field rename parameters', () => {
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

    it('should reject dangerous field renames', () => {
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
    it('should validate form JSON import parameters', () => {
      const params: ImportExportParams = {
        form_json: '{"title": "Test Form", "fields": []}',
        force_import: false
      };

      const result = validator.validateImportExportParams(params);
      expect(result.isValid).toBe(true);
    });

    it('should validate JSON structure', () => {
      const params: ImportExportParams = {
        form_json: 'invalid json',
        force_import: false
      };

      const result = validator.validateImportExportParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid JSON format');
    });

    it('should validate form JSON content', () => {
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
    it('should sanitize SQL injection attempts', () => {
      const formId = "1'; DROP TABLE forms; --";
      const result = validator.validateFormId(formId);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Form ID must be numeric');
    });

    it('should sanitize XSS attempts in form names', () => {
      const params: TemplateParams = {
        source_form_id: '123',
        template_name: '<script>alert("xss")</script>'
      };

      const result = validator.validateTemplateParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Template name contains invalid characters');
    });

    it('should handle extremely large inputs', () => {
      const largeString = 'a'.repeat(100000);
      const params: TemplateParams = {
        source_form_id: '123',
        template_name: largeString
      };

      const result = validator.validateTemplateParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Template name too long (max 255 characters)');
    });

    it('should handle null and undefined values gracefully', () => {
      const nullResult = validator.validateExportEntriesParams(null as any);
      expect(nullResult.isValid).toBe(false);
      expect(nullResult.errors).toContain('Parameters object is required');

      const undefinedResult = validator.validateBulkProcessParams(undefined as any);
      expect(undefinedResult.isValid).toBe(false);
      expect(undefinedResult.errors).toContain('Parameters object is required');
    });

    it('should validate parameter combinations for logical consistency', () => {
      const params: ExportEntriesParams = {
        form_id: '123',
        format: 'csv',
        search: {
          date_range: { start: '2024-12-31', end: '2024-01-01' } // Invalid range
        }
      };

      const result = validator.validateExportEntriesParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Date range start must be before or equal to end date');
    });

    it('should reject invalid dates in date range', () => {
      const params: ExportEntriesParams = {
        form_id: '123',
        format: 'csv',
        search: {
          date_range: { start: 'invalid-date', end: '2024-12-31' }
        }
      };

      const result = validator.validateExportEntriesParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid start date format');
    });

    it('should validate bulk operations with both invalid IDs and too many entries', () => {
      const manyInvalidEntries = new Array(101).fill(0).map((_, i) => `invalid_${i}`);
      const params: BulkProcessParams = {
        entry_ids: manyInvalidEntries,
        operation_type: 'delete',
        confirm: true
      };

      const result = validator.validateBulkProcessParams(params);
      expect(result.isValid).toBe(false);
      // Should report both issues
      expect(result.errors.some(err => err.includes('must be numeric'))).toBe(true);
      expect(result.errors).toContain('Bulk operations limited to 100 entries maximum');
    });

    it('should prevent directory traversal attacks', () => {
      const params: ExportEntriesParams = {
        form_id: '123',
        format: 'csv',
        filename: '../../../etc/passwd'
      };

      const result = validator.validateExportEntriesParams(params);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Filename contains invalid characters');
    });

    describe('File Saving Parameters Validation', () => {
      it('should validate save_to_disk parameter as boolean', () => {
        const validParams: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          save_to_disk: true
        };
        const result = validator.validateExportEntriesParams(validParams);
        expect(result.isValid).toBe(true);
      });

      it('should reject non-boolean save_to_disk parameter', () => {
        const params = {
          form_id: '123',
          format: 'csv',
          save_to_disk: 'true' // String instead of boolean
        } as any;
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('save_to_disk must be a boolean value');
      });

      it('should validate valid output_path parameter', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          save_to_disk: true,
          output_path: './exports/my-file.csv'
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(true);
      });

      it('should reject non-string output_path parameter', () => {
        const params = {
          form_id: '123',
          format: 'csv',
          save_to_disk: true,
          output_path: 123 // Number instead of string
        } as any;
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('output_path must be a string');
      });

      it('should reject empty output_path parameter', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          save_to_disk: true,
          output_path: '   ' // Whitespace only
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('output_path cannot be empty');
      });

      it('should reject output_path with invalid characters', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          save_to_disk: true,
          output_path: '/path/with<invalid>chars.csv'
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('output_path contains invalid characters');
      });

      it('should reject output_path with directory traversal', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          save_to_disk: true,
          output_path: '../../../etc/passwd'
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('output_path contains invalid characters');
      });

      it('should allow valid absolute paths', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          save_to_disk: true,
          output_path: '/valid/absolute/path/file.csv'
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(true);
      });

      it('should allow valid relative paths', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          save_to_disk: true,
          output_path: './exports/relative/path/file.csv'
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(true);
      });

      it('should validate save_to_disk false with output_path (should be allowed)', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          save_to_disk: false,
          output_path: './exports/file.csv'
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(true);
      });

      it('should validate skip_base64 parameter as boolean', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          skip_base64: true
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(true);
      });

      it('should reject non-boolean skip_base64 parameter', () => {
        const params = {
          form_id: '123',
          format: 'csv',
          skip_base64: 'true' // String instead of boolean
        } as any;
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('skip_base64 must be a boolean value');
      });

      it('should allow combination of save_to_disk and skip_base64', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          save_to_disk: true,
          skip_base64: true,
          output_path: './exports/optimized.csv'
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(true);
      });

      it('should allow same start and end date for single-day filtering', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          search: {
            date_range: { start: '2024-01-01', end: '2024-01-01' }
          }
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(true);
      });

      it('should accept LLM-friendly start_date/end_date format', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          search: {
            start_date: '2024-01-01',
            end_date: '2024-12-31'
          }
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(true);
      });

      it('should validate LLM-friendly date format for invalid dates', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          search: {
            start_date: 'invalid-date',
            end_date: '2024-12-31'
          }
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Invalid start date format');
      });

      it('should validate LLM-friendly date format for invalid range', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          search: {
            start_date: '2024-12-31',
            end_date: '2024-01-01'
          }
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Date range start must be before or equal to end date');
      });

      it('should give precedence to LLM-friendly format when both are provided', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          search: {
            date_range: { start: '2024-01-01', end: '2024-06-30' },
            start_date: '2024-12-31', // Invalid range - should be caught
            end_date: '2024-01-01'
          }
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Date range start must be before or equal to end date');
      });

      it('should accept only start_date without end_date', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          search: {
            start_date: '2024-01-01'
          }
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(true);
      });

      it('should accept only end_date without start_date', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          search: {
            end_date: '2024-12-31'
          }
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(true);
      });

      it('should reject invalid start_date when provided alone', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          search: {
            start_date: 'invalid-date'
          }
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Invalid start date format');
      });

      it('should reject invalid end_date when provided alone', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          search: {
            end_date: 'not-a-date'
          }
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Invalid end date format');
      });
    });

    describe('field_ids parameter validation', () => {
      it('should accept valid field_ids array', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          field_ids: ['1', '2', '57', '5']
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(true);
      });

      it('should reject field_ids with non-string values', () => {
        const params: any = {
          form_id: '123',
          format: 'csv',
          field_ids: ['1', 2, '57'] // Number in array
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('field_ids array must contain only string values');
      });

      it('should reject non-array field_ids', () => {
        const params: any = {
          form_id: '123',
          format: 'csv',
          field_ids: 'invalid' // String instead of array
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('field_ids must be a valid JSON array of strings');
      });

      it('should handle empty field_ids array', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          field_ids: []
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(true);
      });

      it('should reject field_ids with empty strings', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          field_ids: ['1', '', '57'] // Empty string in array
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('field_ids cannot contain empty strings');
      });

      it('should accept field_ids with composite field IDs', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          field_ids: ['5.1', '5.3', '1.6'] // Composite field IDs
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(true);
      });

      it('should handle field_ids as JSON string and provide sanitized value', () => {
        const params: any = {
          form_id: '123',
          format: 'csv',
          field_ids: '["1", "2", "57"]' // JSON string
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(true);
        expect(result.sanitizedValue).toBeDefined();
        expect(result.sanitizedValue.field_ids).toEqual(['1', '2', '57']);
        // Original params should not be mutated
        expect(params.field_ids).toBe('["1", "2", "57"]');
      });

      it('should reject malformed JSON in field_ids string', () => {
        const params: any = {
          form_id: '123',
          format: 'csv',
          field_ids: '["1", "2"' // Malformed JSON
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('field_ids must be a valid JSON array of strings');
      });

      it('should handle field_ids with numeric string values', () => {
        const params: ExportEntriesParams = {
          form_id: '123',
          format: 'csv',
          field_ids: ['0', '57', '5'] // Including "0" which could be falsy
        };
        const result = validator.validateExportEntriesParams(params);
        expect(result.isValid).toBe(true);
      });

      it('should provide clear error messages for different validation failures', () => {
        // Test non-array
        const nonArrayParams: any = {
          form_id: '123',
          format: 'csv',
          field_ids: 'not-an-array'
        };
        const nonArrayResult = validator.validateExportEntriesParams(nonArrayParams);
        expect(nonArrayResult.isValid).toBe(false);
        expect(nonArrayResult.errors).toContain('field_ids must be a valid JSON array of strings');

        // Test non-string values in array
        const nonStringParams: any = {
          form_id: '123',
          format: 'csv',
          field_ids: ['1', 2, '3'] // Number in array
        };
        const nonStringResult = validator.validateExportEntriesParams(nonStringParams);
        expect(nonStringResult.isValid).toBe(false);
        expect(nonStringResult.errors).toContain('field_ids array must contain only string values');
      });
    });
  });
});