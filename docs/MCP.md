# MCP in HLVM

SSOT for the MCP implementation in this repository as of 2026-04-19.

## Status snapshot

- MCP protocol version: `2025-11-25` with fallback negotiation to `2025-03-26`
  and `2024-11-05`.
- Transports: `stdio`, HTTP, SSE (via official `@modelcontextprotocol/sdk`).
- OAuth: Authorization Code + PKCE, dynamic client registration, proactive token
  refresh, 401-retry-on-refresh, per-server `clientId` / `callbackPort`,
  insufficient-scope handling.
- Config scopes: project `.mcp.json`, project `.hlvm/mcp.json`, user
  `~/.hlvm/mcp.json`, Claude Code plugin import, plus cross-tool inheritance
  (Cursor, Windsurf, Zed, Codex CLI, Gemini CLI).
- User-facing management: `hlvm mcp add/list/remove/login/logout` and REPL
  `/mcp`.

## What users can do now

- Connect stdio MCP servers (filesystem, GitHub, memory, etc.).
- Connect OAuth-based HTTP MCP servers (Notion MCP, etc.).
- Run one-time OAuth login per server, then reuse/refresh tokens automatically.
- Automatically inherit any MCP server the user has already configured in Claude
  Code, Cursor, Windsurf, Zed, Codex CLI, or Gemini CLI — no reconfiguration
  required (see "Cross-tool discovery" below).
- Use configured MCP tools from `hlvm ask` / `hlvm repl` with no per-request
  auth steps.

## Quick start

```bash
HLVM_CMD='hlvm'                                    # installed CLI
# or:
HLVM_CMD='deno run -A src/hlvm/cli/cli.ts'         # from source
```

### One-line connect — OAuth HTTP MCP server

```bash
$HLVM_CMD mcp add notion --url https://mcp.notion.com/mcp && \
$HLVM_CMD mcp login notion
```

### One-line connect — stdio server

```bash
$HLVM_CMD mcp add github -- npx -y @modelcontextprotocol/server-github
```

### Verify

```bash
$HLVM_CMD mcp list
$HLVM_CMD ask "use my MCP tools"
```

## Live-verified end to end (2026-04-19)

Both via proper `hlvm ask` (no backdoor):

- **context7** (stdio, npx) — agent called `tool_search` → discovered
  `mcp_context7_resolve-library-id` → got `/reactjs/react.dev` back.
- **playwright** (stdio, npx) — navigated to a URL and returned page title.

Tested across `claude-code/claude-haiku-4-5`, `ollama/qwen3:8b`, and
`ollama/llama3.1:8b`. Fails on `ollama/gemma4:e4b` (4B is below the capability
threshold for multi-hop meta-tool reasoning — see "Model requirements" below).

### Cross-tool MCP inheritance (2026-04-19)

HLVM now reads MCP server definitions from Cursor, Windsurf, Zed, Codex CLI, and
Gemini CLI in addition to its own config and Claude Code plugins. Verified by
`deno test --allow-all tests/unit/agent/mcp-config.test.ts` (13/13 passing),
including:

- parsing each source's native schema (JSON, nested JSON, TOML)
- priority order (`user` > Cursor > Windsurf > Zed > Codex > Gemini > Claude
  Code) with duplicate server-name collapse to highest-priority source
- malformed / missing files skipped silently so one broken source can't break
  the whole load
- isolated CLI-source-path E2E runs via `hlvm mcp list` and `hlvm ask` proving
  Cursor, Windsurf (primary path, legacy path, and HTTP `serverUrl`), Zed
  (flat and nested command shapes), Codex CLI, and Gemini CLI all discover,
  connect, and execute MCP tools end to end

## OAuth flow (HTTP servers)

`hlvm mcp login <name>`:

1. Discovers protected-resource + authorization-server metadata.
2. Uses dynamic client registration when supported.
3. Starts PKCE (`S256`) and opens browser.
4. Waits for callback (default `127.0.0.1:35017`, per-server override
   supported).
5. Exchanges code for token and stores credentials locally.

Runtime:

- Adds `Authorization` header automatically when a token exists.
- Refreshes proactively near expiry (5-minute skew).
- On HTTP `401` with Bearer challenge: refresh → retry once.
- On `insufficient_scope`: persists the required scope so the next `login`
  requests it.

Storage: `~/.hlvm/mcp-oauth.json`. Override: `HLVM_MCP_OAUTH_PATH`.

