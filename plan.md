# Complete Form Tracking Database - TDD Implementation Plan

## Overview

The Gravity Forms REST API `/forms` endpoint only returns active forms, missing inactive/trashed forms. We need to implement a local database cache that can discover and track ALL forms (active and inactive) by probing the API systematically.

## Problem Statement

**Current Issue:** The API `/forms` endpoint only returns active forms. Tools like `get_forms`, `list_form_templates`, and `FormImporter` miss inactive/trashed forms, creating incomplete functionality.

**Affected Tools:**
- `get_forms` - Missing inactive forms in listings
- `list_form_templates` - Missing inactive template forms  
- `FormImporter.detectConflicts()` - Incomplete conflict detection
- Any functionality relying on complete form discovery

## Architecture Design

### Core Components
1. **FormCache** - SQLite-based local cache for all forms
2. **FormDiscovery** - Algorithm to find all forms including inactive ones
3. **Enhanced Tools** - Modified tools with `include_all` parameter

### Database Schema
```sql
CREATE TABLE forms (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  entry_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  form_data TEXT -- JSON blob for caching full form data
);

CREATE INDEX idx_forms_active ON forms(is_active);
CREATE INDEX idx_forms_last_synced ON forms(last_synced);
```

### Discovery Algorithm
1. **Initial Sync**: Get active forms from `/forms` endpoint
2. **Gap Detection**: Identify missing IDs from 1 to max_active_id  
3. **Individual Probing**: Query each missing ID via `/forms/{id}`
4. **Beyond-Max Probing**: Continue beyond max_active_id until consecutive failures
5. **Caching**: Store all discovered forms with metadata

### Tool Enhancement Strategy
- **Backward Compatible**: Default behavior unchanged (`include_all=false`)
- **Opt-in Complete Access**: Use `include_all=true` to access all forms from cache
- **Auto-Sync**: Cache updates automatically when accessed

## Implementation Strategy

### Phase Breakdown
1. **Foundation** (Steps 1-3): Database setup and basic operations
2. **Discovery Engine** (Steps 4-6): Form discovery algorithms  
3. **Cache Management** (Steps 7-9): Sync and invalidation logic
4. **Tool Integration** (Steps 10-12): Enhanced tools with `include_all` support
5. **Polish** (Steps 13-15): Error handling, optimization, and testing

## Detailed Implementation Steps

### Step 1: Add SQLite Dependency and Database Foundation ✅ **COMPLETED**

**Goal**: Set up SQLite infrastructure and basic database connection.

**TDD Prompt:**
```
Set up SQLite database infrastructure for form caching:

1. Add better-sqlite3 dependency to package.json
2. Create utils/database.ts with basic SQLite connection management
3. Write tests for database initialization and connection handling
4. Implement database file creation in ./data/ directory
5. Add proper cleanup and error handling for database operations
6. Ensure database file is gitignored but data directory structure is preserved

Write tests first that verify:
- Database file creation and connection
- Proper error handling for file permissions
- Database cleanup and connection closing
- Directory creation if ./data/ doesn't exist

Keep implementation minimal but robust.
```

### Step 2: Create FormCache Class with Database Schema ✅ **COMPLETED**

**Goal**: Create the main FormCache class with table schema management.

**TDD Prompt:**
```
Create FormCache class with database schema management:

1. Write tests for FormCache class that can:
   - Initialize database with proper forms table schema
   - Handle schema migrations if table structure changes  
   - Create proper indexes for performance
   - Manage database lifecycle (open/close connections)
   - Handle database file corruption gracefully

2. Implement FormCache class in utils/formCache.ts with methods:
   - constructor(dbPath?: string) - custom db location for testing
   - init(): Promise<void> - initialize database and schema
   - close(): Promise<void> - clean shutdown
   - isReady(): boolean - connection status check

3. Schema requirements:
   - id (INTEGER PRIMARY KEY)
   - title (TEXT NOT NULL)  
   - entry_count (INTEGER DEFAULT 0)
   - is_active (BOOLEAN DEFAULT true)
   - last_synced (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
   - form_data (TEXT) -- JSON blob

4. Add proper indexes for common queries

Test with both in-memory databases for testing and file databases for integration.
```

### Step 3: Add Basic CRUD Operations ✅ **COMPLETED**

**Goal**: Implement fundamental database operations for forms data.

**TDD Prompt:**
```
Implement basic CRUD operations for FormCache:

1. Write tests for CRUD methods that can:
   - Insert new form records with validation
   - Update existing form records (title, entry_count, is_active, form_data)
   - Query single forms by ID
   - Query all forms with optional filtering (active/inactive)
   - Delete forms by ID
   - Handle concurrent access safely with transactions

2. Implement methods in FormCache class:
   - insertForm(form: FormCacheRecord): Promise<void>
   - updateForm(id: number, updates: Partial<FormCacheRecord>): Promise<void>
   - getForm(id: number): Promise<FormCacheRecord | null>
   - getAllForms(activeOnly?: boolean): Promise<FormCacheRecord[]>
   - deleteForm(id: number): Promise<void>
   - getFormCount(activeOnly?: boolean): Promise<number>

3. Create interfaces:
   - FormCacheRecord with all database fields
   - FormCacheInsert for insertions (without auto fields)
   - FormCacheUpdate for updates (optional fields)

4. Add proper SQL prepared statements for performance and security
5. Test edge cases: missing IDs, duplicate insertions, invalid data
```

