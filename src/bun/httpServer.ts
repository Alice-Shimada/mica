import http from "node:http";
import type { AddressInfo } from "node:net";
import type { BackendState } from "../backend/backendState.js";
import type { AgentInfo } from "../backend/protocol.js";
import { renderDashboard } from "./dashboard.js";

export type BunHttpApp = {
  port: number;
  stop: () => Promise<void>;
};

export type BunHttpAppOptions = {
  state: BackendState;
  host?: string;
  port: number;
};

type RuntimeServer = {
  port: number;
  stop: () => Promise<void>;
};

type AgentRegisterBody = {
  agentSessionId?: unknown;
  wolframVersion?: unknown;
  platform?: unknown;
  seenAt?: unknown;
};

type AgentHeartbeatBody = {
  agentSessionId?: unknown;
  seenAt?: unknown;
};

type NotebookHeartbeatBody = Record<string, unknown>;
type NotebookCloseBody = {
  agentSessionId?: unknown;
};
type HiddenAgentResultBody = Record<string, unknown>;

const JSON_BODY_LIMIT_BYTES = 1024 * 1024;

export async function createBunHttpApp({ state, host = "127.0.0.1", port }: BunHttpAppOptions): Promise<BunHttpApp> {
  const fetchHandler = createFetchHandler(state);
  const bun = (globalThis as typeof globalThis & {
    Bun?: { serve?: (options: { hostname: string; port: number; fetch: (request: Request) => Promise<Response> | Response }) => { port: number; stop: () => void | Promise<void> } };
  }).Bun;

  if (bun?.serve) {
    const server = bun.serve({ hostname: host, port, fetch: fetchHandler });
    return {
      port: server.port,
      stop: async () => {
        await server.stop();
      },
    };
  }

  return startNodeFallbackServer(fetchHandler, host, port);
}

