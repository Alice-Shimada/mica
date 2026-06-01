#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HIDDEN_BEGIN =
  "(* BEGIN MICA hidden-agent autoload *)";
export const HIDDEN_END =
  "(* END MICA hidden-agent autoload *)";
export const CONTROL_BEGIN =
  "(* BEGIN MICA control-kernel autoload *)";
export const CONTROL_END =
  "(* END MICA control-kernel autoload *)";
const OLD_HIDDEN_BEGIN = "(* BEGIN MMA MCP Bridge hidden-agent autoload *)";
const OLD_HIDDEN_END = "(* END MMA MCP Bridge hidden-agent autoload *)";
const OLD_CONTROL_BEGIN = "(* BEGIN MMA MCP Bridge control-kernel autoload *)";
const OLD_CONTROL_END = "(* END MMA MCP Bridge control-kernel autoload *)";
export const STANDARD_INIT_HEADER =
  "(* User Wolfram Kernel/init.m. MICA preserves user content outside marked blocks. *)\n";

const REQUIRED_BRIDGE_FILES = [
  "package.json",
  path.join("src", "bun", "index.ts"),
  path.join("paclet", "Kernel", "MMAAgentBridge.wl"),
  path.join("paclet", "PacletInfo.wl"),
];

export function parseArgs(argv) {
  const options = { dryRun: false, uninstall: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--uninstall") {
      options.uninstall = true;
    } else if (arg === "--bridge-root") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error("--bridge-root requires a value");
      options.bridgeRoot = value;
      index += 1;
    } else if (arg === "--wolfram-userbase") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error("--wolfram-userbase requires a value");
      options.wolframUserBase = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

export function helpText() {
  return `Usage: node scripts/install.js [options]

Options:
  --dry-run                    Preview init.m changes without writing files
  --uninstall                  Remove MICA marked autoload blocks
  --wolfram-userbase <path>    Use a specific Wolfram user base directory
  --bridge-root <path>         Use a specific MICA checkout
  -h, --help                   Show this help
`;
}

export function ensureNode20(version = process.versions.node) {
  const major = Number.parseInt(version.split(".")[0] ?? "0", 10);
  if (!Number.isFinite(major) || major < 20) {
    throw new Error(
      `Node >=20 is required. Current Node version is ${version}.`
    );
  }
}

export function defaultBridgeRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function validateBridgeRoot(bridgeRoot, exists = existsSync) {
  const absoluteRoot = path.resolve(bridgeRoot);
  const missing = REQUIRED_BRIDGE_FILES.filter(
    (relativePath) => !exists(path.join(absoluteRoot, relativePath))
  );
  if (missing.length > 0) {
    throw new Error(
      `Invalid bridge root: ${absoluteRoot}\nMissing required files:\n${missing
        .map((file) => `- ${file}`)
        .join("\n")}`
    );
  }
  return absoluteRoot;
}

function trimWolframscriptPath(stdout) {
  const line = String(stdout ?? "")
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return undefined;
  return line.replace(/^"|"$/g, "");
}

export function readWolframscriptUserBase(runner = spawnSync) {
  const result = runner("wolframscript", ["-code", "$UserBaseDirectory"], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) return undefined;
  return trimWolframscriptPath(result.stdout);
}

export function detectWolframUserBase({
  override,
  platform = process.platform,
  env = process.env,
  homedir = os.homedir(),
  exists = existsSync,
  runWolframscript = () => readWolframscriptUserBase(),
} = {}) {
  if (override) {
    return {
      userBase: path.resolve(override),
      source: "--wolfram-userbase",
      warnings: [],
    };
  }

  const fromWolframscript = runWolframscript();
  if (fromWolframscript) {
    return {
      userBase: path.resolve(fromWolframscript),
      source: "wolframscript",
      warnings: [],
    };
  }

  const warnings = [
    "wolframscript was not available or did not return $UserBaseDirectory; using platform fallback.",
  ];
  if (platform === "win32") {
    const appData = env.APPDATA;
    if (!appData)
      throw new Error(
        "Cannot resolve Wolfram user base: APPDATA is not set and wolframscript was unavailable."
      );
    const wolframBase = path.join(appData, "Wolfram");
    const mathematicaBase = path.join(appData, "Mathematica");
    return {
      userBase: exists(wolframBase) ? wolframBase : mathematicaBase,
      source: "platform fallback",
      warnings,
    };
  }
  if (platform === "darwin") {
    return {
      userBase: path.join(homedir, "Library", "Wolfram"),
      source: "platform fallback",
      warnings,
    };
  }
  return {
    userBase: path.join(homedir, ".Wolfram"),
    source: "platform fallback",
    warnings,
  };
}

export function wolframString(value) {
  return `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")}"`;
}

