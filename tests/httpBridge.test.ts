import { afterEach, describe, expect, it } from "vitest";
import { RequestQueue } from "../src/bridge/requestQueue.js";
import { HttpBridge } from "../src/bridge/httpBridge.js";

const servers: HttpBridge[] = [];

async function startBridge() {
  const queue = new RequestQueue();
  const bridge = new HttpBridge(queue, { host: "127.0.0.1", port: 0 });
  servers.push(bridge);
  await bridge.start();
  return { queue, bridge, baseUrl: `http://127.0.0.1:${bridge.port}` };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe("HttpBridge", () => {
  it("reports status", async () => {
    const { baseUrl } = await startBridge();

    const response = await fetch(`${baseUrl}/status`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.server).toBe("running");
    expect(body.notebookAttached).toBe(false);
    expect(body.paletteConnected).toBe(false);
    expect(body.pendingRequests).toBe(0);
  });

  it("attaches notebook metadata", async () => {
    const { baseUrl } = await startBridge();

    const response = await fetch(`${baseUrl}/attach`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        notebookTitle: "demo.nb",
        wolframVersion: "13.3",
        permissions: {
          ReadNotebook: true,
          InsertCell: false,
          ModifyCell: false,
          DeleteCell: false,
          RunCell: false,
          SaveNotebook: false
        }
      })
    });

    expect(response.status).toBe(200);

    const status = await fetch(`${baseUrl}/status`).then((r) => r.json());
    expect(status.notebookAttached).toBe(true);
    expect(status.paletteConnected).toBe(true);
    expect(status.attachedNotebook.notebookTitle).toBe("demo.nb");
    expect(status.attachedNotebook.wolframVersion).toBe("13.3");
    expect(status.permissions.ReadNotebook).toBe(true);
    expect(status.permissions.InsertCell).toBe(false);
  });

  it("updates status permissions from /permissions", async () => {
    const { baseUrl } = await startBridge();

    const response = await fetch(`${baseUrl}/permissions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        permissions: {
          ReadNotebook: true,
          InsertCell: true,
          ModifyCell: false,
          DeleteCell: false,
          RunCell: true,
          SaveNotebook: false
        }
      })
    });

    expect(response.status).toBe(200);

    const status = await fetch(`${baseUrl}/status`).then((r) => r.json());
    expect(status.permissions).toEqual({
      ReadNotebook: true,
      InsertCell: true,
      ModifyCell: false,
      DeleteCell: false,
      RunCell: true,
      SaveNotebook: false
    });
  });

  it("serves queued requests and accepts results", async () => {
    const { queue, baseUrl } = await startBridge();
    const pending = queue.enqueue("mma_list_cells", {});

    const requestBody = await fetch(`${baseUrl}/requests`).then((r) => r.json());
    expect(requestBody.request.tool).toBe("mma_list_cells");
    expect(requestBody.request.state).toBe("claimed");

    const resultResponse = await fetch(`${baseUrl}/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: requestBody.request.requestId, ok: true, result: { cells: [] } })
    });

    expect(resultResponse.status).toBe(200);
    await expect(pending).resolves.toEqual({ cells: [] });
  });

  it("returns null when no requests are queued", async () => {
    const { baseUrl } = await startBridge();

    const body = await fetch(`${baseUrl}/requests`).then((r) => r.json());
    expect(body.request).toBeNull();
  });

  it("accepts Palette-originated cancellation", async () => {
    const { queue, baseUrl } = await startBridge();
    const pending = queue.enqueue("mma_run_cell", { cellId: "cell_1" });
    const rejected = expect(pending).rejects.toThrow("USER_CANCELLED_IN_PALETTE");
    const requestBody = await fetch(`${baseUrl}/requests`).then((r) => r.json());

    const response = await fetch(`${baseUrl}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: requestBody.request.requestId, reason: "USER_CANCELLED_IN_PALETTE" })
    });

    expect(response.status).toBe(200);
    await rejected;
  });

  it("returns 404 for unknown requestId on cancel", async () => {
    const { baseUrl } = await startBridge();

    const response = await fetch(`${baseUrl}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "nonexistent", reason: "USER_CANCELLED_IN_PALETTE" })
    });

    expect(response.status).toBe(404);
  });

  it("returns 400 when cancel is missing requestId", async () => {
    const { baseUrl } = await startBridge();

    const response = await fetch(`${baseUrl}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "no id" })
    });

    expect(response.status).toBe(400);
  });

  it("exposes MCP-originated cancellations via /cancellations", async () => {
    const { queue, baseUrl } = await startBridge();
    const pending = queue.enqueue("mma_run_cell", { cellId: "cell_1" });
    const rejected = expect(pending).rejects.toThrow("stop running cell");
    const claimed = queue.claimNext();
    queue.cancelFromMcp(claimed!.requestId, "stop running cell");

    const response = await fetch(`${baseUrl}/cancellations`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.cancelRequests).toEqual([
      { requestId: claimed!.requestId, reason: "stop running cell" }
    ]);
    await rejected;

    // One-shot: second poll returns empty.
    const second = await fetch(`${baseUrl}/cancellations`).then((r) => r.json());
    expect(second.cancelRequests).toEqual([]);
  });

  it("returns empty cancellations when none are pending", async () => {
    const { baseUrl } = await startBridge();

    const response = await fetch(`${baseUrl}/cancellations`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.cancelRequests).toEqual([]);
  });

  it("returns 404 for unknown endpoints", async () => {
    const { baseUrl } = await startBridge();

    const response = await fetch(`${baseUrl}/unknown`);
    expect(response.status).toBe(404);
  });

  it("reports pending request count in status", async () => {
    const { queue, baseUrl } = await startBridge();
    const first = queue.enqueue("mma_list_cells", {});
    const second = queue.enqueue("mma_read_cell", { cellId: "cell_1" });
    const firstRejected = expect(first).rejects.toThrow("test cleanup");
    const secondRejected = expect(second).rejects.toThrow("test cleanup");

    const status = await fetch(`${baseUrl}/status`).then((r) => r.json());
    expect(status.pendingRequests).toBe(2);

    queue.drain("test cleanup");
    await firstRejected;
    await secondRejected;
  });

  it("upserts notebooks and lists the active notebook in status", async () => {
    const { baseUrl } = await startBridge();

    const upsertResponse = await fetch(`${baseUrl}/notebooks/upsert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notebookId: "nb_1", notebookTitle: "demo.nb" })
    });

    expect(upsertResponse.status).toBe(200);
    await expect(upsertResponse.json()).resolves.toEqual({ ok: true, activeNotebookId: "nb_1" });

    const listResponse = await fetch(`${baseUrl}/notebooks`);
    await expect(listResponse.json()).resolves.toEqual({
      notebooks: [expect.objectContaining({ notebookId: "nb_1", notebookTitle: "demo.nb" })],
      activeNotebookId: "nb_1"
    });

    const status = await fetch(`${baseUrl}/status`).then((r) => r.json());
    expect(status.notebookAttached).toBe(true);
    expect(status.activeNotebookId).toBe("nb_1");
    expect(status.notebooks).toHaveLength(1);
  });

  it("selects a registered notebook and rejects unknown notebook selection", async () => {
    const { baseUrl } = await startBridge();

    await fetch(`${baseUrl}/notebooks/upsert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notebookId: "nb_1" })
    });

    const selectResponse = await fetch(`${baseUrl}/notebooks/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notebookId: "nb_1" })
    });

    expect(selectResponse.status).toBe(200);
    await expect(selectResponse.json()).resolves.toEqual({ ok: true, activeNotebookId: "nb_1" });

    const missingResponse = await fetch(`${baseUrl}/notebooks/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notebookId: "missing" })
    });

    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toMatchObject({ error: { code: "NOTEBOOK_NOT_FOUND" } });
  });

  it("polls status, cancellations, and the next request together", async () => {
    const { queue, baseUrl } = await startBridge();
    await fetch(`${baseUrl}/notebooks/upsert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notebookId: "nb_1" })
    });
    queue.enqueue("mma_list_cells", {});

    const response = await fetch(`${baseUrl}/poll?paletteId=palette_1&activeNotebookId=nb_1`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status.transportMode).toBe("main-kernel");
    expect(body.status.executorState).toBe("running");
    expect(body.status.activeNotebookId).toBe("nb_1");
    expect(body.request?.tool).toBe("mma_list_cells");
    expect(body.cancelRequests).toEqual([]);

    await fetch(`${baseUrl}/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: body.request.requestId, ok: true, result: {} })
    });
  });

  it("accepts failure results", async () => {
    const { queue, baseUrl } = await startBridge();
    const pending = queue.enqueue("mma_read_cell", { cellId: "cell_1" });
    const rejected = expect(pending).rejects.toThrow("WOLFRAM_ERROR: kernel unavailable");
    const requestBody = await fetch(`${baseUrl}/requests`).then((r) => r.json());

    const resultResponse = await fetch(`${baseUrl}/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: requestBody.request.requestId,
        ok: false,
        error: { code: "WOLFRAM_ERROR", message: "kernel unavailable" }
      })
    });

    expect(resultResponse.status).toBe(200);
    await rejected;
  });

  it("returns 404 when posting result for unknown requestId", async () => {
    const { baseUrl } = await startBridge();

    const response = await fetch(`${baseUrl}/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "nonexistent",
        ok: true,
        result: {}
      })
    });

    expect(response.status).toBe(404);
  });

  it("stop drains the queue and rejects pending promises", async () => {
    const queue = new RequestQueue();
    const bridge = new HttpBridge(queue, { host: "127.0.0.1", port: 0 });
    await bridge.start();

    const pending = queue.enqueue("mma_list_cells", {});
    const rejected = expect(pending).rejects.toThrow("HTTP bridge stopped");

    await bridge.stop();

    await rejected;
  });

  it("returns 413 for oversized POST body", async () => {
    const { baseUrl } = await startBridge();

    const bigBody = "x".repeat(2 * 1024 * 1024); // 2 MiB
    const response = await fetch(`${baseUrl}/attach`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: bigBody
    });

    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("returns 400 for malformed JSON POST body", async () => {
    const { baseUrl } = await startBridge();

    const response = await fetch(`${baseUrl}/attach`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not valid json {{{"
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("returns 400 for empty /attach body and does not set notebookAttached", async () => {
    const { baseUrl } = await startBridge();

    const response = await fetch(`${baseUrl}/attach`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("BAD_REQUEST");

    // notebookAttached must remain false.
    const status = await fetch(`${baseUrl}/status`).then((r) => r.json());
    expect(status.notebookAttached).toBe(false);
  });

  it("paletteConnected is true after /requests poll refreshes heartbeat", async () => {
    const { baseUrl } = await startBridge();

    // Poll /requests to record a heartbeat.
    await fetch(`${baseUrl}/requests`);

    const status = await fetch(`${baseUrl}/status`).then((r) => r.json());
    expect(status.paletteConnected).toBe(true);
  });

  it("paletteConnected expires after stale timeout with no heartbeat", async () => {
    const queue = new RequestQueue();
    const bridge = new HttpBridge(queue, {
      host: "127.0.0.1",
      port: 0,
      paletteStaleTimeoutMs: 50
    });
    servers.push(bridge);
    await bridge.start();
    const baseUrl = `http://127.0.0.1:${bridge.port}`;

    // Record a heartbeat via /requests.
    await fetch(`${baseUrl}/requests`);
    let status = await fetch(`${baseUrl}/status`).then((r) => r.json());
    expect(status.paletteConnected).toBe(true);

    // Wait for the heartbeat to expire.
    await new Promise((resolve) => setTimeout(resolve, 100));

    status = await fetch(`${baseUrl}/status`).then((r) => r.json());
    expect(status.paletteConnected).toBe(false);
  });

  it("paletteConnected stays true with repeated /requests polls", async () => {
    const queue = new RequestQueue();
    const bridge = new HttpBridge(queue, {
      host: "127.0.0.1",
      port: 0,
      paletteStaleTimeoutMs: 100
    });
    servers.push(bridge);
    await bridge.start();
    const baseUrl = `http://127.0.0.1:${bridge.port}`;

    // Poll every 30ms for 150ms — should stay connected.
    for (let i = 0; i < 5; i++) {
      await fetch(`${baseUrl}/requests`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }

    const status = await fetch(`${baseUrl}/status`).then((r) => r.json());
    expect(status.paletteConnected).toBe(true);
  });
});
