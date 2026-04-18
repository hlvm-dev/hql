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

> **Audience:** a GenAI agent with zero prior conversation context who needs to
> pick up work on HLVM's sub-agent system. Compact by design. Sections are
> fact tables, not prose.
> **Last verified:** 2026-04-18 on branch `feat/nuke-cc-harness`.
> **CC reference tree:** `~/dev/ClaudeCode-main/tools/AgentTool/`
> **CC CLI for behavioral comparison:** `claude` (version 2.1.112 at time of
> write); run `claude -p --output-format stream-json --verbose --model haiku`
> to capture the event stream.

## A.1 Scope

**In scope — non-experimental CC production surface:**
single `Agent` tool (LLM-driven dispatch); built-ins `Explore`, `Plan`,
`general-purpose`; custom agents from `~/.hlvm/agents/*.md` and
`<workspace>/.hlvm/agents/*.md`; sync + async (`run_in_background: true`)
execution; worktree isolation (`isolation: "worktree"`); per-agent MCP;
per-agent tool allow/deny; TUI lifecycle (`agent_spawn/progress/complete`).

**Out of scope — CC features HLVM does not implement:**
fork subagent, Agent Teams / Swarm, Resume background agent, Coordinator
mode, auto-background (2s foreground→background race), remote isolation,
DiscoverSkills guidance, scratchpad, auto-memory snapshots, Managed Agents
API, plugin agents, JSON agents in settings.json. All of these are either
gated by CC-internal feature flags or depend on CC-internal runtime
(`query()` async generator, React app state, sidechain transcripts).

**Rule for additions:** if a CC feature lives behind `feature(...)` in CC
source or depends on CC-internal infra, it is out of scope by default.

## A.2 Verdict — CC-faithful on the applicable surface

**Side-by-side observed outcome (2026-04-18):** same prompt through real
CC 2.1.112 and HLVM both returned byte-identical answer. Agent tool
interface, built-in agent types (`Explore`/`Plan`/`general-purpose`), and
flow shape (parent → Agent → child → tools → result → parent) match.

| Dimension | Status |
|---|---|
| Tool name + schema (`description`/`prompt`/`subagent_type`/`model`/`run_in_background`/`isolation`/`cwd`) | same |
| Agent discovery (user + project `.md`, built-in priority) | same |
| Spawn flow (validate → resolve def → resolve tools → build system prompt → isolate context → run → result) | same |
| Child system prompt (`[agentPrompt, notes, envInfo]` with verbatim CC `Notes:` text and `<env>` block) | same |
| Tool filtering (MCP → universal disallow → custom disallow → async allowlist → wildcard/explicit) | same |
| `disallowedTools` + `tools` spec parsing (`"Tool"` / `"Tool(pattern)"` / `"Tool(*)"` / escaped parens) | same |
| Worktree isolation (`.hlvm/worktrees/{slug}`, branch `worktree-{slug}`, cleanup-on-clean) | same |
| Sync result shape (`status`, `agentId`, `agentType`, `prompt`, `content`, `totalDurationMs`, `totalToolUseCount`, `totalTokens`, `worktreePath?`, `worktreeBranch?`) | same |
| Async result shape (`status: "async_launched"`, `agentId`, `description`, `prompt`, `outputFile`, `canReadOutputFile`) | same |
| ONE_SHOT trailer stripping for Explore/Plan | same |
| Error handling (wrapped into `AgentLoopResult` with `stopReason`, not thrown to parent) | same |
| Observer event stream wire format | different (CC: per-message JSON events; HLVM: aggregated `agent_spawn/progress/complete` events). Same semantic information; parent LLM sees only final result in both. |

**Score on applicable surface: outcome-equivalent to CC.**

## A.3 File inventory

