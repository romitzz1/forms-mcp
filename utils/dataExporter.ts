// ABOUTME: Data export utilities for converting Gravity Forms entries to CSV/JSON
// ABOUTME: Handles complex field types, date formatting, CSV formula neutralization, and UTC filenames

import type { IGravityEntry } from './gravityFormsTypes.js';

export type ExportFormat = 'csv' | 'json';

export interface ExportOptions {
  dateFormat?: string;
  includeHeaders?: boolean;
  filename?: string;
  fieldIds?: string[];
  entryOffset?: number;
}

export interface ExportResult {
  data: string;
  filename: string;
  format: ExportFormat;
  mimeType: string;
  previewRows?: string[][];
}

const FORMULA_LEADING = /^[=+\-@\t\r]/;
const NUMBER_SHAPED = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;
const PHONE_SHAPED = /^\+[\d\s().-]+$/;
const BOM = '﻿';
const PREVIEW_DATA_ROWS = 3;

// Spreadsheet apps execute cells that start with = + - @ (and tab/CR) as formulas.
// Gravity Forms returns every value as a string, so number- and phone-shaped
// strings are exempted by pattern rather than by type.
export function neutralizeCsvCell(value: string): string {
  if (!FORMULA_LEADING.test(value)) return value;
  if (NUMBER_SHAPED.test(value) || PHONE_SHAPED.test(value)) return value;
  return `'${value}`;
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

  // Entries arrive as `IGravityEntry`, but this method is defensively typed to
  // tolerate a null/non-object entry (matching the original's own runtime
  // guard) even though both call sites below only ever pass already-validated
  // objects.
  private sanitizeEntry(entry: IGravityEntry | null | undefined, dateFormat?: string, forCSV = false): Record<string, unknown> | null {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry)) {
      if (value === null || value === undefined) {
        sanitized[key] = value;
      } else if (Array.isArray(value)) {
        if (forCSV) {
          // Arrays of objects (e.g. GF multi-column List fields) must be JSON-stringified —
          // Array.join would coerce each object to "[object Object]" and lose the data.
          // Primitive arrays keep the human-readable comma join.
          const hasObjects = value.some((v) => v !== null && typeof v === 'object');
          sanitized[key] = hasObjects ? JSON.stringify(value) : value.join(',');
        } else {
          // For JSON, keep arrays as-is
          sanitized[key] = value;
        }
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

  private cellText(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      return neutralizeCsvCell(JSON.stringify(value));
    }
    // This branch only ever sees primitives or arrays (plain objects were routed
    // to JSON.stringify above), both of which have a meaningful (non-"[object
    // Object]") toString, so the cast documents that rather than changing behavior.
    return neutralizeCsvCell(String(value as string | number | boolean | unknown[]));
  }

  private quoteCSV(stringValue: string): string {
    // Escape CSV special characters
    if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
      return '"' + stringValue.replace(/"/g, '""') + '"';
    }
    return stringValue;
  }

  private getAllFields(entries: Array<Record<string, unknown> | null>): string[] {
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
      // Both keys always come from fieldMap's own key set, so `.get()` never
      // actually returns undefined here — the `?? 0` fallback documents that
      // instead of relying on a non-null assertion.
      return (fieldMap.get(a) ?? 0) - (fieldMap.get(b) ?? 0);
    });
  }

  private filterEntryFields(entry: IGravityEntry, fieldIds: string[]): IGravityEntry {
    const filtered: Record<string, unknown> = {};

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

    return filtered as IGravityEntry;
  }

  private exportToCSV(entries: IGravityEntry[], options: ExportOptions = {}): { data: string; previewRows: string[][] } {
    const validEntries = entries.filter(entry => entry && typeof entry === 'object');

    if (validEntries.length === 0) {
      return { data: '', previewRows: [] };
    }

    // Apply field filtering if fieldIds is provided
    let entriesToProcess = validEntries;
    if (options.fieldIds && options.fieldIds.length > 0) {
      const fieldIds = options.fieldIds;
      entriesToProcess = validEntries.map(entry =>
        this.filterEntryFields(entry, fieldIds)
      );
    }

    // Every element of entriesToProcess passed the `entry && typeof entry === 'object'`
    // check above, so sanitizeEntry's own (defensive-only) null branch never
    // triggers here — the cast documents that known invariant.
    const sanitizedEntries = entriesToProcess.map(entry =>
      this.sanitizeEntry(entry, options.dateFormat, true)
    ) as Array<Record<string, unknown>>;

    const allFields = this.getAllFields(sanitizedEntries);
    const cellRows: string[][] = sanitizedEntries.map(entry => allFields.map(field => this.cellText(entry[field])));
    const includeHeaders = options.includeHeaders !== false;
    const textRows = includeHeaders ? [allFields, ...cellRows] : cellRows;
    const data = BOM + textRows.map(row => row.map(cell => this.quoteCSV(cell)).join(',')).join('\n');
    const previewRows = [allFields, ...cellRows.slice(0, PREVIEW_DATA_ROWS)];

    return { data, previewRows };
  }

  private exportToJSON(entries: IGravityEntry[], options: ExportOptions = {}): string {
    const validEntries = entries.filter(entry => entry && typeof entry === 'object');

    if (validEntries.length === 0) {
      return '[]';
    }

    // Apply field filtering if fieldIds is provided
    let entriesToProcess = validEntries;
    if (options.fieldIds && options.fieldIds.length > 0) {
      const fieldIds = options.fieldIds;
      entriesToProcess = validEntries.map(entry =>
        this.filterEntryFields(entry, fieldIds)
      );
    }

    const sanitizedEntries = entriesToProcess.map(entry =>
      this.sanitizeEntry(entry, options.dateFormat, false)
    );

    return JSON.stringify(sanitizedEntries, null, 2);
  }

  private utcStamp(now: Date): string {
    return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  private generateFilename(format: ExportFormat, customFilename?: string, formId?: string, entryOffset?: number): string {
    if (customFilename) {
      return customFilename.endsWith(`.${format}`) ? customFilename : `${customFilename}.${format}`;
    }
    const formPart = formId ? `-form-${formId}` : '';
    const offsetPart = entryOffset ? `-offset-${entryOffset}` : '';
    return `entries${formPart}${offsetPart}-${this.utcStamp(new Date())}.${format}`;
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

  // Rendering is synchronous (no disk I/O), but the signature stays
  // Promise-returning so callers awaiting export() don't need to change.
  export(
    entries: IGravityEntry[],
    format: ExportFormat,
    options: ExportOptions = {},
    formId?: string
  ): Promise<ExportResult> {
    let data: string;
    let previewRows: string[][] | undefined;

    switch (format) {
      case 'csv': {
        const csv = this.exportToCSV(entries, options);
        data = csv.data;
        previewRows = csv.previewRows;
        break;
      }
      case 'json':
        data = this.exportToJSON(entries, options);
        break;
      default:
        // `format` is exhaustively 'csv' | 'json' per ExportFormat, so this branch is
        // statically unreachable — String() covers a caller bypassing the type (e.g.
        // via `as ExportFormat`) with something else at runtime.
        throw new Error(`Unsupported export format: ${String(format)}`);
    }

    return Promise.resolve({
      data,
      filename: this.generateFilename(format, options.filename, formId, options.entryOffset),
      format,
      mimeType: this.getMimeType(format),
      previewRows,
    });
  }
}
