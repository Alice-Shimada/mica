# Changelog

## 1.3.1 - 2026-07-26

- Use the root `package.json` as the runtime version source instead of stale hard-coded `1.2.3` defaults.
- Keep session files, HTTP `/status`, and MCP server initialization metadata synchronized with the installed MICA package version.
- Propagate explicit runtime version overrides consistently and add regression coverage for every version-reporting path.

## 1.3.0 - 2026-07-26

- Add built-in Wolfram Language authoring guidance to MCP initialization instructions and the reusable notebook workflow prompt, covering context-sensitive naming, delayed definitions, scoping, options, rerunnable state, verification, and symbol lookup before guessing.
- Add concise Cell-authoring reminders to `mma_insert_cell` and `mma_modify_cell`, encouraging one coherent step per Input cell and visible intermediate results during debugging, teaching, and exploration.
- Render `mma_symbol_lookup` text results as readable Markdown for exact, ambiguous, invalid, and missing-symbol responses while preserving the original machine-readable fields in `structuredContent`.
- Apply the new symbol lookup result format consistently across backend, HTTP proxy, and legacy stdio MCP paths.

## 1.2.5 - 2026-07-23

> 1.2.4 was published only under the npm `rc` tag and is superseded by this validated release.

- Make `mma_abort_evaluation` report `aborted` after the final `$Aborted` output is observed.
- Fix `mma_kill_kernel` and `mma_restart_kernel` for kernels blocked in non-interruptible native work by caching the target kernel identity before evaluation and using a guarded process-level fallback when graceful `Quit[]` cannot run.
- Verify the cached process is a Wolfram kernel, protect the MICA control kernel, and confirm termination before reporting success.
- Require a changed kernel identity after restart and preserve `aborted` status for interrupted cells.

## 1.2.3 - 2026-07-03

- Fix Wolfram permission fallback so notebook heartbeats inherit current global permissions instead of reverting `RunCell` and other controls to defaults.
- Preserve notebook-scoped permission overrides when launching the hidden control-kernel agent.
- Require explicit Wolfram-side confirmation for notebook create/open requests using the existing `CreateNotebook` and `OpenNotebook` permissions.

## 1.2.2 - 2026-06-30

- Fix `mma_restart_kernel` reliability: keep restart on the explicit `Quit[]` path and guard against regressing to `EvaluatorQuit`.
- Give kernel kill/restart operations a longer 60s backend timeout so slow Wolfram FrontEnd restarts do not time out as generic mutations.
- Change `mma_open_notebook` to launch `.nb` files through the local OS default application so Mathematica can start even when no MICA agent is connected.

## 1.2.1 - 2026-06-17

- Add watchdog on agent tick loop: force-reset `$HiddenAgentInProgress` if stuck > 120s.
- Add periodic backend sweep (every 10s) for liveness and timed-out requests.
- Fix `markTimedOut` to use `claimedAt` for running requests.
- Remove `runCell` timeout upper bound; default to no timeout.

## 1.2.0 - 2026-06-16

- Add `mma_create_notebook` tool: create a new blank notebook in the Wolfram FrontEnd.
- Add `mma_open_notebook` tool: open an existing notebook file (.nb) from disk.
- Add `CreateNotebook` and `OpenNotebook` permissions (default false).
- Fix agent-level tools when no live notebook exists for routing.

## 1.1.1 - 2026-06-16

- Fix `RestartKernelRequest`: kill kernel via `Quit[]` before restarting.
- Fix `realpathSync` crash when `process.argv[1]` doesn't resolve.
- Fix `$BridgeNotebookPermissions` memory leak: prune on notebook close.

## 1.1.0 - 2026-06-09

- Add `mma_kill_kernel` tool: quit a notebook's Wolfram kernel (control agent kernel is protected).
- Add `mma_restart_kernel` tool: restart a notebook's Wolfram kernel so it can evaluate cells again.

## 1.0.5 - 2026-06-09

- Fix abort disconnection: give control evaluator a separate kernel via `LinkLaunch` instead of cloning `"Local"`.

## 1.0.4 - 2026-06-07

- Remove legacy dead code from npm package (bridge, legacy tools, stop command, runtimeOptions, types).
- Tighten `files` field to only include active runtime directories.
- Fix `mica install` failing after npm install: `validateBridgeRoot` now checks `dist/src/bun/index.js` instead of removed `src/bun/index.ts`.
- Increase Wolfram HTTP timeout from 10s to 30s to prevent large notebook loading timeouts.

## 1.0.3 - 2026-06-06

- Deprecate `mica start`, `mica stop`, and `mica restart` commands.
- `mica start` and bare `mica` (no args) are now aliases for `mica mcp`.
- `mica mcp` starts an MCP stdio server, proxying to an existing bridge or starting a new one.

## 1.0.2 - 2026-06-06

- Add `mica mcp` command: starts an MCP stdio server that proxies to an existing bridge or starts a new one.
- Add `/mcp/call` HTTP endpoint for proxied MCP tool execution.
- Refactor backend tools to export `MICA_BACKEND_TOOL_DEFINITIONS` and `executeBackendMcpTool()` for reuse.
- Update config snippets to use `mica mcp` instead of `mica start`.

## 1.0.1 - 2026-06-02

- Implement `mica status`, including dashboard token recovery from the current session.
- Implement `mica config codex|claude-desktop|cursor|opencode` snippets.
- Add `mica stop` and `mica restart`.
- Make `mica start` print current status instead of failing when a server is already running.

## 1.0.0 - 2026-06-02

- Initial public release as `@aliceshimada/mica`.
- Local MCP bridge for controlling live Wolfram Desktop / Mathematica notebooks.
- Reversible installer, CLI entrypoint, doctor command, dashboard token flow, and bounded notebook output/artifact responses.
- Bilingual README (English / 简体中文).

## 0.1.0 - 2026-06-02

- Initial MICA productization release metadata.
- Local MCP bridge for controlling live Wolfram Desktop / Mathematica notebooks.
- Reversible installer, CLI entrypoint, doctor command, dashboard token flow, and bounded notebook output/artifact responses.
