// ABOUTME: Template & form-import MCP tool handlers (save_form_as_template, create_form_from_template, clone_form_with_modifications, import_form_json)
// ABOUTME: Extracted from GravityFormsMCPServer to isolate handler logic from server infrastructure

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { TemplateCreator } from "./templateCreator.js";
import type { TemplateModification } from "./templateCreator.js";
import type { FormImporter } from "./formImporter.js";
import type { IGravityForm, IGravityFormField } from "./gravityFormsTypes.js";
import type { TemplateManager } from "./templateManager.js";

export interface TemplateToolContext {
  makeRequest<T = unknown>(endpoint: string, method?: string, body?: unknown): Promise<T>;
  getTemplateManager(): TemplateManager;
  getFormImporter(): FormImporter;
}

export interface TemplateToolResult {
  content: Array<{ type: "text"; text: string }>;
}

export interface SaveFormAsTemplateArgs {
  form_id?: string;
  template_name?: string;
}

// A form definition mid-conversion into a template: cloned from the fetched
// `IGravityForm`, with runtime/metadata fields deleted and template-specific
// fields (is_template, template_metadata) added.
interface ITemplateFormData {
  id?: string;
  title?: string;
  date_created?: string;
  date_updated?: string;
  entries_count?: number;
  notifications?: unknown[];
  confirmations?: unknown[];
  is_template?: boolean;
  template_metadata?: {
    original_form_id?: string;
    created_from_form: boolean;
    created_at: string;
  };
  [key: string]: unknown;
}

