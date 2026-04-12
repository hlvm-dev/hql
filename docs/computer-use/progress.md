# Computer Use — Progress

Last updated: 2026-04-12

## Executive Summary

HLVM computer use has moved through three distinct chapters:

```text
1. Make it exist
2. Make it structurally sound
3. Make it reliable in the real product
```

Chapters 1 and 2 are largely done.

Chapter 3 is the current work.

## Status Snapshot

```text
Phase 1  Tool Layer / CC-style CU surface         ████████████████████  DONE
Phase 2  Vision Capability Gating                 ████████████████████  DONE
Phase 3  Agent Loop E2E                           ████████████████████  DONE
Phase 4  Hybrid Browser Profiles                  ████████████████████  DONE
Phase 5  Native Swift Substrate                   ████████████████████  DONE
Phase 6  Bridge-First Reliability                 ████████████████████  DONE
Phase 7  Native Grounding Pipeline                ████████████████████  DONE
Phase 8  Broad Repeated-Run Product Validation    ███████░░░░░░░░░░░░░  IN PROGRESS
```

## Latest Verification Snapshot

Historical live baseline on 2026-04-11:

```text
Native Swift substrate:       working
Native grounding pipeline:    end-to-end operational
Hybrid PW -> CU pack:         5/5 green
CU-only pack:                 18/18 green (full-pack run)
```

Current reality on 2026-04-12:

```text
Foundation / native substrate:                 working
Grounded target actions:                       working
cu_execute_plan v1:                            implemented, additive, not fully signed off
Keyboard/text continuity contract:             partially shipped
Current validation style:                      one live scenario at a time
Current broad gap:                             observation vs execute-plan target consistency
```

Additional verified reading later on 2026-04-12:

```text
execute_plan_cross_app_short_flow:            PASS (~22s, one successful cu_execute_plan)
execute_plan_open_wait_type_verify:           PASS (~18s, safe ambiguity retry then success)
cross_app_grounded_workflow:                  PASS (~40s, no failed tools)
hlvm_spotlight_search:                        PASS (~1m52s, safe but still too slow)
```

Measured latency split:

```text
Typical local tool durations:
  cu_key         ~292ms
  cu_wait(1.5s)  ~2.0s
  cu_observe     ~348ms
  cu_screenshot  ~360ms
  cu_type        ~602ms

Conclusion:
  large visible pauses are mostly cloud/model turn time, not native input time
```

### Phase 8 — Broad Product Validation (2026-04-12)

#### Architecture rule established

The CU system has a clear responsibility split:

- **Native (Swift)** preserves state, classifies elements, correlates data,
  executes actions. Does not guess user intent.
- **LLM (cloud model)** resolves user intent, disambiguates targets when
  native returns multiple candidates, decides next action.
- **TS runtime** orchestrates tools, manages sessions, passes context between
  native and LLM.

Problem taxonomy identified (5 bug classes, 4 types):

- **State preservation** — focused element, target pinning → native's job
- **Correlation** — AX-to-CG window matching → native's job
- **Classification** — is-editable, role normalization → native's job
- **Intent guessing** — which target did the user mean → LLM's job

#### Observation return (Steps 0+1) — DONE

All interactive tools now return post-action observations via the `cuTool`
wrapper. The model gets updated targets, windows, and screenshot immediately
after each action without calling `cu_observe` again.

Measured: `chained_grounded_actions` 50s → 29s (42% faster).
Zero `cu_observe` calls needed in grounded workflows.

#### Execute-plan reliability (Step 2) — MATERIALLY IMPROVED

- `observationId` passes from TS to Swift `/cu/execute-plan`
- Native `resolvePlanTarget` uses observation-backed target cache
- Target pinning: resolved targets reused across plan steps
- Blind `index:0` auto-retry removed — ambiguity returns to LLM
- Size-based disambiguation threshold raised from 2x to 10x

Measured (5x repeated runs):

```text
execute_plan_open_wait_type_verify:   5/5 first-attempt success (was ~0%)
execute_plan_cross_app_short_flow:    1/5 first-attempt, 5/5 semantic pass
```

Single-app execute-plan is now 100% reliable. Cross-app still has first-attempt
failures but always recovers.

