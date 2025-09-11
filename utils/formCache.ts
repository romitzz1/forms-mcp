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

export interface FormCacheInsert {
  id: number;
  title: string;
  entry_count?: number;
  is_active?: boolean;
  form_data?: string;
}

export interface FormCacheUpdate {
  title?: string;
  entry_count?: number;
  is_active?: boolean;
  form_data?: string;
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

  /**
   * Validate form ID parameter
   */
  private validateFormId(id: number): void {
    if (!Number.isInteger(id) || id < 0) {
      throw new Error('Form ID must be a non-negative integer');
    }
  }

  /**
   * Transform raw database result to FormCacheRecord (convert SQLite integers back to booleans)
   */
  private transformDbResult(row: any): FormCacheRecord {
    return {
      id: row.id,
      title: row.title,
      entry_count: row.entry_count,
      is_active: Boolean(row.is_active),
      last_synced: row.last_synced,
      form_data: row.form_data
    };
  }

  /**
   * Transform API form data (strings) to FormCacheInsert (booleans)
   * Gravity Forms API returns is_active as "1"/"0" strings
   */
  private transformApiFormToCache(apiForm: any): FormCacheInsert {
    return {
      id: parseInt(apiForm.id, 10),
      title: apiForm.title || '',
      entry_count: parseInt(apiForm.entries?.length || '0', 10),
      is_active: apiForm.is_active === '1' || apiForm.is_active === 1 || apiForm.is_active === true,
      form_data: JSON.stringify(apiForm)
    };
  }

  /**
   * Insert form from API data (handles string-to-boolean conversion)
   */
  async insertFormFromApi(apiForm: any): Promise<void> {
    const cacheForm = this.transformApiFormToCache(apiForm);
    await this.insertForm(cacheForm);
  }

  /**
   * Insert a new form record into the cache
   */
  async insertForm(form: FormCacheInsert): Promise<void> {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    // Validate required fields
    if (form.id == null || !form.title) {
      throw new Error('Form ID and title are required');
    }

    this.validateFormId(form.id);

    const db = this.getDatabase();
    
    const stmt = db.prepare(`
      INSERT INTO forms (id, title, entry_count, is_active, form_data, last_synced)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    try {
      stmt.run(
        form.id,
        form.title,
        form.entry_count ?? 0,
        (form.is_active ?? true) ? 1 : 0,
        form.form_data ?? ''
      );
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        throw new Error(`Form with ID ${form.id} already exists`);
      }
      if (error.code === 'SQLITE_CONSTRAINT_NOTNULL') {
        throw new Error(`Required field missing: ${error.message}`);
      }
      if (error.code?.startsWith('SQLITE_CONSTRAINT')) {
        throw new Error(`Database constraint violation: ${error.message}`);
      }
      throw new Error(`Failed to insert form: ${error.message}`);
    }
  }

  /**
   * Update an existing form record
   */
  async updateForm(id: number, updates: FormCacheUpdate): Promise<void> {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    this.validateFormId(id);

    if (Object.keys(updates).length === 0) {
      throw new Error('No updates provided');
    }

    const db = this.getDatabase();
    
    // Build dynamic update query
    const updateFields: string[] = [];
    const values: any[] = [];

    if (updates.title !== undefined) {
      updateFields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.entry_count !== undefined) {
      updateFields.push('entry_count = ?');
      values.push(updates.entry_count);
    }
    if (updates.is_active !== undefined) {
      updateFields.push('is_active = ?');
      values.push(updates.is_active ? 1 : 0);
    }
    if (updates.form_data !== undefined) {
      updateFields.push('form_data = ?');
      values.push(updates.form_data);
    }

    // Always update last_synced
    updateFields.push('last_synced = CURRENT_TIMESTAMP');
    values.push(id); // for WHERE clause

    const stmt = db.prepare(`
      UPDATE forms SET ${updateFields.join(', ')}
      WHERE id = ?
    `);

    const result = stmt.run(...values);
    
    // Check if any rows were affected (form exists)
    if (result.changes === 0) {
      throw new Error(`Form with ID ${id} not found`);
    }
  }

  /**
   * Get a single form by ID
   */
  async getForm(id: number): Promise<FormCacheRecord | null> {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    this.validateFormId(id);

    const db = this.getDatabase();
    const stmt = db.prepare(`
      SELECT id, title, entry_count, is_active, last_synced, form_data
      FROM forms WHERE id = ?
    `);

    const result = stmt.get(id);
    return result ? this.transformDbResult(result) : null;
  }

  /**
   * Get all forms with optional active-only filtering
   */
  async getAllForms(activeOnly?: boolean): Promise<FormCacheRecord[]> {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    const db = this.getDatabase();
    let query = `
      SELECT id, title, entry_count, is_active, last_synced, form_data
      FROM forms
    `;

    if (activeOnly === true) {
      query += ` WHERE is_active = true`;
    }

    query += ` ORDER BY id`;

    const stmt = db.prepare(query);
    const results = stmt.all();
    return results.map(row => this.transformDbResult(row));
  }

  /**
   * Delete a form by ID
   */
  async deleteForm(id: number): Promise<void> {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    this.validateFormId(id);

    const db = this.getDatabase();
    const stmt = db.prepare(`DELETE FROM forms WHERE id = ?`);
    const result = stmt.run(id);
    
    // Check if any rows were affected (form exists)
    if (result.changes === 0) {
      throw new Error(`Form with ID ${id} not found`);
    }
  }

  /**
   * Get count of forms with optional active-only filtering
   */
  async getFormCount(activeOnly?: boolean): Promise<number> {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    const db = this.getDatabase();
    let query = `SELECT COUNT(*) as count FROM forms`;

    if (activeOnly === true) {
      query += ` WHERE is_active = true`;
    }

    const stmt = db.prepare(query);
    const result = stmt.get() as { count: number };
    return result.count;
  }
}