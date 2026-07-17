// ABOUTME: Universal search manager for intelligent multi-field searching across Gravity Forms
// ABOUTME: Coordinates field detection, search strategies, confidence scoring, and result optimization

import type { AnalysisResult, DetectedFieldType, FieldTypeDetector, FieldTypeInfo, FormFieldMapping } from './fieldTypeDetector.js';
import { type ICacheStats, SearchResultsCache } from './searchResultsCache.js';
import { PerformanceMonitor } from './performanceMonitor.js';
import type { IGravityEntry, IGravityForm } from './gravityFormsTypes.js';

export type SearchStrategy = 'exact' | 'contains' | 'fuzzy' | 'auto';

export interface SearchOptions {
    strategy: SearchStrategy;
    maxResults: number;
    includeContext: boolean;
}

export interface SearchMatch {
    entryId: string;
    matchedFields: Record<string, string>;
    confidence: number;
    entryData: IGravityEntry;  // Full entry data for formatting
}

export interface SearchResult {
    matches: SearchMatch[];
    totalFound: number;
    searchMetadata: SearchMetadata;
}

export interface SearchMetadata {
    formId: string;
    searchText: string;
    strategy: SearchStrategy;
    fieldsSearched: string[];   // Array of field IDs for SearchResultsFormatter compatibility
    executionTime: number;      // Renamed from executionTimeMs for compatibility
    apiCalls: number;           // Required by SearchResultsFormatter
    cacheStatus: {
        hit: boolean;
        source: 'cache' | 'analysis';
        timestamp: Date;
    };
}

export interface FieldFilter {
    key: string;
    value: string;
    operator: string;
}

export interface ApiClient {
    getFormDefinition(formId: string): Promise<IGravityForm>;
    searchEntries(formId: string, searchParams: unknown): Promise<IGravityEntry[]>;
}

export class UniversalSearchManager {
    private readonly fieldDetector: FieldTypeDetector;
    private readonly apiClient: ApiClient;
    private readonly defaultOptions: SearchOptions;
    private readonly searchCache: SearchResultsCache;
    private readonly performanceMonitor: PerformanceMonitor;

    // Constants for better maintainability
    private static readonly EXACT_SEARCH_MAX_LENGTH = 3;
    private static readonly NAME_FIELD_CONFIDENCE_BOOST = 1.2;
    private static readonly EMAIL_FIELD_CONFIDENCE_BOOST = 1.1;
    private static readonly MULTI_FIELD_BOOST_INCREMENT = 0.05;
    private static readonly MAX_MULTI_FIELD_BOOST = 0.1;
    private static readonly MIN_WORD_LENGTH_FOR_MATCHING = 2;

    constructor(fieldDetector: FieldTypeDetector, apiClient: ApiClient) {
        this.fieldDetector = fieldDetector;
        this.apiClient = apiClient;
        this.defaultOptions = {
            strategy: 'auto',
            maxResults: 50,
            includeContext: true
        };
        
        // Initialize performance optimization components
        this.searchCache = new SearchResultsCache({
            maxAge: Math.max(1000, parseInt(process.env['SEARCH_CACHE_MAX_AGE_MS'] ?? '900000') || 900000), // 15 minutes default, min 1 second
            maxSize: Math.max(1, parseInt(process.env['SEARCH_CACHE_MAX_SIZE'] ?? '100') || 100), // default 100, min 1
            enableLogging: process.env['NODE_ENV'] === 'development'
        });
        this.performanceMonitor = new PerformanceMonitor();
    }

