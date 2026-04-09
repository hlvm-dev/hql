# Model Tier Classification

> SSOT: `classifyModelTier()` in `src/hlvm/agent/constants.ts`

## Overview

Every model HLVM works with is classified into one of three experience
tiers. The tier controls how much the system gives the model (prompt
depth, tool count, MCP) and whether LLM-powered quality features are
enabled (semantic search ranking, memory auto-invalidation).

```
ModelTier = "constrained" | "standard" | "enhanced"
```

## Tier Definitions

### constrained

Resource-limited models that need protection from token overflow.

- **Short system prompt** (~1K tokens, base sections only)
- **16 core tools** (file I/O, git, web, memory, complete_task)
- **No MCP** server loading
- **3-6K context budget** for direct chat
- **Deterministic search** ranking
- **No memory auto-invalidation**

### standard

Full-capability models with progressive tool discovery.

- **Full system prompt** (~3K tokens with 17 tools, vs ~8K with all tools)
- **17 eager tools** + `tool_search` for progressive discovery
- **Deferred tools** (web, memory, CU, etc.) discoverable via `tool_search`
- **MCP** servers loaded lazily on first use
- **Full context budget**
- **Deterministic search** ranking
- **No memory auto-invalidation**

### enhanced

Full-capability models with LLM-powered quality features.

- Everything standard gets, plus:
- **LLM-ranked search result selection** (model picks best results to fetch)
- **LLM evidence reordering** (model ranks fetched passages by relevance)
- **Memory auto-invalidation** (conflicting facts auto-removed when similarity > 0.9)
- **2 extra instruction lines** (iterative search, evidence quality)

## Classification Logic

```
classifyModelTier(modelInfo?, model?): ModelTier

 1. Has capabilities data but NO "tools"?     -> constrained
 2. contextWindow < 8K?                        -> constrained
 3. parameterSize < 3B?                        -> constrained
 4. Cloud provider (anthropic/openai/google)?   -> enhanced
 5. Local model >= 30B with tools?             -> enhanced
 6. Everything else                            -> standard
```

Priority is top-down. Rule 1 fires before rule 4, so a cloud embedding
model (no tools) correctly gets constrained, not enhanced.

### Classification Examples

```
Model                         Data Available               Tier
---------------------------------------------------------------------------
Claude Opus (cloud)           anthropic/ prefix            enhanced
Claude Haiku (cloud)          anthropic/ prefix            enhanced
GPT-4o (cloud)                openai/ prefix               enhanced
Gemini 2.5 Pro (cloud)        google/ prefix               enhanced
Gemma4 8B (local, tools)      parameterSize=8B, tools      standard
Llama 3.1 8B (local, 128K)    parameterSize=8B, tools      standard
DeepSeek R1 70B (local)       parameterSize=70B, tools     enhanced
Qwen 72B (local)              parameterSize=72B, tools     enhanced
CodeLlama 34B (local)         parameterSize=34B, tools     enhanced
Phi-2 2.7B (local)            parameterSize=2.7B, no tools constrained
noname:8b (no tools cap)      parameterSize=8B, chat only  constrained
Unknown model (no data)       nothing                      standard
```

## Two Separate Concerns

The tier system answers "how much should we give this model?" It does
NOT answer "can this model call tools?" That is a separate capability
check:

```
classifyModelTier()         -> constrained | standard | enhanced
                               (resource sizing + quality features)

supportsAgentExecution()    -> boolean
                               (can this model call tools?)
                               checks capabilities.includes("tools")
                               separate from tier
```

A model can be "standard" tier (full prompt, all tools) but NOT support
agent execution (no tool-calling capability). In that case it gets chat
mode with a full prompt but no ReAct loop.

## Data Sources

Classification uses data from `ModelInfo`, which providers populate:

| Field | Ollama | Anthropic | OpenAI | Google | Public Catalog |
|-------|--------|-----------|--------|--------|----------------|
| parameterSize | YES | no | no | no | no |
| contextWindow | YES | no | no | YES | YES |
| capabilities | YES | hardcoded | hardcoded | provider-level | inferred |
| family | YES | hardcoded | from API | hardcoded | extracted |

`capabilities` is the most reliable field (all providers report it).
`parameterSize` is only available from Ollama.

## What Each Tier Controls

### Prompt Sections (minTier gates)

Each prompt section has a `minTier` annotation. The compiler includes a
section only if the model's tier meets or exceeds it:

```
Section               minTier       constrained  standard  enhanced
----------------------------------------------------------------------
Role                  constrained   YES          YES       YES
Critical Rules        constrained   YES          YES       YES
Instructions (base)   constrained   YES          YES       YES
Instructions (+mid)   standard      no           YES       YES
Instructions (+enh)   enhanced      no           no        YES
Tool Routing          constrained   YES          YES       YES
Permissions           constrained   YES          YES       YES
Web Guidance          constrained   YES          YES       YES
Environment           constrained   YES          YES       YES
Custom Instructions   constrained   YES          YES       YES
Delegation            constrained   YES*         YES       YES
Team Coordination     constrained   YES*         YES       YES
Examples              constrained   YES          YES       YES
Tips                  standard      no           YES       YES
Computer Use          standard      no           YES       YES
Footer                constrained   YES          YES       YES

* constrained gets brief versions; standard/enhanced get full guidance
```

### Tool Access

