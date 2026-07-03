// ABOUTME: Field-mapping MCP tool handler (get_field_mappings)
// ABOUTME: Extracted from GravityFormsMCPServer to isolate handler logic from server infrastructure

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { FieldTypeDetector } from "./fieldTypeDetector.js";

export interface FieldMappingToolContext {
  makeRequest(endpoint: string, method?: string, body?: unknown): Promise<any>;
  fieldTypeDetector: FieldTypeDetector;
}

export async function getFieldMappings(ctx: FieldMappingToolContext, args: any) {
    try {
      // Validate required parameters
      const { form_id, include_details = false, refresh_cache = false } = args;

      if (typeof form_id !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'form_id must be a non-empty string');
      }

      if (!form_id || form_id.trim() === '') {
        throw new McpError(ErrorCode.InvalidRequest, 'form_id cannot be empty');
      }

      // Validate optional boolean parameters
      if (include_details !== undefined && typeof include_details !== 'boolean') {
        throw new McpError(ErrorCode.InvalidRequest, 'include_details must be a boolean');
      }

      if (refresh_cache !== undefined && typeof refresh_cache !== 'boolean') {
        throw new McpError(ErrorCode.InvalidRequest, 'refresh_cache must be a boolean');
      }

      // Get cache reference once to avoid redundant calls
      const fieldMappingCache = ctx.fieldTypeDetector.getCache();

      // Clear cache if requested
      if (refresh_cache && fieldMappingCache) {
        fieldMappingCache.invalidate(form_id);
      }

      // Get form definition
      const formData = await ctx.makeRequest(`/forms/${form_id}`);

      if (!formData?.id) {
        throw new McpError(ErrorCode.InvalidRequest, `Form ${form_id} not found or inaccessible`);
      }

      // Check if data was cached before analysis (for accurate cache status)
      const wasCached = fieldMappingCache ? fieldMappingCache.get(form_id) !== null : false;

      // Analyze form fields (this will use cache if available)
      const analysisResult = ctx.fieldTypeDetector.analyzeFormFieldsWithStatus(formData);
      const fieldMappings = analysisResult.mapping;

      // Get field type counts
      const allFields = Object.values(fieldMappings);
      const nameFields = ctx.fieldTypeDetector.getFieldsByType(fieldMappings, 'name');
      const emailFields = ctx.fieldTypeDetector.getFieldsByType(fieldMappings, 'email');
      const phoneFields = ctx.fieldTypeDetector.getFieldsByType(fieldMappings, 'phone');
      const teamFields = ctx.fieldTypeDetector.getFieldsByType(fieldMappings, 'team');
      const textFields = ctx.fieldTypeDetector.getFieldsByType(fieldMappings, 'text');

      // Calculate complexity metrics
      const totalFields = allFields.length;
      const highConfidenceFields = allFields.filter(f => f.confidence >= 0.9).length;
      const searchableFields = [...nameFields, ...emailFields, ...teamFields].length;

      // Get cache stats
      const cacheStats = fieldMappingCache ? fieldMappingCache.getCacheStats() : null;

      // Build response text
      let responseText = `Field Mappings for Form ${form_id} (${formData.title || 'Untitled Form'}):\n\n`;

      // Name fields section
      if (nameFields.length > 0) {
        responseText += 'NAME FIELDS (Recommended for name searches):\n';
        nameFields.forEach(field => {
          responseText += `- Field ${field.fieldId}: "${field.label}" → ${field.fieldType} (confidence: ${field.confidence.toFixed(2)})\n`;
        });
        responseText += '\n';
      }

      // Email fields section
      if (emailFields.length > 0) {
        responseText += 'EMAIL FIELDS:\n';
        emailFields.forEach(field => {
          responseText += `- Field ${field.fieldId}: "${field.label}" → ${field.fieldType} (confidence: ${field.confidence.toFixed(2)})\n`;
        });
        responseText += '\n';
      }

      // Phone fields section
      if (phoneFields.length > 0) {
        responseText += 'PHONE FIELDS:\n';
        phoneFields.forEach(field => {
          responseText += `- Field ${field.fieldId}: "${field.label}" → ${field.fieldType} (confidence: ${field.confidence.toFixed(2)})\n`;
        });
        responseText += '\n';
      }

      // Team/group fields section
      if (teamFields.length > 0) {
        responseText += 'TEAM/GROUP FIELDS:\n';
        teamFields.forEach(field => {
          responseText += `- Field ${field.fieldId}: "${field.label}" → ${field.fieldType} (confidence: ${field.confidence.toFixed(2)})\n`;
        });
        responseText += '\n';
      }

      // Other text fields (low confidence)
      const otherTextFields = textFields.filter(f => f.confidence < 0.7);
      if (otherTextFields.length > 0) {
        responseText += 'OTHER TEXT FIELDS (Low search relevance):\n';
        otherTextFields.slice(0, 10).forEach(field => { // Limit to prevent overflow
          responseText += `- Field ${field.fieldId}: "${field.label}" → ${field.fieldType} (confidence: ${field.confidence.toFixed(2)})\n`;
        });
        if (otherTextFields.length > 10) {
          responseText += `... and ${otherTextFields.length - 10} more text fields\n`;
        }
        responseText += '\n';
      }

      // Form complexity section
      responseText += 'FORM COMPLEXITY:\n';
      responseText += `- Total fields: ${totalFields}\n`;
      responseText += `- High confidence fields: ${highConfidenceFields}\n`;
      responseText += `- Searchable fields: ${searchableFields}\n`;
      responseText += `- Field types detected: ${new Set(allFields.map(f => f.fieldType)).size}\n`;

      // Detect conditional logic (simplified check)
      const hasConditionalLogic = formData.fields?.some((field: any) =>
        field && (field.conditionalLogic || field.conditional_logic)
      );
      if (hasConditionalLogic) {
        responseText += '- Conditional logic: Detected\n';
      }
      responseText += '\n';

      // Cache status section
      responseText += 'CACHE STATUS:\n';
      if (cacheStats) {
        if (analysisResult.cacheStatus.hit) {
          responseText += `- Status: Cache hit (retrieved from cache)\n`;
        } else if (wasCached && refresh_cache) {
          responseText += `- Status: Cache refreshed (forced refresh requested)\n`;
        } else {
          responseText += `- Status: Fresh analysis (not previously cached)\n`;
        }
        responseText += `- Cache hit rate: ${(cacheStats.hitRate * 100).toFixed(1)}%\n`;
        responseText += `- Total cached forms: ${cacheStats.entryCount}\n`;
      } else {
        responseText += '- Status: No cache available\n';
      }

      // Include detailed field information if requested
      if (include_details) {
        responseText += '\nDETAILED FIELD ANALYSIS:\n';
        Object.entries(fieldMappings).forEach(([fieldId, info]) => {
          const field = formData.fields?.find((f: any) => f.id === fieldId);
          responseText += `\nField ${fieldId}:\n`;
          responseText += `  Label: "${info.label}"\n`;
          responseText += `  Detected Type: ${info.fieldType}\n`;
          responseText += `  Confidence: ${info.confidence.toFixed(3)}\n`;
          responseText += `  Form Type: ${field?.type || 'unknown'}\n`;
          if (field?.choices && field.choices.length > 0) {
            responseText += `  Choices: ${field.choices.length} options\n`;
          }
        });
      }

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

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('Form not found') || errorMessage.includes('404')) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Form ${args.form_id} not found. Please verify the form ID is correct and accessible.`
        );
      }

      throw new McpError(
        ErrorCode.InternalError,
        `Field mapping analysis failed: ${errorMessage}`
      );
    }
}
