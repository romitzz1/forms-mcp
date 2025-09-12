// ABOUTME: Input validation utilities for Gravity Forms MCP server
// ABOUTME: Provides secure validation, sanitization, and error handling for all tool parameters

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitizedValue?: any;
}

export interface ExportEntriesParams {
  form_id: string;
  format: 'csv' | 'json';
  search?: {
    field_filters?: Array<{ key: string; value: string }>;
    date_range?: { start: string; end: string };
    status?: string;
  };
  date_format?: string;
  filename?: string;
  include_headers?: boolean;
}

export interface BulkProcessParams {
  entry_ids: string[];
  operation_type: 'delete' | 'update_status' | 'update_fields';
  confirm: boolean;
  data?: {
    status?: string;
    [field: string]: any;
  };
}

export interface TemplateParams {
  source_form_id: string;
  template_name: string;
  field_renames?: Array<{
    original_label: string;
    new_label: string;
  }>;
  preserve_logic?: boolean;
}

export interface ImportExportParams {
  form_json: string;
  force_import?: boolean;
  target_form_id?: string;
}

export class ValidationHelper {
  private readonly MAX_ENTRY_IDS = 1000;
  private readonly MAX_BULK_ENTRIES = 100;
  private readonly MAX_STRING_LENGTH = 255;
  private readonly VALID_DATE_FORMATS = [
    'YYYY-MM-DD',
    'MM/DD/YYYY',
    'DD/MM/YYYY',
    'YYYY-MM-DD HH:mm:ss',
    'MM/DD/YYYY HH:mm',
    'DD/MM/YYYY HH:mm'
  ];

  validateFormId(formId: any): ValidationResult {
    const result: ValidationResult = { isValid: true, errors: [] };

    if (formId === null || formId === undefined) {
      result.isValid = false;
      result.errors.push('Form ID is required');
      return result;
    }

    if (typeof formId !== 'string' || formId.trim() === '') {
      result.isValid = false;
      result.errors.push('Form ID cannot be empty');
      return result;
    }

    // Check if form ID is numeric
    if (!/^\d+$/.test(formId.trim())) {
      result.isValid = false;
      result.errors.push('Form ID must be numeric');
      return result;
    }

    result.sanitizedValue = formId.trim();
    return result;
  }

  validateEntryIds(entryIds: any): ValidationResult {
    const result: ValidationResult = { isValid: true, errors: [] };

    if (entryIds === null || entryIds === undefined) {
      result.isValid = false;
      result.errors.push('Entry IDs are required');
      return result;
    }

    // Handle single entry ID
    if (typeof entryIds === 'string') {
      const singleIdResult = this.validateSingleEntryId(entryIds);
      if (!singleIdResult.isValid) {
        return singleIdResult;
      }
      result.sanitizedValue = entryIds.trim();
      return result;
    }

    // Handle array of entry IDs
    if (!Array.isArray(entryIds)) {
      result.isValid = false;
      result.errors.push('Entry IDs must be a string or array of strings');
      return result;
    }

    if (entryIds.length === 0) {
      result.isValid = false;
      result.errors.push('At least one entry ID is required');
      return result;
    }

    if (entryIds.length > this.MAX_ENTRY_IDS) {
      result.isValid = false;
      result.errors.push(`Too many entry IDs (max ${this.MAX_ENTRY_IDS} allowed)`);
      return result;
    }

    const sanitizedIds: string[] = [];
    for (const id of entryIds) {
      const idResult = this.validateSingleEntryId(id);
      if (!idResult.isValid) {
        result.isValid = false;
        result.errors.push(...idResult.errors);
      } else {
        sanitizedIds.push(id.trim());
      }
    }

    if (result.isValid) {
      result.sanitizedValue = sanitizedIds;
    }

    return result;
  }

