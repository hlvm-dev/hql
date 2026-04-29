# Routing Guide

> Status: current production routing as of 2026-04-20.
>
> Audience: the next agent dropped into the repo cold.

## 1. What Changed Recently

This doc is the SSOT for the current routing system after three distinct waves
of changes:

1. The old tier routing was replaced by the capability model:
   `chat | tool | agent`, with `classifyModelCapability()` and
   `starterPolicy()` as the boundary.
2. `@auto` routing was corrected so auto model resolution happens
   **before** agent-vs-chat mode selection in `/api/chat`.
3. Runtime behavior around explicit provider selection and cold local bootstrap
   was tightened:
   - explicit cloud/provider requests now fail honestly instead of silently
     downgrading to local fallback
   - cold empty-root local bootstrap is allowed to take minutes without the
     client giving up after 60 seconds

If you are debugging live `hlvm ask` / `hlvm repl`, you need all three in your
head at the same time.

## 2. Mental Model

```text
routing has 3 boundaries

1) request boundary   choose model + execution lane
2) agent boundary     choose starter tool surface
3) runtime boundary   wait for local AI readiness when needed
```

Only the first two are "routing" in the classic sense. The third is runtime
readiness, but it is user-visible on cold local startup and must be understood
as part of the real request pipeline.

## 3. End-to-End User Path

```text
hlvm ask / hlvm repl / GUI
    │
    ▼
runtime host client (src/hlvm/runtime/host-client.ts)
    │
    ├─ ensureRuntimeHost()
    ├─ if local AI is needed, waitForRuntimeAiReady()
    │    ├─ fast phase: ~60s @ 100ms
    │    └─ slow phase: ~29 min @ 1s
    │
    ▼
/api/chat (src/hlvm/cli/repl/handlers/chat.ts)
    │
    ├─ resolveRequestedMode(body)
    ├─ resolveChatModelForRequest(...)
    │    └─ resolves "auto" to a concrete model before capability gating
    ├─ load model info / validate attachments / validate tool support
    ├─ enforce provider approval
    ├─ supportsAgentExecution(resolvedModel, resolvedModelInfo)
    │
    ├─ false ──► direct chat lane
    │            handleChatMode()
    │
    └─ true  ──► agent lane
                 handleAgentMode()
                     │
                     ▼
                 runAgentQuery()
                     │
                     ├─ classifyModelCapability()
                     ├─ starterPolicy()
                     ├─ create/reuse session baseline
                     ├─ emit routing_decision trace
                     └─ runReActLoop()
```

## 4. Request-Boundary Routing

This is the part the older doc under-described.

### 4.1 `@auto` resolution happens first

`/api/chat` now resolves `auto` via `resolveChatModelForRequest(...)` before it
asks `supportsAgentExecution(...)`.

That ordering matters because the old bug was:

```text
model = "auto"
    └─ classified as non-agent too early
       └─ request went down direct-chat lane
```

Current contract:

- `auto` must resolve to a concrete model first
- only then may the server ask whether the resolved model is agent-capable
- explicit model selection and `auto` share the same downstream gate once a
  concrete model exists
- `auto` ranks close candidates with live in-process health telemetry from real
  model calls: successful low-latency calls get a small bonus, and
  fallback-worthy failures cool down the failed model
- invalid requests, context overflow, and user cancellations do not cool down or
  penalize the selected model

Relevant files:

- `src/hlvm/cli/repl/handlers/chat.ts`
- `src/hlvm/cli/repl/handlers/chat-direct.ts`
- `src/hlvm/agent/auto-select.ts`

### 4.2 Explicit model requests fail honestly

Once the user explicitly supplies `--model ...`, HLVM must not silently replace
that model with local fallback just because discovery/auth/provider access
failed.

Current contract in `chat.ts`:

- explicit model + catalog says "not found" → `400 Model not found: ...`
- explicit model + capability discovery failed in agent mode →
  `503 Could not verify selected model capabilities...`
- explicit paid provider without consent → `403 Paid provider not approved...`
- explicit provider auth failure is surfaced as that provider/auth failure

Only non-explicit/default selection is allowed to fall back to the configured
default or local fallback when the original default is unavailable.

This is what prevents:

```text
--model claude-code/claude-haiku-4-5-20251001
    └─ silently routed to ollama/qwen3:8b
```

That behavior is no longer allowed.

