// ABOUTME: Cache MCP tool handlers (get_cache_status)
// ABOUTME: Extracted from GravityFormsMCPServer to isolate handler logic from server infrastructure

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ICacheConfig, ICacheStatus } from "./cacheTypes.js";
import type { FormCache } from "./formCache.js";
import type { IFormLike, TemplateInfo, TemplateManager } from "./templateManager.js";
import { createFormSummary, estimateTokenCount } from "./responseSizeManager.js";
import type { IGravityForm } from "./gravityFormsTypes.js";

export interface CacheToolContext {
  getCacheStatus(): Promise<ICacheStatus>;
}

export interface FormsCacheToolContext {
  makeRequest<T = unknown>(this: void, endpoint: string, method?: string, body?: unknown): Promise<T>;
  getFormCache(): FormCache | null;
  cacheConfig: ICacheConfig;
  getTemplateManager(): TemplateManager;
}

// Shared MCP text-content result shape returned by every tool handler in this module.
export interface ICacheToolResult {
  content: Array<{ type: "text"; text: string }>;
}

// Args for get_forms — mirrors the get_forms Zod inputSchema in toolSchemas.ts.
// sort_by/sort_order are typed as plain `string` (not a literal union) because the
// schema casts its z.enum(...) through `as [string, ...string[]]`, which erases
// literal inference at the z.infer level.
export interface IGetFormsArgs {
  form_id?: string;
  include_fields?: boolean;
  include_all?: boolean;
  exclude_trash?: boolean;
  summary_mode?: boolean;
  sort_by?: string;
  sort_order?: string;
  active_only?: boolean;
}

// Args for list_form_templates — mirrors its Zod inputSchema in toolSchemas.ts.
export interface IListFormTemplatesArgs {
  search_term?: string;
  sort_by?: string;
  sort_order?: string;
  include_all?: boolean;
}

