# Routing SSOT & Handoff

> Status: current production routing architecture as of 2026-04-17
> (post-review).
>
> Audience: the next agent who needs to modify routing without prior context.
>
> Scope: request-time routing only. `@auto` model selection internals live in
> [auto.md](./auto.md). CLI/TUI startup issues are not routing, but the known
> adjacent findings are recorded here because they affected end-to-end
> validation.
>
> **2026-04-17 review summary.** A routing review was performed. The
> architectural direction in §1 is sound. Three real bugs inside that
> architecture were fixed (§1.5.1). One honesty correction was recorded
> (§1.5.0): the `TurnRouting` object is currently a **telemetry DTO**, not
> an authoritative SSOT — nothing reads `config.turnRouting`. The real
> tool-surface boundary at runtime is the layered `toolProfileState` plus
> flat `OrchestratorConfig` fields. Debt list is §1.5.3.

## 1. Executive Summary

Routing is now intentionally small.

- Routing decides:
  - which model runs
  - where that model came from (`explicit` or `auto`)
  - which tier that model belongs to
  - what tool surface is visible at turn start
- Routing does **not** decide:
  - browser vs code vs data
  - whether to plan
  - whether to delegate
  - whether to search
  - whether to answer directly

That strategy now belongs to the **main agent loop**.

The core design rule is:

```text
system decides boundaries
model decides strategy
```

## 1.5 Post-Review State (2026-04-17)

### 1.5.0 What the code actually does (honest picture)

The architecture narrative in §1 describes intent. The current code
implements it partially:

```text
USER REQUEST
    │
    ▼
agent-runner.runAgentQuery()
    │
    ├─ @auto? → resolveAutoModel() (may call classifyTask for tie-break)
    ├─ createAgentSession() → classifyModelTier → baseToolAllowlist
    ├─ resetSessionRoutingToolProfile(session)
    │     └─ writes baseline layer, clears domain layer
    ├─ buildTurnRouting(...) → TurnRouting DTO
    │     └─ ✗ config.turnRouting is NEVER read by any consumer
    │     └─ ✓ consumed once to emit routing_decision trace
    │
    └─ runReActLoop(config)
          │
          ├─ applyRequestToolSurface(config)
          │     └─ writes baseline layer AGAIN, clears domain AGAIN
          │        (safety net for non-runner callers: agent.ts, run-agent.ts,
          │         test harness)
          │
          └─ each iteration:
                ├─ applyAdaptiveToolPhase(state, config, userRequest)
                │     ├─ regex-classifies user query (still) — but cached now
                │     └─ writes runtime layer
                ├─ LLM call
                ├─ tool execution
                └─ on fallback error:
                      └─ createFallbackLLM(fbModel)
                            └─ computeFallbackToolFilter({...})
                               (tier floor ∪ session.discoveredDeferredTools)
```

Four separate code paths write the `baseline` layer at turn start:
`session.ts` (tier filter bake-in), `resetSessionRoutingToolProfile`,
`applyRequestToolSurface`, and (conceptually) the `toolSurface` that
`buildTurnRouting` computes but nothing reads. All four converge to the
same value, so no correctness bug — but it is why §1.5.3 calls the real
SSOT surface ambiguous.

### 1.5.1 Fixes applied 2026-04-17

| # | Fix                                        | Files                                              | Why                                                                                                                                                                                                     |
| - | ------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | Phase heuristics cached once per turn      | `orchestrator.ts`, `orchestrator-state.ts`         | `requestImpliesEditing` / `requestImpliesVerification` were re-running on the unchanging user query on every loop iteration. Now lazy-cached on `LoopState.requestHeuristics`; same result, run once.   |
| 2 | Dead code removed                          | `orchestrator.ts`                                  | `READ_TOOLS` Set + `hasRead` var + `if (hasRead && impliesEditing) return "editing"` branch were all subsumed by the next `if (impliesEditing) return "editing"` check. No behavior change.             |
| 3 | `createFallbackLLM` preserves discoveries  | `agent-runner.ts`                                  | Fallback was using the user's **original** allowlist only, silently dropping deferred tools discovered mid-turn via `tool_search`. Extracted to tested helper `computeFallbackToolFilter` (see §1.5.2). |

