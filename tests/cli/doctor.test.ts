import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Dynamic import – will throw MODULE_NOT_FOUND until src/cli/doctor.ts exists
// ---------------------------------------------------------------------------
type DoctorModule = {
  runDoctor(deps?: DoctorDeps): Promise<{ exitCode: number; output: string }>;
};

// Structural type – matches the interface exported by doctor.ts
interface DoctorDeps {
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  nodeVersion?: string;
  exists?: (filePath: string) => boolean;
  readFile?: (filePath: string) => string;
  fetch?: (
    url: string,
    init?: { headers?: Record<string, string> }
  ) => Promise<{ status: number; json(): Promise<unknown> }>;
  detectWolframUserBase?: () => {
    userBase: string;
    source: string;
    warnings: string[];
  };
}

async function importDoctor(): Promise<DoctorModule> {
  return import("../../src/cli/doctor.js") as Promise<DoctorModule>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = path.join(tmpdir(), `mica-doctor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createPackageBuild(projectRoot: string): void {
  // dist/src/cli/index.js
  const distCliDir = path.join(projectRoot, "dist", "src", "cli");
  mkdirSync(distCliDir, { recursive: true });
  writeFileSync(path.join(distCliDir, "index.js"), "// built CLI");

  // dist/src/bun/index.js
  const distBunDir = path.join(projectRoot, "dist", "src", "bun");
  mkdirSync(distBunDir, { recursive: true });
  writeFileSync(path.join(distBunDir, "index.js"), "// built bun");

  // paclet/Kernel/MMAAgentBridge.wl
  const pacletKernelDir = path.join(projectRoot, "paclet", "Kernel");
  mkdirSync(pacletKernelDir, { recursive: true });
  writeFileSync(path.join(pacletKernelDir, "MMAAgentBridge.wl"), "(* MICA bridge paclet *)");
}

function createSessionFile(sessionDir: string, overrides?: Partial<{
  baseUrl: string;
  authToken: string;
  host: string;
  port: number;
  status: string;
}>): string {
  const sessionPath = path.join(sessionDir, "session.json");
  const session = {
    baseUrl: overrides?.baseUrl ?? "http://127.0.0.1:12345",
    authToken: overrides?.authToken ?? "test-token",
    host: overrides?.host ?? "127.0.0.1",
    port: overrides?.port ?? 12345,
    status: overrides?.status ?? "running",
  };
  writeFileSync(sessionPath, JSON.stringify(session));
  return sessionPath;
}

function createKernelInit(userBase: string, withAutoload: boolean): void {
  const kernelDir = path.join(userBase, "Kernel");
  mkdirSync(kernelDir, { recursive: true });
  const content = withAutoload
    ? "(* BEGIN MICA control-kernel autoload *)\nNeeds[\"MMAAgentBridge`\"];\n(* END MICA control-kernel autoload *)"
    : "(* Just a regular init.m *)";
  writeFileSync(path.join(kernelDir, "init.m"), content);
}

function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

function readTextFile(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Phase 11.2 mica doctor", () => {
  describe("runDoctor – all checks OK", () => {
    let projectRoot: string;
    let userBase: string;
    let sessionDir: string;
    let sessionPath: string;

    beforeEach(() => {
      projectRoot = makeTempDir();
      userBase = makeTempDir();
      sessionDir = makeTempDir();

      createPackageBuild(projectRoot);
      sessionPath = createSessionFile(sessionDir);
      createKernelInit(userBase, true);
    });

    afterEach(() => {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(userBase, { recursive: true, force: true });
      rmSync(sessionDir, { recursive: true, force: true });
    });

    it("should return exitCode 0 and output all OK status lines", async () => {
      const mod = await importDoctor();

      const fetchMock = async (url: string, _init?: { headers?: Record<string, string> }) => {
        if (url.includes("/status")) {
          return {
            status: 200,
            json: async () => ({ agentCount: 1, notebookCount: 1 }),
          };
        }
        return { status: 500, json: async () => ({}) };
      };

      const { exitCode, output } = await mod.runDoctor({
        projectRoot,
        env: { MICA_SESSION_FILE: sessionPath },
        nodeVersion: "22.11.0",
        exists: fileExists,
        readFile: readTextFile,
        fetch: fetchMock,
        detectWolframUserBase: () => ({
          userBase,
          source: "test",
          warnings: [],
        }),
      });

      expect(exitCode).toBe(0);
      expect(output).toContain("MICA doctor");
      expect(output).toContain("OK   Node version");
      expect(output).toContain("OK   Package build");
      expect(output).toContain("OK   Bridge source path");
      expect(output).toContain("OK   Session file");
      expect(output).toContain("OK   Session target");
      expect(output).toContain("OK   Auth token");
      expect(output).toContain("OK   Server /status reachable");
      expect(output).toContain("OK   Live agent count: 1");
      expect(output).toContain("OK   Live notebook count: 1");
      expect(output).toContain("OK   Wolfram user base");
      expect(output).toContain("OK   Kernel/init.m");
      expect(output).toContain("OK   Autoload block");
      expect(output.endsWith("\n")).toBe(true);
    });
  });

  describe("runDoctor – Node version and build checks", () => {
    let projectRoot: string;
    let userBase: string;
    let sessionDir: string;
    let sessionPath: string;

    beforeEach(() => {
      projectRoot = makeTempDir();
      userBase = makeTempDir();
      sessionDir = makeTempDir();
      createPackageBuild(projectRoot);
      sessionPath = createSessionFile(sessionDir);
      createKernelInit(userBase, true);
    });

    afterEach(() => {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(userBase, { recursive: true, force: true });
      rmSync(sessionDir, { recursive: true, force: true });
    });

    it("should fail when Node version is older than 20", async () => {
      const mod = await importDoctor();

      const { exitCode, output } = await mod.runDoctor({
        projectRoot,
        env: { MICA_SESSION_FILE: sessionPath },
        nodeVersion: "18.19.0",
        exists: fileExists,
        readFile: readTextFile,
        fetch: async () => ({ status: 200, json: async () => ({ agentCount: 1, notebookCount: 1 }) }),
        detectWolframUserBase: () => ({ userBase, source: "test", warnings: [] }),
      });

      expect(exitCode).toBe(1);
      expect(output).toContain("FAIL Node version");
    });

    it("should report bridge source path separately from package build", async () => {
      const mod = await importDoctor();
      rmSync(path.join(projectRoot, "paclet"), { recursive: true, force: true });

      const { exitCode, output } = await mod.runDoctor({
        projectRoot,
        env: { MICA_SESSION_FILE: sessionPath },
        nodeVersion: "22.11.0",
        exists: fileExists,
        readFile: readTextFile,
        fetch: async () => ({ status: 200, json: async () => ({ agentCount: 1, notebookCount: 1 }) }),
        detectWolframUserBase: () => ({ userBase, source: "test", warnings: [] }),
      });

      expect(exitCode).toBe(1);
      expect(output).toContain("OK   Package build");
      expect(output).toContain("FAIL Bridge source path");
      expect(output).toContain("FIX  Run: npm run build");
    });

    it("should use global fetch when no fetch dependency is injected", async () => {
      const mod = await importDoctor();
      const originalFetch = globalThis.fetch;
      let fetchCalled = false;
      globalThis.fetch = (async () => {
        fetchCalled = true;
        return new Response(JSON.stringify({ agentCount: 1, notebookCount: 1 }), { status: 200 });
      }) as typeof fetch;

      try {
        const { exitCode } = await mod.runDoctor({
          projectRoot,
          env: { MICA_SESSION_FILE: sessionPath },
          nodeVersion: "22.11.0",
          exists: fileExists,
          readFile: readTextFile,
          detectWolframUserBase: () => ({ userBase, source: "test", warnings: [] }),
        });

        expect(exitCode).toBe(0);
        expect(fetchCalled).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("runDoctor – missing session file", () => {
    let projectRoot: string;
    let userBase: string;

    beforeEach(() => {
      projectRoot = makeTempDir();
      userBase = makeTempDir();
      createPackageBuild(projectRoot);
      createKernelInit(userBase, true);
    });

    afterEach(() => {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(userBase, { recursive: true, force: true });
    });

    it("should return exitCode 1, report FAIL Session file, suggest FIX, and not call fetch", async () => {
      const mod = await importDoctor();

      let fetchCalled = false;

      const { exitCode, output } = await mod.runDoctor({
        projectRoot,
        env: { MICA_SESSION_FILE: "/nonexistent/session.json" },
        nodeVersion: "22.11.0",
        exists: () => false,
        readFile: () => {
          throw new Error("ENOENT");
        },
        fetch: async () => {
          fetchCalled = true;
          return { status: 200, json: async () => ({}) };
        },
        detectWolframUserBase: () => ({
          userBase,
          source: "test",
          warnings: [],
        }),
      });

      expect(exitCode).toBe(1);
      expect(output).toContain("FAIL Session file");
      expect(output).toContain("FIX  Run: mica mcp");
      expect(fetchCalled).toBe(false);
    });
  });

  describe("runDoctor – HTTP 401 from /status", () => {
    let projectRoot: string;
    let userBase: string;
    let sessionDir: string;
    let sessionPath: string;

    beforeEach(() => {
      projectRoot = makeTempDir();
      userBase = makeTempDir();
      sessionDir = makeTempDir();

      createPackageBuild(projectRoot);
      sessionPath = createSessionFile(sessionDir);
      createKernelInit(userBase, true);
    });

    afterEach(() => {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(userBase, { recursive: true, force: true });
      rmSync(sessionDir, { recursive: true, force: true });
    });

    it("should return exitCode 1 and report FAIL Auth token", async () => {
      const mod = await importDoctor();

      const fetchMock = async (_url: string, _init?: { headers?: Record<string, string> }) => ({
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      });

      const { exitCode, output } = await mod.runDoctor({
        projectRoot,
        env: { MICA_SESSION_FILE: sessionPath },
        nodeVersion: "22.11.0",
        exists: fileExists,
        readFile: readTextFile,
        fetch: fetchMock,
        detectWolframUserBase: () => ({
          userBase,
          source: "test",
          warnings: [],
        }),
      });

      expect(exitCode).toBe(1);
      expect(output).toContain("FAIL Auth token");
    });
  });

  describe("runDoctor – zero live agents and notebooks", () => {
    let projectRoot: string;
    let userBase: string;
    let sessionDir: string;
    let sessionPath: string;

    beforeEach(() => {
      projectRoot = makeTempDir();
      userBase = makeTempDir();
      sessionDir = makeTempDir();

      createPackageBuild(projectRoot);
      sessionPath = createSessionFile(sessionDir);
      createKernelInit(userBase, true);
    });

    afterEach(() => {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(userBase, { recursive: true, force: true });
      rmSync(sessionDir, { recursive: true, force: true });
    });

    it("should return exitCode 1 and report FAIL for both live agent count and live notebook count", async () => {
      const mod = await importDoctor();

      const fetchMock = async (_url: string, _init?: { headers?: Record<string, string> }) => ({
        status: 200,
        json: async () => ({ agentCount: 0, notebookCount: 0 }),
      });

      const { exitCode, output } = await mod.runDoctor({
        projectRoot,
        env: { MICA_SESSION_FILE: sessionPath },
        nodeVersion: "22.11.0",
        exists: fileExists,
        readFile: readTextFile,
        fetch: fetchMock,
        detectWolframUserBase: () => ({
          userBase,
          source: "test",
          warnings: [],
        }),
      });

      expect(exitCode).toBe(1);
      expect(output).toContain("FAIL Live agent count: 0");
      expect(output).toContain("FAIL Live notebook count: 0");
    });
  });

  describe("runDoctor – missing Kernel/init.m or missing autoload block", () => {
    let projectRoot: string;
    let sessionDir: string;
    let sessionPath: string;

    beforeEach(() => {
      projectRoot = makeTempDir();
      sessionDir = makeTempDir();
      createPackageBuild(projectRoot);
      sessionPath = createSessionFile(sessionDir);
    });

    afterEach(() => {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(sessionDir, { recursive: true, force: true });
    });

    it("should return exitCode 1 when Kernel/init.m is missing", async () => {
      const mod = await importDoctor();

      const userBaseNoInit = makeTempDir();
      // Do NOT create Kernel/init.m

      const fetchMock = async (_url: string, _init?: { headers?: Record<string, string> }) => ({
        status: 200,
        json: async () => ({ agentCount: 1, notebookCount: 1 }),
      });

      const { exitCode, output } = await mod.runDoctor({
        projectRoot,
        env: { MICA_SESSION_FILE: sessionPath },
        nodeVersion: "22.11.0",
        exists: fileExists,
        readFile: readTextFile,
        fetch: fetchMock,
        detectWolframUserBase: () => ({
          userBase: userBaseNoInit,
          source: "test",
          warnings: [],
        }),
      });

      expect(exitCode).toBe(1);
      expect(output).toContain("FAIL");
      expect(output).toMatch(/Kernel.*init\.m/i);

      rmSync(userBaseNoInit, { recursive: true, force: true });
    });

    it("should return exitCode 1 when Kernel/init.m exists but lacks autoload block", async () => {
      const mod = await importDoctor();

      const userBaseNoAutoload = makeTempDir();
      createKernelInit(userBaseNoAutoload, false); // no autoload block

      const fetchMock = async (_url: string, _init?: { headers?: Record<string, string> }) => ({
        status: 200,
        json: async () => ({ agentCount: 1, notebookCount: 1 }),
      });

      const { exitCode, output } = await mod.runDoctor({
        projectRoot,
        env: { MICA_SESSION_FILE: sessionPath },
        nodeVersion: "22.11.0",
        exists: fileExists,
        readFile: readTextFile,
        fetch: fetchMock,
        detectWolframUserBase: () => ({
          userBase: userBaseNoAutoload,
          source: "test",
          warnings: [],
        }),
      });

      expect(exitCode).toBe(1);
      expect(output).toContain("FAIL");
      expect(output).toMatch(/autoload/i);

      rmSync(userBaseNoAutoload, { recursive: true, force: true });
    });
  });
});
