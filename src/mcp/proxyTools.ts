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
      return proxyHttpFailure(response, tool, args);
    }

    return (await response.json()) as StructuredToolResult;
  } catch (error) {
    return toolFailure(error, { tool, args });
  }
}

async function proxyHttpFailure(response: Response, tool: string, args: Record<string, unknown>): Promise<StructuredToolResult> {
  const body = await response.text();
  try {
    const payload = JSON.parse(body) as unknown;
    if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
      return toolFailure(payload, { tool, args });
    }
  } catch {
    // Fall through to an HTTP-status diagnostic when the backend body is not JSON.
  }

  return toolFailure({
    code: "MCP_PROXY_HTTP_ERROR",
    message: `The local MICA backend returned HTTP ${response.status}.`,
    retryable: response.status >= 500,
  }, { tool, args });
}
