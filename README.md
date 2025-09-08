# Gravity Forms MCP Server

A Model Context Protocol (MCP) server that provides tools for interacting with Gravity Forms through its REST API v2. This allows AI assistants and other MCP clients to manage forms, entries, and submissions in WordPress sites running Gravity Forms.

## Features

- 🔧 **Complete CRUD Operations**: Create, read, update, and delete forms and entries
- 📝 **Form Submissions**: Submit forms with full validation and processing
- 🔍 **Advanced Querying**: Search and filter entries with sorting and pagination
- 🛡️ **Secure Authentication**: Supports Basic Authentication (OAuth 1.0a coming soon)
- ✅ **Form Validation**: Validate submissions without saving
- 📊 **Comprehensive API Coverage**: Access all major Gravity Forms REST API v2 endpoints

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

Create a `.env` file or set environment variables:

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

**Examples:**
```javascript
// Get all forms
{ "form_id": null }

// Get specific form with full details
{ "form_id": "1", "include_fields": true }
```

#### `get_entries`
Retrieve entries with filtering, sorting, and pagination.

**Parameters:**
- `form_id` (optional): Form ID to filter by
- `entry_id` (optional): Specific entry ID
- `search` (optional): Search criteria object
- `sorting` (optional): Sort configuration
- `paging` (optional): Pagination settings

**Examples:**
```javascript
// Get all entries from form 1
{ "form_id": "1" }

// Get entries with pagination and sorting
{
  "form_id": "1",
  "sorting": { "key": "date_created", "direction": "DESC" },
  "paging": { "page_size": 10, "current_page": 1 }
}

// Search entries by field value
{
  "search": { "field_filters": [{ "key": "1", "value": "John" }] }
}
```

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

#### `validate_form`
Validate form submission without saving.

**Parameters:**
- `form_id`: Form ID to validate against
- `field_values`: Values to validate

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
- Consider implementing OAuth 1.0a for enhanced security
- Regularly rotate API keys
- Use HTTPS for all API communications

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Verify API credentials are correct
   - Check that REST API is enabled in Gravity Forms
   - Ensure user has required permissions

2. **Connection Errors**
   - Verify base URL is correct and accessible
   - Check SSL certificate if using HTTPS
   - Ensure WordPress site allows external API requests

3. **Form Submission Failures**
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

## License

MIT License - see LICENSE file for details.

## Related Links

- [Gravity Forms REST API v2 Documentation](https://docs.gravityforms.com/rest-api-v2/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Gravity Forms](https://www.gravityforms.com/)

## Support

For issues with this MCP server, please open an issue on GitHub. For Gravity Forms API questions, refer to the official documentation.