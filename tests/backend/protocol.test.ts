import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_TIMEOUTS_MS, canonicalizeNotebookPath } from "../../src/backend/protocol.js";

const protocolSource = readFileSync(new URL("../../src/backend/protocol.ts", import.meta.url), "utf8");

describe("backend protocol", () => {
  it("uses approved default timeouts", () => {
    expect(DEFAULT_TIMEOUTS_MS.status).toBe(5000);
    expect(DEFAULT_TIMEOUTS_MS.listNotebooks).toBe(5000);
    expect(DEFAULT_TIMEOUTS_MS.listCells).toBe(10_000);
    expect(DEFAULT_TIMEOUTS_MS.readCell).toBe(10_000);
    expect(DEFAULT_TIMEOUTS_MS.mutation).toBe(10_000);
    expect(DEFAULT_TIMEOUTS_MS.insertCell).toBe(60_000);
    expect(DEFAULT_TIMEOUTS_MS.runCell).toBe(120_000);
    expect(DEFAULT_TIMEOUTS_MS.symbolLookup).toBe(30_000);
    expect(DEFAULT_TIMEOUTS_MS.agentHeartbeatDegradedMs).toBe(10_000);
    expect(DEFAULT_TIMEOUTS_MS.agentHeartbeatOfflineMs).toBe(30_000);
  });

  it("declares evaluation status names used by the Wolfram bridge", () => {
    for (const status of [
      '"abort_requested"',
      '"kernel_unresponsive"',
      '"unknown"',
      '"late_result"',
    ]) {
      expect(protocolSource).toContain(status);
    }
  });

  it("normalizes Windows saved notebook paths for dedupe", () => {
    expect(canonicalizeNotebookPath("C:/Users/A/Test.nb")).toBe("c:\\users\\a\\test.nb");
    expect(canonicalizeNotebookPath("C:\\Users\\A\\Test.nb")).toBe("c:\\users\\a\\test.nb");
    expect(canonicalizeNotebookPath("C:/Users/A/Test.nb", "Windows")).toBe("c:\\users\\a\\test.nb");
    expect(canonicalizeNotebookPath("  C:\\Users\\A\\Notebook.nb  ")).toBe("c:\\users\\a\\notebook.nb");
    expect(canonicalizeNotebookPath("C:\\Users\\A\\Folder\\\\Test.nb")).toBe("c:\\users\\a\\folder\\test.nb");
    expect(canonicalizeNotebookPath("C:\\Users\\A\\Folder\\.\\Sub\\..\\Test.nb")).toBe("c:\\users\\a\\folder\\test.nb");
    expect(canonicalizeNotebookPath("")).toBeUndefined();
    expect(canonicalizeNotebookPath(undefined)).toBeUndefined();
  });

  it("uses POSIX semantics for Unix-like Linux and macOS notebook paths", () => {
    expect(canonicalizeNotebookPath("/tmp/Test.nb", "Unix")).toBe("/tmp/Test.nb");
    expect(canonicalizeNotebookPath("/tmp/a/../B.nb", "Unix")).toBe("/tmp/B.nb");
    expect(canonicalizeNotebookPath("/Users/A/Notebook.nb", "MacOSX")).toBe("/Users/A/Notebook.nb");
    expect(canonicalizeNotebookPath("/Users/A/../B/Test.nb", "MacOSX")).toBe("/Users/B/Test.nb");
  });
});
