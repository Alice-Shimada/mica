import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";

type SpawnedProcess = {
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "spawn", listener: () => void): unknown;
  unref(): void;
};

type SpawnFn = (command: string, args: string[], options: SpawnOptions) => SpawnedProcess;

export type OpenNotebookResult = {
  status: "launching";
  path: string;
};

export async function openNotebookWithDefaultApp(
  notebookPath: string,
  options: { platform?: NodeJS.Platform; spawn?: SpawnFn } = {},
): Promise<OpenNotebookResult> {
  const platform = options.platform ?? process.platform;
  const spawn = options.spawn ?? nodeSpawn;
  const normalizedPath = validateNotebookPath(notebookPath);
  const { command, args } = openCommand(normalizedPath, platform);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };

    child.once("error", (error) => {
      settle(() => reject(new Error(`OPEN_FAILED: ${error instanceof Error ? error.message : String(error)}`)));
    });
    child.once("spawn", () => {
      child.unref();
      settle(() => resolve({ status: "launching", path: normalizedPath }));
    });
  });
}

function validateNotebookPath(notebookPath: string): string {
  if (!path.isAbsolute(notebookPath)) {
    throw new Error("BAD_REQUEST: path must be an absolute .nb file path");
  }
  if (path.extname(notebookPath).toLowerCase() !== ".nb") {
    throw new Error("BAD_REQUEST: path must point to a .nb notebook file");
  }

  let stats;
  try {
    stats = statSync(notebookPath);
  } catch {
    throw new Error(`FILE_NOT_FOUND: Notebook file not found: ${notebookPath}`);
  }
  if (!stats.isFile()) {
    throw new Error(`BAD_REQUEST: path is not a file: ${notebookPath}`);
  }

  return path.normalize(notebookPath);
}

function openCommand(notebookPath: string, platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === "win32") {
    return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", notebookPath] };
  }
  if (platform === "darwin") {
    return { command: "open", args: [notebookPath] };
  }
  if (platform === "linux") {
    return { command: "xdg-open", args: [notebookPath] };
  }
  throw new Error(`UNSUPPORTED_PLATFORM: Cannot open notebooks on ${platform}`);
}
