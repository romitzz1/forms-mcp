// ABOUTME: Data export utilities for converting Gravity Forms entries to CSV/JSON
// ABOUTME: Handles complex field types, date formatting, and base64 encoding for downloads

export type ExportFormat = 'csv' | 'json';

export interface ExportOptions {
  dateFormat?: string;
  includeHeaders?: boolean;
  filename?: string;
}

export interface ExportResult {
  data: string;
  base64Data?: string;
  filename: string;
  format: ExportFormat;
  mimeType: string;
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

  private exportToCSV(entries: any[], options: ExportOptions = {}): string {
    const validEntries = entries.filter(entry => entry && typeof entry === 'object');
    
    if (validEntries.length === 0) {
      return '';
    }

    const sanitizedEntries = validEntries.map(entry => 
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

    const sanitizedEntries = validEntries.map(entry => 
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

  async export(
    entries: any[], 
    format: ExportFormat, 
    options: ExportOptions = {}
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
    const base64Data = data ? Buffer.from(data, 'utf-8').toString('base64') : '';

    return {
      data,
      base64Data,
      filename,
      format,
      mimeType
    };
  }
}