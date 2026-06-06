import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const CLI_SOURCE_TS = path.resolve("src", "cli", "index.ts");
const PACKAGE_JSON_PATH = path.resolve("package.json");
const PACKAGE_LOCK_PATH = path.resolve("package-lock.json");

// ---------------------------------------------------------------------------
// Dynamic import helper – avoids top-level import of the missing module.
// Will throw MODULE_NOT_FOUND until src/cli/index.ts is created.
// ---------------------------------------------------------------------------
type CliModule = {
  helpText(): string;
  runCli(
    argv: string[],
    deps?: {
      startRuntime?: () => Promise<{ keepAlive: Promise<void> }>;
      runInstaller?: (argv: string[]) => string;
      runDoctor?: () => Promise<{ exitCode: number; output: string }>;
      runStatus?: () => Promise<{ exitCode: number; output: string; running?: boolean }>;
      runConfig?: (argv: string[]) => { exitCode: number; output: string };
      readLiveSession?: () => Promise<{ baseUrl: string; authToken: string } | undefined>;
      startProxyRuntime?: (session: { baseUrl: string; authToken: string }) => Promise<{ keepAlive: Promise<void> }>;
      sleep?: (ms: number) => Promise<void>;
      stdout?: { write(chunk: string): unknown };
      stderr?: { write(chunk: string): unknown };
    }
  ): Promise<number>;
};