export function createFetchHandler(state: BackendState) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/status") {
        state.sweepLiveness(Date.now());
        return jsonResponse({ server: "running", agents: state.agents.list(), notebooks: state.notebooks.listLive() });
      }

      if (request.method === "GET" && url.pathname === "/") {
        return htmlResponse(renderDashboard());
      }

      if (request.method === "POST" && url.pathname === "/agents/register") {
        const body = await readJsonObjectBody<AgentRegisterBody>(request);
        const agentSessionId = readRequiredString(body.agentSessionId, "agentSessionId");
        const wolframVersion = readRequiredString(body.wolframVersion, "wolframVersion");
        const platform = readRequiredString(body.platform, "platform");
        const seenAt = readOptionalNumber(body.seenAt) ?? Date.now();

        const agent = state.agents.register({ agentSessionId, wolframVersion, platform, seenAt });
        return jsonResponse({ agent });
      }

      const agentHeartbeatMatch = url.pathname.match(/^\/agents\/([^/]+)\/heartbeat$/);
      if (request.method === "POST" && (url.pathname === "/agents/heartbeat" || agentHeartbeatMatch)) {
        const body = await readJsonObjectBody<AgentHeartbeatBody>(request);
        const pathAgentSessionId = agentHeartbeatMatch ? decodeURIComponent(agentHeartbeatMatch[1]!) : undefined;
        const agentSessionId = readOptionalString(body.agentSessionId) ?? pathAgentSessionId;
        if (!agentSessionId) throw new Error("BAD_REQUEST");
        const seenAt = readOptionalNumber(body.seenAt) ?? Date.now();
        const existingAgent = state.agents.get(agentSessionId);
        const agent = state.agents.heartbeat(agentSessionId, seenAt);

        if (!agent) {
          return jsonResponse(noLiveAgentPayload(existingAgent), 404);
        }

        return jsonResponse({ agent });
      }

      if (request.method === "POST" && url.pathname === "/notebooks/heartbeat") {
        const body = await readJsonObjectBody<NotebookHeartbeatBody>(request);
        const agentSessionId = readRequiredString(body.agentSessionId, "agentSessionId");
        const liveAgent = state.agents.get(agentSessionId);
        if (!liveAgent || liveAgent.offline || liveAgent.retired) {
          return jsonResponse(noLiveAgentPayload(liveAgent), 404);
        }
        const notebook = state.notebooks.upsertHeartbeat({
          agentSessionId,
          frontendObjectKey: readRequiredString(body.frontendObjectKey, "frontendObjectKey"),
          displayName: readRequiredString(body.displayName, "displayName"),
          windowTitle: readRequiredPossiblyEmptyString(body.windowTitle),
          wolframVersion: readRequiredString(body.wolframVersion, "wolframVersion"),
          platform: readRequiredString(body.platform, "platform"),
          permissions: readPermissions(body.permissions),
          seenAt: readOptionalNumber(body.seenAt) ?? Date.now(),
          notebookPath: readOptionalString(body.notebookPath),
          savedPath: readOptionalString(body.savedPath),
        });

        return jsonResponse({ notebook });
      }

      const notebookClosedMatch = url.pathname.match(/^\/notebooks\/([^/]+)\/closed$/);
      if (request.method === "POST" && notebookClosedMatch) {
        const body = await readJsonObjectBody<NotebookCloseBody>(request);
        const agentSessionId = readRequiredString(body.agentSessionId, "agentSessionId");
        const notebookId = decodeURIComponent(notebookClosedMatch[1]!);
        const notebook = state.notebooks.get(notebookId);
        if (!notebook) {
          return jsonResponse({ error: { code: "NOTEBOOK_NOT_FOUND" } }, 404);
        }

        if (notebook.agentSessionId !== agentSessionId) {
          return jsonResponse({ error: { code: "NOT_OWNER" } }, 403);
        }

        state.closeNotebook(notebookId, Date.now());
        return jsonResponse({ ok: true });
      }

      if (request.method === "GET" && url.pathname === "/notebooks") {
        state.sweepLiveness(Date.now());
        return jsonResponse({ notebooks: state.notebooks.listLive(), activeNotebookId: state.activeNotebookId ?? null });
      }

      const nextRequestMatch = url.pathname.match(/^\/agents\/([^/]+)\/next-request$/);
      if (request.method === "GET" && nextRequestMatch) {
        const agentSessionId = decodeURIComponent(nextRequestMatch[1]!);
        state.sweepLiveness(Date.now());
        state.queue.markTimedOut(Date.now());
        const agent = state.agents.get(agentSessionId);
        if (!agent || agent.offline || agent.retired) {
          return jsonResponse(noLiveAgentPayload(agent), 404);
        }
        const nextRequest = state.queue.claimNext(agentSessionId, Date.now());
        return jsonResponse({ request: nextRequest ?? null, cancelRequests: state.queue.cancellationsForAgent(agentSessionId) });
      }

      const requestResultMatch = url.pathname.match(/^\/requests\/([^/]+)\/result$/);
      const requestFailureMatch = url.pathname.match(/^\/requests\/([^/]+)\/failure$/);
      if (request.method === "POST" && (requestResultMatch || requestFailureMatch)) {
        const requestId = decodeURIComponent((requestResultMatch ?? requestFailureMatch)![1]!);
        const body = await readJsonObjectBody<HiddenAgentResultBody>(request);
        state.queue.markTimedOut(Date.now());

        if (requestFailureMatch || body.ok === false || body.success === false || body.failed === true) {
          const existing = state.queue.get(requestId);
          const failed = state.queue.fail(requestId, body.error ?? body);
          return jsonResponse({ accepted: failed, late: existing?.status === "timed_out" || existing?.status === "cancelled" });
        }

        return jsonResponse(state.queue.resolve(requestId, body.result ?? body, Date.now()));
      }

      return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "BAD_REQUEST") {
        return jsonResponse({ error: { code: "BAD_REQUEST" } }, 400);
      }
      if (message === "MALFORMED_JSON") {
        return jsonResponse({ error: { code: "BAD_REQUEST" } }, 400);
      }
      if (message === "PAYLOAD_TOO_LARGE") {
        return jsonResponse({ error: { code: "PAYLOAD_TOO_LARGE" } }, 413);
      }

      return jsonResponse({ error: { code: "INTERNAL_ERROR", message } }, 500);
    }
  };
}

