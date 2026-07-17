// ABOUTME: Search MCP tool handlers (search_entries_by_name, search_entries_universal)
// ABOUTME: Extracted from GravityFormsMCPServer to isolate handler logic from server infrastructure

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { DetectedFieldType, FieldTypeDetector, FieldTypeInfo } from "./fieldTypeDetector.js";
import type { SearchResult as FormattedSearchResult, FormInfo, OutputMode, SearchResultsFormatter } from "./searchResultsFormatter.js";
import type { SearchMatch, SearchStrategy, UniversalSearchManager } from "./universalSearchManager.js";
import type { IGravityForm } from "./gravityFormsTypes.js";

// Limit for search operations
const SEARCH_RESULTS_LIMIT = 100;

export interface SearchToolContext {
  makeRequest<T = unknown>(endpoint: string, method?: string, body?: unknown): Promise<T>;
  fieldTypeDetector: FieldTypeDetector;
  searchResultsFormatter: SearchResultsFormatter;
  getUniversalSearchManager(): UniversalSearchManager;
}

export interface SearchToolResult {
  content: Array<{ type: "text"; text: string }>;
}

/**
 * Renders a SearchMetadata.fieldsSearched value for display. The declared
 * type is string[], but callers (and tests) may pass a plain count instead -
 * this renders either form the same way `${value}` template coercion did
 * before this file was typed.
 */
function displayFieldsSearched(fieldsSearched: unknown): string {
  if (Array.isArray(fieldsSearched)) {
    return fieldsSearched.join(',');
  }
  if (typeof fieldsSearched === 'number' || typeof fieldsSearched === 'string') {
    return String(fieldsSearched);
  }
  return '';
}

/**
 * Builds the FormInfo passed to SearchResultsFormatter, shared by both search tools.
 */
function buildFormInfo(formData: IGravityForm, formId: string, fieldMapping: Record<string, FieldTypeInfo>): FormInfo {
  return {
    id: formData.id,
    title: formData.title || `Form ${formId}`,
    fields: formData.fields ?? [],
    fieldMapping
  };
}

// ============================================================================
// search_entries_by_name
// ============================================================================

interface SearchEntriesByNameArgs {
  form_id?: unknown;
  search_text?: unknown;
  strategy?: unknown;
  max_results?: unknown;
  output_mode?: unknown;
}

interface ValidatedSearchByNameArgs {
  formId: string;
  searchText: string;
  searchStrategy: SearchStrategy;
  maxResults: number;
  outputMode: OutputMode;
}

/**
 * Validates the optional max_results parameter's type and range, shared by
 * both search tools' argument validation.
 */
function validateMaxResultsRange(maxResults: unknown): void {
  if (maxResults !== undefined && maxResults !== null) {
    if (typeof maxResults !== 'number' || !Number.isInteger(maxResults)) {
      throw new McpError(ErrorCode.InvalidRequest, 'max_results must be an integer');
    }
    if (maxResults <= 0) {
      throw new McpError(ErrorCode.InvalidRequest, 'max_results must be greater than 0');
    }
    if (maxResults > 1000) {
      throw new McpError(ErrorCode.InvalidRequest, 'max_results cannot exceed 1000');
    }
  }
}

function validateSearchByNameArgs(args: SearchEntriesByNameArgs): ValidatedSearchByNameArgs {
  const { form_id, search_text, strategy, max_results, output_mode } = args;

  if (!form_id || typeof form_id !== 'string') {
    throw new McpError(ErrorCode.InvalidRequest, 'form_id must be a non-empty string');
  }

  if (form_id.trim() === '') {
    throw new McpError(ErrorCode.InvalidRequest, 'form_id cannot be empty');
  }

  if (!search_text || typeof search_text !== 'string') {
    throw new McpError(ErrorCode.InvalidRequest, 'search_text must be a non-empty string');
  }

  if (!search_text.trim()) {
    throw new McpError(ErrorCode.InvalidRequest, 'search_text cannot be empty or whitespace-only');
  }

  if (search_text.length > 1000) {
    throw new McpError(ErrorCode.InvalidRequest, 'search_text exceeds maximum length of 1000 characters');
  }

  // Validate optional parameters
  const validStrategies: SearchStrategy[] = ['exact', 'contains', 'fuzzy', 'auto'];
  const searchStrategy: SearchStrategy = validStrategies.includes(strategy as SearchStrategy)
    ? (strategy as SearchStrategy)
    : 'auto';

  const maxResults = typeof max_results === 'number' ? max_results : 50;

  const validOutputModes: OutputMode[] = ['detailed', 'summary', 'minimal', 'auto'];
  const outputMode: OutputMode = validOutputModes.includes(output_mode as OutputMode)
    ? (output_mode as OutputMode)
    : 'auto';

  validateMaxResultsRange(max_results);

  return { formId: form_id, searchText: search_text, searchStrategy, maxResults, outputMode };
}