#### Recovery safety (Step 4) — DONE

- `cuTool` wrapper retries preparation only, never the side-effecting action
- `cu_key` relaxed from window-level to app-level continuity
- Unit tests verify: fn called exactly once, verification failure doesn't
  replay, non-retryable errors pass through

#### Deferred work

- **Step 3 (read-first AX APIs)**: code removed during cleanup, will be
  reintroduced as one generic `/cu/read-target` endpoint after Step 2 is stable
- **Step 5 (semantic transitions)**: not started, depends on Steps 2-4 stable

#### Previous Phase 8 progress (earlier in 2026-04-12)

- `cu_execute_plan` v1 shipped as additive Level 3-only bounded DSL
- keyboard/text actions fail closed on target loss
- passive observation no longer overwrites explicit target context
- harness grading distinguishes attempted/successful/failed
- modifier shortcuts clear inherited typing context
- plan normalizer: auto wait_for_ready, role normalization, bundle propagation
- E2E pack expanded from 21 to 27 cases with metric logging

### Phase 7 — Native Grounding Pipeline (2026-04-11)

Critical fix: `cu_observe`'s `formatResult` was discarding all structured
observation data before it reached the LLM. The model only saw
`"Desktop observed"` + a screenshot image — no observation_id, no target
list. This made `cu_click_target` and `cu_type_into_target` impossible to
use despite being architecturally complete.

Root cause: `formatResult` set `returnDisplay` but not `llmContent`. The
formatting pipeline used `returnDisplay` as the LLM content fallback.

Fixes:

- `cu_observe` formatResult now sets `llmContent` to compact structured text
  with observation_id + prioritized target list
- `summarizeObservation` priority-sorts targets: text fields first, then
  interactive controls, then windows — ensures text inputs survive the 8K
  llmChars truncation limit
- `type_text` validator updated to accept `cu_type_into_target` as valid
  alternative (model correctly prefers grounded path when available)

Impact:

```text
Before: cu_click_target / cu_type_into_target were dead code
        Model used 20+ blind coordinate clicks, 2+ minutes
After:  3-4 grounded semantic tool calls, 15-20 seconds
```

New test cases added:

- `grounded_observe_and_click` — cu_observe → cu_click_target → cu_screenshot
- `grounded_type_into_target` — open app → cu_observe → cu_type_into_target
- `hlvm_spotlight_search` — Ctrl+Z → HLVM panel → search interaction
- `cross_app_grounded_workflow` — TextEdit → Calculator → back, using native targets

### Earlier Phase 6 findings

- `observe_basic`, `multi_app_switch`, and `drag_test`
  - original failures were traced to a shared/default runtime session id causing stale CU permission state to leak across non-persisted runs
  - fix: non-persisted runs now receive a real per-run runtime session id
- `click_and_screenshot`
  - original failure was a false-negative post-action verification on plain coordinate clicks
  - fix: coordinate clicks no longer use generic post-action verification
- `key_combo`
  - original failure first exposed the shared-session permission bug, then reduced to a deterministic eval issue: Calculator state was not guaranteed clear
  - fixes:
    - `plus` now maps semantically as shifted `=`
    - eval now explicitly instructs clearing Calculator state before entering `5 + 3`

Important harness corrections completed:

- per-case timeout budget replaced the old shared pack-wide abort signal
- E2E collectors now count only successful tool executions, so denied/failed tool attempts no longer look like successful tool usage
- fallback model creation now preserves the caller's explicit allowlist instead of widening back to the generic tier tool set

## Phase-by-Phase Journey

### Phase 1 — Tool Layer

Delivered:

- CC-style coordinate computer-use tool surface
- 22 base tools plus HLVM observation-first additions
- consistent parameter shapes and result semantics

Why it mattered:

- HLVM stopped being a custom one-off CU implementation
- the system gained a recognizable substrate the orchestrator could build on

### Phase 2 — Vision Capability Gating

Delivered:

- `visionCapable` as a first-class runtime property
- automatic CU denial for non-vision models
- image-attachment gating in the response pipeline

Why it mattered:

