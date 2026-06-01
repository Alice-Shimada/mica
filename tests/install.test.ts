import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as installer from "../scripts/install.js";

const tempRoots: string[] = [];

function makeTempDir(name: string): string {
  const dir = path.join(
    tmpdir(),
    `mica-${name}-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  tempRoots.push(dir);
  return dir;
}

function makeBridgeFixture(): string {
  const bridgeRoot = makeTempDir("bridge-root");
  mkdirSync(path.join(bridgeRoot, "src", "bun"), { recursive: true });
  mkdirSync(path.join(bridgeRoot, "paclet", "Kernel"), { recursive: true });
  writeFileSync(
    path.join(bridgeRoot, "package.json"),
    JSON.stringify({ name: "mica" }),
    "utf8"
  );
  writeFileSync(
    path.join(bridgeRoot, "src", "bun", "index.ts"),
    "export {};\n",
    "utf8"
  );
  writeFileSync(
    path.join(bridgeRoot, "paclet", "Kernel", "MMAAgentBridge.wl"),
    'BeginPackage["MMAAgentBridge`"]\n',
    "utf8"
  );
  writeFileSync(
    path.join(bridgeRoot, "paclet", "PacletInfo.wl"),
    "PacletObject[<||>]\n",
    "utf8"
  );
  return bridgeRoot;
}

const installerPath = path.resolve("scripts", "install.js");

