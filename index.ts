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
import type { FieldTypeInfo } from "./utils/fieldTypeDetector.js";
import type { SearchStrategy } from "./utils/universalSearchManager.js";
import { UniversalSearchManager } from "./utils/universalSearchManager.js";
import type { SearchResult as FormattedSearchResult, FormInfo, OutputMode } from "./utils/searchResultsFormatter.js";
import { SearchResultsFormatter } from "./utils/searchResultsFormatter.js";
import { TemplateCreator } from "./utils/templateCreator.js";
import {
  createEntrySummary,
  createFormSummary,
  estimateEntriesResponseSize,
  estimateTokenCount,
} from "./utils/responseSizeManager.js";
import { GravityFormsClient } from "./utils/gravityFormsClient.js";
import {
  createEntry as createEntryHandler,
  deleteEntry as deleteEntryHandler,
  submitForm as submitFormHandler,
  updateEntry as updateEntryHandler,
} from "./utils/entryCrudTools.js";
import * as fs from 'fs';
import * as path from 'path';

// Configuration interface
interface IGravityFormsConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  authMethod: 'basic' | 'oauth';
}

// Cache configuration interface  
interface ICacheConfig {
  enabled: boolean;
  dbPath: string;
  maxAgeSeconds: number;
  maxProbeFailures: number;
  autoSync: boolean;
  fullSyncIntervalHours: number;
}

// Cache status interface
interface ICacheStatus {
  enabled: boolean;
  ready: boolean;
  dbPath: string;
  totalForms: number;
  activeForms: number;
  lastSync: Date | null;
  config: ICacheConfig;
}

export class GravityFormsMCPServer {
  // Constants for pagination and safety limits
  private static readonly SEARCH_RESULTS_LIMIT = 100; // Limit for search operations
  private static readonly MAX_EXPORT_ENTRIES = 1000; // Safety limit for exports
  
  private readonly server: Server;
  private readonly config: IGravityFormsConfig;
  private readonly gfClient: GravityFormsClient;
  private readonly cacheConfig: ICacheConfig;
  private readonly dataExporter: DataExporter;
  private readonly validator: ValidationHelper;
  private bulkOperationsManager?: BulkOperationsManager;
  private templateManager?: TemplateManager;
  private formImporter?: FormImporter;
  private formCache: FormCache | null = null;
  private readonly fieldTypeDetector: FieldTypeDetector;
  private universalSearchManager?: UniversalSearchManager;
  private readonly searchResultsFormatter: SearchResultsFormatter;

  constructor() {
    this.server = new Server(
      {
        name: "gravity-forms-mcp",
        version: "1.0.0",
      },
      {
        capabilities: { tools: {} },
      }
    );

    // Load configuration from environment variables
    this.config = {
      baseUrl: process.env.GRAVITY_FORMS_BASE_URL ?? '',
      consumerKey: process.env.GRAVITY_FORMS_CONSUMER_KEY ?? '',
      consumerSecret: process.env.GRAVITY_FORMS_CONSUMER_SECRET ?? '',
      authMethod: (process.env.GRAVITY_FORMS_AUTH_METHOD as 'basic' | 'oauth') ?? 'basic'
    };

    this.gfClient = new GravityFormsClient({
      baseUrl: this.config.baseUrl,
      consumerKey: this.config.consumerKey,
      consumerSecret: this.config.consumerSecret,
      authMethod: this.config.authMethod
    });

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
    // formCache is initialized to null in the field declaration; startup() will set it if caching is enabled

    this.setupToolHandlers();
  }