### Step 4: Implement Active Forms Fetching ✅ **COMPLETED**

**Goal**: Create method to fetch active forms from Gravity Forms API.

**TDD Prompt:**
```
Add active forms fetching capability to FormCache:

1. Write tests for active forms fetching that can:
   - Fetch all active forms from /forms endpoint
   - Parse and validate API response data
   - Handle API errors gracefully (timeouts, 401, 500, etc.)
   - Extract essential form metadata (id, title, entry count)
   - Handle rate limiting with backoff
   - Transform API response to FormCacheRecord format

2. Add FormCache method:
   - fetchActiveForms(apiCall: ApiCallFunction): Promise<FormCacheRecord[]>
   - Accept API function to maintain existing patterns
   - Return standardized form records ready for database storage

3. Add utility methods:
   - transformApiForm(apiForm: any): FormCacheRecord
   - validateApiResponse(response: any): boolean
   - extractFormMetadata(form: any): FormBasicInfo

4. Test with mocked API responses:
   - Successful response with multiple forms
   - Empty response (no forms)
   - Malformed response data
   - API error scenarios (network, auth, rate limits)

Integrate with existing API call patterns in the main server class.
```

### Step 5: Add ID Gap Detection Algorithm ✅ **COMPLETED**

**Goal**: Implement logic to identify missing form IDs in sequences.

**TDD Prompt:**
```
Implement ID gap detection for form discovery:

1. Write tests for gap detection that can:
   - Find gaps in ID sequences: [1, 2, 4, 7] → returns [3, 5, 6]  
   - Handle edge cases: empty arrays, no gaps, single elements
   - Work efficiently with large ID ranges (1000+ forms)
   - Find gaps from 1 to max_id, not just between existing IDs
   - Handle negative IDs and invalid inputs gracefully

2. Add methods to FormCache:
   - findIdGaps(existingIds: number[]): number[]
   - getMaxFormId(): Promise<number>
   - getExistingFormIds(): Promise<number[]>
   - generateProbeList(activeIds: number[]): number[]

3. Algorithm requirements:
   - Start from ID 1 (Gravity Forms standard)
   - End at max_active_id from API response
   - Return sorted array of missing IDs
   - Optimize for memory usage with large ranges

4. Test scenarios:
   - Normal gaps: [1, 3, 5] → find [2, 4]
   - No gaps: [1, 2, 3, 4] → find []
   - Large ranges: test with IDs up to 1000+
   - Invalid inputs: negative numbers, duplicates, non-integers

Keep the algorithm efficient - avoid creating huge arrays in memory.
```

### Step 6: Implement Individual Form Probing ✅ **COMPLETED**

**Goal**: Add capability to fetch individual forms by ID for discovery.

**TDD Prompt:**
```
Add individual form probing for inactive form discovery:

1. Write tests for form probing that can:
   - Fetch individual forms by ID via /forms/{id} endpoint
   - Handle 404 responses (form doesn't exist) gracefully
   - Handle 200 responses (found inactive form)  
   - Distinguish between different error types (404, 403, 500, timeout)
   - Implement retry logic with exponential backoff
   - Track probe statistics (success/failure counts)

2. Add FormCache methods:
   - probeFormById(id: number, apiCall: ApiCallFunction): Promise<FormProbeResult>
   - probeBatch(ids: number[], apiCall: ApiCallFunction): Promise<FormProbeResult[]>
   - probeWithRetry(id: number, apiCall: ApiCallFunction, maxRetries: number): Promise<FormProbeResult>

3. Create interfaces:
   - FormProbeResult { id: number, found: boolean, form?: FormCacheRecord, error?: string }
   - ProbeStats { attempted: number, found: number, failed: number, errors: string[] }

4. Test scenarios:
   - Successful probe finding inactive form
   - 404 response (form not found)
   - API errors (500, timeout, auth)
   - Network failures and retries
   - Rate limiting responses

5. Add rate limiting protection:
   - Delay between requests
   - Circuit breaker for repeated failures
   - Respect API rate limits

The goal is reliable discovery of inactive forms without overwhelming the API.
```

### Step 7: Add Probe Beyond Max Logic

**Goal**: Discover forms beyond the highest known active form ID.

