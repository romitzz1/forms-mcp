// ABOUTME: Export MCP tool handlers (export_entries_formatted, export_form_json)
// ABOUTME: Extracted from GravityFormsMCPServer to isolate handler logic from server infrastructure

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { DataExporter } from "./dataExporter.js";
import type { ValidationHelper } from "./validation.js";

const MAX_EXPORT_ENTRIES = 1000; // Safety limit for exports

export interface ExportToolContext {
  makeRequest(endpoint: string, method?: string, body?: unknown): Promise<any>;
  validator: ValidationHelper;
  dataExporter: DataExporter;
}

export async function exportEntriesFormatted(ctx: ExportToolContext, args: any) {
    // Validate input parameters
    const validationResult = ctx.validator.validateExportEntriesParams(args);
    if (!validationResult.isValid) {
      throw new McpError(
        ErrorCode.InvalidParams,
        validationResult.errors.join(', ')
      );
    }

    // Use sanitized parameters if available (e.g., for parsed field_ids)
    const sanitizedArgs = validationResult.sanitizedValue || args;
    const { form_id, format, search, date_format, filename, include_headers, save_to_disk, output_path, skip_base64, paging, field_ids } = sanitizedArgs;

    try {
      // Build API endpoint URL
      let endpoint = `/forms/${form_id}/entries`;
      const params = new URLSearchParams();

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

        // Handle date filtering - support multiple LLM-friendly formats
        const dateRange: any = {};

        // Format 1: Structured date_range object (preferred)
        if (search.date_range) {
          if (search.date_range.start) {
            dateRange.start = search.date_range.start;
          }
          if (search.date_range.end) {
            dateRange.end = search.date_range.end;
          }
        }

        // Format 2: Direct start_date/end_date properties (LLM-friendly)
        if (search.start_date) {
          dateRange.start = search.start_date;
        }
        if (search.end_date) {
          dateRange.end = search.end_date;
        }

        // Convert date range to field_filters for proper API compatibility
        // The Gravity Forms API doesn't properly support date_range parameter
        if (Object.keys(dateRange).length > 0) {
          if (!searchObject.field_filters) {
            searchObject.field_filters = [];
          }

          // Convert start date to field filter
          if (dateRange.start) {
            searchObject.field_filters.push({
              key: 'date_created',
              value: dateRange.start,
              operator: '>='
            });
          }

          // Convert end date to field filter
          if (dateRange.end) {
            searchObject.field_filters.push({
              key: 'date_created',
              value: dateRange.end,
              operator: '<='
            });
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

        // Only add search parameter if we have something to search for
        if (Object.keys(searchObject).length > 0) {
          params.append('search', JSON.stringify(searchObject));
        }
      }

      // Handle pagination parameters - maintain backward compatibility
      const maxExportEntries = MAX_EXPORT_ENTRIES;
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

      // Append query parameters if any
      const queryString = params.toString();
      if (queryString) {
        endpoint += `?${queryString}`;
      }

      // Fetch entries from Gravity Forms API with pagination metadata
      const response = await ctx.makeRequest(endpoint);

      // Extract entries and pagination info
      const entries = response?.entries || response || [];
      const totalCount = response?.total_count;

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
        saveToDisk: save_to_disk || false,
        outputPath: output_path,
        skipBase64: skip_base64 || false,
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
      let exportMessage = `Export completed successfully!\n\n`;
      exportMessage += `Format: ${exportResult.format.toUpperCase()}\n`;
      exportMessage += `Filename: ${exportResult.filename}\n`;
      exportMessage += `Records exported: ${entries.length}\n`;

      // Add pagination info if total count is available
      if (totalCount !== undefined) {
        exportMessage += `Total entries available: ${totalCount}\n`;

        const totalPages = Math.ceil(totalCount / pageSize);
        exportMessage += `Current page: ${currentPage} of ${totalPages}\n`;
        exportMessage += `Page size: ${pageSize}\n`;

        // Fix math edge case for zero entries
        if (totalCount > 0) {
          exportMessage += `Showing entries: ${((currentPage - 1) * pageSize) + 1} to ${Math.min(currentPage * pageSize, totalCount)}\n`;
        } else {
          exportMessage += `Showing entries: No entries found\n`;
        }

        // Add safety warning if using default limit without explicit pagination
        if (paging === undefined && totalCount > maxExportEntries) {
          exportMessage += `\n⚠️  Large Dataset Safety Limit Applied!\n`;
          exportMessage += `- Only first ${maxExportEntries} entries exported (safety limit)\n`;
          exportMessage += `- Total available: ${totalCount} entries\n`;
          exportMessage += `- Use explicit pagination to access all data:\n`;
          exportMessage += `{ "form_id": "${form_id}", "format": "${format}", "paging": { "page_size": 1000, "current_page": 2 } }\n`;
        } else if (totalCount > (currentPage * pageSize)) {
          const remaining = totalCount - (currentPage * pageSize);
          exportMessage += `\n⚠️  More entries available!\n`;
          exportMessage += `- Remaining: ${remaining} entries\n`;
          exportMessage += `\nTo export the next page:\n`;
          exportMessage += `{ "form_id": "${form_id}", "format": "${format}", "paging": { "page_size": ${pageSize}, "current_page": ${currentPage + 1} } }\n`;
        }
      }

      exportMessage += `\nFile size: ${exportResult.data.length} characters\n`;

      // Add file path information if saved to disk
      if (exportResult.filePath) {
        exportMessage += `\n✅ File saved to disk: ${exportResult.filePath}\n`;
      }

      // Add base64 data if not skipped
      if (exportResult.base64Data !== undefined) {
        exportMessage += `\nBase64 encoded data for download:\n${exportResult.base64Data}`;
      } else {
        exportMessage += `\n⚡ Base64 encoding skipped to reduce response size`;
      }

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

export async function exportFormJson(ctx: ExportToolContext, args: any) {
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
      const form = await ctx.makeRequest(`/forms/${form_id}`);

      if (!form) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Form with ID ${form_id} not found`
        );
      }

      // Create a clean copy for export
      const exportForm = JSON.parse(JSON.stringify(form));

      // Remove runtime/metadata properties that shouldn't be exported
      delete exportForm.id;
      delete exportForm.date_created;
      delete exportForm.date_updated;
      delete exportForm.entries_count;
      delete exportForm.is_active;
      delete exportForm.is_trash;

      // Remove sensitive data from notifications
      if (exportForm.notifications && Array.isArray(exportForm.notifications)) {
        exportForm.notifications = exportForm.notifications.map((notification: any) => {
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

      // Add export metadata for tracking
      exportForm.export_metadata = {
        exported_at: new Date().toISOString(),
        export_version: '1.0',
        source: 'gravity-forms-mcp',
        original_form_id: form_id
      };

      // Format JSON with proper indentation for readability
      const formattedJson = JSON.stringify(exportForm, null, 2);

      const response = {
        success: true,
        message: 'Form exported successfully as JSON',
        form_id: form_id,
        form_title: exportForm.title || 'Untitled Form',
        export_size: formattedJson.length,
        fields_count: exportForm.fields ? exportForm.fields.length : 0,
        json_data: formattedJson
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
