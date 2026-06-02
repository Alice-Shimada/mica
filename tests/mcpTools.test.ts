import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { BackendState } from "../src/backend/backendState.js";
import { RequestQueue } from "../src/bridge/requestQueue.js";
import { registerBackendMcpTools } from "../src/mcp/backendTools.js";
import { assertBridgeReadyForTool, registerMmaTools, resolveNotebookTarget } from "../src/mcp/tools.js";
import { startBunRuntime } from "../src/bun/index.js";
import type { BridgeStatus } from "../src/types.js";

const backendToolsSource = readFileSync(new URL("../src/mcp/backendTools.ts", import.meta.url), "utf8");
const schemasSource = readFileSync(new URL("../src/mcp/toolSchemas.ts", import.meta.url), "utf8");
const bunIndexSource = readFileSync(new URL("../src/bun/index.ts", import.meta.url), "utf8");

const runtimeConfig = {
  host: "127.0.0.1",
  preferredPort: 19791,
  sessionFile: "test-session.json",
  authToken: "test-token",
  bridgeOnly: false,
};

function disableSessionFileWrites() {
  return {
    runtimeConfig,
    writeSessionFile: vi.fn().mockResolvedValue({} as never),
  };
}

function makeBackendState() {
  const now = Date.now();
  const permissions = {
    ReadNotebook: true,
    InsertCell: true,
    ModifyCell: true,
    DeleteCell: true,
    RunCell: true,
    SaveNotebook: true
  };

  const state = new BackendState(() => "nb-1");
  state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: now });
  state.notebooks.upsertHeartbeat({
    agentSessionId: "agent-1",
    frontendObjectKey: "fe-1",
    displayName: "Untitled.nb",
    windowTitle: "Untitled.nb",
    wolframVersion: "13.3",
    platform: "Windows",
    permissions,
    seenAt: now
  });
  return state;
}

function status(overrides: Partial<BridgeStatus>): BridgeStatus {
  return {
    server: "running",
    paletteConnected: true,
    notebookAttached: true,
    notebooks: [],
    transportMode: "main-kernel",
    executorState: "idle",
    runningRequest: null,
    pendingRequests: 0,
    ...overrides
  };
}

type LegacyMmaToolRegistration = {
  name: string;
  description: string;
  handler: (args: Record<string, unknown>, extra?: { signal?: AbortSignal }) => Promise<unknown>;
};

function registerLegacyMmaTools(getStatus: () => BridgeStatus = () => status({})): LegacyMmaToolRegistration[] {
  const registrations: LegacyMmaToolRegistration[] = [];
  const server = {
    tool(
      name: string,
      description: string,
      _schema: unknown,
      handler: (args: Record<string, unknown>, extra?: { signal?: AbortSignal }) => Promise<unknown>
    ) {
      registrations.push({ name, description, handler });
    }
  };

  registerMmaTools(server as never, new RequestQueue(), getStatus);
  return registrations;
}

