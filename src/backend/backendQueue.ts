import type { BackendRequest, BackendRequestStatus } from "./protocol.js";

export type QueueInput = Omit<BackendRequest, "status"> & { agentSessionId: string };
export type ResultResolution =
  | { accepted: true; late: false }
  | { accepted: false; late: true }
  | { accepted: false; late: false };
export type CancellationNotice = { requestId: string; reason: string };

type QueueCompletion =
  | { status: "succeeded"; result: unknown }
  | { status: "failed"; error: Error }
  | { status: "timed_out"; error: Error }
  | { status: "cancelled"; error: Error };

type Waiter = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const SNAPSHOT_STATUSES: BackendRequestStatus[] = [
  "queued",
  "dispatched",
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
];

export class BackendQueue {
  private static readonly DEFAULT_TERMINAL_HISTORY_LIMIT = 500;

  private readonly requests = new Map<string, BackendRequest>();
  private readonly completions = new Map<string, QueueCompletion>();
  private readonly waiters = new Map<string, Waiter[]>();
  private readonly cancellations = new Map<string, CancellationNotice[]>();
  private readonly terminalOrder: string[] = [];

  enqueue(input: QueueInput): BackendRequest {
    if (this.requests.has(input.requestId)) {
      throw new Error(`Duplicate requestId: ${input.requestId}`);
    }

    const request: BackendRequest = this.cloneRequest({ ...input, status: "queued" });
    this.requests.set(request.requestId, request);
    return this.cloneRequest(request);
  }

  get(requestId: string): BackendRequest | undefined {
    const request = this.requests.get(requestId);
    return request ? this.cloneRequest(request) : undefined;
  }

  claimNext(agentSessionId: string, claimedAt: number): BackendRequest | undefined {
    let next: BackendRequest | undefined;
    const busyNotebooks = new Set<string>();

    for (const request of this.requests.values()) {
      if ((request.status === "running" || request.status === "dispatched") && request.targetNotebookId) {
        busyNotebooks.add(request.targetNotebookId);
      }
    }

    for (const request of this.requests.values()) {
      if (request.status !== "queued" || request.agentSessionId !== agentSessionId) continue;
      if (busyNotebooks.has(request.targetNotebookId)) continue;
      if (!next || request.createdAt < next.createdAt) {
        next = request;
      }
    }

    if (!next) return undefined;

    const updated: BackendRequest = this.cloneRequest({ ...next, status: "running", claimedAt });
    this.requests.set(updated.requestId, updated);
    return this.cloneRequest(updated);
  }

  waitForResult(requestId: string): Promise<unknown> {
    const request = this.requests.get(requestId);
    if (!request) {
      return Promise.reject(new Error("REQUEST_NOT_FOUND"));
    }

    const completion = this.completions.get(requestId);
    if (completion) {
      return completion.status === "succeeded" ? Promise.resolve(this.cloneValue(completion.result)) : Promise.reject(completion.error);
    }

    if (request.status === "succeeded") {
      return Promise.resolve(undefined);
    }
    if (request.status === "failed") {
      return Promise.reject(new Error("REQUEST_FAILED"));
    }
    if (request.status === "timed_out") {
      return Promise.reject(new Error("REQUEST_TIMED_OUT"));
    }
    if (request.status === "cancelled") {
      return Promise.reject(new Error("REQUEST_CANCELLED"));
    }

    return new Promise<unknown>((resolve, reject) => {
      const waiters = this.waiters.get(requestId) ?? [];
      waiters.push({ resolve, reject });
      this.waiters.set(requestId, waiters);
    });
  }

  markTimedOut(now: number): string[] {
    const timedOut: string[] = [];

    for (const request of this.requests.values()) {
      if (request.status !== "queued" && request.status !== "running") continue;
      if (now - request.createdAt < request.timeoutMs) continue;

      const updated = this.cloneRequest({ ...request, status: "timed_out" });
      this.requests.set(request.requestId, updated);
      this.completions.set(request.requestId, { status: "timed_out", error: new Error("REQUEST_TIMED_OUT") });
      this.settleWaiters(request.requestId, undefined, new Error("REQUEST_TIMED_OUT"));
      this.recordTerminal(request.requestId);
      timedOut.push(request.requestId);
    }

    return timedOut;
  }

