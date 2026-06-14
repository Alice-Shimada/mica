import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defaultSessionFile } from "../runtime/config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DoctorDeps {
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  nodeVersion?: string;
  exists?: (filePath: string) => boolean;
  readFile?: (filePath: string) => string;
  fetch?: (
    url: string,
    init?: { headers?: Record<string, string> }
  ) => Promise<{ status: number; json(): Promise<unknown> }>;
  detectWolframUserBase?: () => {
    userBase: string;
    source: string;
    warnings: string[];
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTOLOAD_MARKER = "(* BEGIN MICA control-kernel autoload *)";

// ---------------------------------------------------------------------------
// runDoctor
// ---------------------------------------------------------------------------

export async function runDoctor(
  deps: DoctorDeps = {}
): Promise<{ exitCode: number; output: string }> {
  const lines: string[] = [];
  let hasFailure = false;

  const projectRoot = deps.projectRoot ?? process.cwd();
  const env = deps.env ?? process.env;
  const nodeVersion = deps.nodeVersion ?? process.version;
  const _exists = deps.exists ?? existsSync;
  const _readFile = deps.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const _fetch: DoctorDeps["fetch"] | undefined =
    deps.fetch ??
    (typeof globalThis.fetch === "function"
      ? (url, init) => globalThis.fetch(url, init as RequestInit)
      : undefined);
  const _detectWolframUserBase = deps.detectWolframUserBase;

  const ok = (label: string, detail?: string) => {
    const d = detail !== undefined ? `: ${detail}` : "";
    lines.push(`OK   ${label}${d}`);
  };

  const fail = (label: string, detail?: string) => {
    hasFailure = true;
    const d = detail !== undefined ? `: ${detail}` : "";
    lines.push(`FAIL ${label}${d}`);
  };

  const fix = (msg: string) => {
    lines.push(`FIX  ${msg}`);
  };

  // -----------------------------------------------------------------------
  // Header
  // -----------------------------------------------------------------------
  lines.push("MICA doctor");
  lines.push("");

  // -----------------------------------------------------------------------
  // 1. Node version
  // -----------------------------------------------------------------------
  const nodeMajor = Number.parseInt(nodeVersion.replace(/^v/, "").split(".")[0], 10);
  if (Number.isFinite(nodeMajor) && nodeMajor >= 20) {
    ok("Node version", nodeVersion);
  } else {
    fail("Node version", `${nodeVersion} (Node >=20 required)`);
    fix("Install Node.js 20 or newer");
  }

  // -----------------------------------------------------------------------
  // 2. Package build
  // -----------------------------------------------------------------------
  const distCliIndex = path.join(projectRoot, "dist", "src", "cli", "index.js");
  const distBunIndex = path.join(projectRoot, "dist", "src", "bun", "index.js");
  const bridgeSource = path.join(
    projectRoot,
    "paclet",
    "Kernel",
    "MMAAgentBridge.wl"
  );

  const buildOk = _exists(distCliIndex) && _exists(distBunIndex);
  if (buildOk) {
    ok("Package build");
  } else {
    const missing: string[] = [];
    if (!_exists(distCliIndex)) missing.push("dist/src/cli/index.js");
    if (!_exists(distBunIndex)) missing.push("dist/src/bun/index.js");
    fail("Package build", `missing: ${missing.join(", ")}`);
    fix("Run: npm run build");
  }

  if (_exists(bridgeSource)) {
    ok("Bridge source path", bridgeSource);
  } else {
    fail("Bridge source path", `${bridgeSource} (not found)`);
    fix("Run: npm run build");
  }

  // -----------------------------------------------------------------------
  // 3. Session file
  // -----------------------------------------------------------------------
  const sessionFile = env.MICA_SESSION_FILE ?? defaultSessionFile(env);
  let sessionData: {
    baseUrl?: string;
    authToken?: string;
    host?: string;
    port?: number;
  } | null = null;
  let sessionBaseUrl: string | undefined;

  if (!_exists(sessionFile)) {
    fail("Session file", `${sessionFile} (not found)`);
    fix("Run: mica mcp");
  } else {
    try {
      const raw = _readFile(sessionFile);
      sessionData = JSON.parse(raw);
      sessionBaseUrl =
        sessionData?.baseUrl ??
        `http://${sessionData?.host ?? "127.0.0.1"}:${sessionData?.port ?? 19791}`;
      ok("Session file", sessionFile);
      ok("Session target", sessionBaseUrl);
    } catch (e) {
      fail(
        "Session file",
        `${sessionFile} (${e instanceof Error ? e.message : String(e)})`
      );
      fix("Run: mica mcp");
    }
  }

  // -----------------------------------------------------------------------
  // 4. Auth token
  // -----------------------------------------------------------------------
  if (sessionData && !sessionData.authToken) {
    fail("Auth token", "missing in session file");
  } else if (!sessionData) {
    fail("Auth token", "session file not available");
  }

  // -----------------------------------------------------------------------
  // 5–7. Server checks (only when session data is available)
  // -----------------------------------------------------------------------
  if (sessionData && sessionData.authToken && _fetch) {
    const statusUrl = `${sessionBaseUrl}/status`;

    try {
      const res = await _fetch(statusUrl, {
        headers: { Authorization: `Bearer ${sessionData.authToken}` },
      });

      if (res.status === 401) {
        fail("Auth token", "401 Unauthorized");
        fail("Server /status reachable", "authentication failed");
        fail("Live agent count", "server not reachable");
        fail("Live notebook count", "server not reachable");
      } else if (res.status === 200) {
        ok("Auth token");
        ok("Server /status reachable");

        const body = (await res.json()) as Record<string, unknown>;

        // Live agent count
        let agentCount: number;
        if (typeof body.agentCount === "number") {
          agentCount = body.agentCount;
        } else if (Array.isArray(body.agents)) {
          agentCount = (
            body.agents as Array<{ status?: string }>
          ).filter(
            (a) => a.status !== "offline" && a.status !== "retired"
          ).length;
        } else {
          agentCount = 0;
        }

        if (agentCount > 0) {
          ok("Live agent count", String(agentCount));
        } else {
          fail("Live agent count", "0");
        }

        // Live notebook count
        let notebookCount: number;
        if (typeof body.notebookCount === "number") {
          notebookCount = body.notebookCount;
        } else if (Array.isArray(body.notebooks)) {
          notebookCount = body.notebooks.length;
        } else {
          notebookCount = 0;
        }

        if (notebookCount > 0) {
          ok("Live notebook count", String(notebookCount));
        } else {
          fail("Live notebook count", "0");
        }
      } else {
        ok("Auth token");
        fail("Server /status reachable", `HTTP ${res.status}`);
        fail("Live agent count", "server not reachable");
        fail("Live notebook count", "server not reachable");
      }
    } catch (e) {
      fail("Auth token", "server not reachable");
      fail(
        "Server /status reachable",
        e instanceof Error ? e.message : String(e)
      );
      fix("Run: mica mcp");
      fail("Live agent count", "server not reachable");
      fail("Live notebook count", "server not reachable");
    }
  } else if (sessionData && sessionData.authToken && !_fetch) {
    fail("Auth token", "fetch unavailable");
    fail("Server /status reachable", "fetch unavailable");
    fail("Live agent count", "server not reachable");
    fail("Live notebook count", "server not reachable");
  } else {
    // No valid session data
    fail("Server /status reachable", "session file not available");
    fail("Live agent count", "server not reachable");
    fail("Live notebook count", "server not reachable");
  }

  // -----------------------------------------------------------------------
  // 8. Wolfram user base
  // -----------------------------------------------------------------------
  if (_detectWolframUserBase) {
    try {
      const detection = _detectWolframUserBase();
      ok("Wolfram user base", `${detection.userBase} (${detection.source})`);

      // Kernel/init.m
      const initPath = path.join(detection.userBase, "Kernel", "init.m");
      if (_exists(initPath)) {
        ok("Kernel/init.m", initPath);

        // Autoload block
        const content = _readFile(initPath);
        if (content.includes(AUTOLOAD_MARKER)) {
          ok("Autoload block");
        } else {
          fail("Autoload block", `not found in ${initPath}`);
          fix("Run: mica install");
        }
      } else {
        fail("Kernel/init.m", `${initPath} (not found)`);
        fix("Run: mica install");
        fail("Autoload block", "Kernel/init.m not found");
      }
    } catch (e) {
      fail(
        "Wolfram user base",
        e instanceof Error ? e.message : String(e)
      );
      fail("Kernel/init.m", "Wolfram user base detection failed");
      fail("Autoload block", "Wolfram user base detection failed");
    }
  } else {
    fail("Wolfram user base", "detector unavailable");
    fail("Kernel/init.m", "Wolfram user base detection failed");
    fail("Autoload block", "Wolfram user base detection failed");
  }

  // -----------------------------------------------------------------------
  // Result
  // -----------------------------------------------------------------------
  return { exitCode: hasFailure ? 1 : 0, output: `${lines.join("\n")}\n` };
}
