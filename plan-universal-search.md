# Universal Name Search Implementation Plan - TDD Approach

## Overview

Implement a fast, universal name search system that works efficiently across ALL Gravity Forms, automatically detecting name fields and providing lightning-fast search capabilities without relying on form-specific configurations.

## Problem Statement

**Current Issues:**
- **Search API Inconsistency**: `get_entries` uses incorrect search syntax (flat object vs array format)
- **Performance Problems**: 66k+ token responses causing context overflow, requiring manual pagination
- **Form-Specific Limitations**: Current searches require knowledge of specific field IDs for each form
- **No Universal Solution**: No way to search for names across different forms without knowing their structure

**Performance Impact:**
- Finding "Example Person" in form 193 required 3+ API calls and manual pagination
- Responses can exceed 66k tokens causing Claude crashes  
- No field detection means guessing which fields contain names vs other data

## Proposed Architecture

### Core Components

#### 1. **FieldDetector** - Intelligent field type detection
- Analyzes form structure to identify field types automatically
- Caches field mappings per form for performance
- Supports detection of name, email, phone, and team/group fields
- Uses pattern matching on field labels and types

#### 2. **UniversalSearchManager** - Smart search coordination  
- Handles cross-field searches with multiple strategies
- Manages search approaches: exact, fuzzy, contains, phonetic
- Coordinates with FieldDetector for intelligent field targeting
- Implements response size management and result optimization

#### 3. **SearchResultsFormatter** - Response optimization
- Formats search results consistently across all tools
- Handles response size limiting to prevent token overflow  
- Provides rich context about matches and confidence scores
- Supports multiple output formats (detailed, summary, minimal)

#### 4. **Enhanced Search Tools** - Improved MCP interface
- **search_entries_by_name**: Primary universal name search tool
- **search_entries_universal**: Multi-field search capability with custom strategies
- **Enhanced get_entries**: Fixed search syntax with response optimization
- **get_field_mappings**: Utility to inspect detected field types per form

### Field Detection Strategy

#### Automatic Field Type Detection:
1. **Form Structure Analysis**: Download form definition via `/forms/{id}` endpoint
2. **Label Pattern Matching**: Identify field types using label keywords:
   - Name fields: "name", "first", "last", "full name", "attendee", "participant", "member"
   - Email fields: "email", "e-mail", "mail", "contact"  
   - Phone fields: "phone", "tel", "mobile", "cell", "contact"
   - Team/Group fields: "team", "group", "with", "partner", "squad"
3. **Field Type Analysis**: Consider Gravity Forms field types (name, email, phone, text)
4. **Caching Strategy**: Store field mappings in memory/database for performance
5. **Fallback Handling**: When detection fails, search all text-type fields

#### Search Execution Flow:
1. **Field Discovery**: Get or detect field mappings for target form
2. **Query Construction**: Build search filters for identified name fields
3. **API Execution**: Execute search with proper `field_filters` syntax  
4. **Result Processing**: Format results with match context and confidence
5. **Response Optimization**: Limit response size and provide summaries when needed

## Implementation Strategy

### Phase Breakdown
1. **Foundation** (Steps 1-4): Fix existing search issues, create core utilities  
2. **Field Detection** (Steps 5-7): Build intelligent field type detection system
3. **Search Engine** (Steps 8-10): Implement universal search manager with optimization
4. **Tool Integration** (Steps 11-13): Create new search tools and enhance existing ones
5. **Polish & Optimization** (Steps 14-16): Performance tuning, advanced features, comprehensive testing

### Success Criteria

#### Performance Targets:
- **Single API Call**: Most name searches complete with 1 API request
- **Response Size**: All responses under 25k tokens (no context overflow)
- **Speed**: Search results in <2 seconds
- **Accuracy**: 95%+ field detection success rate across diverse forms

#### Functionality Goals:
- **Universal Compatibility**: Works on any Gravity Form without configuration
- **Smart Detection**: Automatically finds name fields regardless of field IDs  
- **Rich Results**: Provides match confidence and context information
- **Scalable**: Handles forms with 100+ fields efficiently
- **Backwards Compatible**: Existing tools unchanged unless opted-in

## Detailed Implementation Steps

### Step 1: Fix get_entries Search Syntax

**Goal**: Fix the broken search functionality in the existing get_entries tool.

**TDD Prompt:**

