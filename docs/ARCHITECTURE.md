# HLVM System Architecture

> Full architecture of the HLVM ecosystem: GUI app (~~/dev/HLVM) + CLI engine
> (~~/dev/hql), how they communicate, and the vision they serve.

---

## Vision

**A programmable AI operating environment for macOS.**

Not a chatbot. Not a launcher. Not an IDE. A living, system-wide, programmable
intelligence layer where code and AI are the same thing — available everywhere,
instantly.

Three access patterns, one unified runtime:

- **Think** (Spotlight REPL) — type an expression, see the result
- **Act** (Hotbar modules, pinned from Launchpad) — one keypress, immediate
  execution
- **Delegate** (Agent chat) — describe the task, AI handles it

Runtime-first architecture:

- **Core engine** — agent, memory, HQL, MCP, providers, companion logic
- **Runtime host** — localhost HTTP/NDJSON/SSE boundary, auth, sessions,
  lifecycle
- **Shells** — macOS app today, CLI now migrating to the same host contract,
  future Windows/Linux shells

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   ~/dev/HLVM — macOS GUI (SwiftUI + AppKit, native, menu bar app)      │
│                                                                         │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│   │  Spotlight   │  │   Hotbar    │  │    Chat     │  │  Launchpad  │  │
│   │  Panel       │  │  [1]...[0]  │  │   Window    │  │  (modules)  │  │
│   │  (REPL/      │  │  (pinned    │  │  (AI agent  │  │  (ALL       │  │
│   │   Search)    │  │   subset)   │  │   ReAct)    │  │   installed)│  │
│   └──────┬───────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │
│          │                 │                │                │          │
│          └─────────────────┴────────────────┴────────────────┘          │
│                                     │                                   │
│   Infrastructure: ReplServerManager, HqlChatClient, HqlAPIClient,      │
│   HttpManager, JSON (yyjson), ClipboardManager, KeyboardShortcuts      │
│                                                                         │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │
                                      │  HTTP localhost:11435
                                      │  Auth: Bearer token (UUID)
                                      │  CORS: localhost only
                                      │
┌─────────────────────────────────────▼───────────────────────────────────┐
│                                                                         │
│   ~/dev/hql — HLVM Runtime + CLI Shells (Deno, TypeScript)            │
│                                                                         │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│   │ Runtime  │  │  Agent   │  │  HQL     │  │  REPL    │              │
│   │  Host    │  │  Engine  │  │Transpiler│  │  State   │              │
│   │ (serve)  │  │ (ReAct)  │  │(7-stage) │  │(persist) │              │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘              │
│                                                                         │
│   Shared: Providers, Platform, Store (SQLite), Memory (FTS5), MCP      │
│                                                                         │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │
                          ┌───────────┼───────────┐
                          ▼           ▼           ▼
                    ┌───────────────┐ ┌─────────┐ ┌──────────┐
                    │   Ollama      │ │  Cloud  │ │   MCP    │
                    │ compat :11434 │ │Providers│ │ Servers  │
                    │ HLVM  :11439  │ │ (APIs)  │ │(stdio/http)│
                    └───────────────┘ └─────────┘ └──────────┘
```

---

### Runtime Boundary

```
┌──────────────────── shells ────────────────────┐
│ macOS app │ CLI │ future Windows/Linux shells │
│ input     │ rendering │ hotkeys │ approvals   │
└──────────────────────┬─────────────────────────┘
                       │
                       ▼
┌────────────────── runtime host ─────────────────┐
│ localhost HTTP/NDJSON/SSE                       │
│ auth token │ daemon lifecycle │ sessions        │
│ readiness  │ stream fanout    │ shell contract  │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌────────────────── core engine ──────────────────┐
│ agent │ memory │ HQL │ MCP │ providers │ store │
│ companion decisions │ no GUI/TTY assumptions    │
└─────────────────────────────────────────────────┘
```

The rule is:

- shells own UX and OS integration
- the runtime host owns the local protocol and lifecycle
- the core engine owns intelligence and state

That keeps GUI, CLI, and future shells aligned around one runtime instead of
duplicating agent logic per surface.

---

## Process Lifecycle

### How GUI Spawns the Server

```
macOS Boot
   │
   ▼
HLVM.app launches (menu bar accessory, no dock icon)
   │
   ▼
AppDelegate → DefaultDependencyProvider.bootstrap()
   │  Wires all dependencies via constructor injection
   │  NO server started yet (lazy startup)
   │
   ▼
Menu bar: 🔥 icon appears. App is idle. Zero CPU.
   │
   │  User triggers first interaction:
   │  - Opens Spotlight panel (global hotkey)
   │  - Opens Chat window
   │  - Clicks menu bar icon
   │
   ▼
ReplServerManager.startServer()
   │
   ├── ① Probe runtime port
   │     TCP connect 127.0.0.1:11435
   │
   │     if occupied:
   │       refuse startup
   │       show "Another HLVM runtime is already running..."
   │
   │     if free:
   │       continue
   │
   ├── ② Generate auth token
   │     UUID().uuidString → "A1B2C3D4-..."
   │
   ├── ③ Spawn server process
   │     Binary: HLVM.app/Contents/Resources/hlvm
   │     Args: ["serve"]
   │     Env: {
   │       HLVM_REPL_PORT: "11435",
   │       HLVM_AUTH_TOKEN: <token>,
   │       HOME: ~,
   │       PATH: /usr/local/bin:...
   │     }
   │     stdout/stderr → /dev/null
   │
   ├── ④ Register crash handler
   │     terminationHandler → post "hlvmServerCrashed" notification
   │
   └── ⑤ Health check loop (bounded retry)
         Attempt 1:  GET :11435/health  (wait 50ms)
         Attempt 2:  GET :11435/health  (wait 100ms)
         ...
         Attempt 10: GET :11435/health  (wait 500ms)
         Total max: ~2 seconds
         │
         ▼
      Response: { "status": "ok", "authToken": "A1B2C3D4-..." }
         │
         ▼
      Server READY. Begin normal operations.
```

### Server Startup (Deno Side)

```
cli.ts → main() → "serve" command
   │
   ▼
serve.ts → startServer()
   │
   ├── Read HLVM_REPL_PORT, HLVM_AUTH_TOKEN
   ├── Initialize AI runtime (runtimeReady promise)
   │     ├── Load config from ~/.hlvm/settings.json
   │     ├── Detect available providers
   │     ├── Register tools (built-in + MCP)
   │     └── Register globalThis APIs (ai, config, memory)
   ├── Initialize REPL state (evaluator, module cache)
   ├── Initialize DB (SQLite for sessions/messages)
   │
   └── Deno.serve({ port: 11435, hostname: "127.0.0.1" })

Request pipeline:
   request → CORS → size guard (1MB) → auth check → router → handler
```

### App Shutdown

```
ReplServerManager.stopServer()
   → process.terminate() (SIGTERM)
   → Wait for terminationHandler callback
   → Clean exit
```

---

## HTTP Protocol

### Authentication

- **Mechanism**: Bearer token in `Authorization` header
- **Token generation**: Random UUID at GUI startup, passed via `HLVM_AUTH_TOKEN`
  env var
- **Bootstrap**: Token returned in `GET /health` response (no auth required)
- **Scope**: All endpoints except `/health` and `OPTIONS`

### CORS

- **Allowed origins**: `http://localhost:*` and `http://127.0.0.1:*`
- **Allowed methods**: GET, POST, PATCH, DELETE, OPTIONS
- **Allowed headers**: Content-Type, X-Request-ID, Last-Event-ID, Authorization

### Three Response Patterns

#### Pattern A: JSON (Simple Request/Response)

```
GUI                              Server
 │                                │
 │── GET /api/chat/messages ────▶│
 │                                │── resolve active hidden session
 │◀── 200 ───────────────────────│
 │   { "messages": [...], ... }   │

Used by: active conversation messages, config, models, eval, cancel
```

#### Pattern B: NDJSON Stream (Long-Running Operations)

```
GUI                              Server
 │                                │
 │── POST /api/chat ────────────▶│
 │   X-Request-ID: req-456        │
 │                                │
 │◀── 200 (application/x-ndjson) │
 │                                │
 │◀─ {"event":"start","request_id":"req-456"}\n
 │◀─ {"event":"token","text":"I'll"}\n
 │◀─ {"event":"token","text":" search"}\n
 │◀─ {"event":"tool_start","name":"search_code",...}\n
 │◀─ {"event":"tool_end","name":"search_code","success":true,...}\n
 │◀─ {"event":"token","text":"Found the bug"}\n
 │◀─ {"event":"turn_stats","tool_count":1,"duration_ms":3200}\n
 │◀─ {"event":"complete","session_version":2}\n
 │   [connection closes]

Used by: /api/chat, /api/models/pull
```

#### Pattern C: SSE (Real-Time Push, Long-Lived)

```
GUI                              Server
 │                                │
 │── GET /api/chat/stream ──────▶│
 │   Accept: text/event-stream    │
 │                                │
 │◀── 200 (text/event-stream)    │
 │◀─ retry: 3000\n\n             │  ← reconnection interval
 │◀─ id: 1\nevent: snapshot\ndata: {...}\n\n
 │   ... time passes ...
 │◀─ id: 2\nevent: conversation_updated\ndata: {...}\n\n
 │◀─ : heartbeat\n\n             │  ← every 30 seconds
 │   ... connection stays open indefinitely ...

On disconnect: GUI reconnects with Last-Event-ID, server replays missed events.
Used by: /api/chat/stream, models/stream, config/stream
```

---

## Full Endpoint Reference

### Health & Diagnostics

| Method | Path      | Auth | Response | Purpose                              |
| ------ | --------- | ---- | -------- | ------------------------------------ |
| GET    | `/health` | No   | JSON     | Server status + auth token bootstrap |

### Chat & Agent

| Method | Path                      | Auth | Response      | Purpose                                  |
| ------ | ------------------------- | ---- | ------------- | ---------------------------------------- |
| POST   | `/api/chat`               | Yes  | NDJSON stream | Streaming chat/agent request             |
| GET    | `/api/chat/messages`      | Yes  | JSON          | List active conversation messages        |
| GET    | `/api/chat/messages/:mid` | Yes  | JSON          | Get a single active-conversation message |
| POST   | `/api/chat/messages`      | Yes  | JSON          | Add message to the active conversation   |
| PATCH  | `/api/chat/messages/:mid` | Yes  | JSON          | Update an active-conversation message    |
| DELETE | `/api/chat/messages/:mid` | Yes  | JSON          | Delete an active-conversation message    |
| GET    | `/api/chat/stream`        | Yes  | SSE           | Real-time active-conversation updates    |
| POST   | `/api/chat/cancel`        | Yes  | JSON          | Cancel in-flight request                 |
| POST   | `/api/chat/interaction`   | Yes  | JSON          | Respond to permission/question           |

### Models

| Method | Path                          | Auth | Response      | Purpose                    |
| ------ | ----------------------------- | ---- | ------------- | -------------------------- |
| GET    | `/api/models`                 | Yes  | JSON          | List available models      |
| GET    | `/api/models/:provider/:name` | Yes  | JSON          | Get model info             |
| GET    | `/api/models/catalog`         | Yes  | JSON          | Downloadable models        |
| GET    | `/api/models/status`          | Yes  | JSON          | Provider availability      |
| POST   | `/api/models/pull`            | Yes  | NDJSON stream | Download model             |
| DELETE | `/api/models/:provider/:name` | Yes  | JSON          | Delete model               |
| GET    | `/api/models/stream`          | Yes  | SSE           | Model change notifications |

### Config

| Method | Path                 | Auth | Response | Purpose                     |
| ------ | -------------------- | ---- | -------- | --------------------------- |
| GET    | `/api/config`        | Yes  | JSON     | Get config                  |
| PATCH  | `/api/config`        | Yes  | JSON     | Update config               |
| GET    | `/api/config/stream` | Yes  | SSE      | Config change notifications |

### Eval & Completions

| Method | Path               | Auth | Response | Purpose                                         |
| ------ | ------------------ | ---- | -------- | ----------------------------------------------- |
| POST   | `/eval`            | Yes  | JSON     | Internal compatibility eval primitive (non-GUI) |
| POST   | `/api/completions` | Yes  | JSON     | Code completions                                |

### Memory Functions

| Method | Path                            | Auth | Response | Purpose                |
| ------ | ------------------------------- | ---- | -------- | ---------------------- |
| GET    | `/api/memory/functions`         | Yes  | JSON     | List persistent defn's |
| POST   | `/api/memory/functions/execute` | Yes  | JSON     | Execute a function     |

---

## Chat Pipeline (Full Depth)

When the user types "fix the auth bug" in the Chat window:

