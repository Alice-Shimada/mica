import { describe, expect, it } from "vitest";
import { NotebookRegistry } from "../../src/backend/notebookRegistry.js";
import type { NotebookHeartbeat } from "../../src/backend/protocol.js";

const permissions = {
  ReadNotebook: true,
  InsertCell: true,
  ModifyCell: true,
  DeleteCell: true,
  RunCell: true,
  SaveNotebook: true,
  CreateNotebook: false,
  OpenNotebook: false,
};

function heartbeat(overrides: Partial<NotebookHeartbeat> = {}): NotebookHeartbeat {
  return {
    agentSessionId: "agent-1",
    frontendObjectKey: "fe-1",
    displayName: "未命名-2",
    windowTitle: "未命名-2",
    wolframVersion: "13.3",
    platform: "Windows",
    permissions,
    seenAt: 1000,
    ...overrides,
  };
}

describe("NotebookRegistry", () => {
  it("updates display name and path without changing notebookId when an untitled notebook is saved", () => {
    let nextId = 0;
    const registry = new NotebookRegistry(() => `notebook-${++nextId}`);
    const first = registry.upsertHeartbeat(heartbeat());
    const saved = registry.upsertHeartbeat(
      heartbeat({
        displayName: "gaussian.nb",
        windowTitle: "gaussian.nb",
        notebookPath: "C:/tmp/gaussian.nb",
        savedPath: "C:/tmp/gaussian.nb",
        seenAt: 2000,
      }),
    );

    expect(saved.notebookId).toBe(first.notebookId);
    expect(saved.displayName).toBe("gaussian.nb");
    expect(saved.windowTitle).toBe("gaussian.nb");
    expect(saved.normalizedPath).toBe("c:\\tmp\\gaussian.nb");
    expect(registry.listLive()).toHaveLength(1);
  });

  it("deduplicates saved notebooks by normalized path across agent sessions", () => {
    let nextId = 0;
    const registry = new NotebookRegistry(() => `notebook-${++nextId}`);
    const first = registry.upsertHeartbeat(
      heartbeat({
        agentSessionId: "agent-1",
        frontendObjectKey: "fe-old",
        displayName: "foo.nb",
        windowTitle: "foo.nb",
        notebookPath: "C:/tmp/foo.nb",
        savedPath: "C:/tmp/foo.nb",
      }),
    );
    const revived = registry.upsertHeartbeat(
      heartbeat({
        agentSessionId: "agent-2",
        frontendObjectKey: "fe-new",
        displayName: "foo.nb",
        windowTitle: "foo.nb",
        notebookPath: "C:\\tmp\\foo.nb",
        savedPath: "C:\\tmp\\foo.nb",
        seenAt: 5000,
      }),
    );

    expect(revived.notebookId).toBe(first.notebookId);
    expect(revived.agentSessionId).toBe("agent-2");
    expect(revived.frontendObjectKey).toBe("fe-new");
    expect(registry.listLive()).toHaveLength(1);
  });

  it("keeps registry state isolated from callers mutating returned records", () => {
    const registry = new NotebookRegistry(() => "notebook-1");
    registry.upsertHeartbeat(heartbeat({ displayName: "alpha.nb", windowTitle: "alpha.nb" }));

    const fromGet = registry.get("notebook-1");
    if (!fromGet) throw new Error("expected record");
    fromGet.displayName = "corrupted";

    const fromList = registry.listLive()[0];
    if (!fromList) throw new Error("expected live record");
    fromList.windowTitle = "broken";

    const fromLookup = registry.findByDisplayName("alpha.nb");
    if (!fromLookup.ok) throw new Error("expected lookup");
    fromLookup.record.displayName = "mutated";

    expect(registry.get("notebook-1")?.displayName).toBe("alpha.nb");
    expect(registry.listLive()[0]?.windowTitle).toBe("alpha.nb");
  });

  it("does not retain mutations made to the original heartbeat permissions after upsert", () => {
    const registry = new NotebookRegistry(() => "notebook-1");
    const input = heartbeat();

    registry.upsertHeartbeat(input);
    input.permissions.SaveNotebook = false;

    expect(registry.get("notebook-1")?.permissions.SaveNotebook).toBe(true);
  });

  it("returns defensive copies of permissions from get, listLive, and findByDisplayName", () => {
    const registry = new NotebookRegistry(() => "notebook-1");
    registry.upsertHeartbeat(heartbeat({ displayName: "alpha.nb", windowTitle: "alpha.nb" }));

    const fromGet = registry.get("notebook-1");
    if (!fromGet) throw new Error("expected record");
    fromGet.permissions.DeleteCell = false;

    const fromList = registry.listLive()[0];
    if (!fromList) throw new Error("expected live record");
    fromList.permissions.RunCell = false;

    const fromLookup = registry.findByDisplayName("alpha.nb");
    if (!fromLookup.ok) throw new Error("expected lookup");
    fromLookup.record.permissions.ReadNotebook = false;

    expect(registry.get("notebook-1")?.permissions).toEqual(permissions);
  });

  it("merges a saved frontend notebook into the frontend record and closes the path-matched duplicate", () => {
    let nextId = 0;
    const registry = new NotebookRegistry(() => `notebook-${++nextId}`);
    const frontend = registry.upsertHeartbeat(
      heartbeat({ agentSessionId: "agent-1", frontendObjectKey: "fe-1", displayName: "未命名-2" }),
    );
    const pathMatched = registry.upsertHeartbeat(
      heartbeat({
        agentSessionId: "agent-2",
        frontendObjectKey: "fe-2",
        displayName: "foo.nb",
        windowTitle: "foo.nb",
        notebookPath: "C:/tmp/foo.nb",
        savedPath: "C:/tmp/foo.nb",
        seenAt: 2000,
      }),
    );

    const merged = registry.upsertHeartbeat(
      heartbeat({
        agentSessionId: "agent-1",
        frontendObjectKey: "fe-1",
        displayName: "foo.nb",
        windowTitle: "foo.nb",
        notebookPath: "C:/tmp/foo.nb",
        savedPath: "C:/tmp/foo.nb",
        seenAt: 3000,
      }),
    );

    expect(merged.notebookId).toBe(frontend.notebookId);
    expect(merged.notebookId).not.toBe(pathMatched.notebookId);
    expect(registry.listLive()).toHaveLength(1);
    expect(registry.get(pathMatched.notebookId)?.closed).toBe(true);
    expect(registry.get(frontend.notebookId)?.normalizedPath).toBe("c:\\tmp\\foo.nb");
  });

  it("falls back to notebookPath when savedPath is empty or whitespace", () => {
    let nextId = 0;
    const registry = new NotebookRegistry(() => `notebook-${++nextId}`);

    const record = registry.upsertHeartbeat(
      heartbeat({
        displayName: "foo.nb",
        windowTitle: "foo.nb",
        savedPath: "   ",
        notebookPath: "C:/tmp/foo.nb",
      }),
    );

    expect(record.normalizedPath).toBe("c:\\tmp\\foo.nb");
  });

  it("reuses the live merged record for later path-only heartbeats instead of resurrecting a closed duplicate", () => {
    let nextId = 0;
    const registry = new NotebookRegistry(() => `notebook-${++nextId}`);

    const pathFirst = registry.upsertHeartbeat(
      heartbeat({
        agentSessionId: "agent-1",
        frontendObjectKey: "fe-1",
        displayName: "foo.nb",
        windowTitle: "foo.nb",
        notebookPath: "C:/tmp/foo.nb",
        savedPath: "C:/tmp/foo.nb",
        seenAt: 1000,
      }),
    );
    const unsaved = registry.upsertHeartbeat(
      heartbeat({
        agentSessionId: "agent-1",
        frontendObjectKey: "fe-2",
        displayName: "未命名-2",
        windowTitle: "未命名-2",
        seenAt: 2000,
      }),
    );

    const merged = registry.upsertHeartbeat(
      heartbeat({
        agentSessionId: "agent-1",
        frontendObjectKey: "fe-2",
        displayName: "foo.nb",
        windowTitle: "foo.nb",
        notebookPath: "C:/tmp/foo.nb",
        savedPath: "C:/tmp/foo.nb",
        seenAt: 3000,
      }),
    );

    const pathOnly = registry.upsertHeartbeat(
      heartbeat({
        agentSessionId: "agent-2",
        frontendObjectKey: "fe-9",
        displayName: "foo.nb",
        windowTitle: "foo.nb",
        notebookPath: "C:/tmp/foo.nb",
        seenAt: 4000,
      }),
    );

    expect(merged.notebookId).toBe(unsaved.notebookId);
    expect(pathOnly.notebookId).toBe(unsaved.notebookId);
    expect(pathOnly.notebookId).not.toBe(pathFirst.notebookId);
    expect(registry.listLive()).toHaveLength(1);
    expect(registry.listLive()[0]?.notebookId).toBe(unsaved.notebookId);
    expect(registry.get(pathFirst.notebookId)?.closed).toBe(true);
  });

  it("ignores a closed frontend match and keeps the current live saved-path record", () => {
    let nextId = 0;
    const registry = new NotebookRegistry(() => `notebook-${++nextId}`);

    const first = registry.upsertHeartbeat(
      heartbeat({
        agentSessionId: "agent-1",
        frontendObjectKey: "fe-1",
        displayName: "untitled.nb",
        windowTitle: "untitled.nb",
        seenAt: 1000,
      }),
    );
    const second = registry.upsertHeartbeat(
      heartbeat({
        agentSessionId: "agent-2",
        frontendObjectKey: "fe-2",
        displayName: "foo.nb",
        windowTitle: "foo.nb",
        notebookPath: "C:/tmp/foo.nb",
        savedPath: "C:/tmp/foo.nb",
        seenAt: 2000,
      }),
    );

    const collided = registry.upsertHeartbeat(
      heartbeat({
        agentSessionId: "agent-1",
        frontendObjectKey: "fe-1",
        displayName: "foo.nb",
        windowTitle: "foo.nb",
        notebookPath: "C:/tmp/foo.nb",
        savedPath: "C:/tmp/foo.nb",
        seenAt: 3000,
      }),
    );

    const revived = registry.upsertHeartbeat(
      heartbeat({
        agentSessionId: "agent-2",
        frontendObjectKey: "fe-2",
        displayName: "foo.nb",
        windowTitle: "foo.nb",
        notebookPath: "C:/tmp/foo.nb",
        savedPath: "C:/tmp/foo.nb",
        seenAt: 4000,
      }),
    );

    expect(collided.notebookId).toBe(first.notebookId);
    expect(revived.notebookId).toBe(first.notebookId);
    expect(registry.get(first.notebookId)?.closed).toBe(false);
    expect(registry.get(second.notebookId)?.closed).toBe(true);
    expect(registry.listLive()).toHaveLength(1);
  });

  it("reuses a stale saved notebook by path and clears stale on heartbeat", () => {
    let nextId = 0;
    const registry = new NotebookRegistry(() => `notebook-${++nextId}`);

    const stale = registry.upsertHeartbeat(
      heartbeat({
        agentSessionId: "agent-1",
        frontendObjectKey: "fe-1",
        displayName: "foo.nb",
        windowTitle: "foo.nb",
        notebookPath: "C:/tmp/foo.nb",
        savedPath: "C:/tmp/foo.nb",
        seenAt: 1000,
      }),
    );
    registry.markStaleByAgent("agent-1", 2000);

    const revived = registry.upsertHeartbeat(
      heartbeat({
        agentSessionId: "agent-1",
        frontendObjectKey: "fe-2",
        displayName: "foo.nb",
        windowTitle: "foo.nb",
        notebookPath: "C:/tmp/foo.nb",
        savedPath: "C:/tmp/foo.nb",
        seenAt: 3000,
      }),
    );

    expect(revived.notebookId).toBe(stale.notebookId);
    expect(registry.get(stale.notebookId)?.stale).toBe(false);
    expect(registry.listLive()).toHaveLength(1);
  });

  it("does not deduplicate unsaved notebooks by display name", () => {
    let nextId = 0;
    const registry = new NotebookRegistry(() => `notebook-${++nextId}`);
    const first = registry.upsertHeartbeat(
      heartbeat({ agentSessionId: "agent-1", frontendObjectKey: "fe-1", displayName: "未命名-2" }),
    );
    const second = registry.upsertHeartbeat(
      heartbeat({ agentSessionId: "agent-1", frontendObjectKey: "fe-2", displayName: "未命名-2" }),
    );

    expect(registry.listLive()).toHaveLength(2);
    expect(registry.findByDisplayName("未命名-2")).toEqual({
      ok: false,
      error: "AMBIGUOUS_NOTEBOOK_NAME",
      candidates: [first, second],
    });
  });

  it("finds live notebooks by window title", () => {
    const registry = new NotebookRegistry(() => "notebook-1");
    const record = registry.upsertHeartbeat(
      heartbeat({ displayName: "foo.nb", windowTitle: "Project Foo - Wolfram" }),
    );

    expect(registry.findByDisplayName("Project Foo - Wolfram")).toEqual({
      ok: true,
      record,
    });
  });

  it("marks notebooks closed and hides them from live listings", () => {
    const registry = new NotebookRegistry(() => "notebook-1");
    const record = registry.upsertHeartbeat(heartbeat());

    registry.markClosed(record.notebookId, 4000);

    expect(registry.get(record.notebookId)?.closed).toBe(true);
    expect(registry.listLive()).toEqual([]);
    expect(registry.listAll()).toHaveLength(1);
  });

  it("hides stale notebooks by default", () => {
    const registry = new NotebookRegistry(() => "notebook-1");
    const record = registry.upsertHeartbeat(heartbeat());

    registry.markStaleByAgent("agent-1", 3000);

    expect(registry.get(record.notebookId)?.stale).toBe(true);
    expect(registry.listLive()).toEqual([]);
    expect(registry.listAll()).toHaveLength(1);
  });

  describe("Phase 8.1 degraded status", () => {
    it("markDegradedByAgent sets status to degraded and keeps notebook in listLive", () => {
      const registry = new NotebookRegistry(() => "notebook-1");
      const record = registry.upsertHeartbeat(heartbeat());

      registry.markDegradedByAgent("agent-1", 3000);

      const retrieved = registry.get(record.notebookId);
      expect(retrieved?.status).toBe("degraded");
      expect(retrieved?.degraded).toBe(true);
      expect(retrieved?.degradedAt).toBe(3000);
      expect(retrieved?.stale).toBe(false);
      expect(registry.listLive()).toHaveLength(1);
      expect(registry.listLive()[0]?.status).toBe("degraded");
    });

    it("markStaleByAgent sets status to offline and hides from listLive", () => {
      const registry = new NotebookRegistry(() => "notebook-1");
      const record = registry.upsertHeartbeat(heartbeat());

      registry.markStaleByAgent("agent-1", 3000);

      const retrieved = registry.get(record.notebookId);
      expect(retrieved?.status).toBe("offline");
      expect(retrieved?.stale).toBe(true);
      expect(registry.listLive()).toEqual([]);
      expect(registry.listAll()).toHaveLength(1);
    });

    it("closed notebooks have status closed and are hidden from listLive", () => {
      const registry = new NotebookRegistry(() => "notebook-1");
      const record = registry.upsertHeartbeat(heartbeat());

      registry.markClosed(record.notebookId, 4000);

      expect(registry.get(record.notebookId)?.status).toBe("closed");
      expect(registry.get(record.notebookId)?.closed).toBe(true);
      expect(registry.listLive()).toEqual([]);
    });

    it("upsertHeartbeat clears degraded status and restores live", () => {
      const registry = new NotebookRegistry(() => "notebook-1");
      const record = registry.upsertHeartbeat(heartbeat({ displayName: "foo.nb", windowTitle: "foo.nb" }));
      registry.markDegradedByAgent("agent-1", 3000);

      const revived = registry.upsertHeartbeat(
        heartbeat({ displayName: "foo.nb", windowTitle: "foo.nb", seenAt: 5000 }),
      );

      expect(revived.notebookId).toBe(record.notebookId);
      expect(registry.get(record.notebookId)?.status).toBe("live");
      expect(registry.get(record.notebookId)?.degraded).toBe(false);
      expect(registry.get(record.notebookId)?.degradedAt).toBeUndefined();
      expect(registry.listLive()).toHaveLength(1);
    });

    it("preserves lastSeenAt while recording degraded and offline transition times", () => {
      const registry = new NotebookRegistry(() => "notebook-1");
      const record = registry.upsertHeartbeat(heartbeat({ seenAt: 1000 }));

      registry.markDegradedByAgent("agent-1", 11_000);
      expect(registry.get(record.notebookId)).toMatchObject({
        lastSeenAt: 1000,
        degradedAt: 11_000,
      });

      registry.markStaleByAgent("agent-1", 31_000);
      expect(registry.get(record.notebookId)).toMatchObject({
        lastSeenAt: 1000,
        offlineAt: 31_000,
      });
    });

    it("does not update offline transition time for already stale notebooks", () => {
      const registry = new NotebookRegistry(() => "notebook-1");
      const record = registry.upsertHeartbeat(heartbeat({ seenAt: 1000 }));

      registry.markStaleByAgent("agent-1", 31_000);
      registry.markStaleByAgent("agent-1", 32_000);

      expect(registry.get(record.notebookId)).toMatchObject({
        stale: true,
        status: "offline",
        offlineAt: 31_000,
      });
    });
  });
});
