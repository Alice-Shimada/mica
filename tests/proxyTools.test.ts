import { describe, expect, it } from "vitest";
import { registerProxyMcpTools } from "../src/mcp/proxyTools.js";

type ToolRegistration = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, extra?: { sessionId?: string }) => Promise<unknown>;
};

function registerTools(fetchImpl: typeof fetch) {
  const registrations: ToolRegistration[] = [];
  const server = {
    tool(name: string, description: string, schema: Record<string, unknown>, handler: ToolRegistration["handler"]) {
      registrations.push({ name, description, schema, handler });
    },
  };

  registerProxyMcpTools(
    server as never,
    { baseUrl: "http://127.0.0.1:19791", authToken: "test-token" },
    { fetch: fetchImpl },
  );

  return registrations;
}

function registrationByName(registrations: ToolRegistration[], name: string) {
  const entry = registrations.find((registration) => registration.name === name);
  if (!entry) throw new Error(`missing registration: ${name}`);
  return entry;
}

describe("proxy MCP tools", () => {
  it("registers the same public MICA tool names as the backend server", () => {
    const registrations = registerTools(async () => new Response("{}"));

    expect(registrations.map((entry) => entry.name)).toEqual([
      "mma_status",
      "mma_list_notebooks",
      "mma_select_notebook",
      "mma_create_notebook",
      "mma_open_notebook",
      "mma_symbol_lookup",
      "mma_list_cells",
      "mma_read_cell",
      "mma_insert_cell",
      "mma_modify_cell",
      "mma_delete_cell",
      "mma_run_cell",
      "mma_abort_evaluation",
      "mma_kill_kernel",
      "mma_restart_kernel",
      "mma_get_cell_output",
      "mma_read_artifact",
      "mma_save_notebook",
    ]);
  });

  it("forwards tool calls to /mcp/call with bearer auth and client session id", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const registrations = registerTools(async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({
        content: [{ type: "text", text: "{\"ok\":true}" }],
        structuredContent: { ok: true, server: "running" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await registrationByName(registrations, "mma_status").handler({}, { sessionId: "client-1" });

    expect(result).toMatchObject({
      structuredContent: { ok: true, server: "running" },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("http://127.0.0.1:19791/mcp/call");
    expect(requests[0]!.init?.headers).toMatchObject({
      authorization: "Bearer test-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      tool: "mma_status",
      arguments: {},
      clientSessionId: "client-1",
    });
  });
});
