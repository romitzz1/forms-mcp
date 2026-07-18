// ABOUTME: Server info MCP tool handler (get_server_info)
// ABOUTME: Extracted from GravityFormsMCPServer to isolate handler logic from server infrastructure
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

// Shared MCP text-content result shape returned by every tool handler in this module.
export interface IServerInfoToolResult {
  content: Array<{ type: "text"; text: string }>;
}

export function getServerInfoTool(): IServerInfoToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ name: SERVER_NAME, version: SERVER_VERSION }, null, 2)
      }
    ]
  };
}
