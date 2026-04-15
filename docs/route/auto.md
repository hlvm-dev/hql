# Auto Model Selection & Local Fallback — Architecture & Progress

> Last updated: 2026-04-08 Status: **Phase 1 + Phase 2 complete — 15 LLM
> classifiers, rate-limit smart skip**

## TL;DR for the Next Agent

The `--model auto` system picks the best available model using **LLM-based
semantic classification** (via the guaranteed-local gemma4), falls back through
ranked alternatives on failure, and uses gemma4 as last resort. Phase 1 (7
heuristics: task/follow-up/response/question detection) and Phase 2 (10 more:
planning/tool-instruction/conflict/grounding/search-intent/error/recovery/PII/source-authority)
are both complete. **Immediate local fallback**: when any cloud model fails and
gemma4 is ready, jumps straight to local last-resort instead of wasting 60+
seconds on cloud fallbacks. Cloud fallbacks only used as degraded path when
gemma4 unavailable. All tests pass (71 auto-select + 39 local-llm + 7
grounding), 0 SSOT violations.

**Key change**: All semantic decision-making now uses `ai.chat(gemma)`. Regex
only remains for format detection (tool-call JSON, plan envelopes,
`[Tool Result]` headers) and structural extraction (file paths, version numbers,
domain matching).

**Backdoor invariant**: `@auto` and every automatic local-AI path target HLVM's
embedded runtime on `127.0.0.1:11439`. `localhost:11434` is compatibility-only
and must never become a silent fallback.

---

## 1. System Overview

```
User: hlvm ask "write a function" --model auto
  |
  v
+-------------------------------------------------------+
| CLI (ask.ts)                                           |
|  isAutoModel("auto") -> true                           |
|  -> dynamic import auto-select.ts                      |
+------------------------+------------------------------+
                         |
                         v
+-------------------------------------------------------+
| Auto Selection (auto-select.ts)                        |
|  1. Query all providers for available models            |
|  2. Build task profile (async, LLM-classified)         |
|     +-> classifyTask(query) -> ai.chat(gemma)          |
|     +-> returns {isCodeTask, isReasoningTask,           |
|                   needsStructuredOutput}                |
|  3. Score each model against task profile               |
|  4. Pick best + 1-2 ranked fallbacks                   |
|  Result: { model, fallbacks, reason }                  |
+------------------------+------------------------------+
                         |
                         v
+-------------------------------------------------------+
| Agent Runner (agent-runner.ts)                          |
|  Wire up: primary LLM + createFallbackLLM factory      |
|  + localLastResort { model, isAvailable }               |
|  -> Pass to ReAct loop                                 |
+------------------------+------------------------------+
                         |
                         v
+-------------------------------------------------------+
| Orchestrator (orchestrator.ts + orchestrator-response)  |
|  withFallbackChain():                                  |
|    1. Try primary model                                |
|    2. Error + gemma4 ready -> gemma4 immediately       |
|    3. Error + gemma4 NOT ready -> try cloud fallbacks  |
|    4. All exhausted -> throw original error            |
|                                                        |
|  handleFinalResponse():                                |
|    +-> classifyFollowUp(resp) -> ai.chat(gemma)        |
|    +-> classifyResponseIntent(resp) -> ai.chat(gemma)  |
|    +-> responseAsksQuestion(resp) -> ai.chat(gemma)    |
+-------------------------------------------------------+
```

### Manual Mode (--model anthropic/claude-sonnet-4)

Same fallback wrapper, but:

- `autoFallbacks = []` (no scored fallbacks to try)
- `localLastResort` still present — gemma4 kicks in if cloud fails
- `createFallbackLLM` still provided — factory is reusable

### Immediate Local Fallback

When the primary model fails with ANY retryable error and local gemma4 is ready:

```
Primary (any error) ──► gemma4 immediately
```

