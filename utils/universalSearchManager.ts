// ABOUTME: Universal search manager for intelligent multi-field searching across Gravity Forms
// ABOUTME: Coordinates field detection, search strategies, confidence scoring, and result optimization

import { FieldTypeDetector, FormFieldMapping, DetectedFieldType, FieldTypeInfo, AnalysisResult } from './fieldTypeDetector';

export type SearchStrategy = 'exact' | 'contains' | 'fuzzy' | 'auto';

export interface SearchOptions {
    strategy: SearchStrategy;
    maxResults: number;
    includeContext: boolean;
}

export interface SearchMatch {
    entryId: string;
    matchedFields: { [fieldId: string]: string };
    confidence: number;
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
    fieldsSearched: number;
    executionTimeMs: number;
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
    getFormDefinition(formId: string): Promise<any>;
    searchEntries(formId: string, searchParams: any): Promise<any[]>;
}

export class UniversalSearchManager {
    private fieldDetector: FieldTypeDetector;
    private apiClient: ApiClient;
    private defaultOptions: SearchOptions;

    constructor(fieldDetector: FieldTypeDetector, apiClient: ApiClient) {
        this.fieldDetector = fieldDetector;
        this.apiClient = apiClient;
        this.defaultOptions = {
            strategy: 'auto',
            maxResults: 50,
            includeContext: true
        };
    }

