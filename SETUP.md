# Enhanced Gravity Forms MCP Server - Setup Guide

## Quick Setup (Recommended)

### 🚀 Automated Setup Tool

Use our interactive setup tool to configure your MCP server automatically:

```bash
# Run the setup tool
node setup-mcp.js

# Or if you made it executable:
./setup-mcp.js
```

The setup tool will:
- ✅ Detect your project directory automatically
- ✅ Create a properly configured `.mcp.json` file  
- ✅ Set up all performance optimization settings
- ✅ Enable all 20 tools including Universal Search
- ✅ Create backups and provide clear next steps

### 🔑 Update Your API Credentials

After running setup, edit your `.mcp.json` file and update these placeholders:

```json
{
  "mcpServers": {
    "gravity-forms-enhanced": {
      "env": {
        "GRAVITY_FORMS_BASE_URL": "https://your-wordpress-site.com",
        "GRAVITY_FORMS_CONSUMER_KEY": "ck_your_consumer_key_here", 
        "GRAVITY_FORMS_CONSUMER_SECRET": "cs_your_consumer_secret_here"
      }
    }
  }
}
```

**Get your API credentials from:**
WordPress Admin → Forms → Settings → REST API → Create Key

## Manual Setup

### 1. Copy Example Configuration

```bash
# Copy the example file
cp .mcp.json.example .mcp.json

# Or for Claude Desktop configuration
cp claude-config.json.example ~/.config/claude/claude_config.json
```

### 2. Edit Configuration

Update the following fields in your `.mcp.json`:

```json
{
  "mcpServers": {
    "gravity-forms-enhanced": {
      "command": "node",
      "args": ["/absolute/path/to/your/forms-mcp/dist/index.js"],
      "env": {
        "GRAVITY_FORMS_BASE_URL": "https://your-actual-site.com",
        "GRAVITY_FORMS_CONSUMER_KEY": "ck_your_actual_key",
        "GRAVITY_FORMS_CONSUMER_SECRET": "cs_your_actual_secret",
        "GRAVITY_FORMS_AUTH_METHOD": "basic",
        "GRAVITY_FORMS_CACHE_ENABLED": "true",
        "GRAVITY_FORMS_CACHE_DB_PATH": "/path/to/cache/forms-cache.db",
        "GRAVITY_FORMS_CACHE_MAX_AGE_SECONDS": "300",
        "SEARCH_CACHE_ENABLED": "true",
        "SEARCH_CACHE_MAX_AGE_MS": "900000",
        "SEARCH_CACHE_MAX_SIZE": "100",
        "PERFORMANCE_MONITORING_ENABLED": "true",
        "NODE_ENV": "production"
      }
    }
  }
}
```

## Build and Test

```bash
# Build the TypeScript project
npm run build

# Test your configuration
npm start

# You should see: "Enhanced Gravity Forms MCP Server started successfully"
```

## Verify Installation

Once configured, your MCP server provides **21 powerful tools**:

### 🆕 Universal Search Tools (NEW!)
- `search_entries_by_name` - Intelligent name search across any form
- `search_entries_universal` - Advanced multi-field search with custom targeting  
- `get_field_mappings` - Field structure analysis and debugging

### Core Tools (9)
- `get_forms`, `get_entries`, `submit_form`, `create_entry`
- `update_entry`, `delete_entry`, `create_form`, `update_form`, `validate_form`

### Enhanced Tools (8) 
- `export_entries_formatted`, `process_entries_bulk`
- `list_form_templates`, `save_form_as_template`, `create_form_from_template`
- `export_form_json`, `import_form_json`, `clone_form_with_modifications`

### System Tool (1)
- `get_cache_status` - Monitor system performance

## Usage Examples

### Universal Name Search (Most Common)
```
search_entries_by_name({
  "form_id": "123",
  "search_text": "John Smith"
})
```

### Advanced Multi-Field Search
```
search_entries_universal({
  "form_id": "123", 
  "search_queries": [
    {"text": "Manager", "field_types": ["name"]},
    {"text": "gmail.com", "field_types": ["email"]}
  ],
  "logic": "AND"
})
```

### Field Structure Analysis
```
get_field_mappings({
  "form_id": "123",
  "include_details": true
})
```

## Configuration Options

### Performance Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `SEARCH_CACHE_ENABLED` | `true` | Enable search result caching |
| `SEARCH_CACHE_MAX_AGE_MS` | `900000` | Cache expiry (15 minutes) |
| `SEARCH_CACHE_MAX_SIZE` | `100` | Max cached results |
| `PERFORMANCE_MONITORING_ENABLED` | `true` | Track performance metrics |
| `GRAVITY_FORMS_CACHE_MAX_AGE_SECONDS` | `300` | Form cache expiry (5 minutes) |

### Environment Modes

- **Production** (`NODE_ENV=production`): Optimized for speed, minimal logging
- **Development** (`NODE_ENV=development`): Verbose logging, detailed errors

## Troubleshooting

### Common Issues

**"Command not found" error:**
- Ensure you've run `npm run build`
- Check that the path in `args` points to the correct `dist/index.js` file

**"Invalid credentials" error:**  
- Verify your Consumer Key starts with `ck_`
- Verify your Consumer Secret starts with `cs_`
- Check that REST API is enabled in Gravity Forms settings

**Cache directory errors:**
- The setup tool automatically creates cache directories
- For manual setup, ensure the directory exists and is writable

### Get Help

- 📚 **Full Documentation**: See `docs/` directory for comprehensive guides
- 🔧 **Configuration**: See `docs/ConfigurationGuide.md` for advanced settings
- 🚨 **Troubleshooting**: See `docs/TroubleshootingGuide.md` for common issues
- 📖 **API Reference**: See `docs/APIReference.md` for all tool parameters

## What Makes This Special?

This isn't just a basic API wrapper - it's a **comprehensive MCP server** with:

- ✅ **20 tools** (8 core + 8 enhanced + 4 universal search)
- ✅ **818+ tests** for production reliability  
- ✅ **Universal Search** - works on any form without configuration
- ✅ **Performance optimized** - sub-second search times
- ✅ **Token safe** - prevents context overflow crashes
- ✅ **Enterprise-grade** - caching, monitoring, error handling

Transform your Gravity Forms workflow from manual pagination to intelligent single-command searching! 🎯