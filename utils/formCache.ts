// ABOUTME: FormCache class for comprehensive form caching and discovery
// ABOUTME: Manages SQLite schema, form storage, and database operations

import { DatabaseManager } from './database.js';
import type Database from 'better-sqlite3';

const CURRENT_SCHEMA_VERSION = 2;

// =====================================
// Step 14: Error Classification System
// =====================================

/**
 * Base error class for all cache-related errors
 */
export class CacheError extends Error {
  public readonly errorCode: string;
  public readonly context?: Record<string, any>;
  public readonly timestamp: Date;

  constructor(message: string, errorCode = 'CACHE_ERROR', context?: Record<string, any>) {
    super(message);
    this.name = 'CacheError';
    this.errorCode = errorCode;
    this.context = context;
    this.timestamp = new Date();
  }
}

/**
 * Database-specific errors (connection, corruption, constraints)
 */
export class DatabaseError extends CacheError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'DATABASE_ERROR', context);
    this.name = 'DatabaseError';
  }
}

/**
 * API-related errors (network, authentication, rate limiting)
 */
export class ApiError extends CacheError {
  public readonly httpStatus?: number;
  public readonly retryable: boolean;

  constructor(message: string, httpStatus?: number, retryable = false, context?: Record<string, any>) {
    super(message, 'API_ERROR', context);
    this.name = 'ApiError';
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

/**
 * Sync workflow errors (data integrity, partial failures)
 */
export class SyncError extends CacheError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'SYNC_ERROR', context);
    this.name = 'SyncError';
  }
}

/**
 * Configuration and setup errors
 */
export class ConfigurationError extends CacheError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'CONFIGURATION_ERROR', context);
    this.name = 'ConfigurationError';
  }
}

// =====================================
// Step 14: Logging Framework
// =====================================

export interface LogContext {
  operation?: string;
  form_id?: number;
  endpoint?: string;
  duration?: number;
  error_code?: string;
  [key: string]: any;
}

export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN', 
  INFO = 'INFO',
  DEBUG = 'DEBUG'
}

/**
 * Simple structured logger for FormCache operations
 */
export class FormCacheLogger {
  private static instance: FormCacheLogger;
  private logLevel: LogLevel = LogLevel.INFO;

  static getInstance(): FormCacheLogger {
    if (!FormCacheLogger.instance) {
      FormCacheLogger.instance = new FormCacheLogger();
    }
    return FormCacheLogger.instance;
  }

  /**
   * Reset the singleton instance (primarily for testing)
   */
  static resetInstance(): void {
    FormCacheLogger.instance = new FormCacheLogger();
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.ERROR, LogLevel.WARN, LogLevel.INFO, LogLevel.DEBUG];
    const currentIndex = levels.indexOf(this.logLevel);
    const messageIndex = levels.indexOf(level);
    return messageIndex <= currentIndex;
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` | ${JSON.stringify(this.sanitizeContext(context))}` : '';
    return `[${timestamp}] [FormCache] [${level}] ${message}${contextStr}`;
  }

  private sanitizeContext(context: LogContext): LogContext {
    const sanitized = { ...context };
    
    // Remove sensitive data
    const sensitiveKeys = ['api_key', 'secret', 'password', 'token', 'auth'];
    for (const key of sensitiveKeys) {
      if (key in sanitized) {
        sanitized[key] = '[REDACTED]';
      }
    }
    
    // Truncate large form_data (use hardcoded value since logger is standalone)
    const LOG_TRUNCATE_LENGTH = 200;
    if (sanitized.form_data && typeof sanitized.form_data === 'string' && sanitized.form_data.length > LOG_TRUNCATE_LENGTH) {
      sanitized.form_data = sanitized.form_data.substring(0, LOG_TRUNCATE_LENGTH) + '... [TRUNCATED]';
    }
    
    return sanitized;
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage(LogLevel.ERROR, message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage(LogLevel.WARN, message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.error(this.formatMessage(LogLevel.INFO, message, context));
    }
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.error(this.formatMessage(LogLevel.DEBUG, message, context));
    }
  }
}

// Type for API call function
export type ApiCallFunction = (endpoint: string) => Promise<any>;

// Interface for basic form metadata extraction
export interface FormBasicInfo {
  id: number;
  title: string;
  is_active: boolean;
  is_trash: boolean;
  entry_count: number;
}

// Interface for form probe results
export interface FormProbeResult {
  id: number;
  found: boolean;
  form?: FormCacheRecord;
  error?: string;
}

// Interface for probe statistics tracking
export interface ProbeStats {
  attempted: number;
  found: number;
  failed: number;
  errors: string[];
}

// Interface for beyond-max probing options
export interface BeyondMaxOptions {
  consecutiveFailureThreshold?: number;
  maxProbeLimit?: number;
  probeDelayMs?: number;
  onProgress?: (progress: ProbeProgress) => void;
}

// Interface for progress tracking during beyond-max probing
export interface ProbeProgress {
  phase: string;
  current: number;
  total?: number;
  found: number;
}

// =====================================
// Step 8: Full Discovery Workflow Interfaces
// =====================================

// Interface for sync operation options
export interface SyncOptions {
  forceFullSync?: boolean;
  maxProbeFailures?: number;
  maxCacheAgeMs?: number;
  onProgress?: (status: SyncProgress) => void;
}

// Interface for sync operation results
export interface SyncResult {
  discovered: number;
  updated: number;
  errors: string[];
  duration: number;
  lastSyncTime: Date;
}

// Interface for sync progress tracking
export interface SyncProgress {
  phase: string;
  current: number;
  total: number;
  found: number;
}

// Interface for sync status information
export interface SyncStatus {
  totalForms: number;
  activeForms: number;
  inactiveForms: number;
  lastSyncTime: Date | null;
  cacheAge: number; // in milliseconds
  needsSync: boolean;
}

// =====================================
// Step 9: Cache Management Interfaces
// =====================================

// Interface for cache statistics
export interface CacheStats {
  totalForms: number;
  activeCount: number;
  lastSync: Date | null;
  hitRate: number;
  oldestEntry: Date | null;
  newestEntry: Date | null;
}

