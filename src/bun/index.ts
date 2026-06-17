import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { BackendState } from "../backend/backendState.js";
import { registerBackendMcpTools } from "../mcp/backendTools.js";
import { createMicaMcpServer, registerMicaPrompts } from "../mcp/prompts.js";
import type { MicaRuntimeConfig } from "../runtime/config.js";
import { loadRuntimeConfig } from "../runtime/config.js";
import { writeSessionFile } from "../runtime/session.js";
import { createBunHttpApp } from "./httpServer.js";

const MCP_SERVER_NAME = "mica-bun";
const MICA_PACKAGE_VERSION = "1.1.1";

export type BunRuntimeDeps = {
  bridgeOnly?: boolean;
  createHttpApp?: typeof createBunHttpApp;
  createMcpServer?: () => Pick<McpServer, "connect" | "prompt" | "tool">;
  createTransport?: () => StdioServerTransport;
  installSignalHandlers?: (onSignal: (signal: NodeJS.Signals) => void) => () => void;
  runtimeConfig?: MicaRuntimeConfig;
  state?: BackendState;
  version?: string;
  writeSessionFile?: typeof writeSessionFile;
};

export type BunRuntime = {
  state: BackendState;
  httpApp: Awaited<ReturnType<typeof createBunHttpApp>>;
  stop: () => Promise<void>;
  keepAlive: Promise<void>;
};

export async function startBunRuntime(deps: BunRuntimeDeps = {}): Promise<BunRuntime> {
  const config = deps.runtimeConfig ?? loadRuntimeConfig();
  const bridgeOnly = deps.bridgeOnly ?? config.bridgeOnly;
  const state = deps.state ?? new BackendState(() => `notebook-${randomUUID()}`);
  const createHttpApp = deps.createHttpApp ?? createBunHttpApp;
  const createMcpServer = deps.createMcpServer ?? (() => createMicaMcpServer(MCP_SERVER_NAME));
  const createTransport = deps.createTransport ?? (() => new StdioServerTransport());
  const writeSession = deps.writeSessionFile ?? writeSessionFile;
  const version = deps.version ?? MICA_PACKAGE_VERSION;
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
  const httpApp = await createHttpApp({ state, host: config.host, port: config.preferredPort, authToken: config.authToken, version });
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
    void stop().finally(() => process.exit(0));
  };

  try {
    cleanupSignals = installSignalHandlers(onSignal);
    await writeSession(config.sessionFile, {
      host: config.host,
      port: httpApp.port,
      authToken: config.authToken,
      pid: process.pid,
      version,
      status: "running",
    });
    const server = createMcpServer();
    registerBackendMcpTools(server as McpServer, state);
    registerMicaPrompts(server);

    console.error(`Bun HTTP server listening on http://${config.host}:${httpApp.port}`);
    console.error(`Dashboard: http://${config.host}:${httpApp.port}/#token=${config.authToken}`);
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

export { MCP_SERVER_NAME };
