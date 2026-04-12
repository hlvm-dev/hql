# Computer Use — Ceiling Vision

> Where CU goes after the foundation is solid. Ordered by impact.

## 1. Declarative Native Interaction Engine — NEXT BIG UPGRADE

The current bottleneck is no longer raw input speed. It is that the LLM still
orchestrates too many micro-transitions.

Measured live reality:

```text
local tools are relatively fast
visible multi-second pauses mostly come from cloud/model turns between tools
```

So the next breakthrough is not more app-specific fixes. It is to move more UI
transitions below the LLM.

Examples of generic native transitions:

- shortcut opens input surface
- open app and wait ready
- focus or find editable target
- type and verify
- click and wait settle
- press keys in an expected app/window context

Each transition should own:

- preconditions
- context continuity
- wait / settle rules
- target resolution
- verification
- one local retry path

The LLM should specify intent, not every tiny step.

## 2. Native Autonomous Executor (cu_execute_plan) — SHIPPED, CORE PATHS VALIDATED

Move from `LLM → one tool → LLM → one tool` to
`LLM sets subgoal → native backend executes locally until done/blocked`.

Smart wait, settle detection, actionability checks, self-healing targets, and
local retries all live below the LLM.

Status: v1 shipped. Bounded DSL with 7 step ops, capability-gated, Level 3
only. Additive tool, foundation unchanged. Core flows now validate live:
open-app -> wait -> find -> type -> verify, grounded observed-target plans,
and shortcut-surface flows. The remaining work is broader repeated-run product
coverage plus evolving it into the more semantic interaction engine above.

## 3. Fail-Closed Interaction Continuity — PARTIALLY SHIPPED

Generic continuity contract: keyboard/text actions fail closed when the
interaction context (app + window) is lost unexpectedly.

- Bundle-level keyboard continuity: shipped (`cu_target_app_lost`)
- Passive observation guard: shipped
- Window-level keyboard continuity: shipped (`cu_target_window_lost`,
  `cu_target_context_changed`)
- Mouse/click continuity: deferred until keyboard contract is stable

## 4. Shared Native Target Model — MOSTLY SHIPPED

Observation targets and execute-plan target resolution should not drift apart.
The important generic work is to keep one target descriptor / candidate model
across:

- `cu_observe` / native target extraction
- `cu_click_target` / `cu_type_into_target`
- `cu_execute_plan` selector resolution

Current status:

- `observed_target { observation_id, target_id }` is live in `cu_execute_plan`
- target pinning and observation-age checks are live
- core grounded observe -> act -> verify consistency is working

Remaining work here is broader edge-case consistency, not the original
selector-vs-identity gap.

## 5. Read-First AX APIs — V1 SHIPPED

Add strong read primitives that don't require screenshots:

- Text field values (exact string, not OCR from pixels)
- Disabled/enabled state
- Menu contents without opening menus
- Selected text
- Scroll position
- Dialog state (which buttons exist, which is default)

Each one eliminates a screenshot + vision round-trip. Cheaper, faster, 100%
accurate.

Current status:

- `cu_read_target` is live
- native `/cu/read-target` is live
- exact grounded `value` and `enabled` reads are shipped

Remaining work is breadth: selected text, menus, scroll position, richer dialog
state.

## 6. Local Recovery Engine

When an action fails, do not immediately return to the LLM. First try local
recovery inside the native backend:

- Refocus target app
- Refresh AX tree
- Wait for target element to appear
- Re-resolve selector with stricter match
- Fall back from AX to coordinate if confidence is low
- Retry once

Only return to LLM when local recovery is exhausted.

## 7. User Safety — Scoped Input Detection

Detect real human input during CU execution. Two layers:

- **Escape key** — hard abort (CC pattern, CGEventTap). This is currently
  deferred. `esc-hotkey.ts` remains a no-op stub until the reliability chapter
  explicitly returns to it.
- **Scoped detection** — monitor input events only in CU's target app windows.
  User works freely in other apps. If user clicks into CU's target app, pause
  CU and notify.

Notification surfaces:
- CLI: print pause message with resume prompt
- GUI: native macOS notification + HLVM panel status indicator
- Menu bar: icon state change (yellow = paused)

Requires native module (CGEventTap) per platform. macOS: HLVM.app. Future
Windows/Linux: platform-specific native shell.

## 8. AX + Vision Fusion

Level 3 alone is not enough for the ceiling. Non-AX apps (games, custom
Electron UIs, canvas-based apps) return zero targets.

Fuse AX targets with vision pseudo-targets:
- OCR text regions as clickable targets
- Template matching for known UI patterns
- Combine into one unified action surface

The model sees one target list regardless of whether targets came from AX or
vision. No hard split between "grounded" and "guessing."

## 9. Semantic Desktop World Model

Keep a live graph of apps, windows, AX elements, focus, recent actions, text
values, and likely intents.

The model stops reasoning from scratch every turn. It reasons over structured
state ("the Save button in TextEdit is disabled because the document hasn't
changed") instead of a fresh screenshot blob.

This is how you get long 15+ step workflows without drift.

## 10. Virtual Display — Background CU

CU works on an invisible virtual monitor. User's real screen is untouched.

```
Real monitor (user):              Virtual monitor (CU):
┌─────────────────────┐           ┌─────────────────────┐
│ User's Slack, Chrome│           │ TextEdit, Calculator │
│ whatever they're    │           │ CU typing, clicking  │
│ doing               │           │ doing its job        │
└─────────────────────┘           └─────────────────────┘
```

User sees CU's work through a live preview in the HLVM chat window. When CU
finishes, results (saved files, data) are on the real filesystem.

Two modes:
- **Background** (virtual display): user doesn't need to see it happen.
  Default for most tasks.
- **Foreground** (real screen): user needs the result on their screen
  (window arrangement, app layout). Uses scoped detection + Escape abort.

Implementation: `CGVirtualDisplay` (macOS, private API but fine outside App
Store). Apps like BetterDummy use this in production. HLVM.app creates the
virtual display, CU tools receive its `display_id`. Everything else
unchanged — the foundation already supports multi-display.

Do this last. Get safety and reliability right on the real screen first.

## Architecture Invariant

Every item above is **additive**. The foundation does not change:

```
ReAct loop:          stays
27 cu_* tools:       stay (`cu_read_target` added; `cu_execute_plan` stays additive)
3-level fallback:    stays (Level 3 → 2 → 1)
Native AX backend:   stays (new endpoints added to it)
Hybrid browser:      stays (PW → CU escalation unchanged)
E2E tests:           stay (regression safety net)
```

Each ceiling feature is a new layer on top, not a replacement of anything
underneath.
