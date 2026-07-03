#!/usr/bin/env node
// ABOUTME: Executable entry point — instantiates and runs the Gravity Forms MCP server
// ABOUTME: Separate from index.ts so the library module never auto-runs on import (esp. under Jest)

import { GravityFormsMCPServer } from "./index.js";

const server = new GravityFormsMCPServer();
server.run().catch((error) => {
  // Exit non-zero so process managers (systemd/Docker/k8s) detect a failed
  // startup — e.g. HTTP mode with a missing MCP_AUTH_TOKEN rejects here.
  console.error(error);
  process.exit(1);
});
