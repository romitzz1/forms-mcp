// ABOUTME: Form import utilities for importing Gravity Forms from JSON with conflict resolution
// ABOUTME: Handles JSON validation, ID mapping, conflict detection, and reference updates

import type { FormCache } from './formCache.js';
import type { IGravityFormField } from './gravityFormsTypes.js';

export interface ImportOptions {
  force_import?: boolean;
  auto_resolve_conflicts?: boolean;
  preserve_ids?: boolean;
  useCompleteDiscovery?: boolean;
}

export interface ConflictInfo {
  hasConflict: boolean;
  conflictType: 'title' | 'id' | 'none';
  conflictDetails?: {
    existingId: string;
    title: string;
  };
}

export type IdMapping = Record<string, string>;

export interface ImportResult {
  success: boolean;
  action: 'created' | 'overwritten' | 'created_with_modified_title' | 'rejected';
  form_id?: string;
  form_title: string;
  original_title?: string;
  fields_imported: number;
  fields_skipped?: number;
  conflicts_resolved: number;
  id_mapping?: IdMapping;
  warnings?: string[];
  errors?: string[];
}

// A form as parsed from imported JSON and carried through the import pipeline.
// `id` is optional (imports are typically ID-less; conflict resolution may
// carry an existing id through), `fields` is the one structurally-validated
// property (validateFormJson enforces it's an array of id/type/label-bearing
// objects), and every other imported key (settings, notifications, etc.) is
// preserved verbatim via the index signature.
export interface IImportableForm {
  id?: string;
  title: string;
  fields: IGravityFormField[];
  [key: string]: unknown;
}

// A minimal existing-form summary used only for title/id conflict lookups —
// shared shape for both FormCache-derived summaries (is_active: boolean) and
// raw API /forms responses (is_active: string per the REST API contract).
interface IExistingFormSummary {
  id: string;
  title: string;
  is_active?: boolean | string;
  [key: string]: unknown;
}

interface IConditionalLogicRule {
  fieldId?: string | number;
  [key: string]: unknown;
}

interface IConditionalLogicWithRules {
  rules: unknown;
  [key: string]: unknown;
}

// Mirrors the original truthy `conditionalLogic?.rules` guard: true when the
// field carries a conditionalLogic object with a truthy `rules` value. Whether
// that value is actually an array is validated by the caller, so a truthy
// non-array `rules` throws (as the original `.map(...)` did) rather than being
// silently skipped.
function hasConditionalLogicRules(value: unknown): value is IConditionalLogicWithRules {
  return typeof value === 'object' && value !== null && Boolean((value as { rules?: unknown }).rules);
}

export class FormImporter {
  constructor(
    private readonly apiCall: <T = unknown>(endpoint: string, method?: string, body?: unknown) => Promise<T>,
    private readonly formCache?: FormCache
  ) {}