```
┌─ GUI Layer ─────────────────────────────────────────────────────────┐
│                                                                     │
│  ReplLogView (SwiftUI)                                              │
│     │                                                               │
│     ▼                                                               │
│  ReplLogViewModel.sendMessage(text)                                 │
│     ├── Generate client_turn_id (UUID)                              │
│     ├── Append to local message store (optimistic UI)               │
│     │                                                               │
│     ▼                                                               │
│  HqlChatClient.streamChat(HqlChatRequest {                          │
│     mode: "agent",                                                  │
│     messages: [                                                     │
│       { role: "system", content: "You are..." },                    │
│       { role: "user", content: "fix the auth bug",                  │
│         client_turn_id: "turn-789" }                                │
│     ],                                                              │
│     model: nil,     // server default                               │
│     temperature: nil // server default                              │
│  })                                                                 │
│     │                                                               │
│     ├── POST http://127.0.0.1:11435/api/chat                       │
│     │   Authorization: Bearer A1B2C3D4-...                          │
│     │   X-Request-ID: req-456                                       │
│     │                                                               │
│     └── StreamLineDelegate accumulates bytes, splits on \n          │
│                                                                     │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌─ Server Layer ──────────────────────────────────────────────────────┐
│                                                                     │
│  handlers/chat.ts → handleChat(req)                                 │
│     ├── Parse body → validate (mode, messages)                      │
│     ├── Ignore deprecated public session_id if provided             │
│     ├── Check: model supports tools? (else 400)                     │
│     ├── Check: provider approved? (else 403)                        │
│     ├── Check: session_version conflict? (else 409)                 │
│     ├── await runtimeReady                                          │
│     ├── Register request for cancellation tracking                  │
│     └── Return streaming Response (application/x-ndjson)            │
│                                                                     │
│  chat-agent-mode.ts (inside the stream):                            │
│     │                                                               │
│     ├── ① emit("start", { request_id })                            │
│     │                                                               │
│     ├── ② Get or create AgentSession                                │
│     │     agent-runner.ts → getOrCreateCachedSession()              │
│     │     ├── Cache hit? → reuseSession() (refresh memory)          │
│     │     ├── Cache miss? → createAgentSession()                    │
│     │     │     ├── resolveEngine() (legacy or SDK)                 │
│     │     │     ├── engine.createLLM(model)                         │
│     │     │     ├── resolveContextBudget(model)                     │
│     │     │     ├── loadMemoryContext(budget)                        │
│     │     │     ├── detectGitContext() (3s timeout)                  │
│     │     │     ├── ensureMcpLoaded()                               │
│     │     │     └── classifyModelTier() → weak|mid|frontier         │
│     │     └── session: { engine, llm, modelTier, context }          │
│     │                                                               │
│     ├── ③ Build system prompt (11 modular sections, tier-filtered)  │
│     ├── ④ Build tool definitions (filtered by model tier)           │
│     ├── ⑤ Load history from SQLite                                  │
│     │                                                               │
│     ├── ⑥ Enter ReAct loop (orchestrator.ts)                        │
│     │     │                                                         │
│     │     │  ┌─ Per Iteration ─────────────────────────────────┐   │
│     │     │  │  orchestrator-llm.ts → call LLM                  │   │
│     │     │  │     │ streaming tokens → emit("token", text)     │   │
│     │     │  │     │ tool_call detected →                       │   │
│     │     │  │     ▼                                            │   │
│     │     │  │  emit("tool_start", { name, args_summary })      │   │
│     │     │  │     │                                            │   │
│     │     │  │  Permission check (policy.ts)                    │   │
│     │     │  │     ├── Always allowed → proceed                 │   │
│     │     │  │     ├── Needs approval →                         │   │
│     │     │  │     │   emit("interaction_request", {...})        │   │
│     │     │  │     │   ↕ GUI shows [Allow][Deny][Always]        │   │
│     │     │  │     │   POST /api/chat/interaction → unblock     │   │
│     │     │  │     └── Denied → tool returns error to LLM       │   │
│     │     │  │     │                                            │   │
│     │     │  │  Execute tool → result                           │   │
│     │     │  │  emit("tool_end", { name, success, content })    │   │
│     │     │  │  Format + truncate result for next turn          │   │
│     │     │  │  Track iteration, token usage                    │   │
│     │     │  │  maybeInjectReminder() (safety/routing hints)    │   │
│     │     │  └──────────────────────────────────────────────────┘   │
│     │     │                                                         │
│     │     └── Loop until LLM returns final text (no more tools)    │
│     │                                                               │
│     ├── ⑦ emit("turn_stats", { tool_count, duration_ms })          │
│     ├── ⑧ Save messages to SQLite, update session_version           │
│     └── ⑨ emit("complete", { session_version })                    │
│                                                                     │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌─ GUI Event Dispatch ────────────────────────────────────────────────┐
│                                                                     │
│  StreamLineDelegate → yyjson parse → HqlChatEvent enum              │
│                                                                     │
│  .start         → show SiriIcon animation                           │
│  .token         → append to chat bubble (streaming markdown)        │
│  .toolStart     → ActivityPanel: add row with spinner               │
│  .toolEnd       → ActivityPanel: update row with duration           │
│  .interaction   → InteractionBubble: [Allow][Deny][Always]          │
│  .turnStats     → ActivityPanel: summary line                       │
│  .complete      → stop animation, update session_version            │
│  .error         → red error bubble, stop animations                 │
│  .cancelled     → show partial text with "(cancelled)"              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Eval Pipeline (HQL from Spotlight)

When the user types `(map inc (range 5))` in Spotlight:

```
GUI: detect "(" prefix → eval mode
   │
   ├── POST :11435/api/chat { "mode": "eval", "messages": [{ "role": "user", "content": "(map inc (range 5))" }] }
   │
   ▼
Server: evaluator.ts → analyzeExpression()
   │  starts with "(" → HQL mode
   │
   ▼
HQL Transpiler Pipeline:
   │
   ├── ① parser.ts: tokenize → parse
   │    "(map inc (range 5))"
   │    → AST: [Symbol(map), Symbol(inc), [Symbol(range), 5]]
   │
   ├── ② semantic-validator.ts: resolve names
   │    map → stdlib.map, inc → stdlib.inc, range → stdlib.range
   │
   ├── ③ hql-ast-to-hql-ir.ts: AST → IR
   │    CallExpr(map, [inc, CallExpr(range, [5])])
   │
   ├── ④ effect-checker.ts: all pure ✓
   │
   ├── ⑤ syntax-transformer.ts: no sugar
   │
   ├── ⑥ js-code-generator.ts: IR → JS
   │    → "map(inc, range(5))"
   │
   └── ⑦ (no TS compilation for eval)
   │
   ▼
js-eval.ts: execute in REPL context
   globalThis has stdlib + previous (defn ...) bindings
   eval("map(inc, range(5))")
   → LazySeq → realize → "[1, 2, 3, 4, 5]"
   │
   ▼
Response: { "success": true, "value": "[1, 2, 3, 4, 5]", "logs": [] }
   │
   ▼
GUI: display result inline in Spotlight panel
   State persists — next expression can reference this result
```

---

## State Synchronization

### SSE Connections (3 concurrent, long-lived)

```
GUI Process                          Server (:11435)
   │                                    │
   │═══ GET /api/chat/stream ══════════▶│  ① Active chat messages
   │═══ GET /api/models/stream ════════▶│  ② Model availability
   │═══ GET /api/config/stream ════════▶│  ③ Config changes
   │                                    │
   │  All SSE connections:              │
   │  - Auto-reconnect (3s retry)       │
   │  - Last-Event-ID replay            │
   │  - 30s heartbeat                   │
```

### Optimistic Locking (session_version)

```
GUI                                 Server
 │  local version = 2                │  DB version = 2
 │                                   │
 │── POST /api/chat (version: 2) ──▶│  ← match ✓
 │                                   │── save → version = 3
 │◀── complete, version: 3 ─────────│
 │  update local = 3                 │
 │                                   │
 │── POST /api/chat (version: 2) ──▶│  ← STALE!
 │◀── 409 Conflict ─────────────────│
 │  refresh session                  │
```

---

## Concurrent Connection Map (Steady State)

```
GUI Process                           hlvm serve (:11435)

 SSE (long-lived):
 ═══════════════════▶  GET /api/chat/stream            ①
 ═══════════════════▶  GET /api/models/stream          ②
 ═══════════════════▶  GET /api/config/stream          ③

 NDJSON (per-chat):
 ───────────────────▶  POST /api/chat                  ⑤

 REST (on-demand):
 - - - - - - - - - ▶  POST /api/chat (mode: eval)     ⑥
                       GET /api/models                  ⑦
                       PATCH /api/config                ⑧
                       POST /api/chat/cancel            ⑨
                       POST /api/chat/interaction       ⑩
                       GET /api/memory/functions         ⑪
                       POST /api/completions             ⑫
                       ... (any CRUD endpoint)

                           Server outbound:
                           → Ollama :11439 (HLVM-managed local LLM)
                           → OpenAI / Anthropic / Google APIs
                           → MCP servers (stdio/http)
                           → Web fetch (agent tools)
```

---

## Cancellation Flow

```
User clicks [Stop] during agent execution

GUI                                  Server
 │                                    │
 ├── ① Cancel URLSession task         │
 │   (terminates NDJSON stream)       │
 │                                    │
 └── ② POST /api/chat/cancel ───────▶│
      { "request_id": "req-456" }     │
                                      │── abortController.abort()
                                      │   → LLM request aborted
                                      │   → Tool execution aborted
                                      │   → MCP call cancelled
                                      │
                                      │── emit("cancelled", {
                                      │     request_id, partial_text
                                      │   })
                                      │── Save partial to DB (cancelled=true)
                                      │
      { "cancelled": true } ◀─────────│
```

---

## Model Pull Flow

```
User selects "gemma4:e4b" and clicks [Download]

GUI                          Server                    Ollama
 │                            │                         │
 │── POST /api/models/pull ─▶│                         │
 │   { "name": "gemma4:e4b" }│── POST :11439/pull ───▶│
 │                            │                         │
 │◀─ NDJSON stream ──────────│◀─ progress ─────────────│
 │  {"event":"progress","completed":1073741824,"total":4294967296}
 │                            │                         │
 │  ████░░░░ 25%              │                         │
 │  ... more progress ...     │                         │
 │                            │                         │
 │◀─ {"event":"complete"} ───│◀─ success ──────────────│
 │                            │                         │
 │  Model list refreshed      │                         │
 │  (via SSE /api/models/stream: "models_updated")      │
```

---

## Shared State Map

### GUI Process (Swift)

| Category   | Data                                                                                  | Storage      |
| ---------- | ------------------------------------------------------------------------------------- | ------------ |
| Ephemeral  | Visible conversation state, scroll position, streaming buffers, SSE state, auth token | Memory       |
| Persistent | Hotbar slots, Spotlight position, shortcuts, appearance, launch-at-login              | UserDefaults |

### Server Process (Deno)

| Category   | Data                                                                                                               | Storage                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Ephemeral  | Active requests (AbortControllers), SSE connections, cached sessions, LLM instances, MCP connections, module cache | Memory                                   |
| Persistent | Config (unified settings)                                                                                          | `~/.hlvm/settings.json`                  |
| Persistent | Sessions, messages, SSE events                                                                                     | `~/.hlvm/hlvm.db` (SQLite)               |
| Persistent | Memory, FTS5 index                                                                                                 | `~/.hlvm/memory/`                        |
| Persistent | MCP server configs                                                                                                 | `~/.hlvm/mcp.json`                       |
| REPL state | globalThis bindings (defn, def), module cache, code history                                                        | Memory (survives evals, lost on restart) |

### Shared via Filesystem

```
~/.hlvm/settings.json
  ├── Server reads on startup + watches for changes
  ├── Server writes on PATCH /api/config
  ├── GUI reads via GET /api/config
  ├── GUI writes via PATCH /api/config
  ├── CLI writes directly (hlvm config set ...)
  └── Server detects external changes → pushes SSE config_updated

~/.hlvm/hlvm.db (SQLite)
  ├── Server owns exclusively (single writer)
  └── GUI accesses only via HTTP API

~/.hlvm/memory/
  ├── Server owns exclusively
  ├── MEMORY.md — user-authored notes (explicit memory)
  └── memory.db — SQLite facts, entities, FTS5 (implicit memory)
```

---

## GUI Surfaces (Detailed)

### Spotlight Panel

- **Type**: NSPanel at `.spotlightLevel` (above all windows)
- **Trigger**: Global hotkey (configurable via KeyboardShortcuts)
- **Modes**: REPL eval, search
  (apps/files/modules/settings/dictionary/stocks/history), agent, browse,
  playground
- **Features**: FuzzyScorer, detail panel (right side), suggestion window,
  position saved per screen
- **Data sources**: AppSearchManager, FileSearch, DictionarySearch,
  WebBrowserHistory, StockQuoteService, SystemSettings

### Hotbar

- **Type**: NSPanel, floating horizontal icon bar
- **Slots**: N configurable slots, each bound to a module action
- **Interaction**: Click or keyboard shortcut to fire
- **Relationship**: Hotbar is a **pinned subset** of Launchpad — only modules
  the user has assigned shortcuts to or explicitly pinned appear here

### Chat Window

- **Type**: Single active-conversation chat surface
- **Layout**: Message transcript + activity/detail panels
- **Detail**: Message bubbles with Markdown/syntax highlighting
- **Features**: SiriIcon animation, ThinkingBubble, ActivityPanel (tool calls),
  InteractionBubble (permissions), image drag-and-drop, drawing input

### Launchpad

- **Type**: Full-screen overlay (paged grid)
- **Purpose**: Module inventory browser — the **superset of all installed
  modules**. Every installed potion appears here.
- **Features**: Search, drag-and-drop reorder, edit mode, keyboard shortcuts
- **Flow**: Install -> Launchpad (all installed) -> pin/shortcut -> Hotbar
  (quick-access subset)

---

## Agent Engine (Detailed)

### Session Creation

```
createAgentSession(options)
  ├── getAgentEngine()        → SDK engine
  ├── engine.createLLM()      → Provider instance
  ├── resolveContextBudget()  → 3-layer token budget pipeline
  ├── loadMemoryContext()     → SQLite FTS5 search, budget-aware
  ├── detectGitContext()      → Branch, dirty state (3s timeout)
  ├── ensureMcpLoaded()       → Load MCP tools from configured servers
  └── classifyModelTier()     → weak | mid | frontier
```

### System Prompt (11 Sections)

| Section                       | Tiers    | Content                           |
| ----------------------------- | -------- | --------------------------------- |
| `renderIdentity()`            | All      | "You are HLVM..."                 |
| `renderEnvironment()`         | All      | cwd, OS, model, git context       |
| `renderToolRouting()`         | All      | Auto-generated from tool metadata |
| `renderPermissions()`         | All      | Auto-generated from safetyLevel   |
| `renderConciseness()`         | All      | Brevity directive                 |
| `renderWebSafety()`           | All      | "Never fabricate URLs..."         |
| `renderFileEditing()`         | Mid+     | File editing guidelines           |
| `renderCodeQuality()`         | Mid+     | Code quality standards            |
| `renderThinkingProtocol()`    | Frontier | Chain-of-thought                  |
| `renderExamples()`            | Weak+Mid | Few-shot examples                 |

### Tool Registry

**Built-in (TOOL_REGISTRY)**:

| Category | Tools                                                                              |
| -------- | ---------------------------------------------------------------------------------- |
| File     | `read_file`, `write_file`, `edit_file`, `list_files`, `open_path`, `archive_files` |
| Code     | `find_symbol`, `search_code`, `get_structure`                                      |
| Shell    | `shell_exec`, `shell_script`                                                       |
| Git      | `git_log`, `git_diff`, `git_commit`, `git_status`                                  |
| Web      | `web_fetch`, `fetch_url`, `search_web`, `render_url`                               |
| Data     | `filter`, `transform`, `aggregate`, `compute`                                      |
| Meta     | `ask_user`                                                                         |

**Dynamic (DYNAMIC_TOOL_REGISTRY)**:

- MCP tools (loaded from server configs)
- `memory_write`, `memory_search`

### Engine Abstraction

```
AgentEngine interface
  └── SdkAgentEngine    → Vercel AI SDK v6
       ├── @ai-sdk/openai
       ├── @ai-sdk/anthropic
       ├── @ai-sdk/google
       └── ollama-ai-provider-v2
