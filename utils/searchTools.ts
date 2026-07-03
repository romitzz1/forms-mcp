// ABOUTME: Search MCP tool handlers (search_entries_by_name, search_entries_universal)
// ABOUTME: Extracted from GravityFormsMCPServer to isolate handler logic from server infrastructure

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { FieldTypeDetector, FieldTypeInfo } from "./fieldTypeDetector.js";
import type { SearchResult as FormattedSearchResult, FormInfo, OutputMode, SearchResultsFormatter } from "./searchResultsFormatter.js";
import type { SearchStrategy, UniversalSearchManager } from "./universalSearchManager.js";

// Limit for search operations
const SEARCH_RESULTS_LIMIT = 100;

export interface SearchToolContext {
  makeRequest(endpoint: string, method?: string, body?: unknown): Promise<any>;
  fieldTypeDetector: FieldTypeDetector;
  searchResultsFormatter: SearchResultsFormatter;
  getUniversalSearchManager(): UniversalSearchManager;
}

export async function searchEntriesByName(ctx: SearchToolContext, args: any) {
    try {
      // Validate required parameters
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
      const maxResults = max_results || 50;
      const validOutputModes: OutputMode[] = ['detailed', 'summary', 'minimal', 'auto'];
      const outputMode: OutputMode = validOutputModes.includes(output_mode as OutputMode)
        ? (output_mode as OutputMode)
        : 'auto';

      if (max_results !== undefined && max_results !== null) {
        if (typeof max_results !== 'number' || !Number.isInteger(max_results)) {
          throw new McpError(ErrorCode.InvalidRequest, 'max_results must be an integer');
        }
        if (max_results <= 0) {
          throw new McpError(ErrorCode.InvalidRequest, 'max_results must be greater than 0');
        }
        if (max_results > 1000) {
          throw new McpError(ErrorCode.InvalidRequest, 'max_results cannot exceed 1000');
        }
      }

      // Get UniversalSearchManager instance
      const searchManager = ctx.getUniversalSearchManager();

      // Perform universal name search
      const searchResult = await searchManager.searchByName(
        form_id,
        search_text,
        {
          strategy: searchStrategy,
          maxResults: maxResults,
          includeContext: true
        }
      );

      // Get form data for formatting context
      const formData = await ctx.makeRequest(`/forms/${form_id}`);

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
          fieldsSearched: [`${searchResult.searchMetadata.fieldsSearched} fields`] // Convert number to array
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
      const formInfo: FormInfo = {
        id: formData.id,
        title: formData.title || `Form ${form_id}`,
        fields: formData.fields || [],
        fieldMapping
      };

      const formattedResult = ctx.searchResultsFormatter.formatSearchResults(
        transformedResult,
        outputMode,
        formInfo
      );

      // Add pagination warning if results may be truncated
      let responseText = formattedResult.content;
      const searchLimit = SEARCH_RESULTS_LIMIT;

      if (transformedResult.matches.length >= searchLimit) {
        responseText += `\n\n⚠️  Search Results Limited!\n`;
        responseText += `- Showing first ${searchLimit} matches\n`;
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
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Form ${args.form_id} not found`
        );
      }

      throw new McpError(
        ErrorCode.InternalError,
        `Error searching entries by name: ${errorMessage}`
      );
    }
  }

/**
 * Advanced multi-field search with custom targeting and strategies
 */
export async function searchEntriesUniversal(ctx: SearchToolContext, args: any) {
    try {
      // Validate required parameters
      const { form_id, search_queries, logic, strategy, filters, output_options } = args;

      if (!form_id || typeof form_id !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'form_id must be a non-empty string');
      }

      if (form_id.trim() === '') {
        throw new McpError(ErrorCode.InvalidRequest, 'form_id cannot be empty');
      }

      if (!search_queries || !Array.isArray(search_queries) || search_queries.length === 0) {
        throw new McpError(ErrorCode.InvalidRequest, 'search_queries must be a non-empty array');
      }

      // Validate each search query
      for (const query of search_queries) {
        if (!query.text || typeof query.text !== 'string') {
          throw new McpError(ErrorCode.InvalidRequest, 'Each search query must have a non-empty text field');
        }

        if (!query.text.trim()) {
          throw new McpError(ErrorCode.InvalidRequest, 'Search query text cannot be empty or whitespace-only');
        }

        if (query.text.length > 1000) {
          throw new McpError(ErrorCode.InvalidRequest, 'Search query text exceeds maximum length of 1000 characters');
        }

        // Validate field_types if provided
        if (query.field_types && !Array.isArray(query.field_types)) {
          throw new McpError(ErrorCode.InvalidRequest, 'field_types must be an array');
        }

        // Validate field_ids if provided
        if (query.field_ids && !Array.isArray(query.field_ids)) {
          throw new McpError(ErrorCode.InvalidRequest, 'field_ids must be an array');
        }
      }

      // Validate optional parameters
      const validLogic = ['AND', 'OR'];
      const searchLogic = validLogic.includes(logic) ? logic : 'OR';

      const validStrategies: SearchStrategy[] = ['exact', 'contains', 'fuzzy', 'auto'];
      const searchStrategy: SearchStrategy = validStrategies.includes(strategy as SearchStrategy)
        ? (strategy as SearchStrategy)
        : 'auto';

      // Process output options
      const outputMode: OutputMode = output_options?.mode && ['detailed', 'summary', 'minimal', 'auto'].includes(output_options.mode)
        ? (output_options.mode as OutputMode)
        : 'auto';
      const maxResults = output_options?.max_results || 50;
      const includeFieldMappings = output_options?.include_field_mappings || false;

      if (maxResults <= 0 || maxResults > 1000) {
        throw new McpError(ErrorCode.InvalidRequest, 'max_results must be between 1 and 1000');
      }

      // Track execution time
      const searchStartTime = Date.now();

      // Get UniversalSearchManager instance
      const searchManager = ctx.getUniversalSearchManager();

      // Perform searches based on logic
      let combinedResults: any = { matches: [], totalFound: 0, searchMetadata: {} };

      if (searchLogic === 'OR') {
        // OR logic: combine results from all queries
        for (const query of search_queries) {
          const fieldTypes = query.field_types || ['name']; // Default to name if not specified

          let searchResult;

          // Use custom field IDs if provided, otherwise use field types
          if (query.field_ids && query.field_ids.length > 0) {
            // Use searchByFieldIds for custom field targeting
            searchResult = await searchManager.searchByFieldIds(
              form_id,
              query.text,
              query.field_ids,
              {
                strategy: searchStrategy,
                maxResults: maxResults,
                includeContext: true
              }
            );
          } else {
            // Use field types approach
            const targetFieldTypes = fieldTypes;
            searchResult = await searchManager.searchUniversal(
              form_id,
              query.text,
              targetFieldTypes,
              {
                strategy: searchStrategy,
                maxResults: maxResults,
                includeContext: true
              }
            );
          }

          // Merge results (avoid duplicates by entry ID)
          const existingIds = new Set(combinedResults.matches.map((m: any) => m.entryId));
          const newMatches = searchResult.matches.filter(match => !existingIds.has(match.entryId));

          combinedResults.matches.push(...newMatches);
          combinedResults.totalFound += newMatches.length;
        }
      } else {
        // AND logic: find entries matching ALL queries
        if (search_queries.length === 1) {
          // Single query case
          const query = search_queries[0];
          const fieldTypes = query.field_types || ['name'];

          if (query.field_ids && query.field_ids.length > 0) {
            combinedResults = await searchManager.searchByFieldIds(
              form_id,
              query.text,
              query.field_ids,
              {
                strategy: searchStrategy,
                maxResults: maxResults,
                includeContext: true
              }
            );
          } else {
            combinedResults = await searchManager.searchUniversal(
              form_id,
              query.text,
              fieldTypes,
              {
                strategy: searchStrategy,
                maxResults: maxResults,
                includeContext: true
              }
            );
          }
        } else {
          // Multiple queries with AND logic
          // Start with first query results
          const firstQuery = search_queries[0];
          const firstFieldTypes = firstQuery.field_types || ['name'];

          let currentResults;
          if (firstQuery.field_ids && firstQuery.field_ids.length > 0) {
            currentResults = await searchManager.searchByFieldIds(
              form_id,
              firstQuery.text,
              firstQuery.field_ids,
              {
                strategy: searchStrategy,
                maxResults: maxResults,
                includeContext: true
              }
            );
          } else {
            currentResults = await searchManager.searchUniversal(
              form_id,
              firstQuery.text,
              firstFieldTypes,
              {
                strategy: searchStrategy,
                maxResults: maxResults,
                includeContext: true
              }
            );
          }

          // Filter by remaining queries
          for (let i = 1; i < search_queries.length; i++) {
            const query = search_queries[i];
            const fieldTypes = query.field_types || ['name'];

            let queryResults;
            if (query.field_ids && query.field_ids.length > 0) {
              queryResults = await searchManager.searchByFieldIds(
                form_id,
                query.text,
                query.field_ids,
                {
                  strategy: searchStrategy,
                  maxResults: maxResults,
                  includeContext: true
                }
              );
            } else {
              queryResults = await searchManager.searchUniversal(
                form_id,
                query.text,
                fieldTypes,
                {
                  strategy: searchStrategy,
                  maxResults: maxResults,
                  includeContext: true
                }
              );
            }

            // Keep only entries that appear in both result sets
            const queryEntryIds = new Set(queryResults.matches.map(m => m.entryId));
            currentResults.matches = currentResults.matches.filter(match =>
              queryEntryIds.has(match.entryId)
            );
            currentResults.totalFound = currentResults.matches.length;
          }

          combinedResults = currentResults;
        }
      }

      // Apply additional filters if provided
      if (filters) {
        if (filters.payment_status) {
          const initialCount = combinedResults.matches.length;
          combinedResults.matches = combinedResults.matches.filter((match: any) => {
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

          // Update total count if filtering removed items
          if (combinedResults.matches.length < initialCount) {
            combinedResults.totalFound = combinedResults.matches.length;
          }
        }

        if (filters.date_range) {
          const initialCount = combinedResults.matches.length;
          combinedResults.matches = combinedResults.matches.filter((match: any) => {
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

          // Update total count if filtering removed items
          if (combinedResults.matches.length < initialCount) {
            combinedResults.totalFound = combinedResults.matches.length;
          }
        }
      }

      // Store total found BEFORE limiting
      const totalFoundBeforeLimiting = combinedResults.totalFound;

      // Limit results to maxResults
      if (combinedResults.matches.length > maxResults) {
        combinedResults.matches = combinedResults.matches.slice(0, maxResults);
        // Keep the original total found, not the limited count
        combinedResults.totalFound = totalFoundBeforeLimiting;
      }

      // Get form data for formatting context
      const formData = await ctx.makeRequest(`/forms/${form_id}`);

      // Calculate execution time
      const executionTimeMs = Date.now() - searchStartTime;

      // Count actual fields searched across all queries
      let totalFieldsSearched = 0;
      for (const query of search_queries) {
        if (query.field_ids && query.field_ids.length > 0) {
          totalFieldsSearched += query.field_ids.length;
        } else {
          // Estimate based on field types (will be more accurate with actual field detection)
          const fieldTypes = query.field_types || ['name'];
          totalFieldsSearched += fieldTypes.length * 2; // Rough estimate
        }
      }

      // Transform to SearchResultsFormatter format. entryData is kept as the
      // full entry (not narrowed to matchedFields) so fields that weren't
      // searched, e.g. email during a name search, are still available for
      // the formatter to render. matchedFields stays on the match separately
      // to indicate which fields actually matched.
      const transformedResult: FormattedSearchResult = {
        matches: combinedResults.matches,
        totalFound: combinedResults.totalFound,
        searchMetadata: {
          searchText: `${search_queries.length} queries with ${searchLogic} logic`,
          executionTime: executionTimeMs,
          apiCalls: search_queries.length,
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
      const formInfo: FormInfo = {
        id: formData.id,
        title: formData.title || `Form ${form_id}`,
        fields: formData.fields || [],
        fieldMapping
      };

      const formattedResult = ctx.searchResultsFormatter.formatSearchResults(
        transformedResult,
        outputMode,
        formInfo
      );

      // Add field mapping information if requested
      let responseText = formattedResult.content;
      if (includeFieldMappings) {
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
      const searchLimit = SEARCH_RESULTS_LIMIT;

      if (transformedResult.matches.length >= searchLimit) {
        responseText += `\n\n⚠️  Search Results Limited!\n`;
        responseText += `- Showing first ${searchLimit} matches per search operation\n`;
        responseText += `- More entries may exist but are not displayed\n`;
        responseText += `- For comprehensive searches of large datasets, consider:\n`;
        responseText += `  • Using more specific search terms\n`;
        responseText += `  • Using get_entries with pagination for complete data access\n`;
      }

      // Warn about AND logic limitation with large datasets
      if (searchLogic === 'AND' && search_queries.length > 1) {
        responseText += `\n\n⚠️  AND Logic Limitation: Results are intersected across separate API calls, each limited to 100 entries. For forms with more than 100 entries, some matches may be missed. For comprehensive AND searches on large forms, use get_entries with manual pagination and filtering.`;
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

      // Handle common API errors with context
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Create detailed error context for debugging
      const searchContext = {
        form_id: args.form_id,
        query_count: args.search_queries?.length || 0,
        logic: args.logic || 'OR',
        strategy: args.strategy || 'auto',
        has_filters: !!args.filters,
        max_results: args.output_options?.max_results || 50
      };

      if (errorMessage.includes('Form not found') || errorMessage.includes('404')) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Form ${args.form_id} not found`
        );
      }

      // Include search context in error for debugging
      throw new McpError(
        ErrorCode.InternalError,
        `Error in universal search: ${errorMessage}. Context: ${JSON.stringify(searchContext)}`
      );
    }
  }
