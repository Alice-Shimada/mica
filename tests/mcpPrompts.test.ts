import { describe, expect, it } from "vitest";
import {
  MICA_AGENT_INSTRUCTIONS,
  MICA_TOOL_GUIDE_PROMPT_NAME,
  createMicaMcpServer,
  registerMicaPrompts,
} from "../src/mcp/prompts.js";

type PromptRegistration = {
  name: string;
  description: string;
  handler: () => unknown;
};

function collectPromptRegistrations(): PromptRegistration[] {
  const registrations: PromptRegistration[] = [];
  const server = {
    prompt(name: string, description: string, handler: () => unknown) {
      registrations.push({ name, description, handler });
    },
  };

  registerMicaPrompts(server as never);
  return registrations;
}

describe("MICA MCP prompts", () => {
  it("registers a notebook workflow prompt for MCP clients", () => {
    const registrations = collectPromptRegistrations();

    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({
      name: MICA_TOOL_GUIDE_PROMPT_NAME,
      description: expect.stringContaining("Mathematica notebook"),
    });
  });

  it("describes every public MCP tool and the expected workflow", () => {
    const prompt = collectPromptRegistrations()[0]!.handler();

    expect(prompt).toMatchObject({
      description: expect.stringContaining("MICA"),
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: expect.stringContaining("Start with mma_status or mma_list_notebooks"),
          },
        },
      ],
    });

    const text = (prompt as { messages: Array<{ content: { text: string } }> }).messages[0]!.content.text;
    for (const tool of [
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
    ]) {
      expect(text).toContain(tool);
    }
    expect(text).toContain('afterCellId="__end__"');
    expect(text).toContain("Do not use detached wolframscript");
    expect(text).toContain("Do not create hidden or offscreen notebooks");
    expect(text).toContain("ok: true");
    expect(text).toContain("ok: false");
  });

  it("instructs agents to pass notebookId explicitly for mutating operations", () => {
    const prompt = collectPromptRegistrations()[0]!.handler();
    const text = (prompt as { messages: Array<{ content: { text: string } }> }).messages[0]!.content.text;

    expect(text).toContain("For all mutating operations, pass notebookId explicitly");
  });

  it("puts the same guide into MCP server initialization instructions", () => {
    const server = createMicaMcpServer("mica-test");

    expect((server.server as unknown as { _instructions?: string })._instructions).toBe(MICA_AGENT_INSTRUCTIONS);
  });
});
