import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TOOL_SCHEMAS } from "./utils/toolSchemas.js";
import { DataExporter } from "./utils/dataExporter.js";
import { ValidationHelper } from "./utils/validation.js";
import { BulkOperationsManager } from "./utils/bulkOperations.js";
import { TemplateManager } from "./utils/templateManager.js";
import type { IFormLike } from "./utils/templateManager.js";
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
  getExportLink as getExportLinkHandler,
} from "./utils/exportTools.js";
import type { ExportEntriesFormattedArgs, ExportFormJsonArgs, ExportToolContext, IExportDeliveryConfig, IExportToolResult, IGetExportLinkArgs } from "./utils/exportTools.js";
import { loadExportConfig } from "./utils/exportConfig.js";
import type { IExportConfig } from "./utils/exportConfig.js";
import { deriveLinkKey } from "./utils/exportLinks.js";
import {
  ExportExpiredError,
  ExportNotFoundError,
  ExportStore,
  ExportTooLargeError,
} from "./utils/exportStore.js";
import { processEntriesBulk as processEntriesBulkHandler } from "./utils/bulkTools.js";
import {
  cloneFormWithModifications as cloneFormWithModificationsHandler,
  createFormFromTemplate as createFormFromTemplateHandler,
  importFormJson as importFormJsonHandler,
  saveFormAsTemplate as saveFormAsTemplateHandler,
} from "./utils/templateTools.js";
import type {
  CloneFormWithModificationsArgs,
  CreateFormFromTemplateArgs,
  ImportFormJsonArgs,
  SaveFormAsTemplateArgs,
  TemplateToolResult,
} from "./utils/templateTools.js";
import { getFieldMappings as getFieldMappingsHandler } from "./utils/fieldMappingTools.js";
import {
  searchEntriesByName as searchEntriesByNameHandler,
  searchEntriesUniversal as searchEntriesUniversalHandler,
} from "./utils/searchTools.js";
import { getEntries as getEntriesHandler } from "./utils/entriesQueryTools.js";
import type { GetEntriesArgs, GetEntriesResult } from "./utils/entriesQueryTools.js";
import { aggregateEntries as aggregateEntriesHandler } from "./utils/aggregateEntriesTools.js";
import type { AggregateEntriesArgs, AggregateEntriesResult } from "./utils/aggregateEntriesTools.js";
import type { ICacheConfig, ICacheStatus } from "./utils/cacheTypes.js";
import {
  getCacheStatusTool as getCacheStatusToolHandler,
  getForms as getFormsHandler,
  listFormTemplates as listFormTemplatesHandler,
} from "./utils/cacheTools.js";
import type { ICacheToolResult, IGetFormsArgs, IListFormTemplatesArgs } from "./utils/cacheTools.js";
import { getServerInfoTool as getServerInfoToolHandler } from "./utils/serverInfoTools.js";
import { SERVER_NAME, SERVER_VERSION } from "./utils/version.js";
import type { IGravityEntry, IGravityForm } from "./utils/gravityFormsTypes.js";
import type { IEntrySummary } from "./utils/responseSizeManager.js";
import type { ApiClient as SearchApiClient } from "./utils/universalSearchManager.js";
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Configuration interface
interface IGravityFormsConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  authMethod: 'basic' | 'oauth';
}

// Shape of the JSON-RPC-style request callTool() accepts (mirrors the MCP SDK's
// CallToolRequest params, narrowed to what this method reads).
interface IToolCallRequest {
  params: {
    name: string;
    arguments?: unknown;
  };
}

// callTool()'s test-facing response envelope: either the dispatched tool's own
// result spread onto isError:false, or an isError:true/content error shape.
interface IToolCallResponse {
  isError: boolean;
  [key: string]: unknown;
}

