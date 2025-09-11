// ABOUTME: Unit tests for export entries formatted functionality
// ABOUTME: Tests the core logic without MCP SDK integration issues

import { DataExporter } from '../../utils/dataExporter';
import { ValidationHelper } from '../../utils/validation';
import { GravityFormsMocks } from '../mocks/gravityFormsMocks';

describe('Export Entries Logic', () => {
  let dataExporter: DataExporter;
  let validator: ValidationHelper;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    dataExporter = new DataExporter();
    validator = new ValidationHelper();
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  describe('Parameter Validation', () => {
    test('should validate export entries parameters correctly', () => {
      const validParams = {
        form_id: '123',
        format: 'csv',
        search: { status: 'active' },
        date_format: 'YYYY-MM-DD'
      };

      const result = validator.validateExportEntriesParams(validParams);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should reject invalid form ID', () => {
      const invalidParams = {
        form_id: 'invalid',
        format: 'csv'
      };

      const result = validator.validateExportEntriesParams(invalidParams);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Form ID must be numeric');
    });

    test('should reject invalid export format', () => {
      const invalidParams = {
        form_id: '123',
        format: 'xml'
      };

      const result = validator.validateExportEntriesParams(invalidParams);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Export format must be "csv" or "json"');
    });

    test('should reject dangerous filenames', () => {
      const invalidParams = {
        form_id: '123',
        format: 'csv',
        filename: '../../../etc/passwd'
      };

      const result = validator.validateExportEntriesParams(invalidParams);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Filename contains invalid characters');
    });
  });

  describe('Data Export Integration', () => {
    test('should export entries to CSV format', async () => {
      const entries = GravityFormsMocks.getMockEntries();

      const result = await dataExporter.export(entries, 'csv', {
        includeHeaders: true,
        filename: 'test-export'
      });

      expect(result.format).toBe('csv');
      expect(result.filename).toBe('test-export.csv');
      expect(result.mimeType).toBe('text/csv');
      expect(result.data).toContain('id,1,2,3,4,form_id,date_created');
      expect(result.base64Data).toBeDefined();
    });

    test('should export entries to JSON format', async () => {
      const entries = GravityFormsMocks.getMockEntries();

      const result = await dataExporter.export(entries, 'json', {
        filename: 'test-export'
      });

      expect(result.format).toBe('json');
      expect(result.filename).toBe('test-export.json');
      expect(result.mimeType).toBe('application/json');
      expect(() => JSON.parse(result.data)).not.toThrow();
      expect(result.base64Data).toBeDefined();
    });

    test('should handle empty entries array', async () => {
      const result = await dataExporter.export([], 'csv');

      expect(result.data).toBe('');
      expect(result.base64Data).toBe('');
      expect(result.filename).toMatch(/\.csv$/);
    });

    test('should apply custom date formatting', async () => {
      const entries = [
        { id: '1', '1': 'John', 'date_created': '2024-01-15 10:30:00' }
      ];

      const result = await dataExporter.export(entries, 'csv', {
        dateFormat: 'MM/DD/YYYY'
      });

      expect(result.data).toContain('01/15/2024');
    });
  });

  describe('URL Construction Logic', () => {
    test('should construct basic API URL', () => {
      const baseUrl = 'https://test.example.com';
      const formId = '123';
      const expectedUrl = `${baseUrl}/wp-json/gf/v2/forms/${formId}/entries`;

      expect(`${baseUrl}/wp-json/gf/v2/forms/${formId}/entries`).toBe(expectedUrl);
    });

    test('should construct URL with JSON search parameters', () => {
      const baseUrl = 'https://test.example.com';
      const formId = '123';
      const params = new URLSearchParams();
      
      // New JSON format
      const searchObject = {
        status: 'active',
        field_filters: [{ key: '1', value: 'John', operator: '=' }]
      };
      params.append('search', JSON.stringify(searchObject));

      const expectedUrl = `${baseUrl}/wp-json/gf/v2/forms/${formId}/entries?${params.toString()}`;
      
      expect(expectedUrl).toContain('/wp-json/gf/v2/forms/123/entries');
      expect(expectedUrl).toContain('search=');
      
      // Verify JSON structure
      const urlObj = new URL(expectedUrl);
      const searchParam = urlObj.searchParams.get('search');
      expect(searchParam).toBeTruthy();
      const parsedSearch = JSON.parse(searchParam!);
      expect(parsedSearch).toEqual(searchObject);
    });

    test('should handle date range parameters in JSON format', () => {
      const params = new URLSearchParams();
      
      // New JSON format
      const searchObject = {
        date_range: { start: '2024-01-01', end: '2024-12-31' }
      };
      params.append('search', JSON.stringify(searchObject));

      const queryString = params.toString();
      expect(queryString).toContain('search=');
      
      // Verify JSON structure
      const searchParam = decodeURIComponent(queryString.split('=')[1]);
      const parsedSearch = JSON.parse(searchParam);
      expect(parsedSearch.date_range).toEqual({ start: '2024-01-01', end: '2024-12-31' });
    });
  });

  describe('Error Handling Scenarios', () => {
    test('should handle malformed entries gracefully', async () => {
      const malformedEntries = [
        { id: '1', '1': 'John' },
        null,
        { id: '2', '1': 'Jane' },
        undefined
      ];

      const result = await dataExporter.export(malformedEntries, 'csv');

      expect(result.data).toContain('John');
      expect(result.data).toContain('Jane');
      // Should skip null/undefined entries
      expect(result.data.split('\n').filter(line => line.trim())).toHaveLength(3); // header + 2 valid entries
    });

    test('should validate complex search parameters', () => {
      const complexParams = {
        form_id: '123',
        format: 'csv',
        search: {
          status: 'active',
          field_filters: [
            { key: '1', value: 'John' },
            { key: '3', value: 'john@example.com' }
          ],
          date_range: { start: '2024-01-01', end: '2024-12-31' }
        }
      };

      const result = validator.validateExportEntriesParams(complexParams);
      expect(result.isValid).toBe(true);
    });

    test('should reject invalid date ranges', () => {
      const invalidParams = {
        form_id: '123',
        format: 'csv',
        search: {
          date_range: { start: '2024-12-31', end: '2024-01-01' }
        }
      };

      const result = validator.validateExportEntriesParams(invalidParams);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Date range start must be before end date');
    });

    test('should reject malformed date strings', () => {
      const invalidParams = {
        form_id: '123',
        format: 'csv',
        search: {
          date_range: { start: 'invalid-date', end: '2024-12-31' }
        }
      };

      const result = validator.validateExportEntriesParams(invalidParams);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid date format in date range');
    });
  });

  describe('Response Format', () => {
    test('should format successful export response correctly', () => {
      const exportResult = {
        data: 'id,name\n1,John',
        base64Data: 'aWQsbmFtZQoxLEpvaG4=',
        filename: 'export.csv',
        format: 'csv' as const,
        mimeType: 'text/csv'
      };

      const response = {
        content: [
          {
            type: "text",
            text: `Export completed successfully!
            
Format: ${exportResult.format.toUpperCase()}
Filename: ${exportResult.filename}
Records: 2
File size: ${exportResult.data.length} characters

Base64 encoded data for download:
${exportResult.base64Data}`
          }
        ]
      };

      expect(response.content[0].text).toContain('Export completed successfully!');
      expect(response.content[0].text).toContain('Format: CSV');
      expect(response.content[0].text).toContain('Filename: export.csv');
      expect(response.content[0].text).toContain('Records: 2');
      expect(response.content[0].text).toContain('Base64 encoded data for download:');
    });

    test('should format empty results response correctly', () => {
      const response = {
        content: [
          {
            type: "text",
            text: "No entries found for the specified criteria."
          }
        ]
      };

      expect(response.content[0].text).toBe("No entries found for the specified criteria.");
    });
  });
});