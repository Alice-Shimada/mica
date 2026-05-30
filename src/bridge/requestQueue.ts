import type { BridgeRequest, RunningRequestInfo, ToolName } from "../types.js";

interface PendingCall {
  request: BridgeRequest;
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

/**
 * Serial request queue for the MMA MCP bridge.
 *
 * Only one notebook operation is processed at a time. The MCP client enqueues
 * tool calls, the Mathematica Palette polls and claims them, then posts results
 * back. Cancellation is supported from both sides.
 *
 * ## Cancellation semantics
 *
 * **MCP-client cancellation** (`cancelFromMcp`):
 * - Queued requests are rejected immediately and removed.
 * - Claimed requests are rejected immediately and removed, and a one-shot
 *   cancellation notification is stored for the Palette to pick up via
 *   `listCancellations`. This ensures the MCP call terminates instead of
 *   hanging indefinitely.
 *
 * **Palette-originated cancellation** (`cancelFromPalette`):
 * - The Palette already knows it is cancelling, so no notification is stored.
 *   The active call is rejected and removed immediately.
 */
export class RequestQueue {
  private counter = 0;
  private readonly calls = new Map<string, PendingCall>();
  private readonly order: string[] = [];

  /**
   * One-shot cancellation notifications for the Palette.
   * Populated by cancelFromMcp on claimed requests, drained by listCancellations.
   */
  private readonly cancellations: Array<{ requestId: string; reason: string }> = [];

  /**
   * Enqueue a tool call and return only the promise.
   *
   * Convenience wrapper around {@link enqueueWithId} for callers that don't
   * need the requestId (e.g. tests, simple fire-and-forget usage).
   */
  enqueue(tool: ToolName, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.enqueueWithId(tool, args).promise;
  }

  /**
   * Enqueue a tool call and return both the requestId and the promise.
   *
   * The requestId is needed by MCP tool handlers so they can wire an
   * AbortSignal listener to {@link cancelFromMcp}.
   */
  enqueueWithId(
    tool: ToolName,
    args: Record<string, unknown>
  ): { requestId: string; promise: Promise<Record<string, unknown>> } {
    const notebookId = typeof args.notebookId === "string" && args.notebookId.length > 0 ? args.notebookId : undefined;
    const requestId = `req_${++this.counter}`;
    const request: BridgeRequest = {
      requestId,
      tool,
      arguments: args,
      notebookId,
      state: "queued",
      createdAt: Date.now()
    };

    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.calls.set(requestId, { request, resolve, reject });
      this.order.push(requestId);
    });

    return { requestId, promise };
  }

  claimNext(): BridgeRequest | null {
    if ([...this.calls.values()].some((call) => call.request.state === "claimed")) {
      return null;
    }

    const requestId = this.order.find((id) => this.calls.get(id)?.request.state === "queued");
    if (!requestId) return null;

    const call = this.calls.get(requestId);
    if (!call) return null;

    call.request.state = "claimed";
    call.request.claimedAt = Date.now();
    return { ...call.request, arguments: { ...call.request.arguments } };
  }

  runningRequestSnapshot(): RunningRequestInfo | null {
    const running = this.order
      .map((id) => this.calls.get(id)?.request)
      .find((request): request is BridgeRequest => request !== undefined && request.state === "claimed");

    if (!running || running.claimedAt === undefined) return null;

    return {
      requestId: running.requestId,
      tool: running.tool,
      arguments: { ...running.arguments },
      notebookId: running.notebookId,
      state: "claimed",
      createdAt: running.createdAt,
      claimedAt: running.claimedAt
    };
  }

  peekQueued(): BridgeRequest[] {
    return this.order
      .map((id) => this.calls.get(id)?.request)
      .filter((request): request is BridgeRequest => request !== undefined && request.state === "queued")
      .map((request) => ({ ...request, arguments: { ...request.arguments } }));
  }

  pendingCount(): number {
    return [...this.calls.values()].filter((call) =>
      call.request.state === "queued" || call.request.state === "claimed"
    ).length;
  }

  resolveSuccess(requestId: string, result: Record<string, unknown>): boolean {
    const call = this.calls.get(requestId);
    if (!call) return false;
    if (call.request.state !== "claimed") return false;
    call.request.state = "completed";
    call.resolve(result);
    this.remove(requestId);
    return true;
  }

  resolveFailure(requestId: string, code: string, message: string): boolean {
    const call = this.calls.get(requestId);
    if (!call) return false;
    if (call.request.state !== "claimed") return false;
    call.request.state = "failed";
    call.reject(new Error(`${code}: ${message}`));
    this.remove(requestId);
    return true;
  }

  /**
   * Cancel a request from the MCP client side.
   *
   * - Queued: rejects the promise and removes the call immediately.
   * - Claimed: rejects the promise, removes the call, and stores a one-shot
   *   cancellation notification for the Palette to discover via listCancellations.
   * - Unknown/removed: returns false.
   */
  cancelFromMcp(requestId: string, reason: string): boolean {
    const call = this.calls.get(requestId);
    if (!call) return false;

    if (call.request.state === "queued") {
      call.request.state = "cancelled";
      call.reject(new Error(reason));
      this.remove(requestId);
      return true;
    }

    // Claimed: reject immediately so the MCP call terminates, and store a
    // one-shot notification for the Palette to pick up.
    call.request.state = "cancelled";
    call.reject(new Error(reason));
    this.cancellations.push({ requestId, reason });
    this.remove(requestId);
    return true;
  }

  /**
   * Cancel a request originating from the Palette (user action in Mathematica).
   *
   * Rejects the promise and removes the call immediately. No cancellation
   * notification is stored because the Palette already knows it cancelled.
   * Returns false if the requestId is unknown or already removed.
   */
  cancelFromPalette(requestId: string, reason: string): boolean {
    const call = this.calls.get(requestId);
    if (!call) return false;
    call.request.state = "cancelled";
    call.reject(new Error(reason));
    this.remove(requestId);
    return true;
  }

  /**
   * Return pending one-shot MCP cancellation notifications and clear them.
   *
   * The Palette polls this endpoint to discover claimed requests that were
   * cancelled by the MCP client. Each cancellation is reported exactly once.
   */
  listCancellations(): Array<{ requestId: string; reason: string }> {
    if (this.cancellations.length === 0) return [];
    const result = [...this.cancellations];
    this.cancellations.length = 0;
    return result;
  }

  /**
   * Reject all outstanding promises and clear all internal state.
   *
   * Used when the HTTP bridge shuts down so pending MCP tool-call promises
   * don't hang indefinitely. Clears active calls, FIFO order, and one-shot
   * cancellation notifications.
   */
  drain(reason: string): void {
    for (const call of this.calls.values()) {
      call.request.state = "cancelled";
      call.reject(new Error(reason));
    }
    this.calls.clear();
    this.order.length = 0;
    this.cancellations.length = 0;
  }

  private remove(requestId: string): void {
    this.calls.delete(requestId);
    const index = this.order.indexOf(requestId);
    if (index >= 0) this.order.splice(index, 1);
  }
}
