#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { DataExporter } from "./utils/dataExporter.js";
import { ValidationHelper } from "./utils/validation.js";
import { BulkOperationsManager } from "./utils/bulkOperations.js";
import { TemplateManager } from "./utils/templateManager.js";

// Configuration interface
interface GravityFormsConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  authMethod: 'basic' | 'oauth';
}

export class GravityFormsMCPServer {
  private server: Server;
  private config: GravityFormsConfig;
  private dataExporter: DataExporter;
  private validator: ValidationHelper;
  private bulkOperationsManager?: BulkOperationsManager;
  private templateManager?: TemplateManager;

  constructor() {
    this.server = new Server(
      {
        name: "gravity-forms-mcp",
        version: "1.0.0",
      }
    );

    // Load configuration from environment variables
    this.config = {
      baseUrl: process.env.GRAVITY_FORMS_BASE_URL || '',
      consumerKey: process.env.GRAVITY_FORMS_CONSUMER_KEY || '',
      consumerSecret: process.env.GRAVITY_FORMS_CONSUMER_SECRET || '',
      authMethod: (process.env.GRAVITY_FORMS_AUTH_METHOD as 'basic' | 'oauth') || 'basic'
    };

    // Initialize utility classes
    this.dataExporter = new DataExporter();
    this.validator = new ValidationHelper();
    // Note: BulkOperationsManager will be initialized lazily when first needed
    // to avoid auth errors during server startup

    this.setupToolHandlers();
  }

