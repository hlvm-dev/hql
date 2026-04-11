# Computer Use — Architecture

## Current Thesis

HLVM computer use is no longer "just screenshots plus clicks."

It is now a layered desktop-control stack with three conceptual levels:

```text
Level 1: Vision + coordinates
  LLM sees screenshot
  -> chooses pixel actions
  -> bridge sends mouse/keyboard events

Level 2: Hybrid grounding
  Same vision loop
  -> but runtime also knows windows, apps, displays, frontmost app,
     browser-vs-desktop boundaries, and target/window coherence

Level 3: Native substrate
  GUI app exposes native AX/window/input services
  -> bridge upgrades to native routes when available
  -> target ids can come from native observation instead of being fabricated
```

The current architecture is:

- Level 3 substrate on macOS is in place
- `hql` can consume that substrate through the bridge
- the remaining work is product reliability, not another substrate rewrite

## Current Live Validation State

As of 2026-04-11, the architecture is fully operational including native
grounding:

```text
Native Swift substrate:       working
Native grounding pipeline:    end-to-end operational
Bridge-first hybrid pack:     5/5 green
CU-only live pack:            18/18 green (full-pack run)
```

### Critical fix: cu_observe grounding data exposure (2026-04-11)

The native grounding pipeline (Level 3) was architecturally complete but
**operationally broken**: `cu_observe`'s `formatResult` returned only
`"Desktop observed"` as the LLM-visible content, discarding the structured
observation data (observation_id, targets, windows). This meant
`cu_click_target` and `cu_type_into_target` were impossible to use — the
model never received the target IDs they require.

Root cause: `formatResult` set `returnDisplay: "Desktop observed"` without
setting `llmContent`. The formatting pipeline at
`orchestrator-tool-formatting.ts:484` used `returnDisplay` as the LLM
content when `llmContent` was absent.

Fix: `cu_observe`'s `formatResult` now sets `llmContent` to a compact
structured text format:

```text
observation_id: ABC-123
frontmost: TextEdit (com.apple.TextEdit)
windows:
  - id:5522 Untitled
targets (use exact target_id with cu_click_target / cu_type_into_target):
  - target_id: t:ax:5522:textArea:0  role:textArea  label:"main text"  [0,44,800,556]
  - target_id: t:ax:5522:button:1    role:button    label:"Close"      [7,3,14,16]
grounding: native_targets
```

Second fix: `summarizeObservation` now priority-sorts targets — text
fields/text areas first, then interactive controls, then windows. This
ensures text input targets survive the 8K llmChars truncation limit.

Impact:

```text
Before: 24 blind coordinate clicks, 2+ minutes, frequent failures
After:  3-4 grounded tool calls, 15-20 seconds, reliable
```

### Earlier fixes in this phase

- explicit CU-only allowlists are no longer masked by browser-domain profiling
- non-persisted runs now get a real per-run runtime session id, which avoids
  stale CU permission state leaking across runs
- plain coordinate clicks no longer use overly strict generic post-action
  verification
- Calculator key-entry flows now recognize `plus` semantically, and the eval
  explicitly starts from a cleared Calculator state
- per-case timeout budget replaced the old shared pack-wide abort signal
- `type_text` validator accepts `cu_type_into_target` as valid alternative to
  `cu_type` (the model correctly prefers the grounded path when available)

## Journey

### Phase 1: Tool Layer

Goal:

- make HLVM expose a real Claude Code style computer-use surface instead of a custom one-off tool set

What changed:

- adopted the 22-tool Anthropic-style coordinate suite
- added 3 HLVM grounded tools:
  - `cu_observe`
  - `cu_click_target`
  - `cu_type_into_target`
- aligned parameter shapes and tool semantics with the CC-style substrate

Result:

- HLVM had a usable desktop-control API
- but this was still fundamentally a vision-plus-coordinates system

### Phase 2: Vision Capability Gating

Goal:

- stop offering computer use to models that cannot interpret screenshots

What changed:

- `visionCapable` became a first-class session/runtime property
- non-vision models automatically lose `cu_*`
- image attachments are suppressed or text-fallbacked when vision is absent

Result:

- the system stopped failing in avoidable ways on text-only models
- CU became a capability-aware feature instead of a blind default

### Phase 3: Agent Loop E2E

Goal:

- prove the full loop works: prompt -> tool call -> screenshot -> image attachment -> model interpretation -> next action

What changed:

- CU prompt guidance was added to the self-hosted prompt pipeline
- real-model live runs proved screenshot capture and interpretation worked end to end

Result:

- HLVM had a working computer-use product
- but it was still mostly a Level 1 system with some runtime discipline on top

### Post-Phase-3 Chapter: Hybrid and Native Substrate

After the initial end-to-end loop worked, the work split into two harder problems:

1. browser tasks should stay Playwright-first and only escalate to desktop/native control when necessary
2. macOS desktop control needed a stronger substrate than TS/JXA alone could provide

That led to two important chapters:

- hybrid browser profiles:
  - `browser_safe`
  - `browser_hybrid`
- native Swift GUI substrate:
  - window metadata
  - AX targets
  - native input
  - native pre-action preparation

