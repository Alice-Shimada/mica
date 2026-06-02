export type ToolName =
  | "mma_status"
  | "mma_list_cells"
  | "mma_read_cell"
  | "mma_insert_cell"
  | "mma_modify_cell"
  | "mma_delete_cell"
  | "mma_run_cell"
  | "mma_abort_evaluation"
  | "mma_get_cell_output"
  | "mma_read_artifact"
  | "mma_select_notebook"
  | "mma_symbol_lookup"
  | "mma_save_notebook";

export type RequestState =
  | "queued"
  | "claimed"
  | "completed"
  | "failed"
  | "cancelled";

export interface BridgeRequest {
  requestId: string;
  tool: ToolName;
  arguments: Record<string, unknown>;
  notebookId?: string;
  state: RequestState;
  createdAt: number;
  claimedAt?: number;
}

export interface NotebookInfo {
  notebookId: string;
  notebookTitle?: string;
  notebookPath?: string;
  wolframVersion?: string;
  platform?: string;
  permissions?: BridgePermissions;
  lastSeenAt: number;
}

export interface RunningRequestInfo {
  requestId: string;
  tool: ToolName;
  arguments: Record<string, unknown>;
  notebookId?: string;
  state: "claimed";
  createdAt: number;
  claimedAt: number;
}

export interface BridgeSuccess {
  requestId: string;
  ok: true;
  result: Record<string, unknown>;
}

export interface BridgeFailure {
  requestId: string;
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type BridgeResult = BridgeSuccess | BridgeFailure;

export interface AttachInfo {
  notebookTitle?: string;
  notebookPath?: string;
  wolframVersion?: string;
  platform?: string;
  permissions?: BridgePermissions;
}

export interface BridgePermissions {
  ReadNotebook: boolean;
  InsertCell: boolean;
  ModifyCell: boolean;
  DeleteCell: boolean;
  RunCell: boolean;
  SaveNotebook: boolean;
}

export interface BridgeStatus {
  server: "running";
  paletteConnected: boolean;
  notebookAttached: boolean;
  attachedNotebook?: AttachInfo;
  permissions?: BridgePermissions;
  activeNotebookId?: string;
  notebooks: NotebookInfo[];
  transportMode: "main-kernel";
  executorState: "idle" | "running";
  runningRequest: RunningRequestInfo | null;
  pendingRequests: number;
}

export interface PollResponse {
  status: BridgeStatus;
  cancelRequests: Array<{ requestId: string; reason: string }>;
  request: BridgeRequest | null;
}

export const DEFAULT_BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_BRIDGE_PORT = 19791;
