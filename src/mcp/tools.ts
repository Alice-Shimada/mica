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
  readArtifactSchema,
  readCellSchema,
  selectNotebookSchema,
  saveNotebookSchema,
  runCellSchema,
  symbolLookupSchema
} from "./toolSchemas.js";
import { INSERT_ANCHOR_GUIDANCE, notebookToolDescription } from "./descriptions.js";
import { toolSuccess, withToolErrors } from "./toolResults.js";

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
    return toolSuccess(result);
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

type LegacyQueuedTool = {
  name: ToolName;
  summary: string;
  schema: Record<string, unknown>;
  extraGuidance?: string;
};

function registerLegacyQueuedTool(
  server: McpServer,
  queue: RequestQueue,
  getStatus: () => BridgeStatus,
  config: LegacyQueuedTool
): void {
  server.tool(
    config.name,
    notebookToolDescription(config.summary, config.extraGuidance),
    config.schema,
    async (args, extra) => {
      const recordArgs = args as Record<string, unknown>;
      return withToolErrors({ tool: config.name, args: recordArgs }, () =>
        enqueueWithCancellation(queue, getStatus, config.name, recordArgs, extra as ToolHandlerExtra)
      );
    }
  );
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
    async () => withToolErrors({ tool: "mma_status" }, () => toolSuccess(getStatus()))
  );

  server.tool(
    "mma_list_notebooks",
    notebookToolDescription("List notebooks registered with the Mathematica bridge Palette."),
    noArgsSchema.shape,
    async () => {
      return withToolErrors({ tool: "mma_list_notebooks" }, () => {
        const status = getStatus();
        return toolSuccess({ notebooks: status.notebooks ?? [], activeNotebookId: status.activeNotebookId });
      });
    }
  );

  server.tool(
    "mma_select_notebook",
    notebookToolDescription("Select the active Mathematica notebook in the Palette registry."),
    selectNotebookSchema.shape,
    async (args, extra) => {
      const recordArgs = args as Record<string, unknown>;
      return withToolErrors({ tool: "mma_select_notebook", args: recordArgs }, () => {
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
          recordArgs,
          extra as ToolHandlerExtra
        );
      });
    }
  );

  const queuedTools: LegacyQueuedTool[] = [
    {
      name: "mma_list_cells",
      summary: "List cells in the attached active Mathematica notebook.",
      schema: listCellsSchema.shape,
    },
    {
      name: "mma_read_cell",
      summary: "Read one cell from the attached Mathematica notebook.",
      schema: readCellSchema.shape,
    },
    {
      name: "mma_insert_cell",
      summary: "Insert a cell through the Mathematica FrontEnd bridge.",
      schema: insertCellSchema.shape,
      extraGuidance: INSERT_ANCHOR_GUIDANCE,
    },
    {
      name: "mma_modify_cell",
      summary: "Modify one existing cell through the Mathematica FrontEnd bridge.",
      schema: modifyCellSchema.shape,
    },
    {
      name: "mma_delete_cell",
      summary: "Delete one cell through the Mathematica FrontEnd bridge.",
      schema: deleteCellSchema.shape,
    },
    {
      name: "mma_run_cell",
      summary: "Run one cell in the attached Mathematica notebook.",
      schema: runCellSchema.shape,
    },
    {
      name: "mma_abort_evaluation",
      summary: "Abort the running Wolfram evaluation in the attached notebook.",
      schema: abortEvaluationSchema.shape,
    },
    {
      name: "mma_get_cell_output",
      summary: "Read output and messages for one Mathematica notebook cell, refreshing completed run status when observed.",
      schema: getCellOutputSchema.shape,
    },
    {
      name: "mma_read_artifact",
      summary: "Read one large output or message artifact by byte page. Artifact ids are resolved against current notebook state and may become stale after notebook edits or reruns.",
      schema: readArtifactSchema.shape,
    },
    {
      name: "mma_save_notebook",
      summary: "Save the attached Mathematica notebook through the FrontEnd.",
      schema: saveNotebookSchema.shape,
    },
    {
      name: "mma_symbol_lookup",
      summary: "Look up Wolfram Language symbol documentation. Provide an exact symbol name (e.g. 'Plot') for full details including usage, options, attributes, and documentation URL, or a partial name (e.g. 'integrate') for a list of matching symbols.",
      schema: symbolLookupSchema.shape,
    },
  ];

  for (const config of queuedTools) {
    registerLegacyQueuedTool(server, queue, getStatus, config);
  }
}