Cloud fallbacks are only tried as a **degraded path** when gemma4 is NOT
available. This eliminates 60+ seconds of wasted retries on cloud models. The
trace event emits `reason: "local_fallback"` so the user can see what happened.

### Direct Chat Mode (non-agent, streaming)

Separate path in `chat-direct.ts`, but same SSOT:

- Uses `isLocalFallbackWorthy(error)` from `local-fallback.ts`
- Uses `isLocalFallbackReady()` from `local-fallback.ts`
- Single retry to gemma4 (no scored fallback tier)

---

## 2. SSOT Chain

```
bootstrap-manifest.ts  ->  LOCAL_FALLBACK_MODEL = "gemma4:e4b"  (ONE definition)
        |
        v
local-fallback.ts      ->  LOCAL_FALLBACK_MODEL_ID = `ollama/${LOCAL_FALLBACK_MODEL}`
        |
        +-------> local-llm.ts       ->  15 classifiers + extractJson(),
        |                                 getLocalModelDisplayName(), collectChat()
        |                                   all use ai.chat(LOCAL_FALLBACK_MODEL_ID)
        |
        +-------> config/types.ts    ->  DEFAULT_MODEL_ID = LOCAL_FALLBACK_MODEL_ID
        |
        +-------> consumers          ->  import from local-fallback.ts or local-llm.ts
```

Zero hardcoded "gemma4" or "Gemma 4" outside `bootstrap-manifest.ts`.

---

## 3. File Map

### Core Auto-Select & Classification

| File                                           | Role                                                                                              | Lines |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----- |
| `src/hlvm/agent/auto-select.ts`                | Model scoring, ranking, fallback wrapper (async)                                                  | ~395  |
| `src/hlvm/runtime/local-llm.ts`                | LLM classification engine — 15 classifiers + extractJson + collectChat + getLocalModelDisplayName | ~455  |
| `src/hlvm/runtime/local-fallback.ts`           | **SSOT** — fallback constant, error classification, readiness                                     | ~60   |
| `src/hlvm/agent/model-compat.ts`               | Response suppression, looksLikeToolInstruction (LLM), responseAsksQuestion (LLM)                  | ~244  |
| `src/hlvm/agent/orchestrator-response.ts`      | Follow-up/interaction handling (LLM-based)                                                        | ~900  |
| `src/hlvm/agent/error-taxonomy.ts`             | Error classification (async, SDK+regex+LLM fallback), recovery hints (async, static+LLM)          | ~430  |
| `src/hlvm/agent/planning.ts`                   | shouldPlanRequest (async, LLM-based)                                                              | ~120  |
| `src/hlvm/agent/grounding.ts`                  | checkGrounding + responseIncorporatesToolData (async, LLM-based)                                  | ~210  |
| `src/hlvm/agent/tools/web/query-strategy.ts`   | Search intent (sync+async companion), followup queries                                            | ~475  |
| `src/hlvm/agent/tools/web/source-authority.ts` | Source classification (sync heuristic + async LLM refinement)                                     | ~275  |
| `src/hlvm/memory/invalidate.ts`                | Conflict detection (async, LLM batch scoring)                                                     | ~58   |
| `src/hlvm/memory/store.ts`                     | PII detection (sync regex + async LLM supplement)                                                 | ~90   |
| `src/hlvm/agent/agent-runner.ts`               | Wires auto-select into ReAct loop config                                                          | ~1300 |
| `src/hlvm/agent/orchestrator.ts`               | OrchestratorConfig + LLM call site with fallback                                                  | ~1250 |
| `src/hlvm/cli/repl/handlers/chat-direct.ts`    | Direct chat fallback (non-agent streaming)                                                        | ~350  |

### Bootstrap & Runtime

