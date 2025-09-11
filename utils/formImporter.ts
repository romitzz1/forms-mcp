// ABOUTME: Form import utilities for importing Gravity Forms from JSON with conflict resolution
// ABOUTME: Handles JSON validation, ID mapping, conflict detection, and reference updates

import { FormCache } from './formCache.js';

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

export interface IdMapping {
  [oldId: string]: string;
}

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

export class FormImporter {
  constructor(
    private apiCall: (endpoint: string, method?: string, body?: any) => Promise<any>,
    private formCache?: FormCache
  ) {}

  /**
   * Validates form JSON structure and content
   */
  validateFormJson(jsonString: string): any {
    try {
      const parsed = JSON.parse(jsonString);
      
      // Validate required properties
      if (!parsed.title || typeof parsed.title !== 'string') {
        throw new Error('Invalid form JSON: title is required and must be a string');
      }
      
      if (!parsed.fields || !Array.isArray(parsed.fields)) {
        throw new Error('Invalid form JSON: fields must be an array');
      }
      
      // Validate each field has required properties
      for (const field of parsed.fields) {
        if (!field.id || !field.type || !field.label) {
          throw new Error('Invalid form JSON: each field must have id, type, and label');
        }
      }
      
      return parsed;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('Invalid JSON format: ' + error.message);
      }
      throw error;
    }
  }

  /**
   * Detects conflicts with existing forms
   */
  async detectConflicts(importedForm: any, useCompleteDiscovery: boolean = false): Promise<ConflictInfo> {
    try {
      let existingForms: any[];

      // Use cache if available and complete discovery requested
      if (useCompleteDiscovery && this.formCache && this.formCache.isReady()) {
        try {
          // Check if cache is stale and auto-sync if needed
          const isStale = await this.formCache.isStale();
          if (isStale) {
            await this.formCache.refreshCache((endpoint: string) => this.apiCall(endpoint));
          }
          
          // Get all forms from cache (including inactive)
          const cachedForms = await this.formCache.getAllForms();
          existingForms = cachedForms.map(cached => ({
            id: (cached.id ?? 0).toString(),
            title: cached.title || '',
            is_active: cached.is_active
          }));
        } catch (error) {
          // For consistency with resolveConflicts, fall back to API when cache fails
          // This provides more robust behavior than throwing errors
          existingForms = await this.apiCall('/forms');
        }
      } else if (useCompleteDiscovery && (!this.formCache || !this.formCache.isReady())) {
        // Fall back to API if complete discovery requested but cache unavailable
        existingForms = await this.apiCall('/forms');
      } else {
        // Use existing API-only behavior (backward compatibility)
        existingForms = await this.apiCall('/forms');
      }
      
      // Check for title conflicts
      const titleConflict = existingForms.find((form: any) => form.title === importedForm.title);
      if (titleConflict) {
        return {
          hasConflict: true,
          conflictType: 'title',
          conflictDetails: { existingId: titleConflict.id, title: importedForm.title }
        };
      }
      
      // Check for explicit ID conflicts if form has an id
      if (importedForm.id) {
        const idConflict = existingForms.find((form: any) => form.id === importedForm.id);
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
  async resolveConflicts(importedForm: any, conflictInfo: ConflictInfo, useCompleteDiscovery: boolean = false, existingForms?: any[]): Promise<any> {
    if (!conflictInfo.hasConflict) {
      return importedForm;
    }

    const resolvedForm = { ...importedForm };

    if (conflictInfo.conflictType === 'title') {
      let forms: any[];
      
      // Use provided forms list to avoid duplicate API call
      if (existingForms) {
        forms = existingForms;
      } else if (useCompleteDiscovery && this.formCache && this.formCache.isReady()) {
        try {
          // Get all forms from cache for complete conflict resolution
          const cachedForms = await this.formCache.getAllForms();
          forms = cachedForms.map(cached => ({
            id: (cached.id ?? 0).toString(),
            title: cached.title || '',
            is_active: cached.is_active
          }));
        } catch (error) {
          // Fall back to API if cache fails
          forms = await this.apiCall('/forms');
        }
      } else {
        // Use API-only behavior
        forms = await this.apiCall('/forms');
      }
      
      const baseTitle = importedForm.title;
      let counter = 1;
      let newTitle = `${baseTitle} (Import ${counter})`;
      
      while (forms.some((form: any) => form.title === newTitle)) {
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
  updateFieldIds(form: any, startingId: number = 1): { updatedForm: any; idMapping: IdMapping } {
    const idMapping: IdMapping = {};
    let currentId = startingId;
    
    const updatedFields = form.fields.map((field: any) => {
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
  updateConditionalLogicReferences(form: any, idMapping: IdMapping): any {
    const updatedFields = form.fields.map((field: any) => {
      if (field.conditionalLogic && field.conditionalLogic.rules) {
        const updatedRules = field.conditionalLogic.rules.map((rule: any) => {
          if (rule.fieldId && idMapping[rule.fieldId]) {
            return { ...rule, fieldId: idMapping[rule.fieldId] };
          }
          return rule;
        });
        
        return {
          ...field,
          conditionalLogic: {
            ...field.conditionalLogic,
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
  updateCalculationReferences(form: any, idMapping: IdMapping): any {
    const updatedFields = form.fields.map((field: any) => {
      if (field.isCalculation && field.calculationFormula) {
        let updatedFormula = field.calculationFormula;
        
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
  prepareFormForImport(form: any, idMapping?: IdMapping): any {
    let preparedForm = { ...form };
    
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
      let existingForms: any[] | undefined;
      
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
            existingForms = await this.apiCall('/forms');
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
      const createdForm = await this.apiCall('/forms', 'POST', resolvedForm);
      
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