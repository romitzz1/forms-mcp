// ABOUTME: Export MCP tool handlers (export_entries_formatted, export_form_json)
// ABOUTME: Extracted from GravityFormsMCPServer to isolate handler logic from server infrastructure

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { DataExporter, ExportResult } from "./dataExporter.js";
import type { IGfEntriesResponse, IGravityEntry, IGravityForm } from "./gravityFormsTypes.js";
import type { ValidationHelper } from "./validation.js";

const MAX_EXPORT_ENTRIES = 1000; // Safety limit for exports

export interface ExportToolContext {
  makeRequest<T = unknown>(endpoint: string, method?: string, body?: unknown): Promise<T>;
  validator: ValidationHelper;
  dataExporter: DataExporter;
}

export interface ExportToolResult {
  content: Array<{ type: "text"; text: string }>;
}

// A single field_filters entry. The Zod schema types each item as `unknown`
// (arbitrary client input), so only the fields actually read here are named;
// everything else is opaque and preserved via the index signature.
interface IRawFieldFilter {
  key?: unknown;
  value?: unknown;
  operator?: unknown;
  [key: string]: unknown;
}

interface IDateRangeFilter {
  start?: string;
  end?: string;
}

interface IExportEntriesSearch {
  status?: string;
  field_filters?: unknown;
  date_range?: IDateRangeFilter;
  start_date?: string;
  end_date?: string;
  // Other LLM-supplied search parameters, passed through as string search terms.
  [key: string]: unknown;
}

export interface ExportEntriesFormattedArgs {
  form_id: string;
  format: 'csv' | 'json';
  search?: IExportEntriesSearch;
  date_format?: string;
  filename?: string;
  include_headers?: boolean;
  save_to_disk?: boolean;
  output_path?: string;
  skip_base64?: boolean;
  field_ids?: string[];
  paging?: {
    page_size?: number;
    current_page?: number;
  };
}

// The search-object shape built up for the Gravity Forms REST API's `search`
// query parameter. Known keys are typed; arbitrary passthrough keys (from the
// "other search parameters" backward-compatibility branch) are covered by the
// index signature.
interface IGfSearchQuery {
  status?: string;
  field_filters?: Array<{ key: string; value: string; operator: string }>;
  date_range?: IDateRangeFilter;
  [key: string]: unknown;
}

function isRawFieldFilterCandidate(filter: unknown): filter is IRawFieldFilter {
  return typeof filter === 'object' && filter !== null;
}

// Routes String() through a plain-`unknown` parameter so a truthy-narrowed
// (non-nullish) call site doesn't resolve to a type whose only toString is
// Object's default (`no-base-to-string`), while producing an identical result.
function stringifyFilterValue(value: unknown): string {
  return String(value).trim();
}

function buildValidFieldFilters(fieldFilters: unknown): Array<{ key: string; value: string; operator: string }> {
  if (!Array.isArray(fieldFilters)) {
    return [];
  }

  return fieldFilters
    .filter((filter): filter is IRawFieldFilter => isRawFieldFilterCandidate(filter) && filter.key != null && filter.value != null)
    .map((filter) => {
      const sanitizedKey = stringifyFilterValue(filter.key);
      const sanitizedValue = stringifyFilterValue(filter.value);
      const sanitizedOperator = filter.operator ? stringifyFilterValue(filter.operator) : '=';

      return sanitizedKey !== '' ? {
        key: sanitizedKey,
        value: sanitizedValue,
        operator: sanitizedOperator
      } : null;
    })
    .filter((filter): filter is { key: string; value: string; operator: string } => filter !== null);
}

