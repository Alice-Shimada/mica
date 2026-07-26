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
  ["mma_kill_kernel", "Quit the Wolfram kernel for a notebook (control agent kernel is protected)."],
  ["mma_restart_kernel", "Restart the Wolfram kernel for a notebook so it can evaluate cells again."],
  ["mma_create_notebook", "Create a new blank notebook in the Wolfram FrontEnd."],
  ["mma_open_notebook", "Open an existing notebook file (.nb) from disk using the local OS default application."],
  ["mma_get_cell_output", "Read output and messages produced by one cell; this may refresh completed run status."],
  ["mma_read_artifact", "Read large output or message artifacts by byte page; ids may become stale after notebook edits or reruns."],
  ["mma_save_notebook", "Save the selected notebook when SaveNotebook permission is granted."],
] as const;

export const WOLFRAM_LANGUAGE_AGENT_GUIDANCE = [
  "Wolfram Language authoring rules:",
  "1. Inspect nearby cells and existing definitions before editing. Preserve the notebook or package's established API, naming, and evaluation conventions.",
  "2. Naming is context-sensitive: System symbols use descriptive UpperCamelCase, while ordinary scratch symbols are typically lowercase. If a project deliberately mirrors Wolfram APIs, use descriptive UpperCamelCase for public functions; use lowerCamelCase or lowercase for local variables and pattern names. Do not capitalize every user symbol mechanically, shadow built-ins, or add a Q suffix unless the function always returns True or False.",
  "3. Define functions with patterns and SetDelayed (:=) when the right-hand side should evaluate per call; use Set (=) only when immediate evaluation is intentional. For named optional arguments, prefer Options, OptionsPattern[], and OptionValue.",
  "4. Localize temporary state: use Module for fresh local symbols, With for lexical constants, and Block only for intentional dynamic localization. Avoid leaking scratch definitions into Global`; use package contexts and private helpers for reusable package code.",
  "5. Give each Input cell one coherent step. Prefer separate cells for setup, transformation, inspection or verification, and visualization. During debugging, teaching, or exploration, name and expose useful intermediate results instead of burying a multi-step computation in one CompoundExpression or oversized Module.",
  "6. Use semicolons only when suppressing output is intentional. Keep useful diagnostic checkpoints visible, then inspect outputs and messages before continuing.",
  "7. Make notebook workflows rerunnable: do not depend on % or fixed Out[n] history, avoid hidden session state, and make assumptions, initialization, and randomness explicit when relevant.",
  "8. For reusable code, add usage messages and verify important behavior with VerificationTest or TestReport. Use Failure or named messages for expected bad inputs when appropriate.",
  "9. Before guessing a Wolfram symbol's syntax, options, or attributes, call mma_symbol_lookup.",
].join("\n");

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
  WOLFRAM_LANGUAGE_AGENT_GUIDANCE,
  "",
  "Tools:",
  ...TOOL_GUIDE.map(([name, description]) => `- ${name}: ${description}`),
].join("\n");

export function createMicaMcpServer(name: string, version = "1.2.3"): McpServer {
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
