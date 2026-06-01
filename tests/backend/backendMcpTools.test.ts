import { describe, expect, it, vi } from "vitest";
import { BackendState } from "../../src/backend/backendState.js";
import { registerBackendMcpTools, resolveToolTarget } from "../../src/mcp/backendTools.js";

function makeState() {
  let nextNotebookId = 0;
  const state = new BackendState(() => `notebook-${++nextNotebookId}`);
  state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: Date.now() });
  return state;
}

function makeNotebook(state: BackendState, overrides: Record<string, unknown> = {}) {
  return state.notebooks.upsertHeartbeat({
    agentSessionId: "agent-1",
    frontendObjectKey: `fe-${Math.random()}`,
    displayName: "Untitled.nb",
    windowTitle: "Untitled.nb",
    wolframVersion: "13.3",
    platform: "Windows",
    permissions: {
      ReadNotebook: true,
      InsertCell: true,
      ModifyCell: true,
      DeleteCell: true,
      RunCell: true,
      SaveNotebook: true,
    },
    seenAt: Date.now(),
    ...overrides,
  });
}

type ToolRegistration = {
  name: string;
  description: string;
  handler: (args: Record<string, unknown>, extra?: { signal?: AbortSignal }) => Promise<unknown>;
};

function registerTools(state: BackendState) {
  const registrations: ToolRegistration[] = [];
  const server = {
    tool(name: string, description: string, _schema: unknown, handler: (args: Record<string, unknown>, extra?: { signal?: AbortSignal }) => Promise<unknown>) {
      registrations.push({ name, description, handler });
    },
  };

  registerBackendMcpTools(server as never, state);
  return registrations;
}

function registrationByName(registrations: ToolRegistration[], name: string) {
  const entry = registrations.find((registration) => registration.name === name);
  if (!entry) throw new Error(`missing registration: ${name}`);
  return entry;
}

