// ABOUTME: Entry-CRUD MCP tool handlers (submit_form, create_entry, update_entry, delete_entry)
// ABOUTME: Extracted from GravityFormsMCPServer to isolate handler logic from server infrastructure

export interface EntryToolContext {
  makeRequest<T = unknown>(endpoint: string, method?: string, body?: unknown): Promise<T>;
}

export interface EntryToolResult {
  content: Array<{ type: "text"; text: string }>;
}

// Falls back to `fallback` for any falsy value, matching the original `||`
// semantics (including an empty string) — `??` would only treat null/undefined
// as "missing" and is deliberately not used here.
function withFallback(value: string | undefined, fallback: string): string {
  if (value) {
    return value;
  }
  return fallback;
}

export interface SubmitFormArgs {
  form_id: string;
  field_values: Record<string, unknown>;
  source_page?: number;
  target_page?: number;
}

// The Gravity Forms submission response. `is_valid` arrives as either a real
// boolean or a stringified "true"/"false"/"1"/"0" depending on API path, so it's
// left as `unknown` and checked against every observed form below (unchanged
// from the original untyped comparisons).
interface ISubmissionResponse {
  is_valid?: unknown;
  entry_id?: string;
  validation_messages?: Record<string, string>;
  [key: string]: unknown;
}

export async function submitForm(ctx: EntryToolContext, args: unknown): Promise<EntryToolResult> {
  const { form_id, field_values, source_page = 1, target_page = 0 } = args as SubmitFormArgs;

  const submission = {
    ...field_values,
    source_page,
    target_page
  };

  const response = await ctx.makeRequest<ISubmissionResponse>(`/forms/${form_id}/submissions`, 'POST', submission);

  // Parse success/failure for clear AI-readable status
  const isValid = response?.is_valid;
  let statusLine: string;
  if (isValid === true || isValid === 'true' || isValid === '1') {
    statusLine = `Submission successful! Entry ID: ${withFallback(response.entry_id, 'unknown')}`;
  } else if (isValid === false || isValid === 'false' || isValid === '0') {
    const validationMessages = response?.validation_messages;
    const errorDetails = validationMessages
      ? Object.entries(validationMessages).map(([field, msg]) => `  - Field ${field}: ${msg}`).join('\n')
      : '  (no details provided)';
    statusLine = `Submission failed - validation errors:\n${errorDetails}`;
  } else {
    statusLine = 'Form Submission Result:';
  }

  return {
    content: [
      {
        type: "text",
        text: `${statusLine}\n\n${JSON.stringify(response, null, 2)}`
      }
    ]
  };
}

export interface CreateEntryArgs {
  form_id: string;
  field_values: Record<string, unknown>;
  entry_meta?: Record<string, unknown>;
}

export async function createEntry(ctx: EntryToolContext, args: unknown): Promise<EntryToolResult> {
  const { form_id, field_values, entry_meta = {} } = args as CreateEntryArgs;

  const entry = {
    form_id: form_id,
    ...field_values,
    ...entry_meta
  };

  const response = await ctx.makeRequest<unknown>('/entries', 'POST', entry);

  return {
    content: [
      {
        type: "text",
        text: `Entry Created:\n${JSON.stringify(response, null, 2)}`
      }
    ]
  };
}

export interface UpdateEntryArgs {
  entry_id: string;
  field_values: Record<string, unknown>;
}

export async function updateEntry(ctx: EntryToolContext, args: unknown): Promise<EntryToolResult> {
  const { entry_id, field_values } = args as UpdateEntryArgs;

  const response = await ctx.makeRequest<unknown>(`/entries/${entry_id}`, 'PUT', field_values);

  return {
    content: [
      {
        type: "text",
        text: `Entry Updated:\n${JSON.stringify(response, null, 2)}`
      }
    ]
  };
}

export interface DeleteEntryArgs {
  entry_id: string;
  force?: boolean;
}

export async function deleteEntry(ctx: EntryToolContext, args: unknown): Promise<EntryToolResult> {
  const { entry_id, force = false } = args as DeleteEntryArgs;

  const endpoint = force ? `/entries/${entry_id}?force=true` : `/entries/${entry_id}`;
  const response = await ctx.makeRequest<unknown>(endpoint, 'DELETE');

  return {
    content: [
      {
        type: "text",
        text: `Entry ${force ? 'Permanently Deleted' : 'Moved to Trash'}:\n${JSON.stringify(response, null, 2)}`
      }
    ]
  };
}