```typescript
Fix the search parameter handling in get_entries tool to match working export_entries_formatted syntax:

1. Write tests that verify get_entries can:
   - Handle field_filters array format correctly: {"field_filters": [{"key": "52", "value": "John"}]}
   - Execute searches with proper URL encoding  
   - Return filtered results matching the search criteria
   - Handle multiple field filters with OR logic
   - Process search alongside existing pagination and sorting parameters

2. Update the getEntries method in index.ts:
   - Change search parameter handling from flat object to support field_filters array
   - Match the working implementation from exportEntriesFormatted method
   - Maintain backward compatibility with existing search parameter formats
   - Add proper URL parameter encoding for field filters

3. Test scenarios:
   - Single field filter search
   - Multiple field filters (OR logic)
   - Combination of search with pagination/sorting  
   - Invalid field filter formats (error handling)
   - Mixed search parameters (status + field_filters)

4. Validation:
   - Compare URL generation with working export_entries_formatted
   - Verify API requests use correct parameter encoding
   - Ensure existing functionality remains unchanged

The fix should make get_entries search work identically to export_entries_formatted search functionality.
```

### Step 2: Add Response Size Management to get_entries

**Goal**: Prevent context overflow by adding smart response limiting to get_entries.

**TDD Prompt:**

```typescript
Add intelligent response size management to get_entries tool:

1. Write tests that verify response size management:
   - Automatic pagination when response would be too large (>20k tokens)
   - Token estimation using character count approximation (1 token ≈ 4 characters)
   - Summary mode for large entry sets with essential info only
   - Configurable response size limits
   - Proper handling of various entry data sizes

2. Implement response optimization in getEntries method:
   - Add token estimation utility method (estimateTokenCount)
   - Add entry summarization method (createEntrySummary)
   - Implement automatic page size reduction for large responses
   - Add response_mode parameter: 'full', 'summary', 'auto' (default: 'auto')

3. Create entry summary format:
   - Essential fields: id, form_id, date_created, payment_status
   - Name fields (detected or common ones like 52, 55)
   - Email fields (detected or common ones like 50, 54)
   - Key status information
   - Match indicators when part of search results

4. Test scenarios:
   - Large entry sets requiring summarization
   - Mixed entry sizes (some large, some small)
   - Search results with various response sizes
   - Manual response_mode override
   - Edge cases: empty results, single entry, malformed entries

5. Integration:
   - Update get_entries tool schema with response_mode parameter
   - Ensure backward compatibility (existing calls work unchanged)
   - Document the new summary behavior

This prevents context overflow while maintaining search functionality.
```

### Step 3: Create Core Field Type Detection Utilities

**Goal**: Build the foundation for automatic field type detection.

**TDD Prompt:**

```typescript
Create intelligent field type detection utilities using TDD:

1. Write tests for FieldTypeDetector class that can:
   - Detect name fields by label patterns: "name", "first", "last", "full name", "attendee", "participant"
   - Detect email fields by labels: "email", "e-mail", "mail", "contact"
   - Detect phone fields by labels: "phone", "tel", "mobile", "cell"
   - Detect team/group fields: "team", "group", "with", "partner", "squad", "members"
   - Handle case-insensitive matching and partial matches
   - Work with Gravity Forms field types (name, email, phone, text, textarea)

2. Create interfaces for field classification:
   - FieldTypeInfo: { fieldId: string, fieldType: DetectedFieldType, confidence: number, label: string }
   - DetectedFieldType: 'name' | 'email' | 'phone' | 'team' | 'text' | 'unknown'
   - FormFieldMapping: { [fieldId: string]: FieldTypeInfo }

3. Implement FieldTypeDetector methods:
   - analyzeFormFields(formDefinition): FormFieldMapping
   - detectFieldType(field): FieldTypeInfo  
   - getNameFields(mapping): FieldTypeInfo[]
   - getEmailFields(mapping): FieldTypeInfo[]
   - getAllTextFields(mapping): FieldTypeInfo[]

4. Test detection patterns:
   - Standard form with "First Name", "Last Name", "Email"
   - Event form with "Participant Name", "Team Name"
   - Contact form with "Your Name", "Contact Email"
   - Edge cases: unnamed fields, multiple name fields, compound fields
   - Various Gravity Forms field types and configurations

5. Add confidence scoring:
   - High confidence (0.9+): exact keyword matches
   - Medium confidence (0.7-0.9): partial matches or field type hints
   - Low confidence (0.5-0.7): weak indicators
   - No confidence (<0.5): generic text fields

Place implementation in utils/fieldTypeDetector.ts with comprehensive pattern matching.
```

