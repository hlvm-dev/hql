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
- If you touch agent routing or `@auto`, read `docs/route/auto.md` and
  `docs/vision/single-binary-local-ai.md` first

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
           │   - Policy + tool init             │
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
├── hooks.ts                     # Lifecycle hooks runtime
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
├── instructions.ts              # Instruction hierarchy
├── types.ts                     # PromptMode, InstructionHierarchy
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
- `shouldReuseAgentSession()` — Policy check for reuse eligibility
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
| `policy`                | `AgentPolicy`          | Safety + permission policy            |
| `profile`               | `ENGINE_PROFILES[key]` | Engine profile (normal/strict config) |
| `modelTier`             | `ModelTier`            | `"weak"` / `"mid"` / `"frontier"`     |
| `isFrontierModel`       | `boolean`              | API-hosted or large context           |
| `thinkingCapable`       | `boolean`              | Extended thinking support             |
| `instructions`          | `InstructionHierarchy` | Global + project instructions         |
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
| `renderCustomInstructions()`      | weak     | Project `.hlvm/HLVM.md` instructions |
| `renderExamples()`                | mid      | Usage examples                       |
| `renderTips()`                    | weak     | General tips                         |
| `renderFooter()`                  | weak     | Closing notes                        |

### Instruction Hierarchy

```typescript
// src/hlvm/prompt/types.ts
interface InstructionHierarchy {
  global: string; // Content from ~/.hlvm/HLVM.md (required)
  project: string; // Content from <workspace>/.hlvm/HLVM.md (required, empty if untrusted)
  projectPath?: string; // Workspace path if project instructions were attempted
  trusted: boolean; // Whether the workspace is trusted
}
```

Trust registry: `~/.hlvm/trusted-workspaces.json`

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
├── instructions.test.ts         # Instruction hierarchy tests

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
~/.hlvm/HLVM.md                 # Global instructions
~/.hlvm/trusted-workspaces.json # Trust registry
~/.hlvm/memory/                 # Memory database
<workspace>/.hlvm/HLVM.md       # Project instructions
<workspace>/.hlvm/agents/       # Custom agent profiles
```
