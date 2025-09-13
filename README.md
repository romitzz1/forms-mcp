# 🚀 Enhanced Gravity Forms MCP Server

The ultimate Model Context Protocol (MCP) server that transforms your Gravity Forms into a powerhouse of automation! This isn't just another API wrapper - it's your AI assistant's best friend for managing WordPress forms with style and intelligence.

*Built with the precision of a Swiss watch and the power of a monster truck!* 🏎️

An experiment in VibeCoding

## 🚀 Quick Start for Claude Desktop

**Want to use this with Claude Desktop? Here's the simplest way to get started:**

### What This Does
This tool lets Claude directly interact with your WordPress Gravity Forms - view entries, submit forms, export data, and much more. Think of it as giving Claude superpowers for your forms!

### Before You Start
1. **WordPress site** with Gravity Forms installed
2. **Claude Desktop app** installed on your computer
3. **5 minutes** of your time

### Step-by-Step Setup

#### 1. Get Your API Credentials
1. In your WordPress admin, go to **Forms → Settings → REST API**
2. Check **"Enabled"** to turn on the API
3. Click **"Add Key"**
4. Give it a name like "Claude MCP"
5. Select a user (your admin user is fine)
6. Copy the **Consumer Key** and **Consumer Secret** - you'll need these!
7. **Important:** Save these somewhere safe - WordPress won't show them again

#### 2. Download and Setup
```bash
# Download this project (or clone it)
# Navigate to the project folder in Terminal/Command Prompt

npm install          # Install dependencies
npm run build        # Build the project
```

#### 3. Add to Claude Desktop
1. Open your Claude Desktop settings (gear icon)
2. Go to the **MCP** tab
3. Add this configuration (replace YOUR_VALUES with your actual info):

```json
{
  "mcpServers": {
    "gravity-forms": {
      "command": "node",
      "args": [
        "/path/to/your/gravity-forms-mcp-server/dist/index.js"
      ],
      "env": {
        "GRAVITY_FORMS_BASE_URL": "https://yourwebsite.com",
        "GRAVITY_FORMS_CONSUMER_KEY": "ck_your_key_here",
        "GRAVITY_FORMS_CONSUMER_SECRET": "cs_your_secret_here"
      }
    }
  }
}
```

#### 4. Update the Path
- Replace `/path/to/your/gravity-forms-mcp-server/` with the actual path where you downloaded this project
- On **Windows**: Use forward slashes like `C:/Users/YourName/Downloads/gravity-forms-mcp-server/`
- On **Mac**: Use something like `/Users/YourName/Downloads/gravity-forms-mcp-server/`

#### 5. Restart Claude Desktop
Close and reopen Claude Desktop completely.

### 🎉 Test It Works
Try asking Claude something like:
> "Show me all my Gravity Forms"

or

> "Get the latest 5 entries from my contact form"

If Claude can see your forms, you're all set!

### 🔧 Common Issues