  private validateSingleEntryId(entryId: any): ValidationResult {
    const result: ValidationResult = { isValid: true, errors: [] };

    if (typeof entryId !== 'string' || entryId.trim() === '') {
      result.isValid = false;
      result.errors.push('Entry ID cannot be empty');
      return result;
    }

    if (!/^\d+$/.test(entryId.trim())) {
      result.isValid = false;
      result.errors.push(`Entry ID "${entryId}" must be numeric`);
      return result;
    }

    return result;
  }

  validateExportFormat(format: any): ValidationResult {
    const result: ValidationResult = { isValid: true, errors: [] };

    if (format === null || format === undefined) {
      result.isValid = false;
      result.errors.push('Export format is required');
      return result;
    }

    if (format !== 'csv' && format !== 'json') {
      result.isValid = false;
      result.errors.push('Export format must be "csv" or "json"');
      return result;
    }

    result.sanitizedValue = format;
    return result;
  }

  validateExportEntriesParams(params: any): ValidationResult {
    const result: ValidationResult = { isValid: true, errors: [] };

    if (!params || typeof params !== 'object') {
      result.isValid = false;
      result.errors.push('Parameters object is required');
      return result;
    }

    // Validate required fields
    const formIdResult = this.validateFormId(params.form_id);
    if (!formIdResult.isValid) {
      result.isValid = false;
      result.errors.push(...formIdResult.errors);
    }

    const formatResult = this.validateExportFormat(params.format);
    if (!formatResult.isValid) {
      result.isValid = false;
      result.errors.push(...formatResult.errors);
    }

    // Validate optional fields
    if (params.date_format && !this.VALID_DATE_FORMATS.includes(params.date_format)) {
      result.isValid = false;
      result.errors.push('Invalid date format');
    }

    if (params.filename && this.containsInvalidFilenameChars(params.filename)) {
      result.isValid = false;
      result.errors.push('Filename contains invalid characters');
    }

    // Validate search parameters
    if (params.search?.date_range) {
      const { start, end } = params.search.date_range;
      if (start && end) {
        const startDate = new Date(start);
        const endDate = new Date(end);
        
        // Check for invalid dates
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          result.isValid = false;
          result.errors.push('Invalid date format in date range');
        } else if (startDate >= endDate) {
          result.isValid = false;
          result.errors.push('Date range start must be before end date');
        }
      }
    }

