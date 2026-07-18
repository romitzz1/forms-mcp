// ABOUTME: Canonical TypeScript types for the Gravity Forms REST API v2 domain
// ABOUTME: Single source of truth for form/field/entry shapes used across tool handlers

// Per GF REST API v2, entry field values arrive as strings; multi-input fields
// (checkboxes, multiselect) can arrive as string arrays. Unanswered = "" or absent.
export type GfFieldValue = string | string[] | null | undefined;

// A composite sub-input of a field (e.g. name first/last, address parts).
export interface IGravityFormInput {
  id: string; // e.g. "1.3"
  label?: string;
  name?: string;
  isHidden?: boolean;
  customLabel?: string;
}

// Choice option for choice-based fields (select, radio, checkbox).
export interface IGravityFormChoice {
  text?: string;
  value?: string;
  isSelected?: boolean;
}

// One field definition inside a form. GF returns many optional keys; the ones
// the handlers actually read are typed, the rest are permitted via the index
// signature so unknown-but-present keys do not force `any`.
export interface IGravityFormField {
  id: string | number;
  label?: string;
  type?: string;
  inputs?: IGravityFormInput[] | null;
  choices?: IGravityFormChoice[] | null;
  isRequired?: boolean;
  conditionalLogic?: unknown;
  calculations?: unknown;
  [key: string]: unknown;
}

// A form definition. Per the API, `id`/`is_active`/`is_trash` are strings.
export interface IGravityForm {
  id: string;
  title: string;
  description?: string;
  fields?: IGravityFormField[];
  is_active?: string;
  is_trash?: string;
  date_created?: string;
  notifications?: Record<string, unknown>;
  confirmations?: Record<string, unknown>;
  [key: string]: unknown;
}

// An entry. Known metadata keys are typed; numeric field-value keys (e.g. "1",
// "1.3", "73.2") plus any other server key are covered by the index signature.
export interface IGravityEntry {
  id?: string;
  form_id?: string;
  date_created?: string;
  date_updated?: string;
  status?: string;
  source_url?: string;
  payment_status?: string;
  created_by?: string;
  [fieldId: string]: GfFieldValue | Record<string, unknown>;
}

// The /entries endpoint response envelope.
export interface IGfEntriesResponse {
  entries: IGravityEntry[];
  total_count: number;
}
