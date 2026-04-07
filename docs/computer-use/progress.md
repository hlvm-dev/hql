# Computer Use — Progress & Roadmap

Last updated: 2026-04-07

## Status Summary

```
Phase 1: Tool Layer (CC Clone)          ████████████████████ 100%  DONE
Phase 2: Vision Capability Gating       ░░░░░░░░░░░░░░░░░░░░   0%  TODO
Phase 3: Agent Loop E2E                 ░░░░░░░░░░░░░░░░░░░░   0%  TODO
Phase 4: Hybrid Playwright + CU         ░░░░░░░░░░░░░░░░░░░░   0%  TODO
Phase 5: Cross-Platform                 ░░░░░░░░░░░░░░░░░░░░   0%  FUTURE (CC is also macOS-only)
```

---

## Phase 1: Tool Layer (CC Clone) — COMPLETE

**Date completed:** 2026-04-07
**Commit before:** `a72cb48` (v1: 10 tools, "to be replaced")

### What Was Done

**V1 (replaced):** 10 custom tools with HLVM-invented parameter shapes
- `cu_click` (combined button/count/modifiers)
- `cu_drag` (from_x/from_y/to_x/to_y)
- `cu_clipboard_read`, `cu_clipboard_write`
- `cu_get_frontmost_app`

**V2 (current):** 22 tools matching CC's `computer_20250124` Anthropic SDK spec
- All parameter names match SDK: `coordinate: [x,y]`, `scroll_direction`, `region: [x1,y1,x2,y2]`
- All descriptions copied from Anthropic SDK
- Result summaries copied from CC's `toolRendering.tsx`
- Click family split into 5 separate tools (left/right/middle/double/triple)
- New tools: `cu_cursor_position`, `cu_left_mouse_down`, `cu_left_mouse_up`, `cu_hold_key`, `cu_zoom`, `cu_open_application`, `cu_request_access`, `cu_wait`

### Files Modified
- `src/hlvm/agent/computer-use/tools.ts` — Full rewrite (437 → 1023 lines)
- `tests/unit/agent/computer-use.test.ts` — Updated tool registration tests

### Verification
- `deno check` — passes
- `ssot:check` — 0 errors
- 44/44 unit tests pass
- 13/13 E2E smoke tests pass on real macOS (screenshot, click, drag, scroll, clipboard round-trip, zoom, cursor tracking, mouse press/release)

### CC Source Parity Audit
| Aspect | Status |
|--------|--------|
| Tool count (22) | Match |
| Parameter names (SDK spec) | Match |
| Result summaries (toolRendering.tsx) | Identical |
| `type` viaClipboard default | Match (hardcoded true) |
| `key` uses `text` param (not `key`) | Match |
| `hold_key` wraps `[text]` for executor | Correct |
| Scroll direction → dx/dy conversion | Match |
| Image attachment structure | Identical |

### What Already Existed (Not Modified)
- `executor.ts` — CC-clone ComputerExecutor (1:1)
- `bridge.ts` — macOS native bridge (osascript CGEvent)
- `lock.ts` — Session lock management
- `cleanup.ts` — Post-turn cleanup
- `common.ts`, `types.ts`, `keycodes.ts`, `app-names.ts`
- `drain-run-loop.ts`, `esc-hotkey.ts` (stubs)
- Orchestrator image pipeline (`_imageAttachment` extraction + injection)

---

## Phase 2: Vision Capability Gating — TODO

**Problem:** Images are sent to ALL models unconditionally. Text-only models (e.g., `llama3.1:8b`) will crash when receiving image attachments.

**Current state:**
- `auto-select.ts` has `ModelCaps.vision` tracking
- `orchestrator-response.ts` injects images WITHOUT checking vision capability
- `convertToSdkMessages()` converts images WITHOUT capability check
- Non-vision models get `{ type: "image", image: base64 }` → API error

### Tasks

1. **Pass vision capability through pipeline**
   - `auto-select.ts` already detects `vision` in `ModelCaps`
   - Need to thread `modelVisionCapable: boolean` through `session.ts` → `orchestrator-response.ts`

