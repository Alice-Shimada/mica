#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startBunRuntime } from "../bun/index.js";
import { createMicaMcpServer, registerMicaPrompts } from "../mcp/prompts.js";
import { registerProxyMcpTools, type ProxyMcpSession } from "../mcp/proxyTools.js";
import { defaultSessionFile } from "../runtime/config.js";
import { runConfigCommand } from "./configSnippets.js";
import { runDoctor } from "./doctor.js";
import { runStatusCommand, type CliStatusResult } from "./status.js";


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveProjectRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(dir, "package.json"))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Cannot find project root (no package.json found)");
    dir = parent;
  }
  return dir;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAddressInUse(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as Record<string, unknown>;
  return record.code === "EADDRINUSE" || String(record.message ?? "").includes("EADDRINUSE");
}

function sessionFileFromArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): string {
  const index = argv.indexOf("--session-file");
  if (index >= 0 && argv[index + 1] && !argv[index + 1]!.startsWith("--")) {
    return argv[index + 1]!;
  }
  return env.MICA_SESSION_FILE ?? defaultSessionFile(env);
}

export async function readLiveSession(argv: string[] = [], deps: {
  env?: NodeJS.ProcessEnv;
  exists?: (filePath: string) => boolean;
  readFile?: (filePath: string) => string;
  fetch?: typeof fetch;
} = {}): Promise<ProxyMcpSession | undefined> {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  const readFile = deps.readFile ?? ((filePath: string) => readFileSync(filePath, "utf8"));
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const sessionFile = sessionFileFromArgs(argv, env);

  if (!exists(sessionFile) || typeof fetchImpl !== "function") return undefined;

  let session: Partial<ProxyMcpSession>;
  try {
    session = JSON.parse(readFile(sessionFile)) as Partial<ProxyMcpSession>;
  } catch {
    return undefined;
  }

  if (!session.baseUrl || !session.authToken) return undefined;

  try {
    const response = await fetchImpl(`${session.baseUrl}/status`, {
      headers: { authorization: `Bearer ${session.authToken}` },
    });
    return response.status === 200 ? { baseUrl: session.baseUrl, authToken: session.authToken } : undefined;
  } catch {
    return undefined;
  }
}

