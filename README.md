# MICA — Mathematica Interactive Control Agent

Local MCP bridge for controlling already-open Mathematica / Wolfram Desktop notebooks through one Wolfram Paclet Palette.

## Architecture

```text
MCP Client / Coding Agent
        |
        | MCP over stdio
        v
Bun backend / MCP server
        |
        | localhost HTTP dashboard / queue / API
        v
Hidden Wolfram FrontEnd agent
        |
        | NotebookRead / NotebookWrite / Cells / CellObject
        v
Selected NotebookObject
```

The Bun backend exposes the MCP tools, dashboard, request queue, timeouts, and stale cleanup on `127.0.0.1:19791`. Wolfram Desktop only runs a hidden FrontEnd agent for live notebook operations. Notebook files are never edited directly.

## Bun hidden-agent mode

Bun now owns MCP orchestration, the notebook registry, request timeouts, stale cleanup, and the dashboard UI. Wolfram Desktop still runs a hidden FrontEnd agent for live notebook operations only.

- Dashboard URL: `http://127.0.0.1:19791/`
- Start the Bun runtime: `npm run dev:bun`
- Start the Bun MCP server: `npm run dev:bun:mcp`
- Configure Wolfram Desktop autoload from this checkout:

```powershell
node scripts/install.js
```

The installer edits only the per-user `<Wolfram user base>\Kernel\init.m`, creates a timestamped backup, and prints MCP snippets instead of editing MCP client config. It does **not** edit `FrontEnd/init.m`, does **not** edit system-level Wolfram files, and does **not** edit MCP client configs. Headless Wolfram Engine is not supported for live notebook control. Restart Wolfram Desktop after install or uninstall.

Dry-run and uninstall:

```powershell
node scripts/install.js --dry-run
node scripts/install.js --uninstall
```

`StartMMAAgentControlKernel[]` creates or reuses a FrontEnd evaluator named `MMAAgentControl`, starts the hidden agent from an invisible control notebook bound to that evaluator, and leaves normal notebooks on their existing evaluator. This keeps bridge polling and abort requests responsive when a user notebook's `Local` kernel is busy.

Notebook names are mutable. Saving a notebook updates its `displayName` and path while preserving the same `notebookId`. If multiple live notebooks share a name, lookups return an ambiguity result instead of guessing.

## Workflow

1. Run `node scripts/install.js` once for this checkout, then fully restart Wolfram Desktop so the control-kernel hidden agent autoloads. If Wolfram Desktop was already open before installation, new notebooks can reuse an old kernel that has not read the updated `Kernel/init.m`; quit and reopen Desktop, or use the manual startup fallback below.
2. Start the Bun runtime with `npm run dev:bun` or point your MCP client at `npm run dev:bun:mcp`.
3. Open the dashboard at `http://127.0.0.1:19791/` to watch notebook registration, live status, queueing, and request results.
4. Use MCP tools against the Bun server; live notebook operations are executed by the hidden Wolfram FrontEnd agent.
5. Notebook names may change over time; saving updates the notebook's display name/path while preserving `notebookId`.
6. If multiple live notebooks share a name, the lookup returns an ambiguity result instead of guessing.

### Manual hidden-agent startup fallback

If you do not want to edit `Kernel/init.m`, or if Wolfram Desktop was already running before installation, start Wolfram Desktop and evaluate the direct startup command, replacing the path with your checkout path. The permission block matches the installer defaults: notebook read/insert/modify/delete/run are enabled, while saving remains disabled.

