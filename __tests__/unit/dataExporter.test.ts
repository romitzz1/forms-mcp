// ABOUTME: Unit tests for DataExporter class
// ABOUTME: Tests CSV/JSON export functionality with various data types and edge cases

import type { ExportFormat, ExportOptions} from '../../utils/dataExporter';
import { DataExporter, ExportResult } from '../../utils/dataExporter';

describe('DataExporter', () => {
  let dataExporter: DataExporter;

  beforeEach(() => {
    dataExporter = new DataExporter();
  });

  describe('Interfaces and Types', () => {
    it('should define ExportFormat type correctly', () => {
      const csvFormat: ExportFormat = 'csv';
      const jsonFormat: ExportFormat = 'json';
      
      expect(csvFormat).toBe('csv');
      expect(jsonFormat).toBe('json');
    });

    it('should accept valid ExportOptions', () => {
      const options: ExportOptions = {
        dateFormat: 'YYYY-MM-DD',
        includeHeaders: true,
        filename: 'test-export'
      };
      
      expect(options.dateFormat).toBe('YYYY-MM-DD');
      expect(options.includeHeaders).toBe(true);
      expect(options.filename).toBe('test-export');
    });
  });

  describe('CSV Export', () => {
    it('should export simple entries to CSV format', async () => {
      const entries = [
        { id: '1', '1': 'John', '2': 'Doe', '3': 'john@example.com' },
        { id: '2', '1': 'Jane', '2': 'Smith', '3': 'jane@example.com' }
      ];

      const result = await dataExporter.export(entries, 'csv', { includeHeaders: true });

      expect(result.format).toBe('csv');
      expect(result.mimeType).toBe('text/csv');
      expect(result.filename).toMatch(/\.csv$/);
      expect(result.data).toContain('id,1,2,3');
      expect(result.data).toContain('1,John,Doe,john@example.com');
      expect(result.data).toContain('2,Jane,Smith,jane@example.com');
    });

    it('should export CSV without headers when option is false', async () => {
      const entries = [
        { id: '1', '1': 'John', '2': 'Doe' }
      ];

      const result = await dataExporter.export(entries, 'csv', { includeHeaders: false });

      expect(result.data).not.toContain('id,1,2');
      expect(result.data).toContain('1,John,Doe');
    });

    it('should handle special characters in CSV', async () => {
      const entries = [
        { id: '1', '1': 'John, Jr.', '2': 'O\'Connor', '3': '"Special"' }
      ];

      const result = await dataExporter.export(entries, 'csv');

      expect(result.data).toContain('"John, Jr."'); // Quoted because of comma
      expect(result.data).toContain('O\'Connor'); // Single quotes don't need escaping in CSV
      expect(result.data).toContain('"""Special"""'); // Double quotes are escaped
    });

    it('should handle complex field types in CSV', async () => {
      const entries = [
        { 
          id: '1', 
          '1.3': 'John',  // Name field - first name
          '1.6': 'Doe',   // Name field - last name
          '2.1': '123 Main St',  // Address field - street
          '2.3': 'Anytown',      // Address field - city
          '3': ['file1.pdf', 'file2.jpg']  // File upload field
        }
      ];

      const result = await dataExporter.export(entries, 'csv');

      expect(result.data).toContain('John');
      expect(result.data).toContain('Doe');
      expect(result.data).toContain('123 Main St');
      expect(result.data).toContain('Anytown');
      expect(result.data).toContain('file1.pdf,file2.jpg');
    });
  });

  describe('JSON Export', () => {
    it('should export entries to JSON format', async () => {
      const entries = [
        { id: '1', '1': 'John', '2': 'Doe', '3': 'john@example.com' },
        { id: '2', '1': 'Jane', '2': 'Smith', '3': 'jane@example.com' }
      ];

      const result = await dataExporter.export(entries, 'json');

      expect(result.format).toBe('json');
      expect(result.mimeType).toBe('application/json');
      expect(result.filename).toMatch(/\.json$/);
      
      const parsedData = JSON.parse(result.data);
      expect(parsedData).toHaveLength(2);
      expect(parsedData[0]).toEqual({ id: '1', '1': 'John', '2': 'Doe', '3': 'john@example.com' });
    });

    it('should export JSON with clean structure and formatting', async () => {
      const entries = [
        { id: '1', '1': 'John', '2': 'Doe' }
      ];

      const result = await dataExporter.export(entries, 'json');

      // Should be properly formatted (indented) JSON
      expect(result.data).toContain('  ');
      expect(result.data).toContain('\n');
      
      // Should be valid JSON
      expect(() => JSON.parse(result.data)).not.toThrow();
    });

    it('should handle complex field types in JSON', async () => {
      const entries = [
        { 
          id: '1', 
          '1.3': 'John',
          '1.6': 'Doe',
          '2': { street: '123 Main St', city: 'Anytown' },
          '3': ['file1.pdf', 'file2.jpg']
        }
      ];

      const result = await dataExporter.export(entries, 'json');

      const parsedData = JSON.parse(result.data);
      expect(parsedData[0]['2']).toEqual({ street: '123 Main St', city: 'Anytown' });
      expect(parsedData[0]['3']).toEqual(['file1.pdf', 'file2.jpg']);
    });
  });

  describe('Date Formatting', () => {
    it('should format dates according to dateFormat option', async () => {
      const entries = [
        { id: '1', '1': 'John', 'date_created': '2024-01-15 10:30:00' }
      ];

      const result = await dataExporter.export(entries, 'csv', { 
        dateFormat: 'MM/DD/YYYY' 
      });

      expect(result.data).toContain('01/15/2024');
    });

    it('should handle various date formats', async () => {
      const entries = [
        { id: '1', 'date_created': '2024-01-15 10:30:00' }
      ];

      const isoResult = await dataExporter.export(entries, 'json', { 
        dateFormat: 'YYYY-MM-DD' 
      });
      expect(isoResult.data).toContain('2024-01-15');

      const usResult = await dataExporter.export(entries, 'csv', { 
        dateFormat: 'MM/DD/YYYY HH:mm' 
      });
      expect(usResult.data).toContain('01/15/2024 10:30');
    });
  });

  describe('Base64 Encoding', () => {
    it('should return base64 encoded data for file download', async () => {
      const entries = [
        { id: '1', '1': 'John', '2': 'Doe' }
      ];

      const result = await dataExporter.export(entries, 'csv');

      // Should have base64 encoded data
      expect(result.base64Data).toBeDefined();
      expect(typeof result.base64Data).toBe('string');
      
      // Should be valid base64
      expect(() => Buffer.from(result.base64Data!, 'base64')).not.toThrow();
      
      // Decoded data should match original
      const decoded = Buffer.from(result.base64Data!, 'base64').toString('utf-8');
      expect(decoded).toBe(result.data);
    });

    it('should encode both CSV and JSON data', async () => {
      const entries = [{ id: '1', '1': 'test' }];

      const csvResult = await dataExporter.export(entries, 'csv');
      const jsonResult = await dataExporter.export(entries, 'json');

      expect(csvResult.base64Data).toBeDefined();
      expect(jsonResult.base64Data).toBeDefined();
      
      const csvDecoded = Buffer.from(csvResult.base64Data!, 'base64').toString('utf-8');
      const jsonDecoded = Buffer.from(jsonResult.base64Data!, 'base64').toString('utf-8');
      
      expect(csvDecoded).toBe(csvResult.data);
      expect(jsonDecoded).toBe(jsonResult.data);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty entry array', async () => {
      const result = await dataExporter.export([], 'csv');

      expect(result.data).toBe('');
      expect(result.base64Data).toBe('');
      expect(result.filename).toMatch(/\.csv$/);
    });

    it('should handle null and undefined values', async () => {
      const entries = [
        { id: '1', '1': null, '2': undefined, '3': 'valid' }
      ];

      const csvResult = await dataExporter.export(entries, 'csv');
      expect(csvResult.data).toContain(',,valid');

      const jsonResult = await dataExporter.export(entries, 'json');
      const parsedData = JSON.parse(jsonResult.data);
      expect(parsedData[0]['1']).toBeNull();
      expect(parsedData[0]['2']).toBeUndefined();
    });

    it('should handle malformed entries gracefully', async () => {
      const entries = [
        { id: '1', '1': 'John' },
        null as any,
        { id: '2', '1': 'Jane' },
        undefined as any
      ];

      const result = await dataExporter.export(entries, 'csv');

      expect(result.data).toContain('John');
      expect(result.data).toContain('Jane');
      // Should skip null/undefined entries
      expect(result.data.split('\n').filter(line => line.trim())).toHaveLength(3); // header + 2 valid entries
    });

    it('should handle entries with inconsistent fields', async () => {
      const entries = [
        { id: '1', '1': 'John', '2': 'Doe' },
        { id: '2', '1': 'Jane', '3': 'jane@example.com' },
        { id: '3', '2': 'Smith', '4': 'Extra field' }
      ];

      const csvResult = await dataExporter.export(entries, 'csv', { includeHeaders: true });

      // Should include all possible field names in headers
      expect(csvResult.data).toContain('id,1,2,3,4');
      
      // Should handle missing fields gracefully
      expect(csvResult.data.split('\n')).toHaveLength(4); // header + 3 entries
    });

    it('should generate appropriate filenames', async () => {
      const entries = [{ id: '1' }];

      const csvResult = await dataExporter.export(entries, 'csv');
      expect(csvResult.filename).toMatch(/^export_\d{4}-\d{2}-\d{2}_\d{6}\.csv$/);

      const jsonResult = await dataExporter.export(entries, 'json');
      expect(jsonResult.filename).toMatch(/^export_\d{4}-\d{2}-\d{2}_\d{6}\.json$/);

      const customResult = await dataExporter.export(entries, 'csv', { 
        filename: 'custom-export' 
      });
      expect(customResult.filename).toBe('custom-export.csv');
    });

    it('should handle very large field values', async () => {
      const largeText = 'A'.repeat(10000);
      const entries = [
        { id: '1', '1': largeText }
      ];

      const csvResult = await dataExporter.export(entries, 'csv');
      expect(csvResult.data).toContain(largeText);

      const jsonResult = await dataExporter.export(entries, 'json');
      const parsedData = JSON.parse(jsonResult.data);
      expect(parsedData[0]['1']).toBe(largeText);
    });
  });
});