**TDD Prompt:**
```
Implement beyond-max probing for complete form discovery:

1. Write tests for beyond-max probing that can:
   - Continue probing form IDs beyond max active ID
   - Stop after N consecutive failures (configurable, default 10)
   - Handle the boundary case efficiently  
   - Track progress and provide status updates
   - Implement reasonable upper bounds to prevent infinite loops
   - Handle API rate limiting during extensive probing

2. Add FormCache methods:
   - probeBeyondMax(startId: number, apiCall: ApiCallFunction): Promise<FormProbeResult[]>
   - findHighestFormId(apiCall: ApiCallFunction): Promise<number>
   - isConsecutiveFailure(results: FormProbeResult[], consecutiveThreshold: number): boolean

3. Configuration options:
   - MAX_CONSECUTIVE_FAILURES: number (default 10)
   - MAX_PROBE_LIMIT: number (default 1000 beyond max active)
   - PROBE_DELAY_MS: number (default 100ms between requests)

4. Test scenarios:
   - Find forms beyond max active ID
   - Stop at consecutive failure threshold
   - Handle large gaps efficiently  
   - Respect maximum probe limits
   - Rate limiting during extensive probing

5. Add progress tracking:
   - onProgress callback for status updates
   - Statistics on forms found beyond max
   - Performance metrics (requests per second)

Balance thoroughness with API protection - avoid overwhelming the server.
```

### Step 8: Integrate Full Discovery Workflow

**Goal**: Combine all discovery methods into complete sync workflow.

**TDD Prompt:**
```
Create complete form discovery and sync workflow:

1. Write tests for full discovery workflow that can:
   - Execute complete discovery process end-to-end
   - Handle partial failures gracefully (some probes fail, continue with others)
   - Maintain data consistency during sync process
   - Track comprehensive sync statistics and progress
   - Handle interruption and resumption of sync process
   - Update existing cached forms and add new discoveries

2. Add FormCache methods:
   - syncAllForms(apiCall: ApiCallFunction, options?: SyncOptions): Promise<SyncResult>
   - performInitialSync(apiCall: ApiCallFunction): Promise<SyncResult> 
   - performIncrementalSync(apiCall: ApiCallFunction): Promise<SyncResult>
   - getSyncStatus(): Promise<SyncStatus>

3. Create interfaces:
   - SyncOptions { forceFullSync?: boolean, maxProbeFailures?: number, onProgress?: (status: SyncProgress) => void }
   - SyncResult { discovered: number, updated: number, errors: string[], duration: number, lastSyncTime: Date }
   - SyncProgress { phase: string, current: number, total: number, found: number }

4. Sync workflow phases:
   - Phase 1: Fetch active forms from /forms
   - Phase 2: Detect ID gaps and probe missing IDs  
   - Phase 3: Probe beyond max active ID
   - Phase 4: Update database with discoveries
   - Phase 5: Clean up stale cache entries

5. Test integration scenarios:
   - Complete first-time sync with mixed active/inactive forms
   - Incremental sync finding only new forms
   - Sync with various API failure scenarios
   - Performance with large form datasets (100+ forms)
   - Database transaction handling during sync

Ensure the workflow is robust and can recover from partial failures.
```

### Step 9: Add Cache Management and Invalidation

**Goal**: Implement cache freshness and invalidation logic.

**TDD Prompt:**
```
Add cache management features for data freshness:

1. Write tests for cache management that can:
   - Determine when cache data is stale based on timestamps
   - Force cache refresh regardless of timestamps
   - Implement selective invalidation (specific forms vs. all)
   - Track cache hit/miss statistics
   - Handle cache corruption and recovery
   - Manage cache size and implement cleanup policies

2. Add FormCache methods:
   - isStale(maxAge?: number): Promise<boolean>
   - invalidateCache(formId?: number): Promise<void>
   - refreshCache(apiCall: ApiCallFunction): Promise<SyncResult>
   - getCacheStats(): Promise<CacheStats>  
   - cleanupStaleData(maxAge: number): Promise<number>

3. Create interfaces:
   - CacheStats { totalForms: number, activeCount: number, lastSync: Date, hitRate: number }
   - CacheConfig { maxAge: number, cleanupInterval: number, maxSize: number }

4. Cache policies:
   - Default cache lifetime: 1 hour  
   - Automatic cleanup of very old data (> 30 days)
   - Size limits to prevent unbounded growth
   - Background refresh for frequently accessed data

5. Test scenarios:
   - Cache expiration and auto-refresh
   - Manual cache invalidation
   - Selective form invalidation
   - Cache statistics tracking
   - Cleanup of stale data

6. Add configuration options:
   - CACHE_MAX_AGE_SECONDS (default 3600)
   - CACHE_CLEANUP_INTERVAL_SECONDS (default 86400)  
   - CACHE_MAX_SIZE_FORMS (default 10000)

Enable smart caching that balances freshness with performance.
```

### Step 10: Enhance get_forms Tool with include_all Support

**Goal**: Add complete form access to get_forms tool with backward compatibility.

