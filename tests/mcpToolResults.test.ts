import { describe, expect, it } from "vitest";
import { toolFailure, toolSuccess } from "../src/mcp/toolResults.js";

describe("MCP tool result formatting", () => {
  it("keeps top-level success semantics separate from agent payload fields", () => {
    expect(toolSuccess({ ok: false, value: 42 })).toMatchObject({
      structuredContent: {
        ok: true,
        value: 42,
      },
    });
  });

  it("turns known tool failures into structured MCP error content", () => {
    expect(toolFailure(new Error("PERMISSION_DENIED: mma_save_notebook"), { tool: "mma_save_notebook" })).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: {
          code: "PERMISSION_DENIED",
          message: "The selected notebook did not grant permission for this tool.",
          retryable: false,
          tool: "mma_save_notebook",
        },
      },
    });
  });
});
