// ABOUTME: FormCache class for comprehensive form caching and discovery
// ABOUTME: Manages SQLite schema, form storage, and database operations

import { DatabaseManager } from './database.js';
import Database from 'better-sqlite3';

const CURRENT_SCHEMA_VERSION = 1;

// Type for API call function
export type ApiCallFunction = (endpoint: string) => Promise<any>;

// Interface for basic form metadata extraction
export interface FormBasicInfo {
  id: number;
  title: string;
  is_active: boolean;
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

  // =====================================
  // Step 4: Active Forms Fetching Methods
  // =====================================

  /**
   * Fetch all active forms from the API and transform them to cache format
   */
  async fetchActiveForms(apiCall: ApiCallFunction): Promise<FormCacheRecord[]> {
    try {
      const response = await apiCall('/forms');
      
      // Validate response format
      if (!this.validateApiResponse(response)) {
        throw new Error('Invalid API response format');
      }

      // Transform each API form to cache format
      const cacheRecords: FormCacheRecord[] = [];
      
      for (const apiForm of response) {
        // Individual form validation (null IDs will be caught in extractFormMetadata)
        const cacheRecord = this.transformApiForm(apiForm);
        cacheRecords.push(cacheRecord);
      }

      return cacheRecords;
      
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch active forms: ${message}`);
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
      last_synced: new Date().toISOString(),
      form_data: JSON.stringify(apiForm)
    };
  }

  /**
   * Validate API response format
   */
  validateApiResponse(response: any): boolean {
    // Must be an array
    if (!Array.isArray(response)) {
      return false;
    }

    // Empty array is valid
    if (response.length === 0) {
      return true;
    }

    // Check each element is an object and has basic structure
    for (const form of response) {
      if (typeof form !== 'object' || form === null) {
        return false;
      }
      
      // Reject completely missing ID or title properties
      if (!form.hasOwnProperty('id') || !form.hasOwnProperty('title')) {
        return false;
      }

      // Reject empty string IDs (null will be caught in individual validation)
      if (form.id === '') {
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
    const is_active = form.is_active === '1' || form.is_active === 1 || form.is_active === true;
    
    // Extract entry count from entries array if present
    let entry_count = 0;
    if (Array.isArray(form.entries)) {
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
      entry_count
    };
  }

  // =====================================
  // Step 5: ID Gap Detection Methods
  // =====================================

  /**
   * Find gaps in ID sequences from 1 to max ID
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
    const maxId = uniqueIds[uniqueIds.length - 1];

    // Find gaps efficiently using Set lookup
    const existingSet = new Set(uniqueIds);
    const gaps: number[] = [];

    for (let id = 1; id <= maxId; id++) {
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

    const results = stmt.all() as { id: number }[];
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

  private lastProbeStats: ProbeStats = { attempted: 0, found: 0, failed: 0, errors: [] };
  private consecutiveFailures = 0;
  private circuitBreakerThreshold = 5;

  /**
   * Probe a single form by ID via API
   */
  async probeFormById(id: number, apiCall: ApiCallFunction): Promise<FormProbeResult> {
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

      return {
        id,
        found: true,
        form
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Handle malformed response as an error case
      if (errorMessage.includes('Invalid form ID')) {
        return {
          id,
          found: false,
          error: 'Invalid form data in API response'
        };
      }

      return {
        id,
        found: false,
        error: errorMessage
      };
    }
  }

  /**
   * Probe multiple forms with rate limiting and statistics tracking
   */
  async probeBatch(ids: number[], apiCall: ApiCallFunction): Promise<FormProbeResult[]> {
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

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      
      // Check circuit breaker
      if (this.consecutiveFailures >= this.circuitBreakerThreshold) {
        const remainingIds = ids.slice(i);
        for (const remainingId of remainingIds) {
          results.push({
            id: remainingId,
            found: false,
            error: 'Circuit breaker open - too many consecutive failures'
          });
          this.lastProbeStats.attempted++;
          this.lastProbeStats.failed++;
        }
        break;
      }

      // Probe individual form
      const result = await this.probeFormById(id, apiCall);
      results.push(result);

      // Update statistics
      this.lastProbeStats.attempted++;
      if (result.found) {
        this.lastProbeStats.found++;
        this.consecutiveFailures = 0; // Reset circuit breaker
      } else {
        this.lastProbeStats.failed++;
        if (result.error) {
          this.lastProbeStats.errors.push(result.error);
        }
        this.consecutiveFailures++;
      }

      // Add delay between requests for rate limiting (except last request)
      if (i < ids.length - 1) {
        await this.sleep(100);
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
        const result = await this.probeFormById(id, apiCall);
        
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
    const baseDelay = 100; // 100ms base delay
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 50; // Add some jitter
    return Math.min(exponentialDelay + jitter, 5000); // Cap at 5 seconds
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
          total: maxProbeLimit,
          found: foundCount
        });
      }
    };

    reportProgress('beyond-max-probing');

    while (results.length < maxProbeLimit && localConsecutiveFailures < consecutiveFailureThreshold) {
      // Probe current ID
      const result = await this.probeFormById(currentId, apiCall);
      results.push(result);

      if (result.found) {
        foundCount++;
        localConsecutiveFailures = 0; // Reset local consecutive failure count
        this.consecutiveFailures = 0; // Reset circuit breaker
        reportProgress('found-form');
      } else {
        localConsecutiveFailures++;
        this.consecutiveFailures++; // Update circuit breaker state
      }

      // Check circuit breaker after probing (this.consecutiveFailures is now properly updated)
      if (this.consecutiveFailures >= this.circuitBreakerThreshold) {
        // Circuit breaker triggered - add error messages for remaining attempts up to maxProbeLimit
        while (results.length < maxProbeLimit) {
          results.push({
            id: currentId + 1,
            found: false,
            error: 'Circuit breaker open - too many consecutive failures'
          });
          currentId++;
        }
        break;
      }

      currentId++;

      // Add delay between requests for rate limiting (except last request)  
      if (results.length < maxProbeLimit && localConsecutiveFailures < consecutiveFailureThreshold) {
        await this.sleep(probeDelayMs);
      }
    }

    reportProgress('completed');
    return results;
  }

  /**
   * Find the highest form ID by probing systematically
   */
  async findHighestFormId(apiCall: ApiCallFunction, startId: number = 1): Promise<number> {
    let highestFound = 0;
    let currentId = startId;
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = 10;

    while (consecutiveFailures < maxConsecutiveFailures && currentId <= 10000) {
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

      // Add small delay to avoid overwhelming API
      await this.sleep(50);
    }

    return highestFound;
  }

  /**
   * Check if the last N results show consecutive failures
   */
  isConsecutiveFailure(results: FormProbeResult[], consecutiveThreshold: number): boolean {
    // Validate threshold
    if (consecutiveThreshold <= 0) {
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
}