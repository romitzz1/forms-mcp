// ABOUTME: Field-mapping MCP tool handler (get_field_mappings)
// ABOUTME: Extracted from GravityFormsMCPServer to isolate handler logic from server infrastructure

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { CacheStats } from "./fieldMappingCache.js";
import type { FieldTypeDetector, FieldTypeInfo, FormFieldMapping } from "./fieldTypeDetector.js";
import type { IGravityForm, IGravityFormField } from "./gravityFormsTypes.js";

export interface FieldMappingToolContext {
  makeRequest<T = unknown>(endpoint: string, method?: string, body?: unknown): Promise<T>;
  fieldTypeDetector: FieldTypeDetector;
}

export interface FieldMappingToolResult {
  content: Array<{ type: "text"; text: string }>;
}

// form_id undergoes its own runtime type validation below (the zod schema marks
// it required, but the handler re-validates it defensively like updateForm's
// form_id/title/fields), so it's typed `unknown` until checked.
export interface GetFieldMappingsArgs {
  form_id?: unknown;
  include_details?: boolean;
  refresh_cache?: boolean;
}

// Validates the (post-default) args and returns the confirmed form_id string.
// include_details/refresh_cache already have defaults applied by the caller's
// destructuring, so their `!== undefined` checks below can never be false —
// this mirrors the original handler's own (pre-existing) redundant checks.
function validateGetFieldMappingsArgs(form_id: unknown, include_details: unknown, refresh_cache: unknown): string {
  if (typeof form_id !== 'string') {
    throw new McpError(ErrorCode.InvalidRequest, 'form_id must be a non-empty string');
  }

  if (!form_id || form_id.trim() === '') {
    throw new McpError(ErrorCode.InvalidRequest, 'form_id cannot be empty');
  }

  if (include_details !== undefined && typeof include_details !== 'boolean') {
    throw new McpError(ErrorCode.InvalidRequest, 'include_details must be a boolean');
  }

  if (refresh_cache !== undefined && typeof refresh_cache !== 'boolean') {
    throw new McpError(ErrorCode.InvalidRequest, 'refresh_cache must be a boolean');
  }

  return form_id;
}

// Renders one field-type section (name/email/phone/team), or '' when empty —
// the four sections in the original handler were identical apart from their
// header text, so they share this helper.
function buildFieldsSection(header: string, fields: FieldTypeInfo[]): string {
  if (fields.length === 0) {
    return '';
  }

  let section = `${header}\n`;
  fields.forEach(field => {
    section += `- Field ${field.fieldId}: "${field.label}" → ${field.fieldType} (confidence: ${field.confidence.toFixed(2)})\n`;
  });
  section += '\n';
  return section;
}

function buildOtherTextFieldsSection(textFields: FieldTypeInfo[]): string {
  const otherTextFields = textFields.filter(f => f.confidence < 0.7);
  if (otherTextFields.length === 0) {
    return '';
  }

  let section = 'OTHER TEXT FIELDS (Low search relevance):\n';
  otherTextFields.slice(0, 10).forEach(field => { // Limit to prevent overflow
    section += `- Field ${field.fieldId}: "${field.label}" → ${field.fieldType} (confidence: ${field.confidence.toFixed(2)})\n`;
  });
  if (otherTextFields.length > 10) {
    section += `... and ${otherTextFields.length - 10} more text fields\n`;
  }
  section += '\n';
  return section;
}

function buildComplexitySection(allFields: FieldTypeInfo[], nameFields: FieldTypeInfo[], emailFields: FieldTypeInfo[], teamFields: FieldTypeInfo[]): string {
  const totalFields = allFields.length;
  const highConfidenceFields = allFields.filter(f => f.confidence >= 0.9).length;
  const searchableFields = [...nameFields, ...emailFields, ...teamFields].length;

  let section = 'FORM COMPLEXITY:\n';
  section += `- Total fields: ${totalFields}\n`;
  section += `- High confidence fields: ${highConfidenceFields}\n`;
  section += `- Searchable fields: ${searchableFields}\n`;
  section += `- Field types detected: ${new Set(allFields.map(f => f.fieldType)).size}\n`;
  return section;
}

// A field's conditionalLogic (camelCase) or conditional_logic (snake_case) key
// can each independently be an explicit `false` (meaning "no conditional logic")
// or simply absent — `||`/`??` are avoided so an explicit `false` on one key
// still falls through to check the other, matching the original's behavior.
function fieldHasConditionalLogic(field: IGravityFormField): boolean {
  if (!field) {
    return false;
  }
  if (field.conditionalLogic) {
    return true;
  }
  return Boolean(field.conditional_logic);
}

// Detects conditional logic (simplified check) and returns the trailing blank
// line the original always appends after the complexity section, with the
// "Detected" line prepended when applicable.
function detectConditionalLogicNote(formData: IGravityForm): string {
  const hasConditionalLogic = formData.fields?.some((field) => fieldHasConditionalLogic(field));
  return hasConditionalLogic ? '- Conditional logic: Detected\n\n' : '\n';
}

