// ABOUTME: Bulk operations manager for Gravity Forms entries
// ABOUTME: Provides safe bulk operations with confirmation, validation, and audit trails

import type { IGravityEntry } from './gravityFormsTypes.js';
import type { BulkProcessParams, ValidationResult } from './validation.js';

export type BulkOperationType = 'delete' | 'update_status' | 'update_fields';

// Alias (not a re-declared interface) — BulkOperationParams adds no members
// beyond BulkProcessParams, and an interface with no additional members over
// its single supertype is flagged by no-empty-object-type.
export type BulkOperationParams = BulkProcessParams;

export interface BulkOperationPreview {
  operation_type: BulkOperationType;
  total_entries: number;
  entries_found: Array<{ id: string; preview: string }>;
  entries_not_found: string[];
  description: string;
  warnings: string[];
  estimated_time_seconds?: number;
}

export interface BulkOperationProgress {
  processed: number;
  total: number;
  current_entry: string;
}

export interface BulkOperationFailure {
  entry_id: string;
  error: string;
  error_code?: string;
}

export interface BulkOperationAuditTrail {
  operation_id: string;
  timestamp: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  operation_summary: string;
  affected_entries: string[];
  user_confirmation: boolean;
}

export interface BulkOperationRollbackData {
  original_values: Array<{
    entry_id: string;
    original_data: unknown;
  }>;
  rollback_instructions: string;
}

export interface BulkOperationResult {
  operation_type: BulkOperationType;
  total_requested: number;
  successful: number;
  failed: number;
  success_ids: string[];
  failed_entries: BulkOperationFailure[];
  can_rollback: boolean;
  rollback_data?: BulkOperationRollbackData;
  audit_trail?: BulkOperationAuditTrail;
  operation_summary: string;
}

// Falls back to `fallback` for any falsy value, matching `||` semantics
// (including an empty string) — `??` would only treat null/undefined as
// "missing" and is deliberately not used here.
function withFallback(value: string | undefined, fallback: string): string {
  if (value) {
    return value;
  }
  return fallback;
}

// Extracts a string `.code` off a caught error (Node system errors carry one,
// e.g. 'ECONNREFUSED'), falling back to 'UNKNOWN_ERROR' for anything else —
// matching the original `(error as any)?.code || 'UNKNOWN_ERROR'`.
function getErrorCode(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && code !== '' ? code : 'UNKNOWN_ERROR';
}

export class BulkOperationsManager {
  private readonly MAX_ENTRY_LIMIT = 100;
  private readonly baseUrl: string;
  private readonly authHeaders: Record<string, string>;

