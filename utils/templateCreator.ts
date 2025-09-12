// ABOUTME: Template creation utilities for safely modifying and cloning form templates
// ABOUTME: Handles field renaming, type validation, and preservation of conditional logic

// Interface for field label renames
export interface FieldRename {
  original_label: string;
  new_label: string;
}

// Interface for template modification options
export interface TemplateModification {
  title: string;
  field_renames?: FieldRename[];
  preserve_logic?: boolean;
}

// Interface for modification validation results
export interface ModificationResult {
  success: boolean;
  warnings: string[];
  errors: string[];
}

// Type for API call function
type ApiCallFunction = (endpoint: string) => Promise<any>;

export class TemplateCreator {
  private readonly apiCall?: ApiCallFunction;

  // Field type semantic categories for validation
  private readonly semanticCategories = {
    names: ['name', 'first', 'last', 'given', 'family', 'full', 'user'],
    dates: ['date', 'birthday', 'birth', 'born', 'when', 'time', 'day', 'month', 'year'],
    contact: ['email', 'phone', 'mobile', 'telephone', 'contact', 'address', 'street', 'city', 'zip'],
    numbers: ['age', 'count', 'number', 'quantity', 'amount', 'price', 'cost', 'total', 'sum'],
    text: ['comment', 'note', 'description', 'feedback', 'message', 'text', 'remarks'],
    choices: ['color', 'animal', 'pet', 'favorite', 'choice', 'option', 'preference', 'type', 'kind']
  };

  constructor(apiCall?: ApiCallFunction) {
    this.apiCall = apiCall;
  }

  /**
   * Validates field renames for safety and semantic compatibility
   */
  validateFieldRenames(template: any, renames: FieldRename[]): ModificationResult {
    const result: ModificationResult = {
      success: true,
      warnings: [],
      errors: []
    };

    if (!template || !Array.isArray(template.fields)) {
      result.success = false;
      result.errors.push('Invalid template structure');
      return result;
    }

    if (!renames || renames.length === 0) {
      return result; // Empty renames is valid
    }

    // Check for duplicate field labels in template
    const labelCounts = new Map<string, number>();
    template.fields.forEach((field: any) => {
      const count = labelCounts.get(field.label) || 0;
      labelCounts.set(field.label, count + 1);
    });

    labelCounts.forEach((count, label) => {
      if (count > 1) {
        result.warnings.push(`Template has duplicate field labels: "${label}"`);
      }
    });

    // Validate each rename
    for (const rename of renames) {
      const field = template.fields.find((f: any) => f.label === rename.original_label);
      
      if (!field) {
        result.success = false;
        result.errors.push(`Field with label "${rename.original_label}" not found in template`);
        continue;
      }

      // Check for dangerous semantic mismatches
      const isDangerous = this.isDangerousRename(field, rename);
      if (isDangerous) {
        result.success = false;
        result.errors.push(`dangerous field rename detected: "${rename.original_label}" -> "${rename.new_label}". This could cause semantic data type mismatch.`);
        continue;
      }

      // Check for risky but allowed renames
      const isRisky = this.isRiskyRename(field, rename);
      if (isRisky) {
        result.warnings.push(`Potentially risky rename: "${rename.original_label}" -> "${rename.new_label}". Verify this semantic change is intentional.`);
      }
    }

    return result;
  }