This is the shift from:

```text
"The model sees pixels and guesses"
```

to:

```text
"The model still sees pixels, but the runtime can also ground actions in
 windows, apps, displays, and native targets."
```

## Current System Map

```text
User request
  |
  v
LLM (vision-capable)
  |
  | native structured tool calls
  v
+------------------------------------------------------------------+
| HLVM orchestrator                                                |
|                                                                  |
|  runReActLoop                                                    |
|  orchestrator-response.ts                                        |
|  orchestrator-tool-execution.ts                                  |
|                                                                  |
|  Responsibilities:                                               |
|  - tool policy and visibility                                    |
|  - browser recovery / promotion                                  |
|  - image attachment injection                                    |
|  - turn loop / retries / grounding checks                        |
+------------------------------------------------------------------+
  |
  v
+------------------------------------------------------------------+
| CU tool layer (tools.ts)                                         |
|                                                                  |
|  Public surface: 25 cu_* tools                                   |
|                                                                  |
|  Responsibilities:                                               |
|  - argument validation                                           |
|  - lock acquisition                                              |
|  - stale observation / target checks                             |
|  - permission gating                                             |
|  - post-action verification hooks                                |
+------------------------------------------------------------------+
  |
  v
+------------------------------------------------------------------+
| Executor (executor.ts)                                           |
|                                                                  |
|  Responsibilities:                                               |
|  - observation assembly                                          |
|  - screenshot sizing                                             |
|  - CC-derived input choreography                                 |
|  - clipboard typing fallback                                     |
|  - movement / modifier / drag semantics                          |
|                                                                  |
|  Observation result SSOT: DesktopObservation                     |
+------------------------------------------------------------------+
  |
  v
+------------------------------------------------------------------+
| Bridge (bridge.ts)                                               |
|                                                                  |
|  Responsibilities:                                               |
|  - backend detection                                             |
|  - native GUI auth + port discovery                              |
|  - native route client                                           |
|  - JXA fallback                                                  |
|  - live upgrade of input/apps/permissions/window methods         |
+------------------------------------------------------------------+
  |
  +-------------------------- native path -------------------------+
  |                                                               |
  |  ~/.hlvm/cu-native-port                                       |
  |  ~/.hlvm/cu-native-auth-token                                 |
  v                                                               |
+------------------------------------------------------------------+
| HLVM.app native CU service (Swift/AppKit/AX)                    |
|                                                                  |
|  Native capabilities:                                            |
|  - /cu/windows                                                   |
|  - /cu/targets                                                   |
|  - /cu/click-target                                              |
|  - /cu/type-into-target                                          |
|  - /cu/prepare-display                                           |
|  - /cu/element-at-point                                          |
|  - /cu/frontmost                                                 |
|  - /cu/permissions                                               |
|  - /cu/input/*                                                   |
+------------------------------------------------------------------+
  |
  +-------------------------- fallback path -----------------------+
  |
  v
+------------------------------------------------------------------+
| JXA / osascript / screencapture                                  |
|                                                                  |
|  Fallback responsibilities:                                      |
|  - screenshot capture                                            |
|  - CGEvent-style input                                           |
|  - NSWorkspace / CGWindow metadata via scripting bridge          |
+------------------------------------------------------------------+
  |
  v
macOS desktop
```

## The Current Observation Pipeline

The most important runtime object is `DesktopObservation`.

It is the grounded read-model the LLM acts against.

```text
cu_observe
  |
  +-> acquire CU lock
  |    -> resolve backend
  |    -> if native GUI available, upgrade bridge methods
  |
  +-> executor.observe()
       |
       +-> frontmost app
       +-> display geometry
       +-> screenshot
       +-> visible windows
       +-> permission state
       +-> choose native target context
       +-> if native backend available:
       |      fetch /cu/targets(bundleId, windowId?)
       |      -> backend-issued observationId
       |      -> backend-issued targetIds
       |
       +-> else:
              synthesize window targets locally
              -> runtime-issued observationId

  => DesktopObservation {
       observationId,
       groundingSource: "native_targets" | "window_fallback",
       screenshot,
       display,
       frontmostApp,
       runningApps,
       windows,
       targets,
       permissions,
       resolvedTargetBundleId?,
       resolvedTargetWindowId?
     }
```

Important consequences:

- observation IDs and target IDs must be treated as opaque
- callers must not assume any particular string shape
- stale observation reuse is a runtime bug, not just a prompt bug
- the `formatResult` for `cu_observe` produces compact `llmContent` with
  observation_id + targets — this is what the LLM actually sees
- targets are priority-sorted: textField/textArea/searchField first, then
  interactive controls, then windows — ensures text inputs survive truncation
- the `returnDisplay` ("Desktop observed") is only for the TUI summary

## Action Pipelines

### Coordinate action path

Used when:

- the model only has visual grounding
- native targets are unavailable
- an action is inherently coordinate-based

```text
cu_left_click / cu_type / cu_scroll / cu_drag / ...
  -> tool validation
  -> permission + focus checks
  -> executor
  -> bridge input API
  -> native GUI input route if available
  -> else JXA/CGEvent fallback
```