    /**
     * Search for names across all detected name fields
     */
    public async searchByName(formId: string, searchText: string, options?: Partial<SearchOptions>): Promise<SearchResult> {
        const { cleanFormId, cleanSearchText } = this.validateInput(formId, searchText);
        const searchOptions = { ...this.defaultOptions, ...options };
        
        // Start performance monitoring
        const perfHandle = this.performanceMonitor.startTimer('search_by_name');
        
        try {
            // Resolve the actual strategy that will be used for consistent caching
            const resolvedStrategy = searchOptions.strategy === 'auto' ? this.determineOptimalStrategy(cleanSearchText) : searchOptions.strategy;
            
            // Check cache first using resolved strategy
            const cachedResult = this.searchCache.get(cleanFormId, cleanSearchText, resolvedStrategy);
            if (cachedResult) {
                this.performanceMonitor.incrementCounter('cache_hits');
                this.performanceMonitor.endTimer('search_by_name', perfHandle);
                return cachedResult;
            }
            
            // Cache miss - proceed with search
            this.performanceMonitor.incrementCounter('cache_misses');
            const startTime = Date.now();

            // Get form definition and analyze fields
            this.performanceMonitor.incrementCounter('api_calls');
            const formDefinition = await this.apiClient.getFormDefinition(cleanFormId);
            const analysisResult = this.fieldDetector.analyzeFormFieldsWithStatus(formDefinition);
            
            // Get name fields for searching
            const nameFields = this.fieldDetector.getNameFields(analysisResult.mapping);
            // Also include team fields since names can be mentioned there
            const teamFields = this.fieldDetector.getFieldsByType(analysisResult.mapping, 'team');
            const fieldsToSearch = [...nameFields, ...teamFields];
            
            let searchResult: SearchResult;
            
            if (fieldsToSearch.length === 0) {
                // Fallback to all text fields if no name or team fields detected
                const allTextFields = this.fieldDetector.getAllTextFields(analysisResult.mapping);
                searchResult = await this.executeSearch(cleanFormId, cleanSearchText, allTextFields, searchOptions, analysisResult, startTime);
            } else {
                searchResult = await this.executeSearch(cleanFormId, cleanSearchText, fieldsToSearch, searchOptions, analysisResult, startTime);
            }

            // Cache the result using resolved strategy
            this.searchCache.set(cleanFormId, cleanSearchText, searchResult, resolvedStrategy);
            this.performanceMonitor.endTimer('search_by_name', perfHandle);
            
            return searchResult;
        } catch (error) {
            this.performanceMonitor.incrementCounter('search_errors');
            this.performanceMonitor.endTimer('search_by_name', perfHandle);
            throw new Error(`Name search failed for form ${cleanFormId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Search for emails across all detected email fields
     */
    public async searchByEmail(formId: string, searchText: string, options?: Partial<SearchOptions>): Promise<SearchResult> {
        const { cleanFormId, cleanSearchText } = this.validateInput(formId, searchText);
        
        const startTime = Date.now();
        const searchOptions = { ...this.defaultOptions, ...options };

        try {
            // Get form definition and analyze fields
            const formDefinition = await this.apiClient.getFormDefinition(cleanFormId);
            const analysisResult = this.fieldDetector.analyzeFormFieldsWithStatus(formDefinition);
            
            // Get email fields for searching
            const emailFields = this.fieldDetector.getEmailFields(analysisResult.mapping);
            
            if (emailFields.length === 0) {
                // No email fields detected - return empty result
                return this.createEmptyResult(cleanFormId, cleanSearchText, searchOptions.strategy, analysisResult, startTime);
            }

            return await this.executeSearch(cleanFormId, cleanSearchText, emailFields, searchOptions, analysisResult, startTime);
        } catch (error) {
            throw new Error(`Email search failed for form ${cleanFormId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Universal search across specified field types
     */
    public async searchUniversal(formId: string, searchText: string, fieldTypes: DetectedFieldType[], options?: Partial<SearchOptions>): Promise<SearchResult> {
        const { cleanFormId, cleanSearchText } = this.validateInput(formId, searchText);
        
        const startTime = Date.now();
        const searchOptions = { ...this.defaultOptions, ...options };

        try {
            // Get form definition and analyze fields
            const formDefinition = await this.apiClient.getFormDefinition(cleanFormId);
            const analysisResult = this.fieldDetector.analyzeFormFieldsWithStatus(formDefinition);
            
            // Get fields by specified types with deduplication
            let fieldsToSearch: FieldTypeInfo[] = [];
            
            if (fieldTypes.length === 0) {
                // Search all text fields if no specific types specified
                fieldsToSearch = this.fieldDetector.getAllTextFields(analysisResult.mapping);
            } else {
                // Combine fields from all specified types with deduplication
                const fieldMap = new Map<string, FieldTypeInfo>();
                
                for (const fieldType of fieldTypes) {
                    const typeFields = this.fieldDetector.getFieldsByType(analysisResult.mapping, fieldType);
                    for (const field of typeFields) {
                        fieldMap.set(field.fieldId, field);
                    }
                }
                
                fieldsToSearch = Array.from(fieldMap.values());
            }

            return await this.executeSearch(cleanFormId, cleanSearchText, fieldsToSearch, searchOptions, analysisResult, startTime);
        } catch (error) {
            throw new Error(`Universal search failed for form ${cleanFormId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Build field filters for API search based on detected fields and strategy
     */
    public buildFieldFilters(fields: FieldTypeInfo[], searchText: string, strategy: SearchStrategy): FieldFilter[] {
        if (!fields || fields.length === 0) {
            return [];
        }

        const operator = this.getOperatorForStrategy(strategy);
        
        return fields.map(field => ({
            key: field.fieldId,
            value: searchText,
            operator
        }));
    }

    /**
     * Calculate match confidence based on matched fields and search context
     */
    public calculateMatchConfidence(entry: IGravityEntry, searchText: string, matchedFields: Record<string, string>, fieldMapping?: FormFieldMapping): number {
        if (!matchedFields || Object.keys(matchedFields).length === 0) {
            return 0;
        }

        let totalConfidence = 0;
        let fieldCount = 0;
        const searchLower = searchText.toLowerCase();

        for (const [fieldId, fieldValue] of Object.entries(matchedFields)) {
            if (!fieldValue) continue;
            
            const valueLower = fieldValue.toLowerCase();
            let fieldConfidence = 0;

            // Exact match gets highest confidence
            if (valueLower === searchLower) {
                fieldConfidence = 1.0;
            }
            // Check if search text is contained in field
            else if (valueLower.includes(searchLower)) {
                // Higher confidence for shorter fields (less likely to be coincidental)
                const containmentRatio = searchLower.length / valueLower.length;
                fieldConfidence = Math.min(0.9, 0.3 + (containmentRatio * 0.6));
            }
            // Check if field contains any words from search text
            else {
                const searchWords = searchLower.split(/\s+/);
                const matchingWords = searchWords.filter(word => 
                    word.length > UniversalSearchManager.MIN_WORD_LENGTH_FOR_MATCHING && valueLower.includes(word)
                );
                if (matchingWords.length > 0) {
                    fieldConfidence = Math.min(0.7, matchingWords.length / searchWords.length * 0.7);
                }
            }

            // Boost confidence based on actual detected field type (not heuristics)
            if (fieldMapping?.[fieldId]) {
                const fieldType = fieldMapping[fieldId].fieldType;
                if (fieldType === 'name') {
                    fieldConfidence *= UniversalSearchManager.NAME_FIELD_CONFIDENCE_BOOST;
                } else if (fieldType === 'email') {
                    fieldConfidence *= UniversalSearchManager.EMAIL_FIELD_CONFIDENCE_BOOST;
                }
            }

            totalConfidence += Math.min(1.0, fieldConfidence);
            fieldCount++;
        }

        // Average confidence across all matched fields
        const baseConfidence = fieldCount > 0 ? totalConfidence / fieldCount : 0;
        
        // Slight boost for multiple field matches (indicates stronger match)
        const multiFieldBoost = fieldCount > 1 ? 
            Math.min(UniversalSearchManager.MAX_MULTI_FIELD_BOOST, (fieldCount - 1) * UniversalSearchManager.MULTI_FIELD_BOOST_INCREMENT) : 0;
        
        return Math.min(1.0, baseConfidence + multiFieldBoost);
    }

    /**
     * Execute search with given fields and options
     */
    private async executeSearch(
        formId: string, 
        searchText: string, 
        fields: FieldTypeInfo[], 
        options: SearchOptions,
        analysisResult: AnalysisResult,
        startTime: number
    ): Promise<SearchResult> {
        const strategy = options.strategy === 'auto' ? this.determineOptimalStrategy(searchText) : options.strategy;
        
        // Build field filters for API search
        const fieldFilters = this.buildFieldFilters(fields, searchText, strategy);
        
        if (fieldFilters.length === 0) {
            return this.createEmptyResult(formId, searchText, strategy, analysisResult, startTime);
        }

        // Execute API search.
        // Gravity Forms combines an ARRAY of field_filters with AND ("all") and IGNORES a
        // sibling "mode" key — so a multi-field name/email search would only match when the
        // text is present in EVERY targeted field (i.e. never). To OR across the targeted
        // fields — the correct semantic here ("find this text in ANY of these fields") — the
        // filters must be sent in GF's OBJECT form with an embedded mode:
        //   { mode: "any", "0": {...}, "1": {...} }
        const searchParams = {
            field_filters: fieldFilters.reduce(
                (acc: Record<string, unknown>, filter, index) => {
                    acc[String(index)] = filter;
                    return acc;
                },
                { mode: 'any' } as Record<string, unknown>
            )
        };

        const entries = await this.apiClient.searchEntries(formId, searchParams);
        
        // Process results into matches with confidence scoring
        const matches = this.processSearchResults(entries, searchText, fields, options.maxResults, analysisResult.mapping);
        
        // Create search metadata
        const executionTimeMs = Date.now() - startTime;
        const searchMetadata: SearchMetadata = {
            formId,
            searchText,
            strategy: strategy, // Use resolved strategy for accurate reporting
            fieldsSearched: fields.map(f => f.fieldId), // Array of field IDs for SearchResultsFormatter compatibility
            executionTime: executionTimeMs, // Renamed for compatibility
            // searchEntries is always one call; the field analysis adds a getFormDefinition
            // call unless it was served from cache (audit B4 — was hardcoded to 1).
            apiCalls: analysisResult.cacheStatus.hit ? 1 : 2,
            cacheStatus: {
                hit: analysisResult.cacheStatus.hit,
                source: analysisResult.cacheStatus.source,
                timestamp: analysisResult.cacheStatus.timestamp
            }
        };

        return {
            matches,
            totalFound: matches.length,
            searchMetadata
        };
    }

    /**
     * Resolves an entry's id for a SearchMatch. entry_id is a legacy fallback
     * key (not a real GF REST API field) kept for defense-in-depth.
     */
    private resolveEntryId(entry: IGravityEntry): string {
        if (entry.id) {
            return entry.id;
        }
        if (typeof entry.entry_id === 'string' && entry.entry_id) {
            return entry.entry_id;
        }
        return 'unknown';
    }

    /**
     * Process API search results into SearchMatch objects with confidence scoring
     */
    private processSearchResults(entries: IGravityEntry[], searchText: string, fields: FieldTypeInfo[], maxResults: number, fieldMapping: FormFieldMapping): SearchMatch[] {
        if (!entries || entries.length === 0) {
            return [];
        }

        const matches: SearchMatch[] = [];
        const searchLower = searchText.toLowerCase();

        for (const entry of entries) {
            // Find which fields actually matched the search
            const matchedFields: Record<string, string> = {};
            
            for (const field of fields) {
                const fieldValue = entry[field.fieldId];
                // Add null safety - check for null/undefined before processing
                if (fieldValue != null && typeof fieldValue === 'string' && fieldValue.trim() !== '') {
                    const valueLower = fieldValue.toLowerCase();
                    if (valueLower.includes(searchLower) || this.containsSearchWords(valueLower, searchLower)) {
                        matchedFields[field.fieldId] = fieldValue;
                    }
                }
            }

            // Only include entries that have actual matches
            if (Object.keys(matchedFields).length > 0) {
                const confidence = this.calculateMatchConfidence(entry, searchText, matchedFields, fieldMapping);
                
                matches.push({
                    entryId: this.resolveEntryId(entry),
                    matchedFields,
                    confidence,
                    entryData: entry  // Add full entry data for SearchResultsFormatter compatibility
                });
            }
        }

        // Sort by confidence (highest first) and limit results
        matches.sort((a, b) => b.confidence - a.confidence);
        return matches.slice(0, maxResults);
    }

    /**
     * Determine optimal search strategy based on search text
     */
    private determineOptimalStrategy(searchText: string): SearchStrategy {
        // For email-like patterns, always use contains
        if (searchText.includes('@') || searchText.includes('.com') || searchText.includes('.org')) {
            return 'contains';
        }
        
        // For very short, exact-looking searches, use exact matching
        if (searchText.length <= UniversalSearchManager.EXACT_SEARCH_MAX_LENGTH && !searchText.includes(' ')) {
            return 'exact';
        }
        
        // For names and longer text, use contains (default for most searches)
        return 'contains';
    }

    /**
     * Get API operator for search strategy
     */
    private getOperatorForStrategy(strategy: SearchStrategy): string {
        switch (strategy) {
            case 'exact':
                // 'is' is the Gravity Forms operator for exact equality. '=' is NOT in the
                // API's valid operator set (is/isnot/contains/>/</>=/<=) — it is either
                // rejected or silently ignored, breaking short exact searches (audit A9).
                return 'is';
            case 'contains':
            case 'fuzzy': // Fuzzy search uses contains for now
            case 'auto':
            default:
                return 'contains';
        }
    }

    /**
     * Check if search text words are contained in field value
     */
    private containsSearchWords(fieldValue: string, searchText: string): boolean {
        const searchWords = searchText.split(/\s+/).filter(word => word.length > UniversalSearchManager.MIN_WORD_LENGTH_FOR_MATCHING);
        return searchWords.some(word => fieldValue.includes(word));
    }

    // Removed flawed heuristic methods - now using proper field type detection

    /**
     * Create empty search result
     */
    private createEmptyResult(formId: string, searchText: string, strategy: SearchStrategy, analysisResult: AnalysisResult, startTime: number): SearchResult {
        const executionTimeMs = Date.now() - startTime;
        
        return {
            matches: [],
            totalFound: 0,
            searchMetadata: {
                formId,
                searchText,
                strategy,
                fieldsSearched: [],
                executionTime: executionTimeMs,
                apiCalls: 0,
                cacheStatus: {
                    hit: analysisResult.cacheStatus.hit,
                    source: analysisResult.cacheStatus.source,
                    timestamp: analysisResult.cacheStatus.timestamp
                }
            }
        };
    }

    /**
     * Validate input parameters and return cleaned values
     */
    private validateInput(formId: string, searchText: string): { cleanFormId: string; cleanSearchText: string } {
        if (!formId || typeof formId !== 'string') {
            throw new Error('Form ID is required and must be a string');
        }
        
        const cleanFormId = formId.trim();
        if (cleanFormId === '') {
            throw new Error('Form ID must be a non-empty string');
        }
        
        if (!searchText || typeof searchText !== 'string') {
            throw new Error('Search text is required and must be a string');
        }
        
        const cleanSearchText = searchText.trim();
        if (cleanSearchText === '') {
            throw new Error('Search text must be a non-empty string');
        }
        
        return { cleanFormId, cleanSearchText };
    }

    /**
     * Search entries using specific field IDs rather than detected field types
     */
    public async searchByFieldIds(formId: string, searchText: string, fieldIds: string[], options?: Partial<SearchOptions>): Promise<SearchResult> {
        const { cleanFormId, cleanSearchText } = this.validateInput(formId, searchText);
        
        if (!fieldIds || fieldIds.length === 0) {
            throw new Error('Field IDs array is required and must not be empty');
        }

        const startTime = Date.now();
        const searchOptions = { ...this.defaultOptions, ...options };

        try {
            // Get form definition for field information
            const formDefinition = await this.apiClient.getFormDefinition(cleanFormId);
            const analysisResult = this.fieldDetector.analyzeFormFieldsWithStatus(formDefinition);
            
            // Convert field IDs to FieldTypeInfo objects for consistency
            const targetFields: FieldTypeInfo[] = fieldIds.map(fieldId => {
                // Try to get field info from analysis, or create basic info
                const existingField = analysisResult.mapping[fieldId];
                if (existingField) {
                    return existingField;
                } else {
                    // Create basic field info for unknown fields
                    const fieldData = formDefinition.fields?.find(f => f.id === fieldId);
                    // fieldData?.label may legitimately be an empty string; fall back
                    // to the placeholder label for any falsy value, not just absence.
                    let label = `Field ${fieldId}`;
                    if (fieldData?.label) {
                        label = fieldData.label;
                    }
                    return {
                        fieldId,
                        fieldType: 'text' as DetectedFieldType,
                        confidence: 0.5,
                        label
                    };
                }
            });

            return await this.executeSearch(cleanFormId, cleanSearchText, targetFields, searchOptions, analysisResult, startTime);
        } catch (error) {
            throw new Error(`Field ID search failed for form ${cleanFormId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get performance statistics
     */
    public getPerformanceStats(): {
        search: ReturnType<PerformanceMonitor['getStats']>;
        cache: ICacheStats;
        summary: ReturnType<PerformanceMonitor['getSummary']>;
    } {
        return {
            search: this.performanceMonitor.getStats(),
            cache: this.searchCache.getCacheStats(),
            summary: this.performanceMonitor.getSummary()
        };
    }

    /**
     * Clear performance caches
     */
    public clearCaches(): void {
        this.searchCache.clear();
        this.performanceMonitor.reset();
    }

    /**
     * Invalidate cache for specific form
     */
    public invalidateFormCache(formId: string): void {
        this.searchCache.invalidateForm(formId);
    }
}