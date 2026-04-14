# Request Routing — Architecture & Profile

> Status: revised 2026-04-14 after industry research, benchmark data, and
> implementation attempt

## TL;DR

- **Drop `classifyAll()` for explicit model selection.** No per-query
  semantic classification. The industry consensus (8 tools audited): don't
  classify, trust the model + bounded eager tools + `tool_search` discovery.
- **Keep `classifyTask()` only for `@auto` model selection** (needs
  `taskType` to pick the right model). This is the only surviving use of
  the local LLM classifier for routing.
- **Keep the 3-tier model system.** Tiers control prompt depth, tool
  count, quality features — not routing.
- **Improve `tool_search`** with CC/Codex lessons: list deferred tool
  names in system prompt, `select:` prefix, better blocked-tool hints.
- **Kill structural regex** for semantic decisions. Regex stays only for
  format detection (per our Phase 1/2 principle).
- **Fix deferred-tool enforcement gap** before testing anything else
  (pre-existing bug: deferred tools are not actually blocked).

## Decision Log

### What `classifyAll()` does vs simpler alternatives

| classifyAll field | What it does | Alternative | Needed? |
|-------------------|-------------|-------------|---------|
| `browser` | Pre-load pw_\*/cu_\* tools | `tool_search` discovers them | NO |
| `delegate` | Add delegation hints | `delegate_agent` already eager for enhanced | NO |
| `plan` | Enable planning mode | User sets manually, or model enters itself | NO |
| `taskType` | Pick model for `@auto` | **No alternative** | ONLY @AUTO |

Every field except `taskType` has a simpler, proven alternative used by
the rest of the industry.

### Why we're dropping classifyAll (except @auto)

1. **Nobody else does it.** 8 tools audited, 0 do per-query semantic
   classification. Not CC, not Codex, not Gemini CLI, not Cline, not Goose.
2. **Inverted trust.** gemma4 (8B) gatekeeping Opus/Haiku/GPT-4o is
   architecturally wrong. The classifier is dumber than the model it
   serves.
3. **Two code paths.** The split (`self_directed` vs `assisted`) adds
   complexity for marginal benefit.
4. **Structural regex is fragile.** The regex patterns in
   `delegation-heuristics.ts` make semantic decisions — violating our own
   Phase 1/2 principle.

### Why we considered using the selected model as classifier

If user picks Haiku → Haiku classifies for Haiku → no inverted trust.
Cost ~$0.001 per query. But this adds 150-200ms to every query, and
the industry evidence says it's unnecessary: bounded eager tools +
`tool_search` discovery is sufficient.

### CC's `tool_reference` is vendor-locked

CC uses `tool_reference` with `defer_loading: true` — an Anthropic API
beta feature. Only works for Opus and Sonnet. Haiku is excluded. Non-
Anthropic models cannot use it.

Codex CLI (OpenAI) independently built the same behavioral pattern using
BM25 search — vendor-agnostic, no API-specific features. This confirms
the approach is generalizable.

Our `tool_search` is the same pattern — a normal tool that searches a
registry. It works for any model that can call tools.

## Industry Research (2026-04-14)

Audited 7 OSS AI coding tools + Claude Code:

| Tool | Per-query classify? | Per-model filter? | MCP scaling | Deferred? |
|------|--------------------|--------------------|-------------|-----------|
| Claude Code | No | No | tool_reference + ToolSearch | Yes (Opus/Sonnet) |
| Codex CLI (OpenAI) | No | Yes (ModelInfo) | <100 direct, >=100 BM25 search | Yes (threshold) |
| Gemini CLI (Google) | No | No | All eager, 512 hard limit, no fix | No |
| OpenCode.ai | No | No | All eager, no limit | No |
| Cline | No | Yes (13+ variants, XS=9, frontier=20+) | All in prompt | No |
| OpenHands | No | No | Keyword microagents | No |
| Goose (Block) | No | No | Layered Tool Pattern (3 meta-tools for 200+) | Sort of |
| Aider | N/A | Per-model edit format | No MCP, no tools | N/A |
| **HLVM (us)** | **Yes** | **Yes (3 tiers)** | **Tier-based + tool_search** | **Yes** |

### Key findings

