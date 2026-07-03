// ABOUTME: Entry-query MCP tool handler (get_entries) and its universal-search helper
// ABOUTME: Extracted from GravityFormsMCPServer to isolate handler logic from server infrastructure

import { createEntrySummary, estimateEntriesResponseSize } from "./responseSizeManager.js";
import type { FieldTypeDetector, FieldTypeInfo } from "./fieldTypeDetector.js";
import type { FormInfo, OutputMode, SearchResultsFormatter } from "./searchResultsFormatter.js";
import type { SearchStrategy, UniversalSearchManager } from "./universalSearchManager.js";

export interface EntriesQueryToolContext {
  makeRequest(endpoint: string, method?: string, body?: unknown): Promise<any>;
  fieldTypeDetector: FieldTypeDetector;
  searchResultsFormatter: SearchResultsFormatter;
  getOrCreateSearchManager(): UniversalSearchManager;
}

export async function getEntries(ctx: EntriesQueryToolContext, args: any) {
    const {
      form_id,
      entry_id,
      search,
      sorting,
      paging,
      response_mode = 'auto',
      search_mode = 'standard',
      field_detection = false
    } = args;

    // Handle universal search mode
    if (search_mode === 'universal' && form_id) {
      try {
        return await handleUniversalSearch(ctx, form_id, search, response_mode, field_detection);
      } catch (error) {
        // Fallback to standard search if universal search fails
        console.warn('Universal search failed, falling back to standard search:', error);
      }
    }

    let endpoint = '';
    const params = new URLSearchParams();

    if (entry_id) {
      endpoint = `/entries/${entry_id}`;
    } else if (form_id) {
      endpoint = `/forms/${form_id}/entries`;
    } else {
      endpoint = '/entries';
    }

    // Build search parameter as JSON object per Gravity Forms API documentation
    if (search) {
      const searchObject: any = {};

      if (search.status) {
        searchObject.status = search.status;
      }

      if (search.field_filters && Array.isArray(search.field_filters)) {
        const validFilters = search.field_filters
          .filter((filter: any) => filter?.key != null && filter.value != null)
          .map((filter: any) => {
            const sanitizedKey = String(filter.key).trim();
            const sanitizedValue = String(filter.value).trim();
            const sanitizedOperator = filter.operator ? String(filter.operator).trim() : '=';

            return sanitizedKey !== '' ? {
              key: sanitizedKey,
              value: sanitizedValue,
              operator: sanitizedOperator
            } : null;
          })
          .filter(Boolean);

        if (validFilters.length > 0) {
          searchObject.field_filters = validFilters;
        }
      }

      if (search.date_range) {
        const dateRange: any = {};
        if (search.date_range.start) {
          dateRange.start = search.date_range.start;
        }
        if (search.date_range.end) {
          dateRange.end = search.date_range.end;
        }
        if (Object.keys(dateRange).length > 0) {
          searchObject.date_range = dateRange;
        }
      }

      // Handle other search parameters (backward compatibility)
      Object.entries(search).forEach(([key, value]) => {
        if (key !== 'status' && key !== 'field_filters' && key !== 'date_range') {
          searchObject[key] = String(value);
        }
      });

      // Only add search parameter if we have something to search for
      if (Object.keys(searchObject).length > 0) {
        params.append('search', JSON.stringify(searchObject));
      }
    }

    if (sorting) {
      Object.entries(sorting).forEach(([key, value]) => {
        params.append(`sorting[${key}]`, String(value));
      });
    }

    if (paging) {
      Object.entries(paging).forEach(([key, value]) => {
        params.append(`paging[${key}]`, String(value));
      });
    }

    const queryString = params.toString();
    const fullEndpoint = queryString ? `${endpoint}?${queryString}` : endpoint;

    const response = await ctx.makeRequest(fullEndpoint);

    // Extract entries and pagination info from API response
    const entries = response?.entries || response || [];
    const totalCount = response?.total_count;
    const hasMorePages = totalCount && entries.length && paging?.page_size && totalCount > (paging.page_size * (paging.current_page || 1));

    // Handle empty results
    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      let emptyMessage = "No entries found for the specified criteria.";
      if (totalCount !== undefined) {
        emptyMessage += ` Total available: ${totalCount}`;
      }
      return {
        content: [
          {
            type: "text",
            text: emptyMessage
          }
        ]
      };
    }

    // Determine how to format response based on size and mode
    let processedEntries = entries;
    let responseText = '';
    let wasSummarized = false;

    if (response_mode === 'summary') {
      // Explicitly requested summary mode
      processedEntries = entries.map((entry: any) => createEntrySummary(entry));
      wasSummarized = true;
    } else if (response_mode === 'full') {
      // Explicitly requested full mode - use all data
      processedEntries = entries;
    } else { // response_mode === 'auto'
      // Auto mode: efficiently estimate size without full JSON generation
      const estimatedTokens = estimateEntriesResponseSize(entries);

      if (estimatedTokens > 20000) {
        // Response too large, use summary mode
        processedEntries = entries.map((entry: any) => createEntrySummary(entry));
        wasSummarized = true;
      } else {
        // Response size OK, use full mode
        processedEntries = entries;
      }
    }

    // Build final response text with pagination info
    let paginationInfo = '';
    if (totalCount !== undefined) {
      const currentPage = paging?.current_page || 1;
      const pageSize = paging?.page_size || entries.length;
      const totalPages = Math.ceil(totalCount / pageSize);

      paginationInfo = `\n📊 Pagination Info:\n`;
      paginationInfo += `- Total entries: ${totalCount}\n`;
      paginationInfo += `- Current page: ${currentPage}\n`;
      paginationInfo += `- Page size: ${pageSize}\n`;
      paginationInfo += `- Total pages: ${totalPages}\n`;
      paginationInfo += `- Showing entries: ${((currentPage - 1) * pageSize) + 1} to ${Math.min(currentPage * pageSize, totalCount)}\n`;

      if (hasMorePages) {
        paginationInfo += `\n⚠️  More entries available! To get the next page, call with:\n`;
        paginationInfo += `{ "paging": { "page_size": ${pageSize}, "current_page": ${currentPage + 1} } }\n`;
      }
    }

    if (wasSummarized) {
      responseText = `Response summarized to prevent context overflow.\n\n`;
      responseText += `Found ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}:\n`;
      responseText += paginationInfo;
      responseText += `\n📋 Entries:\n${JSON.stringify(processedEntries, null, 2)}`;
    } else {
      responseText = `Found ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
      responseText += paginationInfo;
      responseText += `\n📋 Entries:\n${JSON.stringify(processedEntries, null, 2)}`;
    }

    return {
      content: [
        {
          type: "text",
          text: responseText
        }
      ]
    };
}

async function handleUniversalSearch(ctx: EntriesQueryToolContext, form_id: string, search: any, response_mode: string, field_detection: boolean) {
    try {
      const searchManager = ctx.getOrCreateSearchManager();

      // Extract and validate search text from various sources
      let searchText = '';

      // Try to extract from field_filters first
      if (search?.field_filters && Array.isArray(search.field_filters) && search.field_filters.length > 0) {
        searchText = search.field_filters
          .filter((filter: any) => filter && typeof filter.value === 'string')
          .map((filter: any) => String(filter.value).trim())
          .filter(Boolean)
          .join(' ');
      }

      // If no search text from field_filters, try other search parameters
      if (!searchText.trim() && search) {
        // Check for other common search patterns
        if (typeof search.text === 'string') {
          searchText = search.text.trim();
        } else if (typeof search.query === 'string') {
          searchText = search.query.trim();
        }
      }

      // Handle empty search - return all entries in universal mode with field detection
      if (!searchText.trim()) {
        if (field_detection) {
          // In field detection mode, we can still provide field mapping information
          searchText = '*'; // Use wildcard to get all entries for field analysis
        } else {
          return {
            content: [
              {
                type: "text",
                text: "No search criteria provided. Use field_detection=true to analyze all entries or provide search text."
              }
            ]
          };
        }
      }

    // Perform universal search with field_detection setting
    const searchOptions = {
      strategy: 'auto' as SearchStrategy,
      maxResults: 50,
      includeContext: field_detection // Use field_detection parameter for context
    };

      // Execute search with error handling
      const searchResult = await searchManager.searchByName(form_id, searchText, searchOptions);

      // Get form information for better context, including the field mapping
      // so matched fields render by their actual detected type rather than
      // guessing from hardcoded field IDs.
      const formData = await ctx.makeRequest(`/forms/${form_id}`);
      let fieldMapping: Record<string, FieldTypeInfo> = {};
      try {
        fieldMapping = ctx.fieldTypeDetector.analyzeFormFields(formData);
      } catch {
        // Degrade gracefully - matched fields still render, just without
        // type-based labels/ordering.
      }
      const formInfo: FormInfo = {
        id: form_id,
        title: formData.title || `Form ${form_id}`,
        fields: formData.fields || [],
        fieldMapping
      };

      // Format results using SearchResultsFormatter
      // Note: Universal search returns formatted, human-readable results with context and confidence scores
      // This is intentionally different from standard search (raw JSON) to provide enhanced user experience
      const outputMode: OutputMode = response_mode === 'summary' ? 'summary' :
                                     response_mode === 'full' ? 'detailed' : 'auto';

      const formattedResult = ctx.searchResultsFormatter.formatSearchResults(
        searchResult,
        outputMode,
        formInfo
      );

      return {
        content: [
          {
            type: "text",
            text: formattedResult.content
          }
        ]
      };
    } catch (error) {
      // Log the specific error and re-throw to trigger fallback in caller
      console.error(`Universal search failed for form ${form_id}:`, error);
      throw new Error(`Universal search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
