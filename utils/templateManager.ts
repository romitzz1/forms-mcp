// ABOUTME: Template management utilities for Gravity Forms MCP server
// ABOUTME: Handles template identification, validation, and listing functionality

// Base form structure from Gravity Forms API
interface BaseForm {
  id: string;
  title: string;
  description?: string;
  fields: Array<{
    id: string;
    type: string;
    label: string;
    [key: string]: unknown;
  }>;
  date_created?: string;
  [key: string]: unknown;
}

// Extended form interface with template metadata
export interface FormTemplate extends BaseForm {
  is_template: true;
  template_metadata?: {
    original_form_id?: string;
    created_from_template?: boolean;
    template_version?: string;
  };
}

// Template information for listing
export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  field_count: number;
  created_date: string;
}

// Options for creating forms from templates
export interface TemplateCreateOptions {
  new_name: string;
  field_renames?: Array<{
    original_label: string;
    new_label: string;
  }>;
  preserve_logic?: boolean;
}

// A field within a form-like object passed to TemplateManager. Kept loosely typed
// (rather than the canonical IGravityFormField) because validateTemplateStructure's
// whole job is checking whether arbitrary/untrusted data has valid-looking fields.
export interface IFieldLike {
  id?: unknown;
  type?: unknown;
  label?: unknown;
  [key: string]: unknown;
}

// A form-like object accepted by TemplateManager. Callers pass real Gravity Forms
// API responses, FormCache-derived records (id can arrive as a number, plus
// cache-only fields like last_synced/form_data), or arbitrary external input for
// validation — hence the permissive property types instead of the canonical
// IGravityForm (whose `id`/`title` are required strings).
export interface IFormLike {
  id?: string | number;
  title?: unknown;
  description?: string;
  fields?: IFieldLike[];
  date_created?: string | null;
  last_synced?: string;
  form_data?: string;
  [key: string]: unknown;
}

// Type for API call function
type ApiCallFunction = (endpoint: string) => Promise<IFormLike[]>;

export class TemplateManager {
  private readonly apiCall?: ApiCallFunction;

  constructor(apiCall?: ApiCallFunction) {
    this.apiCall = apiCall;
  }

  /**
   * Checks if a form is a template based on its title
   * Templates must have titles ending with '-template'
   */
  isTemplate(form: unknown): boolean {
    if (!form || typeof form !== 'object') {
      return false;
    }

    const title = (form as IFormLike).title;
    if (typeof title !== 'string') {
      return false;
    }

    return title.endsWith('-template');
  }

  /**
   * Generates a template name by adding '-template' suffix
   * Avoids double-adding the suffix
   */
  generateTemplateName(baseName: string | null | undefined): string {
    // Handle null/undefined/empty cases
    if (!baseName || baseName.trim() === '') {
      return 'untitled-template';
    }

    if (baseName.endsWith('-template')) {
      return baseName;
    }

    return `${baseName}-template`;
  }

  /**
   * Validates that a form has proper template structure
   * Must have fields array with at least one valid field
   */
  validateTemplateStructure(form: unknown): boolean {
    if (!form || typeof form !== 'object') {
      return false;
    }

    const f = form as IFormLike;

    // Must have fields array
    if (!Array.isArray(f.fields)) {
      return false;
    }

    // Must have at least one field
    if (f.fields.length === 0) {
      return false;
    }

    // Each field must have required properties
    for (const field of f.fields) {
      if (!field || typeof field !== 'object') {
        return false;
      }

      if (!field.id || !field.type || !field.label) {
        return false;
      }
    }

    return true;
  }

  /**
   * Resolves the forms to scan for templates: the caller-provided cached array
   * when given, otherwise a fresh API fetch (original behavior).
   */
  private async resolveFormsToProcess(forms?: IFormLike[] | null): Promise<IFormLike[]> {
    if (forms !== undefined && forms !== null) {
      // Use provided cached forms
      return Array.isArray(forms) ? forms : [];
    }

    // Fetch from API (original behavior)
    if (!this.apiCall) {
      throw new Error('API call function not provided to TemplateManager');
    }

    const apiResponse = await this.apiCall('/forms');
    return Array.isArray(apiResponse) ? apiResponse : [];
  }

