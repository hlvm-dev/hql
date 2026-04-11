# Computer Use — Progress

Last updated: 2026-04-11

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
Phase 6  Bridge-First Reliability                 ██████████████████░░  MOSTLY DONE
Phase 7  Broad Repeated-Run Product Validation    █████░░░░░░░░░░░░░░░  NEXT
```

## Latest Verification Snapshot

Latest live state on 2026-04-11:

```text
Native Swift substrate:
  working

Hybrid PW -> CU pack:
  5/5 green

CU-only pack:
  previously 12/14 green in full-pack runs
  targeted reruns now green on the prior red set
```

Latest targeted findings:

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

Important harness corrections completed in this phase:

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

Delivered so far:

- `bridge.ts` resolves native GUI backend and upgrades methods in place
- fresh CU lock upgrades backend deterministically before first CU action
- native auth mismatch and lock timing issues were fixed
- executor observation can carry native target identity
- explicit deny-tool handling and hybrid promotion logic were hardened
- native app crash from duplicate running-app bundle IDs was fixed
- full hybrid live pack is green
- prior CU red cases were reduced to targeted runtime/eval bugs and fixed in isolated reruns

What this phase is about:

- not building a new substrate
- proving the existing substrate behaves correctly through `hql`
- removing remaining policy, timing, and e2e reliability bugs

## What Is Fundamentally Done

These are no longer open architecture questions:

- whether HLVM should stay browser-first for web tasks
- whether computer use should be hybrid instead of pure vision
- whether a native macOS substrate is needed beyond TS/JXA
- whether the GUI app is the right native SSOT instead of a second helper binary

Those decisions are effectively settled.

## What Is Still Open

The open work is now narrower and more engineering-focused:

- repeated-run desktop reliability
- multi-step focus/activation recovery
- timing-sensitive failures
- one final full-pack signoff run after targeted green reruns

This is a different class of work from the earlier phases:

```text
before: architecture uncertainty
now: reliability engineering
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

- keep validating focused live cases instead of repeatedly running the whole pack
- do a final CU full-pack signoff run once the targeted red set has stayed green
- continue separating genuine product bugs from environment interference

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

Phase 6+:
  is about making that architecture behave consistently under
  real use
```
