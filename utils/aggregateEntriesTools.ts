// ABOUTME: Aggregate-entries MCP tool handler (aggregate_entries): tallies field-value
// ABOUTME: distributions across a form's entries so a survey can be summarized in one call.

import type { IGfEntriesResponse, IGravityEntry, IGravityForm } from "./gravityFormsTypes.js";

export interface AggregateEntriesToolContext {
  makeRequest<T = unknown>(endpoint: string, method?: string, body?: unknown): Promise<T>;
}

export interface AggregateEntriesArgs {
  form_id?: string;
  field_ids?: unknown;
  search?: unknown;
  max_entries?: unknown;
  top?: unknown;
}

export interface AggregateEntriesResult {
  content: Array<{ type: "text"; text: string }>;
}

interface FieldTally {
  field_id: string;
  label: string;
  total_responses: number; // entries with at least one non-empty value for this field
  distinct_values: number;
  distribution: Array<{ value: string; count: number }>;
}

const DEFAULT_MAX_ENTRIES = 1000;
const PAGE_SIZE = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Routes String() through a plain-`unknown` parameter so a truthy-narrowed call
// site doesn't resolve to a type whose only toString is Object's default
// ('[object Object]'), while producing an identical result to a direct String() call.
function stringifyValue(value: unknown): string {
  return String(value).trim();
}

// A single field_filters entry. The Zod schema types `search` as an opaque
// record (arbitrary client input), so only the fields actually read here are
// named; everything else is opaque and preserved via the index signature.
interface IRawFieldFilter {
  key?: unknown;
  value?: unknown;
  operator?: unknown;
  [key: string]: unknown;
}

function isFieldFilterCandidate(filter: unknown): filter is IRawFieldFilter {
  return isRecord(filter);
}