    /**
     * Search for names across all detected name fields
     */
    public async searchByName(formId: string, searchText: string, options?: Partial<SearchOptions>): Promise<SearchResult> {
        this.validateInput(formId, searchText);
        
        const startTime = Date.now();
        const searchOptions = { ...this.defaultOptions, ...options };

        try {
            // Get form definition and analyze fields
            const formDefinition = await this.apiClient.getFormDefinition(formId);
            const analysisResult = this.fieldDetector.analyzeFormFieldsWithStatus(formDefinition);
            
            // Get name fields for searching
            const nameFields = this.fieldDetector.getNameFields(analysisResult.mapping);
            // Also include team fields since names can be mentioned there
            const teamFields = this.fieldDetector.getFieldsByType(analysisResult.mapping, 'team');
            const fieldsToSearch = [...nameFields, ...teamFields];
            
            if (fieldsToSearch.length === 0) {
                // Fallback to all text fields if no name or team fields detected
                const allTextFields = this.fieldDetector.getAllTextFields(analysisResult.mapping);
                return await this.executeSearch(formId, searchText, allTextFields, searchOptions, analysisResult, startTime);
            }

            return await this.executeSearch(formId, searchText, fieldsToSearch, searchOptions, analysisResult, startTime);
        } catch (error) {
            throw new Error(`Name search failed for form ${formId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Search for emails across all detected email fields
     */
    public async searchByEmail(formId: string, searchText: string, options?: Partial<SearchOptions>): Promise<SearchResult> {
        this.validateInput(formId, searchText);
        
        const startTime = Date.now();
        const searchOptions = { ...this.defaultOptions, ...options };

        try {
            // Get form definition and analyze fields
            const formDefinition = await this.apiClient.getFormDefinition(formId);
            const analysisResult = this.fieldDetector.analyzeFormFieldsWithStatus(formDefinition);
            
            // Get email fields for searching
            const emailFields = this.fieldDetector.getEmailFields(analysisResult.mapping);
            
            if (emailFields.length === 0) {
                // No email fields detected - return empty result
                return this.createEmptyResult(formId, searchText, searchOptions.strategy, analysisResult, startTime);
            }

            return await this.executeSearch(formId, searchText, emailFields, searchOptions, analysisResult, startTime);
        } catch (error) {
            throw new Error(`Email search failed for form ${formId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Universal search across specified field types
     */
    public async searchUniversal(formId: string, searchText: string, fieldTypes: DetectedFieldType[], options?: Partial<SearchOptions>): Promise<SearchResult> {
        this.validateInput(formId, searchText);
        
        const startTime = Date.now();
        const searchOptions = { ...this.defaultOptions, ...options };

        try {
            // Get form definition and analyze fields
            const formDefinition = await this.apiClient.getFormDefinition(formId);
            const analysisResult = this.fieldDetector.analyzeFormFieldsWithStatus(formDefinition);
            
            // Get fields by specified types
            let fieldsToSearch: FieldTypeInfo[] = [];
            
            if (fieldTypes.length === 0) {
                // Search all text fields if no specific types specified
                fieldsToSearch = this.fieldDetector.getAllTextFields(analysisResult.mapping);
            } else {
                // Combine fields from all specified types
                for (const fieldType of fieldTypes) {
                    const typeFields = this.fieldDetector.getFieldsByType(analysisResult.mapping, fieldType);
                    fieldsToSearch = fieldsToSearch.concat(typeFields);
                }
            }

            return await this.executeSearch(formId, searchText, fieldsToSearch, searchOptions, analysisResult, startTime);
        } catch (error) {
            throw new Error(`Universal search failed for form ${formId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    public calculateMatchConfidence(entry: any, searchText: string, matchedFields: { [fieldId: string]: string }): number {
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
                    word.length > 2 && valueLower.includes(word)
                );
                if (matchingWords.length > 0) {
                    fieldConfidence = Math.min(0.7, matchingWords.length / searchWords.length * 0.7);
                }
            }

            // Boost confidence based on field type (name fields are more relevant than team mentions)
            if (this.isNameField(fieldId)) {
                fieldConfidence *= 1.2; // 20% boost for name fields
            } else if (this.isEmailField(fieldId)) {
                fieldConfidence *= 1.1; // 10% boost for email fields
            }

            totalConfidence += Math.min(1.0, fieldConfidence);
            fieldCount++;
        }

        // Average confidence across all matched fields
        const baseConfidence = fieldCount > 0 ? totalConfidence / fieldCount : 0;
        
        // Slight boost for multiple field matches (indicates stronger match)
        const multiFieldBoost = fieldCount > 1 ? Math.min(0.1, (fieldCount - 1) * 0.05) : 0;
        
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

        // Execute API search
        const searchParams = {
            field_filters: fieldFilters
        };
        
        const entries = await this.apiClient.searchEntries(formId, searchParams);
        
        // Process results into matches with confidence scoring
        const matches = this.processSearchResults(entries, searchText, fields, options.maxResults);
        
        // Create search metadata
        const executionTimeMs = Date.now() - startTime;
        const searchMetadata: SearchMetadata = {
            formId,
            searchText,
            strategy: options.strategy, // Use original strategy, not resolved one
            fieldsSearched: fields.length,
            executionTimeMs,
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
     * Process API search results into SearchMatch objects with confidence scoring
     */
    private processSearchResults(entries: any[], searchText: string, fields: FieldTypeInfo[], maxResults: number): SearchMatch[] {
        if (!entries || entries.length === 0) {
            return [];
        }

        const matches: SearchMatch[] = [];
        const searchLower = searchText.toLowerCase();

        for (const entry of entries) {
            // Find which fields actually matched the search
            const matchedFields: { [fieldId: string]: string } = {};
            
            for (const field of fields) {
                const fieldValue = entry[field.fieldId];
                if (fieldValue && typeof fieldValue === 'string') {
                    const valueLower = fieldValue.toLowerCase();
                    if (valueLower.includes(searchLower) || this.containsSearchWords(valueLower, searchLower)) {
                        matchedFields[field.fieldId] = fieldValue;
                    }
                }
            }

            // Only include entries that have actual matches
            if (Object.keys(matchedFields).length > 0) {
                const confidence = this.calculateMatchConfidence(entry, searchText, matchedFields);
                
                matches.push({
                    entryId: entry.id || entry.entry_id || 'unknown',
                    matchedFields,
                    confidence
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
        
        // For very short (<=3 chars), exact-looking searches, use exact matching
        if (searchText.length <= 3 && !searchText.includes(' ')) {
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
                return '=';
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
        const searchWords = searchText.split(/\s+/).filter(word => word.length > 2);
        return searchWords.some(word => fieldValue.includes(word));
    }

    /**
     * Check if field ID represents a name field (heuristic)
     */
    private isNameField(fieldId: string): boolean {
        // Common name field patterns: standalone numbers (52, 55) or name sub-fields (1.3, 1.6)
        return /^\d+$/.test(fieldId) || /^\d+\.[36]$/.test(fieldId);
    }

    /**
     * Check if field ID represents an email field (heuristic)
     */
    private isEmailField(fieldId: string): boolean {
        // Email fields are typically standalone numbers or specific sub-fields
        return /^\d+$/.test(fieldId) || /^\d+\.1$/.test(fieldId);
    }

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
                fieldsSearched: 0,
                executionTimeMs,
                cacheStatus: {
                    hit: analysisResult.cacheStatus.hit,
                    source: analysisResult.cacheStatus.source,
                    timestamp: analysisResult.cacheStatus.timestamp
                }
            }
        };
    }

    /**
     * Validate input parameters
     */
    private validateInput(formId: string, searchText: string): void {
        if (!formId || typeof formId !== 'string' || formId.trim() === '') {
            throw new Error('Form ID is required and must be a non-empty string');
        }
        
        if (!searchText || typeof searchText !== 'string' || searchText.trim() === '') {
            throw new Error('Search text is required and must be a non-empty string');
        }
    }
}