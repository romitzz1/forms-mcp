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
import { FormImporter } from "./utils/formImporter.js";
import { FormCache } from "./utils/formCache.js";
import { FieldTypeDetector } from "./utils/fieldTypeDetector.js";
import { UniversalSearchManager } from "./utils/universalSearchManager.js";
import { SearchResultsFormatter } from "./utils/searchResultsFormatter.js";
import * as fs from 'fs';
import * as path from 'path';

// Configuration interface
interface GravityFormsConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  authMethod: 'basic' | 'oauth';
}

// Cache configuration interface  
interface CacheConfig {
  enabled: boolean;
  dbPath: string;
  maxAgeSeconds: number;
  maxProbeFailures: number;
  autoSync: boolean;
}

// Cache status interface
interface CacheStatus {
  enabled: boolean;
  ready: boolean;
  dbPath: string;
  totalForms: number;
  activeForms: number;
  lastSync: Date | null;
  config: CacheConfig;
}

export class GravityFormsMCPServer {
  private server: Server;
  private config: GravityFormsConfig;
  private cacheConfig: CacheConfig;
  private dataExporter: DataExporter;
  private validator: ValidationHelper;
  private bulkOperationsManager?: BulkOperationsManager;
  private templateManager?: TemplateManager;
  private formImporter?: FormImporter;
  private formCache?: FormCache | null;
  private fieldTypeDetector: FieldTypeDetector;
  private universalSearchManager?: UniversalSearchManager;
  private searchResultsFormatter: SearchResultsFormatter;

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

    // Load cache configuration
    this.cacheConfig = this.loadCacheConfig();

    // Initialize utility classes
    this.dataExporter = new DataExporter();
    this.validator = new ValidationHelper();
    this.fieldTypeDetector = new FieldTypeDetector();
    this.searchResultsFormatter = new SearchResultsFormatter();
    // UniversalSearchManager will be initialized when first needed
    // because it requires an API client interface
    // Note: BulkOperationsManager will be initialized lazily when first needed
    // to avoid auth errors during server startup
    
    // FormCache will be initialized during startup if enabled
    this.formCache = undefined;