| File                                        | Role                                                |
| ------------------------------------------- | --------------------------------------------------- |
| `src/hlvm/runtime/bootstrap-manifest.ts`    | `LOCAL_FALLBACK_MODEL = "gemma4:e4b"`, manifest I/O |
| `src/hlvm/runtime/bootstrap-verify.ts`      | `isFallbackModelAvailable()` — disk check           |
| `src/hlvm/runtime/bootstrap-materialize.ts` | Extract engine + pull model                         |
| `src/hlvm/runtime/bootstrap-recovery.ts`    | Repair on failure                                   |
| `src/hlvm/cli/commands/serve.ts`            | `isRuntimeReadyForAiRequests()` — runtime gate      |

### Tests

| File                                   | Tests | Coverage                                                                                               |
| -------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------ |
| `tests/unit/agent/auto-select.test.ts` | 67    | Scoring, filtering, fallback chain, error classification, async buildTaskProfile                       |
| `tests/unit/agent/local-llm.test.ts`   | 39    | getLocalModelDisplayName, SSOT chain, extractJson (10 tests incl. nested), 16 classifier default tests |
| `tests/unit/agent/grounding.test.ts`   | 7     | Grounding checks (all async) — fabricated headers, unknown tools, citations, data overlap              |

---

## 4. LLM Classification Pipeline

### Phase 1: What Was Replaced (7 heuristics)

| Before (regex)                             | After (LLM)                                      | Location                 |
| ------------------------------------------ | ------------------------------------------------ | ------------------------ |
| `CODE_SIGNALS` regex (12 patterns)         | `classifyTask(query).isCodeTask`                 | auto-select.ts           |
| `REASONING_SIGNALS` regex (10 patterns)    | `classifyTask(query).isReasoningTask`            | auto-select.ts           |
| `STRUCTURED_SIGNALS` regex (8 patterns)    | `classifyTask(query).needsStructuredOutput`      | auto-select.ts           |
| `isBinaryFollowUpQuestion()` regex         | `classifyFollowUp(resp).isBinaryQuestion`        | orchestrator-response.ts |
| `isGenericConversationalFollowUp()` regex  | `classifyFollowUp(resp).isGenericConversational` | orchestrator-response.ts |
| `responseAsksQuestion()` — `endsWith("?")` | `classifyResponseIntent(resp).asksQuestion`      | model-compat.ts          |
| `responseNeedsConcreteTask()` (8 patterns) | `classifyResponseIntent(resp).needsConcreteTask` | orchestrator-response.ts |

### Phase 2: What Was Replaced (10 heuristics)

| Before (regex/keyword/Jaccard)                                 | After (LLM)                                                | Location                 |
| -------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------ |
| 5 keyword `.includes()` + `length >= 160`                      | `classifyPlanNeed(query).needsPlan`                        | planning.ts              |
| `RE_JSON_OBJECT_TOOL`/`RE_FUNCTION_TOOL_CALL`/`RE_INVOKE_TOOL` | `classifyToolInstruction(text).isInstruction`              | model-compat.ts          |
| Jaccard token similarity (tokenize+jaccard)                    | `classifyFactConflicts(new, existing[]).conflicts` (batch) | invalidate.ts            |
| Token-set intersection grounding                               | `classifyGroundedness(resp, tools).incorporatesData`       | grounding.ts             |
| 7 regex word lists for intent                                  | `classifySearchIntent(query)` (6 boolean fields)           | query-strategy.ts        |
| 5 `ERROR_PATTERNS` regex (fallback)                            | `classifyErrorMessage(msg).errorClass` (after SDK+regex)   | error-taxonomy.ts        |
| 27 `RECOVERY_HINT_RULES` keyword arrays                        | `suggestRecoveryHint(msg)` (after static rules)            | error-taxonomy.ts        |
| 4 PII regex patterns (supplementary)                           | `classifySensitiveContent(text)` (after regex pass)        | store.ts                 |
| 11 hardcoded domain/path heuristics                            | `classifySourceAuthorities(results[])` (batch, after sync) | source-authority.ts      |

### What Still Uses Regex (by design)

These detect **format** or **structure**, not **semantics** — regex is correct
here:

| Function                           | Purpose                                                       | File                |
| ---------------------------------- | ------------------------------------------------------------- | ------------------- |
| `looksLikeToolCallJsonAnywhere()`  | Detect raw JSON tool calls in text                            | model-compat.ts     |
| `looksLikeToolCallTextEnvelope()`  | Detect `toolName({...})` text                                 | model-compat.ts     |
| `looksLikePlanEnvelope()`          | Detect PLAN...END_PLAN blocks                                 | model-compat.ts     |
| `extractClaimedToolNames()`        | Extract tool names from response text patterns                | grounding.ts        |
| `[Tool Result]` / header detection | String literal match for fabricated output                    | grounding.ts        |
| `VERSION_RE` / `YEAR_RE`           | Numeric format detection for version/year                     | intent-patterns.ts  |
| `SENSITIVE_PATTERNS` (4 regex)     | Deterministic PII format detection (SSN, CC, etc.)            | store.ts            |
| `RECOVERY_HINT_RULES` (static)     | Fast-path keyword matching (LLM only when no match)           | error-taxonomy.ts   |
| `ERROR_PATTERNS` (regex)           | Fast-path error class (LLM only when regex returns null)      | error-taxonomy.ts   |
| Domain/path heuristics (sync)      | Fast-path source classification (LLM only for "other")        | source-authority.ts |
| Sync `detectSearchQueryIntent()`   | Used in sync `formatResult` callback (async companion exists) | query-strategy.ts   |

### All 15 Classifiers (local-llm.ts)

| #  | Classifier                               | Returns                                                                         | maxTokens | Strategy               |
| -- | ---------------------------------------- | ------------------------------------------------------------------------------- | --------- | ---------------------- |
| 1  | `classifyTask(query)`                    | `{isCodeTask, isReasoningTask, needsStructuredOutput}`                          | 64        | Direct                 |
| 2  | `classifyFollowUp(resp)`                 | `{asksFollowUp, isBinaryQuestion, isGenericConversational}`                     | 64        | Direct                 |
| 3  | `classifyResponseIntent(resp)`           | `{asksQuestion, needsConcreteTask}`                                             | 64        | Direct                 |
| 4  | `classifyPlanNeed(query)`                | `{needsPlan}`                                                                   | 64        | Direct                 |
| 5  | `classifyToolInstruction(text)`          | `{isInstruction}`                                                               | 64        | Direct                 |
| 7  | `classifyFactConflicts(new, existing[])` | `{conflicts: [{index, score}]}`                                                 | 256       | Batch                  |
| 8  | `classifyGroundedness(resp, tools)`      | `{incorporatesData}`                                                            | 64        | Direct                 |
| 9  | `classifySearchIntent(query)`            | `{officialDocs, comparison, recency, versionSpecific, releaseNotes, reference}` | 64        | Direct                 |
| 10 | `classifyErrorMessage(msg)`              | `{errorClass}`                                                                  | 64        | Hybrid (after regex)   |
| 11 | `suggestRecoveryHint(msg)`               | `string \| null`                                                                | 80        | Hybrid (after static)  |
| 12 | `classifySensitiveContent(text)`         | `{additionalPII, types[]}`                                                      | 64        | Hybrid (after regex)   |
| 13 | `classifySourceAuthorities(results[])`   | `{results: [{index, sourceClass}]}`                                             | 256       | Batch                  |
| -  | `extractJson(text)`                      | `string`                                                                        | -         | Brace-depth counting   |
| -  | `getLocalModelDisplayName()`             | `string`                                                                        | -         | SSOT derived           |
| -  | `collectChat(prompt, opts)`              | `string`                                                                        | -         | Shared LLM call helper |

### Design Properties

- **Never throws** — all 15 classifiers return safe defaults on error (Ollama
  down, model loading, etc.)
- **Temperature 0** — deterministic classification
- **maxTokens 64** for single classifiers, **256** for batch (Steps 7, 13)
- **Dynamic imports** — `await import("../runtime/local-llm.ts")` avoids loading
  overhead when not in auto mode
