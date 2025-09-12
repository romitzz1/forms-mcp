// ABOUTME: Test suite for FormCache class
// ABOUTME: Tests form caching with SQLite schema management

import type { FormCacheInsert, FormCacheUpdate} from '../../utils/formCache.js';
import { FormCache, FormCacheRecord } from '../../utils/formCache.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('FormCache', () => {
  let tempDir: string;
  let testDbPath: string;
  let formCache: FormCache;

  beforeEach(() => {
    // Create temporary directory for test databases
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forms-mcp-test-'));
    testDbPath = path.join(tempDir, 'test-forms.db');
  });

  afterEach(async () => {
    // Clean up FormCache and test databases
    if (formCache) {
      try {
        await formCache.close();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    
    // Remove temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('constructor and initialization', () => {
    it('should create FormCache with custom path', () => {
      formCache = new FormCache(testDbPath);
      expect(formCache).toBeDefined();
      expect(formCache.isReady()).toBe(false);
    });

    it('should create FormCache with default path', () => {
      formCache = new FormCache();
      expect(formCache).toBeDefined();
      expect(formCache.isReady()).toBe(false);
    });

    it('should initialize database and create schema', async () => {
      formCache = new FormCache(testDbPath);
      
      expect(fs.existsSync(testDbPath)).toBe(false);
      
      await formCache.init();
      
      expect(fs.existsSync(testDbPath)).toBe(true);
      expect(formCache.isReady()).toBe(true);
    });

    it('should handle multiple init calls gracefully', async () => {
      formCache = new FormCache(testDbPath);
      
      await formCache.init();
      expect(formCache.isReady()).toBe(true);
      
      // Second init should not throw
      await expect(formCache.init()).resolves.not.toThrow();
      expect(formCache.isReady()).toBe(true);
    });
  });

  describe('database schema', () => {
    beforeEach(async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();
    });

    it('should create forms table with correct schema', async () => {
      // Test that table exists by attempting to query it
      const tableExists = await formCache.tableExists('forms');
      expect(tableExists).toBe(true);
    });

    it('should create required indexes for performance', async () => {
      const indexes = await formCache.getTableIndexes('forms');
      
      // Should have indexes for common query patterns
      expect(indexes).toContain('idx_forms_active');
      expect(indexes).toContain('idx_forms_last_synced');
    });

    it('should have proper column structure', async () => {
      const columns = await formCache.getTableColumns('forms');
      
      // Verify all required columns exist with correct types
      expect(columns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'id', type: 'INTEGER', pk: true }),
          expect.objectContaining({ name: 'title', type: 'TEXT', notnull: true }),
          expect.objectContaining({ name: 'entry_count', type: 'INTEGER' }),
          expect.objectContaining({ name: 'is_active', type: 'BOOLEAN' }),
          expect.objectContaining({ name: 'last_synced', type: 'TIMESTAMP' }),
          expect.objectContaining({ name: 'form_data', type: 'TEXT' })
        ])
      );
    });

    it('should reject invalid table names for columns', async () => {
      await expect(formCache.getTableColumns('invalid-name')).rejects.toThrow('Invalid table name format');
      await expect(formCache.getTableColumns('123invalid')).rejects.toThrow('Invalid table name format');
      await expect(formCache.getTableColumns('table;DROP TABLE forms;')).rejects.toThrow('Invalid table name format');
    });

    it('should reject invalid table names for indexes', async () => {
      await expect(formCache.getTableIndexes('invalid-name')).rejects.toThrow('Invalid table name format');
      await expect(formCache.getTableIndexes('123invalid')).rejects.toThrow('Invalid table name format');
      await expect(formCache.getTableIndexes('table;DROP TABLE forms;')).rejects.toThrow('Invalid table name format');
    });
  });

  describe('database lifecycle', () => {
    it('should manage connection lifecycle correctly', async () => {
      formCache = new FormCache(testDbPath);
      
      expect(formCache.isReady()).toBe(false);
      
      await formCache.init();
      expect(formCache.isReady()).toBe(true);
      
      await formCache.close();
      expect(formCache.isReady()).toBe(false);
    });

    it('should handle close called multiple times', async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();
      
      await formCache.close();
      expect(formCache.isReady()).toBe(false);
      
      // Second close should not throw
      await expect(formCache.close()).resolves.not.toThrow();
      expect(formCache.isReady()).toBe(false);
    });

    it('should reconnect to existing database', async () => {
      // First connection
      formCache = new FormCache(testDbPath);
      await formCache.init();
      expect(fs.existsSync(testDbPath)).toBe(true);
      await formCache.close();
      
      // Second connection to same database
      const formCache2 = new FormCache(testDbPath);
      await formCache2.init();
      expect(formCache2.isReady()).toBe(true);
      
      // Should still have the same schema
      const tableExists = await formCache2.tableExists('forms');
      expect(tableExists).toBe(true);
      
      await formCache2.close();
    });
  });

  describe('error handling', () => {
    it('should handle invalid database path gracefully', async () => {
      const invalidPath = '/invalid/path/database.db';
      formCache = new FormCache(invalidPath);
      
      await expect(formCache.init()).rejects.toThrow();
      expect(formCache.isReady()).toBe(false);
    });

    it('should handle database file corruption', async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();
      await formCache.close();
      
      // Corrupt the database file
      fs.writeFileSync(testDbPath, 'corrupted data');
      
      // Should handle corruption gracefully
      formCache = new FormCache(testDbPath);
      await expect(formCache.init()).rejects.toThrow();
    });

    it('should handle directory creation failure', async () => {
      // Create a file where the directory should be
      const blockedPath = path.join(tempDir, 'blocked');
      fs.writeFileSync(blockedPath, 'blocking file');
      
      const dbPath = path.join(blockedPath, 'forms.db');
      formCache = new FormCache(dbPath);
      
      await expect(formCache.init()).rejects.toThrow();
    });
  });

  describe('schema migration', () => {
    it('should handle schema version tracking', async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();
      
      const version = await formCache.getSchemaVersion();
      expect(typeof version).toBe('number');
      expect(version).toBeGreaterThan(0);
    });

    it('should detect when schema needs migration', async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();
      
      // For initial version, should not need migration
      const needsMigration = await formCache.needsSchemaUpdate();
      expect(needsMigration).toBe(false);
    });
  });

  describe('utility methods', () => {
    beforeEach(async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();
    });

    it('should provide database path', () => {
      expect(formCache.getDatabasePath()).toBe(testDbPath);
    });

    it('should provide connection status', () => {
      expect(formCache.isReady()).toBe(true);
    });
  });

  describe('CRUD operations', () => {
    const sampleForm: FormCacheInsert = {
      id: 1,
      title: 'Test Form',
      entry_count: 5,
      is_active: true,
      form_data: JSON.stringify({ fields: [{ id: 1, type: 'text' }] })
    };

    beforeEach(async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();
    });

    describe('insertForm', () => {
      it('should insert new form record successfully', async () => {
        await formCache.insertForm(sampleForm);
        
        const retrieved = await formCache.getForm(1);
        expect(retrieved).toBeDefined();
        expect(retrieved!.id).toBe(1);
        expect(retrieved!.title).toBe('Test Form');
        expect(retrieved!.entry_count).toBe(5);
        expect(retrieved!.is_active).toBe(true);
        expect(retrieved!.form_data).toBe(sampleForm.form_data);
        expect(retrieved!.last_synced).toBeDefined();
      });

      it('should insert form with minimal data', async () => {
        const minimalForm: FormCacheInsert = {
          id: 2,
          title: 'Minimal Form'
        };

        await formCache.insertForm(minimalForm);
        
        const retrieved = await formCache.getForm(2);
        expect(retrieved).toBeDefined();
        expect(retrieved!.id).toBe(2);
        expect(retrieved!.title).toBe('Minimal Form');
        expect(retrieved!.entry_count).toBe(0);
        expect(retrieved!.is_active).toBe(true);
        expect(retrieved!.form_data).toBe('');
      });

      it('should handle duplicate ID insertion gracefully', async () => {
        await formCache.insertForm(sampleForm);
        
        const duplicateForm: FormCacheInsert = {
          id: 1,
          title: 'Duplicate Form'
        };

        await expect(formCache.insertForm(duplicateForm)).rejects.toThrow();
      });

      it('should validate required fields', async () => {
        const invalidForm = {
          id: 3
          // missing title
        } as FormCacheInsert;

        await expect(formCache.insertForm(invalidForm)).rejects.toThrow();
      });
    });

    describe('getForm', () => {
      beforeEach(async () => {
        await formCache.insertForm(sampleForm);
      });

      it('should retrieve existing form by ID', async () => {
        const form = await formCache.getForm(1);
        expect(form).toBeDefined();
        expect(form!.id).toBe(1);
        expect(form!.title).toBe('Test Form');
      });

      it('should return null for non-existent form', async () => {
        const form = await formCache.getForm(999);
        expect(form).toBeNull();
      });

      it('should validate ID parameter', async () => {
        await expect(formCache.getForm(-1)).rejects.toThrow();
        // Form ID 0 is now valid
        await expect(formCache.getForm(0)).resolves.toBeNull();
      });
    });

    describe('getAllForms', () => {
      beforeEach(async () => {
        await formCache.insertForm({ id: 1, title: 'Active Form', is_active: true });
        await formCache.insertForm({ id: 2, title: 'Inactive Form', is_active: false });
        await formCache.insertForm({ id: 3, title: 'Another Active Form', is_active: true });
      });

      it('should return all forms when activeOnly is false', async () => {
        const forms = await formCache.getAllForms(false);
        expect(forms).toHaveLength(3);
        expect(forms.map(f => f.title)).toContain('Active Form');
        expect(forms.map(f => f.title)).toContain('Inactive Form');
        expect(forms.map(f => f.title)).toContain('Another Active Form');
      });

      it('should return only active forms when activeOnly is true', async () => {
        const forms = await formCache.getAllForms(true);
        expect(forms).toHaveLength(2);
        expect(forms.every(f => f.is_active)).toBe(true);
        expect(forms.map(f => f.title)).toContain('Active Form');
        expect(forms.map(f => f.title)).toContain('Another Active Form');
        expect(forms.map(f => f.title)).not.toContain('Inactive Form');
      });

      it('should default to all forms when activeOnly not specified', async () => {
        const forms = await formCache.getAllForms();
        expect(forms).toHaveLength(3);
      });

      it('should return empty array when no forms exist', async () => {
        const emptyCache = new FormCache(':memory:');
        await emptyCache.init();
        const forms = await emptyCache.getAllForms();
        expect(forms).toHaveLength(0);
        await emptyCache.close();
      });
    });

    describe('updateForm', () => {
      beforeEach(async () => {
        await formCache.insertForm(sampleForm);
      });

      it('should update form title', async () => {
        const updates: FormCacheUpdate = { title: 'Updated Title' };
        await formCache.updateForm(1, updates);
        
        const form = await formCache.getForm(1);
        expect(form!.title).toBe('Updated Title');
        expect(form!.entry_count).toBe(5); // unchanged
      });

      it('should update form activity status', async () => {
        const updates: FormCacheUpdate = { is_active: false };
        await formCache.updateForm(1, updates);
        
        const form = await formCache.getForm(1);
        expect(form!.is_active).toBe(false);
      });

      it('should update multiple fields', async () => {
        const updates: FormCacheUpdate = {
          title: 'Multi Update',
          entry_count: 10,
          is_active: false
        };
        await formCache.updateForm(1, updates);
        
        const form = await formCache.getForm(1);
        expect(form!.title).toBe('Multi Update');
        expect(form!.entry_count).toBe(10);
        expect(form!.is_active).toBe(false);
      });

      it('should handle updates to non-existent form', async () => {
        const updates: FormCacheUpdate = { title: 'No Form' };
        await expect(formCache.updateForm(999, updates)).rejects.toThrow();
      });

      it('should validate ID parameter', async () => {
        const updates: FormCacheUpdate = { title: 'Valid Update' };
        await expect(formCache.updateForm(-1, updates)).rejects.toThrow();
        // Form ID 0 is now valid, but will fail because form doesn't exist
        await expect(formCache.updateForm(0, updates)).rejects.toThrow('Form with ID 0 not found');
      });
    });

    describe('deleteForm', () => {
      beforeEach(async () => {
        await formCache.insertForm(sampleForm);
        await formCache.insertForm({ id: 2, title: 'Second Form' });
      });

      it('should delete existing form', async () => {
        await formCache.deleteForm(1);
        
        const form = await formCache.getForm(1);
        expect(form).toBeNull();
        
        // Other forms should still exist
        const otherForm = await formCache.getForm(2);
        expect(otherForm).toBeDefined();
      });

      it('should handle deletion of non-existent form', async () => {
        await expect(formCache.deleteForm(999)).rejects.toThrow();
      });

      it('should validate ID parameter', async () => {
        await expect(formCache.deleteForm(-1)).rejects.toThrow();
        // Form ID 0 is now valid, but will fail because form doesn't exist
        await expect(formCache.deleteForm(0)).rejects.toThrow('Form with ID 0 not found');
      });
    });

    describe('getFormCount', () => {
      beforeEach(async () => {
        await formCache.insertForm({ id: 1, title: 'Active Form', is_active: true });
        await formCache.insertForm({ id: 2, title: 'Inactive Form', is_active: false });
        await formCache.insertForm({ id: 3, title: 'Another Active Form', is_active: true });
      });

      it('should count all forms when activeOnly is false', async () => {
        const count = await formCache.getFormCount(false);
        expect(count).toBe(3);
      });

      it('should count only active forms when activeOnly is true', async () => {
        const count = await formCache.getFormCount(true);
        expect(count).toBe(2);
      });

      it('should default to all forms when activeOnly not specified', async () => {
        const count = await formCache.getFormCount();
        expect(count).toBe(3);
      });

      it('should return zero when no forms exist', async () => {
        const emptyCache = new FormCache(':memory:');
        await emptyCache.init();
        const count = await emptyCache.getFormCount();
        expect(count).toBe(0);
        await emptyCache.close();
      });
    });

    describe('concurrent access and transactions', () => {
      beforeEach(async () => {
        await formCache.insertForm(sampleForm);
      });

      it('should handle concurrent reads safely', async () => {
        const promises = Array.from({ length: 10 }, () => formCache.getForm(1));
        const results = await Promise.all(promises);
        
        results.forEach(result => {
          expect(result).toBeDefined();
          expect(result!.id).toBe(1);
        });
      });

      it('should handle concurrent writes safely', async () => {
        const promises = Array.from({ length: 5 }, (_, i) => 
          formCache.insertForm({ id: i + 10, title: `Concurrent Form ${i}` })
        );
        
        await expect(Promise.all(promises)).resolves.not.toThrow();
        
        // Verify all forms were inserted
        const forms = await formCache.getAllForms();
        expect(forms).toHaveLength(6); // 1 original + 5 new
      });
    });

    describe('input validation and edge cases', () => {
      beforeEach(async () => {
        await formCache.insertForm(sampleForm);
      });

      it('should handle special characters in form data', async () => {
        const specialForm: FormCacheInsert = {
          id: 100,
          title: 'Form with "quotes" and \'apostrophes\'',
          form_data: JSON.stringify({ 
            special: 'data with "quotes", \'apostrophes\', and \nnewlines' 
          })
        };

        await formCache.insertForm(specialForm);
        const retrieved = await formCache.getForm(100);
        expect(retrieved!.title).toBe(specialForm.title);
        expect(retrieved!.form_data).toBe(specialForm.form_data);
      });

      it('should handle very large form data', async () => {
        const largeData = JSON.stringify({ 
          fields: Array.from({ length: 1000 }, (_, i) => ({ 
            id: i, 
            type: 'text', 
            label: `Field ${i}` 
          }))
        });

        const largeForm: FormCacheInsert = {
          id: 101,
          title: 'Large Form',
          form_data: largeData
        };

        await formCache.insertForm(largeForm);
        const retrieved = await formCache.getForm(101);
        expect(retrieved!.form_data).toBe(largeData);
      });

      it('should allow form ID 0 as a valid ID', async () => {
        const zeroForm: FormCacheInsert = {
          id: 0,
          title: 'Zero Form',
          entry_count: 1,
          is_active: true,
          form_data: JSON.stringify({ fields: [] })
        };

        await formCache.insertForm(zeroForm);
        const retrieved = await formCache.getForm(0);
        
        expect(retrieved).toBeDefined();
        expect(retrieved!.id).toBe(0);
        expect(retrieved!.title).toBe('Zero Form');
        
        // Test update with ID 0
        await formCache.updateForm(0, { title: 'Updated Zero Form' });
        const updated = await formCache.getForm(0);
        expect(updated!.title).toBe('Updated Zero Form');
        
        // Test delete with ID 0
        await formCache.deleteForm(0);
        const deleted = await formCache.getForm(0);
        expect(deleted).toBeNull();
      });
    });

    describe('API data transformation', () => {
      beforeEach(async () => {
        formCache = new FormCache(testDbPath);
        await formCache.init();
      });

      it('should convert API form data with string is_active to boolean', async () => {
        const apiForm = {
          id: '5',
          title: 'API Form',
          is_active: '1',  // API returns string
          entries: []
        };

        await formCache.insertFormFromApi(apiForm);
        const retrieved = await formCache.getForm(5);
        
        expect(retrieved).toBeDefined();
        expect(retrieved!.id).toBe(5);
        expect(retrieved!.title).toBe('API Form');
        expect(retrieved!.is_active).toBe(true);  // Should be converted to boolean
        expect(retrieved!.entry_count).toBe(0);
      });

      it('should handle inactive forms from API', async () => {
        const apiForm = {
          id: '6',
          title: 'Inactive API Form',
          is_active: '0',  // API returns "0" for inactive
          entries: [{ id: '1' }, { id: '2' }]
        };

        await formCache.insertFormFromApi(apiForm);
        const retrieved = await formCache.getForm(6);
        
        expect(retrieved).toBeDefined();
        expect(retrieved!.is_active).toBe(false);  // Should be converted to boolean false
        expect(retrieved!.entry_count).toBe(2);
      });

      it('should handle various API boolean formats', async () => {
        const testCases = [
          { is_active: '1', expected: true },
          { is_active: '0', expected: false },
          { is_active: 1, expected: true },    // numeric 1
          { is_active: 0, expected: false },   // numeric 0
          { is_active: true, expected: true }, // boolean true (edge case)
          { is_active: false, expected: false } // boolean false (edge case)
        ];

        for (let i = 0; i < testCases.length; i++) {
          const testCase = testCases[i];
          const apiForm = {
            id: (10 + i).toString(),
            title: `Test Form ${i}`,
            is_active: testCase.is_active,
            entries: []
          };

          await formCache.insertFormFromApi(apiForm);
          const retrieved = await formCache.getForm(10 + i);
          
          expect(retrieved!.is_active).toBe(testCase.expected);
        }
      });

      it('should preserve form_data as JSON string', async () => {
        const complexApiForm = {
          id: '20',
          title: 'Complex Form',
          is_active: '1',
          fields: [
            { id: 1, type: 'text', label: 'Name' },
            { id: 2, type: 'email', label: 'Email' }
          ],
          settings: {
            requireLogin: false,
            limitEntries: true
          }
        };

        await formCache.insertFormFromApi(complexApiForm);
        const retrieved = await formCache.getForm(20);
        
        expect(retrieved).toBeDefined();
        expect(retrieved!.form_data).toBeDefined();
        
        const parsedData = JSON.parse(retrieved!.form_data);
        expect(parsedData.fields).toHaveLength(2);
        expect(parsedData.settings.requireLogin).toBe(false);
      });
    });
  });

  describe('Active Forms Fetching (Step 4)', () => {
    beforeEach(async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();
    });

    describe('fetchActiveForms', () => {
      it('should fetch all active forms from API endpoint', async () => {
        // Mock API response with multiple forms
        const mockApiResponse = [
          {
            id: '1',
            title: 'Contact Form',
            is_active: '1',
            entries: []
          },
          {
            id: '2', 
            title: 'Newsletter Signup',
            is_active: '1',
            entries: []
          }
        ];

        const mockApiCall = jest.fn().mockResolvedValue(mockApiResponse);
        
        const result = await formCache.fetchActiveForms(mockApiCall);
        
        expect(mockApiCall).toHaveBeenCalledWith('/forms');
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe(1);
        expect(result[0].title).toBe('Contact Form');
        expect(result[0].is_active).toBe(true);
        expect(result[1].id).toBe(2);
        expect(result[1].title).toBe('Newsletter Signup');
        expect(result[1].is_active).toBe(true);
      });

      it('should handle empty API response', async () => {
        const mockApiCall = jest.fn().mockResolvedValue([]);
        
        const result = await formCache.fetchActiveForms(mockApiCall);
        
        expect(result).toHaveLength(0);
        expect(mockApiCall).toHaveBeenCalledWith('/forms');
      });

      it('should handle API errors gracefully', async () => {
        const mockApiCall = jest.fn().mockRejectedValue(new Error('API timeout'));
        
        await expect(formCache.fetchActiveForms(mockApiCall)).rejects.toThrow('Failed to fetch active forms: API timeout');
      });

      it('should handle network errors', async () => {
        const mockApiCall = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        
        await expect(formCache.fetchActiveForms(mockApiCall)).rejects.toThrow('Failed to fetch active forms: ECONNREFUSED');
      });

      it('should handle authentication errors', async () => {
        const mockApiCall = jest.fn().mockRejectedValue(new Error('401 Unauthorized'));
        
        await expect(formCache.fetchActiveForms(mockApiCall)).rejects.toThrow('Failed to fetch active forms: 401 Unauthorized');
      });

      it('should handle malformed API response', async () => {
        const mockApiCall = jest.fn().mockResolvedValue('invalid response');
        
        await expect(formCache.fetchActiveForms(mockApiCall)).rejects.toThrow('Invalid API response format');
      });

      it('should handle response with invalid form data', async () => {
        const mockApiResponse = [
          { id: null, title: '', is_active: '1' }, // Invalid form
          { id: '2', title: 'Valid Form', is_active: '1' } // Valid form
        ];

        const mockApiCall = jest.fn().mockResolvedValue(mockApiResponse);
        
        // Enhanced error handling should skip invalid forms and continue with valid ones
        const result = await formCache.fetchActiveForms(mockApiCall);
        
        // Should return only the valid form
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(2);
        expect(result[0].title).toBe('Valid Form');
      });
    });

    describe('transformApiForm', () => {
      it('should transform basic API form to cache record', () => {
        const apiForm = {
          id: '5',
          title: 'Test Form',
          is_active: '1',
          entries: []
        };

        const result = formCache.transformApiForm(apiForm);

        expect(result.id).toBe(5);
        expect(result.title).toBe('Test Form');
        expect(result.is_active).toBe(true);
        expect(result.entry_count).toBe(0);
        expect(result.form_data).toBe(JSON.stringify(apiForm));
      });

      it('should handle different is_active formats', () => {
        const testCases = [
          { input: '1', expected: true },
          { input: '0', expected: false },
          { input: 1, expected: true },
          { input: 0, expected: false },
          { input: true, expected: true },
          { input: false, expected: false }
        ];

        testCases.forEach((testCase, index) => {
          const apiForm = {
            id: `${index + 10}`,
            title: `Form ${index}`,
            is_active: testCase.input,
            entries: []
          };

          const result = formCache.transformApiForm(apiForm);
          expect(result.is_active).toBe(testCase.expected);
        });
      });

      it('should extract entry count from entries array', () => {
        const apiForm = {
          id: '7',
          title: 'Form with Entries',
          is_active: '1',
          entries: [{}, {}, {}] // 3 entries
        };

        const result = formCache.transformApiForm(apiForm);
        expect(result.entry_count).toBe(3);
      });

      it('should handle missing or null entries', () => {
        const testCases = [
          { entries: undefined, expected: 0 },
          { entries: null, expected: 0 },
          { entries: [], expected: 0 }
        ];

        testCases.forEach((testCase, index) => {
          const apiForm = {
            id: `${index + 20}`,
            title: `Form ${index}`,
            is_active: '1',
            entries: testCase.entries
          };

          const result = formCache.transformApiForm(apiForm);
          expect(result.entry_count).toBe(testCase.expected);
        });
      });

      it('should handle missing or empty title', () => {
        const testCases = [
          { title: undefined, expected: '' },
          { title: null, expected: '' },
          { title: '', expected: '' },
          { title: 'Valid Title', expected: 'Valid Title' }
        ];

        testCases.forEach((testCase, index) => {
          const apiForm = {
            id: `${index + 30}`,
            title: testCase.title,
            is_active: '1',
            entries: []
          };

          const result = formCache.transformApiForm(apiForm);
          expect(result.title).toBe(testCase.expected);
        });
      });
    });

    describe('validateApiResponse', () => {
      it('should validate correct API response array', () => {
        const validResponse = [
          { id: '1', title: 'Form 1', is_active: '1' },
          { id: '2', title: 'Form 2', is_active: '0' }
        ];

        expect(formCache.validateApiResponse(validResponse)).toBe(true);
      });

      it('should reject non-array responses', () => {
        const invalidResponses = [
          'string response',
          123,
          { id: '1', title: 'Single Form' },
          null,
          undefined
        ];

        invalidResponses.forEach(response => {
          expect(formCache.validateApiResponse(response)).toBe(false);
        });
      });

      it('should reject array with invalid form objects', () => {
        const invalidResponses = [
          [{ title: 'Missing ID' }],
          [{ id: '', title: 'Empty ID' }],
          [{ id: '1' }], // Missing title
          ['string instead of object']
        ];

        invalidResponses.forEach(response => {
          expect(formCache.validateApiResponse(response)).toBe(false);
        });
      });

      it('should accept empty array', () => {
        expect(formCache.validateApiResponse([])).toBe(true);
      });
    });

    describe('extractFormMetadata', () => {
      it('should extract basic form metadata', () => {
        const form = {
          id: '15',
          title: 'Registration Form',
          is_active: '1',
          date_created: '2024-01-15 10:30:00',
          entries: [{}, {}]
        };

        const result = formCache.extractFormMetadata(form);

        expect(result.id).toBe(15);
        expect(result.title).toBe('Registration Form');
        expect(result.is_active).toBe(true);
        expect(result.entry_count).toBe(2);
      });

      it('should handle forms with complex structures', () => {
        const complexForm = {
          id: '25',
          title: 'Complex Form',
          is_active: '0',
          fields: [
            { id: 1, type: 'text' },
            { id: 2, type: 'email' }
          ],
          settings: {
            confirmations: [],
            notifications: []
          },
          entries: []
        };

        const result = formCache.extractFormMetadata(complexForm);

        expect(result.id).toBe(25);
        expect(result.title).toBe('Complex Form');
        expect(result.is_active).toBe(false);
        expect(result.entry_count).toBe(0);
      });

      it('should throw error for invalid form IDs', () => {
        const invalidForms = [
          { id: 'abc', title: 'Invalid ID' },
          { id: 'not-a-number', title: 'Invalid ID' },
          { id: '', title: 'Empty ID' },
          { id: undefined, title: 'Undefined ID' }
        ];

        invalidForms.forEach(form => {
          expect(() => formCache.extractFormMetadata(form)).toThrow('Invalid form ID');
        });
      });
    });
  });

  describe('ID Gap Detection (Step 5)', () => {
    beforeEach(async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();
    });

    describe('findIdGaps', () => {
      it('should find gaps in ID sequences', () => {
        const testCases = [
          { input: [1, 2, 4, 7], expected: [3, 5, 6] },
          { input: [1, 3, 5], expected: [2, 4] },
          { input: [2, 4, 6, 8], expected: [1, 3, 5, 7] },
          { input: [1, 10], expected: [2, 3, 4, 5, 6, 7, 8, 9] }
        ];

        testCases.forEach(({ input, expected }) => {
          const result = formCache.findIdGaps(input);
          expect(result).toEqual(expected);
        });
      });

      it('should handle edge cases', () => {
        // Empty array
        expect(formCache.findIdGaps([])).toEqual([]);
        
        // Single element
        expect(formCache.findIdGaps([5])).toEqual([1, 2, 3, 4]);
        
        // No gaps
        expect(formCache.findIdGaps([1, 2, 3, 4])).toEqual([]);
        
        // Starting from 1
        expect(formCache.findIdGaps([1, 2, 3])).toEqual([]);
      });

      it('should handle unsorted input arrays', () => {
        const unsorted = [7, 2, 4, 1];
        const result = formCache.findIdGaps(unsorted);
        expect(result).toEqual([3, 5, 6]);
      });

      it('should handle duplicate IDs', () => {
        const withDuplicates = [1, 2, 2, 4, 4, 7];
        const result = formCache.findIdGaps(withDuplicates);
        expect(result).toEqual([3, 5, 6]);
      });

      it('should work efficiently with large ID ranges', () => {
        const largeArray = [1, 500, 1000];
        const result = formCache.findIdGaps(largeArray);
        
        // Should find gaps efficiently without creating huge arrays
        expect(result).toHaveLength(997); // 1000 - 3 = 997 missing IDs
        expect(result[0]).toBe(2);
        expect(result[result.length - 1]).toBe(999);
      });

      it('should handle invalid inputs gracefully', () => {
        const invalidInputs = [
          [-1, 2, 3], // negative numbers
          [0, 1, 2], // zero
          [1.5, 2, 3] // non-integers
        ];

        invalidInputs.forEach(input => {
          expect(() => formCache.findIdGaps(input)).toThrow('Invalid form IDs');
        });
      });
    });

    describe('getMaxFormId', () => {
      it('should return maximum form ID from cache', async () => {
        // Insert test forms
        await formCache.insertForm({ id: 1, title: 'Form 1' });
        await formCache.insertForm({ id: 5, title: 'Form 5' });
        await formCache.insertForm({ id: 3, title: 'Form 3' });

        const maxId = await formCache.getMaxFormId();
        expect(maxId).toBe(5);
      });

      it('should return 0 when no forms exist', async () => {
        const maxId = await formCache.getMaxFormId();
        expect(maxId).toBe(0);
      });
    });

    describe('getExistingFormIds', () => {
      it('should return all form IDs from cache', async () => {
        // Insert test forms
        await formCache.insertForm({ id: 1, title: 'Form 1' });
        await formCache.insertForm({ id: 5, title: 'Form 5' });
        await formCache.insertForm({ id: 3, title: 'Form 3' });

        const ids = await formCache.getExistingFormIds();
        expect(ids.sort()).toEqual([1, 3, 5]);
      });

      it('should return empty array when no forms exist', async () => {
        const ids = await formCache.getExistingFormIds();
        expect(ids).toEqual([]);
      });

      it('should include both active and inactive forms', async () => {
        await formCache.insertForm({ id: 1, title: 'Active Form', is_active: true });
        await formCache.insertForm({ id: 2, title: 'Inactive Form', is_active: false });

        const ids = await formCache.getExistingFormIds();
        expect(ids.sort()).toEqual([1, 2]);
      });
    });

    describe('generateProbeList', () => {
      it('should generate probe list from active form IDs', () => {
        const activeIds = [1, 2, 4, 7, 10];
        const probeList = formCache.generateProbeList(activeIds);
        
        // Should return missing IDs from 1 to max active ID
        expect(probeList).toEqual([3, 5, 6, 8, 9]);
      });

      it('should handle empty active IDs', () => {
        const probeList = formCache.generateProbeList([]);
        expect(probeList).toEqual([]);
      });

      it('should handle continuous sequence (no gaps)', () => {
        const activeIds = [1, 2, 3, 4, 5];
        const probeList = formCache.generateProbeList(activeIds);
        expect(probeList).toEqual([]);
      });

      it('should work with unsorted active IDs', () => {
        const activeIds = [7, 2, 4, 1, 10];
        const probeList = formCache.generateProbeList(activeIds);
        expect(probeList).toEqual([3, 5, 6, 8, 9]);
      });

      it('should handle large gaps efficiently', () => {
        const activeIds = [1, 1000];
        const probeList = formCache.generateProbeList(activeIds);
        
        expect(probeList).toHaveLength(998);
        expect(probeList[0]).toBe(2);
        expect(probeList[probeList.length - 1]).toBe(999);
      });
    });

    describe('gap detection integration', () => {
      it('should work end-to-end with cached forms', async () => {
        // Insert some forms with gaps
        await formCache.insertForm({ id: 1, title: 'Form 1' });
        await formCache.insertForm({ id: 3, title: 'Form 3' });
        await formCache.insertForm({ id: 7, title: 'Form 7' });

        const existingIds = await formCache.getExistingFormIds();
        const gaps = formCache.findIdGaps(existingIds);
        
        expect(gaps).toEqual([2, 4, 5, 6]);
      });

      it('should handle mixed active/inactive forms', async () => {
        await formCache.insertForm({ id: 1, title: 'Active Form', is_active: true });
        await formCache.insertForm({ id: 2, title: 'Inactive Form', is_active: false });
        await formCache.insertForm({ id: 5, title: 'Another Active', is_active: true });

        const existingIds = await formCache.getExistingFormIds();
        const gaps = formCache.findIdGaps(existingIds);
        
        expect(gaps).toEqual([3, 4]);
      });
    });
  });

  describe('Individual Form Probing (Step 6)', () => {
    beforeEach(async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();
    });

    describe('probeFormById', () => {
      it('should successfully probe and find an inactive form', async () => {
        const mockApiResponse = {
          id: '15',
          title: 'Inactive Form',
          is_active: '0',
          entries: []
        };

        const mockApiCall = jest.fn().mockResolvedValue(mockApiResponse);
        
        const result = await formCache.probeFormById(15, mockApiCall);
        
        expect(mockApiCall).toHaveBeenCalledWith('/forms/15');
        expect(result.found).toBe(true);
        expect(result.id).toBe(15);
        expect(result.form).toBeDefined();
        expect(result.form!.title).toBe('Inactive Form');
        expect(result.form!.is_active).toBe(false);
        expect(result.error).toBeUndefined();
      });

      it('should handle 404 response (form not found)', async () => {
        const mockApiCall = jest.fn().mockRejectedValue(new Error('404 Not Found'));
        
        const result = await formCache.probeFormById(99, mockApiCall);
        
        expect(result.found).toBe(false);
        expect(result.id).toBe(99);
        expect(result.form).toBeUndefined();
        expect(result.error).toBe('404 Not Found');
      });

      it('should handle API errors (500, auth, timeout)', async () => {
        const errorScenarios = [
          { error: new Error('500 Internal Server Error'), expected: '500 Internal Server Error' },
          { error: new Error('401 Unauthorized'), expected: '401 Unauthorized' },
          { error: new Error('ETIMEDOUT'), expected: 'ETIMEDOUT' }
        ];

        for (const scenario of errorScenarios) {
          const mockApiCall = jest.fn().mockRejectedValue(scenario.error);
          
          const result = await formCache.probeFormById(50, mockApiCall);
          
          expect(result.found).toBe(false);
          expect(result.id).toBe(50);
          expect(result.error).toBe(scenario.expected);
        }
      });

      it('should validate form ID parameter', async () => {
        const mockApiCall = jest.fn();

        await expect(formCache.probeFormById(-1, mockApiCall)).rejects.toThrow('Invalid form ID');
        await expect(formCache.probeFormById(0, mockApiCall)).rejects.toThrow('Invalid form ID');
        await expect(formCache.probeFormById(1.5, mockApiCall)).rejects.toThrow('Invalid form ID');
      });

      it('should handle malformed API response', async () => {
        const mockApiCall = jest.fn().mockResolvedValue('invalid response');
        
        const result = await formCache.probeFormById(20, mockApiCall);
        
        expect(result.found).toBe(false);
        expect(result.error).toContain('Invalid form data');
      });
    });

    describe('probeBatch', () => {
      it('should probe multiple form IDs', async () => {
        const mockResponses = new Map([
          ['/forms/10', { id: '10', title: 'Form 10', is_active: '0' }],
          ['/forms/11', null], // 404 case
          ['/forms/12', { id: '12', title: 'Form 12', is_active: '1' }]
        ]);

        const mockApiCall = jest.fn().mockImplementation(async (endpoint) => {
          const response = mockResponses.get(endpoint);
          if (response === null) {
            throw new Error('404 Not Found');
          }
          return response;
        });

        const results = await formCache.probeBatch([10, 11, 12], mockApiCall);
        
        expect(results).toHaveLength(3);
        
        // Form 10 - found inactive
        expect(results[0].found).toBe(true);
        expect(results[0].id).toBe(10);
        expect(results[0].form!.is_active).toBe(false);
        
        // Form 11 - not found
        expect(results[1].found).toBe(false);
        expect(results[1].id).toBe(11);
        expect(results[1].error).toBe('404 Not Found');
        
        // Form 12 - found active
        expect(results[2].found).toBe(true);
        expect(results[2].id).toBe(12);
        expect(results[2].form!.is_active).toBe(true);
      });

      it('should handle empty ID list', async () => {
        const mockApiCall = jest.fn();
        
        const results = await formCache.probeBatch([], mockApiCall);
        
        expect(results).toEqual([]);
        expect(mockApiCall).not.toHaveBeenCalled();
      });

      it('should include delay between requests for rate limiting', async () => {
        const mockApiCall = jest.fn().mockResolvedValue({ id: '1', title: 'Test' });
        const startTime = Date.now();
        
        await formCache.probeBatch([1, 2], mockApiCall);
        
        const duration = Date.now() - startTime;
        expect(duration).toBeGreaterThanOrEqual(90); // Should have at least ~100ms delay between requests
      });

      it('should validate all form IDs', async () => {
        const mockApiCall = jest.fn();

        await expect(formCache.probeBatch([-1, 2, 3], mockApiCall)).rejects.toThrow('Invalid form ID');
        await expect(formCache.probeBatch([1, 0, 3], mockApiCall)).rejects.toThrow('Invalid form ID');
      });
    });

    describe('probeWithRetry', () => {
      it('should retry on transient failures and succeed', async () => {
        let callCount = 0;
        const mockApiCall = jest.fn().mockImplementation(async () => {
          callCount++;
          if (callCount < 3) {
            throw new Error('ETIMEDOUT');
          }
          return { id: '25', title: 'Retry Success', is_active: '0' };
        });

        const result = await formCache.probeWithRetry(25, mockApiCall, 3);
        
        expect(callCount).toBe(3);
        expect(result.found).toBe(true);
        expect(result.form!.title).toBe('Retry Success');
      });

      it('should fail after max retries exhausted', async () => {
        const mockApiCall = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

        const result = await formCache.probeWithRetry(30, mockApiCall, 2);
        
        expect(mockApiCall).toHaveBeenCalledTimes(3); // initial + 2 retries
        expect(result.found).toBe(false);
        expect(result.error).toBe('ECONNREFUSED');
      });

      it('should not retry on 404 errors (form definitely does not exist)', async () => {
        const mockApiCall = jest.fn().mockRejectedValue(new Error('404 Not Found'));

        const result = await formCache.probeWithRetry(35, mockApiCall, 3);
        
        expect(mockApiCall).toHaveBeenCalledTimes(1); // No retries for 404
        expect(result.found).toBe(false);
        expect(result.error).toBe('404 Not Found');
      });

      it('should implement exponential backoff', async () => {
        let callCount = 0;
        const callTimes: number[] = [];
        
        const mockApiCall = jest.fn().mockImplementation(async () => {
          callTimes.push(Date.now());
          callCount++;
          if (callCount <= 2) {
            throw new Error('ETIMEDOUT');
          }
          return { id: '40', title: 'Backoff Test' };
        });

        const startTime = Date.now();
        await formCache.probeWithRetry(40, mockApiCall, 2);
        
        // Check exponential backoff timing
        if (callTimes.length >= 2) {
          const delay1 = callTimes[1] - callTimes[0];
          const delay2 = callTimes[2] - callTimes[1];
          
          expect(delay1).toBeGreaterThanOrEqual(100); // First retry ~100ms
          expect(delay2).toBeGreaterThanOrEqual(180); // Second retry ~200ms (exponential)
        }
      });

      it('should validate retry parameters', async () => {
        const mockApiCall = jest.fn();

        await expect(formCache.probeWithRetry(5, mockApiCall, -1)).rejects.toThrow('Invalid retry count');
        await expect(formCache.probeWithRetry(5, mockApiCall, 10)).rejects.toThrow('Max retries too high');
      });
    });

    describe('probe statistics and rate limiting', () => {
      it('should track probe statistics during batch operations', async () => {
        const mockApiCall = jest.fn()
          .mockResolvedValueOnce({ id: '1', title: 'Found' })
          .mockRejectedValueOnce(new Error('404 Not Found'))
          .mockRejectedValueOnce(new Error('500 Server Error'));

        await formCache.probeBatch([1, 2, 3], mockApiCall);
        
        const stats = formCache.getLastProbeStats();
        expect(stats.attempted).toBe(3);
        expect(stats.found).toBe(1);
        expect(stats.failed).toBe(2);
        expect(stats.errors).toContain('404 Not Found');
        expect(stats.errors).toContain('500 Server Error');
      });

      it('should implement circuit breaker for repeated failures', async () => {
        const mockApiCall = jest.fn().mockRejectedValue(new Error('500 Server Error'));

        // Simulate many failures to trigger circuit breaker
        const results = await formCache.probeBatch([1, 2, 3, 4, 5, 6], mockApiCall);
        
        // Circuit breaker should kick in after several consecutive failures
        const failedResults = results.filter(r => !r.found);
        const circuitBreakerErrors = failedResults.filter(r => r.error?.includes('Circuit breaker'));
        
        expect(circuitBreakerErrors.length).toBeGreaterThan(0);
      });

      it('should reset circuit breaker after successful probe', async () => {
        let callCount = 0;
        const mockApiCall = jest.fn().mockImplementation(async () => {
          callCount++;
          if (callCount <= 3) {
            throw new Error('500 Server Error');
          }
          return { id: callCount.toString(), title: 'Success' };
        });

        await formCache.probeBatch([1, 2, 3, 4, 5], mockApiCall);
        
        // Should reset circuit breaker after success and continue probing
        expect(callCount).toBe(5);
      });
    });

    describe('integration with existing cache', () => {
      it('should automatically cache discovered forms', async () => {
        const mockApiResponse = {
          id: '50',
          title: 'Auto Cached Form',
          is_active: '0',
          entries: []
        };

        const mockApiCall = jest.fn().mockResolvedValue(mockApiResponse);
        
        const result = await formCache.probeFormById(50, mockApiCall);
        
        expect(result.found).toBe(true);
        
        // Verify form was cached
        const cachedForm = await formCache.getForm(50);
        expect(cachedForm).toBeDefined();
        expect(cachedForm!.title).toBe('Auto Cached Form');
        expect(cachedForm!.is_active).toBe(false);
      });

      it('should handle probe results with existing cache entries', async () => {
        // Pre-cache a form
        await formCache.insertForm({ id: 60, title: 'Existing Form', is_active: true });

        const mockApiCall = jest.fn().mockResolvedValue({
          id: '60',
          title: 'Updated Form',
          is_active: '0'
        });

        const result = await formCache.probeFormById(60, mockApiCall);
        
        expect(result.found).toBe(true);
        
        // Should update the existing cache entry
        const updatedForm = await formCache.getForm(60);
        expect(updatedForm!.title).toBe('Updated Form');
        expect(updatedForm!.is_active).toBe(false);
      });
    });
  });

  // =====================================
  // Step 7: Probe Beyond Max Logic Tests
  // =====================================

  describe('Step 7: Probe Beyond Max Logic', () => {
    beforeEach(async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();
    });

    describe('probeBeyondMax', () => {
      it('should probe IDs beyond max active ID until consecutive failures', async () => {
        // Mock API that returns forms for IDs 11, 13, but not 12, 14, 15, 16+
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          const id = endpoint.split('/').pop();
          
          if (id === '11') {
            return { id: '11', title: 'Hidden Form 11', is_active: '0' };
          }
          if (id === '13') {
            return { id: '13', title: 'Hidden Form 13', is_active: '0' };
          }
          
          // All other IDs fail
          throw new Error('404 Form not found');
        });

        const results = await formCache.probeBeyondMax(11, mockApiCall);
        
        // Should find forms 11 and 13, then stop after consecutive failures
        const foundResults = results.filter(r => r.found);
        const notFoundResults = results.filter(r => !r.found);
        
        expect(foundResults).toHaveLength(2);
        expect(foundResults[0].id).toBe(11);
        expect(foundResults[1].id).toBe(13);
        
        // Should have stopped after default 10 consecutive failures
        expect(notFoundResults.length).toBeGreaterThanOrEqual(10);
        
        // Verify forms were cached
        const cachedForm11 = await formCache.getForm(11);
        const cachedForm13 = await formCache.getForm(13);
        expect(cachedForm11?.title).toBe('Hidden Form 11');
        expect(cachedForm13?.title).toBe('Hidden Form 13');
      });

      it('should respect custom consecutive failure threshold', async () => {
        const mockApiCall = jest.fn().mockRejectedValue(new Error('404 Not Found'));
        
        // Should stop after 3 consecutive failures
        const results = await formCache.probeBeyondMax(100, mockApiCall, { consecutiveFailureThreshold: 3 });
        
        expect(results).toHaveLength(3);
        expect(results.every(r => !r.found)).toBe(true);
        expect(mockApiCall).toHaveBeenCalledTimes(3);
      });

      it('should respect maximum probe limit', async () => {
        const mockApiCall = jest.fn().mockRejectedValue(new Error('404 Not Found'));
        
        // Should stop at probe limit even without consecutive failures
        const results = await formCache.probeBeyondMax(100, mockApiCall, { 
          consecutiveFailureThreshold: 20, 
          maxProbeLimit: 5 
        });
        
        expect(results).toHaveLength(5);
        expect(mockApiCall).toHaveBeenCalledTimes(5);
      });

      it('should include progress tracking and call onProgress callback', async () => {
        const mockApiCall = jest.fn()
          .mockResolvedValueOnce({ id: '50', title: 'Form 50' })
          .mockRejectedValueOnce(new Error('404'))
          .mockRejectedValueOnce(new Error('404'))
          .mockRejectedValueOnce(new Error('404'));

        const progressUpdates: any[] = [];
        const onProgress = jest.fn((progress) => progressUpdates.push(progress));
        
        await formCache.probeBeyondMax(50, mockApiCall, { 
          consecutiveFailureThreshold: 3,
          onProgress 
        });
        
        expect(onProgress).toHaveBeenCalled();
        expect(progressUpdates.length).toBeGreaterThan(0);
        
        // Verify progress structure
        const lastProgress = progressUpdates[progressUpdates.length - 1];
        expect(lastProgress).toHaveProperty('phase');
        expect(lastProgress).toHaveProperty('current');
        expect(lastProgress).toHaveProperty('found');
      });

      it('should handle API rate limiting with delays', async () => {
        const mockApiCall = jest.fn().mockRejectedValue(new Error('404 Not Found'));
        const startTime = Date.now();
        
        await formCache.probeBeyondMax(100, mockApiCall, { 
          consecutiveFailureThreshold: 3,
          probeDelayMs: 50 
        });
        
        const elapsed = Date.now() - startTime;
        // Should have delays between calls: 3 calls = 2 delays = ~100ms minimum
        expect(elapsed).toBeGreaterThanOrEqual(90);
      });

      it('should reset consecutive failure count when form is found', async () => {
        // Mock that finds forms intermittently but never has 10 consecutive failures
        let callCount = 0;
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          callCount++;
          const id = parseInt(endpoint.split('/').pop()!);
          
          // Find a form every 4th attempt to reset consecutive failures (optimized for speed)
          if (callCount % 4 === 0) {
            return { id: id.toString(), title: `Form ${id}` };
          }
          
          throw new Error('404 Not Found');
        });

        const results = await formCache.probeBeyondMax(100, mockApiCall, { 
          consecutiveFailureThreshold: 10,
          maxProbeLimit: 16, // Reduced for speed: 4 successful calls + 12 failures
          probeDelayMs: 10 // Reduced delay for speed
        });
        
        // Should probe all 16 (limited by maxProbeLimit) because consecutive failures keep resetting
        expect(results).toHaveLength(16);
        const foundForms = results.filter(r => r.found);
        expect(foundForms).toHaveLength(4); // Every 4th call succeeds
      });

      it('should validate startId parameter', async () => {
        const mockApiCall = jest.fn();
        
        await expect(formCache.probeBeyondMax(0, mockApiCall)).rejects.toThrow('Invalid start ID');
        await expect(formCache.probeBeyondMax(-1, mockApiCall)).rejects.toThrow('Invalid start ID');
        await expect(formCache.probeBeyondMax(1.5, mockApiCall)).rejects.toThrow('Invalid start ID');
      });
    });

    describe('findHighestFormId', () => {
      it('should find highest form ID by probing', async () => {
        // Mock API that has forms up to ID 25
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          const id = parseInt(endpoint.split('/').pop()!);
          
          if (id <= 25) {
            return { id: id.toString(), title: `Form ${id}` };
          }
          
          throw new Error('404 Not Found');
        });

        const highestId = await formCache.findHighestFormId(mockApiCall);
        
        expect(highestId).toBe(25);
      });

      it('should handle case where no forms exist beyond start ID', async () => {
        const mockApiCall = jest.fn().mockRejectedValue(new Error('404 Not Found'));
        
        const highestId = await formCache.findHighestFormId(mockApiCall, 100);
        
        expect(highestId).toBe(0); // No forms found
      });

      it('should use reasonable starting point when not provided', async () => {
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          const id = parseInt(endpoint.split('/').pop()!);
          
          // Only form 1 exists
          if (id === 1) {
            return { id: '1', title: 'Form 1' };
          }
          
          throw new Error('404 Not Found');
        });

        const highestId = await formCache.findHighestFormId(mockApiCall);
        
        expect(highestId).toBe(1);
        // Should have started from a reasonable point (likely 1)
        expect(mockApiCall).toHaveBeenCalledWith('/forms/1');
      });
    });

    describe('isConsecutiveFailure', () => {
      it('should detect consecutive failures at end of results', async () => {
        const results = [
          { id: 1, found: true },
          { id: 2, found: false },
          { id: 3, found: false },
          { id: 4, found: false }
        ];
        
        expect(formCache.isConsecutiveFailure(results, 3)).toBe(true);
        expect(formCache.isConsecutiveFailure(results, 4)).toBe(false);
      });

      it('should not trigger when failures are not consecutive', async () => {
        const results = [
          { id: 1, found: false },
          { id: 2, found: true },
          { id: 3, found: false },
          { id: 4, found: false }
        ];
        
        expect(formCache.isConsecutiveFailure(results, 2)).toBe(true);
        expect(formCache.isConsecutiveFailure(results, 3)).toBe(false);
      });

      it('should handle empty results array', async () => {
        expect(formCache.isConsecutiveFailure([], 5)).toBe(false);
      });

      it('should handle threshold larger than results array', async () => {
        const results = [
          { id: 1, found: false },
          { id: 2, found: false }
        ];
        
        expect(formCache.isConsecutiveFailure(results, 5)).toBe(false);
      });

      it('should validate threshold parameter', async () => {
        const results = [{ id: 1, found: false }];
        
        expect(() => formCache.isConsecutiveFailure(results, 0)).toThrow('Invalid threshold');
        expect(() => formCache.isConsecutiveFailure(results, -1)).toThrow('Invalid threshold');
      });
    });

    describe('beyond-max integration scenarios', () => {
      it('should work with empty cache (fresh start)', async () => {
        const mockApiCall = jest.fn()
          .mockResolvedValueOnce({ id: '100', title: 'Form 100' })
          .mockRejectedValue(new Error('404 Not Found'));

        const results = await formCache.probeBeyondMax(100, mockApiCall, { consecutiveFailureThreshold: 2 });
        
        expect(results[0].found).toBe(true);
        expect(results[0].id).toBe(100);
        
        // Verify form was cached even with empty initial cache
        const cachedForm = await formCache.getForm(100);
        expect(cachedForm?.title).toBe('Form 100');
      });

      it('should handle mixed success/failure patterns realistically', async () => {
        // Realistic scenario: forms exist sporadically in higher ID ranges
        const existingFormIds = [100, 102, 107, 110];
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          const id = parseInt(endpoint.split('/').pop()!);
          
          if (existingFormIds.includes(id)) {
            return { id: id.toString(), title: `Form ${id}`, is_active: '0' };
          }
          
          throw new Error('404 Not Found');
        });

        const results = await formCache.probeBeyondMax(100, mockApiCall, { 
          consecutiveFailureThreshold: 5,
          maxProbeLimit: 20 
        });
        
        const foundResults = results.filter(r => r.found);
        expect(foundResults).toHaveLength(4);
        expect(foundResults.map(r => r.id).sort()).toEqual([100, 102, 107, 110]);
      });

      it('should stop after consecutive failures before reaching maxProbeLimit', async () => {
        // Mock that always fails to trigger consecutive failure threshold
        const mockApiCall = jest.fn().mockRejectedValue(new Error('500 Server Error'));

        const results = await formCache.probeBeyondMax(200, mockApiCall, { 
          consecutiveFailureThreshold: 5, // Lower threshold for faster test
          maxProbeLimit: 20
        });
        
        // Should stop due to consecutive failures before reaching maxProbeLimit
        expect(results).toHaveLength(5); // Exactly the consecutive failure threshold
        expect(results.every(r => !r.found)).toBe(true); // All should be failures
        expect(results.every(r => r.error?.includes('500 Server Error'))).toBe(true);
      });
    });
  });

  // =====================================
  // Step 8: Full Discovery Workflow Tests
  // =====================================
  
  describe('Step 8: Full Discovery Workflow', () => {
    beforeEach(async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();
    });

    describe('syncAllForms - complete discovery workflow', () => {
      it('should execute complete discovery process end-to-end', async () => {
        // Mock API with:
        // - Active forms: 1, 3, 5 (API returns these)
        // - Inactive forms: 2, 4 (found during gap probing)
        // - Beyond-max forms: 7, 10 (found during beyond-max probing)
        
        const activeFormsResponse = [
          { id: '1', title: 'Active Form 1', is_active: '1', entries: [] },
          { id: '3', title: 'Active Form 3', is_active: '1', entries: [] },
          { id: '5', title: 'Active Form 5', is_active: '1', entries: [] }
        ];
        
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          if (endpoint === '/forms') {
            return activeFormsResponse;
          }
          
          const id = parseInt(endpoint.split('/').pop()!);
          
          // Gap probing - find forms 2, 4
          if (id === 2) return { id: '2', title: 'Hidden Form 2', is_active: '0', entries: [] };
          if (id === 4) return { id: '4', title: 'Hidden Form 4', is_active: '0', entries: [] };
          
          // Beyond-max probing - find forms 7, 10
          if (id === 7) return { id: '7', title: 'Hidden Form 7', is_active: '0', entries: [] };
          if (id === 10) return { id: '10', title: 'Hidden Form 10', is_active: '0', entries: [] };
          
          // All others not found
          throw new Error('404 Not Found');
        });

        // Track progress updates
        const progressUpdates: any[] = [];
        const onProgress = (status: any) => progressUpdates.push(status);

        const startTime = Date.now();
        const result = await formCache.syncAllForms(mockApiCall, { onProgress });
        const endTime = Date.now();
        
        // Verify sync result
        expect(result.discovered).toBe(7); // 3 active + 2 gap + 2 beyond-max
        expect(result.updated).toBe(0); // All new forms
        expect(result.errors).toEqual([]);
        expect(result.duration).toBeGreaterThan(0);
        expect(result.lastSyncTime.getTime()).toBeCloseTo(endTime, -2);
        
        // Verify all forms were cached
        const allCachedForms = await formCache.getAllForms();
        expect(allCachedForms).toHaveLength(7);
        
        const formIds = allCachedForms.map(f => f.id).sort((a, b) => a - b);
        expect(formIds).toEqual([1, 2, 3, 4, 5, 7, 10]);
        
        // Verify progress tracking occurred
        expect(progressUpdates.length).toBeGreaterThan(0);
        expect(progressUpdates.some(p => p.phase === 'fetching-active-forms')).toBe(true);
        expect(progressUpdates.some(p => p.phase === 'probing-gaps')).toBe(true);
        expect(progressUpdates.some(p => p.phase === 'beyond-max-probing')).toBe(true);
        expect(progressUpdates.some(p => p.phase === 'completed')).toBe(true);
      });

      it('should handle partial failures gracefully', async () => {
        const activeFormsResponse = [
          { id: '1', title: 'Active Form 1', is_active: '1', entries: [] }
        ];
        
        let apiCallCount = 0;
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          apiCallCount++;
          
          if (endpoint === '/forms') {
            return activeFormsResponse;
          }
          
          const id = parseInt(endpoint.split('/').pop()!);
          
          // Simulate intermittent failures
          if (apiCallCount % 3 === 0) {
            throw new Error('500 Server Error');
          }
          
          if (id === 2) return { id: '2', title: 'Form 2', is_active: '0' };
          
          throw new Error('404 Not Found');
        });

        const result = await formCache.syncAllForms(mockApiCall, { maxProbeFailures: 3 });
        
        // Should succeed with partial data
        expect(result.discovered).toBeGreaterThanOrEqual(1); // At least the active form
        expect(result.errors.length).toBeGreaterThan(0); // Should have some errors
        expect(result.errors.some(e => e.includes('500 Server Error'))).toBe(true);
        
        // Verify active forms were still cached despite probe failures
        const cachedForm = await formCache.getForm(1);
        expect(cachedForm).toBeDefined();
        expect(cachedForm!.title).toBe('Active Form 1');
      });

      it('should maintain data consistency during sync process', async () => {
        // Pre-populate cache with existing data
        await formCache.insertForm({ id: 1, title: 'Old Form 1', is_active: true });
        await formCache.insertForm({ id: 99, title: 'Stale Form 99', is_active: false });
        
        const activeFormsResponse = [
          { id: '1', title: 'Updated Form 1', is_active: '1', entry_count: 5 }
        ];
        
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          if (endpoint === '/forms') {
            return activeFormsResponse;
          }
          
          throw new Error('404 Not Found');
        });

        const result = await formCache.syncAllForms(mockApiCall, { forceFullSync: true });
        
        // Verify existing form was updated
        const updatedForm = await formCache.getForm(1);
        expect(updatedForm!.title).toBe('Updated Form 1');
        expect(updatedForm!.entry_count).toBe(5);
        
        // Verify stale form still exists (no cleanup in basic sync)
        const staleForm = await formCache.getForm(99);
        expect(staleForm).toBeDefined();
        expect(staleForm!.title).toBe('Stale Form 99');
        
        expect(result.updated).toBe(1); // One form updated
        expect(result.discovered).toBe(1); // One total form processed
      });

      it('should support force full sync option', async () => {
        // Pre-populate with recent data (fresh cache)
        await formCache.insertForm({ 
          id: 1, 
          title: 'Recent Form', 
          is_active: true
        });
        
        const activeFormsResponse = [
          { id: '1', title: 'Force Updated Form', is_active: '1' }
        ];
        
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          if (endpoint === '/forms') {
            return activeFormsResponse;
          }
          throw new Error('404 Not Found');
        });

        // Force full sync should update even recent cache
        const result = await formCache.syncAllForms(mockApiCall, { forceFullSync: true });
        
        expect(result.discovered).toBe(1);
        expect(result.updated).toBe(1); // Should update the existing form due to force flag
        
        const updatedForm = await formCache.getForm(1);
        expect(updatedForm!.title).toBe('Force Updated Form');
      });

      it('should skip updates for fresh cache when forceFullSync is false', async () => {
        // Pre-populate with very recent data
        await formCache.insertForm({ 
          id: 1, 
          title: 'Fresh Cache Form', 
          is_active: true
        });
        
        const activeFormsResponse = [
          { id: '1', title: 'API Form Title', is_active: '1' }
        ];
        
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          if (endpoint === '/forms') {
            return activeFormsResponse;
          }
          throw new Error('404 Not Found');
        });

        // Normal sync should skip fresh cache entries
        const result = await formCache.syncAllForms(mockApiCall, { forceFullSync: false });
        
        expect(result.discovered).toBe(1);
        expect(result.updated).toBe(0); // Should NOT update fresh cache
        
        const cachedForm = await formCache.getForm(1);
        expect(cachedForm!.title).toBe('Fresh Cache Form'); // Original title preserved
      });

      it('should handle configuration options correctly', async () => {
        const activeFormsResponse: any[] = [];
        
        let probeAttempts = 0;
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          if (endpoint === '/forms') {
            return activeFormsResponse;
          }
          
          probeAttempts++;
          throw new Error('500 Server Error');
        });

        // Test with reduced max probe failures
        const result = await formCache.syncAllForms(mockApiCall, { maxProbeFailures: 2 });
        
        // Should stop probing early due to reduced failure threshold
        expect(probeAttempts).toBeLessThan(10); // Default would try more
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    describe('performInitialSync', () => {
      it('should perform first-time sync with mixed active/inactive forms', async () => {
        const activeFormsResponse = [
          { id: '1', title: 'Active Form 1', is_active: '1' },
          { id: '5', title: 'Active Form 5', is_active: '1' }
        ];
        
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          if (endpoint === '/forms') {
            return activeFormsResponse;
          }
          
          const id = parseInt(endpoint.split('/').pop()!);
          
          // Fill some gaps
          if (id === 2) return { id: '2', title: 'Hidden Form 2', is_active: '0' };
          if (id === 3) return { id: '3', title: 'Hidden Form 3', is_active: '0' };
          
          throw new Error('404 Not Found');
        });

        const result = await formCache.performInitialSync(mockApiCall);
        
        expect(result.discovered).toBeGreaterThanOrEqual(4); // 2 active + 2 inactive
        
        const allForms = await formCache.getAllForms();
        expect(allForms.length).toBeGreaterThanOrEqual(4);
        
        // Verify mix of active and inactive
        const activeForms = allForms.filter(f => f.is_active);
        const inactiveForms = allForms.filter(f => !f.is_active);
        expect(activeForms).toHaveLength(2);
        expect(inactiveForms.length).toBeGreaterThanOrEqual(2);
      });

      it('should handle empty initial state (no existing forms)', async () => {
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          if (endpoint === '/forms') {
            return []; // No active forms
          }
          throw new Error('404 Not Found');
        });

        const result = await formCache.performInitialSync(mockApiCall);
        
        expect(result.discovered).toBe(0);
        expect(result.errors).toEqual([]);
        
        const allForms = await formCache.getAllForms();
        expect(allForms).toHaveLength(0);
      });
    });

    describe('performIncrementalSync', () => {
      it('should find only new forms since last sync', async () => {
        // Pre-populate cache with older data (2 hours ago to trigger update)
        const oldTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
        await formCache.insertForm({ 
          id: 1, 
          title: 'Existing Form 1', 
          is_active: true
        });
        
        // Make the form old by manually updating its timestamp
        const db = (formCache as any).getDatabase();
        db.prepare(`UPDATE forms SET last_synced = ? WHERE id = ?`).run(oldTimestamp, 1);
        
        const activeFormsResponse = [
          { id: '1', title: 'Existing Form 1', is_active: '1' }, // Unchanged
          { id: '2', title: 'New Form 2', is_active: '1' }      // New
        ];
        
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          if (endpoint === '/forms') {
            return activeFormsResponse;
          }
          
          const id = parseInt(endpoint.split('/').pop()!);
          if (id === 3) return { id: '3', title: 'Hidden New Form 3', is_active: '0' };
          
          throw new Error('404 Not Found');
        });

        const result = await formCache.performIncrementalSync(mockApiCall);
        
        // Should find new forms (2 and 3) and update existing ones
        expect(result.discovered).toBe(3); // All processed forms
        expect(result.updated).toBe(1); // Form 1 updated timestamp
        
        const allForms = await formCache.getAllForms();
        expect(allForms).toHaveLength(3);
        expect(allForms.map(f => f.id).sort()).toEqual([1, 2, 3]);
      });
    });

    describe('getSyncStatus', () => {
      it('should return current sync status information', async () => {
        // Add some test data
        await formCache.insertForm({ id: 1, title: 'Form 1', is_active: true });
        await formCache.insertForm({ id: 2, title: 'Form 2', is_active: false });
        
        const status = await formCache.getSyncStatus();
        
        expect(status).toHaveProperty('totalForms');
        expect(status).toHaveProperty('activeForms');
        expect(status).toHaveProperty('inactiveForms');
        expect(status).toHaveProperty('lastSyncTime');
        expect(status).toHaveProperty('cacheAge');
        expect(status).toHaveProperty('needsSync');
        
        expect(status.totalForms).toBe(2);
        expect(status.activeForms).toBe(1);
        expect(status.inactiveForms).toBe(1);
        expect(status.lastSyncTime).toBeDefined();
        expect(typeof status.cacheAge).toBe('number');
        expect(typeof status.needsSync).toBe('boolean');
      });

      it('should indicate sync needed when cache is stale', async () => {
        // Insert old data
        const oldTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
        await formCache.insertForm({ 
          id: 1, 
          title: 'Old Form'
        });
        
        // Manually update the timestamp to make it old (direct database access)
        await formCache.updateForm(1, { title: 'Old Form' });
        const db = (formCache as any).getDatabase();
        db.prepare(`UPDATE forms SET last_synced = ? WHERE id = ?`).run(oldTimestamp, 1);
        
        const status = await formCache.getSyncStatus();
        
        expect(status.needsSync).toBe(true);
        expect(status.cacheAge).toBeGreaterThan(2 * 60 * 60 * 1000 - 1000); // About 2 hours in ms
      });

      it('should handle empty cache', async () => {
        const status = await formCache.getSyncStatus();
        
        expect(status.totalForms).toBe(0);
        expect(status.activeForms).toBe(0);
        expect(status.inactiveForms).toBe(0);
        expect(status.needsSync).toBe(true); // Empty cache always needs sync
      });
    });

    describe('sync workflow phases integration', () => {
      it('should execute all 5 phases in correct order', async () => {
        const phaseOrder: string[] = [];
        
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          if (endpoint === '/forms') {
            return [{ id: '1', title: 'Form 1', is_active: '1' }];
          }
          throw new Error('404 Not Found');
        });

        const onProgress = (status: any) => {
          if (!phaseOrder.includes(status.phase)) {
            phaseOrder.push(status.phase);
          }
        };
        
        await formCache.syncAllForms(mockApiCall, { onProgress });
        
        // Verify phases executed in correct order
        const expectedPhases = [
          'fetching-active-forms',
          'probing-gaps', 
          'beyond-max-probing',
          'updating-database',
          'completed'
        ];
        
        expect(phaseOrder).toEqual(expectedPhases);
      });

      it('should handle large form datasets efficiently', async () => {
        // Simulate smaller but realistic dataset for speed
        const activeFormIds = Array.from({ length: 10 }, (_, i) => i * 2 + 1); // 1, 3, 5, ... 19
        const activeFormsResponse = activeFormIds.map(id => ({
          id: id.toString(),
          title: `Form ${id}`,
          is_active: '1'
        }));
        
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          if (endpoint === '/forms') {
            return activeFormsResponse;
          }
          
          const id = parseInt(endpoint.split('/').pop()!);
          
          // Fill some gaps (even numbers up to 20)
          if (id <= 20 && id % 2 === 0) {
            return { id: id.toString(), title: `Hidden Form ${id}`, is_active: '0' };
          }
          
          throw new Error('404 Not Found');
        });

        const startTime = Date.now();
        const result = await formCache.syncAllForms(mockApiCall, { 
          maxProbeFailures: 3 // Reduce for speed
        });
        const duration = Date.now() - startTime;
        
        // Should handle 10 active + 10 gap forms = 20 total
        expect(result.discovered).toBeGreaterThanOrEqual(20);
        expect(duration).toBeLessThan(10000); // Should complete in reasonable time
        
        const allForms = await formCache.getAllForms();
        expect(allForms.length).toBeGreaterThanOrEqual(20);
      }, 15000); // 15 second timeout

      it('should handle database transaction failures gracefully', async () => {
        // This test would need a way to inject transaction failures
        // For now, test basic error recovery
        
        const activeFormsResponse = [
          { id: '1', title: 'Form 1', is_active: '1' }
        ];
        
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          if (endpoint === '/forms') {
            return activeFormsResponse;
          }
          throw new Error('404 Not Found');
        });

        // Close cache to simulate database unavailable
        await formCache.close();
        
        await expect(formCache.syncAllForms(mockApiCall)).rejects.toThrow();
        
        // Reinitialize for cleanup
        formCache = new FormCache(testDbPath);
        await formCache.init();
      });
    });

    describe('error handling and recovery', () => {
      it('should collect and report all errors during sync', async () => {
        let callCount = 0;
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          callCount++;
          
          if (endpoint === '/forms') {
            return [{ id: '1', title: 'Form 1', is_active: '1' }];
          }
          
          // Every other probe fails with different errors
          if (callCount % 2 === 0) {
            throw new Error(`Test Error ${callCount}`);
          }
          
          throw new Error('404 Not Found');
        });

        const result = await formCache.syncAllForms(mockApiCall, { maxProbeFailures: 3 });
        
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some(e => e.includes('Test Error'))).toBe(true);
      });

      it('should continue sync despite individual probe failures', async () => {
        const activeFormsResponse = [
          { id: '1', title: 'Form 1', is_active: '1' },
          { id: '3', title: 'Form 3', is_active: '1' }
        ];
        
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          if (endpoint === '/forms') {
            return activeFormsResponse;
          }
          
          const id = parseInt(endpoint.split('/').pop()!);
          
          // ID 2 fails, but sync should continue
          if (id === 2) {
            throw new Error('500 Server Error');
          }
          
          throw new Error('404 Not Found');
        });

        const result = await formCache.syncAllForms(mockApiCall, { maxProbeFailures: 2 });
        
        // Should still cache the active forms despite probe failure
        expect(result.discovered).toBe(2); // Two active forms
        expect(result.errors.length).toBeGreaterThan(0);
        
        const cachedForms = await formCache.getAllForms();
        expect(cachedForms).toHaveLength(2);
        expect(cachedForms.map(f => f.id).sort()).toEqual([1, 3]);
      });
    });
  });

  // =====================================
  // Step 9: Cache Management and Invalidation Tests
  // =====================================
  
  describe('Step 9: Cache Management and Invalidation', () => {
    beforeEach(async () => {
      formCache = new FormCache(testDbPath);
      await formCache.init();
    });

    describe('isStale', () => {
      it('should determine if cache is stale based on default age', async () => {
        // Empty cache should be considered stale
        const emptyStale = await formCache.isStale();
        expect(emptyStale).toBe(true);
        
        // Add fresh data
        await formCache.insertForm({ id: 1, title: 'Fresh Form', is_active: true });
        const freshStale = await formCache.isStale();
        expect(freshStale).toBe(false);
        
        // Make data old by updating timestamp
        const oldTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
        const db = (formCache as any).getDatabase();
        db.prepare(`UPDATE forms SET last_synced = ? WHERE id = ?`).run(oldTimestamp, 1);
        
        const oldStale = await formCache.isStale();
        expect(oldStale).toBe(true);
      });

      it('should respect custom maxAge parameter', async () => {
        await formCache.insertForm({ id: 1, title: 'Form', is_active: true });
        
        // Should not be stale with very long maxAge
        const notStale = await formCache.isStale(24 * 60 * 60 * 1000); // 24 hours
        expect(notStale).toBe(false);
        
        // Make form appear old by updating timestamp directly
        const oldTimestamp = new Date(Date.now() - 1000).toISOString(); // 1 second ago
        const db = (formCache as any).getDatabase();
        db.prepare(`UPDATE forms SET last_synced = ? WHERE id = ?`).run(oldTimestamp, 1);
        
        // Should be stale with very short maxAge
        const stale = await formCache.isStale(1); // 1 millisecond
        expect(stale).toBe(true);
      });

      it('should handle empty cache gracefully', async () => {
        const result = await formCache.isStale();
        expect(result).toBe(true);
        
        const customAgeResult = await formCache.isStale(1000);
        expect(customAgeResult).toBe(true);
      });
    });

    describe('invalidateCache', () => {
      it('should invalidate all cache when no formId provided', async () => {
        // Add test data
        await formCache.insertForm({ id: 1, title: 'Form 1', is_active: true });
        await formCache.insertForm({ id: 2, title: 'Form 2', is_active: false });
        
        expect(await formCache.getFormCount()).toBe(2);
        
        // Invalidate all
        await formCache.invalidateCache();
        
        expect(await formCache.getFormCount()).toBe(0);
        
        // Should be empty
        const allForms = await formCache.getAllForms();
        expect(allForms).toHaveLength(0);
      });

      it('should invalidate specific form when formId provided', async () => {
        // Add test data
        await formCache.insertForm({ id: 1, title: 'Form 1', is_active: true });
        await formCache.insertForm({ id: 2, title: 'Form 2', is_active: false });
        
        expect(await formCache.getFormCount()).toBe(2);
        
        // Invalidate specific form
        await formCache.invalidateCache(1);
        
        expect(await formCache.getFormCount()).toBe(1);
        
        // Form 1 should be gone, Form 2 should remain
        expect(await formCache.getForm(1)).toBeNull();
        expect(await formCache.getForm(2)).toBeDefined();
      });

      it('should handle invalidation of non-existent form', async () => {
        await formCache.insertForm({ id: 1, title: 'Form 1', is_active: true });
        
        // Should not throw error
        await expect(formCache.invalidateCache(999)).resolves.not.toThrow();
        
        // Existing form should still be there
        expect(await formCache.getForm(1)).toBeDefined();
      });
    });

    describe('refreshCache', () => {
      it('should refresh cache data from API', async () => {
        // Pre-populate with stale data
        await formCache.insertForm({ id: 1, title: 'Stale Form', is_active: true });
        
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          if (endpoint === '/forms') {
            return [{ id: '1', title: 'Fresh Form', is_active: '1' }];
          }
          throw new Error('404 Not Found');
        });

        const result = await formCache.refreshCache(mockApiCall);
        
        expect(result.discovered).toBe(1);
        expect(result.updated).toBe(1);
        
        // Data should be refreshed
        const refreshedForm = await formCache.getForm(1);
        expect(refreshedForm!.title).toBe('Fresh Form');
      });

      it('should handle refresh with API failures', async () => {
        const mockApiCall = jest.fn().mockRejectedValue(new Error('API Error'));

        // After improving error classification, refresh with API failures now throws SyncError
        await expect(formCache.refreshCache(mockApiCall)).rejects.toThrow('Sync failed during active forms fetch');
      });
    });

    describe('getCacheStats', () => {
      it('should return accurate cache statistics', async () => {
        // Add mixed data with different timestamps
        await formCache.insertForm({ id: 1, title: 'Active Form 1', is_active: true });
        await formCache.insertForm({ id: 2, title: 'Active Form 2', is_active: true });
        await formCache.insertForm({ id: 3, title: 'Inactive Form', is_active: false });
        
        // Make one form older
        const oldTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24 hours ago
        const db = (formCache as any).getDatabase();
        db.prepare(`UPDATE forms SET last_synced = ? WHERE id = ?`).run(oldTimestamp, 1);
        
        const stats = await formCache.getCacheStats();
        
        expect(stats.totalForms).toBe(3);
        expect(stats.activeCount).toBe(2);
        expect(stats.lastSync).toBeDefined();
        expect(stats.hitRate).toBe(0); // No hits tracked yet in this simple implementation
        expect(stats.oldestEntry).toBeDefined();
        expect(stats.newestEntry).toBeDefined();
        expect(stats.oldestEntry!.getTime()).toBeLessThan(stats.newestEntry!.getTime());
      });

      it('should handle empty cache in stats', async () => {
        const stats = await formCache.getCacheStats();
        
        expect(stats.totalForms).toBe(0);
        expect(stats.activeCount).toBe(0);
        expect(stats.lastSync).toBeNull();
        expect(stats.hitRate).toBe(0);
        expect(stats.oldestEntry).toBeNull();
        expect(stats.newestEntry).toBeNull();
      });
    });

    describe('cleanupStaleData', () => {
      it('should remove forms older than specified maxAge', async () => {
        // Add forms with different ages
        await formCache.insertForm({ id: 1, title: 'Fresh Form', is_active: true });
        await formCache.insertForm({ id: 2, title: 'Old Form', is_active: true });
        await formCache.insertForm({ id: 3, title: 'Very Old Form', is_active: false });
        
        // Make forms old with different timestamps
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        
        const db = (formCache as any).getDatabase();
        db.prepare(`UPDATE forms SET last_synced = ? WHERE id = ?`).run(oneDayAgo, 2);
        db.prepare(`UPDATE forms SET last_synced = ? WHERE id = ?`).run(threeDaysAgo, 3);
        
        // Cleanup forms older than 2 days
        const maxAge = 2 * 24 * 60 * 60 * 1000; // 2 days in ms
        const removedCount = await formCache.cleanupStaleData(maxAge);
        
        expect(removedCount).toBe(1); // Only form 3 should be removed
        
        // Verify cleanup results
        expect(await formCache.getForm(1)).toBeDefined(); // Fresh
        expect(await formCache.getForm(2)).toBeDefined(); // 1 day old (within limit)
        expect(await formCache.getForm(3)).toBeNull();    // 3 days old (removed)
        
        expect(await formCache.getFormCount()).toBe(2);
      });

      it('should return zero when no stale data to clean', async () => {
        await formCache.insertForm({ id: 1, title: 'Fresh Form', is_active: true });
        
        // Try to cleanup with very long maxAge
        const maxAge = 365 * 24 * 60 * 60 * 1000; // 1 year
        const removedCount = await formCache.cleanupStaleData(maxAge);
        
        expect(removedCount).toBe(0);
        expect(await formCache.getFormCount()).toBe(1);
      });

      it('should handle cleanup with empty cache', async () => {
        const maxAge = 24 * 60 * 60 * 1000; // 1 day
        const removedCount = await formCache.cleanupStaleData(maxAge);
        
        expect(removedCount).toBe(0);
      });
    });

    describe('cache configuration and policies', () => {
      it('should use appropriate default cache policies', async () => {
        // Test that default maxAge is 1 hour (as specified in requirements)
        await formCache.insertForm({ id: 1, title: 'Form', is_active: true });
        
        // Form should be fresh immediately
        expect(await formCache.isStale()).toBe(false);
        
        // Make it 30 minutes old - should still be fresh
        const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const db = (formCache as any).getDatabase();
        db.prepare(`UPDATE forms SET last_synced = ? WHERE id = ?`).run(thirtyMinAgo, 1);
        
        expect(await formCache.isStale()).toBe(false);
        
        // Make it 90 minutes old - should be stale
        const ninetyMinAgo = new Date(Date.now() - 90 * 60 * 1000).toISOString();
        db.prepare(`UPDATE forms SET last_synced = ? WHERE id = ?`).run(ninetyMinAgo, 1);
        
        expect(await formCache.isStale()).toBe(true);
      });

      it('should handle cache size limits appropriately', async () => {
        // Test that we can handle reasonable number of forms
        const formCount = 100;
        
        for (let i = 1; i <= formCount; i++) {
          await formCache.insertForm({ 
            id: i, 
            title: `Form ${i}`, 
            is_active: i % 2 === 0 
          });
        }
        
        expect(await formCache.getFormCount()).toBe(formCount);
        
        const stats = await formCache.getCacheStats();
        expect(stats.totalForms).toBe(formCount);
        expect(stats.activeCount).toBe(formCount / 2); // Half are active
      });
    });

    describe('cache corruption and recovery', () => {
      it('should handle database errors gracefully', async () => {
        await formCache.insertForm({ id: 1, title: 'Form', is_active: true });
        
        // Close the cache to simulate corruption
        await formCache.close();
        
        // Operations should handle closed database gracefully
        await expect(formCache.isStale()).rejects.toThrow('FormCache not initialized');
        await expect(formCache.getCacheStats()).rejects.toThrow('FormCache not initialized');
        
        // Reinitialize for cleanup
        formCache = new FormCache(testDbPath);
        await formCache.init();
      });

      it('should recover from partially corrupted operations', async () => {
        await formCache.insertForm({ id: 1, title: 'Form 1', is_active: true });
        await formCache.insertForm({ id: 2, title: 'Form 2', is_active: true });
        
        // Invalidate one form
        await formCache.invalidateCache(1);
        
        // Cache should still be functional
        expect(await formCache.getFormCount()).toBe(1);
        expect(await formCache.getForm(2)).toBeDefined();
        
        // Can add more forms
        await formCache.insertForm({ id: 3, title: 'Form 3', is_active: false });
        expect(await formCache.getFormCount()).toBe(2);
      });
    });

    describe('integration with existing sync functionality', () => {
      it('should work correctly with existing sync methods', async () => {
        const mockApiCall = jest.fn().mockImplementation(async (endpoint: string) => {
          if (endpoint === '/forms') {
            return [
              { id: '1', title: 'Form 1', is_active: '1' },
              { id: '2', title: 'Form 2', is_active: '1' }
            ];
          }
          throw new Error('404 Not Found');
        });

        // Initial sync
        await formCache.syncAllForms(mockApiCall);
        
        // Check cache stats
        const initialStats = await formCache.getCacheStats();
        expect(initialStats.totalForms).toBe(2);
        expect(initialStats.activeCount).toBe(2);
        
        // Cache should not be stale immediately
        expect(await formCache.isStale()).toBe(false);
        
        // Force refresh should work
        const refreshResult = await formCache.refreshCache(mockApiCall);
        expect(refreshResult.discovered).toBe(2);
        
        // Invalidate and verify
        await formCache.invalidateCache(1);
        const afterInvalidation = await formCache.getCacheStats();
        expect(afterInvalidation.totalForms).toBe(1);
      });
    });
  });
});