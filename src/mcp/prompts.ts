import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const MICA_TOOL_GUIDE_PROMPT_NAME = "mica_notebook_workflow";

const TOOL_GUIDE = [
  ["mma_status", "Report server, agent, and notebook registry state."],
  ["mma_list_notebooks", "List live notebooks and the active notebook id."],
  ["mma_select_notebook", "Select the active notebook by notebookId or displayName."],
  ["mma_symbol_lookup", "Look up Wolfram Language symbol usage, options, attributes, and documentation URLs."],
  ["mma_list_cells", "List cells in the selected notebook."],
  ["mma_read_cell", "Read one cell's content and metadata."],
  ["mma_insert_cell", "Insert a notebook cell; use afterCellId=\"__end__\" to append."],
  ["mma_modify_cell", "Modify an existing cell."],
  ["mma_delete_cell", "Delete an existing cell."],
  ["mma_run_cell", "Evaluate one cell and wait for completion or timeout."],
  ["mma_abort_evaluation", "Abort a running notebook evaluation."],
  ["mma_get_cell_output", "Read output and messages produced by one cell; this may refresh completed run status."],
  ["mma_read_artifact", "Read large output or message artifacts by byte page; ids may become stale after notebook edits or reruns."],
  ["mma_save_notebook", "Save the selected notebook when SaveNotebook permission is granted."],
] as const;

export const MICA_AGENT_INSTRUCTIONS = [
  "MICA controls already-open Mathematica / Wolfram Desktop notebooks through MCP.",
  "",
  "Workflow rules:",
  "1. Start with mma_status or mma_list_notebooks. Use the latest notebookId because notebookIds change across Mathematica restarts.",
  "2. Work only with notebooks returned by mma_list_notebooks unless the user explicitly asks for a different external action. Do not create hidden or offscreen notebooks.",
  "3. Prefer notebookId for targeting. Use displayName only when the notebook name is unambiguous.",
  "4. For all mutating operations, pass notebookId explicitly.",
  "5. For live notebook debugging, use MCP notebook cells: insert cells, run cells, read cells, and inspect outputs/messages. Do not use detached wolframscript for live notebook mutation or debugging.",
  "6. Cell ids are session-local. Refresh with mma_list_cells after large edits, deletes, or notebook restarts.",
  "7. For appending cells, pass afterCellId=\"__end__\". Empty notebooks are supported.",
  "8. All tool results are structured. Success returns ok: true. Expected failures return ok: false with error.code, error.message, error.retryable, error.tool, and sometimes error.notebookId.",
  "9. Respect notebook permissions. SaveNotebook is commonly disabled; handle PERMISSION_DENIED instead of retrying blindly.",
  "",
  "Tools:",
  ...TOOL_GUIDE.map(([name, description]) => `- ${name}: ${description}`),
].join("\n");

export function createMicaMcpServer(name: string, version = "1.0.2"): McpServer {
  return new McpServer({ name, version }, { instructions: MICA_AGENT_INSTRUCTIONS });
}

export function registerMicaPrompts(server: Pick<McpServer, "prompt">): void {
  server.prompt(
    MICA_TOOL_GUIDE_PROMPT_NAME,
    "How an agent should use MICA's Mathematica notebook MCP tools.",
    () => ({
      description: "MICA Mathematica notebook workflow and tool guide.",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: MICA_AGENT_INSTRUCTIONS,
          },
        },
      ],
    }),
  );
}
