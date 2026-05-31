#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HttpBridge } from "./bridge/httpBridge.js";
import { RequestQueue } from "./bridge/requestQueue.js";
import { createMicaMcpServer, registerMicaPrompts } from "./mcp/prompts.js";
import { registerMmaTools } from "./mcp/tools.js";
import { runtimeModeFromArgs } from "./runtimeOptions.js";

async function main(): Promise<void> {
  const queue = new RequestQueue();
  const bridge = new HttpBridge(queue);
  const mode = runtimeModeFromArgs(process.argv.slice(2));
  await bridge.start();

  const server = createMicaMcpServer("mica");

  registerMmaTools(server, queue, () => bridge.statusSnapshot());
  registerMicaPrompts(server);

  let shuttingDown = false;

  async function shutdown(exitCode?: number): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error("MICA shutting down...");
    await bridge.stop();
    if (exitCode !== undefined) {
      process.exit(exitCode);
    }
  }

  process.on("SIGINT", () => {
    shutdown(130).catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
  });
  process.on("SIGTERM", () => {
    shutdown(143).catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
  });

  // Log only to stderr — stdout is reserved for MCP stdio JSON-RPC.
  console.error(`MICA HTTP listening on http://127.0.0.1:${bridge.port}`);

  if (mode === "bridge-only") {
    console.error("MICA running in bridge-only development mode.");
    return;
  }

  await server.connect(new StdioServerTransport());

  // server.connect() completes stdio transport setup; the HTTP bridge keeps
  // the process alive while opencode owns the MCP server. Signal handlers above
  // perform cleanup on explicit process termination.
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
