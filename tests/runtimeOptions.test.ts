import { describe, expect, it } from "vitest";
import { runtimeModeFromArgs } from "../src/runtimeOptions.js";

describe("runtimeModeFromArgs", () => {
  it("uses MCP stdio mode by default", () => {
    expect(runtimeModeFromArgs([])).toBe("mcp");
  });

  it("uses bridge-only mode for manual development", () => {
    expect(runtimeModeFromArgs(["--bridge-only"])).toBe("bridge-only");
  });
});
