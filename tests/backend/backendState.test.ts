import { describe, expect, it } from "vitest";
import { BackendState } from "../../src/backend/backendState.js";

const permissions = {
  ReadNotebook: true,
  InsertCell: true,
  ModifyCell: true,
  DeleteCell: true,
  RunCell: true,
  SaveNotebook: true,
};

function heartbeat(overrides: Record<string, unknown> = {}) {
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
  } as const;
}

describe("BackendState", () => {
  it("resolves live notebooks by notebookId and displayName", () => {
    let nextNotebookId = 0;
    const state = new BackendState(() => `notebook-${++nextNotebookId}`);
    const record = state.notebooks.upsertHeartbeat(heartbeat());
    const resolved = state.resolveNotebook({ notebookId: record.notebookId });

    expect(resolved).toEqual({ ok: true, record });
    if (resolved.ok) resolved.record.displayName = "mutated";
    expect(state.resolveNotebook({ notebookId: record.notebookId })).toEqual({ ok: true, record });
    expect(state.resolveNotebook({ displayName: "未命名-2" })).toEqual({ ok: true, record });
  });

  it("reports notebook lifecycle resolution errors", () => {
    let nextNotebookId = 0;
    const state = new BackendState(() => `notebook-${++nextNotebookId}`);
    const live = state.notebooks.upsertHeartbeat(heartbeat({ agentSessionId: "agent-1", frontendObjectKey: "fe-1" }));
    const closed = state.notebooks.upsertHeartbeat(
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
    const stale = state.notebooks.upsertHeartbeat(
      heartbeat({
        agentSessionId: "agent-3",
        frontendObjectKey: "fe-3",
        displayName: "bar.nb",
        windowTitle: "bar.nb",
        notebookPath: "C:/tmp/bar.nb",
        savedPath: "C:/tmp/bar.nb",
        seenAt: 3000,
      }),
    );

    state.notebooks.markClosed(closed.notebookId, 4000);
    state.notebooks.markStaleByAgent("agent-3", 5000);

    expect(state.resolveNotebook({ notebookId: "missing" })).toEqual({ ok: false, error: "NOTEBOOK_NOT_FOUND" });
    expect(state.resolveNotebook({ notebookId: closed.notebookId })).toEqual({ ok: false, error: "NOTEBOOK_CLOSED" });
    expect(state.resolveNotebook({ notebookId: stale.notebookId })).toEqual({ ok: false, error: "NOTEBOOK_STALE" });
    expect(state.resolveNotebook({ notebookId: live.notebookId })).toEqual({ ok: true, record: live });
  });

  it("returns ambiguous display-name candidates when more than one live notebook matches", () => {
    let nextNotebookId = 0;
    const state = new BackendState(() => `notebook-${++nextNotebookId}`);
    const first = state.notebooks.upsertHeartbeat(
      heartbeat({ agentSessionId: "agent-1", frontendObjectKey: "fe-1", displayName: "未命名-2", windowTitle: "未命名-2" }),
    );
    const second = state.notebooks.upsertHeartbeat(
      heartbeat({ agentSessionId: "agent-2", frontendObjectKey: "fe-2", displayName: "未命名-2", windowTitle: "未命名-2" }),
    );

    expect(state.resolveNotebook({ displayName: "未命名-2" })).toEqual({
      ok: false,
      error: "AMBIGUOUS_NOTEBOOK_NAME",
      candidates: [first, second],
    });
  });

  it("falls back to the active notebook when no selector is given", () => {
    let nextNotebookId = 0;
    const state = new BackendState(() => `notebook-${++nextNotebookId}`);
    const record = state.notebooks.upsertHeartbeat(heartbeat());
    state.activeNotebookId = record.notebookId;

    expect(state.resolveNotebook({})).toEqual({ ok: true, record });
  });

  it("clears the active notebook when that notebook closes", () => {
    let nextNotebookId = 0;
    const state = new BackendState(() => `notebook-${++nextNotebookId}`);
    const record = state.notebooks.upsertHeartbeat(heartbeat());
    state.activeNotebookId = record.notebookId;

    state.closeNotebook(record.notebookId, 2000);

    expect(state.activeNotebookId).toBeUndefined();
    expect(state.resolveNotebook({})).toEqual({ ok: false, error: "NOTEBOOK_NOT_FOUND" });
  });

  it("does not fall back to the active notebook for explicit empty or whitespace selectors", () => {
    let nextNotebookId = 0;
    const state = new BackendState(() => `notebook-${++nextNotebookId}`);
    const active = state.notebooks.upsertHeartbeat(
      heartbeat({ agentSessionId: "agent-active", frontendObjectKey: "fe-active", displayName: "active.nb", windowTitle: "active.nb" }),
    );
    state.agents.register({ agentSessionId: "agent-active", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
    state.activeNotebookId = active.notebookId;

    expect(state.resolveNotebook({ notebookId: "" })).toEqual({ ok: false, error: "NOTEBOOK_NOT_FOUND" });
    expect(state.resolveNotebook({ notebookId: "   " })).toEqual({ ok: false, error: "NOTEBOOK_NOT_FOUND" });
    expect(state.resolveNotebook({ displayName: "" })).toEqual({ ok: false, error: "NOTEBOOK_NOT_FOUND" });
    expect(state.resolveNotebook({ displayName: "   " })).toEqual({ ok: false, error: "NOTEBOOK_NOT_FOUND" });
    expect(state.resolveNotebook({})).toEqual({ ok: true, record: active });
  });

  it("resolves missing, closed, and stale active notebook ids through the fallback path", () => {
    let nextNotebookId = 0;
    const state = new BackendState(() => `notebook-${++nextNotebookId}`);
    const live = state.notebooks.upsertHeartbeat(heartbeat({ agentSessionId: "agent-1", frontendObjectKey: "fe-1" }));
    const closed = state.notebooks.upsertHeartbeat(
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
    const stale = state.notebooks.upsertHeartbeat(
      heartbeat({
        agentSessionId: "agent-3",
        frontendObjectKey: "fe-3",
        displayName: "bar.nb",
        windowTitle: "bar.nb",
        notebookPath: "C:/tmp/bar.nb",
        savedPath: "C:/tmp/bar.nb",
        seenAt: 3000,
      }),
    );

    state.notebooks.markClosed(closed.notebookId, 4000);
    state.notebooks.markStaleByAgent("agent-3", 5000);

    state.activeNotebookId = "missing";
    expect(state.resolveNotebook({})).toEqual({ ok: false, error: "NOTEBOOK_NOT_FOUND" });

    state.activeNotebookId = closed.notebookId;
    expect(state.resolveNotebook({})).toEqual({ ok: false, error: "NOTEBOOK_CLOSED" });

    state.activeNotebookId = stale.notebookId;
    expect(state.resolveNotebook({})).toEqual({ ok: false, error: "NOTEBOOK_STALE" });

    state.activeNotebookId = live.notebookId;
    expect(state.resolveNotebook({})).toEqual({ ok: true, record: live });
  });

  it("requires a live agent before backend work can proceed", () => {
    const state = new BackendState(() => "notebook-1");

    expect(state.requireLiveAgent()).toEqual({ ok: false, error: "NO_LIVE_AGENT" });
    state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
    expect(state.requireLiveAgent()).toEqual({ ok: true });
  });

  it("keeps older live agent notebooks visible when a new agent registers", () => {
    let nextNotebookId = 0;
    const state = new BackendState(() => `notebook-${++nextNotebookId}`);

    state.agents.register({ agentSessionId: "agent-old", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
    const notebook = state.notebooks.upsertHeartbeat(heartbeat({ agentSessionId: "agent-old", frontendObjectKey: "fe-old", displayName: "old.nb", windowTitle: "old.nb" }));

    state.agents.register({ agentSessionId: "agent-new", wolframVersion: "13.3", platform: "Windows", seenAt: 2000 });

    expect(state.agents.get("agent-old")?.offline).toBe(false);
    expect(state.agents.get("agent-old")?.retired).toBe(false);
    expect(state.notebooks.get(notebook.notebookId)?.stale).toBe(false);
    expect(state.notebooks.listLive()).toEqual([notebook]);
  });

  it("re-registers one live agent without staling peer notebooks", () => {
    let nextNotebookId = 0;
    const state = new BackendState(() => `notebook-${++nextNotebookId}`);

    state.agents.register({ agentSessionId: "agent-old", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
    const oldNotebook = state.notebooks.upsertHeartbeat(heartbeat({ agentSessionId: "agent-old", frontendObjectKey: "fe-old", displayName: "old.nb", windowTitle: "old.nb" }));
    state.agents.register({ agentSessionId: "agent-new", wolframVersion: "13.3", platform: "Windows", seenAt: 2000 });
    const newNotebook = state.notebooks.upsertHeartbeat(heartbeat({ agentSessionId: "agent-new", frontendObjectKey: "fe-new", displayName: "new.nb", windowTitle: "new.nb", seenAt: 2000 }));

    state.agents.register({ agentSessionId: "agent-old", wolframVersion: "13.3", platform: "Windows", seenAt: 3000 });

    expect(state.agents.get("agent-old")?.offline).toBe(false);
    expect(state.agents.get("agent-old")?.lastSeenAt).toBe(3000);
    expect(state.agents.get("agent-new")?.offline).toBe(false);
    expect(state.notebooks.get(oldNotebook.notebookId)?.stale).toBe(false);
    expect(state.notebooks.get(newNotebook.notebookId)?.stale).toBe(false);
    expect(state.notebooks.listLive()).toEqual([oldNotebook, newNotebook]);
  });

  it("does not revive a retired agent via heartbeat", () => {
    let nextNotebookId = 0;
    const state = new BackendState(() => `notebook-${++nextNotebookId}`);

    state.agents.register({ agentSessionId: "agent-old", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
    const staleNotebook = state.notebooks.upsertHeartbeat(heartbeat({ agentSessionId: "agent-old", frontendObjectKey: "fe-old", displayName: "old.nb", windowTitle: "old.nb" }));
    state.agents.retire("agent-old", 2000, "no_live_notebooks");
    state.notebooks.markStaleByAgent("agent-old", 2000);

    expect(state.agents.heartbeat("agent-old", 3000)).toBeUndefined();
    expect(state.agents.get("agent-old")?.offline).toBe(true);
    expect(state.notebooks.get(staleNotebook.notebookId)?.stale).toBe(true);
    expect(state.notebooks.listLive()).toEqual([]);
  });

  it("does not retire an offline agent when a new agent registers", () => {
    let nextNotebookId = 0;
    const state = new BackendState(() => `notebook-${++nextNotebookId}`);

    state.agents.register({ agentSessionId: "agent-old", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
    state.agents.markOfflineOlderThan(5000, 1000);
    state.agents.register({ agentSessionId: "agent-new", wolframVersion: "13.3", platform: "Windows", seenAt: 6000 });

    expect(state.agents.get("agent-old")?.retired).toBe(false);
    expect(state.agents.get("agent-old")?.offline).toBe(true);
    expect(state.agents.heartbeat("agent-old", 7000)).toMatchObject({ agentSessionId: "agent-old", offline: false });
  });

  it("revives an offline but not retired agent on heartbeat and accepts notebook heartbeats after revival", () => {
    let nextNotebookId = 0;
    const state = new BackendState(() => `notebook-${++nextNotebookId}`);

    state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
    const notebook = state.notebooks.upsertHeartbeat(heartbeat({ agentSessionId: "agent-1", frontendObjectKey: "fe-1", displayName: "foo.nb", windowTitle: "foo.nb", notebookPath: "C:/tmp/foo.nb", savedPath: "C:/tmp/foo.nb" }));
    state.sweepLiveness(31_000);

    expect(state.agents.get("agent-1")?.offline).toBe(true);
    expect(state.agents.heartbeat("agent-1", 32_000)).toBeTruthy();

    const revivedNotebook = state.notebooks.upsertHeartbeat(heartbeat({
      agentSessionId: "agent-1",
      frontendObjectKey: "fe-2",
      displayName: "foo.nb",
      windowTitle: "foo.nb",
      notebookPath: "C:/tmp/foo.nb",
      savedPath: "C:/tmp/foo.nb",
      seenAt: 33_000,
    }));

    expect(revivedNotebook.notebookId).toBe(notebook.notebookId);
    expect(state.notebooks.get(notebook.notebookId)?.stale).toBe(false);
    expect(state.notebooks.listLive()).toHaveLength(1);
  });

  describe("per-client active notebook", () => {
    it("stores per-client active notebook via setActiveNotebook", () => {
      let nextNotebookId = 0;
      const state = new BackendState(() => `notebook-${++nextNotebookId}`);
      const record = state.notebooks.upsertHeartbeat(heartbeat());
      const clientSessionId = "mcp-client-abc";

      state.setActiveNotebook(record.notebookId, clientSessionId);

      expect(state.activeNotebookByClientSession.get(clientSessionId)).toBe(record.notebookId);
    });

    it("resolveNotebook prefers client-specific active notebook over global fallback", () => {
      let nextNotebookId = 0;
      const state = new BackendState(() => `notebook-${++nextNotebookId}`);
      const globalNotebook = state.notebooks.upsertHeartbeat(
        heartbeat({ agentSessionId: "agent-global", frontendObjectKey: "fe-global", displayName: "global.nb", windowTitle: "global.nb" }),
      );
      const clientNotebook = state.notebooks.upsertHeartbeat(
        heartbeat({ agentSessionId: "agent-client", frontendObjectKey: "fe-client", displayName: "client.nb", windowTitle: "client.nb" }),
      );
      const clientSessionId = "mcp-client-abc";

      state.activeNotebookId = globalNotebook.notebookId;
      state.setActiveNotebook(clientNotebook.notebookId, clientSessionId);

      expect(state.resolveNotebook({}, clientSessionId)).toEqual({ ok: true, record: clientNotebook });
      expect(state.resolveNotebook({})).toEqual({ ok: true, record: globalNotebook });
    });

    it("resolveNotebook falls back to global active notebook when client has no preference", () => {
      let nextNotebookId = 0;
      const state = new BackendState(() => `notebook-${++nextNotebookId}`);
      const record = state.notebooks.upsertHeartbeat(heartbeat());
      state.activeNotebookId = record.notebookId;

      expect(state.resolveNotebook({}, "mcp-client-xyz")).toEqual({ ok: true, record });
    });

    it("clears per-client active notebook when that notebook closes", () => {
      let nextNotebookId = 0;
      const state = new BackendState(() => `notebook-${++nextNotebookId}`);
      const record = state.notebooks.upsertHeartbeat(heartbeat());
      const clientSessionId = "mcp-client-abc";

      state.setActiveNotebook(record.notebookId, clientSessionId);
      state.closeNotebook(record.notebookId, 2000);

      expect(state.activeNotebookByClientSession.has(clientSessionId)).toBe(false);
      expect(state.resolveNotebook({}, clientSessionId)).toEqual({ ok: false, error: "NOTEBOOK_NOT_FOUND" });
    });

    it("clears per-client active notebook when that notebook goes stale", () => {
      let nextNotebookId = 0;
      const state = new BackendState(() => `notebook-${++nextNotebookId}`);
      const record = state.notebooks.upsertHeartbeat(
        heartbeat({ agentSessionId: "agent-1", frontendObjectKey: "fe-1", seenAt: 1000 }),
      );
      const clientSessionId = "mcp-client-abc";

      state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
      state.setActiveNotebook(record.notebookId, clientSessionId);
      state.sweepLiveness(31_000);

      expect(state.activeNotebookByClientSession.has(clientSessionId)).toBe(false);
      expect(state.resolveNotebook({}, clientSessionId)).toEqual({ ok: false, error: "NOTEBOOK_NOT_FOUND" });
    });

    it("setActiveNotebook without clientSessionId sets the global active notebook", () => {
      let nextNotebookId = 0;
      const state = new BackendState(() => `notebook-${++nextNotebookId}`);
      const record = state.notebooks.upsertHeartbeat(heartbeat());

      state.setActiveNotebook(record.notebookId);

      expect(state.activeNotebookId).toBe(record.notebookId);
    });

    it("explicit notebookId selector overrides per-client active notebook", () => {
      let nextNotebookId = 0;
      const state = new BackendState(() => `notebook-${++nextNotebookId}`);
      const clientNotebook = state.notebooks.upsertHeartbeat(
        heartbeat({ agentSessionId: "agent-client", frontendObjectKey: "fe-client", displayName: "client.nb", windowTitle: "client.nb" }),
      );
      const explicitNotebook = state.notebooks.upsertHeartbeat(
        heartbeat({ agentSessionId: "agent-explicit", frontendObjectKey: "fe-explicit", displayName: "explicit.nb", windowTitle: "explicit.nb" }),
      );
      const clientSessionId = "mcp-client-abc";

      state.setActiveNotebook(clientNotebook.notebookId, clientSessionId);

      expect(state.resolveNotebook({ notebookId: explicitNotebook.notebookId }, clientSessionId)).toEqual({
        ok: true,
        record: explicitNotebook,
      });
    });
  });

  it("ages out offline agents and stales their notebooks through a state sweep", () => {
    let nextNotebookId = 0;
    const state = new BackendState(() => `notebook-${++nextNotebookId}`);

    state.agents.register({ agentSessionId: "agent-old", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
    const notebook = state.notebooks.upsertHeartbeat(heartbeat({ agentSessionId: "agent-old", frontendObjectKey: "fe-old", displayName: "old.nb", windowTitle: "old.nb", seenAt: 1000 }));

    expect(state.sweepLiveness(1000 + 2999)).toEqual({ offlineAgents: [], staleNotebooks: [] });
    expect(state.agents.get("agent-old")?.offline).toBe(false);

    expect(state.sweepLiveness(1000 + 30_000)).toEqual({ offlineAgents: ["agent-old"], staleNotebooks: [notebook.notebookId] });
    expect(state.agents.get("agent-old")?.offline).toBe(true);
    expect(state.notebooks.get(notebook.notebookId)?.stale).toBe(true);
  });

  describe("Phase 8.1 degraded sweep", () => {
    it("keeps agents live at 3s gap and does not stale notebooks", () => {
      let nextNotebookId = 0;
      const state = new BackendState(() => `notebook-${++nextNotebookId}`);

      state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
      const notebook = state.notebooks.upsertHeartbeat(heartbeat({ agentSessionId: "agent-1", frontendObjectKey: "fe-1", seenAt: 1000 }));

      const result = state.sweepLiveness(4000);
      expect(result.offlineAgents).toEqual([]);
      expect(state.agents.get("agent-1")?.status).toBe("live");
      expect(state.agents.get("agent-1")?.offline).toBe(false);
      expect(state.notebooks.get(notebook.notebookId)?.status).toBe("live");
    });

    it("marks agents and notebooks degraded at 10s gap", () => {
      let nextNotebookId = 0;
      const state = new BackendState(() => `notebook-${++nextNotebookId}`);

      state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
      const notebook = state.notebooks.upsertHeartbeat(heartbeat({ agentSessionId: "agent-1", frontendObjectKey: "fe-1", seenAt: 1000 }));

      const result = state.sweepLiveness(11_000);
      expect(result.offlineAgents).toEqual([]);
      expect(state.agents.get("agent-1")?.status).toBe("degraded");
      expect(state.agents.get("agent-1")?.degraded).toBe(true);
      expect(state.agents.get("agent-1")?.offline).toBe(false);
      expect(state.notebooks.get(notebook.notebookId)?.status).toBe("degraded");
      expect(state.notebooks.get(notebook.notebookId)?.stale).toBe(false);
      expect(state.notebooks.listLive()).toHaveLength(1);
    });

    it("marks agents offline and notebooks stale at 30s gap", () => {
      let nextNotebookId = 0;
      const state = new BackendState(() => `notebook-${++nextNotebookId}`);

      state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
      const notebook = state.notebooks.upsertHeartbeat(heartbeat({ agentSessionId: "agent-1", frontendObjectKey: "fe-1", seenAt: 1000 }));

      const result = state.sweepLiveness(31_000);
      expect(result.offlineAgents).toEqual(["agent-1"]);
      expect(result.staleNotebooks).toEqual([notebook.notebookId]);
      expect(state.agents.get("agent-1")?.status).toBe("offline");
      expect(state.agents.get("agent-1")?.offline).toBe(true);
      expect(state.notebooks.get(notebook.notebookId)?.status).toBe("offline");
      expect(state.notebooks.get(notebook.notebookId)?.stale).toBe(true);
    });

    it("preserves active notebook during degraded state and clears it when offline", () => {
      let nextNotebookId = 0;
      const state = new BackendState(() => `notebook-${++nextNotebookId}`);

      state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
      const notebook = state.notebooks.upsertHeartbeat(heartbeat({ agentSessionId: "agent-1", frontendObjectKey: "fe-1", seenAt: 1000 }));
      state.activeNotebookId = notebook.notebookId;

      state.sweepLiveness(11_000);
      expect(state.activeNotebookId).toBe(notebook.notebookId);

      state.sweepLiveness(31_000);
      expect(state.activeNotebookId).toBeUndefined();
    });

    it("resolveNotebook succeeds for degraded notebooks and fails for offline notebooks", () => {
      let nextNotebookId = 0;
      const state = new BackendState(() => `notebook-${++nextNotebookId}`);

      state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
      const notebook = state.notebooks.upsertHeartbeat(heartbeat({ agentSessionId: "agent-1", frontendObjectKey: "fe-1", seenAt: 1000 }));

      state.sweepLiveness(11_000);
      expect(state.resolveNotebook({ notebookId: notebook.notebookId })).toEqual({ ok: true, record: expect.objectContaining({ status: "degraded" }) });

      state.sweepLiveness(31_000);
      expect(state.resolveNotebook({ notebookId: notebook.notebookId })).toEqual({ ok: false, error: "NOTEBOOK_STALE" });
    });

    it("requireLiveAgent returns ok for degraded agents", () => {
      const state = new BackendState(() => "notebook-1");
      state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
      state.agents.markDegradedOlderThan(11_000, 10_000);

      expect(state.requireLiveAgent()).toEqual({ ok: true });
    });
  });
});
