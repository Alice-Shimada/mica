import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  AttachInfo,
  BridgeFailure,
  BridgePermissions,
  BridgeResult,
  BridgeStatus,
  BridgeSuccess,
  NotebookInfo,
  PollResponse
} from "../types.js";
import { DEFAULT_BRIDGE_HOST, DEFAULT_BRIDGE_PORT } from "../types.js";
import type { RequestQueue } from "./requestQueue.js";

export interface HttpBridgeOptions {
  host?: string;
  port?: number;
  /** Milliseconds before a Palette is considered disconnected (default 30_000). */
  paletteStaleTimeoutMs?: number;
}

const DEFAULT_PALETTE_STALE_TIMEOUT_MS = 30_000;

export class HttpBridge {
  private readonly server: http.Server;
  private attachedNotebook: AttachInfo | undefined;
  private permissions: BridgePermissions | undefined;
  private readonly notebooks = new Map<string, NotebookInfo>();
  private activeNotebookId: string | undefined;
  /** Timestamp (ms) of the last Palette heartbeat. 0 = never connected. */
  private lastPaletteHeartbeat = 0;
  private readonly paletteStaleTimeoutMs: number;

  private static readonly MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

  constructor(
    private readonly queue: RequestQueue,
    private readonly options: HttpBridgeOptions = {}
  ) {
    this.paletteStaleTimeoutMs =
      options.paletteStaleTimeoutMs ?? DEFAULT_PALETTE_STALE_TIMEOUT_MS;
    this.server = http.createServer((request, response) => {
      this.handle(request, response);
    });
  }

  get port(): number {
    const address = this.server.address() as AddressInfo | null;
    return address?.port ?? this.options.port ?? DEFAULT_BRIDGE_PORT;
  }

  /**
   * Return a snapshot of the current bridge status.
   *
   * Exposed so the MCP `mma_status` tool can report real Palette connection
   * and notebook attachment state instead of hardcoded false values.
   */
  statusSnapshot(): BridgeStatus {
    return this.status();
  }

  async start(): Promise<void> {
    const host = this.options.host ?? DEFAULT_BRIDGE_HOST;
    const port = this.options.port ?? DEFAULT_BRIDGE_PORT;
    await new Promise<void>((resolve) => this.server.listen(port, host, resolve));
  }