// Field-value keys are the numeric field id, optionally with a composite sub-input
// suffix (e.g. "12", "12.1"). Escaping keeps the id safe inside the RegExp even
// though ids are numeric today.
function fieldKeyMatcher(fieldId: string): RegExp {
  const escaped = fieldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(\\.\\d+)?$`);
}

// Build the GF `search` object from the optional filter. Aggregation supports the
// two filters that matter for a distribution: entry status and field_filters.
function buildSearchObject(search: unknown): Record<string, unknown> {
  const searchObject: Record<string, unknown> = {};
  if (!isRecord(search)) return searchObject;

  if (search.status) {
    searchObject.status = stringifyValue(search.status);
  }

  if (Array.isArray(search.field_filters)) {
    const validFilters = search.field_filters
      .filter((filter): filter is IRawFieldFilter => isFieldFilterCandidate(filter) && filter.key != null && filter.value != null)
      .map((filter) => {
        const key = stringifyValue(filter.key);
        const value = stringifyValue(filter.value);
        const operator = filter.operator ? stringifyValue(filter.operator) : '=';
        return key !== '' ? { key, value, operator } : null;
      })
      .filter((filter): filter is { key: string; value: string; operator: string } => filter !== null);
    if (validFilters.length > 0) {
      searchObject.field_filters = validFilters;
    }
  }

  return searchObject;
}

// Page through the form's entries until exhausted or maxEntries is reached.
async function fetchEntries(
  ctx: AggregateEntriesToolContext,
  formId: string,
  search: unknown,
  maxEntries: number
): Promise<{ entries: IGravityEntry[]; capped: boolean }> {
  const collected: IGravityEntry[] = [];
  const searchObject = buildSearchObject(search);
  let page = 1;
  let totalCount: number | undefined;

  while (collected.length < maxEntries) {
    const params = new URLSearchParams();
    if (Object.keys(searchObject).length > 0) {
      params.append('search', JSON.stringify(searchObject));
    }
    params.append('paging[page_size]', String(PAGE_SIZE));
    params.append('paging[current_page]', String(page));

    const response = await ctx.makeRequest<IGfEntriesResponse | IGravityEntry[] | undefined>(`/forms/${formId}/entries?${params.toString()}`);
    // response may be an enveloped { entries, total_count } object OR a bare array
    // (backward compatibility). isRecord() treats both objects and arrays as records
    // so a bare-array response's `.entries` access below behaves exactly as it did
    // when this code was untyped (arrays don't have a meaningful `.entries` data
    // property, so the `??` fallback below still applies).
    const responseRecord = isRecord(response) ? response : undefined;
    if (totalCount === undefined && responseRecord?.total_count !== undefined) {
      const parsed = Number(responseRecord.total_count);
      if (Number.isFinite(parsed)) totalCount = parsed;
    }
    const batch = responseRecord?.entries ?? (Array.isArray(response) ? response : []);
    if (!Array.isArray(batch) || batch.length === 0) break;

    collected.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    page++;
  }

  const entries = collected.slice(0, maxEntries);
  // "capped" means the scan stopped before covering every entry. Prefer the API's
  // total_count for a precise answer (it stays correct even when maxEntries falls on
  // a page boundary); fall back to "we filled up to the cap" when it isn't reported.
  const capped = totalCount !== undefined
    ? totalCount > entries.length
    : collected.length >= maxEntries;
  return { entries, capped };
}

// Map field id -> label from a form definition, so tallies read as questions
// rather than bare ids.
function buildLabelMap(form: IGravityForm): Record<string, string> {
  const labels: Record<string, string> = {};
  const fields = Array.isArray(form.fields) ? form.fields : [];
  for (const field of fields) {
    if (field.id != null && field.label) {
      labels[String(field.id)] = String(field.label);
    }
  }
  return labels;
}

function tallyField(fieldId: string, entries: IGravityEntry[], label: string | undefined, top?: unknown): FieldTally {
  const counts = new Map<string, number>();
  const matcher = fieldKeyMatcher(fieldId);
  let totalResponses = 0;

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    let entryHasValue = false;
    for (const [key, value] of Object.entries(entry)) {
      if (!matcher.test(key)) continue;
      if (value == null) continue;
      const trimmed = stringifyValue(value);
      if (trimmed === '') continue;
      counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
      entryHasValue = true;
    }
    if (entryHasValue) totalResponses++;
  }

  let distribution = Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  const distinctValues = distribution.length;
  if (typeof top === 'number' && top > 0) {
    distribution = distribution.slice(0, top);
  }

  return {
    field_id: fieldId,
    label: label ?? `Field ${fieldId}`,
    total_responses: totalResponses,
    distinct_values: distinctValues,
    distribution
  };
}

export async function aggregateEntries(ctx: AggregateEntriesToolContext, args: AggregateEntriesArgs): Promise<AggregateEntriesResult> {
  const { form_id, field_ids, search, max_entries = DEFAULT_MAX_ENTRIES, top } = args;

  if (!form_id) {
    return {
      content: [{ type: "text", text: "form_id is required to aggregate entries." }]
    };
  }

  const fieldIds: string[] = Array.isArray(field_ids) ? field_ids.map((id: unknown) => String(id)) : [];
  if (fieldIds.length === 0) {
    return {
      content: [{
        type: "text",
        text: "No field_ids provided. Specify which field IDs to tally (use get_field_mappings to discover them)."
      }]
    };
  }

  const maxEntries = typeof max_entries === 'number' && max_entries > 0 ? max_entries : DEFAULT_MAX_ENTRIES;
  const { entries, capped } = await fetchEntries(ctx, form_id, search, maxEntries);

  if (entries.length === 0) {
    return {
      content: [{ type: "text", text: `No entries found for form ${form_id}. Nothing to aggregate.` }]
    };
  }

  // Field labels are a best-effort enhancement; a failed lookup just falls back to ids.
  let labels: Record<string, string> = {};
  try {
    const form = await ctx.makeRequest<IGravityForm>(`/forms/${form_id}`);
    labels = buildLabelMap(form);
  } catch {
    labels = {};
  }

  const tallies = fieldIds.map(fid => tallyField(fid, entries, labels[fid], top));

  let text = `📊 Aggregation for form ${form_id} — ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} scanned`;
  if (capped) {
    text += `\n⚠️  Scan capped at max_entries=${maxEntries}; distribution may be partial. Raise max_entries to scan more.`;
  }
  text += `\n`;

  for (const tally of tallies) {
    text += `\nField ${tally.field_id} — "${tally.label}"\n`;
    if (tally.distribution.length === 0) {
      text += `  (no responses)\n`;
      continue;
    }
    for (const { value, count } of tally.distribution) {
      text += `  ${value}: ${count}\n`;
    }
    const shown = tally.distribution.length;
    const suffix = shown < tally.distinct_values ? ` (showing top ${shown} of ${tally.distinct_values})` : '';
    text += `  → ${tally.total_responses} responses, ${tally.distinct_values} distinct values${suffix}\n`;
  }

  text += `\n${JSON.stringify({ form_id: String(form_id), entries_scanned: entries.length, capped, fields: tallies }, null, 2)}`;

  return {
    content: [{ type: "text", text }]
  };
}
