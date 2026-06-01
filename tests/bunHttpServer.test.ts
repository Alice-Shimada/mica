import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendState } from "../src/backend/backendState.js";
import { createBunHttpApp, createFetchHandler } from "../src/bun/httpServer.js";

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

describe("Bun HTTP app", () => {
  it("serves a local dashboard shell", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/`);
    const html = await response.text();

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("MMA Agent Bridge");
    expect(html).toContain("Notebook Registry");
    expect(html).toContain("Request Queue");
    expect(html).toContain("Diagnostics");
    expect(html).toContain("/status");
    expect(html).toContain("/notebooks");
    expect(html).toContain("refreshInFlight");
    expect(html).toContain("setTimeout");
  });

  it("binds the HTTP server to a configured host", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, host: "127.0.0.1", port: 0 });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/status`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ server: "running" });
  });

  it("reports status, registers agents, and lists notebooks", async () => {
    const state = new BackendState(() => "notebook-1");
    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);

    const base = `http://127.0.0.1:${server.port}`;
    const now = Date.now();

    const statusResponse = await fetch(`${base}/status`);
    expect(statusResponse.headers.get("content-type")).toBe("application/json; charset=utf-8");
    await expect(statusResponse.json()).resolves.toEqual({
      server: "running",
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

  it("reports superseded retired agents distinctly from no-notebook retirements", async () => {
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

    expect(heartbeatResponse.status).toBe(404);
    await expect(heartbeatResponse.json()).resolves.toMatchObject({ error: { code: "NO_LIVE_AGENT", reason: "superseded" } });
  });

  it("rejects notebook heartbeat from a retired agent with 404 and keeps notebooks stale", async () => {
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
        frontendObjectKey: "fe-old-2",
        displayName: "old.nb",
        windowTitle: "old.nb",
        wolframVersion: "13.3",
        platform: "Windows",
        permissions,
        seenAt: 3000,
      }),
    });

    expect(heartbeatResponse.status).toBe(404);
    await expect(heartbeatResponse.json()).resolves.toMatchObject({ error: { code: "NO_LIVE_AGENT" } });
    expect(state.notebooks.get(notebook.notebookId)?.stale).toBe(true);
    expect(state.notebooks.listLive()).toEqual([]);
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

  it("rejects next-request for missing offline and retired agents without claiming work", async () => {
    const state = new BackendState(() => "notebook-1");
    const now = Date.now();
    state.agents.register({ agentSessionId: "agent-old", wolframVersion: "13.3", platform: "Windows", seenAt: now });
    state.queue.enqueue({ requestId: "r1", tool: "mma_list_cells", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-old", timeoutMs: 5000, createdAt: now });
    state.agents.markOfflineOlderThan(now + 5000, 1000);
    state.agents.register({ agentSessionId: "agent-new", wolframVersion: "13.3", platform: "Windows", seenAt: now + 5000 });

    const server = await createBunHttpApp({ state, port: 0 });
    servers.push(server);
    const base = `http://127.0.0.1:${server.port}`;

    const retired = await fetch(`${base}/agents/agent-old/next-request`);
    expect(retired.status).toBe(404);
    await expect(retired.json()).resolves.toMatchObject({ error: { code: "NO_LIVE_AGENT" } });
    expect(state.queue.get("r1")?.status).not.toBe("running");

    const missing = await fetch(`${base}/agents/missing/next-request`);
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: { code: "NO_LIVE_AGENT" } });

    const live = await fetch(`${base}/agents/agent-new/next-request`);
    expect(live.status).toBe(200);
  });

  it("sweeps before next-request and does not claim if the agent just went stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    try {
      const state = new BackendState(() => "notebook-1");
      state.agents.register({ agentSessionId: "agent-1", wolframVersion: "13.3", platform: "Windows", seenAt: 6_000 });
      state.queue.enqueue({
        requestId: "r1",
        tool: "mma_list_cells",
        arguments: {},
        targetNotebookId: "n1",
        agentSessionId: "agent-1",
        timeoutMs: 5000,
        createdAt: 10_000,
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
    vi.setSystemTime(5_000);
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
});
