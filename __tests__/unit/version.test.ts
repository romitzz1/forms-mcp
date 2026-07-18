// ABOUTME: Drift-guard test ensuring SERVER_VERSION stays in lockstep with package.json's version
// ABOUTME: SERVER_NAME is intentionally NOT compared to package.json's name (npm package name differs from the MCP-advertised name)
import { SERVER_VERSION } from "../../utils/version";

const packageJson = require("../../package.json");

describe("version constant", () => {
  it("matches package.json's version", () => {
    expect(SERVER_VERSION).toBe(packageJson.version);
  });
});