// Largest export body a resources/read will return inline; bigger files go through get_export_link.
const EXPORT_RESOURCE_MAX_BYTES = 256 * 1024;
// MCP 2025-11-25 "resource not found" code; 2026-07-28 clients are told to accept it.
const RESOURCE_NOT_FOUND = -32002;
const EXPORT_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export class GravityFormsMCPServer {
  private readonly mcpServer: McpServer;
  private readonly server: Server;
  private readonly config: IGravityFormsConfig;
  private readonly gfClient: GravityFormsClient;
  private readonly cacheConfig: ICacheConfig;
  private readonly dataExporter: DataExporter;
  private readonly validator: ValidationHelper;
  private readonly exportConfig: IExportConfig;
  private readonly exportStore: ExportStore;
  private readonly linkKey: Buffer | null;
  private exportStoreError: string | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private bulkOperationsManager?: BulkOperationsManager;
  private templateManager?: TemplateManager;
  private formImporter?: FormImporter;
  private formCache: FormCache | null = null;
  private readonly fieldTypeDetector: FieldTypeDetector;
  private universalSearchManager?: UniversalSearchManager;
  private readonly searchResultsFormatter: SearchResultsFormatter;

  constructor() {
    this.mcpServer = new McpServer({
      name: SERVER_NAME,
      version: SERVER_VERSION,
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

    this.exportConfig = loadExportConfig(process.env, os.homedir());
    this.exportStore = new ExportStore({
      dir: this.exportConfig.exportDir,
      retentionDays: this.exportConfig.retentionDays,
    });
    this.linkKey = this.exportConfig.mode === 'http' && this.exportConfig.authToken
      ? deriveLinkKey(this.exportConfig.authToken)
      : null;

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
   * Prepare the export store: create its directories, warn about unmanaged
   * legacy files and missing link configuration, and start the retention sweep.
   * Never throws — export tools report an unwritable directory per call.
   */
  private async initializeExportStore(): Promise<void> {
    for (const warning of this.exportConfig.warnings) {
      console.error(`[WARN] ${warning}`);
    }
    try {
      await this.exportStore.init();
    } catch (error) {
      this.exportStoreError = error instanceof Error ? error.message : String(error);
      console.error(`[WARN] ${this.exportStoreError}; export tools will fail until this is fixed`);
    }
    try {
      const legacy = await this.exportStore.countLegacyFiles();
      if (legacy > 0) {
        console.error(`[WARN] ${legacy} legacy export files in ${this.exportConfig.exportDir} are not managed and will not expire; delete them manually`);
      }
    } catch (error) {
      console.error(`[WARN] could not scan for legacy export files: ${error instanceof Error ? error.message : String(error)}`);
    }
    const sweep = (): void => {
      this.exportStore.sweep().catch((error: unknown) => {
        console.error('[WARN] export sweep failed:', error instanceof Error ? error.message : String(error));
      });
    };
    sweep();
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
    this.sweepTimer = setInterval(sweep, EXPORT_SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  /**
   * Export download wiring for the HTTP transport; undefined when links can't be signed.
   */
  getHttpExportOptions(): { store: ExportStore; linkKey: Buffer } | undefined {
    return this.linkKey ? { store: this.exportStore, linkKey: this.linkKey } : undefined;
  }

  /**
   * Server startup lifecycle method
   */
  private async startup(): Promise<void> {
    this.validateConfig();
    await this.initializeCache();
    await this.initializeExportStore();
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
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
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

  private async makeRequest<T = unknown>(endpoint: string, method = 'GET', body?: unknown): Promise<T> {
    return this.gfClient.makeRequest<T>(endpoint, method, body);
  }

  private setupToolHandlers(): void {
    this.registerTools(this.mcpServer);
    this.registerExportResource(this.mcpServer);
  }

  /**
   * Register the gf-export://{id} resource template (read only — no list callback).
   */
  private registerExportResource(target: McpServer): void {
    target.registerResource(
      'export',
      new ResourceTemplate('gf-export://{id}', { list: undefined }),
      { description: 'A file produced by export_form_json or export_entries_formatted' },
      async (uri, variables) => {
        const id = Array.isArray(variables.id) ? variables.id[0] : variables.id;
        try {
          const store = this.getExportStore();
          const record = await store.get(id);
          const text = await store.readText(id, EXPORT_RESOURCE_MAX_BYTES);
          return { contents: [{ uri: uri.href, mimeType: record.mimeType, text }] };
        } catch (error) {
          if (error instanceof ExportNotFoundError || error instanceof ExportExpiredError) {
            throw new McpError(RESOURCE_NOT_FOUND, error.message);
          }
          if (error instanceof ExportTooLargeError) {
            throw new McpError(
              ErrorCode.InvalidParams,
              `Export is ${error.size} bytes, over the ${EXPORT_RESOURCE_MAX_BYTES}-byte read limit; call get_export_link to download it`
            );
          }
          throw error;
        }
      }
    );
  }

  /**
   * Register all tools on the given McpServer. Handlers dispatch back into this
   * instance, so every server built this way shares the same caches and API client.
   */
  private registerTools(target: McpServer): void {
    for (const [name, def] of Object.entries(TOOL_SCHEMAS)) {
      // McpServer.registerTool types inputSchema via ZodRawShapeCompat (Record<string,
      // AnySchema>), a structural type that resolves cleanly for TOOL_SCHEMAS' heterogeneous
      // shapes registered in this loop; dispatchTool below does the real argument validation
      // via each tool's own typed Args interface.
      target.registerTool(
        name,
        { description: def.description, inputSchema: def.inputSchema },
        async (args: unknown): Promise<CallToolResult> => this.dispatchTool(name, args) as Promise<CallToolResult>
      );
    }
  }

  /**
   * Build a fresh MCP server (all tools registered) for a single connection. The
   * Streamable HTTP transport needs one server per session because a server can
   * only connect to a single transport; the shared handlers keep caches unified.
   * Also used by the end-to-end test harness.
   */
  createSessionServer(): Server {
    const mcpServer = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
    this.registerTools(mcpServer);
    this.registerExportResource(mcpServer);
    return mcpServer.server;
  }

  /**
   * Maps each registered tool name to its handler wrapper. Built fresh per
   * dispatch (cheap relative to the network I/O each handler performs) so the
   * routing table can simply live next to dispatchTool rather than needing
   * constructor wiring.
   */
  private buildToolHandlerMap(): Record<string, (args: unknown) => Promise<unknown>> {
    return {
      get_forms: (args) => this.getForms(args),
      get_entries: (args) => this.getEntries(args),
      aggregate_entries: (args) => this.aggregateEntries(args),
      submit_form: (args) => this.submitForm(args),
      create_entry: (args) => this.createEntry(args),
      update_entry: (args) => this.updateEntry(args),
      delete_entry: (args) => this.deleteEntry(args),
      create_form: (args) => this.createForm(args),
      update_form: (args) => this.updateForm(args),
      export_entries_formatted: (args) => this.exportEntriesFormatted(args),
      process_entries_bulk: (args) => this.processEntriesBulk(args),
      list_form_templates: (args) => this.listFormTemplates(args),
      save_form_as_template: (args) => this.saveFormAsTemplate(args),
      create_form_from_template: (args) => this.createFormFromTemplate(args),
      export_form_json: (args) => this.exportFormJson(args),
      import_form_json: (args) => this.importFormJson(args),
      clone_form_with_modifications: (args) => this.cloneFormWithModifications(args),
      get_cache_status: () => this.getCacheStatusTool(),
      get_server_info: () => Promise.resolve(this.getServerInfoTool()),
      search_entries_by_name: (args) => this.searchEntriesByName(args),
      search_entries_universal: (args) => this.searchEntriesUniversal(args),
      get_field_mappings: (args) => this.getFieldMappings(args),
      get_export_link: (args) => this.getExportLink(args),
    };
  }

  private async dispatchTool(name: string, args: unknown): Promise<unknown> {
    const handler = this.buildToolHandlerMap()[name];
    if (!handler) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${name}`
      );
    }
    return handler(args);
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
  private createEntrySummary(entry: IGravityEntry): IEntrySummary {
    return createEntrySummary(entry);
  }

  // Tool implementation methods
  private async getForms(args: unknown): Promise<ICacheToolResult> {
    return getFormsHandler({
      makeRequest: this.makeRequest.bind(this),
      getFormCache: () => this.formCache,
      cacheConfig: this.cacheConfig,
      getTemplateManager: () => this.getTemplateManager(),
    }, args as IGetFormsArgs);
  }

  private async getEntries(args: unknown): Promise<GetEntriesResult> {
    return getEntriesHandler({
      makeRequest: this.makeRequest.bind(this),
      fieldTypeDetector: this.fieldTypeDetector,
      searchResultsFormatter: this.searchResultsFormatter,
      getOrCreateSearchManager: () => this.getOrCreateSearchManager(),
    }, args as GetEntriesArgs);
  }

  private async aggregateEntries(args: unknown): Promise<AggregateEntriesResult> {
    return aggregateEntriesHandler({
      makeRequest: this.makeRequest.bind(this),
    }, args as AggregateEntriesArgs);
  }

  /**
   * Get or create the UniversalSearchManager singleton with its API client adapter.
   */
  private getOrCreateSearchManager(): UniversalSearchManager {
    if (!this.universalSearchManager) {
      const apiClient: SearchApiClient = {
        getFormDefinition: async (formId: string): Promise<IGravityForm> => {
          try {
            return await this.makeRequest<IGravityForm>(`/forms/${formId}`);
          } catch (error) {
            throw new Error(`Failed to fetch form definition for form ${formId}: ${String(error)}`);
          }
        },
        searchEntries: async (formId: string, searchParams: unknown): Promise<IGravityEntry[]> => {
          try {
            const params = new URLSearchParams();
            params.append('paging[page_size]', '100');
            if (searchParams) {
              params.append('search', JSON.stringify(searchParams));
            }
            const endpoint = `/forms/${formId}/entries?${params.toString()}`;
            const response = await this.makeRequest<unknown>(endpoint);
            // The GF API's shape here is inconsistent (sometimes {entries: [...]},
            // sometimes a bare array). Mirrors the original untyped
            // `response?.entries || response || []` with explicit `if`s — a falsy
            // (not just nullish) `entries` should still fall through to `response`.
            const responseObj = response as { entries?: unknown } | null | undefined;
            if (responseObj?.entries) {
              return responseObj.entries as IGravityEntry[];
            }
            if (response) {
              return response as IGravityEntry[];
            }
            return [];
          } catch (error) {
            throw new Error(`Failed to search entries in form ${formId}: ${String(error)}`);
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

  private async submitForm(args: unknown): ReturnType<typeof submitFormHandler> {
    return submitFormHandler({ makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body) }, args);
  }

  private async createEntry(args: unknown): ReturnType<typeof createEntryHandler> {
    return createEntryHandler({ makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body) }, args);
  }

  private async updateEntry(args: unknown): ReturnType<typeof updateEntryHandler> {
    return updateEntryHandler({ makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body) }, args);
  }

  private async deleteEntry(args: unknown): ReturnType<typeof deleteEntryHandler> {
    return deleteEntryHandler({ makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body) }, args);
  }

  private async createForm(args: unknown): ReturnType<typeof createFormHandler> {
    return createFormHandler({ makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body) }, args);
  }

  private async updateForm(args: unknown): ReturnType<typeof updateFormHandler> {
    return updateFormHandler({ makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body) }, args);
  }

  private getExportStore(): ExportStore {
    if (this.exportStoreError) {
      // exportStoreError already reads "export directory not writable: <dir> (<cause>)"
      throw new McpError(ErrorCode.InternalError, this.exportStoreError);
    }
    return this.exportStore;
  }

  private getExportDelivery(): IExportDeliveryConfig {
    return {
      mode: this.exportConfig.mode,
      publicBaseUrl: this.exportConfig.publicBaseUrl,
      linkKey: this.linkKey,
      linkTtlMinutes: this.exportConfig.linkTtlMinutes,
    };
  }

  private exportToolContext(): ExportToolContext {
    return {
      makeRequest: <T = unknown>(endpoint: string, method?: string, body?: unknown) => this.makeRequest<T>(endpoint, method, body),
      validator: this.validator,
      dataExporter: this.dataExporter,
      getExportStore: () => this.getExportStore(),
      delivery: this.getExportDelivery(),
    };
  }

  private async exportEntriesFormatted(args: unknown): Promise<IExportToolResult> {
    return exportEntriesFormattedHandler(this.exportToolContext(), args as ExportEntriesFormattedArgs);
  }

  private getBulkOperationsManager(): BulkOperationsManager {
    this.bulkOperationsManager ??= new BulkOperationsManager(
      `${this.config.baseUrl}/wp-json/gf/v2`,
      this.getAuthHeaders()
    );
    return this.bulkOperationsManager;
  }

  private async processEntriesBulk(args: unknown): ReturnType<typeof processEntriesBulkHandler> {
    return processEntriesBulkHandler({ getBulkOperationsManager: () => this.getBulkOperationsManager() }, args);
  }

  private async listFormTemplates(args: unknown): Promise<ICacheToolResult> {
    return listFormTemplatesHandler({
      makeRequest: this.makeRequest.bind(this),
      getFormCache: () => this.formCache,
      cacheConfig: this.cacheConfig,
      getTemplateManager: () => this.getTemplateManager(),
    }, args as IListFormTemplatesArgs);
  }

  private async saveFormAsTemplate(args: unknown): Promise<TemplateToolResult> {
    return saveFormAsTemplateHandler({
      makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body),
      getTemplateManager: () => this.getTemplateManager(),
      getFormImporter: () => this.getFormImporter(),
    }, args as SaveFormAsTemplateArgs);
  }

  private async createFormFromTemplate(args: unknown): Promise<TemplateToolResult> {
    return createFormFromTemplateHandler({
      makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body),
      getTemplateManager: () => this.getTemplateManager(),
      getFormImporter: () => this.getFormImporter(),
    }, args as CreateFormFromTemplateArgs);
  }

  private async exportFormJson(args: unknown): Promise<IExportToolResult> {
    return exportFormJsonHandler(this.exportToolContext(), args as ExportFormJsonArgs);
  }

  private async getExportLink(args: unknown): Promise<IExportToolResult> {
    return getExportLinkHandler(this.exportToolContext(), args as IGetExportLinkArgs);
  }

  private getTemplateManager(): TemplateManager {
    // Create TemplateManager with API call function
    this.templateManager ??= new TemplateManager((endpoint: string) => this.makeRequest<IFormLike[]>(endpoint));
    return this.templateManager;
  }

  private getFormImporter(): FormImporter {
    if (!this.formImporter) {
      // Create FormImporter with API call function and FormCache (if available)
      const cacheInstance = (this.formCache && this.formCache !== null) ? this.formCache : undefined;
      this.formImporter = new FormImporter(
        (endpoint: string, method?: string, body?: unknown) => this.makeRequest(endpoint, method, body),
        cacheInstance
      );
    }
    return this.formImporter;
  }

  private async importFormJson(args: unknown): Promise<TemplateToolResult> {
    return importFormJsonHandler({
      makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body),
      getTemplateManager: () => this.getTemplateManager(),
      getFormImporter: () => this.getFormImporter(),
      getExportStore: () => this.getExportStore(),
    }, args as ImportFormJsonArgs);
  }

  private async cloneFormWithModifications(args: unknown): Promise<TemplateToolResult> {
    return cloneFormWithModificationsHandler({
      makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body),
      getTemplateManager: () => this.getTemplateManager(),
      getFormImporter: () => this.getFormImporter(),
    }, args as CloneFormWithModificationsArgs);
  }

  /**
   * Get cache status tool implementation
   */
  private async getCacheStatusTool(): Promise<ICacheToolResult> {
    return getCacheStatusToolHandler({ getCacheStatus: () => this.getCacheStatus() });
  }

  /**
   * Get server info tool implementation
   */
  private getServerInfoTool(): ReturnType<typeof getServerInfoToolHandler> {
    return getServerInfoToolHandler();
  }

  /**
   * Search entries by name using universal search capabilities
   */
  private async searchEntriesByName(args: unknown): ReturnType<typeof searchEntriesByNameHandler> {
    return searchEntriesByNameHandler({
      makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body),
      fieldTypeDetector: this.fieldTypeDetector,
      searchResultsFormatter: this.searchResultsFormatter,
      getUniversalSearchManager: () => this.getUniversalSearchManager(),
    }, args as Parameters<typeof searchEntriesByNameHandler>[1]);
  }

  /**
   * Advanced multi-field search with custom targeting and strategies
   */
  private async searchEntriesUniversal(args: unknown): ReturnType<typeof searchEntriesUniversalHandler> {
    return searchEntriesUniversalHandler({
      makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body),
      fieldTypeDetector: this.fieldTypeDetector,
      searchResultsFormatter: this.searchResultsFormatter,
      getUniversalSearchManager: () => this.getUniversalSearchManager(),
    }, args as Parameters<typeof searchEntriesUniversalHandler>[1]);
  }

  /**
   * Get field mappings and analysis for form structure debugging
   */
  private async getFieldMappings(args: unknown): ReturnType<typeof getFieldMappingsHandler> {
    return getFieldMappingsHandler({
      makeRequest: (endpoint, method, body) => this.makeRequest(endpoint, method, body),
      fieldTypeDetector: this.fieldTypeDetector,
    }, args);
  }

  /**
   * Public method to call tools (for testing)
   */
  async callTool(request: IToolCallRequest): Promise<IToolCallResponse> {
    const { name, arguments: args } = request.params;
    try {
      const result = await this.dispatchTool(name, args);
      return {
        isError: false,
        ...(result as Record<string, unknown>)
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof McpError ? error.message : `Error: ${String(error)}`
          }
        ]
      };
    }
  }

  async run(): Promise<void> {
    await this.startup();
    const transportMode = process.env.MCP_TRANSPORT ?? "stdio";
    if (transportMode === "http") {
      const token = process.env.MCP_AUTH_TOKEN;
      if (!token) {
        throw new Error("MCP_AUTH_TOKEN is required when MCP_TRANSPORT=http");
      }
      const port = Number(process.env.MCP_HTTP_PORT ?? "9807");
      const { startHttpServer } = await import("./utils/httpTransport.js");
      await startHttpServer(() => this.createSessionServer(), { port, token, exports: this.getHttpExportOptions() });
      console.error(`Gravity Forms MCP server listening on http://0.0.0.0:${port}/mcp`);
    } else {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error("Gravity Forms MCP server running on stdio");
    }
  }
}