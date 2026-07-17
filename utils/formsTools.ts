// ABOUTME: Forms-CRUD MCP tool handlers (create_form, update_form)
// ABOUTME: Extracted from GravityFormsMCPServer to isolate handler logic from server infrastructure

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { IGravityForm } from "./gravityFormsTypes.js";

export interface FormsToolContext {
  makeRequest<T = unknown>(endpoint: string, method?: string, body?: unknown): Promise<T>;
}

export interface FormsToolResult {
  content: Array<{ type: "text"; text: string }>;
}

export interface CreateFormArgs {
  title: string;
  description?: string;
  fields?: unknown[];
  settings?: Record<string, unknown>;
}

export async function createForm(ctx: FormsToolContext, args: unknown): Promise<FormsToolResult> {
  const { title, description, fields = [], settings = {} } = args as CreateFormArgs;

  const form = {
    title,
    description,
    fields,
    ...settings
  };

  const response = await ctx.makeRequest<IGravityForm>('/forms', 'POST', form);

  return {
    content: [
      {
        type: "text",
        text: `Form Created:\n${JSON.stringify(response, null, 2)}`
      }
    ]
  };
}

// update_form's core parameters (form_id/title/fields) are re-validated at runtime
// below (the zod schema only marks form_id required; title/fields are validated
// here so a full-replace update can never silently drop them) — they're typed
// `unknown` until checked, matching the untrusted-input pattern documented on
// templateManager.ts's IFieldLike/IFormLike. The remaining fields mirror the
// update_form zod schema (utils/toolSchemas.ts) directly, since they aren't
// re-validated here.
export interface UpdateFormArgs {
  form_id?: unknown;
  title?: unknown;
  fields?: unknown;
  description?: unknown;
  settings?: Record<string, unknown>;
  confirmations?: Record<string, unknown>;
  notifications?: Record<string, unknown>;
  validate_fields?: boolean;
  response_format?: string;
  debug?: boolean;
  [key: string]: unknown;
}

// A field entry from update_form's payload, validated only for its `type` key
// (used for the optional custom-field-type warning below). Unlike the canonical
// IGravityFormField, `id` isn't required here — update_form's fields array is
// arbitrary caller-supplied JSON, not a value already known to be a well-formed
// Gravity Forms field.
interface IUpdateFormFieldForValidation {
  type?: string;
  [key: string]: unknown;
}

function validateUpdateFormId(form_id: unknown): string {
  if (form_id === undefined || form_id === null) {
    throw new McpError(ErrorCode.InvalidParams, 'form_id is required');
  }
  if (typeof form_id !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'form_id must be a string');
  }
  if (form_id.trim() === '') {
    throw new McpError(ErrorCode.InvalidParams, 'form_id must be a non-empty string');
  }
  return form_id;
}

function validateUpdateFormTitle(title: unknown): void {
  if (title === undefined || title === null) {
    throw new McpError(ErrorCode.InvalidParams, 'title is required');
  }
  if (typeof title !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'title must be a string');
  }
  if (title.trim() === '') {
    throw new McpError(ErrorCode.InvalidParams, 'title must be a non-empty string');
  }
}

function validateUpdateFormFieldsPresence(fields: unknown): void {
  if (fields === undefined || fields === null) {
    throw new McpError(ErrorCode.InvalidParams, 'fields is required');
  }
  if (!Array.isArray(fields)) {
    throw new McpError(ErrorCode.InvalidParams, 'fields must be an array');
  }
}

// Warns (via debug logging only, never throws) about field types outside the
// known Gravity Forms set — custom field types are legitimate, so this is
// advisory, not validation.
function warnUnknownFieldTypes(fields: unknown, debug: boolean): void {
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

  const fieldsToValidate = fields as IUpdateFormFieldForValidation[];

  for (const field of fieldsToValidate) {
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
    console.error(`[UPDATE_FORM_DEBUG] Field validation passed for ${fieldsToValidate.length} fields`);
  }
}

interface IUpdateFormBodyInputs {
  finalTitle: unknown;
  finalFields: unknown;
  finalDescription: unknown;
  finalSettings: Record<string, unknown> | undefined;
  finalConfirmations: Record<string, unknown> | undefined;
  finalNotifications: Record<string, unknown> | undefined;
  rest: Record<string, unknown>;
}

function buildUpdateFormBody(inputs: IUpdateFormBodyInputs): Record<string, unknown> {
  const { finalTitle, finalFields, finalDescription, finalSettings, finalConfirmations, finalNotifications, rest } = inputs;

  const formUpdateData: Record<string, unknown> = {
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

  return formUpdateData;
}

// Formats the updated-form response text per the requested response_format.
function formatUpdateFormResponseText(response: IGravityForm, response_format: string): string {
  switch (response_format) {
    case 'minimal':
      return `Form ${response.id} updated successfully`;

    case 'compact': {
      let responseText = `Form updated successfully\nID: ${response.id}\nTitle: ${response.title}`;
      if (response.description) {
        responseText += `\nDescription: ${response.description}`;
      }
      if (response.fields && response.fields.length > 0) {
        responseText += `\nFields: ${response.fields.length} field(s)`;
      }
      return responseText;
    }

    case 'detailed':
    default:
      return `Successfully updated form:\n${JSON.stringify(response, null, 2)}`;
  }
}

export async function updateForm(ctx: FormsToolContext, args: unknown): Promise<FormsToolResult> {
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
  } = args as UpdateFormArgs;

  // Start timing for debug
  const startTime = debug ? Date.now() : 0;

  if (debug) {
    console.error('[UPDATE_FORM_DEBUG] Starting form update');
    console.error(`[UPDATE_FORM_DEBUG] form_id: ${String(form_id)}`);
    console.error(`[UPDATE_FORM_DEBUG] validate_fields: ${String(validate_fields)}`);
    console.error(`[UPDATE_FORM_DEBUG] response_format: ${response_format}`);
  }

  // Validate form_id (always required)
  const validFormId = validateUpdateFormId(form_id);

  const finalTitle = title;
  const finalFields = fields;
  const finalDescription = description;
  const finalSettings = settings;
  const finalConfirmations = confirmations;
  const finalNotifications = notifications;

  // Full updates require title and fields
  validateUpdateFormTitle(title);
  validateUpdateFormFieldsPresence(fields);

  // Validate field types if requested
  if (validate_fields && finalFields) {
    warnUnknownFieldTypes(finalFields, debug);
  }

  // Build the request body
  const formUpdateData = buildUpdateFormBody({
    finalTitle,
    finalFields,
    finalDescription,
    finalSettings,
    finalConfirmations,
    finalNotifications,
    rest
  });

  if (debug) {
    console.error(`[UPDATE_FORM_DEBUG] Request body size: ${JSON.stringify(formUpdateData).length} characters`);
  }

  // Make the PUT request to update the form
  const response = await ctx.makeRequest<IGravityForm>(`/forms/${validFormId}`, 'PUT', formUpdateData);

  if (debug) {
    const endTime = Date.now();
    console.error(`[UPDATE_FORM_DEBUG] Update completed in ${endTime - startTime}ms`);
  }

  // Format response based on requested format
  const responseText = formatUpdateFormResponseText(response, response_format);

  return {
    content: [
      {
        type: "text",
        text: responseText
      }
    ]
  };
}
