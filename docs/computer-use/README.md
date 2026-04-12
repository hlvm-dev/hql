# Computer Use — Overview

Last updated: 2026-04-12

HLVM computer use is the desktop-control subsystem that lets the agent see and
act on a macOS desktop: screenshots, mouse, keyboard, app activation, window
grounding, browser-to-desktop handoff, native AX-backed target actions, and a
bounded native subplan executor when the GUI backend is available.

The important reality now is:

- the native Swift substrate exists
- the `hql` bridge can use it
- the current chapter is reliability validation, generic Level 3 consistency,
  and reducing cloud-turn overhead, not another architecture rewrite

## Quick Links

| Document                                | Purpose                                                               |
| --------------------------------------- | --------------------------------------------------------------------- |
| [Architecture](./architecture.md)       | Full system map, pipeline diagrams, phase journey, current design     |
| [Progress](./progress.md)               | Phase timeline, current status, what is done vs still being validated |
| [Hybrid Strategy](./hybrid-strategy.md) | Browser-first `pw_*` + `pw_promote` + `cu_*` design                   |
| [Ceiling Vision](../vision/cu-ceiling.md) | Roadmap: native executor, safety, AX fusion, virtual display         |

## The Three Levels

```text
Level 1: Vision + coordinates
  Screenshot -> model guesses -> click/type/scroll by pixel

Level 2: Hybrid grounding
  Runtime also knows apps, windows, displays, frontmost app,
  browser-vs-desktop boundaries, and observation coherence

Level 3: Native substrate
  GUI app provides native AX/window/input services
  -> bridge upgrades to native routes
  -> observation/target ids can come from the native backend
```

HLVM operates at all three levels simultaneously. The system degrades
gracefully: Level 3 when HLVM.app is running, Level 2 via JXA fallback, Level 1
as pure vision baseline. All competitors (CC, ChatGPT Operator, Gemini Mariner)
operate at Level 1 or browser-only grounding. HLVM is the only system doing
desktop-level native AX grounding (Level 3).

The open work is not "invent Level 4." It is to make Level 3 consistently
reliable in live product use and to move more interaction transitions below the
LLM.

## The Phase Journey

```text
Phase 1  Tool Layer
  -> CC-style computer-use tool surface

Phase 2  Vision Gating
  -> only vision-capable models see cu_*

Phase 3  Agent Loop E2E
  -> screenshot/action loop proven end to end

Phase 4  Hybrid Browser Profiles
  -> browser_safe and browser_hybrid

Phase 5  Native Swift Substrate
  -> GUI app provides native AX/window/input routes

Phase 6  Bridge-First Reliability
  -> hql consumes the native substrate deterministically
  -> current chapter
```

## What It Can Do

Public CU surface: 26 tools

- Observation: `cu_observe`
- Screenshot: `cu_screenshot`, `cu_zoom`
- Cursor: `cu_cursor_position`
- Click: `cu_left_click`, `cu_right_click`, `cu_middle_click`,
  `cu_double_click`, `cu_triple_click`
- Mouse: `cu_mouse_move`, `cu_left_mouse_down`, `cu_left_mouse_up`,
  `cu_left_click_drag`
- Keyboard: `cu_type`, `cu_key`, `cu_hold_key`
- Grounded target actions: `cu_click_target`, `cu_type_into_target`
- Clipboard: `cu_read_clipboard`, `cu_write_clipboard`
- Scroll: `cu_scroll`
- Apps: `cu_list_granted_applications`, `cu_open_application`,
  `cu_request_access`
- Wait: `cu_wait`
- Native subplan executor: `cu_execute_plan`

Under the native GUI backend (Level 3):

- `cu_observe` returns element-level native targets as compact structured data
  (observation_id, target list with target_id/role/label/bounds)
- the LLM can then call `cu_click_target` or `cu_type_into_target` with exact
  target IDs — no pixel guessing required
- the LLM can also call `cu_execute_plan` for short deterministic native
  subplans (`open_app`, `wait_for_ready`, `find_target`, `click`, `type_into`,
  `press_keys`, `verify`)
- target IDs are backend-issued and opaque
- targets are priority-sorted: text fields/text areas surface first, then
  buttons/menus, then windows
- input, activation, permissions, window routing, and pre-action preparation
  stay on the native path
- keyboard/text continuity now fails closed when the remembered target app or
  window disappears unexpectedly

When the native backend is unavailable (Level 2 / Level 1):

- HLVM falls back to the older JXA / `osascript` / `screencapture` path
- coordinate CU still works, but with weaker grounding
- `cu_observe` returns window-level synthetic targets (Level 2) or screenshot
  only (Level 1)

