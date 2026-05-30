import { describe, expect, it } from "vitest";
import { RequestQueue } from "../src/bridge/requestQueue.js";

describe("RequestQueue", () => {
  it("enqueues and claims one request at a time", () => {
    const queue = new RequestQueue();
    const pending = queue.enqueue("mma_list_cells", {});

    const claimed = queue.claimNext();

    expect(claimed?.tool).toBe("mma_list_cells");
    expect(claimed?.state).toBe("claimed");
    expect(queue.claimNext()).toBeNull();

    queue.resolveSuccess(claimed!.requestId, { cells: [] });
    return expect(pending).resolves.toEqual({ cells: [] });
  });

  it("cancels queued requests before Palette claims them", async () => {
    const queue = new RequestQueue();
    const pending = queue.enqueue("mma_read_cell", { cellId: "cell_1" });
    const requestId = queue.peekQueued()[0]!.requestId;

    queue.cancelFromMcp(requestId, "client cancelled");

    await expect(pending).rejects.toThrow("client cancelled");
    expect(queue.claimNext()).toBeNull();
  });

  it("rejects promise and stores one-shot notification when MCP cancels a claimed request", async () => {
    const queue = new RequestQueue();
    const pending = queue.enqueue("mma_run_cell", { cellId: "cell_1" });
    const claimed = queue.claimNext();

    queue.cancelFromMcp(claimed!.requestId, "stop running cell");

    // Promise must be rejected so the MCP call terminates.
    await expect(pending).rejects.toThrow("stop running cell");

    // One-shot notification is available for the Palette.
    expect(queue.listCancellations()).toEqual([
      { requestId: claimed!.requestId, reason: "stop running cell" }
    ]);

    // Notification is cleared after first read — no duplicate reporting.
    expect(queue.listCancellations()).toEqual([]);
  });

  it("lets Palette-originated cancellation reject the MCP call", async () => {
    const queue = new RequestQueue();
    const pending = queue.enqueue("mma_run_cell", { cellId: "cell_1" });
    const claimed = queue.claimNext();

    queue.cancelFromPalette(claimed!.requestId, "USER_CANCELLED_IN_PALETTE");

    await expect(pending).rejects.toThrow("USER_CANCELLED_IN_PALETTE");
  });

  it("Palette cancellation of a queued request rejects, clears queue, and stores no notification", async () => {
    const queue = new RequestQueue();
    const pending = queue.enqueue("mma_read_cell", { cellId: "cell_1" });
    const requestId = queue.peekQueued()[0]!.requestId;

    queue.cancelFromPalette(requestId, "USER_CANCELLED_IN_PALETTE");

    await expect(pending).rejects.toThrow("USER_CANCELLED_IN_PALETTE");
    expect(queue.claimNext()).toBeNull();
    expect(queue.listCancellations()).toEqual([]);
  });

  it("processes requests in FIFO order", async () => {
    const queue = new RequestQueue();
    const p1 = queue.enqueue("mma_list_cells", {});
    const p2 = queue.enqueue("mma_read_cell", { cellId: "cell_1" });
    const p3 = queue.enqueue("mma_run_cell", { cellId: "cell_2" });

    const c1 = queue.claimNext();

    expect(c1?.tool).toBe("mma_list_cells");
    expect(queue.claimNext()).toBeNull();

    queue.resolveSuccess(c1!.requestId, { cells: [] });

    const c2 = queue.claimNext();
    expect(c2?.tool).toBe("mma_read_cell");
    expect(queue.claimNext()).toBeNull();

    queue.resolveSuccess(c2!.requestId, { content: "x" });

    const c3 = queue.claimNext();
    expect(c3?.tool).toBe("mma_run_cell");

    queue.resolveSuccess(c3!.requestId, { status: "started" });

    await expect(p1).resolves.toEqual({ cells: [] });
    await expect(p2).resolves.toEqual({ content: "x" });
    await expect(p3).resolves.toEqual({ status: "started" });
  });

  it("resolveFailure rejects with the expected error", async () => {
    const queue = new RequestQueue();
    const pending = queue.enqueue("mma_read_cell", { cellId: "cell_1" });
    const claimed = queue.claimNext();

    queue.resolveFailure(claimed!.requestId, "WOLFRAM_ERROR", "kernel unavailable");

    await expect(pending).rejects.toThrow("WOLFRAM_ERROR: kernel unavailable");
  });

  it("pendingCount reflects queued and claimed requests", () => {
    const queue = new RequestQueue();
    expect(queue.pendingCount()).toBe(0);

    queue.enqueue("mma_list_cells", {});
    expect(queue.pendingCount()).toBe(1);

    queue.enqueue("mma_read_cell", { cellId: "cell_1" });
    expect(queue.pendingCount()).toBe(2);

    const claimed = queue.claimNext();
    expect(queue.pendingCount()).toBe(2); // 1 claimed + 1 queued

    queue.resolveSuccess(claimed!.requestId, { cells: [] });
    expect(queue.pendingCount()).toBe(1); // 1 queued remains
  });

  it("peekQueued returns only queued requests in FIFO order", () => {
    const queue = new RequestQueue();
    queue.enqueue("mma_list_cells", {});
    queue.enqueue("mma_read_cell", { cellId: "cell_1" });

    const queued = queue.peekQueued();
    expect(queued).toHaveLength(2);
    expect(queued[0].tool).toBe("mma_list_cells");
    expect(queued[1].tool).toBe("mma_read_cell");

    // Claim one — peekQueued should only show the remaining queued request.
    queue.claimNext();
    const afterClaim = queue.peekQueued();
    expect(afterClaim).toHaveLength(1);
    expect(afterClaim[0].tool).toBe("mma_read_cell");
  });

  it("returns false for operations on unknown or already-removed request IDs", () => {
    const queue = new RequestQueue();
    const pending = queue.enqueue("mma_list_cells", {});
    const claimed = queue.claimNext();

    // Unknown ID.
    expect(queue.resolveSuccess("nonexistent", {})).toBe(false);
    expect(queue.resolveFailure("nonexistent", "ERR", "msg")).toBe(false);
    expect(queue.cancelFromMcp("nonexistent", "reason")).toBe(false);
    expect(queue.cancelFromPalette("nonexistent", "reason")).toBe(false);

    // Already resolved — second call should return false.
    queue.resolveSuccess(claimed!.requestId, { cells: [] });
    expect(queue.resolveSuccess(claimed!.requestId, { cells: [] })).toBe(false);
    expect(queue.cancelFromMcp(claimed!.requestId, "late")).toBe(false);

    // Verify the original promise still resolved correctly.
    return expect(pending).resolves.toEqual({ cells: [] });
  });

  it("resolveSuccess returns false for queued (unclaimed) requests", async () => {
    const queue = new RequestQueue();
    const pending = queue.enqueue("mma_list_cells", {});
    const requestId = queue.peekQueued()[0]!.requestId;

    const result = queue.resolveSuccess(requestId, { cells: [] });
    expect(result).toBe(false);
    expect(queue.pendingCount()).toBe(1); // still queued, promise still pending

    // Clean up: drain to avoid hanging promise.
    queue.drain("test cleanup");
    await expect(pending).rejects.toThrow("test cleanup");
  });

  it("resolveFailure returns false for queued (unclaimed) requests", async () => {
    const queue = new RequestQueue();
    const pending = queue.enqueue("mma_read_cell", { cellId: "cell_1" });
    const requestId = queue.peekQueued()[0]!.requestId;

    const result = queue.resolveFailure(requestId, "ERR", "msg");
    expect(result).toBe(false);
    expect(queue.pendingCount()).toBe(1); // still queued, promise still pending

    queue.drain("test cleanup");
    await expect(pending).rejects.toThrow("test cleanup");
  });

  it("drain rejects all outstanding promises and clears state", async () => {
    const queue = new RequestQueue();
    const p1 = queue.enqueue("mma_list_cells", {});
    const p2 = queue.enqueue("mma_read_cell", { cellId: "cell_1" });
    queue.claimNext(); // claim p1, p2 stays queued

    queue.drain("bridge shutdown");

    await expect(p1).rejects.toThrow("bridge shutdown");
    await expect(p2).rejects.toThrow("bridge shutdown");
    expect(queue.pendingCount()).toBe(0);
    expect(queue.claimNext()).toBeNull();
  });

  it("drain clears one-shot cancellation notifications", () => {
    const queue = new RequestQueue();
    const pending = queue.enqueue("mma_run_cell", { cellId: "cell_1" });
    const rejected = expect(pending).rejects.toThrow("stop");
    const claimed = queue.claimNext();
    queue.cancelFromMcp(claimed!.requestId, "stop");
    // cancelFromMcp on claimed removes the call, stores one-shot notification.

    expect(queue.listCancellations()).toHaveLength(1);

    // drain on now-empty queue should still clear cancellations.
    queue.drain("cleanup");
    expect(queue.listCancellations()).toEqual([]);
    return rejected;
  });

  it("enqueueWithId returns requestId and promise", async () => {
    const queue = new RequestQueue();
    const { requestId, promise } = queue.enqueueWithId("mma_list_cells", {});

    expect(requestId).toMatch(/^req_\d+$/);

    const claimed = queue.claimNext();
    expect(claimed?.requestId).toBe(requestId);

    queue.resolveSuccess(claimed!.requestId, { cells: [] });
    await expect(promise).resolves.toEqual({ cells: [] });
  });

  it("runningRequestSnapshot reflects the claimed request", () => {
    const queue = new RequestQueue();
    queue.enqueue("mma_list_cells", {});

    const claimed = queue.claimNext();

    expect(queue.runningRequestSnapshot()).toEqual({
      requestId: claimed!.requestId,
      tool: "mma_list_cells",
      arguments: {},
      state: "claimed",
      createdAt: claimed!.createdAt,
      claimedAt: claimed!.claimedAt
    });
  });

  it("copies notebookId onto the request and running snapshot", () => {
    const queue = new RequestQueue();
    queue.enqueueWithId("mma_list_cells", { notebookId: "nb_1" });

    const claimed = queue.claimNext();

    expect(claimed?.notebookId).toBe("nb_1");
    expect(queue.runningRequestSnapshot()?.notebookId).toBe("nb_1");
  });

  it("enqueueWithId cancellation via cancelFromMcp rejects the promise", async () => {
    const queue = new RequestQueue();
    const { requestId, promise } = queue.enqueueWithId("mma_read_cell", { cellId: "cell_1" });

    queue.cancelFromMcp(requestId, "client cancelled");

    await expect(promise).rejects.toThrow("client cancelled");
    expect(queue.claimNext()).toBeNull();
  });

  it("enqueue is a convenience wrapper around enqueueWithId", async () => {
    const queue = new RequestQueue();
    const promise = queue.enqueue("mma_list_cells", {});

    const claimed = queue.claimNext();
    expect(claimed?.tool).toBe("mma_list_cells");

    queue.resolveSuccess(claimed!.requestId, { cells: [] });
    await expect(promise).resolves.toEqual({ cells: [] });
  });
});