- stopped offering screenshot-dependent tools to models that cannot use them
- turned CU into a capability-aware system instead of a blind default

### Phase 3 — Agent Loop E2E

Delivered:

- screenshot capture -> image attachment -> LLM interpretation -> next action
- real-model live proof that the loop worked end to end

Why it mattered:

- this established that HLVM computer use was a real product, not just a tool collection

### Phase 4 — Hybrid Browser Profiles

Delivered:

- `browser_safe`
- `browser_hybrid`
- promotion path through `pw_promote`

Why it mattered:

- browser tasks stay fast and structural by default
- desktop/native interaction becomes an escalation path, not the default path

### Phase 5 — Native Swift Substrate

Delivered:

- native GUI CU service in `HLVM.app`
- native windows, targets, target actions, input, permissions, prepare-display, element-at-point
- native auth + port discovery files for bridge consumption

Why it mattered:

- this is the jump from the TS/JXA ceiling to a true native desktop substrate
- it moves HLVM from "mostly pixel guessing" toward "hybrid native + vision"

### Phase 6 — Bridge-First Reliability

Delivered:

- `bridge.ts` resolves native GUI backend and upgrades methods in place
- fresh CU lock upgrades backend deterministically before first CU action
- native auth mismatch and lock timing issues were fixed
- executor observation can carry native target identity
- explicit deny-tool handling and hybrid promotion logic were hardened
- native app crash from duplicate running-app bundle IDs was fixed
- full hybrid live pack is green
- prior CU red cases were reduced to targeted runtime/eval bugs and fixed

### Phase 7 — Native Grounding Pipeline

Delivered:

- `cu_observe` formatResult exposes structured observation data as `llmContent`
- target priority sorting ensures text inputs survive truncation
- `cu_click_target` and `cu_type_into_target` are now operationally usable
- 4 new E2E test cases validate native grounding end-to-end
- full CU pack at 18/18 green

Why it mattered:

- the native substrate (Phase 5) and bridge wiring (Phase 6) were complete,
  but the data was being discarded in the formatting layer before reaching
  the model
- this was the last gap between "architecture exists" and "model can use it"
- unlocks the core competitive advantage: semantic desktop interaction instead
  of coordinate guessing

## What Is Fundamentally Done

These are no longer open architecture questions:

- whether HLVM should stay browser-first for web tasks
- whether computer use should be hybrid instead of pure vision
- whether a native macOS substrate is needed beyond TS/JXA
- whether the GUI app is the right native SSOT instead of a second helper binary

Those decisions are effectively settled.

## What Is Still Open

The open work is now narrower and more engineering-focused:

- repeated-run desktop reliability across diverse scenarios
- multi-step focus/activation recovery edge cases
- timing-sensitive failures
- broader real-user scenario coverage beyond the historical 18-case pack
- `cu_execute_plan` live product sign-off under broader scenario variety
- reducing cloud-turn overhead on shortcut/palette/modal flows
- evolving `cu_execute_plan` from a bounded step runner toward a more semantic
  transition executor
- generic Level 3 target-surface consistency across editors/forms with weak AX
  geometry

This is a different class of work from the earlier phases:

```text
before: architecture uncertainty
now: reliability engineering and scenario breadth
```

## Current Practical Reading

How to interpret the project today:

```text
foundation:
  strong enough

native substrate:
  present

bridge integration:
  substantially in place

full product sign-off:
  not finished yet
```

## What Comes Next

### Immediate next loop

- keep validating one focused live case at a time instead of repeatedly running
  the whole pack
- continue fixing generic causes, not app-specific recipes
- do a final regression/full-pack signoff only after the current targeted loops
  have stabilized

### After that

- repeated-run real-user reliability sweeps
- multi-monitor and app-switch stability passes
- broader product hardening, not another substrate rewrite

## Short Version

```text
Phase 1-3:
  gave HLVM a working computer-use product

Phase 4-5:
  gave it the right hybrid and native architecture

Phase 6:
  made the bridge/native wiring reliable

Phase 7:
  made the native grounding data actually reach the LLM
  (the last gap between "it exists" and "the model can use it")

Phase 8:
  broader repeated-run reliability and real-user scenarios
```
