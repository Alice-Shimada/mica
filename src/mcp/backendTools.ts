import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BackendState } from "../backend/backendState.js";
import { DEFAULT_TIMEOUTS_MS, type NotebookRecord } from "../backend/protocol.js";
import {
  abortEvaluationSchema,
  deleteCellSchema,
  getCellOutputSchema,
  insertCellSchema,
  listCellsSchema,
  modifyCellSchema,
  noArgsSchema,
  readArtifactSchema,
  readCellSchema,
  runCellSchema,
  selectNotebookSchema,
  saveNotebookSchema,
  symbolLookupSchema,
} from "./toolSchemas.js";
import { INSERT_ANCHOR_GUIDANCE, notebookToolDescription } from "./descriptions.js";
import { toolFailure, toolSuccess, withToolErrors, type StructuredToolResult } from "./toolResults.js";

type ToolHandlerExtra = {
  signal?: AbortSignal;
  sessionId?: string;
};

export type BackendToolTarget = {
  agentSessionId: string;
  notebook: NotebookRecord;
};

function assertLiveAgent(state: BackendState): void {
  if (!state.requireLiveAgent().ok) {
    throw new Error("NO_LIVE_AGENT");
  }
}

function sweepStateLiveness(state: BackendState): void {
  state.sweepLiveness(Date.now());
}

function liveActiveNotebookId(state: BackendState, clientSessionId?: string): string | null {
  const resolution = state.resolveNotebook({}, clientSessionId);
  return resolution.ok ? resolution.record.notebookId : null;
}

function liveAgents(state: BackendState) {
  return state.agents.list().filter((agent) => !agent.offline && !agent.retired);
}

function resolveNotebookTarget(state: BackendState, args: { notebookId?: string; displayName?: string }, clientSessionId?: string): NotebookRecord {
  const resolution = state.resolveNotebook(args, clientSessionId);
  if (!resolution.ok) {
    throw new Error(resolution.error);
  }

  return resolution.record;
}

export function resolveToolTarget(state: BackendState, args: Record<string, unknown>, extra?: { sessionId?: string }): BackendToolTarget {
  sweepStateLiveness(state);
  assertLiveAgent(state);
  const notebook = resolveNotebookTarget(state, {
    notebookId: typeof args.notebookId === "string" ? args.notebookId : undefined,
    displayName: typeof args.displayName === "string" ? args.displayName : undefined,
  }, extra?.sessionId);

  const notebookAgent = state.agents.get(notebook.agentSessionId);
  if (!notebookAgent || notebookAgent.offline) {
    throw new Error("NO_LIVE_AGENT");
  }

  return { agentSessionId: notebook.agentSessionId, notebook };
}

function queueNotebookOperation(
  state: BackendState,
  target: BackendToolTarget,
  tool: string,
  args: Record<string, unknown>,
  timeoutMs: number,
  extra?: ToolHandlerExtra,
) {
  const requestId = randomUUID();
  const createdAt = Date.now();

  state.queue.enqueue({
    requestId,
    tool,
    arguments: args,
    targetNotebookId: target.notebook.notebookId,
    agentSessionId: target.agentSessionId,
    timeoutMs,
    createdAt,
  });

  const abortHandler = () => {
    state.queue.cancel(requestId, "MCP client cancelled operation", Date.now());
  };

  if (extra?.signal?.aborted) {
    abortHandler();
  } else if (extra?.signal) {
    extra.signal.addEventListener("abort", abortHandler, { once: true });
  }

  const timeoutHandle = setTimeout(() => {
    state.queue.markTimedOut(Date.now());
  }, timeoutMs);

  return state.queue
    .waitForResult(requestId)
    .then((result) => toolSuccess(result))
    .finally(() => {
      clearTimeout(timeoutHandle);
      extra?.signal?.removeEventListener("abort", abortHandler);
    });
}

function ensurePermission(notebook: NotebookRecord, tool: string, permission: keyof NotebookRecord["permissions"]): void {
  if (!notebook.permissions[permission]) {
    throw new Error(`PERMISSION_DENIED: ${tool}`);
  }
}

