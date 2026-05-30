export type RuntimeMode = "mcp" | "bridge-only";

export function runtimeModeFromArgs(args: string[]): RuntimeMode {
  return args.includes("--bridge-only") ? "bridge-only" : "mcp";
}
