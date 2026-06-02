#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startBunRuntime } from "../bun/index.js";
import { runDoctor } from "./doctor.js";

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function helpText(): string {
  return `Usage: mica <command> [options]

Commands:
  start                   Start the MICA bridge runtime (default)
  install [options]       Install MICA bridge into Wolfram
  uninstall [options]     Uninstall MICA bridge from Wolfram
  doctor                  Diagnose MICA bridge configuration
  status                  Show MICA bridge status
  config codex            Configure for Codex
  config claude-desktop   Configure for Claude Desktop
  config cursor           Configure for Cursor

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
    stdout?: { write(chunk: string): unknown };
    stderr?: { write(chunk: string): unknown };
  }
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;
  const startRuntime = deps?.startRuntime;
  const runInstaller = deps?.runInstaller;
  const _runDoctor = deps?.runDoctor;

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

  // start or no args
  if (command === "start" || command === undefined) {
    if (!startRuntime) {
      stderr.write("Error: startRuntime not available\n");
      return 1;
    }
    const runtime = await startRuntime();
    await runtime.keepAlive;
    return 0;
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

  // Future commands (listed in help but not yet implemented)
  if (command === "status" || command === "config") {
    stderr.write(`Command '${command}' is not yet implemented. Use --help for available commands.\n`);
    return 1;
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
    runInstaller,
    runDoctor: async () =>
      runDoctor({
        projectRoot,
        detectWolframUserBase: () => detectWolframUserBase(),
      }),
  });
  process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
