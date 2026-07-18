// ABOUTME: Tests for the get_server_info tool handler
// ABOUTME: Verifies the returned content reports the server's real name and version
import { getServerInfoTool } from "../../utils/serverInfoTools";
import { SERVER_NAME, SERVER_VERSION } from "../../utils/version";

describe("getServerInfoTool", () => {
  it("returns the server name and version as JSON text content", () => {
    const result = getServerInfoTool();

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe(SERVER_NAME);
    expect(parsed.version).toBe(SERVER_VERSION);
  });
});
