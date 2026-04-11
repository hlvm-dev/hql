# Multi-Agent — Teams, Delegation, Planning

## Overview

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                        MULTI-AGENT TOPOLOGY                        │
  │                                                                    │
  │                      ┌──────────────────┐                          │
  │                      │    TEAM LEAD      │                          │
  │                      │  (runReActLoop)   │                          │
  │                      │                   │                          │
  │                      │  Owns:            │                          │
  │                      │  - TeamRuntime    │                          │
  │                      │  - TeamStore      │                          │
  │                      │  - DelegateInbox  │                          │
  │                      └──┬──────┬──────┬─┘                          │
  │                         │      │      │                            │
  │              ┌──────────┘      │      └──────────┐                 │
  │              ▼                 ▼                  ▼                 │
  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐          │
  │  │  TEAMMATE A   │  │  TEAMMATE B   │  │  TEAMMATE C   │          │
  │  │  (teammate    │  │  (teammate    │  │  (background   │          │
  │  │   loop)       │  │   loop)       │  │   delegate)   │          │
  │  │               │  │               │  │               │          │
  │  │  Owns:        │  │  Owns:        │  │  fire-and-    │          │
  │  │  - own ReAct  │  │  - own ReAct  │  │  forget       │          │
  │  │  - own tools  │  │  - own tools  │  │  result →     │          │
  │  │  - task claim │  │  - task claim │  │  inbox        │          │
  │  └───────────────┘  └───────────────┘  └───────────────┘          │
  │                                                                    │
  │  Communication via:                                                │
  │    TeamRuntime   → message queues (file-backed)                    │
  │    TeamStore     → task board (file-backed)                        │
  │    DelegateInbox → background results (in-memory)                  │
  │                                                                    │
  └─────────────────────────────────────────────────────────────────────┘
```


## Drain Operations (Every Loop Iteration)

These inject external signals into the lead agent's context.
For solo agents, all are no-ops.

```
  ┌── ITERATION START ──────────────────────────────────────────────────┐
  │                                                                     │
  │  1. delegateInbox.drain()                          orch.ts:1594    │
  │     └─ Background delegates that finished while LLM was thinking   │
  │        Formatted: "[Runtime Update] worker-1 completed 'task'"     │
  │                                                                     │
  │  2. teamRuntime.deriveSummary()                    orch.ts:1602    │
  │     └─ Team status: members, tasks, blocked, approvals             │
  │        Only injected if signature changed (dedup)                   │
  │        Guarded by hasMeaningfulTeamSummary()                       │
  │                                                                     │
  │  3. inputQueue.splice(0)                           orch.ts:1631    │
  │     └─ Parent→child steering messages                              │
  │        Prefixed: "[Parent Message]"                                │
  │                                                                     │
  │  4. teamRuntime.readMessages()                     orch.ts:1640    │
  │     └─ Teammate→member messages (DMs, notifications)               │
  │        Formatted: "[Team task_completed] worker-1: done with X"    │
  │                                                                     │
  │  5. teamRuntime.getPendingShutdown()               orch.ts:1658    │
  │     └─ Graceful shutdown request from coordinator                   │
  │        Agent summarizes work and exits                              │
  │                                                                     │
  │  6. teamRuntime.forceExpiredShutdowns()            orch.ts:1675    │
  │     └─ Lead-only: expire idle members past timeout                 │
  │        cancelThread() for each expired member                      │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```


## Delegation Signal

```
  evaluateDelegationSignal(request)        delegation-heuristics.ts:61
    │
    ├─ requestLooksLikeBrowserAutomation()?   → taskDomain: "browser"
    │    URL patterns, browser verbs, pw_*/cu_* tool names
    │    fallback: classifyBrowserAutomation() via local LLM
    │
    ├─ extractMentionedFilePaths() ≥ 3?       → fan-out delegation
    │
    ├─ PARALLEL_CUE_PATTERN match?            → fan-out
    │    "in parallel", "concurrently", "simultaneously"
    │
    ├─ BATCH_CUE_PATTERN match?               → batch
    │    "each of these files", "across all files"
    │
    └─ classifyDelegation() via local LLM     → semantic classification
         temp=0, maxTokens=64, ~50-200ms

    Returns:
    {
      taskDomain:      "browser" | "general",
      shouldDelegate:  boolean,
      suggestedPattern: "fan-out"|"specialist"|"batch"|"sequential"|"none",
      estimatedSubtasks?: number,
      reason:          string
    }
