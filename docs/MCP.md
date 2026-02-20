# MCP Integration — Complete Specification

HLVM implements a full MCP (Model Context Protocol) client, compatible with the
[MCP specification](https://spec.modelcontextprotocol.io/) version **2025-11-25**
with **2024-11-05** and **2025-03-26** fallback negotiation.

Any MCP server that works with Claude Code works with HLVM.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Quick Start](#2-quick-start)
3. [Configuration](#3-configuration)
4. [CLI Commands](#4-cli-commands)
5. [REPL Commands](#5-repl-commands)
6. [Transports](#6-transports)
7. [Protocol Features](#7-protocol-features)
8. [Safety Model](#8-safety-model)
9. [Architecture](#9-architecture)
10. [Conformance](#10-conformance)
11. [Verified Servers](#11-verified-servers)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Overview

MCP lets HLVM connect to external tool servers — databases, file systems, APIs,
knowledge graphs, browsers, and more — using a standard JSON-RPC 2.0 protocol.

```
┌──────────┐    JSON-RPC 2.0     ┌───────────────────┐
│   HLVM   │◄───────────────────▶│  MCP Server       │
│  (client)│  stdio pipe / HTTP  │  (tools+resources) │
└──────────┘                     └───────────────────┘
```

When the agent starts, HLVM:
1. Loads MCP server configs from up to 3 scopes
2. Connects to each server via stdio or HTTP transport
3. Discovers tools, resources, and prompts
4. Registers them in the agent's tool registry
5. Logs connection status: `MCP: github — 26 tools`

The agent can then call MCP tools exactly like built-in tools — no special syntax.

---

## 2. Quick Start

### Add a server

```bash
# Stdio transport (most common)
hlvm mcp add github -- npx -y @modelcontextprotocol/server-github

# HTTP transport
hlvm mcp add db --url http://localhost:8080

# With environment variables
hlvm mcp add github -- npx -y @modelcontextprotocol/server-github \
    --env GITHUB_TOKEN=ghp_xxx
```

### Use it

```bash
hlvm ask "list my github repositories"
```

The agent sees `mcp_github_search_repositories`, `mcp_github_list_commits`,
etc. and calls them automatically.

### List servers

```bash
hlvm mcp list
```

### Remove a server

```bash
hlvm mcp remove github
```

---

## 3. Configuration

### 3.1 Config Scopes

HLVM loads MCP servers from three locations, merged with deduplication:

| Priority | Scope | Path | Format |
|----------|-------|------|--------|
| Highest | dotmcp | `<project>/.mcp.json` | Claude Code convention |
| Medium | project | `<project>/.hlvm/mcp.json` | HLVM native |
| Lowest | user | `~/.hlvm/mcp.json` | HLVM native |

When the same server name appears in multiple scopes, the highest-priority
scope wins. Loading is parallelized via `Promise.all`.

### 3.2 HLVM Native Format

`.hlvm/mcp.json` and `~/.hlvm/mcp.json` use:

```json
{
  "version": 1,
  "servers": [
    {
      "name": "github",
      "command": ["npx", "-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    },
    {
      "name": "db",
      "url": "http://localhost:8080"
    }
  ]
}
```

**Server fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique server identifier |
| `command` | string[] | One of command/url | Stdio: executable + arguments |
| `url` | string | One of command/url | HTTP: server endpoint URL |
| `env` | Record<string, string> | No | Environment variables for stdio |
| `cwd` | string | No | Working directory for stdio |
| `transport` | `"stdio"` \| `"http"` | No | Explicit transport override |
| `headers` | Record<string, string> | No | Additional HTTP headers |

### 3.3 Claude Code Convention (`.mcp.json`)

Drop a `.mcp.json` at the project root. This file is sharable via git:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "..." }
    },
    "postgres": {
      "url": "http://localhost:8080"
    }
  }
}
```

HLVM normalizes this into its internal `McpServerConfig` format automatically:
- Key becomes `name`
- `command` + `args` becomes `command: [command, ...args]`
- `url` maps directly to HTTP transport
- `env` maps directly

### 3.4 Built-in Server Discovery

HLVM also checks for a Playwright MCP server script at
`<workspace>/scripts/mcp/playwright-server.mjs`. If found, it is automatically
registered as `playwright` (stdio transport via `node`).

---

## 4. CLI Commands

```
hlvm mcp <command> [options]
```

### `hlvm mcp add`

Add a new MCP server.

```bash
# Stdio transport
hlvm mcp add <name> -- <command...>

# HTTP transport
hlvm mcp add <name> --url <url>

# Options
--scope project|user    # Config scope (default: project)
--env KEY=VALUE         # Environment variable (repeatable)
```

**Examples:**

```bash
hlvm mcp add github -- npx -y @modelcontextprotocol/server-github
hlvm mcp add db --url http://localhost:8080 --scope user
hlvm mcp add github -- npx -y @modelcontextprotocol/server-github \
    --env GITHUB_TOKEN=ghp_xxx --env GITHUB_ORG=myorg
```

If a server with the same name exists in the target scope, it is replaced.

### `hlvm mcp list` (alias: `ls`)

List all configured MCP servers across all scopes.

```bash
hlvm mcp list
```

Output:

```
MCP Servers:
  github              stdio  npx -y @modelcontextprotocol/server-github  (project)
  db                  http   http://localhost:8080                        (user)
  memory              stdio  npx -y @modelcontextprotocol/server-memory  (.mcp.json)
```

### `hlvm mcp remove` (alias: `rm`)

Remove a server.

```bash
# Auto-detect scope (tries project first, then user)
hlvm mcp remove <name>

# Explicit scope
hlvm mcp remove <name> --scope user
```

Note: Servers defined in `.mcp.json` cannot be removed via CLI — edit the file directly.

---

## 5. REPL Commands

### `/mcp`

In the HLVM REPL, type `/mcp` to see configured servers:

```
hlvm> /mcp
MCP Servers:
  github              stdio  npx -y @modelcontextprotocol/server-github
  memory              stdio  npx -y @modelcontextprotocol/server-memory
```

This uses dynamic import and displays ANSI-colored output.

---

## 6. Transports

### 6.1 Stdio Transport

The default. HLVM spawns the server as a child process and communicates via
stdin/stdout using newline-delimited JSON-RPC 2.0 messages.

```
HLVM ──stdin──▶ Server Process
HLVM ◀─stdout── Server Process
         stderr → drained silently
```

**Implementation**: `StdioTransport` class in `transport.ts`
- Uses `getPlatform().command.run()` (SSOT compliant)
- Newline-delimited JSON parsing with buffered read loop
- Stderr is drained to prevent pipe backpressure
- Graceful shutdown: close stdin → SIGTERM → await status

### 6.2 HTTP Transport (Streamable HTTP + SSE)

For remote servers. HLVM sends JSON-RPC over HTTP POST and handles responses
as either `application/json` or `text/event-stream` (SSE).

```
HLVM ──POST──▶ Server
HLVM ◀─JSON/SSE── Server
```

**Implementation**: `HttpTransport` class in `transport.ts`
- Uses `http.fetchRaw()` (SSOT compliant)
- `Accept: application/json, text/event-stream` header
- Session ID tracking via `Mcp-Session-Id` response/request header
- Protocol version header: `MCP-Protocol-Version`
- SSE stream parsing with multi-line data assembly
- DELETE request on close for session cleanup
- Supports custom headers via `server.headers`

### 6.3 Transport Factory

```typescript
createTransport(server: McpServerConfig): McpTransport
```

Returns `HttpTransport` if `server.url` is set or `server.transport === "http"`,
otherwise `StdioTransport`.

---

## 7. Protocol Features

### 7.1 Lifecycle

| Step | Direction | Description |
|------|-----------|-------------|
| `initialize` | Client → Server | Send protocolVersion, clientInfo, capabilities |
| Version negotiation | Server → Client | Accept 2025-11-25, fallback to 2024-11-05 or 2025-03-26 |
| `notifications/initialized` | Client → Server | Confirm initialization complete |
| Normal operation | Bidirectional | Tools, resources, prompts, sampling |
| `close()` | Client | Reject pending, close transport |

**Timeouts:**
- Transport start: 10 seconds
- JSON-RPC request: 30 seconds
- Transport close: 5 seconds (resolves on timeout — never blocks cleanup)

**Version negotiation:**
1. Client sends `protocolVersion: "2025-11-25"`
2. If server responds with `"2024-11-05"` or `"2025-03-26"` → accept fallback
3. If server responds with unknown version → disconnect (per spec SHOULD)
4. If server errors on version → retry with `"2024-11-05"` explicitly

### 7.2 Tools

```
tools/list     → paginated list of available tools
tools/call     → invoke a tool with arguments
```

Tools are registered in HLVM's tool registry as `mcp_<server>_<tool>`.
Tool names are sanitized (non-alphanumeric chars → underscores).

When the server sends `notifications/tools/list_changed`, HLVM re-lists
tools and updates the registry automatically.

### 7.3 Resources

Only registered if server declares `resources` capability.

```
resources/list                → paginated list of resources
resources/read                → read resource by URI
resources/templates/list      → list URI templates
resources/subscribe           → subscribe to resource changes
resources/unsubscribe         → unsubscribe
```

Exposed as agent tools:
- `mcp_<server>_list_resources` — L0 safety (auto-approved)
- `mcp_<server>_read_resource` — L0 safety (auto-approved)

### 7.4 Prompts

Only registered if server declares `prompts` capability.

```
prompts/list    → paginated list of available prompts
prompts/get     → render a prompt with arguments
```

Exposed as agent tools:
- `mcp_<server>_list_prompts` — L0 safety (auto-approved)
- `mcp_<server>_get_prompt` — L0 safety (auto-approved)

### 7.5 Sampling (Server → Client LLM)

Allows MCP servers to request LLM completions from the client.

```
sampling/createMessage    Server → Client request
```

The handler is wired via `McpLoadResult.setHandlers({ onSampling })` after
the LLM provider is initialized. The handler receives `McpSamplingRequest`
and returns `McpSamplingResponse`.

**Request fields:** messages, modelPreferences, systemPrompt, includeContext,
temperature, maxTokens, stopSequences, metadata.

**Response fields:** role, content (text or image), model, stopReason.

### 7.6 Elicitation (Server → Client User Input)

Allows MCP servers to request structured user input.

```
elicitation/create    Server → Client request
```

Wired via `setHandlers({ onElicitation })`. Receives `McpElicitationRequest`,
returns `McpElicitationResponse` with action (`accept`/`decline`/`cancel`)
and optional content.

### 7.7 Roots

Allows servers to discover the client's workspace roots.

```
roots/list    Server → Client request
```

Wired via `setHandlers({ roots: ["file:///path/to/workspace"] })`.
Supports `listChanged` capability notification.

### 7.8 Completion

```
completion/complete    Client → Server
```

Auto-complete for resource URIs and prompt arguments.

### 7.9 Logging

```
logging/setLevel    Client → Server (set server log level)
```

Server log messages arrive as `notifications/message` with level
(`debug`, `info`, `warning`, `error`, `critical`, `alert`, `emergency`)
and are routed to HLVM's logger at the appropriate level.

### 7.10 Cancellation

```
notifications/cancelled    Client → Server
```

- `sendCancellation(requestId, reason)` — cancel a single request
- `cancelAllPending(reason)` — cancel all in-flight requests
- `McpLoadResult.setSignal(signal)` — wire AbortSignal to cancel all
- Initialize requests are never cancelled (per spec)
- Cancel-after-response is safe (no crash)

### 7.11 Progress

```
notifications/progress    Server → Client
```

Progress updates with `progress`, `total` (optional), and `message` (optional).
Logged at debug level.

### 7.12 Pagination

All list operations (`tools/list`, `resources/list`, `prompts/list`,
`resources/templates/list`) use cursor-based pagination via a generic
`paginatedList()` helper. The client follows `nextCursor` until exhausted.

### 7.13 Ping

```
ping    Bidirectional
```

Client can send `ping` to server. Client responds to server `ping` with `{}`.

---

## 8. Safety Model

Every MCP tool is auto-classified based on its name and description:

| Level | Matches | Behavior |
|-------|---------|----------|
| **L0** | read, list, get, fetch, search, find, query, inspect, describe, status, render, screenshot, echo | Auto-approved |
| **L1** | No clear signal | Confirm once per session |
| **L2** | write, create, update, delete, remove, destroy, drop, insert, modify, post, put, patch, send, execute, run, start, stop, kill, restart, click, type, press, submit | Always confirm |

Classification uses word-boundary regex matching (`\b...\b`) on the combined
tool name + description (lowercased, punctuation normalized to spaces).

Resource and prompt tools are always L0 (read-only).

---

## 9. Architecture

### 9.1 Module Structure

```
src/hlvm/agent/mcp/
├── types.ts        Type definitions (config, JSON-RPC, tools, resources,
│                   prompts, sampling, elicitation, transport, handlers)
├── transport.ts    StdioTransport, HttpTransport, createTransport()
├── client.ts       McpClient — JSON-RPC multiplexer, protocol handshake,
│                   paginated list, tool/resource/prompt operations
├── config.ts       Config loading (3 scopes), saving, add/remove helpers,
│                   .mcp.json parsing, deduplication
├── tools.ts        Tool registration, safety heuristics, notification
│                   handlers, loadMcpTools() main entry point
├── handlers.ts     Type re-exports for handler interfaces
└── mod.ts          Barrel re-export (public API)

src/hlvm/agent/mcp.ts       Backward-compat barrel (re-exports mod.ts)
src/hlvm/cli/commands/mcp.ts CLI command: add, list, remove
src/hlvm/cli/repl/commands.ts /mcp REPL command
src/hlvm/agent/session.ts    Startup connection status logging
src/common/paths.ts          getMcpConfigPath() → ~/.hlvm/mcp.json
```

### 9.2 Data Flow

```
                    ┌─────────────────────────────────┐
                    │        loadMcpTools()            │
                    │  (tools.ts — main entry point)   │
                    └──────────────┬──────────────────┘
                                   │
           ┌───────────────────────┼───────────────────────┐
           ▼                       ▼                       ▼
  ┌──────────────┐      ┌──────────────┐       ┌──────────────┐
  │ .mcp.json    │      │ .hlvm/       │       │ ~/.hlvm/     │
  │ (dotmcp)     │      │ mcp.json     │       │ mcp.json     │
  │              │      │ (project)    │       │ (user)       │
  └──────┬───────┘      └──────┬───────┘       └──────┬───────┘
         └──────────────────┬──┘───────────────────────┘
                            ▼
                   dedupeServers<T>()
                            │
                    ┌───────┴───────┐
                    ▼               ▼
            ┌─────────────┐ ┌─────────────┐
            │ StdioTransp │ │ HttpTransp  │
            └──────┬──────┘ └──────┬──────┘
                   └───────┬───────┘
                           ▼
                    ┌─────────────┐
                    │  McpClient  │
                    │  initialize │
                    │  listTools  │
                    └──────┬──────┘
                           ▼
                  ┌─────────────────┐
                  │  registerTools  │
                  │  (agent registry│
                  │   as mcp_x_y)   │
                  └─────────────────┘
```

### 9.3 SSOT Compliance

All code follows HLVM's mandatory SSOT rules:

| Operation | API Used | Forbidden |
|-----------|----------|-----------|
| File I/O | `getPlatform().fs.*` | `Deno.readFile`, `Deno.writeFile` |
| HTTP | `http.fetchRaw()` | `fetch()` |
| Logging | `getAgentLogger().*`, `log.*` | `console.*` |
| Process | `getPlatform().command.run()` | `Deno.Command` |
| Errors | `ValidationError`, `getErrorMessage()` | raw throw strings |

---

## 10. Conformance

49 automated tests verify spec compliance:

| Category | Tests | Status |
|----------|-------|--------|
| Lifecycle | 12 | PASS |
| JSON-RPC Base | 8 | PASS |
| HTTP Transport | 10 | PASS |
| Cancellation | 5 | PASS |
| Robustness | 6 | PASS |
| Interop (reference server) | 8 | PASS |
| **Total** | **49** | **ALL PASS** |

```bash
deno task test:conformance   # 41 conformance tests
deno task test:interop        # 8 interop tests (requires Node.js)
```

See [mcp-conformance-matrix.md](mcp-conformance-matrix.md) for the full
requirement-to-test mapping.

---

## 11. Verified Servers

Tested with real-world MCP servers:

| Server | Package | Tools | Status |
|--------|---------|-------|--------|
| Filesystem | `@modelcontextprotocol/server-filesystem` | 14 | PASS |
| Memory | `@modelcontextprotocol/server-memory` | 9 | PASS |
| Sequential Thinking | `@modelcontextprotocol/server-sequential-thinking` | 1 | PASS |
| GitHub | `@modelcontextprotocol/server-github` | 26 | PASS |
| Everything (reference) | `@modelcontextprotocol/server-everything` | 8+ | PASS |

All connected, initialized, listed tools, and executed tool calls successfully.

---

## 12. Troubleshooting

### Server not connecting

```bash
# Check config is valid
hlvm mcp list

# Test the server command manually
npx -y @modelcontextprotocol/server-github
# Should output nothing (waiting for JSON-RPC on stdin)
```

### Server skipped at startup

Look for log messages:

```
WARN  Skipping MCP server 'name': <error message>
```

Common causes:
- Server command not found (check `npx` or `node` is on PATH)
- Server crashed during initialization
- Protocol version incompatibility
- Transport start timed out (10s)

### Tool not appearing

- Check server name matches: tools are `mcp_<server>_<tool>`
- Non-alphanumeric chars in names are replaced with underscores
- Server must declare capability for resources/prompts to see those tools

### Environment variables

```bash
# Via CLI
hlvm mcp add github -- npx -y @modelcontextprotocol/server-github \
    --env GITHUB_TOKEN=ghp_xxx

# Via .mcp.json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    }
  }
}

# Via native config
{
  "version": 1,
  "servers": [{
    "name": "github",
    "command": ["npx", "-y", "@modelcontextprotocol/server-github"],
    "env": { "GITHUB_TOKEN": "ghp_xxx" }
  }]
}
```

### HTTP transport issues

- Ensure the URL is accessible: `curl -X POST http://localhost:8080`
- Session ID is tracked automatically via `Mcp-Session-Id` header
- DELETE is sent on close for session cleanup

---

## TypeScript API Reference

### Public Exports (from `mcp/mod.ts`)

**Functions:**
- `loadMcpConfig(workspace, configPath?)` — Load config from single path
- `loadMcpConfigMultiScope(workspace)` — Load + merge all 3 scopes
- `addServerToConfig(scope, workspace, server)` — Add server to config file
- `removeServerFromConfig(scope, workspace, name)` — Remove server from config
- `resolveBuiltinMcpServers(workspace)` — Discover built-in servers
- `loadMcpTools(workspace, configPath?, extraServers?, ownerId?)` — Full load+connect+register
- `inferMcpSafetyLevel(name, description?)` — Classify tool safety

**Classes:**
- `McpClient` — JSON-RPC multiplexer with full MCP protocol support
- `StdioTransport` — Child process transport
- `HttpTransport` — HTTP/SSE transport
- `createTransport(server)` — Transport factory

**Types:**
- `McpConfig`, `McpServerConfig` — Configuration
- `McpScope`, `McpServerWithScope` — Multi-scope config
- `McpToolInfo`, `McpResourceInfo`, `McpResourceContent`, `McpResourceTemplate` — Server entities
- `McpPromptInfo`, `McpPromptMessage` — Prompts
- `McpSamplingRequest`, `McpSamplingResponse` — Sampling
- `McpElicitationRequest`, `McpElicitationResponse` — Elicitation
- `McpHandlers` — Handler registration interface
- `McpTransport`, `JsonRpcMessage` — Transport layer
- `McpConnectedServer`, `McpLoadResult` — Load result