```

---

## HQL Transpiler Pipeline

```
source.hql
   │
   ├── ① parser.ts           → S-expression tokenize + parse → AST
   ├── ② semantic-validator   → Name resolution, scope checking
   ├── ③ hql-ast-to-hql-ir   → AST → typed intermediate representation
   ├── ④ effect-checker       → Pure/impure effect inference + constraints
   ├── ⑤ syntax-transformer   → Desugar syntax handlers
   ├── ⑥ js-code-generator    → IR → JavaScript (+ TCO, source maps)
   └── ⑦ ts-compiler          → Optional TypeScript emit + type checking
   │
   ▼
output.js + output.js.map (Source Map V3)
```

### Language Features

| Feature          | Details                                                         |
| ---------------- | --------------------------------------------------------------- |
| Functions        | `fn`, `async fn`, `fn*`, arrow, variadic                        |
| Classes          | Full: inherit, private, getters/setters                         |
| Pattern matching | `match`/`case`/guards, or-patterns                              |
| Macros           | Compile-time, syntax-quote hygiene, raw quasiquote, auto-gensym |
| Threading        | `->`, `->>`, `as->`                                             |
| Lazy sequences   | Clojure-style, infinite                                         |
| TCO              | Auto self-recursion + mutual (Tarjan SCC)                       |
| Type annotations | Full TypeScript output                                          |
| JS interop       | `js-call`, `js-get`, `js-set`, `js-new`, `?.`, `??`             |
| Generators       | `yield`, `yield*`, async generators                             |
| Destructuring    | Array and object                                                |
| Effect system    | Constraint-based pure/impure inference                          |

### Stdlib (96% Self-Hosted)

107 functions + 15 aliases. Core, sequences, higher-order, predicates, math,
transducers. AI functions (REPL only): `ask`, `generate`, `chat`, `summarize`,
`example`, `format`, `print`, `model`.

---

## Providers

| Provider    | Endpoint                            | Models                                            | Local? |
| ----------- | ----------------------------------- | ------------------------------------------------- | ------ |
| Ollama      | `127.0.0.1:11439`                   | gemma4:e4b (default), other local models | Yes    |
| OpenAI      | `api.openai.com`                    | GPT-4, GPT-3.5                                    | No     |
| Anthropic   | `api.anthropic.com`                 | Claude family                                     | No     |
| Google      | `generativelanguage.googleapis.com` | Gemini family                                     | No     |
| Claude Code | SDK                                 | Claude (via SDK)                                  | No     |

All providers implement the `AIProvider` interface:

- `chat(messages, options)` → completion
- `listModels()` → available models
- `getStatus()` → health check

Cloud providers use the `createCloudProvider()` factory (collapsed from 4
classes).

---

## MCP Integration

- **SDK**: `@modelcontextprotocol/sdk@^1.12.0`
- **Transport**: stdio | streamable-http (with SSE fallback)
- **Protocol**: 2025-11-25 (with 2024-11-05 fallback)
- **Capabilities**: tools, resources, prompts, elicitation, sampling, roots,
  progress
- **Config**: `~/.hlvm/mcp.json`

---

## Memory System

- **Storage**: `~/.hlvm/memory/MEMORY.md` (explicit) + `memory.db` (implicit,
  SQLite)
- **Architecture**: DB-as-SSOT with facts, entities, relationships tables + FTS5
- **Retrieval**: Hybrid (FTS5 BM25 + entity graph traversal) with temporal decay
  (30-day half-life) + access boost
- **Agent tools**: `memory_write`, `memory_search`, `memory_edit` (always
  available)
- **Auto-extraction**: Regex baseline (all models) + LLM extraction (frontier
  only)
- **Pre-compaction flush**: Orchestrator injects save prompt before compaction
- **Full details**: See `docs/memory-system-final.md`

---

## Local AI Substrate

The bootstrap system ensures `hlvm ask "hello"` works immediately after install.

- **Model store**: `~/.hlvm/.runtime/models/` (HLVM-owned, isolated from system
  Ollama)
- **Engine isolation**: `startAIEngine()` sets `OLLAMA_MODELS` env to redirect
  storage
- **HLVM-owned endpoint**: `http://127.0.0.1:11439` for the HLVM-managed
  runtime; `11434` is compatibility-only for explicit system-Ollama use
- **Pinned fallback**: `gemma4:e4b` with a pinned Ollama manifest digest prefix
  and published size sanity bound
- **Manifest**: `~/.hlvm/.runtime/manifest.json` — tracks engine + model state,
  hashes
- **States**: `uninitialized` → `verified` (healthy) or `degraded` (missing
  assets)
- **Adopt-or-pull bootstrap**: `hlvm bootstrap` reuses a preloaded pinned model
  when present and only pulls when it is absent
- **Readiness**: `/health.aiReady` is only true when the fallback is actually
  verified and usable
- **Recovery**: `hlvm bootstrap --repair` re-materializes missing/corrupt assets
- **Model resolution chain**: Claude Code → Ollama Cloud → **local fallback**
  (new)
- **Install**: `curl -fsSL https://hlvm.dev/install.sh | sh` installs the binary,
  downloads pinned Ollama, and completes local Gemma bootstrap before returning
- **Full details**: See `docs/vision/single-binary-local-ai.md`

---

## Future: Module Ecosystem

### Architecture

```
Decentralized hosting (any HTTP URL)
  + Curated index (GitHub repo: index.json)
  + AI Forge (generate modules on demand)
```

### Module Format (ESM JS)

```javascript
export const meta = {
  name: "module-name",
  icon: "icon-name",
  description: "What it does",
  actions: { actionName: { label: "...", shortDescription: "..." } },
};

export async function actionName({ ai, shell, clipboard, fs, fetch, notify }) {
  // Module implementation
}
```

### Module Sources

| Source          | Example                                  |
| --------------- | ---------------------------------------- |
| Local file      | `~/hlvm-modules/tool.mjs`                |
| HTTP URL        | `https://gist.github.com/.../mod.mjs`    |
| npm via ESM CDN | `https://esm.sh/lodash-es`               |
| Deno            | `https://deno.land/x/mod.ts`             |
| HLVM registry   | `https://modules.hlvm.dev/tool.mjs`      |
| AI-generated    | `(forge "clipboard markdown formatter")` |

### Trust Tiers

| Tier | Source                        | Trust           |
| ---- | ----------------------------- | --------------- |
| 1    | `@hlvm/*` (built-in)          | Trusted         |
| 2    | Community index (PR-reviewed) | Vetted          |
| 3    | Any HTTP URL                  | Use at own risk |

### Hotbar / Launchpad Integration

Launchpad shows all installed modules. Hotbar shows only the pinned subset
(modules with assigned shortcuts). Both trigger the same execution path:

```
User presses Ctrl+3 (Hotbar) or clicks module in Launchpad
  → GUI reads binding: { module: "git-standup", action: "standup" }
  → POST :11435/module/run { url, action }
  → Server: import(url), inject context, execute
  → Result → notification / clipboard / panel
  Total: ~2-3 seconds, one keypress
```

❯ so before going deep brainstorm, let's talk about our entire currente where we
are system - HLVM GUI (~~/dev/HLVM) and HLVM CLI (~~/dev/hql)

draw full architecture and pipeline nad how they communicate not only overall
picture but also specifying and explanaing all detail inside

with emphasis on my vision and goal - and what I am trying to make - hoping you
understand my world class vision to some degree.

draw ASCII full visual

⏺ Let me map both systems in full detail.

⏺ 3 Explore agents finished (ctrl+o to expand) ├─ Map hlvm serve HTTP API · 20
tool uses · 77.4k tokens │ ⎿  Done ├─ Map GUI HTTP client layer · 23 tool uses ·
71.8k tokens │ ⎿  Done └─ Map CLI project full structure · 49 tool uses · 56.1k
tokens ⎿  Done

⏺ Now I have the complete picture. Here's the full architecture with your vision
overlaid.

╔══════════════════════════════════════════════════════════════════════════════════════════════════╗
║ ║ ║ THE VISION: A Programmable AI Operating Environment ║ ║
───────────────────────────────────────────────────── ║ ║ ║ ║ Not a chatbot. Not
a launcher. Not an IDE. ║ ║ A living, system-wide, programmable intelligence
layer ║ ║ where code and AI are the same thing — available everywhere,
instantly. ║ ║ ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ │ │ ~/dev/HLVM — macOS GUI (SwiftUI + AppKit, native, menu bar app) │ │ │ │
┌───────────────────────── SURFACES (how user touches the system)
──────────────────────────┐ │ │ │ │ │ │ │
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ │ │ │ │ SPOTLIGHT PANEL (NSPanel, .spotlightLevel, global hotkey) │ │ │ │ │ │
┌──────────────────────────────────────────────────────────────┐ ┌─────────────┐
│ │ │ │ │ │ │ 🔥 ▌(-> (clipboard) json-parse (get "users") (map :name)) │ │
Detail Panel │ │ │ │ │ │ │
└──────────────────────────────────────────────────────────────┘ │ │ │ │ │ │ │ │
┌─ Results / Output ───────────────────────────────────────────┐ │ name │ │ │ │
│ │ │ │ │ │ source │ │ │ │ │ │ │ │ MODE 1: REPL → type HQL/JS, see result
instantly │ │ actions │ │ │ │ │ │ │ │ MODE 2: Search → apps, files, modules,
settings │ │ [Equip] │ │ │ │ │ │ │ │ MODE 3: Agent → "fix the auth bug" (full
ReAct) │ │ [Edit] │ │ │ │ │ │ │ │ MODE 4: Browse → module library (inventory) │
│ [Remove] │ │ │ │ │ │ │ │ MODE 5: Playground → WKWebView code editor │ │ │ │ │
│ │ │ │ │ │ │ │ │ │ │ │ │ │ │ ▸ Apps (27) ▸ Modules (12) ▸ Files (8) │ │ │ │ │ │
│ │ │ │ ▸ Settings (5) ▸ Dictionary (3) ▸ Stocks (2) │ │ │ │ │ │ │ │ │ │ [Load
More] │ │ │ │ │ │ │ │ │
└──────────────────────────────────────────────────────────────┘ └─────────────┘
│ │ │ │ │ │ │ │ │ │ │ │ Data sources: AppSearchManager, FileSearch,
DictionarySearch, │ │ │ │ │ │ WebBrowserHistory, StockQuoteService,
SystemSettings, FuzzyScorer │ │ │ │ │
└─────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ │ │ │ │
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ │ │ │ │ HOTBAR (NSPanel, floating, always visible) ← PINNED SUBSET of
Launchpad │ │ │ │ │ │ │ │ │ │ │ │ [1]📋 [2]🔍 [3]📝 [4]🔧 [5]🚀 [6]🌐 [7]🇰🇷 ...
[0]⚡ │ │ │ │ │ │ clip- code- standup json- deploy fetch trans- forge │ │ │ │ │
│ tools search fmt late │ │ │ │ │ │ │ │ │ │ │ │ Ctrl+N → fire module action
instantly (no UI, just result) │ │ │ │ │ │ Ctrl+Shift+N → open action picker (if
module has multiple exports) │ │ │ │ │ │ Drag from Module Library → equip to
slot │ │ │ │ │
└──────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ │ │ │ │
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ │ │ │ │ LAUNCHPAD (full-screen overlay, paged grid) ← ALL INSTALLED (superset)
│ │ │ │ │ │ │ │ │ │ │ │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
┌──────┐ ┌──────┐ │ │ │ │ │ │ │ git │ │ csv │ │ api │ │email │ │ k8s │ │regex │
│ sql │ │ aws │ │ │ │ │ │ │ │tools │ │tools │ │test │ │draft │ │ mgr │ │help │
│query │ │ ops │ │ │ │ │ │ │ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘
└──────┘ └──────┘ └──────┘ │ │ │ │ │ │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ │ │ │
│ │ │ │docker│ │ PR │ │ DB │ │ AI │ Search, browse, install, equip, reorder │ │
│ │ │ │ │ctl │ │review│ │ seed │ │forge │ Drag to Hotbar = equip │ │ │ │ │ │
└──────┘ └──────┘ └──────┘ └──────┘ │ │ │ │ │ │ ● ○ ○ (pages) │ │ │ │ │
└──────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ │ │ │ │
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ │ │ │ │ CHAT WINDOW (NavigationSplitView) ← THE AI AGENT INTERFACE │ │ │ │ │ │
│ │ │ │ │ │ ┌─ Rooms ──┐ ┌─ Conversation ──────────────────┐ ┌─ Activity
──────────────┐ │ │ │ │ │ │ │ ▸ Auth │ │ │ │ ⚡ search_code (1.2s) │ │ │ │ │ │ │
│ ▸ Deploy │ │ User: fix the auth bug │ │ ⚡ read_file (0.3s) │ │ │ │ │ │ │ │ ▸
Debug │ │ │ │ ⚡ edit_file (0.1s) │ │ │ │ │ │ │ │ │ │ 🟣 [SiriIcon animating] │
│ ● shell_exec (running) │ │ │ │ │ │ │ │ │ │ ┌─ ThinkingBubble ─┐ │ │ │ │ │ │ │
│ │ │ │ │ │ ● ● ● │ │ │ [Allow] [Deny] [Always]│ │ │ │ │ │ │ │ │ │
└──────────────────┘ │ │ ↑ InteractionBubble │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │ │
│ │ │ │ Assistant: I found the issue... │ │ │ │ │ │ │ │ │ │ │ │
`ts                           │  │                        │    │ │ │
  │   │  │  │          │  │  // highlighted code             │  │                        │    │ │ │
  │   │  │  │          │  │`
