# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server that provides tools for interacting with Gravity Forms through its REST API v2. The server enables AI assistants and MCP clients to manage WordPress Gravity Forms, including form creation, entry management, and form submissions.

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
```

## Architecture

### Core Components

- **Main Server Class**: `GravityFormsMCPServer` in `index.ts`
  - Single TypeScript file containing the entire MCP server implementation
  - Uses Model Context Protocol SDK for server infrastructure
  - Handles stdio communication with MCP clients

### Key Methods and Tools

The server implements 8 main tools for Gravity Forms interaction:

1. `get_forms` - Retrieve form definitions and metadata
2. `get_entries` - Query form entries with filtering/pagination  
3. `submit_form` - Submit forms with full processing (validation, notifications)
4. `create_entry` - Create entries directly (bypasses form processing)
5. `update_entry` - Update existing entries
6. `delete_entry` - Delete/trash entries
7. `create_form` - Create new forms programmatically
8. `validate_form` - Validate submissions without saving

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

- `@modelcontextprotocol/sdk` - Core MCP protocol implementation
- `@types/node` & `typescript` - TypeScript development tools
- Node.js 18+ required for runtime

## Field Input Names

When submitting forms, use exact HTML input names:
- Simple fields: `input_1`, `input_2`
- Complex fields: `input_4_3` (field 4, input 3)
- Name fields: `input_1_3` (first name), `input_1_6` (last name)

Inspect form HTML in browser developer tools to find exact input names.