function buildCacheStatusSection(cacheStats: CacheStats | null, cacheHit: boolean, wasCached: boolean, refreshCache: boolean): string {
  let section = 'CACHE STATUS:\n';

  if (cacheStats) {
    if (cacheHit) {
      section += `- Status: Cache hit (retrieved from cache)\n`;
    } else if (wasCached && refreshCache) {
      section += `- Status: Cache refreshed (forced refresh requested)\n`;
    } else {
      section += `- Status: Fresh analysis (not previously cached)\n`;
    }
    section += `- Cache hit rate: ${(cacheStats.hitRate * 100).toFixed(1)}%\n`;
    section += `- Total cached forms: ${cacheStats.entryCount}\n`;
  } else {
    section += '- Status: No cache available\n';
  }

  return section;
}

// Falls back to `fallback` for any falsy value, matching the original `||`
// semantics (including an empty string) — `??` would only treat null/undefined
// as "missing" and is deliberately not used here.
function withFallback(value: string | undefined, fallback: string): string {
  if (value) {
    return value;
  }
  return fallback;
}

function buildDetailedFieldAnalysisSection(fieldMappings: FormFieldMapping, formData: IGravityForm): string {
  let section = '\nDETAILED FIELD ANALYSIS:\n';

  Object.entries(fieldMappings).forEach(([fieldId, info]) => {
    const field = formData.fields?.find((f) => f.id === fieldId);
    section += `\nField ${fieldId}:\n`;
    section += `  Label: "${info.label}"\n`;
    section += `  Detected Type: ${info.fieldType}\n`;
    section += `  Confidence: ${info.confidence.toFixed(3)}\n`;

    section += `  Form Type: ${withFallback(field?.type, 'unknown')}\n`;

    if (field?.choices && field.choices.length > 0) {
      section += `  Choices: ${field.choices.length} options\n`;
    }
  });

  return section;
}

interface IFieldMappingsResponseTextInputs {
  formData: IGravityForm;
  validFormId: string;
  fieldMappings: FormFieldMapping;
  allFields: FieldTypeInfo[];
  nameFields: FieldTypeInfo[];
  emailFields: FieldTypeInfo[];
  phoneFields: FieldTypeInfo[];
  teamFields: FieldTypeInfo[];
  textFields: FieldTypeInfo[];
  cacheHit: boolean;
  cacheStats: CacheStats | null;
  wasCached: boolean;
  refreshCache: boolean;
  includeDetails: boolean;
}

// Assembles the full field-mappings report text from its per-section pieces.
function buildFieldMappingsResponseText(inputs: IFieldMappingsResponseTextInputs): string {
  const { formData, validFormId, fieldMappings, allFields, nameFields, emailFields, phoneFields, teamFields, textFields, cacheHit, cacheStats, wasCached, refreshCache, includeDetails } = inputs;

  let responseText = `Field Mappings for Form ${validFormId} (${withFallback(formData.title, 'Untitled Form')}):\n\n`;

  responseText += buildFieldsSection('NAME FIELDS (Recommended for name searches):', nameFields);
  responseText += buildFieldsSection('EMAIL FIELDS:', emailFields);
  responseText += buildFieldsSection('PHONE FIELDS:', phoneFields);
  responseText += buildFieldsSection('TEAM/GROUP FIELDS:', teamFields);
  responseText += buildOtherTextFieldsSection(textFields);
  responseText += buildComplexitySection(allFields, nameFields, emailFields, teamFields);
  responseText += detectConditionalLogicNote(formData);
  responseText += buildCacheStatusSection(cacheStats, cacheHit, wasCached, refreshCache);

  if (includeDetails) {
    responseText += buildDetailedFieldAnalysisSection(fieldMappings, formData);
  }

  return responseText;
}

export async function getFieldMappings(ctx: FieldMappingToolContext, args: unknown): Promise<FieldMappingToolResult> {
    try {
      // Validate required parameters
      const { form_id, include_details = false, refresh_cache = false } = args as GetFieldMappingsArgs;
      const validFormId = validateGetFieldMappingsArgs(form_id, include_details, refresh_cache);

      // Get cache reference once to avoid redundant calls
      const fieldMappingCache = ctx.fieldTypeDetector.getCache();

      // Clear cache if requested
      if (refresh_cache && fieldMappingCache) {
        fieldMappingCache.invalidate(validFormId);
      }

      // Get form definition
      const formData = await ctx.makeRequest<IGravityForm>(`/forms/${validFormId}`);

      if (!formData?.id) {
        throw new McpError(ErrorCode.InvalidRequest, `Form ${validFormId} not found or inaccessible`);
      }

      // Check if data was cached before analysis (for accurate cache status)
      const wasCached = fieldMappingCache ? fieldMappingCache.get(validFormId) !== null : false;

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

      // Get cache stats
      const cacheStats = fieldMappingCache ? fieldMappingCache.getCacheStats() : null;

      const responseText = buildFieldMappingsResponseText({
        formData,
        validFormId,
        fieldMappings,
        allFields,
        nameFields,
        emailFields,
        phoneFields,
        teamFields,
        textFields,
        cacheHit: analysisResult.cacheStatus.hit,
        cacheStats,
        wasCached,
        refreshCache: refresh_cache,
        includeDetails: include_details
      });

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
          `Form ${String((args as GetFieldMappingsArgs).form_id)} not found. Please verify the form ID is correct and accessible.`
        );
      }

      throw new McpError(
        ErrorCode.InternalError,
        `Field mapping analysis failed: ${errorMessage}`
      );
    }
}
