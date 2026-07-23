# OpenCode Desktop MICA MCP Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `mica-release` and `mica-beta` available in every OpenCode Desktop project while preserving all unrelated global configuration.

**Architecture:** Add the local D-drive MICA build as a second entry in the standard global OpenCode `mcp` object. Do not edit Desktop's serialized application state; validate the global config, both entry points, and the final MCP names before requiring a Desktop restart.

**Tech Stack:** OpenCode JSONC configuration, PowerShell 5.1, Node.js CLI entry points.

---

### Task 1: Establish the pre-change configuration state

**Files:**
- Read: `C:\Users\liuyuanche\.config\opencode\opencode.jsonc`
- Read: `D:\Project\mma-mcp-bridge\opencode.json`

- [ ] **Step 1: Run a pre-change validation that proves the global beta entry is absent**

Run:

```powershell
$path = 'C:\Users\liuyuanche\.config\opencode\opencode.jsonc'
$config = [System.IO.File]::ReadAllText($path) | ConvertFrom-Json
if ($config.mcp.PSObject.Properties.Name -contains 'mica-beta') {
  throw 'Expected mica-beta to be absent before implementation.'
}
'RED: global mica-beta is absent'
```

Expected: output `RED: global mica-beta is absent`. This establishes that the requested global behavior is not yet configured.

### Task 2: Add the global Desktop beta MCP entry

**Files:**
- Modify: `C:\Users\liuyuanche\.config\opencode\opencode.jsonc:7-17`

- [ ] **Step 1: Add `mica-beta` without changing existing entries**

The global `mcp` object must contain this exact pair before `sts2`:

```json
"mica-release": {
  "type": "local",
  "command": ["D:\\Program Files\\nodejs\\node.exe", "C:\\Users\\liuyuanche\\AppData\\Roaming\\npm\\node_modules\\@aliceshimada\\mica\\dist\\src\\cli\\index.js", "mcp"],
  "enabled": true
},
"mica-beta": {
  "type": "local",
  "command": ["node", "D:/Project/mma-mcp-bridge/dist/src/cli/index.js", "mcp"],
  "enabled": true
},
```

Preserve `$schema`, plugins, `sts2`, provider configuration, and all other fields byte-for-byte where practical. Do not edit `C:\Users\liuyuanche\AppData\Roaming\ai.opencode.desktop\opencode.global.dat`.

### Task 3: Validate both Desktop MCP choices

**Files:**
- Test: `C:\Users\liuyuanche\.config\opencode\opencode.jsonc`
- Test: `D:\Project\mma-mcp-bridge\opencode.json`

- [ ] **Step 1: Parse both configurations and validate names**

Run:

```powershell
$globalPath = 'C:\Users\liuyuanche\.config\opencode\opencode.jsonc'
$projectPath = 'D:\Project\mma-mcp-bridge\opencode.json'
$global = [System.IO.File]::ReadAllText($globalPath) | ConvertFrom-Json
$project = [System.IO.File]::ReadAllText($projectPath) | ConvertFrom-Json
$globalNames = @($global.mcp.PSObject.Properties.Name)
if ($globalNames -notcontains 'mica-release' -or $globalNames -notcontains 'mica-beta' -or $globalNames -contains 'mica') {
  throw "Unexpected global MCP names: $($globalNames -join ', ')"
}
if (@($project.mcp.PSObject.Properties.Name) -notcontains 'mica-beta') {
  throw 'Project mica-beta override is missing.'
}
"Global MCP names: $($globalNames -join ', ')"
```

Expected: the global names include `mica-release`, `mica-beta`, and `sts2`, with no old `mica` key.

- [ ] **Step 2: Validate both executable entry points**

Run:

```powershell
$release = Test-Path -LiteralPath 'C:\Users\liuyuanche\AppData\Roaming\npm\node_modules\@aliceshimada\mica\dist\src\cli\index.js'
$beta = Test-Path -LiteralPath 'D:\Project\mma-mcp-bridge\dist\src\cli\index.js'
if (-not $release -or -not $beta) {
  throw "Missing MICA entry point: release=$release beta=$beta"
}
"Entry points: release=$release beta=$beta"
```

Expected: `Entry points: release=True beta=True`.

- [ ] **Step 3: Restart Desktop**

Fully quit OpenCode Desktop, ensure no background Desktop process remains, then relaunch it. The MCP selector should expose `mica-release` and `mica-beta` as separate servers in every opened project.
