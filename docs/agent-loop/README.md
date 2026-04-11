# HLVM Agent Loop — Architecture Reference

Bird's-eye view of the ReAct agent loop, from CLI entry to final response.

## Files in this directory

| File | What it covers |
|------|---------------|
| [01-bird-eye.md](01-bird-eye.md) | Full system map — every subsystem, how they connect |
| [02-react-loop.md](02-react-loop.md) | The main `while` loop — every stage, every branch |
| [03-tool-profiles.md](03-tool-profiles.md) | 5-layer tool filtering, resolution, caching, browser promotion |
| [04-context-memory.md](04-context-memory.md) | Context management, compaction, memory injection |
| [05-multi-agent.md](05-multi-agent.md) | Teams, delegation, planning, inbox draining |
| [06-comparison.md](06-comparison.md) | HLVM vs Claude Code — structural complexity analysis |

## Quick orientation

```
CLI ("hlvm ask")
  → agent-runner.ts    session creation + config wiring
    → session.ts       LLM engine, context manager, tool profiles
      → orchestrator.ts   THE REACT LOOP (this is the core)
        → engine-sdk.ts      LLM calls with filtered tool schemas
        → orch-response.ts   tool execution, final response, recovery
        → orch-state.ts      state initialization, allowlist/denylist helpers
        → orch-llm.ts        LLM call wrapper with timeout/retry
        → orch-tool-exec.ts  individual tool dispatch + permissions
```

## Source file inventory

```
CORE LOOP (6,077 LOC)
  orchestrator.ts              2,085   main while loop + pre-LLM + injections
  orchestrator-response.ts     1,914   tool execution, final response, recovery
  orchestrator-tool-execution.ts 1,668 individual tool dispatch + validation
  orchestrator-state.ts          292   state init, allowlist/denylist helpers
  orchestrator-llm.ts            118   LLM call with timeout

ENGINE + SESSION (1,848 LOC)
  engine-sdk.ts                1,152   SDK wrapper, tool schema filtering
  session.ts                     696   session creation, reuse, disposal

TOOL PROFILES (497 LOC)
  tool-profiles.ts               497   5-layer stack, intersection, caching

CONTEXT + MEMORY (997 LOC)
  context.ts                     790   ContextManager, compaction, trimming
  grounding.ts                   207   post-response grounding verification

BROWSER RECOVERY (201 LOC)
  playwright/recovery-policy.ts  144   headless → headed promotion decisions
  playwright/failure-enrichment.ts 57  actionability classification

DELEGATION (125 LOC)
  delegation-heuristics.ts       125   browser vs general, fan-out detection
                               ─────
  TOTAL                        9,745 LOC
```
