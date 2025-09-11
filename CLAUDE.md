# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **Enhanced** Model Context Protocol (MCP) server that provides comprehensive tools for interacting with Gravity Forms through its REST API v2. The server enables AI assistants and MCP clients to manage WordPress Gravity Forms with advanced capabilities including bulk operations, template management, data export, and form import/export functionality.

**What makes this special:** This isn't just a basic API wrapper - it's a full-featured, battle-tested MCP server with 16 tools, 281+ tests, and enterprise-grade safety mechanisms. Think of it as the Swiss Army knife of Gravity Forms automation!

## Development Commands

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Start the MCP server
npm start

# Development mode (build and run)
npm run dev

# Watch mode for continuous compilation
npm run watch

# Clean build directory
npm run clean

# Run comprehensive test suite (281+ tests!)
npm test

# Run tests with coverage reporting
npm run test:coverage

# Run tests in watch mode during development
npm run test:watch
```

## Architecture

### Core Components

- **Main Server Class**: `GravityFormsMCPServer` in `index.ts`
  - Comprehensive MCP server with 16 total tools
  - Uses Model Context Protocol SDK for server infrastructure
  - Handles stdio communication with MCP clients
  - Modular utility class architecture for maintainability

### Core Tools (Original 8)

1. `get_forms` - Retrieve form definitions and metadata
2. `get_entries` - Query form entries with filtering/pagination  
3. `submit_form` - Submit forms with full processing (validation, notifications)
4. `create_entry` - Create entries directly (bypasses form processing)
5. `update_entry` - Update existing entries
6. `delete_entry` - Delete/trash entries
7. `create_form` - Create new forms programmatically
8. `validate_form` - Validate submissions without saving

### Enhanced Tools (New 8)

9. `export_entries_formatted` - Export entries to CSV/JSON with advanced formatting
10. `process_entries_bulk` - Bulk operations with safety confirmations and audit trails
11. `list_form_templates` - Browse available form templates
12. `save_form_as_template` - Convert existing forms to reusable templates
13. `create_form_from_template` - Create forms from templates with customizations
14. `clone_form_with_modifications` - Intelligent form cloning with modifications
15. `export_form_json` - Export form definitions for backup/migration
16. `import_form_json` - Import forms from JSON with conflict resolution

### Utility Classes

- **DataExporter** (`utils/dataExporter.ts`) - CSV/JSON export with base64 encoding
- **ValidationHelper** (`utils/validation.ts`) - Comprehensive input validation and sanitization
- **BulkOperationsManager** (`utils/bulkOperations.ts`) - Safe bulk operations with rollback
- **TemplateManager** (`utils/templateManager.ts`) - Template identification and listing
- **TemplateCreator** (`utils/templateCreator.ts`) - Safe template modifications and cloning
- **FormImporter** (`utils/formImporter.ts`) - JSON form import with conflict handling

### Authentication & Configuration

- Uses Basic Authentication with WordPress REST API credentials
- Configuration loaded from environment variables:
  - `GRAVITY_FORMS_BASE_URL` - WordPress site URL
  - `GRAVITY_FORMS_CONSUMER_KEY` - API consumer key
  - `GRAVITY_FORMS_CONSUMER_SECRET` - API consumer secret
  - `GRAVITY_FORMS_AUTH_METHOD` - Authentication method (currently only 'basic')

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

## MCP Client Configuration

Use the provided `claude-config.json` as a template for MCP client configuration, updating the path to the built JavaScript file and environment variables with actual values.

## Key Dependencies

### Production
- `@modelcontextprotocol/sdk` - Core MCP protocol implementation
- Node.js 18+ required for runtime

### Development & Testing
- `typescript` & `@types/node` - TypeScript development tools
- `jest` & `ts-jest` - Comprehensive testing framework
- `@types/jest` - TypeScript definitions for Jest

### Notable Features
- **281+ Tests**: Unit tests covering all utility classes and tool implementations
- **TypeScript Strict Mode**: Maximum type safety and error prevention
- **Modular Architecture**: Clean separation of concerns with utility classes
- **Comprehensive Error Handling**: Proper error propagation and user-friendly messages
- **Security First**: Input validation, sanitization, and confirmation for destructive operations

## Field Input Names

When submitting forms, use exact HTML input names:
- Simple fields: `input_1`, `input_2`
- Complex fields: `input_4_3` (field 4, input 3)
- Name fields: `input_1_3` (first name), `input_1_6` (last name)

Inspect form HTML in browser developer tools to find exact input names.