## Competitive Position

```text
Claude Code (Anthropic CC):  Level 1 only — screenshot + coordinate guessing
ChatGPT Operator (OpenAI):   Browser-only — cloud browser DOM, no desktop
Gemini Mariner (Google):     Browser-only — web automation, no desktop
MS Copilot Studio:           Hosted browser + limited local device support
HLVM CU:                     Level 1 + 2 + 3 — desktop native AX grounding
```

HLVM is the only system combining desktop-level interaction with native
accessibility grounding. The grounding pipeline reduces typical CU tasks from
20+ blind coordinate clicks (2+ minutes) to 3-4 semantic tool calls (15-20s).

## Current Architecture in One Picture

```text
LLM
  -> orchestrator
  -> cu tools
  -> executor
  -> bridge
     -> native GUI CU service when available
     -> else JXA fallback
  -> macOS
```

For the full pipeline and file-level system map, read
[architecture.md](./architecture.md).

## Current Status

What is done:

- CC-style tool layer
- vision gating
- initial end-to-end CU loop
- browser-safe / browser-hybrid strategy
- native Swift substrate
- bridge/native upgrade path
- historical hybrid E2E pack is green end to end
- historical native-grounded CU pack reached 18/18 green on the pre-plan live pack
- CU harness now uses per-case timeouts instead of one shared abort budget
- CU grading distinguishes attempted/successful/failed tool executions
- **native grounding pipeline is end-to-end operational** — `cu_observe` exposes
  observation_id + target list to the LLM, enabling `cu_click_target` and
  `cu_type_into_target` to work with real AX-level targets
- `cu_execute_plan` v1 exists as an additive, Level 3-only, bounded DSL path
- keyboard/text continuity is partially hardened with fail-closed app/window
  context checks
- native target matching now has a shared descriptor path for observation and
  execute-plan target resolution

What is still being closed out:

- repeated-run live E2E reliability
- broader one-at-a-time real-user scenario coverage
- consistency between observation target extraction and execute-plan target
  resolution in edge-case AX trees
- full live product sign-off for `cu_execute_plan`
- reducing cloud-turn latency on shortcut/palette/modal workflows
- moving from "LLM orchestrates every micro-step" toward a declarative native
  interaction engine for context shifts, waits, settling, and verification

Historical baseline snapshot on 2026-04-11:

```text
Hybrid pack:  5/5 green
CU pack:      18/18 green (full-pack run)

Included 4 native-grounding and system-UI tests:
  grounded_observe_and_click     green  (3 tools, 19s)
  grounded_type_into_target      green  (4 tools, 16s)
  hlvm_spotlight_search          green  (Ctrl+Z → HLVM panel → search)
  cross_app_grounded_workflow    green  (TextEdit → Calculator → back, using native targets)
```

Current framing on 2026-04-12:

```text
architecture: settled
substrate: present and operational
native grounding: end-to-end working
native subplan executor: implemented but still being live-hardened
current work: one-at-a-time reliability loops and generic Level 3 consistency
```

Latest one-at-a-time live probes on 2026-04-12:

```text
execute_plan_cross_app_short_flow   PASS  (~22s)  cu_execute_plan only
execute_plan_open_wait_type_verify  PASS  (~18s)  safe ambiguity retry, then success
cross_app_grounded_workflow         PASS  (~40s)  grounded non-plan path still healthy
hlvm_spotlight_search               PASS  (~1m52s) safe after shortcut fixes, but too slow
```

Measured latency split:

```text
Representative local tool times:
  cu_key         ~0.3s
  cu_observe     ~0.35s
  cu_screenshot  ~0.36s
  cu_type        ~0.6s

The ugly 10-20s pauses users notice mostly come from cloud/model turns between
tools, not native input execution.
```

Current architectural reading:

```text
foundation: solid
native path: real and operational
main user-visible bottleneck: cloud-turn orchestration overhead
next generic upgrade: declarative native interaction engine
```

In plain terms, the next smart upgrade is not more app-specific fixes. It is to
move transitions such as "shortcut opens an input surface" and "type into the
focused editable target and verify" into the native executor so the LLM
specifies intent rather than every tiny step.

Important non-goal for the current chapter:

- no app-specific hardcoding
- no new escape-hotkey path; `esc-hotkey.ts` remains a stub until intentionally
  revisited

## Requirements

- macOS only
- vision-capable model for full screenshot-based CU
- Accessibility permission
- Screen Recording permission
- running `HLVM.app` if you want the native Level 3 backend instead of JXA
  fallback
