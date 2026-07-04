import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOL_SCHEMAS } from "./utils/toolSchemas.js";
import { DataExporter } from "./utils/dataExporter.js";
import { ValidationHelper } from "./utils/validation.js";
import { BulkOperationsManager } from "./utils/bulkOperations.js";
import { TemplateManager } from "./utils/templateManager.js";
import { FormImporter } from "./utils/formImporter.js";
import { FormCache } from "./utils/formCache.js";
import { FieldTypeDetector } from "./utils/fieldTypeDetector.js";
import { UniversalSearchManager } from "./utils/universalSearchManager.js";
import { SearchResultsFormatter } from "./utils/searchResultsFormatter.js";
import {
  createEntrySummary,
  estimateTokenCount,
} from "./utils/responseSizeManager.js";
import { GravityFormsClient } from "./utils/gravityFormsClient.js";
import {
  createEntry as createEntryHandler,
  deleteEntry as deleteEntryHandler,
  submitForm as submitFormHandler,
  updateEntry as updateEntryHandler,
} from "./utils/entryCrudTools.js";
import {
  createForm as createFormHandler,
  updateForm as updateFormHandler,
} from "./utils/formsTools.js";
import {
  exportEntriesFormatted as exportEntriesFormattedHandler,
  exportFormJson as exportFormJsonHandler,
} from "./utils/exportTools.js";
import { processEntriesBulk as processEntriesBulkHandler } from "./utils/bulkTools.js";
import {
  cloneFormWithModifications as cloneFormWithModificationsHandler,
  createFormFromTemplate as createFormFromTemplateHandler,
  importFormJson as importFormJsonHandler,
  saveFormAsTemplate as saveFormAsTemplateHandler,
} from "./utils/templateTools.js";
import { getFieldMappings as getFieldMappingsHandler } from "./utils/fieldMappingTools.js";
import {
  searchEntriesByName as searchEntriesByNameHandler,
  searchEntriesUniversal as searchEntriesUniversalHandler,
} from "./utils/searchTools.js";
import { getEntries as getEntriesHandler } from "./utils/entriesQueryTools.js";
import type { ICacheConfig, ICacheStatus } from "./utils/cacheTypes.js";
import {
  getCacheStatusTool as getCacheStatusToolHandler,
  getForms as getFormsHandler,
  listFormTemplates as listFormTemplatesHandler,
} from "./utils/cacheTools.js";
import * as fs from 'fs';
import * as path from 'path';

// Configuration interface
interface IGravityFormsConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  authMethod: 'basic' | 'oauth';
}

