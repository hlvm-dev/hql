# MCP in HLVM (Current State)

This document describes the MCP implementation that is currently in this repository.

## Status snapshot

- MCP protocol version: `2025-11-25` with fallback negotiation to `2025-03-26` and `2024-11-05`.
- Transports: `stdio` and HTTP (`POST` with JSON or SSE responses).
- User-facing management: `hlvm mcp add/list/remove/login/logout` and REPL `/mcp`.
- OAuth for HTTP MCP servers: implemented (Authorization Code + PKCE).
- OAuth callback UX: local listener at `http://127.0.0.1:35017/hlvm/oauth/callback` with success page.
- Conformance suites in repo: `41` conformance tests + `8` interop tests.

## What users can do now

- Connect stdio MCP servers (for example GitHub, filesystem, memory).
- Connect OAuth-based HTTP MCP servers (for example Notion MCP).
- Run one-time OAuth login per server, then reuse/refresh tokens automatically.
- Use configured MCP tools from `hlvm ask` with no extra per-request auth steps.

## Quick start

Pick one launcher style:

- Installed CLI: `hlvm`
- From this repo source: `deno run -A src/hlvm/cli/cli.ts`

A convenient alias:

```bash
HLVM_CMD='deno run -A src/hlvm/cli/cli.ts'
# or: HLVM_CMD='hlvm'
```

### One-line connect for any OAuth HTTP MCP server

```bash
NAME="<server_name>"; URL="<mcp_http_url>"; $HLVM_CMD mcp add "$NAME" --url "$URL" && $HLVM_CMD mcp login "$NAME"
```

Example:

```bash
NAME="notion"; URL="https://mcp.notion.com/mcp"; $HLVM_CMD mcp add "$NAME" --url "$URL" && $HLVM_CMD mcp login "$NAME"
```

### One-line connect for stdio server

```bash
$HLVM_CMD mcp add github -- npx -y @modelcontextprotocol/server-github
```

### Verify

```bash
$HLVM_CMD mcp list
$HLVM_CMD ask "use my MCP tools"
```

## OAuth flow (HTTP servers)

`hlvm mcp login <name>` does the following:

1. Discovers protected resource metadata and authorization server metadata.
2. Uses dynamic client registration when available.
3. Starts PKCE flow (`S256`) and opens browser.
4. Waits for callback on `127.0.0.1:35017`.
5. Exchanges code for token and stores credentials locally.

Token storage:

- Default path: `~/.hlvm/mcp-oauth.json`
- Test override env: `HLVM_MCP_OAUTH_PATH`

Runtime behavior:

- Adds `Authorization` header automatically when token exists.
- Refreshes token proactively near expiry.
- On HTTP `401` with Bearer challenge, tries refresh and retries once.
- If login is required, surfaces:
  - `Run: hlvm mcp login <name>`

## Configuration model

HLVM loads config from three scopes, highest priority first:

1. `<workspace>/.mcp.json`
2. `<workspace>/.hlvm/mcp.json`
3. `~/.hlvm/mcp.json`

If names collide, first match wins (higher-priority scope overrides lower).

### `.mcp.json` format (Claude Code style)

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "..." }
    },
    "notion": {
      "url": "https://mcp.notion.com/mcp"
    }
  }
}
```

### Native format (`.hlvm/mcp.json` and `~/.hlvm/mcp.json`)

```json
{
  "version": 1,
  "servers": [
    {
      "name": "github",
      "command": ["npx", "-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "..." }
    },
    {
      "name": "notion",
      "url": "https://mcp.notion.com/mcp"
    }
  ]
}
```

## CLI commands

```bash
hlvm mcp add <name> -- <command...>
hlvm mcp add <name> --url <url>
hlvm mcp list
hlvm mcp remove <name> [--scope project|user]
hlvm mcp login <name>
hlvm mcp logout <name>
```

Notes:

- `add --scope project|user` (default: `project`)
- `add --env KEY=VALUE` repeatable
- `remove` without scope tries project first, then user
- `.mcp.json` entries are file-managed; remove them by editing `.mcp.json`

## REPL command

`/mcp` lists configured MCP servers with transport and scope labels.

## Runtime behavior in agent sessions

At session startup, MCP tools are loaded and registered. Connected servers are logged:

- `MCP: <server> — <toolCount> tools`

Tool naming pattern:

- `mcp_<server>_<tool>`

Resource and prompt helpers are auto-registered when capability exists:

- `mcp_<server>_list_resources`
- `mcp_<server>_read_resource`
- `mcp_<server>_list_prompts`
- `mcp_<server>_get_prompt`

## Implemented protocol surface

- Lifecycle + initialize/initialized negotiation
- JSON-RPC routing (responses, server requests, notifications)
- Tools (`tools/list`, `tools/call`)
- Resources (`list/read/templates/subscribe/unsubscribe`)
- Prompts (`list/get`)
- Sampling (`sampling/createMessage`)
- Elicitation (`elicitation/create`)
- Roots (`roots/list`)
- Completion (`completion/complete`)
- Logging (`logging/setLevel`, notifications/message)
- Cancellation (`notifications/cancelled`)
- Progress notifications (`notifications/progress`)
- Pagination helper across list endpoints
- Ping

## Current known gaps

These are intentionally explicit so docs match implementation reality:

- OAuth authorization UI is browser+redirect based (no device code flow).
- HTTP transport does not yet implement automatic `409` session recreation.
- HTTP transport currently uses request/response SSE handling and does not run a separate long-lived GET SSE listener.
- MCP Tasks (experimental) are not implemented.

## Test coverage in repository

- Conformance tests: `tests/conformance/mcp/` (41 tests)
- Interop tests: `tests/interop/mcp/` (8 tests)
- OAuth unit tests: `tests/unit/agent/mcp-oauth.test.ts`

Run commands:

```bash
deno task test:conformance
deno task test:interop
deno test --allow-all tests/unit/agent/mcp-oauth.test.ts
```

## Live verification performed

Recent live verification against Notion MCP in this environment:

- OAuth callback success page rendered on `127.0.0.1:35017`.
- Token stored and read from local OAuth store.
- Real HTTP MCP handshake + tool listing succeeded:
  - `initialize` HTTP status `200`
  - `tools/list` HTTP status `200`
  - tools returned: `12`

## Troubleshooting

### Browser says callback cannot connect

- Ensure `mcp login` is running in terminal while approving OAuth.
- Callback listener is started by login command; if login process exits, callback will fail.

### `invalid_grant` during login

- Usually caused by reusing old callback code/URL from a previous login attempt.
- Retry login and use callback from the same run.

### `Client ID mismatch`

- Also indicates callback code not matching current auth session.
- Re-run `mcp login` and complete once end-to-end.

### `NO_TOKEN` after login

- Run `hlvm mcp list` and ensure server name matches what you logged in with.
- Check `~/.hlvm/mcp-oauth.json` exists and contains that server key.

### HTTP `401` on MCP call

- Run `hlvm mcp login <name>` again.
- Ensure server URL in config matches the URL used for login.

## Source map (where MCP code lives)

- `src/hlvm/agent/mcp/client.ts`
- `src/hlvm/agent/mcp/transport.ts`
- `src/hlvm/agent/mcp/oauth.ts`
- `src/hlvm/agent/mcp/config.ts`
- `src/hlvm/agent/mcp/tools.ts`
- `src/hlvm/agent/mcp/types.ts`
- `src/hlvm/agent/mcp/mod.ts`
- `src/hlvm/cli/commands/mcp.ts`
- `src/hlvm/cli/repl/commands.ts`