**TDD Prompt:**
```
Enhance get_forms tool to support complete form access:

1. Write tests for enhanced get_forms tool that can:
   - Maintain backward compatibility (default behavior unchanged)
   - Support include_all=true to return all forms from cache
   - Support include_all=false to use original API behavior (default)
   - Handle cache miss scenarios (auto-sync if cache empty/stale)
   - Properly validate the include_all parameter
   - Return appropriate error messages for cache/sync failures

2. Modify existing get_forms tool:
   - Update tool schema to include include_all: boolean parameter (optional, default false)
   - Update getForms() method implementation to check include_all flag
   - Integrate with FormCache for complete form access
   - Maintain existing API-only behavior as default

3. Implementation logic:
   ```
   if include_all === true:
     - Check if cache is available and not too stale
     - If cache stale/empty, perform sync
     - Return all forms from cache
   else:
     - Use existing API-only behavior (unchanged)
   ```

4. Test scenarios:
   - include_all=false: verify original behavior unchanged
   - include_all=true with fresh cache: return cached data
   - include_all=true with stale cache: auto-sync then return
   - include_all=true with sync failures: handle gracefully
   - include_all parameter validation and error handling
   - Specific form_id with include_all (should work from cache)

5. Error handling:
   - Cache initialization failures
   - Sync failures when cache is stale
   - Network issues during auto-sync
   - Database errors during cache access

Ensure tool remains simple to use while adding powerful new capability.
```

### Step 11: Enhance list_form_templates Tool with include_all Support  

**Goal**: Add complete template access including inactive template forms.

**TDD Prompt:**
```
Enhance list_form_templates tool to access all template forms:

1. Write tests for enhanced template listing that can:
   - Support include_all=true to search all cached forms (active + inactive)
   - Support include_all=false for original API-only behavior (default)
   - Find template forms (those ending with '-template') in cache
   - Handle template detection on cached form data
   - Maintain all existing filtering and sorting functionality
   - Auto-sync cache when needed for include_all=true

2. Modify list_form_templates tool:
   - Add include_all: boolean parameter to tool schema (optional, default false)
   - Update listFormTemplates() method to use cache when include_all=true
   - Integrate FormCache with TemplateManager for cached template discovery

3. Update TemplateManager integration:
   - Modify TemplateManager.listTemplates() to accept optional forms array
   - When forms provided, skip API call and use provided data
   - Maintain backward compatibility when no forms array provided
   - Ensure template detection works on cached form data

4. Implementation flow:
   ```
   if include_all === true:
     - Ensure cache is fresh (auto-sync if needed)
     - Get all forms from cache  
     - Pass forms array to TemplateManager.listTemplates()
   else:
     - Use existing API-only behavior (TemplateManager calls API directly)
   ```

5. Test scenarios:
   - include_all=false: verify original behavior (API-only template discovery)
   - include_all=true: find templates from cache including inactive ones
   - Template detection on cached vs. API data (should be identical)
   - Cache auto-sync when accessing with include_all=true
   - Mixed active/inactive templates in cache
   - Error handling: cache failures, sync failures

6. Verify template workflow:
   - Create template form → make it inactive → verify include_all=true finds it
   - Ensure template filtering/sorting works with cached data
   - Confirm performance improvement with cached access

This enables complete template discovery including previously hidden inactive templates.
```

### Step 12: Integrate FormCache with FormImporter  

**Goal**: Enable FormImporter to detect conflicts with all forms including inactive ones.

**TDD Prompt:**
```
Integrate FormCache with FormImporter for complete conflict detection:

1. Write tests for enhanced conflict detection that can:
   - Detect title conflicts with both active and inactive forms
   - Use cached form data when available to reduce API calls
   - Fall back to API calls when cache unavailable
   - Handle mixed scenarios (some forms in cache, others need API calls)
   - Provide option to use complete form discovery in conflict detection

2. Modify FormImporter class:
   - Add optional FormCache parameter to constructor  
   - Update detectConflicts() method to use cache when available
   - Update resolveConflicts() method to leverage cached form data
   - Maintain backward compatibility when FormCache not provided

3. Enhanced conflict detection logic:
   ```
   detectConflicts(importedForm, useCompleteDiscovery=false):
     if useCompleteDiscovery and formCache available:
       - Get all forms from cache (auto-sync if stale)
       - Check conflicts against complete form list
     else:
       - Use existing API-only conflict detection
   ```

4. Update server integration:
   - Initialize FormCache in GravityFormsMCPServer constructor  
   - Pass FormCache instance to FormImporter when initializing
   - Add configuration option for complete conflict detection

5. Test scenarios:
   - Conflict with active form (should work in both modes)
   - Conflict with inactive form (only detected with complete discovery)
   - Performance comparison: cache vs. API-only conflict detection
   - Mixed conflict scenarios with multiple forms
   - Error handling when cache unavailable but requested

6. Add tool enhancements:
   - Consider adding use_complete_discovery parameter to import_form_json tool
   - Document the improved conflict detection capability
   - Ensure backward compatibility with existing import workflows

This ensures import operations have complete visibility into potential conflicts.
```

### Step 13: Add Server Initialization and Configuration

**Goal**: Initialize FormCache in server startup and add configuration options.

