# Contributing

## Development checks

Before opening a pull request, run:

```bash
npm test
npm run typecheck
npm run build
node scripts/install.js --dry-run
```

When changing installer behavior, update installer tests. When changing MCP tools or HTTP endpoints, update the matching protocol tests.

## Security reports

For a security issue or security report, use the process in [SECURITY.md](SECURITY.md). Do not publish bearer tokens, local session files, or private notebook content in public issues.

## Local paths

Avoid committing machine-specific paths or development-only notes. Documentation should use placeholders such as `/absolute/path/to/mica`.