### Target action path

Used when:

- `cu_observe` returned grounded targets
- the runtime can act semantically on a target id

```text
cu_click_target / cu_type_into_target
  -> validate observation_id + target_id
  -> route through bridge/native helper path
  -> Swift AX action if native target is resolvable
  -> else fallback behavior only when policy allows it
  -> verify outcome
```

This is the biggest architectural difference from the early CU stack:

- earlier: "click pixel center"
- now: "act on a runtime-grounded target when structure exists"

## Browser Hybrid Architecture

HLVM does not treat browser automation and desktop automation as the same lane.

It uses a two-stage browser strategy:

```text
Layer A: browser_safe
  - pw_* only
  - headless / structural browser control
  - no CU unless repeated visual/native blocker appears

Layer B: browser_hybrid
  - pw_* + pw_promote + cu_*
  - only activated on repeated visual/native blocker
```

Pipeline:

```text
browser request
  -> domain profile = browser_safe
  -> Playwright tries structural/browser actions
  -> repeated visual/native failure
  -> promote to browser_hybrid
  -> pw_promote
  -> fresh cu_observe / cu_screenshot
  -> desktop/native interaction
  -> if useful, return to pw_* for structured reading
```

This matters because:

- Playwright is faster and more precise when the DOM is usable
- desktop CU is the fallback for:
  - canvas-only UI
  - native dialogs
  - browser-visible interactions
  - headless/browser mismatch

## Backend Detection and Upgrade

The bridge does not assume the native app is running.

It resolves backend like this:

```text
fresh CU lock
  -> invalidate cached backend resolution
  -> read HLVM_CU_PORT or ~/.hlvm/cu-native-port
  -> read auth token (env or ~/.hlvm/cu-native-auth-token)
  -> GET /cu/capabilities

if success:
  backend = native_gui
  upgrade bridge methods in place
else:
  backend = jxa
```

Native upgrade currently covers:

- `prepareDisplay`
- `appUnderPoint`
- `listVisibleWindows(displayId?)`
- permissions
- frontmost app
- app activation
- native input

This is the core reason the current system is stronger than the original TS/JXA-only version:

- the runtime still has fallback behavior
- but it no longer depends on fallback for the primary happy path

## Files That Matter

In `hql`:

```text
src/hlvm/agent/computer-use/
  tools.ts        public CU tools, validation, recovery, gating
  executor.ts     DesktopObservation assembly and CC-derived action logic
  bridge.ts       backend detection, native routing, fallback
  lock.ts         fresh-lock backend upgrade
  cleanup.ts      post-turn cleanup
  types.ts        DesktopObservation / WindowInfo / ObservationTarget / contracts
```

In `HLVM.app`:

```text
HLVM/Shared/Infrastructure/ComputerUse/
  CUNativeService.swift
  CURouter.swift
  CUWindowService.swift
  CUInputService.swift
  CUPermissionService.swift
```

## What Is Actually Finished vs Not Finished

Finished:

- Level 1 tool layer (coordinate-based CU)
- Level 2 hybrid grounding (JXA window-level targets)
- Level 3 native substrate (AX element-level targets)
- vision gating
- initial end-to-end screenshot/action loop
- hybrid browser architecture (browser_safe / browser_hybrid)
- native Swift substrate in HLVM.app
- bridge/native wiring for the main CU paths
- **native grounding data pipeline** — `cu_observe` exposes structured targets
  to the LLM, enabling `cu_click_target` and `cu_type_into_target`
- target priority sorting (text inputs surface first)
- graceful degradation: Level 3 → Level 2 → Level 1

Not yet fully signed off:

- broad repeated-run live reliability
- every hybrid edge case across many prompts and models
- every multi-monitor / timing / stale-target recovery path

That distinction matters.

The architecture chapter is complete.
The product-quality chapter is still in progress.

## Competitive Landscape

```text
Claude Code (Anthropic):     Desktop, Level 1 only (screenshot + coordinates)
                             Same ReAct loop. No AX targets. No grounding.
                             Uses @ant/computer-use-input (Rust/enigo) +
                             @ant/computer-use-swift for native modules.
                             Runs CU as MCP server in subprocess.

ChatGPT Operator (OpenAI):   Browser-only (cloud browser, CUA model on GPT-4o)
                             Cannot touch desktop apps. Web pages only.

Gemini Mariner (Google):     Browser-only (web automation via API)
                             No desktop interaction.

MS Copilot Studio:           Hosted browser via Windows 365 + optional local
                             device support. Public preview.

HLVM CU:                     Desktop + browser. All three levels.
                             Native AX grounding when HLVM.app is running.
                             Only system doing desktop-level semantic targets.
```

## Short Version

```text
Phase 1-3 gave HLVM a working computer-use product.

The later native chapter gave it a real substrate:
  native windows
  native targets
  native input
  native pre-action preparation

The grounding fix (2026-04-11) made that substrate actually
reachable by the LLM — before, the data existed but was
discarded before the model could see it.

Result: 3-4 semantic tool calls where competitors need 20+
blind coordinate clicks for the same task.
```