  async stop(): Promise<void> {
    // Close the HTTP server first to prevent new interactions, then drain
    // the queue so pending MCP promises don't hang.
    if (this.server.listening) {
      await new Promise<void>((resolve, reject) => {
        this.server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    this.queue.drain("HTTP bridge stopped");
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/status") {
        this.sendJson(response, 200, this.status());
        return;
      }

      if (request.method === "POST" && url.pathname === "/attach") {
        const body = await this.readJson(request);
        if (typeof body !== "object" || body === null || Object.keys(body as object).length === 0) {
          this.sendJson(response, 400, {
            error: { code: "BAD_REQUEST", message: "attach body must be a non-empty JSON object" }
          });
          return;
        }
        const attach = body as AttachInfo & { notebookId?: string; permissions?: unknown };
        const permissions = Object.prototype.hasOwnProperty.call(attach, "permissions")
          ? this.parsePermissions(attach.permissions)
          : undefined;
        if (Object.prototype.hasOwnProperty.call(attach, "permissions") && !permissions) {
          this.sendJson(response, 400, {
            error: { code: "BAD_REQUEST", message: "permissions must include boolean values" }
          });
          return;
        }
        this.attachedNotebook = permissions ? { ...attach, permissions } : (attach as AttachInfo);
        this.permissions = permissions;
        if (typeof attach.notebookId === "string" && attach.notebookId.length > 0) {
          this.upsertNotebook({
            notebookId: attach.notebookId,
            notebookTitle: attach.notebookTitle,
            notebookPath: attach.notebookPath,
            wolframVersion: attach.wolframVersion,
            platform: attach.platform,
            permissions,
            lastSeenAt: Date.now()
          });
        }
        this.heartbeat();
        this.sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/notebooks/upsert") {
        const body = await this.readJson(request);
        if (!this.isNotebookPayload(body)) {
          this.sendJson(response, 400, {
            error: { code: "BAD_REQUEST", message: "notebookId is required" }
          });
          return;
        }

        this.upsertNotebook({
          notebookId: body.notebookId,
          notebookTitle: body.notebookTitle,
          notebookPath: body.notebookPath,
          wolframVersion: body.wolframVersion,
          platform: body.platform,
          permissions: this.parsePermissions(body),
          lastSeenAt: Date.now()
        });
        if (!this.activeNotebookId) {
          this.activeNotebookId = body.notebookId;
        }
        this.heartbeat();
        this.sendJson(response, 200, { ok: true, activeNotebookId: this.activeNotebookId });
        return;
      }

      if (request.method === "GET" && url.pathname === "/notebooks") {
        this.sendJson(response, 200, {
          notebooks: this.listNotebooks(),
          activeNotebookId: this.activeNotebookId
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/notebooks/select") {
        const body = await this.readJson(request);
        const notebookId = this.getNotebookId(body);
        if (!notebookId) {
          this.sendJson(response, 400, {
            error: { code: "BAD_REQUEST", message: "notebookId is required" }
          });
          return;
        }
        if (!this.notebooks.has(notebookId)) {
          this.sendJson(response, 404, {
            error: { code: "NOTEBOOK_NOT_FOUND", message: `Unknown notebookId: ${notebookId}` }
          });
          return;
        }
        this.activeNotebookId = notebookId;
        this.heartbeat();
        this.sendJson(response, 200, { ok: true, activeNotebookId: this.activeNotebookId });
        return;
      }

      if (request.method === "GET" && url.pathname === "/poll") {
        const activeNotebookId = url.searchParams.get("activeNotebookId");
        if (activeNotebookId && this.notebooks.has(activeNotebookId)) {
          this.activeNotebookId = activeNotebookId;
        }
        this.heartbeat();
        const requestInfo = this.queue.claimNext();
        const body: PollResponse = {
          status: this.status(),
          cancelRequests: this.queue.listCancellations(),
          request: requestInfo
        };
        this.sendJson(response, 200, body);
        return;
      }

      if (request.method === "POST" && url.pathname === "/permissions") {
        const body = await this.readJson(request);
        const permissions = this.parsePermissions(body);
        if (!permissions) {
          this.sendJson(response, 400, {
            error: { code: "BAD_REQUEST", message: "permissions must include boolean values" }
          });
          return;
        }
        this.permissions = permissions;
        if (this.attachedNotebook) {
          this.attachedNotebook = { ...this.attachedNotebook, permissions };
        }
        const attachedNotebookId = this.getAttachedNotebookId();
        if (attachedNotebookId) {
          this.upsertNotebook({
            notebookId: attachedNotebookId,
            notebookTitle: this.attachedNotebook?.notebookTitle,
            notebookPath: this.attachedNotebook?.notebookPath,
            wolframVersion: this.attachedNotebook?.wolframVersion,
            platform: this.attachedNotebook?.platform,
            permissions,
            lastSeenAt: Date.now()
          });
        }
        this.sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && url.pathname === "/requests") {
        this.heartbeat();
        this.sendJson(response, 200, { request: this.queue.claimNext() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/result") {
        const body = (await this.readJson(request)) as BridgeResult;
        const accepted = body.ok
          ? this.queue.resolveSuccess((body as BridgeSuccess).requestId, (body as BridgeSuccess).result)
          : this.queue.resolveFailure(
              (body as BridgeFailure).requestId,
              (body as BridgeFailure).error.code,
              (body as BridgeFailure).error.message
            );
        this.sendJson(response, accepted ? 200 : 404, { ok: accepted });
        return;
      }

      if (request.method === "GET" && url.pathname === "/cancellations") {
        this.sendJson(response, 200, { cancelRequests: this.queue.listCancellations() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/cancel") {
        const body = (await this.readJson(request)) as { requestId?: string; reason?: string };
        if (!body.requestId) {
          this.sendJson(response, 400, { error: { code: "BAD_REQUEST", message: "requestId is required" } });
          return;
        }
        const accepted = this.queue.cancelFromPalette(body.requestId, body.reason ?? "USER_CANCELLED_IN_PALETTE");
        this.sendJson(response, accepted ? 200 : 404, { ok: accepted });
        return;
      }

      this.sendJson(response, 404, { error: { code: "NOT_FOUND", message: `${request.method} ${url.pathname}` } });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === "PAYLOAD_TOO_LARGE") {
        this.sendJson(response, 413, { error: { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds 1 MiB limit" } });
      } else if (msg === "MALFORMED_JSON") {
        this.sendJson(response, 400, { error: { code: "BAD_REQUEST", message: "Malformed JSON body" } });
      } else {
        this.sendJson(response, 500, { error: { code: "INTERNAL_ERROR", message: msg } });
      }
    }
  }

  private status(): BridgeStatus {
    const permissions = this.permissions ?? this.attachedNotebook?.permissions;
    const runningRequest = this.queue.runningRequestSnapshot();
    const notebookAttached = Boolean(this.attachedNotebook) || Boolean(this.activeNotebookId && this.notebooks.has(this.activeNotebookId));
    return {
      server: "running",
      paletteConnected: this.isPaletteConnected(),
      notebookAttached,
      attachedNotebook: this.attachedNotebook,
      permissions,
      activeNotebookId: this.activeNotebookId,
      notebooks: this.listNotebooks(),
      transportMode: "main-kernel",
      executorState: runningRequest ? "running" : "idle",
      runningRequest,
      pendingRequests: this.queue.pendingCount()
    };
  }

  private upsertNotebook(notebook: NotebookInfo): void {
    const existing = this.notebooks.get(notebook.notebookId);
    this.notebooks.set(notebook.notebookId, {
      ...(existing ?? { notebookId: notebook.notebookId, lastSeenAt: notebook.lastSeenAt }),
      ...notebook
    });
  }

  private listNotebooks(): NotebookInfo[] {
    return [...this.notebooks.values()];
  }

  private getNotebookId(payload: unknown): string | undefined {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return undefined;
    }
    const record = payload as Record<string, unknown>;
    return typeof record.notebookId === "string" && record.notebookId.length > 0 ? record.notebookId : undefined;
  }

  private isNotebookPayload(payload: unknown): payload is {
    notebookId: string;
    notebookTitle?: string;
    notebookPath?: string;
    wolframVersion?: string;
    platform?: string;
  } {
    return this.getNotebookId(payload) !== undefined;
  }

  private getAttachedNotebookId(): string | undefined {
    if (!this.attachedNotebook) return undefined;
    return typeof (this.attachedNotebook as AttachInfo & { notebookId?: unknown }).notebookId === "string"
      ? (this.attachedNotebook as AttachInfo & { notebookId?: string }).notebookId
      : undefined;
  }

  /**
   * Record a Palette heartbeat, refreshing the connection timestamp.
   *
   * Called on POST /attach and GET /requests — the two endpoints the Palette
   * uses to interact with the bridge. If the Palette stops polling, the
   * heartbeat expires and {@link isPaletteConnected} returns false.
   */
  private heartbeat(): void {
    this.lastPaletteHeartbeat = Date.now();
  }

  /**
   * Whether the Palette is considered connected based on heartbeat freshness.
   *
   * Returns true only if the Palette has sent a heartbeat within
   * `paletteStaleTimeoutMs`. This prevents agents from enqueuing requests
   * that will never be claimed after the Palette dies or disconnects.
   */
  private isPaletteConnected(): boolean {
    if (this.lastPaletteHeartbeat === 0) return false;
    return Date.now() - this.lastPaletteHeartbeat < this.paletteStaleTimeoutMs;
  }

  private parsePermissions(payload: unknown): BridgePermissions | undefined {
    const source = this.getPermissionsSource(payload);
    if (!source) return undefined;

    const keys = [
      "ReadNotebook",
      "InsertCell",
      "ModifyCell",
      "DeleteCell",
      "RunCell",
      "SaveNotebook"
    ] as const;
    const permissions = {} as BridgePermissions;
    for (const key of keys) {
      if (typeof source[key] !== "boolean") {
        return undefined;
      }
      permissions[key] = source[key];
    }
    return permissions;
  }

  private getPermissionsSource(payload: unknown): Record<string, unknown> | null {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return null;
    }

    const record = payload as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, "permissions")) {
      const nested = record.permissions;
      if (typeof nested !== "object" || nested === null || Array.isArray(nested)) {
        return null;
      }
      return nested as Record<string, unknown>;
    }

    return record;
  }

  private async readJson(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let exceeded = false;
    for await (const chunk of request) {
      if (exceeded) continue; // drain remaining chunks
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      if (totalBytes > HttpBridge.MAX_BODY_BYTES) {
        exceeded = true;
        chunks.length = 0; // discard accumulated data
        continue;
      }
      chunks.push(buf);
    }
    if (exceeded) {
      throw new Error("PAYLOAD_TOO_LARGE");
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (text.length === 0) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("MALFORMED_JSON");
    }
  }

  private sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
    response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
  }
}
