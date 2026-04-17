# Routing SSOT & Handoff

> Status: current production routing architecture as of 2026-04-17
>
> Audience: the next agent who needs to modify routing without prior context
>
> Scope: request-time routing only. `@auto` model selection internals live in
> [auto.md](./auto.md). CLI/TUI startup issues are not routing, but the known
> adjacent findings are recorded here because they affected end-to-end
> validation.

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

Read these files in this order:

1. [`../../src/hlvm/agent/routing.ts`](../../src/hlvm/agent/routing.ts)
2. [`../../src/hlvm/agent/agent-runner.ts`](../../src/hlvm/agent/agent-runner.ts)
3. [`../../src/hlvm/agent/orchestrator.ts`](../../src/hlvm/agent/orchestrator.ts)
4. [`../../src/hlvm/agent/orchestrator-response.ts`](../../src/hlvm/agent/orchestrator-response.ts)
5. [`../../src/hlvm/agent/tool-profiles.ts`](../../src/hlvm/agent/tool-profiles.ts)
6. [auto.md](./auto.md)

Then verify these tests first:

1. `tests/unit/agent/routing.test.ts`
2. `tests/unit/agent/agent-runner-engine.test.ts`
3. `tests/unit/agent/orchestrator.test.ts`
4. `tests/unit/agent/tool-profiles.test.ts`

If the next task is routing-only, the mental model to keep is:

```text
selected model
  -> tier
  -> tool surface
  -> agent loop

not

query
  -> semantic strategy classification
  -> routing plan
  -> agent loop
```

## 15. One-Line Summary

Routing now decides **which model runs and what tool surface it starts with**.
The main agent loop decides everything strategic after that.