2. **Gate image injection**
   - In `orchestrator-response.ts`: check `modelVisionCapable` before injecting `_imageAttachment`
   - Fallback: inject text-only description `"[Screenshot: 1280x720 JPEG, 36KB]"` for non-vision models

3. **Gate in SDK conversion**
   - In `convertToSdkMessages()`: strip `{ type: "image" }` parts when model lacks vision
   - Or: never inject in the first place (option 2 above)

4. **Disable CU tools for non-vision models**
   - CU tools are useless without vision — agent can't interpret screenshots
   - Hide `cu_*` from tool list when model lacks vision capability
   - Or: `cu_screenshot` returns text description instead of image

### Estimated scope
- 3-4 files modified
- ~50-100 lines changed
- Low risk (additive gating, no behavioral change for vision models)

---

## Phase 3: Agent Loop E2E — TODO

**Problem:** Tool layer works in isolation, but the full agent loop (`hlvm ask "do X on screen"`) has not been tested end-to-end.

**What "full E2E" means:**
```
User prompt
  → LLM receives system prompt with CU tools
  → LLM decides to call cu_screenshot
  → Orchestrator executes tool, extracts _imageAttachment
  → Response builder injects image as user message
  → LLM sees screenshot, decides next action (cu_left_click at x,y)
  → Orchestrator executes click
  → LLM calls cu_screenshot again to verify
  → Loop continues until task is done
  → LLM responds to user with result
```

### Tasks

1. **Smoke test: `hlvm ask` with CU tools**
   - `hlvm ask "take a screenshot and tell me what you see"`
   - `hlvm ask "open TextEdit and type hello world"`
   - Requires vision-capable model (Claude, GPT-4o, Gemini Pro Vision)

2. **System prompt CU guidance**
   - Add CU-specific instructions to system prompt when CU tools are available
   - E.g., "Always take a screenshot before clicking. Use coordinates from the most recent screenshot."
   - Check if CC has specific CU system prompt sections to copy

3. **Multi-turn CU loop stability**
   - Test 5+ tool calls in sequence
   - Verify images don't bloat context (compaction handles images?)
   - Verify lock lifecycle across multi-turn sessions

4. **Error recovery**
   - What happens when screenshot fails mid-loop?
   - What happens when click lands on wrong element?
   - Agent should retry with fresh screenshot

### Estimated scope
- System prompt changes: 1-2 files
- Smoke test script: new file
- Stability fixes: unknown until tested

---

## Phase 4: Hybrid Playwright + CU — TODO

**Goal:** Per-subtask routing where Playwright handles fast/deterministic browser actions and CU handles native/visual tasks.

**NOT a fallback chain.** The approach:
```
Task = [subtask1, subtask2, ..., subtaskN]

For each subtask:
  1. Try Playwright first (fast, deterministic, instant success/fail)
  2. If Playwright fails → CU loop (screenshot → decide → act → verify)
  3. Repeat CU until subtask succeeds
  4. Next subtask
```

**Why hybrid is better than either alone:**

| Scenario | Playwright | CU | Winner |
|----------|-----------|-----|--------|
| Navigate to URL | `page.goto()` instant | Type in address bar | Playwright |
| Click by selector | Instant, reliable | Screenshot → coordinate | Playwright |
| Read page content | DOM access | OCR from pixels | Playwright |
| Fill forms | Direct value set | Keystroke by keystroke | Playwright |
| Wait for network | Built-in | Blind sleep | Playwright |
| Native download dialog | Can't see it | Can see + click | CU |
| Non-browser apps | Can't | Full control | CU |
| CAPTCHAs | Struggles | Sees what user sees | CU |
| System popups | Invisible | Can handle | CU |

### Tasks

1. **Playwright tool integration**
   - Add Playwright-based tools: `pw_goto`, `pw_click`, `pw_fill`, `pw_content`, `pw_wait_for`
   - Each returns success/failure deterministically
   - Already have `playwright-support.ts` for Chromium installation

2. **Subtask decomposition**
   - Agent (or orchestrator) breaks task into subtasks
   - Each subtask tagged with preferred approach (playwright/cu/either)

3. **Routing logic**
   - Try Playwright first for browser subtasks
   - On Playwright failure → switch to CU for that subtask
   - CU retries with screenshot loop until subtask verified