  private getAuthHeaders(): Record<string, string> {
    if (this.config.authMethod === 'basic') {
      const credentials = Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`).toString('base64');
      return {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json'
      };
    }
    // OAuth implementation would go here
    throw new McpError(
      ErrorCode.InvalidParams,
      'OAuth authentication not implemented yet'
    );
  }

  private async makeRequest(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
    const url = `${this.config.baseUrl}/wp-json/gf/v2${endpoint}`;
    const headers = this.getAuthHeaders();

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "get_forms",
            description: "Get all forms or specific form details",
            inputSchema: {
              type: "object",
              properties: {
                form_id: {
                  type: "string",
                  description: "Optional form ID to get specific form details"
                },
                include_fields: {
                  type: "boolean",
                  description: "Include full form field details",
                  default: false
                }
              }
            }
          },
          {
            name: "get_entries",
            description: "Get entries from forms with filtering and pagination",
            inputSchema: {
              type: "object",
              properties: {
                form_id: {
                  type: "string",
                  description: "Form ID to get entries from"
                },
                entry_id: {
                  type: "string",
                  description: "Specific entry ID to retrieve"
                },
                search: {
                  type: "object",
                  description: "Search criteria for filtering entries"
                },
                sorting: {
                  type: "object",
                  properties: {
                    key: { type: "string" },
                    direction: { type: "string", enum: ["ASC", "DESC", "RAND"] },
                    is_numeric: { type: "boolean" }
                  }
                },
                paging: {
                  type: "object",
                  properties: {
                    page_size: { type: "number" },
                    current_page: { type: "number" },
                    offset: { type: "number" }
                  }
                }
              }
            }
          },
          {
            name: "submit_form",
            description: "Submit a form with field values",
            inputSchema: {
              type: "object",
              properties: {
                form_id: {
                  type: "string",
                  description: "Form ID to submit to"
                },
                field_values: {
                  type: "object",
                  description: "Field values as key-value pairs (e.g., 'input_1': 'value')"
                },
                source_page: {
                  type: "number",
                  description: "Source page number",
                  default: 1
                },
                target_page: {
                  type: "number",
                  description: "Target page number",
                  default: 0
                }
              },
              required: ["form_id", "field_values"]
            }
          },
          {
            name: "create_entry",
            description: "Create a new entry directly (bypasses form validation)",
            inputSchema: {
              type: "object",
              properties: {
                form_id: {
                  type: "string",
                  description: "Form ID to create entry for"
                },
                field_values: {
                  type: "object",
                  description: "Field values as key-value pairs"
                },
                entry_meta: {
                  type: "object",
                  description: "Additional entry metadata"
                }
              },
              required: ["form_id", "field_values"]
            }
          },
          {
            name: "update_entry",
            description: "Update an existing entry",
            inputSchema: {
              type: "object",
              properties: {
                entry_id: {
                  type: "string",
                  description: "Entry ID to update"
                },
                field_values: {
                  type: "object",
                  description: "Field values to update"
                }
              },
              required: ["entry_id", "field_values"]
            }
          },
          {
            name: "delete_entry",
            description: "Delete an entry (moves to trash by default)",
            inputSchema: {
              type: "object",
              properties: {
                entry_id: {
                  type: "string",
                  description: "Entry ID to delete"
                },
                force: {
                  type: "boolean",
                  description: "Permanently delete instead of moving to trash",
                  default: false
                }
              },
              required: ["entry_id"]
            }
          },
          {
            name: "create_form",
            description: "Create a new form",
            inputSchema: {
              type: "object",
              properties: {
                title: {
                  type: "string",
                  description: "Form title"
                },
                description: {
                  type: "string",
                  description: "Form description"
                },
                fields: {
                  type: "array",
                  description: "Array of form fields"
                },
                settings: {
                  type: "object",
                  description: "Form settings"
                }
              },
              required: ["title"]
            }
          },
          {
            name: "validate_form",
            description: "Validate form submission without saving",
            inputSchema: {
              type: "object",
              properties: {
                form_id: {
                  type: "string",
                  description: "Form ID to validate against"
                },
                field_values: {
                  type: "object",
                  description: "Field values to validate"
                }
              },
              required: ["form_id", "field_values"]
            }
          },
          {
            name: "export_entries_formatted",
            description: "Export entries from a form in CSV or JSON format with advanced formatting options",
            inputSchema: {
              type: "object",
              properties: {
                form_id: {
                  type: "string",
                  description: "Form ID to export entries from"
                },
                format: {
                  type: "string",
                  enum: ["csv", "json"],
                  description: "Export format"
                },
                search: {
                  type: "object",
                  description: "Search criteria for filtering entries"
                },
                date_format: {
                  type: "string",
                  description: "Date format for exported dates"
                },
                filename: {
                  type: "string", 
                  description: "Custom filename for export"
                },
                include_headers: {
                  type: "boolean",
                  description: "Include headers in CSV export",
                  default: true
                }
              },
              required: ["form_id", "format"]
            }
          },
          {
            name: "process_entries_bulk",
            description: "⚠️  WARNING: DESTRUCTIVE OPERATION ⚠️\n\nPerform bulk operations on multiple entries (delete, update status, update fields). This operation can permanently modify or delete large numbers of entries. ALWAYS confirm operations with 'confirm: true' parameter. Supports up to 100 entries per operation for safety.\n\nOperations:\n- delete: Permanently delete entries (CANNOT be undone)\n- update_status: Change entry status (active, spam, trash)\n- update_fields: Update specific field values\n\nSafety features: confirmation required, operation limits, rollback data for updates, audit trails.",
            inputSchema: {
              type: "object",
              properties: {
                entry_ids: {
                  type: "array",
                  items: { type: "string" },
                  description: "Array of entry IDs to process (max 100)",
                  maxItems: 100
                },
                operation_type: {
                  type: "string",
                  enum: ["delete", "update_status", "update_fields"],
                  description: "Type of bulk operation to perform"
                },
                confirm: {
                  type: "boolean",
                  description: "REQUIRED: Must be true to execute destructive operations"
                },
                data: {
                  type: "object",
                  description: "Data for update operations (required for update_status and update_fields)",
                  properties: {
                    status: {
                      type: "string",
                      enum: ["active", "spam", "trash"],
                      description: "New status for update_status operations"
                    }
                  },
                  additionalProperties: true
                }
              },
              required: ["entry_ids", "operation_type", "confirm"]
            }
          },
          {
            name: "list_form_templates",
            description: "List all available form templates (forms with '-template' suffix). Returns template metadata including name, description, field count, and creation date. Supports optional filtering by search term and sorting by name or creation date.",
            inputSchema: {
              type: "object",
              properties: {
                search_term: {
                  type: "string",
                  description: "Optional search term to filter templates by name or description"
                },
                sort_by: {
                  type: "string",
                  enum: ["name", "date"],
                  description: "Sort templates by name or creation date",
                  default: "name"
                },
                sort_order: {
                  type: "string",
                  enum: ["asc", "desc"],
                  description: "Sort order: ascending or descending",
                  default: "asc"
                }
              }
            }
          }
        ]
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "get_forms":
            return await this.getForms(args);
          
          case "get_entries":
            return await this.getEntries(args);
          
          case "submit_form":
            return await this.submitForm(args);
          
          case "create_entry":
            return await this.createEntry(args);
          
          case "update_entry":
            return await this.updateEntry(args);
          
          case "delete_entry":
            return await this.deleteEntry(args);
          
          case "create_form":
            return await this.createForm(args);
          
          case "validate_form":
            return await this.validateForm(args);
          
          case "export_entries_formatted":
            return await this.exportEntriesFormatted(args);
          
          case "process_entries_bulk":
            return await this.processEntriesBulk(args);
          
          case "list_form_templates":
            return await this.listFormTemplates(args);
          
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });
  }

  // Tool implementation methods
  private async getForms(args: any) {
    const { form_id, include_fields } = args;
    
    if (form_id) {
      const endpoint = `/forms/${form_id}`;
      const form = await this.makeRequest(endpoint);
      return {
        content: [
          {
            type: "text",
            text: `Form Details:\n${JSON.stringify(form, null, 2)}`
          }
        ]
      };
    } else {
      const endpoint = include_fields ? '/forms?include[]=form_fields' : '/forms';
      const forms = await this.makeRequest(endpoint);
      return {
        content: [
          {
            type: "text",
            text: `Forms:\n${JSON.stringify(forms, null, 2)}`
          }
        ]
      };
    }
  }

  private async getEntries(args: any) {
    const { form_id, entry_id, search, sorting, paging } = args;
    
    let endpoint = '';
    const params = new URLSearchParams();

    if (entry_id) {
      endpoint = `/entries/${entry_id}`;
    } else if (form_id) {
      endpoint = `/forms/${form_id}/entries`;
    } else {
      endpoint = '/entries';
    }

    // Add query parameters
    if (search) {
      Object.entries(search).forEach(([key, value]) => {
        params.append(`search[${key}]`, String(value));
      });
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
    
    const entries = await this.makeRequest(fullEndpoint);
    return {
      content: [
        {
          type: "text",
          text: `Entries:\n${JSON.stringify(entries, null, 2)}`
        }
      ]
    };
  }

  private async submitForm(args: any) {
    const { form_id, field_values, source_page = 1, target_page = 0 } = args;
    
    const submission = {
      ...field_values,
      source_page,
      target_page
    };

    const response = await this.makeRequest(`/forms/${form_id}/submissions`, 'POST', submission);
    
    return {
      content: [
        {
          type: "text",
          text: `Form Submission Result:\n${JSON.stringify(response, null, 2)}`
        }
      ]
    };
  }

  private async createEntry(args: any) {
    const { form_id, field_values, entry_meta = {} } = args;
    
    const entry = {
      form_id: form_id,
      ...field_values,
      ...entry_meta
    };

    const response = await this.makeRequest('/entries', 'POST', entry);
    
    return {
      content: [
        {
          type: "text",
          text: `Entry Created:\n${JSON.stringify(response, null, 2)}`
        }
      ]
    };
  }

  private async updateEntry(args: any) {
    const { entry_id, field_values } = args;
    
    const response = await this.makeRequest(`/entries/${entry_id}`, 'PUT', field_values);
    
    return {
      content: [
        {
          type: "text",
          text: `Entry Updated:\n${JSON.stringify(response, null, 2)}`
        }
      ]
    };
  }

  private async deleteEntry(args: any) {
    const { entry_id, force = false } = args;
    
    const endpoint = force ? `/entries/${entry_id}?force=true` : `/entries/${entry_id}`;
    const response = await this.makeRequest(endpoint, 'DELETE');
    
    return {
      content: [
        {
          type: "text",
          text: `Entry ${force ? 'Permanently Deleted' : 'Moved to Trash'}:\n${JSON.stringify(response, null, 2)}`
        }
      ]
    };
  }

  private async createForm(args: any) {
    const { title, description, fields = [], settings = {} } = args;
    
    const form = {
      title,
      description,
      fields,
      ...settings
    };

    const response = await this.makeRequest('/forms', 'POST', form);
    
    return {
      content: [
        {
          type: "text",
          text: `Form Created:\n${JSON.stringify(response, null, 2)}`
        }
      ]
    };
  }

  private async validateForm(args: any) {
    const { form_id, field_values } = args;
    
    const response = await this.makeRequest(`/forms/${form_id}/submissions/validation`, 'POST', field_values);
    
    return {
      content: [
        {
          type: "text",
          text: `Validation Result:\n${JSON.stringify(response, null, 2)}`
        }
      ]
    };
  }

  private async exportEntriesFormatted(args: any) {
    // Validate input parameters
    const validationResult = this.validator.validateExportEntriesParams(args);
    if (!validationResult.isValid) {
      throw new McpError(
        ErrorCode.InvalidParams,
        validationResult.errors.join(', ')
      );
    }

    const { form_id, format, search, date_format, filename, include_headers } = args;

    try {
      // Build API endpoint URL
      let endpoint = `/forms/${form_id}/entries`;
      const params = new URLSearchParams();

      // Add search parameters if provided
      if (search) {
        if (search.status) {
          params.append('search[status]', search.status);
        }
        if (search.field_filters && Array.isArray(search.field_filters)) {
          search.field_filters.forEach((filter: any, index: number) => {
            if (filter.key && filter.value) {
              // Sanitize filter values before URL encoding
              const sanitizedKey = String(filter.key).trim();
              const sanitizedValue = String(filter.value).trim();
              
              params.append(`search[field_filters][${index}][key]`, sanitizedKey);
              params.append(`search[field_filters][${index}][value]`, sanitizedValue);
            }
          });
        }
        if (search.date_range) {
          if (search.date_range.start) {
            params.append('search[date_range][start]', search.date_range.start);
          }
          if (search.date_range.end) {
            params.append('search[date_range][end]', search.date_range.end);
          }
        }
      }

      // Append query parameters if any
      const queryString = params.toString();
      if (queryString) {
        endpoint += `?${queryString}`;
      }

      // Fetch entries from Gravity Forms API
      const entries = await this.makeRequest(endpoint);

      // Handle empty results
      if (!Array.isArray(entries) || entries.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No entries found for the specified criteria."
            }
          ]
        };
      }

      // Export using DataExporter
      const exportOptions = {
        dateFormat: date_format,
        includeHeaders: include_headers !== false, // Default to true
        filename: filename
      };

      let exportResult;
      try {
        exportResult = await this.dataExporter.export(entries, format, exportOptions);
      } catch (exportError) {
        throw new McpError(
          ErrorCode.InternalError,
          `Data export failed: ${exportError instanceof Error ? exportError.message : 'Unknown export error'}`
        );
      }

      return {
        content: [
          {
            type: "text",
            text: `Export completed successfully!

Format: ${exportResult.format.toUpperCase()}
Filename: ${exportResult.filename}
Records: ${entries.length}
File size: ${exportResult.data.length} characters

Base64 encoded data for download:
${exportResult.base64Data}`
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

  private getBulkOperationsManager(): BulkOperationsManager {
    if (!this.bulkOperationsManager) {
      this.bulkOperationsManager = new BulkOperationsManager(
        `${this.config.baseUrl}/wp-json/gf/v2`,
        this.getAuthHeaders()
      );
    }
    return this.bulkOperationsManager;
  }

  private async processEntriesBulk(args: any) {
    try {
      // Extract and validate parameters
      const { entry_ids, operation_type, confirm, data } = args;

      // Get BulkOperationsManager (lazy initialization)
      const bulkManager = this.getBulkOperationsManager();

      // Validate using BulkOperationsManager
      const validation = bulkManager.validateOperation({
        entry_ids,
        operation_type,
        confirm,
        data
      });

      if (!validation.isValid) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Validation failed: ${validation.errors.join(', ')}`
        );
      }

