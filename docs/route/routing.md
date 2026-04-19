# Routing Guide

> Status: current production routing as of 2026-04-19.
>
> Audience: the next agent dropped into the repo cold.

## 1. Mental model

```text
routing chooses boundaries
agent loop chooses strategy
```

Routing decides, once per turn:

- which model runs
- which model tier it belongs to
- what tool surface it starts with

Routing does **not** decide plan vs delegate vs browse vs search — the main
agent loop does that from the allowed tools.

## 2. Runtime SSOT

The live tool-surface state is the **5-layer `toolProfileState`** in
[`../../src/hlvm/agent/tool-profiles.ts`](../../src/hlvm/agent/tool-profiles.ts):

```text
toolProfileState.layers
    baseline    persistent seed + cross-turn discovered deferred tools
    domain      runtime browser recovery widening (browser_hybrid)
    plan        plan-mode shaping
    discovery   current-turn tool_search narrowing   (turn-local)
    runtime     current-turn adaptive phase shaping  (turn-local)
```

Effective filter = intersection across all layers, cached by `_generation`.
Persistent filter = baseline ∪ domain ∪ plan only.

## 3. Current production flow

```text
USER REQUEST
    │
    ▼
agent-runner.runAgentQuery()
    │
    ├─ @auto? → resolveAutoModel() (may call classifyTask for tie-break)
    ├─ createAgentSession() OR reuseSession()
    │     └─ writes baseline from tier filter (session lifetime)
    ├─ session.resetToolFilter()
    │     ├─ re-canonicalizes baseline = tier filter ∪ discoveredDeferredTools
    │     │  (strips any browser_hybrid cu_* widening from prior turn)
    │     └─ clears domain + discovery + runtime layers
    ├─ emits routing_decision trace event (inline — no DTO)
    │
    └─ runReActLoop(config)
          ├─ clearTurnScopedLayersForRun(config)  safety net for non-runner callers
          └─ each iteration:
                ├─ classifyRequestPhase(...)   cached once per turn in local-llm.ts
                │                              fallback: deterministic lexical phase
                ├─ applyAdaptiveToolPhase(...) → runtime layer
                ├─ tool_search narrowing       → discovery layer
                ├─ browser recovery            → domain layer (via widenBaselineForDomainProfile)
                └─ provider error → createFallbackLLM → computeFallbackToolFilter
```

Non-runner callers (`createAgent` / `agent.fork` / `run-agent.ts` / tests) use
`cloneConfigWithFreshToolProfile` in `agent.ts` for per-run isolation, then
reach the orchestrator's `clearTurnScopedLayersForRun` safety net.

## 4. `computeFallbackToolFilter` — fallback tool surface contract

Exported helper in `agent-runner.ts`. The **only** path that builds a fallback
LLM's tool surface. Rules:

- **Implicit fallback uses the fallback tier floor.** When the user did not
  supply an allowlist, fallback uses its own tier eager core — NOT the
  primary's baseline.
- **Explicit allowlist is preserved.** User-provided allowlists are kept and
  discoveries merged on top; no intersection back to the fallback tier.
- **In-turn discoveries merge on top.** `session.discoveredDeferredTools` from
  `tool_search` promotions survive the fallback.
- **Domain-layer additions (browser-hybrid `cu_*`) are NOT inherited.**
- **User-explicit empty allowlist (`[]`) stays empty.**
- **Denylist is threaded through unchanged.**

Six unit tests in
[`tests/unit/agent/routing.test.ts`](../../tests/unit/agent/routing.test.ts).

## 5. Concrete file map

- `src/hlvm/agent/tool-profiles.ts` — runtime SSOT: layers, intersection,
  cache, canonical baseline helpers, browser profile declarations,
  `widenBaselineForDomainProfile`.
- `src/hlvm/agent/agent-runner.ts` — `runAgentQuery()` entrypoint, inline
  routing trace emission, `computeFallbackToolFilter`,
  `updateSessionBaselineAllowlist` (merges discovered tools into baseline),
  `persistDeferredToolDiscoveriesForSession`.
- `src/hlvm/agent/session.ts` — `createAgentSession()` writes initial
  baseline; `resetToolFilter()` re-canonicalizes baseline from the session's
  tier filter + `discoveredDeferredTools` (needed to strip transient
  `widenBaselineForDomainProfile` cu_* additions across turns) and clears
  domain + discovery + runtime layers.
- `src/hlvm/agent/orchestrator.ts` — `clearTurnScopedLayersForRun(config)`
  safety net at loop start, `applyAdaptiveToolPhase()` in-loop phase
  filtering, browser iteration budget.