  resolve(requestId: string, _payload: unknown, resolvedAt: number): ResultResolution {
    const request = this.requests.get(requestId);
    if (!request) return { accepted: false, late: false };
    if (request.status === "timed_out") return { accepted: false, late: true };
    if (request.status === "cancelled") return { accepted: false, late: true };
    if (request.status !== "queued" && request.status !== "running" && request.status !== "dispatched") {
      return { accepted: false, late: false };
    }

    const updated = this.cloneRequest({ ...request, status: "succeeded", claimedAt: request.claimedAt ?? resolvedAt });
    this.requests.set(requestId, updated);
    this.completions.set(requestId, { status: "succeeded", result: this.cloneValue(_payload) });
    this.settleWaiters(requestId, this.cloneValue(_payload), undefined);
    this.recordTerminal(requestId);
    return { accepted: true, late: false };
  }

  fail(requestId: string, error?: unknown): boolean {
    const request = this.requests.get(requestId);
    if (!request) return false;
    if (request.status !== "queued" && request.status !== "running" && request.status !== "dispatched") {
      return false;
    }

    const rejection = this.toError(error, "REQUEST_FAILED");
    this.requests.set(requestId, this.cloneRequest({ ...request, status: "failed" }));
    this.completions.set(requestId, { status: "failed", error: rejection });
    this.settleWaiters(requestId, undefined, rejection);
    this.recordTerminal(requestId);
    return true;
  }

  cancel(requestId: string, reason: string, cancelledAt: number): boolean {
    const request = this.requests.get(requestId);
    if (!request) return false;
    if (request.status !== "queued" && request.status !== "running") return false;

    this.requests.set(
      requestId,
      this.cloneRequest({ ...request, status: "cancelled", claimedAt: request.claimedAt ?? cancelledAt }),
    );
    const rejection = new Error(reason);
    this.completions.set(requestId, { status: "cancelled", error: rejection });
    this.settleWaiters(requestId, undefined, rejection);
    this.recordTerminal(requestId);

    const agentSessionId = request.agentSessionId;
    if (!agentSessionId) return true;

    const notices = this.cancellations.get(agentSessionId) ?? [];
    notices.push({ requestId, reason });
    this.cancellations.set(agentSessionId, notices);
    return true;
  }

  cancellationsForAgent(agentSessionId: string): CancellationNotice[] {
    const notices = this.cancellations.get(agentSessionId) ?? [];
    this.cancellations.set(agentSessionId, []);
    return notices.map((notice) => ({ ...notice }));
  }

  snapshot(): Record<BackendRequestStatus, BackendRequest[]> {
    const snapshot = Object.fromEntries(
      SNAPSHOT_STATUSES.map((status) => [
        status,
        [...this.requests.values()].filter((request) => request.status === status).map((request) => this.cloneRequest(request)),
      ]),
    ) as Record<BackendRequestStatus, BackendRequest[]>;

    return snapshot;
  }

  private cloneRequest(request: BackendRequest): BackendRequest {
    return {
      ...request,
      arguments: this.cloneValue(request.arguments),
    };
  }

  private cloneValue<T>(value: T): T {
    if (value === undefined) return value;
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  }

  private settleWaiters(requestId: string, value: unknown | undefined, error: Error | undefined): void {
    const waiters = this.waiters.get(requestId);
    if (!waiters || waiters.length === 0) return;

    this.waiters.delete(requestId);
    for (const waiter of waiters) {
      if (error) {
        waiter.reject(error);
      } else {
        waiter.resolve(this.cloneValue(value));
      }
    }
  }

  private toError(value: unknown, fallbackMessage: string): Error {
    if (value instanceof Error) return value;
    if (typeof value === "string" && value.trim()) return new Error(value);
    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      const code = typeof record.code === "string" && record.code.trim() ? record.code.trim() : undefined;
      const message = typeof record.message === "string" && record.message.trim() ? record.message.trim() : undefined;
      if (code && message) return new Error(`${code}: ${message}`);
      if (code) return new Error(code);
      if (message) return new Error(message);
    }

    return new Error(fallbackMessage);
  }

  private recordTerminal(requestId: string): void {
    this.terminalOrder.push(requestId);
    while (this.terminalOrder.length > BackendQueue.DEFAULT_TERMINAL_HISTORY_LIMIT) {
      const evictedRequestId = this.terminalOrder.shift();
      if (!evictedRequestId) continue;
      this.requests.delete(evictedRequestId);
      this.completions.delete(evictedRequestId);
      this.waiters.delete(evictedRequestId);
    }
  }
}
