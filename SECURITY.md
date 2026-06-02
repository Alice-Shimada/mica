# Security Policy

## Supported scope

MICA is designed for local control of already-open Wolfram Desktop / Mathematica notebooks. Wolfram Desktop / Mathematica 14.1+ is supported; Mathematica 13.x / 14.0 remains experimental. Headless Wolfram Engine is not supported for live notebook control.

## Security assumptions

- The HTTP bridge binds to `127.0.0.1` / localhost by default.
- MICA has no remote mode. Do not expose the bridge port to a network.
- Protocol endpoints require bearer token auth with the generated local session token.
- The dashboard token is carried in the URL fragment (`#token=...`) and should be treated as sensitive for the current user session.
- Notebook mutation permissions are explicit. Insert, modify, delete, run, and save operations are controlled by the Wolfram permission block installed for the bridge.
- MICA does not provide an arbitrary shell tool or a raw-eval MCP endpoint.

## Reporting vulnerabilities

Report security issues through the GitHub repository security contact or issues page:

https://github.com/Alice-Shimada/mica/issues

Please avoid including sensitive notebook content, bearer tokens, or local session files in public reports.
