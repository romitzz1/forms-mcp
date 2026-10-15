// ABOUTME: Normalizes advertised MCP tool input schemas into a converter-independent contract
// ABOUTME: Keeps names, types, required, enums, descriptions; drops $schema/draft/additionalProperties noise

export interface INormalizedSchema {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, INormalizedSchema>;
  items?: INormalizedSchema;
  default?: unknown;
  anyOf?: INormalizedSchema[];
  oneOf?: INormalizedSchema[];
  allOf?: INormalizedSchema[];
  additionalProperties?: INormalizedSchema;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  minLength?: number;
  maxItems?: number;
  minItems?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeInputSchema(schema: unknown): INormalizedSchema {
  if (!isRecord(schema)) return {};
  const out: INormalizedSchema = {};
  if (schema.type !== undefined) out.type = schema.type as string | string[];
  if (typeof schema.description === 'string') out.description = schema.description;
  if (Array.isArray(schema.enum)) out.enum = [...(schema.enum as unknown[])].sort();
  if (Array.isArray(schema.required) && schema.required.length > 0) {
    out.required = [...(schema.required as string[])].sort();
  }
  if (isRecord(schema.properties)) {
    out.properties = {};
    for (const key of Object.keys(schema.properties).sort()) {
      out.properties[key] = normalizeInputSchema(schema.properties[key]);
    }
  }
  if (isRecord(schema.items)) out.items = normalizeInputSchema(schema.items);
  if (schema.default !== undefined) out.default = schema.default;
  if (Array.isArray(schema.anyOf)) out.anyOf = (schema.anyOf as unknown[]).map((s) => normalizeInputSchema(s));
  if (Array.isArray(schema.oneOf)) out.oneOf = (schema.oneOf as unknown[]).map((s) => normalizeInputSchema(s));
  if (Array.isArray(schema.allOf)) out.allOf = (schema.allOf as unknown[]).map((s) => normalizeInputSchema(s));
  if (isRecord(schema.additionalProperties)) out.additionalProperties = normalizeInputSchema(schema.additionalProperties);
  if (typeof schema.minimum === 'number') out.minimum = schema.minimum;
  if (typeof schema.maximum === 'number') out.maximum = schema.maximum;
  if (typeof schema.maxLength === 'number') out.maxLength = schema.maxLength;
  if (typeof schema.minLength === 'number') out.minLength = schema.minLength;
  if (typeof schema.maxItems === 'number') out.maxItems = schema.maxItems;
  if (typeof schema.minItems === 'number') out.minItems = schema.minItems;
  return out;
}

export function normalizeToolList(
  tools: Array<{ name: string; description?: string; inputSchema: unknown }>
): Record<string, { description: string; input: INormalizedSchema }> {
  const out: Record<string, { description: string; input: INormalizedSchema }> = {};
  for (const tool of [...tools].sort((a, b) => a.name.localeCompare(b.name))) {
    out[tool.name] = { description: tool.description ?? '', input: normalizeInputSchema(tool.inputSchema) };
  }
  return out;
}