│ │ │ │ │ │ │ │ │ └──────────┘ └──────────────────────────────────┘
└────────────────────────┘ │ │ │ │ │ │ │ │ │ │ │ │ Markdown rendering, syntax
highlighting, image drag-and-drop, drawing input │ │ │ │ │
└──────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ │ │ │ │ ┌──────────────────────── Other Surfaces
───────────────────────────────────────────┐ │ │ │ │ │ Settings (General,
Appearance, Spotlight, AI, Shortcuts, Permissions, About) │ │ │ │ │ │
DrawingPanel (sketch → AI interpretation) │ │ │ │ │ │ ScreenCaptureManager
(screenshot → AI context) │ │ │ │ │ │ SheetsWorkspaceView (spreadsheet editor
via WKWebView) │ │ │ │ │
└───────────────────────────────────────────────────────────────────────────────────┘
│ │ │
└───────────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ ┌──────────────────────── INFRASTRUCTURE (Swift side)
─────────────────────────────────────┐ │ │ │ │ │ │ │ AppDelegate → Dependency
wiring, lifecycle │ │ │ │ HlvmApp (@main) → Menu bar extra (flame icon), window
management │ │ │ │ DefaultDependencyProvider → Clean Architecture DI (no
singletons) │ │ │ │ │ │ │ │ ReplServerManager → Spawns hlvm binary, health
checks, crash recovery │ │ │ │ HqlChatClient → HTTP streaming to /api/chat
(NDJSON line parser) │ │ │ │ HqlAPIClient → HTTP calls to /api/chat,
/api/completions, /api/memory/* │ │ │ │ HttpManager → URLSession +
StreamLineDelegate, async streams │ │ │ │ JSON.swift → yyjson C library,
zero-copy parsing, thread-local codec pool │ │ │ │ │ │ │ │ ClipboardManager →
System clipboard read/write │ │ │ │ QuickLookManager → File preview │ │ │ │
SpeechManager → Text-to-speech │ │ │ │ WebBrowserHistoryManager → Browser
history search │ │ │ │ AutocompletePanel → Code completion suggestions │ │ │ │ │
│ │ │ KeyboardShortcuts → Global hotkey registration (3rd party) │ │ │ │
LaunchAtLogin → Login item management (3rd party) │ │ │ │ SDWebImage → Async
image loading/caching (3rd party) │ │ │ │ OrderedCollections → Ordered
dictionaries (3rd party) │ │ │
└───────────────────────────────────────────────────────────────────────────────────────────┘
│ │ │
└────────────────────────────────────────────┬────────────────────────────────────────────────────┘
│ │ HTTP :11435 (localhost only) │ Auth: Bearer token (random UUID) │ CORS:
localhost origins only │ Max body: 1MB │
┌───────────────────────────┐│┌──────────────────────────────┐ │ NDJSON
(streaming) │││ SSE (real-time push) │ │ POST /api/chat │││ GET /api/chat/stream
│ │ POST /api/models/pull │││ GET /api/models/stream │ │ │││ GET
/api/config/stream │ │ Events: │││ │ │ start → token* → tool* │││ Events: │ │ →
interaction? → complete│││ snapshot / message_* │ │ (or error/cancelled) │││
models_updated/config_updated│
└───────────────────────────┘│└──────────────────────────────┘ │
┌───────────────────────────┐│┌──────────────────────────────┐ │ REST (CRUD) │││
Internal Helpers │ │ /api/chat/messages │││ POST /eval (internal) │ │
/api/models (list/del) │││ GET /api/memory/functions │ │ /api/config (get/patch)
│││ POST /api/memory/fn/execute │ │ GET /health (no auth) │││ │
└───────────────────────────┘│└──────────────────────────────┘ │
┌────────────────────────────────────────────▼────────────────────────────────────────────────────┐
│ │ │ ~/dev/hql — HLVM CLI (Deno, TypeScript) │ │ │ │
┌────────────────────────── ENTRY POINTS
──────────────────────────────────────────────────┐ │ │ │ │ │ │ │ cli.ts →
main() │ │ │ │ ├── hlvm ask "..." → askCommand() → runtime host → agent loop │ │
│ │ ├── hlvm chat / repl → replCommand() → React Ink REPL (shell today) │ │ │ │
├── hlvm serve → serve.ts → runtime host on :11435 │ │ │ │ ├── hlvm run
<file.hql> → hql.ts → transpile() → eval() │ │ │ │ ├── hlvm compile <file> →
compile.ts → transpile() → write JS/native │ │ │ │ ├── hlvm mcp → mcp.ts → MCP
server management │ │ │ │ └── hlvm init/upgrade/... → utility commands │ │ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ ┌────────────────────────── HTTP SERVER (hlvm serve)
──────────────────────────────────────┐ │ │ │ │ │ │ │ http-server.ts →
http-router.ts → handlers/ │ │ │ │ │ │ │ │ ┌─ chat.ts
─────────────────────────────────────────────────────────────────────────┐ │ │ │
│ │ POST /api/chat → mode: "chat" | "agent" | "claude-code-agent" │ │ │ │ │ │ →
streams NDJSON: start/token/tool_start/tool_end/ │ │ │ │ │ │
interaction_request/turn_stats/complete/error/cancelled │ │ │ │ │ │ POST
/api/chat/cancel → abort in-flight request by request_id │ │ │ │ │ │ POST
/api/chat/interaction → respond to permission/question (approve/deny/input) │ │
│ │ │ │ │ │ │ │ │ │ chat-agent-mode.ts → full ReAct agent loop (tools,
multi-turn) │ │ │ │ │ │ chat-direct.ts → simple LLM chat (no tools) │ │ │ │ │ │
chat-session.ts → request tracking, interaction state │ │ │ │ │
└────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ │ │ │ │ ┌─ Other Handlers
──────────────────────────────────────────────────────────────────┐ │ │ │ │ │
sessions.ts → CRUD + SSE stream for session list │ │ │ │ │ │ messages.ts →
CRUD + pagination for session messages │ │ │ │ │ │ models.ts →
list/pull/delete/status + SSE stream │ │ │ │ │ │ config.ts → get/patch + SSE
stream (watches config file) │ │ │ │ │ │ sse.ts → per-session SSE stream
(snapshot/add/update/delete events) │ │ │ │ │
└────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ │ │ │ │ ┌─ Eval Engine
─────────────────────────────────────────────────────────────────────┐ │ │ │ │ │
POST /api/chat (mode: eval) → top-level eval turn in the active conversation │ │
│ │ │ │ POST /api/completions → code completion (fuzzy match on REPL state) │ │
│ │ │ │ GET /api/memory/functions → list defn's in REPL memory │ │ │ │ │ │ POST
/api/memory/fn/execute → call a persisted function by name │ │ │ │ │ │ │ │ │ │ │
│ evaluator.ts → analyzeExpression() → transpile or js-eval │ │ │ │ │ │ state.ts
→ ReplState (code history, module cache, bindings — persistent) │ │ │ │ │ │
js-eval.ts → JavaScript evaluation harness │ │ │ │ │
└────────────────────────────────────────────────────────────────────────────────────┘
│ │ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ ┌────────────────────────── AI AGENT ENGINE
───────────────────────────────────────────────┐ │ │ │ │ │ │ │ ┌─ Session
────────────────────────────────────────────────────────────────────────┐ │ │ │
│ │ session.ts → createAgentSession() │ │ │ │ │ │ ├── engine: AgentEngine
(Legacy or SDK) │ │ │ │ │ │ ├── llm: AIProvider
(Ollama/OpenAI/Anthropic/Google/ClaudeCode) │ │ │ │ │ │ ├── modelTier: weak |
mid | frontier │ │ │ │ │ │ ├── context: AgentContext (token budget, file roots)
│ │ │ │ │ │ ├── mcp: MCP client (SDK-based, spec-compliant) │ │ │ │ │ │ └── memory:
loadMemoryContext() (SQLite FTS5, BM25 + temporal decay) │ │ │ │ │ │ │ │ │ │ │ │
detectGitContext() → branch, dirty state (3s timeout, parallel) │ │ │ │ │ │
resolveContextBudget() → 3-layer pipeline + overflow retry │ │ │ │ │
└────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ │ │ │ │ ┌─ Orchestrator (ReAct Loop)
──────────────────────────────────────────────────────┐ │ │ │ │ │
orchestrator.ts → runReActLoop() │ │ │ │ │ │ │ │ │ │ │ │ ┌─ Per Iteration
───────────────────────────────────────────────────────────┐ │ │ │ │ │ │ │ 1.
orchestrator-llm.ts → send messages to LLM, get response │ │ │ │ │ │ │ │ 2.
orchestrator-response.ts → classify: text / tool_call / error │ │ │ │ │ │ │ │ 3.
orchestrator-tool-execution.ts → execute tools (parallel by default) │ │ │ │ │ │
│ │ 4. orchestrator-tool-formatting.ts → format results for next turn │ │ │ │ │
│ │ │ 5. orchestrator-state.ts → track iteration count, token usage │ │ │ │ │ │
│ │ 6. maybeInjectReminder() → mid-conversation safety/routing hints │ │ │ │ │ │
│ └────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ │ │ │ │ │ │ │ │ Emits events: start, token, tool_start, tool_end,
turn_stats, │ │ │ │ │ │ interaction_request, complete, error, cancelled │ │ │ │
│
└────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ │ │ │ │ ┌─ System Prompt (llm-integration.ts)
─────────────────────────────────────────────┐ │ │ │ │ │ 11 modular section
renderers, tier-filtered: │ │ │ │ │ │ ├── renderIdentity() (all tiers) │ │ │ │ │
│ ├── renderEnvironment() (all tiers, includes git context) │ │ │ │ │ │ ├──
renderToolRouting() (auto-generated from tool metadata) │ │ │ │ │ │ ├──
renderPermissions() (auto-generated from safetyLevel) │ │ │ │ │ │ ├──
renderConciseness() (all tiers) │ │ │ │ │ │ ├── renderWebSafety() (all tiers) │
│ │ │ │ │ ├── renderFileEditing() (mid+frontier only) │ │ │ │ │ │ ├──
renderCodeQuality() (mid+frontier only) │ │ │ │ │ │ ├── renderThinkingProtocol()
(frontier only) │ │ │ │ │ │ └── renderExamples() (weak+mid only) │ │ │ │ │
└────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ │ │ │ │ ┌─ Tool Registry (registry.ts)
────────────────────────────────────────────────────┐ │ │ │ │ │ │ │ │ │ │ │
BUILT-IN TOOLS (TOOL_REGISTRY): │ │ │ │ │ │ ┌─ File ───────┐ ┌─ Code ──────┐ ┌─
Shell ─────┐ ┌─ Git ──────────────┐ │ │ │ │ │ │ │ read_file │ │ find_symbol │ │
shell_exec │ │ git_log │ │ │ │ │ │ │ │ write_file │ │ search_code │ │
shell_script│ │ git_diff │ │ │ │ │ │ │ │ edit_file │ │ get_structure│
└─────────────┘ │ git_commit │ │ │ │ │ │ │ │ list_files │ └─────────────┘ │
git_status │ │ │ │ │ │ │ │ open_path │ ┌─ Web ───────┐ ┌─ Data ──────┐
└────────────────────┘ │ │ │ │ │ │ │ archive_files│ │ web_fetch │ │ filter │ ┌─
Meta ──────┐ │ │ │ │ │ │ └──────────────┘ │ fetch_url │ │ transform │ │
ask_user │ │ │ │ │ │ │ │ search_web │ │ aggregate │ │ │ │ │ │ │
│ │ render_url │ │ compute │ └──────────────┘ │ │ │ │ │ │ └─────────────┘
└─────────────┘ │ │ │ │ │ │ │ │ │ │ │ │ DYNAMIC TOOLS (DYNAMIC_TOOL_REGISTRY): │
│ │ │ │ │ ├── MCP tools (loaded from mcp server configs) │ │ │ │ │ │ ├──
memory_write, memory_search (from memory/tools.ts) │ │ │ │ │ │ └── (future:
module tools?) │ │ │ │ │
└────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ │ │ │ │ ┌─ Engine Abstraction (engine.ts)
─────────────────────────────────────────────────┐ │ │ │ │ │ │ │ │ │ │ │
AgentEngine interface: │ │ │ │ │ │ └── SdkAgentEngine → Vercel AI SDK v6
│ │ │ │ │ │ ├── @ai-sdk/openai │ │ │ │ │ │ ├──
@ai-sdk/anthropic │ │ │ │ │ │ ├── @ai-sdk/google │ │ │ │ │ │ └──
ollama-ai-provider-v2 │ │ │ │ │
└────────────────────────────────────────────────────────────────────────────────────┘
│ │ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ ┌────────────────────────── HQL TRANSPILER
────────────────────────────────────────────────┐ │ │ │ │ │ │ │
src/hql/transpiler/index.ts → transpile(code, options) → TranspileResult │ │ │ │
│ │ │ │ ┌─ Pipeline (7 stages)
────────────────────────────────────────────────────────────┐ │ │ │ │ │ │ │ │ │
│ │ source.hql │ │ │ │ │ │ │ │ │ │ │ │ │ ▼ │ │ │ │ │ │ ① parser.ts → S-expr
tokenize + parse → AST │ │ │ │ │ │ │ │ │ │ │ │ │ ▼ │ │ │ │ │ │ ②
semantic-validator.ts → name resolution, scope checking │ │ │ │ │ │ │ │ │ │ │ │
│ ▼ │ │ │ │ │ │ ③ hql-ast-to-hql-ir.ts → AST → typed IR (intermediate
representation) │ │ │ │ │ │ │ │ │ │ │ │ │ ▼ │ │ │ │ │ │ ④ effect-checker.ts →
pure/impure effect inference + constraint solving │ │ │ │ │ │ │ (effect-types,
effect-infer, effect-env, effect-lattice, │ │ │ │ │ │ │ effect-receiver,
effect-signatures, effect-errors) │ │ │ │ │ │ ▼ │ │ │ │ │ │ ⑤
syntax-transformer.ts → desugar, apply syntax handlers │ │ │ │ │ │ │ (function,
class, binding, conditional, loop-recur, │ │ │ │ │ │ │ data-structure,
js-interop, import-export, enum, │ │ │ │ │ │ │ quote, get, primitive,
match/pattern-matching) │ │ │ │ │ │ ▼ │ │ │ │ │ │ ⑥ js-code-generator.ts → IR →
JavaScript source │ │ │ │ │ │ │ + tco-optimizer (self + mutual recursion → while
loops / trampolines) │ │ │ │ │ │ │ + source-map-chain (position tracking through
all stages) │ │ │ │ │ │ ▼ │ │ │ │ │ │ ⑦ ts-compiler.ts → optional TypeScript
emit + type checking │ │ │ │ │ │ │ │ │ │ │ │ │ ▼ │ │ │ │ │ │ output.js +
output.js.map (Source Map V3 compliant) │ │ │ │ │
└────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ │ │ │ │ ┌─ Language Features
──────────────────────────────────────────────────────────────┐ │ │ │ │ │
Functions (fn, async fn, fn*, arrow) │ Pattern matching (match/case/guards) │ │
│ │ │ │ Classes (full: inherit, private, get) │ Macros (compile-time, hygienic,
gensym) │ │ │ │ │ │ Destructuring (array, object) │ Threading (-> ->> as->) │ │
│ │ │ │ Lazy sequences (Clojure-style) │ Tail-call optimization (auto) │ │ │ │ │
│ TypeScript type annotations │ Generators, async generators │ │ │ │ │ │ Full JS
interop (js-call/get/set/new) │ BigInt, template literals │ │ │ │ │
└────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ │ │ │ │ ┌─ Stdlib (96% self-hosted in HQL)
────────────────────────────────────────────────┐ │ │ │ │ │ 107 functions + 15
aliases │ │ │ │ │ │ Core: first, rest, cons, seq, lazySeq, range │ │ │ │ │ │
Seqs: map, filter, reduce, take, drop, concat, flatten, distinct, partition... │
│ │ │ │ │ Higher: mapIndexed, mapcat, keep, takeWhile, dropWhile, groupBy,
interpose... │ │ │ │ │ │ Predicates: isEmpty, some, every, isNil, isEven, isOdd,
isZero... │ │ │ │ │ │ Math: inc, dec, abs, add, sub, mul, div, mod, eq, neq, lt,
gt... │ │ │ │ │ │ Transducers: xf versions of
map/filter/take/drop/partition/dedupe... │ │ │ │ │ │ AI (REPL only): ask,
generate, chat, summarize, example, format, print, model │ │ │ │ │
└────────────────────────────────────────────────────────────────────────────────────┘
│ │ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ ┌────────────────────────── SHARED INFRASTRUCTURE
─────────────────────────────────────────┐ │ │ │ │ │ │ │ ┌─ Providers
───────────┐ ┌─ Platform ────────────┐ ┌─ Store ──────────────────┐ │ │ │ │ │
registry.ts (SSOT) │ │ getPlatform() │ │ db.ts (SQLite) │ │ │ │ │ │
cloud-provider.ts │ │ ├── fs.read/write/... │ │ schema.ts │ │ │ │ │ │ ├──
ollama/ │ │ ├── env │ │ conversation-store.ts │ │ │ │ │ │ ├── openai/ │ │ ├──
cwd() │ │ sse-store.ts │ │ │ │ │ │ ├── anthropic/ │ │ └── exit() │ │
message-utils.ts │ │ │ │ │ │ ├── google/ │ │ │ └────────────────────────┘ │ │ │
│ │ └── claude-code/ │ │ deno-platform.ts │ │ │ │ │ └───────────────────────┘ │
node-platform.ts │ ┌─ Memory ─────────────────┐ │ │ │ │
└───────────────────────┘ │ manager.ts (load ctx) │ │ │ │ │ ┌─ Common
──────────────┐ ┌─ API (globalThis) ────┐ │ store.ts (MEMORY.md+log) │ │ │ │ │ │
config/ │ │ ai (ask/generate/chat) │ │ indexer.ts (chunk+hash) │ │ │ │ │ │
paths.ts │ │ config (get/set/all) │ │ search.ts (FTS5+BM25) │ │ │ │ │ │
http-client.ts │ │ memory (list/get/find) │ │ tools.ts (write/search) │ │ │ │ │
│ token-utils.ts │ │ session (CRUD) │ └────────────────────────┘ │ │ │ │ │
rate-limiter.ts │ │ history (list/get) │ │ │ │ │ │ retry.ts │ │ log
(info/warn/error) │ ┌─ MCP ────────────────────┐ │ │ │ │ │ timeout-utils.ts │ │
runtime (eval/abort) │ │ sdk-client.ts (SDK v1.12)│ │ │ │ │ │ safe-stringify.ts
│ │ errors (constructors) │ │ config.ts (server defs) │ │ │ │ │ │ ...20+ more
utils │ └────────────────────────┘ │ tools.ts (tool wrapping) │ │ │ │ │
└───────────────────────┘ │ oauth.ts (credentials) │ │ │ │ │
└────────────────────────┘ │ │ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
│ │ │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ │ │ EXTERNAL CONNECTIONS │ │ │ │ ┌─ LLM Providers
─────────────────────────────────────────────────────────────────────────┐ │ │ │
│ │ │ │ 127.0.0.1:11439 ←── Ollama (HLVM-managed local runtime) │ │ │ │
api.openai.com ←── OpenAI (GPT-4, GPT-3.5) │ │ │ │ api.anthropic.com ←──
Anthropic (Claude) │ │ │ │ generativelanguage.googleapis.com ←── Google (Gemini)
│ │ │ │ Claude Code SDK ←── Claude Code (via SDK) │ │ │ │ │ │ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ ┌─ MCP Servers
────────────────────────────────────────────────────────────────────────────┐ │
│ │ Configured via .hlvm/mcp.json or CLI │ │ │ │ Transport: stdio |
streamable-http (with SSE fallback) │ │ │ │ Protocol: 2025-11-25 (with
2024-11-05 fallback) │ │ │ │ Capabilities: tools, resources, prompts,
elicitation, sampling, roots, progress │ │ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ ┌─ Module Ecosystem (THE FUTURE)
─────────────────────────────────────────────────────────┐ │ │ │ │ │ │ │ ┌─
Decentralized (HTTP URLs)
──────────────────────────────────────────────────────┐ │ │ │ │ │
https://gist.github.com/user/module.mjs ← any URL = valid module │ │ │ │ │ │
https://esm.sh/lodash-es ← entire npm ecosystem │ │ │ │ │ │
https://deno.land/x/mod.ts ← Deno ecosystem │ │ │ │ │ │
https://your-server.com/custom-tool.mjs ← self-hosted │ │ │ │ │ │
~/hlvm-modules/local-tool.mjs ← local files │ │ │ │ │ │ │ │ │ │ │ │ Deno
handles: fetch, cache, lock, versioning — zero infra needed │ │ │ │ │
└────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ │ │ │ │ ┌─ Curated Index (GitHub repo)
────────────────────────────────────────────────────┐ │ │ │ │ │
github.com/hlvm/modules/index.json │ │ │ │ │ │ ├── @hlvm/* (built-in, maintained
by you) → Tier 1: trusted │ │ │ │ │ │ ├── community submissions (PR-reviewed) →
Tier 2: vetted │ │ │ │ │ │ └── any HTTP URL (user-added, unreviewed) → Tier 3:
open web │ │ │ │ │
└────────────────────────────────────────────────────────────────────────────────────┘
│ │ │ │ │ │ │ │ ┌─ AI Forge
───────────────────────────────────────────────────────────────────────┐ │ │ │ │
│ (forge "describe what you need") │ │ │ │ │ │ → AI generates ESM module │ │ │ │
│ │ → saves to ~/hlvm-modules/ │ │ │ │ │ │ → immediately available in Launchpad,
equippable to Hotbar │ │ │ │ │ │ → sharable via URL │ │ │ │ │
└────────────────────────────────────────────────────────────────────────────────────┘
│ │ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
│ │ │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ │ │ DATA FLOW: MODULE EXECUTION — HOTBAR / LAUNCHPAD (THE CORE LOOP) │ │ (Same
execution path whether triggered from Hotbar shortcut or Launchpad click) │ │ │
│ User presses Ctrl+3 (Hotbar) or clicks module in Launchpad │ │ │ │ │ ▼ │ │
GUI: Hotbar reads slot 3 binding → { module: "git-standup", action: "standup" }
│ │ │ │ │ ▼ │ │ GUI → POST :11435/module/run { url: "~/modules/git-standup.mjs",
action: "standup" } │ │ │ ▲ │ │ ▼ │ NEW ENDPOINT │ │ Server: dynamic import(url)
→ cache module │ │ │ │ │ ▼ │ │ Server: inject ModuleContext { ai, shell,
clipboard, fs, fetch, notify, eval } │ │ │ │ │ ▼ │ │ Server:
module.standup(context) │ │ │ │ │ ├──→ context.shell("git log --since=yesterday
...") → git history │ │ ├──→ context.ai.ask("summarize:\n" + history) → AI
summary │ │ └──→ context.clipboard.set(summary) → result to clipboard │ │ │ │ │
▼ │ │ Server → { result: "Here's your standup...", success: true } │ │ │ │ │ ▼ │
│ GUI: show notification / update hotbar indicator / paste to frontmost app │ │
│ │ Total time: ~2-3 seconds. One keypress. No context switch. │ │ │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ │ │ DATA FLOW: SPOTLIGHT REPL EVAL (THE POWER USER LOOP) │ │ │ │ User hits
global hotkey (e.g. Cmd+Space) │ │ │ │ │ ▼ │ │ Spotlight Panel appears (NSPanel,
floating above all windows) │ │ │ │ │ ▼ │ │ User types: (-> (clipboard)
json-parse (get "users") (filter #(> (:age %) 18)) (map :name)) │ │ │ │ │ ▼ │ │
GUI → POST :11435/api/chat { mode: "eval", messages: [{ role: "user", content:
"(-> (clipboard) ...)" }] } │ │ │ │ │ ▼ │ │ Server: analyzeExpression() → starts
with "(" → HQL mode │ │ │ │ │ ▼ │ │ HQL Transpiler: parse → validate → AST→IR →
effects → transform → codegen │ │ │ │ │ ▼ │ │ JS Eval: execute generated
JavaScript in REPL context (globalThis persists) │ │ │ │ │ ▼ │ │ Server → {
success: true, value: "[\"Alice\", \"Charlie\", \"Eve\"]", logs: [] } │ │ │ │ │
▼ │ │ GUI: display result inline in Spotlight panel │ │ │ │ │ ▼ │ │ User can:
copy result, pipe into next expression, save as defn, or dismiss │ │ │ │ State
persists. Next expression can reference previous results. │ │ (defn my-filter
...) survives across sessions. │ │ │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ │ │ THE INTEGRATION MAP: What Connects to What │ │ │ │ ┌──────────────┐ │ │ │
USER │ │ │ └──────┬───────┘ │ │ │ │ │ ┌─────────────┼──────────────┐ │ │ │ │ │ │
│ ▼ ▼ ▼ │ │ ┌──────────┐ ┌────────────┐ ┌──────────┐ │ │ │ Spotlight │ │ Hotbar
│ │ Chat │ │ │ │ (REPL) │ │ (1-press) │ │ (Agent) │ │ │ └────┬─────┘
└─────┬──────┘ └────┬─────┘ │ │ │ │ │ │ │ │ /api/chat │ /module/run │ /api/chat
│ │ │ │ │ │ │ ▼ ▼ ▼ │ │ ┌─────────────────────────────────────────┐ │ │ │ hlvm
serve (:11435) │ │ │ │ │ │ │ │ ┌─────────┐ ┌──────────┐ ┌──────────┐ │ │ │ │ │
HQL │ │ Module │ │ Agent │ │ │ │ │ │ Eval │ │ Runtime │ │ ReAct │ │ │ │ │ │
Engine │ │ (import+ │ │ Loop │ │ │ │ │ │ │ │ context) │ │ │ │ │ │ │ └────┬────┘
└────┬─────┘ └────┬─────┘ │ │ │ │ │ │ │ │ │ │ │ └───────────┼────────────┘ │ │ │
│ │ │ │ │ │ ▼ │ │ │ │ ┌─────────────────────────────────┐ │ │ │ │ │ Shared
Runtime Layer │ │ │ │ │ │ │ │ │ │ │ │ globalThis.ai ← AI provider │ │ │ │ │ │
globalThis.config │ │ │ │ │ │ REPL state (persistent defs) │ │ │ │ │ │ Module
cache (imported ESMs) │ │ │ │ │ │ Memory (SQLite FTS5) │ │ │ │ │ │ Session store
(SQLite) │ │ │ │ │ └─────────────┬───────────────────┘ │ │ │ │ │ │ │ │
└────────────────┼────────────────────────┘ │ │ │ │ │ ┌───────────┼───────────┐
│ │ │ │ │ │ │ ▼ ▼ ▼ │ │ ┌──────────┐ ┌─────────┐ ┌──────────┐ │ │ │ Ollama │ │
Cloud │ │ MCP │ │ │ │ (local) │ │Providers│ │ Servers │ │ │ │ :11439 │ │ (APIs)
│ │ (stdio/ │ │ │ │ │ │ │ │ http) │ │ │ └──────────┘ └─────────┘ └──────────┘ │
│ │ │ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Module Ecosystem (decentralized HTTP + curated GitHub index) │ │ │ │ Any URL
→ import() → inject context → execute → return result │ │ │
└─────────────────────────────────────────────────────────────────────┘ │ │ │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

What this diagram shows about your vision:

The four surfaces — Spotlight (REPL), Launchpad (all installed modules), Hotbar
(pinned subset), Chat (agent) — are not four separate products. They're four
windows into the same runtime. They share globalThis.ai, the same REPL state,
the same module cache, the same memory. A defn written in Spotlight is callable
from a Launchpad/Hotbar module. An AI call in a module uses the same provider as
the Chat agent. Everything is one connected system.

That's the iPhone insight — not four features bolted together, but one unified
runtime with three access patterns optimized for different moments: think
(REPL), act (Launchpad/Hotbar), ask (Agent).

✻ Cooked for 5m 33s

❯ focus on how they communicate - and different multple angle, draw pipeline and
architectue of how two system co-work together - specifying all\
details as well - in ASCII visual

⏺
╔══════════════════════════════════════════════════════════════════════════════════════╗
║ ║ ║ ANGLE 1: PROCESS LIFECYCLE — How GUI Spawns and Manages the Server ║ ║ ║
╚══════════════════════════════════════════════════════════════════════════════════════╝

    macOS Boot
       │
       ▼
    HLVM.app launches (menu bar accessory, .accessory activation policy)
       │
       ▼
    AppDelegate.swift → DefaultDependencyProvider.bootstrap()
       │  Wires all dependencies via constructor injection
       │  NO server started yet (lazy)
       │
       ▼
    Menu bar: 🔥 icon appears. App is idle. Zero CPU.
       │
       │  User triggers first interaction:
       │  - Opens Spotlight panel (global hotkey)
       │  - Opens Chat window
       │  - Clicks menu bar icon
       │
       ▼
    ReplServerManager.startServer()
       │
       ├──① Probe localhost:11435
       │     TCP connect to 127.0.0.1:11435
       │
       │     if port is already occupied:
       │       throw runtimeConflict
       │       show a clear GUI alert
       │       do not kill the foreign process
       │       do not start a second hlvm host
       │
       ├──② Generate auth token
       │     let authToken = UUID().uuidString    // e.g. "A1B2C3D4-..."
       │
       ├──③ Spawn server process
       │     Binary: Bundle.main.path(forResource: "hlvm", ofType: nil)
       │             → /Applications/HLVM.app/Contents/Resources/hlvm
       │
       │     Process() {
       │       executableURL = hlvmBinaryPath
       │       arguments    = ["serve"]
       │       environment  = {
       │         "HLVM_REPL_PORT": "11435",
       │         "HLVM_AUTH_TOKEN": authToken,    // shared secret
       │         "HOME": NSHomeDirectory(),
       │         "PATH": "/usr/local/bin:/usr/bin:/bin:..."
       │       }
       │       standardOutput = FileHandle.nullDevice    // suppress stdout
       │       standardError  = FileHandle.nullDevice    // suppress stderr
       │     }
       │     process.launch()
       │
       ├──④ Register crash handler
       │     process.terminationHandler = { [weak self] proc in
       │       if proc.terminationStatus != 0 {
       │         NotificationCenter.post("hlvmServerCrashed",
       │                                 exitCode: proc.terminationStatus)
       │         // GUI shows error indicator, can auto-restart
       │       }
       │     }
       │
       └──⑤ Health check loop (bounded retry)
             │
             │  Attempt 1:  GET http://127.0.0.1:11435/health  (wait 50ms)
             │  Attempt 2:  GET http://127.0.0.1:11435/health  (wait 100ms)
             │  Attempt 3:  GET http://127.0.0.1:11435/health  (wait 150ms)
             │  ...
             │  Attempt 10: GET http://127.0.0.1:11435/health  (wait 500ms)
             │  Total max wait: ~2 seconds
             │
             ▼
          Response: { "status": "ok", "initialized": true, "authToken": "A1B2C3D4-..." }
             │
             ▼
          Server is READY. Store auth token. Begin normal operations.


    ┌─ Server Process (Deno) ──────────────────────────────────────┐
    │                                                               │
    │  cli.ts → main() → serve command detected                    │
    │     │                                                         │
    │     ▼                                                         │
    │  serve.ts → startServer()                                     │
    │     │                                                         │
    │     ├── Read HLVM_REPL_PORT (default 11435)                   │
    │     ├── Read HLVM_AUTH_TOKEN                                  │
    │     ├── Initialize AI runtime (runtimeReady promise)          │
    │     │     ├── Load config from ~/.hlvm/settings.json           │
    │     │     ├── Detect available providers                      │
    │     │     ├── Register tools (TOOL_REGISTRY + DYNAMIC)        │
    │     │     ├── Load MCP servers (from .hlvm/mcp.json)          │
    │     │     └── Register globalThis APIs (ai, config, memory)   │
    │     │                                                         │
    │     ├── Initialize REPL state (evaluator, module cache)       │
    │     ├── Initialize DB (SQLite for sessions, messages)         │
    │     │                                                         │
    │     └── Deno.serve({                                          │
    │           port: 11435,                                        │
    │           hostname: "127.0.0.1",                              │
    │           handler: httpHandler                                │
    │         })                                                    │
    │                                                               │
    │  httpHandler pipeline:                                        │
    │     request → corsCheck → sizeCheck → authCheck → router      │
    │                                                               │
    └───────────────────────────────────────────────────────────────┘


    App Shutdown:
       │
       ├── ReplServerManager.stopServer()
       │     process.terminate()    // SIGTERM
       │     Wait for terminationHandler callback
       │
       └── Clean exit

╔══════════════════════════════════════════════════════════════════════════════════════╗
║ ║ ║ ANGLE 2: HTTP PROTOCOL LAYER — Request/Response Anatomy ║ ║ ║
╚══════════════════════════════════════════════════════════════════════════════════════╝

    Every request from GUI to server follows this pattern:

    ┌─ GUI (Swift) ─────────────────────────────────────────────────────────────────┐
    │                                                                               │
    │  HttpManager.request(endpoint, method, body)                                  │
    │     │                                                                         │
    │     ├── Build URL: "http://127.0.0.1:11435" + endpoint.path                  │
    │     │                                                                         │
    │     ├── Set headers:                                                          │
    │     │     Authorization: Bearer A1B2C3D4-E5F6-...                            │
    │     │     Content-Type: application/json                                      │
    │     │     X-Request-ID: <UUID> (for chat requests, cancellation tracking)     │
    │     │     Last-Event-ID: <id> (for SSE reconnection)                          │
    │     │                                                                         │
    │     ├── Encode body: JSONEncoder (thread-local codec pool, yyjson backend)    │
    │     │                                                                         │
    │     └── URLSession.data(for: request) or .bytes(for: request)                │
    │                                                                               │
    └───────────────────────────────────┬───────────────────────────────────────────┘
                                        │
                                        │  TCP localhost:11435
                                        │
    ┌───────────────────────────────────▼───────────────────────────────────────────┐
    │  Server (Deno) — http-server.ts                                               │
    │                                                                               │
    │  ① CORS preflight                                                             │
    │     OPTIONS → 204 (Access-Control-Allow-Origin: http://localhost:*)            │
    │                                                                               │
    │  ② Size guard                                                                 │
    │     Content-Length > 1,000,000 → 413 Payload Too Large                        │
    │                                                                               │
    │  ③ Auth check                                                                 │
    │     Skip: GET /health, OPTIONS                                                │
    │     Check: Authorization header matches HLVM_AUTH_TOKEN                       │
    │     Fail → 401 { "error": "Unauthorized" }                                   │
    │                                                                               │
    │  ④ Route matching (http-router.ts)                                            │
    │     Pattern matching with path params:                                        │
    │     "/api/chat/messages/:messageId" → { id, messageId }              │
    │     Method + path → handler function                                          │
    │                                                                               │
    │  ⑤ Handler execution → Response                                               │
    │                                                                               │
    └───────────────────────────────────────────────────────────────────────────────┘


    Three response patterns:

    ┌─ Pattern A: JSON (simple request/response) ───────────────────────────────────┐
    │                                                                               │
    │  GUI                              Server                                      │
    │   │                                │                                          │
    │   │── GET /api/chat/messages ────▶│                                          │
    │   │                                │── resolve active hidden session          │
    │   │◀── 200 ───────────────────────│                                          │
    │   │   { "messages": [...], ... }   │                                          │
    │   │                                │                                          │
    │  Used by: active conversation messages, config get/patch,                    │
    │           models list, eval, completions, cancel, interaction                 │
    │                                                                               │
    └───────────────────────────────────────────────────────────────────────────────┘

    ┌─ Pattern B: NDJSON Stream (long-running operations) ──────────────────────────┐
    │                                                                               │
    │  GUI                              Server                                      │
    │   │                                │                                          │
    │   │── POST /api/chat ────────────▶│                                          │
    │   │   Content-Type: application/json                                          │
    │   │   X-Request-ID: req-456        │                                          │
    │   │   {                            │                                          │
    │   │     "mode": "agent",           │                                          │
    │   │     "messages": [...],         │                                          │
    │   │     "stateless": false         │                                          │
    │   │   }                            │                                          │
    │   │                                │                                          │
    │   │◀── 200 ───────────────────────│                                          │
    │   │   Content-Type: application/x-ndjson                                      │
    │   │   Cache-Control: no-cache                                                 │
    │   │   Connection: keep-alive                                                  │
    │   │   X-Request-ID: req-456        │                                          │
    │   │                                │                                          │
    │   │◀─ {"event":"start","request_id":"req-456"}\n                             │
    │   │◀─ {"event":"token","text":"I'll"}\n                                      │
    │   │◀─ {"event":"tool_start","name":"search_code",...}\n                      │
    │   │◀─ {"event":"tool_end","name":"search_code","success":true,...}\n         │
    │   │◀─ {"event":"complete","session_version":2}\n                             │
    │   │                                │                                          │
    │   │   [connection closes]          │                                          │
    │   │                                │                                          │
    │  GUI parsing (StreamLineDelegate):                                            │
    │   URLSessionDataDelegate accumulates bytes                                    │
    │   Split on 0x0A (\n) → each line = one JSON object                           │
    │   yyjson parse → HqlChatEvent enum → dispatch to UI                          │
    │                                                                               │
    │  Used by: /api/chat, /api/models/pull                                        │
    │                                                                               │
    └───────────────────────────────────────────────────────────────────────────────┘

    ┌─ Pattern C: SSE Stream (real-time push, long-lived connection) ───────────────┐
    │                                                                               │
    │  GUI                              Server                                      │
    │   │                                │                                          │
    │   │── GET /api/chat/stream ──────▶│                                          │
    │   │   Accept: text/event-stream    │                                          │
    │   │                                │                                          │
    │   │◀── 200 ───────────────────────│                                          │
    │   │   Content-Type: text/event-stream                                         │
    │   │   Cache-Control: no-cache                                                 │
    │   │   Connection: keep-alive                                                  │
    │   │                                │                                          │
    │   │◀─ retry: 3000\n\n             │  ← reconnection interval                 │
    │   │◀─ id: 1\n                      │                                          │
    │   │   event: snapshot\n            │  ← initial active transcript            │
    │   │   data: {"messages":[...]}\n\n │                                          │
    │   │◀─ id: 2\n                      │                                          │
    │   │   event: message_added\n       │  ← delta for another client/tool        │
    │   │   data: {"message_id":"x"}\n\n │                                          │
    │   │◀─ : heartbeat\n\n             │  ← every 30 seconds (SSE comment)        │
    │   │                                │                                          │
    │  On disconnect:                                                               │
    │   GUI auto-reconnects with Last-Event-ID: 2                                  │
    │   Server replays missed events since id 2                                    │
    │                                                                               │
    │  Used by: /api/chat/stream, /api/models/stream, /api/config/stream           │
    │                                                                               │
    └───────────────────────────────────────────────────────────────────────────────┘

╔══════════════════════════════════════════════════════════════════════════════════════╗
║ ║ ║ ANGLE 3: CHAT PIPELINE — Full Depth, Every Layer ║ ║ ║
╚══════════════════════════════════════════════════════════════════════════════════════╝

    User types "fix the auth bug" in Chat window and presses Enter

    ┌─ GUI Layer ───────────────────────────────────────────────────────────────────┐
    │                                                                               │
    │  ReplLogView (SwiftUI)                                                        │
    │     │                                                                         │
    │     ▼                                                                         │
    │  ReplLogViewModel.sendMessage(text)                                           │
    │     │                                                                         │
    │     ├── Generate client_turn_id = UUID()                                      │
    │     ├── Append user message to local message store                            │
    │     ├── Update UI immediately (optimistic)                                    │
    │     │                                                                         │
    │     ▼                                                                         │
    │  ReplChatController.streamChat(messages, sessionId, mode)                     │
    │     │                                                                         │
    │     ▼                                                                         │
    │  HqlChatClient.streamChat(request: HqlChatRequest)                            │
    │     │                                                                         │
    │     ├── request = HqlChatRequest {                                            │
    │     │     mode: "agent",                  // or "chat" or "claude-code-agent" │
    │     │     messages: [                                                         │
    │     │       { role: "system", content: "You are...", client_turn_id: nil },   │
    │     │       { role: "user",   content: "fix the auth bug",                    │
    │     │                         client_turn_id: "turn-789",                     │
    │     │                         attachment_ids: nil }                           │
    │     │     ],                                                                  │
    │     │     model: nil,           // use server default                         │
    │     │     temperature: nil,     // use server default                         │
    │     │     max_tokens: nil,      // use server default                         │
    │     │     assistant_client_turn_id: "turn-790"  // for the response           │
    │     │   }                                                                     │
    │     │                                                                         │
    │     ├── Build URLRequest:                                                     │
    │     │     POST http://127.0.0.1:11435/api/chat                               │
    │     │     Authorization: Bearer A1B2C3D4-...                                  │
    │     │     Content-Type: application/json                                      │
    │     │     X-Request-ID: req-456                                               │
    │     │                                                                         │
    │     └── Start streaming via StreamLineDelegate                                │
    │           URLSession.dataTask(with: request)                                  │
    │           delegate accumulates bytes, splits on \n                            │
    │                                                                               │
    └────────────────────────────────┬──────────────────────────────────────────────┘
                                     │
                                     │  HTTP POST, NDJSON response
                                     │
    ┌────────────────────────────────▼──────────────────────────────────────────────┐
    │  Server: http-server.ts → router → handlers/chat.ts                          │
    │                                                                               │
    │  handleChat(req)                                                              │
    │     │                                                                         │
    │     ├── Parse body → ChatRequest                                              │
    │     ├── Validate: mode and messages required                                  │
    │     ├── Ignore deprecated public session_id if present                        │
    │     ├── Extract X-Request-ID (or generate)                                    │
    │     ├── Check: mode == "agent" → model must support tools                     │
    │     │          if not → 400 "Model does not support tool calling"             │
    │     ├── Check: provider approved? (cloud providers need terminal approval)    │
    │     │          if not → 403 "Run hlvm ask --model X in terminal first"        │
    │     ├── Check: session_version conflict?                                      │
    │     │          if expected_version != current → 409 Conflict                  │
    │     │                                                                         │
    │     ├── await runtimeReady   // ensure AI runtime initialized                 │
    │     │                                                                         │
    │     ├── Register request for cancellation tracking                            │
    │     │   requestMap.set(req-456, { abortController, sessionId })              │
    │     │                                                                         │
    │     └── Return streaming Response:                                            │
    │           new Response(readableStream, {                                      │
    │             headers: {                                                        │
    │               "Content-Type": "application/x-ndjson",                         │
    │               "Cache-Control": "no-cache",                                    │
    │               "Connection": "keep-alive",                                     │
    │               "X-Request-ID": "req-456"                                      │
    │             }                                                                 │
    │           })                                                                  │
    │                                                                               │
    │  Inside readableStream (chat-agent-mode.ts):                                  │
    │     │                                                                         │
    │     ▼                                                                         │
    │  ┌─ Agent Mode Pipeline ──────────────────────────────────────────────────┐   │
    │  │                                                                        │   │
    │  │  ① emit("start", { request_id: "req-456" })                           │   │
    │  │                                                                        │   │
    │  │  ② Get or create cached AgentSession                                   │   │
    │  │     agent-runner.ts → getOrCreateCachedSession()                       │   │
    │  │     │                                                                  │   │
    │  │     ├── Key: session_id + model                                        │   │
    │  │     ├── Cache hit? → reuseSession() (refresh memory, skip stale)       │   │
    │  │     ├── Cache miss? → createAgentSession()                             │   │
    │  │     │     ├── resolveEngine() (legacy or SDK based on env var)         │   │
    │  │     │     ├── engine.createLLM(model, config)                          │   │
    │  │     │     ├── resolveContextBudget(model) → token budget               │   │
    │  │     │     ├── loadMemoryContext(budget) → memory system msg            │   │
    │  │     │     ├── detectGitContext() → branch, dirty (3s timeout)          │   │
    │  │     │     ├── ensureMcpLoaded() → load MCP tools                      │   │
    │  │     │     └── classifyModelTier(model) → weak|mid|frontier             │   │
    │  │     │                                                                  │   │
    │  │     └── session: { engine, llm, modelTier, context, mcp }              │   │
    │  │                                                                        │   │
    │  │  ③ Build system prompt                                                 │   │
    │  │     llm-integration.ts → generateSystemPrompt(session)                │   │
    │  │     │                                                                  │   │
    │  │     ├── renderIdentity()          → "You are HLVM..."                 │   │
    │  │     ├── renderEnvironment()       → cwd, OS, model, git branch        │   │
    │  │     ├── renderToolRouting()       → auto-generated from metadata      │   │
    │  │     ├── renderPermissions()       → safety tiers                      │   │
    │  │     ├── renderConciseness()       → "Be concise..."                   │   │
    │  │     ├── renderWebSafety()         → "Never fabricate URLs..."         │   │
    │  │     ├── renderFileEditing()       → (mid+frontier only)               │   │
    │  │     ├── renderCodeQuality()       → (mid+frontier only)               │   │
    │  │     ├── renderThinkingProtocol()  → (frontier only)                   │   │
    │  │     └── renderExamples()          → (weak+mid only)                   │   │
    │  │                                                                        │   │
    │  │  ④ Build tool definitions                                              │   │
    │  │     llm-integration.ts → buildToolDefinitions(session)                │   │
    │  │     → JSON Schema for each tool in registry                           │   │
    │  │     → Filtered by model tier (weak → core tools only)                 │   │
    │  │                                                                        │   │
    │  │  ⑤ Load history                                                        │   │
    │  │     conversation-store.ts → getMessages(session_id)                   │   │
    │  │     → Previous turns from SQLite                                      │   │
    │  │                                                                        │   │
    │  │  ⑥ Enter ReAct loop                                                    │   │
    │  │     orchestrator.ts → runReActLoop(session, messages, callbacks)       │   │
    │  │     │                                                                  │   │
    │  │     │  ┌─ ITERATION 1 ──────────────────────────────────────────┐     │   │
    │  │     │  │                                                        │     │   │
    │  │     │  │  orchestrator-llm.ts → callLLM()                       │     │   │
    │  │     │  │     messages: [system, ...history, user]               │     │   │
    │  │     │  │     tools: [search_code, read_file, edit_file, ...]    │     │   │
    │  │     │  │     │                                                  │     │   │
    │  │     │  │     ▼                                                  │     │   │
    │  │     │  │  LLM Provider (e.g., Ollama 127.0.0.1:11439)  │     │   │
    │  │     │  │     │                                                  │     │   │
    │  │     │  │     ▼ streaming tokens                                 │     │   │
    │  │     │  │  onToken callback → emit("token", { text }) ──────────│──▶ GUI│ │
    │  │     │  │     │                                                  │     │   │
    │  │     │  │     ▼ tool_call detected                               │     │   │
    │  │     │  │  orchestrator-response.ts → classify as TOOL_CALL      │     │   │
    │  │     │  │     tool: "search_code", args: { query: "auth" }       │     │   │
    │  │     │  │                                                        │     │   │
    │  │     │  │  emit("tool_start", { name, args_summary }) ──────────│──▶ GUI│ │
    │  │     │  │                                                        │     │   │
    │  │     │  │  ┌─ Permission Check ─────────────────────────────┐   │     │   │
    │  │     │  │  │  policy.ts → checkToolPermission()              │   │     │   │
    │  │     │  │  │  │                                              │   │     │   │
    │  │     │  │  │  ├── Always allowed? (read_file, list_files)    │   │     │   │
    │  │     │  │  │  │   → proceed                                  │   │     │   │
    │  │     │  │  │  │                                              │   │     │   │
    │  │     │  │  │  ├── Needs approval? (shell_exec, write_file)   │   │     │   │
    │  │     │  │  │  │   → emit("interaction_request", {            │   │     │   │
    │  │     │  │  │  │       request_id: "int-789",                 │   │     │   │
    │  │     │  │  │  │       mode: "permission",                    │   │     │   │
    │  │     │  │  │  │       tool_name: "shell_exec",               │   │     │   │
    │  │     │  │  │  │       tool_args: "rm -rf node_modules"       │   │     │   │
    │  │     │  │  │  │     }) ──────────────────────────────────────│──▶ GUI│ │
    │  │     │  │  │  │                                              │   │     │   │
    │  │     │  │  │  │   GUI shows InteractionBubble:               │   │     │   │
    │  │     │  │  │  │   [Allow] [Deny] [Always Allow]              │   │     │   │
    │  │     │  │  │  │                                              │   │     │   │
    │  │     │  │  │  │   User clicks [Allow] →                      │   │     │   │
    │  │     │  │  │  │   POST /api/chat/interaction                 │   │     │   │
    │  │     │  │  │  │   { request_id: "int-789", approved: true }  │   │     │   │
    │  │     │  │  │  │   → server unblocks, continues               │   │     │   │
    │  │     │  │  │  │                                              │   │     │   │
    │  │     │  │  │  └── Denied? → tool returns error to LLM        │   │     │   │
    │  │     │  │  └─────────────────────────────────────────────────┘   │     │   │
    │  │     │  │                                                        │     │   │
    │  │     │  │  orchestrator-tool-execution.ts → executeTool()        │     │   │
    │  │     │  │     search_code({ query: "auth" })                     │     │   │
    │  │     │  │     → ripgrep search → results                         │     │   │
    │  │     │  │                                                        │     │   │
    │  │     │  │  emit("tool_end", { name, success, content,           │     │   │
    │  │     │  │                     duration_ms }) ────────────────────│──▶ GUI│ │
    │  │     │  │                                                        │     │   │
    │  │     │  │  orchestrator-tool-formatting.ts → formatResult()      │     │   │
    │  │     │  │     → truncate if > budget, add to messages            │     │   │
    │  │     │  │                                                        │     │   │
    │  │     │  │  orchestrator-state.ts → iteration++, trackUsage()     │     │   │
    │  │     │  │                                                        │     │   │
    │  │     │  │  maybeInjectReminder() → mid-conversation hints        │     │   │
    │  │     │  │     (web safety every turn, tool routing for weak)      │     │   │
    │  │     │  │                                                        │     │   │
    │  │     │  └────────────────────────────────────────────────────────┘     │   │
    │  │     │                                                                  │   │
    │  │     │  ┌─ ITERATION 2 ──────────────────────────────────────────┐     │   │
    │  │     │  │  (same pattern: LLM call → classify → execute → emit)  │     │   │
    │  │     │  │  ...                                                    │     │   │
    │  │     │  │  LLM returns TEXT (no more tool calls)                  │     │   │
    │  │     │  │  → orchestrator-response.ts classifies as FINAL        │     │   │
    │  │     │  └────────────────────────────────────────────────────────┘     │   │
    │  │     │                                                                  │   │
    │  │  ⑦ emit("turn_stats", { tool_count: 2, duration_ms: 5200 })          │   │
    │  │                                                                        │   │
    │  │  ⑧ Save messages to SQLite (conversation-store.ts)                     │   │
    │  │     INSERT user message + assistant message + tool results             │   │
    │  │     UPDATE session version                                             │   │
    │  │                                                                        │   │
    │  │  ⑨ emit("complete", { session_version: 3 })                           │   │
    │  │                                                                        │   │
    │  │  ⑩ Close stream                                                        │   │
    │  └────────────────────────────────────────────────────────────────────────┘   │
    │                                                                               │
    └───────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │  NDJSON lines flow back
                                     │
    ┌────────────────────────────────▼──────────────────────────────────────────────┐
    │  GUI: Event Dispatch                                                          │
    │                                                                               │
    │  StreamLineDelegate → line bytes → yyjson parse → HqlChatEvent               │
    │                                                                               │
    │  switch event {                                                               │
    │    case .start(requestId):                                                    │
    │      → store requestId for cancel button                                      │
    │      → show SiriIcon animation                                                │
    │                                                                               │
    │    case .token(text):                                                         │
    │      → append to assistant message bubble (streaming)                         │
    │      → MarkdownView re-renders incrementally                                  │
    │      → SiriIcon continues animating                                           │
    │                                                                               │
    │    case .toolStart(name, argsSummary):                                        │
    │      → ActivityPanel: add row with spinner ● tool_name (running)              │
    │      → ThinkingBubble: show ● ● ●                                            │
    │                                                                               │
    │    case .toolEnd(name, success, content, durationMs):                         │
    │      → ActivityPanel: update row ⚡ tool_name (1.2s)                          │
    │      → ThinkingBubble: hide                                                   │
    │                                                                               │
    │    case .interactionRequest(requestId, mode, toolName, toolArgs, question):   │
    │      → InteractionBubble: show modal                                          │
    │        mode == "permission":                                                  │
    │          "Allow shell_exec: rm -rf node_modules?"                             │
    │          [Allow] [Deny] [Always Allow]                                        │
    │        mode == "question":                                                    │
    │          "Which database should I use?"                                       │
    │          [text field] [Submit]                                                │
    │      → User response → POST /api/chat/interaction                            │
    │                                                                               │
    │    case .turnStats(toolCount, durationMs):                                    │
    │      → ActivityPanel: show summary line                                       │
    │                                                                               │
    │    case .complete(sessionVersion):                                            │
    │      → Stop SiriIcon animation                                                │
    │      → Update local session_version (for optimistic locking)                  │
    │      → Save to ChatSessionStore                                               │
    │                                                                               │
    │    case .error(message):                                                      │
    │      → Show error in chat bubble (red)                                        │
    │      → Stop animations                                                        │
    │                                                                               │
    │    case .cancelled(requestId, partialText):                                   │
    │      → Show partial text with "(cancelled)" marker                            │
    │      → Stop animations                                                        │
    │  }                                                                            │
    │                                                                               │
    └───────────────────────────────────────────────────────────────────────────────┘

╔══════════════════════════════════════════════════════════════════════════════════════╗
║ ║ ║ ANGLE 4: EVAL PIPELINE — HQL Expression from Spotlight ║ ║ ║
╚══════════════════════════════════════════════════════════════════════════════════════╝

    User types in Spotlight: (map inc (range 5))

    ┌─ GUI ────────────────────────────────────────────────────────────────────────┐
    │                                                                              │
    │  SpotlightView → detect eval mode (input starts with "(")                   │
    │     │                                                                        │
    │     ▼                                                                        │
    │  ApiManager.submit(mode: .eval, prompt: "(map inc (range 5))", ...)          │
    │     │                                                                        │
    │     └── POST http://127.0.0.1:11435/api/chat                                │
    │         Body: { "mode": "eval", "messages": [{ "role": "user", "content": "(map inc (range 5))" }] } │
    │                                                                              │
    └──────────────────────────────────┬───────────────────────────────────────────┘
                                       │
    ┌──────────────────────────────────▼───────────────────────────────────────────┐
    │  Server: /api/chat handler (mode: eval)                                      │
    │                                                                              │
    │  evaluator.ts → analyzeExpression("(map inc (range 5))")                     │
    │     │                                                                        │
    │     ├── Starts with "(" → HQL mode                                          │
    │     │                                                                        │
    │     ▼                                                                        │
    │  HQL Transpiler Pipeline:                                                    │
    │     │                                                                        │
    │     ├── ① parser.ts: tokenize + parse                                       │
    │     │      "(map inc (range 5))"                                             │
    │     │      → AST: [Symbol("map"), Symbol("inc"), [Symbol("range"), 5]]       │
    │     │                                                                        │
    │     ├── ② semantic-validator.ts: resolve names                               │
    │     │      map → stdlib.map, inc → stdlib.inc, range → stdlib.range          │
    │     │                                                                        │
    │     ├── ③ hql-ast-to-hql-ir.ts: AST → IR                                   │
    │     │      CallExpression(map, [inc, CallExpression(range, [5])])            │
    │     │                                                                        │
    │     ├── ④ effect-checker.ts: pure (map, inc, range are all pure)            │
    │     │                                                                        │
    │     ├── ⑤ syntax-transformer.ts: no sugar to desugar                        │
    │     │                                                                        │
    │     ├── ⑥ js-code-generator.ts: IR → JS                                     │
    │     │      → "map(inc, range(5))"                                            │
    │     │                                                                        │
    │     └── ⑦ (no TS compilation needed for eval)                               │
    │                                                                              │
    │  js-eval.ts → execute in REPL context:                                       │
    │     │                                                                        │
    │     │  globalThis has: map, inc, range (from stdlib), plus any               │
    │     │  previous (defn ...) definitions from the session                      │
    │     │                                                                        │
    │     │  eval("map(inc, range(5))")                                            │
    │     │  → LazySeq [1, 2, 3, 4, 5]                                            │
    │     │  → realize + format → "[1, 2, 3, 4, 5]"                               │
    │     │                                                                        │
    │     └── Capture console.log output → logs array                              │
    │                                                                              │
    │  Response:                                                                   │
    │  {                                                                           │
    │    "success": true,                                                          │
    │    "value": "[1, 2, 3, 4, 5]",                                              │
    │    "logs": [],                                                               │
    │    "error": null                                                             │
    │  }                                                                           │
    │                                                                              │
    └──────────────────────────────────┬───────────────────────────────────────────┘
                                       │
    ┌──────────────────────────────────▼───────────────────────────────────────────┐
    │  GUI: Display result inline in Spotlight panel                               │
    │                                                                              │
    │  ┌──────────────────────────────────────────────────────────────────────┐    │
    │  │ 🔥 ▌(map inc (range 5))                                             │    │
    │  ├──────────────────────────────────────────────────────────────────────┤    │
    │  │ → [1, 2, 3, 4, 5]                                                   │    │
    │  └──────────────────────────────────────────────────────────────────────┘    │
    │                                                                              │
    │  State persists — next expression can reference previous results             │
    │  e.g. (def nums (range 5))  then later  (map inc nums)                      │
    │                                                                              │
    └──────────────────────────────────────────────────────────────────────────────┘

╔══════════════════════════════════════════════════════════════════════════════════════╗
║ ║ ║ ANGLE 5: STATE SYNCHRONIZATION — How GUI and Server Stay in Sync ║ ║ ║
╚══════════════════════════════════════════════════════════════════════════════════════╝

    The GUI maintains local state that must stay synchronized with server state.
    Four concurrent SSE connections handle this:

    ┌─ GUI ──────────────────────────────────────────────────────────────────────┐
    │                                                                            │
    │  ┌─ SSE Connection 1: Active Conversation ───────────────────────────┐    │
    │  │  GET /api/chat/stream                                             │    │
    │  │                                                                    │    │
    │  │  Server pushes:                                                    │    │
    │  │  ├── snapshot        → initial active transcript                   │    │
    │  │  ├── message_added   → new message (from agent or other client)    │    │
    │  │  ├── message_updated → edit (content change or cancellation)       │    │
    │  │  └── message_deleted → remove message                              │    │
    │  │                                                                    │    │
    │  │  GUI: ReplLogViewModel observes → updates chat bubbles             │    │
    │  └────────────────────────────────────────────────────────────────────┘    │
    │                                                                            │
    │  ┌─ SSE Connection 2: Model Changes ─────────────────────────────────┐    │
    │  │  GET /api/models/stream                                            │    │
    │  │                                                                    │    │
    │  │  Server pushes:                                                    │    │
    │  │  └── models_updated → reason: runtime_ready | pull_complete |      │    │
    │  │                               deleted | replay_gap                 │    │
    │  │                                                                    │    │
    │  │  GUI: LLMSelectorView refreshes model list                         │    │
    │  └────────────────────────────────────────────────────────────────────┘    │
    │                                                                            │
    │  ┌─ SSE Connection 3: Config Changes ────────────────────────────────┐    │
    │  │  GET /api/config/stream                                            │    │
    │  │                                                                    │    │
    │  │  Server pushes:                                                    │    │
    │  │  └── config_updated → full config object                           │    │
    │  │                                                                    │    │
    │  │  Server watches ~/.hlvm/settings.json for external changes          │    │
    │  │  (e.g., CLI user runs "hlvm config set model gpt-4")              │    │
    │  │  30-second heartbeat to keep connection alive                      │    │
    │  │                                                                    │    │
    │  │  GUI: SettingsManager updates cached config                        │    │
    │  └────────────────────────────────────────────────────────────────────┘    │
    │                                                                            │
    └────────────────────────────────────────────────────────────────────────────┘


    Optimistic Locking (session_version):

    GUI                                 Server
     │                                   │
     │  session_version = 2 (local)      │  session_version = 2 (SQLite)
     │                                   │
     │── POST /api/chat ───────────────▶│
     │   expected_version: 2             │
     │                                   │── version matches → proceed
     │                                   │── save messages → version = 3
     │◀── complete, session_version: 3 ──│
     │                                   │
     │  update local version = 3         │
     │                                   │
     │── POST /api/chat ───────────────▶│
     │   expected_version: 2  (STALE!)   │
     │                                   │── version mismatch!
     │◀── 409 Conflict ─────────────────│
     │                                   │
     │  GUI refreshes session state      │

╔══════════════════════════════════════════════════════════════════════════════════════╗
║ ║ ║ ANGLE 6: CANCELLATION FLOW — User Presses Stop ║ ║ ║
╚══════════════════════════════════════════════════════════════════════════════════════╝

    User clicks [Stop] button during agent execution

    ┌─ GUI ──────────────────────────────────────────────────────────────────────┐
    │                                                                            │
    │  ReplLogViewModel.cancelCurrentRequest()                                   │
    │     │                                                                      │
    │     ├── ① Cancel URLSession task (terminates NDJSON stream)               │
    │     │     task.cancel() → StreamLineDelegate receives error                │
    │     │                                                                      │
    │     └── ② POST /api/chat/cancel                                           │
    │           { "request_id": "req-456" }                                      │
    │                                                                            │
    └──────────────────────────┬─────────────────────────────────────────────────┘
                               │
    ┌──────────────────────────▼─────────────────────────────────────────────────┐
    │  Server: handleChatCancel()                                                │
    │     │                                                                      │
    │     ├── Look up req-456 in requestMap                                      │
    │     ├── abortController.abort()   → signal propagates to:                  │
    │     │     ├── LLM provider HTTP request (aborted)                          │
    │     │     ├── Tool execution (if running, receives AbortError)             │
    │     │     └── MCP tool call (if running, cancelled)                        │
    │     │                                                                      │
    │     ├── ReAct loop catches abort:                                          │
    │     │     emit("cancelled", { request_id, partial_text })                 │
    │     │     Save partial response to DB (marked cancelled=true)             │
    │     │                                                                      │
    │     └── Response: { "cancelled": true, "request_id": "req-456" }          │
    │                                                                            │
    └────────────────────────────────────────────────────────────────────────────┘

╔══════════════════════════════════════════════════════════════════════════════════════╗
║ ║ ║ ANGLE 7: MODEL PULL — Downloading a New Model ║ ║ ║
╚══════════════════════════════════════════════════════════════════════════════════════╝

    User selects "llama3.1:8b" in Model Browser and clicks [Download]

    GUI                                    Server                     Ollama
     │                                      │                          │
     │── POST /api/models/pull ───────────▶│                          │
     │   { "name": "gemma4:e4b" }          │                          │
     │                                      │── POST :11439/api/pull ─▶│
     │◀── 200 (NDJSON stream) ─────────────│                          │
     │                                      │                          │
     │◀─ {"event":"progress","status":      │◀─ progress chunks ──────│
     │     "pulling manifest",              │                          │
     │     "completed":0,"total":0}\n       │                          │
     │                                      │                          │
     │◀─ {"event":"progress","status":      │◀─ progress chunks ──────│
     │     "downloading sha256:abc...",     │                          │
     │     "completed":1073741824,          │                          │
     │     "total":4294967296}\n            │   (1GB of 4GB)           │
     │                                      │                          │
     │   GUI: ProgressBar 25% ████░░░░     │                          │
     │                                      │                          │
     │   ... more progress events ...       │                          │
     │                                      │                          │
     │◀─ {"event":"complete",              │◀─ success ───────────────│
     │     "name":"llama3.1:8b"}\n         │                          │
     │                                      │                          │
     │   GUI: update model list             │                          │
     │   SSE /api/models/stream pushes:     │                          │
     │   "models_updated: pull_complete"    │                          │
     │                                      │                          │

╔══════════════════════════════════════════════════════════════════════════════════════╗
║ ║ ║ ANGLE 8: MEMORY FUNCTIONS — Persistent HQL Definitions ║ ║ ║
╚══════════════════════════════════════════════════════════════════════════════════════╝

    User defined (defn greet [name] (str "Hello " name)) in a previous REPL session.
    This persists in server REPL state. GUI can discover and execute it.

    ┌─ Discovery ────────────────────────────────────────────────────────────────┐
    │                                                                            │
    │  GUI                                 Server                                │
    │   │                                   │                                    │
    │   │── GET /api/memory/functions ────▶│                                    │
    │   │                                   │── scan ReplState.bindings          │
    │   │                                   │   filter: kind == "defn"           │
    │   │◀── 200 ──────────────────────────│                                    │
    │   │   {                               │                                    │
    │   │     "functions": [                │                                    │
    │   │       {                           │                                    │
    │   │         "name": "greet",          │                                    │
    │   │         "kind": "defn",           │                                    │
    │   │         "arity": 1,               │                                    │
    │   │         "params": ["name"],       │                                    │
    │   │         "docstring": null,        │                                    │
    │   │         "sourceCode": "(defn greet [name] (str \"Hello \" name))"     │
    │   │       },                          │                                    │
    │   │       ...                         │                                    │
    │   │     ]                             │                                    │
    │   │   }                               │                                    │
    │   │                                   │                                    │
    │   │  GUI shows these in:              │                                    │
    │   │  - Spotlight search results       │                                    │
    │   │  - Module library (built-in tab)  │                                    │
    │   │  - Launchpad / Hotbar equip picker │                                    │
    │                                                                            │
    └────────────────────────────────────────────────────────────────────────────┘

    ┌─ Execution ────────────────────────────────────────────────────────────────┐
    │                                                                            │
    │  GUI                                 Server                                │
    │   │                                   │                                    │
    │   │── POST /api/memory/fn/execute ──▶│                                    │
    │   │   {                               │                                    │
    │   │     "functionName": "greet",      │                                    │
    │   │     "args": ["World"]             │                                    │
    │   │   }                               │                                    │
    │   │                                   │── look up "greet" in bindings      │
    │   │                                   │── check arity: 1 == 1 ✓           │
    │   │                                   │── call greet("World")              │
    │   │                                   │── capture output                   │
    │   │                                   │                                    │
    │   │◀── 200 ──────────────────────────│                                    │
    │   │   {                               │                                    │
    │   │     "output": "Hello World",      │                                    │
    │   │     "status": "success"           │                                    │
    │   │   }                               │                                    │
    │   │                                   │                                    │
    │   │  Error cases:                     │                                    │
    │   │  ├── FUNCTION_NOT_FOUND           │                                    │
    │   │  ├── ARITY_MISMATCH (expected 1, got 0)                               │
    │   │  └── EXECUTION_ERROR (runtime exception)                               │
    │                                                                            │
    └────────────────────────────────────────────────────────────────────────────┘

╔══════════════════════════════════════════════════════════════════════════════════════╗
║ ║ ║ ANGLE 9: CONCURRENT CONNECTION MAP — All Active Connections at Steady
State ║ ║ ║
╚══════════════════════════════════════════════════════════════════════════════════════╝

    At any given moment, the GUI may have these connections open:

    ┌─ GUI Process ─────────────────────────────────────────────────────────────┐
    │                                                                           │
    │                        ┌──────────────────────────────────────┐           │
    │                        │     hlvm serve (:11435)              │           │
    │                        │                                      │           │
    │  SSE (long-lived) ─────│──── GET /api/chat/stream        ①   │           │
    │  ═══════════════════▶  │     (active conversation deltas)    │           │
    │                        │                                      │           │
    │  SSE (long-lived) ─────│──── GET /api/models/stream      ②   │           │
    │  ═══════════════════▶  │     (model availability)            │           │
    │                        │                                      │           │
    │  SSE (long-lived) ─────│──── GET /api/config/stream      ③   │           │
    │  ═══════════════════▶  │     (config changes)                │           │
    │                        │                                      │           │
    │  NDJSON (per-chat) ────│──── POST /api/chat              ④   │           │
    │  ─────────────────────▶│     (active agent stream)           │           │
    │                        │                                      │           │
    │  REST (on-demand) ─────│──── POST /eval (internal)       ⑤   │           │
    │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶│     GET /api/models             ⑥   │           │
    │                        │     PATCH /api/config            ⑦   │           │
    │                        │     POST /api/chat/cancel        ⑧   │           │
    │                        │     POST /api/chat/interaction   ⑨   │           │
    │                        │     GET /api/memory/functions    ⑩   │           │
    │                        │     POST /api/completions        ⑪   │           │
    │                        │     ... (any CRUD endpoint)          │           │
    │                        │                                      │           │
    │                        └──────────────┬───────────────────────┘           │
    │                                       │                                   │
    └───────────────────────────────────────│───────────────────────────────────┘
                                            │
                              ┌─────────────▼──────────────┐
                              │  Outbound from server:     │
                              │                            │
                              │  → Ollama :11439 (LLM)     │
                              │  → OpenAI API (LLM)        │
                              │  → Anthropic API (LLM)     │
                              │  → Google API (LLM)        │
                              │  → MCP servers (stdio/http) │
                              │  → Web fetch (tools)        │
                              └────────────────────────────┘


    Connection characteristics:

    ①②③  SSE: auto-reconnect (3s retry), Last-Event-ID replay,
           30s heartbeat, survives network blips

    ④      NDJSON: one per active chat, 5-minute timeout,
           cancellable via ⑧, streams until complete/error/cancelled

    ⑤-⑪   REST: short-lived, request-response, <30s timeout

╔══════════════════════════════════════════════════════════════════════════════════════╗
║ ║ ║ ANGLE 10: SHARED STATE — What Lives Where ║ ║ ║
╚══════════════════════════════════════════════════════════════════════════════════════╝

    ┌─ GUI Process (Swift) ──────────────────────────────────────────────────────┐
    │                                                                            │
    │  Ephemeral (in-memory, lost on restart):                                   │
    │  ├── Active conversation UI state                                          │
    │  ├── Scroll position, UI state                                             │
    │  ├── Streaming accumulation buffers                                        │
    │  ├── SSE connection state                                                  │
    │  └── Cached auth token                                                     │
    │                                                                            │
    │  Persistent (UserDefaults / app sandbox):                                  │
    │  ├── Hotbar slot assignments                                               │
    │  ├── Spotlight position per screen                                         │
    │  ├── Keyboard shortcuts                                                    │
    │  ├── Appearance settings (font size, theme)                                │
    │  ├── Launch at login preference                                            │
    │  └── Window sizes and positions                                            │
    │                                                                            │
    └────────────────────────────────────────────────────────────────────────────┘

    ┌─ Server Process (Deno) ────────────────────────────────────────────────────┐
    │                                                                            │
    │  Ephemeral (in-memory, lost on restart):                                   │
    │  ├── Active request map (request_id → AbortController)                     │
    │  ├── Active SSE connections (client tracking)                              │
    │  ├── Cached agent sessions (session_id+model → AgentSession)              │
    │  ├── LLM provider instances (configured + connected)                       │
    │  ├── MCP client connections (to external servers)                          │
    │  └── Module import cache (Deno's built-in ESM cache)                      │
    │                                                                            │
    │  Persistent (filesystem):                                                  │
    │  ├── ~/.hlvm/settings.json        → model, temperature, agent mode       │
    │  ├── ~/.hlvm/hlvm.db (SQLite)     → sessions, messages, SSE events        │
    │  ├── ~/.hlvm/memory/              → MEMORY.md, memory.db (SQLite)        │
    │  └── ~/.hlvm/mcp.json             → MCP server configurations             │
    │                                                                            │
    │  REPL state (in-memory, persistent across evals but not restarts):         │
    │  ├── globalThis bindings (defn, def values)                                │
    │  ├── Module cache (imported ESMs)                                          │
    │  ├── Code history                                                          │
    │  └── AI provider on globalThis.ai                                          │
    │                                                                            │
    └────────────────────────────────────────────────────────────────────────────┘

    ┌─ Shared via filesystem ────────────────────────────────────────────────────┐
    │                                                                            │
    │  ~/.hlvm/settings.json                                                      │
    │     ├── Server reads on startup + watches for changes                      │
    │     ├── Server writes on PATCH /api/config                                │
    │     ├── GUI reads via GET /api/config                                      │
    │     ├── GUI writes via PATCH /api/config                                   │
    │     ├── CLI writes directly (hlvm config set ...)                          │
    │     └── Server detects external changes → pushes SSE config_updated       │
    │                                                                            │
    │  ~/.hlvm/hlvm.db (SQLite)                                                  │
    │     ├── Server owns exclusively (single writer)                            │
    │     ├── GUI accesses only via HTTP API                                     │
    │     └── Contains: sessions, messages, SSE event log                       │
    │                                                                            │
    │  ~/.hlvm/memory/ (Memory system)                                           │
    │     ├── Server owns exclusively                                            │
    │     ├── MEMORY.md — user-authored notes (explicit memory)                   │
    │     └── memory.db — SQLite facts, entities, FTS5 (implicit memory)        │
    │                                                                            │
    └────────────────────────────────────────────────────────────────────────────┘

That's every angle I can draw. The systems communicate through a single
runtime-host channel on localhost:11435, using three patterns (JSON, NDJSON
streaming, SSE push) and sharing persistent state through ~/.hlvm/ on the
filesystem. The runtime host is the single source of truth for data and
execution state; GUI and CLI shells are clients over that boundary.

✻ Brewed for 4m 25s