### Step 4: Add Field Mapping Cache Management  

**Goal**: Implement caching for field type mappings to improve performance.

**TDD Prompt:**

```typescript
Create field mapping cache system for performance optimization:

1. Write tests for FieldMappingCache class that can:
   - Store field mappings per form ID with timestamps
   - Retrieve cached mappings when available and fresh
   - Handle cache expiration (default 1 hour)
   - Support cache invalidation for specific forms
   - Manage memory usage with LRU eviction
   - Handle concurrent access safely

2. Create cache interfaces:
   - CachedFieldMapping: { formId: string, mapping: FormFieldMapping, timestamp: Date, lastAccessed: Date }
   - CacheOptions: { maxAge: number, maxSize: number, enablePersistence: boolean }
   - CacheStats: { hitRate: number, entryCount: number, memoryUsage: number }

3. Implement FieldMappingCache methods:
   - get(formId): FormFieldMapping | null
   - set(formId, mapping): void
   - invalidate(formId?): void  // single form or all
   - isExpired(entry): boolean
   - getCacheStats(): CacheStats
   - cleanup(): void  // remove expired/LRU entries

4. Test scenarios:
   - Cache hit/miss tracking
   - Automatic expiration handling
   - Memory limits and LRU eviction
   - Concurrent access from multiple tools
   - Cache invalidation and refresh

5. Integration with FieldTypeDetector:
   - Modify analyzeFormFields to check cache first
   - Automatically cache results after detection
   - Provide cache status in detection results

6. Configuration options:
   - FIELD_MAPPING_CACHE_MAX_AGE_MS (default: 3600000 = 1 hour)
   - FIELD_MAPPING_CACHE_MAX_SIZE (default: 100 forms)
   - FIELD_MAPPING_CACHE_ENABLED (default: true)

Place implementation in utils/fieldMappingCache.ts with thread-safe operations.
```

### Step 5: Build Universal Search Manager

**Goal**: Create the core search coordination system that handles multiple search strategies.

**TDD Prompt:**

```typescript
Create UniversalSearchManager for intelligent multi-field searching:

1. Write tests for UniversalSearchManager that can:
   - Execute name searches across multiple detected name fields
   - Handle different search strategies: exact, contains, fuzzy
   - Combine results from multiple field searches with OR logic
   - Provide match confidence scoring and context
   - Support pagination and result limiting
   - Handle API errors and field detection failures gracefully

2. Create search interfaces:
   - SearchStrategy: 'exact' | 'contains' | 'fuzzy' | 'auto'
   - SearchOptions: { strategy: SearchStrategy, maxResults: number, includeContext: boolean }
   - SearchMatch: { entryId: string, matchedFields: {[fieldId: string]: string}, confidence: number }
   - SearchResult: { matches: SearchMatch[], totalFound: number, searchMetadata: object }

3. Implement UniversalSearchManager methods:
   - searchByName(formId, searchText, options): Promise<SearchResult>
   - searchByEmail(formId, searchText, options): Promise<SearchResult>
   - searchUniversal(formId, searchText, fieldTypes, options): Promise<SearchResult>
   - buildFieldFilters(mapping, searchText, fieldTypes): FieldFilter[]
   - calculateMatchConfidence(entry, searchText, matchedFields): number

4. Test search scenarios:
   - Single name field match: "John Smith" in field 52
   - Multiple name field matches: "John" in first name (1.3) and "Smith" in last name (1.6)
   - Team/group mentions: "John Smith" mentioned in team field 17
   - Email searches across multiple email fields
   - Fuzzy matching for misspellings: "Jon Smyth" matches "John Smith"

5. API integration:
   - Use fixed get_entries search functionality from Step 1
   - Handle multiple API calls if needed for complex searches
   - Implement response size management from Step 2
   - Proper error handling and fallback strategies

6. Performance optimization:
   - Minimize API calls through smart field targeting
   - Cache frequently accessed form field mappings
   - Efficient result deduplication
   - Response size estimation and limiting

Place implementation in utils/universalSearchManager.ts with comprehensive error handling.
```

### Step 6: Create Search Results Formatter

**Goal**: Build consistent, optimized formatting for all search results.

**TDD Prompt:**