1. **HLVM is the only tool doing per-query semantic classification.**
   This is either an innovation or over-engineering. Industry evidence
   says over-engineering.

2. **Codex CLI's threshold pattern is most relevant to us.** MCP tools
   <100 → all direct. >=100 → deferred behind BM25 search. Vendor-
   agnostic. Same pattern as our `tool_search`.

3. **Goose's Layered Tool Pattern is most scalable.** 3 meta-tools
   (discover → plan → execute) replacing 200+ endpoints. Relevant for
   future MCP scaling.

4. **Cline's variant system is closest to our tier system.** Different
   models get different tool counts (9 for compact, 20+ for frontier).

5. **~20-25 tool ceiling is industry consensus.** Cline, Goose, and
   research all converge on this as the reliability limit.

## Benchmark Data

### Routing-only benchmark (2026-04-13)

28-case labeled benchmark against the routing layer.

| Metric | Assisted weak routing | Structural-only weak proxy |
| --- | ---: | ---: |
| Exact routing match | 25 / 28 | 16 / 28 |
| Correct browser/general domain | 27 / 28 | 22 / 28 |
| Correct delegation decision | 28 / 28 | 24 / 28 |
| Correct plan/no-plan decision | 26 / 28 | 26 / 28 |

Latency:

| Metric | Assisted weak routing | Structural-only weak proxy |
| --- | ---: | ---: |
| Average | 3191 ms | ~0 ms |
| Median | 869 ms | ~0 ms |
| P95 | 12188 ms | ~0 ms |

**Reinterpretation**: This benchmark measured whether `classifyAll()`
improves routing decisions. It does (25/28 vs 16/28). But the question
is wrong. The right question is whether routing decisions are needed at
all — and the industry answer is no.

The live end-to-end test contradicted the routing benchmark: gemma4
scored 3/3 with structural-only vs 1/3 with assisted routing (line 150).
Routing accuracy ≠ task success.

### Tool discovery benchmark (2026-04-14)

5-task end-to-end benchmark: Haiku vs Gemma4.

| # | Task | Haiku | Gemma4 |
|---|------|-------|--------|
| 1 | Implicit browser | pw_goto directly. 7s | pw_goto directly. Crashed. 28s |
| 2 | Plain code | Correct (4). 5s | Wrong (2). 32s |
| 3 | Web search | **tool_search** → search_web → correct. 37s | Guessed search_web, wrong args. 91s |
| 4 | Delegation | delegate_agent directly. 61s | delegate_agent directly. 100s |
| 5 | Simple file read | Correct, concise. 5s | Correct, rambling. 40s |

Key findings:

- **Haiku self-discovers via tool_search.** Explicitly reasoned "I
  should use tool_search first to discover web search capabilities."
- **Gemma4 never used tool_search.** Guessed tool names directly.
- **Haiku's behavior may be Anthropic training-specific.** GPT-4o and
  Gemini not tested — unknown whether they self-discover.

### CC improvements test (2026-04-14)

**Result: INCONCLUSIVE.** Pre-existing enforcement gap prevents testing.

Deferred tools (search_web, etc.) are classified as deferred in the
registry but are not actually blocked by the tool filter. Gemma4 calls
`search_web` directly and succeeds — the gate is open.

Until the enforcement gap is fixed, we cannot test whether the CC
improvements (deferred names in prompt, select: prefix, better hints)
change gemma4's behavior.

## Pre-Existing Bug: Deferred Tool Enforcement Gap

**Priority: P0 — blocks all testing.**

`computeTierToolFilter("standard")` returns a 23-tool allowlist that
does NOT include `search_web`. But when gemma4 calls `search_web`, the
call succeeds.

```
Expected:  search_web called → BLOCKED → hint to use tool_search
Actual:    search_web called → SUCCEEDS → tool_search never needed
```

Verified with:

```typescript
computeTierToolFilter("standard").allowlist  // 23 tools, no search_web
getDeferredToolNames()                       // 36 tools including search_web
// But search_web is callable anyway
```

**This gap makes the entire tool_search discovery mechanism optional.**
If deferred tools are never blocked, models never need tool_search, and
the CC improvements have no trigger point.

**Must fix before any further benchmark testing.**

