# The ReAct Loop — Stage by Stage

`orchestrator.ts:1507-2085` — the beating heart of the agent.

## Overview

```
  runReActLoop(userRequest, config, llm, attachments)
    │
    ├─── INIT (once)
    │      initializeLoopState → applyDomain → addUserMsg → plan?
    │
    └─── WHILE (iterations < max && now < deadline)
           │
           ├── STAGE 1: Boundary ops       (abort, timeout, drain inboxes)
           ├── STAGE 2: (reserved)
           ├── STAGE 3: Pre-LLM            (memory, compaction, tool phase)
           ├── STAGE 4: LLM call           (build schema, call provider)
           ├── STAGE 5: Auto-continue      (rejoin truncated responses)
           ├── STAGE 6: Classify response   (tools vs text)
           ├── STAGE 7: Tool execution      (validate, permit, dispatch)
           ├── STAGE 8: Post-tool          (denial tracking, browser recovery)
           ├── STAGE 9: Final response     (plan advance, grounding, citations)
           └── STAGE 10: Error recovery    (overflow, transient retry)
```


## Initialization (runs once before loop)

```
  orchestrator.ts:1507  runReActLoop(userRequest, attachments, config)
        │
        ├─:1523  initializeLoopState(config)              orch-state.ts:173
        │          iterations=0, runtimePhase=undef, lastToolNames=[],
        │          playwright={repeatFailureCount:0,
        │                      temporaryToolDenylist:Map{}}
        │
        ├─:1524  resolveLoopConfig(config)                orch-state.ts:214
        │          maxIterations, maxDenials, timeout, llmLimiter
        │
        ├─:1527  applyRequestDomainToolProfile()          orch.ts:769
        │          ├─ classifyDomainSignal()        → "browser"|"general"
        │          ├─ resolveCanonicalBaselineAllowlist()
        │          ├─ if browser: widen baseline with pw_*
        │          ├─ if browser: set domain=browser_safe
        │          └─ if general: clear domain layer
        │
        ├─:1529  addContextMessage({role:"user", content:userRequest})
        │
        └─:1548  if should plan:
                   requestPlan(llm, messages, request, config)
                   → parse PLAN...END_PLAN
                   → createPlanState(plan) if mode="always"
```


## STAGE 1: Loop Boundary Operations

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  EVERY ITERATION STARTS HERE                     orch.ts:1585      │
  │                                                                    │
  │  :1585  if (config.signal?.aborted) break                          │
  │  :1588  if (now > loopDeadline) return timeout msg                 │
  │  :1591  state.iterations++                                         │
  │                                                                    │
  │  (no multi-agent drains — delegation/teams removed)               │
  │                                                                    │
  └─────────────────────────────────────────────────────────────────────┘
```


## STAGE 2: Plan Delegation

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  (Plan delegation removed — agent system rewrite pending.)         │
  │                                                                    │
  │  Plan steps are now executed directly by the main agent.           │
  │                                                                    │
  └─────────────────────────────────────────────────────────────────────┘
```