```typescript
Create SearchResultsFormatter for consistent, optimized result presentation:

1. Write tests for SearchResultsFormatter that can:
   - Format search results in multiple output modes: detailed, summary, minimal
   - Highlight matched fields and values for context
   - Estimate and control response token counts
   - Handle various result sizes from single match to hundreds
   - Include search metadata and performance information
   - Support different match confidence levels

2. Create formatting interfaces:
   - OutputMode: 'detailed' | 'summary' | 'minimal' | 'auto'
   - FormattedResult: { content: string, tokenCount: number, resultCount: number, metadata: object }
   - MatchHighlight: { fieldLabel: string, matchedValue: string, confidence: number }
   - ResultSummary: { entryId: string, primaryName: string, email: string, highlights: MatchHighlight[] }

3. Implement SearchResultsFormatter methods:
   - formatSearchResults(searchResult, outputMode, formInfo): FormattedResult
   - createDetailedView(matches): string
   - createSummaryView(matches): string
   - createMinimalView(matches): string
   - estimateResponseSize(results, mode): number
   - highlightMatches(entry, searchText, matchedFields): MatchHighlight[]

4. Test formatting scenarios:
   - Single perfect match with high confidence
   - Multiple partial matches with varying confidence
   - Large result sets requiring summarization
   - No matches found (empty results)
   - Mixed match types (name + email + team mentions)

5. Response optimization:
   - Auto-detect when to switch from detailed to summary mode
   - Intelligent field selection for summaries
   - Token count estimation and limiting
   - Context-aware match highlighting

6. Integration requirements:
   - Work with UniversalSearchManager search results
   - Support form field mapping context
   - Handle various Gravity Forms field types
   - Maintain consistency with existing tool response formats

Place implementation in utils/searchResultsFormatter.ts with performance focus.
```

### Step 7: Implement search_entries_by_name Tool

**Goal**: Create the primary universal name search tool for end users.

**TDD Prompt:**

```typescript
Create search_entries_by_name tool as the primary interface for name searching:

1. Write tests for the new MCP tool that can:
   - Search for names across any form without knowing field structure
   - Return formatted results with match context and confidence
   - Handle various search strategies (exact, contains, fuzzy)
   - Support pagination and result limiting
   - Provide clear error messages for invalid inputs
   - Work with forms of any complexity (simple to complex multi-page forms)

2. Add tool definition to MCP server:
   - Tool name: "search_entries_by_name"
   - Description: "Search form entries by name across all name fields automatically"
   - Parameters: 
     - form_id (required): string
     - search_text (required): string  
     - strategy (optional): 'exact' | 'contains' | 'fuzzy' | 'auto' (default: 'auto')
     - max_results (optional): number (default: 50)
     - output_mode (optional): 'detailed' | 'summary' | 'minimal' | 'auto' (default: 'auto')

3. Implement tool handler using previous components:
   - Integrate FieldTypeDetector for field discovery
   - Use UniversalSearchManager for search execution  
   - Apply SearchResultsFormatter for response optimization
   - Include comprehensive error handling and validation

4. Test comprehensive scenarios:
   - Simple form: "John Smith" in basic contact form
   - Complex form: "Mary Johnson" in multi-page registration with team fields
   - Edge cases: no matches, partial matches, special characters
   - Performance: large forms, many matches, response size management
   - Error handling: invalid form ID, API failures, malformed search text

5. Response format examples:
   ```
   Found 2 matches for "John Smith" in form 193 (League Sign up 25-26):
   
   Entry #10795 (High Confidence: 0.95)
   - Name: John Smith (field 52)
   - Email: john.smith@email.com (field 54)  
   - Payment: $200.00 Paid
   - Date: 2025-09-03 15:43:56
   
   Entry #10792 (Medium Confidence: 0.75)
   - Team Member: "John Smith" mentioned in field 17
   - Primary Name: Different Person (field 52)
   - Payment: $0.00 Unpaid
   
   Search completed in 1.2s using auto-detected name fields.
   ```

6. Integration and testing:
   - Add to server tool list and handler routing
   - Test with real form data (mocked API responses)
   - Verify performance targets (single API call, <25k tokens)
   - Ensure backward compatibility (no impact on existing tools)

This tool should provide the main interface users need for fast, universal name searching.
```

### Step 8: Implement search_entries_universal Tool

**Goal**: Create a flexible multi-field search tool for advanced use cases.

**TDD Prompt:**

