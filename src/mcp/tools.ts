import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestQueue } from "../bridge/requestQueue.js";
import type { BridgeStatus, ToolName } from "../types.js";
import {
  abortEvaluationSchema,
  deleteCellSchema,
  getCellOutputSchema,
  listCellsSchema,
  insertCellSchema,
  modifyCellSchema,
  noArgsSchema,
  readCellSchema,
  selectNotebookSchema,
  saveNotebookSchema,
  runCellSchema
} from "./toolSchemas.js";

/**
 * Structural type for the second argument passed to MCP tool handlers.
 *
 * The @modelcontextprotocol/sdk passes a `RequestHandlerExtra` object with an
 * optional `signal` (AbortSignal). We use a structural interface here so the
 * code compiles without importing SDK-internal types that may shift between
 * versions.
 */
interface ToolHandlerExtra {
  signal?: AbortSignal;
}

const NOTEBOOK_WORKFLOW_GUIDANCE =
  "Start by calling mma_status or mma_list_notebooks. Use the latest notebookId because notebookIds change across sessions/restarts. Restart opencode or the mma MCP server after changing this MCP server code or tool descriptions.";
const LIVE_NOTEBOOK_DEBUG_GUIDANCE =
  "Debug live notebooks only through MCP notebook cells: insert cells, run cells, and read output/messages. Do not use detached wolframscript for live-notebook debugging or mutation.";
const INSERT_ANCHOR_GUIDANCE = 'For append or unknown anchors, use afterCellId="__end__"; empty notebooks are supported.';

function notebookToolDescription(summary: string, extraGuidance?: string): string {
  return [summary, NOTEBOOK_WORKFLOW_GUIDANCE, extraGuidance, LIVE_NOTEBOOK_DEBUG_GUIDANCE].filter(Boolean).join(" ");
}

function toolResult(value: object) {
  const structuredContent: Record<string, unknown> = { ...value };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent
  };
}

export function assertBridgeReadyForTool(status: BridgeStatus): void {
  if (!status.paletteConnected) {
    throw new Error(
      "Mathematica Palette is not connected. Open the MMA Agent Bridge palette and click 'Allow control of current Notebook'."
    );
  }
  if (!status.notebookAttached) {
    throw new Error(
      "No Mathematica notebook is attached. Click 'Allow control of current Notebook' in the MMA Agent Bridge palette."
    );
  }
}

export function resolveNotebookTarget(
  args: Record<string, unknown>,
  status: Pick<BridgeStatus, "activeNotebookId" | "notebooks">
): string {
  const explicit = args.notebookId;
  if (typeof explicit === "string" && explicit.length > 0) {
    const knownNotebook = status.notebooks?.some((notebook) => notebook.notebookId === explicit) ?? false;
    if (!knownNotebook) {
      throw new Error(`Unknown notebookId: ${explicit}`);
    }
    return explicit;
  }

  const displayName = args.displayName;
  if (typeof displayName === "string" && displayName.trim().length > 0) {
    throw new Error("Display-name notebook selection is not supported in the Node MCP tool path yet.");
  }

  if (typeof status.activeNotebookId === "string" && status.activeNotebookId.length > 0) {
    return status.activeNotebookId;
  }

  throw new Error("No Mathematica notebook is selected");
}

/**
 * Enqueue a tool call through the bridge queue and wire MCP-client
 * cancellation via the AbortSignal provided by the SDK.
 *
 * When the MCP client cancels the tool call the SDK fires the signal's
 * `abort` event. We call `queue.cancelFromMcp` so the request is rejected
 * immediately (queued) or a one-shot cancellation notification is stored
 * for the Palette (claimed). The listener is removed after the promise
 * settles to avoid leaks.
 */
async function enqueueRequestWithCancellation(
  queue: RequestQueue,
  tool: ToolName,
  args: Record<string, unknown>,
  extra?: ToolHandlerExtra
) {
  const { requestId, promise } = queue.enqueueWithId(tool, args);

  // If the signal was already aborted before we enqueued, cancel immediately.
  if (extra?.signal?.aborted) {
    queue.cancelFromMcp(requestId, "MCP client cancelled operation");
  }

  const onAbort = () => {
    queue.cancelFromMcp(requestId, "MCP client cancelled operation");
  };

  // Only add the listener if the signal exists and isn't already aborted.
  if (extra?.signal && !extra.signal.aborted) {
    extra.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const result = await promise;
    return toolResult(result);
  } finally {
    extra?.signal?.removeEventListener("abort", onAbort);
  }
}

async function enqueueWithCancellation(
  queue: RequestQueue,
  getStatus: () => BridgeStatus,
  tool: ToolName,
  args: Record<string, unknown>,
  extra?: ToolHandlerExtra
) {
  const status = getStatus();
  assertBridgeReadyForTool(status);
  const notebookId = resolveNotebookTarget(args, status);
  return enqueueRequestWithCancellation(queue, tool, { ...args, notebookId }, extra);
}

