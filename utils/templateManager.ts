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
    [key: string]: any;
  }>;
  date_created?: string;
  [key: string]: any;
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

// Type for API call function
type ApiCallFunction = (endpoint: string) => Promise<any>;

export class TemplateManager {
  private apiCall?: ApiCallFunction;

  constructor(apiCall?: ApiCallFunction) {
    this.apiCall = apiCall;
  }

  /**
   * Checks if a form is a template based on its title
   * Templates must have titles ending with '-template'
   */
  isTemplate(form: any): boolean {
    if (!form || typeof form !== 'object' || typeof form.title !== 'string') {
      return false;
    }

    return form.title.endsWith('-template');
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
  validateTemplateStructure(form: any): boolean {
    if (!form || typeof form !== 'object') {
      return false;
    }

    // Must have fields array
    if (!Array.isArray(form.fields)) {
      return false;
    }

    // Must have at least one field
    if (form.fields.length === 0) {
      return false;
    }

    // Each field must have required properties
    for (const field of form.fields) {
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
   * Lists all available form templates
   * Filters forms to only include valid templates
   */
  async listTemplates(): Promise<TemplateInfo[]> {
    if (!this.apiCall) {
      throw new Error('API call function not provided to TemplateManager');
    }

    try {
      // Fetch all forms from the API
      const forms = await this.apiCall('/forms');

      if (!Array.isArray(forms)) {
        return [];
      }

      // Filter and validate templates
      const templates: TemplateInfo[] = [];

      for (const form of forms) {
        // Check if it's a template and has valid structure
        if (this.isTemplate(form) && this.validateTemplateStructure(form)) {
          templates.push({
            id: form.id,
            name: form.title,
            description: form.description || '',
            field_count: form.fields.length,
            created_date: form.date_created || ''
          });
        }
      }

      return templates;
    } catch (error) {
      // Re-throw the error to let the caller handle it
      throw error;
    }
  }
}