import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startBunRuntime } from "../src/bun/index.js";

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
        createMcpServer: () => ({ tool: vi.fn(), prompt: vi.fn(), connect } as never),
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
      expect(consoleError).toHaveBeenCalledWith("Dashboard: http://127.0.0.1:45678/#token=test-token");

      await runtime.stop();
    } finally {
      consoleError.mockRestore();
    }
  });
});