export class GravityFormsMCPServer {
  private readonly mcpServer: McpServer;
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
    this.mcpServer = new McpServer({
      name: "gravity-forms-mcp",
      version: "1.0.0",
    });
    this.server = this.mcpServer.server;

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
    for (const [name, def] of Object.entries(TOOL_SCHEMAS)) {
      this.mcpServer.registerTool(
        name,
        { description: def.description, inputSchema: def.inputSchema as any },
        async (args: any): Promise<any> => this.dispatchTool(name, args)
      );
    }
  }

  private async dispatchTool(name: string, args: any) {
    switch (name) {
      case "get_forms":
        return this.getForms(args);

      case "get_entries":
        return this.getEntries(args);

      case "submit_form":
        return this.submitForm(args);

      case "create_entry":
        return this.createEntry(args);

      case "update_entry":
        return this.updateEntry(args);

      case "delete_entry":
        return this.deleteEntry(args);

      case "create_form":
        return this.createForm(args);

      case "update_form":
        return this.updateForm(args);

      case "export_entries_formatted":
        return this.exportEntriesFormatted(args);

      case "process_entries_bulk":
        return this.processEntriesBulk(args);

      case "list_form_templates":
        return this.listFormTemplates(args);

      case "save_form_as_template":
        return this.saveFormAsTemplate(args);

      case "create_form_from_template":
        return this.createFormFromTemplate(args);

      case "export_form_json":
        return this.exportFormJson(args);

      case "import_form_json":
        return this.importFormJson(args);

      case "clone_form_with_modifications":
        return this.cloneFormWithModifications(args);

      case "get_cache_status":
        return this.getCacheStatusTool();

      case "search_entries_by_name":
        return this.searchEntriesByName(args);

      case "search_entries_universal":
        return this.searchEntriesUniversal(args);

      case "get_field_mappings":
        return this.getFieldMappings(args);

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  }

  /**
   * Estimate token count for a string (rough approximation: 1 token ≈ 4 characters)
   */
  private estimateTokenCount(text: string | null | undefined): number {
    return estimateTokenCount(text);
  }

  /**
   * Create a summary of a large entry object to prevent context overflow
   */
  private createEntrySummary(entry: any): any {
    return createEntrySummary(entry);
  }

  // Tool implementation methods
  private async getForms(args: any) {
    return getFormsHandler({
      makeRequest: this.makeRequest.bind(this),
      getFormCache: () => this.formCache,
      cacheConfig: this.cacheConfig,
      getTemplateManager: () => this.getTemplateManager(),
    }, args);
  }

  private async getEntries(args: any) {
    return getEntriesHandler({
      makeRequest: this.makeRequest.bind(this),
      fieldTypeDetector: this.fieldTypeDetector,
      searchResultsFormatter: this.searchResultsFormatter,
      getOrCreateSearchManager: () => this.getOrCreateSearchManager(),
    }, args);
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
    return createFormHandler({ makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body) }, args);
  }

  private async updateForm(args: any) {
    return updateFormHandler({ makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body) }, args);
  }

  private async exportEntriesFormatted(args: any) {
    return exportEntriesFormattedHandler({
      makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body),
      validator: this.validator,
      dataExporter: this.dataExporter,
    }, args);
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
    return processEntriesBulkHandler({ getBulkOperationsManager: () => this.getBulkOperationsManager() }, args);
  }

  private async listFormTemplates(args: any) {
    return listFormTemplatesHandler({
      makeRequest: this.makeRequest.bind(this),
      getFormCache: () => this.formCache,
      cacheConfig: this.cacheConfig,
      getTemplateManager: () => this.getTemplateManager(),
    }, args);
  }

  private async saveFormAsTemplate(args: any) {
    return saveFormAsTemplateHandler({
      makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body),
      getTemplateManager: () => this.getTemplateManager(),
      getFormImporter: () => this.getFormImporter(),
    }, args);
  }

  private async createFormFromTemplate(args: any) {
    return createFormFromTemplateHandler({
      makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body),
      getTemplateManager: () => this.getTemplateManager(),
      getFormImporter: () => this.getFormImporter(),
    }, args);
  }

  private async exportFormJson(args: any) {
    return exportFormJsonHandler({
      makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body),
      validator: this.validator,
      dataExporter: this.dataExporter,
    }, args);
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
    return importFormJsonHandler({
      makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body),
      getTemplateManager: () => this.getTemplateManager(),
      getFormImporter: () => this.getFormImporter(),
    }, args);
  }

  private async cloneFormWithModifications(args: any) {
    return cloneFormWithModificationsHandler({
      makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body),
      getTemplateManager: () => this.getTemplateManager(),
      getFormImporter: () => this.getFormImporter(),
    }, args);
  }

  /**
   * Get cache status tool implementation
   */
  private async getCacheStatusTool() {
    return getCacheStatusToolHandler({ getCacheStatus: () => this.getCacheStatus() });
  }

  /**
   * Search entries by name using universal search capabilities
   */
  private async searchEntriesByName(args: any) {
    return searchEntriesByNameHandler({
      makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body),
      fieldTypeDetector: this.fieldTypeDetector,
      searchResultsFormatter: this.searchResultsFormatter,
      getUniversalSearchManager: () => this.getUniversalSearchManager(),
    }, args);
  }

  /**
   * Advanced multi-field search with custom targeting and strategies
   */
  private async searchEntriesUniversal(args: any) {
    return searchEntriesUniversalHandler({
      makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body),
      fieldTypeDetector: this.fieldTypeDetector,
      searchResultsFormatter: this.searchResultsFormatter,
      getUniversalSearchManager: () => this.getUniversalSearchManager(),
    }, args);
  }

  /**
   * Get field mappings and analysis for form structure debugging
   */
  private async getFieldMappings(args: any) {
    return getFieldMappingsHandler({
      makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body),
      fieldTypeDetector: this.fieldTypeDetector,
    }, args);
  }

  /**
   * Public method to call tools (for testing)
   */
  async callTool(request: any) {
    const { name, arguments: args } = request.params;
    try {
      const result = await this.dispatchTool(name, args);
      return {
        isError: false,
        ...result
      };
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