  // Resolves a cached-form-vs-parsed-form_data id fallback chain. Written with
  // explicit `if`s (not `||`) because '' is a legitimate id and must NOT be
  // treated as "missing" the way `??` would require — this mirrors the original
  // `formData.id || form.id || ''` exactly.
  private resolveTemplateId(formData: IFormLike, form: IFormLike): string {
    if (formData.id) return String(formData.id);
    if (form.id) return String(form.id);
    return '';
  }

  // formData.title is guaranteed a non-empty string by the time this runs
  // (isTemplate already checked it), so the form.title/'' fallbacks below never
  // actually fire — they're kept only for parity with the original defensive
  // `formData.title || form.title || ''` chain.
  private resolveTemplateName(formData: IFormLike, form: IFormLike): string {
    if (typeof formData.title === 'string' && formData.title !== '') return formData.title;
    if (typeof form.title === 'string' && form.title !== '') return form.title;
    return '';
  }

  // '' is a legitimate description and must fall through to the next candidate,
  // same as `formData.description || form.description || ''` — an explicit `if`
  // preserves that without tripping prefer-nullish-coalescing.
  private resolveTemplateDescription(formData: IFormLike, form: IFormLike): string {
    if (formData.description) return formData.description;
    if (form.description) return form.description;
    return '';
  }

  // Same empty-string-falls-through shape as the id/name/description resolvers
  // above, for `formData.date_created || form.date_created || form.last_synced || ''`.
  private resolveTemplateCreatedDate(formData: IFormLike, form: IFormLike): string {
    if (formData.date_created) return formData.date_created;
    if (form.date_created) return form.date_created;
    if (form.last_synced) return form.last_synced;
    return '';
  }

  // Parses form_data (when present) into the working form-data object for a
  // listTemplates candidate. Returns null when form_data is present but isn't
  // valid JSON, signaling the caller to skip this form.
  private resolveFormData(form: IFormLike): IFormLike | null {
    if (!form.form_data || typeof form.form_data !== 'string') {
      return form;
    }

    try {
      return JSON.parse(form.form_data) as IFormLike;
    } catch {
      return null;
    }
  }

  /**
   * Builds the TemplateInfo entry for a single candidate form, or null if it
   * isn't a valid template (invalid form_data JSON, not template-titled, or
   * missing a valid field structure).
   */
  private buildTemplateInfo(form: IFormLike): TemplateInfo | null {
    // For cached forms, we may need to parse form_data if it exists
    let formData = this.resolveFormData(form);
    if (!formData) {
      // Skip forms with invalid JSON in form_data
      return null;
    }

    // If this looks like a cached form without parsed form_data, and it has a template title,
    // create minimal structure to allow template validation (only for forms from cache)
    if (!formData.fields && this.isTemplate(formData) && 'last_synced' in form) {
      formData = {
        ...formData,
        fields: [{ id: '1', type: 'text', label: 'Placeholder Field' }]
      };
    }

    // Check if it's a template and has valid structure
    if (this.isTemplate(formData) && this.validateTemplateStructure(formData)) {
      return {
        id: this.resolveTemplateId(formData, form),
        name: this.resolveTemplateName(formData, form),
        description: this.resolveTemplateDescription(formData, form),
        field_count: formData.fields?.length ?? 0,
        created_date: this.resolveTemplateCreatedDate(formData, form)
      };
    }

    return null;
  }

  /**
   * Lists all available form templates
   * Can work with cached forms array or fetch from API
   * @param forms - Optional cached forms array. If provided, uses cache instead of API
   */
  async listTemplates(forms?: IFormLike[] | null): Promise<TemplateInfo[]> {
    const formsToProcess = await this.resolveFormsToProcess(forms);

    const templates: TemplateInfo[] = [];
    for (const form of formsToProcess) {
      const templateInfo = this.buildTemplateInfo(form);
      if (templateInfo) {
        templates.push(templateInfo);
      }
    }

    return templates;
  }
}