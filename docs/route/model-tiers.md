# Capability-Class Routing

> SSOT: `classifyModelCapability()` in `src/hlvm/agent/constants.ts`
>
> Renamed from the old `ModelTier` system on 2026-04-20. Was
> `"constrained" | "standard" | "enhanced"`; now
> `"chat" | "tool" | "agent"`.

## 1. What it decides

One question, up front, before any tools run:

- **What kind of work can this model reliably do?**

The answer picks one of three classes:

```
chat   -> text only. No tool schema sent. Direct chat.
tool   -> can emit tool calls, but not trusted for autonomous loops.
          Gets a small starter, no tool_search, loop narrowed.
agent  -> proven tool-capable. Gets same small starter + tool_search.
```

Ordering: `chat < tool < agent` (each is a superset of the previous).

## 2. Why (evidence)

Earlier HLVM used size-based tiers mapped to eager lists of 16 / 51 / 51
tools. Two independent sources showed this was past the accuracy cliff:

- **RAG-MCP** (arXiv 2505.03275): tool-selection accuracy drops from
  >90% at N≤30 tools to ~13% on full-dump baselines. Retrieval gets
  43%. 3× improvement.
- **Anthropic "Advanced Tool Use"**: Opus 4 went 49% → 74% on MCP
  benchmarks just by switching "all tools upfront" → Tool Search.
  Token load dropped 72K → 8.7K for 50+ tools.
- **Claude Code source** (verified): ~35 eager built-in tools, MCP
  deferred via ToolSearchTool by default.

HLVM's open P1 (`project_agent_system_default_broken.md`) also showed
that size-based tiers can't express "tool-capable but weak at loops"
— gemma4:e2b passed the old tier gate but couldn't drive agent mode.

## 3. Classification logic

`src/hlvm/agent/constants.ts:classifyModelCapability`:

```
1. capabilities reported + "tools" absent → chat
2. parameter count < 3B                   → chat
3. context window < 8K                    → chat
4. frontier provider (anthropic|openai|
   google|claude-code)                    → agent
5. local model name on curated allowlist
   AND params >= 7B                       → agent
6. has "tools" capability                 → tool
7. unknown (no signal)                    → tool   (safe default)
```

The curated allowlist (`AGENT_CAPABLE_MODELS`, private): qwen3, qwen2.5
≥7B, qwen2.5-coder ≥7B, llama3.1/3.2/3.3 ≥8B, deepseek-coder / r1,
mistral (large/small/medium/nemo), mixtral, command-r(-plus), yi ≥9B.

Explicitly `tool`-class (never `agent`): gemma*, phi*, tinyllama,
tinydolphin, smollm, orca-mini, llama2*, qwen2 (pre-2.5), anything
with `:1b` / `:2b` / `:3b` / `:e2b` suffix.

## 4. Starter tool policy

`src/hlvm/agent/constants.ts:starterPolicy` returns the allowlist for
a given class. Single source of truth: one table, three entries.

```
chat  → []                              (no tool schema)
tool  → TOOL_CLASS_STARTER_TOOLS        (~17 tools)
agent → AGENT_CLASS_STARTER_TOOLS       (~18 = tool starter + tool_search)
```

Starter contents (both classes share these; agent adds `tool_search`):

```
read_file, write_file, edit_file, list_files
search_code, find_symbol
git_status, git_diff, git_log
search_web, web_fetch, fetch_url
memory_write, memory_search, memory_edit
ask_user, complete_task, shell_exec
```

Deferred (discoverable via `tool_search` in agent class):
`todo_*`, `move_to_trash`, `reveal_path`, `file_metadata`,
`make_directory`, `move_path`, `copy_path`, `open_path`,
`shell_script`, `get_structure`, all `pw_*` (Playwright),
all `ch_*` (Chrome), sub-agent spawn.

User-explicit `toolAllowlist` wins over class default.

## 5. What differs by class