describe("backend MCP tool resolution", () => {
  it("fails when no live agent is available", () => {
    const state = new BackendState(() => "notebook-1");

    expect(() => resolveToolTarget(state, {})).toThrow("NO_LIVE_AGENT");
  });

  it("uses the resolved notebook's own live agent session", () => {
    const state = new BackendState(() => "notebook-1");
    const now = Date.now();
    state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: now });
    state.agents.register({ agentSessionId: "agent-2", wolframVersion: "13.3", platform: "Windows", seenAt: now - 1_000 });
    const notebook = state.notebooks.upsertHeartbeat({
      agentSessionId: "agent-2",
      frontendObjectKey: "fe-2",
      displayName: "Shared.nb",
      windowTitle: "Shared.nb",
      wolframVersion: "13.3",
      platform: "Windows",
      permissions: {
        ReadNotebook: true,
        InsertCell: true,
        ModifyCell: true,
        DeleteCell: true,
        RunCell: true,
        SaveNotebook: true,
      },
      seenAt: now - 1_000,
    });

    expect(resolveToolTarget(state, { notebookId: notebook.notebookId })).toMatchObject({
      agentSessionId: "agent-2",
      notebook: expect.objectContaining({ notebookId: notebook.notebookId }),
    });
  });

  it("resolves a first agent's notebook after a second agent registers", () => {
    let nextNotebookId = 0;
    const state = new BackendState(() => `notebook-${++nextNotebookId}`);
    const now = Date.now();
    state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: now });
    const firstNotebook = makeNotebook(state, {
      agentSessionId: "agent-1",
      frontendObjectKey: "fe-1",
      displayName: "First.nb",
      windowTitle: "First.nb",
      seenAt: now,
    });
    state.agents.register({ agentSessionId: "agent-2", wolframVersion: "13.3", platform: "Windows", seenAt: now + 1 });
    makeNotebook(state, {
      agentSessionId: "agent-2",
      frontendObjectKey: "fe-2",
      displayName: "Second.nb",
      windowTitle: "Second.nb",
      seenAt: now + 1,
    });

    expect(resolveToolTarget(state, { notebookId: firstNotebook.notebookId })).toMatchObject({
      agentSessionId: "agent-1",
      notebook: expect.objectContaining({ notebookId: firstNotebook.notebookId }),
    });
  });

  it("fails when the resolved notebook's agent is offline even if another agent is live", () => {
    const state = new BackendState(() => "notebook-1");
    const now = Date.now();
    state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: now });
    state.agents.register({ agentSessionId: "agent-2", wolframVersion: "13.3", platform: "Windows", seenAt: now - 4_000 });
    const notebook = state.notebooks.upsertHeartbeat({
      agentSessionId: "agent-2",
      frontendObjectKey: "fe-2",
      displayName: "Shared.nb",
      windowTitle: "Shared.nb",
      wolframVersion: "13.3",
      platform: "Windows",
      permissions: {
        ReadNotebook: true,
        InsertCell: true,
        ModifyCell: true,
        DeleteCell: true,
        RunCell: true,
        SaveNotebook: true,
      },
      seenAt: now - 4_000,
    });

    state.agents.markOfflineOlderThan(now, 3_000);

    expect(() => resolveToolTarget(state, { notebookId: notebook.notebookId })).toThrow("NO_LIVE_AGENT");
  });

  it("resolves notebooks by display name", () => {
    const state = makeState();
    const record = makeNotebook(state, { displayName: "Shared.nb", windowTitle: "Shared.nb" });

    expect(resolveToolTarget(state, { displayName: "Shared.nb" })).toMatchObject({
      agentSessionId: "agent-1",
      notebook: expect.objectContaining({ notebookId: record.notebookId }),
    });
  });

  it("rejects ambiguous display names", () => {
    const state = makeState();
    makeNotebook(state, { agentSessionId: "agent-1", frontendObjectKey: "fe-1", displayName: "Shared.nb", windowTitle: "Shared.nb" });
    const now = Date.now();
    state.notebooks.upsertHeartbeat({
      agentSessionId: "agent-1",
      frontendObjectKey: "fe-2",
      displayName: "Shared.nb",
      windowTitle: "Shared.nb",
      wolframVersion: "13.3",
      platform: "Windows",
      permissions: {
        ReadNotebook: true,
        InsertCell: true,
        ModifyCell: true,
        DeleteCell: true,
        RunCell: true,
        SaveNotebook: true,
      },
      seenAt: now,
    });

    expect(() => resolveToolTarget(state, { displayName: "Shared.nb" })).toThrow("AMBIGUOUS_NOTEBOOK_NAME");
  });
});

