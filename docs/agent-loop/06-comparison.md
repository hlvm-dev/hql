# HLVM vs Claude Code — Structural Comparison

Honest analysis of what's justified and what's over-engineered.


## Raw Numbers

```
                              HLVM              Claude Code
                              ────              ───────────
  Core loop files             5 files            1 file
  Core loop LOC               6,077              1,729

  Session/entry               696 LOC            9,688 LOC (REPL+main)
  Tool filtering              497 LOC            9,409 LOC (permissions)
  Tool execution              1,668 LOC          3,113 LOC
  Context/compaction          790 LOC            3,960 LOC
                              ─────              ─────────
  AGENT CORE TOTAL            ~9,700 LOC         ~28,000 LOC
```


## Architecture Comparison

```
  ═══════════════════════════════════════════════════════════════════════
  CLAUDE CODE — The Loop (query.ts:307)
  ═══════════════════════════════════════════════════════════════════════

    while (true) {
      │
      ├─ state = { messages, toolUseContext, tracking, ... }
      │    (ONE state object, destructured at top)
      │
      ├─ skill discovery prefetch (async, non-blocking)
      ├─ tool result budget enforcement
      ├─ microcompact (cache-aware dedup before call)
      ├─ build messages for API
      │
      ├─ callModel() → streaming async generator
      │    for await (chunk of stream):
      │      text → yield to TUI
      │      tool_use → collect
      │      streaming tool executor → EXECUTE TOOLS DURING STREAM
      │
      ├─ needsFollowUp?
      │    NO → recovery? (3 tiers: collapse → compact → escalate)
      │         stop hooks → return {completed}
      │    YES → execute remaining tools → build next state → continue
      │
      └─ 5 continue sites, all in ONE file

    Key design choices:
      - ONE file for the loop (query.ts, 1,729 LOC)
      - ONE state object (immutable transitions)
      - Streaming tool execution (tools run WHILE LLM streams)
      - Async generator (yields messages to TUI)
      - Flat permission model (5 modes × 3 rule types, no layers)
      - No phase machine — LLM picks tools naturally
      - No domain classification — LLM decides what to use
      - No grounding checks — trusts the LLM


  ═══════════════════════════════════════════════════════════════════════
  HLVM — The Loop (orchestrator.ts:1584 + 4 files)
  ═══════════════════════════════════════════════════════════════════════

    while (iterations < max) {
      │
      ├─ LoopState + ToolProfileState + ContextManager
      │    (THREE mutable state objects, spread across files)
      │
      ├─ rate limit
      ├─ inject reminders, memory
      ├─ context pressure + pre-compaction flush
      ├─ proactive compaction
      ├─ adaptive tool phase (5-layer profile, phase machine)
      ├─ thinking budget
      │
      ├─ callLLM() → wait for full response
      │    NO streaming tool execution
      │
      ├─ auto-continuation (truncated responses)
      ├─ response classification (text vs tools vs JSON repair)
      ├─ tool execution (validate, permit, dispatch)
      ├─ post-tool (denial tracking, playwright recovery)
      ├─ final response (plan advance, grounding, citations,
      │    auto-continue suppression, browser gate, working notes)
      │
      └─ ~12 continue sites, spread across 5 files

    Additional design choices:
      - 5 files for the loop
      - 5-layer tool profile with intersection/union math
      - Phase state machine (researching/editing/verifying/...)
      - Domain pre-classification via local LLM
      - Grounding checks (LLM re-verifies its own answer)
      - Browser headless→headed promotion pipeline
      - Multi-agent teams with task board + messaging
      - Persistent memory (SQLite + FTS5)
      - Plan execution with step advancement
```


## What's Justified vs Over-Engineered

```
  ┌────────────────────────────────┬─────────┬──────────────────────────┐
  │ HLVM Feature                   │ Verdict │ Why                      │
  ├────────────────────────────────┼─────────┼──────────────────────────┤
  │ Browser sandbox (domain layer) │ YES     │ Real security need.      │
  │                                │         │ pw_* must be isolated.   │
  ├────────────────────────────────┼─────────┼──────────────────────────┤
  │ Hybrid promotion               │ YES     │ Headless→headed is a    │
  │ (safe→hybrid escalation)       │         │ real capability gap.     │
  │                                │         │ CC doesn't have this.    │
  ├────────────────────────────────┼─────────┼──────────────────────────┤
  │ Multi-agent teams              │ YES     │ Unique capability.       │
  │                                │         │ But 6 drain ops per      │
  │                                │         │ iteration even for solo  │
  │                                │         │ agents is wasteful.      │
  ├────────────────────────────────┼─────────┼──────────────────────────┤
  │ Persistent memory              │ YES     │ CC uses CLAUDE.md only.  │
  │ (SQLite + FTS5)                │         │ Real advantage for long  │
  │                                │         │ conversations.           │
  ├────────────────────────────────┼─────────┼──────────────────────────┤
  │ Plan execution w/ step markers │ YES     │ Structured multi-step    │
  │                                │         │ execution. CC has        │
  │                                │         │ simpler plan mode.       │
  ├────────────────────────────────┼─────────┼──────────────────────────┤
  │ Pre-compaction memory flush    │ YES     │ Clever: let model save   │
  │                                │         │ before context is lost.  │
  ├────────────────────────────────┼─────────┼──────────────────────────┤
  │ 5-LAYER tool profile stack     │ MAYBE   │ 2 layers needed (base + │
  │                                │         │ domain). 5 is heavy for  │
  │                                │         │ a binary browser/general │
  │                                │         │ decision. plan/discovery │
  │                                │         │ /runtime could be        │
  │                                │         │ simpler overlays.        │
  ├────────────────────────────────┼─────────┼──────────────────────────┤
  │ Phase state machine            │ NO      │ CC lets LLM pick tools   │
  │ (researching/editing/...)      │         │ naturally. Phase-based   │
  │                                │         │ narrowing second-guesses │
  │                                │         │ the model.               │
  ├────────────────────────────────┼─────────┼──────────────────────────┤
  │ Domain pre-classification      │ NO      │ Local LLM call per      │
  │ (local LLM for every request)  │         │ request to decide        │
  │                                │         │ browser/general, then    │
  │                                │         │ LOCKED for the loop.     │
  │                                │         │ The main LLM can decide  │
  │                                │         │ this itself.             │
  ├────────────────────────────────┼─────────┼──────────────────────────┤
  │ Grounding checks               │ NO      │ LLM call to verify the  │
  │                                │         │ LLM's own answer. CC     │
  │                                │         │ trusts the model.        │
  ├────────────────────────────────┼─────────┼──────────────────────────┤
  │ 5-file loop split              │ NO      │ CC keeps loop in 1 file  │
  │                                │         │ (query.ts). The split    │
  │                                │         │ moved complexity around, │
  │                                │         │ didn't remove it. Now    │
  │                                │         │ need 5 files open to     │
  │                                │         │ understand 1 loop.       │
  ├────────────────────────────────┼─────────┼──────────────────────────┤
  │ Auto-continue suppression      │ NO      │ Catches "may I proceed?" │
  │                                │         │ to auto-continue. Better │
  │                                │         │ to fix in system prompt. │
  ├────────────────────────────────┼─────────┼──────────────────────────┤
  │ Working note detection         │ NO      │ Catches "next I will..." │
  │                                │         │ to nudge. System prompt  │
  │                                │         │ should prevent this.     │
  └────────────────────────────────┴─────────┴──────────────────────────┘


  SCORECARD:

    Justified:      7 features  (~40% of complexity)
    Maybe:          1 feature   (~15% of complexity)
    Over-engineered: 5 features  (~45% of complexity)
```