**TDD Prompt:**
```
Add FormCache initialization and configuration to MCP server:

1. Write tests for server initialization that can:
   - Initialize FormCache during server startup
   - Handle FormCache initialization failures gracefully  
   - Load cache configuration from environment variables
   - Provide fallback behavior when cache unavailable
   - Clean up FormCache during server shutdown
   - Support disabling cache via configuration

2. Modify GravityFormsMCPServer class:
   - Add FormCache property and initialization in constructor
   - Add graceful degradation when cache initialization fails
   - Implement proper cleanup in server shutdown (if applicable)
   - Pass FormCache to tools that support it

3. Add environment variable configuration:
   - GRAVITY_FORMS_CACHE_ENABLED (default: true)
   - GRAVITY_FORMS_CACHE_DB_PATH (default: ./data/forms-cache.db)  
   - GRAVITY_FORMS_CACHE_MAX_AGE_SECONDS (default: 3600)
   - GRAVITY_FORMS_CACHE_MAX_PROBE_FAILURES (default: 10)
   - GRAVITY_FORMS_CACHE_AUTO_SYNC (default: true)

4. Integration points:
   - getForms() method: pass cache instance for include_all support
   - listFormTemplates() method: pass cache for complete template discovery  
   - FormImporter: initialize with cache for enhanced conflict detection
   - Add cache health check method for monitoring

5. Test scenarios:
   - Normal initialization with cache enabled
   - Cache disabled via environment variable
   - Cache initialization failure (permissions, disk space)
   - Server startup/shutdown with cache cleanup
   - Configuration loading and validation

6. Add optional cache status endpoint:
   - Consider adding get_cache_status tool for monitoring
   - Include cache statistics, last sync time, health status
   - Useful for debugging and monitoring cache performance

Ensure the cache integrates seamlessly without breaking existing functionality.
```

### Step 14: Add Comprehensive Error Handling and Logging

**Goal**: Implement robust error handling and logging throughout the cache system.

**TDD Prompt:**
```
Add comprehensive error handling and logging to FormCache system:

1. Write tests for error handling that can:
   - Handle database connection failures gracefully
   - Recover from database corruption scenarios
   - Handle API timeouts and rate limiting properly  
   - Manage partial sync failures without data loss
   - Provide meaningful error messages to users
   - Log appropriate information for debugging

2. Add error handling throughout FormCache:
   - Database errors: connection failures, disk full, permissions
   - API errors: network issues, authentication, rate limits
   - Data integrity errors: malformed responses, invalid form data
   - Concurrent access issues: database locks, transaction conflicts

3. Create error classification system:
   - CacheError (base class)
   - DatabaseError (database-specific issues)  
   - ApiError (API-related problems)
   - SyncError (sync workflow issues)
   - ConfigurationError (setup/config problems)

4. Add logging framework:
   - Use structured logging (JSON format recommended)
   - Different log levels: error, warn, info, debug
   - Include context: operation, form_id, timing, cache stats
   - Avoid logging sensitive data (API keys, personal info)

5. Recovery mechanisms:
   - Automatic retry with exponential backoff for transient failures
   - Cache rebuilding for corruption scenarios
   - Graceful degradation: fall back to API-only mode when cache fails
   - Circuit breaker pattern for repeated API failures

6. Test error scenarios:
   - Database file corruption and recovery
   - Network failures during sync
   - API rate limiting responses  
   - Disk space exhaustion
   - Concurrent access conflicts

7. Add monitoring hooks:
   - Error rate tracking
   - Sync success/failure statistics
   - Performance metrics (sync duration, cache hit rate)
   - Health check endpoints

Ensure the system is resilient and provides good observability for operations.
```

### Step 15: Performance Optimization and Final Integration Testing

**Goal**: Optimize performance and conduct comprehensive end-to-end testing.

**TDD Prompt:**
```
Perform final optimization and comprehensive integration testing:

1. Write performance tests that verify:
   - Cache operations perform well with large datasets (1000+ forms)
   - Memory usage remains reasonable during full sync
   - Database queries are optimized with proper indexes
   - API call minimization (80%+ reduction for cached operations)
   - Concurrent access handling without deadlocks

2. Optimization areas:
   - Database query optimization with EXPLAIN QUERY PLAN
   - Connection pooling for high-frequency operations
   - Batch operations for bulk inserts/updates
   - Memory usage optimization during large sync operations
   - Efficient data structures for ID gap detection

3. Integration test scenarios:
   - Complete workflow: fresh install → full sync → tool usage
   - Mixed usage: some tools with include_all, others without
   - Cache invalidation and refresh cycles
   - Server restart with cache persistence
   - Large-scale operations (100+ forms with mixed active/inactive)

4. Load testing:
   - Simulate production usage patterns
   - Test concurrent cache access from multiple tool calls
   - Validate API rate limiting protection during heavy sync
   - Memory usage profiling during extended operations

5. Final validation checklist:
   - All 16 tools working correctly (8 existing + enhanced get_forms/list_form_templates)
   - Backward compatibility: existing tools unchanged without include_all
   - Complete form discovery working reliably
   - Cache performance meets targets (80%+ API call reduction)  
   - Error handling robust across all scenarios
   - Configuration options working properly

6. Documentation and cleanup:
   - Update tool descriptions with include_all parameter info
   - Add cache configuration documentation  
   - Performance tuning guidelines
   - Troubleshooting guide for cache issues
   - Clean up any debug code or TODOs

7. Final integration tests:
   - End-to-end workflow with real API (using test environment)
   - Performance benchmarking vs. API-only mode
   - Cache persistence across server restarts
   - Error recovery testing with various failure modes

Ensure the system is production-ready with excellent performance and reliability.
```

