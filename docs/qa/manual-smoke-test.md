# Manual Smoke Test

Run this checklist before tagging a release or after significant changes to the install/uninstall flow or Wolfram bridge agent.

## Prerequisites

- Wolfram Desktop 14.1+ installed and licensed.
- Node.js 20+ available on `PATH`.
- A clean checkout of the repo with `npm ci && npm run build` completed.
- No existing MICA install in `Kernel/init.m` (run `node scripts/install.js --uninstall` first if needed).

## Checklist

- [ ] **install** — `node scripts/install.js` succeeds and prints a config snippet.
- [ ] **restart Wolfram Desktop** — fully quit and relaunch Wolfram Desktop.
- [ ] **start MICA MCP server** — `npm run start:mcp` starts without errors.
- [ ] **mma_status** — returns `ok: true` with an online agent and at least one registered notebook.
- [ ] **mma_list_notebooks** — lists the active notebook and any other open notebooks.
- [ ] **mma_list_cells** — returns the cell list for the selected notebook.
- [ ] **mma_insert_cell** — inserts a new cell (e.g. `2+2`) and returns the new `cellId`.
- [ ] **mma_run_cell** — runs the inserted cell and returns `ok: true`.
- [ ] **mma_get_cell_output** — returns the output (`4`) and no messages.
- [ ] **large output artifact round trip** — run a cell with large text output, confirm `mma_get_cell_output` returns an `artifactId`, then call `mma_read_artifact` with multiple `offset` / `limit` pages until `done: true`.
- [ ] **mma_modify_cell** — changes the cell content (e.g. to `3+3`) and the change is reflected.
- [ ] **mma_delete_cell** — deletes the cell and it is removed from the notebook.
- [ ] **mma_abort_evaluation** on `Pause[60]` — insert a cell with `Pause[60]`, run it, then abort. Confirm the abort succeeds and the kernel is responsive again.
- [ ] **save denied by default** — `mma_save_notebook` returns `PERMISSION_DENIED` with the default installer permissions.
- [ ] **enable save and save succeeds** — manually set `SaveNotebook -> True` in the permissions block, restart the bridge, then `mma_save_notebook` succeeds.
- [ ] **uninstall** — `node scripts/install.js --uninstall` removes the MICA block from `Kernel/init.m` and restores the backup.

## After Uninstall

- Restart Wolfram Desktop and confirm the MICA control agent no longer starts.
- Confirm no residual MICA entries remain in `Kernel/init.m`.
