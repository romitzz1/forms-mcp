// ABOUTME: Token/size estimation and summarization helpers for large entries/forms
// ABOUTME: Extracted from GravityFormsMCPServer to prevent context overflow in responses

/**
 * Estimate token count for a string (rough approximation: 1 token ≈ 4 characters)
 */
export function estimateTokenCount(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Efficiently estimate response size without full JSON generation
 */
export function estimateEntriesResponseSize(entries: any[]): number {
  if (!entries || entries.length === 0) return 0;

  // Sample first few entries to estimate average size
  const sampleSize = Math.min(3, entries.length);
  let totalSampleSize = 0;

  for (let i = 0; i < sampleSize; i++) {
    try {
      const entryJson = JSON.stringify(entries[i]);
      totalSampleSize += entryJson.length;
    } catch {
      // Fallback: estimate by field count and typical values
      const fieldCount = Object.keys(entries[i] ?? {}).length;
      totalSampleSize += fieldCount * 50; // Rough average per field
    }
  }

  const averageEntrySize = totalSampleSize / sampleSize;
  const estimatedTotalSize = averageEntrySize * entries.length;

  // Add overhead for JSON formatting: "Entries:\n" + array brackets + indentation
  const overhead = 50 + (entries.length * 10); // Rough formatting overhead

  return Math.ceil((estimatedTotalSize + overhead) / 4); // Convert to tokens
}

/**
 * Create a summary of a large entry object to prevent context overflow
 */
export function createEntrySummary(entry: any): any {
  const summary: any = {};

  // Essential fields (always included)
  if (entry.id !== undefined) summary.id = entry.id;
  if (entry.form_id !== undefined) summary.form_id = entry.form_id;
  if (entry.date_created !== undefined) summary.date_created = entry.date_created;
  if (entry.payment_status !== undefined) summary.payment_status = entry.payment_status;

  // Name fields - detect dynamically using Gravity Forms sub-field conventions
  // X.3 = first name, X.6 = last name (universal pattern for all GF name fields)
  const nameFields: string[] = [];
  Object.keys(entry).forEach(key => {
    if (key.includes('.') && (key.endsWith('.3') || key.endsWith('.6'))) {
      nameFields.push(key);
    }
  });
  nameFields.forEach(fieldId => {
    if (entry[fieldId] !== undefined) {
      summary[fieldId] = entry[fieldId];
    }
  });

  // Email fields - detect dynamically using Gravity Forms email field patterns.
  // Constrain to short, single-token values so free-text prose that merely
  // contains an "@" (e.g. "email me @ the rink.") is not copied wholesale into
  // the summary, which would defeat this function's response-size reduction.
  Object.keys(entry).forEach(key => {
    const value = entry[key];
    if (
      typeof value === 'string' &&
      value.length < 100 &&
      !value.includes(' ') &&
      value.includes('@') &&
      value.includes('.')
    ) {
      summary[key] = value;
    }
  });

  // Include other small text fields if entry is small overall
  let entrySize = 0;
  try {
    const entryJson = JSON.stringify(entry);
    entrySize = entryJson.length;
  } catch {
    // If JSON.stringify fails (circular references, etc.), estimate size by field count
    entrySize = Object.keys(entry).length * 100; // Conservative estimate
  }

  if (entrySize < 2000) {
    // Entry is small, include more fields
    Object.keys(entry).forEach(key => {
      if (summary[key] === undefined && entry[key] != null) {
        const fieldValue = String(entry[key]);
        if (fieldValue.length < 200 && fieldValue !== 'undefined') { // Only include short, valid field values
          summary[key] = entry[key];
        }
      }
    });
  }

  return summary;
}

/**
 * Create a summary of a large form object to prevent context overflow
 */
export function createFormSummary(form: any): string {
  const summary = {
    id: form.id,
    title: form.title,
    description: form.description,
    is_active: form.is_active,
    is_trash: form.is_trash,
    date_created: form.date_created,
    field_count: form.fields ? form.fields.length : 0,
    entry_count: form.entries ? form.entries.length : 0,
    has_conditional_logic: form.fields ? form.fields.some((f: any) => f.conditionalLogic) : false,
    has_calculations: form.fields ? form.fields.some((f: any) => f.calculations) : false,
    notification_count: form.notifications ? Object.keys(form.notifications).length : 0,
    confirmation_count: form.confirmations ? Object.keys(form.confirmations).length : 0
  };

  return `LARGE FORM SUMMARY (${estimateTokenCount(JSON.stringify(form, null, 2))} estimated tokens):
${JSON.stringify(summary, null, 2)}

⚠️  This form is too large to display in full (>25k tokens). 
Use specific tools like get_entries or export_form_json for detailed access.
Consider using form templates or cloning for management.`;
}
