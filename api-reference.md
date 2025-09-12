# Gravity Forms REST API v2 Reference

This document provides comprehensive API reference for the Gravity Forms REST API v2, specifically for implementing the `update_form` functionality.

## Base Configuration

### Base URL Structure
```
https://[your-wordpress-site]/wp-json/gf/v2/
```

### Authentication
- **Method**: Basic Authentication (currently supported)
- **Future**: OAuth 1.0a Authentication (planned)
- **Headers**: `Authorization: Basic [base64(username:password)]`
- **Content-Type**: `application/json` (required)

### API Key Setup (WordPress Admin)
1. Navigate to **Forms → Settings → REST API**
2. Check **"Enabled"** to activate REST API
3. Click **"Add Key"** to generate credentials
4. Set user permissions appropriately
5. Copy Consumer Key and Consumer Secret immediately

## Update Form Endpoint

### Endpoint Details
- **URL**: `/gf/v2/forms/[FORM_ID]`
- **HTTP Method**: `PUT`
- **Required Capability**: `gravityforms_create_form`
- **Filter Hook**: `gform_rest_api_capability_put_forms`

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fields` | Array | Array of Field Objects defining form structure |
| `title` | String | Form title (cannot be empty) |

### Optional Parameters

Any property from the Form Object can be included. Unspecified properties will be preserved from the existing form.

Common optional parameters:
- `description` (String): Form description
- `labelPlacement` (String): Label placement setting
- `descriptionPlacement` (String): Description placement setting
- `button` (Object): Submit button configuration
- `fields` (Array): Complete field definitions
- `settings` (Object): Form settings and configuration
- `confirmations` (Object): Confirmation settings
- `notifications` (Object): Notification settings

### Request Body Structure

```json
{
  "title": "Updated Form Title",
  "description": "Updated form description",
  "fields": [
    {
      "type": "text",
      "id": 1,
      "label": "Full Name",
      "isRequired": true,
      "size": "medium",
      "placeholder": "Enter your full name"
    },
    {
      "type": "email",
      "id": 2,
      "label": "Email Address",
      "isRequired": true,
      "size": "medium"
    },
    {
      "type": "select",
      "id": 3,
      "label": "How did you hear about us?",
      "choices": [
        {
          "text": "Google",
          "value": "google"
        },
        {
          "text": "Social Media",
          "value": "social"
        }
      ]
    }
  ],
  "button": {
    "type": "text",
    "text": "Submit Inquiry"
  }
}
```

### Response Format

#### Successful Response (200 OK)
Returns the complete updated Form Object:

```json
{
  "id": "1",
  "title": "Updated Form Title",
  "description": "Updated form description",
  "labelPlacement": "top_label",
  "descriptionPlacement": "below",
  "fields": [
    {
      "type": "text",
      "id": 1,
      "label": "Full Name",
      "isRequired": true,
      "size": "medium"
    }
  ],
  "button": {
    "type": "text",
    "text": "Submit Inquiry"
  },
  "is_active": "1",
  "date_created": "2024-01-15 10:30:00",
  "is_trash": "0"
}
```

#### Error Response
```json
{
  "code": "missing_form",
  "message": "Form not found",
  "data": {
    "status": 404
  }
}
```

### Error Codes

| Code | Description | HTTP Status |
|------|-------------|-------------|
| `missing_form` | Form ID does not exist | 404 |
| `not_found` | Resource not found | 404 |
| `invalid_params` | Required parameters missing or invalid | 400 |
| `rest_forbidden` | Insufficient permissions | 403 |

## Form Object Structure

### Core Properties

```json
{
  "id": "string",                    // Form ID (read-only)
  "title": "string",                 // Form title (required)
  "description": "string",           // Form description
  "labelPlacement": "string",        // top_label, left_label, right_label
  "descriptionPlacement": "string",  // below, above
  "button": {
    "type": "text|image",
    "text": "string",
    "imageUrl": "string"
  },
  "fields": [],                      // Array of Field Objects (required)
  "version": "string",               // Gravity Forms version
  "revision": "string",              // Form revision
  "nextFieldId": "number",           // Next available field ID
  "useCurrentUserAsAuthor": boolean,
  "postContentTemplateEnabled": boolean,
  "postTitleTemplateEnabled": boolean,
  "postTitleTemplate": "string",
  "postContentTemplate": "string",
  "lastPageButton": object,
  "pagination": object,
  "firstPageCssClass": "string",
  "confirmations": {},               // Confirmation configurations
  "notifications": {},               // Notification configurations
  "is_active": "0|1",               // Form active status (string!)
  "date_created": "string",         // Creation date (YYYY-MM-DD HH:MM:SS)
  "is_trash": "0|1"                 // Trash status (string!)
}
```

### Important Data Type Notes

⚠️ **Critical**: The following fields return as **strings**, not booleans:
- `is_active`: `"1"` (active) or `"0"` (inactive)
- `is_trash`: `"1"` (trashed) or `"0"` (not trashed)
- Form IDs: Always returned as strings `"123"`, not numbers
- Date fields: Always strings in format `"YYYY-MM-DD HH:MM:SS"`

## Field Object Structure

### Basic Field Properties

```json
{
  "type": "string",        // Field type (text, email, select, etc.)
  "id": number,            // Unique field ID
  "label": "string",       // Field label
  "adminLabel": "string",  // Admin label (optional)
  "isRequired": boolean,   // Whether field is required
  "size": "string",        // small, medium, large
  "placeholder": "string", // Placeholder text
  "cssClass": "string",    // Custom CSS classes
  "description": "string", // Field description
  "descriptionPlacement": "string" // above, below
}
```

### Field Type Examples

#### Text Field
```json
{
  "type": "text",
  "id": 1,
  "label": "First Name",
  "isRequired": true,
  "size": "medium",
  "placeholder": "Enter your first name"
}
```

#### Email Field
```json
{
  "type": "email",
  "id": 2,
  "label": "Email Address",
  "isRequired": true,
  "size": "medium"
}
```

#### Select Field
```json
{
  "type": "select",
  "id": 3,
  "label": "Country",
  "choices": [
    {
      "text": "United States",
      "value": "US",
      "isSelected": false
    },
    {
      "text": "Canada", 
      "value": "CA",
      "isSelected": false
    }
  ]
}
```

#### Name Field (Composite)
```json
{
  "type": "name",
  "id": 4,
  "label": "Name",
  "inputs": [
    {
      "id": "4.3",
      "label": "First",
      "name": "input_4_3"
    },
    {
      "id": "4.6", 
      "label": "Last",
      "name": "input_4_6"
    }
  ]
}
```

## Authentication Implementation

### Environment Variables
```bash
GRAVITY_FORMS_BASE_URL=https://yoursite.com
GRAVITY_FORMS_CONSUMER_KEY=ck_your_consumer_key_here
GRAVITY_FORMS_CONSUMER_SECRET=cs_your_consumer_secret_here
GRAVITY_FORMS_AUTH_METHOD=basic
```

### Request Headers
```javascript
{
  'Authorization': `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`,
  'Content-Type': 'application/json',
  'User-Agent': 'Gravity Forms MCP Server'
}
```

## Error Handling Patterns

### MCP Error Transformation
```javascript
// Transform API errors to MCP errors
try {
  const response = await this.makeRequest(`/forms/${form_id}`, 'PUT', formData);
  return response;
} catch (error) {
  if (error.response?.status === 404) {
    throw new McpError(ErrorCode.InvalidParams, `Form with ID ${form_id} not found`);
  }
  if (error.response?.status === 403) {
    throw new McpError(ErrorCode.InternalError, 'Insufficient permissions to update form');
  }
  throw new McpError(ErrorCode.InternalError, `Failed to update form: ${error.message}`);
}
```

## Implementation Notes

### Update Form Workflow
1. **Validate Parameters**: Check required fields (form_id, title, fields)
2. **Build Request Body**: Combine required + optional parameters
3. **Make API Call**: PUT request to `/forms/{form_id}`
4. **Handle Response**: Return updated form or transform errors
5. **Format Output**: Follow existing MCP response patterns

### Best Practices
- Always validate `form_id` is a non-empty string
- Ensure `title` is provided and not empty
- Validate `fields` is an array (can be empty)
- Preserve existing form properties when updating
- Use proper error codes for different failure scenarios
- Follow existing code patterns in the MCP server

### Testing Considerations
- Mock successful API responses with complete Form Objects
- Test error scenarios (404, 403, validation errors)
- Verify request body construction
- Test parameter validation
- Ensure backward compatibility

## Related Endpoints

### Get Form (for validation)
- **URL**: `/gf/v2/forms/[FORM_ID]`
- **Method**: `GET`
- **Use**: Validate form exists before update

### List Forms (for reference)
- **URL**: `/gf/v2/forms`
- **Method**: `GET`
- **Use**: Browse available forms

### Create Form (similar pattern)
- **URL**: `/gf/v2/forms`
- **Method**: `POST`
- **Use**: Reference for similar implementation

## Security Considerations

### Input Validation
- Sanitize all user inputs
- Validate field IDs are numeric
- Check field types against allowed values
- Prevent injection attacks in field labels/descriptions

### Permission Checks
- Verify user has `gravityforms_create_form` capability
- Use WordPress nonce for CSRF protection (if applicable)
- Log update operations for audit trails

### Data Integrity
- Backup form configuration before updates
- Validate field relationships and dependencies
- Ensure conditional logic remains valid after updates

---

**Documentation Version**: 1.0  
**Last Updated**: Current Session  
**API Version**: Gravity Forms REST API v2  
**Reference URL**: https://docs.gravityforms.com/rest-api-v2/