- **Single ai.chat() path** — no direct HTTP to Ollama, reuses SSOT provider
  chain
- **~50-200ms latency** — Ollama caches hot models; first call ~200ms,
  subsequent ~50ms
- **Hybrid where applicable** — regex/rules fast path first, LLM only as
  fallback (Steps 10, 11, 12, 13)
- **Companion function pattern** — sync+async variants for functions called from
  sync `formatResult` callbacks (Steps 9, 12, 13)
- **CLI testing** — `hlvm classify "<prompt>"` exposes `collectChat()` directly
  for benchmarking and prompt iteration (no agent loop, no system prompt, raw
  local LLM call)

### LLM Classification Boundary

The same `collectChat()` infrastructure powers fuzzy semantic classification
outside model routing, but it is intentionally not the default for policy or
substrate decisions.

- Use local LLM classification for ambiguous semantic judgments such as
  browser-task detection or ambiguous Playwright visual-failure fallback
- Keep deterministic policy, safety, and stable substrate buckets in code
- Prefer structured facts first, then keyword fast-paths, then local LLM only
  when the remaining ambiguity is genuinely semantic

Measured on gemma4:e4b (local laptop): 300-660ms per ambiguous browser-failure
classification sample.

---

## 5. Display String Abstraction

All user-facing model name strings derive from `getLocalModelDisplayName()`:

| File                       | Before                                  | After                                                   |
| -------------------------- | --------------------------------------- | ------------------------------------------------------- |
| `chat-direct.ts`           | `"Local Gemma 4 is still preparing..."` | `` `Local ${getLocalModelDisplayName()} is still...` `` |
| `serve.ts`                 | `"Gemma"` (2 places)                    | `getLocalModelDisplayName()`                            |
| `first-run-setup.ts`       | `"Gemma"` (1 place)                     | `getLocalModelDisplayName()`                            |
| `model-discovery-store.ts` | `displayName: "Gemma 4"`                | `displayName: getLocalModelDisplayName()`               |

Changing `LOCAL_FALLBACK_MODEL` from `"gemma4:e4b"` to `"gemma5:e4b"`
auto-updates all UI strings.

---

## 6. Error Classification for Fallback

```
classifyError(error)
  -> ErrorClass: abort | timeout | rate_limit | context_overflow | transient | permanent | unknown

classifyForLocalFallback(error)
  -> rate_limit       -> "rate_limit"    (worthy)
     transient        -> "transient"     (worthy)
     timeout          -> "timeout"       (worthy)
     unknown          -> "unknown"       (worthy)
     permanent+401    -> "permanent"     (worthy -- auth failure, local can answer)
     permanent+403    -> "permanent"     (worthy -- auth failure, local can answer)
     permanent(other) -> null            (NOT worthy)
     abort            -> null            (NOT worthy)
     context_overflow -> null            (NOT worthy)
```

---

## 7. Fallback Chain Execution

```
Primary Model Call
  |
  +-- Success -> return response
  |
  +-- Error
      |
      +-- NOT fallback-worthy (abort, context_overflow, permanent non-auth)
      |   -> throw immediately
      |
      +-- Fallback-worthy error
      |   |
      |   +-- Try scored fallback #1
      |   |   +-- Success -> return
      |   |   +-- Fallback-worthy -> continue
      |   |
      |   +-- Try scored fallback #2
      |   |   +-- Success -> return
      |   |   +-- Fallback-worthy -> continue
      |   |
      |   +-- All scored fallbacks exhausted
      |       |
      |       +-- lastResort available?
      |       |   +-- Yes -> try gemma4:e4b -> return or throw
      |       |   +-- No  -> throw original error
      |       |
      +-- throw original error
```

---

## 8. Bootstrap & Binary Architecture

### Binary Contents (~363 MB)

