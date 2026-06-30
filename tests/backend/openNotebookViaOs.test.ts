import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openNotebookWithDefaultApp } from "../../src/backend/openNotebookViaOs.js";

describe("openNotebookWithDefaultApp", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "mica-open-default-app-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("launches an absolute notebook path through the platform default app", async () => {
    const notebookPath = path.join(tempDir, "Notebook.nb");
    writeFileSync(notebookPath, "Notebook[{}]");
    const child = {
      once: vi.fn((event: string, callback: () => void) => {
        if (event === "spawn") callback();
        return child;
      }),
      unref: vi.fn(),
    };
    const spawn = vi.fn(() => child);

    await expect(openNotebookWithDefaultApp(notebookPath, { platform: "darwin", spawn })).resolves.toEqual({
      status: "launching",
      path: notebookPath,
    });

    expect(spawn).toHaveBeenCalledWith("open", [notebookPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("uses the Windows file association launcher without shelling through cmd", async () => {
    const notebookPath = path.join(tempDir, "Notebook & Data.nb");
    writeFileSync(notebookPath, "Notebook[{}]");
    const child = {
      once: vi.fn((event: string, callback: () => void) => {
        if (event === "spawn") callback();
        return child;
      }),
      unref: vi.fn(),
    };
    const spawn = vi.fn(() => child);

    await openNotebookWithDefaultApp(notebookPath, { platform: "win32", spawn });

    expect(spawn).toHaveBeenCalledWith("rundll32.exe", ["url.dll,FileProtocolHandler", notebookPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
  });
});
