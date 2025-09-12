// ABOUTME: Bulk operations manager for Gravity Forms entries
// ABOUTME: Provides safe bulk operations with confirmation, validation, and audit trails

import type { BulkProcessParams, ValidationResult } from './validation.js';

export type BulkOperationType = 'delete' | 'update_status' | 'update_fields';

export interface BulkOperationParams extends BulkProcessParams {
  // Extends the base BulkProcessParams from validation
}

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
    original_data: any;
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

  validateOperation(params: BulkOperationParams): ValidationResult {
    const errors: string[] = [];

    // Validate entry IDs
    if (!params.entry_ids || params.entry_ids.length === 0) {
      errors.push('At least one entry ID is required');
    } else if (params.entry_ids.length > this.MAX_ENTRY_LIMIT) {
      errors.push('Bulk operations limited to 100 entries maximum');
    }

    // Validate operation type
    const validOperations: BulkOperationType[] = ['delete', 'update_status', 'update_fields'];
    if (!validOperations.includes(params.operation_type)) {
      errors.push('Invalid operation type. Must be delete, update_status, or update_fields');
    }

    // Validate confirmation
    if (!params.confirm) {
      errors.push('Bulk operations require explicit confirmation (confirm: true)');
    }

    // Validate data for update operations
    if (params.operation_type === 'update_status' || params.operation_type === 'update_fields') {
      if (!params.data || Object.keys(params.data).length === 0) {
        errors.push('Data is required for update operations');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  async getOperationPreview(params: BulkOperationParams): Promise<BulkOperationPreview> {
    const entriesFound: Array<{ id: string; preview: string }> = [];
    const entriesNotFound: string[] = [];
    const warnings: string[] = [];

    // Fetch each entry to verify existence and generate preview
    for (const entryId of params.entry_ids) {
      try {
        const response = await fetch(`${this.baseUrl}/entries/${entryId}`, {
          method: 'GET',
          headers: this.authHeaders
        });

        if (response.ok) {
          const entry = await response.json();
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
        const errorCode = (error as any)?.code || 'UNKNOWN_ERROR';
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
      can_rollback: params.operation_type !== 'delete' && rollbackData !== undefined,
      rollback_data: rollbackData,
      audit_trail: auditTrail,
      operation_summary: `${params.operation_type.toUpperCase()} operation completed: ${successIds.length} successful, ${failedEntries.length} failed`
    };
  }

  private async executeOperationForEntry(entryId: string, params: BulkOperationParams): Promise<void> {
    let url: string;
    let method: string;
    let body: any = undefined;

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
        throw new Error(`Unsupported operation type: ${params.operation_type}`);
    }

    const response = await fetch(url, {
      method,
      headers: this.authHeaders,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
    }
  }

  private async prepareRollbackData(entryIds: string[]): Promise<BulkOperationRollbackData> {
    const originalValues: Array<{ entry_id: string; original_data: any }> = [];

    for (const entryId of entryIds) {
      try {
        const response = await fetch(`${this.baseUrl}/entries/${entryId}`, {
          method: 'GET',
          headers: this.authHeaders
        });

        if (response.ok) {
          const originalData = await response.json();
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

  private generateEntryPreview(entry: any, operationType: BulkOperationType): string {
    const entryId = entry.id || 'Unknown';
    const formId = entry.form_id || 'Unknown';
    
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
      
      case 'update_status':
        const status = params.data?.status || 'specified status';
        return `This will ${action} to "${status}" for ${validEntries} entries.`;
      
      case 'update_fields':
        const fieldCount = params.data ? Object.keys(params.data).length : 0;
        const fieldList = params.data ? Object.keys(params.data).map(k => `Field ${k}`).join(', ') : '';
        return `This will ${action} (${fieldList}) for ${validEntries} entries.`;
      
      default:
        return `This will perform ${action} on ${validEntries} entries.`;
    }
  }

  private generateOperationSummary(params: BulkOperationParams, successful: number, failed: number): string {
    return `${params.operation_type.toUpperCase()} operation: ${successful} successful, ${failed} failed`;
  }

  private generateOperationId(): string {
    return `bulk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}