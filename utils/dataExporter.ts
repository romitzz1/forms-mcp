// ABOUTME: Data export utilities for converting Gravity Forms entries to CSV/JSON
// ABOUTME: Handles complex field types, date formatting, and base64 encoding for downloads

import * as fs from 'fs';
import * as path from 'path';

export type ExportFormat = 'csv' | 'json';

export interface ExportOptions {
  dateFormat?: string;
  includeHeaders?: boolean;
  filename?: string;
  saveToDisk?: boolean;
  outputPath?: string;
  skipBase64?: boolean;
  fieldIds?: string[];
}

export interface ExportResult {
  data: string;
  base64Data?: string;
  filename: string;
  format: ExportFormat;
  mimeType: string;
  filePath?: string;
}

export class DataExporter {
  private formatDate(dateString: string, format = 'YYYY-MM-DD HH:mm:ss'): string {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return dateString; // Return original if not a valid date
    }

    // Simple date formatting (in a real implementation, you might use a library like date-fns)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return format
      .replace('YYYY', String(year))
      .replace('MM', month)
      .replace('DD', day)
      .replace('HH', hours)
      .replace('mm', minutes)
      .replace('ss', seconds);
  }

  private sanitizeEntry(entry: any, dateFormat?: string, forCSV = false): any {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(entry)) {
      if (value === null || value === undefined) {
        sanitized[key] = value;
      } else if (Array.isArray(value)) {
        // For CSV, join arrays with commas; for JSON, keep as arrays
        sanitized[key] = forCSV ? value.join(',') : value;
      } else if (typeof value === 'object') {
        sanitized[key] = value; // Keep objects as-is for JSON, will be stringified for CSV
      } else if (typeof value === 'string' && this.isDateString(value) && dateFormat) {
        sanitized[key] = this.formatDate(value, dateFormat);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private isDateString(value: string): boolean {
    // Simple check for date strings like "2024-01-15 10:30:00" or "2024-01-15"
    return /^\d{4}-\d{2}-\d{2}(\s\d{2}:\d{2}:\d{2})?$/.test(value);
  }

  private escapeCSVValue(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }

    let stringValue = String(value);
    
    if (typeof value === 'object' && !Array.isArray(value)) {
      stringValue = JSON.stringify(value);
    }

    // Escape CSV special characters
    if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
      stringValue = '"' + stringValue.replace(/"/g, '""') + '"';
    }

    return stringValue;
  }

  private getAllFields(entries: any[]): string[] {
    const fieldMap = new Map<string, number>();
    let order = 0;
    
    for (const entry of entries) {
      if (entry && typeof entry === 'object') {
        Object.keys(entry).forEach(key => {
          if (!fieldMap.has(key)) {
            fieldMap.set(key, order++);
          }
        });
      }
    }

    // Sort by the order they first appeared, but prioritize 'id' first
    return Array.from(fieldMap.keys()).sort((a, b) => {
      if (a === 'id' && b !== 'id') return -1;
      if (b === 'id' && a !== 'id') return 1;
      return fieldMap.get(a)! - fieldMap.get(b)!;
    });
  }

  private filterEntryFields(entry: any, fieldIds: string[]): any {
    const filtered: any = {};

    // Define metadata fields that should always be included
    const metadataFields = ['id', 'form_id', 'date_created', 'date_updated', 'status', 'is_starred', 'is_read',
                           'ip', 'source_url', 'user_agent', 'currency', 'payment_status', 'payment_date',
                           'payment_amount', 'payment_method', 'transaction_id', 'is_fulfilled', 'created_by',
                           'transaction_type', 'source_id', 'post_id', 'is_approved'];

    // Always include metadata fields
    metadataFields.forEach(field => {
      if (entry[field] !== undefined) {
        filtered[field] = entry[field];
      }
    });

    // Create a Set for faster lookup of requested field IDs
    const fieldIdSet = new Set(fieldIds);

    // Single pass through entry keys for better performance
    Object.keys(entry).forEach(key => {
      // Check if this key matches any requested field
      if (fieldIdSet.has(key)) {
        filtered[key] = entry[key];
        return;
      }

      // Check if this is a composite sub-field of any requested field
      const dotIndex = key.indexOf('.');
      if (dotIndex > 0) {
        const parentFieldId = key.substring(0, dotIndex);
        if (fieldIdSet.has(parentFieldId)) {
          filtered[key] = entry[key];
        }
      }
    });

    return filtered;
  }

  private exportToCSV(entries: any[], options: ExportOptions = {}): string {
    const validEntries = entries.filter(entry => entry && typeof entry === 'object');

    if (validEntries.length === 0) {
      return '';
    }

    // Apply field filtering if fieldIds is provided
    let entriesToProcess = validEntries;
    if (options.fieldIds && options.fieldIds.length > 0) {
      entriesToProcess = validEntries.map(entry =>
        this.filterEntryFields(entry, options.fieldIds!)
      );
    }

    const sanitizedEntries = entriesToProcess.map(entry =>
      this.sanitizeEntry(entry, options.dateFormat, true)
    );

    const allFields = this.getAllFields(sanitizedEntries);
    const rows: string[] = [];

    // Add headers if requested
    if (options.includeHeaders !== false) {
      rows.push(allFields.join(','));
    }

    // Add data rows
    for (const entry of sanitizedEntries) {
      const row = allFields.map(field => this.escapeCSVValue(entry[field]));
      rows.push(row.join(','));
    }

    return rows.join('\n');
  }

  private exportToJSON(entries: any[], options: ExportOptions = {}): string {
    const validEntries = entries.filter(entry => entry && typeof entry === 'object');

    if (validEntries.length === 0) {
      return '[]';
    }

    // Apply field filtering if fieldIds is provided
    let entriesToProcess = validEntries;
    if (options.fieldIds && options.fieldIds.length > 0) {
      entriesToProcess = validEntries.map(entry =>
        this.filterEntryFields(entry, options.fieldIds!)
      );
    }

    const sanitizedEntries = entriesToProcess.map(entry =>
      this.sanitizeEntry(entry, options.dateFormat, false)
    );

    return JSON.stringify(sanitizedEntries, null, 2);
  }

  private generateFilename(format: ExportFormat, customFilename?: string): string {
    if (customFilename) {
      return customFilename.endsWith(`.${format}`) ? customFilename : `${customFilename}.${format}`;
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, ''); // HHMMSS
    
    return `export_${dateStr}_${timeStr}.${format}`;
  }

  private getMimeType(format: ExportFormat): string {
    switch (format) {
      case 'csv':
        return 'text/csv';
      case 'json':
        return 'application/json';
      default:
        return 'text/plain';
    }
  }

  private getDefaultExportPath(formId?: string): string {
    const exportDir = process.env.GRAVITY_FORMS_EXPORT_DIR || './exports';
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    if (formId) {
      return path.join(exportDir, formId, today);
    }
    return path.join(exportDir, today);
  }

  private ensureDirectoryExists(dirPath: string): void {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create directory ${dirPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async saveToFile(data: string, filename: string, outputPath?: string, formId?: string): Promise<string> {
    let fullPath: string;

    if (outputPath) {
      // Custom path provided
      if (path.isAbsolute(outputPath)) {
        fullPath = outputPath;
      } else {
        fullPath = path.resolve(outputPath);
      }
    } else {
      // Use default path structure
      const defaultDir = this.getDefaultExportPath(formId);
      this.ensureDirectoryExists(defaultDir);
      fullPath = path.join(defaultDir, filename);
    }

    // Ensure the directory exists for the file
    const dir = path.dirname(fullPath);
    this.ensureDirectoryExists(dir);

    try {
      await fs.promises.writeFile(fullPath, data, 'utf8');
      return fullPath;
    } catch (error) {
      throw new Error(`Failed to save file to ${fullPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async export(
    entries: any[],
    format: ExportFormat,
    options: ExportOptions = {},
    formId?: string
  ): Promise<ExportResult> {
    let data: string;

    switch (format) {
      case 'csv':
        data = this.exportToCSV(entries, options);
        break;
      case 'json':
        data = this.exportToJSON(entries, options);
        break;
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }

    const filename = this.generateFilename(format, options.filename);
    const mimeType = this.getMimeType(format);

    // Conditionally generate base64 data
    let base64Data: string | undefined;
    if (!options.skipBase64) {
      base64Data = data ? Buffer.from(data, 'utf-8').toString('base64') : '';
    }

    let filePath: string | undefined;

    // Save to disk if requested
    if (options.saveToDisk) {
      try {
        filePath = await this.saveToFile(data, filename, options.outputPath, formId);
      } catch (error) {
        throw new Error(`Failed to save export to disk: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return {
      data,
      base64Data,
      filename,
      format,
      mimeType,
      filePath
    };
  }
}