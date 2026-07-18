// ABOUTME: Entry-query MCP tool handler (get_entries) and its universal-search helper
// ABOUTME: Extracted from GravityFormsMCPServer to isolate handler logic from server infrastructure

import { createEntrySummary, estimateEntriesResponseSize } from "./responseSizeManager.js";
import type { FieldTypeDetector, FieldTypeInfo } from "./fieldTypeDetector.js";
import type { FormInfo, OutputMode, SearchResultsFormatter } from "./searchResultsFormatter.js";
import type { IGravityEntry, IGravityForm } from "./gravityFormsTypes.js";
import type { SearchStrategy, UniversalSearchManager } from "./universalSearchManager.js";

export interface EntriesQueryToolContext {
  makeRequest<T = unknown>(endpoint: string, method?: string, body?: unknown): Promise<T>;
  fieldTypeDetector: FieldTypeDetector;
  searchResultsFormatter: SearchResultsFormatter;
  getOrCreateSearchManager(): UniversalSearchManager;
}

interface IGetEntriesSorting {
  key?: string;
  direction?: string;
  is_numeric?: boolean;
}

interface IGetEntriesPaging {
  page_size?: number;
  current_page?: number;
  offset?: number;
}

export interface GetEntriesArgs {
  form_id?: string;
  entry_id?: string;
  // The Zod schema types `search` as an opaque record (arbitrary client input);
  // only the fields actually read here (status/field_filters/date_range, plus
  // freeform passthrough keys) are ever narrowed out of it.
  search?: unknown;
  sorting?: IGetEntriesSorting;
  paging?: IGetEntriesPaging;
  response_mode?: 'full' | 'summary' | 'auto';
  search_mode?: 'standard' | 'universal';
  field_detection?: boolean;
  field_ids?: unknown;
  exclude_empty?: boolean;
}