  constructor(baseUrl: string, authHeaders: Record<string, string>) {
    this.baseUrl = baseUrl;
    this.authHeaders = authHeaders;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getAuthHeaders(): Record<string, string> {
    return this.authHeaders;
  }

  getMaxEntryLimit(): number {
    return this.MAX_ENTRY_LIMIT;
  }

  // Shared numeric-id check used anywhere an entry ID is interpolated into a
  // request URL, so a value like "1/../../users" can never reach fetch().
  private isValidEntryId(entryId: string): boolean {
    return typeof entryId === 'string' && /^\d+$/.test(entryId.trim());
  }

  // Validates params.entry_ids (presence, MAX_ENTRY_LIMIT, and that every ID is
  // purely numeric), appending any problems found to `errors`.
  private validateEntryIdsList(params: BulkOperationParams, errors: string[]): void {
    if (!params.entry_ids || params.entry_ids.length === 0) {
      errors.push('At least one entry ID is required');
      return;
    }

    if (params.entry_ids.length > this.MAX_ENTRY_LIMIT) {
      errors.push('Bulk operations limited to 100 entries maximum');
    }

    // Reject any entry ID that isn't purely numeric to prevent it from being
    // interpolated into request URLs and reaching an unintended REST resource
    for (const entryId of params.entry_ids) {
      if (!this.isValidEntryId(entryId)) {
        errors.push(`Entry ID "${entryId}" must be numeric`);
      }
    }
  }

  // Validates the `data` payload required for update_status/update_fields
  // operations, appending any problems found to `errors`.
  private validateUpdateData(params: BulkOperationParams, errors: string[]): void {
    if (params.operation_type === 'update_status' || params.operation_type === 'update_fields') {
      if (!params.data || Object.keys(params.data).length === 0) {
        errors.push('Data is required for update operations');
      }
    }

    // update_status specifically requires a non-empty status value. Without this, a
    // payload like { note: 'x' } passes the generic check above but sends an empty PUT
    // body ({ status: undefined } -> "{}"), which is silently recorded as success (audit A12).
    if (params.operation_type === 'update_status') {
      const status = params.data?.status;
      if (typeof status !== 'string' || status.trim() === '') {
        errors.push('update_status requires a non-empty "status" value in data');
      }
    }
  }

  validateOperation(params: BulkOperationParams): ValidationResult {
    const errors: string[] = [];

    this.validateEntryIdsList(params, errors);

    // Validate operation type
    const validOperations: BulkOperationType[] = ['delete', 'update_status', 'update_fields'];
    if (!validOperations.includes(params.operation_type)) {
      errors.push('Invalid operation type. Must be delete, update_status, or update_fields');
    }

    // Validate confirmation
    if (!params.confirm) {
      errors.push('Bulk operations require explicit confirmation (confirm: true)');
    }

    this.validateUpdateData(params, errors);

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  async getOperationPreview(params: BulkOperationParams): Promise<BulkOperationPreview> {
    // Reject any entry ID that isn't purely numeric before issuing any request,
    // matching the guard applied in validateOperation/executeOperation.
    for (const entryId of params.entry_ids) {
      if (!this.isValidEntryId(entryId)) {
        throw new Error(`Entry ID "${entryId}" must be numeric`);
      }
    }

    const entriesFound: Array<{ id: string; preview: string }> = [];
    const entriesNotFound: string[] = [];
    const warnings: string[] = [];

    // Fetch each entry to verify existence and generate preview
    for (const entryId of params.entry_ids) {
      try {
        const response = await fetch(`${this.baseUrl}/entries/${entryId}`, {
          method: 'GET',
          headers: this.authHeaders,
          signal: AbortSignal.timeout(30000)
        });

        if (response.ok) {
          const entry = await response.json() as IGravityEntry;
          const preview = this.generateEntryPreview(entry, params.operation_type);
          entriesFound.push({ id: entryId, preview });
        } else {
          entriesNotFound.push(entryId);
          warnings.push(`Entry ${entryId} not found and will be skipped`);
        }
      } catch (error) {
        entriesNotFound.push(entryId);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        warnings.push(`Failed to fetch entry ${entryId}: ${errorMessage}`);
      }
    }

    const description = this.generateOperationDescription(params, entriesFound.length);

    return {
      operation_type: params.operation_type,
      total_entries: params.entry_ids.length,
      entries_found: entriesFound,
      entries_not_found: entriesNotFound,
      description,
      warnings,
      estimated_time_seconds: Math.ceil(entriesFound.length * 0.5) // Rough estimate
    };
  }

  async executeOperation(
    params: BulkOperationParams,
    progressCallback?: (progress: BulkOperationProgress) => void
  ): Promise<BulkOperationResult> {
    // Validate operation first
    const validation = this.validateOperation(params);
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    const startTime = Date.now();
    const operationId = this.generateOperationId();
    const successIds: string[] = [];
    const failedEntries: BulkOperationFailure[] = [];
    let rollbackData: BulkOperationRollbackData | undefined;

    // Prepare rollback data for update operations
    if (params.operation_type !== 'delete') {
      try {
        rollbackData = await this.prepareRollbackData(params.entry_ids);
      } catch (error) {
        // Continue even if rollback data preparation fails
        console.warn('Failed to prepare rollback data:', error);
      }
    }

    // Execute operation for each entry
    for (let i = 0; i < params.entry_ids.length; i++) {
      const entryId = params.entry_ids[i];

      try {
        await this.executeOperationForEntry(entryId, params);
        successIds.push(entryId);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorCode = getErrorCode(error);
        failedEntries.push({
          entry_id: entryId,
          error: errorMessage,
          error_code: errorCode
        });
      }

      // Report progress AFTER processing each entry
      if (progressCallback) {
        progressCallback({
          processed: i + 1,
          total: params.entry_ids.length,
          current_entry: entryId
        });
      }
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Generate audit trail
    const auditTrail: BulkOperationAuditTrail = {
      operation_id: operationId,
      timestamp: new Date().toISOString(),
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date(endTime).toISOString(),
      duration_ms: duration,
      operation_summary: this.generateOperationSummary(params, successIds.length, failedEntries.length),
      affected_entries: successIds,
      user_confirmation: params.confirm
    };

    return {
      operation_type: params.operation_type,
      total_requested: params.entry_ids.length,
      successful: successIds.length,
      failed: failedEntries.length,
      success_ids: successIds,
      failed_entries: failedEntries,
      // Only claim rollback is possible when we captured an original value for EVERY
      // requested entry. Partial coverage (a GET failed during rollback prep) previously
      // still reported can_rollback:true, misleading the operator (audit A7).
      can_rollback: params.operation_type !== 'delete'
        && rollbackData !== undefined
        && rollbackData.original_values.length === params.entry_ids.length,
      rollback_data: rollbackData,
      audit_trail: auditTrail,
      operation_summary: `${params.operation_type.toUpperCase()} operation completed: ${successIds.length} successful, ${failedEntries.length} failed`
    };
  }

  private async executeOperationForEntry(entryId: string, params: BulkOperationParams): Promise<void> {
    let url: string;
    let method: string;
    let body: unknown;

    switch (params.operation_type) {
      case 'delete':
        url = `${this.baseUrl}/entries/${entryId}`;
        method = 'DELETE';
        break;

      case 'update_status':
        url = `${this.baseUrl}/entries/${entryId}`;
        method = 'PUT';
        // For update_status, only send the status field to avoid confusion
        body = { status: params.data?.status };
        break;

      case 'update_fields':
        url = `${this.baseUrl}/entries/${entryId}`;
        method = 'PUT';
        body = params.data;
        break;

      default:
        // params.operation_type is exhaustively covered above (BulkOperationType has
        // exactly 3 members), so this branch is statically unreachable — String()
        // covers a caller bypassing the type at runtime.
        throw new Error(`Unsupported operation type: ${String(params.operation_type)}`);
    }

    const response = await fetch(url, {
      method,
      headers: this.authHeaders,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { message?: string };
      throw new Error(withFallback(errorData.message, `HTTP ${response.status}: ${response.statusText}`));
    }
  }

  private async prepareRollbackData(entryIds: string[]): Promise<BulkOperationRollbackData> {
    const originalValues: Array<{ entry_id: string; original_data: unknown }> = [];

    for (const entryId of entryIds) {
      try {
        const response = await fetch(`${this.baseUrl}/entries/${entryId}`, {
          method: 'GET',
          headers: this.authHeaders,
          signal: AbortSignal.timeout(30000)
        });

        if (response.ok) {
          const originalData: unknown = await response.json();
          originalValues.push({ entry_id: entryId, original_data: originalData });
        }
      } catch (error) {
        // Continue with other entries if one fails
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`Failed to fetch original data for entry ${entryId}: ${errorMessage}`);
      }
    }

    return {
      original_values: originalValues,
      rollback_instructions: 'Use the update_entry tool with the original_data values to restore previous state'
    };
  }

  private generateEntryPreview(entry: IGravityEntry, operationType: BulkOperationType): string {
    const entryId = withFallback(entry.id, 'Unknown');
    const formId = withFallback(entry.form_id, 'Unknown');

    switch (operationType) {
      case 'delete':
        return `Entry ${entryId} (Form ${formId}) will be PERMANENTLY DELETED`;
      case 'update_status':
        return `Entry ${entryId} status will be updated`;
      case 'update_fields':
        return `Entry ${entryId} fields will be updated`;
      default:
        return `Entry ${entryId} will be processed`;
    }
  }

  private generateOperationDescription(params: BulkOperationParams, validEntries: number): string {
    const action = params.operation_type.toUpperCase().replace('_', ' ');

    switch (params.operation_type) {
      case 'delete':
        return `WARNING: This will ${action} ${validEntries} entries permanently. This action cannot be undone.`;

      case 'update_status': {
        const status = withFallback(params.data?.status, 'specified status');
        return `This will ${action} to "${status}" for ${validEntries} entries.`;
      }

      case 'update_fields': {
        // Computed for parity with the original (pre-existing, unused even before
        // this migration) — kept rather than deleted since removing it is outside
        // this task's typing-only scope; `_`-prefixed per the project's unused-var
        // convention.
        const _fieldCount = params.data ? Object.keys(params.data).length : 0;
        const fieldList = params.data ? Object.keys(params.data).map(k => `Field ${k}`).join(', ') : '';
        return `This will ${action} (${fieldList}) for ${validEntries} entries.`;
      }

      default:
        return `This will perform ${action} on ${validEntries} entries.`;
    }
  }

  private generateOperationSummary(params: BulkOperationParams, successful: number, failed: number): string {
    return `${params.operation_type.toUpperCase()} operation: ${successful} successful, ${failed} failed`;
  }

  private generateOperationId(): string {
    return `bulk_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