  /**
   * Load cache configuration from environment variables with defaults
   */
  private loadCacheConfig(): ICacheConfig {
    const enabled = this.parseBooleanEnv('GRAVITY_FORMS_CACHE_ENABLED', true);
    const dbPath = process.env.GRAVITY_FORMS_CACHE_DB_PATH ?? './data/forms-cache.db';
    const maxAgeSeconds = this.parseIntEnv('GRAVITY_FORMS_CACHE_MAX_AGE_SECONDS', 3600, 60, 86400);
    const maxProbeFailures = this.parseIntEnv('GRAVITY_FORMS_CACHE_MAX_PROBE_FAILURES', 10, 1, 50);
    const autoSync = this.parseBooleanEnv('GRAVITY_FORMS_CACHE_AUTO_SYNC', true);
    const fullSyncIntervalHours = this.parseIntEnv('GRAVITY_FORMS_FULL_SYNC_INTERVAL_HOURS', 24, 1, 168);

    return {
      enabled,
      dbPath: dbPath && dbPath.trim() !== '' ? dbPath : './data/forms-cache.db', // Fallback for empty/whitespace
      maxAgeSeconds,
      maxProbeFailures,
      autoSync,
      fullSyncIntervalHours
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
  private getCacheConfig(): ICacheConfig {
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
    this.validateConfig();
    await this.initializeCache();
  }

  /**
   * Validate that required environment variables are set.
   * Logs warnings to stderr rather than throwing to allow Claude Desktop to surface the error.
   */
  private validateConfig(): void {
    const missing: string[] = [];
    if (!this.config.baseUrl) missing.push('GRAVITY_FORMS_BASE_URL');
    if (!this.config.consumerKey) missing.push('GRAVITY_FORMS_CONSUMER_KEY');
    if (!this.config.consumerSecret) missing.push('GRAVITY_FORMS_CONSUMER_SECRET');
    if (missing.length > 0) {
      console.error(`[FATAL] Missing required environment variables: ${missing.join(', ')}`);
      console.error('[FATAL] Server will start but all API calls will fail. Set these variables and restart.');
    }
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
  private async getCacheStatus(): Promise<ICacheStatus> {
    // Cache is enabled if configured AND actually initialized
    const actuallyEnabled = this.cacheConfig.enabled && this.formCache !== null;
    
    const baseStatus: ICacheStatus = {
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
    return this.gfClient.getAuthHeaders();
  }

  private async makeRequest(endpoint: string, method = 'GET', body?: any): Promise<any> {
    return this.gfClient.makeRequest(endpoint, method, body);
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
                exclude_trash: {
                  type: "boolean",
                  description: "When used with include_all=true, exclude forms marked as trash from results.",
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
                  description: "Search criteria for filtering entries. Example: { \"field_filters\": [{ \"key\": \"1\", \"value\": \"Smith\", \"operator\": \"contains\" }], \"status\": \"active\" }. Operators: is, isnot, contains, >, <, >=, <="
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
                },
                search_mode: {
                  type: "string",
                  enum: ["standard", "universal"],
                  description: "Search strategy: 'standard' for traditional field-specific search, 'universal' for intelligent multi-field search with auto-detection (default: standard)"
                },
                field_detection: {
                  type: "boolean",
                  description: "Enable automatic field type detection for better search targeting (default: false)"
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
            name: "update_form",
            description: "Update an existing form",
            inputSchema: {
              type: "object",
              properties: {
                form_id: {
                  type: "string",
                  description: "ID of the form to update"
                },
                title: {
                  type: "string",
                  description: "Updated form title"
                },
                fields: {
                  type: "array",
                  description: "Updated array of field objects"
                },
                description: {
                  type: "string",
                  description: "Updated form description"
                },
                settings: {
                  type: "object",
                  description: "Updated form settings"
                },
                confirmations: {
                  type: "object",
                  description: "Form confirmations"
                },
                notifications: {
                  type: "object",
                  description: "Form notifications"
                },
                partial_update: {
                  type: "boolean",
                  description: "Enable partial updates (only update provided fields). IMPORTANT: When false (default), both title and fields are required — missing fields will be removed from the form. Set to true to safely update individual properties without affecting others."
                },
                validate_fields: {
                  type: "boolean",
                  description: "Validate field types before updating"
                },
                response_format: {
                  type: "string",
                  enum: ["detailed", "compact", "minimal"],
                  description: "Response format (detailed, compact, or minimal)"
                },
                debug: {
                  type: "boolean",
                  description: "Enable debug logging for troubleshooting"
                }
              },
              required: ["form_id"]
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
                  description: "Search criteria for filtering entries. Supports multiple date filtering formats for LLM convenience.",
                  properties: {
                    field_filters: {
                      type: "array",
                      description: "Filter entries by field values"
                    },
                    status: {
                      type: "string",
                      description: "Filter by entry status (active, spam, trash)"
                    },
                    date_range: {
                      type: "object",
                      description: "Date range filter (preferred format)",
                      properties: {
                        start: { type: "string", description: "Start date (YYYY-MM-DD)" },
                        end: { type: "string", description: "End date (YYYY-MM-DD)" }
                      }
                    },
                    start_date: {
                      type: "string",
                      description: "Start date for filtering (LLM-friendly format, YYYY-MM-DD)"
                    },
                    end_date: {
                      type: "string",
                      description: "End date for filtering (LLM-friendly format, YYYY-MM-DD)"
                    }
                  }
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
                },
                save_to_disk: {
                  type: "boolean",
                  description: "Save the exported file to disk",
                  default: false
                },
                output_path: {
                  type: "string",
                  description: "Custom file path for saving (optional, auto-generated if not provided)"
                },
                skip_base64: {
                  type: "boolean",
                  description: "Skip base64 encoding to reduce response size (useful for large exports)",
                  default: false
                },
                field_ids: {
                  type: "array",
                  description: "Array of Gravity Forms field IDs to include in export (optional). Use string format: [\"1\", \"2\", \"4.3\"]. If provided, only these fields plus metadata will be exported. Use get_field_mappings to discover field IDs.",
                  items: {
                    type: "string"
                  }
                },
                paging: {
                  type: "object",
                  description: "Pagination settings",
                  properties: {
                    page_size: { type: "number", description: "Number of entries per page (max 1000)" },
                    current_page: { type: "number", description: "Page number to retrieve" }
                  }
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
          },
          {
            name: "search_entries_universal",
            description: "Advanced multi-field search across name, email, phone, and custom fields with AND/OR logic. Use this for cross-field searches (e.g., name AND email), specific field ID targeting, or when search_entries_by_name is too limited. Use get_field_mappings first to discover field IDs for targeted searches.",
            inputSchema: {
              type: "object",
              properties: {
                form_id: {
                  type: "string",
                  description: "Form ID to search entries in"
                },
                search_queries: {
                  type: "array",
                  description: "Array of search queries with targeting options",
                  items: {
                    type: "object",
                    properties: {
                      text: {
                        type: "string",
                        description: "Search text for this query"
                      },
                      field_types: {
                        type: "array",
                        description: "Field types to target (name, email, phone, team)",
                        items: { type: "string" }
                      },
                      field_ids: {
                        type: "array", 
                        description: "Specific field IDs to target (overrides field_types)",
                        items: { type: "string" }
                      }
                    },
                    required: ["text"]
                  }
                },
                logic: {
                  type: "string",
                  enum: ["AND", "OR"],
                  description: "Logic operator between queries",
                  default: "OR"
                },
                strategy: {
                  type: "string",
                  enum: ["exact", "contains", "fuzzy", "auto"],
                  description: "Search strategy to apply to all queries",
                  default: "auto"
                },
                filters: {
                  type: "object",
                  description: "Additional filtering options",
                  properties: {
                    date_range: {
                      type: "object",
                      properties: {
                        start: { type: "string" },
                        end: { type: "string" }
                      }
                    },
                    payment_status: {
                      type: "string",
                      enum: ["Paid", "Unpaid", "Processing", "Cancelled"]
                    }
                  }
                },
                output_options: {
                  type: "object",
                  description: "Output formatting controls",
                  properties: {
                    mode: {
                      type: "string",
                      enum: ["detailed", "summary", "minimal", "auto"],
                      default: "auto"
                    },
                    max_results: {
                      type: "number",
                      description: "Maximum results to return",
                      default: 50
                    },
                    include_field_mappings: {
                      type: "boolean",
                      description: "Include field mapping information",
                      default: false
                    }
                  }
                }
              },
              required: ["form_id", "search_queries"]
            }
          },
          {
            name: "get_field_mappings",
            description: "Analyze a form's field structure and detect field types (name, email, phone, address). Call this before search_entries_universal to discover which field IDs to target for accurate search results.",
            inputSchema: {
              type: "object",
              properties: {
                form_id: {
                  type: "string",
                  description: "Form ID to analyze field structure for"
                },
                include_details: {
                  type: "boolean",
                  description: "Include detailed field analysis information",
                  default: false
                },
                refresh_cache: {
                  type: "boolean", 
                  description: "Force refresh of cached field mappings",
                  default: false
                }
              },
              required: ["form_id"]
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
          
          case "update_form":
            return await this.updateForm(args);
          
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
          
          case "search_entries_universal":
            return await this.searchEntriesUniversal(args);
          
          case "get_field_mappings":
            return await this.getFieldMappings(args);
          
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
    return estimateTokenCount(text);
  }

  /**
   * Efficiently estimate response size without full JSON generation
   */
  private estimateEntriesResponseSize(entries: any[]): number {
    return estimateEntriesResponseSize(entries);
  }

  /**
   * Create a summary of a large entry object to prevent context overflow
   */
  private createEntrySummary(entry: any): any {
    return createEntrySummary(entry);
  }

  /**
   * Create a summary of a large form object to prevent context overflow
   */
  private createFormSummary(form: any): string {
    return createFormSummary(form);
  }

  // Tool implementation methods
  private async getForms(args: any) {
    const { form_id, include_fields, include_all, exclude_trash, summary_mode } = args;
    
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
        if (await this.formCache.isStale(this.cacheConfig.maxAgeSeconds * 1000)) {
          await this.formCache.performHybridSync(
            this.makeRequest.bind(this), 
            this.cacheConfig.fullSyncIntervalHours,
            this.cacheConfig.maxAgeSeconds * 1000
          );
        }
        
        // Get all forms from cache
        const allForms = await this.formCache.getAllForms(false, exclude_trash);
        
        // Transform cached form data to match API format
        const formsData = allForms.map(form => {
          const baseForm = {
            id: form.id.toString(),
            title: form.title,
            entry_count: form.entry_count,
            is_active: form.is_active ? '1' : '0',
            is_trash: form.is_trash ? '1' : '0'
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
    const forms = await this.makeRequest(endpoint);
    
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

  private async getEntries(args: any) {
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
        return await this.handleUniversalSearch(form_id, search, response_mode, field_detection);
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
    
    const response = await this.makeRequest(fullEndpoint);
    
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

  /**
   * Get or create the UniversalSearchManager singleton with its API client adapter.
   */
  private getOrCreateSearchManager(): UniversalSearchManager {
    if (!this.universalSearchManager) {
      const apiClient = {
        getFormDefinition: async (formId: string) => {
          try {
            return await this.makeRequest(`/forms/${formId}`);
          } catch (error) {
            throw new Error(`Failed to fetch form definition for form ${formId}: ${error}`);
          }
        },
        searchEntries: async (formId: string, searchParams: any) => {
          try {
            const params = new URLSearchParams();
            params.append('paging[page_size]', '100');
            if (searchParams) {
              params.append('search', JSON.stringify(searchParams));
            }
            const endpoint = `/forms/${formId}/entries?${params.toString()}`;
            const response = await this.makeRequest(endpoint);
            return response?.entries || response || [];
          } catch (error) {
            throw new Error(`Failed to search entries in form ${formId}: ${error}`);
          }
        }
      };
      this.universalSearchManager = new UniversalSearchManager(this.fieldTypeDetector, apiClient);
    }
    return this.universalSearchManager;
  }

  /**
   * Get UniversalSearchManager instance (lazy initialization).
   * Delegates to getOrCreateSearchManager() so every caller shares the same
   * memoized singleton with the correctly JSON-encoded search request.
   */
  private getUniversalSearchManager(): UniversalSearchManager {
    return this.getOrCreateSearchManager();
  }

  private async handleUniversalSearch(form_id: string, search: any, response_mode: string, field_detection: boolean) {
    try {
      const searchManager = this.getOrCreateSearchManager();

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
      const formData = await this.makeRequest(`/forms/${form_id}`);
      let fieldMapping: Record<string, FieldTypeInfo> = {};
      try {
        fieldMapping = this.fieldTypeDetector.analyzeFormFields(formData);
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

      const formattedResult = this.searchResultsFormatter.formatSearchResults(
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

  private async submitForm(args: any) {
    return submitFormHandler({ makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body) }, args);
  }

  private async createEntry(args: any) {
    return createEntryHandler({ makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body) }, args);
  }

  private async updateEntry(args: any) {
    return updateEntryHandler({ makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body) }, args);
  }

  private async deleteEntry(args: any) {
    return deleteEntryHandler({ makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body) }, args);
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

  private async updateForm(args: any) {
    const { 
      form_id, 
      title, 
      fields, 
      description, 
      settings, 
      confirmations,
      notifications,
      partial_update = false,
      validate_fields = false,
      response_format = 'detailed',
      debug = false,
      ...rest 
    } = args;
    
    // Start timing for debug
    const startTime = debug ? Date.now() : 0;
    
    if (debug) {
      console.error('[UPDATE_FORM_DEBUG] Starting form update');
      console.error(`[UPDATE_FORM_DEBUG] form_id: ${form_id}`);
      console.error(`[UPDATE_FORM_DEBUG] partial_update: ${partial_update}`);
      console.error(`[UPDATE_FORM_DEBUG] validate_fields: ${validate_fields}`);
      console.error(`[UPDATE_FORM_DEBUG] response_format: ${response_format}`);
    }
    
    // Validate form_id (always required)
    if (form_id === undefined || form_id === null) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'form_id is required'
      );
    }
    
    if (typeof form_id !== 'string') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'form_id must be a string'
      );
    }
    
    if (form_id.trim() === '') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'form_id must be a non-empty string'
      );
    }
    
    let existingForm = null;
    let finalTitle = title;
    let finalFields = fields;
    let finalDescription = description;
    let finalSettings = settings;
    let finalConfirmations = confirmations;
    let finalNotifications = notifications;
    
    // If partial update, retrieve existing form data
    if (partial_update) {
      if (debug) {
        console.error('[UPDATE_FORM_DEBUG] Retrieving existing form for partial update');
      }
      
      existingForm = await this.makeRequest(`/forms/${form_id}`, 'GET');
      
      // Use existing values if not provided
      finalTitle = title || existingForm.title;
      
      // Field merging logic for partial updates
      if (fields && partial_update) {
        // Create a map of updated fields by ID
        const fieldUpdates = new Map();
        fields.forEach((field: Record<string, unknown>) => {
          // Only process fields with valid IDs (non-null, non-empty, non-zero)
          if (field != null && this.isValidFieldId(field.id)) {
            fieldUpdates.set(String(field.id), field);
          }
        });
        
        // Merge with existing fields
        finalFields = existingForm.fields.map((existingField: Record<string, unknown>) => {
          const fieldId = existingField.id != null ? String(existingField.id) : null;
          if (fieldId && fieldUpdates.has(fieldId)) {
            const updates = fieldUpdates.get(fieldId);
            const updatedField = this.mergeFieldProperties(existingField, updates);
            fieldUpdates.delete(fieldId); // Mark as processed
            return updatedField;
          }
          return existingField;
        });
        
        // Add any new fields that weren't in the existing form
        fieldUpdates.forEach(newField => {
          finalFields.push(newField);
        });
        
        // Sort by field ID to maintain consistent order
        finalFields.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
          const idA = a.id != null ? Number(a.id) : 0;
          const idB = b.id != null ? Number(b.id) : 0;
          
          // Handle NaN cases safely - invalid IDs go to end
          if (isNaN(idA) && isNaN(idB)) return 0;
          if (isNaN(idA)) return 1;
          if (isNaN(idB)) return -1;
          
          return idA - idB;
        });
      } else {
        finalFields = fields || existingForm.fields;
      }
      
      finalDescription = description !== undefined ? description : existingForm.description;
      finalSettings = settings || existingForm.settings;
      finalConfirmations = confirmations || existingForm.confirmations;
      finalNotifications = notifications || existingForm.notifications;
    } else {
      // For full updates, validate required fields
      if (title === undefined || title === null) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'title is required'
        );
      }
      
      if (typeof title !== 'string') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'title must be a string'
        );
      }
      
      if (title.trim() === '') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'title must be a non-empty string'
        );
      }
      
      if (fields === undefined || fields === null) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'fields is required'
        );
      }
      
      if (!Array.isArray(fields)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'fields must be an array'
        );
      }
    }
    
    // Validate field types if requested
    if (validate_fields && finalFields) {
      // Common Gravity Forms field types - more comprehensive list
      const validFieldTypes = [
        'text', 'textarea', 'select', 'multiselect', 'number', 'checkbox', 
        'radio', 'hidden', 'html', 'section', 'page', 'date', 'time', 'phone', 
        'website', 'email', 'fileupload', 'captcha', 'list', 'password', 'name',
        'address', 'post_title', 'post_content', 'post_excerpt', 'post_tags',
        'post_category', 'post_image', 'product', 'quantity', 'shipping', 'total',
        'option', 'donation', 'creditcard', 'consent', 'signature', 'survey',
        'poll', 'quiz', 'rating', 'likert', 'rank', 'repeater', 'calculation'
      ];
      
      for (const field of finalFields) {
        if (field.type && !validFieldTypes.includes(field.type)) {
          if (debug) {
            console.error(`[UPDATE_FORM_DEBUG] Warning: Unknown field type '${field.type}' - this may be a custom field type`);
          }
          // For now, just warn but don't fail - custom field types are possible
          // throw new McpError(
          //   ErrorCode.InvalidParams,
          //   `Invalid field type: ${field.type}. Supported types: ${validFieldTypes.join(', ')}`
          // );
        }
      }
      
      if (debug) {
        console.error(`[UPDATE_FORM_DEBUG] Field validation passed for ${finalFields.length} fields`);
      }
    }

    // Build the request body
    const formUpdateData = {
      title: finalTitle,
      fields: finalFields,
      ...(finalDescription !== undefined && { description: finalDescription }),
      ...(finalConfirmations && { confirmations: finalConfirmations }),
      ...(finalNotifications && { notifications: finalNotifications }),
      ...rest
    };
    
    // Apply settings carefully to avoid conflicts
    if (finalSettings) {
      Object.assign(formUpdateData, finalSettings);
    }
    
    if (debug) {
      console.error(`[UPDATE_FORM_DEBUG] Request body size: ${JSON.stringify(formUpdateData).length} characters`);
    }
    
    // Make the PUT request to update the form
    const response = await this.makeRequest(`/forms/${form_id}`, 'PUT', formUpdateData);
    
    if (debug) {
      const endTime = Date.now();
      console.error(`[UPDATE_FORM_DEBUG] Update completed in ${endTime - startTime}ms`);
    }
    
    // Format response based on requested format
    let responseText: string;
    
    switch (response_format) {
      case 'minimal':
        responseText = `Form ${response.id} updated successfully`;
        break;
      
      case 'compact':
        responseText = `Form updated successfully\nID: ${response.id}\nTitle: ${response.title}`;
        if (response.description) {
          responseText += `\nDescription: ${response.description}`;
        }
        if (response.fields && response.fields.length > 0) {
          responseText += `\nFields: ${response.fields.length} field(s)`;
        }
        break;
      
      case 'detailed':
      default:
        responseText = `Successfully updated form:\n${JSON.stringify(response, null, 2)}`;
        break;
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

  /**
   * Validates if a field ID is valid for partial updates
   * Gravity Forms field IDs should be positive integers or numeric strings
   */
  private isValidFieldId(id: unknown): boolean {
    // Reject null, undefined, empty string, zero, and non-numeric values
    if (id == null || id === '' || id === 0) {
      return false;
    }
    
    // Accept positive numbers and numeric strings within reasonable bounds
    const numericId = Number(id);
    return !isNaN(numericId) && 
           numericId > 0 && 
           numericId <= 999999 && // Reasonable upper bound for Gravity Forms field IDs
           Number.isInteger(numericId); // Must be whole numbers
  }

  /**
   * Deep merge field properties for partial updates
   */
  private mergeFieldProperties(existing: Record<string, unknown>, updates: Record<string, unknown>): Record<string, unknown> {
    // Handle choices array specially
    if (Array.isArray(updates.choices) && Array.isArray(existing.choices)) {
      // Ensure both arrays contain objects with consistent typing
      const existingChoices = existing.choices as Array<Record<string, unknown>>;
      const updatesChoices = updates.choices as Array<Record<string, unknown>>;
      
      // Skip validation - handle mixed types during merging
      // This allows for null values and other edge cases in choice arrays
      
      // Handle both existing choices and potential additional choices from updates
      const maxLength = Math.max(existingChoices.length, updatesChoices.length);
      const mergedChoices: unknown[] = [];
      
      for (let index = 0; index < maxLength; index++) {
        const existingChoice = existingChoices[index];
        const updateChoice = updatesChoices[index];
        
        // Handle object merging with proper type checking
        if (existingChoice && typeof existingChoice === 'object' && !Array.isArray(existingChoice) && existingChoice !== null &&
            updateChoice && typeof updateChoice === 'object' && !Array.isArray(updateChoice) && updateChoice !== null) {
          // Merge existing choice with updates
          mergedChoices.push({ ...(existingChoice), ...(updateChoice) });
        } else if (existingChoice !== undefined) {
          // Keep existing choice unchanged (including null values)
          mergedChoices.push(existingChoice);
        } else if (updateChoice !== undefined) {
          // Add new choice from updates (edge case: updates.choices longer than existing)
          mergedChoices.push(updateChoice);
        }
      }
      
      return { ...existing, ...updates, choices: mergedChoices };
    }
    
    // Default shallow merge for other properties
    return { ...existing, ...updates };
  }

  private async validateForm(args: any): Promise<{ content: Array<{ type: string; text: string }> }> {
    throw new McpError(
      ErrorCode.InternalError,
      'validate_form is not currently functional: the Gravity Forms REST API v2 does not provide a validation-only endpoint. Use submit_form to test submissions, or inspect the form fields with get_forms (include_fields=true) to check required fields and validation rules.'
    );
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
      const maxExportEntries = GravityFormsMCPServer.MAX_EXPORT_ENTRIES;
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
      const response = await this.makeRequest(endpoint);
      
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
        exportResult = await this.dataExporter.export(entries, format, exportOptions, form_id);
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
            if (await this.formCache.isStale(this.cacheConfig.maxAgeSeconds * 1000)) {
              await this.formCache.performHybridSync(
                this.makeRequest.bind(this), 
                this.cacheConfig.fullSyncIntervalHours,
                this.cacheConfig.maxAgeSeconds * 1000
              );
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

      if (hasConflict) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Template name '${finalTemplateName}' already exists. Use a different name or rename the existing template first.`
        );
      }

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

      const response = {
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
   * Search entries by name using universal search capabilities
   */
  private async searchEntriesByName(args: any) {
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
      const searchManager = this.getUniversalSearchManager();

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
      const formData = await this.makeRequest(`/forms/${form_id}`);

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
        fieldMapping = this.fieldTypeDetector.analyzeFormFields(formData);
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
      
      const formattedResult = this.searchResultsFormatter.formatSearchResults(
        transformedResult,
        outputMode,
        formInfo
      );

      // Add pagination warning if results may be truncated
      let responseText = formattedResult.content;
      const searchLimit = GravityFormsMCPServer.SEARCH_RESULTS_LIMIT;
      
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
  private async searchEntriesUniversal(args: any) {
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
      const searchManager = this.getUniversalSearchManager();

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
      const formData = await this.makeRequest(`/forms/${form_id}`);
      
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
        fieldMapping = this.fieldTypeDetector.analyzeFormFields(formData);
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

      const formattedResult = this.searchResultsFormatter.formatSearchResults(
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
      const searchLimit = GravityFormsMCPServer.SEARCH_RESULTS_LIMIT;
      
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

  /**
   * Get field mappings and analysis for form structure debugging
   */
  private async getFieldMappings(args: any) {
    try {
      // Validate required parameters
      const { form_id, include_details = false, refresh_cache = false } = args;
      
      if (typeof form_id !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'form_id must be a non-empty string');
      }
      
      if (!form_id || form_id.trim() === '') {
        throw new McpError(ErrorCode.InvalidRequest, 'form_id cannot be empty');
      }

      // Validate optional boolean parameters
      if (include_details !== undefined && typeof include_details !== 'boolean') {
        throw new McpError(ErrorCode.InvalidRequest, 'include_details must be a boolean');
      }
      
      if (refresh_cache !== undefined && typeof refresh_cache !== 'boolean') {
        throw new McpError(ErrorCode.InvalidRequest, 'refresh_cache must be a boolean');
      }

      // Get cache reference once to avoid redundant calls
      const fieldMappingCache = this.fieldTypeDetector.getCache();
      
      // Clear cache if requested
      if (refresh_cache && fieldMappingCache) {
        fieldMappingCache.invalidate(form_id);
      }

      // Get form definition
      const formData = await this.makeRequest(`/forms/${form_id}`);
      
      if (!formData?.id) {
        throw new McpError(ErrorCode.InvalidRequest, `Form ${form_id} not found or inaccessible`);
      }

      // Check if data was cached before analysis (for accurate cache status)
      const wasCached = fieldMappingCache ? fieldMappingCache.get(form_id) !== null : false;

      // Analyze form fields (this will use cache if available)
      const analysisResult = this.fieldTypeDetector.analyzeFormFieldsWithStatus(formData);
      const fieldMappings = analysisResult.mapping;
      
      // Get field type counts
      const allFields = Object.values(fieldMappings);
      const nameFields = this.fieldTypeDetector.getFieldsByType(fieldMappings, 'name');
      const emailFields = this.fieldTypeDetector.getFieldsByType(fieldMappings, 'email');
      const phoneFields = this.fieldTypeDetector.getFieldsByType(fieldMappings, 'phone');
      const teamFields = this.fieldTypeDetector.getFieldsByType(fieldMappings, 'team');
      const textFields = this.fieldTypeDetector.getFieldsByType(fieldMappings, 'text');
      
      // Calculate complexity metrics
      const totalFields = allFields.length;
      const highConfidenceFields = allFields.filter(f => f.confidence >= 0.9).length;
      const searchableFields = [...nameFields, ...emailFields, ...teamFields].length;
      
      // Get cache stats
      const cacheStats = fieldMappingCache ? fieldMappingCache.getCacheStats() : null;

      // Build response text
      let responseText = `Field Mappings for Form ${form_id} (${formData.title || 'Untitled Form'}):\n\n`;
      
      // Name fields section
      if (nameFields.length > 0) {
        responseText += 'NAME FIELDS (Recommended for name searches):\n';
        nameFields.forEach(field => {
          responseText += `- Field ${field.fieldId}: "${field.label}" → ${field.fieldType} (confidence: ${field.confidence.toFixed(2)})\n`;
        });
        responseText += '\n';
      }
      
      // Email fields section
      if (emailFields.length > 0) {
        responseText += 'EMAIL FIELDS:\n';
        emailFields.forEach(field => {
          responseText += `- Field ${field.fieldId}: "${field.label}" → ${field.fieldType} (confidence: ${field.confidence.toFixed(2)})\n`;
        });
        responseText += '\n';
      }
      
      // Phone fields section
      if (phoneFields.length > 0) {
        responseText += 'PHONE FIELDS:\n';
        phoneFields.forEach(field => {
          responseText += `- Field ${field.fieldId}: "${field.label}" → ${field.fieldType} (confidence: ${field.confidence.toFixed(2)})\n`;
        });
        responseText += '\n';
      }
      
      // Team/group fields section
      if (teamFields.length > 0) {
        responseText += 'TEAM/GROUP FIELDS:\n';
        teamFields.forEach(field => {
          responseText += `- Field ${field.fieldId}: "${field.label}" → ${field.fieldType} (confidence: ${field.confidence.toFixed(2)})\n`;
        });
        responseText += '\n';
      }
      
      // Other text fields (low confidence)
      const otherTextFields = textFields.filter(f => f.confidence < 0.7);
      if (otherTextFields.length > 0) {
        responseText += 'OTHER TEXT FIELDS (Low search relevance):\n';
        otherTextFields.slice(0, 10).forEach(field => { // Limit to prevent overflow
          responseText += `- Field ${field.fieldId}: "${field.label}" → ${field.fieldType} (confidence: ${field.confidence.toFixed(2)})\n`;
        });
        if (otherTextFields.length > 10) {
          responseText += `... and ${otherTextFields.length - 10} more text fields\n`;
        }
        responseText += '\n';
      }
      
      // Form complexity section
      responseText += 'FORM COMPLEXITY:\n';
      responseText += `- Total fields: ${totalFields}\n`;
      responseText += `- High confidence fields: ${highConfidenceFields}\n`;
      responseText += `- Searchable fields: ${searchableFields}\n`;
      responseText += `- Field types detected: ${new Set(allFields.map(f => f.fieldType)).size}\n`;
      
      // Detect conditional logic (simplified check)
      const hasConditionalLogic = formData.fields?.some((field: any) => 
        field && (field.conditionalLogic || field.conditional_logic)
      );
      if (hasConditionalLogic) {
        responseText += '- Conditional logic: Detected\n';
      }
      responseText += '\n';
      
      // Cache status section
      responseText += 'CACHE STATUS:\n';
      if (cacheStats) {
        if (analysisResult.cacheStatus.hit) {
          responseText += `- Status: Cache hit (retrieved from cache)\n`;
        } else if (wasCached && refresh_cache) {
          responseText += `- Status: Cache refreshed (forced refresh requested)\n`;
        } else {
          responseText += `- Status: Fresh analysis (not previously cached)\n`;
        }
        responseText += `- Cache hit rate: ${(cacheStats.hitRate * 100).toFixed(1)}%\n`;
        responseText += `- Total cached forms: ${cacheStats.entryCount}\n`;
      } else {
        responseText += '- Status: No cache available\n';
      }
      
      // Include detailed field information if requested
      if (include_details) {
        responseText += '\nDETAILED FIELD ANALYSIS:\n';
        Object.entries(fieldMappings).forEach(([fieldId, info]) => {
          const field = formData.fields?.find((f: any) => f.id === fieldId);
          responseText += `\nField ${fieldId}:\n`;
          responseText += `  Label: "${info.label}"\n`;
          responseText += `  Detected Type: ${info.fieldType}\n`;
          responseText += `  Confidence: ${info.confidence.toFixed(3)}\n`;
          responseText += `  Form Type: ${field?.type || 'unknown'}\n`;
          if (field?.choices && field.choices.length > 0) {
            responseText += `  Choices: ${field.choices.length} options\n`;
          }
        });
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
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      if (errorMessage.includes('Form not found') || errorMessage.includes('404')) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Form ${args.form_id} not found. Please verify the form ID is correct and accessible.`
        );
      }
      
      throw new McpError(
        ErrorCode.InternalError,
        `Field mapping analysis failed: ${errorMessage}`
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
        },
        {
          name: "search_entries_universal",
          description: "Advanced multi-field search with custom targeting and strategies",
        },
        {
          name: "get_field_mappings",
          description: "Analyze form structure and show detected field types for debugging",
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
        
        case "search_entries_universal":
          const universalResult = await this.searchEntriesUniversal(args);
          return {
            isError: false,
            ...universalResult
          };
        
        case "get_field_mappings":
          const mappingResult = await this.getFieldMappings(args);
          return {
            isError: false,
            ...mappingResult
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
    const transportMode = process.env.MCP_TRANSPORT ?? "stdio";
    if (transportMode === "http") {
      const token = process.env.MCP_AUTH_TOKEN;
      if (!token) {
        throw new Error("MCP_AUTH_TOKEN is required when MCP_TRANSPORT=http");
      }
      const port = Number(process.env.MCP_HTTP_PORT ?? "9807");
      const { startHttpServer } = await import("./utils/httpTransport.js");
      await startHttpServer(this.server, { port, token });
      console.error(`Gravity Forms MCP server listening on http://0.0.0.0:${port}/mcp`);
    } else {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error("Gravity Forms MCP server running on stdio");
    }
  }
}

// Auto-start the server, except under the Jest test runner, which imports this
// module to construct its own server instances and must not spawn a real one.
// (`import.meta` can't be used here — ts-jest compiles to CommonJS.)
if (!process.env.JEST_WORKER_ID) {
  const server = new GravityFormsMCPServer();
  server.run().catch((error) => {
    // Exit non-zero so process managers (systemd/Docker/k8s) detect a failed
    // startup — e.g. HTTP mode with a missing MCP_AUTH_TOKEN rejects here.
    console.error(error);
    process.exit(1);
  });
}