### 1.5.2 `computeFallbackToolFilter` — the fallback tool-filter contract

Exported helper in
[`../../src/hlvm/agent/agent-runner.ts`](../../src/hlvm/agent/agent-runner.ts).
The **only** path that builds a fallback LLM's tool surface. Contract:

- **Tier cap is authoritative.** Fallback uses its own tier eager core —
  NOT the primary's (potentially higher) baseline.
- **In-turn discoveries merge on top.** `session.discoveredDeferredTools`
  from `tool_search` promotions is preserved across fallback so the
  fallback can finish a task the primary began.
- **Domain-layer additions (browser-hybrid `cu_*`) are NOT inherited.**
  They encode primary-tier assumptions and a lower-tier fallback should
  not get them.
- **User-explicit empty allowlist (`[]`) stays empty.** Discoveries are
  NOT injected — user said "no tools".
- **Denylist is threaded through unchanged.**

Six unit tests pin every invariant in `tests/unit/agent/routing.test.ts`.

### 1.5.3 Known debt — intentionally NOT fixed in this pass

Deferred because each is larger scope than a bug-fix pass and touches
docs other agents are actively editing:

- **`TurnRouting` is a telemetry DTO, not an SSOT.** The P0 finding from
  the review. Options: (a) make it authoritative by wiring
  `runReActLoop` to consume `config.turnRouting.toolSurface` directly
  and deleting `applyRequestToolSurface` + `baselineToolAllowlistSeed`;
  or (b) delete `routing.ts`, `TurnRouting`, `buildTurnRouting` entirely
  and compute the trace fields at emission time. Do **not** keep both.
- **Three owners of the baseline layer seed**
  (`session.ts` tier bake-in, `resetSessionRoutingToolProfile`,
  `applyRequestToolSurface`). Idempotent but duplicative.
- **`applyAdaptiveToolPhase` still regex-classifies the user query.** Fix
  1 only cached the result per turn; the regexes themselves remain. The
  rest of the codebase migrated to LLM classification — routing should too.
- **`modelSource` (`"explicit" | "auto"`) is a label with no downstream
  branch.** Pure observability.
- **`buildToolSurface()` runs `getDeferredToolNames()` every turn** to
  produce a `deferredTools` list that only feeds a trace count.

### 1.5.4 Verification status (2026-04-17)

Routing-domain unit tests — **all passing, no Ollama dependency**:

| Suite                                  | Tests |
| -------------------------------------- | ----- |
| `tests/unit/agent/routing.test.ts`     | 11 (4 original + 1 phase cache + 6 fallback helper) |
| `tests/unit/agent/phase-filtering.test.ts` | 10 (existing, unbroken) |
| `tests/unit/agent/auto-select.test.ts` | 74 |
| `tests/unit/agent/tool-profiles.test.ts` | 14 |
| `tests/unit/agent/query-tool-routing.test.ts` | 2 |
| **Total**                              | **111 / 111** |

User-path e2e via `hlvm ask` (via `deno run -A src/hlvm/cli/cli.ts ask …`)
— **all passing, no backdoor**:

- Baseline answer (`"Reply with just: ok"` → `ok`)
- Tool use + multi-iteration (`"list files in ~/Downloads and say done"`)
- `--model auto` path
- Cache-trigger editing query (`fix …`)
- Cache-trigger verification query (`check …`)
- JSON-output simple answers

