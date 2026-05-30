import { describe, expect, it } from "vitest";
import { BackendQueue } from "../../src/backend/backendQueue.js";

describe("BackendQueue", () => {
  it("enqueues requests as queued and returns defensive copies", () => {
    const queue = new BackendQueue();

    const enqueued = queue.enqueue({
      requestId: "r1",
      tool: "mma_list_cells",
      arguments: {},
      targetNotebookId: "n1",
      agentSessionId: "agent-1",
      timeoutMs: 5_000,
      createdAt: 1_000,
    });

    enqueued.status = "failed";

    expect(queue.snapshot().queued).toEqual([
      {
        requestId: "r1",
        tool: "mma_list_cells",
        arguments: {},
        targetNotebookId: "n1",
        agentSessionId: "agent-1",
        timeoutMs: 5_000,
        createdAt: 1_000,
        status: "queued",
      },
    ]);
  });

  it("clones nested arguments so caller mutation cannot corrupt queue state", () => {
    const queue = new BackendQueue();
    const inputArguments = { nested: { value: 1 } };

    queue.enqueue({
      requestId: "r1",
      tool: "t",
      arguments: inputArguments,
      targetNotebookId: "n1",
      agentSessionId: "agent-1",
      timeoutMs: 5_000,
      createdAt: 1_000,
    });

    inputArguments.nested.value = 2;

    const snapshot = queue.snapshot();
    expect(snapshot.queued[0]?.arguments).toEqual({ nested: { value: 1 } });

    const queuedRequest = snapshot.queued[0] as unknown as { arguments: { nested: { value: number } } } | undefined;
    if (!queuedRequest) throw new Error("expected queued request");

    queuedRequest.arguments = { nested: { value: 3 } };
    queuedRequest.arguments.nested.value = 4;

    expect(queue.get("r1")?.arguments).toEqual({ nested: { value: 1 } });
  });

  it("claims the oldest queued request for the matching agent only", () => {
    const queue = new BackendQueue();
    queue.enqueue({ requestId: "r1", tool: "t", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-2", timeoutMs: 5_000, createdAt: 1_000 });
    queue.enqueue({ requestId: "r2", tool: "t", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-1", timeoutMs: 5_000, createdAt: 900 });
    queue.enqueue({ requestId: "r3", tool: "t", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-1", timeoutMs: 5_000, createdAt: 800 });

    const claimed = queue.claimNext("agent-1", 1_500);

    expect(claimed).toMatchObject({ requestId: "r3", status: "running", claimedAt: 1_500, agentSessionId: "agent-1" });
    expect(queue.snapshot().running.map((request) => request.requestId)).toEqual(["r3"]);
    expect(queue.snapshot().queued.map((request) => request.requestId)).toEqual(["r1", "r2"]);
  });

  it("skips queued requests whose notebook already has a running request", () => {
    const queue = new BackendQueue();
    queue.enqueue({ requestId: "r1", tool: "t", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-1", timeoutMs: 5_000, createdAt: 1_000 });
    queue.enqueue({ requestId: "r2", tool: "t", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-1", timeoutMs: 5_000, createdAt: 1_100 });
    queue.enqueue({ requestId: "r3", tool: "t", arguments: {}, targetNotebookId: "n2", agentSessionId: "agent-1", timeoutMs: 5_000, createdAt: 1_200 });

    expect(queue.claimNext("agent-1", 1_500)).toMatchObject({ requestId: "r1", targetNotebookId: "n1", status: "running" });
    expect(queue.claimNext("agent-1", 1_600)).toMatchObject({ requestId: "r3", targetNotebookId: "n2", status: "running" });
    expect(queue.snapshot().queued.map((request) => request.requestId)).toEqual(["r2"]);
  });

  it("waits for result settlement and surfaces the resolved payload", async () => {
    const queue = new BackendQueue();
    queue.enqueue({ requestId: "r1", tool: "t", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-1", timeoutMs: 5_000, createdAt: 1_000 });

    const waiting = queue.waitForResult("r1");
    queue.resolve("r1", { cells: [] }, 1_500);

    await expect(waiting).resolves.toEqual({ cells: [] });
  });

  it("rejects waiters when requests time out", async () => {
    const queue = new BackendQueue();
    queue.enqueue({ requestId: "r1", tool: "t", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-1", timeoutMs: 1_000, createdAt: 1_000 });

    const waiting = queue.waitForResult("r1");
    queue.markTimedOut(2_100);

    await expect(waiting).rejects.toThrow("REQUEST_TIMED_OUT");
    expect(queue.get("r1")?.status).toBe("timed_out");
  });

  it("marks queued and running requests timed out", () => {
    const queue = new BackendQueue();
    queue.enqueue({ requestId: "r1", tool: "t", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-1", timeoutMs: 1_000, createdAt: 1_000 });
    queue.enqueue({ requestId: "r2", tool: "t", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-1", timeoutMs: 5_000, createdAt: 1_000 });
    queue.claimNext("agent-1", 1_500);

    expect(queue.markTimedOut(2_100)).toEqual(["r1"]);
    expect(queue.snapshot().timed_out.map((request) => request.requestId)).toEqual(["r1"]);

    expect(queue.markTimedOut(7_000)).toEqual(["r2"]);
    expect(queue.snapshot().timed_out.map((request) => request.requestId)).toEqual(["r1", "r2"]);
  });

  it("accepts queued, running, and timed out resolution rules", () => {
    const queue = new BackendQueue();
    queue.enqueue({ requestId: "r1", tool: "t", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-1", timeoutMs: 5_000, createdAt: 1_000 });
    queue.enqueue({ requestId: "r2", tool: "t", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-1", timeoutMs: 5_000, createdAt: 1_000 });
    expect(queue.resolve("r1", { ok: true }, 1_500)).toEqual({ accepted: true, late: false });

    queue.claimNext("agent-1", 1_200);
    queue.markTimedOut(7_000);

    expect(queue.resolve("r2", { ok: true }, 7_500)).toEqual({ accepted: false, late: true });
    expect(queue.resolve("missing", { ok: true }, 7_500)).toEqual({ accepted: false, late: false });
  });

  it("treats resolve after cancel as late stale result", () => {
    const queue = new BackendQueue();
    queue.enqueue({ requestId: "r1", tool: "t", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-1", timeoutMs: 5_000, createdAt: 1_000 });

    expect(queue.cancel("r1", "USER_CANCELLED", 1_200)).toBe(true);
    expect(queue.resolve("r1", { ok: true }, 1_500)).toEqual({ accepted: false, late: true });
  });

  it("rejects duplicate request ids", () => {
    const queue = new BackendQueue();
    queue.enqueue({ requestId: "r1", tool: "t", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-1", timeoutMs: 5_000, createdAt: 1_000 });

    expect(() =>
      queue.enqueue({ requestId: "r1", tool: "t2", arguments: {}, targetNotebookId: "n2", agentSessionId: "agent-1", timeoutMs: 5_000, createdAt: 2_000 }),
    ).toThrowError("Duplicate requestId: r1");
  });

  it("fails requests and cancels queued or running work with per-agent notices", () => {
    const queue = new BackendQueue();
    queue.enqueue({ requestId: "r1", tool: "t", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-1", timeoutMs: 5_000, createdAt: 1_000 });
    queue.enqueue({ requestId: "r2", tool: "t", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-2", timeoutMs: 5_000, createdAt: 1_000 });
    queue.claimNext("agent-1", 1_100);

    expect(queue.fail("r1")).toBe(true);
    expect(queue.cancel("r1", "USER_CANCELLED", 1_200)).toBe(false);
    expect(queue.cancel("r2", "USER_CANCELLED", 1_200)).toBe(true);
    expect(queue.cancellationsForAgent("agent-2")).toEqual([{ requestId: "r2", reason: "USER_CANCELLED" }]);
    expect(queue.cancellationsForAgent("agent-2")).toEqual([]);
  });

  it("does not overwrite terminal states when fail is called", () => {
    const queue = new BackendQueue();
    queue.enqueue({ requestId: "r1", tool: "t", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-1", timeoutMs: 5_000, createdAt: 1_000 });
    queue.resolve("r1", { ok: true }, 1_500);

    expect(queue.fail("r1")).toBe(false);
    expect(queue.get("r1")?.status).toBe("succeeded");
  });

  it("returns arrays for every snapshot status", () => {
    const queue = new BackendQueue();

    expect(queue.snapshot()).toEqual({
      queued: [],
      dispatched: [],
      running: [],
      succeeded: [],
      failed: [],
      timed_out: [],
      cancelled: [],
    });
  });

  it("evicts older terminal requests while keeping recent terminal history", () => {
    const queue = new BackendQueue();

    for (let i = 0; i < 600; i++) {
      const requestId = `r${i}`;
      queue.enqueue({ requestId, tool: "t", arguments: {}, targetNotebookId: "n1", agentSessionId: "agent-1", timeoutMs: 5_000, createdAt: 1_000 + i });
      queue.resolve(requestId, { value: i }, 2_000 + i);
    }

    expect(queue.get("r0")).toBeUndefined();
    expect(queue.get("r99")).toBeUndefined();
    expect(queue.get("r100")).toMatchObject({ status: "succeeded" });
    expect(queue.get("r599")).toMatchObject({ status: "succeeded" });
    expect(queue.snapshot().succeeded).toHaveLength(500);
  });
});