export function registerMmaTools(
  server: McpServer,
  queue: RequestQueue,
  getStatus: () => BridgeStatus
): void {
  server.tool(
    "mma_status",
    notebookToolDescription("Report Mathematica bridge, Palette, and notebook attachment status."),
    noArgsSchema.shape,
    async () => toolResult(getStatus())
  );

  server.tool(
    "mma_list_cells",
    notebookToolDescription("List cells in the attached active Mathematica notebook."),
    listCellsSchema.shape,
    async (_args, extra) =>
      enqueueWithCancellation(queue, getStatus, "mma_list_cells", _args as Record<string, unknown>, extra as ToolHandlerExtra)
  );

  server.tool(
    "mma_read_cell",
    notebookToolDescription("Read one cell from the attached Mathematica notebook."),
    readCellSchema.shape,
    async (args, extra) =>
      enqueueWithCancellation(queue, getStatus, "mma_read_cell", args as Record<string, unknown>, extra as ToolHandlerExtra)
  );

  server.tool(
    "mma_insert_cell",
    notebookToolDescription("Insert a cell through the Mathematica FrontEnd bridge.", INSERT_ANCHOR_GUIDANCE),
    insertCellSchema.shape,
    async (args, extra) =>
      enqueueWithCancellation(queue, getStatus, "mma_insert_cell", args as Record<string, unknown>, extra as ToolHandlerExtra)
  );

  server.tool(
    "mma_modify_cell",
    notebookToolDescription("Modify one existing cell through the Mathematica FrontEnd bridge."),
    modifyCellSchema.shape,
    async (args, extra) =>
      enqueueWithCancellation(queue, getStatus, "mma_modify_cell", args as Record<string, unknown>, extra as ToolHandlerExtra)
  );

  server.tool(
    "mma_delete_cell",
    notebookToolDescription("Delete one cell through the Mathematica FrontEnd bridge."),
    deleteCellSchema.shape,
    async (args, extra) =>
      enqueueWithCancellation(queue, getStatus, "mma_delete_cell", args as Record<string, unknown>, extra as ToolHandlerExtra)
  );

  server.tool(
    "mma_run_cell",
    notebookToolDescription("Run one cell in the attached Mathematica notebook."),
    runCellSchema.shape,
    async (args, extra) =>
      enqueueWithCancellation(queue, getStatus, "mma_run_cell", args as Record<string, unknown>, extra as ToolHandlerExtra)
  );

  server.tool(
    "mma_abort_evaluation",
    notebookToolDescription("Abort the running Wolfram evaluation in the attached notebook."),
    abortEvaluationSchema.shape,
    async (args, extra) =>
      enqueueWithCancellation(queue, getStatus, "mma_abort_evaluation", args as Record<string, unknown>, extra as ToolHandlerExtra)
  );

  server.tool(
    "mma_get_cell_output",
    notebookToolDescription("Read output and messages for one Mathematica notebook cell."),
    getCellOutputSchema.shape,
    async (args, extra) =>
      enqueueWithCancellation(queue, getStatus, "mma_get_cell_output", args as Record<string, unknown>, extra as ToolHandlerExtra)
  );

  server.tool(
    "mma_save_notebook",
    notebookToolDescription("Save the attached Mathematica notebook through the FrontEnd."),
    saveNotebookSchema.shape,
    async (_args, extra) =>
      enqueueWithCancellation(queue, getStatus, "mma_save_notebook", _args as Record<string, unknown>, extra as ToolHandlerExtra)
  );

  server.tool(
    "mma_list_notebooks",
    notebookToolDescription("List notebooks registered with the Mathematica bridge Palette."),
    noArgsSchema.shape,
    async () => {
      const status = getStatus();
      return toolResult({ notebooks: status.notebooks ?? [], activeNotebookId: status.activeNotebookId });
    }
  );

  server.tool(
    "mma_select_notebook",
    notebookToolDescription("Select the active Mathematica notebook in the Palette registry."),
    selectNotebookSchema.shape,
    async (args, extra) => {
      const status = getStatus();
      if (!status.paletteConnected) {
        throw new Error(
          "Mathematica Palette is not connected. Open the MMA Agent Bridge palette and click 'Allow control of current Notebook'."
        );
      }

      const notebookId = args.notebookId;
      if (typeof args.displayName === "string" && args.displayName.trim().length > 0 && typeof notebookId !== "string") {
        throw new Error("Display-name notebook selection is not supported in the Node MCP tool path yet.");
      }
      if (
        typeof notebookId !== "string" ||
        notebookId.length === 0 ||
        !(status.notebooks?.some((notebook) => notebook.notebookId === notebookId) ?? false)
      ) {
        throw new Error(`Unknown notebookId: ${notebookId}`);
      }

      return enqueueRequestWithCancellation(
        queue,
        "mma_select_notebook",
        args as Record<string, unknown>,
        extra as ToolHandlerExtra
      );
    }
  );
}