4. **Browser session management**
   - Playwright browser lifecycle (launch, page, close)
   - Share browser state between Playwright subtasks
   - CU can interact with the same browser Playwright opened

### Estimated scope
- New tools: 5-8 Playwright tools
- Routing logic: new module
- Integration: orchestrator changes
- Medium-large effort

---

## Phase 5: Cross-Platform — FUTURE

**Current:** macOS-only (platform guard rejects non-Darwin)

**CC is also macOS-only.** Despite using Rust (enigo) for input, CC gates it to macOS (`isSupported: false` on non-darwin). The Swift layer (`SCContentFilter`, `NSWorkspace`) is fundamentally macOS-only with no Linux/Windows alternatives in CC's codebase.

**CC's native stack:**
| Layer | CC Package | Platform |
|-------|-----------|----------|
| Input (keyboard/mouse) | `@ant/computer-use-input` (Rust/enigo) | Enigo supports Linux/Windows, but CC disables it |
| Screenshots | `@ant/computer-use-swift` (Swift `SCContentFilter`) | macOS-only, throws on non-darwin |
| App management | Swift (`NSWorkspace`, `NSScreen`) | macOS-only |
| Permissions | Swift TCC checks | macOS-only |

**What cross-platform would require:**
- Linux: `xdotool`/`ydotool` (input) + `scrot`/Wayland screencopy (screenshots) + `wmctrl` (apps)
- Windows: Win32 `SendInput` (input) + DXGI/GDI (screenshots) + Win32 API (apps)
- Abstraction layer in `bridge.ts` to swap per-platform (currently hardcoded to osascript)

**Not prioritized.** Neither CC nor HLVM has this. macOS is the primary development platform.

---

## Known Gaps & Issues

### Critical
- **No vision capability gating** — images sent to all models, text-only models crash (Phase 2)
- **No full E2E test** — tool layer verified, agent loop untested (Phase 3)

### Important
- **`cu_request_access` is a stub** — returns a helpful message but doesn't actually open System Preferences or trigger permission dialogs
- **No CU-specific system prompt** — agent doesn't receive guidance on how to use CU tools effectively (always screenshot first, use coordinates from latest screenshot, etc.)
- **Context bloat** — screenshots are ~30-150KB base64, multiple screenshots per task could fill context window. Need to verify compaction handles image messages properly.

### Minor
- `drain-run-loop.ts` is a no-op — CC uses this to drain Swift's main run loop between operations. HLVM's osascript bridge doesn't need it, but the call sites remain for CC parity.
- `esc-hotkey.ts` is a no-op — CC registers a CGEventTap to catch escape key for abort. HLVM doesn't have this. Agent abort relies on signal propagation.
- `cu_type` always uses clipboard paste (`viaClipboard: true`) — CC also defaults to this but some use cases need direct keystroke input.

---

## For Agents Picking Up This Work

### Quick orientation
1. Read `src/hlvm/agent/computer-use/tools.ts` — the 22 tool definitions
2. Read `src/hlvm/agent/computer-use/executor.ts` — how tools call macOS
3. Read `src/hlvm/agent/orchestrator-response.ts:330-346` — how screenshots reach the LLM
4. Run tests: `HLVM_DISABLE_AI_AUTOSTART=1 deno test --allow-all tests/unit/agent/computer-use.test.ts`

### Key patterns
- Every tool: `guards()` → `getExecutor()` → `executor.method()` → `okTool()`/`failTool()`
- Screenshot tools return `_imageAttachment` which the orchestrator auto-extracts
- Parameters match Anthropic SDK `computer_20250124` spec — don't invent new param names
- CC source reference: `/Users/seoksoonjang/dev/ClaudeCode-main/utils/computerUse/`

### Don't change
- `executor.ts` — CC clone, keep in sync
- `bridge.ts` — macOS native bridge, works as-is
- `lock.ts`, `cleanup.ts`, `common.ts` — CC patterns, stable
- Image pipeline in orchestrator — single SSOT path, don't add alternatives

### Next priority: Phase 2 (vision gating)
Smallest gap, lowest risk, prevents crashes. Start here.
