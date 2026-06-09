# Changelog

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