export interface GetEntriesResult {
  content: Array<{ type: "text"; text: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Routes String() through a plain-`unknown` parameter so a truthy-narrowed
// (non-nullish) call site doesn't resolve to a type whose only toString is
// Object's default ('[object Object]'), while producing an identical result.
function stringifyTrimmed(value: unknown): string {
  return String(value).trim();
}

// A field-value key on a Gravity Forms entry is the numeric field id, optionally
// with a composite sub-input suffix (e.g. "1", "1.3"). Metadata keys (id, status,
// date_created, source_url, ...) are non-numeric and are ignored here, so an entry
// counts as having values only when at least one actual field is filled in.
function entryHasFieldValues(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  for (const [key, value] of Object.entries(entry)) {
    if (!/^\d+(\.\d+)?$/.test(key)) continue;
    if (value != null && stringifyTrimmed(value) !== '') {
      return true;
    }
  }
  return false;
}

// A single field_filters entry. The Zod schema types `search` as an opaque
// record (arbitrary client input), so only the fields actually read here are
// named; everything else is opaque and preserved via the index signature.
interface IRawFieldFilter {
  key?: unknown;
  value?: unknown;
  operator?: unknown;
  [key: string]: unknown;
}

function isFieldFilterCandidate(filter: unknown): filter is IRawFieldFilter {
  return isRecord(filter);
}

function buildValidFieldFilters(fieldFilters: unknown): Array<{ key: string; value: string; operator: string }> {
  if (!Array.isArray(fieldFilters)) return [];

  return fieldFilters
    .filter((filter): filter is IRawFieldFilter => isFieldFilterCandidate(filter) && filter.key != null && filter.value != null)
    .map((filter) => {
      const sanitizedKey = stringifyTrimmed(filter.key);
      const sanitizedValue = stringifyTrimmed(filter.value);
      const sanitizedOperator = filter.operator ? stringifyTrimmed(filter.operator) : '=';

      return sanitizedKey !== '' ? {
        key: sanitizedKey,
        value: sanitizedValue,
        operator: sanitizedOperator
      } : null;
    })
    .filter((filter): filter is { key: string; value: string; operator: string } => filter !== null);
}

// Builds the JSON-encoded `search` query parameter per Gravity Forms API
// documentation, or returns undefined when there's nothing to search for.
function buildGetEntriesSearchParam(search: unknown): string | undefined {
  // Preserve the original bare-truthy guard (`if (search)`): a truthy non-object
  // search (string/boolean/number) still falls through and runs Object.entries()
  // below exactly as before (a string yields char-index pairs; a boolean/number
  // yields []). Non-object search is unreachable via the Zod schema (typed as
  // z.record) but preserved here for byte-for-byte fidelity; the cast to a record
  // has no runtime effect, so string/boolean/number inputs behave identically.
  if (!search) return undefined;

  const searchRecord = search as Record<string, unknown>;
  const searchObject: Record<string, unknown> = {};

  if (searchRecord.status) {
    searchObject.status = searchRecord.status;
  }

  const validFilters = buildValidFieldFilters(searchRecord.field_filters);
  if (validFilters.length > 0) {
    searchObject.field_filters = validFilters;
  }

  const dateRangeSource = isRecord(searchRecord.date_range) ? searchRecord.date_range : undefined;
  if (dateRangeSource) {
    const dateRange: Record<string, unknown> = {};
    if (dateRangeSource.start) {
      dateRange.start = dateRangeSource.start;
    }
    if (dateRangeSource.end) {
      dateRange.end = dateRangeSource.end;
    }
    if (Object.keys(dateRange).length > 0) {
      searchObject.date_range = dateRange;
    }
  }

  // Handle other search parameters (backward compatibility)
  Object.entries(searchRecord).forEach(([key, value]) => {
    if (key !== 'status' && key !== 'field_filters' && key !== 'date_range') {
      searchObject[key] = String(value);
    }
  });

  // Only report a search parameter if we have something to search for
  return Object.keys(searchObject).length > 0 ? JSON.stringify(searchObject) : undefined;
}

function appendSortingParams(params: URLSearchParams, sorting: IGetEntriesSorting | undefined): void {
  if (!sorting) return;
  Object.entries(sorting).forEach(([key, value]) => {
    params.append(`sorting[${key}]`, String(value));
  });
}

function appendPagingParams(params: URLSearchParams, paging: IGetEntriesPaging | undefined): void {
  if (!paging) return;
  Object.entries(paging).forEach(([key, value]) => {
    params.append(`paging[${key}]`, String(value));
  });
}

function resolveEntriesEndpoint(formId: string | undefined, entryId: string | undefined): string {
  if (entryId) return `/entries/${entryId}`;
  if (formId) return `/forms/${formId}/entries`;
  return '/entries';
}

// Extracts entries + pagination total from the raw /entries response. The
// single-entry endpoint (/entries/{id}) returns a bare entry object (no
// `.entries` key), so this falls through to the whole response; a falsy
// response falls through to an empty array — matching the original untyped
// `response?.entries || response || []` exactly, including for a bare-array
// response (arrays are records too, so `.entries` there resolves the same way
// it did before this file was typed).
function extractEntriesAndTotal(response: unknown): { entries: unknown; totalCount: number | undefined } {
  const responseRecord = isRecord(response) ? response : undefined;
  // Pre-seeded to [] and conditionally overwritten (rather than `||`/`??`) to
  // keep the exact "first truthy of entries, then response, else []"
  // fallthrough — a bare-array `response` can carry a truthy `.entries`
  // (Array.prototype.entries) that isn't nullish, so `??` would not fall
  // through the same way `||`'s truthy check does here.
  let entries: unknown = [];
  if (responseRecord?.entries) {
    entries = responseRecord.entries;
  } else if (response) {
    entries = response;
  }
  const totalCount = responseRecord?.total_count as number | undefined;
  return { entries, totalCount };
}

function wrapSingleEntry(entries: unknown, entryId: string | undefined): unknown {
  if (entryId && entries && typeof entries === 'object' && !Array.isArray(entries)) {
    return [entries];
  }
  return entries;
}

// Combines the single-entry wrap, optional field projection, and optional
// exclude_empty filtering into one step, keeping getEntries' own complexity
// under the repo's lint threshold. Each sub-step is a verbatim extraction of
// what used to be inline in getEntries.
function normalizeAndFilterEntries(
  rawEntries: unknown,
  entryId: string | undefined,
  projectFieldIds: string[] | undefined,
  excludeEmpty: boolean
): unknown {
  let entries = wrapSingleEntry(rawEntries, entryId);

  if (projectFieldIds && projectFieldIds.length > 0 && Array.isArray(entries)) {
    entries = projectEntryFields(entries, projectFieldIds);
  }
  // Drop abandoned submissions (entries with no field values at all) so callers
  // aren't handed empty shells. Applied client-side after fetch, so totalCount /
  // pagination still reflect the server's unfiltered count.
  if (excludeEmpty && Array.isArray(entries)) {
    entries = entries.filter((entry: unknown) => entryHasFieldValues(entry));
  }

  return entries;
}

// Field projection: when field_ids is provided, keep only those field values (plus core
// entry metadata) so wide forms don't return every field. Requested IDs also match their
// composite sub-inputs (e.g. "1" keeps "1.3"/"1.6" name parts). This shrinks the payload
// before size estimation, so a projected wide form won't trip auto-summary.
function projectEntryFields(entries: unknown[], fieldIds: string[]): unknown[] {
  const metaKeys = new Set(['id', 'form_id', 'date_created', 'date_updated', 'created_by', 'status', 'source_url']);
  return entries.map((entry) => {
    if (!isRecord(entry)) return entry;
    const projected: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry)) {
      if (metaKeys.has(key) || fieldIds.some(fid => key === fid || key.startsWith(`${fid}.`))) {
        projected[key] = value;
      }
    }
    return projected;
  });
}