| HLVM file | Role | CC counterpart |
|---|---|---|
| `src/hlvm/agent/tools/agent-tool.ts` | Tool facade, sync/async dispatch, completion notifications | `tools/AgentTool/AgentTool.tsx` |
| `src/hlvm/agent/tools/run-agent.ts` | Execution loop wrapping `runReActLoop` | `tools/AgentTool/runAgent.ts` |
| `src/hlvm/agent/tools/agent-tool-utils.ts` | `filterToolsForAgent`, `resolveAgentTools` | `tools/AgentTool/agentToolUtils.ts` |
| `src/hlvm/agent/tools/agent-definitions.ts` | Frontmatter parse + directory load | `tools/AgentTool/loadAgentsDir.ts` |
| `src/hlvm/agent/tools/agent-prompt.ts` | Tool description shown to parent LLM | `tools/AgentTool/prompt.ts` |
| `src/hlvm/agent/tools/agent-types.ts` | `AgentDefinition`, `AgentToolResult`, `AgentAsyncResult` | `tools/AgentTool/AgentTool.tsx` schemas |
| `src/hlvm/agent/tools/agent-constants.ts` | `AGENT_TOOL_NAME`, `ALL_AGENT_DISALLOWED_TOOLS`, `ASYNC_AGENT_ALLOWED_TOOLS`, `ONE_SHOT_AGENT_TYPES` | `tools/AgentTool/constants.ts` + `constants/tools.ts` |
| `src/hlvm/agent/tools/agent-worktree.ts` | Git worktree creation/cleanup | `tools/AgentTool/utils/worktree.ts` |
| `src/hlvm/agent/tools/agent-tool-metadata.ts` | `formatResult` for sync/async results (ONE_SHOT trailer stripping) | `tools/AgentTool/AgentTool.tsx` formatter |
| `src/hlvm/agent/tools/agent-tool-spec.ts` | Tool arg spec (SSOT for description shown to parent) | inline in CC `AgentTool.tsx` |
| `src/hlvm/agent/tools/prompt-env.ts` | `enhanceSystemPromptWithEnvDetails` + `computeEnvInfo` (CC-faithful port) | `constants/prompts.ts:606,760` |
| `src/hlvm/agent/tools/permission-rule.ts` | `permissionRuleValueFromString` (CC-faithful port) | `utils/permissions/permissionRuleParser.ts:93` |
| `src/hlvm/agent/tools/built-in/{general,explore,plan}.ts` | Built-in agent definitions | `tools/AgentTool/built-in/*.ts` |
| `src/hlvm/agent/tools/built-in-agents.ts` | `getBuiltInAgents()` registry | `tools/AgentTool/builtInAgents.ts` |

## A.4 Tool arg contract (identical to CC)

```ts
{
  description: string,        // 3-5 word task summary
  prompt: string,             // the task
  subagent_type?: string,     // "Explore" | "Plan" | "general-purpose" | custom agent name. Defaults to "general-purpose".
  model?: string,             // override, e.g. "claude-haiku-4-5-20251001" or "inherit"
  run_in_background?: boolean,
  isolation?: "worktree",
  cwd?: string,               // mutually exclusive with isolation
}
```

## A.5 Result shapes

```ts
// Sync completion (returned after child finishes)
interface AgentToolResult {
  status: "completed";
  agentId: string;
  agentType: string;
  prompt: string;              // echo of the prompt sent to the child
  content: string;             // child's final text
  totalDurationMs: number;
  totalToolUseCount: number;
  totalTokens: number;
  worktreePath?: string;
  worktreeBranch?: string;
}

// Async launch (returned immediately when run_in_background: true)
interface AgentAsyncResult {
  status: "async_launched";
  agentId: string;
  description: string;
  prompt: string;
  outputFile: string;          // ~/.hlvm/tasks/{agentId}.output
  canReadOutputFile?: boolean; // true iff parent has read_file or shell_exec
}
```

## A.6 Tool filtering algorithm (mirrors CC `agentToolUtils.ts:70-116`)

1. Allow MCP tools (prefix `mcp__`) unconditionally.
2. Drop tools in `ALL_AGENT_DISALLOWED_TOOLS` (currently `ask_user`, `complete_task`, `Agent`).
3. If not a built-in agent, also drop tools in `CUSTOM_AGENT_DISALLOWED_TOOLS`.
4. If async, restrict to `ASYNC_AGENT_ALLOWED_TOOLS` allowlist.
5. Apply the agent's `disallowedTools` (parsed via `permissionRuleValueFromString` — `"Tool(pattern)"` blocks the whole tool, same as CC).
6. If `tools` is `undefined` or `["*"]` → allow all remaining; else resolve explicit list against remaining (specs accept `"Tool(pattern)"` form; `toolName` is extracted and matched).

## A.7 Child system prompt construction (mirrors CC `runAgent.ts:918`)

```ts
const enhanced = await enhanceSystemPromptWithEnvDetails(
  [agentDefinition.getSystemPrompt(...)],
  effectiveModel,
  undefined,
  new Set(resolvedTools.keys()),
);
// enhanced = [agentPrompt, notes, envInfo]
```

`notes` is **verbatim** from CC `constants/prompts.ts:766-770` (absolute paths, no emojis, no colon before tool calls).
`envInfo` uses the **verbatim** `<env>...</env>` block shape from CC `computeEnvInfo` (prompts.ts:606), with cwd, git status, platform, shell, OS version, model description, knowledge cutoff.

## A.8 Worktree isolation

Creation path `<gitRoot>/.hlvm/worktrees/agent-<slugHash>` (flatten `/`→`+`),
branch `worktree-{slug}`, `git worktree add -B branch path HEAD`. On
completion: if clean (via `git status --porcelain` + `git rev-list`) →
remove worktree + branch; else return `{worktreePath, worktreeBranch}` in
the result.

## A.9 Async / background

`run_in_background: true` → write progress to `~/.hlvm/tasks/{agentId}.output`,
return `AgentAsyncResult` immediately, execute via `setTimeout(..., 0)` to
detach from parent turn. On completion, the next parent turn receives a
synthetic user message with status via
`drainCompletionNotifications()`.

