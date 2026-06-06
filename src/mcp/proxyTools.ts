import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MICA_BACKEND_TOOL_DEFINITIONS } from "./backendTools.js";
import { toolFailure, type StructuredToolResult } from "./toolResults.js";

export type ProxyMcpSession = {
  baseUrl: string;
  authToken: string;
};

type ProxyToolExtra = {
  sessionId?: string;
};

export type ProxyMcpToolDeps = {
  fetch?: typeof fetch;
};

export function registerProxyMcpTools(server: McpServer, session: ProxyMcpSession, deps: ProxyMcpToolDeps = {}): void {
  for (const definition of MICA_BACKEND_TOOL_DEFINITIONS) {
    server.tool(definition.name, definition.description, definition.schema, async (args, extra) => {
      return callProxyTool(session, definition.name, args as Record<string, unknown>, extra as ProxyToolExtra, deps);
    });
  }
}

async function callProxyTool(
  session: ProxyMcpSession,
  tool: string,
  args: Record<string, unknown>,
  extra: ProxyToolExtra | undefined,
  deps: ProxyMcpToolDeps,
): Promise<StructuredToolResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return toolFailure(new Error("FETCH_UNAVAILABLE"), { tool, args });
  }

  try {
    const response = await fetchImpl(`${session.baseUrl}/mcp/call`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.authToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tool,
        arguments: args ?? {},
        ...(extra?.sessionId ? { clientSessionId: extra.sessionId } : {}),
      }),
    });

    if (!response.ok) {
      return toolFailure(new Error(`MCP_PROXY_HTTP_${response.status}`), { tool, args });
    }

    return (await response.json()) as StructuredToolResult;
  } catch (error) {
    return toolFailure(error, { tool, args });
  }
}
