// ABOUTME: Unit tests for DataExporter class
// ABOUTME: Tests CSV/JSON export functionality with various data types and edge cases

import type { ExportFormat, ExportOptions} from '../../utils/dataExporter';
import { DataExporter, ExportResult } from '../../utils/dataExporter';
import * as fs from 'fs';
import * as path from 'path';

describe('DataExporter', () => {
  let dataExporter: DataExporter;
  const testExportDir = './test-exports';

  beforeEach(() => {
    dataExporter = new DataExporter();
    // Clean up test exports directory
    if (fs.existsSync(testExportDir)) {
      fs.rmSync(testExportDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up test exports directory
    if (fs.existsSync(testExportDir)) {
      fs.rmSync(testExportDir, { recursive: true, force: true });
    }
  });

  describe('Interfaces and Types', () => {
    it('should define ExportFormat type correctly', () => {
      const csvFormat: ExportFormat = 'csv';
      const jsonFormat: ExportFormat = 'json';
      
      expect(csvFormat).toBe('csv');
      expect(jsonFormat).toBe('json');
    });

    it('should accept valid ExportOptions including file saving options', () => {
      const options: ExportOptions = {
        dateFormat: 'YYYY-MM-DD',
        includeHeaders: true,
        filename: 'test-export',
        saveToDisk: true,
        outputPath: './custom/path'
      };

      expect(options.dateFormat).toBe('YYYY-MM-DD');
      expect(options.includeHeaders).toBe(true);
      expect(options.filename).toBe('test-export');
      expect(options.saveToDisk).toBe(true);
      expect(options.outputPath).toBe('./custom/path');
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

  describe('File Saving Functionality', () => {
    it('should save CSV file to disk when saveToDisk is true', async () => {
      const entries = [
        { id: '1', '1': 'John', '2': 'Doe', '3': 'john@example.com' },
        { id: '2', '1': 'Jane', '2': 'Smith', '3': 'jane@example.com' }
      ];

      const result = await dataExporter.export(entries, 'csv', {
        saveToDisk: true,
        outputPath: path.join(testExportDir, 'test-export.csv')
      }, 'test-form');

      // Check that result includes file path
      expect(result.filePath).toBeDefined();
      expect(result.filePath).toContain('test-export.csv');

      // Check that file actually exists
      expect(fs.existsSync(result.filePath!)).toBe(true);

      // Check file content matches export data
      const fileContent = fs.readFileSync(result.filePath!, 'utf8');
      expect(fileContent).toBe(result.data);
      expect(fileContent).toContain('id,1,2,3');
      expect(fileContent).toContain('John,Doe,john@example.com');
    });

    it('should save JSON file to disk when saveToDisk is true', async () => {
      const entries = [
        { id: '1', '1': 'John', '2': 'Doe' }
      ];

      const result = await dataExporter.export(entries, 'json', {
        saveToDisk: true,
        outputPath: path.join(testExportDir, 'test-export.json')
      });

      expect(result.filePath).toBeDefined();
      expect(result.filePath).toContain('test-export.json');
      expect(fs.existsSync(result.filePath!)).toBe(true);

      const fileContent = fs.readFileSync(result.filePath!, 'utf8');
      expect(fileContent).toBe(result.data);

      // Verify it's valid JSON
      const parsedContent = JSON.parse(fileContent);
      expect(parsedContent).toHaveLength(1);
      expect(parsedContent[0]).toEqual({ id: '1', '1': 'John', '2': 'Doe' });
    });

    it('should use default export directory structure when no outputPath provided', async () => {
      process.env.GRAVITY_FORMS_EXPORT_DIR = testExportDir;

      const entries = [{ id: '1', '1': 'Test' }];
      const result = await dataExporter.export(entries, 'csv', {
        saveToDisk: true
      }, 'form-123');

      expect(result.filePath).toBeDefined();
      expect(result.filePath).toContain('test-exports'); // Path normalization removes ./
      expect(result.filePath).toContain('form-123');
      expect(result.filePath).toContain(new Date().toISOString().slice(0, 10)); // Today's date
      expect(fs.existsSync(result.filePath!)).toBe(true);

      delete process.env.GRAVITY_FORMS_EXPORT_DIR;
    });

    it('should create directory structure automatically', async () => {
      const deepPath = path.join(testExportDir, 'nested', 'deep', 'structure', 'export.csv');
      const entries = [{ id: '1', '1': 'Test' }];

      const result = await dataExporter.export(entries, 'csv', {
        saveToDisk: true,
        outputPath: deepPath
      });

      expect(result.filePath).toBe(path.resolve(deepPath));
      expect(fs.existsSync(result.filePath!)).toBe(true);
      expect(fs.existsSync(path.dirname(result.filePath!))).toBe(true);
    });

    it('should handle relative paths correctly', async () => {
      const relativePath = './test-exports/relative-export.csv';
      const entries = [{ id: '1', '1': 'Test' }];

      const result = await dataExporter.export(entries, 'csv', {
        saveToDisk: true,
        outputPath: relativePath
      });

      expect(result.filePath).toBe(path.resolve(relativePath));
      expect(fs.existsSync(result.filePath!)).toBe(true);
    });

    it('should not save file when saveToDisk is false', async () => {
      const entries = [{ id: '1', '1': 'Test' }];
      const result = await dataExporter.export(entries, 'csv', {
        saveToDisk: false,
        outputPath: path.join(testExportDir, 'should-not-exist.csv')
      });

      expect(result.filePath).toBeUndefined();
      expect(fs.existsSync(path.join(testExportDir, 'should-not-exist.csv'))).toBe(false);
    });

    it('should not save file when saveToDisk is undefined', async () => {
      const entries = [{ id: '1', '1': 'Test' }];
      const result = await dataExporter.export(entries, 'csv', {
        outputPath: path.join(testExportDir, 'should-not-exist.csv')
      });

      expect(result.filePath).toBeUndefined();
      expect(fs.existsSync(path.join(testExportDir, 'should-not-exist.csv'))).toBe(false);
    });

    it('should return both file path and base64 data when saving to disk', async () => {
      const entries = [{ id: '1', '1': 'Test Data' }];
      const result = await dataExporter.export(entries, 'csv', {
        saveToDisk: true,
        outputPath: path.join(testExportDir, 'dual-output.csv')
      });

      // Should have both file path and base64 data
      expect(result.filePath).toBeDefined();
      expect(result.base64Data).toBeDefined();
      expect(result.data).toBeDefined();

      // File content should match in-memory data
      const fileContent = fs.readFileSync(result.filePath!, 'utf8');
      expect(fileContent).toBe(result.data);

      // Base64 should decode to the same content
      const decodedBase64 = Buffer.from(result.base64Data!, 'base64').toString('utf8');
      expect(decodedBase64).toBe(result.data);
    });

    it('should throw error for invalid file paths', async () => {
      const entries = [{ id: '1', '1': 'Test' }];

      // Test with invalid characters (this may vary by OS)
      await expect(dataExporter.export(entries, 'csv', {
        saveToDisk: true,
        outputPath: '/invalid<>path/file.csv'
      })).rejects.toThrow();
    });

    it('should handle filename with custom extension correctly', async () => {
      const entries = [{ id: '1', '1': 'Test' }];
      const customPath = path.join(testExportDir, 'custom-name.csv');

      const result = await dataExporter.export(entries, 'csv', {
        saveToDisk: true,
        outputPath: customPath,
        filename: 'ignored-when-path-provided'
      });

      expect(result.filePath).toBe(path.resolve(customPath));
      expect(fs.existsSync(result.filePath!)).toBe(true);
    });

    it('should use environment variable for default export directory', async () => {
      const customExportDir = path.join(testExportDir, 'custom-env-dir');
      process.env.GRAVITY_FORMS_EXPORT_DIR = customExportDir;

      const entries = [{ id: '1', '1': 'Test' }];
      const result = await dataExporter.export(entries, 'csv', {
        saveToDisk: true
      }, 'form-456');

      expect(result.filePath).toContain(customExportDir);
      expect(result.filePath).toContain('form-456');
      expect(fs.existsSync(result.filePath!)).toBe(true);

      delete process.env.GRAVITY_FORMS_EXPORT_DIR;
    });

    it('should generate unique filenames with timestamps', async () => {
      const entries = [{ id: '1', '1': 'Test' }];

      // Export two files quickly
      const result1 = await dataExporter.export(entries, 'csv', {
        saveToDisk: true,
        outputPath: path.join(testExportDir, 'file1')
      });

      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      const result2 = await dataExporter.export(entries, 'csv', {
        saveToDisk: true,
        outputPath: path.join(testExportDir, 'file2')
      });

      expect(result1.filePath).not.toBe(result2.filePath);
      expect(fs.existsSync(result1.filePath!)).toBe(true);
      expect(fs.existsSync(result2.filePath!)).toBe(true);
    });
  });

  describe('Base64 Encoding Control', () => {
    it('should skip base64 encoding when skip_base64 is true', async () => {
      const entries = [
        { id: '1', '1': 'John', '2': 'Doe', '3': 'john@example.com' }
      ];

      const result = await dataExporter.export(entries, 'csv', {
        skipBase64: true
      });

      expect(result.base64Data).toBeUndefined();
      expect(result.data).toBeDefined();
      expect(result.filename).toBeDefined();
      expect(result.format).toBe('csv');
    });

    it('should include base64 encoding when skip_base64 is false (default)', async () => {
      const entries = [
        { id: '1', '1': 'John', '2': 'Doe' }
      ];

      const result = await dataExporter.export(entries, 'csv', {
        skipBase64: false
      });

      expect(result.base64Data).toBeDefined();
      expect(result.data).toBeDefined();
      expect(typeof result.base64Data).toBe('string');

      // Verify base64 decodes correctly
      const decoded = Buffer.from(result.base64Data!, 'base64').toString('utf8');
      expect(decoded).toBe(result.data);
    });

    it('should include base64 encoding by default when skipBase64 is not specified', async () => {
      const entries = [
        { id: '1', '1': 'Test' }
      ];

      const result = await dataExporter.export(entries, 'json');

      expect(result.base64Data).toBeDefined();
      expect(result.data).toBeDefined();
    });

    it('should skip base64 but still save to disk when both options are enabled', async () => {
      const entries = [
        { id: '1', '1': 'Large data that would bloat context', '2': 'More data' }
      ];

      const result = await dataExporter.export(entries, 'csv', {
        saveToDisk: true,
        skipBase64: true,
        outputPath: path.join(testExportDir, 'no-base64.csv')
      });

      // Should have file path but no base64
      expect(result.filePath).toBeDefined();
      expect(result.base64Data).toBeUndefined();
      expect(result.data).toBeDefined();

      // File should exist and contain correct data
      expect(fs.existsSync(result.filePath!)).toBe(true);
      const fileContent = fs.readFileSync(result.filePath!, 'utf8');
      expect(fileContent).toBe(result.data);
    });

    it('should handle large exports efficiently with skip_base64', async () => {
      // Create large dataset
      const largeEntries = Array.from({ length: 1000 }, (_, i) => ({
        id: `${i + 1}`,
        '1': `User ${i + 1}`,
        '2': `user${i + 1}@example.com`,
        '3': `Large description text for entry ${i + 1}`.repeat(10)
      }));

      const result = await dataExporter.export(largeEntries, 'csv', {
        skipBase64: true
      });

      expect(result.base64Data).toBeUndefined();
      expect(result.data).toBeDefined();
      expect(result.data.length).toBeGreaterThan(10000); // Should be large

      // Should still have all other properties
      expect(result.filename).toBeDefined();
      expect(result.format).toBe('csv');
      expect(result.mimeType).toBe('text/csv');
    });

    it('should work with JSON format and skip_base64', async () => {
      const entries = [
        { id: '1', complex: { nested: 'data', array: [1, 2, 3] } }
      ];

      const result = await dataExporter.export(entries, 'json', {
        skipBase64: true
      });

      expect(result.base64Data).toBeUndefined();
      expect(result.data).toBeDefined();
      expect(result.format).toBe('json');

      // Should be valid JSON
      const parsed = JSON.parse(result.data);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].complex.nested).toBe('data');
    });

    it('should handle empty entries correctly with skip_base64', async () => {
      const entries: any[] = [];

      const result = await dataExporter.export(entries, 'csv', {
        skipBase64: true
      });

      expect(result.base64Data).toBeUndefined();
      expect(result.data).toBe(''); // Empty string for no data
      expect(result.format).toBe('csv');
    });

    it('should handle empty entries correctly without skip_base64', async () => {
      const entries: any[] = [];

      const result = await dataExporter.export(entries, 'csv', {
        skipBase64: false
      });

      expect(result.base64Data).toBe(''); // Empty base64 for empty data
      expect(result.data).toBe(''); // Empty string for no data
      expect(result.format).toBe('csv');
    });
  });
});