```
hlvm binary
+-- HLVM Runtime (TypeScript -> JS, Deno-compiled)
+-- HQL Standard Library (stdlib.hql -> self-hosted.js)
+-- Pinned Ollama version (embedded-ollama-version.txt, baked in)
```

### First-Run Bootstrap

```
hlvm bootstrap
  1. Download pinned Ollama -> ~/.hlvm/.runtime/engine/
  2. Start Ollama on localhost:11439
  3. Pull gemma4:e4b (~9.6 GB) -> ~/.hlvm/.runtime/models/
  4. Verify: digest prefix + size tolerance
  5. Write manifest.json { state: "verified" }
```

### Runtime Readiness (serve.ts)

```
isRuntimeReadyForAiRequests() =
  runtimeReadyState === "ready"
  && bootstrapVerified           // engine + model hashes match
  && localFallbackReady          // gemma4 responded to probe
```

---

## 9. Completed Work

### Step 1: SSOT Consolidation (complete)

- [x] SSOT local fallback module (`local-fallback.ts`)
- [x] Unified error classification (`classifyForLocalFallback`)
- [x] Manual mode now has gemma4 fallback (was missing)
- [x] chat-direct.ts uses SSOT (was using separate ProviderErrorCode enum)
- [x] Readiness check always does runtime + disk (was inconsistent)
- [x] 44 unit tests covering all paths

### Phase 1: LLM-Based Semantic Classification (complete)

- [x] `DEFAULT_MODEL_ID` SSOT violation fixed (config/types.ts imports from
      local-fallback.ts)
- [x] `local-llm.ts` created — classifyTask, classifyFollowUp,
      classifyResponseIntent, extractJson, getLocalModelDisplayName
- [x] 3 regex constants deleted from auto-select.ts (CODE_SIGNALS,
      REASONING_SIGNALS, STRUCTURED_SIGNALS)
- [x] `buildTaskProfile` and `chooseAutoModel` converted to async (LLM-based)
- [x] `isBinaryFollowUpQuestion` and `isGenericConversationalFollowUp` regex
      deleted from orchestrator-response.ts
- [x] `responseNeedsConcreteTask` 8-pattern regex deleted from
      orchestrator-response.ts
- [x] `responseAsksQuestion` converted from `endsWith("?")` to LLM
      classification in model-compat.ts
- [x] All "Gemma 4" hardcoded display strings replaced with
      `getLocalModelDisplayName()`

### Phase 2: Replace 10 Brittle Heuristics (complete)

- [x] `extractJson` fixed: regex `/\{[^}]+\}/` → brace-depth counting (handles
      nested JSON)
- [x] `collectChat` exported (was private) for batch classifiers
- [x] `shouldPlanRequest` → async with `classifyPlanNeed` (planning.ts)
- [x] `looksLikeToolInstruction` → async with `classifyToolInstruction`; deleted
      `RE_JSON_OBJECT_TOOL`/`RE_FUNCTION_TOOL_CALL`/`RE_INVOKE_TOOL`
      (model-compat.ts)
- [x] `detectConflicts` → async with `classifyFactConflicts` (batch); deleted
      `tokenize()`/`jaccard()` (invalidate.ts)
- [x] `responseIncorporatesToolData` + `checkGrounding` → async with
      `classifyGroundedness`; deleted `COMMON_WORDS` (grounding.ts)
- [x] Added `detectSearchQueryIntentAsync` companion with
      `classifySearchIntent`; extracted `deriveIntentFields` shared helper
      (query-strategy.ts)
- [x] `classifyError` → async with `classifyErrorMessage` LLM fallback after
      SDK+regex (error-taxonomy.ts)
- [x] `getRecoveryHint` → async with `suggestRecoveryHint` LLM fallback after
      static rules (error-taxonomy.ts)
- [x] Added `sanitizeSensitiveContentAsync` with `classifySensitiveContent`
      (store.ts, facts.ts)
- [x] Added `annotateSearchResultSourcesAsync` with `classifySourceAuthorities`
      batch (source-authority.ts, ddg-search-backend.ts)