## STAGE 3: Pre-LLM Preparation

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  PREPARE CONTEXT BEFORE CALLING LLM                orch.ts:1745    │
  │                                                                    │
  │  :1745  ── Rate limit ──────────────────────────────────────────   │
  │         lc.llmLimiter?.consume(1)                                  │
  │         throws RateLimitError if exceeded                          │
  │                                                                    │
  │  :1765  emit { type: "thinking" }                                  │
  │                                                                    │
  │  :1767  ── Inject reminders ────────────────────────────────────   │
  │         maybeInjectReminder(state, lc, config)                     │
  │         periodic system nudges (tool usage, constraints)           │
  │                                                                    │
  │  :1768  ── Memory recall ───────────────────────────────────────   │
  │         maybeInjectMemoryRecall(state, config)                     │
  │           └─ buildRelevantMemoryRecall() → context-relevant facts  │
  │              injected as [System Reminder] user message             │
  │                                                                    │
  │                                                                    │
  │  :1773  ── Context pressure ────────────────────────────────────   │
  │         pct = calculateContextPercent(context)                     │
  │         emit { type: "context_pressure", percent: pct }            │
  │                                                                    │
  │  :1800  ── Pre-compaction memory flush ─────────────────────────   │
  │         if (context.isPendingCompaction                            │
  │             && pct >= threshold                                     │
  │             && !memoryFlushedThisCycle                              │
  │             && memoryWriteAvailable):                               │
  │           inject "save important context via memory_write NOW"      │
  │           skipCompaction = true  (give model a chance to save)      │
  │                                                                    │
  │  :1817  ── Proactive compaction ────────────────────────────────   │
  │         if (!skipCompaction && isPendingCompaction && pct >= 80%):  │
  │           context.compactIfNeeded()                                │
  │             └─ LLM-powered summarization of older messages         │
  │                microcompact: replace tool results with sentinel     │
  │                preserve: system msgs + last N messages             │
  │                build: restoration hints for file state             │
  │           emit { type: "context_compaction", before, after }       │
  │                                                                    │
  │  :1843  ── Adaptive tool phase ─────────────────────────────────   │
  │         applyAdaptiveToolPhase(state, config, userRequest)         │
  │           │                                                        │
  │           ├─ deriveRuntimePhase(state)                             │
  │           │    last tools → "researching"|"editing"|"verifying"    │
  │           │                  "completing"                           │
  │           │                                                        │
  │           ├─ resolvePersistentToolFilter()                         │
  │           │    baseline ∩ domain ∩ plan → available tools          │
  │           │                                                        │
  │           ├─ getPhaseCategories(phase)                             │
  │           │    researching → READ+SEARCH+WEB+MEMORY+DISCOVERY     │
  │           │    editing     → READ+WRITE+SEARCH+MEMORY             │
  │           │    verifying   → READ+SEARCH+EXEC+MEMORY              │
  │           │                                                        │
  │           ├─ drain temporaryToolDenylist (TTL countdown)           │
  │           │                                                        │
  │           └─ updateToolProfileLayer("runtime", {allowlist,deny})   │
  │              _generation bumped → cache invalidated                │
  │                                                                    │
  │  :1849  ── Thinking budget ─────────────────────────────────────   │
  │         resolveThinkingProfile(config, state)                      │
  │         budget_tokens for native reasoning models                  │
  │                                                                    │
  └─────────────────────────────────────────────────────────────────────┘
```


## STAGE 4: LLM Call

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  CALL THE LLM                                      orch.ts:1879    │
  │                                                                    │
  │  runLlmResponsePass(messages, state, lc, config, llm)              │
  │    │                                            orch.ts:1349       │
  │    ├─ callLLM(llm, messages, config)            orch-llm.ts:58    │
  │    │    │                                                          │
  │    │    │  ┌─ INSIDE engine-sdk.ts ──────────────────────────────┐ │
  │    │    │  │                                                      │ │
  │    │    │  │  resolveToolFilters()                        :809   │ │
  │    │    │  │    └─ resolveEffectiveToolFilterCached()            │ │
  │    │    │  │       walk 5 layers, intersect allowlists           │ │
  │    │    │  │       cache hit if _generation unchanged            │ │
  │    │    │  │                                                      │ │
  │    │    │  │  if cache miss:                                      │ │
  │    │    │  │    buildToolDefinitions({allow, deny, ownerId})     │ │
  │    │    │  │    → filter registry → convert to SDK schema        │ │
  │    │    │  │                                                      │ │
  │    │    │  │  provider.call({                                     │ │
  │    │    │  │    messages, tools, maxTokens, temperature           │ │
  │    │    │  │  })                                                  │ │
  │    │    │  │  → streaming tokens → onToken callback → TUI        │ │
  │    │    │  │                                                      │ │
  │    │    │  └──────────────────────────────────────────────────────┘ │
  │    │    │                                                          │
  │    │    ├─ returns AgentResponse {content, toolCalls, usage,       │
  │    │    │                         completionState}                 │
  │    │    │                                                          │
  │    │    └─ ON context_overflow:                                    │
  │    │         context.compactIfNeeded()                             │
  │    │         retry ONCE                                            │
  │    │                                                               │
  │    ├─ record token usage                                           │
  │    ├─ emit { type: "llm_performance", latency, tokens }           │
  │    └─ if native thinking: emit { type: "reasoning" }              │
  │                                                                    │
  └─────────────────────────────────────────────────────────────────────┘
```