type QueuedNotebookTool = {
  name: string;
  summary: string;
  schema: Record<string, unknown>;
  permission: keyof NotebookRecord["permissions"];
  timeoutMs: (args: Record<string, unknown>) => number;
  extraGuidance?: string;
  requiresExplicitTarget?: boolean;
};

const queuedNotebookTools: QueuedNotebookTool[] = [
  {
    name: "mma_symbol_lookup",
    summary: "Look up Wolfram Language symbol documentation. Provide an exact symbol name (e.g. 'Plot') for full details including usage, options, attributes, and documentation URL, or a partial name (e.g. 'integrate') for a list of matching symbols.",
    schema: symbolLookupSchema.shape,
    permission: "ReadNotebook",
    timeoutMs: () => DEFAULT_TIMEOUTS_MS.symbolLookup,
  },
  {
    name: "mma_list_cells",
    summary: "List cells in the attached active Mathematica notebook.",
    schema: listCellsSchema.shape,
    permission: "ReadNotebook",
    timeoutMs: () => DEFAULT_TIMEOUTS_MS.listCells,
  },
  {
    name: "mma_read_cell",
    summary: "Read one cell from the attached Mathematica notebook.",
    schema: readCellSchema.shape,
    permission: "ReadNotebook",
    timeoutMs: () => DEFAULT_TIMEOUTS_MS.readCell,
  },
  {
    name: "mma_insert_cell",
    summary: "Insert a cell through the Mathematica FrontEnd bridge.",
    schema: insertCellSchema.shape,
    permission: "InsertCell",
    timeoutMs: () => DEFAULT_TIMEOUTS_MS.insertCell,
    extraGuidance: INSERT_ANCHOR_GUIDANCE,
    requiresExplicitTarget: true,
  },
  {
    name: "mma_modify_cell",
    summary: "Modify one existing cell through the Mathematica FrontEnd bridge.",
    schema: modifyCellSchema.shape,
    permission: "ModifyCell",
    timeoutMs: () => DEFAULT_TIMEOUTS_MS.mutation,
    requiresExplicitTarget: true,
  },
  {
    name: "mma_delete_cell",
    summary: "Delete one cell through the Mathematica FrontEnd bridge.",
    schema: deleteCellSchema.shape,
    permission: "DeleteCell",
    timeoutMs: () => DEFAULT_TIMEOUTS_MS.mutation,
    requiresExplicitTarget: true,
  },
  {
    name: "mma_run_cell",
    summary: "Run one cell in the attached Mathematica notebook.",
    schema: runCellSchema.shape,
    permission: "RunCell",
    timeoutMs: (args) => {
      const timeoutSec = typeof args.timeoutSec === "number" ? args.timeoutSec : 120;
      return timeoutSec * 1000;
    },
    requiresExplicitTarget: true,
  },
  {
    name: "mma_abort_evaluation",
    summary: "Abort the running Wolfram evaluation in the attached notebook.",
    schema: abortEvaluationSchema.shape,
    permission: "RunCell",
    timeoutMs: () => DEFAULT_TIMEOUTS_MS.mutation,
    requiresExplicitTarget: true,
  },
  {
    name: "mma_get_cell_output",
    summary: "Read output and messages for one Mathematica notebook cell, refreshing completed run status when observed.",
    schema: getCellOutputSchema.shape,
    permission: "ReadNotebook",
    timeoutMs: () => DEFAULT_TIMEOUTS_MS.readCell,
  },
  {
    name: "mma_read_artifact",
    summary: "Read one large output or message artifact by byte page. Artifact ids are resolved against current notebook state and may become stale after notebook edits or reruns.",
    schema: readArtifactSchema.shape,
    permission: "ReadNotebook",
    timeoutMs: () => DEFAULT_TIMEOUTS_MS.readCell,
  },
  {
    name: "mma_save_notebook",
    summary: "Save the attached Mathematica notebook through the FrontEnd.",
    schema: saveNotebookSchema.shape,
    permission: "SaveNotebook",
    timeoutMs: () => DEFAULT_TIMEOUTS_MS.mutation,
    requiresExplicitTarget: true,
  },
];