- [x] All async cascade `await` sites verified across ~20 files
- [x] 39 local-llm tests + 7 grounding tests pass, 0 SSOT violations

#### Phase 2 Files Changed (~20 files, +350 lines in local-llm.ts, ~150 lines across callers)

| File                                             | Change                                                      |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `src/hlvm/runtime/local-llm.ts`                  | +10 classifiers, extractJson fix, collectChat export        |
| `src/hlvm/agent/planning.ts`                     | `shouldPlanRequest` → async                                 |
| `src/hlvm/agent/model-compat.ts`                 | `looksLikeToolInstruction` → async, 3 regex deleted         |
| `src/hlvm/memory/invalidate.ts`                  | `detectConflicts` → async, jaccard/tokenize deleted         |
| `src/hlvm/memory/pipeline.ts`                    | `writeMemoryFact`/`writeMemoryFacts` → async                |
| `src/hlvm/memory/store.ts`                       | New `sanitizeSensitiveContentAsync`                         |
| `src/hlvm/memory/facts.ts`                       | Uses `sanitizeSensitiveContentAsync`                        |
| `src/hlvm/agent/grounding.ts`                    | `checkGrounding` + `responseIncorporatesToolData` → async   |
| `src/hlvm/agent/tools/web/query-strategy.ts`     | Companion async functions, shared `deriveIntentFields`      |
| `src/hlvm/agent/tools/web/source-authority.ts`   | New `annotateSearchResultSourcesAsync`                      |
| `src/hlvm/agent/tools/web/ddg-search-backend.ts` | `await` at async call sites                                 |
| `src/hlvm/agent/tools/web/duckduckgo.ts`         | `await buildFollowupQueriesAsync`                           |
| `src/hlvm/agent/error-taxonomy.ts`               | `classifyError`/`getRecoveryHint` → async with LLM fallback |
| `src/hlvm/agent/orchestrator.ts`                 | `await` at 5 call sites                                     |
| `src/hlvm/agent/orchestrator-response.ts`        | `await checkGrounding`, `await shouldSuppressFinalResponse` |
| `src/hlvm/agent/orchestrator-llm.ts`             | `await classifyError`                                       |
| `src/hlvm/agent/orchestrator-tool-formatting.ts` | `await getRecoveryHint` (2 sites)                           |
| `src/hlvm/cli/commands/ask.ts`                   | `await shouldSuppressFinalResponse`                         |
| `tests/unit/agent/local-llm.test.ts`             | +23 new tests (39 total)                                    |
| `tests/unit/agent/grounding.test.ts`             | All tests converted to async                                |

---

## 10. Remaining Work (Roadmap)

### Not Yet Done (Future Enhancements)

| Priority | Item                                             | Description                                                                                               | Effort |
| -------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------ |
| P1       | **Happy-path LLM classification tests**          | Current tests only cover empty-input defaults. Need mocked `ai.chat()` to test actual JSON parsing paths. | Small  |
| P2       | **Auto-select for direct chat**                  | Chat mode doesn't do model scoring — just configured model or gemma4. Could reuse `chooseAutoModel()`.    | Medium |
| P2       | **Fallback telemetry**                           | Track fallback frequency, latency delta, success rate. Currently only trace events.                       | Medium |
| P2       | **`extractClarifyingQuestion()` LLM conversion** | Still uses regex heuristic in orchestrator-response.ts. Medium priority.                                  | Small  |
| P3       | **User-configurable fallback policy**            | Allow users to disable local fallback, pin fallback model, set retry budget.                              | Medium |
| P3       | **Model quality regression detection**           | Surface warning if gemma4 consistently produces low-quality answers.                                      | Large  |

### Known Issues

1. **Pre-existing memory test cross-pollution** — `memory api: replace...` fails
   in full suite, passes in isolation. Not related to auto-select.