    return result;
  }

  validateBulkProcessParams(params: any): ValidationResult {
    const result: ValidationResult = { isValid: true, errors: [] };

    if (!params || typeof params !== 'object') {
      result.isValid = false;
      result.errors.push('Parameters object is required');
      return result;
    }

    // Validate entry IDs
    const entryIdsResult = this.validateEntryIds(params.entry_ids);
    if (!entryIdsResult.isValid) {
      result.isValid = false;
      result.errors.push(...entryIdsResult.errors);
    }
    
    // Check bulk limit separately (even if entry IDs are invalid)
    if (Array.isArray(params.entry_ids) && params.entry_ids.length > this.MAX_BULK_ENTRIES) {
      result.isValid = false;
      result.errors.push(`Bulk operations limited to ${this.MAX_BULK_ENTRIES} entries maximum`);
    }

    // Validate operation type
    const validOperations = ['delete', 'update_status', 'update_fields'];
    if (!validOperations.includes(params.operation_type)) {
      result.isValid = false;
      result.errors.push('Invalid operation type');
    }

    // Require confirmation
    if (params.confirm !== true) {
      result.isValid = false;
      result.errors.push('Bulk operations require explicit confirmation (confirm: true)');
    }

    // Validate data for update operations
    if (params.operation_type?.startsWith('update_') && !params.data) {
      result.isValid = false;
      result.errors.push('Data is required for update operations');
    }

    return result;
  }

  validateTemplateParams(params: any): ValidationResult {
    const result: ValidationResult = { isValid: true, errors: [] };

    if (!params || typeof params !== 'object') {
      result.isValid = false;
      result.errors.push('Parameters object is required');
      return result;
    }

    // Validate source form ID
    const formIdResult = this.validateFormId(params.source_form_id);
    if (!formIdResult.isValid) {
      result.isValid = false;
      result.errors.push(...formIdResult.errors);
    }

    // Validate template name
    if (!params.template_name || typeof params.template_name !== 'string' || params.template_name.trim() === '') {
      result.isValid = false;
      result.errors.push('Template name cannot be empty');
    } else if (params.template_name.length > this.MAX_STRING_LENGTH) {
      result.isValid = false;
      result.errors.push(`Template name too long (max ${this.MAX_STRING_LENGTH} characters)`);
    } else if (this.containsInvalidChars(params.template_name)) {
      result.isValid = false;
      result.errors.push('Template name contains invalid characters');
    }

    // Validate field renames
    if (params.field_renames && Array.isArray(params.field_renames)) {
      for (const rename of params.field_renames) {
        if (!rename.original_label || !rename.new_label) {
          result.isValid = false;
          result.errors.push('Field rename must include both original_label and new_label');
          continue;
        }

        if (this.containsInvalidChars(rename.new_label)) {
          result.isValid = false;
          result.errors.push('Field label contains invalid characters');
        }
      }
    }

    return result;
  }

  validateImportExportParams(params: any): ValidationResult {
    const result: ValidationResult = { isValid: true, errors: [] };

    if (!params || typeof params !== 'object') {
      result.isValid = false;
      result.errors.push('Parameters object is required');
      return result;
    }

    // Validate form JSON
    if (!params.form_json || typeof params.form_json !== 'string') {
      result.isValid = false;
      result.errors.push('Form JSON is required');
      return result;
    }

    // Validate JSON format
    try {
      const parsedJson = JSON.parse(params.form_json);
      
      // Basic structure validation
      if (!parsedJson.title || !parsedJson.fields) {
        result.isValid = false;
        result.errors.push('Form JSON must contain title and fields');
      }
    } catch (e) {
      result.isValid = false;
      result.errors.push('Invalid JSON format');
    }

    // Validate target form ID if provided
    if (params.target_form_id) {
      const formIdResult = this.validateFormId(params.target_form_id);
      if (!formIdResult.isValid) {
        result.isValid = false;
        result.errors.push(...formIdResult.errors);
      }
    }

    return result;
  }

  private containsInvalidChars(str: string): boolean {
    // Check for XSS patterns, script tags, and other dangerous content
    const dangerousPatterns = [
      /<script[^>]*>/i,
      /<\/script>/i,
      /javascript:/i,
      /on\w+\s*=/i,
      /<iframe[^>]*>/i,
      /<object[^>]*>/i,
      /<embed[^>]*>/i
    ];

    return dangerousPatterns.some(pattern => pattern.test(str));
  }

  private containsInvalidFilenameChars(filename: string): boolean {
    // Check for directory traversal and invalid filename characters
    const invalidPatterns = [
      /\.\./,     // Directory traversal anywhere in string
      /[<>:"|?*]/,  // Invalid filename characters
      /^[./]/,    // Starting with dot or slash
      /[./]$/,    // Ending with dot or slash
      /\/|\\/, // Any forward or backslash (directory separators)
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i, // Reserved Windows names
    ];

    return invalidPatterns.some(pattern => pattern.test(filename));
  }

  // Utility method to sanitize string inputs
  sanitizeString(input: string): string {
    if (typeof input !== 'string') {
      return '';
    }

    return input
      .trim()
      .replace(/[<>]/g, '') // Remove angle brackets
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, '') // Remove event handlers
      .substring(0, this.MAX_STRING_LENGTH); // Limit length
  }

  // Utility method for comprehensive parameter validation
  validateAndSanitize(params: any, schema: 'export' | 'bulk' | 'template' | 'import'): ValidationResult {
    switch (schema) {
      case 'export':
        return this.validateExportEntriesParams(params);
      case 'bulk':
        return this.validateBulkProcessParams(params);
      case 'template':
        return this.validateTemplateParams(params);
      case 'import':
        return this.validateImportExportParams(params);
      default:
        return { isValid: false, errors: ['Invalid validation schema'] };
    }
  }
}