## TDD Prompt Collection

Each step above provides a complete TDD prompt that builds incrementally on previous work. The prompts emphasize:

- **Test-First Development**: Write comprehensive tests before implementation
- **Incremental Progress**: Each step builds on the previous foundation  
- **Backward Compatibility**: Existing functionality remains unchanged
- **Error Resilience**: Robust handling of failures and edge cases
- **Performance Focus**: Efficient operations with large datasets
- **Production Readiness**: Monitoring, logging, and operational concerns

## Success Criteria

1. **Complete Form Discovery**: System discovers and caches all forms (active and inactive)
2. **Backward Compatibility**: Existing tools work unchanged by default
3. **Performance**: 80%+ reduction in API calls for repeated operations
4. **Reliability**: Robust error handling and recovery mechanisms  
5. **Maintainability**: Well-tested, documented, and monitorable code
6. **Scalability**: Efficient with large form datasets (1000+ forms)

## Configuration Options

```bash
# Enable/disable caching
GRAVITY_FORMS_CACHE_ENABLED=true

# Database location  
GRAVITY_FORMS_CACHE_DB_PATH=./data/forms-cache.db

# Cache freshness (seconds)
GRAVITY_FORMS_CACHE_MAX_AGE_SECONDS=3600

# Discovery limits
GRAVITY_FORMS_CACHE_MAX_PROBE_FAILURES=10

# Auto-sync behavior
GRAVITY_FORMS_CACHE_AUTO_SYNC=true
```

**TDD Prompt**:
```
Set up a comprehensive testing environment for the Gravity Forms MCP server. You need to:

1. Add Jest and necessary TypeScript testing dependencies to package.json
2. Create a jest.config.js file with TypeScript support and proper module resolution
3. Add test scripts to package.json (test, test:watch, test:coverage)
4. Create a __tests__ directory structure
5. Create a basic test file that verifies the existing GravityFormsMCPServer class can be instantiated
6. Create mock utilities for Gravity Forms API responses
7. Ensure all tests pass and TypeScript compilation works

Write tests first, then implement the minimal configuration needed to make them pass. The testing setup should support both unit tests and integration tests.
```

### Step 2: Create Data Export Utilities

**Goal**: Build reusable utilities for converting Gravity Forms entry data to CSV and JSON formats.

**TDD Prompt**:
```
Create data export utilities for the Gravity Forms MCP server using Test-Driven Development:

1. Write tests for a DataExporter class that can:
   - Convert entry arrays to CSV format with proper headers
   - Convert entry arrays to JSON format with clean structure
   - Handle complex field types (name fields, address fields, file uploads)
   - Handle missing or null values gracefully
   - Support custom date formatting
   - Return data as base64 encoded strings for file download

2. Create interfaces for:
   - ExportFormat ('csv' | 'json')
   - ExportOptions (dateFormat, includeHeaders, etc.)
   - ExportResult (data, filename, mimeType)

3. Implement the DataExporter class to make all tests pass
4. Test edge cases: empty data, malformed entries, special characters

The implementation should be in a separate utils/dataExporter.ts file and follow existing code patterns.
```

### Step 3: Add Input Validation Utilities

**Goal**: Create comprehensive input validation for all tool parameters.

**TDD Prompt**:
```
Create input validation utilities using TDD approach:

1. Write tests for a ValidationHelper class that validates:
   - Form IDs (non-empty strings, numeric format)
   - Entry IDs (arrays and single values)
   - Export formats and options
   - Bulk operation parameters
   - Field modification parameters for templates

2. Create validation schemas using TypeScript interfaces for:
   - ExportEntriesParams
   - BulkProcessParams  
   - TemplateParams
   - ImportExportParams

3. Implement validation methods that:
   - Return clear error messages for invalid inputs
   - Sanitize inputs to prevent injection attacks
   - Validate required vs optional parameters
   - Check parameter combinations for logical consistency

4. Write tests for edge cases and security scenarios

Place implementation in utils/validation.ts and ensure it integrates with existing error handling patterns.
```

### Step 4: Implement Export Entries Tool

**Goal**: Add the export_entries_formatted tool with full CSV/JSON export capability.

**TDD Prompt**:
```
Implement the export_entries_formatted tool using TDD:

1. Write tests that verify the tool can:
   - Export entries from a specific form in CSV format
   - Export entries in JSON format with proper structure
   - Handle pagination for large datasets
   - Apply search filters before export
   - Include proper headers and metadata
   - Handle various field types (text, email, name, address, file uploads)
   - Return base64 encoded data for download

2. Add the tool definition to the ListToolsRequestSchema response
3. Implement the tool handler in the CallToolRequestSchema handler
4. Use the DataExporter utility created in Step 2
5. Use the ValidationHelper from Step 3 for input validation
6. Mock all API calls to Gravity Forms in tests
7. Test error scenarios: invalid form ID, no entries, API failures

The tool should accept parameters: form_id, format ('csv'|'json'), search filters, date_format, and pagination options. Follow existing tool patterns in the codebase.
```

