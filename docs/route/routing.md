# Routing

> Status: current production architecture as of 2026-04-16

## TL;DR

- Routing is now **model selection + tool-surface shaping only**.
- Routing does **not** decide browser vs code vs data.
- Routing does **not** decide planning, delegation, or task strategy.
- Explicit model selection makes **no routing LLM call**.
- `@auto` uses `resolveAutoModel()` and may use `classifyTask()` only for model
  selection tie-breaks.
- The main agent loop decides whether to:
  - answer directly
  - read/edit files
  - browse
  - search
  - plan with `todo_write`
  - delegate

## Production Flow

```text
USER REQUEST
   |
   +--> explicit model ----------------------+
   |                                         |
   +--> @auto -> resolveAutoModel() ---------+
                                             |
                                             v
                                     classifyModelTier()
                                             |
                                             v
                                     buildTurnRouting()
                         { selectedModel, modelSource, modelTier, toolSurface }
                                             |
                                             v
                                       AGENT LOOP
                           model decides browser / search /
                           plan / delegate / edit / answer
```

## Routing Boundary

Routing output is intentionally small:

```ts
{
  selectedModel: string;
  modelSource: "explicit" | "auto";
  modelTier: "enhanced" | "standard" | "constrained";
  toolSurface: {
    eagerTools: string[];
    deferredTools: string[];
    deniedTools: string[];
    discovery: "tool_search" | "none";
  };
  reason: string;
}
```

Routing does **not** output:

```ts
{
  taskDomain: ...,
  needsPlan: ...,
  shouldDelegate: ...,
  behavior: ...,
}
```

## Tool Surface by Tier

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
   |      bounded eager tools
   |      deferred discovery via tool_search
   |
   +--> standard
   |      bounded eager tools
   |      deferred discovery via tool_search
   |
   +--> constrained
          small fixed tool set
          no deferred discovery
```

### Tier intent

- `enhanced`
  - largest prompt/tool budget
  - eager tool surface stays bounded
  - deferred tools unlocked via `tool_search`
- `standard`
  - same routing model as enhanced
  - smaller capacity budget
  - deferred tools unlocked via `tool_search`
- `constrained`
  - hard-capped tool surface
  - no meta-tool discovery

## What Changed

Removed from the live routing path:

- `request-routing.ts`
- `computeRoutingResult()`
- `classifyAll()`
- `taskDomain`
- `needsPlan`
- `self_directed` vs `assisted`

The old model was:

```text
user request
   |
   v
classifyAll()
   |
   v
computeRoutingResult()
   |
   v
taskDomain / needsPlan / behavior
   |
   v
agent loop
```

That path is gone from production.

## Why This Is Cleaner

### 1. Explicit model means trust the chosen model

If the user chose the model, routing should not make another semantic LLM call
to second-guess it.

### 2. Strategy belongs in the loop

Browser use, planning, delegation, and search are agent behaviors. They are
better decided by the active model with the real prompt and active tools than by
an earlier helper classifier.

### 3. Tool discovery is a tool problem, not a routing problem

Deferred tools are handled by:

- bounded eager surfaces
- `tool_search`
- blocked-tool hints from the orchestrator

### 4. Weak-model support stays in the right place

HLVM still supports weaker models by changing:

- tier
- prompt/tool budget
- discovery availability

It does not do that by semantic pre-routing.

## Current SSOT Files

- [`/Users/seoksoonjang/dev/hql/src/hlvm/agent/routing.ts`](/Users/seoksoonjang/dev/hql/src/hlvm/agent/routing.ts)
- [`/Users/seoksoonjang/dev/hql/src/hlvm/agent/agent-runner.ts`](/Users/seoksoonjang/dev/hql/src/hlvm/agent/agent-runner.ts)
- [`/Users/seoksoonjang/dev/hql/src/hlvm/agent/orchestrator.ts`](/Users/seoksoonjang/dev/hql/src/hlvm/agent/orchestrator.ts)
- [`/Users/seoksoonjang/dev/hql/src/hlvm/agent/query-tool-routing.ts`](/Users/seoksoonjang/dev/hql/src/hlvm/agent/query-tool-routing.ts)
- [`/Users/seoksoonjang/dev/hql/src/hlvm/agent/tool-profiles.ts`](/Users/seoksoonjang/dev/hql/src/hlvm/agent/tool-profiles.ts)

## Validation Focus

Routing validation should prove:

1. explicit model path never uses semantic pre-routing
2. `@auto` resolves a model, then uses the same routing boundary
3. standard/enhanced tiers expose bounded eager tools plus deferred discovery
4. constrained tier disables discovery
5. browser/planning behavior comes from the main loop, not routing metadata
6. empty allowlists remain truly restrictive

## One-Line Summary

Routing now decides **which model runs and what tool surface it sees**.
Everything else is the job of the agent loop.