```typescript
Create search_entries_universal tool for advanced multi-field searching:

1. Write tests for advanced search capabilities:
   - Search across multiple field types simultaneously (name + email + phone)
   - Custom field targeting with manual field ID specification
   - Multiple search terms with AND/OR logic
   - Field type filtering: search only name fields, only email fields, etc.
   - Advanced result filtering and sorting options

2. Add tool definition:
   - Tool name: "search_entries_universal"  
   - Description: "Advanced multi-field search with custom targeting and strategies"
   - Parameters:
     - form_id (required): string
     - search_queries (required): Array<{text: string, field_types?: string[], field_ids?: string[]}>
     - logic (optional): 'AND' | 'OR' (default: 'OR')
     - strategy (optional): search strategy per query
     - filters (optional): additional filtering options
     - output_options (optional): detailed formatting controls

3. Implement advanced search logic:
   - Multi-query processing with logical operators
   - Custom field targeting (override auto-detection)
   - Result combination and deduplication
   - Advanced confidence scoring for complex matches
   - Performance optimization for multiple queries

4. Test complex scenarios:
   - Find entries matching "John" in name fields AND "gmail.com" in email fields
   - Search for "Team Alpha" in team fields OR specific email addresses
   - Custom field targeting: search only in fields 52,55 for names
   - Performance with multiple complex queries

5. Advanced features:
   - Support for regex patterns in search text
   - Date range filtering for entries
   - Payment status filtering
   - Result sorting by relevance, date, or custom fields
   - Export integration (search + export in one operation)

6. Response format:
   - Detailed match breakdown showing which queries matched
   - Per-query statistics and performance metrics
   - Field mapping information used in search
   - Suggestions for query refinement

This tool provides power-user capabilities while maintaining ease of use.
```

### Step 9: Add get_field_mappings Utility Tool

**Goal**: Create a diagnostic tool for understanding form field structure.

**TDD Prompt:**

```typescript
Create get_field_mappings tool for form structure inspection and debugging:

1. Write tests for field mapping inspection:
   - Analyze any form and return detected field types
   - Show confidence scores for field type detection
   - Display field labels, types, and detection reasoning
   - Identify potential search target fields
   - Provide form complexity metrics

2. Add tool definition:
   - Tool name: "get_field_mappings"
   - Description: "Analyze form structure and show detected field types for debugging"
   - Parameters:
     - form_id (required): string
     - include_details (optional): boolean (default: false)
     - refresh_cache (optional): boolean (default: false)

3. Implement field analysis features:
   - Use FieldTypeDetector to analyze form structure
   - Show all detected field types with confidence scores
   - Highlight recommended search target fields
   - Display form complexity metrics (field count, types, conditional logic)
   - Cache status and performance information

4. Response format example:
   ```
   Field Mappings for Form 193 (League Sign up 25-26):
   
   NAME FIELDS (Recommended for name searches):
   - Field 52: "Name" → name (confidence: 0.95)
   - Field 55: "Full Name" → name (confidence: 0.90)
   
   EMAIL FIELDS:
   - Field 50: "Username" → text (confidence: 0.60) 
   - Field 54: "Email Address" → email (confidence: 1.00)
   
   TEAM/GROUP FIELDS:
   - Field 17: "Team Members" → team (confidence: 0.85)
   - Field 32: "Notes/Comments" → text (confidence: 0.30)
   
   FORM COMPLEXITY:
   - Total fields: 61
   - Text fields: 34
   - Complex fields: 12 (name, email, address)
   - Conditional logic: Yes (15 conditions detected)
   
   CACHE STATUS: Fresh (generated 2 minutes ago)
   ```

5. Use cases:
   - Debugging search issues ("Why didn't it find the name?")
   - Form development guidance ("Which fields will be searchable?")
   - Performance optimization ("How complex is this form?")
   - Integration testing ("Are field mappings working correctly?")

This tool helps users understand how the universal search system sees their forms.
```

### Step 10: Enhance Existing get_entries with Fixed Search

**Goal**: Apply all improvements to the existing get_entries tool while maintaining backward compatibility.

**TDD Prompt:**