export type MicaMcpToolDefinition = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
};

export const MICA_BACKEND_TOOL_DEFINITIONS: MicaMcpToolDefinition[] = [
  {
    name: "mma_status",
    description: notebookToolDescription("Report backend status and notebook registry state."),
    schema: noArgsSchema.shape,
  },
  {
    name: "mma_list_notebooks",
    description: notebookToolDescription("List notebooks registered with the Mathematica bridge Palette."),
    schema: noArgsSchema.shape,
  },
  {
    name: "mma_select_notebook",
    description: notebookToolDescription("Select the active Mathematica notebook in the backend registry."),
    schema: selectNotebookSchema.shape,
  },
  ...queuedNotebookTools.map((config) => ({
    name: config.name,
    description: notebookToolDescription(config.summary, config.extraGuidance),
    schema: config.schema,
  })),
];

export async function executeBackendMcpTool(
  state: BackendState,
  tool: string,
  args: Record<string, unknown> = {},
  extra?: ToolHandlerExtra,
): Promise<StructuredToolResult> {
  const recordArgs = args && typeof args === "object" && !Array.isArray(args) ? args : {};

  if (tool === "mma_status") {
    return withToolErrors({ tool }, () => {
      sweepStateLiveness(state);
      return toolSuccess({
        server: "running",
        activeNotebookId: liveActiveNotebookId(state, extra?.sessionId),
        notebooks: state.notebooks.listLive(),
        agents: liveAgents(state),
      });
    });
  }

  if (tool === "mma_list_notebooks") {
    return withToolErrors({ tool }, () => {
      sweepStateLiveness(state);
      return toolSuccess({ notebooks: state.notebooks.listLive(), activeNotebookId: liveActiveNotebookId(state, extra?.sessionId) });
    });
  }

  if (tool === "mma_select_notebook") {
    return withToolErrors({ tool, args: recordArgs }, () => {
      const clientSessionId = extra?.sessionId;
      const target = resolveToolTarget(state, recordArgs, extra);
      state.setActiveNotebook(target.notebook.notebookId);
      if (clientSessionId) state.setActiveNotebook(target.notebook.notebookId, clientSessionId);
      return toolSuccess({ activeNotebookId: state.activeNotebookId, notebook: target.notebook });
    });
  }

  const queuedConfig = queuedNotebookTools.find((config) => config.name === tool);
  if (!queuedConfig) {
    return toolFailure(new Error(`UNKNOWN_TOOL: ${tool}`), { tool, args: recordArgs });
  }

  return withToolErrors({ tool: queuedConfig.name, args: recordArgs }, async () => {
    if (process.env.MICA_STRICT_TARGETING === "1" && queuedConfig.requiresExplicitTarget) {
      const hasNotebookId = typeof recordArgs.notebookId === "string" && recordArgs.notebookId.trim().length > 0;
      const hasDisplayName = typeof recordArgs.displayName === "string" && recordArgs.displayName.trim().length > 0;
      if (!hasNotebookId && !hasDisplayName) {
        throw new Error("EXPLICIT_NOTEBOOK_REQUIRED");
      }
    }
    const target = resolveToolTarget(state, recordArgs, extra);
    ensurePermission(target.notebook, queuedConfig.name, queuedConfig.permission);
    return queueNotebookOperation(state, target, queuedConfig.name, recordArgs, queuedConfig.timeoutMs(recordArgs), extra);
  });
}

export function registerBackendMcpTools(server: McpServer, state: BackendState): void {
  for (const definition of MICA_BACKEND_TOOL_DEFINITIONS) {
    server.tool(definition.name, definition.description, definition.schema, (args, extra) =>
      executeBackendMcpTool(state, definition.name, args as Record<string, unknown>, extra as ToolHandlerExtra)
    );
  }
}
