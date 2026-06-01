import { randomBytes } from "node:crypto";
import path from "node:path";

export type MicaRuntimeConfig = {
  host: string;
  preferredPort: number;
  sessionFile: string;
  authToken: string;
  bridgeOnly: boolean;
};

export type LoadRuntimeConfigOptions = {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  randomToken?: () => string;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 19_791;

export function defaultSessionFile(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || process.cwd();
  return path.join(home, ".mica", "session.json");
}

export function generateAuthToken(): string {
  return randomBytes(32).toString("base64url");
}

export function loadRuntimeConfig(options: LoadRuntimeConfigOptions = {}): MicaRuntimeConfig {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv.slice(2);
  const cli = parseCliArgs(argv);

  return {
    host: cli.host ?? env.MICA_HOST ?? DEFAULT_HOST,
    preferredPort: cli.port ?? parseOptionalPort(env.MICA_PORT, "MICA_PORT") ?? DEFAULT_PORT,
    sessionFile: cli.sessionFile ?? env.MICA_SESSION_FILE ?? defaultSessionFile(env),
    authToken: cli.token ?? nonEmptyString(env.MICA_TOKEN) ?? (options.randomToken ?? generateAuthToken)(),
    bridgeOnly: cli.bridgeOnly,
  };
}

type ParsedCliArgs = {
  host?: string;
  port?: number;
  sessionFile?: string;
  token?: string;
  bridgeOnly: boolean;
};

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const parsed: ParsedCliArgs = { bridgeOnly: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--host":
        parsed.host = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case "--port":
        parsed.port = parseRequiredPort(readFlagValue(argv, index, arg), arg);
        index += 1;
        break;
      case "--session-file":
        parsed.sessionFile = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case "--token":
        parsed.token = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case "--bridge-only":
        parsed.bridgeOnly = true;
        break;
      default:
        break;
    }
  }

  return parsed;
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseOptionalPort(value: string | undefined, source: string): number | undefined {
  if (!value) return undefined;
  return parseRequiredPort(value, source);
}

function parseRequiredPort(value: string, source: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`${source} must be a positive integer port`);
  }
  return port;
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export { DEFAULT_HOST, DEFAULT_PORT };