// Merges the structured date_range object and the LLM-friendly start_date/end_date
// shorthand into a single { start?, end? } pair (structured format takes priority
// since it's applied first and the shorthand can then overwrite it, matching the
// original sequential-assignment order).
function resolveDateRangeFilter(search: IExportEntriesSearch): IDateRangeFilter {
  const dateRange: IDateRangeFilter = {};

  if (search.date_range) {
    if (search.date_range.start) {
      dateRange.start = search.date_range.start;
    }
    if (search.date_range.end) {
      dateRange.end = search.date_range.end;
    }
  }

  if (search.start_date) {
    dateRange.start = search.start_date;
  }
  if (search.end_date) {
    dateRange.end = search.end_date;
  }

  return dateRange;
}

// Builds the JSON-encoded `search` query parameter per Gravity Forms API
// documentation, or returns undefined when there's nothing to search for.
function buildSearchQueryParam(search: IExportEntriesSearch | undefined): string | undefined {
  if (!search) {
    return undefined;
  }

  const searchObject: IGfSearchQuery = {};

  if (search.status) {
    searchObject.status = search.status;
  }

  const validFilters = buildValidFieldFilters(search.field_filters);
  if (validFilters.length > 0) {
    searchObject.field_filters = validFilters;
  }

  // Convert date range to field_filters for proper API compatibility
  // The Gravity Forms API doesn't properly support date_range parameter
  const dateRange = resolveDateRangeFilter(search);
  if (Object.keys(dateRange).length > 0) {
    searchObject.field_filters ??= [];

    if (dateRange.start) {
      searchObject.field_filters.push({ key: 'date_created', value: dateRange.start, operator: '>=' });
    }
    if (dateRange.end) {
      searchObject.field_filters.push({ key: 'date_created', value: dateRange.end, operator: '<=' });
    }

    // Also keep the original date_range for backward compatibility
    searchObject.date_range = dateRange;
  }

  // Handle other search parameters (backward compatibility)
  Object.entries(search).forEach(([key, value]) => {
    if (key !== 'status' && key !== 'field_filters' && key !== 'date_range' &&
        key !== 'start_date' && key !== 'end_date') {
      searchObject[key] = String(value);
    }
  });

  // Only report a search parameter if we have something to search for
  return Object.keys(searchObject).length > 0 ? JSON.stringify(searchObject) : undefined;
}

interface IExportMessageParams {
  exportResult: ExportResult;
  entriesCount: number;
  totalCount: number | undefined;
  pageSize: number;
  currentPage: number;
  pagingExplicit: boolean;
  maxExportEntries: number;
  formId: string;
  format: string;
}

// Builds the export-completed summary message, including pagination and
// "more entries available" guidance when applicable.
function buildExportMessage(p: IExportMessageParams): string {
  let exportMessage = `Export completed successfully!\n\n`;
  exportMessage += `Format: ${p.exportResult.format.toUpperCase()}\n`;
  exportMessage += `Filename: ${p.exportResult.filename}\n`;
  exportMessage += `Records exported: ${p.entriesCount}\n`;

  // Add pagination info if total count is available
  if (p.totalCount !== undefined) {
    exportMessage += `Total entries available: ${p.totalCount}\n`;

    const totalPages = Math.ceil(p.totalCount / p.pageSize);
    exportMessage += `Current page: ${p.currentPage} of ${totalPages}\n`;
    exportMessage += `Page size: ${p.pageSize}\n`;

    // Fix math edge case for zero entries
    if (p.totalCount > 0) {
      exportMessage += `Showing entries: ${((p.currentPage - 1) * p.pageSize) + 1} to ${Math.min(p.currentPage * p.pageSize, p.totalCount)}\n`;
    } else {
      exportMessage += `Showing entries: No entries found\n`;
    }

    // Add safety warning if using default limit without explicit pagination
    if (!p.pagingExplicit && p.totalCount > p.maxExportEntries) {
      exportMessage += `\n⚠️  Large Dataset Safety Limit Applied!\n`;
      exportMessage += `- Only first ${p.maxExportEntries} entries exported (safety limit)\n`;
      exportMessage += `- Total available: ${p.totalCount} entries\n`;
      exportMessage += `- Use explicit pagination to access all data:\n`;
      exportMessage += `{ "form_id": "${p.formId}", "format": "${p.format}", "paging": { "page_size": 1000, "current_page": 2 } }\n`;
    } else if (p.totalCount > (p.currentPage * p.pageSize)) {
      const remaining = p.totalCount - (p.currentPage * p.pageSize);
      exportMessage += `\n⚠️  More entries available!\n`;
      exportMessage += `- Remaining: ${remaining} entries\n`;
      exportMessage += `\nTo export the next page:\n`;
      exportMessage += `{ "form_id": "${p.formId}", "format": "${p.format}", "paging": { "page_size": ${p.pageSize}, "current_page": ${p.currentPage + 1} } }\n`;
    }
  }

  exportMessage += `\nFile size: ${p.exportResult.data.length} characters\n`;

  // Add file path information if saved to disk
  if (p.exportResult.filePath) {
    exportMessage += `\n✅ File saved to disk: ${p.exportResult.filePath}\n`;
  }

  // Add base64 data if not skipped
  if (p.exportResult.base64Data !== undefined) {
    exportMessage += `\nBase64 encoded data for download:\n${p.exportResult.base64Data}`;
  } else {
    exportMessage += `\n⚡ Base64 encoding skipped to reduce response size`;
  }

  return exportMessage;
}