describe("MCP tool bridge readiness", () => {
  it("uses explicit notebookId before the active notebook", () => {
    expect(
      resolveNotebookTarget(
        { notebookId: "nb_explicit" },
        status({
          activeNotebookId: "nb_active",
          notebooks: [
            { notebookId: "nb_explicit", lastSeenAt: 1 },
            { notebookId: "nb_active", lastSeenAt: 1 }
          ]
        })
      )
    ).toBe("nb_explicit");
  });

  it("throws when explicit notebookId is unknown", () => {
    expect(() =>
      resolveNotebookTarget(
        { notebookId: "missing" },
        status({
          activeNotebookId: "nb_1",
          notebooks: [{ notebookId: "nb_1", lastSeenAt: 1 }]
        })
      )
    ).toThrow("Unknown notebookId");
  });

  it("falls back to the active notebook", () => {
    expect(resolveNotebookTarget({}, status({ activeNotebookId: "nb_active" }))).toBe("nb_active");
  });

  it("throws when no notebook target is selected", () => {
    expect(() => resolveNotebookTarget({}, status({ activeNotebookId: undefined }))).toThrow(
      "No Mathematica notebook is selected"
    );
  });

  it("registers the notebook list and notebook selection tools", () => {
    const names = registerLegacyMmaTools().map((registration) => registration.name);

    expect(names).toContain("mma_list_notebooks");
    expect(names).toContain("mma_select_notebook");
  });

  it("runs legacy abort evaluation without requiring MCP extra", async () => {
    const registrations: Array<{
      name: string;
      handler: (args: Record<string, unknown>, extra?: { signal?: AbortSignal }) => Promise<unknown>;
    }> = [];
    const server = {
      tool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: (args: Record<string, unknown>, extra?: { signal?: AbortSignal }) => Promise<unknown>
      ) {
        registrations.push({ name, handler });
      }
    };
    const queue = new RequestQueue();
    const getStatus = () =>
      status({
        activeNotebookId: "nb-1",
        notebooks: [{ notebookId: "nb-1", lastSeenAt: 1 }]
      });

    registerMmaTools(server as never, queue, getStatus);

    expect(registrations.map((entry) => entry.name)).toContain("mma_abort_evaluation");

    const abortHandler = registrations.find((entry) => entry.name === "mma_abort_evaluation")!.handler;
    const handlerPromise = abortHandler({ notebookId: "nb-1" });

    expect(queue.peekQueued()).toEqual([
      expect.objectContaining({ tool: "mma_abort_evaluation", notebookId: "nb-1", state: "queued" })
    ]);

    const claimed = queue.claimNext();
    expect(claimed).toEqual(expect.objectContaining({ tool: "mma_abort_evaluation", notebookId: "nb-1" }));
    expect(claimed).not.toBeNull();

    const requestId = claimed!.requestId;
    expect(queue.resolveSuccess(requestId, { ok: true })).toBe(true);

    await expect(handlerPromise).resolves.toMatchObject({
      structuredContent: expect.objectContaining({ ok: true })
    });
    expect(queue.pendingCount()).toBe(0);
  });

  it("registers all notebook operation tools", () => {
    expect(registerLegacyMmaTools().map((registration) => registration.name)).toEqual([
      "mma_status",
      "mma_list_notebooks",
      "mma_select_notebook",
      "mma_list_cells",
      "mma_read_cell",
      "mma_insert_cell",
      "mma_modify_cell",
      "mma_delete_cell",
      "mma_run_cell",
      "mma_abort_evaluation",
      "mma_get_cell_output",
      "mma_read_artifact",
      "mma_save_notebook",
      "mma_symbol_lookup"
    ]);
  });

  it("rejects displayName on the Node select path instead of falling back to active notebook", async () => {
    const selectNotebook = registerLegacyMmaTools(() =>
      status({
        activeNotebookId: "nb-active",
        notebooks: [{ notebookId: "nb-active", lastSeenAt: 1 }]
      })
    ).find((registration) => registration.name === "mma_select_notebook")!.handler;

    await expect(selectNotebook({ displayName: "Untitled.nb" })).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: expect.objectContaining({ code: "UNSUPPORTED_SELECTOR", tool: "mma_select_notebook" })
      }
    });
  });

  it("validates notebook selection ids against the registered notebook list", async () => {
    const selectNotebook = registerLegacyMmaTools(() =>
      status({
        activeNotebookId: "nb-active",
        notebooks: [{ notebookId: "nb-active", lastSeenAt: 1 }]
      })
    ).find((registration) => registration.name === "mma_select_notebook")!.handler;

    await expect(selectNotebook({ notebookId: "missing" })).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: expect.objectContaining({
          code: "NOTEBOOK_NOT_FOUND",
          message: "Unknown notebookId: missing",
          tool: "mma_select_notebook",
          notebookId: "missing"
        })
      }
    });
  });

  it("surfaces notebook workflow guidance in legacy Node MCP tool descriptions", () => {
    const registrations = registerLegacyMmaTools();

    const descriptions = registrations.map((registration) => registration.description).join("\n");
    const insertDescription = registrations.find((registration) => registration.name === "mma_insert_cell")?.description ?? "";

    expect(descriptions).toContain("Start by calling mma_status or mma_list_notebooks");
    expect(descriptions).toContain("Use the latest notebookId");
    expect(insertDescription).toContain('afterCellId="__end__"');
    expect(descriptions).toContain("Debug live notebooks only through MCP notebook cells");
    expect(descriptions).toContain("Do not use detached wolframscript");
    expect(descriptions).toContain("Restart your MCP client or the MICA MCP server");
  });

  it("fails immediately when the Palette is not connected", () => {
    expect(() => assertBridgeReadyForTool(status({ paletteConnected: false }))).toThrow(
      "Mathematica Palette is not connected"
    );
  });

  it("fails immediately when no notebook is attached", () => {
    expect(() => assertBridgeReadyForTool(status({ notebookAttached: false }))).toThrow(
      "No Mathematica notebook is attached"
    );
  });

  it("allows tool calls when Palette and notebook are ready", () => {
    expect(() => assertBridgeReadyForTool(status({}))).not.toThrow();
  });
});