export async function saveFormAsTemplate(ctx: TemplateToolContext, args: SaveFormAsTemplateArgs): Promise<TemplateToolResult> {
    try {
      // Validate required parameters
      const { form_id, template_name } = args;

      if (!form_id) {
        throw new McpError(ErrorCode.InvalidParams, 'form_id is required');
      }

      // Get TemplateManager (lazy initialization)
      const templateManager = ctx.getTemplateManager();

      // Fetch the source form
      const sourceForm = await ctx.makeRequest<IGravityForm>(`/forms/${form_id}`, 'GET');

      if (!sourceForm) {
        throw new McpError(ErrorCode.InvalidParams, `Form with ID ${form_id} not found`);
      }

      // Check if the source form is already a template
      if (templateManager.isTemplate(sourceForm)) {
        throw new McpError(ErrorCode.InvalidParams, `Form with ID ${form_id} is already a template`);
      }

      // Generate template name. '' is a legitimate (if unusual) explicit name and
      // distinct from "not provided" — an explicit `if` keeps that fall-through
      // without tripping prefer-nullish-coalescing (which only fires on null/undefined).
      let finalTemplateName = templateManager.generateTemplateName(sourceForm.title);
      if (template_name) {
        finalTemplateName = template_name;
      }

      // Check for name conflicts with existing templates
      const existingTemplates = await templateManager.listTemplates();
      const hasConflict = existingTemplates.some((template) => template.name === finalTemplateName);

      if (hasConflict) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Template name '${finalTemplateName}' already exists. Use a different name or rename the existing template first.`
        );
      }

      // Clone and sanitize the form data for template use
      const templateData = prepareTemplateData(sourceForm, finalTemplateName);

      // Create the template via API
      const createdTemplate = await ctx.makeRequest<{ id?: string }>('/forms', 'POST', templateData);

      // Prepare response
      const response = {
        success: true,
        template_id: createdTemplate.id,
        template_name: finalTemplateName,
        original_form_id: form_id
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2)
          }
        ]
      };

    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to save form as template: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

function prepareTemplateData(sourceForm: IGravityForm, templateName: string): ITemplateFormData {
    // Deep clone the source form to avoid mutation
    const templateData = JSON.parse(JSON.stringify(sourceForm)) as ITemplateFormData;

    // Remove form-specific properties
    delete templateData.id;
    delete templateData.date_created;
    delete templateData.date_updated;
    delete templateData.entries_count;

    // Clear form-specific data
    templateData.notifications = [];
    templateData.confirmations = [];

    // Set template-specific properties
    templateData.title = templateName;
    templateData.is_template = true;
    templateData.template_metadata = {
      original_form_id: sourceForm.id,
      created_from_form: true,
      created_at: new Date().toISOString()
    };

    return templateData;
  }

// A field-rename request as read off the raw args object — only validated to
// be an object at this point; `isValidFieldRenames` confirms the string fields.
interface IRawFieldRename {
  original_label?: unknown;
  new_label?: unknown;
  [key: string]: unknown;
}

export interface IFieldRenameArg {
  original_label: string;
  new_label: string;
}

function isFieldRenameCandidate(rename: unknown): rename is IRawFieldRename {
  return typeof rename === 'object' && rename !== null;
}

function isValidFieldRenames(value: unknown): value is IFieldRenameArg[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return !value.some((rename) => {
    if (!isFieldRenameCandidate(rename)) {
      return true;
    }
    return !rename.original_label || !rename.new_label ||
      typeof rename.original_label !== 'string' || typeof rename.new_label !== 'string';
  });
}

// A cloned/template-derived form as it exists mid-modification: `id` and every
// other runtime/metadata field are optional here (unlike the strict
// `IGravityForm`) since they get deleted or were never assigned by the clone.
interface IClonedTemplateForm {
  id?: string;
  title?: string;
  fields?: IGravityFormField[];
  is_template?: boolean;
  template_metadata?: unknown;
  [key: string]: unknown;
}

export interface CreateFormFromTemplateArgs {
  template_id?: string;
  new_form_title?: string;
  field_renames?: unknown;
}

export async function createFormFromTemplate(ctx: TemplateToolContext, args: CreateFormFromTemplateArgs): Promise<TemplateToolResult> {
    try {
      // Validate required parameters
      const { template_id, new_form_title, field_renames } = args;

      if (!template_id || typeof template_id !== 'string') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'template_id is required and must be a string'
        );
      }

      if (!new_form_title || typeof new_form_title !== 'string') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'new_form_title is required and must be a string'
        );
      }

      // Validate field_renames if provided
      if (field_renames && !isValidFieldRenames(field_renames)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'field_renames must be an array of objects with original_label and new_label string properties'
        );
      }

      // field_renames, when present, has already been confirmed valid above —
      // casting here documents that validated boundary.
      const validatedFieldRenames: IFieldRenameArg[] = (field_renames as IFieldRenameArg[] | undefined) ?? [];

      // Create TemplateCreator with API call function
      const templateCreator = new TemplateCreator((endpoint: string) => ctx.makeRequest(endpoint));

      // Prepare modifications for TemplateCreator
      const modifications: TemplateModification = {
        title: new_form_title,
        field_renames: validatedFieldRenames,
        preserve_logic: true
      };

      // Clone form from template with modifications
      const clonedForm = await templateCreator.cloneFromTemplate(template_id, modifications) as IClonedTemplateForm;

      // Remove template-specific properties to create a regular form
      delete clonedForm.is_template;
      delete clonedForm.template_metadata;

      // Create the new form via API
      const result = await ctx.makeRequest<IClonedTemplateForm>('/forms', 'POST', clonedForm);

      const response = {
        success: true,
        message: 'Form created successfully from template',
        form: {
          id: result.id,
          title: result.title,
          fields_count: result.fields ? result.fields.length : 0,
          template_id: template_id,
          applied_renames: validatedFieldRenames.length
        }
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2)
          }
        ]
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create form from template: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

export interface ImportFormJsonArgs {
  form_json?: string;
  force_import?: boolean;
  use_complete_discovery?: boolean;
}

export async function importFormJson(ctx: TemplateToolContext, args: ImportFormJsonArgs): Promise<TemplateToolResult> {
    try {
      // Validate required parameters
      const { form_json, force_import = false, use_complete_discovery = false } = args;

      if (!form_json || typeof form_json !== 'string' || form_json.trim() === '') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'form_json is required and must be a non-empty string'
        );
      }

      if (force_import !== undefined && typeof force_import !== 'boolean') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'force_import must be a boolean value'
        );
      }

      if (typeof use_complete_discovery !== 'boolean') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'use_complete_discovery must be a boolean value'
        );
      }

      // Use FormImporter to perform the import
      const formImporter = ctx.getFormImporter();
      const result = await formImporter.importForm(form_json, {
        force_import,
        useCompleteDiscovery: use_complete_discovery
      });

      if (!result.success) {
        throw new McpError(
          ErrorCode.InternalError,
          `Form import failed: ${result.errors ? result.errors.join(', ') : 'Unknown error'}`
        );
      }

      return {
        content: [
          {
            type: "text",
            text: `Form Import Results:\n${JSON.stringify(result, null, 2)}`
          }
        ]
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to import form from JSON: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

export interface CloneModificationsArg {
  title?: string;
  field_renames?: unknown;
}

export interface CloneFormWithModificationsArgs {
  source_form_id?: string;
  modifications?: CloneModificationsArg;
}

// A form definition mid-clone: `id` and the runtime/metadata fields are
// optional here since they get deleted before the clone is sent back to the API.
interface IClonedForm {
  id?: string;
  title?: string;
  date_created?: string;
  date_updated?: string;
  entries_count?: number;
  is_active?: string;
  is_trash?: string;
  fields?: IGravityFormField[];
  [key: string]: unknown;
}

function validateCloneFieldRenamesArray(fieldRenames: unknown): void {
  if (!Array.isArray(fieldRenames)) {
    throw new McpError(ErrorCode.InvalidParams, 'field_renames must be an array');
  }

  for (const rename of fieldRenames) {
    if (!isFieldRenameCandidate(rename) || !rename.original_label || typeof rename.original_label !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Each field rename must have original_label as string');
    }
    if (!rename.new_label || typeof rename.new_label !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Each field rename must have new_label as string');
    }
  }
}

// Applies each rename to the matching field (by current label) and records
// old→new label mappings, so calculation formulas referencing the old labels
// can be updated afterward.
function applyClonedFieldRenames(fields: IGravityFormField[], renames: IFieldRenameArg[]): Record<string, string> {
  const labelMapping: Record<string, string> = {};

  for (const rename of renames) {
    const field = fields.find((f) => f.label === rename.original_label);
    if (field) {
      labelMapping[rename.original_label] = rename.new_label;
      field.label = rename.new_label;

      // Update placeholder with exact word matching to avoid false positives
      if (typeof field.placeholder === 'string') {
        // Use word boundary regex to avoid partial matches
        const labelRegex = new RegExp(`\\b${rename.original_label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        if (labelRegex.test(field.placeholder)) {
          field.placeholder = field.placeholder.replace(labelRegex, rename.new_label);
        }
      }
    }
  }

  return labelMapping;
}

