import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultSessionFile, generateAuthToken, loadRuntimeConfig } from "../src/runtime/config.js";

describe("runtime config", () => {
  it("uses safe local defaults", () => {
    const config = loadRuntimeConfig({ env: { HOME: "/home/alice" }, argv: [] });

    expect(config).toEqual({
      host: "127.0.0.1",
      preferredPort: 19791,
      sessionFile: path.join("/home/alice", ".mica", "session.json"),
      authToken: undefined,
      bridgeOnly: false,
    });
  });

  it("uses USERPROFILE when HOME is unavailable", () => {
    expect(defaultSessionFile({ USERPROFILE: "C:\\Users\\Alice" })).toBe(path.join("C:\\Users\\Alice", ".mica", "session.json"));
  });

  it("loads env values", () => {
    const config = loadRuntimeConfig({
      env: {
        MICA_HOST: "localhost",
        MICA_PORT: "23456",
        MICA_SESSION_FILE: "D:\\tmp\\mica-session.json",
        MICA_TOKEN: "env-token",
      },
      argv: [],
    });

    expect(config).toMatchObject({
      host: "localhost",
      preferredPort: 23456,
      sessionFile: "D:\\tmp\\mica-session.json",
      authToken: "env-token",
    });
  });

  it("treats an empty env token as unconfigured", () => {
    const config = loadRuntimeConfig({ env: { HOME: "/home/alice", MICA_TOKEN: "" }, argv: [] });

    expect(config.authToken).toBeUndefined();
  });

  it("lets CLI args override env values", () => {
    const config = loadRuntimeConfig({
      env: {
        HOME: "/home/alice",
        MICA_HOST: "env-host",
        MICA_PORT: "11111",
        MICA_SESSION_FILE: "/env/session.json",
        MICA_TOKEN: "env-token",
      },
      argv: ["--host", "cli-host", "--port", "22222", "--session-file", "/cli/session.json", "--token", "cli-token", "--bridge-only"],
    });

    expect(config).toEqual({
      host: "cli-host",
      preferredPort: 22222,
      sessionFile: "/cli/session.json",
      authToken: "cli-token",
      bridgeOnly: true,
    });
  });

  it("rejects invalid ports", () => {
    expect(() => loadRuntimeConfig({ env: { MICA_PORT: "abc" }, argv: [] })).toThrow(/MICA_PORT/);
    expect(() => loadRuntimeConfig({ env: {}, argv: ["--port", "0"] })).toThrow(/--port/);
  });

  it("rejects missing CLI argument values", () => {
    expect(() => loadRuntimeConfig({ env: {}, argv: ["--host"] })).toThrow(/--host/);
    expect(() => loadRuntimeConfig({ env: {}, argv: ["--session-file"] })).toThrow(/--session-file/);
    expect(() => loadRuntimeConfig({ env: {}, argv: ["--token"] })).toThrow(/--token/);
  });

  it("generates opaque auth tokens", () => {
    const token = generateAuthToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  });
});
