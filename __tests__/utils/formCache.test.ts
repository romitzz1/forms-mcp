// ABOUTME: Test suite for FormCache class
// ABOUTME: Tests form caching with SQLite schema management

import { FormCache } from '../../utils/formCache.js';
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
});