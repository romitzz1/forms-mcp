// ABOUTME: Forms-CRUD MCP tool handlers (create_form, update_form)
// ABOUTME: Extracted from GravityFormsMCPServer to isolate handler logic from server infrastructure

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

export interface FormsToolContext {
  makeRequest(endpoint: string, method?: string, body?: unknown): Promise<any>;
}

export async function createForm(ctx: FormsToolContext, args: any) {
  const { title, description, fields = [], settings = {} } = args;

  const form = {
    title,
    description,
    fields,
    ...settings
  };

  const response = await ctx.makeRequest('/forms', 'POST', form);

  return {
    content: [
      {
        type: "text",
        text: `Form Created:\n${JSON.stringify(response, null, 2)}`
      }
    ]
  };
}

export async function updateForm(ctx: FormsToolContext, args: any) {
  const {
    form_id,
    title,
    fields,
    description,
    settings,
    confirmations,
    notifications,
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

  const finalTitle = title;
  const finalFields = fields;
  const finalDescription = description;
  const finalSettings = settings;
  const finalConfirmations = confirmations;
  const finalNotifications = notifications;

  // Full updates require title and fields
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
  const response = await ctx.makeRequest(`/forms/${form_id}`, 'PUT', formUpdateData);

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