describe("Bun backend MCP compatibility", () => {
  it("supports displayName selectors without removing notebookId selectors", () => {
    expect(schemasSource).toContain("displayName");
    expect(schemasSource).toContain("notebookId");
  });

  it("provides a Bun MCP entrypoint", () => {
    expect(bunIndexSource).toContain("registerBackendMcpTools");
    expect(bunIndexSource).toContain("McpServer");
    expect(bunIndexSource).toContain("StdioServerTransport");
    expect(bunIndexSource).toContain("BackendState");
    expect(bunIndexSource).toContain("createBunHttpApp");
  });

  it("registers backend MCP tools for status and notebook selection", () => {
    expect(backendToolsSource).toContain('"mma_status"');
    expect(backendToolsSource).toContain('"mma_list_notebooks"');
    expect(backendToolsSource).toContain('"mma_select_notebook"');
    expect(backendToolsSource).toContain("BackendState");
  });

  it("registers backend tools that return JSON text responses", async () => {
    const registrations: Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<unknown> }> = [];
    const server = {
      tool(name: string, _description: string, _schema: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) {
        registrations.push({ name, handler });
      }
    };

    const state = makeBackendState();
    registerBackendMcpTools(server as never, state);

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
      "mma_read_artifact",
      "mma_save_notebook"
    ]);

    await expect(registrations[0]!.handler({})).resolves.toMatchObject({
      structuredContent: expect.objectContaining({ ok: true, server: "running" }),
      content: [expect.objectContaining({ type: "text", text: expect.stringContaining('"server": "running"') })]
    });

    await expect(registrations[1]!.handler({})).resolves.toMatchObject({
      structuredContent: expect.objectContaining({ ok: true, notebooks: expect.any(Array) })
    });

    await expect(registrations[2]!.handler({ notebookId: "nb-1" })).resolves.toMatchObject({
      structuredContent: expect.objectContaining({ ok: true, activeNotebookId: "nb-1" })
    });
    expect(state.activeNotebookId).toBe("nb-1");
  });

  it("returns structured errors from backend tools instead of throwing plain exceptions", async () => {
    const registrations: Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<unknown> }> = [];
    const server = {
      tool(name: string, _description: string, _schema: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) {
        registrations.push({ name, handler });
      }
    };

    registerBackendMcpTools(server as never, new BackendState(() => "nb-1"));

    const listCells = registrations.find((entry) => entry.name === "mma_list_cells")!.handler;

    await expect(listCells({})).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: expect.objectContaining({
          code: "NO_LIVE_AGENT",
          tool: "mma_list_cells",
          retryable: true
        })
      },
      content: [expect.objectContaining({ type: "text", text: expect.stringContaining('"ok": false') })]
    });
  });

  it("returns structured errors from the legacy Node tool path", async () => {
    const registrations: Array<{
      name: string;
      handler: (args: Record<string, unknown>, extra?: { signal?: AbortSignal }) => Promise<unknown>;
    }> = [];
    const server = {
      tool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: (args: Record<string, unknown>, extra?: { signal?: AbortSignal }) => Promise<unknown>
      ) {
        registrations.push({ name, handler });
      }
    };

    registerMmaTools(server as never, new RequestQueue(), () => status({ paletteConnected: false }));

    const listCells = registrations.find((entry) => entry.name === "mma_list_cells")!.handler;

    await expect(listCells({})).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: expect.objectContaining({
          code: "PALETTE_NOT_CONNECTED",
          tool: "mma_list_cells",
          retryable: true
        })
      }
    });
  });

  it("registers mma_symbol_lookup with query parameter", async () => {
    const registrations: Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<unknown> }> = [];
    const server = {
      tool(name: string, _description: string, _schema: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) {
        registrations.push({ name, handler });
      }
    };

    const state = makeBackendState();
    state.activeNotebookId = "nb-1";
    registerBackendMcpTools(server as never, state);

    const lookupHandler = registrations.find((entry) => entry.name === "mma_symbol_lookup")!.handler;

    const handlerPromise = lookupHandler({ query: "Plot" });

    // Resolve the queued request so the handler promise can settle
    const queued = state.queue.snapshot().queued;
    expect(queued).toHaveLength(1);
    state.queue.resolve(queued[0]!.requestId, { ok: true }, Date.now());

    await expect(handlerPromise).resolves.toMatchObject({
      structuredContent: expect.objectContaining({ ok: true })
    });
  });

  it("stops the HTTP server when MCP startup fails", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const tool = vi.fn();
    const prompt = vi.fn();
    const connect = vi.fn().mockRejectedValue(new Error("stdio failed"));

    await expect(
      startBunRuntime({
        ...disableSessionFileWrites(),
        bridgeOnly: false,
        createHttpApp: async () => ({ port: 19791, stop }),
        createMcpServer: () => ({ tool, prompt, connect } as never)
      })
    ).rejects.toThrow("stdio failed");

    expect(stop).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith(
      "mica_notebook_workflow",
      expect.stringContaining("Mathematica notebook"),
      expect.any(Function)
    );
  });

  it("cleans up HTTP and signal handlers when MCP setup throws after HTTP starts", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const removeSignals = vi.fn();
    const installSignals = vi.fn().mockReturnValue(removeSignals);
    const tool = vi.fn();

    await expect(
      startBunRuntime({
        ...disableSessionFileWrites(),
        bridgeOnly: false,
        createHttpApp: async () => ({ port: 19791, stop }),
        createMcpServer: () => {
          throw new Error("server setup failed");
        },
        installSignalHandlers: installSignals
      })
    ).rejects.toThrow("server setup failed");

    expect(stop).toHaveBeenCalledTimes(1);
    expect(installSignals).toHaveBeenCalledTimes(1);
    expect(removeSignals).toHaveBeenCalledTimes(1);
  });

  it("makes stop idempotent", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const removeSignals = vi.fn();
    const installSignals = vi.fn().mockReturnValue(removeSignals);
    const tool = vi.fn();
    const prompt = vi.fn();
    const connect = vi.fn().mockResolvedValue(undefined);

    const runtime = await startBunRuntime({
      ...disableSessionFileWrites(),
      bridgeOnly: false,
      createHttpApp: async () => ({ port: 19791, stop }),
      createMcpServer: () => ({ tool, prompt, connect } as never),
      installSignalHandlers: installSignals
    });

    await runtime.stop();
    await runtime.stop();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(removeSignals).toHaveBeenCalledTimes(1);
  });

  it("removes signal handlers when stop is called after successful startup", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const removeSignals = vi.fn();
    const installSignals = vi.fn().mockReturnValue(removeSignals);
    const tool = vi.fn();
    const prompt = vi.fn();
    const connect = vi.fn().mockResolvedValue(undefined);

    const runtime = await startBunRuntime({
      ...disableSessionFileWrites(),
      bridgeOnly: false,
      createHttpApp: async () => ({ port: 19791, stop }),
      createMcpServer: () => ({ tool, prompt, connect } as never),
      installSignalHandlers: installSignals
    });

    await runtime.stop();

    expect(removeSignals).toHaveBeenCalledTimes(1);
    expect(installSignals).toHaveBeenCalledTimes(1);
  });

  it("keeps the HTTP server running after MCP setup succeeds", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const tool = vi.fn();
    const prompt = vi.fn();
    const connect = vi.fn().mockResolvedValue(undefined);

    const runtime = await startBunRuntime({
      ...disableSessionFileWrites(),
      bridgeOnly: false,
      createHttpApp: async () => ({ port: 19791, stop }),
      createMcpServer: () => ({ tool, prompt, connect } as never)
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(runtime.keepAlive).toBeInstanceOf(Promise);
    await runtime.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