// Updates calculation formulas that reference renamed fields.
// Note: Gravity Forms uses {FieldLabel:FieldID} format in formulas
function updateClonedCalculationReferences(fields: IGravityFormField[], labelMapping: Record<string, string>): void {
  for (const field of fields) {
    if (field.isCalculation && typeof field.calculationFormula === 'string') {
      let updatedFormula = field.calculationFormula;
      for (const [oldLabel, newLabel] of Object.entries(labelMapping)) {
        // Update formula references preserving field IDs
        const labelRegex = new RegExp(`{${oldLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`, 'g');
        updatedFormula = updatedFormula.replace(labelRegex, `{${newLabel}:`);
      }
      field.calculationFormula = updatedFormula;
    }
  }
}

// Validates source_form_id and modifications.field_renames, returning the
// validated field renames (empty when none were provided). Extracted from
// cloneFormWithModifications to keep it under the complexity threshold.
function validateCloneArgs(source_form_id: string | undefined, modifications: CloneModificationsArg): IFieldRenameArg[] {
  if (!source_form_id || typeof source_form_id !== 'string' || source_form_id.trim() === '') {
    throw new McpError(
      ErrorCode.InvalidParams,
      'source_form_id is required and must be a non-empty string'
    );
  }

  if (modifications && typeof modifications !== 'object') {
    throw new McpError(
      ErrorCode.InvalidParams,
      'modifications must be an object'
    );
  }

  // Validate field_renames structure if provided
  if (modifications.field_renames) {
    validateCloneFieldRenamesArray(modifications.field_renames);
    return modifications.field_renames as IFieldRenameArg[];
  }

  return [];
}

export async function cloneFormWithModifications(ctx: TemplateToolContext, args: CloneFormWithModificationsArgs): Promise<TemplateToolResult> {
    try {
      // Validate required parameters
      const { source_form_id, modifications = {} } = args;
      const validatedFieldRenames = validateCloneArgs(source_form_id, modifications);

      // Fetch the source form
      const sourceForm = await ctx.makeRequest<IGravityForm>(`/forms/${source_form_id}`);

      if (!sourceForm) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Form with ID ${source_form_id} not found`
        );
      }

      // Create a deep copy of the source form for cloning
      const clonedForm = JSON.parse(JSON.stringify(sourceForm)) as IClonedForm;

      // Ensure fields array exists
      if (!clonedForm.fields || !Array.isArray(clonedForm.fields)) {
        clonedForm.fields = [];
      }

      // Remove the original ID so a new one will be assigned
      delete clonedForm.id;
      delete clonedForm.date_created;
      delete clonedForm.date_updated;
      delete clonedForm.entries_count;
      delete clonedForm.is_active;
      delete clonedForm.is_trash;

      // Apply title modification
      if (modifications.title) {
        clonedForm.title = modifications.title;
      } else {
        // Default behavior: append " (Copy)" to the title
        clonedForm.title = `${sourceForm.title} (Copy)`;
      }

      // Apply field label modifications and update references
      let labelMapping: Record<string, string> = {};
      if (validatedFieldRenames.length > 0) {
        labelMapping = applyClonedFieldRenames(clonedForm.fields, validatedFieldRenames);
        updateClonedCalculationReferences(clonedForm.fields, labelMapping);
      }

      // Field modifications are applied - no additional validation needed for now

      // Create the new form
      const createdForm = await ctx.makeRequest<{ id?: string }>('/forms', 'POST', clonedForm);

      return {
        content: [
          {
            type: "text",
            text: `Form Clone Results:\n${JSON.stringify({
              success: true,
              action: 'cloned',
              source_form_id: source_form_id,
              cloned_form_id: createdForm.id,
              cloned_form_title: clonedForm.title,
              original_title: sourceForm.title,
              fields_count: clonedForm.fields ? clonedForm.fields.length : 0,
              modifications_applied: {
                title_changed: !!modifications.title,
                fields_renamed: validatedFieldRenames.length
              }
            }, null, 2)}`
          }
        ]
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to clone form with modifications: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
