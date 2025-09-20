// ABOUTME: Unit tests for DataExporter field filtering functionality
// ABOUTME: Tests field_ids parameter to export only specified fields plus metadata

import type { ExportOptions } from '../../utils/dataExporter';
import { DataExporter } from '../../utils/dataExporter';

describe('DataExporter Field Filtering', () => {
  let dataExporter: DataExporter;

  beforeEach(() => {
    dataExporter = new DataExporter();
  });

  const mockEntries = [
    {
      id: '1',
      form_id: '106',
      date_created: '2025-04-10 21:21:29',
      status: 'active',
      is_starred: '0',
      // Field 57: Date of Birth
      '57': '1986-08-11',
      // Field 5: Address (composite field)
      '5.1': '26 S Linwood Ave',
      '5.3': 'Pittsburgh',
      '5.4': 'Pennsylvania',
      '5.5': '15205',
      '5.6': 'United States',
      // Field 1: Name (should be excluded when not requested)
      '1.3': 'Emily',
      '1.6': 'Hendrickson',
      // Field 3: Phone (should be excluded when not requested)
      '3': '(724) 290-9624',
      // Field 4: Email (should be excluded when not requested)
      '4': 'emilyshendrickson@gmail.com'
    },
    {
      id: '2',
      form_id: '106',
      date_created: '2025-03-21 17:50:46',
      status: 'active',
      is_starred: '1',
      '57': '1976-11-26',
      '5.1': '42 South Ave',
      '5.3': 'Sewickley',
      '5.4': 'Pennsylvania',
      '5.5': '15143',
      '5.6': 'United States',
      '1.3': 'Mark',
      '1.6': 'Longwell',
      '3': '(412) 726-9824',
      '4': 'mjlongwell@comcast.net'
    }
  ];

  describe('field filtering with fieldIds option', () => {
    it('should filter entries to include only specified field IDs', async () => {
      const options: ExportOptions = {
        fieldIds: ['57', '5'] // Date of birth and address only
      };

      const result = await dataExporter.export(mockEntries, 'json', options);
      const exportedEntries = JSON.parse(result.data);

      // Should have 2 entries
      expect(exportedEntries).toHaveLength(2);

      const firstEntry = exportedEntries[0];

      // Should include metadata fields
      expect(firstEntry.id).toBe('1');
      expect(firstEntry.form_id).toBe('106');
      expect(firstEntry.date_created).toBe('2025-04-10 21:21:29');
      expect(firstEntry.status).toBe('active');
      expect(firstEntry.is_starred).toBe('0');

      // Should include requested field 57 (date of birth)
      expect(firstEntry['57']).toBe('1986-08-11');

      // Should include all sub-fields of field 5 (address)
      expect(firstEntry['5.1']).toBe('26 S Linwood Ave');
      expect(firstEntry['5.3']).toBe('Pittsburgh');
      expect(firstEntry['5.4']).toBe('Pennsylvania');
      expect(firstEntry['5.5']).toBe('15205');
      expect(firstEntry['5.6']).toBe('United States');

      // Should NOT include unrequested fields
      expect(firstEntry['1.3']).toBeUndefined(); // Name
      expect(firstEntry['1.6']).toBeUndefined(); // Name
      expect(firstEntry['3']).toBeUndefined(); // Phone
      expect(firstEntry['4']).toBeUndefined(); // Email
    });

    it('should preserve metadata fields even when not specified in fieldIds', async () => {
      const options: ExportOptions = {
        fieldIds: ['57'] // Only date of birth requested
      };

      const result = await dataExporter.export(mockEntries, 'json', options);
      const exportedEntries = JSON.parse(result.data);
      const firstEntry = exportedEntries[0];

      // Should still include all metadata fields
      expect(firstEntry.id).toBe('1');
      expect(firstEntry.form_id).toBe('106');
      expect(firstEntry.date_created).toBe('2025-04-10 21:21:29');
      expect(firstEntry.status).toBe('active');
      expect(firstEntry.is_starred).toBe('0');

      // Should include only the requested field
      expect(firstEntry['57']).toBe('1986-08-11');

      // Should not include other form fields
      expect(firstEntry['5.1']).toBeUndefined();
      expect(firstEntry['3']).toBeUndefined();
    });

    it('should handle composite fields by including all sub-fields', async () => {
      const options: ExportOptions = {
        fieldIds: ['5'] // Address field only
      };

      const result = await dataExporter.export(mockEntries, 'json', options);
      const exportedEntries = JSON.parse(result.data);
      const firstEntry = exportedEntries[0];

      // Should include all address sub-fields
      expect(firstEntry['5.1']).toBe('26 S Linwood Ave');
      expect(firstEntry['5.3']).toBe('Pittsburgh');
      expect(firstEntry['5.4']).toBe('Pennsylvania');
      expect(firstEntry['5.5']).toBe('15205');
      expect(firstEntry['5.6']).toBe('United States');

      // Should not include other fields
      expect(firstEntry['57']).toBeUndefined();
      expect(firstEntry['1.3']).toBeUndefined();
    });

    it('should handle non-existent field IDs gracefully', async () => {
      const options: ExportOptions = {
        fieldIds: ['999', '57'] // Non-existent field + valid field
      };

      const result = await dataExporter.export(mockEntries, 'json', options);
      const exportedEntries = JSON.parse(result.data);
      const firstEntry = exportedEntries[0];

      // Should include valid field
      expect(firstEntry['57']).toBe('1986-08-11');

      // Should include metadata
      expect(firstEntry.id).toBe('1');

      // Non-existent field should not cause errors
      expect(firstEntry['999']).toBeUndefined();
    });

    it('should work with CSV export format', async () => {
      const options: ExportOptions = {
        fieldIds: ['57', '5'],
        includeHeaders: true
      };

      const result = await dataExporter.export(mockEntries, 'csv', options);
      const csvLines = result.data.split('\n');

      // Should have header + 2 data rows
      expect(csvLines).toHaveLength(3);

      // Header should include only metadata and requested fields
      const headers = csvLines[0];
      expect(headers).toContain('id');
      expect(headers).toContain('57');
      expect(headers).toContain('5.1');
      expect(headers).toContain('5.5');

      // Should not include unrequested fields in headers
      // Use word boundaries to avoid false positives with substrings
      expect(headers.split(',')).not.toContain('1.3');
      expect(headers.split(',')).not.toContain('3');
      expect(headers.split(',')).not.toContain('4');
    });

    it('should work with JSON export format', async () => {
      const options: ExportOptions = {
        fieldIds: ['57']
      };

      const result = await dataExporter.export(mockEntries, 'json', options);

      expect(result.format).toBe('json');
      expect(result.mimeType).toBe('application/json');

      const exportedEntries = JSON.parse(result.data);
      expect(Array.isArray(exportedEntries)).toBe(true);
      expect(exportedEntries).toHaveLength(2);
    });

    it('should return all fields when fieldIds is empty or undefined', async () => {
      // Test with undefined fieldIds
      const resultUndefined = await dataExporter.export(mockEntries, 'json', {});
      const entriesUndefined = JSON.parse(resultUndefined.data);

      // Should include all fields
      expect(entriesUndefined[0]['57']).toBe('1986-08-11');
      expect(entriesUndefined[0]['5.1']).toBe('26 S Linwood Ave');
      expect(entriesUndefined[0]['1.3']).toBe('Emily');
      expect(entriesUndefined[0]['3']).toBe('(724) 290-9624');

      // Test with empty fieldIds array
      const resultEmpty = await dataExporter.export(mockEntries, 'json', { fieldIds: [] });
      const entriesEmpty = JSON.parse(resultEmpty.data);

      // Should include all fields
      expect(entriesEmpty[0]['57']).toBe('1986-08-11');
      expect(entriesEmpty[0]['5.1']).toBe('26 S Linwood Ave');
      expect(entriesEmpty[0]['1.3']).toBe('Emily');
      expect(entriesEmpty[0]['3']).toBe('(724) 290-9624');
    });

    it('should handle entries with null and undefined values gracefully', async () => {
      const entriesWithNulls = [
        {
          id: '1',
          form_id: '106',
          '57': null,
          '5.1': 'Valid Address',
          '5.2': undefined,
          '5.3': 'Valid City',
          '1.3': 'John'
        }
      ];

      const options: ExportOptions = {
        fieldIds: ['57', '5']
      };

      const result = await dataExporter.export(entriesWithNulls, 'json', options);
      const exportedEntries = JSON.parse(result.data);
      const entry = exportedEntries[0];

      // Should include metadata
      expect(entry.id).toBe('1');
      expect(entry.form_id).toBe('106');

      // Should include null values but not undefined values
      expect(entry['57']).toBeNull();
      expect(entry['5.1']).toBe('Valid Address');
      expect(entry['5.3']).toBe('Valid City');
      expect(entry.hasOwnProperty('5.2')).toBe(false); // undefined should be excluded

      // Should not include unrequested fields
      expect(entry['1.3']).toBeUndefined();
    });

    it('should handle field IDs that are numeric strings', async () => {
      const options: ExportOptions = {
        fieldIds: ['0', '57'] // Testing with "0" field ID
      };

      const entriesWithZeroField = [
        {
          id: '1',
          '0': 'Zero field value',
          '57': '1990-01-01',
          '1.3': 'Should be excluded'
        }
      ];

      const result = await dataExporter.export(entriesWithZeroField, 'json', options);
      const exportedEntries = JSON.parse(result.data);
      const entry = exportedEntries[0];

      expect(entry['0']).toBe('Zero field value');
      expect(entry['57']).toBe('1990-01-01');
      expect(entry['1.3']).toBeUndefined();
    });

    it('should handle complex nested field IDs correctly', async () => {
      const entriesWithComplexFields = [
        {
          id: '1',
          '1': 'Field 1',
          '1.1': 'Field 1.1',
          '1.1.1': 'Field 1.1.1', // This should NOT be included when requesting field "1"
          '11': 'Field 11',
          '11.1': 'Field 11.1' // This should NOT be included when requesting field "1"
        }
      ];

      const options: ExportOptions = {
        fieldIds: ['1']
      };

      const result = await dataExporter.export(entriesWithComplexFields, 'json', options);
      const exportedEntries = JSON.parse(result.data);
      const entry = exportedEntries[0];

      // Should include field 1 and its direct sub-fields
      expect(entry['1']).toBe('Field 1');
      expect(entry['1.1']).toBe('Field 1.1');
      expect(entry['1.1.1']).toBe('Field 1.1.1'); // This is a sub-field of field 1

      // Should NOT include field 11 (different field)
      expect(entry['11']).toBeUndefined();
      expect(entry['11.1']).toBeUndefined();
    });
  });
});