### Step 5: Implement Bulk Operations Foundation

**Goal**: Create the framework for safe bulk operations with confirmation mechanisms.

**TDD Prompt**:
```
Create the foundation for bulk operations using TDD:

1. Write tests for a BulkOperationsManager class that:
   - Validates bulk operation requests (max 100 entries)
   - Requires explicit confirmation parameter
   - Supports operation types: delete, update_status, update_fields
   - Provides operation previews before execution
   - Tracks success/failure counts
   - Implements rollback capabilities where possible

2. Create interfaces for:
   - BulkOperationType ('delete' | 'update_status' | 'update_fields')
   - BulkOperationParams (entry_ids, operation, confirmation, data)
   - BulkOperationResult (processed, successful, failed, errors)

3. Implement the BulkOperationsManager to make tests pass
4. Test safety mechanisms: no confirmation, too many entries, invalid operations
5. Mock API responses for testing different scenarios

Place in utils/bulkOperations.ts. Ensure proper error handling and logging for audit trails.
```

### Step 6: Implement Process Entries Bulk Tool

**Goal**: Add the process_entries_bulk tool with full safety mechanisms.

**TDD Prompt**:
```
Implement the process_entries_bulk tool using TDD:

1. Write tests that verify the tool can:
   - Delete multiple entries with confirmation
   - Update entry status (active, spam, trash) for multiple entries
   - Update specific field values across multiple entries
   - Refuse operations without explicit confirm: true parameter
   - Return detailed results with success/failure counts
   - Handle partial failures gracefully
   - Respect the 100 entry limit

2. Add the tool definition with clear warning about destructive operations
3. Implement the tool handler using BulkOperationsManager from Step 5
4. Test all operation types with mocked API responses
5. Test safety mechanisms: missing confirmation, oversized requests
6. Test error recovery: API failures, network issues, invalid entry IDs

The tool should require: entry_ids[], operation_type, confirm: true, and optional data for update operations. Include clear warnings in the tool description.
```

### Step 7: Implement Template Identification

**Goal**: Create utilities to identify and work with form templates.

**TDD Prompt**:
```
Create template identification utilities using TDD:

1. Write tests for a TemplateManager class that:
   - Identifies forms with '-template' suffix as templates
   - Filters template list from all forms
   - Validates template form structure
   - Checks if form names would conflict when creating from template
   - Generates safe template names from existing forms

2. Create interfaces for:
   - FormTemplate (extends base form with template metadata)
   - TemplateInfo (id, name, description, field_count, created_date)
   - TemplateCreateOptions (new_name, field_renames)

3. Implement TemplateManager methods:
   - listTemplates(): Promise<TemplateInfo[]>
   - isTemplate(form): boolean  
   - generateTemplateName(baseName): string
   - validateTemplateStructure(form): boolean

4. Test with various form data including edge cases
5. Mock API responses for form listing

Place in utils/templateManager.ts and ensure it works with existing API patterns.
```

### Step 8: Implement List Form Templates Tool

**Goal**: Add the list_form_templates tool to browse available templates.

**TDD Prompt**:
```
Implement the list_form_templates tool using TDD:

1. Write tests that verify the tool can:
   - List all forms with '-template' suffix
   - Return template metadata (name, description, field count)
   - Filter templates by search criteria
   - Sort templates by name or creation date
   - Handle cases where no templates exist
   - Include field summary information

2. Add the tool definition to the tools list
3. Implement the tool handler using TemplateManager from Step 7
4. Test with various template scenarios
5. Test error handling: API failures, malformed template data

The tool should accept optional parameters: search_term, sort_by ('name'|'date'), sort_order ('asc'|'desc'). Return clean template information suitable for user selection.
```

### Step 9: Implement Template Creation Utilities

**Goal**: Create utilities for safely modifying form templates.

**TDD Prompt**:
```
Create template creation utilities using TDD:

1. Write tests for a TemplateCreator class that:
   - Clones form structure from templates
   - Safely renames field labels (strings only)
   - Validates field type compatibility
   - Prevents dangerous field type changes (date->text, etc.)
   - Updates form title and removes '-template' suffix
   - Preserves conditional logic and calculations
   - Handles field dependencies correctly

2. Create interfaces for:
   - FieldRename (original_label, new_label)
   - TemplateModification (title, field_renames, preserve_logic)
   - ModificationResult (success, warnings, errors)

3. Implement methods:
   - cloneFromTemplate(templateId, modifications): Promise<FormData>
   - validateFieldRenames(template, renames): ModificationResult
   - applyFieldRenames(form, renames): FormData

4. Test field type safety: prevent birthday->phone, allow color->animal
5. Test complex forms with conditional logic

Place in utils/templateCreator.ts with comprehensive field type validation.
```

### Step 10: Implement Save Form as Template Tool

**Goal**: Add the save_form_as_template tool to create reusable templates.

