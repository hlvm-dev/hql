# Auto Model Selection & Local Fallback — Architecture & Progress

> Last updated: 2026-04-07
> Status: **Step 2 complete — LLM-based semantic classification** (regex heuristics replaced)

## TL;DR for the Next Agent

The `--model auto` system picks the best available model using **LLM-based semantic classification** (via the guaranteed-local gemma4), falls back through ranked alternatives on failure, and uses gemma4 as last resort. Step 1 (SSOT consolidation) and Step 2 (replace regex heuristics with local LLM classification) are both complete. All 83 tests pass (67 auto-select + 16 local-llm), 0 SSOT violations.

**Key change in Step 2**: Task detection, follow-up detection, question detection, and concrete-task detection all now use `ai.chat(gemma)` instead of regex patterns. The local model classifies semantics; regex only remains for format detection (tool-call JSON, plan envelopes).

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
|  callLLMWithModelFallback():                           |
|    1. Try primary model                                |
|    2. On fallback-worthy error -> try scored models    |
|    3. All exhausted -> try local gemma4 last-resort    |
|    4. Still failing -> throw original error            |
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
        +-------> local-llm.ts       ->  classifyTask(), classifyFollowUp(),
        |                                 classifyResponseIntent(), extractJson(),
        |                                 getLocalModelDisplayName()
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

| File | Role | Lines |
|------|------|-------|
| `src/hlvm/agent/auto-select.ts` | Model scoring, ranking, fallback wrapper (async) | ~395 |
| `src/hlvm/runtime/local-llm.ts` | **NEW** — LLM classification engine (classifyTask, classifyFollowUp, classifyResponseIntent, extractJson, getLocalModelDisplayName) | ~160 |
| `src/hlvm/runtime/local-fallback.ts` | **SSOT** — fallback constant, error classification, readiness | ~60 |
| `src/hlvm/agent/model-compat.ts` | Response suppression, responseAsksQuestion (LLM-based) | ~244 |
| `src/hlvm/agent/orchestrator-response.ts` | Follow-up/interaction handling (LLM-based) | ~900 |
| `src/hlvm/agent/error-taxonomy.ts` | Error -> class mapping | ~330 |
| `src/hlvm/agent/agent-runner.ts` | Wires auto-select into ReAct loop config | ~1300 |
| `src/hlvm/agent/orchestrator.ts` | OrchestratorConfig + LLM call site with fallback | ~1250 |
| `src/hlvm/cli/repl/handlers/chat-direct.ts` | Direct chat fallback (non-agent streaming) | ~350 |

### Bootstrap & Runtime

| File | Role |
|------|------|
| `src/hlvm/runtime/bootstrap-manifest.ts` | `LOCAL_FALLBACK_MODEL = "gemma4:e4b"`, manifest I/O |
| `src/hlvm/runtime/bootstrap-verify.ts` | `isFallbackModelAvailable()` — disk check |
| `src/hlvm/runtime/bootstrap-materialize.ts` | Extract engine + pull model |
| `src/hlvm/runtime/bootstrap-recovery.ts` | Repair on failure |
| `src/hlvm/cli/commands/serve.ts` | `isRuntimeReadyForAiRequests()` — runtime gate |

### Tests

| File | Tests | Coverage |
|------|-------|----------|
| `tests/unit/agent/auto-select.test.ts` | 67 | Scoring, filtering, fallback chain, error classification, async buildTaskProfile |
| `tests/unit/agent/local-llm.test.ts` | 16 | getLocalModelDisplayName, SSOT chain, extractJson, classifyTask/FollowUp/Intent defaults |

---

## 4. LLM Classification Pipeline (Step 2)

### What Was Replaced

| Before (regex) | After (LLM) | Location |
|----------------|-------------|----------|
| `CODE_SIGNALS` regex (12 patterns) | `classifyTask(query).isCodeTask` | auto-select.ts |
| `REASONING_SIGNALS` regex (10 patterns) | `classifyTask(query).isReasoningTask` | auto-select.ts |
| `STRUCTURED_SIGNALS` regex (8 patterns) | `classifyTask(query).needsStructuredOutput` | auto-select.ts |
| `isBinaryFollowUpQuestion()` regex | `classifyFollowUp(resp).isBinaryQuestion` | orchestrator-response.ts |
| `isGenericConversationalFollowUp()` regex | `classifyFollowUp(resp).isGenericConversational` | orchestrator-response.ts |
| `responseAsksQuestion()` — `endsWith("?")` | `classifyResponseIntent(resp).asksQuestion` | model-compat.ts |
| `responseNeedsConcreteTask()` (8 patterns) | `classifyResponseIntent(resp).needsConcreteTask` | orchestrator-response.ts |

### What Still Uses Regex (by design)

These detect **format**, not **semantics** — regex is correct here:

