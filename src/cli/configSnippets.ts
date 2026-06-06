export type CliConfigResult = {
  exitCode: number;
  output: string;
};

const CLIENTS = ["codex", "claude-desktop", "cursor", "opencode"] as const;
type Client = (typeof CLIENTS)[number];

export function runConfigCommand(argv: string[]): CliConfigResult {
  const client = argv[0] as Client | undefined;
  if (!client || !CLIENTS.includes(client)) {
    return {
      exitCode: 1,
      output: `Usage: mica config <${CLIENTS.join("|")}>\n`,
    };
  }

  if (client === "codex") {
    return ok(`[mcp_servers.mica]\ncommand = "mica"\nargs = ["mcp"]\n`);
  }

  if (client === "opencode") {
    return ok(`${JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      mcp: {
        mica: {
          type: "local",
          command: ["mica", "mcp"],
          enabled: true,
        },
      },
    }, null, 2)}\n`);
  }

  return ok(`${JSON.stringify({
    mcpServers: {
      mica: {
        command: "mica",
        args: ["mcp"],
      },
    },
  }, null, 2)}\n`);
}

function ok(output: string): CliConfigResult {
  return { exitCode: 0, output };
}