  /**
   * Clones a form from a template with modifications
   */
  async cloneFromTemplate(templateId: string, modifications: TemplateModification): Promise<any> {
    if (!this.apiCall) {
      throw new Error('API call function not provided to TemplateCreator');
    }

    try {
      // Fetch the template
      const template = await this.apiCall(`/forms/${templateId}`);

      if (!template || !Array.isArray(template.fields)) {
        throw new Error('Invalid template structure');
      }

      // Validate modifications before applying
      if (modifications.field_renames && modifications.field_renames.length > 0) {
        const validation = this.validateFieldRenames(template, modifications.field_renames);
        if (!validation.success) {
          throw new Error(`Field rename validation failed: ${validation.errors.join(', ')}`);
        }
      }

      // Clone the template using a more efficient method
      let clonedForm = this.deepClone(template);

      // Remove template-specific properties
      delete clonedForm.id;
      delete clonedForm.date_created;
      delete clonedForm.date_updated;

      // Update title
      clonedForm.title = modifications.title;

      // Apply field renames if provided
      if (modifications.field_renames && modifications.field_renames.length > 0) {
        clonedForm = this.applyFieldRenames(clonedForm, modifications.field_renames);
      }

      // Preserve conditional logic and calculations if requested
      if (modifications.preserve_logic) {
        // Logic is already preserved by deep cloning, no additional action needed
      }

      return clonedForm;

    } catch (error) {
      throw error; // Re-throw to let caller handle
    }
  }

  /**
   * Applies field renames to a form structure
   */
  applyFieldRenames(form: any, renames: FieldRename[]): any {
    if (!renames || renames.length === 0) {
      return form;
    }

    // Clone the form to avoid mutation
    const clonedForm = this.deepClone(form);

    // Apply renames to each field
    for (const field of clonedForm.fields) {
      const rename = renames.find(r => r.original_label === field.label);
      if (rename) {
        field.label = rename.new_label;
      }
    }

    return clonedForm;
  }

  /**
   * Checks if a field rename is dangerous (semantic type mismatch)
   */
  private isDangerousRename(field: any, rename: FieldRename): boolean {
    const originalCategory = this.getSemanticCategory(rename.original_label, field.type);
    const newCategory = this.getSemanticCategory(rename.new_label);

    // Dangerous combinations that should be prevented
    const dangerousCombos = [
      ['dates', 'contact'],
      ['dates', 'numbers'],
      ['contact', 'text'], // email -> comment is dangerous
    ];

    for (const [cat1, cat2] of dangerousCombos) {
      if ((originalCategory === cat1 && newCategory === cat2) ||
          (originalCategory === cat2 && newCategory === cat1)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Checks if a field rename is risky but allowed
   */
  private isRiskyRename(field: any, rename: FieldRename): boolean {
    const originalCategory = this.getSemanticCategory(rename.original_label, field.type);
    const newCategory = this.getSemanticCategory(rename.new_label);

    // Risky but allowed combinations
    const riskyCombos = [
      ['numbers', 'contact'], // age -> phone
      ['names', 'dates'],     // name -> date
      ['text', 'numbers']     // comment -> age
    ];

    for (const [cat1, cat2] of riskyCombos) {
      if ((originalCategory === cat1 && newCategory === cat2) ||
          (originalCategory === cat2 && newCategory === cat1)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Determines the semantic category of a field label, considering actual field type
   */
  private getSemanticCategory(label: string, fieldType?: string): string {
    // First check actual field type for definitive categorization
    if (fieldType) {
      switch (fieldType) {
        case 'date':
        case 'time':
          return 'dates';
        case 'email':
        case 'phone':
        case 'address':
          return 'contact';
        case 'number':
        case 'price':
        case 'quantity':
          return 'numbers';
        case 'textarea':
          return 'text';
        case 'select':
        case 'radio':
        case 'checkbox':
          return 'choices';
        case 'name':
          return 'names';
      }
    }

    // Fall back to label-based categorization
    const lowerLabel = label.toLowerCase();

    for (const [category, keywords] of Object.entries(this.semanticCategories)) {
      for (const keyword of keywords) {
        if (lowerLabel.includes(keyword)) {
          return category;
        }
      }
    }

    return 'unknown';
  }

  /**
   * Efficient deep cloning method that handles most use cases better than JSON methods
   */
  private deepClone(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (obj instanceof Date) {
      return new Date(obj.getTime());
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.deepClone(item));
    }

    const cloned: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = this.deepClone(obj[key]);
      }
    }

    return cloned;
  }
}