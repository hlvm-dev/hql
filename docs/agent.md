# HLVM Agent System — Architecture & Reference

> Comprehensive documentation of the HLVM agent system, covering the full
> pipeline from CLI entry points through the ReAct orchestrator to TUI
> presentation.

**→ This document** is the complete technical reference for developers and
maintainers.

---

## Table of Contents

1. [Overview](#overview)
2. [Entry Points](#entry-points)
3. [Session Management](#session-management)
4. [ReAct Orchestrator Loop](#react-orchestrator-loop)
5. [Tool System](#tool-system)
6. [Agent Profiles](#agent-profiles)
7. [Engine Abstraction (AI SDK)](#engine-abstraction)
8. [Prompt System](#prompt-system)
9. [Memory System](#memory-system)
10. [MCP Integration](#mcp-integration)
11. [TUI Presentation](#tui-presentation)
12. [Event System](#event-system)
13. [Error Handling](#error-handling)
14. [Constants & Limits](#constants--limits)
15. [Testing](#testing)

---

## Overview

HLVM's agent system implements an autonomous coding assistant with Claude
Code-level capabilities:

- **ReAct loop** — iterative reason-then-act execution with parallel tool
  calling
- **Multi-provider** — Anthropic, OpenAI, Google, Ollama, Claude Code via Vercel
  AI SDK v6
- **Persistent memory** — SQLite/FTS5-backed fact database across sessions
- **MCP integration** — dynamic tool discovery via Model Context Protocol
- **Structured TUI** — Ink-based terminal UI with styled events and footer
  status

### Local AI SSOT

The agent/runtime pipeline must treat HLVM's embedded local AI runtime as the
only default local-Ollama path.

- Default endpoint SSOT: `127.0.0.1:11439`
- Default local model SSOT: `DEFAULT_MODEL_ID` / `LOCAL_FALLBACK_MODEL_ID`
- Auto-routing, bootstrap, and runtime startup must fail closed to the embedded
  runtime instead of silently falling back to system Ollama on `11434`
- Any hidden fallback, split default, automatic compatibility shortcut, or
  silent reroute to system Ollama is a backdoor and a SSOT violation
- The only legitimate system-Ollama path is the explicit compatibility command
  `hlvm ollama ...`
- If you touch agent routing or `@auto`, read `docs/route/routing.md`,
  `docs/route/model-tiers.md`, and `docs/vision/single-binary-local-ai.md`
  first

These documents are the product contract for local AI and auto routing.

### Architecture Diagram

```
           ┌─────────────────────────────────┐
           │       CLI / HTTP / REPL          │
           │  ask.ts · chat.ts · repl.ts      │
           └──────────────┬──────────────────┘
                          │
           ┌──────────────▼──────────────────┐
           │   runAgentQuery()  [SSOT]        │
           │   agent-runner.ts                 │
           │   - Session setup                 │
           │   - Tool init                     │
           │   - Engine resolution              │
           └──────────────┬──────────────────┘
                          │
           ┌──────────────▼──────────────────┐
           │   createAgentSession()            │
           │   session.ts                      │
           │   - System prompt compilation      │
           │   - MCP tool loading               │
           │   - Context budget resolution      │
           │   - Memory injection               │
           └──────────────┬──────────────────┘
                          │
┌─────────────────────────▼───────────────────────────┐
│              runReActLoop()                          │
│              orchestrator.ts                         │
│                                                      │
│   ┌─────────────────────────────────────────────┐   │
│   │  for each iteration (max 20):               │   │
│   │   1. Call LLM (with retry + timeout)        │   │
│   │   2. Parse tool calls from response         │   │
│   │   3. Execute tools (parallel by default)    │   │
│   │   4. Format results → add to context        │   │
│   │   5. Inject memory recall if applicable     │   │
│   │   6. Check stopping conditions              │   │
│   └─────────────────────────────────────────────┘   │
│                                                      │
└──────────────────────┬──────────────────────────────┘
                       │
           ┌───────────▼────────────┐
           │  AgentRunnerResult      │
           │  - Final text response  │
           │  - Stats (tokens, time) │
           │  - Citations metadata   │
           └────────────────────────┘
```

### File Layout

```
src/hlvm/agent/
├── agent-runner.ts              # Main entry: runAgentQuery()
├── agent-registry.ts            # Built-in + custom agent profiles
├── constants.ts                 # Limits, timeouts, model tiers
├── engine.ts                    # AgentEngine interface + singleton
├── engine-sdk.ts                # Vercel AI SDK v6 engine impl
├── error-taxonomy.ts            # Error classification
├── llm-integration.ts           # System prompt compilation
├── orchestrator.ts              # ReAct loop + AgentUIEvent type
├── orchestrator-state.ts        # Loop state types
├── orchestrator-tool-execution.ts
├── orchestrator-tool-formatting.ts
├── orchestrator-llm.ts
├── orchestrator-response.ts
├── registry.ts                  # Tool registry (SSOT)
├── session.ts                   # AgentSession creation + reuse
├── mcp/
│   ├── sdk-client.ts            # MCP SDK adapter
│   ├── config.ts                # Server config loading
│   ├── tools.ts                 # MCP tool registration
│   └── oauth.ts                 # OAuth2 for MCP servers
src/hlvm/prompt/
├── compiler.ts                  # Prompt compilation pipeline
├── sections.ts                  # Section renderers (role, rules, routing, etc.)
├── types.ts                     # PromptMode, PromptCompilerInput, CompiledPrompt
src/hlvm/memory/
├── db.ts                        # SQLite + FTS5 schema
├── facts.ts                     # Fact CRUD + search
├── entities.ts                  # Entity tracking
├── retrieve.ts                  # Hybrid retrieval
├── invalidate.ts                # Auto-invalidation
├── manager.ts                   # loadMemoryContext()
├── tools.ts                     # memory_write/search/edit
├── store.ts                     # MEMORY.md + journal I/O
├── explicit.ts                  # Explicit memory operations
├── pipeline.ts                  # Memory pipeline orchestration
├── policy.ts                    # Memory policy configuration
```

---

## Entry Points

### `hlvm ask "<query>"`

Single-shot agent execution. Entry: `src/hlvm/cli/commands/ask.ts`.

```
hlvm ask "refactor the auth module"
hlvm ask "what does session.ts do" --model anthropic/claude-sonnet-4-20250514
hlvm ask --verbose --json "create hello.txt"
```

Flags:

- `--model <id>` — Override model (e.g., `anthropic/claude-sonnet-4-20250514`,
  `ollama/gemma4:e4b`)
- `--verbose` — Show agent header, tool labels, stats, trace events
- `--json` — NDJSON event stream output
- `--stateless` — No session persistence
- `--attach <path>` — Attach file context

Calls `runAgentQueryViaHost()` which invokes `runAgentQuery()` via the local
host boundary.

### `POST /api/chat`

HTTP API endpoint. Entry: `src/hlvm/cli/repl/handlers/`.

Split into modules:

- `chat.ts` — Main request handler and routing
- `chat-agent-mode.ts` — Agent execution + Claude Code subprocess mode
- `chat-direct.ts` — Direct chat streaming (non-agent mode)
- `chat-context.ts` — Context management for chat sessions
- `messages.ts` — Message formatting utilities

### `hlvm repl`

Interactive REPL. Same `runAgentQuery()` infrastructure, with Ink-based TUI
rendering.

### Core Function

All paths converge on a single SSOT function:

```typescript
// src/hlvm/agent/agent-runner.ts
export async function runAgentQuery(
  options: AgentRunnerOptions,
): Promise<AgentRunnerResult>;
```

Other exports:

- `createReusableSession()` — Session persistence for stateful mode
- `reuseSession()` — Reuse + refresh stale sessions (async)
- `shouldReuseAgentSession()` — Reuse-eligibility check
- `ensureAgentReady()` — Runtime initialization (cache, log, stdlib)

---

## Session Management

### AgentSession

Created by `createAgentSession()` in `src/hlvm/agent/session.ts`:

| Field                   | Type                   | Purpose                               |
| ----------------------- | ---------------------- | ------------------------------------- |
| `llm`                   | `LLMFunction`          | The configured LLM callable           |
| `engine`                | `AgentEngine`          | SDK or Legacy engine instance         |
| `context`               | `ContextManager`       | Token budget + sliding window         |
| `profile`               | `ENGINE_PROFILES[key]` | Engine profile (normal/strict config) |
| `modelTier`             | `ModelTier`            | `"weak"` / `"mid"` / `"frontier"`     |
| `isFrontierModel`       | `boolean`              | API-hosted or large context           |
| `thinkingCapable`       | `boolean`              | Extended thinking support             |
| `compiledPromptMeta`    | `CompiledPromptMeta`   | Compiled system prompt metadata       |
| `todoState`             | `TodoState`            | Session-scoped task list              |
| `l1Confirmations`       | `L1ConfirmationState`  | Remembered L1 tool approvals          |
| `toolFilterState`       | `ToolFilterState`      | Dynamic tool filtering                |
| `resolvedContextBudget` | `ResolvedBudget`       | Token allocation                      |

### Context Budget Resolution

3-layer pipeline in `src/hlvm/agent/context-resolver.ts`:

1. **Base**: Default 32K tokens or model-specific limit
2. **Overflow retry**: Expand budget if context overflow detected
3. **Context manager**: Sliding window compaction when approaching limit

Memory is **always** a separate system message (marker: `# Your Memory`), never
embedded in the main system prompt.

### Session Reuse

```
First run → createAgentSession() → runReActLoop() → return session ID

Second run with --resume <id>:
  → reuseSession(existingSession)
    → Replace stale memory with fresh retrieval
    → Skip `# Your Memory` marker during message rehydration
    → Reuse LLM + context manager
  → runReActLoop()
```

---

## ReAct Orchestrator Loop

**Entry**: `runReActLoop()` in `src/hlvm/agent/orchestrator.ts`

### Architecture

The orchestrator was split from a single 2,030-line file into 5 focused modules:

| Module                            | Responsibility                                               |
| --------------------------------- | ------------------------------------------------------------ |
| `orchestrator.ts`                 | Main iteration loop, control flow, phase detection           |
| `orchestrator-state.ts`           | `LoopState`, `LoopConfig` types, state initialization        |
| `orchestrator-tool-execution.ts`  | Tool execution with timeout, verification, permission checks |
| `orchestrator-llm.ts`             | LLM call wrapper with retry + timeout                        |
| `orchestrator-response.ts`        | Response processing, final output extraction                 |
| `orchestrator-tool-formatting.ts` | Tool result formatting, dedup, display truncation            |

### Iteration Flow

```
for iteration = 1 to MAX_ITERATIONS (20):
  1. maybeInjectMemoryRecall()     — retrieve relevant memory facts
  2. maybeInjectReminder()          — safety/routing reminders (tier-aware)
  3. LLM call with retry (max 3)
  5. Parse tool calls from response
  6. Execute tools (parallel by default)
  7. Format results, add to context
  8. Derive runtime phase: researching | editing | verifying | completing
  9. Apply adaptive tool phase filtering (narrow available tools based on phase)
  10. Check stopping: max tokens, max iterations, quality threshold
```

### Runtime Phases

The orchestrator detects the agent's current work phase and dynamically filters
available tools:

| Phase         | Tool Categories                                                          | Triggered When                             |
| ------------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| `researching` | all categories (unfiltered)                                              | Default / reading/searching tools dominate |
| `editing`     | `read`, `search`, `write`, `shell`, `git`, `meta`, `memory`              | Write/edit tools in use                    |
| `verifying`   | same as editing                                                          | Build/test/lint tools in use               |
| `completing`  | `read`, `shell`, `meta`                                                  | Agent signals completion                   |

---

## Tool System

### Registry

**SSOT**: `src/hlvm/agent/registry.ts`

All tools (native + MCP) are registered in a single central registry. Key
operations:

```typescript
registerTool(name, metadata); // Add a tool
registerTools(entries); // Bulk add
unregisterTool(name); // Remove (MCP cleanup)
getTool(name); // Lookup by name
getAllTools(); // All registered tools
getToolsByCategory(); // Returns all tools grouped by category
searchTools(query, options); // Fuzzy search for tool_search
resolveTools(allowlist, denylist, ownerId); // Build filtered set
```

### Tool Metadata

```typescript
interface ToolMetadata {
  fn: ToolFunction;
  description: string;
  args: Record<string, string>; // arg name → description
  argAliases?: Record<string, string>;
  returns?: Record<string, string>; // return field → description
  safetyLevel?: "L0" | "L1" | "L2";
  safety?: string; // additional safety info text
  category?:
    | "read"
    | "write"
    | "search"
    | "shell"
    | "git"
    | "web"
    | "data"
    | "meta"
    | "memory";
  replaces?: string; // shell command this tool replaces (e.g., "cat/head/tail")
  skipValidation?: boolean; // for dynamic tools with unknown schemas
  formatResult?: (result: unknown) => FormattedToolResult | null;
  terminalOnSuccess?: boolean; // standalone success = end turn
}
```

### Safety Levels

| Level  | Meaning            | Examples                                                | Auto-approve                          |
| ------ | ------------------ | ------------------------------------------------------- | ------------------------------------- |
| **L0** | Read-only          | `read_file`, `list_files`, `search_code`, `git_status`  | All modes                             |
| **L1** | Low-risk execution | `write_file`, `edit_file`, `shell_exec` (safe commands) | `acceptEdits` and `bypassPermissions` |
| **L2** | High-risk mutation | `shell_exec` (dangerous), `delete` operations           | `bypassPermissions` only              |

### Permission Modes

HLVM provides five permission modes plus fine-grained tool control via
`--permission-mode`:

#### Built-in Modes

| Mode                | L0   | L1     | L2     | CLI Flag                              | Use Case                     |
| ------------------- | ---- | ------ | ------ | ------------------------------------- | ---------------------------- |
| `default`           | Auto | Prompt | Prompt | (none)                                | Interactive development      |
| `plan`              | Auto | Prompt | Prompt | `--permission-mode plan`              | Plan-first execution         |
| `acceptEdits`       | Auto | Auto   | Prompt | `--permission-mode acceptEdits`       | Trusted file operations      |
| `bypassPermissions` | Auto | Auto   | Auto   | `--permission-mode bypassPermissions` | Full automation (unsafe)     |
| `dontAsk`           | Auto | Deny   | Deny   | `--permission-mode dontAsk`           | Non-interactive/CI pipelines |

**Default mode** is fully interactive — safe tools (L0) auto-approve, mutations
(L1/L2) prompt the user.

**dontAsk mode** is the non-interactive standard — execution where unsafe tools
are automatically denied. This is the recommended mode for CI/CD pipelines,
scripts, and automation. When `-p`/`--print` is used without an explicit
`--permission-mode`, it defaults to `dontAsk`.

**Legacy aliases:** `--auto-edit` maps to `--permission-mode acceptEdits`.
`--dangerously-skip-permissions` maps to `--permission-mode bypassPermissions`.

#### Fine-Grained Tool Control

Beyond built-in modes, you can explicitly allow or deny individual tools:

```bash
# Allow specific tools (repeatable)
hlvm ask --allowedTools write_file --allowedTools edit_file "fix bug"

# Deny specific tools (repeatable)
hlvm ask --disallowedTools shell_exec "analyze code"

# Combine with permission modes
hlvm ask --permission-mode dontAsk --allowedTools write_file "generate docs"
```

**Permission resolution priority** (highest to lowest):

1. Explicit `--disallowedTools`
2. Explicit `--allowedTools`
3. Mode-based defaults (`dontAsk`, `acceptEdits`, `bypassPermissions`)
4. Safety level defaults (L0 auto-approve, L1/L2 prompt)

### Tool Categories

| Category  | Tools                                                                        |
| --------- | ---------------------------------------------------------------------------- |
| `read`    | `read_file`, `list_files`, `file_stats`                                      |
| `write`   | `write_file`, `edit_file`                                                    |
| `search`  | `search_code`, `find_symbol`, `get_structure`, `ast_query`                   |
| `shell`   | `shell_exec`, `shell_script`                                                 |
| `web`     | `search_web`, `fetch_url`, `web_fetch`, `render_url`                         |
| `memory`  | `memory_write`, `memory_search`, `memory_edit`                               |
| `meta`    | `tool_search`, `request_clarification`                                       |
| `git`     | `git_status`, `git_diff`, `git_log`, `git_commit`                            |
| `data`    | Data processing tools                                                        |

### Model Tier Tool Filtering

```typescript
type ModelTier = "weak" | "mid" | "frontier";

classifyModelTier(modelInfo, isFrontier) → ModelTier
  // frontier: API-hosted (anthropic/openai/google/claude-code) OR context ≥ 128K
  // weak: local model with <13B params
  // mid: everything else

computeTierToolFilter(tier) → { allowlist, denylist }
  // weak: restricted to WEAK_TIER_CORE_TOOLS (read, list, search, shell basics)
  // mid/frontier: full access
```

---

## Agent Profiles

**File**: `src/hlvm/agent/agent-registry.ts`

### Built-in Profiles

| Profile   | Tools                                             | Notes              |
| --------- | ------------------------------------------------- | ------------------ |
| `general` | File + Code + Shell + Web + Memory                | Default profile    |
| `code`    | Code analysis (read, search, find_symbol)         | `temperature: 0.2` |
| `file`    | File operations (read/write/edit/list)            |                    |
| `shell`   | Shell execution (shell_exec, shell_script)        |                    |
| `web`     | Web research (search, fetch, render)              | `maxTokens: 32000` |
| `memory`  | Memory operations only                            |                    |

### Profile Aliases

LLMs naturally use descriptive names. The registry maps them:

```typescript
const PROFILE_ALIASES = {
  "general-purpose": "general",
  "generalist": "general",
};
```

Lookup: exact match first, then alias fallback.

### Custom Project Profiles

Place `.md` files in `.hlvm/agents/` with YAML frontmatter:

```markdown
---
name: reviewer
description: Code review specialist
tools:
  - read_file
  - search_code
  - find_symbol
  - get_structure
temperature: 0.1
instructions: Focus on security, performance, and code quality.
---

## Review Guidelines

When reviewing code, check for:

- OWASP Top 10 vulnerabilities
- Performance bottlenecks
- Code style violations
```

Fields: `name`, `description`, `tools` (required), plus optional `model`,
`temperature`, `maxTokens`, `instructions`.


---

## Engine Abstraction

**Files**: `src/hlvm/agent/engine.ts`, `src/hlvm/agent/engine-sdk.ts`

### Interface

```typescript
interface AgentEngine {
  createLLM(config: AgentLLMConfig): LLMFunction;
  createSummarizer(): (text: string) => Promise<string>;
}
```

### Implementation

`SdkAgentEngine` is the sole implementation (default). Uses Vercel AI SDK v6.

`getAgentEngine()` returns `_engine ?? new SdkAgentEngine()` — no env var
switching.

### AI SDK v6 Integration

Provider support:

| Provider    | Package                 | Model Examples                         |
| ----------- | ----------------------- | -------------------------------------- |
| Anthropic   | `@ai-sdk/anthropic`     | `anthropic/claude-sonnet-4-20250514`   |
| OpenAI      | `@ai-sdk/openai`        | `openai/gpt-4o`                        |
| Google      | `@ai-sdk/google`        | `google/gemini-2.0-flash`              |
| Ollama      | `ollama-ai-provider-v2` | `ollama/gemma4:e4b`                    |
| Claude Code | Custom adapter          | `claude-code/claude-sonnet-4-20250514` |

Features:

- Native structured tool calling
- Prompt caching (Anthropic, OpenAI)
- Extended thinking (Claude, OpenAI o1)
- Text repair fallback for weak models (parse JSON from text when native fails)

---

## Prompt System

**Files**: `src/hlvm/prompt/`

### Compilation Pipeline

```typescript
// src/hlvm/prompt/compiler.ts
compilePrompt(input: PromptCompilerInput): CompiledPrompt
```

The system prompt is assembled from 17 section renderers, each gated by
`minTier`:

| Section                           | Min Tier | Content                              |
| --------------------------------- | -------- | ------------------------------------ |
| `renderRole()`                    | weak     | Agent role + workspace description   |
| `renderChatRole()`                | weak     | Chat mode role (chat-only)           |
| `renderChatNoToolsRule()`         | weak     | No tools in chat mode (chat-only)    |
| `renderCriticalRules()`           | weak     | Safety constraints + SSOT rules      |
| `renderInstructions()`            | weak     | Instruction priority and references  |
| `renderToolRouting()`             | mid      | Auto-generated tool routing table    |
| `renderPermissionTiers()`         | mid      | Safety level explanations            |
| `renderWebToolGuidance()`         | mid      | Web tool best practices              |
| `renderRemoteExecutionGuidance()` | mid      | Remote execution safety              |
| `renderEnvironment()`             | weak     | Workspace info, git status           |
| `renderExamples()`                | mid      | Usage examples                       |
| `renderTips()`                    | weak     | General tips                         |
| `renderFooter()`                  | weak     | Closing notes                        |

### Tool Routing Table

Auto-generated from `replaces` metadata on tools:

```
## Tool Routing
| Instead of... | Use... | Why |
|---------------|--------|-----|
| shell grep    | search_code | Structured results, respects gitignore |
| curl          | fetch_url   | Handles auth, rate limits |
```

---

## Memory System

**Files**: `src/hlvm/memory/`

### Architecture: DB-as-SSOT

```
memory_write → SQLite DB (facts, entities, relationships) → MEMORY.md (projection)
                     ↕
              FTS5 full-text index
```

### Core Modules

| Module          | Purpose                                                          |
| --------------- | ---------------------------------------------------------------- |
| `db.ts`         | SQLite database, FTS5 indexing, schema migrations                |
| `facts.ts`      | Fact CRUD: `insertFact()`, `getValidFacts()`, `replaceInFacts()` |
| `entities.ts`   | Entity relationship tracking (name/type graph)                   |
| `retrieve.ts`   | Hybrid retrieval: FTS5 BM25 + entity graph traversal             |
| `invalidate.ts` | Jaccard similarity auto-invalidation (>0.9 threshold)            |
| `manager.ts`    | `loadMemoryContext()` — session-level memory loading             |
| `tools.ts`      | Agent tools: `memory_write`, `memory_search`, `memory_edit`      |
| `store.ts`      | MEMORY.md file + journal I/O, sensitive content filtering        |

### Session Integration

1. `loadMemoryContext()` called after context budget resolution
2. Memory injected as separate system message (marker: `# Your Memory`)
3. `maybeInjectMemoryRecall()` in orchestrator retrieves relevant facts
   per-iteration
4. Pinned facts limit (10) with availability hint when more exist in DB

### Memory Tools

| Tool            | Purpose                                 |
| --------------- | --------------------------------------- |
| `memory_write`  | Record a fact, insight, or project note |
| `memory_search` | Query facts by keyword (FTS5)           |
| `memory_edit`   | Delete or replace facts by category     |

---

## MCP Integration

**Files**: `src/hlvm/agent/mcp/`

Uses `@modelcontextprotocol/sdk@^1.12.0` (replaced 1,900 lines of hand-rolled
client).

### Components

| Module          | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `sdk-client.ts` | `SdkMcpClient` adapter wrapping SDK `Client`                      |
| `config.ts`     | Load server configs from `~/.hlvm/mcp.json` + Claude Code plugins |
| `tools.ts`      | Register MCP tools into dynamic tool registry                     |
| `oauth.ts`      | OAuth2 flow (discovery, authorization, token exchange, refresh)   |

### Safety Inference for MCP Tools

```typescript
inferMcpSafetyLevel(toolName, description?) → "L0" | "L1" | "L2"
  // Checks combined toolName + description text:
  // L2: matches MCP_MUTATING_RE (write, create, update, delete, remove, destroy, execute, run, etc.)
  // L0: matches MCP_READ_ONLY_RE (read, list, get, fetch, search, find, etc.)
  // L1: default for unrecognized tools (neither read-only nor mutating pattern matched)
```

### Capabilities

- Protocol version: `2025-11-25` with `2024-11-05` fallback
- Elicitation, sampling, roots handling
- Pagination (handled by SDK)
- Transport: stdio, HTTP/SSE

---

## TUI Presentation

### Conversation Items

All agent output is converted to typed `ConversationItem`s for rendering:

```typescript
type ConversationItem =
  | UserItem // User input
  | AssistantItem // Agent text response
  | ThinkingItem // Reasoning/planning bubbles
  | ToolGroupItem // Grouped tool call results
  | ErrorItem // Error messages
  | InfoItem // Generic info
  | MemoryActivityItem; // Memory recall/write activity
```

---

## Event System

### AgentUIEvent

Defined in `src/hlvm/agent/orchestrator.ts`. Emitted by the orchestrator,
consumed by TUI:

| Event Type                  | Fields                                                                | When                      |
| --------------------------- | --------------------------------------------------------------------- | ------------------------- |
| `thinking`                  | `iteration`                                                           | Start of each iteration   |
| `reasoning_update`          | `iteration`, `summary`                                                | Agent reasoning output    |
| `planning_update`           | `iteration`, `summary`                                                | Planning phase output     |
| `tool_start`                | `name`, `argsSummary`, `toolIndex`, `toolTotal`                       | Before tool execution     |
| `tool_end`                  | `name`, `success`, `content`, `durationMs`                            | After tool execution      |
| `turn_stats`                | `iteration`, `toolCount`, `durationMs`, `inputTokens`, `outputTokens` | End of each iteration     |
| `memory_activity`           | `recalled[]`, `written[]`, `searched?`                                | Memory operations         |
| `todo_updated`              | `todoState`, `source`                                                 | Task list changed         |
| `plan_created`              | `plan`                                                                | Plan generated            |
| `plan_step`                 | `stepId`, `index`, `completed`                                        | Plan step status          |

### Event Flow

```
Orchestrator (runReActLoop)
  │ emits AgentUIEvent via onAgentEvent callback
  │
  ├─► CLI: agent-transcript-state.ts reduces events → ConversationItem[]
  │         ConversationPanel renders items
  │
  ├─► HTTP: Streamed as NDJSON { type: "agent_event", event: {...} }
  │
  └─► JSON mode: --json flag outputs raw NDJSON stream
```

---

## Error Handling

**File**: `src/hlvm/agent/error-taxonomy.ts`

### Error Classification

```typescript
classifyError(error) → ErrorClass
```

| Class              | Retry? | Examples                                     |
| ------------------ | ------ | -------------------------------------------- |
| `abort`            | No     | `AbortError` — user cancelled                |
| `timeout`          | Maybe  | Tool/LLM exceeded time limit                 |
| `rate_limit`       | Yes    | HTTP 429 — backoff and retry                 |
| `context_overflow` | Yes    | Token limit — retry with smaller budget      |
| `transient`        | Yes    | Network errors, 5xx                          |
| `permanent`        | No     | Auth errors, invalid prompt, model not found |
| `unknown`          | No     | Unclassified errors                          |

### SDK Error Types

From Vercel AI SDK v6:

- `APICallError` — HTTP status code extraction
- `RetryError` — Recurse on `lastError`
- `LoadAPIKeyError` — Missing API key
- `NoSuchModelError` — Invalid model ID
- `InvalidPromptError` — Malformed prompt
- `NoContentGeneratedError` — Empty response

---

## Constants & Limits

**File**: `src/hlvm/agent/constants.ts`

### Iteration Limits

| Constant                  | Value | Context               |
| ------------------------- | ----- | --------------------- |
| `MAX_ITERATIONS`          | 20    | Parent/lead agent     |
| `DEFAULT_MAX_TOOL_CALLS`  | 50    | Tools per turn        |

### Timeouts

| Constant                     | Value | Context                   |
| ---------------------------- | ----- | ------------------------- |
| `DEFAULT_TIMEOUTS.llm`       | 120s  | LLM call timeout          |
| `DEFAULT_TIMEOUTS.tool`      | 60s   | Tool execution timeout    |
| `DEFAULT_TIMEOUTS.userInput` | 300s  | User confirmation timeout |
| `DEFAULT_TIMEOUTS.total`     | 300s  | Total loop timeout        |

### Resource Limits

| Constant                  | Value | Context                   |
| ------------------------- | ----- | ------------------------- |
| `maxReadBytes`            | 2 MB  | Single file read          |
| `maxWriteBytes`           | 2 MB  | Single file write         |
| `maxListEntries`          | 5,000 | `list_files` results      |
| `maxSearchResults`        | 5,000 | `search_code` results     |
| `maxSearchFileBytes`      | 1 MB  | Per-file search scan      |
| `maxSymbolFiles`          | 5,000 | `find_symbol` files       |
| `maxTotalToolResultBytes` | 2 MB  | Total tool output per run |

### Context

| Constant                 | Value  | Context                   |
| ------------------------ | ------ | ------------------------- |
| `DEFAULT_CONTEXT_WINDOW` | 32,000 | Default token budget      |
| `COMPACTION_THRESHOLD`   | 0.8    | Trigger compaction at 80% |
| `OUTPUT_RESERVE_TOKENS`  | 4,096  | Reserved for LLM output   |
| `MAX_SESSION_HISTORY`    | 10     | Max messages before trim  |

---

## Testing

### Test Structure

```
tests/unit/agent/
├── llm-integration.test.ts      # Prompt compilation tests
├── sdk-runtime.test.ts          # SDK message consolidation tests
├── error-taxonomy.test.ts       # Error classification tests

tests/unit/repl/
├── footer-hint.test.ts          # 23 tests (footer rendering)
├── shell-chrome.test.ts         # Shell footer tests

tests/unit/prompt/
├── compiler.test.ts             # Prompt compilation pipeline tests

tests/unit/memory/
├── memory.test.ts               # 47 tests (DB, facts, retrieval, invalidation)
```

### Running Tests

```bash
# Full suite
deno task test:unit

# SSOT compliance
deno task ssot:check
```

### Test Utilities

- `createScriptedLLM(responses)` — Deterministic LLM for unit tests

---

## Quick Reference

### Environment Variables

| Variable     | Purpose             | Default             |
| ------------ | ------------------- | ------------------- |
| `HLVM_DIR`   | HLVM data directory | `~/.hlvm`           |
| `HLVM_MODEL` | Default model       | `ollama/gemma4:e4b` |

### Key File Paths

```
~/.hlvm/                        # Data root
~/.hlvm/settings.json           # Unified config
~/.hlvm/memory/                 # Memory database
<workspace>/.hlvm/agents/       # Custom agent profiles
```

---

# Appendix A — Sub-Agent System (Claude Code Parity)

> **Audience**: a continuing agent with zero prior conversation context.
> Everything needed to resume work on HLVM's CC-parity-tracked sub-agent stack
> is in this appendix. Verified against source on 2026-04-18.
>
> **CC reference tree**: `~/dev/ClaudeCode-main/tools/AgentTool/`

## A.1 What "CC parity" means here

HLVM's sub-agent system is a deliberate reimplementation of Claude Code's
`Agent` tool. The module layout intentionally mirrors CC and the common
execution path is recognizably the same, but this is **not** yet a
behavior-complete port. Treat the matrix in A.2 as authoritative for
what is actually equivalent vs merely close vs still missing.

The work was done on the current branch `feat/nuke-cc-harness` after
ripping out the legacy team/delegation code (-26,595 lines).

**In scope (production-only CC features):**

- Single `Agent` tool, LLM-driven dispatch (no regex/keyword routing)
- Built-in agents: `Explore`, `Plan`, `general-purpose`
- Custom agents from `.hlvm/agents/*.md` (frontmatter-parsed)
- Sync execution (parent blocks on child)
- Async / background execution (`run_in_background: true`)
- Worktree isolation (`isolation: "worktree"`)
- Per-agent MCP server specs
- Per-agent tool allow/deny resolution
- Ink TUI rendering for spawn/progress/complete
- Background-tasks overlay in REPL

**Explicitly out of scope (CC experimental / infra-bound):**

- Agent Teams / Swarm (opt-in experimental in CC)
- Fork mechanism, Resume, Coordinator mode (feature-flag gated in CC)
- Agent memory/snapshots (experimental)
- Managed Agents API (separate Anthropic cloud product)
- Anthropic-internal remote/CCR execution

> When someone asks to "add a CC feature", first check whether the CC
> file lives under a feature flag. If yes, it is out of scope by default.

## A.2 Current verdict

- **Architecture**: the file layout intentionally mirrors CC's
  `tools/AgentTool/` tree, but behavior parity is mixed. The common
  spawn → child loop → result path is close; the config / policy /
  continuation surface is where most real gaps still live.
- **E2E**: verified working through `hlvm ask` with live Claude Haiku:
  Explore spawn, ad-hoc default (→ `general-purpose`), Plan spawn,
  unknown-type error path, tool isolation (Explore refuses edits),
  background agent, custom `.md` agent, worktree isolation, multiple
  parallel agents.
- **Unit tests**: `tests/unit/agent/agent-*.test.ts` (4 files,
  ≈3,000 LOC) — must all pass with `deno test --allow-all` and
  `HLVM_DISABLE_AI_AUTOSTART=1`.
- **SSOT**: `deno task ssot:check` must pass with zero errors.

### Status key

- `same` — materially the same on the inspected production path
- `close` — same broad user-visible shape, but contract or implementation is narrower
- `partial` — implemented, but important CC behavior is missing
- `missing` — production CC surface not implemented in HLVM
- `excluded` — intentionally out of scope for this parity target

### Parity chart — core execution path

| Surface | CC | HLVM now | Status | Notes |
| ------- | -- | -------- | ------ | ----- |
| `Agent` tool exists and selection is LLM-driven | yes | yes | `same` | No regex routing in either path. |
| Stable built-ins `general-purpose`, `Explore`, `Plan` | yes | yes | `same` | `src/hlvm/agent/tools/built-in-agents.ts` mirrors the stable built-ins. |
| Omit `subagent_type` on the fresh-agent path | defaults to general-purpose when not using fork path | defaults to `general-purpose` | `close` | CC can route omitted `subagent_type` into fork mode under a feature gate; HLVM always uses `general-purpose`. |
| Sync child execution in isolated context | yes | yes | `same` | `run-agent.ts` creates a fresh `ContextManager`. |
| Background execution from initial launch | yes | yes | `close` | HLVM launches background agents and writes an output file, but lacks part of CC's continuation contract. |
| Worktree isolation | yes | yes | `same` | Create / keep-on-change / cleanup behavior exists in `agent-worktree.ts`. |
| Parent TUI sees spawn / progress / complete events | yes | yes | `close` | HLVM forwards aggregate progress, not CC's richer streamed child message model. |
| Prompt tells the parent to fan out multiple agents in one message | yes | yes | `same` | Present in `agent-prompt.ts`. |

### Parity chart — agent definitions and config surface

| Surface | CC | HLVM now | Status | Notes |
| ------- | -- | -------- | ------ | ----- |
| Load custom markdown agents from user + project dirs | yes | yes | `same` | `~/.hlvm/agents/` and `<workspace>/.hlvm/agents/`. |
| Override / precedence chain | built-in → plugin → user → project → flag → managed | built-in → user → project | `partial` | HLVM only implements the simpler three-tier merge. |
| Core frontmatter fields | tools, disallowedTools, model, maxTurns, background, isolation, permissionMode, initialPrompt, mcpServers | same subset implemented | `close` | The core subset exists, but not the full CC definition surface. |
| `effort` frontmatter | yes | no | `missing` | CC parses string or integer effort values. |
| `skills` frontmatter preload | yes | no | `missing` | HLVM has no agent-frontmatter skill preload path. |
| `hooks` frontmatter | yes | no | `missing` | `src/hlvm/agent/hooks.ts` is deleted in this branch. |
| `requiredMcpServers` availability gate | yes | no | `missing` | No per-agent MCP precondition / wait path in HLVM. |
| JSON agents in settings | yes | no | `missing` | CC supports JSON-defined agents; HLVM only loads `.md` files. |
| Plugin / policy / managed agent sources | yes | no | `missing` | HLVM source union is only `built-in | user | project`. |
| Parse-error surfacing for agent-like invalid files | yes | partial | `partial` | HLVM surfaces file read errors, but malformed YAML / invalid frontmatter can collapse to `meta: null` and be skipped silently. |
| `allowedAgentTypes` metadata from tool permission specs | yes | no | `missing` | CC threads allowed agent-type scoping through the tool resolution path. |

### Parity chart — execution contract, result shape, and lifecycle

| Surface | CC | HLVM now | Status | Notes |
| ------- | -- | -------- | ------ | ----- |
| Child system prompt gets env details (`cwd`, platform, enabled tools, absolute-path guidance) | yes | no | `missing` | CC runs `enhanceSystemPromptWithEnvDetails`; HLVM currently uses only `getSystemPrompt()`. |
| `initialPrompt` is a separate first-turn prefix instead of user-prompt concatenation | yes | no | `missing` | HLVM currently builds `initialPrompt + "\\n\\n" + prompt` inside `run-agent.ts`. |
| Per-invocation model override | yes | yes | `same` | Implemented in `run-agent.ts` via `modelOverride`. |
| Explore defaults to a small / fast model | yes | no | `close` | HLVM Explore currently inherits the parent model. |
| Permission-mode-aware tool filtering | yes | partial | `partial` | HLVM supports `permissionMode` on the child config, but its `filterToolsForAgent()` lacks CC's permission-mode branches and `ExitPlanMode` special case. |
| Sync result schema | structured text blocks + granular usage object | plain string + total counts | `partial` | HLVM returns `content: string` and simplified token stats. |
| Async result includes `canReadOutputFile` | yes | no | `missing` | HLVM returns only `agentId`, `description`, `prompt`, `outputFile`. |
| Continue a live spawned agent | yes (`SendMessage`) | no | `missing` | HLVM has no SendMessage-equivalent continuation path. |
| Resume a background agent after restart | yes | no | `excluded` | Kept out of the current parity target with fork / resume scope. |
| Background completion delivery | yes | partial | `partial` | HLVM persists a synthetic user message when `sessionId` exists; otherwise it only queues a string in `completionQueue`. No production queue-drain consumer is present in this tree outside tests. |
| Auto-background after elapsed time / summarization path | yes | no | `missing` | CC has threshold-based backgrounding and summarization helpers; HLVM only supports explicit `run_in_background`. |

### Parity chart — UI and result presentation

| Surface | CC | HLVM now | Status | Notes |
| ------- | -- | -------- | ------ | ----- |
| One-shot built-ins skip continuation trailer | yes | yes | `same` | `Explore` and `Plan` are treated as one-shot in both systems. |
| Background output file is usable by the REPL overlay | yes | yes | `same` | HLVM writes task output under `~/.hlvm/tasks/`. |
| Completed agent transcript can be expanded in TUI | yes | yes | `close` | HLVM stores a transcript summary and passes tests, but the child-side stream is still more approximate than CC. |
| Async result tells the parent how to inspect progress | yes | partial | `partial` | HLVM returns `outputFile`, but not `canReadOutputFile` or CC's richer guidance text. |
| Per-agent color assignment in TUI | yes | no | `missing` | CC has agent color management; HLVM does not assign per-agent colors. |

### Parity chart — CC features intentionally excluded here

| Surface | Why not counted toward current target | Status |
| ------- | ------------------------------------ | ------ |
| Fork subagent path / inherited full parent context | CC feature-flagged; different execution model | `excluded` |
| Coordinator mode | CC feature-flagged | `excluded` |
| Teams / Swarm / in-process teammates | experimental / broader than the stable sub-agent path | `excluded` |
| Remote CCR isolation | Anthropic infra-bound | `excluded` |
| Managed Agents API | separate Anthropic cloud product | `excluded` |
| Agent memory / snapshots | experimental in CC and not part of this branch target | `excluded` |

### Practical read on closeness

- **Close on the common path**: spawning a fresh agent, running it sync or background, isolating it in a worktree, and rendering its lifecycle in the TUI all work and are already test-backed.
- **Farther on the control surface**: CC's larger agent-definition space, permission / policy integration, continuation (`SendMessage` / resume), and richer output schema are where HLVM is still materially behind.
- **Do not use the word "equivalent" without the matrix qualifier**. The common execution path is close; the full production agent surface is not yet at CC parity.

## A.3 Control-flow overview

```
USER prompt
   │
   ▼
BRAIN (runReActLoop in orchestrator.ts)
   │   - sees `Agent` tool in its toolset
   │   - tool description lists Explore / Plan / general-purpose + any
   │     `.hlvm/agents/*.md` custom agents (dynamic spec)
   │   - LLM decides which agent (no regex) and emits a tool call
   ▼
Agent({ subagent_type, description, prompt, ... })
   │
   ▼
agent-tool.ts  (dispatcher)
   1. parse & normalize input (boolean coercion for run_in_background)
   2. loadAgentDefinitions()     → built-in + .hlvm/agents merge
   3. resolve subagent_type      → AgentDefinition (or error)
   4. assemble child tool pool   → filterToolsForAgent + resolveAgentTools
   5. build InheritedAgentConfig → modelTier, timeouts, querySource, etc.
   6. optional: createAgentWorktree(agentId)
   7. route:
        - sync    → await runAgent(...)               → AgentToolResult
        - async   → fire-and-forget Promise           → AgentAsyncResult
                   - push to backgroundAgents Map
                   - on done: enqueue completion msg
   8. emit AgentUIEvent: agent_spawn / agent_progress / agent_complete
   │
   ▼
run-agent.ts  (child loop wrapper)
   - new ContextManager()        (isolated message history)
   - resolve tools list
   - resolve model (modelOverride or inherited)
   - build child OrchestratorConfig (maxTurns = agentDef.maxTurns ||
     AGENT_MAX_TURNS = 200)
   - call runReActLoop(prompt, childConfig, childLLM)
   - tap onAgentEvent to forward child events → parent progress counter
   - return AgentLoopResult → shaped into AgentToolResult
   │
   ▼
Background completion delivery:
   - sync: tool result is in the normal tool-result slot
   - async with sessionId: enqueueCompletionNotification() persists a
     synthetic user message immediately
   - async without sessionId: notification text is appended to
     completionQueue
   - current caveat: no production queue-drain consumer is present in
     this tree outside tests, so the queue path is not equivalent to CC's
     normal notification re-entry behavior
```

## A.4 Agent tool contract

### Input (`AgentToolInput` — `src/hlvm/agent/tools/agent-types.ts`)

| Field               | Required | Notes                                             |
| ------------------- | -------- | ------------------------------------------------- |
| `description`       | yes      | Short 3–5 word task title shown in TUI            |
| `prompt`            | yes      | Full task for the child                           |
| `subagent_type`     | no       | Defaults to `general-purpose`                     |
| `model`             | no       | Model override for child                          |
| `run_in_background` | no       | Bool; coerce `"true"`→`true` (see A.10)           |
| `isolation`         | no       | Only `"worktree"` is supported                    |
| `cwd`               | no       | Absolute workspace override for child             |

### Output union (`AgentToolOutput`)

```ts
AgentToolResult  { status: "completed",      agentId, agentType,
                   content, totalDurationMs, totalToolUseCount,
                   totalTokens, worktreePath?, worktreeBranch? }

AgentAsyncResult { status: "async_launched", agentId, description,
                   prompt, outputFile }
```

`outputFile` is under `getHlvmTasksDir()` (`~/.hlvm/tasks/…`). The REPL's
Background Tasks overlay reads that directory.

### Agent definition (`BaseAgentDefinition`)

Current HLVM type surface in `agent-types.ts`:

| Field             | Purpose                                                    |
| ----------------- | ---------------------------------------------------------- |
| `agentType`       | Identifier string                                          |
| `whenToUse`       | Description shown to the brain for selection               |
| `tools`           | `undefined` or `["*"]` = all; otherwise explicit allowlist |
| `disallowedTools` | Explicit deny list (applied after allow)                   |
| `model`           | Model override; `"inherit"` uses parent's                  |
| `maxTurns`        | Child's ReAct iteration limit                              |
| `source`          | `"built-in" \| "user" \| "project"`                        |
| `baseDir`         | Dir of the `.md` file (custom only)                        |
| `getSystemPrompt` | `() => string` — lazy                                      |
| `background`      | Always run as background task                              |
| `isolation`       | `"worktree"` to force worktree                             |
| `omitClaudeMd`    | Skip project CLAUDE.md context                             |
| `permissionMode`  | Override permission mode for child                         |
| `initialPrompt`   | Sticky prompt prepended to every invocation                |
| `mcpServers`      | Array of ref strings or inline `{ name: config }` records  |

CC has additional production-facing fields not currently implemented in
HLVM's `BaseAgentDefinition`, including `skills`, `hooks`, `effort`,
`requiredMcpServers`, and the wider source / color / memory surfaces
described in the matrix above.

## A.5 Built-in agents

| Agent             | Tools                          | Model      | Role                                   |
| ----------------- | ------------------------------ | ---------- | -------------------------------------- |
| `general-purpose` | `["*"]`                        | inherit    | Default; arbitrary multi-step tasks    |
| `Explore`         | all − `edit_file`,`write_file` | inherit*   | Read-only codebase search specialist   |
| `Plan`            | all − `edit_file`,`write_file` | inherit    | Read-only design/architecture planner  |

`*` CC's Explore uses Haiku by default for speed; HLVM currently
inherits the parent's model (documented divergence — fine to switch to
a small model explicitly via the `model` field if bench justifies it).

System prompts are **copied near-verbatim** from CC
(`tools/AgentTool/built-in/{explore,plan,generalPurposeAgent}.ts`).
The key bit in Explore/Plan is the `"READ-ONLY MODE — NO FILE
MODIFICATIONS"` block: this is what makes tool isolation observably
effective even when the child has shell_exec.

Registry: `src/hlvm/agent/tools/built-in-agents.ts`.

## A.6 Custom agents (`.hlvm/agents/*.md`)

Loaded by `agent-definitions.ts` from two dirs:

- User: `~/.hlvm/agents/`
- Project: `<workspace>/.hlvm/agents/`

Format (frontmatter + body):

```markdown
---
name: security-auditor
description: Audit code for common vulnerabilities
tools: [read_file, search_code, list_files]
disallowedTools: [shell_exec]
maxTurns: 100
model: inherit
mcpServers:
  - existing-ref-name
  - inline-server:
      command: /usr/local/bin/foo
      args: ["--flag"]
---

You are a security auditor. Inspect the given code for SQL injection,
XSS, and authz bypass. Report findings as structured bullets.
```

Parser details:

- YAML frontmatter (`---` fences) is parsed by the shared frontmatter util
- `name` → `agentType`
- `description` → `whenToUse`
- Only the explicit HLVM subset is parsed into the returned definition
- File read failures are recorded in `loadAgentDefinitions().failedFiles[]`
- Malformed YAML / invalid frontmatter are **not** surfaced as cleanly as CC:
  they can currently collapse to `meta: null` and be skipped silently

## A.7 Tool resolution algorithm

Two-pass, same broad shape as CC but not identical. See
`agent-tool-utils.ts`.

```
Input: all tools from registry + AgentDefinition + isAsync flag
 ─────────────────────────────────────────────────────────────
 Pass 1: filterToolsForAgent()
   keep  if mcp__*                     (MCP tools always allowed)
   drop  if ALL_AGENT_DISALLOWED_TOOLS (ask_user, complete_task, Agent)
   drop  if custom && in CUSTOM_AGENT_DISALLOWED_TOOLS
   when isAsync, restrict to ASYNC_AGENT_ALLOWED_TOOLS

 Pass 2: resolveAgentTools()
   remove  tools in agentDef.disallowedTools
   when    tools == ["*"] || undefined → keep survivors
   else                                → intersect with agentDef.tools
```

Current deltas vs CC:

- HLVM does **not** thread `permissionMode` into `filterToolsForAgent()`
- HLVM does **not** support `allowedAgentTypes` metadata on `Agent(...)`
  tool specs
- HLVM does **not** special-case CC's plan-mode `ExitPlanMode` allowance

Constants: `agent-constants.ts`.

- `AGENT_TOOL_NAME = "Agent"`
- `AGENT_MAX_TURNS = 200`
- `ALL_AGENT_DISALLOWED_TOOLS = { ask_user, complete_task, Agent }`
- `CUSTOM_AGENT_DISALLOWED_TOOLS` = same (for now)
- `ASYNC_AGENT_ALLOWED_TOOLS` = explicit allowlist of safe tools
- `ONE_SHOT_AGENT_TYPES = { Explore, Plan }` — skip continuation trailer

## A.8 Async / background execution

Runtime state is a process-global Map keyed off `globalThis`:

```ts
__hlvmAgentToolRuntimeState__ : {
  backgroundAgents: Map<agentId, BackgroundAgent>,
  agentCounter:     number,
  completionQueue:  string[],      // notification messages to inject
}
```

Lifecycle:

1. `Agent({..., run_in_background: true})` returns immediately with
   `{ status: "async_launched", agentId, outputFile }`.
2. Child runs via `runAgent()` in a detached promise; output is
   streamed line-by-line to `outputFile` under `~/.hlvm/tasks/`.
3. If `sessionId` is present, completion is persisted immediately into
   the session transcript as a synthetic user message with
   `sender_detail = "task-notification"`.
4. If `sessionId` is absent, the notification text is pushed into
   `completionQueue`.
5. The REPL's Background Tasks overlay reads the same task dir; see
   `src/hlvm/cli/repl-ink/components/BackgroundTasksOverlay.tsx`.

> **Important**: the queued-notification path is narrower than CC right
> now. `completionQueue` exists, but no production consumer drains it in
> the current tree outside tests.

> **Why globalThis?** Singletons across dynamically imported modules
> (the circular-dep workaround — see A.10). CC uses a module-scoped
> singleton; HLVM needs globalThis because the registry imports
> `AGENT_TOOL_METADATA` dynamically. Acceptable tradeoff.

## A.9 Worktree isolation

`agent-worktree.ts` wraps `git worktree`:

```
createAgentWorktree(agentId)
  → git worktree add .hlvm/worktrees/<agentId> \
        -B worktree-<agentId> HEAD
  → return { path, branch, headCommit }

hasWorktreeChanges(path, headCommit)
  → git status --porcelain          (any uncommitted changes?)
  → git rev-list --count HEAD..HEAD (any new commits vs parent head?)

cleanupWorktree(info)
  → only if no changes — otherwise keep and return path to parent
```

The child runs with `cwd = worktree.path`. On completion:

- **No changes** → worktree is removed, branch is deleted.
- **Any changes** → worktree is kept; `AgentToolResult` includes
  `worktreePath` / `worktreeBranch` so the parent (or user) can
  inspect/merge.

## A.10 Critical pitfalls (read before editing)

### 1. Circular dependency: registry ↔ agent-tool

`agent-tool.ts` is imported by `registry.ts` (to register the tool),
and `agent-tool.ts` needs `getAllTools()` from `registry.ts` to build
the child tool pool.

Solution in current code — **do not break it**:

- `agent-tool-metadata.ts` exports static metadata only; imported by
  `registry.ts` directly.
- `agent-tool.ts` imports `registry.ts` types at top level but calls
  `getAllTools()` via `await import("../registry.ts")` at call-time.
- `agent-tool-metadata.ts` delegates its `function` field back to
  `agent-tool.ts` via dynamic import.

### 2. String-vs-boolean coercion from LLM

Providers sometimes serialize booleans as strings. In `agent-tool.ts`
the dispatcher treats both as truthy:

```ts
const isAsync =
  input.run_in_background === true || input.run_in_background === "true";
```

Apply the same pattern to any new boolean field.

### 3. Serve process identity during E2E

`hlvm ask` talks to a serve process on `:11435`. If the serve was
started from a different repo / older build, you see
`Cannot read properties of undefined (reading 'type')` or
`Hint: Restart HLVM so the client and runtime host use the same build`.

Always:

```bash
kill $(lsof -ti:11435) 2>/dev/null; sleep 1
deno run -A --no-check src/hlvm/cli/cli.ts serve &
sleep 5
# then: hlvm ask ...
```

### 4. Nuke regressions

The legacy team/delegation nuke removed code that other modules still
referenced (commit `a7326216`). The fix-up is already landed, but
**if the runtime crashes on a trivial prompt** after any major refactor,
first suspect a missing import somewhere in the orchestrator or
registry — not a logic bug in the Agent tool.

### 5. CC = async generator, HLVM = return string

`runReActLoop()` returns a final string; CC's `query()` yields a stream
of messages. Consequences:

- HLVM **cannot** mid-turn transition sync→async.
- HLVM **cannot** record per-message sidechain transcripts.
- HLVM approximates child progress via `onAgentEvent` counting.

If a future task requires real-time streaming from child to parent,
this is the interface to change first. It is not a small change.

### 6. `docs/vision/` is gitignored

`docs/vision/agent-system-handoff.md` is the long-form design diary
(not committed). This appendix is the committed SSOT. If the two drift,
this appendix wins.

## A.11 File inventory (verified 2026-04-18)

### New (sub-agent system core)

```
src/hlvm/agent/tools/
├── agent-tool.ts              743  Dispatcher           (CC: AgentTool.tsx)
├── run-agent.ts               314  Child loop wrapper   (CC: runAgent.ts)
├── agent-definitions.ts       359  .md loading          (CC: loadAgentsDir.ts)
├── agent-worktree.ts          289  Git worktree         (CC: utils/worktree.ts)
├── agent-types.ts             165  Type hierarchy
├── agent-tool-utils.ts        158  Tool resolution      (CC: agentToolUtils.ts)
├── agent-tool-metadata.ts      90  Circular-dep bridge
├── agent-prompt.ts             85  Brain-facing listing (CC: prompt.ts)
├── agent-constants.ts          71  Limits, disallow lists
├── agent-tool-spec.ts          51  Dynamic tool spec
├── built-in-agents.ts          24  Registry of built-ins
└── built-in/
    ├── plan.ts                 80  Plan system prompt
    ├── explore.ts              62  Explore system prompt
    └── general.ts              42  general-purpose prompt
```

### Wiring (modified)

```
src/hlvm/agent/registry.ts                     # Agent tool registration
src/hlvm/agent/orchestrator.ts                 # agent_spawn/progress/complete events
src/hlvm/agent/orchestrator-tool-execution.ts  # llmFunction threading to tools
src/hlvm/agent/engine.ts                       # workspace field on AgentLLMConfig
src/hlvm/agent/engine-sdk.ts                   # model override support
src/hlvm/agent/llm-integration.ts              # dynamic tool descriptions
src/hlvm/agent/session.ts                      # dynamic descriptions into prompt
src/hlvm/cli/agent-transcript-state.ts         # TUI event reducer
src/hlvm/cli/commands/ask.ts                   # --print agent display
src/hlvm/cli/repl/handlers/chat-agent-mode.ts  # agent event transport
src/hlvm/runtime/chat-protocol.ts              # agent event NDJSON types
src/hlvm/runtime/host-client.ts                # agent event parsing
src/hlvm/cli/repl-ink/components/App.tsx       # background-agent polling
src/hlvm/cli/repl-ink/components/BackgroundTasksOverlay.tsx
```

### Tests

```
tests/unit/agent/
├── agent-system.test.ts          722  unit: constants, types, tool resolution,
│                                      built-ins, .md parsing, prompt generation
├── agent-integration.test.ts    1549  integration: runAgent, tool fn, async,
│                                      worktree end-to-end, notifications
├── agent-worktree.test.ts        305  worktree create/detect/cleanup/slugs
├── agent-tui.test.ts             464  TUI state: spawn→progress→complete,
│                                      transcript expand, multiple agents
└── (plus agent-registry / agent-runner-engine / agent-runtime-composition)
```

## A.12 Agent events (for TUI / NDJSON consumers)

Emitted by `orchestrator.ts`; typed in its `AgentUIEvent` union:

| Event            | Fields                                                         |
| ---------------- | -------------------------------------------------------------- |
| `agent_spawn`    | `agentId`, `agentType`, `description`, `isAsync`               |
| `agent_progress` | `agentId`, `agentType`, `toolUseCount`, `durationMs`           |
| `agent_complete` | `agentId`, `agentType`, `success`, `durationMs`, `toolUseCount`, `totalTokens?`, `resultPreview?`, `transcript?` |

TUI reducer (`agent-transcript-state.ts`) renders these as the
`⏺ Agent(…) "…"` / `⎿ In progress… · n tool uses · Xs` tree.

## A.13 Verify commands

```bash
# Unit tests (no serve, no autostart)
HLVM_DISABLE_AI_AUTOSTART=1 deno test --allow-all \
  tests/unit/agent/agent-system.test.ts \
  tests/unit/agent/agent-integration.test.ts \
  tests/unit/agent/agent-worktree.test.ts \
  tests/unit/agent/agent-tui.test.ts

# SSOT (required, zero errors)
deno task ssot:check

# E2E smoke through the user path
kill $(lsof -ti:11435) 2>/dev/null; sleep 1
deno run -A --no-check src/hlvm/cli/cli.ts serve & ; sleep 5
deno run -A --no-check src/hlvm/cli/cli.ts ask \
  --model claude-code/claude-haiku-4-5-20251001 \
  --print --verbose --permission-mode dontAsk \
  'Use the Agent tool with subagent_type Explore to find test files'

# Interactive REPL (visual TUI check)
deno run -A --no-check src/hlvm/cli/cli.ts
```

Do **not** run `deno task test:unit` unless explicitly asked — this is a
multi-agent repo; full-suite runs stomp on other agents' WIP.

## A.14 What to pick up next (prioritised)

1. **Single SSOT for agent description.** The brain-facing description
   is currently computed in three places: `agent-prompt.ts`,
   `agent-tool-spec.ts`, `agent-tool-metadata.ts`. Consolidate.
2. **Trim `agent-tool.ts`.** At 743 LOC it is the largest file in the
   module and carries three concerns (dispatch, background bookkeeping,
   MCP-per-agent loading). Split along those seams.
3. **Drop the `globalThis` runtime state.** Only required by the
   circular-dep workaround; replace with a module-scoped singleton
   once the circular dep is re-factored out.
4. **Explore → Haiku by default.** CC's performance story relies on
   this; today HLVM inherits the parent's model. Flag it through
   `agentDefinition.model` on the built-in, behind a settings-based
   default that falls back to `inherit` when unavailable.
5. **Mid-turn sync→async ("auto-background" ≥ 2s).** CC's
   `PROGRESS_THRESHOLD_MS` — requires changing the orchestrator's
   return shape from `Promise<string>` to an async-iterable.
6. **Per-message sidechain transcripts.** Same blocker as #5.
7. **Small-terminal TUI density pass** for the Background Tasks overlay
   and the `⏺ Agent` lines (text overlap currently observed on narrow
   widths in interactive REPL).

## A.15 CC → HLVM source map (for quick cross-reads)

```
CC path                                       HLVM path
────────────────────────────────────────────  ───────────────────────────────────────────
tools/AgentTool/AgentTool.tsx                 src/hlvm/agent/tools/agent-tool.ts
tools/AgentTool/runAgent.ts                   src/hlvm/agent/tools/run-agent.ts
tools/AgentTool/agentToolUtils.ts             src/hlvm/agent/tools/agent-tool-utils.ts
tools/AgentTool/loadAgentsDir.ts              src/hlvm/agent/tools/agent-definitions.ts
tools/AgentTool/builtInAgents.ts              src/hlvm/agent/tools/built-in-agents.ts
tools/AgentTool/built-in/exploreAgent.ts      src/hlvm/agent/tools/built-in/explore.ts
tools/AgentTool/built-in/planAgent.ts         src/hlvm/agent/tools/built-in/plan.ts
tools/AgentTool/built-in/generalPurposeAgent  src/hlvm/agent/tools/built-in/general.ts
tools/AgentTool/prompt.ts                     src/hlvm/agent/tools/agent-prompt.ts
tools/AgentTool/constants.ts                  src/hlvm/agent/tools/agent-constants.ts
tools/AgentTool/UI.tsx                        src/hlvm/cli/agent-transcript-state.ts
tools/AgentTool/utils/worktree.ts             src/hlvm/agent/tools/agent-worktree.ts
```

Read the CC file alongside the HLVM file when in doubt — naming and
algorithm were kept deliberately close to make diffing painless.
