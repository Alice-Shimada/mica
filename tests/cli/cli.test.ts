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

      const commands = ["start", "install", "uninstall", "doctor", "status"];
      for (const cmd of commands) {
        expect(text).toMatch(new RegExp(cmd));
      }

      expect(text).toMatch(/config\s+codex/);
      expect(text).toMatch(/config\s+claude-desktop/);
      expect(text).toMatch(/config\s+cursor/);
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

  // -- runCli([]) – default / no args ---------------------------------------

  describe("runCli([])", () => {
    it("should call startRuntime(), await keepAlive, return 0", async () => {
      const mod = await importCli();

      let startCalled = false;
      let keepAliveResolved = false;
      const keepAlivePromise = new Promise<void>((resolve) => {
        // resolve after a tick so the test can observe the await
        setTimeout(() => {
          keepAliveResolved = true;
          resolve();
        }, 0);
      });

      const exitCode = await mod.runCli([], {
        startRuntime: async () => {
          startCalled = true;
          return { keepAlive: keepAlivePromise };
        },
      });

      expect(exitCode).toBe(0);
      expect(startCalled).toBe(true);
      expect(keepAliveResolved).toBe(true);
    });
  });

  // -- runCli(["start"]) ----------------------------------------------------

  describe("runCli(['start'])", () => {
    it("should behave identically to no-args: call startRuntime(), await keepAlive, return 0", async () => {
      const mod = await importCli();

      let startCalled = false;
      let keepAliveResolved = false;
      const keepAlivePromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          keepAliveResolved = true;
          resolve();
        }, 0);
      });

      const exitCode = await mod.runCli(["start"], {
        startRuntime: async () => {
          startCalled = true;
          return { keepAlive: keepAlivePromise };
        },
      });

      expect(exitCode).toBe(0);
      expect(startCalled).toBe(true);
      expect(keepAliveResolved).toBe(true);
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
