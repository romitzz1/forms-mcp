// ABOUTME: Token/size estimation and summarization helpers for large entries/forms
// ABOUTME: Extracted from GravityFormsMCPServer to prevent context overflow in responses

import type { GfFieldValue, IGravityEntry, IGravityForm } from "./gravityFormsTypes.js";

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
export function estimateEntriesResponseSize(entries: IGravityEntry[]): number {
  if (!entries || entries.length === 0) return 0;

  // Sample first few entries to estimate average size
  const sampleSize = Math.min(3, entries.length);
  let totalSampleSize = 0;

  for (let i = 0; i < sampleSize; i++) {
    try {
      // Sample with indent-2 to match the ACTUAL response, which is emitted via
      // JSON.stringify(processedEntries, null, 2). Sampling compact JSON here undercounts
      // pretty-printed output by 30-50% for entries with many fields, so the size guard
      // could classify a payload as 'full' that actually overflows the token budget (audit A11).
      const entryJson = JSON.stringify(entries[i], null, 2);
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

// Per-field character cap for summary mode. Real Gravity Forms answers (choices,
// short text, name parts, dates) sit well under this, so they are kept verbatim.
// Only genuinely long free-text values exceed it and are truncated — never dropped.
const MAX_SUMMARY_FIELD_VALUE_LENGTH = 200;

// A field-value key on a Gravity Forms entry is the numeric field id, optionally with
// a composite sub-input suffix (e.g. "1", "1.3", "73.2"). Everything else (id, status,
// date_created, source_url, ...) is entry metadata.
function isFieldValueKey(key: string): boolean {
  return /^\d+(\.\d+)?$/.test(key);
}

// Manifest recorded on a summary when one or more field values were too long
// to keep verbatim — lists which keys were shortened so a consumer knows to
// re-fetch them in full mode.
interface ITruncationManifest {
  truncated_fields: string[];
  note: string;
}

// The shape returned by createEntrySummary: a handful of typed metadata keys,
// plus arbitrary field-value keys (numeric field ids) carrying either the
// original entry value or a truncated string, and an optional truncation
// manifest under `_summary`.
export interface IEntrySummary {
  id?: string;
  form_id?: string;
  date_created?: string;
  status?: string;
  payment_status?: string;
  _summary?: ITruncationManifest;
  [key: string]: GfFieldValue | Record<string, unknown> | ITruncationManifest | undefined;
}

/**
 * Create a compact-but-complete summary of an entry for context-limited responses.
 *
 * Summary mode keeps EVERY populated field value, just in a smaller shape:
 * short values are copied verbatim, and only individually oversized free-text
 * values are truncated (with a marker) rather than dropped. Any truncated field
 * is recorded under `_summary.truncated_fields` so a consumer can re-fetch it in
 * full mode. Empty/whitespace-only field values are omitted (no data lost — there
 * was no answer). This prevents the silent data loss that the old size-gated
 * filter caused for wide entries.
 */
export function createEntrySummary(entry: IGravityEntry): IEntrySummary {
  const summary: IEntrySummary = {};

  if (!entry || typeof entry !== 'object') return summary;

  // Essential metadata (always included when present).
  if (entry.id !== undefined) summary.id = entry.id;
  if (entry.form_id !== undefined) summary.form_id = entry.form_id;
  if (entry.date_created !== undefined) summary.date_created = entry.date_created;
  if (entry.status !== undefined) summary.status = entry.status;
  if (entry.payment_status !== undefined) summary.payment_status = entry.payment_status;

  // Every populated field value is preserved. Oversized values are truncated and
  // recorded, never silently discarded.
  const truncatedFields: string[] = [];
  Object.keys(entry).forEach(key => {
    if (!isFieldValueKey(key)) return;

    const value = entry[key];
    if (value == null) return;

    // Field-value keys (matched by isFieldValueKey) are always GfFieldValue in
    // practice; IGravityEntry's index signature also allows Record<string, unknown>
    // for other, non-numeric entry keys. Narrow here so String() has a meaningful
    // (non-default-Object) stringification — behavior is unchanged either way.
    const stringValue = String(value as GfFieldValue);
    if (stringValue.trim() === '') return; // Unanswered — omit, not lost.

    if (stringValue.length <= MAX_SUMMARY_FIELD_VALUE_LENGTH) {
      summary[key] = value;
    } else {
      const omitted = stringValue.length - MAX_SUMMARY_FIELD_VALUE_LENGTH;
      summary[key] = `${stringValue.slice(0, MAX_SUMMARY_FIELD_VALUE_LENGTH)}…[truncated ${omitted} chars]`;
      truncatedFields.push(key);
    }
  });

  if (truncatedFields.length > 0) {
    summary._summary = {
      truncated_fields: truncatedFields,
      note: 'Long field values were truncated in summary mode. Re-fetch with response_mode:"full" for their complete values.'
    };
  }

  return summary;
}

/**
 * Create a summary of a large form object to prevent context overflow
 */
export function createFormSummary(form: IGravityForm): string {
  // `entries` isn't part of the canonical form shape — some Gravity Forms API
  // responses carry it as an entry count (string/number) rather than an array
  // of entry objects. Read it through a duck-typed view so `.length` mirrors
  // whatever the original untyped code saw at runtime (a string/array's
  // character/element count, or `undefined` for a bare number).
  const rawEntries = form.entries as { length?: number } | null | undefined;

  const summary = {
    id: form.id,
    title: form.title,
    description: form.description,
    is_active: form.is_active,
    is_trash: form.is_trash,
    date_created: form.date_created,
    field_count: form.fields ? form.fields.length : 0,
    entry_count: rawEntries ? rawEntries.length : 0,
    has_conditional_logic: form.fields ? form.fields.some((f) => f.conditionalLogic) : false,
    has_calculations: form.fields ? form.fields.some((f) => f.calculations) : false,
    notification_count: form.notifications ? Object.keys(form.notifications).length : 0,
    confirmation_count: form.confirmations ? Object.keys(form.confirmations).length : 0
  };

  return `LARGE FORM SUMMARY (${estimateTokenCount(JSON.stringify(form, null, 2))} estimated tokens):
${JSON.stringify(summary, null, 2)}

⚠️  This form is too large to display in full (>25k tokens). 
Use specific tools like get_entries or export_form_json for detailed access.
Consider using form templates or cloning for management.`;
}