export function generateAutoloadBlock(bridgeSourcePath) {
  return `${CONTROL_BEGIN}
Quiet @ Check[
  With[{bridgePath = ${wolframString(bridgeSourcePath)}},
    If[
      TrueQ[$Notebooks] &&
      FileExistsQ[bridgePath] &&
      !TrueQ[Quiet @ Check[CurrentValue[$FrontEndSession, {TaggingRules, "MMAAgentBridge", "ControlKernelBooting"}], False]] &&
      !TrueQ[Quiet @ Check[CurrentValue[$FrontEndSession, {TaggingRules, "MMAAgentBridge", "AgentRunning"}], False]],
      Get[bridgePath];
      MMAAgentBridge\`Private\`$BridgePermissions = <|
        "ReadNotebook" -> True,
        "InsertCell" -> True,
        "ModifyCell" -> True,
        "DeleteCell" -> True,
        "RunCell" -> True,
        "SaveNotebook" -> False
      |>;
      MMAAgentBridge\`StartMMAAgentControlKernel[];
    ];
  ];
  Null,
  Null
];
${CONTROL_END}
`;
}

function removeOneBlockPair(content, begin, end) {
  let result = content;
  let removed = 0;
  while (result.includes(begin)) {
    const start = result.indexOf(begin);
    const endStart = result.indexOf(end, start + begin.length);
    if (endStart < 0)
      throw new Error(`Found ${begin} without matching ${end}`);
    let removeEnd = endStart + end.length;
    if (result.slice(removeEnd, removeEnd + 2) === "\r\n") removeEnd += 2;
    else if (result.slice(removeEnd, removeEnd + 1) === "\n") removeEnd += 1;
    result = result.slice(0, start) + result.slice(removeEnd);
    removed += 1;
  }
  return { content: result, removed };
}

export function removeBridgeBlocks(content) {
  const withoutHidden = removeOneBlockPair(
    content,
    HIDDEN_BEGIN,
    HIDDEN_END
  );
  const withoutOldHidden = removeOneBlockPair(
    withoutHidden.content,
    OLD_HIDDEN_BEGIN,
    OLD_HIDDEN_END
  );
  const withoutControl = removeOneBlockPair(
    withoutOldHidden.content,
    CONTROL_BEGIN,
    CONTROL_END
  );
  const withoutOldControl = removeOneBlockPair(
    withoutControl.content,
    OLD_CONTROL_BEGIN,
    OLD_CONTROL_END
  );
  return {
    content: withoutOldControl.content.replace(/(?:\r?\n){3,}/g, "\n\n"),
    removed: withoutHidden.removed + withoutOldHidden.removed + withoutControl.removed + withoutOldControl.removed,
  };
}

function ensureTrailingNewline(content) {
  if (content.length === 0 || content.endsWith("\n")) return content;
  return `${content}\n`;
}

export function applyInstallToContent(existingContent, autoloadBlock) {
  const originalBase =
    existingContent.length > 0 ? existingContent : STANDARD_INIT_HEADER;
  const removed = removeBridgeBlocks(originalBase);
  const preserved = ensureTrailingNewline(removed.content.trimEnd());
  const separator = preserved.length > 0 ? "\n" : "";
  const content = `${preserved}${separator}${autoloadBlock}`;
  return {
    content,
    removed: removed.removed,
    changed: content !== existingContent,
  };
}

export function applyUninstallToContent(existingContent) {
  const removed = removeBridgeBlocks(existingContent);
  if (removed.removed === 0) {
    return { content: existingContent, removed: 0, changed: false };
  }
  const content = ensureTrailingNewline(removed.content.trimEnd());
  return {
    content,
    removed: removed.removed,
    changed: content !== existingContent,
  };
}

function countLines(content) {
  if (content.length === 0) return 0;
  return content.split(/\r?\n/).length;
}

function countCurrentBlocks(content) {
  return content.split(CONTROL_BEGIN).length - 1;
}

export function summarizeContentChange(before, after, removed) {
  const controlBlocks = countCurrentBlocks(after);
  return [
    `Before lines: ${countLines(before)}`,
    `After lines: ${countLines(after)}`,
    `Bridge blocks to remove: ${removed}`,
    `New control block present after change: ${
      controlBlocks > 0 ? "yes" : "no"
    }`,
    `Control blocks after change: ${controlBlocks}`,
  ].join("\n");
}

function timestamp(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function nextBackupPath(initPath, exists = existsSync, date = new Date()) {
  const base = `${initPath}.${timestamp(date)}.bak`;
  if (!exists(base)) return base;
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base}.${index}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error(
    `Could not choose an unused backup path next to ${initPath}`
  );
}

