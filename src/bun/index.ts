import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { BackendState } from "../backend/backendState.js";
import { registerBackendMcpTools } from "../mcp/backendTools.js";
import { createMicaMcpServer, registerMicaPrompts } from "../mcp/prompts.js";
import { createBunHttpApp } from "./httpServer.js";

const PORT = 19_791;
const MCPP_SERVER_NAME = "mica-bun";

export type BunRuntimeDeps = {
  bridgeOnly?: boolean;
  createHttpApp?: typeof createBunHttpApp;
  createMcpServer?: () => Pick<McpServer, "connect" | "prompt" | "tool">;
  createTransport?: () => StdioServerTransport;
  installSignalHandlers?: (onSignal: (signal: NodeJS.Signals) => void) => () => void;
  state?: BackendState;
};

export type BunRuntime = {
  state: BackendState;
  httpApp: Awaited<ReturnType<typeof createBunHttpApp>>;
  stop: () => Promise<void>;
  keepAlive: Promise<void>;
};

export async function startBunRuntime(deps: BunRuntimeDeps = {}): Promise<BunRuntime> {
  const bridgeOnly = deps.bridgeOnly ?? process.argv.includes("--bridge-only");
  const state = deps.state ?? new BackendState(() => `notebook-${randomUUID()}`);
  const createHttpApp = deps.createHttpApp ?? createBunHttpApp;
  const createMcpServer = deps.createMcpServer ?? (() => createMicaMcpServer(MCPP_SERVER_NAME));
  const createTransport = deps.createTransport ?? (() => new StdioServerTransport());
  const installSignalHandlers =
    deps.installSignalHandlers ??
    ((onSignal: (signal: NodeJS.Signals) => void) => {
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
      return () => {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
      };
    });
  const httpApp = await createHttpApp({ state, port: PORT });
  let cleanupSignals = () => {};
  let stopped = false;
  let stopPromise: Promise<void> | undefined;

  const stop = async (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      if (stopped) return;
      stopped = true;
      cleanupSignals();
      await httpApp.stop();
    })();
    return stopPromise;
  };

  const onSignal = (signal: NodeJS.Signals) => {
    void stop().finally(() => process.exit(signal === "SIGINT" ? 0 : 0));
  };

  try {
    cleanupSignals = installSignalHandlers(onSignal);
    const server = createMcpServer();
    registerBackendMcpTools(server as McpServer, state);
    registerMicaPrompts(server);

    console.error(`Bun HTTP server listening on http://127.0.0.1:${httpApp.port}`);
    if (!bridgeOnly) {
      console.error("Bun MCP mode enabled; connecting stdio transport.");
      await server.connect(createTransport());
    }
  } catch (error) {
    await stop();
    throw error;
  }

  return {
    state,
    httpApp,
    stop,
    keepAlive: new Promise<void>(() => {})
  };
}

async function main(): Promise<void> {
  const runtime = await startBunRuntime();
  await runtime.keepAlive;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}

export { MCPP_SERVER_NAME, PORT };