```typescript
Enhance existing get_entries tool with all universal search improvements:

1. Integration requirements:
   - Apply fixed search syntax from Step 1
   - Add response size management from Step 2  
   - Include optional universal search capabilities
   - Maintain 100% backward compatibility
   - Add new optional parameters without breaking existing usage

2. Enhanced tool parameters:
   - All existing parameters unchanged
   - search_mode (new, optional): 'standard' | 'universal' (default: 'standard')
   - response_mode (new, optional): 'full' | 'summary' | 'auto' (default: 'auto')  
   - field_detection (new, optional): boolean (default: false)

3. Backward compatibility testing:
   - All existing get_entries calls work identically
   - Default behavior unchanged (standard search, full responses)
   - New parameters are optional and don't affect existing usage
   - API response format remains consistent

4. Universal search integration:
   - When search_mode='universal': use UniversalSearchManager
   - Automatic field detection and intelligent searching
   - Enhanced result formatting with match context
   - Performance optimization and response size management

5. Test migration scenarios:
   - Existing tools and scripts continue working
   - Gradual adoption of new features (search_mode='universal')
   - Performance comparison: standard vs universal search modes
   - Edge cases: complex forms, large result sets, API failures

6. Documentation updates:
   - Clear explanation of new optional parameters
   - Examples showing universal search capabilities
   - Migration guide for adopting new features
   - Performance tuning recommendations

This ensures existing users see no breaking changes while providing access to new capabilities.
```

### Step 11: Performance Optimization and Caching

**Goal**: Optimize performance across all components with comprehensive caching.

**TDD Prompt:**

```typescript
Implement comprehensive performance optimization and caching strategy:

1. Write performance tests that verify:
   - Single API call achievement for most name searches (>80% cases)
   - Response times under 2 seconds for typical searches
   - Memory usage reasonable during large form analysis
   - Cache effectiveness (hit rates >70%)
   - Response size management prevents token overflow

2. Optimization areas:
   - Form field mapping cache with persistence option
   - Search result caching for frequently accessed queries
   - API response caching with smart invalidation
   - Batch processing for multiple field detections
   - Memory optimization for large form processing

3. Implement caching layers:
   - Level 1: In-memory field mapping cache (1 hour expiry)
   - Level 2: In-memory search result cache (15 minutes expiry)
   - Level 3: Optional SQLite persistence for field mappings
   - Smart cache invalidation on form updates

4. Performance monitoring:
   - Search execution time tracking
   - API call count monitoring  
   - Cache hit/miss rate statistics
   - Memory usage profiling
   - Response size monitoring

5. Test performance scenarios:
   - Cold start: first search on new form
   - Warm cache: repeated searches on same form
   - Large forms: 100+ fields with complex structure
   - Bulk operations: searching across multiple forms
   - Memory pressure: handling many cached forms

6. Configuration options:
   - SEARCH_CACHE_ENABLED (default: true)
   - SEARCH_CACHE_MAX_AGE_MS (default: 900000 = 15 minutes)
   - FIELD_MAPPING_CACHE_PERSISTENCE (default: false)
   - PERFORMANCE_MONITORING_ENABLED (default: true)

Ensure the system meets all performance targets while remaining responsive.
```

### Step 12: Advanced Search Features

**Goal**: Add advanced features like fuzzy matching, phonetic search, and multi-form search.

**TDD Prompt:**

```typescript
Implement advanced search features for enhanced matching capabilities:

1. Write tests for advanced matching algorithms:
   - Fuzzy string matching using Levenshtein distance
   - Phonetic matching for name variations (Soundex/Metaphone)
   - Multi-form search across related forms
   - Search result ranking and relevance scoring
   - Name variation handling (nicknames, abbreviations)

2. Fuzzy matching implementation:
   - Configurable similarity threshold (default: 0.8)
   - Character transposition handling
   - Length difference tolerance
   - Performance optimization for fuzzy searches

3. Phonetic matching features:
   - Soundex algorithm for English names
   - Handle common name variations: "John/Jon", "Catherine/Katherine"
   - Phonetic confidence scoring
   - Integration with existing search strategies

4. Multi-form search capabilities:
   - Search across multiple forms simultaneously
   - Form relationship detection (shared field structures)
   - Cross-form result correlation
   - Performance optimization for multi-form operations

5. Advanced result ranking:
   - Exact match prioritization
   - Field type relevance weighting (name fields > team mentions)
   - Recency scoring (newer entries ranked higher)
   - Payment status influence on relevance
   - User-configurable ranking factors

6. Test advanced scenarios:
   - Find "Jon Smyth" when entry contains "John Smith" (fuzzy)
   - Find "Bob" when entry contains "Robert" (phonetic)
   - Search for "Mary Johnson" across all league forms
   - Rank results by match quality and relevance

7. Configuration and tuning:
   - FUZZY_MATCH_THRESHOLD (default: 0.8)
   - PHONETIC_MATCHING_ENABLED (default: true)
   - MULTI_FORM_SEARCH_ENABLED (default: false)
   - RESULT_RANKING_WEIGHTS (default: balanced)

These features provide enterprise-grade search capabilities while maintaining performance.
```