interface IResolvedPagination {
  pageSize: number;
  currentPage: number;
}

// Resolves the effective page size/current page and appends the corresponding
// `paging[...]` query params, preserving the original's backward-compatible
// default: when no page_size is explicitly requested, current_page is reset
// to '1' in the query string even if the caller supplied a current_page.
function applyPaginationParams(params: URLSearchParams, paging: ExportEntriesFormattedArgs['paging'], maxExportEntries: number): IResolvedPagination {
  let pageSize: number | undefined;
  let currentPage = 1;

  if (paging) {
    if (paging.page_size) {
      // Enforce safety limit when page_size is explicitly provided
      pageSize = Math.min(Math.max(1, paging.page_size), maxExportEntries);
    }
    if (paging.current_page) {
      currentPage = Math.max(1, paging.current_page); // Ensure page >= 1
    }
  }

  // Only add pagination if explicitly requested - preserves backward compatibility
  if (pageSize !== undefined) {
    params.append('paging[page_size]', String(pageSize));
    params.append('paging[current_page]', String(currentPage));
  } else {
    // No pagination specified - let API return all entries (original behavior)
    // Add safety warning for large datasets
    params.append('paging[page_size]', String(maxExportEntries));
    params.append('paging[current_page]', '1');
    pageSize = maxExportEntries; // Set for response calculations
  }

  return { pageSize, currentPage };
}

// Normalizes the /entries response into an entries array + optional total
// count, tolerating a bare-array response (no envelope) for backward compatibility.
function extractEntriesAndTotal(response: IGfEntriesResponse | IGravityEntry[]): { entries: IGravityEntry[]; totalCount: number | undefined } {
  if (Array.isArray(response)) {
    return { entries: response, totalCount: undefined };
  }
  return { entries: response?.entries ?? [], totalCount: response?.total_count };
}

