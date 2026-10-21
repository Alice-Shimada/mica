# Contributing

## Setup

```bash
git clone https://github.com/Alice-Shimada/mica.git
cd mica
npm ci
npm test
npm run typecheck
npm run build
```

Requires Node.js 20 or later.

## Project layout

- `src/cli` - command-line interface (`mica` binary)
- `src/bun` - Bun server entrypoint
- `src/backend` - backend state machine
- `src/mcp` - MCP tool layer
- `paclet/` - Wolfram agent (Wolfram Language paclet)
- `scripts/install.js` - installer
- `tests/` - unit and protocol tests

## Testing

Unit tests run anywhere with `npm test`. Changes to `paclet/*.wl` require manual smoke testing against a local Wolfram Desktop 14.1+ installation; see [docs/qa/manual-smoke-test.md](docs/qa/manual-smoke-test.md).

## Development checks

Before opening a pull request, run:

```bash
npm test
npm run typecheck
npm run build
node scripts/install.js --dry-run
```

When changing installer behavior, update installer tests. When changing MCP tools or HTTP endpoints, update the matching protocol tests.

## Pull request process

1. Fork the repository and create a branch.
2. Make your changes and add a CHANGELOG entry.
3. Ensure CI passes (`npm test`, `npm run typecheck`, `npm run build`).
4. Open a pull request using the pull request template.

## Release process

Maintainer-only. To publish a release:

1. Bump the version in `package.json`, `package-lock.json`, and `paclet/PacletInfo.wl`; update `CHANGELOG.md`, both READMEs, and the package metadata test.
2. Commit and tag with `vX.Y.Z`.
3. Push the tag. The `release.yml` workflow publishes to npm and creates a GitHub release.

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

The `v*` tag workflow requires the repository's `NPM_TOKEN` secret and publishes
to npm before creating the GitHub release. To prepare npm publication separately,
use an unprefixed `X.Y.Z` tag (as in `1.4.2` and `1.5.0`), create the GitHub
release with reviewed notes, and attach the verified `npm pack` tarball and its
SHA-256 checksum. An unprefixed tag does not trigger the npm publishing workflow.

Before manual npm publication, run the development checks, `npm pack --dry-run`,
and `npm publish <tarball> --access public --dry-run`; smoke-test an installation
of the packed tarball in a fresh directory. Authenticate with `npm login`, then
publish that exact tarball with `npm publish <tarball> --access public`.

## Code style

TypeScript is compiled in strict mode. Do not add new dependencies without first discussing the change in an issue or discussion.

## Security reports

For a security issue or security report, use the process in [SECURITY.md](SECURITY.md). Do not publish bearer tokens, local session files, or private notebook content in public issues.

## Local paths

Avoid committing machine-specific paths or development-only notes. Documentation should use placeholders such as `/absolute/path/to/mica`.