export async function searchEntriesByName(ctx: SearchToolContext, args: SearchEntriesByNameArgs): Promise<SearchToolResult> {
  try {
    const validated = validateSearchByNameArgs(args);

    // Get UniversalSearchManager instance
    const searchManager = ctx.getUniversalSearchManager();

    // Perform universal name search
    const searchResult = await searchManager.searchByName(
      validated.formId,
      validated.searchText,
      {
        strategy: validated.searchStrategy,
        maxResults: validated.maxResults,
        includeContext: true
      }
    );

    // Get form data for formatting context
    const formData = await ctx.makeRequest<IGravityForm>(`/forms/${validated.formId}`);

    // Transform UniversalSearchManager result to SearchResultsFormatter format.
    // entryData is kept as the full entry (not narrowed to matchedFields) so
    // fields that weren't searched, e.g. email during a name search, are
    // still available for the formatter to render. matchedFields stays on
    // the match separately to indicate which fields actually matched.
    const transformedResult: FormattedSearchResult = {
      matches: searchResult.matches,
      totalFound: searchResult.totalFound,
      searchMetadata: {
        searchText: searchResult.searchMetadata.searchText,
        executionTime: searchResult.searchMetadata.executionTime,
        apiCalls: 1, // Default for now
        fieldsSearched: [`${displayFieldsSearched(searchResult.searchMetadata.fieldsSearched)} fields`] // Convert field id list to a display string
      }
    };

    // Format results with SearchResultsFormatter
    let fieldMapping: Record<string, FieldTypeInfo> = {};
    try {
      fieldMapping = ctx.fieldTypeDetector.analyzeFormFields(formData);
    } catch {
      // Degrade gracefully - matched fields still render, just without
      // type-based labels/ordering.
    }
    const formInfo = buildFormInfo(formData, validated.formId, fieldMapping);

    const formattedResult = ctx.searchResultsFormatter.formatSearchResults(
      transformedResult,
      validated.outputMode,
      formInfo
    );

    // Add pagination warning if results may be truncated
    let responseText = formattedResult.content;

    if (transformedResult.matches.length >= SEARCH_RESULTS_LIMIT) {
      responseText += `\n\n⚠️  Search Results Limited!\n`;
      responseText += `- Showing first ${SEARCH_RESULTS_LIMIT} matches\n`;
      responseText += `- More entries may exist but are not displayed\n`;
      responseText += `- For comprehensive searches of large datasets, consider:\n`;
      responseText += `  • Using more specific search terms\n`;
      responseText += `  • Using get_entries with pagination for complete data access\n`;
    }

    return {
      content: [
        {
          type: "text",
          text: responseText
        }
      ]
    };

  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }

    // Handle common API errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage.includes('Form not found') || errorMessage.includes('404')) {
      const formId = typeof args.form_id === 'string' ? args.form_id : 'unknown';
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Form ${formId} not found`
      );
    }

    throw new McpError(
      ErrorCode.InternalError,
      `Error searching entries by name: ${errorMessage}`
    );
  }
}

// ============================================================================
// search_entries_universal
// ============================================================================

interface SearchQueryInput {
  text?: unknown;
  field_types?: unknown;
  field_ids?: unknown;
}

interface ValidatedSearchQuery {
  text: string;
  field_types?: string[];
  field_ids?: string[];
}

interface UniversalSearchFilters {
  payment_status?: string;
  date_range?: { start?: string; end?: string };
}

interface SearchEntriesUniversalArgs {
  form_id?: unknown;
  search_queries?: unknown;
  logic?: unknown;
  strategy?: unknown;
  filters?: unknown;
  output_options?: unknown;
}

interface ValidatedUniversalSearchArgs {
  formId: string;
  queries: ValidatedSearchQuery[];
  searchLogic: 'AND' | 'OR';
  searchStrategy: SearchStrategy;
  filters: UniversalSearchFilters | undefined;
  outputMode: OutputMode;
  maxResults: number;
  includeFieldMappings: boolean;
}

/**
 * Validates and normalizes the search_queries array, converting each raw
 * entry into a properly typed ValidatedSearchQuery.
 */
function validateSearchQueries(rawQueries: unknown): ValidatedSearchQuery[] {
  if (!rawQueries || !Array.isArray(rawQueries) || rawQueries.length === 0) {
    throw new McpError(ErrorCode.InvalidRequest, 'search_queries must be a non-empty array');
  }

  const queryArray = rawQueries as unknown[];

  return queryArray.map((rawQuery): ValidatedSearchQuery => {
    const query = rawQuery as SearchQueryInput;
    const text = query.text;

    if (!text || typeof text !== 'string') {
      throw new McpError(ErrorCode.InvalidRequest, 'Each search query must have a non-empty text field');
    }

    if (!text.trim()) {
      throw new McpError(ErrorCode.InvalidRequest, 'Search query text cannot be empty or whitespace-only');
    }

    if (text.length > 1000) {
      throw new McpError(ErrorCode.InvalidRequest, 'Search query text exceeds maximum length of 1000 characters');
    }

    // Validate field_types if provided
    const fieldTypes = query.field_types;
    if (fieldTypes && !Array.isArray(fieldTypes)) {
      throw new McpError(ErrorCode.InvalidRequest, 'field_types must be an array');
    }

    // Validate field_ids if provided
    const fieldIds = query.field_ids;
    if (fieldIds && !Array.isArray(fieldIds)) {
      throw new McpError(ErrorCode.InvalidRequest, 'field_ids must be an array');
    }

    return {
      text,
      field_types: fieldTypes as string[] | undefined,
      field_ids: fieldIds as string[] | undefined
    };
  });
}

function validateSearchFilters(rawFilters: unknown): UniversalSearchFilters | undefined {
  if (!rawFilters || typeof rawFilters !== 'object') {
    return undefined;
  }
  return rawFilters as UniversalSearchFilters;
}

interface ParsedOutputOptions {
  outputMode: OutputMode;
  maxResults: number;
  includeFieldMappings: boolean;
}

/**
 * Parses and normalizes the optional output_options object.
 */
function parseOutputOptions(rawOutputOptions: unknown): ParsedOutputOptions {
  const outputOptions = (typeof rawOutputOptions === 'object' && rawOutputOptions !== null) ? rawOutputOptions as Record<string, unknown> : undefined;

  const validOutputModes: OutputMode[] = ['detailed', 'summary', 'minimal', 'auto'];
  const rawMode = outputOptions?.['mode'];
  const outputMode: OutputMode = typeof rawMode === 'string' && validOutputModes.includes(rawMode as OutputMode)
    ? (rawMode as OutputMode)
    : 'auto';

  const rawMaxResults = outputOptions?.['max_results'];
  const maxResults = typeof rawMaxResults === 'number' ? rawMaxResults : 50;

  const includeFieldMappings = outputOptions?.['include_field_mappings'] === true;

  return { outputMode, maxResults, includeFieldMappings };
}

function validateSearchEntriesUniversalArgs(args: SearchEntriesUniversalArgs): ValidatedUniversalSearchArgs {
  const { form_id, search_queries, logic, strategy, filters, output_options } = args;

  if (!form_id || typeof form_id !== 'string') {
    throw new McpError(ErrorCode.InvalidRequest, 'form_id must be a non-empty string');
  }

  if (form_id.trim() === '') {
    throw new McpError(ErrorCode.InvalidRequest, 'form_id cannot be empty');
  }

  const queries = validateSearchQueries(search_queries);

  // Validate optional parameters
  const validLogic = ['AND', 'OR'];
  const searchLogic: 'AND' | 'OR' = typeof logic === 'string' && validLogic.includes(logic) ? (logic as 'AND' | 'OR') : 'OR';

  const validStrategies: SearchStrategy[] = ['exact', 'contains', 'fuzzy', 'auto'];
  const searchStrategy: SearchStrategy = validStrategies.includes(strategy as SearchStrategy)
    ? (strategy as SearchStrategy)
    : 'auto';

  // Process output options
  const { outputMode, maxResults, includeFieldMappings } = parseOutputOptions(output_options);

  if (maxResults <= 0 || maxResults > 1000) {
    throw new McpError(ErrorCode.InvalidRequest, 'max_results must be between 1 and 1000');
  }

  return {
    formId: form_id,
    queries,
    searchLogic,
    searchStrategy,
    filters: validateSearchFilters(filters),
    outputMode,
    maxResults,
    includeFieldMappings
  };
}

interface CombinedSearchResults {
  matches: SearchMatch[];
  totalFound: number;
}

/**
 * Runs a single search query, using field_ids targeting when provided and
 * falling back to field_types (defaulting to 'name') otherwise.
 */
async function runSingleSearchQuery(
  searchManager: UniversalSearchManager,
  formId: string,
  query: ValidatedSearchQuery,
  searchStrategy: SearchStrategy,
  maxResults: number
): Promise<{ matches: SearchMatch[] }> {
  const searchOptions = { strategy: searchStrategy, maxResults, includeContext: true };

  if (query.field_ids && query.field_ids.length > 0) {
    // Use searchByFieldIds for custom field targeting
    return searchManager.searchByFieldIds(formId, query.text, query.field_ids, searchOptions);
  }

  // Use field types approach, defaulting to name if not specified
  const fieldTypes = query.field_types ?? ['name'];
  return searchManager.searchUniversal(formId, query.text, fieldTypes as DetectedFieldType[], searchOptions);
}

/**
 * OR logic: combine results from all queries, deduplicated by entry ID.
 */
async function combineSearchResultsOr(
  searchManager: UniversalSearchManager,
  formId: string,
  queries: ValidatedSearchQuery[],
  searchStrategy: SearchStrategy,
  maxResults: number
): Promise<CombinedSearchResults> {
  const combined: CombinedSearchResults = { matches: [], totalFound: 0 };

  for (const query of queries) {
    const searchResult = await runSingleSearchQuery(searchManager, formId, query, searchStrategy, maxResults);
    const existingIds = new Set(combined.matches.map(m => m.entryId));
    const newMatches = searchResult.matches.filter(match => !existingIds.has(match.entryId));
    combined.matches.push(...newMatches);
    combined.totalFound += newMatches.length;
  }

  return combined;
}

/**
 * AND logic: find entries matching ALL queries by intersecting each query's
 * matches (by entry ID) into the running result, starting from the first query.
 */
async function combineSearchResultsAnd(
  searchManager: UniversalSearchManager,
  formId: string,
  queries: ValidatedSearchQuery[],
  searchStrategy: SearchStrategy,
  maxResults: number
): Promise<CombinedSearchResults> {
  const firstResult = await runSingleSearchQuery(searchManager, formId, queries[0], searchStrategy, maxResults);
  let currentMatches = firstResult.matches;

  for (let i = 1; i < queries.length; i++) {
    const queryResult = await runSingleSearchQuery(searchManager, formId, queries[i], searchStrategy, maxResults);
    const queryEntryIds = new Set(queryResult.matches.map(m => m.entryId));
    currentMatches = currentMatches.filter(match => queryEntryIds.has(match.entryId));
  }

  return { matches: currentMatches, totalFound: currentMatches.length };
}

/**
 * Filters combined.matches in place with the given predicate, updating
 * totalFound to match whenever filtering actually removed entries.
 */
function filterMatchesInPlace(combined: CombinedSearchResults, predicate: (match: SearchMatch) => boolean): void {
  const initialCount = combined.matches.length;
  combined.matches = combined.matches.filter(predicate);
  if (combined.matches.length < initialCount) {
    combined.totalFound = combined.matches.length;
  }
}

/**
 * Applies the optional payment_status / date_range filters to the combined
 * results, in place.
 */
function applySearchFilters(combined: CombinedSearchResults, filters: UniversalSearchFilters | undefined): void {
  if (!filters) {
    return;
  }

  if (filters.payment_status) {
    filterMatchesInPlace(combined, match => {
      // Check if the match has entry data with payment information
      const entryData = match.entryData || match.matchedFields;
      const paymentStatus = entryData?.payment_status;

      // If payment status exists, filter by it
      if (paymentStatus) {
        return paymentStatus === filters.payment_status;
      }

      // If no payment status data, include the match (avoid false negatives)
      return true;
    });
  }

  if (filters.date_range) {
    filterMatchesInPlace(combined, match => {
      const entryData = match.entryData || match.matchedFields;
      const dateCreated = entryData?.date_created;

      if (!dateCreated) {
        return true; // Include if no date info (avoid false negatives)
      }

      const entryDate = new Date(dateCreated);
      let includeEntry = true;

      if (filters.date_range?.start) {
        const startDate = new Date(filters.date_range.start);
        if (entryDate < startDate) {
          includeEntry = false;
        }
      }

      if (filters.date_range?.end && includeEntry) {
        const endDate = new Date(filters.date_range.end);
        if (entryDate > endDate) {
          includeEntry = false;
        }
      }

      return includeEntry;
    });
  }
}

/**
 * Estimates the number of fields searched across all queries, for the
 * response's fieldsSearched metadata.
 */
function countFieldsSearched(queries: ValidatedSearchQuery[]): number {
  let totalFieldsSearched = 0;
  for (const query of queries) {
    if (query.field_ids && query.field_ids.length > 0) {
      totalFieldsSearched += query.field_ids.length;
    } else {
      // Estimate based on field types (will be more accurate with actual field detection)
      const fieldTypes = query.field_types ?? ['name'];
      totalFieldsSearched += fieldTypes.length * 2; // Rough estimate
    }
  }
  return totalFieldsSearched;
}

/**
 * Appends the optional field-mappings summary, pagination warning, and
 * AND-logic limitation notice to the formatted response content.
 */
function buildUniversalResponseText(
  baseContent: string,
  validated: ValidatedUniversalSearchArgs,
  transformedResult: FormattedSearchResult,
  fieldMapping: Record<string, FieldTypeInfo>,
  fieldMappingError: boolean
): string {
  let responseText = baseContent;

  // Add field mapping information if requested
  if (validated.includeFieldMappings) {
    if (fieldMappingError) {
      responseText += `\n\n--- Field Mappings ---\nField mapping information unavailable`;
    } else {
      const mappingInfo = Object.entries(fieldMapping)
        .map(([fieldId, info]) => `Field ${fieldId}: ${info.label} (type: ${info.fieldType}, confidence: ${info.confidence.toFixed(2)})`)
        .join('\n');

      responseText += `\n\n--- Field Mappings Used ---\n${mappingInfo}`;
    }
  }

  // Add pagination warning if results may be truncated
  if (transformedResult.matches.length >= SEARCH_RESULTS_LIMIT) {
    responseText += `\n\n⚠️  Search Results Limited!\n`;
    responseText += `- Showing first ${SEARCH_RESULTS_LIMIT} matches per search operation\n`;
    responseText += `- More entries may exist but are not displayed\n`;
    responseText += `- For comprehensive searches of large datasets, consider:\n`;
    responseText += `  • Using more specific search terms\n`;
    responseText += `  • Using get_entries with pagination for complete data access\n`;
  }

  // Warn about AND logic limitation with large datasets
  if (validated.searchLogic === 'AND' && validated.queries.length > 1) {
    responseText += `\n\n⚠️  AND Logic Limitation: Results are intersected across separate API calls, each limited to 100 entries. For forms with more than 100 entries, some matches may be missed. For comprehensive AND searches on large forms, use get_entries with manual pagination and filtering.`;
  }

  return responseText;
}

/**
 * Builds the debug context included in the internal-error message, safely
 * narrowing each field of the (still unvalidated, since validation may have
 * failed) raw args.
 */
function buildSearchErrorContext(args: SearchEntriesUniversalArgs): Record<string, unknown> {
  const queryCount = Array.isArray(args.search_queries) ? args.search_queries.length : 0;
  const logic = typeof args.logic === 'string' ? args.logic : 'OR';
  const strategy = typeof args.strategy === 'string' ? args.strategy : 'auto';

  let maxResults = 50;
  if (typeof args.output_options === 'object' && args.output_options !== null) {
    const rawMaxResults = (args.output_options as Record<string, unknown>)['max_results'];
    if (typeof rawMaxResults === 'number') {
      maxResults = rawMaxResults;
    }
  }

  return {
    form_id: args.form_id,
    query_count: queryCount,
    logic,
    strategy,
    has_filters: !!args.filters,
    max_results: maxResults
  };
}

/**
 * Advanced multi-field search with custom targeting and strategies
 */
export async function searchEntriesUniversal(ctx: SearchToolContext, args: SearchEntriesUniversalArgs): Promise<SearchToolResult> {
  try {
    const validated = validateSearchEntriesUniversalArgs(args);

    // Track execution time
    const searchStartTime = Date.now();

    // Get UniversalSearchManager instance
    const searchManager = ctx.getUniversalSearchManager();

    // Perform searches based on logic
    const combined = validated.searchLogic === 'OR'
      ? await combineSearchResultsOr(searchManager, validated.formId, validated.queries, validated.searchStrategy, validated.maxResults)
      : await combineSearchResultsAnd(searchManager, validated.formId, validated.queries, validated.searchStrategy, validated.maxResults);

    // Apply additional filters if provided
    applySearchFilters(combined, validated.filters);

    // Store total found BEFORE limiting
    const totalFoundBeforeLimiting = combined.totalFound;

    // Limit results to maxResults
    if (combined.matches.length > validated.maxResults) {
      combined.matches = combined.matches.slice(0, validated.maxResults);
      // Keep the original total found, not the limited count
      combined.totalFound = totalFoundBeforeLimiting;
    }

    // Get form data for formatting context
    const formData = await ctx.makeRequest<IGravityForm>(`/forms/${validated.formId}`);

    // Calculate execution time
    const executionTimeMs = Date.now() - searchStartTime;

    // Count actual fields searched across all queries
    const totalFieldsSearched = countFieldsSearched(validated.queries);

    // Transform to SearchResultsFormatter format. entryData is kept as the
    // full entry (not narrowed to matchedFields) so fields that weren't
    // searched, e.g. email during a name search, are still available for
    // the formatter to render. matchedFields stays on the match separately
    // to indicate which fields actually matched.
    const transformedResult: FormattedSearchResult = {
      matches: combined.matches,
      totalFound: combined.totalFound,
      searchMetadata: {
        searchText: `${validated.queries.length} queries with ${validated.searchLogic} logic`,
        executionTime: executionTimeMs,
        apiCalls: validated.queries.length,
        fieldsSearched: [totalFieldsSearched.toString()]
      }
    };

    // Compute field mapping once, used both for rendering matched fields
    // by their actual type and for the optional field-mappings summary below.
    let fieldMapping: Record<string, FieldTypeInfo> = {};
    let fieldMappingError = false;
    try {
      fieldMapping = ctx.fieldTypeDetector.analyzeFormFields(formData);
    } catch {
      fieldMappingError = true;
    }

    // Format results
    const formInfo = buildFormInfo(formData, validated.formId, fieldMapping);

    const formattedResult = ctx.searchResultsFormatter.formatSearchResults(
      transformedResult,
      validated.outputMode,
      formInfo
    );

    const responseText = buildUniversalResponseText(formattedResult.content, validated, transformedResult, fieldMapping, fieldMappingError);

    return {
      content: [
        {
          type: "text",
          text: responseText
        }
      ]
    };

  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }

    // Handle common API errors with context
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Create detailed error context for debugging
    const searchContext = buildSearchErrorContext(args);

    if (errorMessage.includes('Form not found') || errorMessage.includes('404')) {
      const formId = typeof args.form_id === 'string' ? args.form_id : 'unknown';
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Form ${formId} not found`
      );
    }

    // Include search context in error for debugging
    throw new McpError(
      ErrorCode.InternalError,
      `Error in universal search: ${errorMessage}. Context: ${JSON.stringify(searchContext)}`
    );
  }
}