```
constrained: 16 core tools, hard cap, NO tool_search (CONSTRAINED_CORE_TOOLS)
  read_file, write_file, edit_file, list_files,
  search_code, ask_user, complete_task,
  git_status, git_diff, git_log,
  search_web, web_fetch, fetch_url,
  memory_write, memory_search, memory_edit

standard: 17 eager tools + progressive discovery (STANDARD_EAGER_TOOLS)
  ask_user, tool_search, todo_read, todo_write,
  list_files, read_file, search_code, find_symbol,
  get_structure, edit_file, write_file,
  git_status, git_diff, git_log,
  shell_exec, shell_script, open_path
  (deferred: web, memory, CU, archive — discovered via tool_search)

enhanced: ALL registered tools, no cap
```

Why constrained has web+memory but standard doesn't: constrained has no
`tool_search` so it can never discover tools. Standard has `tool_search`
so it starts lean and expands on demand. This cuts input tokens by ~70%
for standard-tier models (8K vs 29K).

### Lazy Tool Loading Pipeline (standard tier)

```
Session start
  → computeTierToolFilter("standard") → 17 eager tools
  → System prompt describes only 17 tools
  → LLM sees 17 tool schemas (~3K tokens)

Model needs deferred tool (e.g. search_web)
  → Calls tool directly → BLOCKED with hint:
    "Use tool_search to discover and enable 'search_web'"
  → Model calls tool_search("web search")
  → tool_search searches FULL registry (all 40+ tools)
  → Returns: suggested_allowlist: ["search_web", "web_fetch"]

Discovery callback fires
  → session.discoveredDeferredTools.add("search_web")
  → baseline allowlist grows: 17 + 1 = 18 tools
  → Current turn narrowed to: 9 core + discovered = 10 tools
  → Persisted to disk for session reuse

Next turn
  → toolFilterState resets to baseline (18 tools)
  → Model can call search_web directly without tool_search
```

Key invariant: `tool_search` searches the FULL registry (not just the
active allowlist). Deferred tools are always findable — just not callable
until discovered.

### MCP Server Loading

```
constrained: skipped entirely (never loads MCP)
standard:    lazy-loaded on first tool use
enhanced:    lazy-loaded on first tool use
```

### Web Search Quality

```
constrained/standard:
  selectSearchResultsDeterministically()  — formula-based scoring
  rankFetchedEvidenceDeterministically()  — keyword + authority + freshness

enhanced:
  selectSearchResultsWithLlm()            — model picks best results
  reorderFetchedEvidenceWithLlm()         — model ranks by relevance
  (try/catch fallback to deterministic if LLM call fails)
```

### Memory Auto-Invalidation

```
constrained/standard: conflicts detected but NOT auto-removed
enhanced:             conflicts with Jaccard similarity > 0.9 auto-invalidated
```

### Auto-Select Coding Strength Default

```
constrained -> codingStrength: "weak"   (+0 score)
standard    -> codingStrength: "mid"    (+2 score)
enhanced    -> codingStrength: "strong" (+5 score)

(overridden by MODEL_OVERRIDES for known models)
```

## Relationship to ToolProfile System

Tier-based filtering feeds into the `baseline` slot of the first-class
ToolProfile system (`tool-profiles.ts`). The tier filter is the foundation
layer; additional layers stack on top:

```
registered tools
  → baseline layer (tier + capability gating — this doc)
  → domain layer   (task-type routing, e.g. browser_safe)
  → plan layer     (planning vs execution phase)
  → discovery layer (tool_search narrowing)
  → runtime layer  (adaptive pruning)
  = final visible/executable tools
```

The tier system answers "how much should we give this model?"
The domain layer answers "what tools should this task use?"
Both are enforced by the same underlying allowlist/denylist machinery.

See `src/hlvm/agent/tool-profiles.ts` for the profile controller.
See `docs/computer-use/hybrid-strategy.md` for browser domain profiles.

## Key Source Files

| File | Role |
|------|------|
| `src/hlvm/agent/constants.ts` | `ModelTier` type, `classifyModelTier()`, `tierMeetsMinimum()`, `computeTierToolFilter()`, `STANDARD_EAGER_TOOLS`, `supportsAgentExecution()` |
| `src/hlvm/agent/tool-profiles.ts` | `ToolProfileState`, profile CRUD, declared browser profiles, merge semantics |
| `src/hlvm/prompt/sections.ts` | Prompt section renderers with `minTier` annotations |
| `src/hlvm/prompt/compiler.ts` | Filters sections by `tierMeetsMinimum(tier, section.minTier)` |
| `src/hlvm/agent/session.ts` | MCP gate, tool filter application, tier computation, profile baseline init |
| `src/hlvm/agent/tools/web/ddg-search-backend.ts` | LLM vs deterministic search selection |
| `src/hlvm/memory/invalidate.ts` | Auto-invalidation gate |
| `src/hlvm/agent/auto-select.ts` | Coding strength default from tier |
| `src/hlvm/cli/repl/handlers/direct-chat-history.ts` | Constrained direct-chat budget (3-6K) |

## Design Principles

1. **Names describe system behavior, not model quality.**
   "constrained" = we constrain what we give it. Not "weak" = it's bad.

2. **Capabilities and tier are orthogonal.**
   Tier = resource sizing. Capabilities = feature gates (tools, vision, thinking).

3. **SSOT.** One function (`classifyModelTier`), one type (`ModelTier`),
   one file (`constants.ts`). No duplicate types. No scattered logic.

4. **Ground truth first.** Check capabilities and context window before
   falling back to parameter count heuristics.

5. **Safe defaults.** Unknown models get "standard" (full tools, full
   prompt). Conservative enough not to break, generous enough to be useful.