    this.setupToolHandlers();
  }

  /**
   * Load cache configuration from environment variables with defaults
   */
  private loadCacheConfig(): CacheConfig {
    const enabled = this.parseBooleanEnv('GRAVITY_FORMS_CACHE_ENABLED', true);
    const dbPath = process.env.GRAVITY_FORMS_CACHE_DB_PATH || './data/forms-cache.db';
    const maxAgeSeconds = this.parseIntEnv('GRAVITY_FORMS_CACHE_MAX_AGE_SECONDS', 3600, 60, 86400);
    const maxProbeFailures = this.parseIntEnv('GRAVITY_FORMS_CACHE_MAX_PROBE_FAILURES', 10, 1, 50);
    const autoSync = this.parseBooleanEnv('GRAVITY_FORMS_CACHE_AUTO_SYNC', true);

    return {
      enabled,
      dbPath: dbPath && dbPath.trim() !== '' ? dbPath : './data/forms-cache.db', // Fallback for empty/whitespace
      maxAgeSeconds,
      maxProbeFailures,
      autoSync
    };
  }

  /**
   * Parse boolean environment variable with fallback
   */
  private parseBooleanEnv(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    
    // For invalid values, return default instead of false
    const lowerValue = value.toLowerCase();
    if (lowerValue === 'true') return true;
    if (lowerValue === 'false') return false;
    
    // Invalid value, return default
    return defaultValue;
  }

  /**
   * Parse integer environment variable with validation and fallback
   */
  private parseIntEnv(key: string, defaultValue: number, min?: number, max?: number): number {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) return defaultValue;
    if (min !== undefined && parsed < min) return defaultValue;
    if (max !== undefined && parsed > max) return defaultValue;
    
    return parsed;
  }

  /**
   * Get current cache configuration
   */
  private getCacheConfig(): CacheConfig {
    return { ...this.cacheConfig };
  }

  /**
   * Initialize FormCache if enabled
   */
  private async initializeCache(): Promise<void> {
    if (!this.cacheConfig.enabled) {
      this.formCache = null;
      return;
    }

    try {
      // Ensure directory exists for database
      const dbDir = path.dirname(this.cacheConfig.dbPath);
      if (!fs.existsSync(dbDir)) {
        try {
          fs.mkdirSync(dbDir, { recursive: true });
        } catch (dirError) {
          throw new Error(`Failed to create cache directory: ${dirError instanceof Error ? dirError.message : 'Unknown error'}`);
        }
      }

      this.formCache = new FormCache(this.cacheConfig.dbPath);
      await this.formCache.init();
    } catch (error) {
      console.error('FormCache initialization failed:', error instanceof Error ? error.message : 'Unknown error');
      this.formCache = null;
    }
  }

  /**
   * Server startup lifecycle method
   */
  private async startup(): Promise<void> {
    await this.initializeCache();
  }

  /**
   * Server shutdown lifecycle method
   */
  private async shutdown(): Promise<void> {
    if (this.formCache && this.formCache !== null) {
      try {
        await this.formCache.close();
      } catch (error) {
        console.error('Error closing FormCache:', error instanceof Error ? error.message : 'Unknown error');
      }
    }
    this.formCache = null;
  }

  /**
   * Get comprehensive cache status for monitoring
   */
  private async getCacheStatus(): Promise<CacheStatus> {
    // Cache is enabled if configured AND actually initialized
    const actuallyEnabled = this.cacheConfig.enabled && this.formCache !== null;
    
    const baseStatus: CacheStatus = {
      enabled: actuallyEnabled,
      ready: false,
      dbPath: this.cacheConfig.dbPath,
      totalForms: 0,
      activeForms: 0,
      lastSync: null,
      config: this.getCacheConfig()
    };

    if (!this.formCache || this.formCache === null) {
      return baseStatus;
    }

    try {
      const ready = this.formCache.isReady();
      baseStatus.ready = ready;

      if (ready) {
        const stats = await this.formCache.getCacheStats();
        
        // Safely extract stats with defaults
        baseStatus.totalForms = stats?.totalForms ?? 0;
        baseStatus.activeForms = stats?.activeCount ?? 0;
        baseStatus.lastSync = stats?.lastSync ?? null;
      }
    } catch (error) {
      // Status retrieval failed, return base status
      console.warn('Failed to get cache status:', error instanceof Error ? error.message : 'Unknown error');
    }

    return baseStatus;
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
                },
                include_all: {
                  type: "boolean",
                  description: "Include all forms (active and inactive) from local cache. If true, performs complete form discovery including hidden/inactive forms.",
                  default: false
                },
                summary_mode: {
                  type: "boolean", 
                  description: "Return only essential form info for large forms to prevent context overflow. Auto-enabled for forms >20k tokens.",
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
                },
                response_mode: {
                  type: "string",
                  enum: ["full", "summary", "auto"],
                  description: "Response format mode: 'full' for complete entries, 'summary' for essential fields only, 'auto' for intelligent size management (default: auto)"
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
                },
                include_all: {
                  type: "boolean",
                  description: "Include inactive/trashed templates by using local cache. When true, performs complete template discovery including inactive forms. When false (default), uses API-only discovery.",
                  default: false
                }
              }
            }
          },
          {
            name: "save_form_as_template",
            description: "Save an existing form as a reusable template. Clones the form structure while removing form-specific data like entries and notifications. The template can then be used to create new forms with similar structure.",
            inputSchema: {
              type: "object",
              properties: {
                form_id: {
                  type: "string",
                  description: "ID of the form to convert to a template (required)"
                },
                template_name: {
                  type: "string",
                  description: "Name for the template (optional - defaults to form title + '-template')"
                }
              },
              required: ["form_id"]
            }
          },
          {
            name: "create_form_from_template",
            description: "Create a new form from an existing template with optional field customizations. Supports safe field label renames while preserving field types, validation rules, and conditional logic. Dangerous field type changes (e.g., date->phone) are prevented for data integrity.",
            inputSchema: {
              type: "object",
              properties: {
                template_id: {
                  type: "string",
                  description: "ID of the template form to use as the base (required)"
                },
                new_form_title: {
                  type: "string",
                  description: "Title for the new form (required)"
                },
                field_renames: {
                  type: "array",
                  description: "Optional array of field label renames to apply",
                  items: {
                    type: "object",
                    properties: {
                      original_label: {
                        type: "string",
                        description: "Current field label in the template"
                      },
                      new_label: {
                        type: "string",
                        description: "New label to assign to the field"
                      }
                    },
                    required: ["original_label", "new_label"]
                  }
                }
              },
              required: ["template_id", "new_form_title"]
            }
          },
          {
            name: "export_form_json",
            description: "Export a complete form definition as JSON for backup, migration, or import purposes. Removes sensitive data (API keys, private settings) while preserving all form structure, fields, conditional logic, and calculations. Returns formatted JSON suitable for import.",
            inputSchema: {
              type: "object",
              properties: {
                form_id: {
                  type: "string",
                  description: "ID of the form to export (required)"
                }
              },
              required: ["form_id"]
            }
          },
          {
            name: "import_form_json",
            description: "Import a form definition from JSON with automatic conflict resolution. Handles form ID conflicts, validates JSON structure, supports force import to overwrite existing forms. Maps field IDs and updates references (conditional logic, calculations) to maintain form integrity. Supports complete discovery to check conflicts against both active and inactive forms.",
            inputSchema: {
              type: "object",
              properties: {
                form_json: {
                  type: "string",
                  description: "JSON string containing the form definition to import (required)"
                },
                force_import: {
                  type: "boolean",
                  description: "Force import and overwrite existing form with same title (optional, default: false)",
                  default: false
                },
                use_complete_discovery: {
                  type: "boolean",
                  description: "Use complete form discovery including inactive forms for conflict detection (optional, default: false)",
                  default: false
                }
              },
              required: ["form_json"]
            }
          },
          {
            name: "clone_form_with_modifications",
            description: "Clone an existing form with intelligent modifications including title changes and field label updates. Preserves form structure, conditional logic, and calculations while safely applying modifications. Automatically updates field references in formulas and conditional logic.",
            inputSchema: {
              type: "object",
              properties: {
                source_form_id: {
                  type: "string",
                  description: "ID of the form to clone (required)"
                },
                modifications: {
                  type: "object",
                  description: "Modifications to apply to the cloned form (optional)",
                  properties: {
                    title: {
                      type: "string",
                      description: "New title for the cloned form"
                    },
                    field_renames: {
                      type: "array",
                      description: "Array of field label changes",
                      items: {
                        type: "object",
                        properties: {
                          original_label: {
                            type: "string",
                            description: "Current field label to change"
                          },
                          new_label: {
                            type: "string", 
                            description: "New label for the field"
                          }
                        },
                        required: ["original_label", "new_label"]
                      }
                    }
                  }
                }
              },
              required: ["source_form_id"]
            }
          },
          {
            name: "get_cache_status",
            description: "Get comprehensive FormCache status and statistics for monitoring and debugging. Shows cache health, configuration, form counts, and last sync information.",
            inputSchema: {
              type: "object",
              properties: {},
              required: []
            }
          },
          {
            name: "search_entries_by_name",
            description: "Search form entries by name across all name fields automatically",
            inputSchema: {
              type: "object",
              properties: {
                form_id: {
                  type: "string",
                  description: "Form ID to search entries in"
                },
                search_text: {
                  type: "string", 
                  description: "Name text to search for"
                },
                strategy: {
                  type: "string",
                  enum: ["exact", "contains", "fuzzy", "auto"],
                  description: "Search strategy to use",
                  default: "auto"
                },
                max_results: {
                  type: "number",
                  description: "Maximum number of results to return",
                  default: 50
                },
                output_mode: {
                  type: "string",
                  enum: ["detailed", "summary", "minimal", "auto"],
                  description: "Output format mode",
                  default: "auto"
                }
              },
              required: ["form_id", "search_text"]
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
          
          case "save_form_as_template":
            return await this.saveFormAsTemplate(args);
          
          case "create_form_from_template":
            return await this.createFormFromTemplate(args);
          
          case "export_form_json":
            return await this.exportFormJson(args);
          
          case "import_form_json":
            return await this.importFormJson(args);
          
          case "clone_form_with_modifications":
            return await this.cloneFormWithModifications(args);
          
          case "get_cache_status":
            return await this.getCacheStatusTool();
          
          case "search_entries_by_name":
            return await this.searchEntriesByName(args);
          
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

  /**
   * Estimate token count for a string (rough approximation: 1 token ≈ 4 characters)
   */
  private estimateTokenCount(text: string | null | undefined): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Efficiently estimate response size without full JSON generation
   */
  private estimateEntriesResponseSize(entries: any[]): number {
    if (!entries || entries.length === 0) return 0;
    
    // Sample first few entries to estimate average size
    const sampleSize = Math.min(3, entries.length);
    let totalSampleSize = 0;
    
    for (let i = 0; i < sampleSize; i++) {
      try {
        const entryJson = JSON.stringify(entries[i]);
        totalSampleSize += entryJson.length;
      } catch (error) {
        // Fallback: estimate by field count and typical values
        const fieldCount = Object.keys(entries[i] || {}).length;
        totalSampleSize += fieldCount * 50; // Rough average per field
      }
    }
    
    const averageEntrySize = totalSampleSize / sampleSize;
    const estimatedTotalSize = averageEntrySize * entries.length;
    
    // Add overhead for JSON formatting: "Entries:\n" + array brackets + indentation
    const overhead = 50 + (entries.length * 10); // Rough formatting overhead
    
    return Math.ceil((estimatedTotalSize + overhead) / 4); // Convert to tokens
  }

  /**
   * Create a summary of a large entry object to prevent context overflow
   */
  private createEntrySummary(entry: any): any {
    const summary: any = {};
    
    // Essential fields (always included)
    if (entry.id !== undefined) summary.id = entry.id;
    if (entry.form_id !== undefined) summary.form_id = entry.form_id;
    if (entry.date_created !== undefined) summary.date_created = entry.date_created;
    if (entry.payment_status !== undefined) summary.payment_status = entry.payment_status;
    
    // Common name fields - include standalone name fields and common name sub-fields
    // Format: standalone fields (52, 55) + name sub-fields (X.3 = first name, X.6 = last name)
    const nameFields = ['52', '55']; // Most common standalone name fields
    
    // Also check for name sub-fields (field_id.3 for first name, field_id.6 for last name)
    Object.keys(entry).forEach(key => {
      if (key.includes('.') && (key.endsWith('.3') || key.endsWith('.6'))) {
        nameFields.push(key);
      }
    });
    nameFields.forEach(fieldId => {
      if (entry[fieldId] !== undefined) {
        summary[fieldId] = entry[fieldId];
      }
    });
    
    // Common email fields (50, 54)
    const emailFields = ['50', '54'];
    emailFields.forEach(fieldId => {
      if (entry[fieldId] !== undefined) {
        summary[fieldId] = entry[fieldId];
      }
    });
    
    // Include other small text fields if entry is small overall
    let entrySize = 0;
    try {
      const entryJson = JSON.stringify(entry);
      entrySize = entryJson.length;
    } catch (error) {
      // If JSON.stringify fails (circular references, etc.), estimate size by field count
      entrySize = Object.keys(entry).length * 100; // Conservative estimate
    }
    
    if (entrySize < 2000) {
      // Entry is small, include more fields
      Object.keys(entry).forEach(key => {
        if (summary[key] === undefined && entry[key] != null) {
          const fieldValue = String(entry[key]);
          if (fieldValue.length < 200 && fieldValue !== 'undefined') { // Only include short, valid field values
            summary[key] = entry[key];
          }
        }
      });
    }
    
    return summary;
  }

  /**
   * Create a summary of a large form object to prevent context overflow
   */
  private createFormSummary(form: any): string {
    const summary = {
      id: form.id,
      title: form.title,
      description: form.description,
      is_active: form.is_active,
      is_trash: form.is_trash,
      date_created: form.date_created,
      field_count: form.fields ? form.fields.length : 0,
      entry_count: form.entries ? form.entries.length : 0,
      has_conditional_logic: form.fields ? form.fields.some((f: any) => f.conditionalLogic) : false,
      has_calculations: form.fields ? form.fields.some((f: any) => f.calculations) : false,
      notification_count: form.notifications ? Object.keys(form.notifications).length : 0,
      confirmation_count: form.confirmations ? Object.keys(form.confirmations).length : 0
    };

    return `LARGE FORM SUMMARY (${this.estimateTokenCount(JSON.stringify(form, null, 2))} estimated tokens):
${JSON.stringify(summary, null, 2)}

⚠️  This form is too large to display in full (>25k tokens). 
Use specific tools like get_entries or export_form_json for detailed access.
Consider using form templates or cloning for management.`;
  }

  // Tool implementation methods
  private async getForms(args: any) {
    const { form_id, include_fields, include_all, summary_mode } = args;
    
    // When form_id is specified, always use API (ignore include_all)
    if (form_id) {
      const endpoint = `/forms/${form_id}`;
      const form = await this.makeRequest(endpoint);
      
      // Check if summary mode is requested or if form response would be too large
      const fullResponse = JSON.stringify(form, null, 2);
      const tokenEstimate = this.estimateTokenCount(fullResponse);
      
      if (summary_mode || tokenEstimate > 20000) {
        // Return summary for large forms or when explicitly requested
        return {
          content: [
            {
              type: "text", 
              text: this.createFormSummary(form)
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
        if (!this.formCache || this.formCache === null) {
          throw new Error('FormCache not available');
        }
        
        // Initialize cache if not ready
        if (!this.formCache.isReady()) {
          try {
            await this.formCache.init();
          } catch (initError) {
            throw new Error(`Cache init failed: ${initError instanceof Error ? initError.message : 'Unknown error'}`);
          }
        }
        
        // Check if cache is stale and sync if needed
        if (await this.formCache.isStale()) {
          await this.formCache.performIncrementalSync(this.makeRequest.bind(this));
        }
        
        // Get all forms from cache (includes inactive forms)
        const allForms = await this.formCache.getAllForms();
        
        // Transform cached form data to match API format
        const formsData = allForms.map(form => {
          const baseForm = {
            id: form.id.toString(),
            title: form.title,
            entry_count: form.entry_count,
            is_active: form.is_active ? '1' : '0'
          };
          
          // Include full form data when include_fields is true or form_data exists
          if (include_fields && form.form_data) {
            try {
              const parsedData = JSON.parse(form.form_data);
              return { ...baseForm, ...parsedData };
            } catch {
              // If form_data is invalid JSON, just return base form
              return baseForm;
            }
          }
          
          return baseForm;
        });
        
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
          const forms = await this.makeRequest(endpoint);
          
          if (message.includes('not available')) {
            return {
              content: [
                {
                  type: "text",
                  text: `${JSON.stringify(forms, null, 2)}`
                }
              ]
            };
          } else if (message.includes('Cache error')) {
            return {
              content: [
                {
                  type: "text",
                  text: `${JSON.stringify(forms, null, 2)}`
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

  private async getEntries(args: any) {
    const { form_id, entry_id, search, sorting, paging, response_mode = 'auto' } = args;
    
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
          .filter((filter: any) => filter && filter.key != null && filter.value != null)
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
    
    const entries = await this.makeRequest(fullEndpoint);
    
    // Handle empty results
    if (!entries || entries.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No entries found for the specified criteria."
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
      processedEntries = entries.map((entry: any) => this.createEntrySummary(entry));
      wasSummarized = true;
    } else if (response_mode === 'full') {
      // Explicitly requested full mode - use all data
      processedEntries = entries;
    } else { // response_mode === 'auto'
      // Auto mode: efficiently estimate size without full JSON generation
      const estimatedTokens = this.estimateEntriesResponseSize(entries);
      
      if (estimatedTokens > 20000) {
        // Response too large, use summary mode
        processedEntries = entries.map((entry: any) => this.createEntrySummary(entry));
        wasSummarized = true;
      } else {
        // Response size OK, use full mode
        processedEntries = entries;
      }
    }

    // Build final response text
    if (wasSummarized) {
      responseText = `Response summarized to prevent context overflow.\n\n`;
      responseText += `Found ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}:\n\n`;
      responseText += JSON.stringify(processedEntries, null, 2);
    } else {
      responseText = `Entries:\n${JSON.stringify(processedEntries, null, 2)}`;
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

      // Build search parameter as JSON object per Gravity Forms API documentation
      if (search) {
        const searchObject: any = {};
        
        if (search.status) {
          searchObject.status = search.status;
        }
        
        if (search.field_filters && Array.isArray(search.field_filters)) {
          const validFilters = search.field_filters
            .filter((filter: any) => filter && filter.key != null && filter.value != null)
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
        
        // Only add search parameter if we have something to search for
        if (Object.keys(searchObject).length > 0) {
          params.append('search', JSON.stringify(searchObject));
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
      const templateManager = this.getTemplateManager();

      let allTemplates;

      if (include_all === true) {
        // Use cache for complete template discovery
        try {
          // Check if FormCache is available
          if (!this.formCache || this.formCache === null) {
            console.warn('FormCache not available, falling back to API-only template discovery');
            allTemplates = await templateManager.listTemplates();
          } else {
            // Ensure cache is initialized
            if (!this.formCache.isReady()) {
              await this.formCache.init();
            }

            // Check if cache needs sync
            if (await this.formCache.isStale()) {
              await this.formCache.performIncrementalSync(this.makeRequest.bind(this));
            }

            // Get all cached forms
            const cachedForms = await this.formCache.getAllForms();

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

  private async saveFormAsTemplate(args: any) {
    try {
      // Validate required parameters
      const { form_id, template_name } = args;

      if (!form_id) {
        throw new McpError(ErrorCode.InvalidParams, 'form_id is required');
      }

      // Get TemplateManager (lazy initialization)
      const templateManager = this.getTemplateManager();

      // Fetch the source form
      const sourceForm = await this.makeRequest(`/forms/${form_id}`, 'GET');

      if (!sourceForm) {
        throw new McpError(ErrorCode.InvalidParams, `Form with ID ${form_id} not found`);
      }

      // Check if the source form is already a template
      if (templateManager.isTemplate(sourceForm)) {
        throw new McpError(ErrorCode.InvalidParams, `Form with ID ${form_id} is already a template`);
      }

      // Generate template name
      const finalTemplateName = template_name || templateManager.generateTemplateName(sourceForm.title);

      // Check for name conflicts with existing templates
      const existingTemplates = await templateManager.listTemplates();
      const hasConflict = existingTemplates.some(template => template.name === finalTemplateName);

      // Clone and sanitize the form data for template use
      const templateData = this.prepareTemplateData(sourceForm, finalTemplateName);

      // Create the template via API
      const createdTemplate = await this.makeRequest('/forms', 'POST', templateData);

      // Prepare response
      const response: any = {
        success: true,
        template_id: createdTemplate.id,
        template_name: finalTemplateName,
        original_form_id: form_id
      };

      if (hasConflict) {
        response.warnings = [`Template name '${finalTemplateName}' may conflict with existing template`];
      }

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
        `Failed to save form as template: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private prepareTemplateData(sourceForm: any, templateName: string): any {
    // Deep clone the source form to avoid mutation
    const templateData = JSON.parse(JSON.stringify(sourceForm));

    // Remove form-specific properties
    delete templateData.id;
    delete templateData.date_created;
    delete templateData.date_updated;
    delete templateData.entries_count;

    // Clear form-specific data
    templateData.notifications = [];
    templateData.confirmations = [];

    // Set template-specific properties
    templateData.title = templateName;
    templateData.is_template = true;
    templateData.template_metadata = {
      original_form_id: sourceForm.id,
      created_from_form: true,
      created_at: new Date().toISOString()
    };

    return templateData;
  }

  private async createFormFromTemplate(args: any) {
    try {
      // Validate required parameters
      const { template_id, new_form_title, field_renames } = args;

      if (!template_id || typeof template_id !== 'string') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'template_id is required and must be a string'
        );
      }

      if (!new_form_title || typeof new_form_title !== 'string') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'new_form_title is required and must be a string'
        );
      }

      // Validate field_renames if provided
      if (field_renames && (!Array.isArray(field_renames) || 
          field_renames.some((rename: any) => 
            !rename || 
            typeof rename !== 'object' ||
            !rename.original_label || 
            !rename.new_label ||
            typeof rename.original_label !== 'string' ||
            typeof rename.new_label !== 'string'
          ))) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'field_renames must be an array of objects with original_label and new_label string properties'
        );
      }

      // Import TemplateCreator here to avoid circular import
      const { TemplateCreator } = await import('./utils/templateCreator.js');
      
      // Create TemplateCreator with API call function
      const templateCreator = new TemplateCreator((endpoint: string) => this.makeRequest(endpoint));

      // Prepare modifications for TemplateCreator
      const modifications = {
        title: new_form_title,
        field_renames: field_renames || [],
        preserve_logic: true
      };

      // Clone form from template with modifications
      const clonedForm = await templateCreator.cloneFromTemplate(template_id, modifications);

      // Remove template-specific properties to create a regular form
      delete clonedForm.is_template;
      delete clonedForm.template_metadata;

      // Create the new form via API
      const result = await this.makeRequest('/forms', 'POST', clonedForm);

      return {
        success: true,
        message: 'Form created successfully from template',
        form: {
          id: result.id,
          title: result.title,
          fields_count: result.fields ? result.fields.length : 0,
          template_id: template_id,
          applied_renames: field_renames ? field_renames.length : 0
        }
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create form from template: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async exportFormJson(args: any) {
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
      const form = await this.makeRequest(`/forms/${form_id}`);

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
          if (cleanNotification.to && cleanNotification.to.includes('@') && cleanNotification.to !== '{admin_email}') {
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

      return {
        success: true,
        message: 'Form exported successfully as JSON',
        form_id: form_id,
        form_title: exportForm.title || 'Untitled Form',
        export_size: formattedJson.length,
        fields_count: exportForm.fields ? exportForm.fields.length : 0,
        json_data: formattedJson
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

  private getTemplateManager(): TemplateManager {
    if (!this.templateManager) {
      // Create TemplateManager with API call function
      this.templateManager = new TemplateManager((endpoint: string) => this.makeRequest(endpoint));
    }
    return this.templateManager;
  }

  private getFormImporter(): FormImporter {
    if (!this.formImporter) {
      // Create FormImporter with API call function and FormCache (if available)
      const cacheInstance = (this.formCache && this.formCache !== null) ? this.formCache : undefined;
      this.formImporter = new FormImporter(
        (endpoint: string, method?: string, body?: any) => this.makeRequest(endpoint, method, body),
        cacheInstance
      );
    }
    return this.formImporter;
  }

  private async importFormJson(args: any) {
    try {
      // Validate required parameters
      const { form_json, force_import = false, use_complete_discovery = false } = args;

      if (!form_json || typeof form_json !== 'string' || form_json.trim() === '') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'form_json is required and must be a non-empty string'
        );
      }

      if (force_import !== undefined && typeof force_import !== 'boolean') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'force_import must be a boolean value'
        );
      }

      if (typeof use_complete_discovery !== 'boolean') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'use_complete_discovery must be a boolean value'
        );
      }

      // Use FormImporter to perform the import
      const formImporter = this.getFormImporter();
      const result = await formImporter.importForm(form_json, { 
        force_import, 
        useCompleteDiscovery: use_complete_discovery 
      });

      if (!result.success) {
        throw new McpError(
          ErrorCode.InternalError,
          `Form import failed: ${result.errors ? result.errors.join(', ') : 'Unknown error'}`
        );
      }

      return {
        content: [
          {
            type: "text",
            text: `Form Import Results:\n${JSON.stringify(result, null, 2)}`
          }
        ]
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to import form from JSON: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async cloneFormWithModifications(args: any) {
    try {
      // Validate required parameters
      const { source_form_id, modifications = {} } = args;

      if (!source_form_id || typeof source_form_id !== 'string' || source_form_id.trim() === '') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'source_form_id is required and must be a non-empty string'
        );
      }

      if (modifications && typeof modifications !== 'object') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'modifications must be an object'
        );
      }

      // Validate field_renames structure if provided
      if (modifications.field_renames) {
        if (!Array.isArray(modifications.field_renames)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'field_renames must be an array'
          );
        }
        
        for (const rename of modifications.field_renames) {
          if (!rename.original_label || typeof rename.original_label !== 'string') {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Each field rename must have original_label as string'
            );
          }
          if (!rename.new_label || typeof rename.new_label !== 'string') {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Each field rename must have new_label as string'
            );
          }
        }
      }

      // Fetch the source form
      const sourceForm = await this.makeRequest(`/forms/${source_form_id}`);

      if (!sourceForm) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Form with ID ${source_form_id} not found`
        );
      }

      // Create a deep copy of the source form for cloning
      const clonedForm = JSON.parse(JSON.stringify(sourceForm));
      
      // Ensure fields array exists
      if (!clonedForm.fields || !Array.isArray(clonedForm.fields)) {
        clonedForm.fields = [];
      }
      
      // Remove the original ID so a new one will be assigned
      delete clonedForm.id;
      delete clonedForm.date_created;
      delete clonedForm.date_updated;
      delete clonedForm.entries_count;
      delete clonedForm.is_active;
      delete clonedForm.is_trash;

      // Apply title modification
      if (modifications.title) {
        clonedForm.title = modifications.title;
      } else {
        // Default behavior: append " (Copy)" to the title
        clonedForm.title = `${sourceForm.title} (Copy)`;
      }

      // Apply field label modifications and update references
      if (modifications.field_renames && Array.isArray(modifications.field_renames)) {
        const labelMapping: Record<string, string> = {};
        
        // Apply field label changes
        for (const rename of modifications.field_renames) {
          const field = clonedForm.fields.find((f: any) => f.label === rename.original_label);
          if (field) {
            labelMapping[rename.original_label] = rename.new_label;
            field.label = rename.new_label;
            
            // Update placeholder with exact word matching to avoid false positives
            if (field.placeholder) {
              // Use word boundary regex to avoid partial matches
              const labelRegex = new RegExp(`\\b${rename.original_label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
              if (labelRegex.test(field.placeholder)) {
                field.placeholder = field.placeholder.replace(labelRegex, rename.new_label);
              }
            }
          }
        }
        
        // Update calculation formulas that reference renamed fields  
        // Note: Gravity Forms uses {FieldLabel:FieldID} format in formulas
        for (const field of clonedForm.fields) {
          if (field.isCalculation && field.calculationFormula) {
            let updatedFormula = field.calculationFormula;
            for (const [oldLabel, newLabel] of Object.entries(labelMapping)) {
              // Update formula references preserving field IDs
              const labelRegex = new RegExp(`{${oldLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`, 'g');
              updatedFormula = updatedFormula.replace(labelRegex, `{${newLabel}:`);
            }
            field.calculationFormula = updatedFormula;
          }
        }
      }

      // Field modifications are applied - no additional validation needed for now

      // Create the new form
      const createdForm = await this.makeRequest('/forms', 'POST', clonedForm);

      return {
        content: [
          {
            type: "text",
            text: `Form Clone Results:\n${JSON.stringify({
              success: true,
              action: 'cloned',
              source_form_id: source_form_id,
              cloned_form_id: createdForm.id,
              cloned_form_title: clonedForm.title,
              original_title: sourceForm.title,
              fields_count: clonedForm.fields ? clonedForm.fields.length : 0,
              modifications_applied: {
                title_changed: !!modifications.title,
                fields_renamed: modifications.field_renames ? modifications.field_renames.length : 0
              }
            }, null, 2)}`
          }
        ]
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to clone form with modifications: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get cache status tool implementation
   */
  private async getCacheStatusTool() {
    try {
      const status = await this.getCacheStatus();
      
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

  /**
   * Get UniversalSearchManager instance (lazy initialization)
   */
  private getUniversalSearchManager(): UniversalSearchManager {
    if (!this.universalSearchManager) {
      // Create ApiClient interface implementation
      const apiClient = {
        getFormDefinition: async (formId: string) => {
          return await this.makeRequest('GET', `/forms/${formId}`);
        },
        searchEntries: async (formId: string, searchParams: any) => {
          const response = await this.makeRequest('GET', `/forms/${formId}/entries`, searchParams);
          return response.entries || [];
        }
      };
      
      this.universalSearchManager = new UniversalSearchManager(this.fieldTypeDetector, apiClient);
    }
    return this.universalSearchManager;
  }

  /**
   * Search entries by name using universal search capabilities
   */
  private async searchEntriesByName(args: any) {
    try {
      // Validate required parameters
      const { form_id, search_text, strategy, max_results, output_mode } = args;
      
      if (!form_id) {
        throw new McpError(ErrorCode.InvalidRequest, 'form_id is required');
      }
      
      if (!search_text) {
        throw new McpError(ErrorCode.InvalidRequest, 'search_text is required');
      }
      
      if (!search_text.trim()) {
        throw new McpError(ErrorCode.InvalidRequest, 'search_text cannot be empty');
      }

      // Validate optional parameters
      const searchStrategy = strategy || 'auto';
      const maxResults = max_results || 50;
      const outputMode = output_mode || 'auto';

      if (typeof maxResults !== 'number' || maxResults <= 0) {
        throw new McpError(ErrorCode.InvalidRequest, 'max_results must be a positive number');
      }

      // Get UniversalSearchManager instance
      const searchManager = this.getUniversalSearchManager();
      
      // Perform universal name search
      const searchResult = await searchManager.searchByName(
        form_id,
        search_text,
        {
          strategy: searchStrategy as any,
          maxResults: maxResults,
          includeContext: true
        }
      );

      // Get form data for formatting context  
      const formData = await this.makeRequest('GET', `/forms/${form_id}`);

      // Transform UniversalSearchManager result to SearchResultsFormatter format
      const transformedResult = {
        matches: searchResult.matches.map(match => ({
          ...match,
          entryData: { 
            id: match.entryId,
            ...match.matchedFields,
            // Add minimal entry data - in real use, this would come from entry lookup
            form_id: form_id
          }
        })),
        totalFound: searchResult.totalFound,
        searchMetadata: {
          searchText: searchResult.searchMetadata.searchText,
          executionTime: searchResult.searchMetadata.executionTimeMs,
          apiCalls: 1, // Default for now
          fieldsSearched: [`${searchResult.searchMetadata.fieldsSearched} fields`] // Convert number to array
        }
      };

      // Format results with SearchResultsFormatter
      const formattedResult = this.searchResultsFormatter.formatSearchResults(
        transformedResult as any,
        outputMode as any,
        {
          id: formData.id,
          title: formData.title || `Form ${form_id}`,
          fields: formData.fields || []
        }
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
   * Public method to list available tools (for testing)
   */
  listTools() {
    return {
      tools: [
        {
          name: "get_forms",
          description: "Get all forms or specific form details",
        },
        {
          name: "get_entries", 
          description: "Get entries from forms with filtering and pagination",
        },
        {
          name: "submit_form",
          description: "Submit a form with field values",
        },
        {
          name: "create_entry",
          description: "Create a new entry directly (bypasses form validation)",
        },
        {
          name: "update_entry",
          description: "Update an existing entry",
        },
        {
          name: "delete_entry", 
          description: "Delete an entry (moves to trash by default)",
        },
        {
          name: "create_form",
          description: "Create a new form",
        },
        {
          name: "validate_form",
          description: "Validate form submission without saving",
        },
        {
          name: "export_entries_formatted",
          description: "Export entries from a form in CSV or JSON format with advanced formatting options",
        },
        {
          name: "process_entries_bulk",
          description: "Perform bulk operations on multiple entries (delete, update status, update fields)",
        },
        {
          name: "list_form_templates",
          description: "List all available form templates (forms with '-template' suffix)",
        },
        {
          name: "save_form_as_template",
          description: "Save an existing form as a reusable template",
        },
        {
          name: "create_form_from_template",
          description: "Create a new form from an existing template with optional field customizations",
        },
        {
          name: "export_form_json",
          description: "Export a complete form definition as JSON for backup, migration, or import purposes",
        },
        {
          name: "import_form_json", 
          description: "Import a form definition from JSON with automatic conflict resolution",
        },
        {
          name: "clone_form_with_modifications",
          description: "Clone an existing form with intelligent modifications including title changes and field label updates",
        },
        {
          name: "get_cache_status",
          description: "Get comprehensive FormCache status and statistics for monitoring and debugging",
        },
        {
          name: "search_entries_by_name",
          description: "Search form entries by name across all name fields automatically",
        }
      ]
    };
  }

  /**
   * Public method to call tools (for testing)
   */
  async callTool(request: any) {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "search_entries_by_name":
          const result = await this.searchEntriesByName(args);
          return {
            isError: false,
            ...result
          };
        
        default:
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Tool ${name} not implemented in test interface`
              }
            ]
          };
      }
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text", 
            text: error instanceof McpError ? error.message : `Error: ${error}`
          }
        ]
      };
    }
  }

  async run() {
    await this.startup();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Gravity Forms MCP server running on stdio");
  }
}

// Run the server
const server = new GravityFormsMCPServer();
server.run().catch(console.error);