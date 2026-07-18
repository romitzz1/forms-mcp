// ABOUTME: Bulk-operations MCP tool handler (process_entries_bulk)
// ABOUTME: Extracted from GravityFormsMCPServer to isolate handler logic from server infrastructure

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { BulkOperationParams, BulkOperationsManager } from "./bulkOperations.js";

export interface BulkToolContext {
  getBulkOperationsManager(): BulkOperationsManager;
}

export interface BulkToolResult {
  content: Array<{ type: "text"; text: string }>;
}

// process_entries_bulk's args are the same shape BulkOperationsManager itself
// validates/executes against — reuse that domain type rather than duplicating it.
export type ProcessEntriesBulkArgs = BulkOperationParams;

export async function processEntriesBulk(ctx: BulkToolContext, args: unknown): Promise<BulkToolResult> {
    try {
      // Extract and validate parameters
      const { entry_ids, operation_type, confirm, data } = args as ProcessEntriesBulkArgs;

      // Get BulkOperationsManager (lazy initialization)
      const bulkManager = ctx.getBulkOperationsManager();

      // Validate using BulkOperationsManager
      const validation = bulkManager.validateOperation({
        entry_ids,
        operation_type,
        confirm,
        data
      });

      if (!validation.isValid) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Validation failed: ${validation.errors.join(', ')}`
        );
      }

      // Execute the bulk operation
      const result = await bulkManager.executeOperation({
        entry_ids,
        operation_type,
        confirm,
        data
      });

      // Format the response
      let responseText = `Bulk operation completed successfully!\n\n`;
      responseText += `Operation: ${result.operation_type.toUpperCase()}\n`;
      responseText += `Total requested: ${result.total_requested}\n`;
      responseText += `Successful: ${result.successful}\n`;
      responseText += `Failed: ${result.failed}\n`;

      if (result.successful > 0) {
        responseText += `\nSuccessful entries: ${result.success_ids.join(', ')}\n`;
      }

      if (result.failed_entries.length > 0) {
        responseText += `\nFailed entries:\n`;
        result.failed_entries.forEach(failure => {
          responseText += `- ${failure.entry_id}: ${failure.error}`;
          if (failure.error_code) {
            responseText += ` (${failure.error_code})`;
          }
          responseText += `\n`;
        });
      }

      if (result.can_rollback && result.rollback_data) {
        responseText += `\n🔄 Rollback available: ${result.rollback_data.original_values.length} entries can be restored using the original data.\n`;
        responseText += `Rollback instructions: ${result.rollback_data.rollback_instructions}\n`;
      }

      if (result.audit_trail) {
        responseText += `\n📋 Audit Trail:\n`;
        responseText += `- Operation ID: ${result.audit_trail.operation_id}\n`;
        responseText += `- Timestamp: ${result.audit_trail.timestamp}\n`;
        responseText += `- Duration: ${result.audit_trail.duration_ms}ms\n`;
        responseText += `- User confirmation: ${result.audit_trail.user_confirmation}\n`;
      }

      responseText += `\n${result.operation_summary}`;

      return {
        content: [
          {
            type: "text",
            text: responseText
          }
        ]
      };

    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Bulk operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
}