Investigate: `buildIsToolAllowed()` in `orchestrator-tool-execution.ts`,
tool profile layer intersection in `tool-profiles.ts`, and session
baseline construction in `session.ts` / `agent-runner.ts`.

## CC Improvements — Implemented, Untested

Three changes implemented (0 SSOT errors), awaiting enforcement fix:

### 1. Deferred tool names in system prompt

**File**: `src/hlvm/prompt/sections.ts`

Added `getDeferredToolNames()` call in `renderCriticalRules()`. The
system prompt now includes:

```
Additional tools available via tool_search: aggregate_entries,
archive_files, ch_back, ch_click, ..., search_web, web_fetch, ...
```

Plus instruction: `Use "select:" prefix for exact match (e.g.
tool_search({query:"select:search_web"}))`

Mirrors CC's `<available-deferred-tools>` block.

### 2. `select:` prefix for exact match

**File**: `src/hlvm/agent/tools/meta-tools.ts`

`tool_search` now supports `select:search_web,web_fetch` for exact-match
selection. Comma-separated multi-select. No fuzzy search needed when
model knows the name from the deferred list.

Mirrors CC's `ToolSearchTool` select pattern.

### 3. Better blocked-tool hint

**File**: `src/hlvm/agent/orchestrator-tool-execution.ts`

Changed from:
```
Use tool_search to discover and enable "search_web".
```

To:
```
Call tool_search({query:"select:search_web"}) to discover and enable it.
```

Copy-paste ready. Even weak models can follow explicit instructions.

Mirrors CC's `buildSchemaNotSentHint()` pattern.

### 4. `getDeferredToolNames()` utility

**File**: `src/hlvm/agent/registry.ts`

New exported function that returns sorted list of all deferred tool names
by iterating the registry and checking `inferToolLoadingExposure()`.
Returns 36 tools currently.

## Two Architecture Options (decide after testing)

### Option A: Drop classifyAll, tool_search only (industry standard)

The target if Steps 2-3 in the execution order pass. Simplest. Matches
what CC, Codex, Gemini CLI, and every other tool does.

### Option B: Keep classifyAll, selected model as classifier (fallback)

If tool_search improvements don't work for weak models (gemma4 still
doesn't follow discovery hints), keep classifyAll but fix the inverted
trust problem:

```
User picks Opus   → Opus classifies for itself   → best accuracy
User picks Haiku  → Haiku classifies for itself   → great accuracy
User picks GPT-4o → GPT-4o classifies for itself  → great accuracy
User picks gemma4 → gemma4 classifies for itself   → same as today
@auto             → gemma4 classifies              → same as today

Rule:
  selectedModelTier >= "standard" AND model is known
    → classifier = selected model
  else (constrained, @auto, unknown)
    → classifier = gemma4 (LOCAL_FALLBACK_MODEL_ID)
```

Cost: ~200 tokens in + 64 out. On Haiku ~$0.001. Negligible.

This eliminates the "weak gatekeeping strong" problem while keeping
classifyAll as a safety net for weak models. classifyAll fields:
`{ browser, delegate, plan, taskType }` — pre-loads tools + sets modes.

One routing path for all tiers (no self_directed/assisted split).
Kill structural regex either way.

### Decision criteria

```
Step 2 passes (gemma4 follows tool_search hints)?
  → Option A (drop classifyAll, simplest)

Step 2 fails (gemma4 still doesn't discover)?
  → Option B (keep classifyAll with selected-model classifier)

Either way:
  → Kill structural regex
  → Kill two-path split
  → Fix enforcement gap
  → Keep tool_search + CC improvements
```

## Proposed Architecture — Option A (after enforcement fix)