// Determines how to format the response based on the requested mode (and, in
// 'auto' mode, the estimated response size).
function resolveProcessedEntries(entries: IGravityEntry[], responseMode: string): { processedEntries: unknown[]; wasSummarized: boolean } {
  if (responseMode === 'summary') {
    return { processedEntries: entries.map((entry): unknown => createEntrySummary(entry)), wasSummarized: true };
  }
  if (responseMode === 'full') {
    return { processedEntries: entries, wasSummarized: false };
  }
  // response_mode === 'auto': efficiently estimate size without full JSON generation
  const estimatedTokens = estimateEntriesResponseSize(entries);
  if (estimatedTokens > 20000) {
    return { processedEntries: entries.map((entry): unknown => createEntrySummary(entry)), wasSummarized: true };
  }
  return { processedEntries: entries, wasSummarized: false };
}

function buildPaginationInfo(totalCount: number | undefined, paging: IGetEntriesPaging | undefined, entriesLength: number): string {
  if (totalCount === undefined) return '';

  // page/size 0 are not meaningful values here (a zero page or zero page size
  // makes no sense), so an explicit `if` preserves the original's "any falsy
  // value falls back" behavior — `??` would only catch null/undefined.
  let currentPage = 1;
  if (paging?.current_page) {
    currentPage = paging.current_page;
  }
  let pageSize = entriesLength;
  if (paging?.page_size) {
    pageSize = paging.page_size;
  }
  const totalPages = Math.ceil(totalCount / pageSize);

  // "More pages" is judged by how many entries have actually been shown vs the
  // total — not by whether the caller passed paging. Gravity Forms defaults to a
  // small page size, so an unpaged first call returns only page 1; without this,
  // a caller (or a model) with no paging in the request got no hint that more
  // existed and would assume it had everything.
  const shownThrough = ((currentPage - 1) * pageSize) + entriesLength;
  const hasMorePages = shownThrough < totalCount;

  let paginationInfo = `\n📊 Pagination Info:\n`;
  paginationInfo += `- Total entries: ${totalCount}\n`;
  paginationInfo += `- Current page: ${currentPage}\n`;
  paginationInfo += `- Page size: ${pageSize}\n`;
  paginationInfo += `- Total pages: ${totalPages}\n`;
  paginationInfo += `- Showing entries: ${((currentPage - 1) * pageSize) + 1} to ${Math.min(shownThrough, totalCount)}\n`;

  if (hasMorePages) {
    const remaining = totalCount - shownThrough;
    paginationInfo += `\n⚠️  Showing ${entriesLength} of ${totalCount} entries (page ${currentPage} of ${totalPages}) — ${remaining} more not shown.\n`;
    paginationInfo += `To get the next page, call get_entries again with:\n`;
    paginationInfo += `  { "paging": { "page_size": ${pageSize}, "current_page": ${currentPage + 1} } }\n`;
    paginationInfo += `To get all ${totalCount} in one call, use:\n`;
    paginationInfo += `  { "paging": { "page_size": ${totalCount} } }\n`;
    paginationInfo += `(For wide forms, also pass "field_ids": [...] to return only the fields you need and keep the response small.)\n`;
  }

  return paginationInfo;
}

function buildEntriesResponseText(entriesLength: number, processedEntries: unknown[], wasSummarized: boolean, paginationInfo: string): string {
  let responseText: string;
  if (wasSummarized) {
    responseText = `Response summarized to prevent context overflow.\n\n`;
    responseText += `Found ${entriesLength} ${entriesLength === 1 ? 'entry' : 'entries'}:\n`;
  } else {
    responseText = `Found ${entriesLength} ${entriesLength === 1 ? 'entry' : 'entries'}`;
  }
  responseText += paginationInfo;
  responseText += `\n📋 Entries:\n${JSON.stringify(processedEntries, null, 2)}`;
  return responseText;
}