export async function exportEntriesFormatted(ctx: ExportToolContext, args: ExportEntriesFormattedArgs): Promise<ExportToolResult> {
    // Validate input parameters
    const validationResult = ctx.validator.validateExportEntriesParams(args);
    if (!validationResult.isValid) {
      throw new McpError(
        ErrorCode.InvalidParams,
        validationResult.errors.join(', ')
      );
    }

    // Use sanitized parameters if available (e.g., for parsed field_ids). sanitizedValue,
    // when present, has already been validated by validateExportEntriesParams above to
    // match this same shape — casting here documents that validated boundary.
    const sanitizedArgs = (validationResult.sanitizedValue ?? args) as ExportEntriesFormattedArgs;
    const { form_id, format, search, date_format, filename, include_headers, save_to_disk, output_path, skip_base64, paging, field_ids } = sanitizedArgs;

    try {
      // Build API endpoint URL
      let endpoint = `/forms/${form_id}/entries`;
      const params = new URLSearchParams();

      // Build search parameter as JSON object per Gravity Forms API documentation
      const searchParam = buildSearchQueryParam(search);
      if (searchParam) {
        params.append('search', searchParam);
      }

      // Handle pagination parameters - maintain backward compatibility
      const maxExportEntries = MAX_EXPORT_ENTRIES;
      const { pageSize, currentPage } = applyPaginationParams(params, paging, maxExportEntries);

      // Append query parameters if any
      const queryString = params.toString();
      if (queryString) {
        endpoint += `?${queryString}`;
      }

      // Fetch entries from Gravity Forms API with pagination metadata
      const response = await ctx.makeRequest<IGfEntriesResponse | IGravityEntry[]>(endpoint);

      // Extract entries and pagination info
      const { entries, totalCount } = extractEntriesAndTotal(response);

      // Handle empty results
      if (!Array.isArray(entries) || entries.length === 0) {
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

      // Export using DataExporter
      const exportOptions = {
        dateFormat: date_format,
        includeHeaders: include_headers !== false, // Default to true
        filename: filename,
        saveToDisk: save_to_disk ?? false,
        outputPath: output_path,
        skipBase64: skip_base64 ?? false,
        fieldIds: field_ids
      };

      let exportResult;
      try {
        exportResult = await ctx.dataExporter.export(entries, format, exportOptions, form_id);
      } catch (exportError) {
        throw new McpError(
          ErrorCode.InternalError,
          `Data export failed: ${exportError instanceof Error ? exportError.message : 'Unknown export error'}`
        );
      }

      // Build export success message with pagination info
      const exportMessage = buildExportMessage({
        exportResult,
        entriesCount: entries.length,
        totalCount,
        pageSize,
        currentPage,
        pagingExplicit: paging !== undefined,
        maxExportEntries,
        formId: form_id,
        format
      });

      return {
        content: [
          {
            type: "text",
            text: exportMessage
          }
        ]
      };

    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
}

export interface ExportFormJsonArgs {
  form_id?: string;
  filename?: string;
  output_path?: string;
}

// A notification entry with the fields this handler reads/redacts. Gravity
// Forms notifications always carry a string `to` address per the REST API
// contract; other sensitive keys are opaque and only ever deleted.
interface IExportableNotification {
  to?: string;
  apiKey?: unknown;
  privateKey?: unknown;
  authToken?: unknown;
  customHeaders?: unknown;
  [key: string]: unknown;
}

interface IExportablePaymentSettings {
  apiUsername?: unknown;
  apiPassword?: unknown;
  signature?: unknown;
  secretKey?: unknown;
  publishableKey?: unknown;
  apiLoginId?: unknown;
  transactionKey?: unknown;
  [key: string]: unknown;
}

interface IExportableSettings {
  paypal?: IExportablePaymentSettings;
  stripe?: IExportablePaymentSettings;
  authorizenet?: IExportablePaymentSettings;
  [key: string]: unknown;
}

// A form definition as it exists mid-export: cloned from the fetched
// `IGravityForm`, with runtime/metadata fields deleted and export-specific
// fields (export_metadata) added, so every field the export mutates is
// declared optional here even though it's required/absent on `IGravityForm`.
interface IExportableForm {
  id?: string;
  title?: string;
  fields?: IGravityForm['fields'];
  settings?: IExportableSettings;
  notifications?: unknown;
  date_created?: string;
  date_updated?: string;
  entries_count?: number;
  is_active?: string;
  is_trash?: string;
  export_metadata?: {
    exported_at: string;
    export_version: string;
    source: string;
    original_form_id: string;
  };
  [key: string]: unknown;
}

// Redacts sensitive notification/payment-gateway data from a cloned form in
// place, ahead of writing it to disk as an export.
function sanitizeExportedForm(exportForm: IExportableForm): void {
  // Remove sensitive data from notifications
  if (exportForm.notifications && Array.isArray(exportForm.notifications)) {
    exportForm.notifications = (exportForm.notifications as IExportableNotification[]).map((notification) => {
      const cleanNotification = { ...notification };

      // Replace sensitive email addresses with placeholders
      if (cleanNotification.to?.includes('@') && cleanNotification.to !== '{admin_email}') {
        cleanNotification.to = '{admin_email}';
      }

      // Remove API keys and sensitive auth data
      delete cleanNotification.apiKey;
      delete cleanNotification.privateKey;
      delete cleanNotification.authToken;
      delete cleanNotification.customHeaders;

      return cleanNotification;
    });
  }

  // Remove sensitive payment gateway data
  if (exportForm.settings) {
    if (exportForm.settings.paypal) {
      delete exportForm.settings.paypal.apiUsername;
      delete exportForm.settings.paypal.apiPassword;
      delete exportForm.settings.paypal.signature;
    }
    if (exportForm.settings.stripe) {
      delete exportForm.settings.stripe.secretKey;
      // Keep publishable key as it's not sensitive
    }
    // Remove other sensitive payment processor data
    if (exportForm.settings.authorizenet) {
      delete exportForm.settings.authorizenet.apiLoginId;
      delete exportForm.settings.authorizenet.transactionKey;
    }
  }
}

export async function exportFormJson(ctx: ExportToolContext, args: ExportFormJsonArgs): Promise<ExportToolResult> {
    try {
      // Validate required parameters
      const { form_id } = args;

      if (!form_id || typeof form_id !== 'string' || form_id.trim() === '') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'form_id is required and must be a non-empty string'
        );
      }

      // Fetch the form data
      const form = await ctx.makeRequest<IGravityForm>(`/forms/${form_id}`);

      if (!form) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Form with ID ${form_id} not found`
        );
      }

      // Create a clean copy for export
      const exportForm = JSON.parse(JSON.stringify(form)) as IExportableForm;

      // Remove runtime/metadata properties that shouldn't be exported
      delete exportForm.id;
      delete exportForm.date_created;
      delete exportForm.date_updated;
      delete exportForm.entries_count;
      delete exportForm.is_active;
      delete exportForm.is_trash;

      sanitizeExportedForm(exportForm);

      // Add export metadata for tracking
      exportForm.export_metadata = {
        exported_at: new Date().toISOString(),
        export_version: '1.0',
        source: 'gravity-forms-mcp',
        original_form_id: form_id
      };

      // Format JSON with proper indentation for readability
      const formattedJson = JSON.stringify(exportForm, null, 2);

      // Always write the export to disk rather than inlining the (potentially huge)
      // JSON in the response — a large form definition can overflow the model's
      // context. Callers get a path + summary and read the file to import/inspect.
      const { filename, output_path } = args;
      // '' is a legitimate title, distinct from "not provided" — an explicit
      // `if` (rather than `||`) keeps that fall-through without tripping
      // prefer-nullish-coalescing (which would only trigger on null/undefined).
      let titleForSlug = 'form';
      if (exportForm.title) {
        titleForSlug = exportForm.title;
      }
      const slug = String(titleForSlug)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'form';
      let exportFilename = `form-${form_id}-${slug}.json`;
      if (filename) {
        exportFilename = filename;
      }

      const filePath = await ctx.dataExporter.saveContentToDisk(
        formattedJson,
        exportFilename,
        form_id,
        output_path
      );

      let formTitle = 'Untitled Form';
      if (exportForm.title) {
        formTitle = exportForm.title;
      }

      const response = {
        success: true,
        message: 'Form exported to disk as JSON',
        form_id: form_id,
        form_title: formTitle,
        export_size: formattedJson.length,
        fields_count: exportForm.fields ? exportForm.fields.length : 0,
        file_path: filePath,
        note: 'Full JSON written to disk (not inlined) to avoid overflowing context. Read the file to import or inspect it.'
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
        `Failed to export form as JSON: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
}
