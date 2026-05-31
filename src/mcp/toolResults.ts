export type ToolResultContext = {
  tool?: string;
  args?: Record<string, unknown>;
  notebookId?: string;
};

export type StructuredToolError = {
  code: string;
  message: string;
  retryable: boolean;
  tool?: string;
  notebookId?: string;
  details?: Record<string, unknown>;
};

export type StructuredToolPayload = { ok: true; [key: string]: unknown } | { ok: false; error: StructuredToolError };

export type StructuredToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: StructuredToolPayload;
  isError?: true;
};

type ErrorDefinition = {
  code: string;
  message: string;
  retryable: boolean;
};

const ERROR_DEFINITIONS: Record<string, ErrorDefinition> = {
  AMBIGUOUS_NOTEBOOK_NAME: {
    code: "AMBIGUOUS_NOTEBOOK_NAME",
    message: "More than one live notebook matches that display name.",
    retryable: false,
  },
  NOTEBOOK_CLOSED: {
    code: "NOTEBOOK_CLOSED",
    message: "The selected Mathematica notebook has been closed.",
    retryable: true,
  },
  NOTEBOOK_NOT_ATTACHED: {
    code: "NOTEBOOK_NOT_ATTACHED",
    message: "No Mathematica notebook is attached to the bridge.",
    retryable: true,
  },
  NOTEBOOK_NOT_FOUND: {
    code: "NOTEBOOK_NOT_FOUND",
    message: "No live Mathematica notebook matches the requested selector.",
    retryable: true,
  },
  NOTEBOOK_NOT_SELECTED: {
    code: "NOTEBOOK_NOT_SELECTED",
    message: "No Mathematica notebook is selected.",
    retryable: true,
  },
  NOTEBOOK_STALE: {
    code: "NOTEBOOK_STALE",
    message: "The selected Mathematica notebook has stopped sending heartbeats.",
    retryable: true,
  },
  NO_LIVE_AGENT: {
    code: "NO_LIVE_AGENT",
    message: "No live Mathematica control agent is registered.",
    retryable: true,
  },
  PALETTE_NOT_CONNECTED: {
    code: "PALETTE_NOT_CONNECTED",
    message: "The Mathematica bridge palette is not connected.",
    retryable: true,
  },
  PERMISSION_DENIED: {
    code: "PERMISSION_DENIED",
    message: "The selected notebook did not grant permission for this tool.",
    retryable: false,
  },
  REQUEST_CANCELLED: {
    code: "REQUEST_CANCELLED",
    message: "The MCP client cancelled the operation.",
    retryable: false,
  },
  REQUEST_TIMED_OUT: {
    code: "REQUEST_TIMED_OUT",
    message: "The Mathematica control agent did not answer before the tool timeout.",
    retryable: true,
  },
  UNSUPPORTED_SELECTOR: {
    code: "UNSUPPORTED_SELECTOR",
    message: "That notebook selector is not supported by this MCP transport.",
    retryable: false,
  },
  WOLFRAM_AGENT_ERROR: {
    code: "WOLFRAM_AGENT_ERROR",
    message: "The Mathematica control agent reported an error.",
    retryable: true,
  },
};

export function toolSuccess(value: unknown): StructuredToolResult {
  const { ok: _ignoredOk, ...payload } = objectPayload(value);
  return textResult({ ok: true, ...payload });
}

export function toolFailure(error: unknown, context: ToolResultContext = {}): StructuredToolResult {
  return { ...textResult({ ok: false, error: normalizeToolError(error, context) }), isError: true };
}

export async function withToolErrors(
  context: ToolResultContext,
  handler: () => Promise<StructuredToolResult> | StructuredToolResult,
): Promise<StructuredToolResult> {
  try {
    return await handler();
  } catch (error) {
    return toolFailure(error, context);
  }
}

function textResult(structuredContent: StructuredToolPayload): StructuredToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

function objectPayload(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return { result: value };
}

function normalizeToolError(error: unknown, context: ToolResultContext): StructuredToolError {
  const raw = readErrorFields(error);
  const definition = classifyError(raw.code ?? raw.message);
  const notebookId = context.notebookId ?? notebookIdFromArgs(context.args);
  const tool = raw.tool ?? context.tool;

  return {
    code: definition.code,
    message: raw.message && !isBareCode(raw.message) ? raw.message : definition.message,
    retryable: raw.retryable ?? definition.retryable,
    ...(tool ? { tool } : {}),
    ...(notebookId ? { notebookId } : {}),
    ...(raw.details ? { details: raw.details } : {}),
  };
}

function readErrorFields(error: unknown): {
  code?: string;
  message?: string;
  retryable?: boolean;
  tool?: string;
  details?: Record<string, unknown>;
} {
  if (error instanceof Error) {
    return parseMessage(error.message);
  }

  if (typeof error === "string") {
    return parseMessage(error);
  }

  if (error !== null && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const nested = record.error !== null && typeof record.error === "object" ? (record.error as Record<string, unknown>) : record;
    const code = readString(nested.code);
    const message = readString(nested.message);
    const retryable = typeof nested.retryable === "boolean" ? nested.retryable : undefined;
    const tool = readString(nested.tool);
    const details = nested.details !== null && typeof nested.details === "object" && !Array.isArray(nested.details)
      ? (nested.details as Record<string, unknown>)
      : undefined;
    return { code, message, retryable, tool, details };
  }

  return { message: String(error) };
}

function parseMessage(message: string): { code?: string; message?: string; tool?: string } {
  const trimmed = message.trim();
  if (!trimmed) return {};

  const permissionMatch = trimmed.match(/^PERMISSION_DENIED:\s*(.+)$/);
  if (permissionMatch) {
    return { code: "PERMISSION_DENIED", message: ERROR_DEFINITIONS.PERMISSION_DENIED.message, tool: permissionMatch[1]!.trim() };
  }

  if (trimmed === "MCP client cancelled operation") {
    return { code: "REQUEST_CANCELLED", message: trimmed };
  }

  if (trimmed.startsWith("Mathematica Palette is not connected")) {
    return { code: "PALETTE_NOT_CONNECTED", message: trimmed };
  }

  if (trimmed.startsWith("No Mathematica notebook is attached")) {
    return { code: "NOTEBOOK_NOT_ATTACHED", message: trimmed };
  }

  if (trimmed.startsWith("No Mathematica notebook is selected")) {
    return { code: "NOTEBOOK_NOT_SELECTED", message: trimmed };
  }

  if (trimmed.startsWith("Unknown notebookId:")) {
    return { code: "NOTEBOOK_NOT_FOUND", message: trimmed };
  }

  if (trimmed.startsWith("Display-name notebook selection is not supported")) {
    return { code: "UNSUPPORTED_SELECTOR", message: trimmed };
  }

  const codeMatch = trimmed.match(/^([A-Z][A-Z0-9_]+)(?::\s*(.+))?$/);
  if (codeMatch) {
    return { code: codeMatch[1], message: codeMatch[2] ?? codeMatch[1] };
  }

  return { message: trimmed };
}

function classifyError(input: string | undefined): ErrorDefinition {
  if (input && ERROR_DEFINITIONS[input]) return ERROR_DEFINITIONS[input];
  return { code: "INTERNAL_ERROR", message: "The MCP tool failed unexpectedly.", retryable: false };
}

function notebookIdFromArgs(args: Record<string, unknown> | undefined): string | undefined {
  return readString(args?.notebookId);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isBareCode(message: string): boolean {
  return /^[A-Z][A-Z0-9_]+$/.test(message);
}
