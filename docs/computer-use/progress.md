# Computer Use — Progress & Roadmap

Last updated: 2026-04-07

## Status Summary

```
Phase 1: Tool Layer (CC Clone)          ████████████████████ 100%  DONE  (ef1ae38, 22a5fe5)
Phase 2: Vision Capability Gating       ████████████████████ 100%  DONE  (162ef7e)
Phase 3: Agent Loop E2E                 ████████████████████ 100%  DONE  (162ef7e)
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

## Phase 2: Vision Capability Gating — COMPLETE

**Date completed:** 2026-04-07
**Commit:** `162ef7e`

**Problem solved:** Images were sent to ALL models unconditionally. Text-only models (e.g., `llama3.1:8b`) would crash receiving image attachments. CU tools were useless for non-vision models.

### What Was Done

1. **`visionCapable` derived in `session.ts`**
   - `modelInfo?.capabilities?.includes("vision") ?? isFrontier`
   - Frontier providers (anthropic, openai, google) default `true` when modelInfo unavailable
   - Local models without modelInfo default `false` (safe)

2. **CU tools denied for non-vision models**
   - All `cu_*` tool names added to `effectiveToolDenylist` when `!visionCapable`
   - Done BEFORE `computeTierToolFilter` so it propagates through all downstream consumers
   - Non-vision models never see CU tools in their tool list

3. **Image injection gated in `orchestrator-response.ts`**
   - `config.visionCapable !== false` → inject image attachment (existing behavior)
   - `config.visionCapable === false` → text fallback: `"[Screenshot captured (WxHpx) — not shown: model lacks vision]"`
   - `!== false` means `undefined` (older code paths, tests) defaults to current behavior — defense-in-depth

4. **`visionCapable` threaded through full pipeline**
   - `session.ts` → `AgentSession.visionCapable` → `agent-runner.ts` → `OrchestratorConfig.visionCapable` → `orchestrator-response.ts`
   - Also threaded to prompt pipeline: `session.ts` → `buildCompiledPromptArtifacts` → `compileSystemPrompt` → `sections.ts`

### Files Modified (7)
| File | Change |
|------|--------|
| `src/hlvm/prompt/types.ts` | Added `visionCapable` to `PromptCompilerInput` |
| `src/hlvm/prompt/sections.ts` | Added `renderComputerUseGuidance()` + stability entry + wire |
| `src/hlvm/agent/llm-integration.ts` | Added `visionCapable` to `SystemPromptOptions` + thread |
| `src/hlvm/agent/session.ts` | Derive `visionCapable`, deny CU tools, thread everywhere |
| `src/hlvm/agent/orchestrator.ts` | Added `visionCapable` to `OrchestratorConfig` |
| `src/hlvm/agent/orchestrator-response.ts` | Gate image injection + text fallback |
| `src/hlvm/agent/agent-runner.ts` | Thread `visionCapable` to reactLoopConfig |

---

## Phase 3: Agent Loop E2E — COMPLETE

**Date completed:** 2026-04-07
**Commit:** `162ef7e` (same as Phase 2 — implemented together)

### What Was Done

1. **CU system prompt section added (`renderComputerUseGuidance` in `sections.ts`)**
   - Only rendered when `cu_*` tools are present AND model is vision-capable
   - Covers: workflow (screenshot first, verify after action), best practices (center clicks, cu_wait for loading, cu_zoom for ambiguity), coordinate system (absolute pixels, (0,0) top-left), safety (minimize actions, clipboard for sensitive data)
   - Stability: `"session"` (doesn't change mid-conversation)
   - `minTier: "mid"` (available for mid and frontier models)

2. **Full E2E verified with real model + real screen**
   ```
   ./hlvm ask --model claude-code/claude-haiku-4-5-20251001 \
     --dangerously-skip-permissions \
     "take a screenshot and tell me what you see"
   ```
   - Haiku called `cu_screenshot` → captured 1280x720px JPEG
   - Screenshot injected as image attachment → Haiku received it
   - Haiku accurately described: terminal window, Spotlight Search dialog, conversation content, timestamp
   - Full agent loop working: prompt → tool call → image capture → image injection → LLM interpretation → text response

### E2E Test Commands
```bash
# Quick smoke test (requires vision-capable model + macOS)
./hlvm ask --model claude-code/claude-haiku-4-5-20251001 \
  --dangerously-skip-permissions \
  "take a screenshot and tell me what you see"

