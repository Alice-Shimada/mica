import path from "node:path";

export const DEFAULT_TIMEOUTS_MS = {
  status: 5000,
  listNotebooks: 5000,
  listCells: 10_000,
  readCell: 10_000,
  mutation: 10_000,
  insertCell: 60_000,
  runCell: 120_000,
  symbolLookup: 30_000,
  agentHeartbeatDegradedMs: 10_000,
  agentHeartbeatOfflineMs: 30_000,
} as const;

export type CanonicalErrorCode =
  | "NO_LIVE_AGENT"
  | "NOTEBOOK_NOT_FOUND"
  | "NOTEBOOK_STALE"
  | "NOTEBOOK_CLOSED"
  | "NOTEBOOK_UNAVAILABLE"
  | "AMBIGUOUS_NOTEBOOK_NAME"
  | "PERMISSION_DENIED"
  | "REQUEST_TIMED_OUT"
  | "WOLFRAM_AGENT_ERROR";

export type Permissions = {
  ReadNotebook: boolean;
  InsertCell: boolean;
  ModifyCell: boolean;
  DeleteCell: boolean;
  RunCell: boolean;
  SaveNotebook: boolean;
};

export type AgentRetiredReason = "superseded" | "no_live_notebooks";
export type AgentStatus = "live" | "degraded" | "offline" | "retired";
export type NotebookStatus = "live" | "degraded" | "offline" | "closed";

export type AgentInfo = {
  agentSessionId: string;
  wolframVersion: string;
  platform: string;
  lastSeenAt: number;
  degradedAt?: number;
  degraded: boolean;
  offlineAt?: number;
  offline: boolean;
  retired: boolean;
  retiredReason?: AgentRetiredReason;
  status: AgentStatus;
  machineId?: string;
  frontendSessionId?: string;
  wolframProcessId?: string;
};

export type NotebookHeartbeat = {
  agentSessionId: string;
  frontendObjectKey: string;
  displayName: string;
  windowTitle: string;
  notebookPath?: string;
  savedPath?: string;
  wolframVersion: string;
  platform: string;
  permissions: Permissions;
  seenAt: number;
};

export type NotebookRecord = NotebookHeartbeat & {
  notebookId: string;
  normalizedPath?: string;
  createdAt: number;
  lastSeenAt: number;
  closed: boolean;
  degradedAt?: number;
  degraded: boolean;
  offlineAt?: number;
  stale: boolean;
  status: NotebookStatus;
};

export type BackendRequestStatus =
  | "queued"
  | "dispatched"
  | "running"
  | "abort_requested"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "kernel_unresponsive"
  | "unknown"
  | "late_result";

export type BackendRequest = {
  requestId: string;
  tool: string;
  arguments: Record<string, unknown>;
  targetNotebookId: string;
  timeoutMs: number;
  createdAt: number;
  claimedAt?: number;
  status: BackendRequestStatus;
  agentSessionId?: string;
};

function looksLikeWindowsPath(input: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(input) || /^\\\\/.test(input);
}

function usesWindowsPathSemantics(platform: string | undefined, input: string): boolean {
  if (platform === "Windows") return true;
  if (platform !== undefined) return false;
  return process.platform === "win32" || looksLikeWindowsPath(input);
}

export function canonicalizeNotebookPath(input: string | undefined, platform?: string): string | undefined {
  const trimmed = input?.trim();
  if (!trimmed) return undefined;

  if (usesWindowsPathSemantics(platform, trimmed)) {
    return path.win32.normalize(trimmed).toLowerCase();
  }

  return path.posix.normalize(trimmed);
}