**TDD Prompt**:
```
Implement the save_form_as_template tool using TDD:

1. Write tests that verify the tool can:
   - Clone an existing form with '-template' suffix added
   - Remove form-specific data (entries, notifications)
   - Preserve form structure and field definitions
   - Handle name conflicts with existing templates
   - Validate source form exists and is accessible
   - Set appropriate template metadata

2. Add the tool definition with clear description
3. Implement using TemplateManager and existing API methods
4. Test with various form types and complexities
5. Test error cases: missing source form, name conflicts, API failures

The tool should accept: form_id (required), template_name (optional - defaults to form title + '-template'). Return the created template information.
```

### Step 11: Implement Create Form from Template Tool

**Goal**: Add the create_form_from_template tool with field customization.

**TDD Prompt**:
```
Implement the create_form_from_template tool using TDD:

1. Write tests that verify the tool can:
   - Create new forms from existing templates
   - Apply field label renames safely
   - Preserve field types and validation rules
   - Update form title and metadata
   - Handle field dependency updates
   - Validate all modifications before applying

2. Use TemplateCreator from Step 9 for safe modifications
3. Test field renaming scenarios: safe (color->animal) and unsafe (date->phone)
4. Test complex templates with conditional logic
5. Test error handling: missing template, invalid modifications

The tool should accept: template_id, new_form_title, field_renames (optional array of {original_label, new_label}). Return the created form information.
```

### Step 12: Implement Form JSON Export Tool

**Goal**: Add the export_form_json tool for form definition export.

**TDD Prompt**:
```
Implement the export_form_json tool using TDD:

1. Write tests that verify the tool can:
   - Export complete form definition as JSON
   - Include all fields, settings, and configuration
   - Preserve conditional logic and calculations
   - Remove sensitive data (API keys, private settings)
   - Format JSON for readability and import compatibility
   - Handle forms with complex field types

2. Add the tool definition
3. Implement using existing API patterns
4. Test with various form complexities
5. Test error handling: missing form, permission issues

The tool should accept: form_id (required). Return the form JSON as a formatted string that can be imported later.
```

### Step 13: Implement Form JSON Import Tool

**Goal**: Add the import_form_json tool with conflict resolution.

**TDD Prompt**:
```
Implement the import_form_json tool using TDD:

1. Write tests that verify the tool can:
   - Import form definitions from JSON
   - Handle form ID conflicts with existing forms
   - Validate JSON structure before import
   - Support force_import flag for overwriting
   - Assign new IDs when conflicts occur
   - Preserve form integrity during import

2. Create FormImporter utility class for:
   - JSON validation and parsing
   - Conflict detection and resolution
   - ID mapping and reference updates
   - Import result reporting

3. Test scenarios: new import, conflicting IDs, malformed JSON, partial failures
4. Test with force_import flag behavior

The tool should accept: form_json (required), force_import (optional boolean). Return import results with any ID mappings or conflicts resolved.
```

### Step 14: Implement Clone with Modifications Tool

**Goal**: Add the clone_form_with_modifications tool for intelligent form cloning.

**TDD Prompt**:
```
Implement the clone_form_with_modifications tool using TDD:

1. Write tests that verify the tool can:
   - Clone existing forms with modifications
   - Apply field label changes
   - Update form title and metadata
   - Preserve or modify conditional logic
   - Handle field dependencies correctly
   - Validate all modifications for safety

2. Combine utilities from previous steps (TemplateCreator, validation)
3. Test complex modification scenarios
4. Test with forms containing advanced features
5. Test error handling and rollback scenarios

The tool should accept: source_form_id, modifications (title, field_renames, etc.). Return the cloned form information.
```

### Step 15: Integration Testing and Polish

**Goal**: Comprehensive testing of all tools working together and final polish.

**TDD Prompt**:
```
Create comprehensive integration tests and polish the implementation:

1. Write integration tests that verify:
   - Complete template workflow: create template, list templates, create from template
   - Export/import round-trip: export form JSON, import to new form
   - Bulk operations with various data sets
   - Error handling across all tools
   - Tool interactions and dependencies

2. Performance testing:
   - Large data export operations
   - Bulk operations with maximum entries
   - Template operations with complex forms

3. Polish and cleanup:
   - Consistent error messages across all tools
   - Proper input validation everywhere
   - Clean up any remaining TODO comments
   - Ensure TypeScript strict mode compliance
   - Update tool descriptions for clarity

4. Final verification:
   - All 8 new tools working correctly
   - No breaking changes to existing functionality
   - Comprehensive test coverage
   - Code follows existing patterns

Run full test suite and ensure all tests pass. Verify the server can start and all tools are properly registered.
```

## TDD Prompt Summary

Each step above provides a complete TDD prompt that builds incrementally on previous work. The prompts emphasize:

- Writing tests first
- Implementing minimal code to pass tests
- Building reusable utilities
- Maintaining safety and security
- Following existing code patterns
- Comprehensive error handling
- Progressive complexity building

The implementation should result in a robust, well-tested enhancement to the Gravity Forms MCP server with all 8 new tools functioning correctly.