## Configuration model

Loaded from multiple scopes, highest priority first. First match wins (duplicate
server names are silently collapsed by `dedupeServers`).

1. `<workspace>/.mcp.json` (project)
2. `<workspace>/.hlvm/mcp.json` (project)
3. `~/.hlvm/mcp.json` (user — HLVM's own)
4. `~/.cursor/mcp.json` (Cursor)
5. `~/.codeium/windsurf/mcp_config.json` or `~/.codeium/mcp_config.json`
   (Windsurf)
6. `~/.config/zed/settings.json` → `context_servers` (Zed)
7. `~/.codex/config.toml` → `[mcp_servers.*]` (Codex CLI)
8. `~/.gemini/settings.json` → `mcpServers` (Gemini CLI)
9. `~/.claude/plugins/marketplaces/**` plugin manifests (Claude Code)

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

## Cross-tool discovery

HLVM reads MCP server definitions from every major agent tool on the user's
machine and merges them into one runtime server list. User installs HLVM →
supported MCP server definitions they already configured elsewhere work
immediately, no reconfiguration. Duplicate server names across sources resolve
to the highest-priority source (see the priority list above).

| Source      | Path                                                                  | Format                                                                             |
| ----------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Cursor      | `~/.cursor/mcp.json`                                                  | JSON `mcpServers`                                                                  |
| Windsurf    | `~/.codeium/windsurf/mcp_config.json` or `~/.codeium/mcp_config.json` | JSON `mcpServers`                                                                  |
| Zed         | `~/.config/zed/settings.json`                                         | JSON `context_servers` (flat `command`/`args` or nested `command.{path,args,env}`) |
| Codex CLI   | `~/.codex/config.toml`                                                | TOML `[mcp_servers.*]`                                                             |
| Gemini CLI  | `~/.gemini/settings.json`                                             | JSON `mcpServers`                                                                  |
| Claude Code | `~/.claude/plugins/marketplaces/**`                                   | plugin manifests (see below)                                                       |

Each source is read independently; a malformed or missing file never blocks the
others. Scope labels appear in `hlvm mcp list` so you can see where a server
came from. HLVM normalizes a few cross-tool aliases while loading, including
Windsurf `serverUrl` → `url`, `timeout` → `connection_timeout_ms`, and Zed's
flat vs nested command shapes.

### Why this is safe (legal + security)

- HLVM is MIT OSS. Reading config files the user already wrote themselves on
  their own machine carries effectively zero legal risk — HLVM is not
  redistributing or repackaging any third-party code.
- No secrets are exfiltrated: env vars in these configs are just used to launch
  the same MCP subprocesses those other tools would launch.

## Claude Code plugin import

HLVM scans installed CC plugin manifests and merges them into the runtime MCP
server list. Anything a user has already configured for Claude Code works in
HLVM with no extra setup.

- Scan root: `~/.claude/plugins/marketplaces/`
- Collected subdirs: both `external_plugins/` and `plugins/`
- Schema read:
  `{ mcpServers: { name: { command, args, env, cwd, url, serverUrl, type, timeout, oauth, ... } } }`
- Supported transports from imported manifests: `stdio`, `http`, `sse`.
  Unsupported types (`ws`, `sse-ide`, `ws-ide`, `sdk`) are **rejected**, not
  silently misclassified.
- OAuth config on imported manifests is preserved (`clientId`, `callbackPort`,
  `authServerMetadataUrl`, `xaa`).
- Plugin-local variables (`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`) are
  expanded to real paths at connect time so stdio plugins launch correctly.

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
- Entries in `.mcp.json` are file-managed; edit `.mcp.json` to remove them
- `/mcp` in REPL lists configured servers with transport and scope

## Runtime behavior

Loaded lazily. On first MCP-tool usage (or when `tool_search` probes for a
deferred MCP tool), HLVM connects configured servers and registers their tools
into the active session.

Log on connect:

```
MCP: <server> — <toolCount> tools
```

Tool naming pattern: `mcp_<server>_<tool>`

Capability-gated helpers auto-register when the server exposes them:

- `mcp_<server>_list_resources`
- `mcp_<server>_read_resource`
- `mcp_<server>_list_prompts`
- `mcp_<server>_get_prompt`

## Implemented protocol surface

- Lifecycle + `initialize/initialized` negotiation
- JSON-RPC routing (responses, server requests, notifications)
- Tools (`tools/list`, `tools/call`)
- Resources (`list/read/templates/subscribe/unsubscribe`)
- Prompts (`list/get`)
- Sampling (`sampling/createMessage`)
- Elicitation (`elicitation/create`)
- Roots (`roots/list`)
- Completion (`completion/complete`)
- Logging (`logging/setLevel`, `notifications/message`)
- Cancellation (`notifications/cancelled`)
- Progress (`notifications/progress`)
- Pagination helper across list endpoints
- Ping

## Discovery — `tool_search` and lazy loading

MCP tools are **deferred** by default. Only the core local tools are in the
eager set sent to the model. The model discovers MCP tools at runtime via the
`tool_search` meta-tool.

System prompt includes an imperative rule: when the user names a tool, service,
or integration the model does not see in its eager list, it MUST call
`tool_search({query: "<name>"})` before replying.

Example discovery trace:

```
user: use context7 to get the library ID for react
  → tool_search({query:"context7"})
  → returns matches: mcp_context7_resolve-library-id, mcp_context7_query-docs
  → mcp_context7_resolve-library-id({libraryName:"React"})
  → answer with /reactjs/react.dev
```

## Model requirements for reliable MCP

Verified matrix (fresh sessions via `hlvm ask`, same context7 task):

| Model                 | Params    | Calls tool_search? | Full MCP loop |
| --------------------- | --------- | ------------------ | ------------- |
| claude-code/haiku-4-5 | ~frontier | ✅                 | ✅            |
| ollama/qwen3:8b       | 8B        | ✅                 | ✅            |
| ollama/llama3.1:8b    | 8B        | ✅                 | ✅            |
| ollama/gemma4:e4b     | 4B        | ❌                 | ❌            |
| ollama/gemma4:e2b     | 2B        | ❌                 | ❌            |

**8B is the practical minimum** for reliable multi-hop tool discovery.

Default local model (SSOT in `src/hlvm/runtime/bootstrap-manifest.ts`):

```
LOCAL_FALLBACK_MODEL = "qwen3:8b"
```

Legacy defaults (`gemma4:e2b`, `gemma4:e4b`) are recognized and auto-upgraded on
next run.

## Performance (M1 Max, qwen3:8b)

Measured on a full `hlvm ask` MCP loop (context7 discovery + call):

| Turn                                 | TTFT | Latency |
| ------------------------------------ | ---- | ------- |
| 1 (cold, 11K system prompt)          | ~43s | 45s     |
| 2 (process tool_search result)       | ~10s | 12s     |
| 3 (process MCP result, write answer) | 1.8s | 3.5s    |

Raw generation speed: ~37 tok/s. First-turn cost is dominated by cold prompt
processing. Subsequent turns benefit from Ollama's prompt cache.

## Current known gaps

- OAuth authorization UI is browser+redirect based (no device code flow).
- HTTP transport does not yet implement automatic `409` session recreation.
- HTTP transport uses request/response SSE and does not run a separate
  long-lived GET SSE listener.
- MCP Tasks (experimental protocol feature) not implemented.
- WebSocket transport (`ws`, `ws-ide`) not implemented — imported manifests
  using them are rejected rather than misclassified.
- Tool result output truncation + compression (CC-style) not implemented.
- MCP tools below 8B-class models: discovery via `tool_search` is unreliable.
  Architectural fix (pre-route tools via embedding retrieval before the LLM
  call) is the known path forward, not yet implemented.

## Roadmap — TODO

### Lazy-load reliability for small models

Ship a `classifyRelevantTools(query, toolCatalog)` in
`src/hlvm/runtime/local-llm.ts` that runs a cheap classification call and
populates `toolProfileState.discovery` before the main LLM turn. This is the
path that makes MCP reliable on 4B-class models that cannot do multi-hop
meta-tool reasoning on their own.

### Cold-prompt latency

The 11K-token system prompt dominates first-turn TTFT on local models. Plan:

- Trim non-essential sections for `constrained` / `standard` tiers.
- Pre-warm the prompt cache on install by issuing a throwaway generation during
  `hlvm bootstrap`.

### Cold-start fan-out

`tool_search` triggers `ensureMcpLoaded`, which spawns every configured server
at once so their tools can be enumerated into the live registry. With cross-tool
discovery the total count grows (power users may have 10–20+ servers combined).
Options when this becomes a real cost:

- Keep a lightweight **descriptor catalog** from config text alone — no
  subprocess until the model actually matches a server name in `tool_search`.
  Only spawn the matched server on demand.
- Per-server connect timeout and bounded parallelism already exist
  (`pooledMap`); failure of one server never blocks the rest.

Only pursue this once fan-out latency shows up in real-world sessions.

## Test coverage in repository

- Unit: `tests/unit/agent/mcp.test.ts`, `mcp-config.test.ts`,
  `mcp-resilience.test.ts`, `mcp-sse.test.ts`, `session-lazy-mcp.test.ts`
- OAuth unit: `tests/unit/agent/mcp-oauth.test.ts`
- CLI: `tests/unit/cli/mcp-command.test.ts`
- Integration (real `@modelcontextprotocol/server-filesystem`):
  `tests/integration/mcp-official-filesystem.test.ts`
- Interop (real `@modelcontextprotocol/server-everything`):
  `tests/interop/mcp/everything-stdio.test.ts`
- E2E OAuth (real HTTP server + full PKCE flow):
  `tests/e2e/mcp-oauth-e2e.test.ts`

Run:

```bash
deno task test:conformance                                     # interop
deno test --allow-all tests/unit/agent/mcp.test.ts
deno test --allow-all tests/unit/agent/mcp-config.test.ts
deno test --allow-all tests/unit/agent/mcp-oauth.test.ts
```

## Troubleshooting

### Browser says callback cannot connect

- Ensure `mcp login` is running in terminal while approving OAuth.
- Callback listener is owned by the login command; if it exits, callback fails.

### `invalid_grant` during login

- Usually caused by reusing a stale callback code/URL from a previous login
  attempt. Re-run `mcp login` and use the callback from the same run.

### `Client ID mismatch`

- Also indicates the callback code is not matching the current auth session.
  Re-run `mcp login` end-to-end.

### `NO_TOKEN` after login

- Run `hlvm mcp list` and confirm the server name matches what was logged in.
- Check `~/.hlvm/mcp-oauth.json` contains that server key.

### HTTP `401` on MCP call

- Run `hlvm mcp login <name>` again.
- Ensure the server URL in config matches the URL used for login.

### Local model ignores user's "use <service>" request

- Likely on a <8B model. Switch to `ollama/qwen3:8b` or better.

### Imported CC plugin fails to start

- Confirm the plugin is in `~/.claude/plugins/marketplaces/**/external_plugins/`
  or `.../plugins/`.
- If the plugin manifest uses `${CLAUDE_PLUGIN_ROOT}`, HLVM expands it at
  connect time; check `hlvm mcp list` to confirm it was imported.
- If the manifest declares `type: "ws"`, `"sse-ide"`, `"ws-ide"`, or `"sdk"`,
  HLVM rejects it — those transports are not supported.

## Source map

- Client: `src/hlvm/agent/mcp/sdk-client.ts`
- OAuth: `src/hlvm/agent/mcp/oauth.ts`
- Config (includes CC import + env expansion): `src/hlvm/agent/mcp/config.ts`,
  `src/hlvm/agent/mcp/env-expansion.ts`
- Tools + registration: `src/hlvm/agent/mcp/tools.ts`
- Types: `src/hlvm/agent/mcp/types.ts`
- Barrel: `src/hlvm/agent/mcp/mod.ts`
- CC plugin scan root: `src/common/paths.ts` → `getClaudeCodeMcpDir`
- Cross-tool config paths: `src/common/paths.ts` → `getCursorMcpPath`,
  `getWindsurfMcpPath`, `getZedSettingsPath`, `getCodexConfigPath`,
  `getGeminiSettingsPath`
- Cross-tool loaders + shared shape normalizer: `src/hlvm/agent/mcp/config.ts`
  (`parseMcpServersMap`, `loadCursorMcpServers`, `loadWindsurfMcpServers`,
  `loadZedMcpServers`, `loadCodexMcpServers`, `loadGeminiMcpServers`)
- System-prompt discovery rule: `src/hlvm/prompt/sections.ts` →
  `renderCriticalRules`
- Default local model SSOT: `src/hlvm/runtime/bootstrap-manifest.ts` →
  `LOCAL_FALLBACK_MODEL`
- CLI: `src/hlvm/cli/commands/mcp.ts`
- REPL: `src/hlvm/cli/repl/commands.ts`
