# HLVM vs Claude Code: Full Architecture Comparison

> **Purpose**: This document captures a comprehensive reverse-engineering analysis of Claude Code's architecture (leaked via npm source maps, March 2026) compared to HLVM's architecture. It is written so that **any AI agent with zero prior context** can pick it up and understand both systems end-to-end — including where HLVM should adopt patterns from Claude Code, where HLVM is already ahead, and specific implementation details for each subsystem.
>
> **Source**: Claude Code source at `<local-claude-code-dir>/` (extracted from npm source maps). HLVM source at `<hlvm-repo>/`.
>
> **Date**: 2026-04-01

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Entry Points & Bootstrapping](#3-entry-points--bootstrapping)
4. [Core Agent AI Loop](#4-core-agent-ai-loop)
5. [Tool System](#5-tool-system)
6. [Context Management & Compaction](#6-context-management--compaction)
7. [TUI / React Ink Architecture](#7-tui--react-ink-architecture)
8. [State Management](#8-state-management)
9. [Memory System](#9-memory-system)
10. [Multi-Agent / Teams](#10-multi-agent--teams)
11. [Permission & Safety System](#11-permission--safety-system)
12. [Error Handling & Retry](#12-error-handling--retry)
13. [Hooks & Extensibility](#13-hooks--extensibility)
14. [Skills / Plugins](#14-skills--plugins)
15. [Cost & Usage Tracking](#15-cost--usage-tracking)
16. [Engine / Provider Abstraction](#16-engine--provider-abstraction)
17. [MCP Integration](#17-mcp-integration)
18. [Gaps: What CC Has That HLVM Doesn't](#18-gaps-what-cc-has-that-hlvm-doesnt)
19. [Advantages: What HLVM Has That CC Doesn't](#19-advantages-what-hlvm-has-that-cc-doesnt)
20. [Recommended Adoption Priorities](#20-recommended-adoption-priorities)
21. [ASCII Pipeline Diagrams](#21-ascii-pipeline-diagrams)
22. [SDK & Library Usage Comparison](#22-sdk--library-usage-comparison)

---

## 1. Executive Summary

Both Claude Code (CC) and HLVM are AI-powered CLI coding agents built with React Ink for TUI rendering. They share the same fundamental **ReAct loop** pattern (Think -> Act -> Observe -> Repeat) and many of the same subsystems.

**Key differences**:

| Dimension | Claude Code | HLVM |
|-----------|------------|------|
| **Provider support** | Anthropic only | 5 providers (Ollama, OpenAI, Anthropic, Google, Claude Code) via Vercel AI SDK |
| **Codebase maturity** | Production-hardened (error recovery, retry, perf) | Architecturally cleaner (modular splits, metadata-driven) |
| **Tool batching** | Concurrency-safe partitioning (read-only parallel, writes serial) | All tools parallel via `Promise.all()` (no classification) |
| **Context recovery** | Reactive compaction (413 -> compact -> retry), microcompaction, output continuation | Graceful return on overflow (no retry) |
| **Memory** | File-based + Sonnet side-query for relevance | SQLite FTS5 + entity graph (no extra API call) |
| **Multi-agent** | Cross-process (tmux panes, file-backed mailbox) | In-process async loops, in-memory inbox |
| **TUI rendering** | Streaming markdown with split-boundary O(tail), Rust NAPI diffs, per-tool custom UI | Plain text rendering, Paredit input editing, 9 overlay types |
| **Extensibility** | 20+ lifecycle hooks, skills/plugins, feature gates | No user-extensible hooks yet |
| **Distribution model** | Proprietary (Anthropic backend, centralized telemetry) | MIT OSS (no server, fully self-contained) |
| **External deps** | ~65+ npm packages (lodash, axios, OpenTelemetry, Rust NAPI, etc.) | ~22 deps (Deno stdlib preferred, npm only when no alternative) |
| **AI SDK** | `@anthropic-ai/sdk` (Anthropic-only + AWS Bedrock) | Vercel AI SDK `ai@6` (5 providers: Ollama, OpenAI, Anthropic, Google, CC) |

---

## 2. System Architecture Overview

### Claude Code Architecture

```
Entry Points                 Provider Layer              Core Loop
─────────────                ──────────────              ─────────
CLI (cli.tsx)          ┐
IDE Bridge (WebSocket) ├──▶ App.tsx (providers) ──▶ QueryEngine.submitMessage()
SDK (agentSdk.ts)      ┘    ├─ FpsMetricsProvider       └──▶ query() / queryLoop()
                             ├─ StatsProvider                  └──▶ while(true) {
                             └─ AppStateProvider                     pre-API pipeline
                                  └─ REPL.tsx                        API call (streaming)
                                     (actual layout)                  tool execution
                                                                      recovery paths
                                                                    }
```

**Key files**:
- `main.tsx` — Bootstrap: settings, migrations, prefetch git/MCP/plugins
- `replLauncher.tsx` — Ink app initialization
- `QueryEngine.ts` — Conversation lifecycle owner (one instance per conversation)
- `query.ts` — The agentic while(true) loop
- `Tool.ts` — Tool type definition with Zod schemas
- `tools.ts` — Tool pool assembly
- `services/tools/toolOrchestration.ts` — Concurrent/serial batching
- `components/App.tsx` — Provider wrapper (thin)
- `screens/REPL.tsx` — Full TUI layout (~2500 lines)
- `state/store.ts` — Custom external store (NOT Zustand/Redux)
- `utils/messages.ts` — Message normalization for API
- `utils/permissions/permissions.ts` — Multi-layered permission system
- `services/compact/` — Auto/reactive/micro compaction
- `memdir/` — File-based memory with Sonnet side-query
- `coordinator/` — Multi-agent coordinator mode

### HLVM Architecture

```
Entry Points                Transport Layer         Core Loop
─────────────               ───────────────         ─────────
CLI `hlvm ask`        ┐
HTTP/WS Server        ├──▶ agent-runner.ts ──▶ createAgentSession()
GUI (Ink TUI)         ┘    runAgentQuery()        └──▶ runReActLoop()
                            (single SSOT for            while(iter < max) {
                             ALL transports)              pre-LLM injection chain
                                                          LLM call (AI SDK)
                                                          response processing
                                                          tool execution
                                                        }
```

**Key files**:
- `src/hlvm/cli/commands/chat.ts` — CLI entry point
- `src/hlvm/cli/repl/http-server.ts` — WebSocket + HTTP server (923 lines)
- `src/hlvm/agent/agent-runner.ts` — Transport abstraction (1680 lines)
- `src/hlvm/agent/session.ts` — Session creation (472 lines)
- `src/hlvm/agent/orchestrator.ts` — Main ReAct loop (1543 lines)
- `src/hlvm/agent/orchestrator-tool-execution.ts` — Tool execution (1453 lines)
- `src/hlvm/agent/orchestrator-response.ts` — Response processing (1292 lines)
- `src/hlvm/agent/orchestrator-tool-formatting.ts` — Result formatting (680 lines)
- `src/hlvm/agent/orchestrator-llm.ts` — LLM call wrappers (154 lines)
- `src/hlvm/agent/orchestrator-state.ts` — State types (234 lines)
- `src/hlvm/agent/registry.ts` — Tool registry with O(1) lookups (1027 lines)
- `src/hlvm/agent/engine.ts` + `engine-sdk.ts` — Provider abstraction (1097 lines combined)
- `src/hlvm/agent/context.ts` — Token budget management (704 lines)
- `src/hlvm/agent/policy.ts` — Tool permissions (422 lines)
- `src/hlvm/agent/planning.ts` — Plan mode (756 lines)
- `src/hlvm/agent/tools/` — Tool implementations (7359 lines across 10 files)
- `src/hlvm/memory/` — SQLite FTS5 memory system
- `src/hlvm/cli/repl-ink/components/App.tsx` — TUI root (1983 lines)
- `src/hlvm/cli/repl-ink/components/ConversationPanel.tsx` — Message rendering (691 lines)
- `src/hlvm/cli/repl-ink/components/Input.tsx` — Paredit-aware input (3767 lines)

---

## 3. Entry Points & Bootstrapping

### Claude Code

1. `entrypoints/cli.tsx` — CLI bootstrap, calls `main()`
2. `main.tsx::initializeEntrypoint()`:
   - Load settings from disk
   - Run migrations
   - Prefetch git context (parallel)
   - Prefetch MCP servers, plugins, skills (deferred)
3. `replLauncher.tsx::launchRepl()` — Renders React/Ink app
4. `App.tsx` — Nests 3 providers: FpsMetrics, Stats, AppState
5. `screens/REPL.tsx` — The actual TUI layout and orchestration

### HLVM

1. `src/hlvm/cli/commands/chat.ts::chatCommand()` — CLI entry
2. `agent-runner.ts::runAgentQuery()` — **Single entry point for ALL transports** (CLI, HTTP, GUI)
   - Creates or reuses session
   - Loads history if resuming
   - Sets up delegation, plan mode, team runtime
   - Runs `runReActLoop()`
   - Post-loop: structured output, persistence, memory extraction
3. `session.ts::createAgentSession()` — Parallel I/O initialization:
   - `Promise.all([loadAgentPolicy(), tryGetModelInfo()])`
   - `classifyModelTier()` — weak/mid/frontier
   - `compileSystemPrompt()` — 11 modular section renderers
   - Memory injection as separate system message
   - Engine creation via `engine.createLLM()`

**Key pattern difference**: CC has separate paths for CLI/Bridge/SDK that converge at `QueryEngine`. HLVM has a single `runAgentQuery()` that serves all transports — cleaner abstraction.

---

## 4. Core Agent AI Loop

### Claude Code Loop (`query.ts`)

The CC loop is a `while(true)` inside `queryLoop()` with `needsFollowUp` flag:

```
while(true) {
  // PRE-API PIPELINE (8 steps):
  1. applyToolResultBudget()      — enforce per-message size on aggregate results
  2. snipCompactIfNeeded()        — feature-gated lightweight compaction
  3. microcompact()               — gradual reduction without full LLM summary
  4. contextCollapse.apply()      — collapse redundant tool results
  5. autocompact()                — full LLM summarization when > threshold
                                    threshold = contextWindow - 13K buffer
                                    circuit breaker after 3 consecutive failures
  6. blockingLimitCheck()         — hard stop if still over limit
  7. normalizeMessagesForAPI()    — strip virtual msgs, merge consecutive, strip thinking
  8. prependUserContext()         — inject git status, CLAUDE.md, date

  // API CALL:
  for await (message of deps.callModel({messages, systemPrompt, tools, ...})) {
    // Stream messages to TUI
    // Collect tool_use blocks
    // Optionally start StreamingToolExecutor (tools begin during streaming)
  }

  // TOOL EXECUTION:
  partitionToolCalls() → concurrent batches (safe tools) + serial batches (unsafe tools)
  for each batch:
    if safe → runToolsConcurrently (max 10)
    else → runToolsSerially

  // POST-EXECUTION:
  if aborted → return
  if maxTurns → return
  assemble next turn messages
  if toolResults.length > 0 → continue  // LOOP
  else → return

  // RECOVERY PATHS (on error):
  413 → reactive_compact_retry or collapse_drain_retry
  maxTokens → escalate to 64K, then inject "resume" meta message (up to 3 retries)
  429/529 → subscriber-aware retry with exponential backoff
  overflow → parse inputTokens from error, dynamically set maxTokensOverride
}
```

### HLVM Loop (`orchestrator.ts`)

The HLVM loop is a `while(iterations < maxIterations)`:

```
while (state.iterations < maxIterations) {
  if (signal.aborted) break;

  // PRE-LLM INJECTION CHAIN (6 steps):
  1. maybeInjectReminder()         — web safety (all tiers), tool routing (weak, every 7 iter)
                                     injected as role:"user" + [System Reminder] prefix
  2. maybeInjectMemoryRecall()     — FTS5 + entity graph hybrid retrieval
  3. maybeInjectDelegationHint()   — nudge about pending delegate results
  4. Pre-compaction memory flush   — one turn to call memory_write before compaction
  5. compactIfNeeded()             — triggers at 80% of budget, LLM summarization
  6. applyAdaptiveToolPhase()      — weak models only: filter tools by inferred phase
                                     (researching | editing | verifying | delegating | completing)

  // LLM CALL:
  callLLM(llm, messages, ...)
    — single attempt, no retries
    — ContextOverflowError → compact context + one recovery attempt
    — Other errors → propagate to withFallbackChain
    — llm() closure from SdkAgentEngine:
      - 5 provider routing (Ollama/OpenAI/Anthropic/Google/Claude Code)
      - cached model + tools (rebuild on registry generation change)
      - provider-specific options (thinking budget, reasoning effort, etc.)
      - tool call repair (double-serialized JSON unwrapping)

  // RESPONSE PROCESSING (sequential pipeline):
  1. handleTextOnlyResponse()     — empty → retry, weak model JSON → extract
  2. processAgentResponse()       — native tool_calls dispatch, text-repair fallback
  3. EXECUTE TOOLS                — Promise.all (all parallel, no partitioning)
  4. handleFinalResponse()        — plan mode, grounding, citations
  5. handlePostToolExecution()    — 3-stage loop detection (warn → deny → abort)

  state.iterations++;
  if (hasToolCalls) continue;  // LOOP
  else break;                  // EXIT
}
```

### Critical Differences

| Aspect | CC | HLVM | Impact |
|--------|-----|------|--------|
| **Pre-API pipeline** | 8 steps (budget, snip, micro, collapse, auto, limit, normalize, context) | 6 steps (remind, memory, delegate, flush, compact, phase) | CC has more compaction strategies |
| **Tool execution during streaming** | Yes — `StreamingToolExecutor` starts tools while API is still streaming | No — tools only execute after full response | CC has lower latency |
| **Tool batching** | `partitionToolCalls()` — safe tools parallel, unsafe serial, max 10 | `Promise.all()` — all parallel, no classification | CC is safer for concurrent file writes |
| **Recovery paths** | 7 named transitions for 413, maxTokens, 429/529, overflow | `ContextOverflowError` graceful return, 3-stage loop detection | CC recovers instead of giving up |
| **Output continuation** | Inject "resume" meta message on max_output_tokens, retry up to 3x | None | CC can generate longer responses |
| **Adaptive filtering** | None | `applyAdaptiveToolPhase()` for weak models | HLVM helps weak models stay focused |

---

## 5. Tool System

### Claude Code Tool Type (`Tool.ts`)

CC tools are rich objects with Zod validation, per-tool rendering, and behavioral methods:

```typescript
type Tool<Input, Output> = {
  name: string
  aliases?: string[]
  inputSchema: ZodSchema               // Runtime validation via Zod
  maxResultSizeChars: number            // Per-tool output limit
  strict?: boolean

  // Core methods
  call(args, context, canUseTool): Promise<ToolResult<Output>>
  description(input, options): Promise<string>
  prompt(options): Promise<string>
  checkPermissions(input, context): Promise<PermissionResult>  // PER-TOOL permission logic

  // Behavioral methods
  isConcurrencySafe(input): boolean     // Can run concurrently? (read-only → true)
  isReadOnly(input): boolean
  isDestructive?(input): boolean
  isEnabled(): boolean

  // UI methods (per-tool custom rendering)
  userFacingName(input): string
  renderToolUseMessage(input, options): React.ReactNode
  renderToolResultMessage?(result, progress, options): React.ReactNode
  renderGroupedToolUse?(toolUses, options): React.ReactNode | null

  mapToolResultToToolResultBlockParam(content, toolUseID): ToolResultBlockParam
}
```

**Tool assembly** (`tools.ts`):
- `getAllBaseTools()` — exhaustive list of 40+ tools (conditional on env/features)
- `assembleToolPool(permCtx, mcpTools)` — built-in (sorted, prompt cache stability) + MCP tools
- `filterToolsByDenyRules()` — applies deny patterns

**Tool orchestration** (`services/tools/toolOrchestration.ts`):
- `partitionToolCalls()` — groups consecutive concurrency-safe tools into parallel batches
- Example: `[Read, Read, Grep, Edit, Read]` → `[Read,Read,Grep]` parallel, `[Edit]` serial, `[Read]` parallel
- Max concurrency: 10 (configurable via `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`)
- Context modifiers from concurrent tools are queued and applied after batch completes

### HLVM Tool Type (`registry.ts`)

HLVM tools are simpler metadata objects:

```typescript
interface ToolMetadata {
  fn: (args: unknown, workspace: string, options?: ToolExecutionOptions) => Promise<unknown>
  description: string
  args: Record<string, string>           // arg name → description (simple, no nested types)
  safetyLevel?: "L0" | "L1" | "L2"      // L0=safe, L1=confirm, L2=dangerous
  category?: string                       // For adaptive tool phasing
  replaces?: string[]                     // Tool routing hints (auto-generated in prompt)
  skipValidation?: boolean
  formatResult?: (result: unknown) => string
  terminalOnSuccess?: boolean
  argAliases?: Record<string, string[]>
}
```

**Registry** (`registry.ts`):
- Static: `TOOL_REGISTRY` (merged at module load from 11 tool categories)
- Dynamic: `DYNAMIC_TOOL_REGISTRY` (MCP + runtime, scoped by ownerId)
- O(1) lookups with generation-counter cache invalidation
- `normalizeToolName()` — 4-stage fuzzy resolution: exact → lowercase → camelCase→snake → strip separators
- `searchTools()` — token-based scoring for natural language tool search

**Tool execution** (`orchestrator-tool-execution.ts`):
- `executeToolCalls()` — `Promise.all(toolCalls.map(executeToolCall))` — ALL parallel
- Per-tool pipeline: lazy MCP → normalize name → sanitize args → check safety → execute → post-verify
- Special handling: delegate_agent (foreground/background), edit_file (auto-retry), write verification (LSP → syntax check)

### What HLVM Should Adopt from CC

1. **`isConcurrencySafe()` per tool** — Prevent concurrent writes to the same file. Easy to add to `ToolMetadata`.
2. **Zod input schemas** — Replace `args: Record<string, string>` with Zod for runtime validation + TypeScript inference.
3. **`maxResultSizeChars` per tool** — Prevent oversized tool results from blowing up context.
4. **Per-tool custom rendering** — Let each tool define how its invocation/result looks in the TUI.

---

## 6. Context Management & Compaction

### Claude Code Compaction Strategy

CC has **4 levels** of compaction, each progressively more aggressive:

1. **Microcompaction** (`microcompact`) — Lightweight reduction without LLM. Strips unnecessary detail from older messages.
2. **Snip compaction** (`snipCompactIfNeeded`) — Feature-gated, removes specific message types.
3. **Context collapse** (`contextCollapse.applyCollapsesIfNeeded`) — Collapses redundant tool results (e.g., multiple reads of the same file).
4. **Auto-compaction** (`autocompact`) — Full LLM-powered summarization:
   - Threshold: `contextWindow - 13K buffer - maxOutputTokens`
   - Circuit breaker: stops after 3 consecutive failures
   - Post-compact: re-reads files, re-injects agent listings, MCP instructions
   - Images stripped before compaction

**Reactive compaction** (on API 413 error):
```
API returns 413 "prompt too long"
  → withhold error during streaming
  → try reactiveCompact() after stream ends
  → if successful: yield post-compact messages, continue loop
  → if failed: surface the error
```

**Output continuation** (on max_output_tokens):
```
API returns stop_reason: "max_tokens"
  → escalate to 64K output tokens, retry
  → if still truncated: inject "resume" meta message
  → retry up to 3 times for multi-turn continuation
```

### HLVM Compaction Strategy

HLVM has **1 level** of compaction:

1. **LLM-powered summarization** (`compactIfNeeded`):
   - Threshold: 80% of token budget
   - Partitions messages into system + recent (keep) + older (summarize)
   - Replaces older with single summary message
   - Group-aware trimming: assistant + its tool results stay together
   - Pre-compaction memory flush: gives model one turn to call `memory_write`

**No reactive compaction** — `ContextOverflowError` → graceful return.
**No output continuation** — truncated responses are returned as-is.
**No microcompaction** — no lightweight reduction option.

### What HLVM Should Adopt

1. **Reactive compaction** (HIGH PRIORITY) — Catch API overflow errors, compact, retry. Currently HLVM gives up on overflow.
2. **Output continuation** — Inject "resume" messages when output is truncated. Enables longer generated responses.
3. **Microcompaction** — Strip unnecessary detail from old messages without a full LLM call.
4. **Per-tool result budget** — `applyToolResultBudget()` to enforce aggregate size limits.

---

## 7. TUI / React Ink Architecture

### Claude Code TUI

**Structure**:
```
App.tsx (thin: FpsMetrics → Stats → AppState providers)
  └─ screens/REPL.tsx (~2500 lines, the actual layout)
     ├─ Message List (scrollable)
     │   └─ Message.tsx (dispatcher, 626 lines)
     │      ├─ UserPromptMessage (truncation: 10K chars head+tail)
     │      ├─ AssistantTextMessage (error switch + Markdown)
     │      ├─ AssistantThinkingMessage
     │      ├─ AssistantToolUseMessage
     │      │   ├─ tool.renderToolUseMessage(input)  ← PER-TOOL custom rendering
     │      │   └─ ToolUseLoader (blinking dot, state-colored)
     │      ├─ UserToolResultMessage (dispatcher)
     │      │   ├─ UserToolCanceledMessage
     │      │   ├─ UserToolRejectMessage
     │      │   ├─ UserToolErrorMessage
     │      │   └─ UserToolSuccessMessage
     │      │       └─ tool.renderToolResultMessage()
     │      └─ AttachmentMessage, SystemMessage, etc.
     ├─ PromptInput (~190 props orchestrator)
     │   ├─ TextInput → BaseTextInput (cursor + voice waveform animation)
     │   ├─ VimTextInput (optional vim mode)
     │   ├─ Slash command typeahead + suggestions
     │   ├─ Mode pills: [plan] [vim] [auto] [fast]
     │   ├─ Footer pills: [tasks] [bridge] [teams] [companion]
     │   ├─ Submit: Enter | Multiline: Shift+Enter or Ctrl+E
     │   └─ Image paste, stashed prompts, history (up/down)
     ├─ StatusLine (debounced 300ms, async-computed)
     │   └─ model, workspace, cost, context window %, rate limits, vim mode
     └─ Overlays (conditional via activeOverlays Set)
```

**Streaming text** — `StreamingMarkdown` with split-boundary algorithm:
```typescript
// Only re-lexes the growing tail, O(tail length) per frame
const boundary = stablePrefixRef.current.length
const tokens = marked.lexer(stripped.substring(boundary))
// Find last non-space token = growing block; everything before is stable
// stablePrefix is memoized inside <Markdown> — never re-parsed
return (
  <Box flexDirection="column">
    {stablePrefix && <Markdown>{stablePrefix}</Markdown>}
    {unstableSuffix && <Markdown>{unstableSuffix}</Markdown>}
  </Box>
)
```
Additional optimizations:
- 500-entry LRU token cache (keyed by content hash)
- Fast-path: plain text without markdown → skip `marked.lexer` entirely
- Lazy syntax highlighting via React `Suspense` + `use()`

**Diff rendering** — `StructuredDiff` with Rust NAPI:
- `ColorDiff` Rust module for word-level syntax-highlighted diffs
- WeakMap cache keyed by `StructuredPatchHunk` reference (4-entry inner map: theme|width|dim|gutter)
- Two-column layout: NoSelect gutter (copy-paste safe) + content
- `RawAnsi` component bypasses Ink's ANSI parser for pre-rendered output
- Falls back to `StructuredDiffFallback` when NAPI unavailable

### HLVM TUI

**Structure**:
```
App.tsx (~1983 lines, full orchestrator — state, overlays, keyboard routing, layout)
  ├─ Banner (model name, status, runtime mode)
  ├─ ConversationPanel (691 lines)
  │   └─ Scrollable viewport (clamp + compute visible range)
  │      └─ Per-type dispatch on ConversationItem union:
  │         ├─ UserMessage
  │         ├─ AssistantMessage (plain text, no markdown parsing)
  │         ├─ ThinkingIndicator (collapsible)
  │         ├─ ToolGroup (collapsible, generic rendering)
  │         ├─ DelegateItem / DelegateGroup
  │         ├─ MemoryActivityLine (compact: "Recalled N, wrote N memory")
  │         ├─ TeamEventItem
  │         ├─ PlanChecklistPanel
  │         ├─ ConfirmationDialog / QuestionDialog
  │         ├─ ErrorMessage
  │         ├─ HqlEvalDisplay
  │         └─ TurnStats (tokens, time, cost)
  ├─ LocalAgentsBar (compact status when delegates running)
  ├─ Input.tsx (3767 lines)
  │   ├─ Paredit-aware editing:
  │   │   slurpForward/Backward, barfForward/Backward,
  │   │   raiseSexp, spliceSexp, killSexp, transposeSexp, wrapSexp,
  │   │   forwardSexp/backwardSexp (navigate by form)
  │   ├─ Syntax highlighting (detectComposerLanguage → HQL | markdown | plain)
  │   ├─ Completions (Tab accept, findSuggestion, @ mentions)
  │   ├─ History (up/down cycle, Ctrl+R reverse search)
  │   ├─ Multiline: automatic when parens unbalanced
  │   └─ Submit: Enter (when balanced)
  ├─ FooterHint (contextual keyboard shortcut hints)
  └─ Overlays (useOverlayPanel routing):
      ConfigOverlay, CommandPaletteOverlay, TeamDashboardOverlay,
      ShortcutsOverlay, BackgroundTasksOverlay, ModelBrowser,
      ModelSetupOverlay, TranscriptViewerOverlay
```

**Streaming text** — Direct text append to `ConversationItem`, re-rendered each frame. O(full text) per frame. No markdown parsing in TUI.

**Diff rendering** — None. Tool results are rendered as plain text.

### Key Differences

| Feature | CC | HLVM |
|---------|-----|------|
| Streaming perf | O(tail) split-boundary + LRU cache | O(full text) re-render |
| Markdown | Full: `marked.lexer` + syntax highlight | None |
| Diffs | Rust NAPI word-level + syntax colors | None |
| Per-tool UI | Each tool defines `renderToolUseMessage()` | Generic ToolGroup |
| Input editing | TextInput + VimTextInput, slash commands | Paredit (Lisp structural editing) |
| User input truncation | 10K head+tail for piped input | None |
| Status line | Async-computed: model, cost, ctx%, rate limits | Banner only |
| Overlays | `activeOverlays` Set, conditional rendering | `useOverlayPanel` hook, 9 overlay types |

### What HLVM Should Adopt

1. **StreamingMarkdown split-boundary** — O(tail) instead of O(full text). Critical for long streaming output.
2. **Markdown rendering** — Parse and render markdown in TUI output (code blocks, lists, bold, etc.)
3. **Per-tool custom rendering** — Let each tool define its own TUI component.
4. **User input truncation** — Head+tail for large piped inputs.
5. **Diff visualization** — Show inline diffs for file edits. Doesn't need Rust NAPI; pure JS word-diff is sufficient.

---

## 8. State Management

### Claude Code: Custom External Store

CC uses a minimal custom store (NOT Redux, NOT Zustand):

```typescript
function createStore<T>(initialState: T, onChange?: OnChange<T>): Store<T> {
  let state = initialState
  const listeners = new Set<Listener>()
  return {
    getState: () => state,
    setState: (updater) => {
      const prev = state
      const next = updater(prev)
      if (Object.is(next, prev)) return  // Skip if same reference
      state = next
      onChange?.({ newState: next, oldState: prev })
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
```

React binding via `useSyncExternalStore` (React 18 concurrent-mode safe):
```typescript
function useAppState(selector) {
  const store = useAppStore()
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()))
}
```

`AppState` is a **single massive type** (~450 lines) covering everything: settings, model, permissions, tasks, MCP, plugins, speculation, team context, inbox, bridge state, etc.

### HLVM: Hook-per-Domain Pattern

HLVM splits state across multiple React hooks:
- `useRepl()` — REPL lifecycle, eval
- `useConversation()` — message state, agent events
- `useTeamState()` — team dashboard state
- `useModelConfig()` — model selection
- `useOverlayPanel()` — overlay routing
- `useAgentRunner()` — agent execution lifecycle
- `useTaskManager()` — background task tracking
- `useAttachments()` — file/image attachment handling

Conversation state uses `agentTranscriptReducer` (reducer pattern with `useReducer`).

### Comparison

| Aspect | CC | HLVM |
|--------|-----|------|
| Pattern | External store + selectors | `useReducer` + per-domain hooks |
| Re-render efficiency | Only components using changed slice re-render | All hooks re-run on parent re-render |
| Single SSOT | Yes (AppState) | Split across hooks |
| Concurrent mode safe | Yes (`useSyncExternalStore`) | Standard `useReducer` |
| Complexity | Lower conceptual (one store) | Lower per-domain (each hook isolated) |

---

## 9. Memory System

### Claude Code: File-Based + Sonnet Side-Query

**Storage**: Individual Markdown files with frontmatter in `~/.claude/projects/<slug>/memory/`

```markdown
---
name: auth-system
description: Authentication implementation details
type: project
---
(content)
```

Types: `user | feedback | project | reference`

**Always loaded**: `MEMORY.md` (index, max 200 lines / 25KB)

**On-demand retrieval**:
1. `scanMemoryFiles(dir)` → frontmatter headers only
2. `selectRelevantMemories(query, headers)` → **Sonnet side-query** with JSON schema output
   - Sends all memory headers + user query to a fast Sonnet model
   - Model picks up to 5 relevant memories
   - Costs one extra API call per retrieval
3. Load selected full files → inject into context

**Session extraction**: LLM-based extraction from completed sessions (post-loop).

**KAIROS mode**: Daily log files (`logs/YYYY/MM/YYYY-MM-DD.md`), nightly `/dream` skill distills into `MEMORY.md`.

### HLVM: SQLite FTS5 + Entity Graph

**Storage**: SQLite database with 3 tables + FTS5 virtual table

```
facts table:        id, content, category, validFrom, validUntil, createdAt, confidence
entities table:     name, type
relationships:      source_entity_id, target_entity_id, relationship_type
FTS5 virtual table: synced from facts, BM25 scoring + 30-day half-life temporal decay
```

**Always loaded**: 10 pinned facts + availability hint when totalCount > 10

**On-demand retrieval** (`retrieveMemory()`):
1. FTS5 keyword search (BM25 + temporal decay)
2. Entity graph traversal (relationship walking)
3. Merge + deduplicate via Map
4. NO extra API call

**Conflict resolution**:
- `detectConflicts()` — Jaccard similarity > 0.4 = candidate
- `autoInvalidateConflicts()` — similarity > 0.9 = auto-invalidate

**Session extraction**: Pattern-based + LLM-based for frontier models (post-loop in `agent-runner.ts`).

### Comparison

| Aspect | CC | HLVM |
|--------|-----|------|
| Storage | Files (`.md` with frontmatter) | SQLite + FTS5 |
| Retrieval | Sonnet side-query (1 API call) | FTS5 + entity graph (0 API calls) |
| Quality | LLM-ranked (higher quality selection) | Algorithm-ranked (faster, cheaper) |
| Conflict detection | None | Jaccard similarity auto-invalidation |
| Temporal decay | None (file mtime only) | 30-day half-life on search scores |
| Entity relationships | None | Graph traversal for related facts |
| Cost | ~$0.003 per retrieval (Sonnet) | Free (local computation) |

---

## 10. Multi-Agent / Teams

### Claude Code: Cross-Process Coordination

```
Team Lead (main process)
  ├─ spawnTeam() → ~/.claude/teams/<name>/config.json
  ├─ TaskCreate → file per task in tasks/ directory
  ├─ Teammate 1 (tmux pane or subprocess)
  │   ├─ reads mailbox/ for assignments
  │   ├─ claims tasks via TaskUpdate (auto-set owner on in_progress)
  │   └─ writes results to mailbox
  ├─ Teammate 2 (tmux pane or subprocess)
  └─ SendMessage → writeToMailbox() or auto-resume stopped agents
```

**Communication**: File-backed mailboxes (survives crashes, cross-process)
**Process model**: tmux panes, separate processes, or in-process
**Task assignment**: Auto-ownership on claim, verification nudge when all 3+ tasks done
**Structured messages**: `shutdown_request/response`, `plan_approval_response` (discriminated union via Zod)

### HLVM: In-Process Async Loops

```
Team Lead (main thread)
  ├─ spawnTeam() → ~/.hlvm/tasks/<team>/
  ├─ TaskCreate → file per task + .highwatermark for ID persistence
  ├─ spawnAgent() → runTeammateLoop() [async, in-process]
  │   ├─ Check inbox (in-memory) for messages/shutdown
  │   ├─ Check task list for unclaimed tasks
  │   ├─ Claim → set owner + in_progress
  │   ├─ Run agent query on task
  │   ├─ Mark completed → send idle_notification
  │   └─ Poll for next (idlePollIntervalMs: 3s, maxIdlePolls: 30)
  └─ Shutdown: SendMessage type:"shutdown_request"
```

**Communication**: In-memory inbox (lost on crash)
**Process model**: Async functions in same process
**Task storage**: File-backed with `.highwatermark` counter
**Config**: `TeamConfigMember { joinedAt, backendType, planModeRequired }`

### Comparison

| Aspect | CC | HLVM |
|--------|-----|------|
| Process model | Cross-process (tmux, subprocess) | In-process (async) |
| Communication | File-backed mailbox | In-memory inbox |
| Crash resilience | Yes (files survive) | No (in-memory lost) |
| True parallelism | Yes (separate processes/CPU cores) | No (single-threaded, interleaved) |
| Startup overhead | Higher (spawn process/pane) | Lower (start async fn) |
| Complexity | Higher (file I/O, process mgmt) | Lower (just async/await) |

---

## 11. Permission & Safety System

### Claude Code: Multi-Layered

Permission decision pipeline (in order):
1. **Deny rules** — `getDenyRuleForTool()` blanket deny
2. **Allow rules** — `toolAlwaysAllowedRule()` blanket allow
3. **Ask rules** — `getAskRuleForTool()` "always ask"
4. **Per-tool `checkPermissions()`** — Each tool implements its own logic
5. **Mode transforms**:
   - `dontAsk` → ask becomes deny
   - `auto` → AI classifier decides (uses conversation context)

**Auto mode classifier** (`classifyYoloAction`):
- Fast path 1: check if `acceptEdits` mode would allow
- Fast path 2: safe-tool allowlist
- Full path: calls classifier with message history + action context
- Decides whether dangerous tool use is reasonable given conversation

**Content-specific rules**: `Bash(git *)` matches specific command patterns

**Headless agents**: Special path with hooks-based permission (no UI for prompts)

### HLVM: Policy-Based

Policy structure:
```typescript
interface AgentPolicy {
  version: 1
  default?: "allow" | "deny" | "ask"
  toolRules?: Record<string, PolicyDecision>     // per-tool overrides
  levelRules?: Record<string, PolicyDecision>     // per safety level (L0/L1/L2)
  pathRules?: { deny?: string[]; allow?: string[]; roots?: string[] }
  networkRules?: { deny?: string[]; allow?: string[] }
}
```

Resolution: `toolRules > levelRules > default > null` (strict precedence)
Path rules: glob patterns with deny-takes-precedence, compiled regex cached (200 cap)

### What HLVM Should Adopt

1. **Per-tool `checkPermissions()`** — Let tools define their own permission logic (e.g., Bash checks command pattern).
2. **Auto mode AI classifier** — For autonomous agent runs, use the conversation to decide permissions.
3. **Content-specific rules** — `shell_exec(git *)` matching specific command patterns.

---

## 12. Error Handling & Retry

### Claude Code: Production-Hardened

`withRetry()` is an **async generator** that yields UI error messages while retrying:

```typescript
async function* withRetry<T>(getClient, operation, options): AsyncGenerator<ErrorMsg, T> {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try { return await operation(client, attempt, retryContext) }
    catch (error) { /* classification + retry logic */ }
  }
}
```

**Error classification** (`shouldRetry()`):
- 408 (timeout) → retry
- 409 (lock) → retry
- 429 (rate limit) → retry (unless Claude AI Pro subscriber, unless Enterprise)
- 401 → retry for remote mode (CCR)
- 5xx → always retry
- Checks `x-should-retry` response header

**529 (overloaded) handling**:
- Background queries bail immediately (prevent amplification)
- Foreground retries 3x, then triggers fallback model
- `MAX_529_RETRIES = 3`

**Fast mode fallback**:
- On 429/529: check `retryAfterMs`
- Short retry (< threshold) → keep fast mode, sleep, retry
- Long retry → enter cooldown period, disable fast mode

**Persistent retry** (unattended sessions):
- Infinite retries with 30s heartbeat chunks
- Yields error messages periodically for UI liveness

**Context overflow recovery**:
- Parse `inputTokens`/`contextLimit` from error response
- Dynamically set `maxTokensOverride = max(floor, contextLimit - inputTokens - 1000)`
- Retry with reduced output budget

**Exponential backoff**: `min(base * 2^attempt, 32s) + random jitter (0-25%)`

### HLVM: Basic

`callLLM()`:
- Single attempt, no retries
- `ContextOverflowError` → compact context + one recovery attempt
- All other errors → propagate to `withFallbackChain` for model switching
- No subscriber-aware handling
- No 529 handling
- No persistent retry
- No fast mode
- No output continuation

### What HLVM Should Adopt

1. **Reactive compaction on overflow** (HIGH PRIORITY) — Don't give up on 413.
2. **Subscriber-aware rate limiting** — Different behavior for different API tiers.
3. **Output continuation** — "Resume" meta messages for truncated responses.
4. **Persistent retry mode** — For unattended/automated runs.
5. **Context overflow recovery** — Parse error response to dynamically adjust token budget.

---

## 13. Hooks & Extensibility

### Claude Code: Comprehensive Hook System

20+ lifecycle events:

| Event | When | Use Case |
|-------|------|----------|
| `PreToolUse` | Before tool execution | Auto-format, validation |
| `PostToolUse` | After tool success | Auto-test, notification |
| `PostToolUseFailure` | After tool failure | Error reporting |
| `PermissionRequest` | Tool needs approval | Custom approval flows |
| `PermissionDenied` | Tool was denied | Audit logging |
| `PreCompact` | Before compaction | Save important context |
| `PostCompact` | After compaction | Reinject context |
| `SessionStart` | Session begins | Environment setup |
| `SessionEnd` | Session ends | Cleanup, reporting |
| `Stop` | Model stops (end turn) | Auto-commit, validation |
| `StopFailure` | Stop hook failed | Error recovery |
| `SubagentStart/Stop` | Sub-agent lifecycle | Coordination |
| `TeammateIdle` | Teammate goes idle | Task assignment |
| `TaskCreated/Completed` | Task lifecycle | Workflow automation |
| `CwdChanged` | Working directory changed | Environment update |
| `FileChanged` | File modified | Auto-lint, auto-test |
| `ConfigChanged` | Settings changed | Reinitialization |
| `UserPromptSubmit` | User submits prompt | Input validation |
| `InstructionsLoaded` | CLAUDE.md loaded | Custom injection |
| `Elicitation` | Agent asks question | Custom responses |

Execution modes:
- **Shell command** — `exec` in subprocess
- **Prompt-based** — inject into conversation
- **Agent hook** — spawn sub-agent
- **HTTP hook** — webhook call

Async hooks: background execution with "rewake" notification on completion.

Configuration: user settings, project settings, skill frontmatter, plugin hooks.

### HLVM: No Hook System

HLVM has no user-extensible hook system. All lifecycle behavior is hardcoded.

### What HLVM Should Adopt

Start with the most impactful hooks:
1. `PreToolUse` / `PostToolUse` — Auto-format, auto-test
2. `Stop` — Auto-commit, validation on turn end
3. `UserPromptSubmit` — Input preprocessing

---

## 14. Skills / Plugins

### Claude Code

Skills are loaded from multiple sources (priority order):
1. Managed skills (bundled in binary)
2. User skills (`~/.claude/skills/`)
3. Project skills (`.claude/skills/`)
4. Legacy commands (`.claude/commands/`)

Format: `skill-name/SKILL.md` with frontmatter:
```yaml
name: my-skill
description: Does something
allowedTools: [Read, Edit, Bash]
whenToUse: When user asks to do X
version: 1.0
model: sonnet
userInvocable: true
hooks:
  preToolUse: ...
executionContext: fork  # inline or fork (sub-agent)
```

Conditional skills: `paths: ["*.py", "src/**/*.ts"]` triggers auto-activation when matching files are touched.

### HLVM

No skills/plugins system. Project instructions via `.hlvm/prompt.md` only.

---

## 15. Cost & Usage Tracking

### Claude Code

Per-model accumulation with full token breakdown:
```typescript
addToTotalSessionCost(cost, usage, model)
  ├─ input_tokens, output_tokens
  ├─ cache_read_input_tokens, cache_creation_input_tokens
  ├─ web requests
  └─ advisor (sub-model) usage recursion
```

Hardcoded pricing tiers:
- Sonnet: $3/$15 per M tokens (in/out)
- Opus 4/4.1: $15/$75
- Opus 4.6 fast: $30/$150

Persisted to project config for session resumption.
Displayed in StatusLine: `total_cost_usd, total_duration_ms, context_window_used_%`

### HLVM

Basic usage tracking (tokens in/out) per turn. Displayed in `TurnStats` component. No cost calculation. No per-model pricing.

---

## 16. Engine / Provider Abstraction

### Claude Code

Direct Anthropic SDK client. Single provider. No abstraction layer.

```typescript
// Calls Anthropic API directly
const client = new Anthropic()
const response = await client.messages.create({...})
```

### HLVM

`AgentEngine` interface with 5-provider support via Vercel AI SDK:

```typescript
interface AgentEngine {
  createLLM(config: AgentLLMConfig): LLMFunction
  createSummarizer(model?: string): SummarizeFn
}

class SdkAgentEngine implements AgentEngine {
  // Provider routing:
  // "ollama/"    → ollama-ai-provider-v2
  // "openai/"    → @ai-sdk/openai
  // "anthropic/" → @ai-sdk/anthropic
  // "google/"    → @ai-sdk/google
  // "claude-code"→ Claude Code native

  // Caching:
  // cachedModel (rebuild on OAuth/change)
  // cachedTools (rebuild on registry generation change)

  // Provider-specific options:
  // Anthropic: thinking budget
  // OpenAI: reasoning effort
  // Google: thinking config
  // Ollama: num_ctx
}
```

Singleton pattern: `getAgentEngine()` / `setAgentEngine()` / `resetAgentEngine()`
Selection via `HLVM_AGENT_ENGINE` env var (`"sdk"` | `"legacy"`)

**HLVM advantage**: Multi-provider support is a significant differentiator. CC is locked to Anthropic.

---

## 17. MCP Integration

### Claude Code

Uses official `@modelcontextprotocol/sdk` client. 4 transport types:
- `SSEClientTransport` (SSE)
- `StdioClientTransport` (stdio)
- `StreamableHTTPClientTransport` (HTTP)
- `WebSocketTransport` (custom WebSocket)

Connections are memoized (one per server name). On connection:
```typescript
const [tools, commands, skills, resources] = await Promise.all([
  fetchToolsForClient(client),
  fetchCommandsForClient(client),
  fetchMcpSkillsForClient(client),
  fetchResourcesForClient(client),
])
```

Auth: `ClaudeAuthProvider` per server. Session expiry detection (404 with code -32001).

### HLVM

Also uses `@modelcontextprotocol/sdk`. Migrated from hand-rolled client (see memory: "MCP SDK Migration"). Supports stdio and SSE transports.

**Lazy loading**: MCP tools are not loaded until first `mcp_*` tool use. Weak models skip MCP entirely.

Both projects are at parity here.

---

## 18. Gaps: What CC Has That HLVM Doesn't

| Feature | Difficulty | Impact | Priority |
|---------|-----------|--------|----------|
| `isConcurrencySafe()` tool batching | Low | Medium (prevents concurrent write conflicts) | HIGH |
| Reactive compaction (413 → compact → retry) | Medium | High (currently HLVM gives up on overflow) | HIGH |
| Output continuation (resume on truncation) | Medium | High (enables longer responses) | HIGH |
| StreamingMarkdown split-boundary | Medium | High (O(tail) vs O(full text)) | HIGH |
| Per-tool custom TUI rendering | Medium | Medium (richer tool output display) | MEDIUM |
| Diff visualization in TUI | Medium | Medium (visual feedback for edits) | MEDIUM |
| User-extensible hooks | High | High (workflow automation) | MEDIUM |
| Microcompaction | Medium | Medium (gradual context reduction) | MEDIUM |
| Auto-mode AI classifier for permissions | High | Medium (autonomous agent runs) | LOW |
| Skills/plugins system | High | Medium (extensibility) | LOW |
| Vim mode input | Medium | Low (niche user preference) | LOW |
| IDE bridge (VSCode, JetBrains) | Very High | Medium (IDE integration) | LOW |
| Voice recording + waveform cursor | High | Low (accessibility feature) | LOW |
| Rust NAPI diff rendering | High | Low (JS word-diff is sufficient) | LOW |
| Cost tracking with per-model pricing | Low | Low (nice to have) | LOW |
| Feature gates (compile-time elimination) | Medium | Low (optimization) | LOW |
| Persistent retry (infinite with heartbeat) | Low | Medium (unattended runs) | MEDIUM |
| Zod input schemas for tools | Medium | Medium (validation + types) | MEDIUM |
| `maxResultSizeChars` per tool | Low | Medium (prevent context blowup) | HIGH |
| Per-tool result budget enforcement | Low | Medium (aggregate size control) | HIGH |
| Text diffing (`diff` library) | Low | High (no diff visualization at all) | HIGH |
| CJK/emoji column width (`get-east-asian-width`, `emoji-regex`) | Low | High (broken layout for international users) | HIGH |
| Shell argument quoting (`shell-quote`) | Low | Medium (security for shell_exec) | MEDIUM |

> **Note**: See [Section 22](#22-sdk--library-usage-comparison) for full SDK/library analysis filtered through HLVM's OSS distribution constraints.

---

## 19. Advantages: What HLVM Has That CC Doesn't

| Feature | Description |
|---------|-------------|
| Multi-provider engine | 5 providers via Vercel AI SDK (Ollama, OpenAI, Anthropic, Google, Claude Code) |
| SQLite FTS5 memory | No API call for retrieval, entity graph traversal, temporal decay |
| Fact conflict auto-invalidation | Jaccard similarity detection + auto-invalidation |
| Paredit input editing | Structural editing for Lisp (slurp, barf, raise, splice, transpose, kill) |
| Modular orchestrator | 6 focused files vs CC's monolithic QueryEngine |
| Auto-generated tool routing table | From `replaces` metadata on tools |
| Auto-generated permission tiers | From `safetyLevel` metadata |
| Adaptive tool phasing | Filter tools by inferred phase (weak models only) |
| 3-stage loop detection | Graduated escalation: warn → temp-deny → escalate → abort |
| Pre-compaction memory flush | Give model one turn to save context before compaction |
| HQL language REPL | Built-in programming language with transpilation |
| ModelTier classification | weak/mid/frontier with tier-filtered prompts |
| O(1) tool registry with generation counter | Cached lookups invalidated on mutation |
| Transport-agnostic agent runner | Single `runAgentQuery()` for CLI, HTTP, and GUI |

---

## 20. Recommended Adoption Priorities

### Phase 1: Quick Wins (Low effort, High impact)

1. **`isConcurrencySafe` flag on ToolMetadata** — Add boolean to each tool, partition in `executeToolCalls()`. Prevents concurrent writes.
2. **`maxResultSizeChars` on ToolMetadata** — Truncate oversized tool results before they blow up context.
3. **Per-tool result budget** — Enforce aggregate size limit across all tool results in a turn.
4. **User input truncation** — Head+tail display for large piped inputs in ConversationPanel.
5. **Cost tracking** — Add per-model pricing table, track cumulative cost, display in TurnStats.
6. **`diff` library** — `npm:diff` for edit_file result visualization. Pure JS, MIT, tiny. (See [§22.5 Tier 1](#225-recommended-library-adoptions-for-hlvm))
7. **CJK/emoji column width** — `get-east-asian-width` + `emoji-regex` for correct terminal layout globally. (See [§22.5 Tier 1](#225-recommended-library-adoptions-for-hlvm))
8. **`shell-quote`** — Shell argument escaping for shell_exec security. (See [§22.5 Tier 2](#225-recommended-library-adoptions-for-hlvm))

### Phase 2: Core Robustness (Medium effort, High impact)

6. **Reactive compaction** — Catch API overflow/413 errors, compact context, retry the request.
7. **Output continuation** — Detect `stop_reason: max_tokens`, inject "please continue" message, retry up to 3x.
8. **StreamingMarkdown** — Implement split-boundary algorithm for O(tail) streaming performance.
9. **Markdown rendering** — Add `marked` or similar to TUI for rendering assistant output.
10. **Persistent retry mode** — For `--unattended` flag: infinite retry with exponential backoff + heartbeat.

### Phase 3: Rich UX (Medium-High effort, Medium impact)

11. **Per-tool custom TUI rendering** — Add optional `renderUse?: (input) => ReactNode` and `renderResult?: (result) => ReactNode` to ToolMetadata.
12. **Diff visualization** — Show word-level diffs for `edit_file` results. Pure JS `diff` library is sufficient.
13. **Microcompaction** — Strip unnecessary detail from old messages without a full LLM call (e.g., collapse verbose tool results to summaries).
14. **Zod input schemas** — Replace `args: Record<string, string>` with Zod schemas for runtime validation. Already a transitive dep via AI SDK — just start using it. (See [§22.5 Tier 1](#225-recommended-library-adoptions-for-hlvm))
15. **Context overflow recovery** — Parse token counts from API error, dynamically adjust output budget.

### Phase 4: Extensibility (High effort, High long-term impact)

16. **Hooks system** — Start with PreToolUse, PostToolUse, Stop. Shell command execution.
17. **Per-tool checkPermissions()** — Let tools define their own permission logic.
18. **Auto-mode AI classifier** — Use conversation context to auto-approve tool permissions.
19. **Streaming tool executor** — Start tool execution during API streaming.

---

## 21. ASCII Pipeline Diagrams

### Claude Code — Full Pipeline

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                     CLAUDE CODE — FULL PIPELINE                          ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  ENTRY POINTS                                                            ║
║  ────────────                                                            ║
║  CLI (cli.tsx) ──┐                                                       ║
║  IDE Bridge ─────┼──▶ main.tsx::initializeEntrypoint()                   ║
║  SDK (agent) ────┘    ├─ load settings + migrations                      ║
║                       ├─ prefetch git context (parallel)                 ║
║                       └─ prefetch MCP/plugins (deferred)                 ║
║                            │                                             ║
║                            ▼                                             ║
║  PROVIDER LAYER                                                          ║
║  ──────────────                                                          ║
║  App.tsx (thin shell)                                                    ║
║  ├─ FpsMetricsProvider                                                   ║
║  ├─ StatsProvider                                                        ║
║  └─ AppStateProvider (custom store, ~450 lines of AppState type)         ║
║       └─ screens/REPL.tsx (2500 lines — actual layout)                   ║
║            ├─ MessageList ──▶ Message.tsx dispatcher                      ║
║            │   ├─ UserPromptMessage (10K truncation)                     ║
║            │   ├─ AssistantTextMessage (error switch + Markdown)         ║
║            │   ├─ AssistantToolUseMessage (per-tool custom render)       ║
║            │   └─ UserToolResultMessage (success/error/cancel)           ║
║            ├─ PromptInput (190 props, vim mode, voice, typeahead)        ║
║            ├─ StatusLine (model, cost, ctx%, rate limits)                ║
║            └─ Overlays (activeOverlays Set)                              ║
║                            │                                             ║
║  USER INPUT                │                                             ║
║  ──────────                ▼                                             ║
║  ┌──────────────────────────────────────────────────────────────┐        ║
║  │  QueryEngine.submitMessage(prompt)                           │        ║
║  │  ├─ AsyncGenerator<SDKMessage>                               │        ║
║  │  ├─ Build system prompt (git, CLAUDE.md, date)               │        ║
║  │  ├─ Wrap canUseTool for denial tracking                      │        ║
║  │  ├─ Track usage/budget/structured-output retries             │        ║
║  │  └─ Delegate to query()                                      │        ║
║  └────────────────────────┬─────────────────────────────────────┘        ║
║                           ▼                                              ║
║  AGENTIC LOOP                                                            ║
║  ────────────                                                            ║
║  ┌──────────────────────────────────────────────────────────────┐        ║
║  │  while(true) {                                                │        ║
║  │                                                               │        ║
║  │    ┌─── PRE-API (8 steps) ─────────────────────────────────┐ │        ║
║  │    │ 1. applyToolResultBudget (aggregate size limit)        │ │        ║
║  │    │ 2. snipCompact (feature-gated lightweight)             │ │        ║
║  │    │ 3. microcompact (gradual, no LLM)                      │ │        ║
║  │    │ 4. contextCollapse (collapse redundant results)        │ │        ║
║  │    │ 5. autocompact (LLM summary, threshold-based)          │ │        ║
║  │    │    └─ circuit breaker after 3 consecutive failures     │ │        ║
║  │    │ 6. blockingLimitCheck (hard stop)                      │ │        ║
║  │    │ 7. normalizeMessagesForAPI (strip/merge/convert)       │ │        ║
║  │    │ 8. prependUserContext (git, CLAUDE.md, date)           │ │        ║
║  │    └────────────────────────────────────────────────────────┘ │        ║
║  │                         │                                     │        ║
║  │    ┌─── API CALL ───────▼──────────────────────────────────┐ │        ║
║  │    │ for await (msg of callModel({                          │ │        ║
║  │    │   messages, systemPrompt, tools, model, taskBudget     │ │        ║
║  │    │ })) {                                                  │ │        ║
║  │    │   collect tool_use blocks                              │ │        ║
║  │    │   yield msg to TUI                                     │ │        ║
║  │    │   [optional] StreamingToolExecutor.addTool(block)      │ │        ║
║  │    │   ← tools start DURING streaming                       │ │        ║
║  │    │ }                                                      │ │        ║
║  │    └────────────────────────────────────────────────────────┘ │        ║
║  │                         │                                     │        ║
║  │    ┌─── TOOL EXECUTION ─▼──────────────────────────────────┐ │        ║
║  │    │ partitionToolCalls():                                  │ │        ║
║  │    │   [Read,Read,Grep] → parallel batch (max 10)           │ │        ║
║  │    │   [Edit]           → serial batch                      │ │        ║
║  │    │   [Read,Read]      → parallel batch                    │ │        ║
║  │    │                                                        │ │        ║
║  │    │ Per tool:                                              │ │        ║
║  │    │   Zod validate → checkPermissions → execute            │ │        ║
║  │    │   → mapResult → postHooks                              │ │        ║
║  │    └────────────────────────────────────────────────────────┘ │        ║
║  │                         │                                     │        ║
║  │    ┌─── POST / RECOVERY ▼──────────────────────────────────┐ │        ║
║  │    │ if aborted → return                                    │ │        ║
║  │    │ if maxTurns → return                                   │ │        ║
║  │    │                                                        │ │        ║
║  │    │ RECOVERY:                                              │ │        ║
║  │    │ 413 → reactive compact → retry                         │ │        ║
║  │    │ maxTokens → escalate 64K → resume msg (3 retries)      │ │        ║
║  │    │ 429/529 → subscriber-aware retry (exp backoff)         │ │        ║
║  │    │ overflow → parse tokens → dynamic maxTokensOverride    │ │        ║
║  │    │ persistent mode → infinite retry + 30s heartbeat       │ │        ║
║  │    │                                                        │ │        ║
║  │    │ needsFollowUp? → continue : return                     │ │        ║
║  │    └────────────────────────────────────────────────────────┘ │        ║
║  │  }                                                            │        ║
║  └──────────────────────────────────────────────────────────────┘        ║
║                           │                                              ║
║  SUPPORTING SYSTEMS       ▼                                              ║
║  ──────────────────                                                      ║
║  ├─ Memory: file-based + Sonnet side-query (5 relevant files)            ║
║  ├─ Teams: file-backed mailbox, cross-process (tmux panes)               ║
║  ├─ Hooks: 20+ events, shell/prompt/agent/HTTP execution modes           ║
║  ├─ Skills: managed + user + project, conditional activation             ║
║  ├─ Cost: per-model pricing, persisted to project config                 ║
║  └─ MCP: SDK client, 4 transports, memoized connections                  ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

### HLVM — Full Pipeline

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                        HLVM — FULL PIPELINE                              ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  ENTRY POINTS                                                            ║
║  ────────────                                                            ║
║  CLI `hlvm ask` ─┐                                                       ║
║  HTTP/WS Server ─┼──▶ agent-runner.ts::runAgentQuery()                   ║
║  GUI (Ink TUI) ──┘    (SINGLE entry point for ALL transports)            ║
║                        ├─ Callbacks: onToken, onAgentEvent, onTrace,     ║
║                        │  onInteraction, onComplete                      ║
║                        │                                                 ║
║                        ▼                                                 ║
║  SESSION CREATION                                                        ║
║  ────────────────                                                        ║
║  createAgentSession()                                                    ║
║  ├─ Promise.all([loadAgentPolicy(), tryGetModelInfo()])                   ║
║  ├─ classifyModelTier() → weak | mid | frontier                         ║
║  ├─ computeTierToolFilter()                                              ║
║  ├─ resolveContextBudget()                                               ║
║  ├─ createLazyMcpLoader() (deferred until first mcp_* use)              ║
║  ├─ compileSystemPrompt() — modular section renderers:                   ║
║  │   identity, rules, capabilities, tool routing table,                  ║
║  │   permission tiers, project instructions, git context,               ║
║  │   delegation docs, team coordination, plan mode                       ║
║  │   (tier-filtered: weak → minimal, frontier → full)                    ║
║  ├─ Memory: separate system message ("# Your Memory\n...")               ║
║  │   └─ 10 pinned facts from SQLite + availability hint                  ║
║  └─ engine.createLLM() → closure with cached model + tools              ║
║                        │                                                 ║
║                        ▼                                                 ║
║  AGENTIC LOOP                                                            ║
║  ────────────                                                            ║
║  ┌──────────────────────────────────────────────────────────────┐        ║
║  │  while (iterations < maxIterations) {                         │        ║
║  │    if (signal.aborted) break;                                 │        ║
║  │                                                               │        ║
║  │    ┌─── PRE-LLM (6 steps) ─────────────────────────────────┐ │        ║
║  │    │ 1. maybeInjectReminder()                                │ │        ║
║  │    │    ├─ web safety: all tiers, every iteration            │ │        ║
║  │    │    └─ tool routing: weak only, every 7 iter, 3 cooldown│ │        ║
║  │    │    └─ as role:"user" + [System Reminder]                │ │        ║
║  │    │ 2. maybeInjectMemoryRecall()                            │ │        ║
║  │    │    └─ FTS5 + entity graph hybrid (no API call)          │ │        ║
║  │    │ 3. maybeInjectDelegationHint()                          │ │        ║
║  │    │ 4. Pre-compaction memory flush                          │ │        ║
║  │    │    └─ one turn to call memory_write before compaction   │ │        ║
║  │    │ 5. compactIfNeeded() (80% threshold, LLM summary)      │ │        ║
║  │    │ 6. applyAdaptiveToolPhase() [weak models only]          │ │        ║
║  │    │    └─ phase: researching|editing|verifying|delegating   │ │        ║
║  │    └────────────────────────────────────────────────────────┘ │        ║
║  │                         │                                     │        ║
║  │    ┌─── LLM CALL ──────▼──────────────────────────────────┐ │        ║
║  │    │ callLLM(llm, messages)                       │ │        ║
║  │    │ ├─ exp backoff, up to 2 retries                       │ │        ║
║  │    │ ├─ ContextOverflowError → graceful return             │ │        ║
║  │    │ │                                                     │ │        ║
║  │    │ │ llm() = SdkAgentEngine closure:                     │ │        ║
║  │    │ │ ├─ 5 providers (Ollama/OpenAI/Anthropic/Google/CC)  │ │        ║
║  │    │ │ ├─ cached model + tools (rebuild on gen change)     │ │        ║
║  │    │ │ ├─ provider options (thinking/reasoning/num_ctx)    │ │        ║
║  │    │ │ ├─ prompt caching (Anthropic/OpenAI)                │ │        ║
║  │    │ │ ├─ tool call repair (double JSON unwrap)            │ │        ║
║  │    │ │ └─ streamText() or generateText()                   │ │        ║
║  │    │ │                                                     │ │        ║
║  │    └───────────────────────────────────────────────────────┘ │        ║
║  │                         │                                     │        ║
║  │    ┌─── RESPONSE ───────▼──────────────────────────────────┐ │        ║
║  │    │ 1. handleTextOnlyResponse (empty retry, JSON extract) │ │        ║
║  │    │ 2. processAgentResponse (native tool_calls dispatch)  │ │        ║
║  │    │ 3. EXECUTE TOOLS                                      │ │        ║
║  │    │ 4. handleFinalResponse (plan, grounding, citations)   │ │        ║
║  │    │ 5. handlePostToolExecution (loop detection)           │ │        ║
║  │    └───────────────────────────────────────────────────────┘ │        ║
║  │                         │                                     │        ║
║  │    ┌─── TOOL EXECUTION ─▼──────────────────────────────────┐ │        ║
║  │    │ Promise.all(toolCalls.map(executeToolCall))            │ │        ║
║  │    │ ← ALL parallel (no concurrency classification)         │ │        ║
║  │    │                                                        │ │        ║
║  │    │ Per tool:                                              │ │        ║
║  │    │   lazyMCP → normalizeName → sanitizeArgs               │ │        ║
║  │    │   → checkSafety → execute → postVerify (LSP/syntax)   │ │        ║
║  │    │                                                        │ │        ║
║  │    │ Special: delegate (fg/bg), edit_file (auto-retry),     │ │        ║
║  │    │ write verify, batch_delegate (fan-out)                 │ │        ║
║  │    └────────────────────────────────────────────────────────┘ │        ║
║  │                         │                                     │        ║
║  │    ┌─── LOOP CONTROL ───▼──────────────────────────────────┐ │        ║
║  │    │ 3-stage loop detection:                                │ │        ║
║  │    │   Stage 1: warn model                                  │ │        ║
║  │    │   Stage 2: temp-deny repeated tool                     │ │        ║
║  │    │   Stage 3: escalate / abort                            │ │        ║
║  │    │                                                        │ │        ║
║  │    │ iterations++                                           │ │        ║
║  │    │ hasToolCalls? → continue : break                       │ │        ║
║  │    └────────────────────────────────────────────────────────┘ │        ║
║  │  }                                                            │        ║
║  └──────────────────────────────────────────────────────────────┘        ║
║                           │                                              ║
║  POST-LOOP                ▼                                              ║
║  ─────────                                                               ║
║  ├─ synthesizeStructuredOutput() (if schema requested)                   ║
║  ├─ persistSession() (save to disk)                                      ║
║  └─ extractSessionFacts() (frontier models → SQLite)                     ║
║                                                                          ║
║  TUI RENDERING                                                           ║
║  ─────────────                                                           ║
║  AgentUIEvent stream                                                     ║
║    → agentTranscriptReducer → ConversationItem[]                         ║
║    → App.tsx (1983 lines, full orchestrator)                             ║
║       ├─ Banner                                                          ║
║       ├─ ConversationPanel (scrollable viewport)                         ║
║       │   └─ 12 item types: User, Assistant, Thinking, ToolGroup,        ║
║       │      Delegate, Memory, Team, Plan, Interaction, Error, Eval,     ║
║       │      TurnStats                                                   ║
║       ├─ LocalAgentsBar (delegate status)                                ║
║       ├─ Input.tsx (3767 lines, Paredit + syntax highlighting)           ║
║       ├─ FooterHint                                                      ║
║       └─ 8 Overlays: Config, Commands, Teams, Shortcuts, Tasks,         ║
║          ModelBrowser, ModelSetup, Transcript                             ║
║                                                                          ║
║  SUPPORTING SYSTEMS                                                      ║
║  ──────────────────                                                      ║
║  ├─ Memory: SQLite FTS5 + entity graph (no API call retrieval)           ║
║  ├─ Teams: in-process async loops, in-memory inbox                       ║
║  ├─ Engine: 5 providers via Vercel AI SDK                                ║
║  ├─ Registry: O(1) lookups, generation-counter cache invalidation        ║
║  ├─ Policy: toolRules > levelRules > default, path/network globs         ║
║  ├─ Planning: draft → review → execute mode                             ║
║  ├─ Delegation: foreground/background, batch fan-out                     ║
║  └─ MCP: SDK client, lazy loading, weak models skip                      ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

### Side-by-Side: Loop Comparison

```
CLAUDE CODE                              HLVM
══════════                               ════

submitMessage()                          runAgentQuery()
     │                                        │
     ▼                                        ▼
while(true) {                            while(iter < max) {

  PRE-API (8 steps):                       PRE-LLM (6 steps):
  ├─ toolResultBudget                      ├─ injectReminder
  ├─ snipCompact                           ├─ injectMemoryRecall
  ├─ microcompact                          ├─ injectDelegationHint
  ├─ contextCollapse                       ├─ preCompactionFlush
  ├─ autocompact (ctx-13K)                 ├─ compactIfNeeded (80%)
  ├─ blockingLimit                         └─ adaptiveToolPhase
  ├─ normalizeForAPI                          (weak models only)
  └─ prependContext

  API CALL:                                LLM CALL:
  ├─ Anthropic API (streaming)             ├─ Vercel AI SDK (5 providers)
  └─ StreamingToolExecutor                 └─ generateText / streamText
     (tools start during stream)              (tools wait for completion)

  TOOL EXECUTION:                          TOOL EXECUTION:
  ├─ partition: safe→parallel,             ├─ Promise.all (all parallel)
  │  unsafe→serial (max 10)               └─ No concurrency classification
  ├─ Zod validate
  ├─ checkPermissions (per-tool)
  └─ custom UI render

  RECOVERY:                                RECOVERY:
  ├─ 413 → reactive compact + retry       ├─ ContextOverflow → graceful return
  ├─ maxTokens → 64K + resume (3x)        ├─ 3-stage loop detection
  ├─ 429 → subscriber-aware retry         └─ consecutive failure abort
  ├─ 529 → bail (bg) or retry (fg)
  ├─ overflow → dynamic maxTokens
  └─ persistent → infinite + heartbeat

  needsFollowUp? → continue               hasToolCalls? → continue
}                                        }
```

---

*This document was generated on 2026-04-01 from a comprehensive code analysis of both codebases. For questions or updates, refer to the source repositories.*



=============================================================
=============================================================

claude analysis into deep

=============================================================
=============================================================
=============================================================


Last login: Wed Apr 1 02:12:52 on ttys032 user@hostname hql % claude ▗ ▗ ▖ ▖ Claude Code v2.1.32 Opus 4.6 ▘▘ ▝▝ ~/dev/hql ❯ /usage
PASTED
write full summarization here - that can take all gist without repetition - drawing core idea and things in ASCII visual - all inclusive and described but brief down to core
3:56 AM

Synthesized comparison framework with visual ASCII representations
Synthesized comparison framework with visual ASCII representations
Here's the distilled summary of the full comparison.
HLVM vs Claude Code — Core Architecture Summary
Both are React/Ink TUI + ReAct agent loop systems for AI-assisted coding. Same fundamental pattern, different maturity profiles.
The Core Loop (Both Projects)
User Input
    │
    ▼
┌─────────────────────────────┐
│  PRE-PROCESSING             │  ← context management, injections
│  (compact/normalize/inject) │
└──────────┬──────────────────┘
           ▼
┌─────────────────────────────┐
│  LLM CALL (streaming)       │  ← CC: Anthropic only / HLVM: 5 providers
└──────────┬──────────────────┘
           ▼
┌─────────────────────────────┐
│  TOOL EXECUTION             │  ← CC: partitioned batches / HLVM: all parallel
└──────────┬──────────────────┘
           ▼
       has tools?
       ├─ yes → LOOP BACK ↑
       └─ no  → RETURN final response
Where Each Wins
╔═══════════════════════════╦═══════════════════════════════╗
║  CC AHEAD (production)    ║  HLVM AHEAD (architecture)    ║
╠═══════════════════════════╬═══════════════════════════════╣
║                           ║                               ║
║  Reactive compaction      ║  5-provider engine            ║
║  (413 → compact → retry)  ║  (Anthropic/OpenAI/Google/    ║
║                           ║   Ollama/Claude Code)         ║
║  Tool concurrency         ║                               ║
║  (safe→parallel,          ║  SQLite FTS5 memory           ║
║   unsafe→serial)          ║  (no extra API call,          ║
║                           ║   entity graph, temporal       ║
║  Streaming markdown       ║   decay, conflict detection)  ║
║  (O(tail) not O(full))    ║                               ║
║                           ║  Modular orchestrator         ║
║  Streaming tool exec      ║  (6 files vs monolithic       ║
║  (tools start during      ║   QueryEngine)                ║
║   API response)           ║                               ║
║  20+ lifecycle hooks      ║  Adaptive tool phasing        ║
║  (user-extensible)        ║  (weak model support)         ║
║                           ║                               ║
║  Rust NAPI diff render    ║  Paredit input editing        ║
║  Per-tool custom TUI      ║  3-stage loop detection       ║
║  Vim mode                 ║  Pre-compaction memory flush  ║
║  IDE bridge (VSCode/JB)   ║  ModelTier classification     ║
║  Skills/plugins system    ║                               ║
║  AI permission classifier ║                               ║
║  Cost tracking            ║                               ║
╚═══════════════════════════╩═══════════════════════════════╝
Key Subsystem Differences
TOOL DEFINITION
  CC:   Zod schema + isConcurrencySafe() + per-tool render + checkPermissions()
  HLVM: Record<string,string> args + safetyLevel L0/L1/L2 + category + replaces[]

CONTEXT MANAGEMENT
  CC:   6-stage pipeline (snip → micro → collapse → auto → normalize → inject)
        + reactive retry on 413 + microcompact for gradual reduction
  HLVM: compactIfNeeded at 80% + ContextOverflowError = give up (no retry)

ERROR RECOVERY
  CC:   7 named recovery paths, subscriber-aware 429, persistent infinite retry
  HLVM: 2 retries with backoff, graceful return on overflow

STATE MANAGEMENT
  CC:   Custom store + useSyncExternalStore (selective re-render)
  HLVM: useReducer + per-domain hooks (cleaner split, more re-renders)

MULTI-AGENT
  CC:   Cross-process (tmux panes), file-backed mailboxes (crash-safe)
  HLVM: In-process async loops, in-memory inbox (simpler, not crash-safe)

MEMORY
  CC:   File-based .md + Sonnet side-query picks ≤5 relevant files
  HLVM: SQLite FTS5 + entity graph + BM25 + temporal decay (no API call)
Priority Adoption List for HLVM
HIGH VALUE (adopt now):
  1. Reactive compaction     ← catch 413, compact, retry (don't give up)
  2. Tool concurrency split  ← isConcurrencySafe() per tool
  3. Streaming markdown      ← O(tail) split-boundary algorithm
  4. Per-tool result limits  ← maxResultSizeChars prevents context bloat
  5. Output continuation     ← inject "resume" on max_output_tokens hit

MEDIUM VALUE (design needed):
  6. Streaming tool executor ← start tools during API response
  7. User-extensible hooks   ← pre/post tool lifecycle events
  8. Per-tool custom TUI     ← file edits show diffs, bash shows output
  9. AI permission classifier← auto-approve safe actions in auto mode
 10. Microcompaction         ← lightweight reduction without full LLM summary
Tech Stack Overlap
Both use:  TypeScript, React Ink, Anthropic SDK types, MCP protocol,
           file-backed task stores, slash commands, plan mode,
           team coordination with structured shutdown protocol

CC only:   Rust NAPI (diffs), Zod (validation), feature gates (compile-time)
HLVM only: Vercel AI SDK (multi-provider), SQLite/better-sqlite3 (memory),
           HQL transpiler (language REPL)
The TL;DR: CC is battle-hardened for production edge cases (retry, recovery, rendering perf). HLVM is architecturally cleaner and more flexible (multi-provider, modular splits, declarative metadata). The biggest gaps to close are reactive compaction, tool batching, and streaming performance.
the goal is to get inspired and learn from CC - so you should explain and layout all technical details as well
3:57 AM

Architected comprehensive technical breakdown of implementation patterns and algorithms
Architected comprehensive technical breakdown of implementation patterns and algorithms
Here's the full technical breakdown — every CC pattern worth learning from, with implementation details.
HLVM vs Claude Code: Complete Technical Reference
1. SYSTEM ENTRY & BOOTSTRAPPING
CC's initialization pipeline is a multi-stage async bootstrap:
CLI/IDE/SDK
    │
    ▼
initializeEntrypoint()
    ├─ load settings (JSON config, env vars)
    ├─ run migrations (schema versioning for config files)
    ├─ prefetch git context (async, non-blocking)
    └─ prefetch MCP/plugins (parallel discovery)
    │
    ▼
replLauncher.tsx → launchRepl(props)
    │
    ▼
App.tsx (THIN — providers only, no layout)
    └─ FpsMetricsProvider
       └─ StatsProvider (token/cost accumulator)
          └─ AppStateProvider (single store, ~450 lines of type)
             └─ REPL.tsx (~2500 lines — actual layout + logic)
Key CC insight — separation of concerns: App.tsx is purely a provider shell. All layout, keyboard routing, overlays, and rendering live in REPL.tsx. HLVM's App.tsx is ~1983 lines doing everything — providers, layout, overlays, state, keyboard routing all in one file.
CC's custom state store (NOT Redux, NOT Zustand):
createStore<AppState>()
    ├─ getState()        → returns immutable snapshot
    ├─ setState(updater) → Object.is equality check (skip no-ops)
    └─ subscribe(fn)     → Set<Listener>, returns unsubscribe

React binding: useSyncExternalStore(store.subscribe, selector)
This is React 18 concurrent-mode safe. Only components that read a changed slice re-render. HLVM uses useReducer + per-domain hooks — architecturally cleaner but causes more re-renders because React can't tell which part of state changed.
CC's bridge layer enables IDE integration:
CLI ──────┐
IDE ──────┼──→ replBridge.ts ──→ QueryEngine
SDK ──────┘         │
                    ├─ WebSocket (VSCode extension)
                    ├─ HTTP (JetBrains plugin)
                    └─ stdio (agent SDK)
HLVM's agent-runner.ts serves a similar role (CLI + HTTP + GUI → single runAgentQuery()) but has no IDE bridge equivalent.
2. THE AGENT AI LOOP — CC's query() in Detail
CC's core loop is a while(true) with 7 named recovery transitions. Here's the full pipeline with every stage explained:
submitMessage(prompt, options?)
│
│  ← AsyncGenerator<SDKMessage> — yields messages as they arrive
│  ← Builds system prompt via context.ts (git info, CLAUDE.md, date)
│  ← Wraps canUseTool to track permission denials per-session
│  ← Tracks usage budget and structured-output retries
│
▼
query() / queryLoop()   ← THE WHILE(TRUE)
│
├─── STAGE 1: PRE-API PIPELINE (6 steps, ordered) ────────────────
│
│  1. applyToolResultBudget()
│     PURPOSE: Prevent tool results from bloating context
│     HOW: Enforces per-message aggregate size cap on tool_result blocks
│     WHY: A single grep can return megabytes; this caps it before the API call
│     HLVM EQUIVALENT: None — no per-tool or per-message result size limit
│
│  2. snipCompactIfNeeded()  [feature-gated]
│     PURPOSE: Lightweight "snip" compaction — remove middle of large blocks
│     HOW: Identifies expandable sections (long tool results, repeated outputs)
│           and truncates them with "[snipped N chars]" markers
│     WHY: Cheaper than LLM summarization, good for incremental reduction
│     HLVM EQUIVALENT: None
│
│  3. microcompact()
│     PURPOSE: Gradual context reduction without full LLM summarization
│     HOW: Removes less important content — old thinking blocks, redundant
│           tool outputs from succeeded operations, collapsed results
│     TRIGGERS: Runs when context is growing but not yet at compaction threshold
│     WHY: Avoids the "cliff" where everything is fine → suddenly need
│           expensive full compaction. Smooths the curve.
│     HLVM EQUIVALENT: None — HLVM jumps straight to full LLM compaction at 80%
│
│  4. contextCollapse.applyCollapsesIfNeeded()
│     PURPOSE: Collapse redundant tool results
│     HOW: If a file was read 3 times, collapse earlier reads into
│           "[previously read — see latest version below]"
│           Uses COMPACT_BOUNDARY markers to identify collapsible regions
│     WHY: Agent often re-reads files; keeping all versions wastes tokens
│     HLVM EQUIVALENT: Group-aware trimming (simpler, less targeted)
│
│  5. autocompact()
│     PURPOSE: Full LLM-powered summarization when context is large
│     THRESHOLD: contextWindow - 13,000 buffer tokens
│     HOW:
│       a. Send current conversation to Sonnet with "summarize" prompt
│       b. Replace old messages with summary
│       c. Attach post-compact metadata:
│          - Re-read currently relevant files
│          - Re-list active agent/team state
│          - Re-inject working directory context
│     CIRCUIT BREAKER: After 3 consecutive compaction failures, stop trying
│     HLVM EQUIVALENT: compactIfNeeded() at 80% budget — similar but no
│       post-compact re-injection and no circuit breaker
│
│  6. blockingLimitCheck()
│     PURPOSE: Hard stop if still over limit after all above
│     HOW: If token count > context window even after all compaction,
│           throw ContextTooLargeError (unrecoverable)
│
│  7. normalizeMessagesForAPI()
│     PURPOSE: Clean messages for Anthropic API compliance
│     OPERATIONS:
│       - Strip virtual/display-only messages (UI-only metadata)
│       - Merge consecutive same-role messages (API requires alternating)
│       - Strip thinking blocks from non-final turns (save tokens)
│       - Strip images that caused previous errors (don't retry broken images)
│       - Convert attachments → tool_result blocks (normalize format)
│     HLVM EQUIVALENT: Partial — HLVM normalizes but doesn't strip thinking
│       from old turns or handle broken images
│
│  8. prependUserContext()
│     PURPOSE: Inject fresh context at conversation start
│     CONTENT: git status, CLAUDE.md project instructions, current date
│     WHY: After compaction, this context may have been lost; re-inject it
│
├─── STAGE 2: API CALL ─────────────────────────────────────────
│
│  deps.callModel({
│    messages, systemPrompt, thinkingConfig,
│    tools, signal, model, fastMode, taskBudget
│  })
│
│  The call returns an async iterator of SDKMessages.
│  During streaming:
│
│  for await (const message of stream) {
│    if (message.type === 'assistant') {
│      // Collect tool_use blocks as they arrive
│      // OPTIONALLY start StreamingToolExecutor (see below)
│    }
│    yield message  // Stream to TUI for live rendering
│  }
│
│  ┌─── STREAMING TOOL EXECUTOR (feature-gated) ──────────────┐
│  │                                                            │
│  │  CC's key latency optimization:                            │
│  │                                                            │
│  │  NORMAL:  [API streaming......] → [tool exec] → [next turn]│
│  │  CC:      [API streaming......] → [next turn]              │
│  │                       ↑                                     │
│  │                  [tool exec starts HERE, overlapped]         │
│  │                                                            │
│  │  HOW:                                                       │
│  │  1. As each tool_use block arrives in the stream,           │
│  │     addTool(block) immediately begins execution             │
│  │  2. Tools that are isConcurrencySafe start right away       │
│  │  3. After stream ends, getRemainingResults() collects       │
│  │     any still-running tools                                 │
│  │                                                            │
│  │  WHY: If API takes 5s to stream and tool takes 2s,         │
│  │  normal = 7s, streaming exec = 5s (2s hidden)               │
│  │                                                            │
│  │  HLVM EQUIVALENT: None — tools only execute after           │
│  │  full LLM response is received                              │
│  └────────────────────────────────────────────────────────────┘
│
├─── STAGE 3: TOOL EXECUTION ───────────────────────────────────
│
│  CC's partitioning algorithm:
│
│  partitionToolCalls(toolUseBlocks)
│  ┌────────────────────────────────────────────────────────────┐
│  │                                                            │
│  │  Walk the array left-to-right:                             │
│  │  - If tool.isConcurrencySafe(input) === true:              │
│  │    → Accumulate into current "safe batch"                  │
│  │  - If tool.isConcurrencySafe(input) === false:             │
│  │    → Flush current safe batch (run parallel, max 10)       │
│  │    → Run this tool alone (serial)                          │
│  │    → Start new safe batch                                  │
│  │                                                            │
│  │  Example:                                                  │
│  │  Input:  [Read, Read, Grep, Edit, Read, Read]              │
│  │                                                            │
│  │  Batch 1: [Read, Read, Grep]  → Promise.all() (parallel)  │
│  │  Batch 2: [Edit]              → await single (serial)      │
│  │  Batch 3: [Read, Read]        → Promise.all() (parallel)  │
│  │                                                            │
│  │  Max concurrency per batch: 10 (env-configurable)          │
│  └────────────────────────────────────────────────────────────┘
│
│  Per-tool execution pipeline:
│
│  1. VALIDATE:   tool.inputSchema.safeParse(input)  ← Zod runtime validation
│     - Returns { success: true, data } or { success: false, error }
│     - Error includes specific field-level messages
│     - HLVM: No validation — trusts LLM output
│
│  2. PERMISSIONS: tool.checkPermissions(input, context)
│     Layered evaluation:
│     a. denyRules   → pattern match (e.g., Bash(rm -rf /))  → DENY
│     b. allowRules  → pattern match (e.g., Bash(git *))     → ALLOW
│     c. askRules    → pattern match                          → ASK USER
│     d. tool-specific logic (e.g., Edit checks file ownership)
│     e. Mode transform:
│        - dontAsk mode: "ask" becomes "deny" (headless safety)
│        - auto mode:    AI classifier decides (see below)
│
│     ┌─── AUTO-MODE AI CLASSIFIER ──────────────────────────┐
│     │                                                       │
│     │  classifyYoloAction(toolCall, conversationContext)     │
│     │                                                       │
│     │  Sends the tool call + recent conversation to a       │
│     │  fast model (Sonnet) and asks:                        │
│     │  "Is this action reasonable given the conversation?"  │
│     │                                                       │
│     │  Returns: approve | deny | ask_user                   │
│     │                                                       │
│     │  WHY: In "auto" mode, you want the agent to run       │
│     │  unattended but not do crazy things. The classifier   │
│     │  catches "delete production database" while allowing  │
│     │  "create a new test file".                            │
│     │                                                       │
│     │  HLVM EQUIVALENT: None — only static policy rules     │
│     └───────────────────────────────────────────────────────┘
│
│  3. EXECUTE:  tool.call(input, context, canUseTool)
│
│  4. MAP RESULT: mapToolResultToToolResultBlockParam()
│     - Truncate to maxResultSizeChars (per-tool configurable)
│     - Convert to API-compatible format
│
│  5. POST-HOOKS: Execute post-tool-use lifecycle hooks
│     - User-defined shell commands, prompts, webhooks
│     - Async hooks run in background with "rewake" notification
│
├─── STAGE 4: POST-EXECUTION ───────────────────────────────────
│
│  if (aborted by user)     → yield interruption message, return
│  if (maxTurns reached)    → yield max_turns_reached attachment
│  if (stop hooks blocking) → surface error, continue loop
│
│  Assemble next turn:
│  messages = [...existing, ...assistantResponse, ...toolResults]
│
│  needsFollowUp = toolResults.length > 0
│  if (needsFollowUp) → continue  // LOOP BACK TO STAGE 1
│  else               → return { reason: 'end_turn' }
│
├─── STAGE 5: RECOVERY PATHS (on error) ────────────────────────
│
│  CC has 7 named transitions — each handles a specific failure:
│
│  ┌─ 413 PROMPT TOO LONG ─────────────────────────────────────┐
│  │                                                            │
│  │  Transition 1: collapse_drain_retry                        │
│  │  → Drain any staged collapses that haven't been applied    │
│  │  → Retry the same API call                                 │
│  │                                                            │
│  │  Transition 2: reactive_compact_retry                      │
│  │  → Full reactive compaction (LLM summarization)            │
│  │  → Retry the API call with compacted context               │
│  │                                                            │
│  │  HLVM: ContextOverflowError → graceful return (GIVES UP)   │
│  │  This is the #1 gap. User's request is lost.               │
│  └────────────────────────────────────────────────────────────┘
│
│  ┌─ MAX OUTPUT TOKENS HIT ────────────────────────────────────┐
│  │                                                            │
│  │  Transition 3: max_output_tokens_escalate                  │
│  │  → Retry with maxTokens bumped to 64K                      │
│  │  → Only tries once                                         │
│  │                                                            │
│  │  Transition 4: max_output_tokens_recovery                  │
│  │  → Inject a meta-message: "Your previous response was      │
│  │    truncated. Continue from where you left off."            │
│  │  → Up to 3 continuation attempts                           │
│  │  → Each continuation appends to the original response      │
│  │                                                            │
│  │  HLVM: No handling. Truncated output = truncated output.   │
│  └────────────────────────────────────────────────────────────┘
│
│  ┌─ 429/529 RATE LIMIT ──────────────────────────────────────┐
│  │                                                            │
│  │  withRetry() — an async generator that yields UI messages  │
│  │  while retrying (user sees "Retrying in 5s..." etc.)       │
│  │                                                            │
│  │  Subscriber-aware:                                         │
│  │  - Pro users: shorter retry, different messaging            │
│  │  - Enterprise: longer patience, less aggressive             │
│  │                                                            │
│  │  Fast-mode: short retry or enter cooldown period            │
│  │  (fast-mode = use cheaper/faster model temporarily)        │
│  │                                                            │
│  │  Persistent mode: infinite retry with heartbeat             │
│  │  (for unattended agent runs — never give up)               │
│  │                                                            │
│  │  Background queries: bail immediately on 529               │
│  │  (don't waste retry budget on side-queries like memory)    │
│  │                                                            │
│  │  HLVM: 2 retries with exponential backoff. No subscriber   │
│  │  awareness, no persistent mode, no background query logic. │
│  └────────────────────────────────────────────────────────────┘
│
│  ┌─ CONTEXT OVERFLOW ─────────────────────────────────────────┐
│  │                                                            │
│  │  Parse inputTokens and contextLimit from the error body    │
│  │  → Dynamically set maxTokensOverride = contextLimit -      │
│  │    inputTokens (fit output within remaining space)          │
│  │  → Retry with adjusted limit                               │
│  │                                                            │
│  │  HLVM: No dynamic adjustment. Fixed budget.                │
│  └────────────────────────────────────────────────────────────┘
│
└─── END: yield final SDKMessage { type:'result', usage, cost }
HLVM's equivalent loop for comparison:
runAgentQuery() → runReActLoop()
│
├─── PRE-LLM INJECTION CHAIN ──────────────────────────────────
│
│  1. maybeInjectReminder()
│     - Web safety reminder: ALL model tiers, every iteration
│     - Tool routing reminder: weak models only, every 7 iterations
│       with 3-iteration cooldown
│     - Injected as role:"user" with [System Reminder] prefix
│       (NOT role:"system" — avoids multi-system-message bugs
│        with some providers)
│     CC EQUIVALENT: None — CC only targets Anthropic API which
│       handles multiple system messages fine
│
│  2. maybeInjectMemoryRecall()
│     - Calls retrieveMemory() = FTS5 keyword search + entity graph
│     - Hybrid: BM25 scoring with 30-day half-life temporal decay
│       + relationship traversal across entity graph
│     - Emits memory_activity AgentUIEvent for TUI display
│     CC EQUIVALENT: Sonnet side-query (extra API call, arguably
│       higher quality selection but costs money/latency)
│
│  3. maybeInjectDelegationHint()
│     - Nudges model about pending delegate results
│     - Prevents model from forgetting about background agents
│     CC EQUIVALENT: Team mailbox polling (file-based)
│
│  4. Pre-compaction memory flush
│     - UNIQUE TO HLVM: Before compaction destroys old context,
│       give the model one turn to call memory_write to persist
│       anything important
│     - This prevents information loss during summarization
│     CC EQUIVALENT: None — CC just compacts and re-injects
│       post-compact attachments (file re-reads, etc.)
│
│  5. compactIfNeeded()
│     - Triggers at 80% of token budget
│     - LLM summarization of older messages
│     - Keeps system prompt + recent N messages
│     CC EQUIVALENT: autocompact() at contextWindow - 13K buffer,
│       with circuit breaker after 3 failures
│
│  6. applyAdaptiveToolPhase() [weak models only]
│     - UNIQUE TO HLVM: Infers current work phase from recent tools:
│       researching → editing → verifying → delegating → completing
│     - Filters available tools to match phase
│     - Prevents weak models from being overwhelmed by 40+ tools
│     CC EQUIVALENT: None — CC gives all tools to all models
│
├─── LLM CALL ──────────────────────────────────────────────────
│
│  callLLM(llm, messages, ...)
│  - Exponential backoff, up to 2 retries
│  - ContextOverflowError → graceful return (no retry)
│
│  The llm() closure routes to 5 providers via Vercel AI SDK:
│  - "ollama/"    → ollama-ai-provider-v2
│  - "openai/"    → @ai-sdk/openai
│  - "anthropic/" → @ai-sdk/anthropic
│  - "google/"    → @ai-sdk/google
│  - "claude-code"→ claude-code native passthrough
│
│  Provider-specific caching:
│  - Anthropic: ephemeral cache breakpoints on system messages
│  - OpenAI: cacheKey property on system messages
│
│  Tool call repair for weak models:
│  - Detect double-serialized JSON: '{"args":"{\"path\":\"/foo\"}"}'
│  - Unwrap: string → JSON.parse → actual args object
│
├─── RESPONSE PROCESSING ──────────────────────────────────────
│
│  1. handleTextOnlyResponse()
│     - Empty response → retry once
│     - Weak model JSON-in-text → extract tool calls from prose
│
│  2. processAgentResponse()
│     - Native tool_calls → dispatch
│     - Text-repair fallback (last resort for models without tool calling)
│
│  3. If tool calls → EXECUTE (see tool execution below)
│
│  4. handleFinalResponse()
│     - Plan mode handling (checklist extraction)
│     - Grounding/citations attachment
│     - Emit final_response AgentUIEvent
│
│  5. handlePostToolExecution()
│     - 3-stage loop detection (signature-based):
│       Stage 1: Warn model ("You seem to be repeating...")
│       Stage 2: Temp-deny the repeated tool
│       Stage 3: Escalate / abort loop
│     CC EQUIVALENT: None explicit — CC relies on maxTurns limit
│
├─── TOOL EXECUTION ────────────────────────────────────────────
│
│  Promise.all(toolCalls.map(executeToolCall))
│  ← ALL tools run in parallel (no partitioning)
│
│  Per-tool pipeline:
│  1. Lazy MCP bootstrap (if mcp_* tool, first-use only)
│  2. normalizeToolName() — 4-level fuzzy matching:
│     exact → lowercase → camelCase→snake_case → strip separators
│  3. sanitizeArgs(normalizeToolArgs(args)) + argAliases resolution
│  4. checkToolSafety() — policy check (toolRules > levelRules > default)
│  5. toolFn(args, workspace, toolOptions) — actual execution
│  6. Post-execution verification:
│     - edit_file auto-retry with closest line match
│     - maybeVerifyWrite() → LSP syntax check
│
└─── POST-LOOP ─────────────────────────────────────────────────
│
│  1. synthesizeStructuredOutput() — if JSON schema was requested
│  2. persistSession() — save conversation to disk
│  3. extractSessionFacts() — frontier models only
│     Pattern-based + LLM extraction → SQLite facts table
3. TOOL SYSTEM — CC's Design in Detail
CC's Tool interface (what each tool must implement):
typescript
// CC Tool shape (simplified from Tool.ts)
interface Tool {
  name: string;
  inputSchema: ZodSchema;           // Runtime validation + TS inference
  maxResultSizeChars: number;        // Per-tool output cap (e.g., 50K for grep)
  aliases?: string[];                // Alternative names LLM might use

  call(args, context, canUseTool): Promise<ToolResult>;
  checkPermissions(input, context): PermissionResult;
  isConcurrencySafe(input): boolean; // Can this run in parallel?
  isReadOnly(input): boolean;        // Does this only read?
  isDestructive(input): boolean;     // Could this cause damage?

  // TUI rendering — each tool controls its own display
  renderToolUseMessage(input): ReactElement;
  renderToolResultMessage(result): ReactElement;
  userFacingName(input): string;     // Display label
}
HLVM's ToolMetadata for comparison:
typescript
interface ToolMetadata {
  fn: (args, workspace, opts?) => Promise<unknown>;
  description: string;
  args: Record<string, string>;      // argName → description (no types!)
  safetyLevel: "L0" | "L1" | "L2";  // Static safety classification
  category: string;                   // For adaptive phasing
  replaces: string[];                 // Tool routing hints
  argAliases?: Record<string, string[]>;
  formatResult?: (result) => string;
}
```

**Key difference — Zod vs Record<string, string>**:
```
CC with Zod:
  inputSchema: z.object({
    path: z.string().describe("File path"),
    line: z.number().int().min(1).optional(),
    content: z.string().max(10000),
  })

  → Runtime validation with specific error messages
  → TypeScript inference: args is typed as { path: string; line?: number; content: string }
  → Supports nested objects, enums, unions, arrays
  → safeParse returns { success: false, error: ZodError } with field-level details

HLVM with Record:
  args: {
    path: "File path to edit",
    line: "Line number (optional)",
    content: "New content to write",
  }

  → No runtime validation
  → No type inference (everything is unknown)
  → Can't express optional, nested, enum constraints
  → LLM gets descriptions but schema isn't enforced
```

**CC's tool pool assembly**:
```
getAllBaseTools()
│  40+ built-in tools
│  ├─ conditional: some tools gated by env vars or feature flags
│  └─ sorted alphabetically (important: prompt cache stability —
│     if tools are in consistent order, Anthropic's prompt cache
│     hits more often, saving money)
│
▼
assembleToolPool(permCtx, mcpTools)
│  ├─ built-in tools (sorted) + MCP tools (sorted)
│  ├─ dedup by name (built-in wins over MCP if name collision)
│  └─ filter by deny rules (removed before LLM ever sees them)
```

---

### 4. TUI RENDERING — CC's Performance Patterns

**StreamingMarkdown — the split-boundary algorithm**:
```
Problem: Markdown text arrives character-by-character during streaming.
         Re-parsing the entire text every frame is O(n) where n grows.

CC's solution: Split text into stable prefix + unstable suffix.

Frame 1:  "# Hello"
          └─ stable: ""  |  unstable: "# Hello"

Frame 2:  "# Hello\n\nThis is a para"
          └─ stable: "# Hello\n\n"  |  unstable: "This is a para"

Frame 3:  "# Hello\n\nThis is a paragraph.\n\n```js"
          └─ stable: "# Hello\n\nThis is a paragraph.\n\n"  |  unstable: "```js"

KEY INSIGHT: The split boundary is the last "safe" markdown boundary
(end of paragraph, end of code block, etc.). Everything before it
is fully parsed and MEMOIZED — never re-parsed.

Only the unstable suffix (typically <100 chars) gets re-lexed each frame.

Performance: O(suffix length) per frame, NOT O(full text length)

Additional optimizations:
├─ 500-entry LRU token cache (marked.lexer results cached by content hash)
├─ Fast-path: if text contains no markdown chars → skip lexer entirely
└─ Lazy syntax highlighting via React Suspense (don't block render)
```

HLVM: Direct text append, full re-render each frame. O(full text) per frame. No markdown parsing in TUI at all.

**CC's diff rendering — Rust NAPI**:
```
ColorDiff (Rust module compiled to Node.js native addon via NAPI):

Input:  oldText, newText, theme, width, dim, gutter
Output: ANSI-escaped string with word-level colored diffs

Features:
├─ Word-level granularity (not just line-level)
├─ Syntax highlighting ON the diff (language-aware)
├─ WeakMap cache keyed by (theme, width, dim, gutter) → ANSI output
├─ NoSelect gutter: line numbers rendered in a way that
│  copy-paste skips them (terminal selection trick)
└─ RawAnsi: bypasses Ink's ANSI parser for direct terminal write
   (avoids double-parsing overhead)

WHY Rust: Diffing + syntax highlighting + ANSI rendering is CPU-heavy.
          Rust NAPI runs this at native speed, no GC pressure.
```

HLVM: No diff visualization at all. File edits show before/after text without visual comparison.

**CC's message rendering — per-tool custom UI**:
```
Message.tsx (626 lines) — dispatcher:
│
├─ Examines block type of each content block
├─ Delegates to 15+ specialized components
│
└─ For tool_use/tool_result:
   tool.renderToolUseMessage(input)     ← TOOL CONTROLS ITS OWN UI
   tool.renderToolResultMessage(result)

   Examples:
   ├─ BashTool:    Shows command in monospace, output in scrollable box
   ├─ EditFileTool: Shows syntax-highlighted diff with line numbers
   ├─ ReadFileTool: Shows file content with line numbers and truncation
   ├─ GrepTool:    Shows matched lines with context and highlighting
   └─ WebSearchTool: Shows search results with titles and snippets
```

HLVM: Generic `ToolGroup` component renders all tools the same way — tool name, args, and raw result text. No per-tool customization.

**CC's PromptInput** — ~190 props orchestrating:
```
PromptInput
├─ TextInput → BaseTextInput
│  └─ Voice recording with waveform cursor animation
├─ Slash command typeahead + suggestion dropdown
│  └─ Fuzzy match on command names and descriptions
├─ Mode pills: [plan] [vim] [auto] [fast]
│  └─ Visual indicators of current mode
├─ Footer pills: [tasks] [bridge] [teams] [companion]
├─ VimTextInput (optional, full vim keybindings)
├─ Submit: Enter  |  Multiline: Shift+Enter or Ctrl+E
├─ Image paste (clipboard → base64 → API)
├─ Stashed prompts (save incomplete input for later)
└─ History: ↑/↓ cycle through previous inputs
```

HLVM's Input.tsx (3767 lines) has a different strength — Paredit:
```
Input.tsx
├─ Paredit (structural editing for s-expressions):
│  ├─ slurpForward/Backward    (expand parens to include next/prev form)
│  ├─ barfForward/Backward     (shrink parens to exclude last/first form)
│  ├─ raiseSexp               (replace parent with current form)
│  ├─ spliceSexp              (remove enclosing parens)
│  ├─ killSexp                (delete form at cursor)
│  ├─ transposeSexp           (swap adjacent forms)
│  ├─ wrapSexp                (wrap selection in parens)
│  └─ forwardSexp/backwardSexp (navigate by s-expression)
├─ Syntax highlighting:
│  ├─ detectComposerLanguage() → HQL | markdown | plain
│  └─ getComposerHighlightSegments() → colored spans
├─ Completions: Tab accept, @ mentions (file/symbol picker)
├─ History: ↑/↓ cycle, Ctrl+R reverse search
└─ Multiline: automatic when parens are unbalanced
```

---

### 5. CONTEXT COMPACTION — CC's Full Strategy

CC has a **5-level compaction hierarchy**, from cheapest to most expensive:
```
LEVEL 1: applyToolResultBudget()
  Cost: Zero (just truncation)
  When: Every iteration
  What: Cap aggregate tool_result size per message

LEVEL 2: snipCompact [feature-gated]
  Cost: Zero (pattern-based truncation)
  When: Feature-gated, before other compaction
  What: Find large expandable sections, replace middle with "[snipped]"

LEVEL 3: microcompact()
  Cost: Zero (heuristic removal)
  When: Context growing but not at threshold
  What: Remove old thinking blocks, redundant succeeded-op outputs

LEVEL 4: contextCollapse()
  Cost: Zero (deduplication)
  When: Before autocompact
  What: Collapse repeated file reads into "[see latest version]"
  Uses: COMPACT_BOUNDARY markers inserted during tool execution

LEVEL 5: autocompact()
  Cost: HIGH (LLM API call to Sonnet for summarization)
  When: Context exceeds (contextWindow - 13K buffer)
  What: Full conversation summarization + post-compact re-injection
  Safety: Circuit breaker after 3 consecutive failures

REACTIVE (on 413 error):
  Cost: HIGH (emergency compaction)
  When: API returns 413 (prompt too long)
  What: Same as autocompact but triggered reactively, then RETRY
  This is CC's killer feature: the request isn't lost.
```

HLVM's equivalent:
```
LEVEL 1: compactIfNeeded() at 80% budget
  Cost: HIGH (LLM summarization)
  What: Summarize older messages, keep system + recent N

LEVEL 2: ContextOverflowError
  Cost: Zero (but request is LOST)
  What: Graceful return — user must re-ask

LEVEL 3: Group-aware trimming
  Cost: Low
  What: Remove old tool groups before individual messages
```

---

### 6. HOOKS SYSTEM — CC's Extensibility Model
```
20+ lifecycle events:

SESSION:     SessionStart, SessionEnd, ConfigChanged, CWDChanged
PROMPT:      UserPrompt, InstructionsLoaded
TOOL:        PreToolUse, PostToolUse, Stop, StopFailure
COMPACTION:  PreCompact, PostCompact
AGENT:       SubagentStart, SubagentStop, Elicitation
TEAM:        TaskCreated, TaskCompleted, TeammateIdle
FILE:        FileChanged
PERMISSION:  PermissionRequest

4 execution modes:
├─ Shell command  → exec in subprocess, capture stdout
├─ Prompt-based   → inject result into conversation as context
├─ Agent hook     → spawn sub-agent with the hook output
└─ HTTP hook      → webhook call to external service

Async hooks:
├─ Run in background (don't block main loop)
└─ "Rewake" notification: when hook completes,
   inject a message into conversation telling the model
   about the result (model was doing other work meanwhile)
```

Example use cases:
- Auto-format on file save (PostToolUse → shell: `prettier --write`)
- Auto-test after edit (PostToolUse → shell: `npm test`)
- Custom approval flow (PermissionRequest → HTTP: call internal approval API)
- Team notifications (TaskCompleted → HTTP: post to Slack)

HLVM: No user-extensible hooks system.

---

### 7. MEMORY — Implementation Details

**CC's file-based memory**:
```
~/.claude/projects/<project-slug>/memory/
├─ MEMORY.md         (index file, max 200 lines, ALWAYS loaded into context)
├─ auth-system.md    (topic file with frontmatter)
│  ---
│  name: auth-system
│  type: project
│  description: "Authentication architecture and patterns"
│  ---
│  (detailed content about auth implementation...)
│
├─ db-schema.md
└─ api-patterns.md

Retrieval flow:
1. scanMemoryFiles(dir) → extract frontmatter headers only (cheap)
2. selectRelevantMemories(query, headers)
   └─ Sonnet side-query with JSON schema output
   └─ Picks up to 5 most relevant files based on name/type/description
   └─ This costs an extra API call but gets high-quality relevance ranking
3. Load selected file contents → inject into conversation context

Types: user | feedback | project | reference
```

**HLVM's SQLite FTS5 memory**:
```
SQLite Database:
├─ facts table
│  ├─ id, content, category
│  ├─ validFrom, validUntil (temporal validity windows)
│  ├─ createdAt, confidence
│  └─ pinned (boolean — always-loaded facts)
│
├─ entities table
│  └─ name, type (person, project, concept, etc.)
│
├─ relationships table
│  └─ source_entity_id, target_entity_id, relationship_type
│
└─ FTS5 virtual table (auto-synced from facts)
   └─ BM25 scoring + temporal decay (30-day half-life)

Retrieval flow:
1. FTS5 keyword search with BM25 ranking + temporal decay weighting
2. Entity graph traversal (follow relationships from matched entities)
3. Merge + deduplicate via Map
4. Return ranked facts → inject into conversation

Conflict resolution:
├─ detectConflicts()       → Jaccard similarity > 0.4 = candidate conflict
└─ autoInvalidateConflicts → similarity > 0.9 = auto-invalidate old fact

Always loaded: 10 pinned facts + "[N more facts available — use memory_search]"
```

---

### 8. MULTI-AGENT TEAMS — Both Approaches

**CC — cross-process, file-backed**:
```
~/.claude/teams/<team-name>/
├─ config.json     { members: [...], lead: "agent-0", created_at }
├─ tasks/
│  ├─ task-001.json  { title, description, owner, status, result }
│  ├─ task-002.json
│  └─ task-003.json
└─ mailbox/
   ├─ agent-0/     (files: msg-001.json, msg-002.json, ...)
   ├─ agent-1/
   └─ agent-2/

Process model:
Team Lead (main process)
├─ Teammate 1 (tmux pane OR separate Node.js process)
├─ Teammate 2 (tmux pane)
└─ Teammate 3 (subprocess)

Communication: writeToMailbox(agentId, message)
→ Writes JSON file to mailbox/<agentId>/msg-<timestamp>.json
→ Agent polls its mailbox directory for new files
→ Survives crashes (files persist)
→ Can span multiple machines (shared filesystem)

Shutdown: SendMessage with structured JSON:
{ type: "shutdown_request" } → teammate responds → lead confirms
```

**HLVM — in-process, in-memory**:
```
~/.hlvm/tasks/<team-name>/
├─ task-001.json
├─ task-002.json
└─ .highwatermark  (next task ID, avoids ID collisions)

Process model:
Team Lead (main async loop)
├─ Teammate 1 (runTeammateLoop() — async function, same process)
├─ Teammate 2 (async function)
└─ Teammate 3 (async function)

Communication: in-memory inbox (TeamMessageKind union type)
→ Direct function calls between loops
→ Lost on crash (no persistence)
→ Single process only (no true parallelism on multi-core)

Teammate loop:
1. Check inbox for messages/shutdown requests
2. Check task list for unclaimed tasks
3. Claim task → set owner + status: "in_progress"
4. Run agent query on task
5. Mark task completed
6. Send idle_notification to lead
7. Poll for next task (idlePollIntervalMs: 3s, maxIdlePolls: 30)
```

---

### 9. COST TRACKING — CC's Approach
```
addToTotalSessionCost(cost, usage, model)
├─ input_tokens
├─ output_tokens
├─ cache_read_input_tokens
├─ cache_creation_input_tokens
├─ web requests
└─ advisor (sub-model) usage — recursive for side-queries

Hardcoded pricing:
├─ Sonnet:     $3 / $15   per M tokens (in/out)
├─ Opus 4:     $15 / $75
└─ Opus 4.6:   $30 / $150

StatusLine display (async, debounced 300ms):
├─ Model name
├─ Total cost (USD)
├─ Context window: used_percentage
├─ Rate limits: 5h window used_percentage
└─ Rendered as ANSI text via user-configurable command
```

HLVM: `TurnStats` component shows per-turn tokens/time/cost but no session-level accumulation or pricing tier awareness.

---

### 10. SKILLS/PLUGINS — CC's Discovery System
```
Sources (priority order):
1. Managed skills  (bundled in binary — Anthropic's built-in skills)
2. User skills     (~/.claude/skills/ — user-defined)
3. Project skills  (.claude/skills/ — per-project)
4. Legacy commands (.claude/commands/ — backward compat)

Format:
skill-name/SKILL.md
---
name: "My Skill"
description: "Does something useful"
paths: ["*.py", "src/**/*.ts"]   ← conditional: auto-activates on matching files
execution: inline | fork          ← inline = inject into conversation; fork = sub-agent
---
(skill instructions / prompt content)

Discovery:
/command-name → searches all skill sources
Tab completion on / prefix
Fuzzy matching on name + description
```

HLVM: No equivalent plugin/skills system. Commands are hardcoded.

---

### 11. FEATURE GATES — CC's Compile-Time System
```
CC uses compile-time feature flags for experimental features:

if (FEATURE_STREAMING_TOOL_EXEC) {
  // This code is DEAD CODE ELIMINATED in production builds
  // when the flag is off — not just runtime-skipped
  startStreamingToolExecutor(toolBlocks);
}

Benefits:
├─ Zero runtime cost for disabled features
├─ Smaller bundle size (tree-shaking removes dead paths)
├─ Clean A/B testing (different builds for different cohorts)
└─ Safe experimentation (feature can't accidentally leak)
```

HLVM: No feature gate system. All code is always active.

---

### Summary: Technical Adoption Roadmap for HLVM
```
PHASE 1 — Error Recovery (highest impact, most urgent):
├─ Reactive compaction (413 → compact → retry)
├─ Output continuation (max_output_tokens → inject "resume" → retry 3x)
├─ Dynamic maxTokens adjustment (parse error body → fit output)
└─ Subscriber-aware retry with persistent mode for unattended runs

PHASE 2 — Performance:
├─ StreamingMarkdown split-boundary algorithm
├─ Tool concurrency classification (isConcurrencySafe per tool)
├─ Streaming tool executor (start during API response)
└─ Per-tool result size limits (maxResultSizeChars)

PHASE 3 — UX Polish:
├─ Per-tool custom TUI rendering
├─ Diff visualization (can use JS diff library, Rust NAPI optional)
├─ Microcompaction (gradual reduction before full compaction)
├─ User input truncation (head+tail for piped/large inputs)
└─ Vim mode for input

PHASE 4 — Extensibility:
├─ User-extensible hooks (pre/post tool use lifecycle)
├─ Skills/plugins system with conditional activation
├─ Auto-mode AI classifier for tool permissions
└─ Feature gate system for safe experimentation
what are overlapped features between two and what are things HLVM should learn from CC HLVM is lagging behind? list all of them as well as technical details all - drawing full ASCII visual to be better visualized - don't need to compare all features CC has - but both in common
4:01 AM

Identified shared features where HLVM lags behind CC with technical details
Identified shared features where HLVM lags behind CC with technical details
Here are all overlapping features where both projects implement the same thing, but CC's implementation is more mature — with full technical details on what HLVM should learn.
Overlapping Features: Where HLVM Lags Behind CC
Quick Reference — All 14 Shared Features Where CC Leads
╔══════════════════════════════════════════════════════════════════════════╗
║  SHARED FEATURE                    CC MATURITY    HLVM MATURITY   GAP  ║
╠══════════════════════════════════════════════════════════════════════════╣
║  1.  Context Compaction            ██████████     ████░░░░░░      BIG  ║
║  2.  Tool Concurrency              ██████████     ███░░░░░░░      BIG  ║
║  3.  Error Recovery / Retry        ██████████     ██░░░░░░░░      BIG  ║
║  4.  Streaming Text Rendering      ██████████     ██░░░░░░░░      BIG  ║
║  5.  Tool Result Size Control      ████████░░     ░░░░░░░░░░      BIG  ║
║  6.  Tool Input Validation         ██████████     ███░░░░░░░      MED  ║
║  7.  Per-Tool TUI Rendering        ██████████     ████░░░░░░      MED  ║
║  8.  Permission System             ██████████     ██████░░░░      MED  ║
║  9.  Message Normalization         ██████████     █████░░░░░      MED  ║
║ 10.  Multi-Agent Communication     ████████░░     █████░░░░░      MED  ║
║ 11.  App Shell / Provider Split    ████████░░     █████░░░░░      SML  ║
║ 12.  State Management              ████████░░     ██████░░░░      SML  ║
║ 13.  Cost / Usage Tracking         ████████░░     █████░░░░░      SML  ║
║ 14.  Input Component               ████████░░     ████████░░      SML  ║
╚══════════════════════════════════════════════════════════════════════════╝
1. CONTEXT COMPACTION
Both do LLM-powered summarization. CC has a 5-level hierarchy; HLVM has 1 level + give up.
┌─────────────────────────────────────────────────────────────────────────┐
│                      CONTEXT COMPACTION PIPELINE                        │
├───────────────────────────────────┬─────────────────────────────────────┤
│           CLAUDE CODE             │              HLVM                    │
├───────────────────────────────────┼─────────────────────────────────────┤
│                                   │                                     │
│  LEVEL 1: applyToolResultBudget() │  (nothing)                          │
│  ┌─────────────────────────────┐  │                                     │
│  │ Cap aggregate tool_result   │  │                                     │
│  │ size per message.           │  │                                     │
│  │ Cost: ZERO (truncation)     │  │                                     │
│  │ When: EVERY iteration       │  │                                     │
│  │                             │  │                                     │
│  │ A single grep can return    │  │  HLVM allows unbounded tool         │
│  │ megabytes. This caps it     │  │  results to fill context.           │
│  │ before the API call.        │  │                                     │
│  └─────────────────────────────┘  │                                     │
│           │                       │                                     │
│           ▼                       │                                     │
│  LEVEL 2: snipCompact()           │  (nothing)                          │
│  ┌─────────────────────────────┐  │                                     │
│  │ Find large expandable       │  │                                     │
│  │ sections → replace middle   │  │                                     │
│  │ with "[snipped N chars]"    │  │                                     │
│  │ Cost: ZERO                  │  │                                     │
│  │ Feature-gated               │  │                                     │
│  └─────────────────────────────┘  │                                     │
│           │                       │                                     │
│           ▼                       │                                     │
│  LEVEL 3: microcompact()          │  (nothing)                          │
│  ┌─────────────────────────────┐  │                                     │
│  │ Heuristic removal:          │  │                                     │
│  │ - old thinking blocks       │  │                                     │
│  │ - redundant succeeded-op    │  │  HLVM has no gradual reduction.     │
│  │   outputs                   │  │  It's either fine or it hits 80%    │
│  │ - collapsed results         │  │  and does full LLM summarization.   │
│  │ Cost: ZERO                  │  │                                     │
│  │ When: context growing but   │  │                                     │
│  │ not yet at threshold        │  │                                     │
│  └─────────────────────────────┘  │                                     │
│           │                       │                                     │
│           ▼                       │                                     │
│  LEVEL 4: contextCollapse()       │  Group-aware trimming               │
│  ┌─────────────────────────────┐  │  ┌───────────────────────────────┐  │
│  │ Collapse repeated file      │  │  │ Remove old tool groups        │  │
│  │ reads:                      │  │  │ before individual messages.   │  │
│  │ Read #1: "[see latest]"     │  │  │                               │  │
│  │ Read #2: "[see latest]"     │  │  │ Less targeted — removes       │  │
│  │ Read #3: (full content)     │  │  │ entire groups vs CC's         │  │
│  │                             │  │  │ surgical dedup.               │  │
│  │ Uses COMPACT_BOUNDARY       │  │  └───────────────────────────────┘  │
│  │ markers inserted during     │  │                                     │
│  │ tool execution.             │  │                                     │
│  │ Cost: ZERO                  │  │                                     │
│  └─────────────────────────────┘  │                                     │
│           │                       │           │                         │
│           ▼                       │           ▼                         │
│  LEVEL 5: autocompact()           │  compactIfNeeded()                  │
│  ┌─────────────────────────────┐  │  ┌───────────────────────────────┐  │
│  │ Full LLM summarization      │  │  │ Full LLM summarization       │  │
│  │ via Sonnet                  │  │  │                               │  │
│  │                             │  │  │ Threshold: 80% of budget     │  │
│  │ Threshold:                  │  │  │                               │  │
│  │ contextWindow - 13K buffer  │  │  │ Keeps system + recent N msgs │  │
│  │                             │  │  │                               │  │
│  │ Post-compact re-injection:  │  │  │ (no re-injection)            │  │
│  │ ├─ re-read relevant files   │  │  │                               │  │
│  │ ├─ re-list agent/team state │  │  │ HLVM does pre-compaction     │  │
│  │ └─ re-inject cwd context    │  │  │ memory flush instead (unique │  │
│  │                             │  │  │ strength — save facts before  │  │
│  │ Circuit breaker:            │  │  │ context is destroyed).        │  │
│  │ 3 consecutive failures →    │  │  │                               │  │
│  │ stop trying                 │  │  │ No circuit breaker.           │  │
│  └─────────────────────────────┘  │  └───────────────────────────────┘  │
│           │                       │           │                         │
│           ▼                       │           ▼                         │
│  REACTIVE (on 413 error):         │  ContextOverflowError:              │
│  ┌─────────────────────────────┐  │  ┌───────────────────────────────┐  │
│  │ API returns 413 →           │  │  │ GRACEFUL RETURN               │  │
│  │ reactive compaction →       │  │  │                               │  │
│  │ RETRY the same request      │  │  │ User's request is LOST.      │  │
│  │                             │  │  │ They must re-ask.             │  │
│  │ THE USER'S REQUEST          │  │  │                               │  │
│  │ IS NOT LOST.                │  │  │ *** #1 GAP TO CLOSE ***       │  │
│  └─────────────────────────────┘  │  └───────────────────────────────┘  │
└───────────────────────────────────┴─────────────────────────────────────┘
What HLVM should adopt:
Priority 1: Reactive compaction (413 → compact → retry)
  try {
    response = await llm(messages);
  } catch (e) {
    if (e.status === 413 || e instanceof ContextOverflowError) {
      messages = await compactConversation(messages);
      response = await llm(messages);  // RETRY, don't give up
    }
  }

Priority 2: Tool result budget (per-message cap)
  const MAX_AGGREGATE_RESULT_SIZE = 50_000; // chars
  // After all tool results collected, if total > cap:
  // Truncate largest results first (head + tail with "[truncated]")

Priority 3: Microcompact (heuristic removal before LLM summarization)
  function microcompact(messages) {
    return messages.map(msg => {
      if (msg.role === 'assistant' && msg.thinking) return stripThinking(msg);
      if (msg.toolResult && msg.succeeded) return truncateResult(msg);
      return msg;
    });
  }

Priority 4: Post-compact re-injection
  After compaction, re-read files the agent was actively working on.
  Prevents "I was editing foo.ts but now I don't know what's in it."

Priority 5: Circuit breaker (3 failures → stop compacting)
  let compactionFailures = 0;
  if (compactionFailures >= 3) {
    // Don't waste API calls on doomed compactions
    skipCompaction = true;
  }
2. TOOL CONCURRENCY
Both execute multiple tools per turn. CC partitions safe/unsafe; HLVM runs everything in parallel.
┌─────────────────────────────────────────────────────────────────────────┐
│                    TOOL CONCURRENCY EXECUTION                           │
├───────────────────────────────────┬─────────────────────────────────────┤
│           CLAUDE CODE             │              HLVM                    │
├───────────────────────────────────┼─────────────────────────────────────┤
│                                   │                                     │
│  LLM returns: [R, R, G, E, R, R] │  LLM returns: [R, R, G, E, R, R]   │
│  (Read, Read, Grep, Edit, Read,   │                                     │
│   Read)                           │                                     │
│                                   │                                     │
│  Step 1: partitionToolCalls()     │  Step 1: (no partitioning)          │
│                                   │                                     │
│  Walk left-to-right:              │  Promise.all([                      │
│  ┌─────────────────────────────┐  │    exec(Read),                      │
│  │ R → safe? YES → accumulate  │  │    exec(Read),                      │
│  │ R → safe? YES → accumulate  │  │    exec(Grep),                      │
│  │ G → safe? YES → accumulate  │  │    exec(Edit),   ← DANGER          │
│  │   FLUSH → Batch 1: [R,R,G] │  │    exec(Read),   ← reads DURING    │
│  │ E → safe? NO  → serial     │  │    exec(Read),      edit!           │
│  │   Batch 2: [E] alone       │  │  ])                                  │
│  │ R → safe? YES → accumulate  │  │                                     │
│  │ R → safe? YES → accumulate  │  │  ALL 6 run simultaneously.          │
│  │   FLUSH → Batch 3: [R,R]   │  │  Read might see half-written file.  │
│  └─────────────────────────────┘  │  Two Edits could corrupt same file. │
│                                   │                                     │
│  Step 2: Execute batches          │                                     │
│                                   │                                     │
│  Batch 1: ──→ Promise.all([       │                                     │
│                 R, R, G            │                                     │
│               ]) (parallel, ≤10)  │                                     │
│           │                       │                                     │
│           ▼                       │                                     │
│  Batch 2: ──→ await Edit          │                                     │
│               (serial, alone)     │                                     │
│           │                       │                                     │
│           ▼                       │                                     │
│  Batch 3: ──→ Promise.all([       │                                     │
│                 R, R               │                                     │
│               ]) (parallel)       │                                     │
│                                   │                                     │
│  Per-tool declaration:            │  Per-tool declaration:               │
│  ┌─────────────────────────────┐  │  ┌───────────────────────────────┐  │
│  │ isConcurrencySafe(input) {  │  │  │ safetyLevel: "L0" | "L1"     │  │
│  │   // Read-only tools:       │  │  │                               │  │
│  │   return true;              │  │  │ (classifies danger level but  │  │
│  │ }                           │  │  │  NOT concurrency safety)      │  │
│  │                             │  │  │                               │  │
│  │ // Some are input-dependent:│  │  │ L0 = safe (read-only)         │  │
│  │ // Bash("ls") → safe       │  │  │ L1 = needs confirmation       │  │
│  │ // Bash("rm") → unsafe     │  │  │ L2 = dangerous                │  │
│  └─────────────────────────────┘  │  └───────────────────────────────┘  │
│                                   │                                     │
│  Max concurrency per batch: 10    │  Max concurrency: unlimited         │
│  (env-configurable)               │                                     │
└───────────────────────────────────┴─────────────────────────────────────┘
What HLVM should adopt:
// Add to ToolMetadata:
isConcurrencySafe?: (args: Record<string, string>) => boolean;

// Default: derive from safetyLevel
// L0 → true (read-only tools are always safe)
// L1/L2 → false (mutation tools are serial)

// Special cases (input-dependent):
// shell_exec: safe if command is read-only (ls, cat, grep)
//             unsafe if command mutates (rm, mv, write)

// Partitioning algorithm:
function partitionToolCalls(calls: ToolCall[]): ToolCall[][] {
  const batches: ToolCall[][] = [];
  let currentBatch: ToolCall[] = [];

  for (const call of calls) {
    const tool = registry.get(call.name);
    const safe = tool?.isConcurrencySafe?.(call.args)
                 ?? (tool?.safetyLevel === 'L0');

    if (safe) {
      currentBatch.push(call);
    } else {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);  // flush safe batch
        currentBatch = [];
      }
      batches.push([call]);          // unsafe alone
    }
  }
  if (currentBatch.length > 0) batches.push(currentBatch);
  return batches;
}

// Execute:
for (const batch of batches) {
  const results = await Promise.all(
    batch.slice(0, 10).map(executeToolCall)  // cap at 10
  );
  allResults.push(...results);
}
3. ERROR RECOVERY / RETRY
Both retry on transient errors. CC has 7 named recovery paths; HLVM has 1.
┌─────────────────────────────────────────────────────────────────────────┐
│                    ERROR RECOVERY COMPARISON                            │
├───────────────────────────────────┬─────────────────────────────────────┤
│           CLAUDE CODE             │              HLVM                    │
├───────────────────────────────────┼─────────────────────────────────────┤
│                                   │                                     │
│  ┌── 413 PROMPT TOO LONG ──────┐  │  ┌── ContextOverflowError ───────┐  │
│  │                              │  │  │                               │  │
│  │  Path 1: collapse_drain      │  │  │  → graceful return            │  │
│  │  → drain staged collapses    │  │  │  → REQUEST LOST               │  │
│  │  → retry                     │  │  │                               │  │
│  │                              │  │  │  No retry. No compaction.     │  │
│  │  Path 2: reactive_compact    │  │  │  User must re-ask.            │  │
│  │  → full LLM summarization    │  │  │                               │  │
│  │  → retry with compacted ctx  │  │  └───────────────────────────────┘  │
│  │  → REQUEST PRESERVED         │  │                                     │
│  └──────────────────────────────┘  │                                     │
│                                   │                                     │
│  ┌── MAX OUTPUT TOKENS HIT ────┐  │  ┌── (no handling) ──────────────┐  │
│  │                              │  │  │                               │  │
│  │  Path 3: escalate to 64K    │  │  │  Truncated = truncated.       │  │
│  │  → retry with higher limit   │  │  │  No continuation.            │  │
│  │                              │  │  │                               │  │
│  │  Path 4: continuation       │  │  │  Long responses get cut off   │  │
│  │  → inject meta-message:      │  │  │  mid-sentence.               │  │
│  │    "Your response was        │  │  │                               │  │
│  │     truncated. Continue."    │  │  └───────────────────────────────┘  │
│  │  → up to 3 continuation     │  │                                     │
│  │    turns appended together   │  │                                     │
│  └──────────────────────────────┘  │                                     │
│                                   │                                     │
│  ┌── 429 RATE LIMIT ───────────┐  │  ┌── 429 handling ───────────────┐  │
│  │                              │  │  │                               │  │
│  │  withRetry() async generator │  │  │  Exponential backoff          │  │
│  │  yields UI status messages:  │  │  │  Up to 2 retries              │  │
│  │  "Retrying in 5s..."        │  │  │                               │  │
│  │  "Rate limited, waiting..."  │  │  │  No UI feedback during wait.  │  │
│  │                              │  │  │  No subscriber awareness.     │  │
│  │  Subscriber-aware:           │  │  │  No persistent mode.          │  │
│  │  ├─ Pro: shorter retry       │  │  │  No background query bail.    │  │
│  │  └─ Enterprise: more patient │  │  │                               │  │
│  │                              │  │  └───────────────────────────────┘  │
│  │  Persistent mode:            │  │                                     │
│  │  └─ infinite retry + heartbt │  │                                     │
│  │    (unattended agent runs)   │  │                                     │
│  │                              │  │                                     │
│  │  Background queries:         │  │                                     │
│  │  └─ bail on 529 immediately  │  │                                     │
│  │    (don't waste retries on   │  │                                     │
│  │     side-queries like memory │  │                                     │
│  │     or fast-mode advisor)    │  │                                     │
│  └──────────────────────────────┘  │                                     │
│                                   │                                     │
│  ┌── CONTEXT OVERFLOW ─────────┐  │  ┌── (no handling) ──────────────┐  │
│  │                              │  │  │                               │  │
│  │  Parse error body:           │  │  │  Fixed budget. If overflow,   │  │
│  │  { inputTokens, ctxLimit }   │  │  │  same as 413 — give up.      │  │
│  │  maxTokens = ctxLimit -      │  │  │                               │  │
│  │              inputTokens     │  │  └───────────────────────────────┘  │
│  │  → retry with dynamic limit  │  │                                     │
│  └──────────────────────────────┘  │                                     │
│                                   │                                     │
│  ┌── 529 OVERLOADED ───────────┐  │  ┌── (no handling) ──────────────┐  │
│  │  Background → bail now       │  │  │                               │  │
│  │  Foreground → 3x retry then  │  │  │  No 529-specific handling.   │  │
│  │    fall back to slower model  │  │  │                               │  │
│  └──────────────────────────────┘  │  └───────────────────────────────┘  │
└───────────────────────────────────┴─────────────────────────────────────┘
What HLVM should adopt:
// Priority 1: Reactive compaction on 413
// (covered in section 1 above)

// Priority 2: Output continuation
async function handleMaxOutputTokens(response, messages) {
  if (response.stopReason !== 'max_tokens') return response;

  let fullText = response.text;
  for (let i = 0; i < 3; i++) {
    const continuation = await llm([
      ...messages,
      { role: 'assistant', content: fullText },
      { role: 'user', content: '[System: Your previous response was ' +
        'truncated at the token limit. Continue exactly from where ' +
        'you left off.]' }
    ]);
    fullText += continuation.text;
    if (continuation.stopReason !== 'max_tokens') break;
  }
  return { ...response, text: fullText };
}

// Priority 3: Dynamic maxTokens on overflow
catch (e) {
  if (e.inputTokens && e.contextLimit) {
    const available = e.contextLimit - e.inputTokens;
    return await llm(messages, { maxTokens: available });
  }
}

// Priority 4: withRetry as async generator (UI feedback)
async function* withRetry(fn, { maxRetries, onRetry }) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === maxRetries) throw e;
      const delay = Math.pow(2, i) * 1000;
      yield { type: 'retry_status', delay, attempt: i + 1 };
      // ↑ TUI can render "Retrying in 2s..." from this
      await sleep(delay);
    }
  }
}
4. STREAMING TEXT RENDERING
Both stream LLM output to TUI character-by-character. CC uses split-boundary O(tail); HLVM uses full re-render O(n).
┌─────────────────────────────────────────────────────────────────────────┐
│                    STREAMING TEXT PERFORMANCE                            │
├───────────────────────────────────┬─────────────────────────────────────┤
│           CLAUDE CODE             │              HLVM                    │
├───────────────────────────────────┼─────────────────────────────────────┤
│                                   │                                     │
│  StreamingMarkdown component      │  Direct text state update           │
│                                   │                                     │
│  Algorithm: split-boundary        │  Algorithm: full re-render          │
│                                   │                                     │
│  "# Hello\n\nParagraph.\n\n```"  │  "# Hello\n\nParagraph.\n\n```"    │
│   ────────────────────── ─────    │   ─────────────────────────────     │
│   stablePrefix (memoized) tail    │   entire string re-processed        │
│                                   │                                     │
│  HOW IT WORKS:                    │  HOW IT WORKS:                      │
│                                   │                                     │
│  Frame N:  text = "# He"         │  Frame N:  text = "# He"            │
│  ┌─────────────────┐              │  ┌───────────────────────────────┐  │
│  │ stable: ""      │              │  │ render entire "# He"          │  │
│  │ tail:   "# He"  │ ← lex tail  │  │                               │  │
│  └─────────────────┘              │  └───────────────────────────────┘  │
│                                   │                                     │
│  Frame N+500: text = "# Hello    │  Frame N+500: text = "# Hello      │
│  \n\nThis is a long paragraph    │  \n\nThis is a long paragraph      │
│  about many things.\n\n```js\n"  │  about many things.\n\n```js\n"    │
│  ┌─────────────────────────────┐  │  ┌───────────────────────────────┐  │
│  │ stable: "# Hello\n\nThis   │  │  │ re-render ENTIRE 200-char     │  │
│  │  is a long paragraph about  │  │  │ string from scratch           │  │
│  │  many things.\n\n"          │  │  │                               │  │
│  │  ↑ NEVER RE-PARSED          │  │  │ O(200) every frame            │  │
│  │                             │  │  │                               │  │
│  │ tail: "```js\n"             │  │  │ At 10K chars response:        │  │
│  │  ↑ only this gets lexed     │  │  │ O(10000) every frame          │  │
│  │  O(7) this frame            │  │  │                               │  │
│  └─────────────────────────────┘  │  └───────────────────────────────┘  │
│                                   │                                     │
│  BOUNDARY DETECTION:              │                                     │
│  Split at last "safe" markdown    │  (no split — everything is          │
│  boundary:                        │   one chunk)                        │
│  ├─ end of paragraph (\n\n)       │                                     │
│  ├─ end of code block (```)       │                                     │
│  ├─ end of list item              │                                     │
│  └─ end of heading                │                                     │
│                                   │                                     │
│  ADDITIONAL OPTIMIZATIONS:        │  ADDITIONAL OPTIMIZATIONS:          │
│  ├─ 500-entry LRU cache for      │  (none)                             │
│  │  marked.lexer results          │                                     │
│  ├─ Fast-path: no markdown chars  │  No markdown parsing at all.        │
│  │  detected → skip lexer         │  Plain text only.                   │
│  └─ Lazy syntax highlighting      │                                     │
│     via React Suspense            │                                     │
│                                   │                                     │
│  PERFORMANCE:                     │  PERFORMANCE:                       │
│  O(tail length) per frame         │  O(full text) per frame             │
│  Tail is typically <200 chars     │  Full text grows unbounded          │
│                                   │                                     │
│  At 10K response: ~200 chars/frame│  At 10K response: 10K chars/frame   │
│  At 50K response: ~200 chars/frame│  At 50K response: 50K chars/frame   │
│  ↑ CONSTANT regardless of length  │  ↑ LINEAR growth with response      │
└───────────────────────────────────┴─────────────────────────────────────┘
What HLVM should adopt:
// Split-boundary streaming markdown renderer

function findSplitBoundary(text: string): number {
  // Find last safe markdown boundary
  const boundaries = [
    text.lastIndexOf('\n\n'),           // paragraph break
    text.lastIndexOf('\n```'),          // code fence
    text.lastIndexOf('\n# '),           // heading
    text.lastIndexOf('\n- '),           // list item
  ];
  return Math.max(...boundaries.filter(i => i >= 0));
}

function StreamingMarkdown({ text }: { text: string }) {
  const splitIdx = findSplitBoundary(text);

  // Stable prefix — memoized, never re-parsed
  const stablePrefix = text.slice(0, splitIdx);
  const stableTokens = useMemo(
    () => marked.lexer(stablePrefix),
    [stablePrefix]  // only re-lexes when boundary moves forward
  );

  // Unstable suffix — re-lexed every frame (but tiny)
  const tail = text.slice(splitIdx);
  const tailTokens = marked.lexer(tail);

  return <>{renderTokens(stableTokens)}{renderTokens(tailTokens)}</>;
}

// LRU cache for lexer results
const lexerCache = new LRUCache<string, marked.Token[]>(500);
function cachedLex(text: string): marked.Token[] {
  const cached = lexerCache.get(text);
  if (cached) return cached;
  const tokens = marked.lexer(text);
  lexerCache.set(text, tokens);
  return tokens;
}
5. TOOL RESULT SIZE CONTROL
Both return tool results to the LLM. CC caps per-tool; HLVM has no limits.
┌─────────────────────────────────────────────────────────────────────────┐
│                    TOOL RESULT SIZE CONTROL                              │
├───────────────────────────────────┬─────────────────────────────────────┤
│           CLAUDE CODE             │              HLVM                    │
├───────────────────────────────────┼─────────────────────────────────────┤
│                                   │                                     │
│  Each tool declares:              │  No per-tool limit.                 │
│  maxResultSizeChars: number       │                                     │
│                                   │  A grep returning 500KB goes        │
│  Examples:                        │  straight into context.             │
│  ├─ GrepTool:     30,000 chars   │                                     │
│  ├─ ReadFileTool: 50,000 chars   │  A shell_exec returning 1MB of      │
│  ├─ BashTool:     50,000 chars   │  logs goes straight into context.   │
│  └─ WebSearch:    20,000 chars   │                                     │
│                                   │  This is the fastest way to         │
│  Truncation strategy:             │  blow the context window.           │
│  ┌─────────────────────────────┐  │                                     │
│  │  if (result > limit) {      │  │                                     │
│  │    head = result[0..limit/2]│  │                                     │
│  │    tail = result[-limit/2..]│  │                                     │
│  │    return head +            │  │                                     │
│  │      "\n[truncated " +      │  │                                     │
│  │      (result.length-limit)+ │  │                                     │
│  │      " chars]\n" + tail;    │  │                                     │
│  │  }                          │  │                                     │
│  └─────────────────────────────┘  │                                     │
│                                   │                                     │
│  WHY head+tail (not just head):   │                                     │
│  The END of output often has the  │                                     │
│  most useful info (error messages │                                     │
│  at bottom of logs, final lines   │                                     │
│  of test output, etc.)            │                                     │
└───────────────────────────────────┴─────────────────────────────────────┘
What HLVM should adopt:
// Add to ToolMetadata:
maxResultChars?: number;  // default: 50_000

// In executeToolCall(), after getting result:
function truncateResult(result: string, limit: number): string {
  if (result.length <= limit) return result;
  const half = Math.floor(limit / 2);
  const head = result.slice(0, half);
  const tail = result.slice(-half);
  const dropped = result.length - limit;
  return `${head}\n\n[... truncated ${dropped} characters ...]\n\n${tail}`;
}

// Recommended limits per existing HLVM tools:
// read_file:    50_000
// shell_exec:   50_000
// search_code:  30_000
// search_web:   20_000
// web_fetch:   30_000
// git_log:      20_000
// git_diff:     50_000
6. TOOL INPUT VALIDATION
Both receive tool args from LLM. CC validates with Zod; HLVM trusts the LLM.
┌─────────────────────────────────────────────────────────────────────────┐
│                    TOOL INPUT VALIDATION                                │
├───────────────────────────────────┬─────────────────────────────────────┤
│           CLAUDE CODE             │              HLVM                    │
├───────────────────────────────────┼─────────────────────────────────────┤
│                                   │                                     │
│  inputSchema: z.object({          │  args: {                            │
│    path: z.string(),              │    path: "File path to read",       │
│    line_start: z.number()         │    line_start: "Starting line",     │
│      .int().min(1).optional(),    │    line_end: "Ending line",         │
│    line_end: z.number()           │  }                                  │
│      .int().min(1).optional(),    │                                     │
│  })                               │  // No runtime validation           │
│                                   │  // LLM sends "line_start": "abc"   │
│  const parsed = schema.safeParse( │  // → tool gets string "abc"        │
│    toolInput                      │  //   where it expects number        │
│  );                               │  // → runtime crash or silent bug   │
│                                   │                                     │
│  if (!parsed.success) {           │  // LLM omits required "path"       │
│    return {                       │  // → tool gets undefined            │
│      type: 'error',              │  // → unhelpful error to LLM        │
│      error: parsed.error.format() │                                     │
│    };                             │  // LLM sends extra args             │
│    // Error includes:             │  // → silently ignored (fine)        │
│    // "path: Required"            │                                     │
│    // "line_start: Expected       │                                     │
│    //  number, received string"   │                                     │
│  }                                │                                     │
│                                   │                                     │
│  WHAT THIS ENABLES:               │                                     │
│  ├─ TypeScript inference:         │                                     │
│  │  parsed.data is typed as       │                                     │
│  │  { path: string;               │                                     │
│  │    line_start?: number;        │                                     │
│  │    line_end?: number }         │                                     │
│  │                                │                                     │
│  ├─ LLM gets specific feedback:   │                                     │
│  │  "line_start must be ≥ 1"     │                                     │
│  │  → can self-correct next turn  │                                     │
│  │                                │                                     │
│  ├─ Nested objects/arrays:        │                                     │
│  │  z.array(z.object({...}))      │                                     │
│  │  HLVM can't express this       │                                     │
│  │                                │                                     │
│  └─ Enums/unions:                 │                                     │
│     z.enum(["file","dir"])        │                                     │
│     HLVM can't express this       │                                     │
└───────────────────────────────────┴─────────────────────────────────────┘
What HLVM should adopt:
// Option A: Full Zod migration (high effort, high reward)
// Replace args: Record<string, string> with:
inputSchema: z.object({
  path: z.string().describe("File path"),
  content: z.string().max(50000).describe("Content to write"),
})

// Option B: Lightweight validation layer (low effort, decent reward)
// Keep args: Record<string, string> for LLM schema generation
// Add a validate function:
interface ToolMetadata {
  args: Record<string, string>;
  validate?: (args: Record<string, unknown>) => {
    valid: boolean;
    error?: string;
    cleaned?: Record<string, unknown>;
  };
}

// In executeToolCall:
if (tool.validate) {
  const { valid, error, cleaned } = tool.validate(args);
  if (!valid) {
    return { type: 'error', content: error };
    // LLM sees specific error → can self-correct
  }
  args = cleaned ?? args;
}
7. PER-TOOL TUI RENDERING
Both show tool use/results in TUI. CC renders each tool differently; HLVM uses one generic component.
┌─────────────────────────────────────────────────────────────────────────┐
│                    TOOL TUI RENDERING                                    │
├───────────────────────────────────┬─────────────────────────────────────┤
│           CLAUDE CODE             │              HLVM                    │
├───────────────────────────────────┼─────────────────────────────────────┤
│                                   │                                     │
│  Each tool defines:               │  All tools rendered identically:    │
│  renderToolUseMessage(input)      │                                     │
│  renderToolResultMessage(result)  │  ┌───────────────────────────────┐  │
│                                   │  │ ToolGroup component           │  │
│  BashTool:                        │  │                               │  │
│  ┌─────────────────────────────┐  │  │  ▸ shell_exec                 │  │
│  │ $ npm test                  │  │  │    args: { command: "npm      │  │
│  │ ┌─────────────────────────┐ │  │  │    test" }                    │  │
│  │ │ PASS src/utils.test.ts  │ │  │  │    result: "PASS src/..."    │  │
│  │ │ ✓ should parse (3ms)    │ │  │  │                               │  │
│  │ │ Tests: 5 passed         │ │  │  │  ▸ edit_file                  │  │
│  │ └─────────────────────────┘ │  │  │    args: { path: "foo.ts",   │  │
│  └─────────────────────────────┘  │  │    old_string: "...",         │  │
│                                   │  │    new_string: "..." }        │  │
│  EditFileTool:                    │  │    result: "OK"               │  │
│  ┌─────────────────────────────┐  │  │                               │  │
│  │ foo.ts                      │  │  │  (All tools look the same:   │  │
│  │ ┌──────┬───────────────┐   │  │  │   name, raw args, raw result) │  │
│  │ │ - 12 │ old code      │   │  │  └───────────────────────────────┘  │
│  │ │ + 12 │ new code      │   │  │                                     │
│  │ │   13 │ unchanged     │   │  │  No visual diff for edits.          │
│  │ └──────┴───────────────┘   │  │  No syntax highlighting.            │
│  │  ↑ syntax-highlighted diff │  │  No output formatting.              │
│  │  ↑ word-level changes      │  │                                     │
│  │  ↑ copy-safe line numbers  │  │                                     │
│  └─────────────────────────────┘  │                                     │
│                                   │                                     │
│  ReadFileTool:                    │                                     │
│  ┌─────────────────────────────┐  │                                     │
│  │ src/index.ts (lines 1-50)   │  │                                     │
│  │ ┌──────┬──────────────────┐ │  │                                     │
│  │ │    1 │ import { App }   │ │  │                                     │
│  │ │    2 │ from './app';    │ │  │                                     │
│  │ │  ... │                  │ │  │                                     │
│  │ │   50 │ export default;  │ │  │                                     │
│  │ └──────┴──────────────────┘ │  │                                     │
│  └─────────────────────────────┘  │                                     │
│                                   │                                     │
│  GrepTool:                        │                                     │
│  ┌─────────────────────────────┐  │                                     │
│  │ 5 matches for "useState"    │  │                                     │
│  │ src/App.tsx:12:  [useState] │  │                                     │
│  │ src/App.tsx:45:  [useState] │  │                                     │
│  │ ↑ matched text highlighted  │  │                                     │
│  └─────────────────────────────┘  │                                     │
└───────────────────────────────────┴─────────────────────────────────────┘
What HLVM should adopt:
// Add optional render methods to ToolMetadata:
interface ToolMetadata {
  // ... existing fields
  renderUse?: (args: Record<string, unknown>) => ReactElement;
  renderResult?: (result: unknown) => ReactElement;
}

// High-value tools to customize first:
// 1. edit_file → show diff (even basic unified diff is huge improvement)
// 2. shell_exec → show command prominently, output in scrollable box
// 3. read_file → show filename + line numbers
// 4. search_code → highlight matched text in results

// Minimal diff rendering (no Rust NAPI needed):
import { diffLines } from 'diff';  // npm package

function EditDiff({ oldText, newText, path }) {
  const changes = diffLines(oldText, newText);
  return (
    <Box flexDirection="column">
      <Text bold>{path}</Text>
      {changes.map((change, i) => (
        <Text key={i}
          color={change.added ? 'green' : change.removed ? 'red' : undefined}>
          {change.added ? '+ ' : change.removed ? '- ' : '  '}
          {change.value}
        </Text>
      ))}
    </Box>
  );
}
8. PERMISSION SYSTEM
Both gate dangerous tools. CC has layered rules + AI classifier; HLVM has static policy.
┌─────────────────────────────────────────────────────────────────────────┐
│                    PERMISSION EVALUATION                                │
├───────────────────────────────────┬─────────────────────────────────────┤
│           CLAUDE CODE             │              HLVM                    │
├───────────────────────────────────┼─────────────────────────────────────┤
│                                   │                                     │
│  Evaluation order (first match    │  Evaluation order:                  │
│  wins):                           │                                     │
│                                   │  1. toolRules (per-tool overrides)  │
│  1. denyRules                     │  2. levelRules (per-safety-level)   │
│     Pattern: Bash(rm -rf *)       │  3. default policy                  │
│     → DENY (no override)          │                                     │
│                                   │  Example:                           │
│  2. allowRules                    │  ┌───────────────────────────────┐  │
│     Pattern: Bash(git *)          │  │ L0: allow                     │  │
│     → ALLOW (skip remaining)      │  │ L1: ask user for confirmation │  │
│                                   │  │ L2: deny                      │  │
│  3. askRules                      │  │                               │  │
│     Pattern: Bash(npm install *)  │  │ toolRules:                    │  │
│     → ASK USER                    │  │   shell_exec: allow           │  │
│                                   │  │   (overrides L1 for shell)    │  │
│  4. tool.checkPermissions()       │  └───────────────────────────────┘  │
│     Per-tool custom logic:        │                                     │
│     EditFile checks file in       │  Path/network deny rules:           │
│       allowed dirs                │  ┌───────────────────────────────┐  │
│     Bash checks command against   │  │ deny paths: ["/etc/*",       │  │
│       known-dangerous patterns    │  │   "/usr/*", "~/.ssh/*"]      │  │
│                                   │  │ deny network: ["*.internal"] │  │
│  5. Mode transform:               │  │ (compiled to glob matchers)   │  │
│     ┌─────────────────────────┐   │  └───────────────────────────────┘  │
│     │ dontAsk mode:           │   │                                     │
│     │  "ask" → "deny"        │   │  Plan mode:                         │
│     │  (headless safety —     │   │  ┌───────────────────────────────┐  │
│     │   never prompt in CI)   │   │  │ Blocks all L1+ tools          │  │
│     │                         │   │  │ (read-only during planning)   │  │
│     │ auto mode:              │   │  └───────────────────────────────┘  │
│     │  "ask" → AI classifier  │   │                                     │
│     │  ┌───────────────────┐  │   │  (no auto-mode AI classifier)      │
│     │  │ classifyYoloAction│  │   │                                     │
│     │  │ sends tool call + │  │   │  (no headless/dontAsk mode)        │
│     │  │ conversation to   │  │   │                                     │
│     │  │ Sonnet → decides  │  │   │                                     │
│     │  │ approve/deny/ask  │  │   │                                     │
│     │  └───────────────────┘  │   │                                     │
│     └─────────────────────────┘   │                                     │
│                                   │                                     │
│  CC also has content-aware rules: │  HLVM rules are name-only:          │
│  Bash(git *) matches the actual   │  "shell_exec": allow                │
│  command content, not just tool   │  (no inspection of what command     │
│  name.                            │   is being run)                     │
└───────────────────────────────────┴─────────────────────────────────────┘
What HLVM should adopt:
// Priority 1: Content-aware permission rules
// Currently: toolRules: { shell_exec: "allow" }
// Should be: toolRules: { "shell_exec(git *)": "allow",
//                         "shell_exec(rm *)":  "deny" }

// Priority 2: dontAsk mode for headless/CI
// When running non-interactively (no TTY, HTTP mode):
// "ask" → "deny" automatically (can't prompt user)

// Priority 3: Auto-mode AI classifier (lower priority)
// Requires extra API call per tool use
// Only worth it for fully autonomous agent runs
9. MESSAGE NORMALIZATION
Both prepare messages before sending to API. CC normalizes more aggressively.
┌─────────────────────────────────────────────────────────────────────────┐
│                    MESSAGE NORMALIZATION FOR API                         │
├───────────────────────────────────┬─────────────────────────────────────┤
│           CLAUDE CODE             │              HLVM                    │
├───────────────────────────────────┼─────────────────────────────────────┤
│                                   │                                     │
│  normalizeMessagesForAPI():       │  Basic normalization:               │
│                                   │                                     │
│  1. Strip virtual/display-only    │  1. Format messages per provider    │
│     messages (UI metadata that    │     (Anthropic vs OpenAI vs Google  │
│     API doesn't need)             │     message format differences)     │
│                                   │                                     │
│  2. Merge consecutive same-role   │  2. (no merging)                    │
│     messages                      │     → Can produce invalid API       │
│     user, user → single user      │       requests with consecutive     │
│     (API requires alternating)    │       same-role messages            │
│                                   │                                     │
│  3. Strip thinking blocks from    │  3. (no stripping)                  │
│     non-final assistant turns     │     → Old thinking blocks waste     │
│     ┌─────────────────────────┐   │       tokens. In a 20-turn convo,  │
│     │ Turn 1: [think] + text  │   │       18 turns of thinking blocks  │
│     │         → text only     │   │       are pure waste.              │
│     │ Turn 2: [think] + text  │   │                                     │
│     │         → text only     │   │                                     │
│     │ Turn 3: [think] + text  │   │                                     │
│     │         → KEEP thinking │   │                                     │
│     │         (most recent)   │   │                                     │
│     └─────────────────────────┘   │                                     │
│                                   │                                     │
│  4. Strip images that caused      │  4. (no image error tracking)       │
│     errors in previous turns      │     → Broken image gets re-sent    │
│     (don't retry broken images)   │       every turn, wasting tokens   │
│                                   │                                     │
│  5. Convert attachment objects    │  5. (no attachment abstraction)     │
│     → tool_result blocks          │     → Messages are already in      │
│     (normalize internal format    │       provider format              │
│      to API format)               │                                     │
│                                   │                                     │
│  6. User input truncation:        │  6. (no input truncation)           │
│     ┌─────────────────────────┐   │     → Piped input of 1MB goes      │
│     │ if (input > 10K chars)  │   │       straight into context        │
│     │   head = input[0..5K]   │   │                                     │
│     │   tail = input[-5K..]   │   │                                     │
│     │   show head+tail        │   │                                     │
│     └─────────────────────────┘   │                                     │
│     For piped/large inputs        │                                     │
└───────────────────────────────────┴─────────────────────────────────────┘
What HLVM should adopt:
// Priority 1: Strip old thinking blocks (FREE token savings)
function stripOldThinking(messages: Message[]): Message[] {
  // Find last assistant message index
  const lastAssistantIdx = messages.findLastIndex(
    m => m.role === 'assistant'
  );
  return messages.map((msg, i) => {
    if (msg.role === 'assistant' && i < lastAssistantIdx) {
      // Remove thinking blocks from non-final turns
      return {
        ...msg,
        content: msg.content.filter(b => b.type !== 'thinking')
      };
    }
    return msg;
  });
}

// Priority 2: Merge consecutive same-role messages
// (prevents API validation errors)

// Priority 3: Input truncation for piped/large user input
function truncateUserInput(input: string, limit = 10_000): string {
  if (input.length <= limit) return input;
  const half = limit / 2;
  return input.slice(0, half) +
    `\n\n[... ${input.length - limit} chars truncated ...]\n\n` +
    input.slice(-half);
}
10. MULTI-AGENT COMMUNICATION
Both coordinate multiple agents via file-backed tasks. CC uses file-backed mailboxes; HLVM uses in-memory.
┌─────────────────────────────────────────────────────────────────────────┐
│                    MULTI-AGENT COORDINATION                             │
├───────────────────────────────────┬─────────────────────────────────────┤
│           CLAUDE CODE             │              HLVM                    │
├───────────────────────────────────┼─────────────────────────────────────┤
│                                   │                                     │
│  Communication: FILE-BACKED       │  Communication: IN-MEMORY           │
│                                   │                                     │
│  writeToMailbox(agentId, msg)     │  inbox.push(message)                │
│  → ~/.claude/teams/<name>/       │  → Array in memory                  │
│    mailbox/<agentId>/             │                                     │
│    msg-<timestamp>.json           │  On crash: ALL messages LOST.       │
│                                   │  On process exit: gone.             │
│  On crash: messages PERSIST.      │                                     │
│  Agent restarts, reads mailbox.   │  Cannot span multiple processes.    │
│                                   │  All agents share one Node.js       │
│  Can span separate processes:     │  event loop (no true parallelism).  │
│  ┌─────────────────────────────┐  │                                     │
│  │ Lead (process A)            │  │  ┌───────────────────────────────┐  │
│  │  ↕ file I/O                 │  │  │ Lead (main async loop)        │  │
│  │ Mate 1 (tmux pane, proc B)  │  │  │  ↕ function call              │  │
│  │  ↕ file I/O                 │  │  │ Mate 1 (async function)       │  │
│  │ Mate 2 (subprocess, proc C) │  │  │  ↕ function call              │  │
│  │                             │  │  │ Mate 2 (async function)       │  │
│  │ TRUE parallelism:           │  │  │                               │  │
│  │ Each process has own CPU    │  │  │ COOPERATIVE multitasking:     │  │
│  │ core, own event loop.       │  │  │ All share one CPU core.       │  │
│  │ Tool I/O is truly parallel. │  │  │ One agent blocks = all block. │  │
│  └─────────────────────────────┘  │  └───────────────────────────────┘  │
│                                   │                                     │
│  Task storage: SAME (both file-   │  Task storage: SAME (both file-     │
│  backed with JSON per task)       │  backed). HLVM adds .highwatermark  │
│                                   │  for ID uniqueness.                 │
│                                   │                                     │
│  Shutdown protocol: SAME          │  Shutdown protocol: SAME            │
│  { type: "shutdown_request" }     │  { type: "shutdown_request" }       │
│  → teammate responds              │  → teammate responds                │
│  → lead confirms                  │  → lead confirms                    │
└───────────────────────────────────┴─────────────────────────────────────┘
What HLVM should adopt:
// Option A: File-backed mailbox (match CC)
// Pros: crash-safe, can spawn separate processes later
// Cons: filesystem I/O overhead for in-process communication

// Option B: Hybrid (pragmatic)
// Keep in-memory for in-process agents (fast)
// Add optional file persistence for crash recovery:

class AgentInbox {
  private messages: TeamMessage[] = [];
  private persistDir?: string;

  async send(msg: TeamMessage) {
    this.messages.push(msg);
    if (this.persistDir) {
      // Write-behind: persist async, don't block
      fs.writeFile(
        `${this.persistDir}/msg-${Date.now()}.json`,
        JSON.stringify(msg)
      ).catch(() => {}); // best-effort
    }
  }

  async recover() {
    if (!this.persistDir) return;
    const files = await fs.readdir(this.persistDir);
    for (const f of files) {
      const msg = JSON.parse(await fs.readFile(`${this.persistDir}/${f}`));
      this.messages.push(msg);
    }
  }
}
11. APP SHELL / PROVIDER SPLIT
Both use React/Ink with provider wrappers. CC separates providers from layout; HLVM combines them.
┌─────────────────────────────────────────────────────────────────────────┐
│                    APP SHELL ARCHITECTURE                                │
├───────────────────────────────────┬─────────────────────────────────────┤
│           CLAUDE CODE             │              HLVM                    │
├───────────────────────────────────┼─────────────────────────────────────┤
│                                   │                                     │
│  App.tsx (~50 lines):             │  App.tsx (~1983 lines):             │
│  ┌─────────────────────────────┐  │  ┌───────────────────────────────┐  │
│  │ FpsMetricsProvider          │  │  │ ReplProvider                   │  │
│  │  └─ StatsProvider           │  │  │  └─ EVERYTHING:               │  │
│  │     └─ AppStateProvider     │  │  │     ├─ all hooks              │  │
│  │        └─ <REPL />          │  │  │     ├─ all state              │  │
│  └─────────────────────────────┘  │  │     ├─ keyboard routing       │  │
│                                   │  │     ├─ overlay management     │  │
│  REPL.tsx (~2500 lines):          │  │     ├─ layout                 │  │
│  ┌─────────────────────────────┐  │  │     ├─ conversation panel     │  │
│  │ Layout, overlays, keyboard, │  │  │     ├─ input component        │  │
│  │ message list, input,        │  │  │     ├─ agent runner           │  │
│  │ status line, all rendering  │  │  │     └─ 10+ hooks              │  │
│  └─────────────────────────────┘  │  └───────────────────────────────┘  │
│                                   │                                     │
│  BENEFIT: App.tsx never changes.  │  PROBLEM: Any change to any part   │
│  Provider shape is stable.        │  of the TUI means editing a 2K-    │
│  Layout changes only touch REPL.  │  line file. Hard to maintain.      │
└───────────────────────────────────┴─────────────────────────────────────┘
What HLVM should adopt:
// Split App.tsx into:
// app-providers.tsx (~50 lines) — just context wrappers
// app-layout.tsx (~1800 lines) — the actual REPL screen

// app-providers.tsx:
export function App() {
  return (
    <ReplProvider>
      <ModelConfigProvider>
        <AgentProvider>
          <ReplScreen />   // ← all layout lives here
        </AgentProvider>
      </ModelConfigProvider>
    </ReplProvider>
  );
}
12. STATE MANAGEMENT
Both manage complex TUI state. CC uses external store with selective re-render; HLVM uses useReducer.
┌─────────────────────────────────────────────────────────────────────────┐
│                    STATE MANAGEMENT                                      │
├───────────────────────────────────┬─────────────────────────────────────┤
│           CLAUDE CODE             │              HLVM                    │
├───────────────────────────────────┼─────────────────────────────────────┤
│                                   │                                     │
│  Custom external store:           │  useReducer + per-domain hooks:     │
│                                   │                                     │
│  const store = createStore({      │  const [state, dispatch] =          │
│    messages: [],                  │    useReducer(reducer, initial);    │
│    model: 'opus',                 │                                     │
│    overlays: new Set(),           │  // Plus per-domain hooks:          │
│    ...450 lines of state          │  const conv = useConversation();    │
│  });                              │  const team = useTeamState();       │
│                                   │  const model = useModelConfig();    │
│  // Component reads ONE slice:    │  const overlay = useOverlayPanel(); │
│  function MessageList() {         │  const runner = useAgentRunner();   │
│    const messages = useStore(     │  const tasks = useTaskManager();    │
│      s => s.messages              │                                     │
│    );                             │  // Problem:                        │
│    // ONLY re-renders when        │  // useReducer re-renders the       │
│    // messages change. Model      │  // entire component tree on ANY    │
│    // change? No re-render.       │  // state change, even if only     │
│  }                                │  // one field changed.             │
│                                   │                                     │
│  // React 18 concurrent-safe:     │  // HLVM's approach IS cleaner     │
│  useSyncExternalStore(            │  // architecturally (domain split   │
│    store.subscribe,               │  // vs monolith), but performance  │
│    () => selector(store.getState())│ // is worse for frequent updates  │
│  );                               │  // like streaming tokens.          │
│                                   │                                     │
│  // Object.is equality skip:      │                                     │
│  setState(prev => {               │                                     │
│    const next = updater(prev);    │                                     │
│    if (Object.is(prev, next))     │                                     │
│      return; // skip notification │                                     │
│    notify(next);                  │                                     │
│  });                              │                                     │
└───────────────────────────────────┴─────────────────────────────────────┘
What HLVM should consider:
// Not urgent — HLVM's hook-per-domain pattern is clean.
// But for streaming performance, consider:

// Option: useSyncExternalStore for hot-path state
// Keep useReducer for cold state (overlays, config)
// Use external store for conversation items (updated every frame)

import { useSyncExternalStore } from 'react';

const conversationStore = createStore<ConversationItem[]>([]);

function ConversationPanel() {
  const items = useSyncExternalStore(
    conversationStore.subscribe,
    conversationStore.getSnapshot
  );
  // Only re-renders when items actually change
}
13. COST / USAGE TRACKING
Both track token usage. CC accumulates per-model with pricing; HLVM shows per-turn only.
┌─────────────────────────────────────────────────────────────────────────┐
│                    COST TRACKING                                        │
├───────────────────────────────────┬─────────────────────────────────────┤
│           CLAUDE CODE             │              HLVM                    │
├───────────────────────────────────┼─────────────────────────────────────┤
│                                   │                                     │
│  Session-level accumulation:      │  Per-turn only:                     │
│                                   │                                     │
│  addToTotalSessionCost(           │  TurnStats component:               │
│    cost, usage, model             │  ┌───────────────────────────────┐  │
│  )                                │  │ tokens: 1,234 in / 567 out   │  │
│  ├─ input_tokens                  │  │ time: 3.2s                    │  │
│  ├─ output_tokens                 │  │ cost: $0.02                   │  │
│  ├─ cache_read_input_tokens       │  └───────────────────────────────┘  │
│  ├─ cache_creation_input_tokens   │                                     │
│  ├─ web requests                  │  No session accumulation.           │
│  └─ advisor (sub-model) usage     │  No cache hit tracking.             │
│     (recursive for side-queries)  │  No per-model breakdown.            │
│                                   │  No rate limit % display.           │
│  Hardcoded pricing:               │                                     │
│  ├─ Sonnet:     $3/$15 per M tok │                                     │
│  ├─ Opus 4:     $15/$75           │                                     │
│  └─ Opus 4.6:   $30/$150          │                                     │
│                                   │                                     │
│  StatusLine display:              │                                     │
│  ┌─────────────────────────────┐  │                                     │
│  │ opus-4.6 │ $2.34 │ ctx:67% │  │                                     │
│  │ rate: 23% of 5h window     │  │                                     │
│  └─────────────────────────────┘  │                                     │
│                                   │                                     │
│  Persisted to project config      │  Not persisted.                     │
│  (survives session resume)        │                                     │
└───────────────────────────────────┴─────────────────────────────────────┘
What HLVM should adopt:
// Add session-level cost accumulator:
interface SessionCost {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReads: number;
  totalCacheCreations: number;
  totalCostUsd: number;
  perModel: Map<string, { input: number; output: number; cost: number }>;
}

// Display in status bar:
// model | $total | ctx:N% | session: Xmin
14. INPUT COMPONENT
Both have rich input editing. CC has vim mode + voice + image paste; HLVM has Paredit (which CC lacks). CC leads on breadth.
┌─────────────────────────────────────────────────────────────────────────┐
│                    INPUT COMPONENT                                       │
├───────────────────────────────────┬─────────────────────────────────────┤
│           CLAUDE CODE             │              HLVM                    │
├───────────────────────────────────┼─────────────────────────────────────┤
│                                   │                                     │
│  UNIQUE TO CC:                    │  UNIQUE TO HLVM:                    │
│  ├─ VimTextInput                  │  ├─ Full Paredit (slurp, barf,      │
│  │  (full vim keybindings)        │  │  raise, splice, transpose,       │
│  ├─ Voice recording               │  │  kill-sexp, wrap-sexp)           │
│  │  (waveform cursor animation)   │  ├─ S-expression navigation         │
│  ├─ Image paste                   │  ├─ Auto-multiline on unbalanced    │
│  │  (clipboard → base64 → API)   │  │  parens (HQL-aware)              │
│  ├─ Stashed prompts               │  ├─ Language-aware syntax            │
│  │  (save incomplete for later)   │  │  highlighting in input           │
│  └─ Slash command typeahead       │  └─ Ctrl+R reverse history search   │
│     (fuzzy match suggestions)     │                                     │
│                                   │                                     │
│  SHARED (CC does better):         │  SHARED (HLVM does differently):    │
│  ├─ History: ↑/↓ cycle            │  ├─ History: ↑/↓ + Ctrl+R search   │
│  ├─ Multiline: Shift+Enter or    │  ├─ Multiline: auto when parens     │
│  │  Ctrl+E (launch editor)        │  │  unbalanced                      │
│  └─ Submit: Enter                 │  └─ Submit: Enter when balanced     │
│                                   │                                     │
│  CC gap to close: Vim mode        │                                     │
│  Many developers expect vim       │                                     │
│  keybindings. CC built a full     │                                     │
│  VimTextInput component.          │                                     │
└───────────────────────────────────┴─────────────────────────────────────┘
What HLVM should consider:
// Vim mode is high-demand among developers.
// Slash command typeahead is useful for discoverability.
// Image paste requires multi-modal API support (provider-dependent).

// Priority: Vim mode > Slash typeahead > Image paste > Voice
// Vim mode can be a separate VimInput wrapper around existing Input.
MASTER PRIORITY TABLE
╔════╦══════════════════════════════════╦════════╦═══════════════════════╗
║ #  ║  FEATURE GAP                     ║ EFFORT ║ IMPACT                ║
╠════╬══════════════════════════════════╬════════╬═══════════════════════╣
║    ║  BIG GAPS (must fix)             ║        ║                       ║
║  1 ║  Reactive compaction (413→retry) ║  MED   ║ Prevents lost requests║
║  2 ║  Tool concurrency partitioning   ║  LOW   ║ Prevents data races   ║
║  3 ║  Streaming markdown O(tail)      ║  MED   ║ 50x render perf gain  ║
║  4 ║  Tool result size caps           ║  LOW   ║ Prevents context bloat║
║  5 ║  Output continuation (resume)    ║  LOW   ║ No more truncated resp║
╠════╬══════════════════════════════════╬════════╬═══════════════════════╣
║    ║  MEDIUM GAPS (should fix)        ║        ║                       ║
║  6 ║  Per-tool TUI rendering          ║  MED   ║ Much better UX        ║
║  7 ║  Tool input validation (Zod)     ║  HIGH  ║ Self-correcting LLM   ║
║  8 ║  Content-aware permissions       ║  MED   ║ Safer auto-mode       ║
║  9 ║  Strip old thinking blocks       ║  LOW   ║ Free token savings    ║
║ 10 ║  File-backed agent mailbox       ║  MED   ║ Crash recovery        ║
╠════╬══════════════════════════════════╬════════╬═══════════════════════╣
║    ║  SMALL GAPS (nice to have)       ║        ║                       ║
║ 11 ║  App shell / provider split      ║  MED   ║ Maintainability       ║
║ 12 ║  External store for hot state    ║  MED   ║ Render performance    ║
║ 13 ║  Session cost accumulation       ║  LOW   ║ Cost visibility       ║
║ 14 ║  Vim mode for input              ║  MED   ║ Developer preference  ║
╚════╩══════════════════════════════════╩════════╩═══════════════════════╝

QUICK WINS (low effort, high impact):
  #2  Tool concurrency        → ~50 lines of partitioning logic
  #4  Tool result size caps   → ~20 lines per tool
  #5  Output continuation     → ~30 lines of retry logic
  #9  Strip old thinking      → ~15 lines in message normalization



---

## 22. SDK & Library Usage Comparison

> **Context**: CC is **proprietary** — backed by Anthropic's servers, centralized telemetry, internal packages, dedicated build infra. HLVM is **MIT OSS** — fully self-contained, no server dependency, distributed globally, must work offline, on any platform, for any user.
>
> This difference fundamentally changes which of CC's library choices make sense to adopt.

### 22.1 Full Dependency Inventory

#### Claude Code (~65+ packages)

| Category | Packages | Purpose |
|----------|----------|---------|
| **Anthropic internal** | `@anthropic-ai/sdk`, `@anthropic-ai/claude-agent-sdk`, `@anthropic-ai/mcpb`, `@anthropic-ai/sandbox-runtime` | Proprietary AI/sandbox/protocol |
| **Anthropic extensions** | `@ant/claude-for-chrome-mcp`, `@ant/computer-use-mcp`, `@ant/computer-use-input`, `@ant/computer-use-swift` | Computer use, Chrome MCP |
| **Cloud providers** | `@aws-sdk/client-bedrock-runtime`, `google-auth-library` | AWS Bedrock, Google auth |
| **MCP** | `@modelcontextprotocol/sdk` | MCP client/server |
| **Observability** | `@opentelemetry/api`, `core`, `resources`, `sdk-logs`, `sdk-metrics`, `sdk-trace-base`, `semantic-conventions` | Full OTel stack (7 packages) |
| **Feature flags** | `@growthbook/growthbook` | A/B testing, gradual rollout |
| **TUI framework** | `react`, `react-reconciler`, `react/compiler-runtime`, `ink` | Terminal rendering |
| **CLI** | `@commander-js/extra-typings`, `chalk`, `cli-boxes`, `figures`, `strip-ansi`, `wrap-ansi` | Argument parsing, styling |
| **Utilities** | `lodash-es` (14+ functions), `lru-cache`, `type-fest`, `auto-bind`, `env-paths`, `p-map` | General-purpose |
| **Schema/validation** | `zod`, `ajv` | Input validation |
| **Text processing** | `marked`, `highlight.js`, `code-excerpt`, `indent-string`, `jsonc-parser`, `@alcalzone/ansi-tokenize`, `xss` | Markdown, syntax, ANSI |
| **Diffing** | `diff`, `color-diff-napi` (Rust NAPI) | Text diff, word-level colored diff |
| **i18n/text** | `bidi-js`, `get-east-asian-width`, `emoji-regex` | RTL, CJK width, emoji |
| **HTTP** | `axios`, `undici`, `https-proxy-agent` | HTTP client, proxy |
| **Networking** | `ws`, `vscode-jsonrpc/node.js` | WebSocket, JSON-RPC |
| **LSP** | `vscode-languageserver-protocol`, `vscode-languageserver-types` | IDE integration |
| **File/process** | `chokidar`, `execa`, `tree-kill`, `signal-exit`, `proper-lockfile`, `ignore`, `picomatch`, `fuse.js` | File watching, process mgmt, glob, fuzzy |
| **Misc** | `semver`, `shell-quote`, `stack-utils`, `qrcode`, `asciichart`, `supports-hyperlinks` | Versioning, shell, QR |

#### HLVM (~22 packages)

| Category | Packages | Purpose |
|----------|----------|---------|
| **AI SDK** | `ai@^6.0.0`, `@ai-sdk/openai@^3`, `@ai-sdk/anthropic@^3`, `@ai-sdk/google@^3`, `ollama-ai-provider-v2@^3` | 5-provider engine |
| **MCP** | `@modelcontextprotocol/sdk@^1.12.0` | MCP client |
| **Database** | `@db/sqlite@0.12` | SQLite + FTS5 memory |
| **Deno stdlib** | `@std/async`, `@std/path`, `@std/semver`, `@std/cli`, `@std/media-types`, `@std/encoding` | Async, glob, semver, CLI, MIME, encoding |
| **TUI framework** | `react@18`, `ink@5` | Terminal rendering |
| **Text processing** | `marked@^17`, `lowlight@3` | Markdown, syntax highlighting |
| **Glob/gitignore** | `ignore@^6` | Gitignore patterns |
| **Source maps** | `source-map@0.6.1`, `vlq@2.0.4` | HQL transpiler source maps |
| **Transpiler** | `typescript@5.3.3`, `esbuild@^0.17`, `esbuild-wasm@^0.17` | HQL compilation |
| **Web scraping** | `jsdom@22.1.0`, `@mozilla/readability@0.5.0`, `tldts@7.0.23` | HTML parsing, domain extraction |
| **Documents** | `officeparser@6.0.4`, `mammoth@1.12.0`, `xlsx@0.18.5`, `jszip@3.10.1`, `libreoffice-convert@1.8.1` | Office/Excel/DOCX parsing |

### 22.2 Head-to-Head by Domain

| Domain | CC Choice | HLVM Choice | Winner | Why |
|--------|-----------|-------------|--------|-----|
| **AI provider** | `@anthropic-ai/sdk` (1 vendor) | Vercel AI SDK (5 providers) | **HLVM** | OSS must support all providers; CC locked to Anthropic |
| **MCP** | `@modelcontextprotocol/sdk` | `@modelcontextprotocol/sdk` | Tie | Same SDK |
| **TUI** | `react` + `ink` | `react` + `ink` | Tie | Same framework |
| **Markdown** | `marked` + `highlight.js` | `marked` + `lowlight` | Tie | lowlight is highlight.js-based; same capability |
| **Glob** | `picomatch` | `@std/path/glob-to-regexp` | **HLVM** | Zero extra dep (Deno stdlib) |
| **Gitignore** | `ignore` | `ignore@6` | Tie | Same library |
| **Semver** | `semver` (npm) | `@std/semver` (Deno std) | **HLVM** | Zero extra dep |
| **CLI parsing** | `commander.js` | `@std/cli/parse-args` | **HLVM** | Zero extra dep, HLVM's CLI is simpler |
| **Schema validation** | `zod` (explicit) | zod (transitive via AI SDK) | CC | CC uses Zod for tool input schemas; HLVM doesn't yet |
| **Fuzzy search** | `fuse.js` | Hand-rolled 4-stage | **HLVM** | Custom is tailored to tool name resolution |
| **HTTP** | `axios` + `undici` + proxy | SSOT `http.*` (native fetch) | **HLVM** | Fewer deps, SSOT pattern. Proxy gap exists |
| **File watching** | `chokidar` | `Deno.watchFs` | **HLVM** | Native, zero dep |
| **Process mgmt** | `execa` + `tree-kill` + `signal-exit` | `Deno.Command` | **HLVM** | Native, zero dep |
| **Database** | None (file-based) | `@db/sqlite` (FTS5) | **HLVM** | Structured memory, full-text search, no API call |
| **Document parsing** | None | officeparser, mammoth, xlsx | **HLVM** | CC has no document ingestion |
| **Diffing** | `diff` + Rust NAPI `color-diff-napi` | None | **CC** | HLVM lacks any diff capability |
| **i18n text** | `bidi-js` + `get-east-asian-width` + `emoji-regex` | None | **CC** | HLVM lacks CJK/RTL/emoji width handling |
| **Observability** | Full OpenTelemetry (7 packages) | None | **CC** | But requires a collector backend |
| **Feature flags** | `@growthbook/growthbook` | None | CC | But requires a server |
| **Sandboxing** | `@anthropic-ai/sandbox-runtime` | Deno permission model | **HLVM** | Deno's built-in permissions are excellent for OSS |
| **Styling** | `chalk` + `cli-boxes` + `figures` + `strip-ansi` + `wrap-ansi` | Ink's built-in `<Text>` | Tie | Ink handles TUI; CC needs chalk for non-Ink output |
| **Shell quoting** | `shell-quote` | None | CC | Security-relevant for shell_exec |

### 22.3 The OSS Distribution Filter

CC's library choices assume a proprietary context: dedicated servers, centralized telemetry, controlled distribution, single-platform builds. HLVM as MIT OSS has fundamentally different constraints. Here is every CC dependency evaluated through the OSS lens:

#### Does NOT make sense for HLVM OSS

| CC Dependency | Why it doesn't fit |
|---|---|
| `@anthropic-ai/*` (4 packages) | Proprietary. HLVM's Vercel AI SDK is strictly superior for OSS (5 providers vs 1) |
| `@ant/*` (4 packages) | Proprietary Anthropic internal extensions |
| `@aws-sdk/client-bedrock-runtime` | Same model family as Anthropic direct. HLVM already covers Anthropic via AI SDK |
| `@growthbook/growthbook` | Needs a server-side backend for feature flags. OSS has no central server. Compile-time env vars are sufficient |
| `@opentelemetry/*` (7 packages) | Full stack needs a collector/backend (Jaeger, Grafana, etc.). OSS users don't have this. Optional `--trace` writing to local JSON file is the right answer — zero deps needed |
| `color-diff-napi` (Rust NAPI) | Distribution nightmare for OSS: prebuilt binaries per arch×OS, or force users to have Rust toolchain. Pure JS `diff` library is the right choice |
| `google-auth-library` | CC-specific for Google Cloud. HLVM's AI SDK Google provider handles auth |
| `vscode-languageserver-protocol` | CC's IDE bridge is proprietary. If HLVM does LSP, it'd be a separate architecture decision |
| `axios` + `undici` + `https-proxy-agent` | HLVM's SSOT `http.*` over native `fetch` is cleaner. Proxy support can be added natively via `Deno.HttpClient` |
| `commander.js` | HLVM's `@std/cli/parse-args` is lighter and sufficient |
| `chokidar` | Deno's built-in `Deno.watchFs` is better (native, cross-platform, zero dep) |
| `execa` + `tree-kill` + `signal-exit` | Deno's `Deno.Command` + `Deno.Signal` covers this natively |
| `lodash-es` | Deno stdlib + modern JS (structuredClone, Object.groupBy, Array.prototype.toSorted) covers most of lodash. The 14 functions CC uses can be written in ~50 lines total |
| `lru-cache` | A 20-line Map-with-eviction is sufficient for HLVM's needs |
| `auto-bind`, `env-paths`, `p-map` | Trivial utilities that don't justify a dependency |

#### DOES make sense for HLVM OSS to adopt

| CC Dependency | Why it fits | Current HLVM gap | Priority |
|---|---|---|---|
| `diff` | MIT, tiny, zero-dep. `edit_file` results should show what changed. Pure JS = no distribution issue | No diff capability at all | **HIGH** — enables diff visualization in TUI |
| `bidi-js` + `get-east-asian-width` + `emoji-regex` | MIT OSS distributed globally means users in Japan, Korea, China, Middle East. Terminal column widths are WRONG without CJK/RTL/emoji width calculation. **More important for OSS than for proprietary** | No i18n text handling | **HIGH** — correctness for international users |
| `zod` (explicit tool schemas) | Already transitive via AI SDK. OSS with community tool contributions needs stronger input validation than `Record<string, string>` | Tool args unvalidated | **MEDIUM** — leverage existing transitive dep |
| `shell-quote` | Proper shell argument escaping for `shell_exec` tool. Security-relevant. MIT, tiny | No shell quoting | **MEDIUM** — security hardening |
| `jsonc-parser` | Config files with comments (`.hlvm/config.jsonc`). Small quality-of-life for users | JSON-only config | **LOW** — nice-to-have |
| `proper-lockfile` | File locking for concurrent agent teams writing to shared task store / `.highwatermark` | No file locking in team store | **LOW** — edge case for multi-agent |

#### Already aligned (same or equivalent choice)

| Domain | CC | HLVM | Notes |
|---|---|---|---|
| MCP SDK | `@modelcontextprotocol/sdk` | `@modelcontextprotocol/sdk` | Same |
| TUI | `react` + `ink` | `react@18` + `ink@5` | Same |
| Markdown | `marked` | `marked@^17` | Same |
| Syntax highlighting | `highlight.js` | `lowlight@3` (hljs-based) | Equivalent |
| Gitignore | `ignore` | `ignore@^6` | Same |
| Semver | `semver` | `@std/semver` | Equivalent (HLVM lighter) |
| Glob | `picomatch` | `@std/path/glob-to-regexp` | Equivalent (HLVM lighter) |

### 22.4 Philosophy Comparison

```
┌──────────────────────────────────────────────────────────────────────┐
│                    DEPENDENCY PHILOSOPHY                             │
├──────────────────────────┬───────────────────────────────────────────┤
│ CLAUDE CODE (Proprietary)│ HLVM (MIT OSS)                           │
├──────────────────────────┼───────────────────────────────────────────┤
│ "Best npm pkg for job"   │ "Runtime-native first, npm only when     │
│                          │  no alternative exists"                   │
│                          │                                           │
│ ~65+ deps                │ ~22 deps                                  │
│ 5 proprietary packages   │ 0 proprietary packages                   │
│ 7 OpenTelemetry packages │ 0 observability packages                  │
│ 6 CLI styling packages   │ 0 (Ink built-in)                         │
│ 3 HTTP packages          │ 0 (native fetch)                         │
│ 3 process packages       │ 0 (Deno.Command)                         │
│                          │                                           │
│ PROS:                    │ PROS:                                     │
│ · Production-hardened    │ · Tiny attack surface                     │
│ · Rich terminal UX       │ · Simple supply chain                     │
│ · Enterprise telemetry   │ · Works offline by default                │
│ · i18n support           │ · No license compatibility issues         │
│                          │ · Deno's security model = free sandboxing │
│                          │ · Multi-provider out of the box           │
│                          │                                           │
│ CONS:                    │ CONS:                                     │
│ · Single provider lock-in│ · No diff visualization                   │
│ · Needs Anthropic server │ · Wrong column widths for CJK/RTL        │
│ · Rust NAPI = build pain │ · No shell argument quoting               │
│ · Supply chain risk      │ · Tool inputs unvalidated                 │
│ · Can't run fully offline│ · No structured observability             │
└──────────────────────────┴───────────────────────────────────────────┘
```

### 22.5 Recommended Library Adoptions for HLVM

Based on the OSS distribution filter above, here are the concrete adoptions ranked by value:

#### Tier 1: Adopt Now (High value, low effort, OSS-friendly)

**1. `diff` (npm:diff) — Text diffing**
```
Effort: ~2 hours
Why: edit_file results currently show no visual diff. CC has both `diff` (pure JS)
     and Rust NAPI. For OSS, pure JS `diff` is the right choice.
Where: New `renderDiffResult()` in orchestrator-tool-formatting.ts
       Import in edit_file tool to generate word-level diff
```

**2. `get-east-asian-width` + `emoji-regex` — Terminal column width**
```
Effort: ~4 hours
Why: HLVM is MIT OSS targeting global users. Terminal column alignment is BROKEN
     for CJK (Chinese/Japanese/Korean) text and emoji without these.
     More important for OSS than for CC (which is US-focused proprietary).
Where: New common/text-width.ts utility, used by ConversationPanel.tsx and Input.tsx
Note: bidi-js (RTL) is lower priority — can defer to Tier 2
```

**3. `zod` for tool input schemas — Validation**
```
Effort: ~6 hours (already transitive dep via AI SDK, just start using it)
Why: OSS with community tool contributions NEEDS input validation.
     CC uses Zod for every tool schema. HLVM's Record<string, string> is fragile.
Where: Each tool in src/hlvm/agent/tools/*.ts gets a Zod inputSchema
       Registry validates args against schema before execution
```

#### Tier 2: Adopt Soon (Medium value, medium effort)

**4. `shell-quote` — Shell argument escaping**
```
Effort: ~1 hour
Why: Security hardening for shell_exec tool. Prevents injection.
Where: shell_exec tool in tools/compute-tools.ts
```

**5. `bidi-js` — Bidirectional text (RTL support)**
```
Effort: ~3 hours (builds on Tier 1 text-width work)
Why: Arabic, Hebrew, Farsi users. Lower priority than CJK width.
Where: common/text-width.ts + Input.tsx cursor positioning
```

#### Tier 3: Consider Later (Nice-to-have)

**6. `proper-lockfile` — File locking for team store**
```
Why: Multi-agent teams writing to shared files concurrently.
     Edge case — only matters when multiple teammates write simultaneously.
```

**7. `jsonc-parser` — Config files with comments**
```
Why: Quality-of-life. Users can comment their .hlvm/config.json.
```

#### Explicitly NOT adopting (and why)

| CC Package | Reason to skip |
|---|---|
| `lodash-es` | Modern JS + Deno stdlib covers all 14 functions CC uses |
| `axios`/`undici` | Native `fetch` + SSOT wrappers are cleaner |
| `commander.js` | `@std/cli/parse-args` is sufficient |
| `chalk`/`figures` | Ink's `<Text>` handles all TUI styling |
| `fuse.js` | HLVM's 4-stage fuzzy is tailored to tool names (better) |
| `lru-cache` | 20-line Map is sufficient |
| `@opentelemetry/*` | Needs a backend. Local `--trace` JSON file is sufficient for OSS |
| `@growthbook/*` | Needs a server. Compile-time env vars are sufficient |
| `color-diff-napi` | Rust NAPI = distribution pain. Pure JS `diff` is fine |
| `@anthropic-ai/*` | Proprietary. Vercel AI SDK is strictly superior for OSS |

### 22.6 Summary: The OSS Advantage

HLVM's lean dependency approach is not a weakness — it's a **strategic advantage** for OSS distribution:

```
CC's 65+ deps = optimized for a single company with servers and build infra
HLVM's 22 deps = optimized for anyone, anywhere, with zero infrastructure

The 5 libraries worth adopting (diff, east-asian-width, emoji-regex, zod, shell-quote)
fill real gaps without compromising the lean philosophy.

Everything else CC uses either:
  (a) has a Deno-native equivalent HLVM already uses (better)
  (b) requires proprietary infrastructure HLVM doesn't have (irrelevant)
  (c) solves a problem that doesn't exist in HLVM's architecture (unnecessary)
```

The biggest insight: **CC's library-heavy approach is a consequence of being proprietary, not a virtue.** Having servers, build infra, and a controlled distribution channel makes it easy to pile on dependencies. HLVM's constraint (MIT OSS, no server, runs everywhere) forces better choices: native APIs, smaller surface area, and true self-containment. The 5 recommended adoptions are the genuine gaps where a battle-tested library provides value that can't be replicated with a few lines of code.

---

Claude is AI and can make mistakes. Please double-check responses.
