# HLVM Agent System — Architecture & Reference

> Comprehensive documentation of the HLVM agent system, covering the full pipeline from CLI entry points through the ReAct orchestrator to team coordination and TUI presentation.

**→ New to HLVM teams?** Start with the **[Agent Teams Tutorial](./agent-teams-tutorial.md)** for a visual, beginner-friendly guide.

**→ This document** is the complete technical reference for developers and maintainers.

---

## Table of Contents

1. [Overview](#overview)
2. [Entry Points](#entry-points)
3. [Session Management](#session-management)
4. [ReAct Orchestrator Loop](#react-orchestrator-loop)
5. [Tool System](#tool-system)
6. [Agent Profiles](#agent-profiles)
7. [Delegation System](#delegation-system)
8. [Team Agent System](#team-agent-system)
9. [Engine Abstraction (AI SDK)](#engine-abstraction)
10. [Prompt System](#prompt-system)
11. [Memory System](#memory-system)
12. [MCP Integration](#mcp-integration)
13. [TUI Presentation](#tui-presentation)
14. [Event System](#event-system)
15. [Error Handling](#error-handling)
16. [Constants & Limits](#constants--limits)
17. [Testing](#testing)
18. [Comparison with Claude Code](#comparison-with-claude-code)

---

## Overview

HLVM's agent system implements an autonomous coding assistant with Claude Code-level capabilities:

- **ReAct loop** — iterative reason-then-act execution with parallel tool calling
- **Multi-provider** — Anthropic, OpenAI, Google, Ollama, Claude Code via Vercel AI SDK v6
- **Team coordination** — lead + worker agents with task boards, messaging, plan approval
- **Persistent memory** — SQLite/FTS5-backed fact database across sessions
- **MCP integration** — dynamic tool discovery via Model Context Protocol
- **Structured TUI** — Ink-based terminal UI with styled team events, dashboards, and footer status

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
         │   ┌───────────────┐ ┌───────────────┐               │
         │   │  Delegation   │ │  Team Coord   │               │
         │   │  delegation.ts│ │  team-*.ts     │               │
         │   └───────────────┘ └───────────────┘               │
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
├── delegation.ts                # Child agent delegation
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
├── team-executor.ts             # Teammate event loop
├── team-runtime.ts              # Team types + runtime logic
├── team-store.ts                # File-backed team persistence
├── tools/
│   └── agent-team-tools.ts      # Teammate/Task/SendMessage tools
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
- `--model <id>` — Override model (e.g., `anthropic/claude-sonnet-4-20250514`, `ollama/llama3.1:8b`)
- `--verbose` — Show agent header, tool labels, stats, trace events
- `--json` — NDJSON event stream output
- `--stateless` — No session persistence
- `--attach <path>` — Attach file context

Calls `runAgentQueryViaHost()` which invokes `runAgentQuery()` via the local host boundary.

### `POST /api/chat`

HTTP API endpoint. Entry: `src/hlvm/cli/repl/handlers/`.

Split into modules:
- `chat.ts` — Main request handler and routing
- `chat-agent-mode.ts` — Agent execution + Claude Code subprocess delegation
- `chat-direct.ts` — Direct chat streaming (non-agent mode)
- `chat-context.ts` — Context management for chat sessions
- `messages.ts` — Message formatting utilities

### `hlvm repl`

Interactive REPL. Same `runAgentQuery()` infrastructure, with Ink-based TUI rendering.

### Core Function

All paths converge on a single SSOT function:

```typescript
// src/hlvm/agent/agent-runner.ts
export async function runAgentQuery(options: AgentRunnerOptions): Promise<AgentRunnerResult>
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

| Field | Type | Purpose |
|-------|------|---------|
| `llm` | `LLMFunction` | The configured LLM callable |
| `engine` | `AgentEngine` | SDK or Legacy engine instance |
| `context` | `ContextManager` | Token budget + sliding window |
| `policy` | `AgentPolicy` | Safety + permission policy |
| `profile` | `ENGINE_PROFILES[key]` | Engine profile (normal/strict config) |
| `modelTier` | `ModelTier` | `"weak"` / `"mid"` / `"frontier"` |
| `isFrontierModel` | `boolean` | API-hosted or large context |
| `thinkingCapable` | `boolean` | Extended thinking support |
| `instructions` | `InstructionHierarchy` | Global + project instructions |
| `compiledPromptMeta` | `CompiledPromptMeta` | Compiled system prompt metadata |
| `todoState` | `TodoState` | Session-scoped task list |
| `l1Confirmations` | `L1ConfirmationState` | Remembered L1 tool approvals |
| `toolFilterState` | `ToolFilterState` | Dynamic tool filtering |
| `resolvedContextBudget` | `ResolvedBudget` | Token allocation |

### Context Budget Resolution

3-layer pipeline in `src/hlvm/agent/context-resolver.ts`:

1. **Base**: Default 32K tokens or model-specific limit
2. **Overflow retry**: Expand budget if context overflow detected
3. **Context manager**: Sliding window compaction when approaching limit

Memory is **always** a separate system message (marker: `# Your Memory`), never embedded in the main system prompt.

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

| Module | Responsibility |
|--------|---------------|
| `orchestrator.ts` | Main iteration loop, control flow, phase detection |
| `orchestrator-state.ts` | `LoopState`, `LoopConfig` types, state initialization |
| `orchestrator-tool-execution.ts` | Tool execution with timeout, verification, permission checks |
| `orchestrator-llm.ts` | LLM call wrapper with retry + timeout |
| `orchestrator-response.ts` | Response processing, final output extraction |
| `orchestrator-tool-formatting.ts` | Tool result formatting, dedup, display truncation |

### Iteration Flow

```
for iteration = 1 to MAX_ITERATIONS (20):
  1. maybeInjectMemoryRecall()     — retrieve relevant memory facts
  2. maybeInjectReminder()          — safety/routing reminders (tier-aware)
  3. maybeInjectDelegationHint()    — hint about delegation when appropriate
  4. LLM call with retry (max 3)
  5. Parse tool calls from response
  6. Execute tools (parallel by default)
  7. Format results, add to context
  8. Derive runtime phase: researching | editing | verifying | delegating | completing
  9. Apply adaptive tool phase filtering (narrow available tools based on phase)
  10. Check stopping: max tokens, max iterations, quality threshold
```

### Runtime Phases

The orchestrator detects the agent's current work phase and dynamically filters available tools:

| Phase | Tool Categories | Triggered When |
|-------|----------------|----------------|
| `researching` | all categories (unfiltered) | Default / reading/searching tools dominate |
| `editing` | `read`, `search`, `write`, `shell`, `git`, `meta`, `memory` | Write/edit tools in use |
| `verifying` | same as editing | Build/test/lint tools in use |
| `delegating` | `read`, `search`, `write`, `shell`, `git`, `meta`, `memory` + delegation | Delegation/team tools in use |
| `completing` | `read`, `shell`, `meta` | Agent signals completion |

### Team Integration in Orchestrator

When a team is active, the orchestrator:
- Formats team summary for context via `formatTeamSummaryForContext()`
- Formats team messages via `formatTeamMessageForContext()`
- Handles shutdown requests via `formatShutdownRequestForContext()`
- Emits `team_task_updated`, `team_message`, `team_plan_review_*`, `team_shutdown_*` events

---

## Tool System

### Registry

**SSOT**: `src/hlvm/agent/registry.ts`

All tools (native + MCP) are registered in a single central registry. Key operations:

```typescript
registerTool(name, metadata)    // Add a tool
registerTools(entries)           // Bulk add
unregisterTool(name)            // Remove (MCP cleanup)
getTool(name)                   // Lookup by name
getAllTools()                    // All registered tools
getToolsByCategory()            // Returns all tools grouped by category
searchTools(query, options)     // Fuzzy search for tool_search
resolveTools(allowlist, denylist, ownerId)  // Build filtered set
```

### Tool Metadata

```typescript
interface ToolMetadata {
  fn: ToolFunction;
  description: string;
  args: Record<string, string>;               // arg name → description
  argAliases?: Record<string, string>;
  returns?: Record<string, string>;            // return field → description
  safetyLevel?: "L0" | "L1" | "L2";
  safety?: string;                             // additional safety info text
  category?: "read" | "write" | "search" | "shell" | "git" | "web" | "data" | "meta" | "memory";
  replaces?: string;                           // shell command this tool replaces (e.g., "cat/head/tail")
  skipValidation?: boolean;                    // for dynamic tools with unknown schemas
  formatResult?: (result: unknown) => FormattedToolResult | null;
  terminalOnSuccess?: boolean;                 // standalone success = end turn
}
```

### Safety Levels

| Level | Meaning | Examples | Auto-approve |
|-------|---------|----------|-------------|
| **L0** | Read-only | `read_file`, `list_files`, `search_code`, `git_status` | All modes |
| **L1** | Low-risk execution | `write_file`, `edit_file`, `shell_exec` (safe commands) | `acceptEdits` and `bypassPermissions` |
| **L2** | High-risk mutation | `shell_exec` (dangerous), `delete` operations | `bypassPermissions` only |

### Permission Modes

HLVM provides five permission modes plus fine-grained tool control via `--permission-mode`:

#### Built-in Modes

| Mode | L0 | L1 | L2 | CLI Flag | Use Case |
|------|----|----|-----|----------|----------|
| `default` | Auto | Prompt | Prompt | (none) | Interactive development |
| `plan` | Auto | Prompt | Prompt | `--permission-mode plan` | Plan-first execution |
| `acceptEdits` | Auto | Auto | Prompt | `--permission-mode acceptEdits` | Trusted file operations |
| `bypassPermissions` | Auto | Auto | Auto | `--permission-mode bypassPermissions` | Full automation (unsafe) |
| `dontAsk` | Auto | Deny | Deny | `--permission-mode dontAsk` | Non-interactive/CI pipelines |

**Default mode** is fully interactive — safe tools (L0) auto-approve, mutations (L1/L2) prompt the user.

**dontAsk mode** is the non-interactive standard — execution where unsafe tools are automatically denied. This is the recommended mode for CI/CD pipelines, scripts, and automation. When `-p`/`--print` is used without an explicit `--permission-mode`, it defaults to `dontAsk`.

**Legacy aliases:** `--auto-edit` maps to `--permission-mode acceptEdits`. `--dangerously-skip-permissions` maps to `--permission-mode bypassPermissions`.

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

Permission mode propagates from the lead to spawned teammates via `ToolExecutionOptions.permissionMode`.

### Tool Categories

| Category | Tools |
|----------|-------|
| `read` | `read_file`, `list_files`, `file_stats` |
| `write` | `write_file`, `edit_file` |
| `search` | `search_code`, `find_symbol`, `get_structure`, `ast_query` |
| `shell` | `shell_exec`, `shell_script` |
| `web` | `search_web`, `fetch_url`, `web_fetch`, `render_url` |
| `memory` | `memory_write`, `memory_search`, `memory_edit` |
| `meta` | `tool_search`, `request_clarification` |
| `git` | `git_status`, `git_diff`, `git_log`, `git_commit` |
| `data` | Data processing tools |
| (dynamic) | `Teammate`, `TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`, `SendMessage` |

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

| Profile | Tools | Notes |
|---------|-------|-------|
| `general` | File + Code + Shell + Web + Memory + Team | Default profile |
| `code` | Code analysis (read, search, find_symbol) + Team | `temperature: 0.2` |
| `file` | File operations (read/write/edit/list) + Team | |
| `shell` | Shell execution (shell_exec, shell_script) + Team | |
| `web` | Web research (search, fetch, render) + Team | `maxTokens: 32000` |
| `memory` | Memory operations only | |

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

Fields: `name`, `description`, `tools` (required), plus optional `model`, `temperature`, `maxTokens`, `instructions`.

---

## Delegation System

**File**: `src/hlvm/agent/delegation.ts`

Single-session child agent execution (not team-based).

### Flow

```
Lead calls delegate tool
  → validateDelegateArgs()
  → snapshotWorkspaceFiles()
  → runDelegateChild() with child constraints:
      - Max 10 iterations (vs 20 parent)
      - 120s total timeout
      - CHILD_TOOL_DENYLIST (no recursion, no delegation, no plan review)
  → generateChildDiff()
  → applyChildChanges() to parent workspace
  → Return result + diff to lead
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `runDelegateChild()` | Execute task via delegated child session |
| `resumeDelegateChild()` | Resume paused child session |
| `snapshotWorkspaceFiles()` | Capture workspace state pre-delegation |
| `generateChildDiff()` | Compute file changes made by child |
| `applyChildChanges()` | Reconcile child changes back to parent |

### Delegate vs Team

| Feature | Delegation | Team |
|---------|-----------|------|
| Agents | 1 child | N workers |
| Lifecycle | Synchronous | Persistent event loop |
| Coordination | None (fire-and-forget) | Task board + messaging |
| Workspace | Snapshot + diff | Shared workspace |
| Use case | Single subtask | Complex multi-step projects |

---

## Team Agent System

The team system implements Claude Code-style multi-agent coordination with a lead/worker model.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Lead Agent (user-facing)                                │
│  - Creates team via Teammate(operation: "spawnTeam")     │
│  - Creates tasks via TaskCreate                          │
│  - Spawns workers via Teammate(operation: "spawnAgent")  │
│  - Monitors via TaskList                                 │
│  - Sends messages via SendMessage                        │
│  - Shuts down via SendMessage(type: "shutdown_request")  │
│  - Cleans up via Teammate(operation: "cleanup")          │
└────────────┬────────────────────────────────────────────┘
             │ spawns
    ┌────────▼────────┐    ┌──────────────────┐
    │  Worker Agent 1  │    │  Worker Agent 2   │
    │  runTeammateLoop │    │  runTeammateLoop  │
    │  - Idle poll     │    │  - Idle poll      │
    │  - Claim task    │    │  - Claim task     │
    │  - Execute       │    │  - Execute        │
    │  - Complete      │    │  - Complete       │
    └──────────────────┘    └──────────────────┘
             │                        │
    ┌────────▼────────────────────────▼──────┐
    │         Shared Task Board               │
    │  ~/.hlvm/tasks/{team-name}/             │
    │  - Task files (JSON)                    │
    │  - .highwatermark (ID counter)          │
    │                                         │
    │         Team Config                     │
    │  ~/.hlvm/teams/{team-name}/config.json  │
    │  - Members list                         │
    │  - Inbox messages                       │
    └─────────────────────────────────────────┘
```

### Team Lifecycle

```
1. CREATE TEAM
   Lead: Teammate(operation: "spawnTeam", team_name: "my-project")
   → Creates team config + task directory
   → Sets active team store

2. CREATE TASKS
   Lead: TaskCreate(subject: "Implement auth", description: "...")
   Lead: TaskCreate(subject: "Write tests", description: "...")
   → Persisted as JSON files in ~/.hlvm/tasks/{team-name}/

3. SPAWN WORKERS
   Lead: Teammate(operation: "spawnAgent", name: "auth-dev", agent_type: "general")
   Lead: Teammate(operation: "spawnAgent", name: "test-writer", agent_type: "code")
   → Each runs runTeammateLoop() as background task
   → Registered in team config with metadata

4. WORKERS EXECUTE
   Worker: polls TaskList → claims unclaimed task → runs ReAct loop → marks complete
   Worker: sends task_completed message to lead inbox
   Worker: polls again for next task or goes idle

5. LEAD MONITORS
   Lead: TaskList → sees status of all tasks
   Lead: receives completion messages automatically

6. SHUTDOWN
   Lead: SendMessage(type: "shutdown_request", recipient: "auth-dev")
   Worker: acknowledges → exits gracefully

7. CLEANUP
   Lead: Teammate(operation: "cleanup")
   → Removes team + task directories
```

### Team Runtime

**File**: `src/hlvm/agent/team-runtime.ts`

Core types:

```typescript
interface TeamRuntime {
  leadMemberId: string;
  teamId: string;

  // Member management
  registerMember(input: { id?, agent, role?, threadId?, childSessionId?, currentTaskId? }): TeamMember;
  unregisterMember(memberId): void;
  getMember(memberId): TeamMember;
  listMembers(): TeamMember[];

  // Task coordination
  claimTask(taskId, memberId): TeamTask | undefined;
  updateTask(taskId, updates): void;
  getTask(taskId): TeamTask;
  listTasks(): TeamTask[];
  getBlockingDependencies(task): TeamTaskBlocker[];

  // Messaging
  sendMessage(input: { fromMemberId, toMemberId?, kind?, content, relatedTaskId? }): TeamMessage[];
  readMessages(memberId, options?: { markRead?: boolean }): TeamMessage[];

  // Plan approval
  requestPlanApproval(submission): void;
  reviewPlan(input: { approvalId, reviewedByMemberId, approved, feedback? }): TeamPlanApproval | undefined;

  // Shutdown
  requestShutdown(input: { memberId, requestedByMemberId, reason? }): TeamShutdownRequest | undefined;
  acknowledgeShutdown(requestId, memberId): TeamShutdownRequest | undefined;
  forceShutdown(requestId, requestedByMemberId): TeamShutdownRequest | undefined;

  // Observability
  snapshot(): TeamRuntimeSnapshot;
  deriveSummary(): TeamSummary;
  deriveTodoState(): TodoState;
}
```

Status enums:

| Domain | Statuses |
|--------|---------|
| `TeamMemberStatus` | `active`, `shutdown_requested`, `shutting_down`, `terminated` |
| `TeamTaskStatus` | `pending`, `claimed`, `in_progress`, `blocked`, `completed`, `cancelled`, `errored` |
| `TeamMessageKind` | `direct`, `broadcast`, `task_update`, `approval_request`, `approval_response`, `shutdown_request`, `shutdown_ack`, `idle_notification`, `task_completed` |
| `TeamApprovalStatus` | `pending`, `approved`, `rejected` |
| `TeamShutdownStatus` | `requested`, `acknowledged`, `forced`, `terminated` |

### Team Store (Persistence)

**File**: `src/hlvm/agent/team-store.ts`

File-backed persistence:

```
~/.hlvm/teams/{team-name}/
  config.json          # Team config: members, lead, timestamps

~/.hlvm/tasks/{team-name}/
  1.json               # Task #1
  2.json               # Task #2
  .highwatermark        # Next task ID counter
```

```typescript
interface TeamStore {
  teamName: string;
  runtime: TeamRuntime;

  createTask(subject, description, opts?): TaskFile;
  updateTask(taskId, updates): TaskFile;
  getTask(taskId): TaskFile | null;
  listTasks(): TaskFile[];

  sendMessage(msg: InboxMessage): void;
  readInbox(memberId): InboxMessage[];

  getConfig(): TeamConfig;
  persistConfig(): void;
  cleanup(): Promise<void>;
}
```

`TaskIdCounter` — persistent counter using `.highwatermark` file. Survives store recreation.

### Teammate Executor

**File**: `src/hlvm/agent/team-executor.ts`

```typescript
export async function runTeammateLoop(options: TeammateLoopOptions): Promise<TeammateLoopResult>
```

Persistent event loop for each spawned worker:

```
1. Build teammate system note (role, team context, available tools)
2. Generate system prompt (child-specific, with team coordination section)
3. IDLE POLL LOOP:
   a. Check inbox for shutdown requests → exit if found
   b. Scan TaskList for unclaimed, unblocked tasks
   c. If found: claim task → break to WORK phase
   d. Sleep (default 3s, configurable for tests)
   e. Repeat up to maxIdlePolls (default 30 = 90s timeout)
4. WORK PHASE:
   a. Build task-specific user message
   b. runReActLoop() with child constraints
   c. Update task status (completed/errored)
   d. Send task_completed or task_error notification to lead
   e. Emit team_task_updated + team_message events
5. LOOP: Go back to step 3 for next task
6. EXIT: Return { exitReason, tasksCompleted }
```

Exit reasons: `"shutdown"`, `"signal"`, `"no_work"`, `"error"`

### Team Tools (Claude Code Parity API)

**File**: `src/hlvm/agent/tools/agent-team-tools.ts`

#### Teammate

```typescript
// Create team
Teammate({ operation: "spawnTeam", team_name: "project-x", description: "..." })

// Spawn worker
Teammate({ operation: "spawnAgent", name: "researcher", agent_type: "code", model?: "...", plan_mode_required?: true })

// Cleanup
Teammate({ operation: "cleanup" })
```

Agent types map to built-in profiles: `general`, `code`, `file`, `shell`, `web`, `memory`.

#### TaskCreate / TaskUpdate / TaskGet / TaskList

```typescript
TaskCreate({ subject: "Implement feature X", description: "...", activeForm?: "Implementing X" })
TaskUpdate({ taskId: "1", status: "completed", owner?: "researcher", addBlockedBy?: ["2"] })
TaskGet({ taskId: "1" })
TaskList()  // Returns all tasks with status, owner, blockers
```

#### SendMessage

```typescript
// Direct message
SendMessage({ type: "message", recipient: "researcher", content: "...", summary: "Status update" })

// Broadcast to all
SendMessage({ type: "broadcast", content: "...", summary: "Critical update" })

// Shutdown request
SendMessage({ type: "shutdown_request", recipient: "researcher", content: "Task complete" })

// Shutdown response (from worker)
SendMessage({ type: "shutdown_response", request_id: "abc", approve: true })

// Plan approval
SendMessage({ type: "plan_approval_response", request_id: "abc", recipient: "researcher", approve: true })
```

### Permission Inheritance

The lead's `permissionMode` propagates to all spawned teammates:

```
Lead (permissionMode: "acceptEdits")
  → Teammate(spawnAgent) passes permissionMode via ToolExecutionOptions
    → runTeammateLoop receives it
      → runReActLoop uses it for tool execution
        → L1 tools (write_file, edit_file) auto-approve
```

This ensures teammates can write files without user prompts when the lead has `acceptEdits` mode.

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

`getAgentEngine()` returns `_engine ?? new SdkAgentEngine()` — no env var switching.

### AI SDK v6 Integration

Provider support:

| Provider | Package | Model Examples |
|----------|---------|---------------|
| Anthropic | `@ai-sdk/anthropic` | `anthropic/claude-sonnet-4-20250514` |
| OpenAI | `@ai-sdk/openai` | `openai/gpt-4o` |
| Google | `@ai-sdk/google` | `google/gemini-2.0-flash` |
| Ollama | `ollama-ai-provider-v2` | `ollama/llama3.1:8b` |
| Claude Code | Custom adapter | `claude-code/claude-sonnet-4-20250514` |

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

The system prompt is assembled from 17 section renderers, each gated by `minTier`:

| Section | Min Tier | Content |
|---------|----------|---------|
| `renderRole()` | weak | Agent role + workspace description |
| `renderChatRole()` | weak | Chat mode role (chat-only) |
| `renderChatNoToolsRule()` | weak | No tools in chat mode (chat-only) |
| `renderCriticalRules()` | weak | Safety constraints + SSOT rules |
| `renderInstructions()` | weak | Instruction priority and references |
| `renderToolRouting()` | mid | Auto-generated tool routing table |
| `renderPermissionTiers()` | mid | Safety level explanations |
| `renderWebToolGuidance()` | mid | Web tool best practices |
| `renderRemoteExecutionGuidance()` | mid | Remote execution safety |
| `renderEnvironment()` | weak | Workspace info, git status |
| `renderCustomInstructions()` | weak | Project `.hlvm/HLVM.md` instructions |
| `renderDelegation()` | frontier | Delegation guidelines |
| `renderTeamCoordination()` | frontier | Team lifecycle + spawnAgent docs |
| `renderExamples()` | mid | Usage examples |
| `renderTips()` | weak | General tips |
| `renderFooter()` | weak | Closing notes |

### Instruction Hierarchy

```typescript
// src/hlvm/prompt/types.ts
interface InstructionHierarchy {
  global: string;          // Content from ~/.hlvm/HLVM.md (required)
  project: string;         // Content from <workspace>/.hlvm/HLVM.md (required, empty if untrusted)
  projectPath?: string;    // Workspace path if project instructions were attempted
  trusted: boolean;        // Whether the workspace is trusted
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

| Module | Purpose |
|--------|---------|
| `db.ts` | SQLite database, FTS5 indexing, schema migrations |
| `facts.ts` | Fact CRUD: `insertFact()`, `getValidFacts()`, `replaceInFacts()` |
| `entities.ts` | Entity relationship tracking (name/type graph) |
| `retrieve.ts` | Hybrid retrieval: FTS5 BM25 + entity graph traversal |
| `invalidate.ts` | Jaccard similarity auto-invalidation (>0.9 threshold) |
| `manager.ts` | `loadMemoryContext()` — session-level memory loading |
| `tools.ts` | Agent tools: `memory_write`, `memory_search`, `memory_edit` |
| `store.ts` | MEMORY.md file + journal I/O, sensitive content filtering |

### Session Integration

1. `loadMemoryContext()` called after context budget resolution
2. Memory injected as separate system message (marker: `# Your Memory`)
3. `maybeInjectMemoryRecall()` in orchestrator retrieves relevant facts per-iteration
4. Pinned facts limit (10) with availability hint when more exist in DB

### Memory Tools

| Tool | Purpose |
|------|---------|
| `memory_write` | Record a fact, insight, or project note |
| `memory_search` | Query facts by keyword (FTS5) |
| `memory_edit` | Delete or replace facts by category |

---

## MCP Integration

**Files**: `src/hlvm/agent/mcp/`

Uses `@modelcontextprotocol/sdk@^1.12.0` (replaced 1,900 lines of hand-rolled client).

### Components

| Module | Purpose |
|--------|---------|
| `sdk-client.ts` | `SdkMcpClient` adapter wrapping SDK `Client` |
| `config.ts` | Load server configs from `~/.hlvm/mcp.json` + Claude Code plugins |
| `tools.ts` | Register MCP tools into dynamic tool registry |
| `oauth.ts` | OAuth2 flow (discovery, authorization, token exchange, refresh) |

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
  | UserItem          // User input
  | AssistantItem     // Agent text response
  | ThinkingItem      // Reasoning/planning bubbles
  | ToolGroupItem     // Grouped tool call results
  | DelegateItem      // Child agent delegation status
  | ErrorItem         // Error messages
  | InfoItem          // Generic info (or structured team events)
  | MemoryActivityItem // Memory recall/write activity
```

### Team Event Items

Structured team events are a discriminated union extending `InfoItem`:

```typescript
type StructuredTeamInfoItem =
  | TeamTaskInfoItem       // teamEventType: "team_task_updated"
  | TeamMessageInfoItem    // teamEventType: "team_message"
  | TeamPlanReviewInfoItem // teamEventType: "team_plan_review"
  | TeamShutdownInfoItem   // teamEventType: "team_shutdown"
  | TeamRuntimeSnapshotInfoItem // teamEventType: "team_runtime_snapshot"
```

Type guard: `isStructuredTeamInfoItem(item)` checks for `teamEventType` discriminator.

### Team Event Rendering

**File**: `src/hlvm/cli/repl-ink/components/conversation/TeamEventItem.tsx`

Each event type renders as a `ConversationCallout` with tone-aware borders:

| Event Type | Rendering | Tones |
|-----------|-----------|-------|
| Task updated | `{glyph} Task #{id}: {goal}` + assignee | pending→neutral, in_progress→active, completed→success, errored→error, blocked→warning |
| Message | `{glyph} {from} → {to}: {preview}` | idle→neutral, completed→success, error→error, message→active, broadcast→active |
| Plan review | `{glyph} Plan Review` + task + submitter | pending→warning, approved→success, rejected→error |
| Shutdown | `{glyph} Shutdown {status}` + member + reason | requested→warning, acknowledged→active, forced→error, terminated→neutral |

Glyphs: `○` pending, `●` active, `✓` success, `✗` error, `⚠` warning, `✉` message, `📢` broadcast

### ConversationPanel Integration

```typescript
// src/hlvm/cli/repl-ink/components/ConversationPanel.tsx
case "info":
  if (isStructuredTeamInfoItem(item)) {
    return <TeamEventItem item={item} width={width} />;
  }
  return <InfoMessage text={item.text} />;
```

### Team Dashboard Overlay

**File**: `src/hlvm/cli/repl-ink/components/TeamDashboardOverlay.tsx`

Modal panel accessible via keyboard shortcut showing:
- Members with name, agent type, status
- Task board with status counts (active, done, blocked)
- Pending plan approvals
- Shutdown requests
- Attention items requiring lead action

Layout: balanced two-column for wide terminals (88+ cols), single column for narrow.

### Footer Status

**File**: `src/hlvm/cli/repl-ink/components/FooterHint.tsx`

When team is active:
- **"Team" chip** — active tone, always visible
- **Worker summary** — `"alice: working · bob: idle"` in muted text
- **Attention count** — `Ctrl+T (N)` when items need attention

Computed in `App.tsx` from `teamState.members`:
```typescript
teamWorkerSummary = teamState.members
  .filter(m => m.role === "worker")
  .map(m => `${m.id}: ${m.currentTaskId ? "working" : "idle"}`)
  .join(" · ")
```

### Team State Hook

**File**: `src/hlvm/cli/repl-ink/hooks/useTeamState.ts`

Derives `TeamDashboardState` from conversation items:

```typescript
interface TeamDashboardState {
  active: boolean;
  members: TeamMemberDisplay[];
  tasks: TeamTaskDisplay[];
  attentionItems: AttentionItem[];
  pendingApprovals: ApprovalDisplay[];
  shutdownRequests: ShutdownDisplay[];
  focusedWorkerIndex: number;
}
```

---

## Event System

### AgentUIEvent

Defined in `src/hlvm/agent/orchestrator.ts`. Emitted by the orchestrator, consumed by TUI:

| Event Type | Fields | When |
|-----------|--------|------|
| `thinking` | `iteration` | Start of each iteration |
| `reasoning_update` | `iteration`, `summary` | Agent reasoning output |
| `planning_update` | `iteration`, `summary` | Planning phase output |
| `tool_start` | `name`, `argsSummary`, `toolIndex`, `toolTotal` | Before tool execution |
| `tool_end` | `name`, `success`, `content`, `durationMs` | After tool execution |
| `turn_stats` | `iteration`, `toolCount`, `durationMs`, `inputTokens`, `outputTokens` | End of each iteration |
| `delegate_start` | `agent`, `task`, `threadId` | Child delegation begins |
| `delegate_end` | `agent`, `task`, `success`, `durationMs`, `summary` | Child delegation ends |
| `team_task_updated` | `taskId`, `goal`, `status`, `assigneeMemberId` | Task status change |
| `team_message` | `kind`, `fromMemberId`, `toMemberId`, `contentPreview` | Inter-agent message |
| `team_plan_review_required` | `approvalId`, `taskId`, `submittedByMemberId` | Plan needs approval |
| `team_plan_review_resolved` | `approvalId`, `approved`, `reviewedByMemberId` | Plan approved/rejected |
| `team_shutdown_requested` | `requestId`, `memberId`, `reason` | Shutdown initiated |
| `team_shutdown_resolved` | `requestId`, `memberId`, `status` | Shutdown completed |
| `memory_activity` | `recalled[]`, `written[]`, `searched?` | Memory operations |
| `todo_updated` | `todoState`, `source` | Task list changed |
| `plan_created` | `plan` | Plan generated |
| `plan_step` | `stepId`, `index`, `completed` | Plan step status |
| `batch_progress_updated` | `snapshot` | Batch delegation progress |

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

| Class | Retry? | Examples |
|-------|--------|---------|
| `abort` | No | `AbortError` — user cancelled |
| `timeout` | Maybe | Tool/LLM exceeded time limit |
| `rate_limit` | Yes | HTTP 429 — backoff and retry |
| `context_overflow` | Yes | Token limit — retry with smaller budget |
| `transient` | Yes | Network errors, 5xx |
| `permanent` | No | Auth errors, invalid prompt, model not found |
| `unknown` | No | Unclassified errors |

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

| Constant | Value | Context |
|----------|-------|---------|
| `MAX_ITERATIONS` | 20 | Parent/lead agent |
| `DELEGATE_MAX_ITERATIONS` | 10 | Delegated child agent |
| `MAX_RETRIES` | 3 | LLM call retries |
| `DEFAULT_MAX_TOOL_CALLS` | 50 | Tools per turn |

### Timeouts

| Constant | Value | Context |
|----------|-------|---------|
| `DEFAULT_TIMEOUTS.llm` | 120s | LLM call timeout |
| `DEFAULT_TIMEOUTS.tool` | 60s | Tool execution timeout |
| `DEFAULT_TIMEOUTS.userInput` | 300s | User confirmation timeout |
| `DEFAULT_TIMEOUTS.total` | 300s | Total loop timeout |
| `DELEGATE_TOTAL_TIMEOUT` | 120s | Child delegation total |

### Resource Limits

| Constant | Value | Context |
|----------|-------|---------|
| `maxReadBytes` | 2 MB | Single file read |
| `maxWriteBytes` | 2 MB | Single file write |
| `maxListEntries` | 5,000 | `list_files` results |
| `maxSearchResults` | 5,000 | `search_code` results |
| `maxSearchFileBytes` | 1 MB | Per-file search scan |
| `maxSymbolFiles` | 5,000 | `find_symbol` files |
| `maxTotalToolResultBytes` | 2 MB | Total tool output per run |

### Context

| Constant | Value | Context |
|----------|-------|---------|
| `DEFAULT_CONTEXT_WINDOW` | 32,000 | Default token budget |
| `COMPACTION_THRESHOLD` | 0.8 | Trigger compaction at 80% |
| `OUTPUT_RESERVE_TOKENS` | 4,096 | Reserved for LLM output |
| `MAX_SESSION_HISTORY` | 10 | Max messages before trim |

---

## Testing

### Test Structure

```
tests/unit/agent/
├── agent-team.test.ts           # 14 unit tests (team runtime, store, config)
├── agent-team-e2e.test.ts       # 16 E2E tests (full lifecycle with scripted LLMs)
├── delegation.test.ts           # Delegation system tests
├── llm-integration.test.ts      # Prompt compilation tests
├── sdk-runtime.test.ts          # SDK message consolidation tests
├── error-taxonomy.test.ts       # Error classification tests

tests/unit/repl/
├── team-event-rendering.test.ts # 34 tests (chrome mapping functions)
├── team-dashboard-overlay.test.ts # Dashboard rendering tests
├── footer-hint.test.ts          # 23 tests (includes team footer)
├── conversation-chrome.test.ts  # Conversation styling tests
├── shell-chrome.test.ts         # Shell footer tests

tests/unit/prompt/
├── compiler.test.ts             # Prompt compilation pipeline tests
├── instructions.test.ts         # Instruction hierarchy tests

tests/unit/memory/
├── memory.test.ts               # 47 tests (DB, facts, retrieval, invalidation)
```

### Running Tests

```bash
# Specific domain
deno test tests/unit/agent/agent-team-e2e.test.ts -A --no-check

# Team TUI tests
deno test tests/unit/repl/team-event-rendering.test.ts --no-check

# Full suite
deno task test:unit

# SSOT compliance
deno task ssot:check
```

### Test Utilities

- `createScriptedLLM(responses)` — Deterministic LLM for unit tests
- `FAST_POLL = { idlePollIntervalMs: 10, maxIdlePolls: 3 }` — Fast teammate polling (30ms vs 90s)
- `setupTeamEnv()` / `teardownTeamEnv()` — Temp directory + HLVM_DIR isolation

### Real E2E Verification

**Verified 2026-03-24** with Claude Haiku 4.5 (subscription auth, no API key).

Note: Automated unit tests use `createScriptedLLM()` (deterministic stubs). The test below uses a **real LLM** to prove the full workflow end-to-end.

```bash
cd /tmp/hlvm-team-e2e-test && deno run -A --no-check src/hlvm/cli/cli.ts ask \
  --model claude-code/claude-haiku-4-5-20251001 \
  --permission-mode acceptEdits --json \
  "Use a team of agents to accomplish these 2 tasks in parallel: \
   (1) Create hello.txt containing 'Hello from Agent 1' and \
   (2) Create goodbye.txt containing 'Goodbye from Agent 2'. \
   Use Teammate to spawn a team, TaskCreate for each task, then spawn 2 workers. \
   After both complete, shut down workers and clean up." \
  2>/dev/null | tee /tmp/hlvm-team-events.jsonl
```

**Observed timeline** (13 tool calls across lead + 2 workers, 9 iterations):

```
Lead  [1] Teammate(spawnTeam, "parallel-writers")              → created
Lead  [2] TaskCreate("Create hello.txt")                       → Task #1 pending
Lead  [3] TaskCreate("Create goodbye.txt")                     → Task #2 pending
Lead  [4] Teammate(spawnAgent, "worker1", type="file")         → spawned (background)
Lead  [5] Teammate(spawnAgent, "worker2", type="file")         → spawned (background)
      *** TEAM_TASK #1 → in_progress (worker1 claimed)
      *** TEAM_TASK #2 → in_progress (worker2 claimed)
W2    [6] write_file("goodbye.txt", "Goodbye from Agent 2")   → 20 bytes written
W1    [7] write_file("hello.txt", "Hello from Agent 1")        → 18 bytes written
Lead  [8] TaskList                                             → both in_progress
Lead  [9] wait_agent                                           → (poll)
      *** TEAM_TASK #2 → completed (worker2)
      >>> TEAM_MSG: task_completed worker2→lead "Created goodbye.txt..."
      *** TEAM_TASK #1 → completed (worker1)
      >>> TEAM_MSG: task_completed worker1→lead "Created hello.txt..."
Lead [10] TaskList                                             → both completed
Lead [11] SendMessage(shutdown_request, worker1)               → sent
Lead [12] SendMessage(shutdown_request, worker2)               → sent
Lead [13] Teammate(cleanup)                                    → cleaned_up
```

**Verification**:
```
$ cat /tmp/hlvm-team-e2e-test/hello.txt
Hello from Agent 1

$ cat /tmp/hlvm-team-e2e-test/goodbye.txt
Goodbye from Agent 2

$ ls ~/.hlvm/teams/parallel-writers/
ls: No such file or directory   # cleanup removed all team artifacts
```

**Key observations**:
- Workers ran **in parallel** (both claimed tasks before either completed)
- Workers used **real Claude Haiku 4.5 inference** (not scripted) to decide tool calls
- Permission mode (`acceptEdits`) propagated from lead to workers (write_file auto-approved)
- Task completion messages flowed from workers back to lead via inbox system
- Shutdown + cleanup removed all persistent state
- Total: ~142K input tokens, ~1K output tokens, 9 lead iterations + 2 iterations per worker

---

## Comparison with Claude Code

### Parity Status

| Feature | Claude Code | HLVM | Status |
|---------|-------------|------|--------|
| **Core** | | | |
| Lead/worker model | Yes | Yes | Done |
| Task board (create/update/list/get) | Yes | Yes | Done |
| Inter-agent messaging | Yes | Yes | Done |
| Broadcast messages | Yes | Yes | Done |
| Shutdown workflow | Yes | Yes | Done |
| Plan approval workflow | Yes | Yes (infrastructure) | Done |
| Permission inheritance | Yes | Yes | Done |
| Agent profiles | Yes | Yes (6 built-in + custom) | Done |
| Profile aliases | N/A | Yes (LLM-friendly names) | Done |
| **Persistence** | | | |
| File-backed task store | Yes | Yes | Done |
| Highwatermark task ID counter | Yes | Yes | Done |
| Team config JSON | Yes | Yes | Done |
| Inbox messages | Yes | Yes (via team store) | Done |
| **TUI** | | | |
| Structured team event rendering | Yes | Yes (ConversationCallout) | Done |
| Team dashboard overlay | Yes | Yes (TeamDashboardOverlay) | Done |
| Footer team status | Yes | Yes (Team chip + worker summary) | Done |
| Teammate cycling (Shift+Down/Up) | Yes | Yes (focusedWorkerIndex) | Done |
| Task list toggle (Ctrl+T) | Yes | Yes (overlay keybinding) | Done |
| Background tasks (Ctrl+B) | Yes | Yes (BackgroundTasksOverlay) | Done |
| **Advanced** | | | |
| Expand/collapse tool results (Ctrl+O) | Yes | Partial | Gap |
| Kill all agents (Ctrl+F) | Yes | Unknown | Gap |
| Delegate mode (Shift+Tab) | Yes | Unknown | Gap |
| tmux split-pane mode | Yes | No (in-process only) | Gap |
| TeammateIdle hook | Yes | No | Gap |
| TaskCompleted hook | Yes | No | Gap |
| `/tasks` slash command | Yes | Unknown | Gap |
| **NDJSON Event Stream** | | | |
| `--json` output mode | Yes | Yes | Done |
| team_task_updated events | Yes | Yes | Done |
| team_message events | Yes | Yes | Done |
| team_plan_review events | Yes | Yes | Done |
| team_shutdown events | Yes | Yes | Done |

### Key Differences

1. **Inbox system**: Claude Code uses file-based inboxes at `~/.claude/teams/`. HLVM uses in-memory team runtime with file-backed store persistence.

2. **Display modes**: Claude Code supports `in-process`, `tmux`, and `auto` modes. HLVM currently only supports in-process.

3. **Hooks**: Claude Code has `TeammateIdle` and `TaskCompleted` lifecycle hooks with quality gate support. HLVM has hook infrastructure but not these specific hooks.

4. **Known Claude Code bugs**: Teammate messages render with `Human:` prefix ([#27555](https://github.com/anthropics/claude-code/issues/27555)). HLVM renders them as structured `TeamMessageInfoItem` with proper sender attribution.

---

## Quick Reference

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `HLVM_DIR` | HLVM data directory | `~/.hlvm` |
| `HLVM_MODEL` | Default model | `ollama/llama3.1:8b` |

### Key File Paths

```
~/.hlvm/                        # Data root
~/.hlvm/HLVM.md                 # Global instructions
~/.hlvm/trusted-workspaces.json # Trust registry
~/.hlvm/memory/                 # Memory database
~/.hlvm/teams/{name}/           # Team configs
~/.hlvm/tasks/{name}/           # Task files
<workspace>/.hlvm/HLVM.md       # Project instructions
<workspace>/.hlvm/agents/       # Custom agent profiles
```
