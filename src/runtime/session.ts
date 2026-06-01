import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type MicaSessionFile = {
  host: string;
  port: number;
  baseUrl: string;
  authToken: string | undefined;
  pid: number;
  version: string;
  status: "running";
  updatedAt: string;
};

export type WriteSessionFileInput = Omit<MicaSessionFile, "baseUrl" | "updatedAt"> & {
  updatedAt?: string;
};

export async function writeSessionFile(sessionFile: string, input: WriteSessionFileInput): Promise<MicaSessionFile> {
  const session: MicaSessionFile = {
    ...input,
    baseUrl: `http://${input.host}:${input.port}`,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };

  await mkdir(path.dirname(sessionFile), { recursive: true });
  const tempFile = `${sessionFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  await rename(tempFile, sessionFile);

  return session;
}
