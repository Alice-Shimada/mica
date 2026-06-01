# Support Matrix

CI runs unit tests, typecheck, build, and dry-run install on every PR and push to `master`. The table below covers the full MICA stack including Wolfram Desktop integration, which is not exercised in CI.

| OS | Node | Bun | Wolfram Desktop / Mathematica | MCP client | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Windows 11 | 20 | — | 14.1+ | — | Unverified | CI configured. Full smoke not yet run. |
| Windows 11 | 22 | — | 14.1+ | — | Unverified | CI configured. Full smoke not yet run. |
| macOS 14 (Sonoma) | 20 | — | 14.1+ | — | Unverified | CI configured. Full smoke not yet run. |
| macOS 14 (Sonoma) | 22 | — | 14.1+ | — | Unverified | CI configured. Full smoke not yet run. |
| macOS 15 (Sequoia) | 20 | — | 14.1+ | — | Unverified | CI configured. Full smoke not yet run. |
| macOS 15 (Sequoia) | 22 | — | 14.1+ | — | Unverified | CI configured. Full smoke not yet run. |
| Ubuntu 22.04 | 20 | — | 14.1+ | — | Unverified | CI configured. Full smoke not yet run. |
| Ubuntu 22.04 | 22 | — | 14.1+ | — | Unverified | CI configured. Full smoke not yet run. |
| Ubuntu 24.04 | 20 | — | 14.1+ | — | Unverified | CI configured. Full smoke not yet run. |
| Ubuntu 24.04 | 22 | — | 14.1+ | — | Unverified | CI configured. Full smoke not yet run. |

## Experimental

The following configurations may work but are not formally tested or supported:

| OS | Node | Bun | Wolfram Desktop / Mathematica | MCP client | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Any | 20+ | — | 13.x | — | Experimental | May work; not part of CI or smoke test coverage. |
| Any | 20+ | — | 14.0 | — | Experimental | May work; not part of CI or smoke test coverage. |

## Unsupported

- **Headless Wolfram Engine**: not supported for live notebook control. MICA requires a running Wolfram FrontEnd (`$Notebooks` must be `True`).

## Notes

- **CI coverage**: unit tests, typecheck, build, and `install.js --dry-run` are configured for `ubuntu-latest`, `macos-latest`, and `windows-latest` with Node 20 and 22.
- **Wolfram Desktop integration**: the full [manual smoke test](manual-smoke-test.md) requires a licensed Wolfram Desktop and is not automated in CI.
- **Bun**: the Bun runtime is used for development hot-reload. Bun-specific smoke testing is not yet tracked in this matrix.
- **MCP clients**: tested informally with Codex, Claude Desktop, and Cursor. No client-specific issues have been reported.
