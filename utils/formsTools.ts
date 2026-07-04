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
    partial_update = false,
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
    console.error(`[UPDATE_FORM_DEBUG] partial_update: ${partial_update}`);
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

  let existingForm = null;
  let finalTitle = title;
  let finalFields = fields;
  let finalDescription = description;
  let finalSettings = settings;
  let finalConfirmations = confirmations;
  let finalNotifications = notifications;

  // If partial update, retrieve existing form data
  if (partial_update) {
    if (debug) {
      console.error('[UPDATE_FORM_DEBUG] Retrieving existing form for partial update');
    }

    existingForm = await ctx.makeRequest(`/forms/${form_id}`, 'GET');

    // Use existing values if not provided
    finalTitle = title || existingForm.title;

    // Field merging logic for partial updates
    if (fields && partial_update) {
      // Create a map of updated fields by ID
      const fieldUpdates = new Map();
      fields.forEach((field: Record<string, unknown>) => {
        // Only process fields with valid IDs (non-null, non-empty, non-zero)
        if (field != null && isValidFieldId(field.id)) {
          fieldUpdates.set(String(field.id), field);
        }
      });

      // Merge with existing fields
      finalFields = existingForm.fields.map((existingField: Record<string, unknown>) => {
        const fieldId = existingField.id != null ? String(existingField.id) : null;
        if (fieldId && fieldUpdates.has(fieldId)) {
          const updates = fieldUpdates.get(fieldId);
          const updatedField = mergeFieldProperties(existingField, updates);
          fieldUpdates.delete(fieldId); // Mark as processed
          return updatedField;
        }
        return existingField;
      });

      // Add any new fields that weren't in the existing form
      fieldUpdates.forEach(newField => {
        finalFields.push(newField);
      });

      // Sort by field ID to maintain consistent order
      finalFields.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
        const idA = a.id != null ? Number(a.id) : 0;
        const idB = b.id != null ? Number(b.id) : 0;

        // Handle NaN cases safely - invalid IDs go to end
        if (isNaN(idA) && isNaN(idB)) return 0;
        if (isNaN(idA)) return 1;
        if (isNaN(idB)) return -1;

        return idA - idB;
      });
    } else {
      finalFields = fields || existingForm.fields;
    }

    finalDescription = description !== undefined ? description : existingForm.description;
    finalSettings = settings || existingForm.settings;
    finalConfirmations = confirmations || existingForm.confirmations;
    finalNotifications = notifications || existingForm.notifications;
  } else {
    // For full updates, validate required fields
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

/**
 * Validates if a field ID is valid for partial updates
 * Gravity Forms field IDs should be positive integers or numeric strings
 */
function isValidFieldId(id: unknown): boolean {
  // Reject null, undefined, empty string, zero, and non-numeric values
  if (id == null || id === '' || id === 0) {
    return false;
  }

  // Accept positive numbers and numeric strings within reasonable bounds
  const numericId = Number(id);
  return !isNaN(numericId) &&
         numericId > 0 &&
         numericId <= 999999 && // Reasonable upper bound for Gravity Forms field IDs
         Number.isInteger(numericId); // Must be whole numbers
}

/**
 * Deep merge field properties for partial updates
 */
function mergeFieldProperties(existing: Record<string, unknown>, updates: Record<string, unknown>): Record<string, unknown> {
  // Handle choices array specially
  if (Array.isArray(updates.choices) && Array.isArray(existing.choices)) {
    // Ensure both arrays contain objects with consistent typing
    const existingChoices = existing.choices as Array<Record<string, unknown>>;
    const updatesChoices = updates.choices as Array<Record<string, unknown>>;

    // Skip validation - handle mixed types during merging
    // This allows for null values and other edge cases in choice arrays

    // Handle both existing choices and potential additional choices from updates
    const maxLength = Math.max(existingChoices.length, updatesChoices.length);
    const mergedChoices: unknown[] = [];

    for (let index = 0; index < maxLength; index++) {
      const existingChoice = existingChoices[index];
      const updateChoice = updatesChoices[index];

      // Handle object merging with proper type checking
      if (existingChoice && typeof existingChoice === 'object' && !Array.isArray(existingChoice) && existingChoice !== null &&
          updateChoice && typeof updateChoice === 'object' && !Array.isArray(updateChoice) && updateChoice !== null) {
        // Merge existing choice with updates
        mergedChoices.push({ ...(existingChoice), ...(updateChoice) });
      } else if (existingChoice !== undefined) {
        // Keep existing choice unchanged (including null values)
        mergedChoices.push(existingChoice);
      } else if (updateChoice !== undefined) {
        // Add new choice from updates (edge case: updates.choices longer than existing)
        mergedChoices.push(updateChoice);
      }
    }

    return { ...existing, ...updates, choices: mergedChoices };
  }

  // Default shallow merge for other properties
  return { ...existing, ...updates };
}
