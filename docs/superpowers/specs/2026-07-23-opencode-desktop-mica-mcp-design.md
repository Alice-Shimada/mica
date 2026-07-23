# OpenCode Desktop MICA MCP Naming Design

## Goal

Make both MICA installations selectable in every OpenCode Desktop project:

- `mica-release`: the globally installed npm package.
- `mica-beta`: the local build under `D:\Project\mma-mcp-bridge`.

## Configuration Architecture

OpenCode Desktop uses the standard OpenCode configuration loader. The editable global configuration is `C:\Users\liuyuanche\.config\opencode\opencode.jsonc`; Desktop state under `AppData\Roaming\ai.opencode.desktop` is not an MCP configuration and must not be edited.

The global `mcp` object will contain both servers. Existing plugin, provider, and `sts2` settings remain unchanged. The repository-local `opencode.json` may retain its `mica-beta` entry; when that repository is opened directly, the identical project key overrides the global key without creating another server.

## MCP Commands

`mica-release` uses the npm installation:

```json
["D:\\Program Files\\nodejs\\node.exe", "C:\\Users\\liuyuanche\\AppData\\Roaming\\npm\\node_modules\\@aliceshimada\\mica\\dist\\src\\cli\\index.js", "mcp"]
```

`mica-beta` uses the local build:

```json
["node", "D:/Project/mma-mcp-bridge/dist/src/cli/index.js", "mcp"]
```

Both entries are local MCP servers and are enabled.

## Validation

1. Parse the global JSONC file as JSON because it currently contains no comments.
2. Confirm the merged MCP names include `mica-release` and `mica-beta` and exclude the old `mica` key.
3. Confirm both CLI entry-point files exist.
4. Fully quit and restart OpenCode Desktop because file-based configuration is not hot-reloaded.

## Non-Goals

- Do not edit `opencode.global.dat` or other Desktop cache/state files.
- Do not publish an npm package.
- Do not change MICA source code or runtime behavior.
