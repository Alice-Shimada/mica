import { existsSync, readFileSync } from "node:fs";
import { defaultSessionFile } from "../runtime/config.js";

type SessionData = {
  baseUrl?: string;
  authToken?: string;
  host?: string;
  port?: number;
  pid?: number;
  version?: string;
};

export type CliStatusResult = {
  exitCode: number;
  output: string;
  running: boolean;
};

export type CliStatusDeps = {
  env?: NodeJS.ProcessEnv;
  exists?: (filePath: string) => boolean;
  readFile?: (filePath: string) => string;
  fetch?: (
    url: string,
    init?: { headers?: Record<string, string> }
  ) => Promise<{ status: number; json(): Promise<unknown> }>;
};

export async function runStatusCommand(deps: CliStatusDeps = {}): Promise<CliStatusResult> {
  const env = deps.env ?? process.env;
  const _exists = deps.exists ?? existsSync;
  const _readFile = deps.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const _fetch: CliStatusDeps["fetch"] | undefined =
    deps.fetch ??
    (typeof globalThis.fetch === "function"
      ? (url, init) => globalThis.fetch(url, init as RequestInit)
      : undefined);

  const lines = ["MICA status", ""];
  const sessionFile = env.MICA_SESSION_FILE ?? defaultSessionFile(env);

  const fail = (label: string, detail: string) => lines.push(`FAIL ${label}: ${detail}`);
  const ok = (label: string, detail: string) => lines.push(`OK   ${label}: ${detail}`);

  if (!_exists(sessionFile)) {
    fail("Session file", `${sessionFile} (not found)`);
    lines.push("FIX  Run: mica start");
    return result(1, lines, false);
  }

  let session: SessionData;
  try {
    session = JSON.parse(_readFile(sessionFile)) as SessionData;
  } catch (error) {
    fail("Session file", error instanceof Error ? error.message : String(error));
    lines.push("FIX  Run: mica start");
    return result(1, lines, false);
  }

  const baseUrl = session.baseUrl ?? `http://${session.host ?? "127.0.0.1"}:${session.port ?? 19791}`;
  ok("Session file", sessionFile);
  ok("Session target", baseUrl);

  if (!session.authToken) {
    fail("Auth token", "missing in session file");
    lines.push("FIX  Restart MICA with: mica start");
    return result(1, lines, false);
  }

  if (!_fetch) {
    fail("Server /status reachable", "fetch unavailable");
    return result(1, lines, false);
  }

  try {
    const response = await _fetch(`${baseUrl}/status`, {
      headers: { Authorization: `Bearer ${session.authToken}` },
    });

    if (response.status === 401) {
      fail("Auth token", "401 Unauthorized");
      lines.push("FIX  Restart MICA with: mica start");
      return result(1, lines, false);
    }

    if (response.status !== 200) {
      fail("Server /status reachable", `HTTP ${response.status}`);
      lines.push("FIX  Run: mica start");
      return result(1, lines, false);
    }

    const body = (await response.json()) as Record<string, unknown>;
    const server = readRecord(body.server);
    const agents = Array.isArray(body.agents) ? body.agents : [];
    const notebooks = Array.isArray(body.notebooks) ? body.notebooks : [];

    ok("Server", String(server.state ?? "running"));
    ok("Version", String(server.version ?? session.version ?? "unknown"));
    if (typeof session.pid === "number") ok("PID", String(session.pid));
    ok("Agents", String(agents.length));
    ok("Notebooks", String(notebooks.length));
    lines.push(`Dashboard: ${baseUrl}/#token=${session.authToken}`);

    return result(0, lines, true);
  } catch (error) {
    fail("Server /status reachable", error instanceof Error ? error.message : String(error));
    lines.push("FIX  Run: mica start");
    return result(1, lines, false);
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function result(exitCode: number, lines: string[], running: boolean): CliStatusResult {
  return { exitCode, output: `${lines.join("\n")}\n`, running };
}