# Multi-turn CU (open app + interact)
./hlvm ask --model claude-code/claude-haiku-4-5-20251001 \
  --dangerously-skip-permissions \
  "open TextEdit and type hello world"

# With other vision-capable models
./hlvm ask --model openai/gpt-4o "take a screenshot"
./hlvm ask --model anthropic/claude-sonnet-4-20250514 "take a screenshot"
```

### Remaining E2E Gaps (not blocking, future hardening)
- **Multi-turn CU loop stress test** — 10+ sequential tool calls to verify context doesn't bloat
- **Error recovery** — what happens when screenshot fails mid-loop (e.g., permission revoked)
- **Lock lifecycle** — concurrent sessions both requesting CU

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
- None remaining. Phase 1-3 complete.

### Important
- **`cu_request_access` is a stub** — returns a helpful message but doesn't actually open System Preferences or trigger permission dialogs
- **Context bloat** — screenshots are ~30-150KB base64, multiple screenshots per task could fill context window. Need to verify compaction handles image messages properly.
- **No streaming screenshot preview in TUI** — CC shows live screen updates in its terminal UI. HLVM returns results but doesn't render images inline in the REPL.

### Minor
- `drain-run-loop.ts` is a no-op — CC uses this to drain Swift's main run loop between operations. HLVM's osascript bridge doesn't need it, but the call sites remain for CC parity.
- `esc-hotkey.ts` is a no-op — CC registers a CGEventTap to catch escape key for abort. HLVM doesn't have this. Agent abort relies on signal propagation.
- `cu_type` always uses clipboard paste (`viaClipboard: true`) — CC also defaults to this but some use cases need direct keystroke input.

---

## For Agents Picking Up This Work

### Quick orientation
1. Read `src/hlvm/agent/computer-use/tools.ts` — the 22 tool definitions
2. Read `src/hlvm/agent/computer-use/executor.ts` — how tools call macOS
3. Read `src/hlvm/agent/orchestrator-response.ts` — how screenshots reach the LLM (search for `imageAttachments`)
4. Read `src/hlvm/agent/session.ts` — search for `visionCapable` to see gating + CU tool denial
5. Read `src/hlvm/prompt/sections.ts` — search for `renderComputerUseGuidance` for CU system prompt
6. Run tests: `HLVM_DISABLE_AI_AUTOSTART=1 deno test --allow-all tests/unit/agent/computer-use.test.ts`

### Key patterns
- Every tool: `guards()` → `getExecutor()` → `executor.method()` → `okTool()`/`failTool()`
- Screenshot tools return `_imageAttachment` which the orchestrator auto-extracts
- Parameters match Anthropic SDK `computer_20250124` spec — don't invent new param names
- `visionCapable` threading: `session.ts` → `agent-runner.ts` → `OrchestratorConfig` → `orchestrator-response.ts`
- `visionCapable` also flows: `session.ts` → `buildCompiledPromptArtifacts` → `compileSystemPrompt` → `sections.ts`
- CC source reference: `/Users/seoksoonjang/dev/ClaudeCode-main/utils/computerUse/`

### Don't change
- `executor.ts` — CC clone, keep in sync
- `bridge.ts` — macOS native bridge, works as-is
- `lock.ts`, `cleanup.ts`, `common.ts` — CC patterns, stable
- Image pipeline in orchestrator — single SSOT path, don't add alternatives
- Vision gating logic in `session.ts` — `visionCapable` derivation and CU tool denial is intentionally placed BEFORE `computeTierToolFilter`

### Key implementation details
- `visionCapable` defaults: frontier providers (`anthropic`, `openai`, `google`) → `true`; local models without modelInfo → `false`
- Image injection uses `config.visionCapable !== false` (not `=== true`) so `undefined` preserves backward compatibility
- CU system prompt section has `minTier: "mid"` and stability `"session"` — only appears for vision-capable models with `cu_*` tools registered
- `--dangerously-skip-permissions` flag needed for non-interactive E2E testing (L2 tools require approval)

### HLVM advantage over CC
- **Any vision-capable LLM works**: Claude, GPT-4o, Gemini, local models with vision (llava, etc.)
- CC is locked to Claude; HLVM uses the same 22 tools with swappable brain
- Test with: `./hlvm ask --model claude-code/claude-haiku-4-5-20251001 --dangerously-skip-permissions "take a screenshot"`

### Next priority: Phase 4 (Hybrid Playwright + CU)
See [hybrid-strategy.md](./hybrid-strategy.md). Playwright for fast/deterministic browser ops, CU for native/visual tasks.
