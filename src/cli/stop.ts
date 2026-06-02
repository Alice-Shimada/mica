import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { defaultSessionFile } from "../runtime/config.js";

type SessionData = {
  pid?: number;
};

export type CliStopResult = {
  exitCode: number;
  output: string;
};

export type CliStopDeps = {
  env?: NodeJS.ProcessEnv;
  exists?: (filePath: string) => boolean;
  readFile?: (filePath: string) => string;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  unlink?: (filePath: string) => void;
};

export async function runStopCommand(deps: CliStopDeps = {}): Promise<CliStopResult> {
  const env = deps.env ?? process.env;
  const sessionFile = env.MICA_SESSION_FILE ?? defaultSessionFile(env);
  const _exists = deps.exists ?? existsSync;
  const _readFile = deps.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const _kill = deps.kill ?? ((pid: number, signal: NodeJS.Signals) => { process.kill(pid, signal); });
  const _unlink = deps.unlink ?? ((p: string) => { unlinkSync(p); });

  if (!_exists(sessionFile)) {
    return { exitCode: 1, output: `MICA is not running\nSession file not found: ${sessionFile}\n` };
  }

  let session: SessionData;
  try {
    session = JSON.parse(_readFile(sessionFile)) as SessionData;
  } catch (error) {
    return { exitCode: 1, output: `Cannot read session file: ${error instanceof Error ? error.message : String(error)}\n` };
  }

  if (typeof session.pid !== "number" || !Number.isInteger(session.pid) || session.pid <= 0) {
    return { exitCode: 1, output: "Cannot stop MICA: session file has no valid pid\n" };
  }

  try {
    _kill(session.pid, "SIGTERM");
  } catch (error) {
    return { exitCode: 1, output: `Cannot stop MICA pid ${session.pid}: ${error instanceof Error ? error.message : String(error)}\n` };
  }

  try {
    _unlink(sessionFile);
  } catch {
    // The process may have already removed or replaced it; stopping still succeeded.
  }

  return { exitCode: 0, output: `MICA stopped\nPID: ${session.pid}\n` };
}