export async function getEntries(ctx: EntriesQueryToolContext, args: GetEntriesArgs): Promise<GetEntriesResult> {
    const {
      form_id,
      entry_id,
      search,
      sorting,
      paging,
      response_mode = 'auto',
      search_mode = 'standard',
      field_detection = false,
      field_ids,
      exclude_empty = false
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

    const endpoint = resolveEntriesEndpoint(form_id, entry_id);
    const params = new URLSearchParams();

    // Build search parameter as JSON object per Gravity Forms API documentation
    const searchParam = buildGetEntriesSearchParam(search);
    if (searchParam) {
      params.append('search', searchParam);
    }

    appendSortingParams(params, sorting);
    appendPagingParams(params, paging);

    const queryString = params.toString();
    const fullEndpoint = queryString ? `${endpoint}?${queryString}` : endpoint;

    const response = await ctx.makeRequest<unknown>(fullEndpoint);

    // Extract entries and pagination info from API response
    const { entries: rawEntries, totalCount } = extractEntriesAndTotal(response);

    // The single-entry endpoint (/entries/{id}) returns one entry object rather
    // than an array or an { entries: [...] } envelope. Wrap it in a one-element
    // array so projection, exclude_empty, and the empty-result guard below treat
    // it like any other result set instead of reporting "No entries found".
    const projectFieldIds: string[] | undefined = Array.isArray(field_ids)
      ? field_ids.map((id: unknown) => String(id))
      : undefined;
    const entries = normalizeAndFilterEntries(rawEntries, entry_id, projectFieldIds, exclude_empty === true);

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

    // Entries have been through the fetch + array-normalization above; treat
    // the validated array as Gravity Forms entries for the rest of the response
    // pipeline (summarization, projection sizing, JSON output).
    const entryList = entries as IGravityEntry[];

    // Determine how to format response based on size and mode
    const { processedEntries, wasSummarized } = resolveProcessedEntries(entryList, response_mode);

    // Build final response text with pagination info
    const paginationInfo = buildPaginationInfo(totalCount, paging, entryList.length);
    const responseText = buildEntriesResponseText(entryList.length, processedEntries, wasSummarized, paginationInfo);

    return {
      content: [
        {
          type: "text",
          text: responseText
        }
      ]
    };
}

// A field_filters entry with a string `value`, as read while extracting free-text
// search from universal-search's `search.field_filters`.
interface IFieldFilterWithStringValue {
  value: string;
  [key: string]: unknown;
}

function extractSearchTextFromFieldFilters(search: unknown): string {
  if (!isRecord(search) || !Array.isArray(search.field_filters) || search.field_filters.length === 0) {
    return '';
  }

  return search.field_filters
    .filter((filter): filter is IFieldFilterWithStringValue => isRecord(filter) && typeof filter.value === 'string')
    .map((filter) => filter.value.trim())
    .filter(Boolean)
    .join(' ');
}

function extractFallbackSearchText(search: unknown): string {
  if (!isRecord(search)) return '';
  if (typeof search.text === 'string') return search.text.trim();
  if (typeof search.query === 'string') return search.query.trim();
  return '';
}

function resolveOutputMode(responseMode: string): OutputMode {
  if (responseMode === 'summary') return 'summary';
  if (responseMode === 'full') return 'detailed';
  return 'auto';
}

async function handleUniversalSearch(ctx: EntriesQueryToolContext, form_id: string, search: unknown, response_mode: string, field_detection: boolean): Promise<GetEntriesResult> {
    try {
      const searchManager = ctx.getOrCreateSearchManager();

      // Extract and validate search text from various sources. field_filters is
      // tried first; if that yields nothing, fall back to a text/query parameter.
      let searchText = extractSearchTextFromFieldFilters(search);
      if (!searchText.trim()) {
        searchText = extractFallbackSearchText(search);
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
      const formData = await ctx.makeRequest<IGravityForm>(`/forms/${form_id}`);
      let fieldMapping: Record<string, FieldTypeInfo> = {};
      try {
        fieldMapping = ctx.fieldTypeDetector.analyzeFormFields(formData);
      } catch {
        // Degrade gracefully - matched fields still render, just without
        // type-based labels/ordering.
      }
      // '' is a legitimate (if unlikely) form title, distinct from "not provided" —
      // an explicit `if` (rather than `||`/`??`) keeps that fall-through without
      // treating an empty title as missing.
      let formTitle = `Form ${form_id}`;
      if (formData.title) {
        formTitle = formData.title;
      }
      const formInfo: FormInfo = {
        id: form_id,
        title: formTitle,
        fields: formData.fields ?? [],
        fieldMapping
      };

      // Format results using SearchResultsFormatter
      // Note: Universal search returns formatted, human-readable results with context and confidence scores
      // This is intentionally different from standard search (raw JSON) to provide enhanced user experience
      const outputMode = resolveOutputMode(response_mode);

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