```


## Teammate Execution Loop

```
  runTeammateLoop(options)                 team-executor.ts:146
    │
    │  ┌── WHILE (not aborted) ─────────────────────────────────────┐
    │  │                                                             │
    │  │  1. Check shutdown                                         │
    │  │     getPendingShutdown()?                                   │
    │  │       YES → acknowledge + exit                              │
    │  │                                                             │
    │  │  2. Drain inbox                                            │
    │  │     Read file-based inbox messages                          │
    │  │     Check for shutdown_request kind                         │
    │  │                                                             │
    │  │  3. Find work                                              │
    │  │     store.listTasks()                                       │
    │  │       filter: status=pending, unblocked, unowned            │
    │  │       sort by ID (FIFO)                                     │
    │  │                                                             │
    │  │  4. No tasks?                                              │
    │  │     sendNotification("idle_notification")                   │
    │  │     sleep(idlePollIntervalMs)  ← 3s default, 10ms in tests │
    │  │     if polled maxIdlePolls times → exit "no_work"           │
    │  │                                                             │
    │  │  5. Claim task                                             │
    │  │     store.updateTask(id, {status:"in_progress", owner:me}) │
    │  │                                                             │
    │  │  6. Execute                                                │
    │  │     Create child LLM + context                              │
    │  │     runReActLoop(task.description, childConfig, childLLM)   │
    │  │       └─ SAME react loop, restricted tools                  │
    │  │                                                             │
    │  │  7. Notify outcome                                         │
    │  │     notifyTaskOutcome(task, result, "completed"|"error")    │
    │  │     emit UI events                                          │
    │  │                                                             │
    │  └─────────────────────────────── LOOP ────────────────────────┘
    │
    └─ return { tasksCompleted, exitReason }
```


## Planning System

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  PLANNING MODES                                                    │
  │                                                                    │
  │  "off"     → never plan                                            │
  │  "auto"    → plan if request has cues or LLM classifies as multi-  │
  │               step (shouldPlanRequest via classifyPlanNeed)         │
  │  "always"  → always plan before executing                          │
  │                                                                    │
  └─────────────────────────────────────────────────────────────────────┘


  PLANNING FLOW:

  shouldPlanRequest(request, mode)               planning.ts:76
    │
    ├─ mode="always"? → true
    ├─ cue patterns? ("first...then", "step 1...step 2") → true
    └─ classifyPlanNeed(request) via local LLM → true/false

                    │ true
                    ▼
  requestPlan(llm, messages, request, config)    planning.ts:216
    │
    ├─ Call LLM with planning prompt (tools disabled)
    ├─ Parse PLAN...END_PLAN JSON block
    │    { steps: [{id, title, goal, tools, successCriteria, agent}] }
    └─ Return Plan or null

                    │ Plan found
                    ▼
            ┌───────┴──────────┐
        mode="always"     mode="auto"
            │                  │
            ▼                  ▼
  createPlanState(plan)    inject plan as context
  { plan, currentIndex:0,  (model uses it as guidance
    completedIds: Set(),    but not enforced)
    delegatedIds: Set() }


  PLAN EXECUTION (mode="always"):

  ┌── EACH ITERATION ────────────────────────────────────────────────┐
  │                                                                   │
  │  currentStep = plan.steps[currentIndex]                           │
  │                                                                   │
  │  Has agent=X?                                                     │
  │    YES → executeToolCall("delegate_agent", {task: step.goal})    │
  │          delegatedIds.add(step.id)                                │
  │          continue (skip LLM this turn)                            │
  │                                                                   │
  │    NO  → LLM executes step directly                               │
  │          On completion: LLM writes "STEP_DONE step-1"            │
  │                                                                   │
  │  extractStepDoneId(response) → "step-1"                           │
  │  advancePlanState(state, "step-1")                                │
  │    currentIndex++ (if matches current step)                       │
  │    completedIds.add("step-1")                                     │
  │                                                                   │
  │  More steps?                                                      │
  │    YES → inject next-step directive, continue                     │
  │    NO  → plan finished, return final response                     │
  │                                                                   │
  └───────────────────────────────────────────────────────────────────┘


  PLAN REVIEW (when permissionMode="plan"):

    LLM drafts plan
         │
         ▼
    handleDraftedPlan()                        orch-response.ts:805
         │
         ├─ config.planReview.ensureApproved(plan)
         │    → user sees plan, chooses: approve / revise / cancel
         │
         ├─ APPROVED:
         │    createPlanState(plan)
         │    derivePlanExecutionAllowlist(plan)
         │    updateToolProfileLayer("plan", {allowlist})
         │    requireStepMarkers = true
         │    inject "Plan approved. Execute step 1."
         │
         ├─ REVISE:
         │    inject revision prompt
         │    continue (LLM redrafts)
         │
         └─ CANCELLED:
              return cancellation message
```


## Delegation Dispatch Paths

```
  Tool: delegate_agent                 orch-tool-exec.ts:665
    │
    └─ config.delegate(agentProfile, task, options)
         └─ creates child session with restricted tools
            calls runReActLoop with child config
            result returned to parent's context

  Tool: batch_delegate                 orch-tool-exec.ts:900
    │
    └─ fan-out N delegates in parallel (concurrency limited)
         each gets own session + context
         results collected and formatted

  Tool: interrupt_agent                orch-tool-exec.ts:782
    │
    └─ cancel running delegate thread
         inject resume directive if needed

  Background delegate:
    │
    └─ config.delegate() with background=true
         result → delegateInbox (in-memory queue)
         drained at next iteration boundary
```