function runInstaller(args: string[]): string {
  return execFileSync(process.execPath, [installerPath, ...args], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("installer argument parsing", () => {
  it("parses default, dry-run, uninstall, and override options", () => {
    expect(installer.parseArgs([])).toEqual({
      dryRun: false,
      uninstall: false,
      help: false,
    });
    expect(installer.parseArgs(["--dry-run", "--uninstall"])).toEqual({
      dryRun: true,
      uninstall: true,
      help: false,
    });
    expect(
      installer.parseArgs([
        "--bridge-root",
        "C:\\repo",
        "--wolfram-userbase",
        "C:\\Users\\me\\AppData\\Roaming\\Wolfram",
      ])
    ).toEqual({
      dryRun: false,
      uninstall: false,
      help: false,
      bridgeRoot: "C:\\repo",
      wolframUserBase: "C:\\Users\\me\\AppData\\Roaming\\Wolfram",
    });
  });

  it("parses --help and -h with help:true while preserving defaults", () => {
    expect(installer.parseArgs(["--help"])).toEqual({
      dryRun: false,
      uninstall: false,
      help: true,
    });
    expect(installer.parseArgs(["-h"])).toEqual({
      dryRun: false,
      uninstall: false,
      help: true,
    });
  });

  it("rejects unknown options and missing option values", () => {
    expect(() => installer.parseArgs(["--wat"])).toThrow(
      /Unknown option: --wat/
    );
    expect(() => installer.parseArgs(["--bridge-root"])).toThrow(
      /--bridge-root requires a value/
    );
    expect(() => installer.parseArgs(["--wolfram-userbase"])).toThrow(
      /--wolfram-userbase requires a value/
    );
  });
});

describe("installer environment checks", () => {
  it("requires Node 20 or newer", () => {
    expect(() => installer.ensureNode20("20.0.0")).not.toThrow();
    expect(() => installer.ensureNode20("22.15.0")).not.toThrow();
    expect(() => installer.ensureNode20("18.19.0")).toThrow(
      /Node >=20 is required/
    );
  });
});

describe("installer Wolfram user base detection", () => {
  it("uses an explicit Wolfram user base override first", () => {
    const selected = (installer.detectWolframUserBase as any)({
      override: path.join("C:", "custom", "Wolfram"),
      runWolframscript: () => path.join("C:", "ignored"),
    });

    expect(selected.source).toBe("--wolfram-userbase");
    expect(selected.userBase).toContain(path.join("custom", "Wolfram"));
    expect(selected.warnings).toEqual([]);
  });

  it("uses wolframscript when it returns a path", () => {
    const selected = installer.detectWolframUserBase({
      platform: "linux",
      homedir: "/home/agent",
      runWolframscript: () => "/home/agent/.WolframDesktop",
    });

    expect(selected).toEqual({
      userBase: path.resolve("/home/agent/.WolframDesktop"),
      source: "wolframscript",
      warnings: [],
    });
  });

  it("falls back to platform defaults when wolframscript is unavailable", () => {
    const selected = installer.detectWolframUserBase({
      platform: "win32",
      env: { APPDATA: "C:\\Users\\agent\\AppData\\Roaming" },
      exists: (filePath) =>
        String(filePath).endsWith(`${path.sep}Wolfram`),
      runWolframscript: () => undefined,
    });

    expect(selected.userBase).toBe(
      path.join("C:\\Users\\agent\\AppData\\Roaming", "Wolfram")
    );
    expect(selected.source).toBe("platform fallback");
    expect(selected.warnings.join("\n")).toContain(
      "wolframscript was not available"
    );
  });

  it("falls back to Mathematica on Windows when Wolfram dir does not exist", () => {
    const selected = installer.detectWolframUserBase({
      platform: "win32",
      env: { APPDATA: "C:\\Users\\agent\\AppData\\Roaming" },
      exists: () => false,
      runWolframscript: () => undefined,
    });

    expect(selected.userBase).toBe(
      path.join("C:\\Users\\agent\\AppData\\Roaming", "Mathematica")
    );
    expect(selected.source).toBe("platform fallback");
  });

  it("uses macOS fallback", () => {
    const selected = installer.detectWolframUserBase({
      platform: "darwin",
      homedir: "/Users/agent",
      runWolframscript: () => undefined,
    });

    expect(selected.userBase).toBe(
      path.join("/Users/agent", "Library", "Wolfram")
    );
    expect(selected.source).toBe("platform fallback");
  });

  it("uses Linux fallback", () => {
    const selected = installer.detectWolframUserBase({
      platform: "linux",
      homedir: "/home/agent",
      runWolframscript: () => undefined,
    });

    expect(selected.userBase).toBe(path.join("/home/agent", ".Wolfram"));
    expect(selected.source).toBe("platform fallback");
  });
});

describe("installer Wolfram init block generation", () => {
  it("escapes backslashes, quotes, CR, LF, and tabs for valid Wolfram strings", () => {
    const result = installer.wolframString(
      'C:\\Users\\agent\\mma "bridge"\r\n\tpaclet\\Kernel\\MMAAgentBridge.wl'
    );
    expect(result).toBe(
      '"C:\\\\Users\\\\agent\\\\mma \\"bridge\\"\\r\\n\\tpaclet\\\\Kernel\\\\MMAAgentBridge.wl"'
    );
  });

  it("generates the control-kernel autoload block", () => {
    const sourcePath =
      "C:\\Users\\agent\\repo\\paclet\\Kernel\\MMAAgentBridge.wl";
    const block = installer.generateAutoloadBlock(sourcePath);

    expect(block).toContain(installer.CONTROL_BEGIN);
    expect(block).toContain(
      'With[{bridgePath = "C:\\\\Users\\\\agent\\\\repo\\\\paclet\\\\Kernel\\\\MMAAgentBridge.wl"}'
    );
    expect(block).toContain("TrueQ[$Notebooks]");
    expect(block).toContain("FileExistsQ[bridgePath]");
    expect(block).toContain(
      'CurrentValue[$FrontEndSession, {TaggingRules, "MMAAgentBridge", "ControlKernelBooting"}]'
    );
    expect(block).toContain(
      'CurrentValue[$FrontEndSession, {TaggingRules, "MMAAgentBridge", "AgentRunning"}]'
    );
    expect(block).toContain('"SaveNotebook" -> False');
    expect(block).toContain(
      "MMAAgentBridge`StartMMAAgentControlKernel[];"
    );
    expect(block).toContain("Get[bridgePath];");
    expect(block).toContain(installer.CONTROL_END);
  });

  it("removes old hidden-agent and control-kernel blocks while preserving user content", () => {
    const oldHidden = `${installer.HIDDEN_BEGIN}\nold hidden\n${installer.HIDDEN_END}\n`;
    const oldControl = `${installer.CONTROL_BEGIN}\nold control\n${installer.CONTROL_END}\n`;
    const input = `Print["before"]\n${oldHidden}Print["middle"]\n${oldControl}Print["after"]\n`;

    const result = installer.removeBridgeBlocks(input);

    expect(result.removed).toBe(2);
    expect(result.content).toContain('Print["before"]');
    expect(result.content).toContain('Print["middle"]');
    expect(result.content).toContain('Print["after"]');
    expect(result.content).not.toContain("old hidden");
    expect(result.content).not.toContain("old control");
  });

  it("removes legacy MMA MCP Bridge markers for backward compatibility", () => {
    const oldHidden = "(* BEGIN MMA MCP Bridge hidden-agent autoload *)\nold hidden\n(* END MMA MCP Bridge hidden-agent autoload *)\n";
    const oldControl = "(* BEGIN MMA MCP Bridge control-kernel autoload *)\nold control\n(* END MMA MCP Bridge control-kernel autoload *)\n";
    const input = `Print["before"]\n${oldHidden}Print["middle"]\n${oldControl}Print["after"]\n`;

    const result = installer.removeBridgeBlocks(input);

    expect(result.removed).toBe(2);
    expect(result.content).toContain('Print["before"]');
    expect(result.content).toContain('Print["middle"]');
    expect(result.content).toContain('Print["after"]');
    expect(result.content).not.toContain("old hidden");
    expect(result.content).not.toContain("old control");
  });

  it("makes repeated install content idempotent", () => {
    const block = installer.generateAutoloadBlock(
      "/Users/agent/repo/paclet/Kernel/MMAAgentBridge.wl"
    );
    const first = installer.applyInstallToContent(
      'Print["user"]\n',
      block
    ).content;
    const second = installer.applyInstallToContent(first, block).content;

    expect(second).toBe(first);
    expect(second.split(installer.CONTROL_BEGIN)).toHaveLength(2);
  });

  it("uninstalls only marked bridge blocks", () => {
    const block = installer.generateAutoloadBlock(
      "/Users/agent/repo/paclet/Kernel/MMAAgentBridge.wl"
    );
    const installed = `Print["before"]\n${block}Print["after"]\n`;
    const uninstalled = installer.applyUninstallToContent(installed);

    expect(uninstalled.removed).toBe(1);
    expect(uninstalled.content).toBe('Print["before"]\nPrint["after"]\n');
  });

  it("preserves unrelated content during uninstall", () => {
    const content = `(* my custom init *)\nPrint["hello"]\n${installer.CONTROL_BEGIN}\nbridge stuff\n${installer.CONTROL_END}\nPrint["world"]\n`;
    const result = installer.applyUninstallToContent(content);

    expect(result.removed).toBe(1);
    expect(result.content).toContain('(* my custom init *)');
    expect(result.content).toContain('Print["hello"]');
    expect(result.content).toContain('Print["world"]');
    expect(result.content).not.toContain("bridge stuff");
  });

  it("returns unchanged content and changed:false when uninstall finds no bridge blocks", () => {
    const content = 'Print["hello"]\nPrint["world"]\n';
    const result = installer.applyUninstallToContent(content);

    expect(result.removed).toBe(0);
    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
  });

  it("handles CRLF blank-line collapse after bridge block removal", () => {
    const crlf = "\r\n";
    const input =
      `Print["before"]${crlf}${crlf}${crlf}${crlf}` +
      `${installer.CONTROL_BEGIN}${crlf}old control${crlf}${installer.CONTROL_END}` +
      `${crlf}${crlf}${crlf}${crlf}Print["after"]${crlf}`;

    const result = installer.removeBridgeBlocks(input);

    expect(result.removed).toBe(1);
    expect(result.content).toContain('Print["before"]');
    expect(result.content).toContain('Print["after"]');
    expect(result.content).not.toContain("old control");
    // Must not contain triple-or-more blank lines
    expect(result.content).not.toMatch(/(?:\r?\n){3,}/);
  });
});

describe("installer MCP snippet rendering", () => {
  it("prints Bun and built Node MCP snippets without writing client config", () => {
    const bridgeRoot = path.resolve("C:\\repo\\mica");
    const snippets = installer.renderMcpSnippets(bridgeRoot);

    expect(snippets).toContain('"command": "bun"');
    expect(snippets).toContain('"args": [');
    expect(snippets).toContain("src");
    expect(snippets).toContain("bun");
    expect(snippets).toContain("index.ts");
    expect(snippets).toContain('"command": "node"');
    expect(snippets).toContain("dist");
    expect(snippets).toContain("index.js");
    expect(snippets).toContain(
      "this installer does not edit"
    );
  });

  it("can render MCP snippets with absolute command paths for clients without shell PATH", () => {
    const bridgeRoot = path.resolve("/repo/mica");
    const snippets = installer.renderMcpSnippets(bridgeRoot, {
      bunCommand: "/home/agent/.bun/bin/bun",
      nodeCommand: "/usr/local/bin/node",
    });

    expect(snippets).toContain('"command": "/home/agent/.bun/bin/bun"');
    expect(snippets).toContain('"command": "/usr/local/bin/node"');
    expect(snippets).not.toContain('"command": "bun"');
    expect(snippets).not.toContain('"command": "node"');
  });

  it("prints a manual Wolfram startup snippet with default notebook-control permissions", () => {
    const bridgeRoot = path.resolve("/repo/mica");
    const snippets = installer.renderWolframStartupSnippet(bridgeRoot);
    const expectedPath = path.join(bridgeRoot, "paclet", "Kernel", "MMAAgentBridge.wl");

    expect(snippets).toContain("Manual Wolfram Desktop startup fallback:");
    expect(snippets).toContain("MMAAgentBridge`Private`$BridgePermissions = <|");
    expect(snippets).toContain('"ReadNotebook" -> True');
    expect(snippets).toContain('"InsertCell" -> True');
    expect(snippets).toContain('"ModifyCell" -> True');
    expect(snippets).toContain('"DeleteCell" -> True');
    expect(snippets).toContain('"RunCell" -> True');
    expect(snippets).toContain('"SaveNotebook" -> False');
    expect(snippets).toContain("MMAAgentBridge`StartMMAAgentControlKernel[]");
  });
});

describe("installer CLI filesystem behavior", () => {
  it("dry-run reports planned changes without writing init.m", () => {
    const bridgeRoot = makeBridgeFixture();
    const userBase = makeTempDir("wolfram-userbase");

    const output = runInstaller([
      "--dry-run",
      "--bridge-root",
      bridgeRoot,
      "--wolfram-userbase",
      userBase,
    ]);

    expect(output).toContain("Dry run: no files written");
    expect(output).toContain(
      path.join(userBase, "Kernel", "init.m")
    );
    expect(output).toContain("Bridge blocks to remove: 0");
    expect(output).toContain("MCP config snippets");
    expect(output).toContain("14.1+");
    expect(output).toContain("Experimental");
    expect(output).toContain("Headless");
    expect(existsSync(path.join(userBase, "Kernel", "init.m"))).toBe(false);
  });

  it("installs, backs up, is idempotent, and uninstalls", () => {
    const bridgeRoot = makeBridgeFixture();
    const userBase = makeTempDir("wolfram-userbase");
    const kernelDir = path.join(userBase, "Kernel");
    const initPath = path.join(kernelDir, "init.m");
    mkdirSync(kernelDir, { recursive: true });
    writeFileSync(initPath, 'Print["keep me"]\n', "utf8");

    // First install
    const firstOutput = runInstaller([
      "--bridge-root",
      bridgeRoot,
      "--wolfram-userbase",
      userBase,
    ]);
    const firstContent = readFileSync(initPath, "utf8");
    const backupFiles = readdirSync(kernelDir).filter(
      (name) => name.startsWith("init.m.") && name.endsWith(".bak")
    );

    expect(firstOutput).toContain(
      "Installed MICA Wolfram autoload"
    );
    expect(firstOutput).toContain("Restart Wolfram Desktop");
    expect(firstOutput).toContain("MCP config snippets");
    expect(firstOutput).toContain("14.1+");
    expect(firstOutput).toContain("Experimental");
    expect(firstOutput).toContain("Headless");
    expect(firstContent).toContain('Print["keep me"]');
    expect(firstContent).toContain(installer.CONTROL_BEGIN);
    expect(backupFiles.length).toBeGreaterThanOrEqual(1);

    // Reinstall (idempotent)
    runInstaller([
      "--bridge-root",
      bridgeRoot,
      "--wolfram-userbase",
      userBase,
    ]);
    const secondContent = readFileSync(initPath, "utf8");
    expect(secondContent).toContain('Print["keep me"]');
    expect(secondContent.split(installer.CONTROL_BEGIN)).toHaveLength(2);

    // Uninstall
    const uninstallOutput = runInstaller([
      "--uninstall",
      "--bridge-root",
      bridgeRoot,
      "--wolfram-userbase",
      userBase,
    ]);
    const uninstalledContent = readFileSync(initPath, "utf8");
    expect(uninstallOutput).toContain(
      "Removed MICA Wolfram autoload"
    );
    expect(uninstalledContent).toBe('Print["keep me"]\n');
  });

  it("uninstall does not create init.m when no startup file exists", () => {
    const bridgeRoot = makeBridgeFixture();
    const userBase = makeTempDir("wolfram-userbase");
    const initPath = path.join(userBase, "Kernel", "init.m");

    const output = runInstaller([
      "--uninstall",
      "--bridge-root",
      bridgeRoot,
      "--wolfram-userbase",
      userBase,
    ]);

    expect(output).toContain(
      "No MICA Wolfram autoload was present"
    );
    expect(output).toContain(
      "No init.m existed; nothing was written."
    );
    expect(existsSync(initPath)).toBe(false);
  });

  it("install creates Kernel dir and init.m from scratch with backup", () => {
    const bridgeRoot = makeBridgeFixture();
    const userBase = makeTempDir("wolfram-userbase");
    const kernelDir = path.join(userBase, "Kernel");
    const initPath = path.join(kernelDir, "init.m");

    // No Kernel dir exists yet
    expect(existsSync(kernelDir)).toBe(false);

    const output = runInstaller([
      "--bridge-root",
      bridgeRoot,
      "--wolfram-userbase",
      userBase,
    ]);

    expect(output).toContain(
      "Installed MICA Wolfram autoload"
    );
    expect(output).toContain("Backup written:");

    const content = readFileSync(initPath, "utf8");
    expect(content).toContain(installer.CONTROL_BEGIN);
    expect(content).toContain(installer.CONTROL_END);

    // Backup should exist (even for empty original)
    const backupFiles = readdirSync(kernelDir).filter(
      (name) => name.startsWith("init.m.") && name.endsWith(".bak")
    );
    expect(backupFiles.length).toBeGreaterThanOrEqual(1);
  });

  it("reinstall is idempotent: exactly one control block remains", () => {
    const bridgeRoot = makeBridgeFixture();
    const userBase = makeTempDir("wolfram-userbase");
    const kernelDir = path.join(userBase, "Kernel");
    const initPath = path.join(kernelDir, "init.m");
    mkdirSync(kernelDir, { recursive: true });
    writeFileSync(initPath, 'Print["user"]\n', "utf8");

    // Install twice
    runInstaller([
      "--bridge-root",
      bridgeRoot,
      "--wolfram-userbase",
      userBase,
    ]);
    runInstaller([
      "--bridge-root",
      bridgeRoot,
      "--wolfram-userbase",
      userBase,
    ]);

    const content = readFileSync(initPath, "utf8");
    const controlCount =
      content.split(installer.CONTROL_BEGIN).length - 1;
    expect(controlCount).toBe(1);
    expect(content).toContain('Print["user"]');
  });

  it("uninstall on init.m with no bridge blocks preserves content and creates no backup", () => {
    const bridgeRoot = makeBridgeFixture();
    const userBase = makeTempDir("wolfram-userbase");
    const kernelDir = path.join(userBase, "Kernel");
    const initPath = path.join(kernelDir, "init.m");
    mkdirSync(kernelDir, { recursive: true });
    const originalContent = 'Print["hello"]\n(* nothing to remove *)\n';
    writeFileSync(initPath, originalContent, "utf8");

    const output = runInstaller([
      "--uninstall",
      "--bridge-root",
      bridgeRoot,
      "--wolfram-userbase",
      userBase,
    ]);

    expect(output).toContain(
      "No MICA Wolfram autoload was present"
    );
    expect(output).toContain("No changes needed.");

    // Content must be byte-for-byte unchanged
    const contentAfter = readFileSync(initPath, "utf8");
    expect(contentAfter).toBe(originalContent);

    // No backup file should have been created
    const backupFiles = readdirSync(kernelDir).filter(
      (name) => name.startsWith("init.m.") && name.endsWith(".bak")
    );
    expect(backupFiles.length).toBe(0);
  });
});