```wolfram
Get["D:\\Project\\mica\\paclet\\Kernel\\MMAAgentBridge.wl"];
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

### Legacy Palette flow (temporary)

The older Palette registration/dropdown flow is retained only for compatibility during migration.

1. Start the legacy bridge with `npm run dev`.
2. Open the Paclet Palette in Wolfram Desktop.
3. Click **Register Current Window** or **Allow control of current Notebook**.
4. Use the Palette dropdown to choose the default notebook for MCP calls that do not pass `notebookId`.
5. Write/run/delete/save actions require confirmation unless their global permission is enabled in the Palette.

## Notebook targeting

The bridge supports multiple open notebooks from one Palette.

- `mma_list_notebooks` lists registered notebooks and the active/default notebook id.
- `mma_select_notebook` changes the active/default notebook.
- Notebook operation tools accept an optional `notebookId`.
- If a tool call includes `notebookId`, that notebook is used.
- If a tool call omits `notebookId`, the Palette-selected active notebook is used.
- If no notebook is selected, the tool fails immediately instead of hanging.

Permissions are global and shared across notebooks.

## Stability model

**Bun hidden-agent mode:** The hidden agent runs from the dedicated `MMAAgentControl` FrontEnd evaluator (invisible control notebook). It polls `/agents/.../next-request` and executes FrontEnd notebook operations against visible notebooks. The control kernel keeps bridge polling and abort requests responsive even when a user notebook's `Local` kernel is busy.

**Legacy Palette mode:** The legacy Palette still uses a single consolidated `/poll` request for status, cancellation, and request delivery.

## Development

```powershell
npm install
npm run dev
npm run dev:bun
npm test
npm run typecheck
npm run build
```

- `npm run dev` starts the HTTP bridge only for manual Palette/browser testing.
- `npm run dev:mcp` starts the legacy stdio MCP server + HTTP bridge for compatibility testing.
- `npm run dev:bun` starts the Bun dashboard/runtime for the migrated bridge.
- `npm run dev:bun:mcp` starts the Bun MCP entrypoint.
- `npm run build` emits the production JS in `dist/`.

## Run the MCP server

For Bun hidden-agent development, start the Bun runtime and dashboard at `http://127.0.0.1:19791/`:

```powershell
npm run dev:bun
```

You can then check bridge status with either PowerShell or curl:

```powershell
Invoke-RestMethod http://127.0.0.1:19791/status
curl.exe http://127.0.0.1:19791/status
```

For the migrated flow, point your MCP client at the Bun MCP server:

```powershell
npm run dev:bun:mcp
```

The legacy Node package command / `dist\src\index.js` entrypoint remains available only until config migration is complete; it is not the primary Bun path.

Running the legacy stdio MCP mode directly in a normal terminal may exit when stdin closes; use `npm run dev` for manual Palette/HTTP testing.

If you need the legacy built entrypoint:

```powershell
npm run build
node dist\src\index.js
```

## Paclet install and open

Development install:

```wolfram
PacletInstall["paclet"]
Needs["MMAAgentBridge`"]
MMAAgentBridge`StartMMAAgentPalette[]
```

Or, if you prefer a direct directory load, replace the path with your local paclet directory:

```wolfram
PacletDirectoryLoad["<local path to the paclet directory>"]
```

You can also open `paclet/FrontEnd/Palettes/MMAAgentBridge.nb` from Wolfram Desktop after the paclet is loaded.

## Security defaults

- MVP has no HTTP auth/token and relies on binding only to `127.0.0.1`.
- No direct raw-eval endpoint is exposed; code execution happens only through confirmed/permission-gated notebook cell operations.
- No shell or arbitrary filesystem tools are exposed; `mma_save_notebook` can save the attached notebook, but there are no arbitrary filesystem write/read tools.
- One request is processed at a time across all notebooks.
- In the legacy Palette flow, write, run, delete, and save operations require Palette confirmation unless enabled globally.
- Notebook data is handled through FrontEnd APIs; the Node process does not directly edit `.nb` files.

## Known limitations

- Cancellation is best-effort. If the notebook kernel is busy, Palette polling may be delayed.
- Running-status updates are also best-effort and may briefly lag behind the actual evaluation state.
- `mma_run_cell` may report `started` before outputs are available; use `mma_get_cell_output` to inspect final messages and results.
- Cell IDs are session-local and may change after reopening the notebook.
- Cell IDs are session-local and per registered notebook.
- The first redesigned implementation keeps FrontEnd execution serial even when multiple notebooks are registered.

## Verification

Recommended local verification:

```powershell
npm test
npm run typecheck
npm run build
node scripts/install.js --dry-run
```

Live verification steps:

1. Run `node scripts/install.js` and restart Wolfram Desktop.
2. Confirm `mma_status` reports an online agent and a registered notebook.
3. Confirm insert, read, modify, run, get-output, delete, and abort all work against a live notebook.
4. Run `node scripts/install.js --uninstall` and restart Wolfram Desktop.
5. Confirm the marked block is removed from `Kernel/init.m` while unrelated content remains.
