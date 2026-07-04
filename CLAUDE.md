# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Claude's name in this project is "TurboMan", and likes to talk about itself in the third person.

## Project Overview

This is an **Enhanced** Model Context Protocol (MCP) server that provides comprehensive tools for interacting with Gravity Forms through its REST API v2. The server enables AI assistants and MCP clients to manage WordPress Gravity Forms with advanced capabilities including bulk operations, template management, data export, and form import/export functionality.

21 MCP tools are registered via the MCP SDK's `McpServer.registerTool` with hand-authored Zod input schemas (`utils/toolSchemas.ts`). The user-facing README documents them grouped by purpose; see "Architecture" below for where each tool's handler logic lives.

## Development Commands

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Start the MCP server (runs dist/cli.js)
npm start

# Development mode (build and run)
npm run dev

# Watch mode for continuous compilation
npm run watch

# Clean build directory
npm run clean

# Run comprehensive test suite
npm test

# Run tests with coverage reporting
npm run test:coverage

# Run tests in watch mode during development
npm run test:watch

# Type-check, lint, and test in one shot
npm run quality
```

Node.js 24+ is required (`.nvmrc` and `package.json` `engines` both pin `>=24.0.0`), driven by `better-sqlite3` ^12's prebuilt binaries.

## Architecture

### Entry points

- **`cli.ts`** — the executable entry point. `package.json`'s `main`/`bin`/`start`/`dev` scripts all point at the compiled `dist/cli.js`. It exists as a separate file from `index.ts` so that importing the library (e.g. under Jest) never auto-starts a server.
- **`index.ts`** — a ~657-line library module exporting `class GravityFormsMCPServer`. It owns configuration loading, cache lifecycle, and tool dispatch, but delegates most tool *logic* to the per-cluster modules below. It builds an `McpServer` (from `@modelcontextprotocol/sdk/server/mcp.js`), registers all 21 tools from `TOOL_SCHEMAS` in a loop, and dispatches each call by name to a handler method.

This is a migration away from the older, low-level `Server` + manual `ListTools`/`CallTool` request-handler pattern — the SDK's `McpServer.registerTool` now owns schema registration, and Zod schemas replace hand-written JSON Schema.

### Tool handler modules (per cluster)

Each module exports plain functions that take a small dependency-injection object (e.g. `{ makeRequest, ... }`) plus the tool's `args`, so they're testable without instantiating the whole server:

- `utils/entryCrudTools.ts` — `submit_form`, `create_entry`, `update_entry`, `delete_entry`
- `utils/formsTools.ts` — `create_form`, `update_form`
- `utils/exportTools.ts` — `export_entries_formatted`, `export_form_json`
- `utils/bulkTools.ts` — `process_entries_bulk`
- `utils/templateTools.ts` — `save_form_as_template`, `create_form_from_template`, `clone_form_with_modifications`, `import_form_json`
- `utils/fieldMappingTools.ts` — `get_field_mappings`
- `utils/searchTools.ts` — `search_entries_by_name`, `search_entries_universal`
- `utils/entriesQueryTools.ts` — `get_entries` (plus its universal-search helper)
- `utils/aggregateEntriesTools.ts` — `aggregate_entries` (field-value distribution tallies)
- `utils/cacheTools.ts` — `get_cache_status`, and (together with `formCache`) `get_forms`, `list_form_templates`

### Shared core

- `utils/toolSchemas.ts` — `TOOL_SCHEMAS`: Zod input schemas + descriptions for all 21 tools; this is the single source of truth for tool names, inputs, and registered descriptions. Verified against the original hand-written JSON schemas by `toolSchemas.test.ts`.
- `utils/gravityFormsClient.ts` — `GravityFormsClient`: HTTP client for the Gravity Forms REST API v2 (auth headers + request execution), isolating transport concerns from tool handlers.
- `utils/responseSizeManager.ts` — token/size estimation and entry/form summarization helpers, used to keep large responses from overflowing model context.
- `utils/cacheTypes.ts` — shared `ICacheConfig`/`ICacheStatus` interfaces used by `index.ts` and `cacheTools.ts`.
- `utils/database.ts` — SQLite connection management (init, connect, cleanup) underlying `FormCache`.

### Supporting utility classes

- **DataExporter** (`utils/dataExporter.ts`) — CSV/JSON export with base64 encoding
- **ValidationHelper** (`utils/validation.ts`) — input validation and sanitization
- **BulkOperationsManager** (`utils/bulkOperations.ts`) — safe bulk operations with rollback and audit trails
- **TemplateManager** (`utils/templateManager.ts`) — template identification and listing
- **TemplateCreator** (`utils/templateCreator.ts`) — safe template modifications and cloning
- **FormImporter** (`utils/formImporter.ts`) — JSON form import with conflict handling
- **FormCache** (`utils/formCache.ts`) — SQLite-based form caching and discovery
- **FieldMappingCache** (`utils/fieldMappingCache.ts`) — LRU cache for field type detection
- **SearchResultsCache** (`utils/searchResultsCache.ts`) — LRU cache for repeated search queries
- **PerformanceMonitor** (`utils/performanceMonitor.ts`) — execution time / cache hit tracking for search
- **UniversalSearchManager** (`utils/universalSearchManager.ts`) — coordinates multi-field search strategies and confidence scoring
- **FieldTypeDetector** (`utils/fieldTypeDetector.ts`) — pattern-based detection of name/email/phone/team fields
- **SearchResultsFormatter** (`utils/searchResultsFormatter.ts`) — consistent search result formatting across output modes
- **ErrorHandlingSystem** (`utils/errorHandlingSystem.ts`) — error classification, graceful degradation, recovery for search

### Transport: stdio or Streamable HTTP

`GravityFormsMCPServer.run()` (in `index.ts`) picks a transport based on `MCP_TRANSPORT`:

- **stdio** (default) — connects the SDK's `StdioServerTransport` directly.
- **http** — dynamically imports `utils/httpTransport.ts` and calls `startHttpServer(server, { port, token })`. Requires `MCP_AUTH_TOKEN`; `run()` throws (and `cli.ts` exits non-zero) if it's missing when `MCP_TRANSPORT=http`.

`utils/httpTransport.ts` is an Express app implementing the MCP Streamable HTTP transport:

- `POST /mcp` — session-based JSON-RPC endpoint, guarded by a constant-time bearer-token check (`createBearerAuthMiddleware`, SHA-256 + `timingSafeEqual`)
- `GET /mcp` / `DELETE /mcp` — session resumption/close, also bearer-guarded
- `GET /health` — unauthenticated liveness probe (used by the Docker `HEALTHCHECK` and orchestrators)
- Idle sessions are swept every 5 minutes and closed after 30 minutes of inactivity

Default port is `9807` (`MCP_HTTP_PORT`).

### Docker / central deployment

`Dockerfile` is a two-stage build: `node:24-bookworm-slim` build stage compiles TypeScript and the native `better-sqlite3` binding (needs `python3 make g++`), then `npm prune --omit=dev`; the runtime stage copies only `node_modules`, `dist`, and `package.json`, runs as a non-root `appuser` (uid 10001), and defaults `MCP_TRANSPORT=http`. `docker-compose.yml` builds the image, maps `9807:9807`, loads `.env`, and mounts two named volumes: `gf-cache:/data` (SQLite cache) and `gf-exports:/exports` (file exports). Bring it up with `docker compose up -d --build`; the container's `HEALTHCHECK` polls `/health` every 30s.

### Authentication & Configuration

- Uses Basic Authentication with WordPress REST API credentials
- Configuration loaded from environment variables (see `.env.example` for the authoritative list):
  - `GRAVITY_FORMS_BASE_URL` — WordPress site URL
  - `GRAVITY_FORMS_CONSUMER_KEY` — API consumer key
  - `GRAVITY_FORMS_CONSUMER_SECRET` — API consumer secret
  - `GRAVITY_FORMS_AUTH_METHOD` — Authentication method (currently only 'basic')
  - `GRAVITY_FORMS_MIN_FORM_ID` — Minimum form ID for gap detection (optional, defaults to lowest existing ID)
  - `GRAVITY_FORMS_FULL_SYNC_INTERVAL_HOURS` — Hours between comprehensive form discovery (default: 24)
  - `GRAVITY_FORMS_CACHE_ENABLED` — Enable/disable form caching (default: true)
  - `GRAVITY_FORMS_CACHE_DB_PATH` — SQLite database path (default: ./data/forms-cache.db)
  - `GRAVITY_FORMS_CACHE_MAX_AGE_SECONDS` — Cache entry max age (default: 3600, clamped to 60-86400)
  - `GRAVITY_FORMS_CACHE_MAX_PROBE_FAILURES` — Consecutive gap-probe failures before giving up during discovery (default: 10, clamped to 1-50)
  - `GRAVITY_FORMS_CACHE_AUTO_SYNC` — Automatic cache synchronization (default: true)
  - `GRAVITY_FORMS_EXPORT_DIR` — Default directory for file exports (default: ./exports)
  - `MCP_TRANSPORT` — `stdio` (default) or `http`
  - `MCP_HTTP_PORT` — HTTP transport port (default: 9807)
  - `MCP_AUTH_TOKEN` — Bearer token; required when `MCP_TRANSPORT=http`
  - `SEARCH_CACHE_ENABLED`, `SEARCH_CACHE_MAX_AGE_MS`, `SEARCH_CACHE_MAX_SIZE` — tuning for `SearchResultsCache` (see `utils/universalSearchManager.ts` / `utils/searchResultsCache.ts`)
  - `PERFORMANCE_MONITORING_ENABLED` — enable `PerformanceMonitor` instrumentation (default: false)
- Invalid or out-of-range numeric/boolean env values fall back to their defaults rather than throwing (see `parseBooleanEnv`/`parseIntEnv` in `index.ts`).
- Missing required credentials (`GRAVITY_FORMS_BASE_URL`/`CONSUMER_KEY`/`CONSUMER_SECRET`) log a `[FATAL]` warning to stderr at startup rather than crashing, so Claude Desktop can surface the error instead of silently failing to launch.

### API Integration

- Communicates with Gravity Forms REST API v2 endpoints
- Base URL pattern: `{WORDPRESS_URL}/wp-json/gf/v2/{endpoint}`
- All requests use JSON content type with Basic Auth headers
- Error handling wraps HTTP errors in MCP error format

## Configuration Setup

1. Copy `.env.example` to `.env`
2. Fill in WordPress site URL and API credentials
3. Ensure Gravity Forms REST API is enabled in WordPress admin
4. Set appropriate user permissions for API access
5. For the HTTP/Docker transport, also copy `.env.docker.example` and set `MCP_AUTH_TOKEN`

## MCP Client Configuration

For stdio (Claude Desktop, etc.), point the client at `dist/cli.js` with `node` — see the README Quick Start for a full example. The tracked templates `claude-config.json` and `claude-config.json.example` at the repo root reference `dist/cli.js`. If you keep a personal `local.claude-config.json` (gitignored), make sure it points at `dist/cli.js`, not the old `dist/index.js` — `index.ts` is now a library and no longer auto-runs.

## Key Dependencies

### Production

- `@modelcontextprotocol/sdk` - Core MCP protocol implementation (`McpServer`, Streamable HTTP transport)
- `better-sqlite3` (^12) - SQLite database for caching and performance optimization
- `express` (^5) - HTTP transport server (`utils/httpTransport.ts`)
- `zod` - Input schema definitions for all registered tools (`utils/toolSchemas.ts`)
- Node.js 24+ required for runtime

### Development & Testing

- `typescript` & `@types/node` - TypeScript development tools
- `jest` & `ts-jest` - Testing framework (tests live under `__tests__/`)
- `eslint` / `typescript-eslint` - Linting (`npm run lint`, `npm run lint:check`)
- `husky` / `lint-staged` - Pre-commit hooks (runs `eslint --fix` on staged `.ts`/`.tsx`, then the full test suite)

### Notable Features

- **Extensive Test Coverage**: Jest suite under `__tests__/` covering utility classes, tool handler modules, and server dispatch
- **TypeScript Strict Mode**: Maximum type safety and error prevention
- **Modular Architecture**: Tool handler logic extracted into per-cluster modules, with `index.ts` reduced to configuration, lifecycle, and dispatch
- **Comprehensive Error Handling**: Proper error propagation and user-friendly messages
- **Security First**: Input validation, sanitization, and confirmation for destructive operations; constant-time bearer token comparison on the HTTP transport

## Field Input Names

When submitting forms, use exact HTML input names:

- Simple fields: `input_1`, `input_2`
- Complex fields: `input_4_3` (field 4, input 3)
- Name fields: `input_1_3` (first name), `input_1_6` (last name)

Inspect form HTML in browser developer tools to find exact input names.

## `update_form` Behavior

`update_form` always performs a full replace: `form_id`, `title`, and `fields`
are required, and the payload you send becomes the form's new definition.
Any field not included in `fields` is removed from the form, so always send
the complete field list (fetch the form first with `get_forms` if you need
to preserve existing fields). Use `validate_fields: true` to catch field
type issues early, and `debug: true` to see detailed operation logs.

## 🔗 **Critical API Documentation Reference**

**⚠️ IMPORTANT:** When working with Gravity Forms API data, always reference the official documentation for accurate field formats:

**Primary Documentation:**
- **Getting Forms API Guide**: https://docs.gravityforms.com/getting-forms-with-the-rest-api-v2/
- **REST API v2 Main Docs**: https://docs.gravityforms.com/rest-api-v2/

**Key API Format Notes:**
- ✅ `is_active` field returns **string** `"1"`/`"0"`, NOT boolean `true`/`false`
- ✅ `is_trash` field returns **string** `"1"`/`"0"`, NOT boolean `true`/`false` 
- ✅ Form IDs return as **strings** `"123"`, NOT numbers `123`
- ✅ Date fields return as **strings** in format `"YYYY-MM-DD HH:MM:SS"`

**Code Implementation:**
- Use `FormCache.insertFormFromApi()` for API data (handles string→boolean conversion)
- Use `FormCache.insertForm()` for internal data (expects proper booleans)
- Mock data matches real API format in `/tests/mocks/gravityFormsMocks.ts`

**When in doubt about API format, ALWAYS check the official documentation first rather than assuming data types!**