2. **Parallel test HLVM_DIR race** — Tests run in parallel share HLVM state dir.
   Use `HLVM_DIR` override for isolation.
3. **Comments still hardcode "gemma4"** — in `local-fallback.ts` and
   `chat-direct.ts`. Code is clean but some comments reference the concrete
   model name.

---

## 11. How to Build & Verify

### Run Tests

```bash
# SSOT check (mandatory, 0 errors)
deno task ssot:check

# Auto-select unit tests (67 tests)
deno test tests/unit/agent/auto-select.test.ts --no-check --allow-all

# Local LLM utility tests (39 tests)
deno test tests/unit/agent/local-llm.test.ts --no-check --allow-all

# Grounding tests (7 tests)
deno test tests/unit/agent/grounding.test.ts --no-check --allow-all

# Full unit suite
deno task test:unit
```

### Verify Binary

```bash
./hlvm --version
./hlvm bootstrap --verify
./hlvm ask "hello"
```

### Grep Audits

```bash
# No hardcoded model IDs outside SSOT root
grep -rn 'gemma4:e4b' src/ --include='*.ts' | grep -v 'bootstrap-manifest.ts' | grep -v node_modules

# No hardcoded display strings
grep -rn '"Gemma 4"' src/

# No deleted regex constants (Phase 1 + Phase 2)
grep -rn 'CODE_SIGNALS\|REASONING_SIGNALS\|STRUCTURED_SIGNALS' src/

grep -rn 'RE_JSON_OBJECT_TOOL\|RE_FUNCTION_TOOL_CALL\|RE_INVOKE_TOOL\|RE_TOOL_WORD' src/
grep -rn 'COMMON_WORDS' src/

# No old regex functions
grep -rn 'isBinaryFollowUpQuestion\|isGenericConversationalFollowUp\|responseNeedsConcreteTask' src/

# No stale jaccard/tokenize in memory
grep -rn 'jaccard\|tokenize' src/hlvm/memory/
```

---

## 12. Key Design Decisions

1. **Pure scoring** — `scoreModel` has no side effects. `buildTaskProfile` does
   one LLM call; `resolveAutoModel` does provider I/O.
2. **Lazy imports** — `local-llm.ts` imported dynamically via
   `await import(...)` in auto-select.ts and orchestrator-response.ts to avoid
   loading overhead when not in auto mode.
3. **Error taxonomy is SSOT** — `classifyError` in error-taxonomy.ts is the
   single classifier. `classifyForLocalFallback` wraps it for fallback-specific
   decisions.
4. **LastResort is always wired** — Both auto and manual mode get
   `localLastResort`. The difference is auto mode also gets scored fallbacks.
5. **Readiness requires both checks** — `isLocalFallbackReady()` always checks
   runtime readiness AND model on disk.
6. **Semantic classification via LLM** — All 16 semantic classifiers use
   `ai.chat(gemma)` with temperature 0. Regex only for format detection
   (tool-call JSON, plan envelopes) and structural extraction (file paths,
   versions, domains).
7. **Never-throw classification** — All `classify*` functions return safe
   defaults on any error. If Ollama is down, auto-select falls back to neutral
   scoring.
8. **Display name from SSOT** — `getLocalModelDisplayName()` parses the model
   name from `LOCAL_FALLBACK_MODEL_ID` at runtime. Changing the constant
   auto-updates all UI strings.
9. **Hybrid strategy** — For error classification, recovery hints, PII
   detection, and source authority: fast sync path (regex/rules/heuristics) runs
   first, LLM only when sync path returns null or "other". Minimizes latency for
   common cases.
10. **Companion function pattern** — When a function is called from a sync
    `formatResult` callback (tool definitions), both sync and async variants
    exist. Sync uses regex, async uses LLM. Avoids cascading sync→async through
    30+ tool definitions.
11. **Batch classification** — Fact conflict scoring (up to 12 candidates) and
    source authority (10-15 results) use single LLM calls with `maxTokens: 256`
    to avoid per-item latency.
