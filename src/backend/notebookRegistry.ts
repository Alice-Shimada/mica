import { canonicalizeNotebookPath, type CanonicalErrorCode, type NotebookHeartbeat, type NotebookRecord } from "./protocol.js";

type DisplayNameLookup =
  | { ok: true; record: NotebookRecord }
  | {
      ok: false;
      error: Extract<CanonicalErrorCode, "NOTEBOOK_NOT_FOUND" | "AMBIGUOUS_NOTEBOOK_NAME">;
      candidates: NotebookRecord[];
    };

export class NotebookRegistry {
  private readonly records = new Map<string, NotebookRecord>();

  constructor(private readonly createNotebookId: () => string) {}

  upsertHeartbeat(input: NotebookHeartbeat): NotebookRecord {
    const existingByFrontend = this.findByFrontend(input.agentSessionId, input.frontendObjectKey);
    const normalizedPath = this.canonicalizeFirstPath(input.savedPath, input.notebookPath, input.platform);
    const existingByPath = normalizedPath ? this.findByNormalizedPath(normalizedPath) : undefined;
    const existing = existingByFrontend ?? existingByPath;

    if (existingByFrontend && existingByPath && existingByFrontend.notebookId !== existingByPath.notebookId) {
      this.markClosed(existingByPath.notebookId, input.seenAt);
    }

    const notebookId = existing?.notebookId ?? this.createNotebookId();

    const record: NotebookRecord = {
      ...input,
      permissions: this.clonePermissions(input.permissions),
      notebookId,
      normalizedPath,
      createdAt: existing?.createdAt ?? input.seenAt,
      lastSeenAt: input.seenAt,
      closed: false,
      stale: false,
    };

    this.records.set(notebookId, record);
    return this.cloneRecord(record);
  }

  get(notebookId: string): NotebookRecord | undefined {
    const record = this.records.get(notebookId);
    return record ? this.cloneRecord(record) : undefined;
  }

  listLive(): NotebookRecord[] {
    return this.listAll().filter((record) => !record.closed && !record.stale).map((record) => this.cloneRecord(record));
  }

  listAll(): NotebookRecord[] {
    return [...this.records.values()].map((record) => this.cloneRecord(record));
  }

  hasLiveForAgent(agentSessionId: string): boolean {
    for (const record of this.records.values()) {
      if (record.agentSessionId !== agentSessionId) continue;
      if (record.closed || record.stale) continue;
      return true;
    }

    return false;
  }

  findByDisplayName(displayName: string): DisplayNameLookup {
    const matches = this.listLive().filter(
      (record) => record.displayName === displayName || record.windowTitle === displayName,
    );

    if (matches.length === 1) {
      return { ok: true, record: this.cloneRecord(matches[0]!) };
    }

    if (matches.length > 1) {
      return { ok: false, error: "AMBIGUOUS_NOTEBOOK_NAME", candidates: matches };
    }

    return { ok: false, error: "NOTEBOOK_NOT_FOUND", candidates: [] };
  }

  markClosed(notebookId: string, closedAt: number): void {
    const record = this.records.get(notebookId);
    if (!record) return;

    this.records.set(notebookId, {
      ...record,
      closed: true,
      stale: false,
      lastSeenAt: closedAt,
    });
  }

  markStaleByAgent(agentSessionId: string, staleAt: number): void {
    for (const record of this.records.values()) {
      if (record.agentSessionId !== agentSessionId || record.closed) continue;

      this.records.set(record.notebookId, {
        ...record,
        stale: true,
        lastSeenAt: staleAt,
      });
    }
  }

  private findByFrontend(agentSessionId: string, frontendObjectKey: string): NotebookRecord | undefined {
    for (const record of this.records.values()) {
      if (record.closed) continue;
      if (record.agentSessionId === agentSessionId && record.frontendObjectKey === frontendObjectKey) {
        return record;
      }
    }

    return undefined;
  }

  private findByNormalizedPath(normalizedPath: string): NotebookRecord | undefined {
    for (const record of this.records.values()) {
      if (!record.closed && record.normalizedPath === normalizedPath) {
        return record;
      }
    }

    return undefined;
  }

  private canonicalizeFirstPath(savedPath: string | undefined, notebookPath: string | undefined, platform: string): string | undefined {
    return canonicalizeNotebookPath(savedPath, platform) ?? canonicalizeNotebookPath(notebookPath, platform);
  }

  private cloneRecord(record: NotebookRecord): NotebookRecord {
    return {
      ...record,
      permissions: this.clonePermissions(record.permissions),
    };
  }

  private clonePermissions(permissions: NotebookHeartbeat["permissions"]): NotebookHeartbeat["permissions"] {
    return { ...permissions };
  }
}