export async function getCacheStatusTool(ctx: CacheToolContext): Promise<ICacheToolResult> {
    try {
      const status = await ctx.getCacheStatus();

      // Ensure proper JSON serialization by converting dates to strings
      const serializedStatus = {
        ...status,
        lastSync: status.lastSync ? status.lastSync.toISOString() : null
      };

      return {
        content: [
          {
            type: "text",
            text: `FormCache Status Report:\n${JSON.stringify(serializedStatus, null, 2)}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get cache status: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
}

// form_id branch of get_forms: always uses the API directly (ignores include_all).
async function getFormById(ctx: FormsCacheToolContext, formId: string, summaryMode: boolean | undefined): Promise<ICacheToolResult> {
  const endpoint = `/forms/${formId}`;
  const form = await ctx.makeRequest<IGravityForm>(endpoint);

  // Check if summary mode is requested or if form response would be too large
  const fullResponse = JSON.stringify(form, null, 2);
  const tokenEstimate = estimateTokenCount(fullResponse);

  if (summaryMode || tokenEstimate > 20000) {
    // Return summary for large forms or when explicitly requested
    return {
      content: [
        {
          type: "text",
          text: createFormSummary(form)
        }
      ]
    };
  }

  return {
    content: [
      {
        type: "text",
        text: `Form Details:\n${fullResponse}`
      }
    ]
  };
}

// Builds the sorted/filtered "All Forms (including inactive)" response from the
// FormCache once forms have been resolved. Extracted from discoverAllFormsViaCache
// purely to keep that function's complexity/line-count under the lint thresholds —
// logic and order are unchanged.
function buildAllFormsResponse(
  allForms: Awaited<ReturnType<FormCache['getAllForms']>>,
  includeFields: boolean | undefined,
  activeOnly: boolean | undefined,
  sortBy: string | undefined,
  sortOrder: string | undefined
): ICacheToolResult {
  // Transform cached form data to match API format
  let formsData: Array<Record<string, unknown>> = allForms.map((form): Record<string, unknown> => {
    const baseForm: Record<string, unknown> = {
      id: form.id.toString(),
      title: form.title,
      entry_count: form.entry_count,
      is_active: form.is_active ? '1' : '0',
      is_trash: form.is_trash ? '1' : '0',
      // Read from the dedicated column, backfilled from full form definitions.
      date_created: form.date_created ?? null
    };

    // Include full field definitions when requested (parsed from cached
    // form_data). Keep date_created from the column authoritative.
    if (includeFields && form.form_data) {
      try {
        const parsedData = JSON.parse(form.form_data) as Record<string, unknown>;
        return { ...baseForm, ...parsedData, date_created: form.date_created ?? parsedData?.date_created ?? null };
      } catch {
        return baseForm;
      }
    }

    return baseForm;
  });

  // Optionally drop inactive forms so callers can focus on live forms.
  if (activeOnly === true) {
    formsData = formsData.filter(form => form.is_active === '1');
  }

  // Sort by a chosen key so callers can browse by recency, usage, or name
  // without eyeballing an unordered list. Defaults to no sort (cache order).
  if (sortBy) {
    const direction = sortOrder === 'asc' ? 1 : -1;
    const numericKeys = new Set(['id', 'entry_count']);
    formsData.sort((a, b) => {
      let av: unknown = a[sortBy];
      let bv: unknown = b[sortBy];
      if (numericKeys.has(sortBy)) {
        av = Number(av);
        bv = Number(bv);
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      // By this point av/bv are either both Numbers (numericKeys) or the raw
      // cached-form field values (strings from the API/cache) — comparable
      // with `<`/`>` either way, matching the original's untyped comparison.
      const avComparable = av as string | number;
      const bvComparable = bv as string | number;
      if (avComparable < bvComparable) return -1 * direction;
      if (avComparable > bvComparable) return 1 * direction;
      return 0;
    });
  }

  return {
    content: [
      {
        type: "text",
        text: `All Forms (including inactive):\n${JSON.stringify(formsData, null, 2)}`
      }
    ]
  };
}

// The include_all=true "happy path" for get_forms: pulls from FormCache, refreshing
// in the background when stale, with a cold-cache fallback to a direct API call.
// Throws on any cache failure — getFormsIncludeAll's catch handles the fallback.
async function discoverAllFormsViaCache(ctx: FormsCacheToolContext, formCache: FormCache | null, args: IGetFormsArgs): Promise<ICacheToolResult> {
  const { include_fields, exclude_trash, active_only, sort_by, sort_order } = args;

  // Ensure FormCache is available and initialized
  if (!formCache || formCache === null) {
    throw new Error('FormCache not available');
  }

  // Initialize cache if not ready
  if (!formCache.isReady()) {
    try {
      await formCache.init();
    } catch (initError) {
      throw new Error(`Cache init failed: ${initError instanceof Error ? initError.message : 'Unknown error'}`);
    }
  }

  // Refresh the cache in the BACKGROUND when stale. A cold discovery sync can
  // take minutes; blocking the tool call on it times out clients. Callers get
  // the current cached forms immediately (stale-while-revalidate), and the
  // background sync freshens the cache for the next call.
  const stale = await formCache.isStale(ctx.cacheConfig.maxAgeSeconds * 1000);
  if (stale) {
    formCache.syncInBackground(
      (endpoint: string) => ctx.makeRequest(endpoint),
      ctx.cacheConfig.fullSyncIntervalHours,
      ctx.cacheConfig.maxAgeSeconds * 1000
    );
  }

  // Get all forms from cache
  const allForms = await formCache.getAllForms(false, exclude_trash);

  // Cold cache (first-ever sync still warming): don't hand back an empty list.
  // Fall back to a direct /forms call for active forms now; a follow-up call
  // includes inactive/hidden forms once the background discovery finishes.
  if (allForms.length === 0 && stale) {
    const endpoint = include_fields ? '/forms?include[]=form_fields' : '/forms';
    const forms = await ctx.makeRequest<unknown>(endpoint);
    // Only surface the "warming up" note when the site actually has forms to
    // discover. A genuinely empty site always reads as stale (no last_synced),
    // so without this it would loop on the note forever; fall through to the
    // normal empty result instead.
    const hasForms = forms && typeof forms === 'object' && Object.keys(forms).length > 0;
    if (hasForms) {
      const warming = `Note: full form discovery is warming up in the background. Showing active forms for now — call get_forms with include_all again shortly for the complete list (including inactive/deleted forms).\n\n`;
      return {
        content: [{ type: "text", text: `${warming}${JSON.stringify(forms, null, 2)}` }]
      };
    }
  }

  return buildAllFormsResponse(allForms, include_fields, active_only, sort_by, sort_order);
}

// Fallback used when discoverAllFormsViaCache throws: retries via the API directly
// and shapes the error message according to the failure's origin.
async function handleFormsCacheFailure(ctx: FormsCacheToolContext, error: unknown, includeFields: boolean | undefined): Promise<ICacheToolResult> {
  const message = error instanceof Error ? error.message : 'Unknown error';

  // For cache-related errors, fallback to API
  try {
    const endpoint = includeFields ? '/forms?include[]=form_fields' : '/forms';
    const forms = await ctx.makeRequest<unknown>(endpoint);

    const cacheFallbackWarning = `Note: Form cache unavailable (${message}). Showing active forms from API only — inactive/deleted forms are not included.\n\n`;
    if (message.includes('not available')) {
      return {
        content: [{ type: "text", text: `${cacheFallbackWarning}${JSON.stringify(forms, null, 2)}` }]
      };
    } else if (message.includes('Cache error')) {
      return {
        content: [{ type: "text", text: `${cacheFallbackWarning}${JSON.stringify(forms, null, 2)}` }]
      };
    } else if (message.includes('Cache init failed')) {
      return {
        content: [{ type: "text", text: `Error initializing form cache: ${message}` }]
      };
    } else {
      // For sync failures, show error message
      return {
        content: [{ type: "text", text: `Error accessing complete form cache: ${message}` }]
      };
    }
  } catch {
    // If API fallback also fails, return the cache error with appropriate prefix
    if (message.includes('Cache init failed')) {
      return {
        content: [{ type: "text", text: `Error initializing form cache: ${message}` }]
      };
    } else {
      return {
        content: [{ type: "text", text: `Error accessing complete form cache: ${message}` }]
      };
    }
  }
}

// include_all=true branch of get_forms.
async function getFormsIncludeAll(ctx: FormsCacheToolContext, args: IGetFormsArgs): Promise<ICacheToolResult> {
  const formCache = ctx.getFormCache();
  try {
    return await discoverAllFormsViaCache(ctx, formCache, args);
  } catch (error) {
    return handleFormsCacheFailure(ctx, error, args.include_fields);
  }
}

// Default behavior: use API only (backward compatibility)
async function getFormsDefault(ctx: FormsCacheToolContext, includeFields: boolean | undefined): Promise<ICacheToolResult> {
  const endpoint = includeFields ? '/forms?include[]=form_fields' : '/forms';
  const forms = await ctx.makeRequest<IGravityForm[]>(endpoint);

  // /forms endpoint only returns active forms, no filtering needed
  // Add a human-readable summary before the JSON for quick orientation
  const formsList = Array.isArray(forms) ? forms : [];
  let summaryHeader = `Found ${formsList.length} active form${formsList.length === 1 ? '' : 's'}`;
  if (formsList.length > 0) {
    const listing = formsList.map((f) => `  - "${f.title || 'Untitled'}" (ID: ${f.id})`).join('\n');
    summaryHeader += `:\n${listing}\n\nFull details:`;
  }

  return {
    content: [
      {
        type: "text",
        text: `${summaryHeader}\n${JSON.stringify(forms, null, 2)}`
      }
    ]
  };
}

export async function getForms(ctx: FormsCacheToolContext, args: IGetFormsArgs): Promise<ICacheToolResult> {
    const { form_id, include_fields, include_all, summary_mode } = args;

    // When form_id is specified, always use API (ignore include_all)
    if (form_id) {
      return getFormById(ctx, form_id, summary_mode);
    }

    // If include_all is true, use FormCache for complete form discovery
    if (include_all === true) {
      return getFormsIncludeAll(ctx, args);
    }

    return getFormsDefault(ctx, include_fields);
}

// Validates list_form_templates args (post-default-application). Throws McpError
// on invalid input, exactly as the original inline checks did.
function validateListFormTemplatesArgs(sortBy: string, sortOrder: string, includeAll: boolean | undefined): void {
  if (sortBy && !['name', 'date'].includes(sortBy)) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid sort_by value: ${sortBy}. Must be 'name' or 'date'.`);
  }

  if (sortOrder && !['asc', 'desc'].includes(sortOrder)) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid sort_order value: ${sortOrder}. Must be 'asc' or 'desc'.`);
  }

  if (includeAll !== undefined && typeof includeAll !== 'boolean') {
    throw new McpError(ErrorCode.InvalidParams, 'include_all must be a boolean');
  }
}

// The FormCache-backed half of discoverTemplates's include_all path: refreshes a
// stale cache in the background, converts cached forms into form-like objects, and
// asks TemplateManager to filter them down to templates.
async function discoverTemplatesViaCache(ctx: FormsCacheToolContext, formCache: FormCache): Promise<TemplateInfo[]> {
  const templateManager = ctx.getTemplateManager();

  // Ensure cache is initialized
  if (!formCache.isReady()) {
    await formCache.init();
  }

  // Refresh in the background when stale rather than blocking on a
  // potentially multi-minute discovery sync (stale-while-revalidate).
  if (await formCache.isStale(ctx.cacheConfig.maxAgeSeconds * 1000)) {
    formCache.syncInBackground(
      (endpoint: string) => ctx.makeRequest(endpoint),
      ctx.cacheConfig.fullSyncIntervalHours,
      ctx.cacheConfig.maxAgeSeconds * 1000
    );
  }

  // Get all cached forms
  const cachedForms = await formCache.getAllForms();

  // Cold cache (first sync still warming): fall back to API-only template
  // discovery so callers get results now instead of an empty list.
  if (cachedForms.length === 0) {
    return templateManager.listTemplates();
  }

  // Convert FormCacheRecord[] to form objects for TemplateManager
  const formsData: IFormLike[] = cachedForms.map((form): IFormLike => {
    // Parse form_data if it's a JSON string
    if (form.form_data && typeof form.form_data === 'string') {
      try {
        return JSON.parse(form.form_data) as IFormLike;
      } catch {
        // If form_data is invalid JSON, create basic form object with minimal template structure
        return {
          id: form.id.toString(),
          title: form.title,
          description: '',
          fields: [{ id: '1', type: 'text', label: 'Placeholder Field' }], // Minimal valid structure
          date_created: form.last_synced
        };
      }
    }

    // If no form_data, create basic form object with minimal template structure
    return {
      id: form.id.toString(),
      title: form.title,
      description: '',
      fields: [{ id: '1', type: 'text', label: 'Placeholder Field' }], // Minimal valid structure
      date_created: form.last_synced
    };
  });

  // Use TemplateManager with cached forms
  return templateManager.listTemplates(formsData);
}

// Resolves the full (unfiltered/unsorted) template list for list_form_templates,
// per include_all.
async function discoverTemplates(ctx: FormsCacheToolContext, formCache: FormCache | null, includeAll: boolean): Promise<TemplateInfo[]> {
  const templateManager = ctx.getTemplateManager();

  if (includeAll !== true) {
    // Use API-only behavior (original behavior)
    return templateManager.listTemplates();
  }

  // Use cache for complete template discovery
  try {
    // Check if FormCache is available
    if (!formCache || formCache === null) {
      console.warn('FormCache not available, falling back to API-only template discovery');
      return await templateManager.listTemplates();
    }

    return await discoverTemplatesViaCache(ctx, formCache);
  } catch (error) {
    // Fall back to API-only behavior if cache fails
    console.warn('FormCache failed, falling back to API-only template discovery:', error);
    return templateManager.listTemplates();
  }
}

// Applies the search_term filter and name/date sort to a resolved template list.
function filterAndSortTemplates(allTemplates: TemplateInfo[], searchTerm: string | undefined, sortBy: string, sortOrder: string): TemplateInfo[] {
  // Filter templates by search term if provided
  let filteredTemplates = allTemplates;
  if (searchTerm && searchTerm.trim() !== '') {
    const searchLower = searchTerm.trim().toLowerCase();
    filteredTemplates = allTemplates.filter(template =>
      template.name.toLowerCase().includes(searchLower) ||
      (template.description || '').toLowerCase().includes(searchLower)
    );
  }

  // Sort templates
  filteredTemplates.sort((a, b) => {
    let comparison = 0;

    if (sortBy === 'name') {
      comparison = a.name.localeCompare(b.name);
    } else if (sortBy === 'date') {
      // Convert date strings to Date objects for comparison with safety checks
      const dateA = new Date(a.created_date || '1970-01-01');
      const dateB = new Date(b.created_date || '1970-01-01');

      // Handle invalid dates
      const timeA = isNaN(dateA.getTime()) ? 0 : dateA.getTime();
      const timeB = isNaN(dateB.getTime()) ? 0 : dateB.getTime();

      comparison = timeA - timeB;
    }

    return sortOrder === 'desc' ? -comparison : comparison;
  });

  return filteredTemplates;
}

export async function listFormTemplates(ctx: FormsCacheToolContext, args: IListFormTemplatesArgs): Promise<ICacheToolResult> {
    const formCache = ctx.getFormCache();
    try {
      // Extract parameters with defaults
      const { search_term, sort_by = 'name', sort_order = 'asc', include_all = false } = args;

      validateListFormTemplatesArgs(sort_by, sort_order, include_all);

      const allTemplates = await discoverTemplates(ctx, formCache, include_all);
      const filteredTemplates = filterAndSortTemplates(allTemplates, search_term, sort_by, sort_order);

      // Prepare response
      const response = {
        templates: filteredTemplates,
        total_count: filteredTemplates.length,
        message: filteredTemplates.length === 0 ? 'No templates found matching the criteria.' : undefined
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2)
          }
        ]
      };

    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list templates: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
}