```text
USER QUERY
   |
   v
+--------------------------------------------------------------+
| Is it @auto mode?                                            |
|                                                              |
|   YES -> gemma4 classifyTask() for taskType only             |
|          auto-select picks model                             |
|                                                              |
|   NO  -> skip. Zero classification.                          |
+--------------------------------------------------------------+
   |
   v
+--------------------------------------------------------------+
| classifyModelTier(modelInfo, model)                          |
|                                                              |
| constrained | standard | enhanced                            |
+--------------------------------------------------------------+
   |
   v
+--------------------------------------------------------------+
| session/tool setup (tier-based, NO routing result needed)    |
|                                                              |
| constrained: 16 core tools, no tool_search, no MCP          |
| standard:    23 eager + tool_search + deferred names listed  |
| enhanced:    32 eager + tool_search + deferred names listed  |
|                                                              |
| Deferred tools BLOCKED until discovered via tool_search.     |
+--------------------------------------------------------------+
   |
   v
+--------------------------------------------------------------+
| main agent loop                                              |
|                                                              |
| Model sees eager tools + deferred tool names listed.         |
| Model needs a deferred tool?                                 |
|   → calls tool_search("select:search_web")                   |
|   → tool discovered, added to allowlist                      |
|   → uses it on next turn                                     |
|                                                              |
| Model tries deferred tool directly (without discovery)?      |
|   → BLOCKED with hint:                                       |
|     "Call tool_search({query:'select:X'}) to enable it."     |
|   → model follows hint → discovers → uses on next turn       |
+--------------------------------------------------------------+
```

### What changes from current system

| Change | Why |
|--------|-----|
| Remove `computeRoutingResult()` for explicit models | Not needed. No per-query classification. |
| Remove structural regex (BROWSER_URL_CUE_PATTERN, PARALLEL_CUE_PATTERN, etc.) | Semantic decisions via regex violates Phase 1/2 principle. |
| Remove two-path split (`self_directed` vs `assisted`) | One path for all tiers. Tier controls tool count, not routing. |
| Keep `classifyTask()` for `@auto` only | Still need taskType to pick model. |
| Fix deferred-tool enforcement | **P0**: without this, tool_search is never needed. |
| List deferred tool names in prompt | CC lesson: model must know what exists. |
| Add `select:` prefix to tool_search | CC lesson: exact match for known names. |
| Better blocked-tool hint | CC lesson: copy-paste ready discovery call. |

### What stays

| Stays | Why |
|-------|-----|
| 3-tier model system | Controls prompt depth, tool count, quality features |
| Bounded eager tool sets per tier | Research: fewer tools = better accuracy |
| `tool_search` meta-tool | Discovery for deferred/MCP tools |
| Tier-based MCP loading (constrained = none) | Weak models can't handle MCP |
| Tool profile layers (domain, plan, discovery, runtime) | Orthogonal concerns |

## MCP Scaling Strategy (Future)

Codex-style threshold for MCP at scale:

```
total tools <= ~50:  all direct (no deferral needed)
total tools > ~50:   built-in eager + excess MCP deferred behind tool_search
```

Codex uses threshold of 100 (their built-ins are ~15-25). Our built-ins
are ~30, so threshold should be lower (~50).

For very large MCP catalogs (200+), consider Goose's Layered Tool
Pattern: 3 meta-tools (discover → plan → execute) replacing the flat
tool list.

## Execution Order

```
STEP 1: Fix deferred-tool enforcement gap           ← P0 BLOCKER
        (search_web etc. must be blocked for
         standard/enhanced until discovered)

STEP 2: Retest gemma4 with CC improvements          ← validates the approach
        (deferred names in prompt + select: +
         better hints. Does gemma4 follow?)

STEP 3: Test Haiku, GPT-4o, Gemini                  ← validates cross-provider
        (do non-Anthropic frontier models
         use tool_search unprompted?)

STEP 4: Remove classifyAll() routing path            ← only if Steps 2-3 pass
        (keep classifyTask for @auto only)

STEP 5: Remove structural regex                      ← cleanup
        (BROWSER_URL_CUE_PATTERN etc.)

STEP 6: Remove two-path split                        ← cleanup
        (self_directed / assisted)
```

## Raw Data

### Routing-only benchmark (2026-04-13)

- `/tmp/hql_routing_profile_report.json`

### Tool discovery benchmark (2026-04-14)

- `/tmp/bench_t1a_haiku.txt` — Haiku browser task
- `/tmp/bench_t1b_gemma4.txt` — Gemma4 browser task
- `/tmp/bench_t3a_haiku.txt` — Haiku web search
- `/tmp/bench_t3b_gemma4.txt` — Gemma4 web search
- `/tmp/bench_cc3_gemma4.txt` — Gemma4 web search (CC improvements, enforcement gap)

These are measurement artifacts, not committed SSOT documents.