## STAGE 5: Auto-Continuation

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  REJOIN TRUNCATED RESPONSES                        orch.ts:1891    │
  │                                                                    │
  │  while (true):                                                     │
  │    decision = shouldAutoContinueResponse(agentResponse)            │
  │                                                                    │
  │    Continue IF ALL of:                                              │
  │      ✓ completionState === "truncated_max_tokens"                  │
  │      ✓ no tool_calls in response                                   │
  │      ✓ response doesn't look like tool-call JSON                   │
  │      ✓ continuationCount < 3  (RESPONSE_CONTINUATION_MAX_HOPS)    │
  │                                                                    │
  │    if (!decision.continue) break                                   │
  │                                                                    │
  │    continuationResult = runLlmResponsePass(                        │
  │      buildContinuationMessages(base, previousText)                 │
  │    )                                                               │
  │    agentResponse.content = mergeContinuationText(prev, new)        │
  │                                                                    │
  │  (Handles long-form answers that exceed provider's max_tokens)     │
  │                                                                    │
  └─────────────────────────────────────────────────────────────────────┘
```


## STAGE 6: Response Classification

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  WHAT DID THE LLM RETURN?                          orch.ts:1978    │
  │                                                                    │
  │                    Has tool_calls?                                  │
  │                   ┌─────┴──────┐                                   │
  │                  YES            NO                                  │
  │                   │             │                                   │
  │                   │      handleTextOnlyResponse()                   │
  │                   │      orch-response.ts:644                       │
  │                   │             │                                   │
  │                   │      ┌──────┴───────┐                           │
  │                   │    empty?      looks like JSON?                 │
  │                   │      │              │                           │
  │                   │   retry once    toolCallRetries++               │
  │                   │   (noInput      if < max: inject nudge         │
  │                   │    Retries++)     → LOOP BACK                  │
  │                   │                 if max: repairToolCallFromText  │
  │                   │                   repaired? → treat as tool     │
  │                   │                   else → error                  │
  │                   │                                                │
  │                   │    (valid text → STAGE 9: final response)       │
  │                   │                                                │
  │                   ▼                                                │
  │            STAGE 7: tool execution                                 │
  │                                                                    │
  └─────────────────────────────────────────────────────────────────────┘
```


## STAGE 7: Tool Execution

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  EXECUTE TOOL CALLS                      orch-response.ts:416      │
  │                                                                    │
  │  processAgentResponse(agentResponse, config, rateLimiter)          │
  │    │                                                               │
  │    ├─ ensureToolCallIds(toolCalls)                                 │
  │    ├─ limit to config.maxToolCalls (default 10)                    │
  │    ├─ PREEMPT: if complete_task present → execute only that        │
  │    ├─ add assistant message to context                             │
  │    │                                                               │
  │    └─ executeToolCalls(calls, config, rateLimiter)                 │
  │         │                                                          │
  │         │  ┌── FOR EACH tool call (parallel w/ concurrency) ────┐ │
  │         │  │                                                     │ │
  │         │  │  executeToolCall()     orch-tool-exec.ts:422       │ │
  │         │  │    │                                                │ │
  │         │  │    ├─ ensureMcpLoaded()     (lazy, first call only) │ │
  │         │  │    ├─ normalizeToolName()   (camelCase → snake)     │ │
  │         │  │    ├─ normalizeToolArgs()                           │ │
  │         │  │    │                                                │ │
  │         │  │    ├─ VALIDATE ─────────────────────────────────┐  │ │
  │         │  │    │  tool exists?   → suggest alternatives     │  │ │
  │         │  │    │  tool allowed?  → "permission denied"      │  │ │
  │         │  │    │  args valid?    → schema error              │  │ │
  │         │  │    ├────────────────────────────────────────────┘  │ │
  │         │  │    │                                                │ │
  │         │  │    ├─ PERMISSION ───────────────────────────────┐  │ │
  │         │  │    │  headless + ask_user? → error              │  │ │
  │         │  │    │  plan mode + mutating? → error             │  │ │
  │         │  │    │  plan review gate (ensureApproved)         │  │ │
  │         │  │    │  checkToolSafety() → modal                  │  │ │
  │         │  │    ├────────────────────────────────────────────┘  │ │
  │         │  │    │                                                │ │
  │         │  │    ├─ emit { type: "tool_start" }                 │ │
  │         │  │    │                                                │ │
  │         │  │    ├─ DISPATCH ─────────────────────────────────┐  │ │
  │         │  │    │                                            │  │ │
  │         │  │    │  standard tool:                            │  │ │
  │         │  │    │    getTool(name, ownerId)                  │  │ │
  │         │  │    │    executeToolWithTimeout(fn, args)        │  │ │
  │         │  │    │                                            │  │ │
  │         │  │    │  ON edit_file fail:                        │  │ │
  │         │  │    │    buildEditFileAutoRetryArgs()            │  │ │
  │         │  │    │  ON playwright fail:                       │  │ │
  │         │  │    │    enrichPlaywrightFailureMetadata()       │  │ │
  │         │  │    ├────────────────────────────────────────────┘  │ │
  │         │  │    │                                                │ │
  │         │  │    ├─ emit { type: "tool_end" }                   │ │
  │         │  │    └─ return ToolExecutionResult                   │ │
  │         │  │                                                     │ │
  │         │  └─────────────────────────────────────────────────────┘ │
  │         │                                                          │
  │         ├─ resolveContextObservation(call, result)                 │
  │         │    → full result or summary depending on size            │
  │         ├─ addContextMessage({role:"tool", content:observation})   │
  │         ├─ if images: addContextMessage(screenshot)                │
  │         ├─ buildCitationSourceIndex() from web tool results        │
  │         └─ return { shouldContinue, stopReason, toolResults }      │
  │                                                                    │
  └─────────────────────────────────────────────────────────────────────┘
```


## STAGE 8: Post-Tool Execution

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  AFTER TOOLS RUN                        orch-response.ts:1518      │
  │                                                                    │
  │  handlePostToolExecution(result, state, lc, config, llm)           │
  │    │                                                               │
  │    ├─ Denial tracking                                              │
  │    │    for each tool result:                                      │
  │    │      if "denied" → denialCountByTool.increment(toolName)     │
  │    │      if count > maxDenials → block tool                       │
  │    │                                                               │
  │    ├─ All tools blocked?                                           │
  │    │    YES → attempt final ungrounded response                    │
  │    │                                                               │
  │    ├─ Update state.lastToolNames                                   │
  │    │                                                               │
  │    ├─ Playwright recovery  (see 03-tool-profiles.md for details)   │
  │    │    decideBrowserRecovery({toolName, failure, repeatCount})    │
  │    │      │                                                        │
  │    │      ├─ candidateHref → pw_goto fallback                     │
  │    │      ├─ download navigated → follow destination               │
  │    │      ├─ repeatCount < 2 → let LLM retry                      │
  │    │      ├─ visual blocker + browser_safe → PROMOTE TO HYBRID    │
  │    │      │    widenBaselineForDomainProfile(BROWSER_HYBRID)       │
  │    │      │    updateToolProfileLayer("domain", browser_hybrid)    │
  │    │      │    clearToolProfileLayer("runtime")                    │
  │    │      │    inject hybrid directive                              │
  │    │      │    block failing tool for 2 turns                      │
  │    │      └─ visual blocker + already hybrid → cu_* fallback      │
  │    │                                                               │
  │    ├─ Playwright visual loop detection                             │
  │    │    repeated screenshots without progress → nudge structural   │
  │    │                                                               │
  │    └─ return { action: "continue" }  ──── LOOP BACK TO STAGE 1    │
  │                                                                    │
  └─────────────────────────────────────────────────────────────────────┘
```


## STAGE 9: Final Response

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  TEXT-ONLY RESPONSE (no tools)          orch-response.ts:1143      │
  │                                                                    │
  │  handleFinalResponse(text, result, state, lc, config)              │
  │    │                                                               │
  │    ├─:1164  Require tool calls guard                               │
  │    │        if requireToolCalls && no tools made → retry/error     │
  │    │                                                               │
  │    ├─:1191  Plan mode handling                                     │
  │    │        if planModeState.active && not executing:              │
  │    │          parse PLAN...END_PLAN block                          │
  │    │          → handleDraftedPlan() → review → approve/revise     │
  │    │          → on approve: createPlanState, set executing phase   │
  │    │          → continue  ─────────────── LOOP BACK               │
  │    │                                                               │
  │    ├─:1273  Auto-continue suppression                              │
  │    │        if LLM prematurely asks "may I proceed?"              │
  │    │        → inject "continue" directive                          │
  │    │        → continue  ─────────────── LOOP BACK                 │
  │    │                                                               │
  │    ├─:1291  Follow-up interaction                                  │
  │    │        if LLM asks yes/no question + onInteraction available: │
  │    │        → convert to user prompt, await response               │
  │    │        → continue  ─────────────── LOOP BACK                 │
  │    │                                                               │
  │    ├─:1319  Weak-model JSON detection                              │
  │    │        if final answer contains JSON tool calls → retry       │
  │    │                                                               │
  │    ├─:1341  Working note detection                                 │
  │    │        if "next I will..." → nudge to continue working       │
  │    │        → continue  ─────────────── LOOP BACK                 │
  │    │                                                               │
  │    ├─:1356  Browser final answer gate                              │
  │    │        if browser tools used → assess completeness            │
  │    │        if incomplete → require evidence                       │
  │    │                                                               │
  │    ├─:1380  Plan state advancement                                 │
  │    │        extract STEP_DONE <id> marker                          │
  │    │        advancePlanState(state, completedId)                   │
  │    │        if more steps → inject next-step directive             │
  │    │        → continue  ─────────────── LOOP BACK                 │
  │    │                                                               │
  │    ├─:1429  No-input mode question filter                          │
  │    │        if headless + LLM asks question → "provide best-effort"│
  │    │                                                               │
  │    ├─:1446  Citation attribution                                   │
  │    │        build citation spans from passage index                │
  │    │                                                               │
  │    ├─:1471  Grounding check                                        │
  │    │        checkGrounding(response, toolUses, citations)          │
  │    │          ├─ fabricated [Tool Result]? → warning               │
  │    │          ├─ unknown tool names? → warning                     │
  │    │          └─ LLM classification: incorporates tool data?       │
  │    │        if !grounded && strict: retry ── LOOP BACK             │
  │    │        if !grounded && soft: emit warning                     │
  │    │                                                               │
  │    ├─:1510  emit final response metadata (citations)               │
  │    │                                                               │
  │    └─:1511  return { action: "return", value: finalResponse }      │
  │                                                                    │
  │             ════════════════════════════════════════                │
  │             THIS IS THE ONLY WAY TO EXIT THE LOOP                  │
  │             WITH A SUCCESSFUL RESPONSE                             │
  │             ════════════════════════════════════════                │
  │                                                                    │
  └─────────────────────────────────────────────────────────────────────┘
```


## STAGE 10: Error Recovery

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  CATCH BLOCK                                       orch.ts:2033    │
  │                                                                    │
  │  ContextOverflowError                              :2034           │
  │    → return "Context limit reached" gracefully                     │
  │                                                                    │
  │  Transient errors (network, 5xx, rate limit)       :2042           │
  │    classifyError(error) → { transient: true }                      │
  │    consecutiveTransientRetries++                                   │
  │    if retries < 2:                                                 │
  │      delayMs = 2^(retries-1) * 1000  (1s, 2s)                    │
  │      await sleep(delayMs)                                          │
  │      continue  ──────────────────── LOOP BACK                     │
  │    else:                                                           │
  │      throw  (propagate to caller)                                  │
  │                                                                    │
  │  All other errors                                  :2064           │
  │    → throw  (propagate to caller)                                  │
  │                                                                    │
  └─────────────────────────────────────────────────────────────────────┘
```


## Loop Exhaustion

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  AFTER WHILE LOOP EXITS                            orch.ts:2068    │
  │                                                                    │
  │  maybeSynthesizeLoopExhaustionAnswer()             orch.ts:1251    │
  │    │                                                               │
  │    ├─ precondition: toolUses.length > 0 (did something useful)    │
  │    │                                                               │
  │    ├─ inject LOOP_EXHAUSTION_FINAL_ANSWER_PROMPT                   │
  │    │    "Based on the work done so far, provide your best answer"  │
  │    │                                                               │
  │    ├─ runLlmResponsePass(messages, { disableTools: true })        │
  │    │    → LLM generates answer with tools disabled                 │
  │    │                                                               │
  │    ├─ grounding check on synthesized answer                        │
  │    │                                                               │
  │    └─ return synthesized answer                                    │
  │                                                                    │
  │  OR if no tools were used:                                         │
  │    return buildLimitStopMessage("max_iterations" | "timeout")      │
  │                                                                    │
  └─────────────────────────────────────────────────────────────────────┘
```


## All Continue/Return Sites (Summary)

```
  ┌────────────────────────────────────────────────────┬────────────────┐
  │ Site                                                │ Action         │
  ├────────────────────────────────────────────────────┼────────────────┤
  │ Post-tool execution (more work to do)              │ continue       │
  │ Empty response retry (noInputRetries < 2)          │ continue       │
  │ JSON in text retry (toolCallRetries < max)         │ continue       │
  │ Plan mode: plan drafted → review → approved/revise │ continue       │
  │ Auto-continue: suppress "may I proceed?"           │ continue       │
  │ Follow-up interaction: yes/no question             │ continue       │
  │ Working note: "next I will..."                     │ continue       │
  │ Plan advancement: STEP_DONE → next step            │ continue       │
  │ Grounding fail (strict mode): retry with warning   │ continue       │
  │ Transient error: exponential backoff               │ continue       │
  │ Context overflow during LLM: compact + retry once  │ continue       │
  ├────────────────────────────────────────────────────┼────────────────┤
  │ Final response passes grounding                    │ return answer  │
  │ Abort signal                                       │ break          │
  │ Timeout                                            │ return timeout │
  │ Context overflow (unrecoverable)                   │ return error   │
  │ Loop exhaustion → synthesize                       │ return synth   │
  │ Fatal error                                        │ throw          │
  └────────────────────────────────────────────────────┴────────────────┘
```