function commandAvailable(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function resolveCommandPath(command, runner = spawnSync) {
  if (path.isAbsolute(command) || /[\\/]/.test(command)) return command;

  const result =
    process.platform === "win32"
      ? runner("where", [command], { encoding: "utf8" })
      : runner("sh", ["-lc", `command -v ${shellQuote(command)}`], {
          encoding: "utf8",
        });
  if (result.error || result.status !== 0) return undefined;
  return trimWolframscriptPath(result.stdout);
}

export function renderWolframStartupSnippet(bridgeRoot) {
  const bridgeSourcePath = path.join(
    bridgeRoot,
    "paclet",
    "Kernel",
    "MMAAgentBridge.wl"
  );

  return [
    "Manual Wolfram Desktop startup fallback:",
    `Get[${wolframString(bridgeSourcePath)}];`,
    "MMAAgentBridge`Private`$BridgePermissions = <|",
    '  "ReadNotebook" -> True,',
    '  "InsertCell" -> True,',
    '  "ModifyCell" -> True,',
    '  "DeleteCell" -> True,',
    '  "RunCell" -> True,',
    '  "SaveNotebook" -> False',
    "|>;",
    "MMAAgentBridge`StartMMAAgentControlKernel[]",
  ].join("\n");
}

export function renderMcpSnippets(
  bridgeRoot,
  { bunCommand = "bun", nodeCommand = "node" } = {}
) {
  const nodeSnippet = {
    mcpServers: {
      "mica": {
        command: nodeCommand,
        args: [path.join(bridgeRoot, "dist", "src", "bun", "index.js")],
      },
    },
  };
  const bunSnippet = {
    mcpServers: {
      "mica": {
        command: bunCommand,
        args: ["run", path.join(bridgeRoot, "src", "bun", "index.ts")],
      },
    },
  };
  return [
    "MCP config snippets (copy into your MCP client config; this installer does not edit it):",
    "",
    "Production (built Node):",
    JSON.stringify(nodeSnippet, null, 2),
    "",
    "Development (Bun):",
    JSON.stringify(bunSnippet, null, 2),
    "",
    renderWolframStartupSnippet(bridgeRoot),
  ].join("\n");
}

export function renderVersionSupport() {
  return [
    "Version support:",
    "  Supported: Wolfram Desktop / Mathematica 14.1+",
    "  Experimental: Mathematica 13.x / 14.0",
    "  Unsupported: Headless Wolfram Engine for live notebook control",
  ].join("\n");
}

export function runInstaller(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return helpText();
  ensureNode20();

  const bridgeRoot = validateBridgeRoot(
    options.bridgeRoot ?? defaultBridgeRoot()
  );
  const detection = detectWolframUserBase({
    override: options.wolframUserBase,
  });
  const kernelDir = path.join(detection.userBase, "Kernel");
  const initPath = path.join(kernelDir, "init.m");
  const initExists = existsSync(initPath);
  const before = initExists ? readFileSync(initPath, "utf8") : "";
  const bridgeSourcePath = path.join(
    bridgeRoot,
    "paclet",
    "Kernel",
    "MMAAgentBridge.wl"
  );
  const change = options.uninstall
    ? applyUninstallToContent(before)
    : applyInstallToContent(before, generateAutoloadBlock(bridgeSourcePath));

  const warnings = [...detection.warnings];
  if (!commandAvailable("bun"))
    warnings.push(
      "bun was not found on PATH; the Bun MCP snippet is still printed for machines that have Bun installed."
    );
  const nodeFallbackPath = path.join(bridgeRoot, "dist", "src", "index.js");
  if (!existsSync(nodeFallbackPath))
    warnings.push(
      `Built Node fallback is missing: ${nodeFallbackPath}\nRun npm run build before using the Node fallback snippet.`
    );

  const lines = [];
  lines.push(
    options.dryRun
      ? "Dry run: no files written"
      : !change.changed && options.uninstall
        ? "No MICA Wolfram autoload was present"
        : options.uninstall
          ? "Removed MICA Wolfram autoload"
          : "Installed MICA Wolfram autoload"
  );
  lines.push(`Bridge root: ${bridgeRoot}`);
  lines.push(
    `Wolfram user base: ${detection.userBase} (${detection.source})`
  );
  lines.push(`Target init.m: ${initPath}`);
  lines.push(
    summarizeContentChange(before, change.content, change.removed)
  );

  if (!options.uninstall) {
    lines.push(renderVersionSupport());
  }

  if (!options.dryRun && change.changed) {
    mkdirSync(kernelDir, { recursive: true });
    const backupPath = nextBackupPath(initPath);
    writeFileSync(backupPath, before, "utf8");
    writeFileSync(initPath, change.content, "utf8");
    lines.push(`Backup written: ${backupPath}`);
  } else if (!change.changed) {
    if (!initExists && options.uninstall) {
      lines.push("No init.m existed; nothing was written.");
    } else {
      lines.push("No changes needed.");
    }
  }

  if (warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of warnings) lines.push(`- ${warning}`);
  }

  if (!options.uninstall) {
    lines.push(
      "Restart Wolfram Desktop after installing or reinstalling the autoload block."
    );
    lines.push(
      renderMcpSnippets(bridgeRoot, {
        bunCommand: resolveCommandPath("bun") ?? "bun",
        nodeCommand: process.execPath || resolveCommandPath("node") || "node",
      })
    );
    lines.push("Verification commands:");
    lines.push("  npm test");
    lines.push("  npm run typecheck");
    lines.push("  npm run build");
    lines.push("  node scripts/install.js --dry-run");
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  try {
    process.stdout.write(runInstaller(process.argv.slice(2)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`ERROR: ${message}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  main();
}