### Step 13: Error Handling and Resilience

**Goal**: Implement comprehensive error handling and graceful degradation.

**TDD Prompt:**

```typescript
Create robust error handling and resilience mechanisms:

1. Write tests for comprehensive error scenarios:
   - API failures: timeouts, rate limits, authentication errors
   - Form structure issues: malformed forms, missing fields
   - Search input validation: invalid characters, empty searches
   - Cache corruption: database errors, memory issues
   - Network problems: intermittent connectivity, slow responses

2. Error classification system:
   - SearchError (base class with error codes and context)
   - FormAccessError (form not found, permission denied)
   - FieldDetectionError (field analysis failures)
   - ApiError (API communication issues)
   - CacheError (cache system problems)
   - ValidationError (input validation failures)

3. Graceful degradation strategies:
   - Fallback to standard search when universal search fails
   - Cache bypass when cache system unavailable
   - Simplified field detection when complex analysis fails
   - Partial results when some operations fail
   - Clear error messaging with suggested actions

4. Recovery mechanisms:
   - Automatic retry with exponential backoff for transient failures
   - Cache rebuilding when corruption detected
   - Alternative field detection methods when primary fails
   - Circuit breaker pattern for repeated API failures

5. Test error scenarios:
   - Form 999999 (does not exist) → clear "form not found" message
   - Rate limit exceeded → retry with backoff, then degrade gracefully
   - Cache corruption → rebuild cache, continue with API-only mode
   - Malformed search input → validation error with suggestions

6. Monitoring and alerting:
   - Error rate tracking by error type
   - Performance degradation detection
   - Cache health monitoring
   - API response time tracking

7. User experience:
   - Clear, actionable error messages
   - Suggested fixes for common problems
   - Fallback options when advanced features fail
   - Progress indicators for long operations

Ensure the system remains usable even when components fail.
```

### Step 14: Comprehensive Integration Testing

**Goal**: Test all components working together in realistic scenarios.

**TDD Prompt:**

```typescript
Create comprehensive integration tests for the complete universal search system:

1. Write end-to-end integration tests:
   - Complete search workflows from form analysis to result formatting
   - Multi-tool integration (search + export, search + template creation)
   - Performance under realistic load conditions
   - Cache behavior across multiple search sessions
   - Error recovery and graceful degradation

2. Real-world scenario testing:
   - League signup form: Find team member "Example Name" across all name and team fields
   - Event registration: Search for partial names in multi-page forms
   - Contact forms: Email and name search across various field configurations
   - Complex forms: 50+ fields with conditional logic and multi-step processes

3. Performance integration tests:
   - Cold system: first search on uncached forms
   - Warm system: repeated searches with full cache utilization
   - Mixed load: simultaneous searches across multiple forms
   - Memory usage: prolonged operation with cache growth
   - API efficiency: verify <2 API calls per search average

4. Cross-tool compatibility:
   - Universal search + bulk operations workflow
   - Field mapping inspection + search optimization
   - Template creation from search results
   - Export functionality with search filtering

5. Data quality testing:
   - Various name formats: "First Last", "Last, First", single names
   - International names: accents, unicode characters, various lengths
   - Edge cases: empty fields, null values, special characters
   - Large datasets: forms with 1000+ entries

6. Production simulation:
   - Multiple concurrent users (simulated)
   - Various form structures and complexities
   - Mixed usage patterns: heavy search users, occasional users
   - System startup and shutdown procedures
   - Configuration changes and cache invalidation

7. Regression testing:
   - All existing MCP tools continue working unchanged
   - Backward compatibility maintained across updates
   - Performance doesn't degrade with new features
   - Memory usage remains reasonable

Ensure the system works reliably in production-like conditions.
```

### Step 15: Documentation and User Guidance

**Goal**: Create comprehensive documentation and usage examples.

**TDD Prompt:**

