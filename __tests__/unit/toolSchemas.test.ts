// ABOUTME: Faithfulness test verifying TOOL_SCHEMAS (Zod) matches LEGACY_TOOL_SCHEMAS (JSON Schema)
// ABOUTME: Round-trips each Zod raw shape through zod-to-json-schema and compares property/required/enum parity
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { TOOL_SCHEMAS } from "../../utils/toolSchemas";
import { LEGACY_TOOL_SCHEMAS } from "../fixtures/legacyToolSchemas";

const toolNames = Object.keys(LEGACY_TOOL_SCHEMAS);

// Deliberate departures from the legacy oracle. The fixture stays verbatim;
// every change to a legacy tool's contract is listed here as the audit trail.
const INTENTIONAL_SCHEMA_CHANGES: Record<string, { removed?: string[]; added?: string[]; noLongerRequired?: string[] }> = {
  export_entries_formatted: { removed: ['save_to_disk', 'skip_base64'] },
  import_form_json: { added: ['export_id'], noLongerRequired: ['form_json'] },
};
const NEW_TOOLS = ['get_export_link'];

describe("TOOL_SCHEMAS faithfulness vs legacy JSON schemas", () => {
  it("covers the legacy tools plus the intentionally added ones", () => {
    expect(Object.keys(TOOL_SCHEMAS).sort()).toEqual([...toolNames, ...NEW_TOOLS].sort());
  });

  it.each(toolNames)("%s: property names, required, and enums match", (name) => {
    const legacy = LEGACY_TOOL_SCHEMAS[name];
    const change = INTENTIONAL_SCHEMA_CHANGES[name] ?? {};
    const generated: any = zodToJsonSchema(z.object(TOOL_SCHEMAS[name].inputSchema), { target: "jsonSchema7" });

    const legacyProps = Object.keys(legacy.properties ?? {})
      .filter((p) => !(change.removed ?? []).includes(p))
      .concat(change.added ?? [])
      .sort();
    const genProps = Object.keys(generated.properties ?? {}).sort();
    expect(genProps).toEqual(legacyProps); // <-- catches any stripped/missing property

    const legacyRequired = [...(legacy.required ?? [])]
      .filter((p: string) => !(change.noLongerRequired ?? []).includes(p))
      .sort();
    const genRequired = [...(generated.required ?? [])].sort();
    expect(genRequired).toEqual(legacyRequired);

    // enum parity for any top-level property that had one (unconditional expect so a
    // missing/extra enum always fails the assertion instead of silently skipping it)
    for (const prop of legacyProps.filter((p) => !(change.added ?? []).includes(p))) {
      const legacyEnum: string[] | undefined = legacy.properties[prop]?.enum;
      const genEnum: string[] | undefined = generated.properties[prop]?.enum;
      expect(genEnum ? [...genEnum].sort() : undefined).toEqual(legacyEnum ? [...legacyEnum].sort() : undefined);
    }
  });

  it("get_export_link requires export_id", () => {
    const generated = zodToJsonSchema(z.object(TOOL_SCHEMAS.get_export_link.inputSchema), { target: "jsonSchema7" }) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(generated.properties)).toStrictEqual(['export_id']);
    expect(generated.required).toStrictEqual(['export_id']);
  });
});
