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
  readCellSchema,
  runCellSchema,
  selectNotebookSchema,
  saveNotebookSchema,
  symbolLookupSchema,
} from "./toolSchemas.js";

type ToolHandlerExtra = {
  signal?: AbortSignal;
};

const NOTEBOOK_WORKFLOW_GUIDANCE =
  "Start by calling mma_status or mma_list_notebooks. Use the latest notebookId because notebookIds change across sessions/restarts. Restart opencode or the mma MCP server after changing this MCP server code or tool descriptions.";
const LIVE_NOTEBOOK_DEBUG_GUIDANCE =
  "Debug live notebooks only through MCP notebook cells: insert cells, run cells, and read output/messages. Do not use detached wolframscript for live-notebook debugging or mutation.";
const INSERT_ANCHOR_GUIDANCE = 'For append or unknown anchors, use afterCellId="__end__"; empty notebooks are supported.';

function notebookToolDescription(summary: string, extraGuidance?: string): string {
  return [summary, NOTEBOOK_WORKFLOW_GUIDANCE, extraGuidance, LIVE_NOTEBOOK_DEBUG_GUIDANCE].filter(Boolean).join(" ");
}

function toolResult(value: unknown) {
  const structuredContent = value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : { result: value };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

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

function liveActiveNotebookId(state: BackendState): string | null {
  const activeNotebookId = state.activeNotebookId;
  if (!activeNotebookId) return null;

  const activeNotebook = state.notebooks.get(activeNotebookId);
  return activeNotebook && !activeNotebook.closed && !activeNotebook.stale ? activeNotebookId : null;
}

function liveAgents(state: BackendState) {
  return state.agents.list().filter((agent) => !agent.offline && !agent.retired);
}

function resolveNotebookTarget(state: BackendState, args: { notebookId?: string; displayName?: string }): NotebookRecord {
  const resolution = state.resolveNotebook(args);
  if (!resolution.ok) {
    throw new Error(resolution.error);
  }

  return resolution.record;
}

export function resolveToolTarget(state: BackendState, args: Record<string, unknown>): BackendToolTarget {
  sweepStateLiveness(state);
  assertLiveAgent(state);
  const notebook = resolveNotebookTarget(state, {
    notebookId: typeof args.notebookId === "string" ? args.notebookId : undefined,
    displayName: typeof args.displayName === "string" ? args.displayName : undefined,
  });

  const notebookAgent = state.agents.get(notebook.agentSessionId);
  if (!notebookAgent || notebookAgent.offline) {
    throw new Error("NO_LIVE_AGENT");
  }

  return { agentSessionId: notebook.agentSessionId, notebook };
}

function queueNotebookOperation(
  state: BackendState,
  tool: string,
  args: Record<string, unknown>,
  timeoutMs: number,
  extra?: ToolHandlerExtra,
) {
  const { agentSessionId, notebook } = resolveToolTarget(state, args);
  const requestId = randomUUID();
  const createdAt = Date.now();

  state.queue.enqueue({
    requestId,
    tool,
    arguments: args,
    targetNotebookId: notebook.notebookId,
    agentSessionId,
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
    .then((result) => toolResult(result))
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
};

function registerQueuedNotebookTool(server: McpServer, state: BackendState, config: QueuedNotebookTool): void {
  server.tool(
    config.name,
    notebookToolDescription(config.summary, config.extraGuidance),
    config.schema,
    async (args, extra) => {
      const recordArgs = args as Record<string, unknown>;
      const target = resolveToolTarget(state, recordArgs);
      ensurePermission(target.notebook, config.name, config.permission);
      return queueNotebookOperation(state, config.name, recordArgs, config.timeoutMs(recordArgs), extra as ToolHandlerExtra);
    }
  );
}

export function registerBackendMcpTools(server: McpServer, state: BackendState): void {
  server.tool("mma_status", notebookToolDescription("Report backend status and notebook registry state."), noArgsSchema.shape, async () => {
    sweepStateLiveness(state);
    return toolResult({
      server: "running",
      activeNotebookId: liveActiveNotebookId(state),
      notebooks: state.notebooks.listLive(),
      agents: liveAgents(state),
    });
  });

  server.tool(
    "mma_list_notebooks",
    notebookToolDescription("List notebooks registered with the Mathematica bridge Palette."),
    noArgsSchema.shape,
    async () => {
      sweepStateLiveness(state);
      return toolResult({ notebooks: state.notebooks.listLive(), activeNotebookId: liveActiveNotebookId(state) });
    }
  );

  server.tool(
    "mma_select_notebook",
    notebookToolDescription("Select the active Mathematica notebook in the backend registry."),
    selectNotebookSchema.shape,
    async (args) => {
      const target = resolveToolTarget(state, args as Record<string, unknown>);
      state.activeNotebookId = target.notebook.notebookId;
      return toolResult({ ok: true, activeNotebookId: state.activeNotebookId, notebook: target.notebook });
    }
  );

  const queuedNotebookTools: QueuedNotebookTool[] = [
    {
      name: "mma_symbol_lookup",
      summary: "Look up Wolfram Language symbol documentation. Provide an exact symbol name (e.g. 'Plot') for full details including usage, options, attributes, syntax, related symbols, and documentation URL, or a partial name (e.g. 'integrate') for a list of matching symbols.",
      schema: symbolLookupSchema.shape,
      permission: "ReadNotebook",
      timeoutMs: () => DEFAULT_TIMEOUTS_MS.symbolLookup,
      extraGuidance: "",
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
    },
    {
      name: "mma_modify_cell",
      summary: "Modify one existing cell through the Mathematica FrontEnd bridge.",
      schema: modifyCellSchema.shape,
      permission: "ModifyCell",
      timeoutMs: () => DEFAULT_TIMEOUTS_MS.mutation,
    },
    {
      name: "mma_delete_cell",
      summary: "Delete one cell through the Mathematica FrontEnd bridge.",
      schema: deleteCellSchema.shape,
      permission: "DeleteCell",
      timeoutMs: () => DEFAULT_TIMEOUTS_MS.mutation,
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
    },
    {
      name: "mma_abort_evaluation",
      summary: "Abort the running Wolfram evaluation in the attached notebook.",
      schema: abortEvaluationSchema.shape,
      permission: "RunCell",
      timeoutMs: () => DEFAULT_TIMEOUTS_MS.mutation,
    },
    {
      name: "mma_get_cell_output",
      summary: "Read output and messages for one Mathematica notebook cell.",
      schema: getCellOutputSchema.shape,
      permission: "ReadNotebook",
      timeoutMs: () => DEFAULT_TIMEOUTS_MS.readCell,
    },
    {
      name: "mma_save_notebook",
      summary: "Save the attached Mathematica notebook through the FrontEnd.",
      schema: saveNotebookSchema.shape,
      permission: "SaveNotebook",
      timeoutMs: () => DEFAULT_TIMEOUTS_MS.mutation,
    },
  ];

  for (const config of queuedNotebookTools) {
    registerQueuedNotebookTool(server, state, config);
  }
}
