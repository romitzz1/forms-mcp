// ABOUTME: FormCache class for comprehensive form caching and discovery
// ABOUTME: Manages SQLite schema, form storage, and database operations

import { DatabaseManager } from './database.js';
import Database from 'better-sqlite3';

const CURRENT_SCHEMA_VERSION = 1;

export interface FormCacheRecord {
  id: number;
  title: string;
  entry_count: number;
  is_active: boolean;
  last_synced: string;
  form_data: string;
}

export interface TableColumn {
  name: string;
  type: string;
  notnull: boolean;
  dflt_value?: any;
  pk: boolean;
}

export class FormCache {
  private dbManager: DatabaseManager;

  constructor(dbPath?: string) {
    this.dbManager = new DatabaseManager(dbPath);
  }

  /**
   * Initialize the cache with database schema
   */
  async init(): Promise<void> {
    try {
      // Initialize database connection
      this.dbManager.init();
      
      // Create schema if needed
      await this.createSchema();
      
      // Handle schema migrations
      await this.handleSchemaMigration();
      
    } catch (error) {
      throw new Error(`Failed to initialize FormCache: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    this.dbManager.close();
  }

  /**
   * Check if cache is ready for operations
   */
  isReady(): boolean {
    return this.dbManager.isReady();
  }

  /**
   * Get database file path
   */
  getDatabasePath(): string {
    return this.dbManager.getPath();
  }

  /**
   * Check if a table exists
   */
  async tableExists(tableName: string): Promise<boolean> {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    const db = this.getDatabase();
    const result = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name=?
    `).get(tableName);
    
    return result !== undefined;
  }

  /**
   * Get table columns information
   */
  async getTableColumns(tableName: string): Promise<TableColumn[]> {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    // Validate table name to prevent SQL injection
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new Error('Invalid table name format');
    }

    const db = this.getDatabase();
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    
    return columns.map((col: any) => ({
      name: col.name,
      type: col.type,
      notnull: col.notnull === 1,
      dflt_value: col.dflt_value,
      pk: col.pk === 1
    }));
  }

  /**
   * Get table indexes
   */
  async getTableIndexes(tableName: string): Promise<string[]> {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    // Validate table name to prevent SQL injection
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new Error('Invalid table name format');
    }

    const db = this.getDatabase();
    const indexes = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='index' AND tbl_name=?
    `).all(tableName);
    
    return indexes.map((idx: any) => idx.name);
  }

  /**
   * Get current schema version
   */
  async getSchemaVersion(): Promise<number> {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    const db = this.getDatabase();
    
    // Check if schema_version table exists
    const versionTableExists = await this.tableExists('schema_version');
    if (!versionTableExists) {
      return 0;
    }

    const result = db.prepare(`
      SELECT version FROM schema_version ORDER BY version DESC LIMIT 1
    `).get() as { version: number } | undefined;
    
    return result ? result.version : 0;
  }

  /**
   * Check if schema needs update
   */
  async needsSchemaUpdate(): Promise<boolean> {
    const currentVersion = await this.getSchemaVersion();
    return currentVersion < CURRENT_SCHEMA_VERSION;
  }

  /**
   * Create initial database schema
   */
  private async createSchema(): Promise<void> {
    const db = this.getDatabase();
    
    // Create forms table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS forms (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        entry_count INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        form_data TEXT
      )
    `).run();

    // Create indexes for performance
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_forms_active 
      ON forms(is_active)
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_forms_last_synced 
      ON forms(last_synced)
    `).run();

    // Create schema version table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // Record initial schema version
    const versionExists = db.prepare(`
      SELECT 1 FROM schema_version WHERE version = ?
    `).get(CURRENT_SCHEMA_VERSION);

    if (!versionExists) {
      db.prepare(`
        INSERT INTO schema_version (version) VALUES (?)
      `).run(CURRENT_SCHEMA_VERSION);
    }
  }

  /**
   * Handle schema migrations
   */
  private async handleSchemaMigration(): Promise<void> {
    const needsUpdate = await this.needsSchemaUpdate();
    if (!needsUpdate) {
      return;
    }

    // Future migrations would go here
    // For now, we only have version 1
    const currentVersion = await this.getSchemaVersion();
    
    if (currentVersion < CURRENT_SCHEMA_VERSION) {
      // Apply migrations here when needed
      const db = this.getDatabase();
      db.prepare(`
        INSERT INTO schema_version (version) VALUES (?)
      `).run(CURRENT_SCHEMA_VERSION);
    }
  }

  /**
   * Get database instance for schema operations
   */
  private getDatabase(): Database.Database {
    return this.dbManager.getDatabase();
  }
}