**"No forms found" or connection errors:**
- Double-check your website URL (should start with https://)
- Verify your API keys are correct
- Make sure REST API is enabled in Gravity Forms settings

**"Module not found" or path errors:**
- Check the file path in your MCP configuration
- Make sure you ran `npm install` and `npm run build`
- Try using the full absolute path to the dist/index.js file

**Still having trouble?**
- Check the [detailed installation instructions](#installation) below
- Look at the [troubleshooting section](#troubleshooting) for more help

---

## Features

### Core Functionality

- 🔧 **Complete CRUD Operations**: Create, read, update, and delete forms and entries
- 📝 **Form Submissions**: Submit forms with full validation and processing
- 🔍 **Advanced Querying**: Search and filter entries with sorting and pagination
- 🛡️ **Secure Authentication**: Supports Basic Authentication with API credentials
- ✅ **Form Validation**: Validate submissions without saving

### Advanced Features

- 📊 **Data Export**: Export entries to CSV/JSON with advanced formatting options
- ⚡ **Bulk Operations**: Safely perform bulk delete, update, and status changes on entries
- 🎨 **Template Management**: Create, manage, and clone form templates
- 🔄 **Import/Export**: Export form definitions as JSON and import to create new forms
- 📈 **Audit Trails**: Complete operation tracking for compliance and debugging
- 🔒 **Safety Mechanisms**: Confirmation required for destructive operations, rollback support

### Developer Experience (The Good Stuff!)

- 📚 **Battle-Tested**: Comprehensive test suite that would make a QA engineer weep tears of joy
- 🚀 **TypeScript Supremacy**: Full type safety because nobody has time for runtime surprises
- 🔧 **Modular Magic**: Clean utility classes that play together like a well-orchestrated symphony
- 📖 **Documentation That Actually Helps**: Unlike those other projects... you know the ones 😉

## Prerequisites

- Node.js 18+
- WordPress site with Gravity Forms 2.4+
- Gravity Forms REST API enabled
- Valid API credentials

## Installation

1. Clone or download this project
2. Install dependencies:

```bash
npm install
```

3. Build the TypeScript code:

```bash
npm run build
```

4. Set up environment variables (see Configuration section)

## Configuration

Set environment variables:

```bash
# Required: Your WordPress site URL
GRAVITY_FORMS_BASE_URL=https://yoursite.com

# Required: API credentials from Gravity Forms > Settings > REST API
GRAVITY_FORMS_CONSUMER_KEY=ck_your_consumer_key_here
GRAVITY_FORMS_CONSUMER_SECRET=cs_your_consumer_secret_here

# Optional: Authentication method (default: basic)
GRAVITY_FORMS_AUTH_METHOD=basic
```

### Getting API Credentials

1. In WordPress admin, go to **Forms → Settings → REST API**
2. Check **"Enabled"** to activate the REST API
3. Click **"Add Key"**
4. Add a description and select a user
5. Set appropriate permissions
6. Copy the Consumer Key and Consumer Secret
7. **Important**: Save the credentials immediately as they won't be shown again

## Usage

### Running the MCP Server

```bash
# Start the server
npm start

# Or run in development mode with auto-rebuild
npm run dev
```

The server runs on stdio and can be connected to by MCP clients.

### Available Tools

#### `get_forms`

Get all forms or specific form details.

**Parameters:**

- `form_id` (optional): Specific form ID
- `include_fields` (optional): Include full field details
- `include_all` (optional): Include all forms from cache, including inactive forms (default: false)
- `exclude_trash` (optional): When used with include_all=true, exclude trashed forms (default: false)
- `summary_mode` (optional): Return essential info only for large forms (default: false)

**Examples:**

```javascript
// Get all active forms
{ "form_id": null }

// Get specific form with full details
{ "form_id": "1", "include_fields": true }

// Get all forms including inactive ones, but exclude trashed forms
{ "include_all": true, "exclude_trash": true }
```

#### `get_entries`

Retrieve entries with filtering, sorting, and pagination.

**Parameters:**

- `form_id` (optional): Form ID to filter by
- `entry_id` (optional): Specific entry ID
- `search` (optional): Search criteria object
- `sorting` (optional): Sort configuration
- `paging` (optional): Pagination settings
  - `page_size`: Number of results per page
  - `current_page`: Page number to retrieve (takes priority over offset)
  - `offset`: Zero-based record number to start from (ignored if current_page is set)

**Examples:**

```javascript
// Get all entries from form 1
{ "form_id": "1" }

// Get entries with pagination (page 2, 20 results per page)
{
  "form_id": "1",
  "paging": { "page_size": 20, "current_page": 2 }
}

// Get entries with offset-based pagination (20 results starting from record 15)
{
  "form_id": "1",
  "paging": { "page_size": 20, "offset": 15 }
}

// Combined: pagination, sorting, and search
{
  "form_id": "1",
  "search": { "field_filters": [{ "key": "1", "value": "John" }] },
  "sorting": { "key": "date_created", "direction": "DESC" },
  "paging": { "page_size": 10, "current_page": 1 }
}
```

**Important:** Use pagination to prevent database timeouts when working with large datasets. If both `current_page` and `offset` are provided, `current_page` takes priority per Gravity Forms API behavior.

#### `submit_form`

Submit a form with complete processing (validation, notifications, etc.).

**Parameters:**

- `form_id`: Form ID to submit to
- `field_values`: Object with field values using input names
- `source_page` (optional): Source page number
- `target_page` (optional): Target page number

**Example:**

```javascript
{
  "form_id": "1",
  "field_values": {
    "input_1": "John Doe",
    "input_2": "john@example.com",
    "input_3": "Hello, this is a test message"
  }
}
```

#### `create_entry`

Create an entry directly (bypasses form processing).

**Parameters:**

- `form_id`: Form ID
- `field_values`: Field values object
- `entry_meta` (optional): Additional metadata

#### `update_entry`

Update an existing entry.

**Parameters:**

- `entry_id`: Entry ID to update
- `field_values`: Fields to update

#### `delete_entry`

Delete an entry (trash by default).

**Parameters:**

- `entry_id`: Entry ID to delete
- `force` (optional): Permanently delete instead of trash

#### `create_form`

Create a new form.

**Parameters:**

- `title`: Form title
- `description` (optional): Form description
- `fields` (optional): Array of field objects
- `settings` (optional): Form settings

#### `update_form`

Update an existing form with advanced capabilities including partial updates, field validation, and flexible response formats.

**Parameters:**

- `form_id` (required): ID of the form to update
- `title` (optional*): Updated form title
- `fields` (optional*): Updated array of field objects
- `description` (optional): Updated form description
- `settings` (optional): Updated form settings
- `confirmations` (optional): Form confirmations configuration
- `notifications` (optional): Form notifications configuration
- `partial_update` (optional): Enable partial updates (only update provided fields)
- `validate_fields` (optional): Validate field types before updating
- `response_format` (optional): Response format (`detailed`, `compact`, or `minimal`)
- `debug` (optional): Enable debug logging for troubleshooting

*Required for full updates, optional for partial updates

**Advanced Features:**

1. **Partial Updates**: Update only specific fields without affecting others
2. **Field Type Validation**: Validate field types against Gravity Forms standards
3. **Response Formatting**: Choose from detailed, compact, or minimal response formats
4. **Settings & Notifications**: Update form confirmations and notifications
5. **Debug Logging**: Performance timing and detailed operation logs

## Partial Update Behavior

When `partial_update: true` is used with a `fields` array, the server performs intelligent field-by-field merging:

- **Existing fields** are preserved if not included in the update
- **Updated fields** are merged by ID, preserving unmodified properties
- **New fields** can be added during partial updates
- **Nested properties** (like choices) are deep-merged intelligently
- **Field order** is maintained automatically

### Field Merging Examples

**Update single field property without losing others:**

```javascript
{
  "form_id": "217",
  "partial_update": true,
  "fields": [
    {
      "id": 6,
      "label": "Updated Checkbox Label"
      // All other properties (choices, validation, etc.) are preserved
    }
  ]
}
```

**Update nested properties (choices in checkbox field):**

```javascript
{
  "form_id": "217", 
  "partial_update": true,
  "fields": [
    {
      "id": 6,
      "choices": [
        { "text": "Yes, as event lead.", "inventory_limit": "1" },
        { "text": "Yes, as primary instructor.", "inventory_limit": 7 }, // Updated limit
        { "text": "Yes, as assistant.", "inventory_limit": "4" }
      ]
    }
  ]
}
```

**Add new field during partial update:**

```javascript
{
  "form_id": "217",
  "partial_update": true,
  "fields": [
    {
      "id": 10, // New field ID
      "type": "text",
      "label": "Additional Information"
    }
  ]
}
```

### Full vs Partial Updates

**Full Update (`partial_update: false` or omitted):**
- Replaces ALL form properties with provided values
- Missing fields are removed from the form
- Use when rebuilding entire form structure

**Partial Update (`partial_update: true`):**
- Merges provided fields with existing ones
- Preserves fields not included in update
- Use when modifying specific properties only

### Complete Examples

**Full form update:**

```javascript
{
  "form_id": "1",
  "title": "Updated Contact Form",
  "fields": [
    {
      "type": "text",
      "label": "Full Name",
      "isRequired": true
    }
  ],
  "description": "Updated form description"
  // This replaces ALL existing fields with just this one
}
```

**Partial update with validation:**

```javascript
{
  "form_id": "1",
  "title": "Validated Form",
  "partial_update": true,
  "fields": [
    { "id": 2, "type": "email", "label": "Email Address" },
    { "id": 3, "type": "phone", "label": "Phone Number" }
  ],
  "validate_fields": true,
  "response_format": "compact"
}
```

**Debug mode for troubleshooting:**

```javascript
{
  "form_id": "1",
  "title": "Debug Form",
  "partial_update": true,
  "fields": [{ "id": 1, "label": "Updated Field Label" }],
  "debug": true
}
```

### Troubleshooting Partial Updates

**Common Issues:**

1. **Fields without IDs are ignored**: Always include field `id` when using `partial_update: true`
2. **Nested properties not updating**: Use arrays with complete choice objects, not partial ones
3. **Field order changes**: Fields are automatically sorted by ID for consistency
4. **Validation errors**: Enable `debug: true` to see detailed operation logs

**Best Practices:**

- Use `partial_update: true` when modifying existing forms to preserve data
- Always include field IDs in your updates
- Test with `debug: true` first to understand the merge behavior
- Use `validate_fields: true` to catch field type issues early

#### `validate_form`

Validate form submission without saving.

**Parameters:**

- `form_id`: Form ID to validate against
- `field_values`: Values to validate

### Advanced Tools

#### `export_entries_formatted`

Export entries from a form in CSV or JSON format with advanced formatting options.

**Parameters:**

- `form_id`: Form ID to export entries from
- `format`: Export format ('csv' or 'json')
- `search` (optional): Search criteria to filter entries
- `date_format` (optional): Custom date formatting (default: 'YYYY-MM-DD HH:mm:ss')
- `filename` (optional): Custom filename for export
- `include_headers` (optional): Include headers in CSV export (default: true)

**Example:**

```javascript
{
  "form_id": "1",
  "format": "csv",
  "search": { "status": "active" },
  "date_format": "MM/DD/YYYY",
  "filename": "contact-entries-export"
}
```

#### `process_entries_bulk`

⚠️ **DESTRUCTIVE OPERATION** - The nuclear option for bulk operations! Handle with care, like a monster truck at a pottery convention.

**Parameters:**

- `entry_ids`: Array of entry IDs to process (max 100)
- `operation_type`: Operation to perform ('delete', 'update_status', 'update_fields')
- `confirm`: Must be `true` for safety confirmation
- `data` (optional): Required for update operations

**Examples:**

```javascript
// Bulk delete entries
{
  "entry_ids": ["101", "102", "103"],
  "operation_type": "delete",
  "confirm": true
}

// Bulk status update
{
  "entry_ids": ["104", "105"],
  "operation_type": "update_status",
  "confirm": true,
  "data": { "status": "spam" }
}
```

### Template Management Tools

#### `list_form_templates`

Browse available form templates (forms with '-template' suffix).

**Parameters:**

- `search_term` (optional): Filter templates by name
- `sort_by` (optional): Sort by 'name' or 'date'
- `sort_order` (optional): 'asc' or 'desc'

#### `save_form_as_template`

Save an existing form as a reusable template.

**Parameters:**

- `form_id`: Source form ID to save as template
- `template_name` (optional): Custom template name (defaults to form title + '-template')

#### `create_form_from_template`

Create a new form from an existing template with customizations.

**Parameters:**

- `template_id`: Template form ID to clone from
- `new_form_title`: Title for the new form
- `field_renames` (optional): Array of field label renames

**Example:**

```javascript
{
  "template_id": "5",
  "new_form_title": "Customer Contact Form",
  "field_renames": [
    { "original_label": "First Name", "new_label": "Customer Name" }
  ]
}
```

#### `clone_form_with_modifications`

Clone an existing form with intelligent modifications.

**Parameters:**

- `source_form_id`: Form ID to clone
- `modifications`: Object with title and field modifications

### Import/Export Tools

#### `export_form_json`

Export form definition as JSON for backup or migration.

**Parameters:**

- `form_id`: Form ID to export

#### `import_form_json`

Import form from JSON with conflict handling.

**Parameters:**

- `form_json`: JSON string of form definition
- `force_import` (optional): Overwrite existing forms with same ID

## Field Input Names

When submitting or updating entries, use the exact input names from the form HTML:

- Simple fields: `input_1`, `input_2`, etc.
- Complex fields: `input_4_3` (field 4, input 3)
- Name field example: `input_1_3` (first name), `input_1_6` (last name)

You can find exact input names by inspecting the form HTML in your browser's developer tools.

## Error Handling

The server provides detailed error messages for:

- Authentication failures
- Invalid API credentials
- Missing required parameters
- Network connection issues
- Gravity Forms API errors

Check the server logs for debugging information.

## Permissions

Ensure your API user has appropriate Gravity Forms capabilities:

- `gravityforms_view_entries` - View entries
- `gravityforms_edit_entries` - Edit entries
- `gravityforms_delete_entries` - Delete entries
- `gravityforms_create_form` - Create forms
- `gravityforms_edit_forms` - Edit forms
- `gravityforms_delete_forms` - Delete forms

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Watch for changes during development
npm run watch

# Clean build directory
npm run clean
```

## Security Notes

- Keep your API credentials secure and never commit them to version control
- Use environment variables or secure credential management
- Use secure credential management practices
- Regularly rotate API keys
- Use HTTPS for all API communications

## Troubleshooting

### Common Claude Desktop Issues

1. **"No forms found" or "Cannot connect"**
   - **Check your website URL**: Must start with `https://` (not `http://`)
   - **Verify API credentials**: Copy/paste them exactly from WordPress - no extra spaces
   - **Test the website**: Make sure your WordPress site is online and accessible
   - **Check Gravity Forms REST API**: Go to Forms → Settings → REST API and ensure it's "Enabled"

2. **"Module not found" or "Command failed"**
   - **Wrong file path**: Check the path to `dist/index.js` in your MCP config
   - **Missing build**: Run `npm run build` in the project folder
   - **Node.js not installed**: Install Node.js from nodejs.org
   - **Use full paths**: Try the complete path like `/Users/YourName/Downloads/gravity-forms-mcp-server/dist/index.js`

3. **Claude doesn't see the forms after setup**
   - **Restart Claude Desktop**: Close it completely and reopen
   - **Check MCP config**: Look for syntax errors in your JSON (missing commas, quotes, etc.)
   - **Test with simple commands**: Try "What MCP tools do you have?" to see if Claude sees the server

### Technical Issues

4. **Authentication Errors**
   - Verify API credentials are correct
   - Check that REST API is enabled in Gravity Forms
   - Ensure user has required permissions

5. **Connection Errors**
   - Verify base URL is correct and accessible
   - Check SSL certificate if using HTTPS
   - Ensure WordPress site allows external API requests

6. **Form Submission Failures**
   - Verify field input names match form structure
   - Check required field validation
   - Review form conditional logic settings

### Debug Logging

Enable logging in Gravity Forms:

1. Go to **Forms → Settings → Logging**
2. Enable **"Gravity Forms API"**
3. Set to log all messages
4. Check logs after API requests

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Related Links

- [Gravity Forms REST API v2 Documentation](https://docs.gravityforms.com/rest-api-v2/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Gravity Forms](https://www.gravityforms.com/)

## Support

For issues with this MCP server, please open an issue on GitHub. For Gravity Forms API questions, refer to the official documentation.
