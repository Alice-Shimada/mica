import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendState } from "../src/backend/backendState.js";
import { createBunHttpApp, createFetchHandler } from "../src/bun/httpServer.js";

const httpServerSource = readFileSync(new URL("../src/bun/httpServer.ts", import.meta.url), "utf8");

const permissions = {
  ReadNotebook: true,
  InsertCell: true,
  ModifyCell: true,
  DeleteCell: true,
  RunCell: true,
  SaveNotebook: true,
};

const servers: Array<{ stop: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

async function waitForQueuedCount(state: BackendState, count: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (state.queue.snapshot().queued.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`expected ${count} queued requests, got ${state.queue.snapshot().queued.length}`);
}

describe("Bun HTTP app", () => {
  it("serves a local dashboard shell", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/`);
    const html = await response.text();

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("MICA Dashboard");
    expect(html).toContain("Server");
    expect(html).toContain("Security");
    expect(html).toContain("Agents");
    expect(html).toContain("Notebooks");
    expect(html).toContain("Requests");
    expect(html).toContain("/status");
    expect(html).toContain("/notebooks");
    expect(html).toContain("Missing dashboard token. Open the dashboard URL printed by the MICA server.");
    expect(html).toContain("new URLSearchParams(location.hash.slice(1)).get('token')");
    expect(html).toContain("authorization: `Bearer ${token}`");
    expect(html).toContain("refreshInFlight");
    expect(html).toContain("setTimeout");
  });

  it("binds the HTTP server to a configured host", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, host: "127.0.0.1", port: 0 });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/status`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ server: { state: "running" } });
  });

  it("requires Bearer authorization when an auth token is configured", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0, authToken: "secret-token" });
    servers.push(server);

    const base = `http://127.0.0.1:${server.port}`;

    const missingResponse = await fetch(`${base}/status`);
    expect(missingResponse.status).toBe(401);
    await expect(missingResponse.json()).resolves.toEqual({ error: { code: "UNAUTHORIZED" } });

    const wrongResponse = await fetch(`${base}/status`, { headers: { authorization: "Bearer wrong-token" } });
    expect(wrongResponse.status).toBe(401);

    const authorizedResponse = await fetch(`${base}/status`, { headers: { authorization: "Bearer secret-token" } });
    expect(authorizedResponse.status).toBe(200);
    await expect(authorizedResponse.json()).resolves.toMatchObject({ server: { state: "running" } });
  });

  it("requires Bearer authorization for MCP proxy calls", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0, authToken: "secret-token" });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/mcp/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: "mma_status", arguments: {} }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: "UNAUTHORIZED" } });
  });

  it("executes mma_status through the MCP proxy endpoint with a valid token", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0, authToken: "secret-token" });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/mcp/call`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer secret-token" },
      body: JSON.stringify({ tool: "mma_status", arguments: {}, clientSessionId: "client-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      structuredContent: { ok: true, server: "running", notebooks: [], agents: [] },
      content: [expect.objectContaining({ type: "text" })],
    });
  });

  it("routes concurrent MCP proxy calls through the same BackendState queue", async () => {
    const state = new BackendState(() => "notebook-1");
    const now = Date.now();
    state.agents.register({ agentSessionId: "agent-1", wolframVersion: "14.3", platform: "Windows", seenAt: now });
    const notebook = state.notebooks.upsertHeartbeat({
      agentSessionId: "agent-1",
      frontendObjectKey: "fe-1",
      displayName: "Shared.nb",
      windowTitle: "Shared.nb",
      wolframVersion: "14.3",
      platform: "Windows",
      permissions,
      seenAt: now,
    });
    state.activeNotebookId = notebook.notebookId;

    const server = await createBunHttpApp({ state, port: 0, authToken: "secret-token" });
    servers.push(server);
    const base = `http://127.0.0.1:${server.port}`;
    const call = (clientSessionId: string) =>
      fetch(`${base}/mcp/call`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer secret-token" },
        body: JSON.stringify({ tool: "mma_list_cells", arguments: {}, clientSessionId }),
      }).then((response) => response.json());

    const first = call("client-1");
    const second = call("client-2");
    await waitForQueuedCount(state, 2);

    const queued = state.queue.snapshot().queued;
    expect(queued).toHaveLength(2);
    expect(queued[0]).toMatchObject({ tool: "mma_list_cells", targetNotebookId: notebook.notebookId });
    expect(queued[1]).toMatchObject({ tool: "mma_list_cells", targetNotebookId: notebook.notebookId });

    state.queue.resolve(queued[0]!.requestId, { cells: [{ cellId: "cell-1" }] }, now + 1);
    state.queue.resolve(queued[1]!.requestId, { cells: [{ cellId: "cell-2" }] }, now + 2);

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ structuredContent: expect.objectContaining({ ok: true, cells: [{ cellId: "cell-1" }] }) }),
      expect.objectContaining({ structuredContent: expect.objectContaining({ ok: true, cells: [{ cellId: "cell-2" }] }) }),
    ]);
  });

  it("uses timing-safe comparison for configured Bearer tokens", () => {
    expect(httpServerSource).toContain("timingSafeEqual");
  });

  it("reports status, registers agents, and lists notebooks", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const base = `http://127.0.0.1:${server.port}`;
    const now = Date.now();

    const statusResponse = await fetch(`${base}/status`);
    expect(statusResponse.headers.get("content-type")).toBe("application/json; charset=utf-8");
    await expect(statusResponse.json()).resolves.toMatchObject({
      server: { state: "running" },
      agents: [],
      notebooks: [],
    });

    const registerResponse = await fetch(`${base}/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentSessionId: "agent-1",
        wolframVersion: "13.3",
        platform: "Windows",
        seenAt: now,
      }),
    });

    expect(registerResponse.status).toBe(200);
    await expect(registerResponse.json()).resolves.toMatchObject({
      agent: {
        agentSessionId: "agent-1",
        lastSeenAt: now,
        offline: false,
      },
    });

    const notebookResponse = await fetch(`${base}/notebooks/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentSessionId: "agent-1",
        frontendObjectKey: "fe-1",
        displayName: "未命名-2",
        windowTitle: "未命名-2",
        wolframVersion: "13.3",
        platform: "Windows",
        permissions,
        seenAt: now + 100,
      }),
    });

    expect(notebookResponse.status).toBe(200);
    await expect(notebookResponse.json()).resolves.toMatchObject({
      notebook: {
        notebookId: "notebook-1",
        displayName: "未命名-2",
      },
    });

    await expect(fetch(`${base}/notebooks`).then((response) => response.json())).resolves.toEqual({
      notebooks: [
        expect.objectContaining({
          notebookId: "notebook-1",
          displayName: "未命名-2",
        }),
      ],
      activeNotebookId: null,
    });
  });

  it("accepts Wolfram 14.1+ untitled notebook heartbeats with an empty window title", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const base = `http://127.0.0.1:${server.port}`;
    const now = Date.now();

    await fetch(`${base}/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentSessionId: "agent-143",
        wolframVersion: "14.3",
        platform: "Unix",
        seenAt: now,
      }),
    });

    const notebookResponse = await fetch(`${base}/notebooks/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentSessionId: "agent-143",
        frontendObjectKey: "fe-untitled",
        displayName: "Untitled notebook e5f6b81",
        windowTitle: "",
        wolframVersion: "14.3",
        platform: "Unix",
        permissions,
        seenAt: now + 100,
      }),
    });

    expect(notebookResponse.status).toBe(200);
    await expect(notebookResponse.json()).resolves.toMatchObject({
      notebook: {
        notebookId: "notebook-1",
        displayName: "Untitled notebook e5f6b81",
        windowTitle: "",
      },
    });
  });

  it("heartbeats agents and returns 404 when no live agent exists", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const base = `http://127.0.0.1:${server.port}`;

    const missingResponse = await fetch(`${base}/agents/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentSessionId: "missing", seenAt: 2000 }),
    });

    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toMatchObject({ error: { code: "NO_LIVE_AGENT" } });

    await fetch(`${base}/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentSessionId: "agent-1",
        wolframVersion: "13.3",
        platform: "Windows",
        seenAt: 1000,
      }),
    });

    const heartbeatResponse = await fetch(`${base}/agents/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentSessionId: "agent-1", seenAt: 2000 }),
    });

    expect(heartbeatResponse.status).toBe(200);
    await expect(heartbeatResponse.json()).resolves.toMatchObject({
      agent: {
        agentSessionId: "agent-1",
        lastSeenAt: 2000,
        offline: false,
      },
    });
  });

  it("accepts protocol-compatible agent heartbeat, failure, and notebook closed aliases", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const base = `http://127.0.0.1:${server.port}`;

    await fetch(`${base}/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 }),
    });

    await expect(
      fetch(`${base}/agents/agent-1/heartbeat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seenAt: 2000 }),
      }).then(async (response) => ({ status: response.status, body: await response.json() })),
    ).resolves.toMatchObject({ status: 200, body: { agent: expect.objectContaining({ agentSessionId: "agent-1", lastSeenAt: 2000 }) } });

    const createdAt = Date.now();
    state.queue.enqueue({ requestId: "r1", tool: "mma_list_cells", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-1", timeoutMs: 5000, createdAt });
    const failureResponse = await fetch(`${base}/requests/r1/failure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: { code: "WOLFRAM_AGENT_ERROR", message: "kernel unavailable" } }),
    });

    expect(failureResponse.status).toBe(200);
    await expect(failureResponse.json()).resolves.toEqual({ accepted: true, late: false });
    expect(state.queue.get("r1")).toMatchObject({ status: "failed" });

    const notebook = state.notebooks.upsertHeartbeat({
      agentSessionId: "agent-1",
      frontendObjectKey: "fe-1",
      displayName: "demo.nb",
      windowTitle: "demo.nb",
      wolframVersion: "13.3",
      platform: "Windows",
      permissions,
      seenAt: 3000,
    });
    const closedResponse = await fetch(`${base}/notebooks/${notebook.notebookId}/closed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentSessionId: "agent-1" }),
    });

    expect(closedResponse.status).toBe(200);
    await expect(closedResponse.json()).resolves.toEqual({ ok: true });
    expect(state.notebooks.get(notebook.notebookId)?.closed).toBe(true);
  });

  it("requires close ownership and agentSessionId for notebook close posts", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const base = `http://127.0.0.1:${server.port}`;

    await fetch(`${base}/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 }),
    });
    await fetch(`${base}/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentSessionId: "agent-2", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 }),
    });

    const notebook = state.notebooks.upsertHeartbeat({
      agentSessionId: "agent-1",
      frontendObjectKey: "fe-1",
      displayName: "demo.nb",
      windowTitle: "demo.nb",
      wolframVersion: "13.3",
      platform: "Windows",
      permissions,
      seenAt: 3000,
    });

    const missingBody = await fetch(`${base}/notebooks/${notebook.notebookId}/closed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missingBody.status).toBe(400);
    await expect(missingBody.json()).resolves.toMatchObject({ error: { code: "BAD_REQUEST" } });
    expect(state.notebooks.get(notebook.notebookId)?.closed).toBe(false);

    const wrongAgent = await fetch(`${base}/notebooks/${notebook.notebookId}/closed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentSessionId: "agent-2" }),
    });
    expect(wrongAgent.status).toBe(403);
    await expect(wrongAgent.json()).resolves.toMatchObject({ error: { code: "NOT_OWNER" } });
    expect(state.notebooks.get(notebook.notebookId)?.closed).toBe(false);

    const missingNotebook = await fetch(`${base}/notebooks/missing/closed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentSessionId: "agent-1" }),
    });
    expect(missingNotebook.status).toBe(404);
    await expect(missingNotebook.json()).resolves.toMatchObject({ error: { code: "NOTEBOOK_NOT_FOUND" } });
    expect(state.notebooks.get(notebook.notebookId)?.closed).toBe(false);

    const allowed = await fetch(`${base}/notebooks/${notebook.notebookId}/closed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentSessionId: "agent-1" }),
    });
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toEqual({ ok: true });
    expect(state.notebooks.get(notebook.notebookId)?.closed).toBe(true);
  });

  it("retires an agent when closing its last live notebook", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const base = `http://127.0.0.1:${server.port}`;

    await fetch(`${base}/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 }),
    });

    const notebook = state.notebooks.upsertHeartbeat({
      agentSessionId: "agent-1",
      frontendObjectKey: "fe-1",
      displayName: "demo.nb",
      windowTitle: "demo.nb",
      wolframVersion: "13.3",
      platform: "Windows",
      permissions,
      seenAt: 2000,
    });

    const closedResponse = await fetch(`${base}/notebooks/${notebook.notebookId}/closed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentSessionId: "agent-1" }),
    });

    expect(closedResponse.status).toBe(200);
    await expect(closedResponse.json()).resolves.toEqual({ ok: true });
    expect(state.agents.get("agent-1")?.retired).toBe(true);
    expect(state.agents.get("agent-1")?.retiredReason).toBe("no_live_notebooks");
    expect(state.requireLiveAgent()).toEqual({ ok: false, error: "NO_LIVE_AGENT" });

    const heartbeatResponse = await fetch(`${base}/notebooks/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentSessionId: "agent-1",
        frontendObjectKey: "fe-2",
        displayName: "demo.nb",
        windowTitle: "demo.nb",
        wolframVersion: "13.3",
        platform: "Windows",
        permissions,
        seenAt: 3000,
      }),
    });

    expect(heartbeatResponse.status).toBe(404);
    await expect(heartbeatResponse.json()).resolves.toMatchObject({ error: { code: "NO_LIVE_AGENT", reason: "no_live_notebooks" } });
  });

  it("keeps both agents live when a second agent registers", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const base = `http://127.0.0.1:${server.port}`;

    await fetch(`${base}/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentSessionId: "agent-old", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 }),
    });
    await fetch(`${base}/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentSessionId: "agent-new", wolframVersion: "13.3", platform: "Windows", seenAt: 2000 }),
    });

    const heartbeatResponse = await fetch(`${base}/agents/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentSessionId: "agent-old", seenAt: 3000 }),
    });

    expect(heartbeatResponse.status).toBe(200);
    await expect(heartbeatResponse.json()).resolves.toMatchObject({ agent: { agentSessionId: "agent-old", offline: false, retired: false } });
    expect(state.agents.get("agent-new")?.offline).toBe(false);
  });

  it("accepts notebook heartbeat from the first agent after another agent registers", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const base = `http://127.0.0.1:${server.port}`;

    await fetch(`${base}/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentSessionId: "agent-old", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 }),
    });

    const notebook = state.notebooks.upsertHeartbeat({
      agentSessionId: "agent-old",
      frontendObjectKey: "fe-old",
      displayName: "old.nb",
      windowTitle: "old.nb",
      wolframVersion: "13.3",
      platform: "Windows",
      permissions,
      seenAt: 1000,
    });

    await fetch(`${base}/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentSessionId: "agent-new", wolframVersion: "13.3", platform: "Windows", seenAt: 2000 }),
    });

    const heartbeatResponse = await fetch(`${base}/notebooks/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentSessionId: "agent-old",
        frontendObjectKey: "fe-old",
        displayName: "old.nb",
        windowTitle: "old.nb",
        wolframVersion: "13.3",
        platform: "Windows",
        permissions,
        seenAt: 3000,
      }),
    });

    expect(heartbeatResponse.status).toBe(200);
    await expect(heartbeatResponse.json()).resolves.toMatchObject({ notebook: { notebookId: notebook.notebookId, agentSessionId: "agent-old" } });
    expect(state.notebooks.get(notebook.notebookId)?.stale).toBe(false);
    expect(state.notebooks.listLive()).toHaveLength(1);
  });

  it("rejects notebook heartbeat from a missing or offline agent with 404", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const base = `http://127.0.0.1:${server.port}`;

    const missing = await fetch(`${base}/notebooks/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentSessionId: "missing",
        frontendObjectKey: "fe-1",
        displayName: "missing.nb",
        windowTitle: "missing.nb",
        wolframVersion: "13.3",
        platform: "Windows",
        permissions,
        seenAt: 1000,
      }),
    });
    expect(missing.status).toBe(404);

    await fetch(`${base}/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 }),
    });
    state.agents.markOfflineOlderThan(5000, 1000);

    const offline = await fetch(`${base}/notebooks/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentSessionId: "agent-1",
        frontendObjectKey: "fe-1",
        displayName: "offline.nb",
        windowTitle: "offline.nb",
        wolframVersion: "13.3",
        platform: "Windows",
        permissions,
        seenAt: 6000,
      }),
    });
    expect(offline.status).toBe(404);
  });

  it("rejects next-request for missing and offline agents without claiming work", async () => {
    const state = new BackendState(() => "notebook-1");
    const now = Date.now();
    state.agents.register({ agentSessionId: "agent-old", wolframVersion: "13.3", platform: "Windows", seenAt: now });
    state.queue.enqueue({ requestId: "r1", tool: "mma_list_cells", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-old", timeoutMs: 5000, createdAt: now });
    state.agents.markOfflineOlderThan(now + 5000, 1000);
    state.agents.register({ agentSessionId: "agent-new", wolframVersion: "13.3", platform: "Windows", seenAt: now + 5000 });
    expect(state.agents.get("agent-old")?.retired).toBe(false);

    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);
    const base = `http://127.0.0.1:${server.port}`;

    const offline = await fetch(`${base}/agents/agent-old/next-request`);
    expect(offline.status).toBe(404);
    await expect(offline.json()).resolves.toMatchObject({ error: { code: "NO_LIVE_AGENT" } });
    expect(state.queue.get("r1")?.status).not.toBe("running");

    const missing = await fetch(`${base}/agents/missing/next-request`);
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: { code: "NO_LIVE_AGENT" } });

    const live = await fetch(`${base}/agents/agent-new/next-request`);
    expect(live.status).toBe(200);
  });

  it("sweeps before next-request and does not claim if the agent just went stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(31_000);
    try {
      const state = new BackendState(() => "notebook-1");
      state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1_000 });
      state.queue.enqueue({
        requestId: "r1",
        tool: "mma_list_cells",
        arguments: {},
        targetNotebookId: "n1",
        agentSessionId: "agent-1",
        timeoutMs: 5000,
        createdAt: 31_000,
      });

      const server = await createBunHttpApp({ state, port: 0 });
      servers.push(server);

      const response = await fetch(`http://127.0.0.1:${server.port}/agents/agent-1/next-request`);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "NO_LIVE_AGENT" } });
      expect(state.queue.get("r1")?.status).not.toBe("running");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ages out stale agents and notebooks before status and claim paths", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(31_000);
    try {
      const state = new BackendState(() => "notebook-1");
      state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1_000 });
      const notebook = state.notebooks.upsertHeartbeat({
        agentSessionId: "agent-1",
        frontendObjectKey: "fe-1",
        displayName: "demo.nb",
        windowTitle: "demo.nb",
        wolframVersion: "13.3",
        platform: "Windows",
        permissions,
        seenAt: 1_000,
      });
      state.activeNotebookId = notebook.notebookId;

      const server = await createBunHttpApp({ state, port: 0 });
      servers.push(server);
      const base = `http://127.0.0.1:${server.port}`;

      await fetch(`${base}/status`);
      expect(state.agents.get("agent-1")?.offline).toBe(true);
      expect(state.notebooks.get(notebook.notebookId)?.stale).toBe(true);

      const response = await fetch(`${base}/agents/agent-1/next-request`);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "NO_LIVE_AGENT" } });
      const refreshed = await fetch(`${base}/notebooks`);
      expect(refreshed.status).toBe(200);
      await expect(refreshed.json()).resolves.toEqual({ notebooks: [], activeNotebookId: null });
      expect(state.activeNotebookId).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns JSON 404 for unknown routes", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/unknown`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("rejects malformed, null, array, and missing-field JSON bodies with BAD_REQUEST", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const base = `http://127.0.0.1:${server.port}`;

    const malformed = await fetch(`${base}/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not valid json {{{",
    });

    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ error: { code: "BAD_REQUEST" } });

    const nullBody = await fetch(`${base}/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });

    expect(nullBody.status).toBe(400);
    await expect(nullBody.json()).resolves.toMatchObject({ error: { code: "BAD_REQUEST" } });

    const arrayBody = await fetch(`${base}/notebooks/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "[]",
    });

    expect(arrayBody.status).toBe(400);
    await expect(arrayBody.json()).resolves.toMatchObject({ error: { code: "BAD_REQUEST" } });

    const missingField = await fetch(`${base}/notebooks/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        frontendObjectKey: "fe-1",
        displayName: "未命名-2",
        windowTitle: "未命名-2",
        wolframVersion: "13.3",
        platform: "Windows",
        permissions,
        seenAt: 1100,
      }),
    });

    expect(missingField.status).toBe(400);
    await expect(missingField.json()).resolves.toMatchObject({ error: { code: "BAD_REQUEST" } });
  });

  it("rejects oversized JSON bodies with PAYLOAD_TOO_LARGE", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const largeValue = "x".repeat(1024 * 1024);
    const response = await fetch(`http://127.0.0.1:${server.port}/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentSessionId: largeValue,
        wolframVersion: "13.3",
        platform: "Windows",
        seenAt: 1000,
      }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
  });

  it("rejects oversized JSON bodies through the fetch handler with PAYLOAD_TOO_LARGE", async () => {
    const state = new BackendState(() => "notebook-1");
    const handler = createFetchHandler(state);

    const largeValue = "x".repeat(1024 * 1024);
    const response = await handler(
      new Request("http://127.0.0.1/agents/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentSessionId: largeValue,
          wolframVersion: "13.3",
          platform: "Windows",
          seenAt: 1000,
        }),
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
  });

  it("lets an agent claim a queued request and post a success result", async () => {
    const now = Date.now();
    const state = new BackendState(() => "notebook-1");
    state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: now });
    state.queue.enqueue({
      requestId: "r1",
      tool: "mma_list_cells",
      arguments: {},
      targetNotebookId: "n1",
      agentSessionId: "agent-1",
      timeoutMs: 5000,
      createdAt: now,
    });

    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const base = `http://127.0.0.1:${server.port}`;

    const nextResponse = await fetch(`${base}/agents/agent-1/next-request`);
    expect(nextResponse.status).toBe(200);
    await expect(nextResponse.json()).resolves.toEqual({
      request: expect.objectContaining({
        requestId: "r1",
        status: "running",
        claimedAt: expect.any(Number),
      }),
      cancelRequests: [],
    });

    expect(state.queue.get("r1")).toMatchObject({ status: "running", claimedAt: expect.any(Number) });

    const resultResponse = await fetch(`${base}/requests/r1/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, result: { cells: [] } }),
    });

    expect(resultResponse.status).toBe(200);
    await expect(resultResponse.json()).resolves.toEqual({ accepted: true, late: false });
    expect(state.queue.get("r1")).toMatchObject({ status: "succeeded" });
  });

  it("serves queued requests as UTF-8 JSON for Unicode cell content", async () => {
    const now = Date.now();
    const state = new BackendState(() => "notebook-1");
    state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: now });
    state.queue.enqueue({
      requestId: "r-unicode",
      tool: "mma_insert_cell",
      arguments: { content: "中文测试 😀 αβγ", style: "Text" },
      targetNotebookId: "notebook-1",
      agentSessionId: "agent-1",
      timeoutMs: 5000,
      createdAt: now,
    });

    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/agents/agent-1/next-request`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const bodyText = await response.text();
    expect(bodyText).toContain("\\u4e2d\\u6587\\u6d4b\\u8bd5");
    expect(bodyText).not.toContain("中文测试");
    expect(JSON.parse(bodyText)).toMatchObject({
      request: {
        requestId: "r-unicode",
        arguments: { content: "中文测试 😀 αβγ", style: "Text" },
      },
    });
  });

  it("marks expired queued requests timed out before next-request claims", async () => {
    const state = new BackendState(() => "notebook-1");
    const now = Date.now();
    state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: now });
    state.queue.enqueue({
      requestId: "r1",
      tool: "mma_list_cells",
      arguments: {},
      targetNotebookId: "n1",
      agentSessionId: "agent-1",
      timeoutMs: 5_000,
      createdAt: now - 5_001,
    });

    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/agents/agent-1/next-request`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ request: null, cancelRequests: [] });
    expect(state.queue.get("r1")).toMatchObject({ status: "timed_out" });
  });

  it("delivers cancellation notices once and then clears them", async () => {
    const state = new BackendState(() => "notebook-1");
    const now = Date.now();
    state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: now });
    state.queue.enqueue({
      requestId: "r1",
      tool: "mma_list_cells",
      arguments: {},
      targetNotebookId: "n1",
      agentSessionId: "agent-1",
      timeoutMs: 5000,
      createdAt: now,
    });
    state.queue.cancel("r1", "USER_CANCELLED", 1500);

    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const base = `http://127.0.0.1:${server.port}`;

    const first = await fetch(`${base}/agents/agent-1/next-request`);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ request: null, cancelRequests: [{ requestId: "r1", reason: "USER_CANCELLED" }] });

    const second = await fetch(`${base}/agents/agent-1/next-request`);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({ request: null, cancelRequests: [] });
  });

  it("returns late for results posted after timeout", async () => {
    const state = new BackendState(() => "notebook-1");
    state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
    state.queue.enqueue({
      requestId: "r1",
      tool: "mma_list_cells",
      arguments: {},
      targetNotebookId: "n1",
      agentSessionId: "agent-1",
      timeoutMs: 5000,
      createdAt: 1000,
    });

    state.queue.markTimedOut(7000);

    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/requests/r1/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, result: { cells: [] } }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: false, late: true });
    expect(state.queue.get("r1")).toMatchObject({ status: "timed_out" });
  });

  it("marks expired running requests timed out before result handling", async () => {
    const now = 1_000_000;
    const state = new BackendState(() => "notebook-1");
    state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: now });
    state.queue.enqueue({
      requestId: "r1",
      tool: "mma_list_cells",
      arguments: {},
      targetNotebookId: "n1",
      agentSessionId: "agent-1",
      timeoutMs: 5_000,
      createdAt: now - 5_001,
    });

    state.queue.claimNext("agent-1", now);

    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/requests/r1/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, result: { cells: [] } }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: false, late: true });
    expect(state.queue.get("r1")).toMatchObject({ status: "timed_out" });
  });

  it("marks failures and unknown request results as unaccepted", async () => {
    const now = Date.now();
    const state = new BackendState(() => "notebook-1");
    state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: now });
    state.queue.enqueue({
      requestId: "r1",
      tool: "mma_list_cells",
      arguments: {},
      targetNotebookId: "n1",
      agentSessionId: "agent-1",
      timeoutMs: 5000,
      createdAt: now,
    });

    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const base = `http://127.0.0.1:${server.port}`;

    const failure = await fetch(`${base}/requests/r1/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: "WOLFRAM_AGENT_ERROR" }),
    });

    expect(failure.status).toBe(200);
    await expect(failure.json()).resolves.toEqual({ accepted: true, late: false });
    expect(state.queue.get("r1")).toMatchObject({ status: "failed" });

    const unknown = await fetch(`${base}/requests/missing/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, result: { cells: [] } }),
    });

    expect(unknown.status).toBe(200);
    await expect(unknown.json()).resolves.toEqual({ accepted: false, late: false });
  });

  it("accepts optional agent scope fields on registration and returns them in status", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const base = `http://127.0.0.1:${server.port}`;
    const now = Date.now();

    const registerResponse = await fetch(`${base}/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentSessionId: "agent-scoped",
        wolframVersion: "14.3",
        platform: "Windows",
        seenAt: now,
        machineId: "machine-abc",
        frontendSessionId: "fe-session-1",
        wolframProcessId: "proc-42",
      }),
    });

    expect(registerResponse.status).toBe(200);
    await expect(registerResponse.json()).resolves.toMatchObject({
      agent: {
        agentSessionId: "agent-scoped",
        machineId: "machine-abc",
        frontendSessionId: "fe-session-1",
        wolframProcessId: "proc-42",
      },
    });

    const statusResponse = await fetch(`${base}/status`);
    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toMatchObject({
      server: { state: "running" },
      agents: [
        expect.objectContaining({
          agentSessionId: "agent-scoped",
          machineId: "machine-abc",
          frontendSessionId: "fe-session-1",
          wolframProcessId: "proc-42",
        }),
      ],
    });
  });

  it("accepts registration without scope fields and omits them from status", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const base = `http://127.0.0.1:${server.port}`;
    const now = Date.now();

    await fetch(`${base}/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentSessionId: "agent-plain",
        wolframVersion: "13.3",
        platform: "Windows",
        seenAt: now,
      }),
    });

    const statusResponse = await fetch(`${base}/status`);
    expect(statusResponse.status).toBe(200);
    const body = await statusResponse.json();
    const agent = body.agents.find((a: { agentSessionId: string }) => a.agentSessionId === "agent-plain");
    expect(agent).toBeDefined();
    expect(agent.machineId).toBeUndefined();
    expect(agent.frontendSessionId).toBeUndefined();
    expect(agent.wolframProcessId).toBeUndefined();
  });

  it("returns late for results from cancelled running requests and keeps them cancelled", async () => {
    const state = new BackendState(() => "notebook-1");
    state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1000 });
    state.queue.enqueue({
      requestId: "r1",
      tool: "mma_list_cells",
      arguments: {},
      targetNotebookId: "n1",
      agentSessionId: "agent-1",
      timeoutMs: 5000,
      createdAt: 1000,
    });

    state.queue.claimNext("agent-1", 1500);
    state.queue.cancel("r1", "USER_CANCELLED", 1600);

    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/requests/r1/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, result: { cells: [] } }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: false, late: true });
    expect(state.queue.get("r1")).toMatchObject({ status: "cancelled" });
  });

  describe("Phase 13.1 dashboard productization", () => {
    it("dashboard HTML includes module titles and shared detail panel structure", async () => {
      const state = new BackendState(() => "notebook-1");
      const server = await createBunHttpApp({ state, port: 0 });
      servers.push(server);

      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      // Module titles for the diagnostic overview grid
      for (const title of ["Server", "Security", "Agents", "Notebooks", "Requests"]) {
        expect(html).toContain(title);
      }

      // Shared detail panel below the grid
      expect(html).toContain("detail-panel");
      expect(html).toContain("detail-title");
      expect(html).toContain("Collapse");

      // Accessible affordances
      expect(html).toContain("aria-controls");
      expect(html).toContain("aria-expanded");

      // Token must never appear as a literal in the HTML
      expect(html).not.toMatch(/secret-token/);
      expect(html).not.toMatch(/authToken\s*[:=]\s*["'][^"']+["']/);

      // JS functions for the below-grid detail panel
      expect(html).toMatch(/openDetail|activeDetail/);
    });

    it("dashboard HTML keeps auth gate with token extraction and no-fetch-before-token guard", async () => {
      const state = new BackendState(() => "notebook-1");
      const server = await createBunHttpApp({ state, port: 0 });
      servers.push(server);

      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      // Auth gate messaging
      expect(html).toContain("Missing dashboard token");

      // Token extraction from URL fragment
      expect(html).toContain("location.hash");

      // Authorization Bearer header construction
      expect(html).toMatch(/Bearer\s+\$\{?token\}?/);

      // requireDashboardToken guard prevents fetch before token
      expect(html).toContain("requireDashboardToken");
    });

    it("/status with a configured auth token returns diagnostics metadata", async () => {
      const state = new BackendState(() => "notebook-1");
      const now = Date.now();

      // Register an agent and enqueue a request so queue snapshot is populated
      state.agents.register({ agentSessionId: "agent-1", wolframVersion: "14.3", platform: "Windows", seenAt: now });
      state.queue.enqueue({
        requestId: "r-queued",
        tool: "mma_list_cells",
        arguments: {},
        targetNotebookId: "n1",
        agentSessionId: "agent-1",
        timeoutMs: 5000,
        createdAt: now,
      });

      const server = await createBunHttpApp({
        state,
        host: "127.0.0.1",
        port: 0,
        authToken: "secret-token",
        version: "0.1.0",
      });
      servers.push(server);

      const base = `http://127.0.0.1:${server.port}`;
      const response = await fetch(`${base}/status`, {
        headers: { authorization: "Bearer secret-token" },
      });

      expect(response.status).toBe(200);
      const body = await response.json();

      // Server metadata
      expect(body.server).toBeDefined();
      expect(body.server.state ?? body.server).toEqual(expect.stringMatching(/running/));
      expect(body.server.version).toBe("0.1.0");
      expect(body.server.pid).toEqual(expect.any(Number));
      expect(body.server.host).toBe("127.0.0.1");
      expect(body.server.port).toEqual(expect.any(Number));
      expect(body.server.uptimeMs ?? body.server.uptime).toEqual(expect.any(Number));

      // Security metadata
      expect(body.security).toBeDefined();
      expect(body.security.authEnabled).toBe(true);
      expect(body.security.dashboardTokenPresent).toBe(true);

      // Requests queue snapshot
      expect(body.requests).toBeDefined();
      expect(body.requests.queued).toEqual(expect.any(Number));
      expect(body.requests.running).toEqual(expect.any(Number));
      expect(body.requests.timed_out).toEqual(expect.any(Number));
      expect(body.requests.cancelled).toEqual(expect.any(Number));
      expect(body.requests.latestRequestIds).toEqual(expect.any(Array));
      expect(body.requests.latestRequestIds).toContain("r-queued");
    });

    it("/status without authToken reports security.authEnabled false and dashboardTokenPresent false", async () => {
      const state = new BackendState(() => "notebook-1");
      const server = await createBunHttpApp({ state, port: 0 });
      servers.push(server);

      const response = await fetch(`http://127.0.0.1:${server.port}/status`);
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.security).toBeDefined();
      expect(body.security.authEnabled).toBe(false);
      expect(body.security.dashboardTokenPresent).toBe(false);
    });
  });

  describe("Phase 8.1 degraded HTTP endpoints", () => {
    it("dashboard HTML mentions degraded agent status", async () => {
      const state = new BackendState(() => "notebook-1");
      const server = await createBunHttpApp({ state, port: 0 });
      servers.push(server);

      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      const html = await response.text();

      expect(html).toContain("degraded");
    });

    it("shows degraded agents and notebooks in /status and /notebooks at 10s gap", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(11_000);
      try {
        const state = new BackendState(() => "notebook-1");
        state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1_000 });
        const notebook = state.notebooks.upsertHeartbeat({
          agentSessionId: "agent-1",
          frontendObjectKey: "fe-1",
          displayName: "demo.nb",
          windowTitle: "demo.nb",
          wolframVersion: "13.3",
          platform: "Windows",
          permissions,
          seenAt: 1_000,
        });
        state.activeNotebookId = notebook.notebookId;

        const server = await createBunHttpApp({ state, port: 0 });
        servers.push(server);
        const base = `http://127.0.0.1:${server.port}`;

        const statusResponse = await fetch(`${base}/status`);
        expect(statusResponse.status).toBe(200);
        const statusBody = await statusResponse.json();
        const agent = statusBody.agents.find((a: { agentSessionId: string }) => a.agentSessionId === "agent-1");
        expect(agent?.status).toBe("degraded");
        expect(agent?.degraded).toBe(true);

        const notebooksResponse = await fetch(`${base}/notebooks`);
        expect(notebooksResponse.status).toBe(200);
        const notebooksBody = await notebooksResponse.json();
        expect(notebooksBody.notebooks).toHaveLength(1);
        expect(notebooksBody.notebooks[0]?.status).toBe("degraded");
      } finally {
        vi.useRealTimers();
      }
    });

    it("allows next-request claim for degraded agents", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(11_000);
      try {
        const state = new BackendState(() => "notebook-1");
        state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1_000 });
        state.queue.enqueue({
          requestId: "r1",
          tool: "mma_list_cells",
          arguments: {},
          targetNotebookId: "n1",
          agentSessionId: "agent-1",
          timeoutMs: 5000,
          createdAt: 11_000,
        });

        const server = await createBunHttpApp({ state, port: 0 });
        servers.push(server);

        const response = await fetch(`http://127.0.0.1:${server.port}/agents/agent-1/next-request`);
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          request: expect.objectContaining({ requestId: "r1" }),
          cancelRequests: [],
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("rejects next-request for offline agents at 30s", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(31_000);
      try {
        const state = new BackendState(() => "notebook-1");
        state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1_000 });
        state.queue.enqueue({
          requestId: "r1",
          tool: "mma_list_cells",
          arguments: {},
          targetNotebookId: "n1",
          agentSessionId: "agent-1",
          timeoutMs: 5000,
          createdAt: 31_000,
        });

        const server = await createBunHttpApp({ state, port: 0 });
        servers.push(server);

        const response = await fetch(`http://127.0.0.1:${server.port}/agents/agent-1/next-request`);
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toMatchObject({ error: { code: "NO_LIVE_AGENT" } });
      } finally {
        vi.useRealTimers();
      }
    });

    it("accepts notebook heartbeat from degraded agent", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(11_000);
      try {
        const state = new BackendState(() => "notebook-1");
        state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 1_000 });

        const server = await createBunHttpApp({ state, port: 0 });
        servers.push(server);
        const base = `http://127.0.0.1:${server.port}`;

        const heartbeatResponse = await fetch(`${base}/notebooks/heartbeat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            agentSessionId: "agent-1",
            frontendObjectKey: "fe-1",
            displayName: "demo.nb",
            windowTitle: "demo.nb",
            wolframVersion: "13.3",
            platform: "Windows",
            permissions,
            seenAt: 11_000,
          }),
        });

        expect(heartbeatResponse.status).toBe(200);
        await expect(heartbeatResponse.json()).resolves.toMatchObject({
          notebook: expect.objectContaining({ agentSessionId: "agent-1" }),
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
