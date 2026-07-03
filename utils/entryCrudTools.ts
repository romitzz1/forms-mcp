// ABOUTME: Entry-CRUD MCP tool handlers (submit_form, create_entry, update_entry, delete_entry)
// ABOUTME: Extracted from GravityFormsMCPServer to isolate handler logic from server infrastructure

export interface EntryToolContext {
  makeRequest(endpoint: string, method?: string, body?: unknown): Promise<any>;
}

export async function submitForm(ctx: EntryToolContext, args: any) {
  const { form_id, field_values, source_page = 1, target_page = 0 } = args;

  const submission = {
    ...field_values,
    source_page,
    target_page
  };

  const response = await ctx.makeRequest(`/forms/${form_id}/submissions`, 'POST', submission);

  // Parse success/failure for clear AI-readable status
  const isValid = response?.is_valid;
  let statusLine: string;
  if (isValid === true || isValid === 'true' || isValid === '1') {
    statusLine = `Submission successful! Entry ID: ${response.entry_id || 'unknown'}`;
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

export async function createEntry(ctx: EntryToolContext, args: any) {
  const { form_id, field_values, entry_meta = {} } = args;

  const entry = {
    form_id: form_id,
    ...field_values,
    ...entry_meta
  };

  const response = await ctx.makeRequest('/entries', 'POST', entry);

  return {
    content: [
      {
        type: "text",
        text: `Entry Created:\n${JSON.stringify(response, null, 2)}`
      }
    ]
  };
}

export async function updateEntry(ctx: EntryToolContext, args: any) {
  const { entry_id, field_values } = args;

  const response = await ctx.makeRequest(`/entries/${entry_id}`, 'PUT', field_values);

  return {
    content: [
      {
        type: "text",
        text: `Entry Updated:\n${JSON.stringify(response, null, 2)}`
      }
    ]
  };
}

export async function deleteEntry(ctx: EntryToolContext, args: any) {
  const { entry_id, force = false } = args;

  const endpoint = force ? `/entries/${entry_id}?force=true` : `/entries/${entry_id}`;
  const response = await ctx.makeRequest(endpoint, 'DELETE');

  return {
    content: [
      {
        type: "text",
        text: `Entry ${force ? 'Permanently Deleted' : 'Moved to Trash'}:\n${JSON.stringify(response, null, 2)}`
      }
    ]
  };
}
