// ABOUTME: Faithfulness test verifying TOOL_SCHEMAS (Zod) matches LEGACY_TOOL_SCHEMAS (JSON Schema)
// ABOUTME: Round-trips each Zod raw shape through zod-to-json-schema and compares property/required/enum parity
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { TOOL_SCHEMAS } from "../../utils/toolSchemas";
import { LEGACY_TOOL_SCHEMAS } from "../fixtures/legacyToolSchemas";

const toolNames = Object.keys(LEGACY_TOOL_SCHEMAS);

describe("TOOL_SCHEMAS faithfulness vs legacy JSON schemas", () => {
  it("covers exactly the 21 legacy tools", () => {
    expect(Object.keys(TOOL_SCHEMAS).sort()).toEqual(toolNames.sort());
  });

  it.each(toolNames)("%s: property names, required, and enums match", (name) => {
    const legacy = LEGACY_TOOL_SCHEMAS[name];
    const generated: any = zodToJsonSchema(z.object(TOOL_SCHEMAS[name].inputSchema), { target: "jsonSchema7" });

    const legacyProps = Object.keys(legacy.properties ?? {}).sort();
    const genProps = Object.keys(generated.properties ?? {}).sort();
    expect(genProps).toEqual(legacyProps); // <-- catches any stripped/missing property

    const legacyRequired = [...(legacy.required ?? [])].sort();
    const genRequired = [...(generated.required ?? [])].sort();
    expect(genRequired).toEqual(legacyRequired);

    // enum parity for any top-level property that had one (unconditional expect so a
    // missing/extra enum always fails the assertion instead of silently skipping it)
    for (const prop of legacyProps) {
      const legacyEnum: string[] | undefined = legacy.properties[prop]?.enum;
      const genEnum: string[] | undefined = generated.properties[prop]?.enum;
      expect(genEnum ? [...genEnum].sort() : undefined).toEqual(legacyEnum ? [...legacyEnum].sort() : undefined);
    }
  });
});
