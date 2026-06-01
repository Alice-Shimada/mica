# MICA

**Mathematica Interactive Control Agent**

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)
![Node](https://img.shields.io/badge/node-%3E%3D20-5FA04E?logo=node.js&logoColor=white)
![Bun](https://img.shields.io/badge/runtime-Bun-f3e7d3?logo=bun&logoColor=111111)
![MCP](https://img.shields.io/badge/protocol-MCP-2563eb)
![Wolfram Desktop](https://img.shields.io/badge/Wolfram%20Desktop-14.1%2B-dd1100)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-111827)

MICA lets an MCP-capable coding agent control the Mathematica notebook you already have open: list notebooks, inspect cells, insert code, run evaluations, read outputs/messages, abort long computations, and look up Wolfram Language symbols without writing `.nb` files directly.

![MICA architecture hero](docs/assets/mica-readme-hero.png)

## Why MICA?

- **Works in real notebooks**: the agent acts on visible Wolfram Desktop notebooks instead of a detached headless kernel.
- **Agent-friendly workflow**: `mma_status`, `mma_list_notebooks`, structured errors, and a built-in MCP prompt tell the agent how to proceed.
- **Permission-gated control**: read, insert, modify, delete, run, and save permissions are explicit.
- **No raw eval endpoint**: code execution happens through notebook cells, so the interaction stays inspectable.
- **Local-first**: the bridge binds to `127.0.0.1`; notebook files are not edited by the Node/Bun process.
- **Release-minded**: install/uninstall is reversible and keeps timestamped `Kernel/init.m` backups.

## How It Works

```text
MCP client / coding agent
        |
        | stdio MCP
        v
Bun MCP server + localhost dashboard
        |
        | HTTP queue on 127.0.0.1:19791
        v
Hidden Wolfram FrontEnd control agent
        |
        | NotebookRead / NotebookWrite / Cells / CellObject
        v
Your already-open Mathematica notebook
```

The hidden Wolfram agent runs from a dedicated `MMAAgentControl` FrontEnd evaluator. Your normal notebooks stay on their own evaluator, while MICA keeps polling, queueing, timeout handling, and abort requests responsive.

## Requirements

| Requirement | Notes |
| --- | --- |
| Wolfram Desktop / Mathematica | 14.1+ supported. 13.x / 14.0 experimental (may work but not formally tested). Headless Wolfram Engine is not supported for live notebook control. |
| Node.js | 20 or newer. |
| Bun | Optional. Used for development hot-reload (`npm run dev:mcp`). Production path uses Node. |
| MCP client | Codex, Claude Desktop, Cursor, or any stdio MCP client. |

## Quick Start

```bash
git clone https://github.com/Alice-Shimada/mica.git
cd mica
npm ci
npm run build
node scripts/install.js
```

Then fully quit and restart Wolfram Desktop. Open a notebook, start the MCP server, and connect your MCP client:

```bash
npm run start:mcp
```

Dashboard:

```text
Use the `Dashboard: http://127.0.0.1:<port>/#token=<token>` URL printed by the MICA server.
```

The installer edits only your per-user Wolfram `Kernel/init.m`, creates a timestamped backup, and prints MCP client config snippets. It does not edit system Wolfram files and does not edit MCP client configs for you.

Dry run and uninstall:

```bash
node scripts/install.js --dry-run
node scripts/install.js --uninstall
```

## MCP Client Config

Use the built Node entrypoint from your local checkout:

```toml
[mcp_servers.mica]
command = "node"
args = ["/absolute/path/to/mica/dist/src/bun/index.js"]
```

For development with hot-reload, use Bun:

```toml
[mcp_servers.mica]
command = "bun"
args = ["run", "/absolute/path/to/mica/src/bun/index.ts"]
```

## Agent Guide Prompt

MICA exposes usage guidance in two MCP-facing places:

- Server initialization `instructions`
- Reusable prompt: `mica_notebook_workflow`

The prompt tells the agent to start with `mma_status` or `mma_list_notebooks`, use current `notebookId` values, avoid hidden/offscreen notebooks, avoid detached `wolframscript` for live-notebook work, and handle structured `ok: true` / `ok: false` responses.

## Tools

| Tool | Purpose |
| --- | --- |
| `mma_status` | Report server, agent, and notebook registry state. |
| `mma_list_notebooks` | List registered live notebooks and the active notebook id. |
| `mma_select_notebook` | Select the active notebook by `notebookId` or unambiguous `displayName`. |
| `mma_symbol_lookup` | Look up Wolfram Language usage, options, attributes, and documentation URLs. |
| `mma_list_cells` | List cells in the selected notebook. |
| `mma_read_cell` | Read one cell's content and metadata. |
| `mma_insert_cell` | Insert a cell; use `afterCellId="__end__"` to append. |
| `mma_modify_cell` | Modify an existing cell. |
| `mma_delete_cell` | Delete an existing cell. |
| `mma_run_cell` | Evaluate one cell with a timeout. |
| `mma_abort_evaluation` | Abort the current notebook evaluation. |
| `mma_get_cell_output` | Read output and messages for a cell. |
| `mma_save_notebook` | Save the notebook when `SaveNotebook` permission is granted. |

All MCP tools return JSON text plus `structuredContent`.

```json
{ "ok": true, "result": "..." }
```

Expected failures are structured and set the MCP `isError` flag:

```json
{
  "ok": false,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "The selected notebook did not grant permission for this tool.",
    "retryable": false,
    "tool": "mma_save_notebook"
  }
}
```

## Manual Wolfram Startup

If you do not want to edit `Kernel/init.m`, start Wolfram Desktop and evaluate the following after replacing the path:

```wolfram
Get["/absolute/path/to/mica/paclet/Kernel/MMAAgentBridge.wl"];
MMAAgentBridge`Private`$BridgePermissions = <|
  "ReadNotebook" -> True,
  "InsertCell" -> True,
  "ModifyCell" -> True,
  "DeleteCell" -> True,
  "RunCell" -> True,
  "SaveNotebook" -> False
|>;
MMAAgentBridge`StartMMAAgentControlKernel[]
```

## Development

```bash
npm test
npm run typecheck
npm run build
npm run dev:bun
npm run dev:bun:mcp
```

Common commands:

| Command | Use |
| --- | --- |
| `npm run dev:bun` | Start the Bun runtime and dashboard without stdio MCP. |
| `npm run dev:bun:mcp` | Start the primary Bun MCP server. |
| `npm run dev` | Start the legacy Node HTTP bridge for Palette compatibility testing. |
| `npm run build` | Emit production JavaScript under `dist/`. |

## Verification Checklist

```bash
npm test
npm run typecheck
npm run build
node scripts/install.js --dry-run
```

Live smoke test:

1. Run `node scripts/install.js`.
2. Fully restart Wolfram Desktop.
3. Open a notebook.
4. Confirm `mma_status` reports an online agent and a registered notebook.
5. Confirm insert, read, modify, run, get-output, delete, abort, and symbol lookup work against that notebook.
6. Run `node scripts/install.js --uninstall` and confirm the marked block is removed from `Kernel/init.m`.

See also:

- [Manual Smoke Test](docs/qa/manual-smoke-test.md) — full release checklist.
- [Support Matrix](docs/qa/support-matrix.md) — platform and runtime coverage.

## Security Model

- MICA binds its HTTP bridge to `127.0.0.1`.
- MICA writes a local session file with a generated auth token and requires `Authorization: Bearer <token>` for protocol endpoints.
- The dashboard token is carried in the URL fragment (`#token=...`), not in the HTTP request path.
- The dashboard URL, including the local bearer token, is printed to the server startup log for the current user session.
- MICA does not include a remote access mode.
- There is no arbitrary shell tool and no direct raw-eval MCP endpoint.
- Notebook mutation goes through Wolfram FrontEnd APIs and explicit permissions.
- `mma_save_notebook` is disabled by default in the installer permission block.
- The Node/Bun process does not directly edit `.nb` files.

## Known Limitations

- Cancellation is best-effort when the Wolfram kernel is already busy.
- Cell ids are session-local and can change after reopening a notebook.
- FrontEnd notebook operations are currently serialized.
- The legacy Palette flow remains only for compatibility during migration.

## License

MIT