export async function startProxyMcpRuntime(
  session: ProxyMcpSession,
  deps: {
    createMcpServer?: () => Pick<McpServer, "connect" | "prompt" | "tool">;
    createTransport?: () => StdioServerTransport;
  } = {},
): Promise<{ keepAlive: Promise<void> }> {
  const server = deps.createMcpServer?.() ?? createMicaMcpServer("mica-proxy");
  registerProxyMcpTools(server as McpServer, session);
  registerMicaPrompts(server);
  const transport = deps.createTransport?.() ?? new StdioServerTransport();
  await server.connect(transport);
  return { keepAlive: new Promise<void>(() => {}) };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function helpText(): string {
  return `Usage: mica <command> [options]

Commands:
  mcp                     Run MCP stdio server (proxy to existing bridge or launch new)
  install [options]       Install MICA bridge into Wolfram
  uninstall [options]     Uninstall MICA bridge from Wolfram
  doctor                  Diagnose MICA bridge configuration
  status                  Show MICA bridge status
  config codex            Configure for Codex
  config claude-desktop   Configure for Claude Desktop
  config cursor           Configure for Cursor
  config opencode         Configure for OpenCode

Options:
  --help, -h              Show this help message
  --dry-run               Preview changes without applying (install/uninstall)
`;
}

export async function runCli(
  argv: string[],
  deps?: {
    startRuntime?: () => Promise<{ keepAlive: Promise<void> }>;
    runInstaller?: (argv: string[]) => string;
    runDoctor?: () => Promise<{ exitCode: number; output: string }>;
    runStatus?: () => Promise<CliStatusResult>;
    runConfig?: (argv: string[]) => { exitCode: number; output: string };
    readLiveSession?: () => Promise<ProxyMcpSession | undefined>;
    startProxyRuntime?: (session: ProxyMcpSession) => Promise<{ keepAlive: Promise<void> }>;
    sleep?: (ms: number) => Promise<void>;
    stdout?: { write(chunk: string): unknown };
    stderr?: { write(chunk: string): unknown };
  }
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;
  const startRuntime = deps?.startRuntime;
  const runInstaller = deps?.runInstaller;
  const _runDoctor = deps?.runDoctor;
  const _runStatus = deps?.runStatus;
  const _runConfig = deps?.runConfig;
  const _readLiveSession = deps?.readLiveSession ?? (() => readLiveSession(argv.slice(1)));
  const _startProxyRuntime = deps?.startProxyRuntime ?? ((session: ProxyMcpSession) => startProxyMcpRuntime(session));
  const _sleep = deps?.sleep ?? sleep;

  const command = argv[0];

  // --help / -h
  if (command === "--help" || command === "-h") {
    stdout.write(helpText());
    return 0;
  }

  // install
  if (command === "install") {
    if (!runInstaller) {
      stderr.write("Error: runInstaller not available\n");
      return 1;
    }
    const output = runInstaller(argv.slice(1));
    stdout.write(output);
    return 0;
  }

  // uninstall
  if (command === "uninstall") {
    if (!runInstaller) {
      stderr.write("Error: runInstaller not available\n");
      return 1;
    }
    const output = runInstaller(["--uninstall", ...argv.slice(1)]);
    stdout.write(output);
    return 0;
  }

  // mcp (also start, or no args)
  if (command === "mcp" || command === "start" || command === undefined) {
    const existingSession = await _readLiveSession();
    if (existingSession) {
      const proxyRuntime = await _startProxyRuntime(existingSession);
      await proxyRuntime.keepAlive;
      return 0;
    }

    if (!startRuntime) {
      stderr.write("Error: startRuntime not available\n");
      return 1;
    }

    try {
      const runtime = await startRuntime();
      await runtime.keepAlive;
      return 0;
    } catch (error) {
      if (!isAddressInUse(error)) throw error;

      for (let attempt = 0; attempt < 20; attempt += 1) {
        await _sleep(100);
        const racedSession = await _readLiveSession();
        if (racedSession) {
          const proxyRuntime = await _startProxyRuntime(racedSession);
          await proxyRuntime.keepAlive;
          return 0;
        }
      }

      const message = error instanceof Error ? error.message : String(error);
      stderr.write(`Error: MICA bridge port is already in use, but no live session became available. ${message}\n`);
      return 1;
    }
  }

  // doctor
  if (command === "doctor") {
    if (!_runDoctor) {
      stderr.write("Error: runDoctor not available\n");
      return 1;
    }
    const { exitCode, output } = await _runDoctor();
    stdout.write(output);
    return exitCode;
  }

  // status
  if (command === "status") {
    if (!_runStatus) {
      stderr.write("Error: runStatus not available\n");
      return 1;
    }
    const { exitCode, output } = await _runStatus();
    stdout.write(output);
    return exitCode;
  }

  // config
  if (command === "config") {
    if (!_runConfig) {
      stderr.write("Error: runConfig not available\n");
      return 1;
    }
    const { exitCode, output } = _runConfig(argv.slice(1));
    stdout.write(output);
    return exitCode;
  }

  // Unknown command
  stderr.write(`Unknown command: ${command}\n`);
  return 1;
}

// ---------------------------------------------------------------------------
// Direct invocation (node dist/src/cli/index.js)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const projectRoot = resolveProjectRoot();
  const installerUrl = pathToFileURL(path.join(projectRoot, "scripts", "install.js")).href;
  const { runInstaller, detectWolframUserBase } = (await import(installerUrl)) as {
    runInstaller: (argv: string[]) => string;
    detectWolframUserBase: (opts?: Record<string, unknown>) => {
      userBase: string;
      source: string;
      warnings: string[];
    };
  };
  const exitCode = await runCli(process.argv.slice(2), {
    startRuntime: async () => startBunRuntime(),
    startProxyRuntime: async (session) => startProxyMcpRuntime(session),
    readLiveSession: async () => readLiveSession(process.argv.slice(3)),
    runInstaller,
    runStatus: async () => runStatusCommand(),
    runConfig: runConfigCommand,
    runDoctor: async () =>
      runDoctor({
        projectRoot,
        detectWolframUserBase: () => detectWolframUserBase(),
      }),
  });
  process.exitCode = exitCode;
}

if (process.argv[1]) {
  const scriptReal = realpathSync(fileURLToPath(import.meta.url));
  const argReal = realpathSync(process.argv[1]);
  if (scriptReal === argReal) {
    main().catch((error) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
  }
}