  /**
   * Validates form JSON structure and content
   */
  validateFormJson(jsonString: string): IImportableForm {
    try {
      const parsed = JSON.parse(jsonString) as Record<string, unknown>;

      // Validate required properties
      if (typeof parsed.title !== 'string' || parsed.title === '') {
        throw new Error('Invalid form JSON: title is required and must be a string');
      }

      if (!Array.isArray(parsed.fields)) {
        throw new Error('Invalid form JSON: fields must be an array');
      }

      // Validate each field has required properties
      const fields = parsed.fields as unknown[];
      for (const field of fields) {
        const fieldRecord = (typeof field === 'object' && field !== null) ? field as Record<string, unknown> : null;
        if (!fieldRecord?.id || !fieldRecord.type || !fieldRecord.label) {
          throw new Error('Invalid form JSON: each field must have id, type, and label');
        }
      }

      return parsed as unknown as IImportableForm;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('Invalid JSON format: ' + error.message);
      }
      throw error;
    }
  }

  /**
   * Resolves the existing-forms list used for conflict detection: cache (with
   * auto-sync-if-stale) when complete discovery is requested and the cache is
   * ready, otherwise a fresh API fetch — extracted verbatim from detectConflicts
   * to keep it under the complexity threshold.
   */
  private async resolveExistingFormsForConflictDetection(useCompleteDiscovery: boolean): Promise<IExistingFormSummary[]> {
    let existingForms: IExistingFormSummary[];

    // Use cache if available and complete discovery requested
    if (useCompleteDiscovery && this.formCache?.isReady()) {
      try {
        // Check if cache is stale and auto-sync if needed
        const isStale = await this.formCache.isStale();
        if (isStale) {
          await this.formCache.refreshCache((endpoint: string) => this.apiCall(endpoint));
        }

        // Get all forms from cache (including inactive)
        const cachedForms = await this.formCache.getAllForms();
        existingForms = cachedForms.map((cached) => ({
          id: cached.id.toString(),
          title: cached.title,
          is_active: cached.is_active
        }));
      } catch {
        // For consistency with resolveConflicts, fall back to API when cache fails
        // This provides more robust behavior than throwing errors
        const apiResponse = await this.apiCall<Record<string, IExistingFormSummary>>('/forms');
        existingForms = Object.values(apiResponse);
      }
    } else if (useCompleteDiscovery && (!this.formCache?.isReady())) {
      // Fall back to API if complete discovery requested but cache unavailable
      const apiResponse = await this.apiCall<Record<string, IExistingFormSummary>>('/forms');
      existingForms = Object.values(apiResponse);
    } else {
      // Use existing API-only behavior (backward compatibility)
      const apiResponse = await this.apiCall<Record<string, IExistingFormSummary>>('/forms');
      existingForms = Object.values(apiResponse);
    }

    // Ensure existingForms is always an array
    if (!Array.isArray(existingForms)) {
      existingForms = [];
    }

    return existingForms;
  }

  /**
   * Detects conflicts with existing forms
   */
  async detectConflicts(importedForm: IImportableForm, useCompleteDiscovery = false): Promise<ConflictInfo> {
    try {
      const existingForms = await this.resolveExistingFormsForConflictDetection(useCompleteDiscovery);

      // Check for title conflicts
      const titleConflict = existingForms.find((form) => form.title === importedForm.title);
      if (titleConflict) {
        return {
          hasConflict: true,
          conflictType: 'title',
          conflictDetails: { existingId: titleConflict.id, title: importedForm.title }
        };
      }

      // Check for explicit ID conflicts if form has an id
      if (importedForm.id) {
        const idConflict = existingForms.find((form) => form.id === importedForm.id);
        if (idConflict) {
          return {
            hasConflict: true,
            conflictType: 'id',
            conflictDetails: { existingId: importedForm.id, title: idConflict.title }
          };
        }
      }

      return { hasConflict: false, conflictType: 'none' };
    } catch (error) {
      throw new Error(`Failed to check for conflicts: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Resolves conflicts by modifying the imported form
   */
  async resolveConflicts(importedForm: IImportableForm, conflictInfo: ConflictInfo, useCompleteDiscovery = false, existingForms?: IExistingFormSummary[]): Promise<IImportableForm> {
    if (!conflictInfo.hasConflict) {
      return importedForm;
    }

    const resolvedForm: IImportableForm = { ...importedForm };

    if (conflictInfo.conflictType === 'title') {
      let forms: IExistingFormSummary[];

      // Use provided forms list to avoid duplicate API call
      if (existingForms) {
        forms = existingForms;
      } else if (useCompleteDiscovery && this.formCache?.isReady()) {
        try {
          // Get all forms from cache for complete conflict resolution
          const cachedForms = await this.formCache.getAllForms();
          forms = cachedForms.map((cached) => ({
            id: cached.id.toString(),
            title: cached.title,
            is_active: cached.is_active
          }));
        } catch {
          // Fall back to API if cache fails
          const apiResponse = await this.apiCall<Record<string, IExistingFormSummary>>('/forms');
          forms = Object.values(apiResponse);
        }
      } else {
        // Use API-only behavior
        const apiResponse = await this.apiCall<Record<string, IExistingFormSummary>>('/forms');
        forms = Object.values(apiResponse);
      }

      const baseTitle = importedForm.title;
      let counter = 1;
      let newTitle = `${baseTitle} (Import ${counter})`;

      while (forms.some((form) => form.title === newTitle)) {
        counter++;
        newTitle = `${baseTitle} (Import ${counter})`;
      }

      resolvedForm.title = newTitle;
    }

    // Remove ID to let Gravity Forms assign a new one (handles both title and ID conflicts)
    delete resolvedForm.id;

    return resolvedForm;
  }

  /**
   * Updates field IDs to avoid conflicts and returns mapping
   */
  updateFieldIds(form: IImportableForm, startingId = 1): { updatedForm: IImportableForm; idMapping: IdMapping } {
    const idMapping: IdMapping = {};
    let currentId = startingId;

    const updatedFields = form.fields.map((field) => {
      const newId = currentId.toString();
      idMapping[field.id] = newId;
      currentId++;

      return { ...field, id: newId };
    });

    return {
      updatedForm: { ...form, fields: updatedFields },
      idMapping
    };
  }

  /**
   * Updates conditional logic references when field IDs change
   */
  updateConditionalLogicReferences(form: IImportableForm, idMapping: IdMapping): IImportableForm {
    const updatedFields = form.fields.map((field) => {
      const conditionalLogic = field.conditionalLogic;
      if (hasConditionalLogicRules(conditionalLogic)) {
        const { rules } = conditionalLogic;
        // Preserve the original's crash-on-invalid behavior: the original
        // called `rules.map(...)` unconditionally after a truthy check, so a
        // truthy non-array `rules` threw. Throw here too (rather than silently
        // returning the field unchanged) before narrowing `rules` to an array.
        if (!Array.isArray(rules)) {
          throw new TypeError('conditionalLogic.rules must be an array');
        }
        const updatedRules = (rules as IConditionalLogicRule[]).map((rule) => {
          if (rule.fieldId && idMapping[rule.fieldId]) {
            return { ...rule, fieldId: idMapping[rule.fieldId] };
          }
          return rule;
        });

        return {
          ...field,
          conditionalLogic: {
            ...conditionalLogic,
            rules: updatedRules
          }
        };
      }
      return field;
    });

    return { ...form, fields: updatedFields };
  }

  /**
   * Updates calculation formulas when field IDs change
   */
  updateCalculationReferences(form: IImportableForm, idMapping: IdMapping): IImportableForm {
    const updatedFields = form.fields.map((field) => {
      if (field.isCalculation && field.calculationFormula) {
        const formula = field.calculationFormula;
        // Preserve the original's crash-on-invalid behavior: the original
        // called `.replace()` unconditionally after a truthy check, so a
        // truthy non-string formula threw. Throw here too (rather than silently
        // returning the field unchanged) before narrowing to a string.
        if (typeof formula !== 'string') {
          throw new TypeError('calculationFormula must be a string');
        }
        let updatedFormula = formula;

        // Update field references in calculation formula
        for (const [oldId, newId] of Object.entries(idMapping)) {
          const regex = new RegExp(`{([^:]+):${oldId}}`, 'g');
          updatedFormula = updatedFormula.replace(regex, `{$1:${newId}}`);
        }

        return { ...field, calculationFormula: updatedFormula };
      }
      return field;
    });

    return { ...form, fields: updatedFields };
  }

  /**
   * Prepares form for import by cleaning metadata and updating references
   */
  prepareFormForImport(form: IImportableForm, idMapping?: IdMapping): IImportableForm {
    let preparedForm: IImportableForm = { ...form };

    // Remove export metadata and runtime properties
    delete preparedForm.export_metadata;
    delete preparedForm.id;
    delete preparedForm.date_created;
    delete preparedForm.date_updated;
    delete preparedForm.entries_count;
    delete preparedForm.is_active;
    delete preparedForm.is_trash;

    // Update references if ID mapping provided
    if (idMapping) {
      preparedForm = this.updateConditionalLogicReferences(preparedForm, idMapping);
      preparedForm = this.updateCalculationReferences(preparedForm, idMapping);
    }

    return preparedForm;
  }

  /**
   * Performs the complete import process
   */
  async importForm(formJson: string, options: ImportOptions = {}): Promise<ImportResult> {
    try {
      // Validate JSON
      const importedForm = this.validateFormJson(formJson);
      const originalTitle = importedForm.title;
      const useCompleteDiscovery = options.useCompleteDiscovery ?? false;

      // Check for conflicts
      const conflictInfo = await this.detectConflicts(importedForm, useCompleteDiscovery);

      let resolvedForm = importedForm;
      let conflictsResolved = 0;
      let action: ImportResult['action'] = 'created';
      let idMapping: IdMapping | undefined;
      let existingForms: IExistingFormSummary[] | undefined;

      // Handle conflicts
      if (conflictInfo.hasConflict) {
        if (options.force_import) {
          // Force import: overwrite existing form for any conflict type
          if (!conflictInfo.conflictDetails) {
            throw new Error('Conflict details missing for force import');
          }

          const existingId = conflictInfo.conflictDetails.existingId;
          resolvedForm = this.prepareFormForImport(importedForm);

          await this.apiCall(`/forms/${existingId}`, 'PUT', resolvedForm);

          return {
            success: true,
            action: 'overwritten',
            form_id: existingId,
            form_title: resolvedForm.title,
            fields_imported: resolvedForm.fields.length,
            conflicts_resolved: 1
          };
        } else {
          // Auto-resolve conflicts by modifying the form
          // Only get existing forms for traditional resolution if not using complete discovery
          if (!useCompleteDiscovery) {
            const apiResponse = await this.apiCall<Record<string, IExistingFormSummary>>('/forms');
            existingForms = Object.values(apiResponse);
          }

          resolvedForm = await this.resolveConflicts(importedForm, conflictInfo, useCompleteDiscovery, existingForms);
          conflictsResolved = 1;
          action = 'created_with_modified_title';
        }
      }

      // Update field IDs if needed
      if (!options.preserve_ids) {
        const { updatedForm, idMapping: mapping } = this.updateFieldIds(resolvedForm);
        resolvedForm = updatedForm;
        idMapping = mapping;
      }

      // Prepare form for import
      resolvedForm = this.prepareFormForImport(resolvedForm, idMapping);

      // Create the new form
      const createdForm = await this.apiCall<{ id?: string }>('/forms', 'POST', resolvedForm);

      const result: ImportResult = {
        success: true,
        action,
        form_id: createdForm.id,
        form_title: resolvedForm.title,
        fields_imported: resolvedForm.fields.length,
        conflicts_resolved: conflictsResolved
      };

      if (originalTitle !== resolvedForm.title) {
        result.original_title = originalTitle;
      }

      if (idMapping) {
        result.id_mapping = idMapping;
      }

      return result;
    } catch (error) {
      return {
        success: false,
        action: 'rejected',
        form_title: 'Unknown',
        fields_imported: 0,
        conflicts_resolved: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error occurred during import']
      };
    }
  }
}