```typescript
Create comprehensive documentation and user guidance for universal search:

1. Write user-facing documentation:
   - Quick start guide for common search tasks
   - Comprehensive tool reference with examples
   - Performance tuning guide for large forms
   - Troubleshooting guide for common issues
   - Migration guide from basic to universal search

2. Tool documentation updates:
   - search_entries_by_name: usage examples, parameter options
   - search_entries_universal: advanced scenarios, power user features  
   - get_field_mappings: debugging and analysis workflows
   - Enhanced get_entries: backward compatibility and new features

3. Configuration documentation:
   - Environment variable reference
   - Performance tuning parameters
   - Cache configuration options  
   - Monitoring and alerting setup

4. Integration examples:
   - Common workflows: search → analyze → act
   - Integration with existing tools (bulk operations, exports)
   - Custom field detection configuration
   - Multi-form search patterns

5. Performance guidance:
   - Form design recommendations for optimal search performance
   - Field naming best practices for auto-detection
   - Cache sizing and tuning for different usage patterns
   - Monitoring and optimization recommendations

6. API reference:
   - Complete parameter documentation
   - Response format examples
   - Error code reference
   - Rate limiting and usage guidelines

7. Testing and validation:
   - All documentation examples tested and verified
   - Code samples run successfully
   - Performance claims validated with benchmarks
   - User journey testing for documentation clarity

Provide users with everything needed for successful adoption and optimization.
```

### Step 16: Final Integration and Production Readiness

**Goal**: Prepare the system for production use with final testing and optimization.

**TDD Prompt:**

```typescript
Finalize universal search system for production deployment:

1. Production readiness checklist:
   - All tests passing (unit, integration, performance)
   - Memory usage profiled and optimized
   - Error handling comprehensive and user-friendly
   - Configuration externalized and documented
   - Performance targets met or exceeded
   - Security review completed

2. Final performance validation:
   - <2 second response time for 95% of searches
   - <25k tokens for all responses (no context overflow)
   - <2 API calls average per search operation
   - >95% field detection accuracy across diverse forms
   - Cache hit rate >70% for repeated operations

3. Production deployment testing:
   - Fresh installation and configuration
   - Various form types and complexities
   - Load testing with realistic usage patterns
   - Failover and recovery testing
   - Configuration change impact testing

4. Final code review and cleanup:
   - Remove debug code and temporary comments
   - Optimize imports and dependencies
   - Code style consistency across all files
   - TypeScript strict mode compliance
   - Security scan for potential vulnerabilities

5. Monitoring and observability:
   - Key performance indicators (KPIs) defined
   - Logging levels appropriate for production
   - Error tracking and alerting configured
   - Performance metrics collection enabled

6. Rollback planning:
   - Feature flags for gradual rollout
   - Rollback procedures documented
   - Backward compatibility verified
   - Data migration procedures if needed

7. Launch readiness:
   - User communication and training materials
   - Support procedures and troubleshooting guides
   - Performance monitoring dashboards
   - Success criteria and measurement plans

Complete system ready for production use with confidence.
```

## TDD Prompt Collection

Each step above provides a complete TDD prompt that builds incrementally on previous work. The prompts emphasize:

- **Test-First Development**: Write comprehensive tests before implementation
- **Incremental Progress**: Each step builds on the previous foundation  
- **Performance Focus**: Meeting specific targets for speed and response size
- **Universal Compatibility**: Works across all forms without configuration
- **Backward Compatibility**: Existing functionality remains unchanged
- **Production Readiness**: Comprehensive error handling, monitoring, and documentation

## Implementation Timeline

**Estimated Timeline: 3-4 weeks**

- **Week 1**: Foundation (Steps 1-4) - Fix core issues and build utilities
- **Week 2**: Field Detection & Search Engine (Steps 5-8) - Core search capabilities  
- **Week 3**: Tool Integration & Advanced Features (Steps 9-12) - User-facing tools
- **Week 4**: Testing, Optimization & Production (Steps 13-16) - Polish and deploy

## Success Metrics

### Technical Metrics:
- **API Efficiency**: <2 API calls per search (currently requires 3-6)
- **Response Speed**: <2 second search completion (currently 10+ seconds)
- **Token Management**: Zero context overflow incidents (currently causes crashes)
- **Accuracy**: >95% field detection success rate

### User Experience Metrics:
- **Usability**: One-command name searching across any form
- **Reliability**: >99.9% search success rate with graceful error handling
- **Performance**: Consistent sub-2-second response times
- **Flexibility**: Works with any Gravity Form structure without configuration

This comprehensive plan provides a roadmap for implementing universal name search that transforms the user experience from manual, error-prone pagination to fast, intelligent, single-command searching.