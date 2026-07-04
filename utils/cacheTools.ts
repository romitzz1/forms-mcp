// ABOUTME: Cache MCP tool handlers (get_cache_status)
// ABOUTME: Extracted from GravityFormsMCPServer to isolate handler logic from server infrastructure

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ICacheConfig, ICacheStatus } from "./cacheTypes.js";
import type { FormCache } from "./formCache.js";
import type { TemplateManager } from "./templateManager.js";
import { createFormSummary, estimateTokenCount } from "./responseSizeManager.js";

export interface CacheToolContext {
  getCacheStatus(): Promise<ICacheStatus>;
}

export interface FormsCacheToolContext {
  makeRequest(this: void, endpoint: string, method?: string, body?: unknown): Promise<any>;
  getFormCache(): FormCache | null;
  cacheConfig: ICacheConfig;
  getTemplateManager(): TemplateManager;
}

export async function getCacheStatusTool(ctx: CacheToolContext) {
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

export async function getForms(ctx: FormsCacheToolContext, args: any) {
    const formCache = ctx.getFormCache();
    const { form_id, include_fields, include_all, exclude_trash, summary_mode, sort_by, sort_order, active_only } = args;

    // When form_id is specified, always use API (ignore include_all)
    if (form_id) {
      const endpoint = `/forms/${form_id}`;
      const form = await ctx.makeRequest(endpoint);

      // Check if summary mode is requested or if form response would be too large
      const fullResponse = JSON.stringify(form, null, 2);
      const tokenEstimate = estimateTokenCount(fullResponse);

      if (summary_mode || tokenEstimate > 20000) {
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

    // If include_all is true, use FormCache for complete form discovery
    if (include_all === true) {
      try {
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
            ctx.makeRequest,
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
          const forms = await ctx.makeRequest(endpoint);
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

        // Transform cached form data to match API format
        let formsData = allForms.map(form => {
          const baseForm = {
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
          if (include_fields && form.form_data) {
            try {
              const parsedData = JSON.parse(form.form_data);
              return { ...baseForm, ...parsedData, date_created: form.date_created ?? parsedData?.date_created ?? null };
            } catch {
              return baseForm;
            }
          }

          return baseForm;
        });

        // Optionally drop inactive forms so callers can focus on live forms.
        if (active_only === true) {
          formsData = formsData.filter(form => form.is_active === '1');
        }

        // Sort by a chosen key so callers can browse by recency, usage, or name
        // without eyeballing an unordered list. Defaults to no sort (cache order).
        if (sort_by) {
          const direction = sort_order === 'asc' ? 1 : -1;
          const numericKeys = new Set(['id', 'entry_count']);
          formsData.sort((a: any, b: any) => {
            let av = a[sort_by];
            let bv = b[sort_by];
            if (numericKeys.has(sort_by)) {
              av = Number(av);
              bv = Number(bv);
            }
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (av < bv) return -1 * direction;
            if (av > bv) return 1 * direction;
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
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';

        // For cache-related errors, fallback to API
        try {
          const endpoint = include_fields ? '/forms?include[]=form_fields' : '/forms';
          const forms = await ctx.makeRequest(endpoint);

          const cacheFallbackWarning = `Note: Form cache unavailable (${message}). Showing active forms from API only — inactive/deleted forms are not included.\n\n`;
          if (message.includes('not available')) {
            return {
              content: [
                {
                  type: "text",
                  text: `${cacheFallbackWarning}${JSON.stringify(forms, null, 2)}`
                }
              ]
            };
          } else if (message.includes('Cache error')) {
            return {
              content: [
                {
                  type: "text",
                  text: `${cacheFallbackWarning}${JSON.stringify(forms, null, 2)}`
                }
              ]
            };
          } else if (message.includes('Cache init failed')) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error initializing form cache: ${message}`
                }
              ]
            };
          } else {
            // For sync failures, show error message
            return {
              content: [
                {
                  type: "text",
                  text: `Error accessing complete form cache: ${message}`
                }
              ]
            };
          }
        } catch (apiError) {
          // If API fallback also fails, return the cache error with appropriate prefix
          if (message.includes('Cache init failed')) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error initializing form cache: ${message}`
                }
              ]
            };
          } else {
            return {
              content: [
                {
                  type: "text",
                  text: `Error accessing complete form cache: ${message}`
                }
              ]
            };
          }
        }
      }
    }

    // Default behavior: use API only (backward compatibility)
    const endpoint = include_fields ? '/forms?include[]=form_fields' : '/forms';
    const forms = await ctx.makeRequest(endpoint);

    // /forms endpoint only returns active forms, no filtering needed
    // Add a human-readable summary before the JSON for quick orientation
    const formsList = Array.isArray(forms) ? forms : [];
    let summaryHeader = `Found ${formsList.length} active form${formsList.length === 1 ? '' : 's'}`;
    if (formsList.length > 0) {
      const listing = formsList.map((f: any) => `  - "${f.title || 'Untitled'}" (ID: ${f.id})`).join('\n');
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

export async function listFormTemplates(ctx: FormsCacheToolContext, args: any) {
    const formCache = ctx.getFormCache();
    try {
      // Extract parameters with defaults
      const { search_term, sort_by = 'name', sort_order = 'asc', include_all = false } = args;

      // Validate parameters
      if (sort_by && !['name', 'date'].includes(sort_by)) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid sort_by value: ${sort_by}. Must be 'name' or 'date'.`);
      }

      if (sort_order && !['asc', 'desc'].includes(sort_order)) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid sort_order value: ${sort_order}. Must be 'asc' or 'desc'.`);
      }

      if (include_all !== undefined && typeof include_all !== 'boolean') {
        throw new McpError(ErrorCode.InvalidParams, 'include_all must be a boolean');
      }

      // Get TemplateManager (lazy initialization)
      const templateManager = ctx.getTemplateManager();

      let allTemplates;

      if (include_all === true) {
        // Use cache for complete template discovery
        try {
          // Check if FormCache is available
          if (!formCache || formCache === null) {
            console.warn('FormCache not available, falling back to API-only template discovery');
            allTemplates = await templateManager.listTemplates();
          } else {
            // Ensure cache is initialized
            if (!formCache.isReady()) {
              await formCache.init();
            }

            // Refresh in the background when stale rather than blocking on a
            // potentially multi-minute discovery sync (stale-while-revalidate).
            if (await formCache.isStale(ctx.cacheConfig.maxAgeSeconds * 1000)) {
              formCache.syncInBackground(
                ctx.makeRequest,
                ctx.cacheConfig.fullSyncIntervalHours,
                ctx.cacheConfig.maxAgeSeconds * 1000
              );
            }

            // Get all cached forms
            const cachedForms = await formCache.getAllForms();

            // Cold cache (first sync still warming): fall back to API-only template
            // discovery so callers get results now instead of an empty list.
            if (cachedForms.length === 0) {
              allTemplates = await templateManager.listTemplates();
            } else {
            // Convert FormCacheRecord[] to form objects for TemplateManager
            const formsData = cachedForms.map(form => {
              // Parse form_data if it's a JSON string
              if (form.form_data && typeof form.form_data === 'string') {
                try {
                  return JSON.parse(form.form_data);
                } catch (error) {
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
            allTemplates = await templateManager.listTemplates(formsData);
            }
          }
        } catch (error) {
          // Fall back to API-only behavior if cache fails
          console.warn('FormCache failed, falling back to API-only template discovery:', error);
          allTemplates = await templateManager.listTemplates();
        }
      } else {
        // Use API-only behavior (original behavior)
        allTemplates = await templateManager.listTemplates();
      }

      // Filter templates by search term if provided
      let filteredTemplates = allTemplates;
      if (search_term && search_term.trim() !== '') {
        const searchLower = search_term.trim().toLowerCase();
        filteredTemplates = allTemplates.filter(template =>
          template.name.toLowerCase().includes(searchLower) ||
          (template.description || '').toLowerCase().includes(searchLower)
        );
      }

      // Sort templates
      filteredTemplates.sort((a, b) => {
        let comparison = 0;

        if (sort_by === 'name') {
          comparison = a.name.localeCompare(b.name);
        } else if (sort_by === 'date') {
          // Convert date strings to Date objects for comparison with safety checks
          const dateA = new Date(a.created_date || '1970-01-01');
          const dateB = new Date(b.created_date || '1970-01-01');

          // Handle invalid dates
          const timeA = isNaN(dateA.getTime()) ? 0 : dateA.getTime();
          const timeB = isNaN(dateB.getTime()) ? 0 : dateB.getTime();

          comparison = timeA - timeB;
        }

        return sort_order === 'desc' ? -comparison : comparison;
      });

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