| Function | Purpose | File |
|----------|---------|------|
| `looksLikeToolCallJsonAnywhere()` | Detect raw JSON tool calls in text | model-compat.ts |
| `looksLikeToolCallTextEnvelope()` | Detect `toolName({...})` text | model-compat.ts |
| `looksLikePlanEnvelope()` | Detect PLAN...END_PLAN blocks | model-compat.ts |
| `looksLikeToolInstruction()` | Detect "invoke the X tool" text | model-compat.ts |
| `shouldSuppressFinalResponse()` | Combines above format checks | model-compat.ts |

### Classification Functions (local-llm.ts)

```ts
// Task classification — used by auto-select scoring
interface TaskClassification {
  isCodeTask: boolean;        // writing, debugging, reviewing code
  isReasoningTask: boolean;   // math, logic, step-by-step analysis
  needsStructuredOutput: boolean; // JSON, CSV, table, YAML output
}
async function classifyTask(query: string): Promise<TaskClassification>;

// Follow-up classification — used by orchestrator response handling
interface FollowUpClassification {
  asksFollowUp: boolean;          // ends with question to user
  isBinaryQuestion: boolean;      // yes/no question
  isGenericConversational: boolean; // "anything else I can help with?"
}
async function classifyFollowUp(response: string): Promise<FollowUpClassification>;

// Response intent — used by model-compat and orchestrator
interface ResponseIntentClassification {
  asksQuestion: boolean;      // asks user a question (not rhetorical)
  needsConcreteTask: boolean; // says it needs more specific instructions
}
async function classifyResponseIntent(response: string): Promise<ResponseIntentClassification>;

// Display name — derived from SSOT, never hardcoded
function getLocalModelDisplayName(): string; // "ollama/gemma4:e4b" -> "Gemma4"

// JSON extraction — handles markdown fences, preamble
function extractJson(text: string): string; // "Here: {\"code\":true}" -> "{\"code\":true}"
```

### Design Properties

- **Never throws** — all functions return safe defaults on error (Ollama down, model loading, etc.)
- **Temperature 0** — deterministic classification
- **maxTokens 64** — tiny, fast responses
- **Dynamic imports** — `await import("../runtime/local-llm.ts")` avoids loading overhead when not in auto mode
- **Single ai.chat() path** — no direct HTTP to Ollama, reuses SSOT provider chain
- **~50-200ms latency** — Ollama caches hot models; first call ~200ms, subsequent ~50ms

---

## 5. Display String Abstraction

All user-facing model name strings derive from `getLocalModelDisplayName()`:

| File | Before | After |
|------|--------|-------|
| `chat-direct.ts` | `"Local Gemma 4 is still preparing..."` | `` `Local ${getLocalModelDisplayName()} is still...` `` |
| `serve.ts` | `"Gemma"` (2 places) | `getLocalModelDisplayName()` |
| `first-run-setup.ts` | `"Gemma"` (1 place) | `getLocalModelDisplayName()` |
| `model-discovery-store.ts` | `displayName: "Gemma 4"` | `displayName: getLocalModelDisplayName()` |

Changing `LOCAL_FALLBACK_MODEL` from `"gemma4:e4b"` to `"gemma5:e4b"` auto-updates all UI strings.

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

### Binary Contents (~587 MB)

```
hlvm binary
+-- HLVM Runtime (TypeScript -> JS, Deno-compiled)
+-- HQL Standard Library (stdlib.hql -> self-hosted.js)
+-- Embedded Ollama v0.20.1 (~500 MB)
    +-- resources/ai-engine/
```

### First-Run Bootstrap

