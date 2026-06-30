import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendState } from "../../src/backend/backendState.js";
import { openNotebookWithDefaultApp } from "../../src/backend/openNotebookViaOs.js";
import { executeBackendMcpTool } from "../../src/mcp/backendTools.js";

vi.mock("../../src/backend/openNotebookViaOs.js", () => ({
  openNotebookWithDefaultApp: vi.fn(),
}));

const mockedOpenNotebookWithDefaultApp = vi.mocked(openNotebookWithDefaultApp);

describe("backend OS notebook opening", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "mica-open-notebook-"));
    mockedOpenNotebookWithDefaultApp.mockResolvedValue({ status: "launching", path: "" });
  });

  afterEach(() => {
    vi.clearAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("opens a notebook with the local default app without requiring a live Wolfram agent", async () => {
    const notebookPath = path.join(tempDir, "Example.nb");
    writeFileSync(notebookPath, "Notebook[{}]");
    mockedOpenNotebookWithDefaultApp.mockResolvedValue({ status: "launching", path: notebookPath });
    const state = new BackendState(() => "notebook-1");

    const result = await executeBackendMcpTool(state, "mma_open_notebook", { path: notebookPath });

    expect(mockedOpenNotebookWithDefaultApp).toHaveBeenCalledWith(notebookPath);
    expect(state.queue.snapshot().queued).toHaveLength(0);
    expect(result).toMatchObject({
      structuredContent: {
        ok: true,
        status: "launching",
        path: notebookPath,
      },
    });
  });
});
