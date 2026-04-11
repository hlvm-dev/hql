# Computer Use — Overview

HLVM computer use is the desktop-control subsystem that lets the agent see and act on a macOS desktop: screenshots, mouse, keyboard, app activation, window grounding, browser-to-desktop handoff, and native AX-backed target actions when the GUI backend is available.

The important reality now is:

- the native Swift substrate exists
- the `hql` bridge can use it
- the current chapter is reliability validation, not another architecture rewrite

## Quick Links

| Document | Purpose |
|----------|---------|
| [Architecture](./architecture.md) | Full system map, pipeline diagrams, phase journey, current design |
| [Progress](./progress.md) | Phase timeline, current status, what is done vs still being validated |
| [Hybrid Strategy](./hybrid-strategy.md) | Browser-first `pw_*` + `pw_promote` + `cu_*` design |

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

HLVM is now operating at Level 3 on macOS. The open work is not "invent Level 4." It is to make Level 3 consistently reliable in live product use.

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

Public CU surface: 25 tools

- Observation: `cu_observe`
- Screenshot: `cu_screenshot`, `cu_zoom`
- Cursor: `cu_cursor_position`
- Click: `cu_left_click`, `cu_right_click`, `cu_middle_click`, `cu_double_click`, `cu_triple_click`
- Mouse: `cu_mouse_move`, `cu_left_mouse_down`, `cu_left_mouse_up`, `cu_left_click_drag`
- Keyboard: `cu_type`, `cu_key`, `cu_hold_key`
- Grounded target actions: `cu_click_target`, `cu_type_into_target`
- Clipboard: `cu_read_clipboard`, `cu_write_clipboard`
- Scroll: `cu_scroll`
- Apps: `cu_list_granted_applications`, `cu_open_application`, `cu_request_access`
- Wait: `cu_wait`

Under the native GUI backend:

- `cu_observe` can return element-level native targets
- target ids are backend-issued and opaque
- input, activation, permissions, window routing, and pre-action preparation can stay on the native path

When the native backend is unavailable:

- HLVM falls back to the older JXA / `osascript` / `screencapture` path
- coordinate CU still works, but with weaker grounding

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

For the full pipeline and file-level system map, read [architecture.md](./architecture.md).

## Current Status

What is done:

- CC-style tool layer
- vision gating
- initial end-to-end CU loop
- browser-safe / browser-hybrid strategy
- native Swift substrate
- bridge/native upgrade path
- hybrid E2E pack is green end to end
- CU pack harness now uses per-case timeouts instead of one shared abort budget
- CU pack validation now counts only successful tool executions

What is still being closed out:

- repeated-run live e2e reliability
- final pack-level signoff after targeted reruns
- one remaining deterministic eval hardening point:
  - `key_combo`: runtime bugs are fixed, but the eval must start from a cleared Calculator state to avoid inheriting prior calculator contents

Latest live snapshot on 2026-04-11:

```text
Hybrid pack: 5/5 green
CU pack:     previously 12/14 green in full-pack runs
Targeted reruns on prior red cases:
  observe_basic         green
  click_and_screenshot  green
  multi_app_switch      green
  drag_test             green
  key_combo             green after explicit clear-state instruction
```

That is the right framing for the project now:

```text
architecture: mostly settled
substrate: present
current work: last-mile product hardening
```

## Requirements

- macOS only
- vision-capable model for full screenshot-based CU
- Accessibility permission
- Screen Recording permission
- running `HLVM.app` if you want the native Level 3 backend instead of JXA fallback
