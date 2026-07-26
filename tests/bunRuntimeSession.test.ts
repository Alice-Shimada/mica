import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startBunRuntime } from "../src/bun/index.js";
import { MICA_PACKAGE_VERSION } from "../src/runtime/packageVersion.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Bun runtime session file", () => {
  it("writes a session file with the actual HTTP port after startup", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "mica-session-"));
    tempDirs.push(tempDir);
    const sessionFile = path.join(tempDir, ".mica", "session.json");
    const stop = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue(undefined);
    const createHttpApp = vi.fn().mockResolvedValue({ port: 45678, stop });
    const createMcpServer = vi.fn(() => ({ tool: vi.fn(), prompt: vi.fn(), connect } as never));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const runtime = await startBunRuntime({
        runtimeConfig: {
          host: "127.0.0.1",
          preferredPort: 0,
          sessionFile,
          authToken: "test-token",
          bridgeOnly: false,
        },
        createHttpApp,
        createMcpServer,
        version: "9.8.7-test",
      });

      const session = JSON.parse(await readFile(sessionFile, "utf8"));

      expect(session).toMatchObject({
        host: "127.0.0.1",
        port: 45678,
        baseUrl: "http://127.0.0.1:45678",
        authToken: "test-token",
        pid: process.pid,
        version: "9.8.7-test",
        status: "running",
      });
      expect(typeof session.updatedAt).toBe("string");
      expect(createHttpApp).toHaveBeenCalledWith(expect.objectContaining({ authToken: "test-token" }));
      expect(createMcpServer).toHaveBeenCalledWith("9.8.7-test");
      expect(consoleError).toHaveBeenCalledWith("Dashboard: http://127.0.0.1:45678/#token=test-token");

      await runtime.stop();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("uses the package version when no override is provided", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "mica-session-"));
    tempDirs.push(tempDir);
    const sessionFile = path.join(tempDir, ".mica", "session.json");
    const stop = vi.fn().mockResolvedValue(undefined);
    const createHttpApp = vi.fn().mockResolvedValue({ port: 45678, stop });
    const createMcpServer = vi.fn(() => ({ tool: vi.fn(), prompt: vi.fn(), connect: vi.fn() } as never));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const runtime = await startBunRuntime({
        bridgeOnly: true,
        runtimeConfig: {
          host: "127.0.0.1",
          preferredPort: 0,
          sessionFile,
          authToken: "test-token",
          bridgeOnly: true,
        },
        createHttpApp,
        createMcpServer,
      });

      const session = JSON.parse(await readFile(sessionFile, "utf8"));
      expect(session.version).toBe(MICA_PACKAGE_VERSION);
      expect(createHttpApp).toHaveBeenCalledWith(expect.objectContaining({ version: MICA_PACKAGE_VERSION }));
      expect(createMcpServer).toHaveBeenCalledWith(MICA_PACKAGE_VERSION);

      await runtime.stop();
    } finally {
      consoleError.mockRestore();
    }
  });
});