// Interface for cache configuration
export interface CacheConfig {
  maxAge: number; // in milliseconds
  cleanupInterval: number; // in milliseconds
  maxSize: number; // maximum number of forms
}

export interface FormCacheRecord {
  id: number;
  title: string;
  entry_count: number;
  is_active: boolean;
  is_trash: boolean;
  last_synced: string;
  form_data: string;
}

export interface FormCacheInsert {
  id: number;
  title: string;
  entry_count?: number;
  is_active?: boolean;
  is_trash?: boolean;
  form_data?: string;
}

export interface FormCacheUpdate {
  title?: string;
  entry_count?: number;
  is_active?: boolean;
  is_trash?: boolean;
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
  private readonly dbManager: DatabaseManager;
  private readonly logger: FormCacheLogger;

  constructor(dbPath?: string) {
    this.dbManager = new DatabaseManager(dbPath);
    this.logger = FormCacheLogger.getInstance();
  }

  /**
   * Initialize the cache with database schema
   */
  async init(): Promise<void> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Initializing FormCache', { 
        operation: 'init',
        db_path: this.dbManager.getPath()
      });

      // Validate database path configuration
      const dbPath = this.dbManager.getPath();
      if (!dbPath || dbPath.trim() === '' || dbPath === '' || dbPath === '.') {
        throw new ConfigurationError('Database path is empty or invalid', {
          operation: 'init',
          db_path: dbPath
        });
      }

      // Initialize database connection
      this.dbManager.init();
      
      // Create schema if needed
      await this.createSchema();
      
      // Handle schema migrations
      await this.handleSchemaMigration();

      const duration = Date.now() - startTime;
      this.logger.info('FormCache initialized successfully', {
        operation: 'init',
        duration,
        db_path: dbPath
      });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      
      this.logger.error('Failed to initialize FormCache', {
        operation: 'init',
        duration,
        error: message,
        db_path: this.dbManager.getPath()
      });

      // Classify errors appropriately
      if (error instanceof ConfigurationError) {
        throw error;
      }
      
      if (message.includes('SQLITE_CANTOPEN') || 
          message.includes('permission denied') || 
          message.includes('disk I/O error') ||
          message.includes('database is locked') ||
          message.includes('unable to open database file')) {
        throw new DatabaseError(`Database initialization failed: ${message}`, {
          operation: 'init',
          db_path: this.dbManager.getPath()
        });
      }
      
      if (message.includes('not a database') || 
          message.includes('file is not a database') || 
          message.includes('database disk image is malformed') ||
          message.includes('SQLITE_CORRUPT')) {
        this.logger.error('Database corruption detected', {
          operation: 'init',
          db_path: this.dbManager.getPath(),
          corruption: true
        });
        throw new DatabaseError(`Database corruption detected: ${message}`, {
          operation: 'init',
          db_path: this.dbManager.getPath(),
          corruption: true
        });
      }

      throw new CacheError(`Failed to initialize FormCache: ${message}`, 'INIT_FAILED', {
        operation: 'init',
        original_error: message
      });
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
      throw new CacheError('FormCache not initialized', 'NOT_INITIALIZED', {
        operation: 'tableExists',
        table_name: tableName
      });
    }

    try {
      const db = this.getDatabase();
      const result = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name=?
      `).get(tableName);
      
      return result !== undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to check table existence', {
        operation: 'tableExists',
        table_name: tableName,
        error: message
      });
      throw new DatabaseError(`Failed to check table existence: ${message}`, {
        operation: 'tableExists',
        table_name: tableName
      });
    }
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
        is_trash BOOLEAN DEFAULT false,
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
      CREATE INDEX IF NOT EXISTS idx_forms_trash 
      ON forms(is_trash)
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

    // Create sync metadata table for hybrid sync tracking
    db.prepare(`
      CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

    const currentVersion = await this.getSchemaVersion();
    const db = this.getDatabase();
    
    // Migration from version 1 to version 2: Add is_trash column
    if (currentVersion < 2) {
      // Check if is_trash column already exists (safety check)
      const columnExists = db.prepare(`
        PRAGMA table_info(forms)
      `).all().some((col: any) => col.name === 'is_trash');
      
      if (!columnExists) {
        // Add is_trash column with default value false
        db.prepare(`
          ALTER TABLE forms ADD COLUMN is_trash BOOLEAN DEFAULT false
        `).run();
        
        // Create index for is_trash performance
        db.prepare(`
          CREATE INDEX IF NOT EXISTS idx_forms_trash 
          ON forms(is_trash)
        `).run();
      }
      
      // Update schema version to 2
      db.prepare(`
        INSERT INTO schema_version (version) VALUES (?)
      `).run(2);
    }
    
    // Future migrations will be added here
    // if (currentVersion < 3) { ... }
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
      is_trash: Boolean(row.is_trash),
      last_synced: row.last_synced,
      form_data: row.form_data
    };
  }

  /**
   * Transform API form data (strings) to FormCacheInsert (booleans)
   * Gravity Forms API returns is_active as "1"/"0" strings
   */
  private transformApiFormToCache(apiForm: any): FormCacheInsert {
    // Handle entry count - /forms API returns 'entries' as string count, not array
    let entry_count = 0;
    if (apiForm.entry_count !== undefined) {
      entry_count = parseInt(apiForm.entry_count, 10) || 0;
    } else if (apiForm.entries !== undefined) {
      // Handle both string count (from /forms API) and array format (from individual form API)
      if (Array.isArray(apiForm.entries)) {
        entry_count = apiForm.entries.length;
      } else {
        entry_count = parseInt(apiForm.entries, 10) || 0;
      }
    }
    
    return {
      id: parseInt(apiForm.id, 10),
      title: apiForm.title || '',
      entry_count,
      // /forms endpoint only returns active forms, so default to true if is_active field is missing
      is_active: apiForm.is_active !== undefined 
        ? (apiForm.is_active === '1' || apiForm.is_active === 1 || apiForm.is_active === true)
        : true,
      // Handle is_trash from API response, default to false if not provided
      is_trash: apiForm.is_trash !== undefined 
        ? (apiForm.is_trash === '1' || apiForm.is_trash === 1 || apiForm.is_trash === true)
        : false,
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
      throw new CacheError('FormCache not initialized', 'NOT_INITIALIZED', {
        operation: 'insertForm',
        form_id: form.id
      });
    }

    // Validate required fields
    if (form.id == null || !form.title) {
      throw new DatabaseError('Form ID and title are required', {
        operation: 'insertForm',
        form_id: form.id,
        has_title: !!form.title
      });
    }

    this.validateFormId(form.id);

    const db = this.getDatabase();
    
    const stmt = db.prepare(`
      INSERT INTO forms (id, title, entry_count, is_active, is_trash, form_data, last_synced)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    try {
      this.logger.debug('Inserting form into cache', {
        operation: 'insertForm',
        form_id: form.id,
        title: form.title,
        is_active: form.is_active
      });

      stmt.run(
        form.id,
        form.title,
        form.entry_count ?? 0,
        (form.is_active ?? true) ? 1 : 0,
        (form.is_trash ?? false) ? 1 : 0,
        form.form_data ?? ''
      );

      this.logger.info('Form inserted successfully', {
        operation: 'insertForm',
        form_id: form.id
      });

    } catch (error: any) {
      const context = {
        operation: 'insertForm',
        form_id: form.id,
        error_code: error.code,
        sqlite_error: error.message
      };

      this.logger.error('Failed to insert form', context);

      if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        throw new DatabaseError(`Form with ID ${form.id} already exists`, context);
      }
      if (error.code === 'SQLITE_CONSTRAINT_NOTNULL') {
        throw new DatabaseError(`Required field missing: ${error.message}`, context);
      }
      if (error.code?.startsWith('SQLITE_CONSTRAINT')) {
        throw new DatabaseError(`Database constraint violation: ${error.message}`, context);
      }
      
      throw new DatabaseError(`Failed to insert form: ${error.message}`, context);
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
    if (updates.is_trash !== undefined) {
      updateFields.push('is_trash = ?');
      values.push(updates.is_trash ? 1 : 0);
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
      throw new CacheError('FormCache not initialized', 'NOT_INITIALIZED', {
        operation: 'getForm',
        form_id: id
      });
    }

    this.validateFormId(id);

    try {
      const db = this.getDatabase();
      const stmt = db.prepare(`
        SELECT id, title, entry_count, is_active, is_trash, last_synced, form_data
        FROM forms WHERE id = ?
      `);

      const result = stmt.get(id);
      return result ? this.transformDbResult(result) : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to get form', {
        operation: 'getForm',
        form_id: id,
        error: message
      });
      throw new DatabaseError(`Failed to get form: ${message}`, {
        operation: 'getForm',
        form_id: id
      });
    }
  }

  /**
   * Get all forms with optional active-only and exclude-trash filtering
   */
  async getAllForms(activeOnly?: boolean, excludeTrash?: boolean): Promise<FormCacheRecord[]> {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    const db = this.getDatabase();
    let query = `
      SELECT id, title, entry_count, is_active, is_trash, last_synced, form_data
      FROM forms
    `;

    const conditions: string[] = [];
    
    if (activeOnly === true) {
      conditions.push('is_active = true');
    }
    
    if (excludeTrash === true) {
      conditions.push('is_trash = false');
    }
    
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
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

  // =====================================
  // Step 4: Active Forms Fetching Methods
  // =====================================

  /**
   * Fetch all active forms from the API and transform them to cache format
   */
  async fetchActiveForms(apiCall: ApiCallFunction): Promise<FormCacheRecord[]> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Fetching active forms from API', {
        operation: 'fetchActiveForms',
        endpoint: '/forms'
      });

      const response = await apiCall('/forms');
      
      // Validate response format - /forms endpoint returns object keyed by form ID, not array
      if (!this.validateApiResponse(response)) {
        throw new ApiError('Invalid API response format', undefined, false, {
          operation: 'fetchActiveForms',
          endpoint: '/forms',
          response_type: typeof response,
          is_object: typeof response === 'object' && response !== null,
          is_array: Array.isArray(response)
        });
      }

      // Convert object of forms to array for processing
      const formsArray = Object.values(response);

      // Transform each API form to cache format
      const cacheRecords: FormCacheRecord[] = [];
      let hasTransformErrors = false;
      let lastTransformError: string | undefined;
      
      for (const apiForm of formsArray) {
        try {
          // Individual form validation (null IDs will be caught in extractFormMetadata)
          const cacheRecord = this.transformApiForm(apiForm);
          cacheRecords.push(cacheRecord);
        } catch (transformError) {
          const message = transformError instanceof Error ? transformError.message : 'Unknown error';
          this.logger.warn('Skipping malformed form in API response', {
            operation: 'fetchActiveForms',
            form_data: JSON.stringify(apiForm).substring(0, 200),
            error: message
          });
          hasTransformErrors = true;
          lastTransformError = message;
          // Continue processing other forms instead of failing completely
        }
      }
      
      // If all forms failed to transform, throw error
      if (cacheRecords.length === 0 && hasTransformErrors) {
        throw new ApiError(`Failed to transform any forms: ${lastTransformError}`, undefined, false, {
          operation: 'fetchActiveForms',
          endpoint: '/forms'
        });
      }

      const duration = Date.now() - startTime;
      this.logger.info('Successfully fetched active forms', {
        operation: 'fetchActiveForms',
        count: cacheRecords.length,
        duration
      });

      return cacheRecords;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      
      this.logger.error('Failed to fetch active forms', {
        operation: 'fetchActiveForms',
        endpoint: '/forms',
        duration,
        error: message
      });

      // Classify API errors appropriately
      if (error instanceof ApiError) {
        throw error;
      }

      // Determine if error is retryable
      const retryable = this.isRetryableError(message);
      let httpStatus: number | undefined;
      
      if (message.includes('401')) httpStatus = 401;
      else if (message.includes('403')) httpStatus = 403;
      else if (message.includes('404')) httpStatus = 404;
      else if (message.includes('429')) httpStatus = 429;
      else if (message.includes('500')) httpStatus = 500;
      else if (message.includes('502')) httpStatus = 502;
      else if (message.includes('503')) httpStatus = 503;
      else if (message.includes('504')) httpStatus = 504;

      throw new ApiError(`Failed to fetch active forms: ${message}`, httpStatus, retryable, {
        operation: 'fetchActiveForms',
        endpoint: '/forms',
        duration
      });
    }
  }

  /**
   * Transform API form data to FormCacheRecord format
   */
  transformApiForm(apiForm: any): FormCacheRecord {
    const basicInfo = this.extractFormMetadata(apiForm);
    
    return {
      id: basicInfo.id,
      title: basicInfo.title,
      entry_count: basicInfo.entry_count,
      is_active: basicInfo.is_active,
      is_trash: basicInfo.is_trash,
      last_synced: new Date().toISOString(),
      form_data: JSON.stringify(apiForm)
    };
  }

  /**
   * Validate API response format
   * /forms endpoint returns object keyed by form ID, not array
   */
  validateApiResponse(response: any): boolean {
    // Must be an object but not an array
    if (typeof response !== 'object' || response === null || Array.isArray(response)) {
      return false;
    }

    // Empty object is valid
    const formValues = Object.values(response);
    if (formValues.length === 0) {
      return true;
    }

    // Check each form value is an object and has basic structure
    for (const form of formValues) {
      if (typeof form !== 'object' || form === null) {
        return false;
      }
      
      // Reject completely missing ID or title properties
      if (!form.hasOwnProperty('id') || !form.hasOwnProperty('title')) {
        return false;
      }

      // Reject empty string IDs (null will be caught in individual validation)
      if ((form as any).id === '') {
        return false;
      }
    }

    return true;
  }

  /**
   * Extract basic form metadata from API form data
   */
  extractFormMetadata(form: any): FormBasicInfo {
    const id = parseInt(form.id, 10);
    if (isNaN(id)) {
      throw new Error(`Invalid form ID: ${form.id}`);
    }
    const title = form.title || '';
    // /forms endpoint only returns active forms, so default to true if is_active field is missing
    const is_active = form.is_active !== undefined 
      ? (form.is_active === '1' || form.is_active === 1 || form.is_active === true)
      : true;

    // Handle is_trash from API response, default to false if not provided
    const is_trash = form.is_trash !== undefined 
      ? (form.is_trash === '1' || form.is_trash === 1 || form.is_trash === true)
      : false;
    
    // Extract entry count - prefer direct entry_count field, then entries array length
    let entry_count = 0;
    if (form.entry_count !== undefined) {
      // Direct entry_count field from API
      const parsed = parseInt(form.entry_count, 10);
      entry_count = isNaN(parsed) ? 0 : parsed;
    } else if (Array.isArray(form.entries)) {
      entry_count = form.entries.length;
    } else if (form.entries) {
      // Handle case where entries might be a number or string
      const parsed = parseInt(form.entries, 10);
      entry_count = isNaN(parsed) ? 0 : parsed;
    }

    return {
      id,
      title,
      is_active,
      is_trash,
      entry_count
    };
  }

  // =====================================
  // Step 5: ID Gap Detection Methods
  // =====================================

  /**
   * Find gaps in ID sequences from min to max ID
   * Uses GRAVITY_FORMS_MIN_FORM_ID environment variable or defaults to lowest existing ID
   */
  findIdGaps(existingIds: number[]): number[] {
    // Validate input
    for (const id of existingIds) {
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Invalid form IDs: must be positive integers');
      }
    }

    // Handle empty input
    if (existingIds.length === 0) {
      return [];
    }

    // Remove duplicates and sort
    const uniqueIds = [...new Set(existingIds)].sort((a, b) => a - b);
    const minId = uniqueIds[0];
    const maxId = uniqueIds[uniqueIds.length - 1];

    // Determine starting ID - use environment variable or default to 1
    const envMinId = process.env.GRAVITY_FORMS_MIN_FORM_ID;
    let startId = 1; // Default
    
    if (envMinId) {
      const parsed = parseInt(envMinId, 10);
      if (!isNaN(parsed) && parsed > 0) {
        startId = parsed;
      } else {
        this.logger.warn('Invalid GRAVITY_FORMS_MIN_FORM_ID environment variable, using default (1)', {
          operation: 'findIdGaps',
          env_value: envMinId,
          fallback_id: 1
        });
      }
    }

    // Find gaps efficiently using Set lookup
    const existingSet = new Set(uniqueIds);
    const gaps: number[] = [];

    // Only check for gaps between configured start ID and max existing ID
    const effectiveStartId = startId;
    for (let id = effectiveStartId; id <= maxId; id++) {
      if (!existingSet.has(id)) {
        gaps.push(id);
      }
    }

    return gaps;
  }

  /**
   * Get maximum form ID from cache
   */
  async getMaxFormId(): Promise<number> {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    const db = this.getDatabase();
    const stmt = db.prepare(`
      SELECT MAX(id) as max_id FROM forms
    `);

    const result = stmt.get() as { max_id: number | null };
    return result.max_id ?? 0;
  }

  /**
   * Get all existing form IDs from cache
   */
  async getExistingFormIds(): Promise<number[]> {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    const db = this.getDatabase();
    const stmt = db.prepare(`
      SELECT id FROM forms ORDER BY id
    `);

    const results = stmt.all() as Array<{ id: number }>;
    return results.map(row => row.id);
  }

  /**
   * Generate probe list from active form IDs (find gaps from 1 to max active ID)
   */
  generateProbeList(activeIds: number[]): number[] {
    // Handle empty input
    if (activeIds.length === 0) {
      return [];
    }

    // Use findIdGaps to get missing IDs
    return this.findIdGaps(activeIds);
  }

  // =====================================
  // Step 6: Individual Form Probing Methods
  // =====================================

  // Configuration constants for error handling and circuit breaker
  private static readonly DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 5;
  private static readonly DEFAULT_MAX_ERROR_HISTORY_SIZE = 100;
  private static readonly DEFAULT_RETRY_BASE_DELAY_MS = 100;
  private static readonly DEFAULT_RETRY_MAX_DELAY_MS = 5000;
  private static readonly DEFAULT_RETRY_JITTER_MS = 50;
  private static readonly DEFAULT_PROBE_DELAY_MS = 100;
  private static readonly DEFAULT_LOG_TRUNCATE_LENGTH = 200;

  private lastProbeStats: ProbeStats = { attempted: 0, found: 0, failed: 0, errors: [] };
  private consecutiveFailures = 0;
  private readonly circuitBreakerThreshold = FormCache.DEFAULT_CIRCUIT_BREAKER_THRESHOLD;
  private readonly maxErrorHistorySize = FormCache.DEFAULT_MAX_ERROR_HISTORY_SIZE;

  /**
   * Add error to statistics with size limit management
   */
  private addErrorToStats(error: string): void {
    this.lastProbeStats.errors.push(error);
    
    // Trim error history if it exceeds limit to prevent memory leaks
    if (this.lastProbeStats.errors.length > this.maxErrorHistorySize) {
      // Keep only the most recent errors
      this.lastProbeStats.errors = this.lastProbeStats.errors.slice(-this.maxErrorHistorySize);
    }
  }

  /**
   * Probe a single form by ID via API
   */
  async probeFormById(id: number, apiCall: ApiCallFunction, updateStats = true): Promise<FormProbeResult> {
    // Validate form ID
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Invalid form ID: must be positive integer');
    }

    try {
      const response = await apiCall(`/forms/${id}`);
      
      // Transform and validate response
      const form = this.transformApiForm(response);
      
      // Cache the discovered form
      const existingForm = await this.getForm(id);
      if (existingForm) {
        await this.updateForm(id, {
          title: form.title,
          entry_count: form.entry_count,
          is_active: form.is_active,
          form_data: form.form_data
        });
      } else {
        await this.insertFormFromApi(response);
      }

      const result = {
        id,
        found: true,
        form
      };

      // Update individual probe stats if requested
      if (updateStats) {
        this.lastProbeStats.attempted++;
        this.lastProbeStats.found++;
        this.consecutiveFailures = 0;
      }

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      let result: FormProbeResult;
      
      // Handle malformed response as an error case
      if (errorMessage.includes('Invalid form ID')) {
        result = {
          id,
          found: false,
          error: 'Invalid form data in API response'
        };
      } else {
        result = {
          id,
          found: false,
          error: errorMessage
        };
      }

      // Update individual probe stats if requested
      if (updateStats) {
        this.lastProbeStats.attempted++;
        this.lastProbeStats.failed++;
        if (result.error) {
          this.addErrorToStats(result.error);
        }
        this.consecutiveFailures++;
      }

      return result;
    }
  }

  /**
   * Probe multiple forms with rate limiting and statistics tracking
   */
  async probeBatch(ids: number[], apiCall: ApiCallFunction, circuitBreakerThreshold?: number): Promise<FormProbeResult[]> {
    // Validate all IDs upfront
    for (const id of ids) {
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Invalid form ID: must be positive integer');
      }
    }

    // Handle empty input
    if (ids.length === 0) {
      return [];
    }

    // Reset stats for this batch
    this.lastProbeStats = { attempted: 0, found: 0, failed: 0, errors: [] };
    const results: FormProbeResult[] = [];

    // Use provided threshold or fall back to instance default
    const effectiveThreshold = circuitBreakerThreshold ?? this.circuitBreakerThreshold;

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      
      // Check circuit breaker
      if (this.consecutiveFailures >= effectiveThreshold) {
        const circuitBreakerError = 'Circuit breaker open - too many consecutive failures';
        const remainingIds = ids.slice(i);
        for (const remainingId of remainingIds) {
          results.push({
            id: remainingId,
            found: false,
            error: circuitBreakerError
          });
          this.lastProbeStats.attempted++;
          this.lastProbeStats.failed++;
          this.addErrorToStats(circuitBreakerError);
        }
        break;
      }

      // Probe individual form (don't update stats here, we handle them in the batch)
      const result = await this.probeFormById(id, apiCall, false);
      results.push(result);

      // Update statistics
      this.lastProbeStats.attempted++;
      if (result.found) {
        this.lastProbeStats.found++;
        this.consecutiveFailures = 0; // Reset circuit breaker
      } else {
        this.lastProbeStats.failed++;
        if (result.error) {
          this.addErrorToStats(result.error);
        }
        this.consecutiveFailures++;
      }

      // Add delay between requests for rate limiting (except last request)
      if (i < ids.length - 1) {
        await this.sleep(FormCache.DEFAULT_PROBE_DELAY_MS);
      }
    }

    return results;
  }

  /**
   * Probe with retry logic and exponential backoff
   */
  async probeWithRetry(id: number, apiCall: ApiCallFunction, maxRetries: number): Promise<FormProbeResult> {
    // Validate parameters
    if (maxRetries < 0) {
      throw new Error('Invalid retry count: must be non-negative');
    }
    if (maxRetries > 5) {
      throw new Error('Max retries too high: maximum is 5');
    }

    let lastError: string | undefined;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.probeFormById(id, apiCall, false);
        
        // Don't retry on 404 - form definitely doesn't exist
        if (!result.found && result.error?.includes('404')) {
          return result;
        }
        
        // Return successful results or non-retryable errors
        if (result.found || !this.isRetryableError(result.error || '')) {
          return result;
        }
        
        lastError = result.error;
        
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
      }

      // Don't sleep after the last attempt
      if (attempt < maxRetries && this.isRetryableError(lastError || '')) {
        const delay = this.calculateBackoffDelay(attempt);
        await this.sleep(delay);
      }
    }

    // All retries exhausted
    return {
      id,
      found: false,
      error: lastError || 'Max retries exceeded'
    };
  }

  /**
   * Get statistics from the last probe operation
   */
  getLastProbeStats(): ProbeStats {
    return { ...this.lastProbeStats };
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: string): boolean {
    const retryableErrors = [
      'ETIMEDOUT',
      'ECONNREFUSED',
      'ENOTFOUND',
      'ECONNRESET',
      '500',
      '502',
      '503',
      '504'
    ];

    return retryableErrors.some(retryable => error.includes(retryable));
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attempt: number): number {
    const exponentialDelay = FormCache.DEFAULT_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
    const jitter = Math.random() * FormCache.DEFAULT_RETRY_JITTER_MS; // Add some jitter
    return Math.min(exponentialDelay + jitter, FormCache.DEFAULT_RETRY_MAX_DELAY_MS); // Cap at max delay
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // =====================================
  // Step 7: Probe Beyond Max Logic Methods
  // =====================================

  /**
   * Probe form IDs beyond the max active ID until consecutive failures
   */
  async probeBeyondMax(
    startId: number, 
    apiCall: ApiCallFunction, 
    options: BeyondMaxOptions = {}
  ): Promise<FormProbeResult[]> {
    // Validate startId parameter
    if (!Number.isInteger(startId) || startId <= 0) {
      throw new Error('Invalid start ID: must be positive integer');
    }

    // Set default options
    const consecutiveFailureThreshold = options.consecutiveFailureThreshold ?? 10;
    const maxProbeLimit = options.maxProbeLimit ?? 1000;
    const probeDelayMs = options.probeDelayMs ?? 100;
    const onProgress = options.onProgress;

    const results: FormProbeResult[] = [];
    let currentId = startId;
    let localConsecutiveFailures = 0;
    let foundCount = 0;

    // Progress tracking
    const reportProgress = (phase: string) => {
      if (onProgress) {
        onProgress({
          phase,
          current: currentId,
          total: undefined, // Don't specify total since method can stop early due to consecutive failures
          found: foundCount
        });
      }
    };

    reportProgress('beyond-max-probing');

    while (results.length < maxProbeLimit && localConsecutiveFailures < consecutiveFailureThreshold) {
      // Probe current ID (don't update global stats, this is beyond-max specific)
      const result = await this.probeFormById(currentId, apiCall, false);
      results.push(result);

      if (result.found) {
        foundCount++;
        localConsecutiveFailures = 0; // Reset local consecutive failure count
        reportProgress('found-form');
      } else {
        localConsecutiveFailures++;
      }

      currentId++;

      // Add delay between requests for rate limiting (avoid delay before exit conditions)
      const shouldContinue = results.length < maxProbeLimit && localConsecutiveFailures < consecutiveFailureThreshold;
      if (shouldContinue) {
        await this.sleep(probeDelayMs);
      }
    }

    reportProgress('completed');
    return results;
  }

  /**
   * Find the highest form ID by probing systematically
   */
  async findHighestFormId(
    apiCall: ApiCallFunction, 
    startId = 1, 
    options: { maxConsecutiveFailures?: number; maxSearchLimit?: number; probeDelayMs?: number } = {}
  ): Promise<number> {
    // Set configurable options with sensible defaults
    const maxConsecutiveFailures = options.maxConsecutiveFailures ?? 10;
    const maxSearchLimit = options.maxSearchLimit ?? 50000; // Much higher but still bounded
    const probeDelayMs = options.probeDelayMs ?? 50;

    let highestFound = 0;
    let currentId = startId;
    let consecutiveFailures = 0;

    while (consecutiveFailures < maxConsecutiveFailures && currentId <= maxSearchLimit) {
      try {
        const result = await this.probeFormById(currentId, apiCall);
        
        if (result.found) {
          highestFound = currentId;
          consecutiveFailures = 0;
        } else {
          consecutiveFailures++;
        }
      } catch (error) {
        consecutiveFailures++;
      }

      currentId++;

      // Add delay to avoid overwhelming API (skip delay before potential exit)
      if (consecutiveFailures < maxConsecutiveFailures && currentId <= maxSearchLimit) {
        await this.sleep(probeDelayMs);
      }
    }

    return highestFound;
  }

  /**
   * Check if the last N results show consecutive failures
   */
  isConsecutiveFailure(results: FormProbeResult[], consecutiveThreshold: number): boolean {
    // Validate threshold
    if (!Number.isInteger(consecutiveThreshold) || consecutiveThreshold <= 0) {
      throw new Error('Invalid threshold: must be positive integer');
    }

    // Handle empty results or threshold larger than results
    if (results.length === 0 || consecutiveThreshold > results.length) {
      return false;
    }

    // Check the last N results for consecutive failures
    const lastResults = results.slice(-consecutiveThreshold);
    return lastResults.every(result => !result.found);
  }

  // =====================================
  // Step 8: Full Discovery Workflow Methods
  // =====================================

  /**
   * Execute complete form discovery and sync workflow
   */
  async syncAllForms(apiCall: ApiCallFunction, options: SyncOptions = {}): Promise<SyncResult> {
    if (!this.isReady()) {
      throw new CacheError('FormCache not initialized', 'NOT_INITIALIZED', {
        operation: 'syncAllForms'
      });
    }

    const startTime = Date.now();
    const errors: string[] = [];
    let discovered = 0;
    let updated = 0;
    let foundCount = 0;

    // Set default options
    const maxProbeFailures = options.maxProbeFailures ?? 10;
    const forceFullSync = options.forceFullSync ?? false;
    const maxCacheAgeMs = options.maxCacheAgeMs ?? (5 * 60 * 1000); // Default 5 minutes
    const onProgress = options.onProgress;

    // Helper to report progress
    const reportProgress = (phase: string, current = 0, total = 0) => {
      if (onProgress) {
        onProgress({ phase, current, total, found: foundCount });
      }
    };

    // Helper to determine if form should be updated
    const shouldUpdateForm = (existing: FormCacheRecord | null, apiForm: any): boolean => {
      if (!existing) {
        return false; // New form, will be inserted
      }
      
      if (forceFullSync) {
        return true; // Force update regardless of cache age
      }
      
      // Check if individual form is stale (use configured cache age)
      const lastSync = new Date(existing.last_synced).getTime();
      const now = Date.now();
      const cacheAge = now - lastSync;
      
      return cacheAge > maxCacheAgeMs;
    };

    try {
      this.logger.info('Starting sync workflow', {
        operation: 'syncAllForms',
        forceFullSync,
        maxProbeFailures
      });

      // Phase 1: Fetch active forms from /forms endpoint
      reportProgress('fetching-active-forms', 0, 0);
      
      let activeForms: FormCacheRecord[];
      let activeFormIds: number[];
      
      try {
        activeForms = await this.fetchActiveForms(apiCall);
        activeFormIds = activeForms.map(f => f.id);
        
        this.logger.debug('Fetched active forms', {
          operation: 'syncAllForms',
          phase: 'fetch-active',
          count: activeForms.length,
          active_ids: activeFormIds.slice(0, 10) // Log first 10 IDs
        });
      } catch (error) {
        // Convert all API errors to SyncError in sync context for consistency
        if (error instanceof ApiError) {
          throw new SyncError(`Sync failed during active forms fetch: ${error.message}`, {
            operation: 'syncAllForms',
            phase: 'fetch-active',
            original_error: error.message,
            http_status: error.httpStatus
          });
        }
        // For other errors, let them propagate normally (will be handled by outer catch)
        throw error;
      }
      
      // Cache active forms and track statistics
      for (const form of activeForms) {
        const existing = await this.getForm(form.id);
        if (shouldUpdateForm(existing, form)) {
          await this.updateForm(form.id, {
            title: form.title,
            entry_count: form.entry_count,
            is_active: form.is_active,
            form_data: form.form_data
          });
          updated++;
        } else if (!existing) {
          await this.insertForm({
            id: form.id,
            title: form.title,
            entry_count: form.entry_count,
            is_active: form.is_active,
            form_data: form.form_data
          });
        }
        discovered++; // Count all processed forms
        foundCount++;
      }

      // Phase 2: Detect ID gaps and probe missing IDs
      reportProgress('probing-gaps', 0, 0);
      
      if (activeFormIds.length > 0) {
        const gapIds = this.generateProbeList(activeFormIds);
        
        if (gapIds.length > 0) {
          try {
            const gapResults = await this.probeBatch(gapIds, apiCall, maxProbeFailures);
            
            for (const result of gapResults) {
              if (result.found && result.form) {
                // Form is already cached by probeFormById, just track statistics
                discovered++; // Count all processed forms in this sync
                foundCount++;
              } else if (result.error && !result.error.includes('404')) {
                // Only collect non-404 errors as 404s are expected for gap probing
                errors.push(`Gap probe ${result.id}: ${result.error}`);
              }
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`Gap probing failed: ${message}`);
          }
        }
      }

      // Phase 3: Probe beyond max active ID (or starting from 1 if no active forms)
      reportProgress('beyond-max-probing', 0, 0);
      
      let beyondMaxStartId = 1; // Default starting point
      if (activeFormIds.length > 0) {
        const maxActiveId = Math.max(...activeFormIds);
        beyondMaxStartId = maxActiveId + 1;
      }
        
      try {
        const beyondMaxResults = await this.probeBeyondMax(beyondMaxStartId, apiCall, {
          consecutiveFailureThreshold: maxProbeFailures,
          maxProbeLimit: 100, // Reasonable limit for beyond-max probing
          probeDelayMs: 100,
          onProgress: (progress) => {
            foundCount = discovered + progress.found;
            reportProgress('beyond-max-probing', progress.current, progress.total);
          }
        });

        for (const result of beyondMaxResults) {
          if (result.found && result.form) {
            // Form is already cached by probeFormById, just track statistics
            discovered++; // Count all processed forms in this sync
            foundCount++;
          } else if (result.error && !result.error.includes('404')) {
            // Don't log 404 errors as they're expected, but collect others (like 500 Server Error)
            errors.push(`Beyond-max probe ${result.id}: ${result.error}`);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Beyond-max probing failed: ${message}`);
      }

      // Phase 4: Update database (already done incrementally above)
      reportProgress('updating-database', discovered, discovered);

      // Phase 5: Clean up stale cache entries would go here in future versions

      // Phase 6: Mark completion
      reportProgress('completed', discovered, discovered);

      // Record full sync timestamp if this was a comprehensive sync
      if (forceFullSync) {
        this.recordLastFullSync();
      }

      const endTime = Date.now();
      return {
        discovered,
        updated,
        errors,
        duration: endTime - startTime,
        lastSyncTime: new Date(endTime)
      };

    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      
      this.logger.error('Sync workflow failed', {
        operation: 'syncAllForms',
        duration,
        discovered,
        updated,
        error: message,
        error_type: error instanceof Error ? error.constructor.name : 'Unknown'
      });

      // If it's already a SyncError, re-throw it
      if (error instanceof SyncError) {
        throw error;
      }
      
      // If it's another CacheError, add to errors and return partial results  
      if (error instanceof CacheError) {
        errors.push(`Sync workflow failed: ${message}`);
      } else {
        // Classify unknown errors as sync errors
        errors.push(`Sync workflow failed: ${message}`);
        
        // Only throw SyncError for critical failures, return partial results for recoverable issues
        if (discovered === 0 && updated === 0) {
          throw new SyncError(`Complete sync failure: ${message}`, {
            operation: 'syncAllForms',
            duration,
            original_error: message
          });
        }
      }
      
      return {
        discovered,
        updated,
        errors,
        duration,
        lastSyncTime: new Date(endTime)
      };
    }
  }

  /**
   * Perform initial comprehensive sync (first-time setup)
   */
  async performInitialSync(apiCall: ApiCallFunction, maxCacheAgeMs?: number): Promise<SyncResult> {
    return this.syncAllForms(apiCall, { 
      forceFullSync: true,
      maxProbeFailures: 10,
      maxCacheAgeMs
    });
  }

  /**
   * Perform incremental sync (update existing cache)
   */
  async performIncrementalSync(apiCall: ApiCallFunction, maxCacheAgeMs?: number): Promise<SyncResult> {
    return this.syncAllForms(apiCall, { 
      forceFullSync: false,
      maxProbeFailures: 5, // Less aggressive for incremental
      maxCacheAgeMs
    });
  }

  /**
   * Perform hybrid sync - intelligently chooses incremental vs full sync
   */
  async performHybridSync(apiCall: ApiCallFunction, fullSyncIntervalHours = 24, maxCacheAgeMs?: number): Promise<SyncResult> {
    const needsFull = this.needsFullSync(fullSyncIntervalHours);
    
    if (needsFull) {
      const lastFullSync = this.getLastFullSync();
      this.logger.info('Performing full sync due to interval', {
        operation: 'performHybridSync',
        fullSyncIntervalHours,
        lastFullSync
      });
      return this.performInitialSync(apiCall, maxCacheAgeMs);
    } else {
      this.logger.debug('Performing incremental sync', {
        operation: 'performHybridSync',
        fullSyncIntervalHours
      });
      return this.performIncrementalSync(apiCall, maxCacheAgeMs);
    }
  }

  /**
   * Get current sync status and cache information
   */
  async getSyncStatus(): Promise<SyncStatus> {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    const db = this.getDatabase();

    // Get form counts
    const totalForms = await this.getFormCount();
    const activeForms = await this.getFormCount(true);
    const inactiveForms = totalForms - activeForms;

    // Get most recent sync time
    const lastSyncResult = db.prepare(`
      SELECT MAX(last_synced) as last_sync FROM forms
    `).get() as { last_sync: string | null };

    const lastSyncTime = lastSyncResult.last_sync ? new Date(lastSyncResult.last_sync) : null;
    
    // Calculate cache age and determine if sync needed
    const now = Date.now();
    const cacheAge = lastSyncTime ? now - lastSyncTime.getTime() : Infinity;
    const maxCacheAge = 60 * 60 * 1000; // 1 hour in milliseconds
    const needsSync = totalForms === 0 || cacheAge > maxCacheAge;

    return {
      totalForms,
      activeForms,
      inactiveForms,
      lastSyncTime,
      cacheAge: cacheAge === Infinity ? 0 : cacheAge,
      needsSync
    };
  }

  // =====================================
  // Step 9: Cache Management Methods
  // =====================================

  /**
   * Determine if cache is stale based on age threshold
   */
  async isStale(maxAge?: number): Promise<boolean> {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    const db = this.getDatabase();
    
    // Default maxAge is 1 hour (as specified in requirements)
    const maxAgeMs = maxAge ?? (60 * 60 * 1000);
    
    // Get the most recent sync time
    const lastSyncResult = db.prepare(`
      SELECT MAX(last_synced) as last_sync FROM forms
    `).get() as { last_sync: string | null };

    // If no forms exist, consider cache stale
    if (!lastSyncResult.last_sync) {
      return true;
    }

    const lastSyncTime = new Date(lastSyncResult.last_sync).getTime();
    const now = Date.now();
    const cacheAge = now - lastSyncTime;

    return cacheAge > maxAgeMs;
  }

  /**
   * Invalidate cache (all forms or specific form)
   */
  async invalidateCache(formId?: number): Promise<void> {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    const db = this.getDatabase();

    if (formId !== undefined) {
      // Invalidate specific form
      db.prepare('DELETE FROM forms WHERE id = ?').run(formId);
    } else {
      // Invalidate all cache
      db.prepare('DELETE FROM forms').run();
    }
  }

  /**
   * Refresh cache by performing a full sync
   */
  async refreshCache(apiCall: ApiCallFunction): Promise<SyncResult> {
    // Use the existing full sync workflow with force enabled
    return this.syncAllForms(apiCall, { forceFullSync: true });
  }

  /**
   * Get comprehensive cache statistics
   */
  async getCacheStats(): Promise<CacheStats> {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    const db = this.getDatabase();

    // Get form counts
    const totalForms = await this.getFormCount();
    const activeCount = await this.getFormCount(true);

    // Get sync time statistics
    const syncStatsResult = db.prepare(`
      SELECT 
        MAX(last_synced) as last_sync,
        MIN(last_synced) as oldest_entry,
        MAX(last_synced) as newest_entry
      FROM forms
    `).get() as {
      last_sync: string | null;
      oldest_entry: string | null;
      newest_entry: string | null;
    };

    const lastSync = syncStatsResult.last_sync ? new Date(syncStatsResult.last_sync) : null;
    const oldestEntry = syncStatsResult.oldest_entry ? new Date(syncStatsResult.oldest_entry) : null;
    const newestEntry = syncStatsResult.newest_entry ? new Date(syncStatsResult.newest_entry) : null;

    return {
      totalForms,
      activeCount,
      lastSync,
      hitRate: 0, // Simple implementation - no hit tracking yet
      oldestEntry,
      newestEntry
    };
  }

  /**
   * Clean up stale data older than maxAge
   */
  async cleanupStaleData(maxAge: number): Promise<number> {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    const db = this.getDatabase();
    const cutoffTime = new Date(Date.now() - maxAge).toISOString();

    const result = db.prepare(`
      DELETE FROM forms 
      WHERE last_synced < ?
    `).run(cutoffTime);

    return result.changes;
  }

  // =====================================
  // Step 10: Hybrid Sync Metadata Methods
  // =====================================

  /**
   * Set sync metadata value
   */
  private setSyncMetadata(key: string, value: string): void {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    const db = this.getDatabase();
    db.prepare(`
      INSERT OR REPLACE INTO sync_metadata (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).run(key, value);
  }

  /**
   * Get sync metadata value
   */
  private getSyncMetadata(key: string): string | null {
    if (!this.isReady()) {
      throw new Error('FormCache not initialized');
    }

    const db = this.getDatabase();
    const result = db.prepare(`
      SELECT value FROM sync_metadata WHERE key = ?
    `).get(key) as { value: string } | undefined;

    return result ? result.value : null;
  }

  /**
   * Record last full sync timestamp
   */
  recordLastFullSync(): void {
    this.setSyncMetadata('last_full_sync', new Date().toISOString());
  }

  /**
   * Get last full sync timestamp
   */
  getLastFullSync(): Date | null {
    const timestamp = this.getSyncMetadata('last_full_sync');
    return timestamp ? new Date(timestamp) : null;
  }

  /**
   * Check if full sync is needed based on interval
   */
  needsFullSync(intervalHours: number): boolean {
    const lastFullSync = this.getLastFullSync();
    if (!lastFullSync) {
      return true; // No full sync recorded, need one
    }

    const now = Date.now();
    const intervalMs = intervalHours * 60 * 60 * 1000;
    const timeSinceFullSync = now - lastFullSync.getTime();

    return timeSinceFullSync > intervalMs;
  }
}