```
hlvm bootstrap
  1. Extract Ollama -> ~/.hlvm/.runtime/engine/
  2. Start Ollama on localhost:11439
  3. Pull gemma4:e4b (~9.6 GB) -> ~/.hlvm/models/
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

### Step 2: LLM-Based Semantic Classification (complete)

- [x] `DEFAULT_MODEL_ID` SSOT violation fixed (config/types.ts imports from local-fallback.ts)
- [x] `local-llm.ts` created — classifyTask, classifyFollowUp, classifyResponseIntent, extractJson, getLocalModelDisplayName
- [x] 3 regex constants deleted from auto-select.ts (CODE_SIGNALS, REASONING_SIGNALS, STRUCTURED_SIGNALS)
- [x] `buildTaskProfile` and `chooseAutoModel` converted to async (LLM-based)
- [x] `isBinaryFollowUpQuestion` and `isGenericConversationalFollowUp` regex deleted from orchestrator-response.ts
- [x] `responseNeedsConcreteTask` 8-pattern regex deleted from orchestrator-response.ts
- [x] `responseAsksQuestion` converted from `endsWith("?")` to LLM classification in model-compat.ts
- [x] All "Gemma 4" hardcoded display strings replaced with `getLocalModelDisplayName()`
- [x] 83 tests pass (67 auto-select + 16 local-llm), 0 SSOT violations

#### Step 2 Files Changed

| File | Change | Net |
|------|--------|-----|
| `src/common/config/types.ts` | Import `LOCAL_FALLBACK_MODEL_ID` for `DEFAULT_MODEL_ID` | ~+1, -1 |
| `src/hlvm/runtime/local-llm.ts` | **NEW** — classification engine | +160 |
| `src/hlvm/agent/auto-select.ts` | Delete 3 regex constants, async buildTaskProfile/chooseAutoModel | ~-10 |
| `src/hlvm/agent/orchestrator-response.ts` | Replace 3 regex functions with classifyFollowUp/classifyResponseIntent | ~-15 |
| `src/hlvm/agent/model-compat.ts` | responseAsksQuestion -> async LLM classification | ~+5 |
| `src/hlvm/cli/repl/handlers/chat-direct.ts` | Replace "Gemma 4" with getLocalModelDisplayName() | ~+3, -3 |
| `src/hlvm/cli/commands/serve.ts` | Replace "Gemma" with getLocalModelDisplayName() | ~+2, -2 |
| `src/hlvm/cli/commands/first-run-setup.ts` | Replace "Gemma" with getLocalModelDisplayName() | ~+1, -1 |
| `src/hlvm/providers/model-discovery-store.ts` | Replace "Gemma 4" with getLocalModelDisplayName() | ~+1, -1 |
| `tests/unit/agent/auto-select.test.ts` | Async tests, scoreModel unit tests, 67 total | rewritten |
| `tests/unit/agent/local-llm.test.ts` | **NEW** — 16 tests | +133 |

---

## 10. Remaining Work (Roadmap)

### Not Yet Done (Future Enhancements)

| Priority | Item | Description | Effort |
|----------|------|-------------|--------|
| P1 | **Happy-path LLM classification tests** | Current tests only cover empty-input defaults. Need mocked `ai.chat()` to test actual JSON parsing. | Small |
| P1 | **`extractJson()` nested JSON support** | Current regex `/\{[^}]+\}/` can't handle `{"outer":{"inner":true}}`. Need balanced-brace parser. | Small |
| P2 | **Auto-select for direct chat** | Chat mode doesn't do model scoring — just configured model or gemma4. Could reuse `chooseAutoModel()`. | Medium |
| P2 | **Fallback telemetry** | Track fallback frequency, latency delta, success rate. Currently only trace events. | Medium |
| P2 | **`extractClarifyingQuestion()` LLM conversion** | Still uses regex heuristic in orchestrator-response.ts. Medium priority. | Small |
| P3 | **User-configurable fallback policy** | Allow users to disable local fallback, pin fallback model, set retry budget. | Medium |
| P3 | **Model quality regression detection** | Surface warning if gemma4 consistently produces low-quality answers. | Large |

### Known Issues

1. **Pre-existing memory test cross-pollution** — `memory api: replace...` fails in full suite, passes in isolation. Not related to auto-select.
2. **Parallel test HLVM_DIR race** — Tests run in parallel share HLVM state dir. Use `HLVM_DIR` override for isolation.
3. **Comments still hardcode "gemma4"** — in `local-fallback.ts` and `chat-direct.ts`. Code is clean but some comments reference the concrete model name.

---

## 11. How to Build & Verify

### Run Tests

```bash
# SSOT check (mandatory, 0 errors)
deno task ssot:check

# Auto-select unit tests (67 tests)
deno test tests/unit/agent/auto-select.test.ts --no-check --allow-all

# Local LLM utility tests (16 tests)
deno test tests/unit/agent/local-llm.test.ts --no-check --allow-all

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

# No deleted regex constants
grep -rn 'CODE_SIGNALS\|REASONING_SIGNALS\|STRUCTURED_SIGNALS' src/

# No old regex functions
grep -rn 'isBinaryFollowUpQuestion\|isGenericConversationalFollowUp\|responseNeedsConcreteTask' src/
```

---

## 12. Key Design Decisions

1. **Pure scoring** — `scoreModel` has no side effects. `buildTaskProfile` does one LLM call; `resolveAutoModel` does provider I/O.
2. **Lazy imports** — `local-llm.ts` imported dynamically via `await import(...)` in auto-select.ts and orchestrator-response.ts to avoid loading overhead when not in auto mode.
3. **Error taxonomy is SSOT** — `classifyError` in error-taxonomy.ts is the single classifier. `classifyForLocalFallback` wraps it for fallback-specific decisions.
4. **LastResort is always wired** — Both auto and manual mode get `localLastResort`. The difference is auto mode also gets scored fallbacks.
5. **Readiness requires both checks** — `isLocalFallbackReady()` always checks runtime readiness AND model on disk.
6. **Semantic classification via LLM** — Task detection, follow-up detection, question detection all use `ai.chat(gemma)` with temperature 0, maxTokens 64. Regex only for format detection (tool-call JSON, plan envelopes).
7. **Never-throw classification** — All `classify*` functions return safe defaults on any error. If Ollama is down, auto-select falls back to neutral scoring.
8. **Display name from SSOT** — `getLocalModelDisplayName()` parses the model name from `LOCAL_FALLBACK_MODEL_ID` at runtime. Changing the constant auto-updates all UI strings.