## What CC Does Better

```
  ┌────────────────────────────────┬────────────────────────────────────┐
  │ CC Advantage                   │ Impact                            │
  ├────────────────────────────────┼────────────────────────────────────┤
  │ Streaming tool execution       │ Tools run WHILE LLM still         │
  │                                │ streaming. HLVM waits for full    │
  │                                │ response. Massive latency win.    │
  ├────────────────────────────────┼────────────────────────────────────┤
  │ 3-tier compaction              │ Snip → collapse → full compact.   │
  │                                │ Preserves granularity. HLVM has   │
  │                                │ trim or full summarize only.      │
  ├────────────────────────────────┼────────────────────────────────────┤
  │ Tool result budget             │ Per-message byte limit prevents   │
  │                                │ single tool result from eating    │
  │                                │ the context. HLVM relies on       │
  │                                │ truncateResult() only.            │
  ├────────────────────────────────┼────────────────────────────────────┤
  │ Async generator architecture   │ Yields messages as they arrive.   │
  │                                │ True streaming UX. HLVM buffers.  │
  ├────────────────────────────────┼────────────────────────────────────┤
  │ Single-file loop               │ ONE file to understand the loop.  │
  │                                │ HLVM needs 5 files.               │
  ├────────────────────────────────┼────────────────────────────────────┤
  │ Flat permissions               │ 5 modes × 3 rules. No layers,    │
  │                                │ no intersection math, no cache.   │
  └────────────────────────────────┴────────────────────────────────────┘
```


## What HLVM Does Better

```
  ┌────────────────────────────────┬────────────────────────────────────┐
  │ HLVM Advantage                 │ Impact                            │
  ├────────────────────────────────┼────────────────────────────────────┤
  │ Browser automation             │ Playwright + computer-use tools.  │
  │                                │ CC has no browser capabilities.   │
  ├────────────────────────────────┼────────────────────────────────────┤
  │ Multi-agent (pending rewrite)  │ Agent system being ported from    │
  │                                │ CC's AgentTool pattern.           │
  ├────────────────────────────────┼────────────────────────────────────┤
  │ Persistent memory              │ SQLite+FTS5, entity graph,        │
  │                                │ temporal decay. Survives across   │
  │                                │ sessions. CC has no memory.       │
  ├────────────────────────────────┼────────────────────────────────────┤
  │ Structured planning            │ Multi-step plans with step        │
  │                                │ markers and review gates.         │
  │                                │ CC has simpler plan mode.         │
  ├────────────────────────────────┼────────────────────────────────────┤
  │ Pre-compaction memory flush    │ Model gets a chance to save       │
  │                                │ important context before          │
  │                                │ compaction. CC compacts silently. │
  ├────────────────────────────────┼────────────────────────────────────┤
  │ Local model routing            │ Auto-select between providers     │
  │                                │ including local Ollama. CC is     │
  │                                │ Anthropic-only.                   │
  └────────────────────────────────┴────────────────────────────────────┘
```


## If You Were Starting Over

```
  KEEP:
    - Browser sandbox (2 profiles, not 5 layers)
    - Hybrid promotion (real bug fix, real capability)
    - Multi-agent with lazy initialization (skip drains if solo)
    - Memory system
    - Pre-compaction flush
    - Plan execution with step markers

  SIMPLIFY:
    - 5 layers → 2 (baseline + domain) + simple overlays
    - Phase machine → delete (trust the LLM)
    - Domain classification → let the LLM request browser tools
    - Grounding checks → delete (trust the LLM)
    - Auto-continue/working note detection → fix system prompt
    - 5-file split → 2 files max (loop + tool execution)

  ADD FROM CC:
    - Streaming tool execution (latency)
    - Gradual compaction (snip before full compact)
    - Tool result budget (prevent context bloat)
    - Async generator for streaming UX
```
