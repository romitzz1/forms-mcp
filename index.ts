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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Gravity Forms MCP server running on stdio");
  }
}

// Run the server
const server = new GravityFormsMCPServer();
server.run().catch(console.error);