Out-of-domain e2e failures observed on 2026-04-17 (NOT caused by this
review's changes):

- `tests/e2e/agent-runtime-shell.test.ts` hybrid promotion cases — caused
  by the concurrent commit
  `a26a06fa nuke(agent): remove entire legacy delegation and team system`.
- `tests/e2e/local-llm-classification-e2e.test.ts` `classifyBrowserAutomation`
  — LLM semantic judgment flake in `src/hlvm/runtime/local-llm.ts`; not
  routing code.

### 1.5.5 Testing rule — user path only (added 2026-04-17)

**Never bypass the HLVM-managed runtime when testing routing.**

Forbidden:

- Invoking Ollama binaries directly
  (`~/.hlvm/.runtime/engine/ollama serve`)
- `curl` probes to `localhost:11439` or `localhost:11434`
- Setting `HLVM_DISABLE_AI_AUTOSTART=1` to suppress managed autostart
- Side-starting a parallel Ollama on HLVM's port

Allowed:

- `hlvm ask`, `hlvm repl`, other user-visible CLI commands
- `deno run -A src/hlvm/cli/cli.ts <cmd>` (CLI-source path for pre-rebuild
  changes)
- E2E tests that drive those same CLI entry points

If the managed runtime is down, `hlvm ask` will bootstrap it. If bootstrap
fails, fix the managed path — do not side-start Ollama. See `AGENTS.md` §
"Testing — user path only" for the canonical rule.

## 2. What Was Achieved

The routing rewrite is complete inside the routing domain.

- Added a single SSOT routing module:
  - [`../../src/hlvm/agent/routing.ts`](../../src/hlvm/agent/routing.ts)
- Rewired production execution to use it:
  - [`../../src/hlvm/agent/agent-runner.ts`](../../src/hlvm/agent/agent-runner.ts)
  - [`../../src/hlvm/agent/orchestrator.ts`](../../src/hlvm/agent/orchestrator.ts)
- Removed the old request-routing layer from production and from disk:
  - `src/hlvm/agent/request-routing.ts` is gone
  - `tests/unit/agent/request-routing.test.ts` is gone
- Removed semantic pre-routing outputs from the live routing contract:
  - `taskDomain`
  - `needsPlan`
  - `behavior`
  - `routingResult`
  - `classifyAll()`
- Explicit model selection no longer spends a helper LLM call on routing.
- `@auto` now picks a model first, then uses the same routing boundary as any
  explicit model.
- Tool enforcement was fixed so explicit empty allowlists remain truly
  restrictive.
- Browser-heavy tasks now get a larger loop budget **reactively when browser
  tools are actually used**, instead of predictively from semantic task
  classification.

## 3. Full Journey

### Phase 0: Original problem

The old routing model tried to predict execution strategy before the main model
ran.

The user request would be semantically classified up front, and the routing
layer would decide things like:

- task domain
- whether planning was needed
- whether behavior should be "assisted" vs "self_directed"
- how tool profiles should widen before the real loop started

That created two problems:

1. It spent an extra LLM call before the main agent even got to think.
2. It forced the system to guess execution strategy from a thinner context than
   the real agent loop has.

### Phase 1: Research conclusion

After reviewing the docs and code, the key conclusion was:

```text
The first main LLM call inside the agent loop is already the real strategy
decision point.
```

That means:

- if the model wants to browse, it can choose browser tools
- if the model wants to delegate, it can call the agent tool
- if the model wants to plan, it can use `todo_write`
- if the model wants to answer directly, it can just answer

So the routing layer should stop earlier.

### Phase 2: Target architecture decision

The chosen target was:

- keep deterministic model selection and model tiering
- keep deterministic tool-surface shaping
- delete semantic task pre-routing from request-time routing
- let the main loop decide strategy

This was especially important because HLVM supports weaker models too. Weak
models should be supported by:

- tier-aware prompt depth
- tier-aware tool surface
- discovery availability
- runtime recovery / compensation inside the loop

They should **not** be supported by a separate semantic helper router deciding
the task for them ahead of time.

### Phase 3: Implementation

The rewrite happened in four parts.

#### 3.1 New routing contract

`routing.ts` was introduced as the new SSOT. It only produces:

```ts
{
  selectedModel,
  modelSource,
  modelTier,
  toolSurface,
  reason,
}
```

#### 3.2 Production call path swap

`agent-runner.ts` now builds a `TurnRouting` object for each turn from:

- selected model
- model source (`explicit` or `auto`)
- session tier
- current effective tool filter
- discovered deferred tools

#### 3.3 Orchestrator cleanup

`orchestrator.ts` was updated so request-time routing no longer owns semantic
task profiles.

The key behavioral changes are:

- request-time routing no longer populates semantic domain routing
- browser iteration boost is now reactive, not predictive
- `tool_search` discovery/narrowing happens inside the loop

#### 3.4 Legacy removal

The old request-routing module and test were removed. The live routing path no
longer uses:

- `request-routing.ts`
- `computeRoutingResult()`
- `classifyAll()`
- `taskDomain`
- `needsPlan`
- `self_directed` / `assisted`

### Phase 4: Validation

Routing-specific validation was completed during the rewrite.

The targeted routing matrix passed:

```text
236 passed, 0 failed
```

That matrix covered:

- routing core
- query-tool routing
- tool-profile enforcement
- registry allowlist behavior
- orchestrator routing behavior
- runner routing behavior
- local-llm cleanup around removed routing usage
- auto-select integration

The routing rewrite itself is done.

## 4. Before vs After

### 4.1 Before: semantic pre-routing model

This is the old mental model we intentionally moved away from:

```text
USER REQUEST
   |
   v
helper semantic routing pass
(classifyAll / request routing)
   |
   +--> taskDomain = browser / code / data / general
   +--> needsPlan = true / false
   +--> behavior = assisted / self_directed
   |
   v
pre-shape tool profile from predicted strategy
   |
   v
MAIN AGENT LOOP
```

Why this was weak:

- extra LLM call before the real loop
- duplicated reasoning about task strategy
- routing guessed behavior that the real model should decide itself

### 4.2 Important historical nuance

Immediately before the rewrite, the system was already partially split:

- stronger models were already closer to self-routing
- weaker paths still depended more on semantic pre-routing

So the rewrite was not inventing a brand-new philosophy. It made the whole
system consistently follow the cleaner model.

### 4.3 After: current production routing model

```text
USER REQUEST
   |
   +--> explicit model --------------------------------------+
   |                                                         |
   +--> @auto -> resolveAutoModel() -------------------------+
                                                           selected model
                                                                 |
                                                                 v
                                                        classifyModelTier()
                                                                 |
                                                                 v
                                               resolve current effective tool filter
                                                                 |
                                                                 v
                                                        buildTurnRouting()
                     { selectedModel, modelSource, modelTier, toolSurface, reason }
                                                                 |
                                                                 v
                                                          MAIN AGENT LOOP
                          main model decides answer / plan / search / browse /
                          delegate / edit / tool_search / clarification
```

### 4.4 The main principle in one picture

```text
OLD
----
routing decided both:
  1. boundaries
  2. strategy

NEW
----
routing decides:
  1. boundaries

agent loop decides:
  2. strategy
```

## 5. Current Production Flow

### 5.1 Explicit model path

```text
USER REQUEST
   |
   v
explicit model already chosen by user
   |
   v
classifyModelTier()
   |
   v
buildTurnRouting()
   |
   v
main agent loop
```

There is **no request-time semantic routing LLM call** here.

### 5.2 `@auto` path

```text
USER REQUEST
   |
   v
resolveAutoModel()
   |
   +--> deterministic provider/model filtering
   |
   +--> if 0 or 1 eligible model:
   |        choose deterministically
   |        no classifyTask()
   |
   +--> if multiple eligible models remain:
            classifyTask()
            score/rank candidates
   |
   v
selected model
   |
   v
classifyModelTier()
   |
   v
buildTurnRouting()
   |
   v
main agent loop
```

This distinction matters:

- `classifyTask()` is still allowed inside **auto model selection**
- it is **not** a general request-time routing strategy pass
- its job is model choice, not plan/delegate/browser decisions

## 6. The SSOT Routing Contract

Current contract from [`../../src/hlvm/agent/routing.ts`](../../src/hlvm/agent/routing.ts):

```ts
type TurnModelSource = "explicit" | "auto";
type ToolDiscoveryMode = "tool_search" | "none";

interface ToolSurface {
  eagerTools: string[];
  deferredTools: string[];
  deniedTools: string[];
  discovery: ToolDiscoveryMode;
}

interface TurnRouting {
  selectedModel: string;
  modelSource: TurnModelSource;
  modelTier: ModelTier;
  toolSurface: ToolSurface;
  reason: string;
}
```

The contract intentionally does **not** contain:

```ts
{
  taskDomain: ...,
  needsPlan: ...,
  shouldDelegate: ...,
  behavior: ...,
}
```

If those fields come back, that is a routing regression.

## 7. Tool Surface Model

### 7.1 Tier view

```text
selected model
   |
   v
classifyModelTier()
   |
   v
tool surface
   |
   +--> enhanced
   |      eager bounded core
   |      deferred discovery via tool_search
   |
   +--> standard
   |      eager bounded core
   |      deferred discovery via tool_search
   |
   +--> constrained
          small fixed core
          no deferred discovery
```

### 7.2 Practical meaning by tier

- `enhanced`
  - largest capability budget
  - still bounded eager surface
  - discovery allowed through `tool_search`
- `standard`
  - same routing boundary as enhanced
  - smaller capability budget
  - discovery allowed through `tool_search`
- `constrained`
  - hard-capped surface
  - no deferred discovery
  - no `tool_search`

### 7.3 Important browser detail

Browser tools are eager for standard/enhanced tiers. That means browser tasks
do **not** require semantic pre-routing just to expose Playwright/Chrome entry
tools.

Discovery still matters for more specialized deferred tools, but plain browser
entry is not blocked behind semantic routing.

## 8. Tool-Profile Layers and Ownership

The tool profile system still exists. Routing no longer owns all of it.

### 8.1 Layer model

```text
tool profile state
   |
   +--> baseline   = routing seed + persistent discovered deferred tools
   +--> domain     = runtime/browser recovery widening when needed
   +--> plan       = plan-mode shaping
   +--> discovery  = current turn tool_search narrowing
   +--> runtime    = adaptive phase narrowing
```

### 8.2 Ownership rules

- `baseline`
  - seeded from routing
  - can absorb discovered deferred tools across turns
- `domain`
  - **not** request-time routing anymore
  - still used by runtime browser recovery when the loop promotes from
    `browser_safe` to `browser_hybrid`
- `plan`
  - owned by planning/runtime behavior
- `discovery`
  - owned by `tool_search`
- `runtime`
  - owned by adaptive in-loop phase filtering

### 8.3 Why this matters

Do **not** confuse:

- "request-time routing no longer sets semantic domain profiles"

with:

- "the `domain` tool-profile slot should be deleted"

That would be wrong. The `domain` slot still has a runtime use for browser
recovery escalation.

## 9. Dynamic Behavior Inside the Loop

Routing stops at turn start. The loop still adapts.

### 9.1 Browser iteration budget

Old idea:

```text
predict browser task early
-> raise max iterations early
```

Current idea:

```text
if the loop actually emits browser tool calls
-> raise max iterations reactively
```

That is implemented in the orchestrator.

### 9.2 `tool_search` behavior

`tool_search` does two things:

1. it can narrow the **current turn** runtime tool context
2. it can promote discovered deferred tools into the persistent baseline for
   later turns

So there are two related but distinct effects:

```text
turn-local narrowing
and
session-persistent discovery
```

### 9.3 Planning and delegation

Routing does not decide them.

The loop can still:

- create todos
- draft a plan
- ask for approval
- delegate to a child agent

Those are loop behaviors, not routing outputs.

## 10. Concrete File Map

### 10.1 Core routing

- [`../../src/hlvm/agent/routing.ts`](../../src/hlvm/agent/routing.ts)
  - SSOT `TurnRouting` and `ToolSurface`
  - `buildToolSurface()`
  - `buildTurnRouting()`

### 10.2 Runner integration

- [`../../src/hlvm/agent/agent-runner.ts`](../../src/hlvm/agent/agent-runner.ts)
  - resolves effective session tool filter
  - builds per-turn routing
  - emits `routing_decision` trace
  - **`computeFallbackToolFilter(options)`** (exported) — the fallback
    LLM tool surface: tier floor ∪ `session.discoveredDeferredTools`;
    used inside `createFallbackLLM` closure. See §1.5.2.

### 10.3 Orchestrator integration

- [`../../src/hlvm/agent/orchestrator.ts`](../../src/hlvm/agent/orchestrator.ts)
  - clears request-time semantic domain routing
  - reactively expands browser iteration budget

- [`../../src/hlvm/agent/orchestrator-response.ts`](../../src/hlvm/agent/orchestrator-response.ts)
  - applies `tool_search` narrowing
  - persists discovered deferred tools into baseline
  - runtime browser recovery may widen the `domain` layer to hybrid

### 10.4 Supporting tool-filter logic

- [`../../src/hlvm/agent/tool-profiles.ts`](../../src/hlvm/agent/tool-profiles.ts)
  - layered tool-profile state
  - canonical baseline allowlist
  - browser tool profile declarations

- [`../../src/hlvm/agent/query-tool-routing.ts`](../../src/hlvm/agent/query-tool-routing.ts)
  - query-source baseline allowlist helpers

- [`../../src/hlvm/agent/constants.ts`](../../src/hlvm/agent/constants.ts)
  - model tiering
  - tier eager-tool sets

### 10.5 Auto selection boundary

- [`../../src/hlvm/agent/auto-select.ts`](../../src/hlvm/agent/auto-select.ts)
  - picks a model for `@auto`
  - may use `classifyTask()` only when multiple eligible models remain

### 10.6 Tests (routing domain)

- `tests/unit/agent/routing.test.ts` — `buildTurnRouting` + phase cache +
  `computeFallbackToolFilter` contract (11 tests)
- `tests/unit/agent/phase-filtering.test.ts` — `applyAdaptiveToolPhase`
  behavior (10 tests)
- `tests/unit/agent/tool-profiles.test.ts` — layered tool-profile
  semantics (14 tests)
- `tests/unit/agent/query-tool-routing.test.ts` — REPL baseline allowlist
  helpers (2 tests)
- `tests/unit/agent/auto-select.test.ts` — auto-select scoring +
  fallback chain (74 tests)

## 11. What Was Removed from Routing

Removed from live request-time routing:

- `classifyAll()`
- `computeRoutingResult()`
- `routingResult`
- `taskDomain`
- `needsPlan`
- `behavior`

Removed from disk:

- `src/hlvm/agent/request-routing.ts`
- `tests/unit/agent/request-routing.test.ts`

## 12. Validation Record

### 12.1 Routing-domain validation completed

Validated during the rewrite:

- `routing.ts` unit tests
- runner trace assertions
- orchestrator tool-surface behavior
- allowlist/denylist enforcement
- auto-select integration

Key proof points:

- explicit model path no longer emits semantic routing metadata
- `@auto` emits `modelSource: "auto"` and the same lean routing fields
- `routing_decision` trace has no `taskDomain`
- `routing_decision` trace has no `needsPlan`
- discovery mode is visible as `tool_search` vs `none`

### 12.2 User-path validation findings

Routing-domain validation is complete, but two adjacent findings matter for the
next agent:

#### A. Old CLI eager import coupling still exists

`hlvm ask` still shares a CLI entrypoint that eagerly imports all commands.
That means:

```text
hlvm ask
  -> cli.ts
  -> ai.ts
  -> repl-ink/model-browser.tsx
  -> ink
```

This is not a routing issue, but it is an architectural smell discovered during
end-to-end investigation.

#### B. Current browser-safe E2E blocker is early host termination, not routing

On the latest reproduced run, the browser-safe real-path E2E did:

```text
pw_goto -> pw_snapshot -> process ended before completion
```

The runtime diagnostics showed:

```text
ended_before_tool_end=true
ended_before_complete=true
```

That is outside request-time routing. It is recorded here so the next agent does
not waste time blaming the routing rewrite for that failure.

## 13. Guardrails for Future Changes

If you change routing again, preserve these invariants:

### 13.1 Do not reintroduce semantic request pre-routing

Do not add back:

- request-time `taskDomain`
- request-time `needsPlan`
- request-time `shouldDelegate`
- request-time semantic browser detection

### 13.2 Keep explicit model path deterministic

If the user chose the model, do not spend an extra semantic routing LLM call to
second-guess that choice.

### 13.3 Keep `@auto` narrow

`@auto` may use semantic classification only to choose the model. After that, it
must hand off to the same routing boundary as explicit selection.

### 13.4 Do not delete the whole tool-profile system

The routing rewrite removed semantic pre-routing, not the layered tool-profile
mechanism. Runtime discovery, plan mode, adaptive phase shaping, and browser
recovery still use those layers.

## 14. If Another Agent Takes Over

### 14.1 Read in this order

1. [`../../AGENTS.md`](../../AGENTS.md) — the canonical project guidelines;
   the **Testing — user path only** section is load-bearing for anyone
   touching routing or the runtime.
2. `§1.5` of this doc — honest current state, the 2026-04-17 fixes, and
   the known debt.
3. [`../../src/hlvm/agent/routing.ts`](../../src/hlvm/agent/routing.ts)
   (91 lines — small on purpose).
4. [`../../src/hlvm/agent/agent-runner.ts`](../../src/hlvm/agent/agent-runner.ts)
   (specifically `buildTurnRoutingForSession`, `createFallbackLLM`,
   `computeFallbackToolFilter`, `resetSessionRoutingToolProfile`).
5. [`../../src/hlvm/agent/orchestrator.ts`](../../src/hlvm/agent/orchestrator.ts)
   (`applyRequestToolSurface`, `applyAdaptiveToolPhase`,
   `maybeActivateBrowserIterationBudget`,
   `resolveRequestHeuristics`).
6. [`../../src/hlvm/agent/orchestrator-response.ts`](../../src/hlvm/agent/orchestrator-response.ts)
   (browser hybrid promotion; `tool_search` narrowing).
7. [`../../src/hlvm/agent/tool-profiles.ts`](../../src/hlvm/agent/tool-profiles.ts)
   (the actual runtime SSOT for tool surface — see §1.5.0).
8. [auto.md](./auto.md) and [model-tiers.md](./model-tiers.md).

### 14.2 Verify these first (no backdoor needed)

Unit tests — pure logic, no Ollama, instant:

```bash
deno test --allow-all --no-check \
  tests/unit/agent/routing.test.ts \
  tests/unit/agent/phase-filtering.test.ts \
  tests/unit/agent/tool-profiles.test.ts \
  tests/unit/agent/query-tool-routing.test.ts \
  tests/unit/agent/auto-select.test.ts
```

Expected: **111 / 111 pass**.

User-path e2e (HLVM manages its own runtime; no env hacks):

```bash
deno run -A src/hlvm/cli/cli.ts ask -p "Reply with just: ok"
deno run -A src/hlvm/cli/cli.ts ask -p "list files in ~/Downloads and say done"
deno run -A src/hlvm/cli/cli.ts ask -p --model auto "what is 7 times 8"
```

If any of those hang, fix the managed-runtime path. **Do not** side-start
an Ollama instance, `curl` the endpoints, or set
`HLVM_DISABLE_AI_AUTOSTART=1` to work around it.

### 14.3 Do not reintroduce

Preserve these invariants from the original rewrite:

- No request-time `taskDomain` / `needsPlan` / `shouldDelegate` /
  semantic browser detection.
- Explicit model path must not spend a semantic routing LLM call.
- `@auto` may use `classifyTask` only to *pick* the model; after that it
  flows through the same boundary as explicit selection.
- Do not delete the whole tool-profile system — runtime discovery,
  plan mode, adaptive phase shaping, and browser recovery all use it.

### 14.4 If you want to take on the known debt (§1.5.3)

The single highest-value follow-up is collapsing the duplication around
the baseline-layer seed. Concretely, pick **one** of these:

- **(a) Make `TurnRouting` authoritative.** Have `runReActLoop` read
  `config.turnRouting.toolSurface.eagerTools` as the source of the
  baseline layer; have the runner seed `baseline` from
  `turnRouting.toolSurface` exactly once; delete
  `applyRequestToolSurface` and `baselineToolAllowlistSeed`; drop the
  duplicate tier bake-in inside `session.ts` or make it use the same
  computation. Update §1.5.0 and §10 in this doc afterwards.
- **(b) Delete `routing.ts`, `TurnRouting`, `buildTurnRouting`.** Compute
  the `routing_decision` trace-event fields at emission time directly
  from `session.modelTier` + `resolvePersistentToolFilter(session.toolProfileState)`.
  Remove §10.1 from this doc afterwards.

Do not keep both.

### 14.5 Mental model

Keep this mental model when routing-only:

```text
selected model  →  tier  →  tool surface  →  agent loop
```

Not this (what the legacy design did):

```text
query → semantic strategy classification → routing plan → agent loop
```

## 15. One-Line Summary

Routing is intentionally small: **which model runs and what tool surface it
starts with**. The agent loop decides everything strategic after that. The
`TurnRouting` DTO produced by `routing.ts` is currently **trace-only**
(see §1.5.0); the real runtime boundary is the layered `toolProfileState`.
