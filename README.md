# MICA

**Mathematica Interactive Control Agent**

English | [简体中文](README.zh-CN.md)

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D20-5FA04E?logo=node.js&logoColor=white)
![Bun](https://img.shields.io/badge/runtime-Bun-f3e7d3?logo=bun&logoColor=111111)
![MCP](https://img.shields.io/badge/protocol-MCP-2563eb)
![Wolfram Desktop](https://img.shields.io/badge/Wolfram%20Desktop-14.1%2B-dd1100)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-111827)

MICA is a local MCP bridge for Wolfram Desktop / Mathematica. It lets an MCP-capable coding agent work through real FrontEnd notebooks: discover live notebooks, open existing `.nb` files through the local OS, create blank notebooks, inspect cells, insert and edit code, run evaluations, read outputs/messages, manage notebook kernels, and look up Wolfram Language documentation without directly editing `.nb` files or launching a detached `wolframscript` workflow.

![MICA architecture hero](docs/assets/mica-readme-hero.png)

## Why MICA?

- **Works in real notebooks**: the agent acts on visible Wolfram Desktop notebooks, not a detached headless kernel.
- **Human-visible agent work**: inserted code, outputs, messages, and edits appear in the notebook where you can review them.
- **Notebook lifecycle tools**: agents can list, select, create, open, save, and recover notebooks without leaving the MCP workflow.
- **Notebook-aware targeting**: agents can select the intended notebook and use strict targeting for mutating tools.
- **Agent-friendly protocol**: `mma_status`, `mma_list_notebooks`, structured errors, bounded outputs, artifact paging, and the `mica_notebook_workflow` prompt tell agents how to proceed safely.
- **Permission-gated control**: read, insert, modify, delete, run, create/open, kernel lifecycle, and save permissions are explicit.
- **Local-first security model**: the bridge binds to `127.0.0.1`, uses a generated bearer token, and does not include a remote access mode.
- **Release-minded install path**: install/uninstall is reversible and keeps timestamped `Kernel/init.m` backups.

## Why work through Wolfram Desktop notebooks?

Traditional automation usually copies code into a separate script or starts a headless kernel. That is useful for batch jobs, but it loses the context that makes notebooks valuable. MICA keeps the agent in the same FrontEnd workflow you are using, whether the notebook was already open, created by MICA, or launched from an existing `.nb` file.

- **Preserves live context**: definitions, prior cells, rich outputs, messages, and notebook structure stay in the real working notebook.
- **Keeps the human in the loop**: you can watch what the agent inserts, interrupt a long evaluation, edit a cell yourself, or rerun something manually.
- **Improves auditability**: code execution happens as notebook cells instead of an opaque raw-eval endpoint, leaving visible cells and outputs behind.
- **Reduces context loss**: the agent can read nearby cells, outputs, and messages before deciding what to do next.
- **Handles multiple notebooks**: the agent can discover open notebooks, open an existing `.nb` file, create a blank notebook, and target the intended one by current `notebookId` or display name.
- **Fits exploratory Wolfram work**: plots, dynamic output, formatted boxes, and FrontEnd notebook operations remain part of the workflow.

## How It Works

```text
MCP client / coding agent
        |
        | stdio MCP
        v
MICA MCP server + localhost dashboard
        |
        | HTTP queue on 127.0.0.1:19791
        v
Hidden Wolfram FrontEnd control agent
        |
        | NotebookRead / NotebookWrite / Cells / CellObject
        v
Visible Mathematica notebooks
(already open, created, or launched from `.nb`)
```

The hidden Wolfram agent runs from a dedicated `MMAAgentControl` FrontEnd evaluator. Your normal notebooks stay on their own evaluator, while MICA keeps polling, queueing, timeout handling, and abort requests responsive.

## Requirements

| Requirement | Notes |
| --- | --- |
| Wolfram Desktop / Mathematica | 14.1+ supported. 13.x / 14.0 experimental (may work but not formally tested). Headless Wolfram Engine is not supported for live notebook control. |
| Node.js | 20 or newer. |
| Bun | Optional. Used for Bun development scripts. The release CLI runs through Node. |
| MCP client | Codex, Claude Desktop, Cursor, or any stdio MCP client. |

## Quick Start

Install globally from npm:

```bash
npm install -g @aliceshimada/mica
mica install
```

Then fully quit and restart Wolfram Desktop. Open a notebook manually or let the agent open an existing `.nb` with `mma_open_notebook`; start the MCP server and connect your MCP client:

```bash
mica mcp
```

Or from a release checkout:

```bash
git clone https://github.com/Alice-Shimada/mica.git
cd mica
npm ci
npm run build
node dist/src/cli/index.js install
```

Then fully quit and restart Wolfram Desktop. Open a notebook manually or let the agent open an existing `.nb` with `mma_open_notebook`; start the MCP server and connect your MCP client:

```bash
node dist/src/cli/index.js mcp
```

If MICA is installed on your `PATH`, the same release commands are:

```bash
mica install
mica mcp
mica doctor
mica status
```

Dashboard:

```text
Use the `Dashboard: http://127.0.0.1:<port>/#token=<token>` URL printed by the MICA server.
```

The dashboard is token-gated: opening `/` without the URL fragment does not fetch or display bridge data. With the printed token URL, it shows grouped diagnostics for Server, Security, Agents, Notebooks, and Requests. Click Agents or Notebooks to open a shared details panel below the overview cards.

The installer edits only your per-user Wolfram `Kernel/init.m`, creates a timestamped backup, and prints MCP client config snippets. It does not edit system Wolfram files and does not edit MCP client configs for you.

Dry run and uninstall:

```bash
node dist/src/cli/index.js install --dry-run
node dist/src/cli/index.js uninstall
```

`mica status` prints the current session file, server URL, version, PID, live agent/notebook counts, and the token-bearing dashboard URL. If a server is already running, `mica mcp` proxies to it instead of failing with a port-in-use error, so you can recover the dashboard token at any time.

The legacy installer entry remains available for compatibility: `node scripts/install.js --dry-run`.

## MCP Client Config

Print a copy-pasteable MCP config snippet:

```bash
mica config codex
mica config claude-desktop
mica config cursor
mica config opencode
```

MICA only prints snippets; it does not edit client config files for you.

For OpenCode, the snippet uses the validated local MCP shape:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "mica": {
      "type": "local",
      "command": ["mica", "mcp"],
      "enabled": true
    }
  }
}
```

When editing OpenCode config, restart OpenCode after saving; config is loaded at startup.

For manual setup from a local checkout, use the built release entrypoint:

```toml
[mcp_servers.mica]
command = "node"
args = ["/absolute/path/to/mica/dist/src/cli/index.js", "mcp"]
```

For development, you can point an MCP client at the TypeScript entrypoint:

```toml
[mcp_servers.mica]
command = "npx"
args = ["tsx", "/absolute/path/to/mica/src/cli/index.ts", "mcp"]
```

## Agent Guide Prompt

MICA exposes usage guidance in two MCP-facing places:

- Server initialization `instructions`
- Reusable prompt: `mica_notebook_workflow`

The prompt tells the agent to start with `mma_status` or `mma_list_notebooks`, use current `notebookId` values, avoid hidden/offscreen notebooks, use `mma_create_notebook` / `mma_open_notebook` only when the user explicitly wants a notebook created or opened, avoid detached `wolframscript` for live-notebook work, and handle structured `ok: true` / `ok: false` responses.

## Tools

| Tool | Purpose |
| --- | --- |
| `mma_status` | Report server, agent, and notebook registry state. |
| `mma_list_notebooks` | List registered live notebooks and the active notebook id. |
| `mma_select_notebook` | Select the active notebook by `notebookId` or unambiguous `displayName`. |
| `mma_create_notebook` | Create a new visible blank notebook through the Wolfram FrontEnd. |
| `mma_open_notebook` | Open an existing absolute `.nb` path through the local OS default application. |
| `mma_symbol_lookup` | Look up Wolfram Language usage, options, attributes, and documentation URLs. |
| `mma_list_cells` | List cells in the selected notebook. |
| `mma_read_cell` | Read one cell's content and metadata. |
| `mma_insert_cell` | Insert a cell; use `afterCellId="__end__"` to append. |
| `mma_modify_cell` | Modify an existing cell. |
| `mma_delete_cell` | Delete an existing cell. |
| `mma_run_cell` | Evaluate one cell with a timeout. |
| `mma_abort_evaluation` | Abort the current notebook evaluation. |
| `mma_kill_kernel` | Quit a notebook's Wolfram kernel while protecting the MICA control agent evaluator. |
| `mma_restart_kernel` | Restart a notebook's Wolfram kernel using `Quit[]`, then force a fresh evaluation. |
| `mma_get_cell_output` | Read output and messages for a cell. |
| `mma_read_artifact` | Read large output or message artifacts by byte page. |
| `mma_save_notebook` | Save the notebook when `SaveNotebook` permission is granted. |

All MCP tools return JSON text plus `structuredContent`.

```json
{ "ok": true, "result": "..." }
```

### Opening and creating notebooks

`mma_create_notebook` asks the live Wolfram FrontEnd control agent to create a visible blank notebook, so it requires MICA to already be connected to Wolfram Desktop.

`mma_open_notebook` is different: it runs in the Node backend and launches an existing `.nb` file through the local OS file association (Windows `rundll32`, macOS `open`, Linux `xdg-open`). It accepts only absolute paths to existing `.nb` files and can start Mathematica even when no MICA agent is connected yet. The tool returns `status: "launching"`; after the notebook opens and the bridge registers, call `mma_list_notebooks` to get the current `notebookId` before using notebook-targeted tools.

Kernel lifecycle tools use a longer backend timeout than ordinary cell mutations: `mma_kill_kernel` and `mma_restart_kernel` have 60 seconds to account for slow FrontEnd/kernel recovery. They refuse to act on the protected MICA control-agent evaluator.

`mma_read_cell` truncates large cell content, outputs, and messages by default to keep MCP responses bounded. `mma_get_cell_output` keeps small outputs/messages inline and returns artifact metadata for large entries; pass the returned `artifactId` to `mma_read_artifact` with `offset` and `limit` to page through the full text. Artifact ids are deterministic but ephemeral: they are resolved by rescanning the current notebook, so notebook edits or reruns can make an id stale or point to updated content. Reading outputs or artifacts may also refresh a completed cell's run status. Output status values include `running`, `abort_requested`, `aborted`, `finished`, `timeout`, and `unknown`; `abort_requested` means MICA sent an abort signal but has not yet observed terminal completion. Pass `maxBytes` (positive integer, up to 1 MiB) to request a different response budget. Truncated or artifact-backed responses include `truncated`, `originalByteLength`, and `returnedByteLength` metadata.

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
  "CreateNotebook" -> False,
  "OpenNotebook" -> False,
  "SaveNotebook" -> False
|>;
MMAAgentBridge`StartMMAAgentControlKernel[]
```

## Development

```bash
npm test
npm run typecheck
npm run build
npm run dev:mcp
npm run dev:bridge
```

Common commands:

| Command | Use |
| --- | --- |
| `npm run dev:mcp` | Start the TypeScript MCP server through `tsx`. |
| `npm run dev:bridge` | Start the TypeScript bridge and dashboard without stdio MCP. |
| `npm run dev:bun:mcp` | Start the MCP server through Bun. |
| `npm run dev:bun` | Start the bridge and dashboard through Bun without stdio MCP. |
| `npm run dev:legacy` | Start the legacy Node HTTP bridge for Palette compatibility testing. |
| `npm run build` | Emit production JavaScript under `dist/`. |

## Verification Checklist

```bash
npm test
npm run typecheck
npm run build
node dist/src/cli/index.js install --dry-run
node dist/src/cli/index.js doctor
```

Live smoke test:

1. Run `node dist/src/cli/index.js install`.
2. Fully restart Wolfram Desktop.
3. Open a notebook.
4. Confirm `mma_status` reports an online agent and a registered notebook.
5. Confirm insert, read, modify, run, get-output, delete, abort, kernel restart, create/open notebook, and symbol lookup work against that notebook.
6. Run `node dist/src/cli/index.js uninstall` and confirm the marked block is removed from `Kernel/init.m`.

See also:

- [Manual Smoke Test](docs/qa/manual-smoke-test.md) — full release checklist.
- [Support Matrix](docs/qa/support-matrix.md) — platform and runtime coverage.

## Troubleshooting

Run the built-in doctor first — it diagnoses the most common issues without side effects:

```bash
node dist/src/cli/index.js doctor
# or if installed globally:
mica doctor
```

The doctor checks Node version, package build, session file, auth token, server reachability, live agent/notebook counts, Wolfram user base, `Kernel/init.m`, and the MICA autoload block. Each check reports `OK` or `FAIL` with a suggested `FIX` line.

**Common failures and fixes:**

| Doctor output | Likely cause | Action |
| --- | --- | --- |
| `FAIL Session file` | Server never started | `mica mcp` |
| `FAIL Auth token` | Token mismatch or expired | Restart the server |
| `FAIL Server /status reachable` | Server not running | `mica mcp` |
| `FAIL Live agent count: 0` | Wolfram not running or bridge not loaded | Restart Wolfram Desktop after install |
| `FAIL Live notebook count: 0` | No notebook open or registered | Open a notebook in Wolfram Desktop, or ask the agent to call `mma_open_notebook` with an absolute `.nb` path |
| `FAIL Kernel/init.m` | Installer not run | `mica install` |
| `FAIL Autoload block` | Installer not run or uninstalled | `mica install` |
| `FAIL Package build` | Build artifacts missing | `npm run build` |

If the doctor passes but you still see `NO_LIVE_AGENT`, `NOTEBOOK_STALE`, or connection errors in your MCP client, fully quit and restart Wolfram Desktop, then restart the MICA server.

## Security Model

- MICA binds its HTTP bridge to `127.0.0.1`.
- MICA writes a local session file with a generated auth token and requires `Authorization: Bearer <token>` for protocol endpoints.
- The dashboard token is carried in the URL fragment (`#token=...`), not in the HTTP request path.
- The dashboard URL, including the local bearer token, is printed to the server startup log for the current user session.
- MICA does not include a remote access mode.
- There is no arbitrary shell tool and no direct raw-eval MCP endpoint.
- Notebook mutation goes through Wolfram FrontEnd APIs and explicit permissions.
- `mma_open_notebook` launches a local `.nb` path through the OS default application but does not edit the notebook file directly.
- `mma_save_notebook` is disabled by default in the installer permission block.
- The Node/Bun process does not directly edit `.nb` files.

## Explicit Notebook Targeting

Set `MICA_STRICT_TARGETING=1` to require explicit `notebookId` (or `displayName`) for all notebook-targeted mutating MCP tools (`mma_insert_cell`, `mma_modify_cell`, `mma_delete_cell`, `mma_run_cell`, `mma_abort_evaluation`, `mma_kill_kernel`, `mma_restart_kernel`, `mma_save_notebook`). Read-only notebook tools (`mma_list_cells`, `mma_read_cell`, `mma_get_cell_output`, `mma_read_artifact`) continue to use the active notebook, and `mma_symbol_lookup` is unaffected because it does not target a notebook. `mma_open_notebook` also does not require a notebook selector because it opens a file path before the notebook has a session-local `notebookId`. When strict targeting is enabled and no selector is provided, the tool returns error code `EXPLICIT_NOTEBOOK_REQUIRED` with `retryable: false`. Default behavior (no env var or any value other than `"1"`) is unchanged.

## Known Limitations

- Cancellation is best-effort when the Wolfram kernel is already busy.
- Kernel kill/restart is more reliable than abort for recovering a stuck notebook kernel, but FrontEnd recovery can still take time; poll `mma_status` / `mma_list_notebooks` after restart.
- `mma_open_notebook` requires an absolute path to an existing `.nb` file and a local OS file association for Mathematica/Wolfram Desktop.
- Cell ids are session-local and can change after reopening a notebook.
- FrontEnd notebook operations are currently serialized.
- The legacy Palette flow remains only for compatibility during migration; the documented release path is the CLI plus MCP server.

## License

MIT — see [LICENSE](LICENSE).