      // Execute the bulk operation
      const result = await bulkManager.executeOperation({
        entry_ids,
        operation_type,
        confirm,
        data
      });

      // Format the response
      let responseText = `Bulk operation completed successfully!\n\n`;
      responseText += `Operation: ${result.operation_type.toUpperCase()}\n`;
      responseText += `Total requested: ${result.total_requested}\n`;
      responseText += `Successful: ${result.successful}\n`;
      responseText += `Failed: ${result.failed}\n`;

      if (result.successful > 0) {
        responseText += `\nSuccessful entries: ${result.success_ids.join(', ')}\n`;
      }

      if (result.failed_entries.length > 0) {
        responseText += `\nFailed entries:\n`;
        result.failed_entries.forEach(failure => {
          responseText += `- ${failure.entry_id}: ${failure.error}`;
          if (failure.error_code) {
            responseText += ` (${failure.error_code})`;
          }
          responseText += `\n`;
        });
      }

      if (result.can_rollback && result.rollback_data) {
        responseText += `\n🔄 Rollback available: ${result.rollback_data.original_values.length} entries can be restored using the original data.\n`;
        responseText += `Rollback instructions: ${result.rollback_data.rollback_instructions}\n`;
      }

      if (result.audit_trail) {
        responseText += `\n📋 Audit Trail:\n`;
        responseText += `- Operation ID: ${result.audit_trail.operation_id}\n`;
        responseText += `- Timestamp: ${result.audit_trail.timestamp}\n`;
        responseText += `- Duration: ${result.audit_trail.duration_ms}ms\n`;
        responseText += `- User confirmation: ${result.audit_trail.user_confirmation}\n`;
      }

      responseText += `\n${result.operation_summary}`;

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
      throw new McpError(
        ErrorCode.InternalError,
        `Bulk operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async listFormTemplates(args: any) {
    try {
      // Get TemplateManager (lazy initialization)
      const templateManager = this.getTemplateManager();

      // Get all templates from TemplateManager
      const allTemplates = await templateManager.listTemplates();

      // Extract parameters with defaults
      const { search_term, sort_by = 'name', sort_order = 'asc' } = args;

      // Validate parameters
      if (sort_by && !['name', 'date'].includes(sort_by)) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid sort_by value: ${sort_by}. Must be 'name' or 'date'.`);
      }

      if (sort_order && !['asc', 'desc'].includes(sort_order)) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid sort_order value: ${sort_order}. Must be 'asc' or 'desc'.`);
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

  private getTemplateManager(): TemplateManager {
    if (!this.templateManager) {
      // Create TemplateManager with API call function
      this.templateManager = new TemplateManager((endpoint: string) => this.makeRequest(endpoint));
    }
    return this.templateManager;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Gravity Forms MCP server running on stdio");
  }
}

// Run the server
const server = new GravityFormsMCPServer();
server.run().catch(console.error);