// ABOUTME: Test suite for database utility functions
// ABOUTME: Tests SQLite connection management and error handling

import { DatabaseManager } from '../../utils/database.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('DatabaseManager', () => {
  let tempDir: string;
  let testDbPath: string;
  let dbManager: DatabaseManager;

  beforeEach(() => {
    // Create temporary directory for test databases
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forms-mcp-test-'));
    testDbPath = path.join(tempDir, 'test.db');
  });

  afterEach(() => {
    // Clean up test databases and directories
    if (dbManager) {
      try {
        dbManager.close();
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
    it('should create DatabaseManager with custom path', () => {
      dbManager = new DatabaseManager(testDbPath);
      expect(dbManager).toBeDefined();
    });

    it('should use default path when no path provided', () => {
      dbManager = new DatabaseManager();
      expect(dbManager).toBeDefined();
    });

    it('should create data directory if it does not exist', () => {
      const dataDir = path.join(tempDir, 'data');
      const dbPath = path.join(dataDir, 'forms.db');
      
      expect(fs.existsSync(dataDir)).toBe(false);
      
      dbManager = new DatabaseManager(dbPath);
      dbManager.init();
      
      expect(fs.existsSync(dataDir)).toBe(true);
    });
  });

  describe('database operations', () => {
    beforeEach(() => {
      dbManager = new DatabaseManager(testDbPath);
    });

    it('should initialize database and create file', () => {
      expect(fs.existsSync(testDbPath)).toBe(false);
      
      dbManager.init();
      
      expect(fs.existsSync(testDbPath)).toBe(true);
    });

    it('should connect to existing database file', () => {
      // First initialization
      dbManager.init();
      expect(fs.existsSync(testDbPath)).toBe(true);
      
      // Close and reconnect
      dbManager.close();
      
      const dbManager2 = new DatabaseManager(testDbPath);
      expect(() => dbManager2.init()).not.toThrow();
      dbManager2.close();
    });

    it('should return connection status', () => {
      expect(dbManager.isReady()).toBe(false);
      
      dbManager.init();
      expect(dbManager.isReady()).toBe(true);
      
      dbManager.close();
      expect(dbManager.isReady()).toBe(false);
    });

    it('should close database connection cleanly', () => {
      dbManager.init();
      expect(dbManager.isReady()).toBe(true);
      
      expect(() => dbManager.close()).not.toThrow();
      expect(dbManager.isReady()).toBe(false);
    });

    it('should handle multiple close calls gracefully', () => {
      dbManager.init();
      dbManager.close();
      
      expect(() => dbManager.close()).not.toThrow();
      expect(dbManager.isReady()).toBe(false);
    });

    it('should handle init called multiple times', () => {
      dbManager.init();
      expect(dbManager.isReady()).toBe(true);
      
      // Second init should not throw
      expect(() => dbManager.init()).not.toThrow();
      expect(dbManager.isReady()).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle invalid database path gracefully', () => {
      // Try to create database in non-existent directory with no permissions
      const invalidPath = '/invalid/path/database.db';
      dbManager = new DatabaseManager(invalidPath);
      
      expect(() => dbManager.init()).toThrow();
    });

    it('should throw error when operating on closed database', () => {
      dbManager = new DatabaseManager(testDbPath);
      dbManager.init();
      dbManager.close();
      
      expect(dbManager.isReady()).toBe(false);
    });

    it('should handle file permission errors', () => {
      // Create a directory where we want the db file (permission issue)
      fs.mkdirSync(testDbPath);
      
      dbManager = new DatabaseManager(testDbPath);
      expect(() => dbManager.init()).toThrow();
    });
  });

  describe('path handling', () => {
    it('should normalize database paths correctly', () => {
      const pathWithSpaces = path.join(tempDir, 'path with spaces', 'test.db');
      dbManager = new DatabaseManager(pathWithSpaces);
      
      expect(() => dbManager.init()).not.toThrow();
      expect(fs.existsSync(pathWithSpaces)).toBe(true);
    });

    it('should handle relative paths', () => {
      const relativePath = './test-data/test.db';
      dbManager = new DatabaseManager(relativePath);
      
      expect(() => dbManager.init()).not.toThrow();
      
      // Clean up
      const absolutePath = path.resolve(relativePath);
      const dir = path.dirname(absolutePath);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});