### 4.3 Claude Code subprocess lane is separate from generic agent lane

If the resolved model ends with `:agent`, or request/config mode selects the
Claude Code agent suffix path, `/api/chat` dispatches to
`handleClaudeCodeAgentMode(...)` instead of the generic HLVM agent loop.

That is a lane choice, not a capability-class choice.

## 5. Agent-Boundary Routing

Once the request is in the generic HLVM agent lane, the capability-class system
is the SSOT.

```text
agent-runner.runAgentQuery()
    │
    ├─ createAgentSession() or reuse session
    │    └─ writes baseline starter filter
    ├─ session.resetToolFilter()
    │    ├─ baseline = starter filter ∪ discoveredDeferredTools
    │    └─ clears domain + discovery + runtime layers
    ├─ emit routing_decision trace
    └─ runReActLoop()
```

### 5.1 Tool-surface SSOT

The live tool-surface state is the 5-layer `toolProfileState` in
`src/hlvm/agent/tool-profiles.ts`:

```text
toolProfileState.layers
    baseline    persistent seed + cross-turn discovered deferred tools
    domain      browser recovery widening
    plan        plan-mode shaping
    discovery   current-turn tool_search narrowing
    runtime     current-turn adaptive phase shaping
```

Effective filter = intersection across all layers.

Persistent filter = baseline ∪ domain ∪ plan only.

### 5.2 Fallback tool-surface contract

`computeFallbackToolFilter()` in `src/hlvm/agent/agent-runner.ts` is the only
path that builds a fallback LLM tool surface.

Rules:

- implicit fallback uses the fallback model's capability floor
- explicit user allowlists are preserved
- discovered deferred tools survive fallback
- browser-hybrid `cu_*` widening does not persist as baseline
- explicit empty allowlist stays empty
- denylist threads through unchanged

## 6. Capability-Class Model

```text
agent   lean starter + tool_search, full autonomous loop
tool    lean starter, no tool_search
chat    no tool schema, direct chat only
```

SSOT lives in `src/hlvm/agent/constants.ts`:

- `classifyModelCapability(modelInfo, model)`
- `starterPolicy(capability, ...)`
- `supportsAgentExecution(...)`
- `REPL_MAIN_THREAD_EAGER_TOOLS`
- `parseParamBillions(...)`

Current behavior:

- cloud frontier models generally classify as `agent`
- curated local models can classify as `agent`
- weak/small/short-context models fall to `chat`
- unknown models default to `tool`
- REPL main thread gets the wider eager core; generic agent mode starts lean

See `docs/route/model-tiers.md` for the full class rationale and mapping.

## 7. Runtime-Boundary Contract

This is the main live behavior that was missing from the older doc.

### 7.1 Warm path

For a warm/shared runtime, `host-client.ts` returns quickly:

- host is already running
- `aiReady=true`
- request proceeds immediately

### 7.2 Cold empty-root path

For a clean isolated root, the runtime host may need to:

- extract or validate the embedded engine
- install/download Chromium
- materialize the managed Python runtime
- pull the pinned local fallback model
- verify and write bootstrap state

That can take minutes.

Current client contract in `src/hlvm/runtime/host-client.ts`:

- fast AI-ready poll: `600 × 100ms` (~60s)
- slow AI-ready poll: `1740 × 1000ms` (~29 min)
- both phases stop immediately on:
  - `aiReady=true`
  - `aiReadyRetryable=false`

This preserves warm-case responsiveness but does not abort a legitimate cold
bootstrap after 60 seconds.

### 7.3 Bootstrap-in-progress errors are retryable

Bootstrap-in-progress messages such as:

```text
Local HLVM runtime host is not ready for AI requests:
Verified bootstrap not found. Local AI bootstrap is being materialized.
```

now classify as transient/retryable in
`src/hlvm/agent/error-taxonomy.ts` with the AI-runtime hint instead of
rendering as opaque `unknown`.

### 7.4 Compiled binary vs source-mode

Uninitialized bootstrap is only exercised by the compiled HLVM binary path.
Source-mode `deno run ...` is the development bypass case in `serve.ts` and
must not be treated as proof that first-run compiled bootstrap works.

## 8. Recent Failure Modes That Are Now Fixed

These are important because they explain why some older logs or handoff notes
are stale.

### 8.1 Old `@auto` bug

Old behavior:

```text
"auto" classified before resolution
    └─ wrong lane chosen
       └─ direct chat / malformed downstream behavior
```

Current behavior:

```text
"auto" resolved first
    └─ capability checked on concrete model
       └─ correct lane chosen
```

### 8.2 Silent explicit-provider downgrade

Old behavior:

```text
explicit Claude model
    └─ provider/auth/discovery failure
       └─ silently replaced by local qwen3 fallback
```

Current behavior:

```text
explicit Claude model
    └─ provider/auth/discovery failure
       └─ surfaced honestly to the user
```

### 8.3 Clean-root wrong-store bootstrap

Old behavior:

```text
clean temp root
    └─ reused a "compatible" existing Ollama
       └─ model pull landed in the wrong store
          └─ later manifest mismatch
```

Current behavior:

```text
clean temp root
    └─ bootstrap only reuses an existing engine when the current store
       already has the requested fallback identity
       └─ otherwise reclaim and materialize under the requested root
```

Relevant file:

- `src/hlvm/runtime/bootstrap-materialize.ts`

## 9. Concrete File Map

- `src/hlvm/cli/repl/handlers/chat.ts` — request-boundary routing,
  explicit-model behavior, provider approval, agent-vs-chat gate.
- `src/hlvm/cli/repl/handlers/chat-direct.ts` — direct-chat model resolution,
  `auto` resolution helper, direct streaming lane.
- `src/hlvm/agent/constants.ts` — capability classes, starter policies,
  REPL eager core, parameter-size parsing.
- `src/hlvm/agent/agent-runner.ts` — generic agent entrypoint,
  `routing_decision`, fallback tool-surface contract.
- `src/hlvm/agent/tool-profiles.ts` — layered tool-surface SSOT.
- `src/hlvm/agent/orchestrator.ts` — in-loop adaptive shaping and turn-scoped
  layer clearing.
- `src/hlvm/runtime/host-client.ts` — runtime-host attach/start and AI-ready
  wait contract.
- `src/hlvm/runtime/bootstrap-materialize.ts` — local bootstrap ownership and
  materialization rules.
- `src/hlvm/agent/error-taxonomy.ts` — user-facing classification and hints
  for routing/runtime/provider failures.
- `src/hlvm/providers/claude-code/auth.ts` — Claude Code OAuth token loading
  and refresh.

## 10. Verification

Routing-domain unit suite:

```bash
deno test --allow-all --no-check \
  tests/unit/agent/routing.test.ts \
  tests/unit/agent/phase-filtering.test.ts \
  tests/unit/agent/local-llm.test.ts \
  tests/unit/agent/tool-profiles.test.ts \
  tests/unit/agent/query-tool-routing.test.ts \
  tests/unit/agent/auto-select.test.ts \
  tests/unit/repl/handlers.test.ts
```

Runtime/error focused suite:

```bash
deno test --allow-all --no-check \
  tests/unit/runtime/host-client.test.ts \
  tests/unit/agent/error-taxonomy.test.ts
```

User-path checks:

```bash
./hlvm ask --model auto -p --permission-mode dontAsk "What is 2+2?"
./hlvm ask --model claude-code/claude-haiku-4-5-20251001 -p --permission-mode dontAsk "What is 2+2?"
```

Cold compiled-binary bootstrap check:

```bash
HLVM_TEST_STATE_ROOT=/tmp/hlvm-cold-root-$(date +%s) \
HLVM_ALLOW_TEST_STATE_ROOT=1 \
HLVM_REPL_PORT=19482 \
./hlvm ask --model auto -p --permission-mode dontAsk "What is 2+2?"
```

Also run:

```bash
deno task ssot:check
```

## 11. Guardrails

Do not reintroduce:

- late `auto` resolution after mode selection
- silent explicit-model fallback to local/default models
- request-time semantic routing DTOs rebuilt for trace-only consumption
- multiple baseline writers at turn start
- ad-hoc intent heuristics outside the existing capability/tool-profile system
- a fixed 60-second AI-ready cap for cold bootstrap

`@auto` may use task classification only to select the model. After that,
explicit and auto-selected models must pass through the same request-boundary
gate.

## 12. One-Line Summary

Routing is now:

```text
resolve the real model first,
choose the execution lane honestly,
seed the right starter tool surface,
and wait through legitimate cold local bootstrap.
```