async function startNodeFallbackServer(fetchHandler: (request: Request) => Promise<Response>, host: string, port: number): Promise<BunHttpApp> {
  const server = http.createServer(async (incoming, outgoing) => {
    try {
      const body = await readNodeBody(incoming, JSON_BODY_LIMIT_BYTES);
      const request = new Request(`http://${host}${incoming.url ?? "/"}`, {
        method: incoming.method ?? "GET",
        headers: incoming.headers as HeadersInit,
        body: body.length > 0 ? Buffer.from(body) : undefined,
      });
      const response = await fetchHandler(request);
      await writeNodeResponse(outgoing, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "PAYLOAD_TOO_LARGE") {
        await writeNodeResponse(outgoing, jsonResponse({ error: { code: "PAYLOAD_TOO_LARGE" } }, 413));
        return;
      }
      await writeNodeResponse(outgoing, jsonResponse({ error: { code: "INTERNAL_ERROR", message } }, 500));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo | null;
  return {
    port: address?.port ?? port,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function readNodeBody(request: http.IncomingMessage, limitBytes: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limitBytes) {
      throw new Error("PAYLOAD_TOO_LARGE");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function writeNodeResponse(response: http.ServerResponse, result: Response): Promise<void> {
  const headers: Record<string, string> = {};
  result.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const body = Buffer.from(await result.arrayBuffer());
  response.writeHead(result.status, headers);
  response.end(body);
}

async function readJsonObjectBody<T extends Record<string, unknown>>(request: Request): Promise<T> {
  const text = await readLimitedRequestText(request, JSON_BODY_LIMIT_BYTES);
  if (!text.trim()) throw new Error("BAD_REQUEST");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("MALFORMED_JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("BAD_REQUEST");
  }

  return parsed as T;
}

async function readLimitedRequestText(request: Request, limitBytes: number): Promise<string> {
  const body = request.body;
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      size += value.byteLength;
      if (size > limitBytes) {
        throw new Error("PAYLOAD_TOO_LARGE");
      }

      parts.push(decoder.decode(value, { stream: true }));
    }

    parts.push(decoder.decode());
    return parts.join("");
  } finally {
    reader.releaseLock();
  }
}

function readRequiredString(value: unknown, fieldName: string): string {
  const text = readOptionalString(value);
  if (!text) throw new Error("BAD_REQUEST");
  return text;
}

function readRequiredPossiblyEmptyString(value: unknown): string {
  if (typeof value !== "string") throw new Error("BAD_REQUEST");
  return value.trim();
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readPermissions(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("BAD_REQUEST");

  const record = value as Record<string, unknown>;
  const keys = ["ReadNotebook", "InsertCell", "ModifyCell", "DeleteCell", "RunCell", "SaveNotebook"] as const;
  const permissions = {} as Record<(typeof keys)[number], boolean>;

  for (const key of keys) {
    if (typeof record[key] !== "boolean") throw new Error("BAD_REQUEST");
    permissions[key] = record[key];
  }

  return permissions;
}

function noLiveAgentPayload(agent: AgentInfo | undefined) {
  const error: Record<string, unknown> = { code: "NO_LIVE_AGENT" };
  if (agent?.retiredReason) error.reason = agent.retiredReason;
  return { error };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(escapeJsonForWolfram(JSON.stringify(payload)), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function escapeJsonForWolfram(json: string): string {
  return json.replace(/[^\x00-\x7F]/g, (character) => {
    return [...character]
      .map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`)
      .join("");
  });
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
