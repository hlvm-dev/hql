# HLVM Auto Mode — Design Spec v1

## One Sentence

When the user sets `--model auto`, HLVM automatically picks the best available model for each turn based on simple task signals and user policy.

## What It Is

- Per-turn model selection (one model per turn, no mid-turn switching)
- Rule-based scoring with simple additive heuristics
- Transparent: reason is visible, not black-box
- Fallback on hard failure only
- Open model catalog with policy controls

## What It Is NOT

- Not LLVM-for-LLM / capability routing / execution surface
- Not mid-turn model switching or subtask routing
- Not multi-provider orchestration
- Not an IR or compiler architecture
- Not "smart" — deliberately dumb and debuggable

## Algorithm (5 steps)

```
User prompt + attachments + policy
  → 1. Build TaskProfile (obvious signals only)
  → 2. Filter impossible models (hard constraints)
  → 3. Score remaining models (simple additive)
  → 4. Pick top scorer
  → 5. Keep 1-2 fallbacks for hard failure only
```

## Core Types

```typescript
type TaskProfile = {
  hasImage: boolean;
  needsStructuredOutput: boolean;
  promptIsLarge: boolean;
  preferCheap: boolean;
  preferQuality: boolean;
  localOnly: boolean;
  noUpload: boolean;
};

type ModelCaps = {
  id: string;              // e.g. "anthropic/claude-sonnet-4-5"
  provider: string;
  vision: boolean;
  longContext: boolean;
  structuredOutput: boolean;  // reliability, not just support
  toolCalling: boolean;
  local: boolean;
  costTier: "low" | "mid" | "high";
  codingStrength: "weak" | "mid" | "strong";
};

type AutoDecision = {
  model: string;
  fallbacks: string[];     // 1-2 next-best valid models
  reason: string;          // human-readable, shown in --verbose
};
```

## Integration Points

### Where Auto Intercepts

`"auto"` is a **sentinel value**, not a normal model string.

Auto must resolve to a concrete model string **before `shouldReuseAgentSession()`**
in `runAgentQuery()` (agent-runner.ts), because the model string is consumed by two
earlier decision points before `createAgentSession()` is ever called:

**1. Session reuse matching** (`shouldReuseAgentSession()`, agent-runner.ts ~line 646):
   - Compares `model` against the reusable session's model to decide reuse
   - If model is still `"auto"`, reuse will never match (no session was built with `"auto"`)
   - Or if it somehow matches, the reused session has wrong tier/prompt/tools

**2. Session construction** (`createAgentSession()`, session.ts ~line 340):
   - `classifyModelTier()` → weak models get stripped tool surface
   - `computeTierToolFilter()` → tool allow/deny lists depend on tier
   - `buildCompiledPromptArtifacts()` → system prompt varies by tier
   - `resolveContextBudget()` → context window from model metadata
   - `supportsNativeThinking()` → thinking capability flag
   - MCP loading skipped entirely for weak tier

If Auto resolves after either of these, the session will have wrong tier/prompt/tools.

```
CLI --model auto
  → runAgentQuery() in agent-runner.ts (~line 572)
  → detect "auto" sentinel IMMEDIATELY after resolveCompatibleClaudeCodeModel()
  → auto-select.ts: chooseAutoModel(query, attachments, policy, catalog)
  → returns AutoDecision { model, fallbacks, reason }
  → model is now concrete (e.g. "anthropic/claude-sonnet-4-5")
  → shouldReuseAgentSession() uses concrete model for matching
  → createAgentSession() / reuseSession() uses concrete model
  → session builds normally (modelTier, prompt, tools all correct)
  → engine-sdk.ts receives normal provider/model string
```

Auto must NOT be treated as just another model ID flowing through existing resolution.

### Existing Code That Helps

- `ModelTier` (weak/mid/frontier) in `constants.ts` — one weak input signal, not the selector
- `classifyModelTier()` — useful but too coarse for Auto alone
- Provider registry — knows what models are available

### New Code

One file: `src/hlvm/agent/auto-select.ts`

Contains:
- `buildTaskProfile()` — extract obvious signals from prompt/attachments
- `filterModels()` — remove impossible candidates
- `scoreModel()` — simple additive scoring
- `chooseAutoModel()` — top-level entry point, returns AutoDecision

## Model Catalog: Hybrid Approach

- **Availability (v1)** = existing catalog snapshot (configured providers + locally installed models). No active probing or health checks.
- **Availability (v2, future)** = active probing (provider reachable? auth valid? degraded? latency?)
- **Selection heuristics** = small static table (hardcoded quality/reliability/traits)

Why static heuristics: Provider APIs tell you what exists, but they do NOT reliably tell you:
- Actual quality
- Structured output reliability
- Good coding defaults
- Fallback preference

So the static heuristic table is a small `ModelCaps[]` that HLVM maintains.

## Scoring Rules (v1)

Simple additive, hand-tuned:

```
score = 0

// Hard requirements (high weight)
if hasImage && model.vision: +100
if localOnly && model.local: +100

// Soft preferences
if needsStructuredOutput && model.structuredOutput: +40
if promptIsLarge && model.longContext: +20
if preferQuality && model.costTier === "high": +30
if preferCheap && model.costTier === "low": +30
if model.codingStrength === "strong": +15

// Penalties
if preferCheap && model.costTier === "high": -20
```

Tie-break: reliability > lower cost > preferred provider order.

## Fallback Policy (v1)

Fallback triggers ONLY on:
- Provider unavailable / network error
- Request rejected (auth, rate limit)
- Model cannot satisfy obvious capability (e.g. vision needed but model lacks it)
- Hard execution failure

Fallback does NOT trigger on:
- "Bad" or "low quality" answer
- Empty but valid response
- Slow response

This keeps Auto deterministic and debuggable.

## Edge Over Cursor

| | Cursor Auto | HLVM Auto |
|---|---|---|
| Selection logic | Black box | Open, inspectable rules |
| Reason visibility | Hidden | Shown in --verbose |
| Policy inputs | None | localOnly, noUpload, cheap, quality (internal) |
| Provider control | None | allow/block (internal policy, not CLI flags) |
| Model catalog | Closed | Open, user can see & modify |
| Source | Proprietary | Open source |

Note: Policy inputs (cheap, quality, localOnly, noUpload, allow/block) are **internal inputs**
to the selection algorithm, not committed CLI flags. Per CLAUDE.md CLI-simplicity rule,
new user-facing switches are only added when explicitly requested.
These may surface as config options or CLI flags later if needed.

## Phases

| Phase | What | Effort |
|-------|------|--------|
| v1 | `--model auto` sentinel, rule-based pick, hard-failure fallback, catalog snapshot | Small |
| v1.1 | `--verbose` shows reason, `/why` in REPL | Tiny |
| v1.2 | Policy inputs wired from config (not new CLI flags) | Small |
| v2 (future) | Active availability probing, learned ranking from evals | Medium |

## Non-Goals (Permanently)

- No execution surface architecture
- No per-capability routing
- No multi-provider subtask orchestration
- No LLVM framing or IR beyond AutoDecision
- No mid-turn model switching
- No "answer quality" judgment for fallback