async function importCli(): Promise<CliModule> {
  // Dynamic import – resolves to dist/src/cli/index.js at runtime,
  // but vitest with tsx handles .ts sources transparently.
  return import("../../src/cli/index.js") as Promise<CliModule>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Phase 11.1 CLI entry point", () => {
  // -- Package manifest assertions ------------------------------------------

  describe("package.json bin", () => {
    it("should point bin.mica to dist/src/cli/index.js", () => {
      const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8"));
      expect(pkg.bin?.mica).toBe("dist/src/cli/index.js");
    });
  });

  describe("package-lock.json bin", () => {
    it("should point root package bin.mica to dist/src/cli/index.js", () => {
      const lock = JSON.parse(readFileSync(PACKAGE_LOCK_PATH, "utf8"));
      expect(lock.packages?.[""]?.bin?.mica).toBe("dist/src/cli/index.js");
    });
  });

  // -- Source file existence ------------------------------------------------

  describe("CLI source file", () => {
    it("should exist at src/cli/index.ts", () => {
      expect(existsSync(CLI_SOURCE_TS)).toBe(true);
    });
  });

  // -- Module exports -------------------------------------------------------

  describe("CLI module exports", () => {
    it("should export helpText(): string", async () => {
      const mod = await importCli();
      expect(mod.helpText).toBeTypeOf("function");
      const text = mod.helpText();
      expect(text).toBeTypeOf("string");
    });

    it("should export runCli(argv, deps?): Promise<number>", async () => {
      const mod = await importCli();
      expect(mod.runCli).toBeTypeOf("function");
    });
  });

  // -- helpText() -----------------------------------------------------------

  describe("helpText()", () => {
    it("should include Usage: mica and all core commands", async () => {
      const mod = await importCli();
      const text = mod.helpText();

      expect(text).toMatch(/Usage:\s+mica/);

      const commands = ["mcp", "install", "uninstall", "doctor", "status"];
      for (const cmd of commands) {
        expect(text).toMatch(new RegExp(cmd));
      }

      expect(text).toMatch(/config\s+codex/);
      expect(text).toMatch(/config\s+claude-desktop/);
      expect(text).toMatch(/config\s+cursor/);
      expect(text).toMatch(/config\s+opencode/);

      // deprecated commands should not appear
      expect(text).not.toMatch(/\bstart\b/);
      expect(text).not.toMatch(/\bstop\b/);
      expect(text).not.toMatch(/\brestart\b/);
    });
  });

  // -- runCli(["--help"]) ---------------------------------------------------

  describe("runCli(['--help'])", () => {
    it("should return 0, write help to stdout, and not call startRuntime or runInstaller", async () => {
      const mod = await importCli();

      let startCalled = false;
      let installerCalled = false;
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      const exitCode = await mod.runCli(["--help"], {
        startRuntime: async () => {
          startCalled = true;
          return { keepAlive: new Promise(() => {}) };
        },
        runInstaller: (_argv: string[]) => {
          installerCalled = true;
          return "";
        },
        stdout: { write(chunk: string) { stdoutChunks.push(chunk); } },
        stderr: { write(chunk: string) { stderrChunks.push(chunk); } },
      });

      expect(exitCode).toBe(0);
      expect(startCalled).toBe(false);
      expect(installerCalled).toBe(false);
      expect(stdoutChunks.join("")).toMatch(/Usage:\s+mica/);
      expect(stderrChunks.join("")).toBe("");
    });
  });

  // -- runCli(["install", "--dry-run"]) -------------------------------------

  describe("runCli(['install', '--dry-run'])", () => {
    it("should call runInstaller(['--dry-run']), write its output to stdout, return 0", async () => {
      const mod = await importCli();

      let receivedArgs: string[] | undefined;
      const stdoutChunks: string[] = [];

      const exitCode = await mod.runCli(["install", "--dry-run"], {
        runInstaller: (argv: string[]) => {
          receivedArgs = argv;
          return "installer output";
        },
        stdout: { write(chunk: string) { stdoutChunks.push(chunk); } },
      });

      expect(exitCode).toBe(0);
      expect(receivedArgs).toEqual(["--dry-run"]);
      expect(stdoutChunks.join("")).toBe("installer output");
    });
  });

  // -- runCli(["uninstall", "--dry-run"]) -----------------------------------

  describe("runCli(['uninstall', '--dry-run'])", () => {
    it("should call runInstaller(['--uninstall', '--dry-run']), write its output to stdout, return 0", async () => {
      const mod = await importCli();

      let receivedArgs: string[] | undefined;
      const stdoutChunks: string[] = [];

      const exitCode = await mod.runCli(["uninstall", "--dry-run"], {
        runInstaller: (argv: string[]) => {
          receivedArgs = argv;
          return "uninstaller output";
        },
        stdout: { write(chunk: string) { stdoutChunks.push(chunk); } },
      });

      expect(exitCode).toBe(0);
      expect(receivedArgs).toEqual(["--uninstall", "--dry-run"]);
      expect(stdoutChunks.join("")).toBe("uninstaller output");
    });
  });

  // -- runCli([]) – no args now behaves like mcp ---------------------------

  describe("runCli([])", () => {
    it("should proxy to existing bridge when a live session exists", async () => {
      const mod = await importCli();
      const session = { baseUrl: "http://127.0.0.1:19791", authToken: "test-token" };
      let startCalled = false;
      let proxySession: typeof session | undefined;

      const exitCode = await mod.runCli([], {
        readLiveSession: async () => session,
        startRuntime: async () => {
          startCalled = true;
          return { keepAlive: Promise.resolve() };
        },
        startProxyRuntime: async (receivedSession) => {
          proxySession = receivedSession;
          return { keepAlive: Promise.resolve() };
        },
      });

      expect(exitCode).toBe(0);
      expect(startCalled).toBe(false);
      expect(proxySession).toEqual(session);
    });

    it("should start full runtime when no live bridge exists", async () => {
      const mod = await importCli();
      let startCalled = false;
      let proxyCalled = false;

      const exitCode = await mod.runCli([], {
        readLiveSession: async () => undefined,
        startRuntime: async () => {
          startCalled = true;
          return { keepAlive: Promise.resolve() };
        },
        startProxyRuntime: async () => {
          proxyCalled = true;
          return { keepAlive: Promise.resolve() };
        },
      });

      expect(exitCode).toBe(0);
      expect(startCalled).toBe(true);
      expect(proxyCalled).toBe(false);
    });
  });

  // -- runCli(["start"]) – alias for mcp -----------------------------------

  describe("runCli(['start'])", () => {
    it("should proxy to existing bridge when a live session exists", async () => {
      const mod = await importCli();
      const session = { baseUrl: "http://127.0.0.1:19791", authToken: "test-token" };
      let startCalled = false;
      let proxySession: typeof session | undefined;

      const exitCode = await mod.runCli(["start"], {
        readLiveSession: async () => session,
        startRuntime: async () => {
          startCalled = true;
          return { keepAlive: Promise.resolve() };
        },
        startProxyRuntime: async (receivedSession) => {
          proxySession = receivedSession;
          return { keepAlive: Promise.resolve() };
        },
      });

      expect(exitCode).toBe(0);
      expect(startCalled).toBe(false);
      expect(proxySession).toEqual(session);
    });

    it("should start full runtime when no live bridge exists", async () => {
      const mod = await importCli();
      let startCalled = false;
      let proxyCalled = false;

      const exitCode = await mod.runCli(["start"], {
        readLiveSession: async () => undefined,
        startRuntime: async () => {
          startCalled = true;
          return { keepAlive: Promise.resolve() };
        },
        startProxyRuntime: async () => {
          proxyCalled = true;
          return { keepAlive: Promise.resolve() };
        },
      });

      expect(exitCode).toBe(0);
      expect(startCalled).toBe(true);
      expect(proxyCalled).toBe(false);
    });
  });

  // -- runCli(["status"]) ---------------------------------------------------

  describe("runCli(['status'])", () => {
    it("should call runStatus, write its output to stdout, and return its exitCode", async () => {
      const mod = await importCli();

      let statusCalled = false;
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      const exitCode = await mod.runCli(["status"], {
        runStatus: async () => {
          statusCalled = true;
          return { exitCode: 0, output: "MICA status\nServer: running\n", running: true };
        },
        stdout: { write(chunk: string) { stdoutChunks.push(chunk); } },
        stderr: { write(chunk: string) { stderrChunks.push(chunk); } },
      });

      expect(exitCode).toBe(0);
      expect(statusCalled).toBe(true);
      expect(stdoutChunks.join("")).toContain("MICA status");
      expect(stderrChunks.join("")).toBe("");
    });
  });

  // -- runCli(["config", "opencode"]) -------------------------------------

  describe("runCli(['config', 'opencode'])", () => {
    it("should call runConfig, write the opencode snippet to stdout, and return 0", async () => {
      const mod = await importCli();

      let receivedArgs: string[] | undefined;
      const stdoutChunks: string[] = [];

      const exitCode = await mod.runCli(["config", "opencode"], {
        runConfig: (argv: string[]) => {
          receivedArgs = argv;
          return { exitCode: 0, output: '{"mcp":{"mica":{"type":"local","command":["mica","mcp"]}}}\n' };
        },
        stdout: { write(chunk: string) { stdoutChunks.push(chunk); } },
      });

      expect(exitCode).toBe(0);
      expect(receivedArgs).toEqual(["opencode"]);
      expect(stdoutChunks.join("")).toContain('"type":"local"');
      expect(stdoutChunks.join("")).toContain('"command":["mica","mcp"]');
    });
  });

  describe("runCli(['config']) MCP snippets", () => {
    it("runConfigCommand prints mica mcp for Codex, Claude Desktop, Cursor, and OpenCode", async () => {
      const { runConfigCommand } = await import("../../src/cli/configSnippets.js");
      const clients = ["codex", "claude-desktop", "cursor", "opencode"];

      for (const client of clients) {
        const { exitCode, output } = runConfigCommand([client]);

        expect(exitCode).toBe(0);
        expect(output).toContain("mcp");
        expect(output).not.toContain("start");
      }
    });
  });

  describe("runCli(['mcp'])", () => {
    it("starts a stdio proxy without stdout status text when a live bridge exists", async () => {
      const mod = await importCli();
      const session = { baseUrl: "http://127.0.0.1:19791", authToken: "test-token" };
      let startCalled = false;
      let proxySession: typeof session | undefined;
      const stdoutChunks: string[] = [];

      const exitCode = await mod.runCli(["mcp"], {
        readLiveSession: async () => session,
        startRuntime: async () => {
          startCalled = true;
          return { keepAlive: Promise.resolve() };
        },
        startProxyRuntime: async (receivedSession) => {
          proxySession = receivedSession;
          return { keepAlive: Promise.resolve() };
        },
        stdout: { write(chunk: string) { stdoutChunks.push(chunk); } },
      });

      expect(exitCode).toBe(0);
      expect(startCalled).toBe(false);
      expect(proxySession).toEqual(session);
      expect(stdoutChunks.join("")).toBe("");
    });

    it("starts the full runtime when no live bridge exists", async () => {
      const mod = await importCli();
      let startCalled = false;
      let proxyCalled = false;

      const exitCode = await mod.runCli(["mcp"], {
        readLiveSession: async () => undefined,
        startRuntime: async () => {
          startCalled = true;
          return { keepAlive: Promise.resolve() };
        },
        startProxyRuntime: async () => {
          proxyCalled = true;
          return { keepAlive: Promise.resolve() };
        },
      });

      expect(exitCode).toBe(0);
      expect(startCalled).toBe(true);
      expect(proxyCalled).toBe(false);
    });

    it("falls back to proxy when full runtime startup races with an existing bridge", async () => {
      const mod = await importCli();
      const session = { baseUrl: "http://127.0.0.1:19791", authToken: "test-token" };
      let liveSessionReads = 0;
      let proxySession: typeof session | undefined;
      let sleepCalls = 0;
      const error = Object.assign(new Error("listen EADDRINUSE: address already in use 127.0.0.1:19791"), {
        code: "EADDRINUSE",
      });

      const exitCode = await mod.runCli(["mcp"], {
        readLiveSession: async () => {
          liveSessionReads += 1;
          return liveSessionReads >= 2 ? session : undefined;
        },
        startRuntime: async () => {
          throw error;
        },
        startProxyRuntime: async (receivedSession) => {
          proxySession = receivedSession;
          return { keepAlive: Promise.resolve() };
        },
        sleep: async () => {
          sleepCalls += 1;
        },
      });

      expect(exitCode).toBe(0);
      expect(sleepCalls).toBe(1);
      expect(proxySession).toEqual(session);
    });
  });

  // -- runCli(["doctor"]) ---------------------------------------------------

  describe("runCli(['doctor'])", () => {
    it("should call runDoctor, write its output to stdout, return its exitCode, write nothing to stderr", async () => {
      const mod = await importCli();

      let doctorCalled = false;
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      const exitCode = await mod.runCli(["doctor"], {
        runDoctor: async () => {
          doctorCalled = true;
          return { exitCode: 0, output: "MICA doctor\nOK   Node version: 22.x\n" };
        },
        stdout: { write(chunk: string) { stdoutChunks.push(chunk); } },
        stderr: { write(chunk: string) { stderrChunks.push(chunk); } },
      });

      expect(exitCode).toBe(0);
      expect(doctorCalled).toBe(true);
      expect(stdoutChunks.join("")).toContain("MICA doctor");
      expect(stderrChunks.join("")).toBe("");
    });
  });

  // -- runCli(["wat"]) – unknown command ------------------------------------

  describe("runCli(['wat'])", () => {
    it("should return 1 and write an Unknown command error to stderr", async () => {
      const mod = await importCli();

      let startCalled = false;
      let installerCalled = false;
      const stderrChunks: string[] = [];

      const exitCode = await mod.runCli(["wat"], {
        startRuntime: async () => {
          startCalled = true;
          return { keepAlive: new Promise(() => {}) };
        },
        runInstaller: (_argv: string[]) => {
          installerCalled = true;
          return "";
        },
        stderr: { write(chunk: string) { stderrChunks.push(chunk); } },
      });

      expect(exitCode).toBe(1);
      expect(startCalled).toBe(false);
      expect(installerCalled).toBe(false);
      expect(stderrChunks.join("").toLowerCase()).toMatch(/unknown/);
    });
  });
});