| Aspect | chat | tool | agent |
|---|---|---|---|
| Tool schema | empty | ~17 starter | ~18 starter + tool_search |
| Autonomous loop | no | no (agent mode rejects) | yes |
| MCP loading | skipped | loaded | loaded |
| Runtime phase narrowing | n/a | aggressive (web pruning) | permissive |
| Memory aggressive-invalidation | no | no | yes |
| Prompt depth | narrowest | tool-level sections | full agent sections |

## 6. REPL vs agent mode

REPL main-thread uses a wider eager core
(`REPL_MAIN_THREAD_EAGER_TOOLS` in `src/hlvm/agent/constants.ts`,
~51-tool surface including browser families) so REPL users can type
`pw_goto(...)` directly. Only agent mode (`hlvm ask`) uses the lean
`AGENT_CLASS_STARTER_TOOLS`.

Code boundary: `src/hlvm/agent/query-tool-routing.ts` for REPL
seeding; `src/hlvm/agent/session.ts` for agent-mode seeding via
`starterPolicy(capability, …)`.

## 7. Discovery semantics

In agent mode, `tool_search` discoveries are **turn-local**:

- The discovered tool name is tracked in `session.discoveredDeferredTools`
  for cross-session persistence.
- The turn-local `discovery` layer of `toolProfileState` surfaces it
  for the current turn only.
- `resetToolFilter()` at the next turn clears the `discovery` layer;
  baseline is NOT silently grown.

Evidence: same RAG-MCP / Anthropic findings — ratcheting discoveries
into baseline reintroduces the "too many tools" cliff the lean starter
was designed to avoid.

REPL keeps its original promotion semantics (the REPL branch of
`persistDeferredToolDiscoveriesForSession`) because REPL users expect
discovered tools to stay for the session.

## 8. Where the logic lives

| Concern | File |
|---|---|
| Capability class + classifier | `src/hlvm/agent/constants.ts` |
| Starter tool lists + policy | `src/hlvm/agent/constants.ts` |
| Agent admission gate | `src/hlvm/agent/agent-runner.ts:700` |
| Session baseline seeding | `src/hlvm/agent/session.ts:410` |
| Turn-local discovery | `src/hlvm/agent/agent-runner.ts:566` |
| Adaptive phase narrowing | `src/hlvm/agent/orchestrator.ts:876` |
| Prompt section gating | `src/hlvm/prompt/sections.ts` + `compiler.ts` |
| Memory invalidation gate | `src/hlvm/memory/invalidate.ts:46` |
| REPL wider eager core | `src/hlvm/agent/query-tool-routing.ts` |
| `@auto` codingStrength derivation | `src/hlvm/agent/auto-select.ts:280` |

## 9. Migration from the old tier system

| Old | New |
|---|---|
| `ModelTier = "constrained" \| "standard" \| "enhanced"` | `ModelCapabilityClass = "chat" \| "tool" \| "agent"` |
| `classifyModelTier(modelInfo, model)` | `classifyModelCapability(modelInfo, model)` |
| `computeTierToolFilter(tier, ...)` | `starterPolicy(capability, ...)` |
| `CONSTRAINED_CORE_TOOLS` (16) | `TOOL_CLASS_STARTER_TOOLS` (17) |
| `STANDARD_EAGER_TOOLS` (51) | `AGENT_CLASS_STARTER_TOOLS` (18) + `REPL_MAIN_THREAD_EAGER_TOOLS` (51, REPL only) |
| `ENHANCED_EAGER_TOOLS` (alias of STANDARD) | — (no difference between agent and cloud-frontier) |
| `tierMeetsMinimum(tier, min)` | `capabilityAtLeast(value, min)` |

Behavior changes intentionally introduced:

- Agent mode eager surface shrunk from 51 → 18 tools.
- Browser tools (`pw_*` / `ch_*`) moved out of eager — discoverable
  via `tool_search`.
- Unknown / weak local models fail agent admission instead of being
  silently promoted to a standard tier with 51 tools.
- Discovery in agent mode stays turn-local (no baseline ratchet).

## 10. One-line summary

Capability class in front, lean starter underneath, `tool_search` for
discovery, REPL keeps its own wider surface. Same runtime machinery
below — this is a policy replacement, not a subsystem rewrite.