describe("backend MCP tool registration", () => {
  it("registers every backend MCP tool", () => {
    const registrations = registerTools(makeState());

    expect(registrations.map((entry) => entry.name)).toEqual([
      "mma_status",
      "mma_list_notebooks",
      "mma_select_notebook",
      "mma_symbol_lookup",
      "mma_list_cells",
      "mma_read_cell",
      "mma_insert_cell",
      "mma_modify_cell",
      "mma_delete_cell",
      "mma_run_cell",
      "mma_abort_evaluation",
      "mma_get_cell_output",
      "mma_save_notebook",
    ]);
  });

  it("surfaces notebook workflow guidance in backend MCP tool descriptions", () => {
    const registrations = registerTools(makeState());
    const descriptions = registrations.map((registration) => registration.description).join("\n");

    expect(registrationByName(registrations, "mma_status").description).toContain("Start by calling mma_status or mma_list_notebooks");
    expect(registrationByName(registrations, "mma_insert_cell").description).toContain('afterCellId="__end__"');
    expect(descriptions).toContain("Use the latest notebookId");
    expect(descriptions).toContain("Debug live notebooks only through MCP notebook cells");
    expect(descriptions).toContain("Do not use detached wolframscript");
    expect(descriptions).toContain("Restart opencode or the mma MCP server");
  });

  it("returns immediate JSON text for status and notebook selection", async () => {
    const state = makeState();
    const notebook = makeNotebook(state, { displayName: "Shared.nb", windowTitle: "Shared.nb" });
    const registrations = registerTools(state);

    const status = await registrations[0]!.handler({});
    const list = await registrations[1]!.handler({});
    const select = await registrations[2]!.handler({ displayName: "Shared.nb" });

    expect(status).toMatchObject({
      structuredContent: expect.objectContaining({
        ok: true,
        server: "running",
        activeNotebookId: null,
      }),
      content: [expect.objectContaining({ type: "text", text: expect.stringContaining('"server": "running"') })],
    });
    expect(list).toMatchObject({
      structuredContent: expect.objectContaining({ ok: true, notebooks: expect.any(Array) }),
    });
    expect(select).toMatchObject({
      structuredContent: expect.objectContaining({ ok: true, activeNotebookId: notebook.notebookId }),
    });
    expect(state.activeNotebookId).toBe(notebook.notebookId);
  });

  it("sweeps stale notebooks before status and list results", async () => {
    vi.spyOn(Date, "now").mockReturnValue(4_000);
    try {
      const state = new BackendState(() => "notebook-1");
      state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 0 });
      const notebook = makeNotebook(state, { seenAt: 0 });
      state.activeNotebookId = notebook.notebookId;
      const registrations = registerTools(state);

      await expect(registrations[0]!.handler({})).resolves.toMatchObject({
        structuredContent: expect.objectContaining({ notebooks: [], activeNotebookId: null, agents: [] }),
      });
      await expect(registrations[1]!.handler({})).resolves.toMatchObject({
        structuredContent: expect.objectContaining({ notebooks: [], activeNotebookId: null }),
      });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("enqueues list, insert, and run notebook operations with the right metadata", async () => {
    const state = makeState();
    const notebook = makeNotebook(state, {
      displayName: "Shared.nb",
      windowTitle: "Shared.nb",
      permissions: {
        ReadNotebook: true,
        InsertCell: true,
        ModifyCell: true,
        DeleteCell: true,
        RunCell: true,
        SaveNotebook: true,
      },
    });
    state.activeNotebookId = notebook.notebookId;
    const registrations = registerTools(state);

    const listResult = registrationByName(registrations, "mma_list_cells").handler({});
    const symbolLookupResult = registrationByName(registrations, "mma_symbol_lookup").handler({ query: "Plot" });
    const readResult = registrationByName(registrations, "mma_read_cell").handler({ cellId: "cell-1" });
    const insertResult = registrationByName(registrations, "mma_insert_cell").handler({ content: "1+1", style: "Input" });
    const modifyResult = registrationByName(registrations, "mma_modify_cell").handler({ cellId: "cell-1", content: "2+2" });
    const deleteResult = registrationByName(registrations, "mma_delete_cell").handler({ cellId: "cell-1" });
    const runResult = registrationByName(registrations, "mma_run_cell").handler({ cellId: "cell-1", timeoutSec: 7 });
    const abortResult = registrationByName(registrations, "mma_abort_evaluation").handler({});
    const outputResult = registrationByName(registrations, "mma_get_cell_output").handler({ cellId: "cell-1" });
    const saveResult = registrationByName(registrations, "mma_save_notebook").handler({});

    const queued = state.queue.snapshot().queued;
    expect(queued).toHaveLength(10);
    expect(queued[0]).toMatchObject({
      tool: "mma_list_cells",
      targetNotebookId: notebook.notebookId,
      agentSessionId: "agent-1",
      timeoutMs: 10_000,
      status: "queued",
    });
    expect(queued[1]).toMatchObject({
      tool: "mma_symbol_lookup",
      targetNotebookId: notebook.notebookId,
      agentSessionId: "agent-1",
      timeoutMs: 30_000,
      arguments: expect.objectContaining({ query: "Plot" }),
    });
    expect(queued[2]).toMatchObject({
      tool: "mma_read_cell",
      targetNotebookId: notebook.notebookId,
      agentSessionId: "agent-1",
      timeoutMs: 10_000,
      arguments: expect.objectContaining({ cellId: "cell-1" }),
    });
    expect(queued[3]).toMatchObject({
      tool: "mma_insert_cell",
      targetNotebookId: notebook.notebookId,
      agentSessionId: "agent-1",
      timeoutMs: 60_000,
      arguments: expect.objectContaining({ content: "1+1", style: "Input" }),
    });
    expect(queued[4]).toMatchObject({
      tool: "mma_modify_cell",
      targetNotebookId: notebook.notebookId,
      agentSessionId: "agent-1",
      timeoutMs: 10_000,
      arguments: expect.objectContaining({ cellId: "cell-1", content: "2+2" }),
    });
    expect(queued[5]).toMatchObject({
      tool: "mma_delete_cell",
      targetNotebookId: notebook.notebookId,
      agentSessionId: "agent-1",
      timeoutMs: 10_000,
      arguments: expect.objectContaining({ cellId: "cell-1" }),
    });
    expect(queued[6]).toMatchObject({
      tool: "mma_run_cell",
      targetNotebookId: notebook.notebookId,
      agentSessionId: "agent-1",
      timeoutMs: 7_000,
      arguments: expect.objectContaining({ cellId: "cell-1", timeoutSec: 7 }),
    });
    expect(queued[7]).toMatchObject({
      tool: "mma_abort_evaluation",
      targetNotebookId: notebook.notebookId,
      agentSessionId: "agent-1",
      timeoutMs: 10_000,
      arguments: expect.objectContaining({}),
    });
    expect(queued[8]).toMatchObject({
      tool: "mma_get_cell_output",
      targetNotebookId: notebook.notebookId,
      agentSessionId: "agent-1",
      timeoutMs: 10_000,
      arguments: expect.objectContaining({ cellId: "cell-1" }),
    });
    expect(queued[9]).toMatchObject({
      tool: "mma_save_notebook",
      targetNotebookId: notebook.notebookId,
      agentSessionId: "agent-1",
      timeoutMs: 10_000,
      arguments: expect.objectContaining({}),
    });

    const resultByTool = new Map(queued.map((request) => [request.tool, request.requestId]));
    for (const request of queued) {
      state.queue.resolve(request.requestId, { tool: request.tool, requestId: request.requestId }, request.createdAt + 1);
    }

    await expect(listResult).resolves.toMatchObject({
      structuredContent: expect.objectContaining({ tool: "mma_list_cells" }),
    });
    await expect(symbolLookupResult).resolves.toMatchObject({
      structuredContent: expect.objectContaining({ tool: "mma_symbol_lookup" }),
    });
    await expect(readResult).resolves.toMatchObject({
      structuredContent: expect.objectContaining({ tool: "mma_read_cell" }),
    });
    await expect(insertResult).resolves.toMatchObject({
      structuredContent: expect.objectContaining({ tool: "mma_insert_cell" }),
    });
    await expect(modifyResult).resolves.toMatchObject({
      structuredContent: expect.objectContaining({ tool: "mma_modify_cell" }),
    });
    await expect(deleteResult).resolves.toMatchObject({
      structuredContent: expect.objectContaining({ tool: "mma_delete_cell" }),
    });
    await expect(runResult).resolves.toMatchObject({
      structuredContent: expect.objectContaining({ tool: "mma_run_cell" }),
    });
    await expect(abortResult).resolves.toMatchObject({
      structuredContent: expect.objectContaining({ tool: "mma_abort_evaluation" }),
    });
    await expect(outputResult).resolves.toMatchObject({
      structuredContent: expect.objectContaining({ tool: "mma_get_cell_output" }),
    });
    await expect(saveResult).resolves.toMatchObject({
      structuredContent: expect.objectContaining({ tool: "mma_save_notebook" }),
    });

    expect(resultByTool.size).toBe(10);
  });

  it("awaits hidden-agent results and returns the result object directly", async () => {
    const state = makeState();
    const notebook = makeNotebook(state, { displayName: "Shared.nb", windowTitle: "Shared.nb" });
    state.activeNotebookId = notebook.notebookId;
    const handler = registrationByName(registerTools(state), "mma_list_cells").handler;

    const pending = handler({});
    const requestId = state.queue.snapshot().queued[0]?.requestId;
    if (!requestId) throw new Error("expected queued request");

    state.queue.resolve(requestId, { cells: [{ id: "c1" }] }, 1_500);

    await expect(pending).resolves.toMatchObject({
      structuredContent: { ok: true, cells: [{ id: "c1" }] },
      content: [{ type: "text", text: expect.stringContaining('"cells"') }],
    });
  });

  it("wraps primitive hidden-agent results in a result object", async () => {
    const state = makeState();
    const notebook = makeNotebook(state, { displayName: "Shared.nb", windowTitle: "Shared.nb" });
    state.activeNotebookId = notebook.notebookId;
    const handler = registrationByName(registerTools(state), "mma_list_cells").handler;

    const pending = handler({});
    const requestId = state.queue.snapshot().queued[0]?.requestId;
    if (!requestId) throw new Error("expected queued request");

    state.queue.resolve(requestId, "ok", 1_500);

    await expect(pending).resolves.toMatchObject({
      structuredContent: { ok: true, result: "ok" },
      content: [{ type: "text", text: expect.stringContaining('"result": "ok"') }],
    });
  });

  it("rejects MCP notebook operations after timeout and marks the queued request timed out", async () => {
    vi.useFakeTimers();
    try {
      const state = makeState();
      const notebook = makeNotebook(state, { displayName: "Shared.nb", windowTitle: "Shared.nb" });
      state.activeNotebookId = notebook.notebookId;
      const handler = registrationByName(registerTools(state), "mma_list_cells").handler;

      const pending = handler({});
      const rejected = expect(pending).resolves.toMatchObject({
        isError: true,
        structuredContent: {
          ok: false,
          error: expect.objectContaining({
            code: "REQUEST_TIMED_OUT",
            retryable: true,
            tool: "mma_list_cells",
          }),
        },
      });
      await vi.runOnlyPendingTimersAsync();

      await rejected;
      expect(state.queue.snapshot().timed_out).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps insert operations pending past the generic mutation timeout and rejects at the insert timeout", async () => {
    vi.useFakeTimers();
    try {
      const state = makeState();
      const notebook = makeNotebook(state, { displayName: "Shared.nb", windowTitle: "Shared.nb" });
      state.activeNotebookId = notebook.notebookId;
      const handler = registrationByName(registerTools(state), "mma_insert_cell").handler;
      let settled = false;

      const pending = handler({ content: "中文".repeat(256), style: "Text" });
      pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );

      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();

      expect(settled).toBe(false);
      expect(state.queue.snapshot().timed_out).toHaveLength(0);

      const rejected = expect(pending).resolves.toMatchObject({
        isError: true,
        structuredContent: {
          ok: false,
          error: expect.objectContaining({
            code: "REQUEST_TIMED_OUT",
            tool: "mma_insert_cell",
          }),
        },
      });
      await vi.advanceTimersByTimeAsync(50_000);

      await rejected;
      expect(state.queue.snapshot().timed_out).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels notebook operations when the MCP client aborts", async () => {
    const state = makeState();
    const notebook = makeNotebook(state, { displayName: "Shared.nb", windowTitle: "Shared.nb" });
    state.activeNotebookId = notebook.notebookId;
    const handler = registrationByName(registerTools(state), "mma_list_cells").handler;
    const controller = new AbortController();

    const pending = handler({}, { signal: controller.signal });
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: expect.objectContaining({
          code: "REQUEST_CANCELLED",
          message: "MCP client cancelled operation",
          tool: "mma_list_cells",
        }),
      },
    });
    expect(state.queue.snapshot().cancelled).toHaveLength(1);
    expect(state.queue.cancellationsForAgent("agent-1")).toEqual([{ requestId: expect.any(String), reason: "MCP client cancelled operation" }]);
  });

  it("cancels notebook operations immediately when the signal is already aborted", async () => {
    const state = makeState();
    const notebook = makeNotebook(state, { displayName: "Shared.nb", windowTitle: "Shared.nb" });
    state.activeNotebookId = notebook.notebookId;
    const handler = registrationByName(registerTools(state), "mma_list_cells").handler;
    const controller = new AbortController();
    controller.abort();

    await expect(handler({}, { signal: controller.signal })).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: expect.objectContaining({
          code: "REQUEST_CANCELLED",
          tool: "mma_list_cells",
        }),
      },
    });
    expect(state.queue.snapshot().cancelled).toHaveLength(1);
  });

  it("does not enqueue when notebook permissions deny the tool", async () => {
    const deniedCases = [
      { tool: "mma_list_cells", args: {}, permission: "ReadNotebook" as const },
      { tool: "mma_symbol_lookup", args: { query: "Plot" }, permission: "ReadNotebook" as const },
      { tool: "mma_read_cell", args: { cellId: "cell-1" }, permission: "ReadNotebook" as const },
      { tool: "mma_insert_cell", args: { content: "1+1" }, permission: "InsertCell" as const },
      { tool: "mma_modify_cell", args: { cellId: "cell-1", content: "2+2" }, permission: "ModifyCell" as const },
      { tool: "mma_delete_cell", args: { cellId: "cell-1" }, permission: "DeleteCell" as const },
      { tool: "mma_run_cell", args: { cellId: "cell-1" }, permission: "RunCell" as const },
      { tool: "mma_abort_evaluation", args: {}, permission: "RunCell" as const },
      { tool: "mma_save_notebook", args: {}, permission: "SaveNotebook" as const },
    ];

    for (const denied of deniedCases) {
      const state = makeState();
      const notebook = makeNotebook(state, {
        permissions: {
          ReadNotebook: denied.permission !== "ReadNotebook",
          InsertCell: denied.permission !== "InsertCell",
          ModifyCell: denied.permission !== "ModifyCell",
          DeleteCell: denied.permission !== "DeleteCell",
          RunCell: denied.permission !== "RunCell",
          SaveNotebook: denied.permission !== "SaveNotebook",
        },
      });
      state.activeNotebookId = notebook.notebookId;
      const handler = registrationByName(registerTools(state), denied.tool).handler;

      await expect(handler(denied.args)).resolves.toMatchObject({
        isError: true,
        structuredContent: {
          ok: false,
          error: expect.objectContaining({
            code: "PERMISSION_DENIED",
            tool: denied.tool,
            retryable: false,
          }),
        },
      });
      expect(state.queue.snapshot().queued).toHaveLength(0);
    }
  });

  it("routes queued work to the notebook's agent session id", async () => {
    const state = new BackendState(() => "notebook-1");
    const now = Date.now();
    state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: now });
    state.agents.register({ agentSessionId: "agent-2", wolframVersion: "13.3", platform: "Windows", seenAt: now });
    const notebook = state.notebooks.upsertHeartbeat({
      agentSessionId: "agent-2",
      frontendObjectKey: "fe-2",
      displayName: "Shared.nb",
      windowTitle: "Shared.nb",
      wolframVersion: "13.3",
      platform: "Windows",
      permissions: {
        ReadNotebook: true,
        InsertCell: true,
        ModifyCell: true,
        DeleteCell: true,
        RunCell: true,
        SaveNotebook: true,
      },
      seenAt: now,
    });
    state.activeNotebookId = notebook.notebookId;

    const pending = registrationByName(registerTools(state), "mma_list_cells").handler({});
    const queued = state.queue.snapshot().queued[0];
    if (!queued) throw new Error("expected queued request");
    const requestId = queued.requestId;
    state.queue.resolve(requestId, { ok: true }, now);
    await pending;

    expect(queued).toMatchObject({ agentSessionId: "agent-2", targetNotebookId: notebook.notebookId });
  });

  it("does not enqueue when the target notebook agent is offline", async () => {
    const state = new BackendState(() => "notebook-1");
    const now = Date.now();
    state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: now });
    state.agents.register({ agentSessionId: "agent-2", wolframVersion: "13.3", platform: "Windows", seenAt: now - 4_000 });
    const notebook = state.notebooks.upsertHeartbeat({
      agentSessionId: "agent-2",
      frontendObjectKey: "fe-2",
      displayName: "Shared.nb",
      windowTitle: "Shared.nb",
      wolframVersion: "13.3",
      platform: "Windows",
      permissions: {
        ReadNotebook: true,
        InsertCell: true,
        ModifyCell: true,
        DeleteCell: true,
        RunCell: true,
        SaveNotebook: true,
      },
      seenAt: now - 4_000,
    });
    state.agents.markOfflineOlderThan(now, 3_000);
    state.activeNotebookId = notebook.notebookId;

    await expect(registrationByName(registerTools(state), "mma_list_cells").handler({})).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: expect.objectContaining({
          code: "NO_LIVE_AGENT",
          tool: "mma_list_cells",
          retryable: true,
        }),
      },
    });
    expect(state.queue.snapshot().queued).toHaveLength(0);
  });

  describe("MICA_STRICT_TARGETING", () => {
    const MUTATING_TOOLS = [
      "mma_insert_cell",
      "mma_modify_cell",
      "mma_delete_cell",
      "mma_run_cell",
      "mma_abort_evaluation",
      "mma_save_notebook",
    ] as const;

    const READ_ONLY_TOOLS = [
      "mma_list_cells",
      "mma_read_cell",
      "mma_get_cell_output",
      "mma_symbol_lookup",
    ] as const;

    function enableStrictTargeting() {
      process.env.MICA_STRICT_TARGETING = "1";
    }

    function disableStrictTargeting() {
      delete process.env.MICA_STRICT_TARGETING;
    }

    it("rejects each mutating tool with no selector in strict mode, no queue entry", async () => {
      enableStrictTargeting();
      try {
        for (const tool of MUTATING_TOOLS) {
          const state = makeState();
          const notebook = makeNotebook(state);
          state.activeNotebookId = notebook.notebookId;
          const handler = registrationByName(registerTools(state), tool).handler;

          const args: Record<string, unknown> = tool === "mma_insert_cell" || tool === "mma_modify_cell"
            ? { content: "1+1" }
            : tool === "mma_run_cell" || tool === "mma_delete_cell"
              ? { cellId: "cell-1" }
              : {};

          await expect(handler(args)).resolves.toMatchObject({
            isError: true,
            structuredContent: {
              ok: false,
              error: expect.objectContaining({
                code: "EXPLICIT_NOTEBOOK_REQUIRED",
                tool,
                retryable: false,
              }),
            },
          });
          expect(state.queue.snapshot().queued).toHaveLength(0);
        }
      } finally {
        disableStrictTargeting();
      }
    });

    it("allows mutating tool in strict mode when notebookId is provided and queues normally", async () => {
      enableStrictTargeting();
      try {
        for (const tool of MUTATING_TOOLS) {
          const state = makeState();
          const notebook = makeNotebook(state);
          const handler = registrationByName(registerTools(state), tool).handler;

          const args: Record<string, unknown> = { notebookId: notebook.notebookId };
          if (tool === "mma_insert_cell" || tool === "mma_modify_cell") {
            args.content = "1+1";
          }
          if (tool === "mma_run_cell" || tool === "mma_delete_cell" || tool === "mma_modify_cell") {
            args.cellId = "cell-1";
          }

          const pending = handler(args);
          expect(state.queue.snapshot().queued).toHaveLength(1);
          expect(state.queue.snapshot().queued[0]).toMatchObject({
            tool,
            targetNotebookId: notebook.notebookId,
          });

          const requestId = state.queue.snapshot().queued[0]!.requestId;
          state.queue.resolve(requestId, { tool }, Date.now() + 1);
          await expect(pending).resolves.toMatchObject({
            structuredContent: expect.objectContaining({ ok: true }),
          });
        }
      } finally {
        disableStrictTargeting();
      }
    });

    it("allows mutating tool in strict mode when displayName is provided", async () => {
      enableStrictTargeting();
      try {
        const state = makeState();
        const notebook = makeNotebook(state, { displayName: "Target.nb", windowTitle: "Target.nb" });
        const handler = registrationByName(registerTools(state), "mma_run_cell").handler;

        const pending = handler({ displayName: "Target.nb", cellId: "cell-1" });
        expect(state.queue.snapshot().queued).toHaveLength(1);
        expect(state.queue.snapshot().queued[0]).toMatchObject({
          tool: "mma_run_cell",
          targetNotebookId: notebook.notebookId,
        });

        const requestId = state.queue.snapshot().queued[0]!.requestId;
        state.queue.resolve(requestId, { tool: "mma_run_cell" }, Date.now() + 1);
        await expect(pending).resolves.toMatchObject({
          structuredContent: expect.objectContaining({ ok: true }),
        });
      } finally {
        disableStrictTargeting();
      }
    });

    it("allows read-only tools to use active notebook without selector in strict mode", async () => {
      enableStrictTargeting();
      try {
        for (const tool of READ_ONLY_TOOLS) {
          const state = makeState();
          const notebook = makeNotebook(state);
          state.activeNotebookId = notebook.notebookId;
          const handler = registrationByName(registerTools(state), tool).handler;

          const args: Record<string, unknown> = {};
          if (tool === "mma_read_cell" || tool === "mma_get_cell_output") {
            args.cellId = "cell-1";
          }
          if (tool === "mma_symbol_lookup") {
            args.query = "Plot";
          }

          const pending = handler(args);
          expect(state.queue.snapshot().queued).toHaveLength(1);
          expect(state.queue.snapshot().queued[0]).toMatchObject({
            tool,
            targetNotebookId: notebook.notebookId,
          });

          const requestId = state.queue.snapshot().queued[0]!.requestId;
          state.queue.resolve(requestId, { tool }, Date.now() + 1);
          await expect(pending).resolves.toMatchObject({
            structuredContent: expect.objectContaining({ ok: true }),
          });
        }
      } finally {
        disableStrictTargeting();
      }
    });

    it("allows mutating tools to use active notebook without selector in default mode", async () => {
      disableStrictTargeting();
      for (const tool of MUTATING_TOOLS) {
        const state = makeState();
        const notebook = makeNotebook(state);
        state.activeNotebookId = notebook.notebookId;
        const handler = registrationByName(registerTools(state), tool).handler;

        const args: Record<string, unknown> = {};
        if (tool === "mma_insert_cell" || tool === "mma_modify_cell") {
          args.content = "1+1";
        }
        if (tool === "mma_run_cell" || tool === "mma_delete_cell" || tool === "mma_modify_cell") {
          args.cellId = "cell-1";
        }

        const pending = handler(args);
        expect(state.queue.snapshot().queued).toHaveLength(1);
        expect(state.queue.snapshot().queued[0]).toMatchObject({
          tool,
          targetNotebookId: notebook.notebookId,
        });

        const requestId = state.queue.snapshot().queued[0]!.requestId;
        state.queue.resolve(requestId, { tool }, Date.now() + 1);
        await expect(pending).resolves.toMatchObject({
          structuredContent: expect.objectContaining({ ok: true }),
        });
      }
    });
  });

  it("sweeps stale notebooks before enqueuing notebook operations", async () => {
    vi.useFakeTimers();
    vi.spyOn(Date, "now").mockReturnValue(4_000);
    try {
      const state = new BackendState(() => "notebook-1");
      state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 4_000 });
      state.agents.register({ agentSessionId: "agent-2", wolframVersion: "13.3", platform: "Windows", seenAt: 0 });
      const notebook = state.notebooks.upsertHeartbeat({
        agentSessionId: "agent-2",
        frontendObjectKey: "fe-2",
        displayName: "Shared.nb",
        windowTitle: "Shared.nb",
        wolframVersion: "13.3",
        platform: "Windows",
        permissions: {
          ReadNotebook: true,
          InsertCell: true,
          ModifyCell: true,
          DeleteCell: true,
          RunCell: true,
          SaveNotebook: true,
        },
        seenAt: 0,
      });
      state.activeNotebookId = notebook.notebookId;

      const pending = registrationByName(registerTools(state), "mma_list_cells").handler({ notebookId: notebook.notebookId });
      expect(state.queue.snapshot().queued).toHaveLength(0);
      await expect(pending).resolves.toMatchObject({
        isError: true,
        structuredContent: {
          ok: false,
          error: expect.objectContaining({
            code: expect.stringMatching(/NO_LIVE_AGENT|NOTEBOOK_STALE/),
            tool: "mma_list_cells",
          }),
        },
      });
      expect(state.queue.snapshot().queued).toHaveLength(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});