## A.10 Default model routing

`@auto` routes through `src/hlvm/agent/auto-select.ts`. Key fix (commit
`318951b0`): tiny local models (`gemma\d+:e[12]b`) are rated `weak` coding
strength, which excludes them from the `strong` filter when any mid/strong
cloud model is eligible. With the user's `claude-code` OAuth token in the
Keychain, `@auto` now resolves to
`claude-code/claude-haiku-4-5-20251001:agent`.

Override at any time with `--model claude-code/claude-haiku-4-5-20251001`.
Local `gemma4:e2b` remains the last-resort fallback when no cloud model
is available.

## A.11 Recent commits (newest first)

| SHA | Summary |
|---|---|
| `13c01c4d` | port `permissionRuleValueFromString` + add `prompt` echo to sync result |
| `c9b16d80` | `canReadOutputFile` on async result; strip provenance comments; codify no-comment rule in `AGENTS.md` |
| `fae6e7cb` | surface frontmatter parse failures via `failedFiles[]` |
| `878a4bf9` | CC-faithful port of `enhanceSystemPromptWithEnvDetails` |
| `7f704bd5` | stop concatenating `initialPrompt` into sub-agent user message |
| `318951b0` | demote tiny local models (`gemma*:e[12]b`) to weak in `auto-select` |

## A.12 Verify commands

```bash
# Unit tests (agent domain only — never run full suite per AGENTS.md)
HLVM_DISABLE_AI_AUTOSTART=1 deno test --allow-all --no-check tests/unit/agent/
# Expected: 1070+ passed, 0 failed

# SSOT check
deno task ssot:check
# Expected: "No errors found." (~160 warnings is baseline, unchanged)

# Live E2E with Haiku
timeout 120 deno run -A --no-check src/hlvm/cli/cli.ts ask --verbose \
  --model 'claude-code/claude-haiku-4-5-20251001' \
  "Use the Agent tool with subagent_type=Explore to find the absolute path of agent-types.ts under src/hlvm/agent/. Return only the path."
# Expected: /Users/.../src/hlvm/agent/tools/agent-types.ts

# Side-by-side against real CC
echo "Use the Agent tool with subagent_type=Explore to find..." | \
  claude -p --output-format stream-json --verbose --model haiku --dangerously-skip-permissions > /tmp/cc-stream.json
# Compare the final `result` field with HLVM's output above.
```

## A.13 Known gaps (outside in-scope bar)

Do NOT implement these without an explicit ask — they are either CC
experimental, CC-only infra, or HLVM-architecturally-different:

- Fork subagent (CC `forkSubagent.ts`) — depends on CC `query()` generator
  and buildForkedMessages; no HLVM analog for cache-identical prefix reuse.
- In-process teammates, SendMessage, Task tools coordination — CC swarm
  feature, gated on `isAgentSwarmsEnabled()`.
- Resume background agent — depends on CC sidechain transcripts and
  `recordSidechainTranscript`/session storage.
- Auto-background (2s foreground → background race) — depends on CC's
  React app state.
- Remote isolation (`isolation: "remote"`) — depends on CC remote agent
  server.
- DiscoverSkills / skill preload (`feature('EXPERIMENTAL_SKILL_SEARCH')`) —
  HLVM has no skills concept.
- Scratchpad guidance (`isScratchpadEnabled()`) — experimental in CC.
- Auto-memory snapshots (`isAutoMemoryEnabled()`) — experimental in CC.
- JSON agents in `settings.json`, plugin agents — HLVM has neither surface.

## A.14 Rules for the next agent

1. **Never** write provenance/port-source comments in code (e.g. "CC parity:
   foo.ts:123"). See `AGENTS.md § Comments`.
2. Run only `tests/unit/agent/*.test.ts` — never `deno task test:unit` full
   suite.
3. Before changing `disallowedTools` / `tools` parsing: read
   `src/hlvm/agent/tools/permission-rule.ts` and the CC parser at
   `~/dev/ClaudeCode-main/utils/permissions/permissionRuleParser.ts` — both
   should return the same shape for the same input.
4. If the child agent appears to "work but return 0 tool uses", the cause
   is almost always model capability (`gemma4:e2b` can't drive tool loops),
   not the agent system. Verify by forcing `--model claude-code/claude-haiku-4-5-20251001`.
5. When in doubt about CC behavior, run real CC with `-p --output-format
   stream-json` and compare the event stream directly. Source reading alone
   misses runtime behavior.

## A.15 Test fixture helpers (internal, for reference)

- `tests/unit/agent/agent-system.test.ts` — parser, filter, resolve unit tests
- `tests/unit/agent/agent-integration.test.ts` — end-to-end runAgent harness via `mockToolRegistry` + `LLMFunction` stub
- `tests/unit/agent/agent-worktree.test.ts` — worktree create/cleanup
- `tests/unit/agent/agent-tui.test.ts` — TUI reducer state for `agent_spawn/progress/complete` events