- `src/hlvm/runtime/local-llm.ts` — request-phase classification
  (`classifyRequestPhase`) for adaptive phase shaping, plus auto-routing and
  other local classification helpers.
- `src/hlvm/agent/orchestrator-response.ts` — `tool_search` narrowing,
  discovery persistence, browser hybrid promotion.
- `src/hlvm/agent/query-tool-routing.ts` — REPL-main-thread baseline helpers.
- `src/hlvm/agent/auto-select.ts` — `@auto` model selection (may use
  `classifyTask` when multiple eligible models remain).
- `src/hlvm/agent/constants.ts` — `ModelCapabilityClass` (`chat` | `tool` |
  `agent`), `TOOL_CLASS_STARTER_TOOLS` / `AGENT_CLASS_STARTER_TOOLS`,
  `starterPolicy`, `REPL_MAIN_THREAD_EAGER_TOOLS` (REPL-only wide core).

## 6. Capability-class model

```text
agent   lean ~18-tool starter + tool_search (autonomous loops, full prompt)
tool    lean ~17-tool starter, NO tool_search (one-shot use, loop-narrowed)
chat    no tool schema (direct chat only)
```

`classifyModelCapability(modelInfo, model)` decides this from capability
data (`capabilities.includes("tools")`), provider prefix (cloud frontier
→ agent), curated local allowlist (qwen3, llama3.1/2/3 ≥8B, deepseek,
mistral, mixtral, command-r, yi ≥9B), and size gates (<3B → chat,
<8K context → chat). Unknown models default to `tool` (safe).

Browser entry tools (`pw_*`, `ch_*`) are **deferred** for agent mode —
the model discovers them via `tool_search`. REPL main-thread keeps a
wider eager core (`REPL_MAIN_THREAD_EAGER_TOOLS`) so REPL users can
type tool names directly.

See `docs/route/capability-classes.md` for full rationale and evidence.

## 7. Guardrails

Do **not** reintroduce:

- request-time `taskDomain` / `needsPlan` / `shouldDelegate` / semantic
  browser detection
- a `TurnRouting` DTO built once per turn for trace-only consumption
- multiple writers of the `baseline` layer at turn start
- extra admission-time LLM calls on the explicit model path

`@auto` may use `classifyTask` **only** to pick the model; after that it
flows through the same boundary as explicit selection. Do not delete the
layered tool-profile system — runtime discovery, plan mode, adaptive phase
shaping, and browser recovery all use it. `applyAdaptiveToolPhase()` may use
the cached `classifyRequestPhase()` local-model hint inside the loop; keep that
as a single entrypoint, not parallel ad-hoc heuristics.

## 8. Verification

Routing-domain unit suite (pure logic, no Ollama):

```bash
deno test --allow-all --no-check \
  tests/unit/agent/routing.test.ts \
  tests/unit/agent/phase-filtering.test.ts \
  tests/unit/agent/local-llm.test.ts \
  tests/unit/agent/tool-profiles.test.ts \
  tests/unit/agent/query-tool-routing.test.ts \
  tests/unit/agent/auto-select.test.ts
```

Expanded suite (runtime composition + orchestrator):

```bash
deno test --allow-all --no-check \
  tests/unit/agent/agent-runtime-composition.test.ts \
  tests/unit/agent/agent-runner-engine.test.ts \
  tests/unit/agent/orchestrator.test.ts \
  tests/unit/agent/routing.test.ts \
  tests/unit/agent/phase-filtering.test.ts \
  tests/unit/agent/local-llm.test.ts \
  tests/unit/agent/tool-profiles.test.ts \
  tests/unit/agent/query-tool-routing.test.ts \
  tests/unit/agent/auto-select.test.ts
```

User-path e2e (HLVM manages its own runtime — no `curl`, no env hacks, see
AGENTS.md "Testing — user path only"):

```bash
deno run -A src/hlvm/cli/cli.ts ask -p "Reply with just: ok"
deno run -A src/hlvm/cli/cli.ts ask -p --model auto "what is 7 times 8"
deno run -A src/hlvm/cli/cli.ts ask -p "list files in src/hlvm/agent and say done"
```

Also: `deno task ssot:check` (expect 0 errors).

## 9. Known debt

- **`classifyRequestPhase` fallback is still lexical.** The primary path is the
  cached local-model classifier in `local-llm.ts`, but failure/disabled cases
  fall back to a deterministic lexical phase guess. If telemetry shows bad
  first-turn phase picks, tune `classifyRequestPhase()` or its fallback there;
  do not add parallel request-intent logic back to `orchestrator.ts`.

## 10. One-line summary

Routing is: **pick the model, set the initial tool surface, hand off to the
loop.** The runtime SSOT is `toolProfileState`. There is no separate routing
DTO.
