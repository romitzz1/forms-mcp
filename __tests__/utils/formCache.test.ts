// ABOUTME: Test suite for FormCache class
// ABOUTME: Tests form caching with SQLite schema management

import { FormCache, FormCacheInsert, FormCacheUpdate, FormCacheRecord } from '../../utils/formCache.js';
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
        await expect(formCache.getForm(0)).rejects.toThrow();
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
        await expect(formCache.updateForm(0, updates)).rejects.toThrow();
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
        await expect(formCache.deleteForm(0)).rejects.toThrow();
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
    });
  });
});