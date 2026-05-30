import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("MCP server lifecycle", () => {
  it("does not shut down the HTTP bridge immediately after stdio connect resolves", () => {
    const source = readFileSync("src/index.ts", "utf8");
    expect(source).not.toContain("await server.connect(new StdioServerTransport());\n\n  // server.connect() returns when the transport closes");
    expect(source).not.toContain("await server.connect(new StdioServerTransport());\n\n  await shutdown();");
  });
});
