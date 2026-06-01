const NOTEBOOK_WORKFLOW_GUIDANCE =
  "Start by calling mma_status or mma_list_notebooks. Use the latest notebookId because notebookIds change across sessions/restarts. Restart your MCP client or the MICA MCP server after changing this MCP server code or tool descriptions.";
const LIVE_NOTEBOOK_DEBUG_GUIDANCE =
  "Debug live notebooks only through MCP notebook cells: insert cells, run cells, and read output/messages. Do not use detached wolframscript for live-notebook debugging or mutation.";

export const INSERT_ANCHOR_GUIDANCE = 'For append or unknown anchors, use afterCellId="__end__"; empty notebooks are supported.';

export function notebookToolDescription(summary: string, extraGuidance?: string): string {
  return [summary, NOTEBOOK_WORKFLOW_GUIDANCE, extraGuidance, LIVE_NOTEBOOK_DEBUG_GUIDANCE].filter(Boolean).join(" ");
}
