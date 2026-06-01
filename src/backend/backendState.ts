import { AgentRegistry } from "./agentRegistry.js";
import { BackendQueue } from "./backendQueue.js";
import { NotebookRegistry } from "./notebookRegistry.js";
import { DEFAULT_TIMEOUTS_MS, type CanonicalErrorCode, type NotebookRecord } from "./protocol.js";

export type NotebookSelector = {
  notebookId?: string;
  displayName?: string;
};

export type NotebookResolution =
  | { ok: true; record: NotebookRecord }
  | { ok: false; error: Extract<CanonicalErrorCode, "NOTEBOOK_NOT_FOUND" | "NOTEBOOK_STALE" | "NOTEBOOK_CLOSED" | "AMBIGUOUS_NOTEBOOK_NAME">; candidates?: NotebookRecord[] };

export class BackendState {
  readonly agents: AgentRegistry;
  readonly notebooks: NotebookRegistry;
  readonly queue = new BackendQueue();

  activeNotebookId: string | undefined;
  readonly activeNotebookByClientSession = new Map<string, string>();

  constructor(createNotebookId: () => string) {
    this.notebooks = new NotebookRegistry(createNotebookId);
    this.agents = new AgentRegistry();
  }

  setActiveNotebook(notebookId: string, clientSessionId?: string): void {
    if (clientSessionId) {
      this.activeNotebookByClientSession.set(clientSessionId, notebookId);
    } else {
      this.activeNotebookId = notebookId;
    }
  }

  sweepLiveness(now: number = Date.now()): { offlineAgents: string[]; staleNotebooks: string[] } {
    const offlineAgents = this.agents.markOfflineOlderThan(now, DEFAULT_TIMEOUTS_MS.agentHeartbeatGrace);
    for (const agentSessionId of offlineAgents) {
      this.notebooks.markStaleByAgent(agentSessionId, now);
    }
    this.clearInactiveActiveNotebook();

    return {
      offlineAgents,
      staleNotebooks: this.notebooks.listAll().filter((record) => record.stale).map((record) => record.notebookId),
    };
  }

  requireLiveAgent(): { ok: true } | { ok: false; error: "NO_LIVE_AGENT" } {
    return this.agents.hasLiveAgent() ? { ok: true } : { ok: false, error: "NO_LIVE_AGENT" };
  }

  resolveNotebook(selector: NotebookSelector, clientSessionId?: string): NotebookResolution {
    if (selector.notebookId !== undefined) {
      const notebookId = selector.notebookId.trim();
      if (!notebookId) return { ok: false, error: "NOTEBOOK_NOT_FOUND" };

      const record = this.notebooks.get(notebookId);
      if (!record) return { ok: false, error: "NOTEBOOK_NOT_FOUND" };
      if (record.closed) return { ok: false, error: "NOTEBOOK_CLOSED" };
      if (record.stale) return { ok: false, error: "NOTEBOOK_STALE" };
      return { ok: true, record };
    }

    if (selector.displayName !== undefined) {
      const displayName = selector.displayName.trim();
      if (!displayName) return { ok: false, error: "NOTEBOOK_NOT_FOUND" };

      const lookup = this.notebooks.findByDisplayName(displayName);
      if (lookup.ok) return { ok: true, record: lookup.record };
      return { ok: false, error: lookup.error, candidates: lookup.candidates };
    }

    if (clientSessionId) {
      const clientActiveNotebookId = this.activeNotebookByClientSession.get(clientSessionId);
      if (clientActiveNotebookId) {
        return this.resolveNotebook({ notebookId: clientActiveNotebookId });
      }
    }

    if (this.activeNotebookId) {
      return this.resolveNotebook({ notebookId: this.activeNotebookId });
    }

    return { ok: false, error: "NOTEBOOK_NOT_FOUND" };
  }

  closeNotebook(notebookId: string, closedAt: number): void {
    const notebook = this.notebooks.get(notebookId);
    if (!notebook) return;

    this.notebooks.markClosed(notebookId, closedAt);
    this.clearInactiveActiveNotebook();

    if (!this.notebooks.hasLiveForAgent(notebook.agentSessionId)) {
      this.agents.retire(notebook.agentSessionId, closedAt);
    }
  }

  private clearInactiveActiveNotebook(): void {
    if (this.activeNotebookId) {
      const active = this.notebooks.get(this.activeNotebookId);
      if (!active || active.closed || active.stale) {
        this.activeNotebookId = undefined;
      }
    }

    for (const [clientSessionId, notebookId] of this.activeNotebookByClientSession) {
      const record = this.notebooks.get(notebookId);
      if (!record || record.closed || record.stale) {
        this.activeNotebookByClientSession.delete(clientSessionId);
      }
    }
  }
}
