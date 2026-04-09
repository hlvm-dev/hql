# Computer Use — Hybrid Playwright + CU Strategy

> Last updated: 2026-04-09 Status: **Browser-safe activation, hybrid promotion,
> and storage-first pw_promote shipped**

## Core Principle

**Profile-based 2-layer browser control, not per-subtask routing.**

The orchestrator controls which tool families the LLM can access. The LLM
decides how to use the tools within the allowed set.

```
Layer 1: browser_safe   (PW-only, default for all browser tasks)
Layer 2: browser_hybrid  (PW + CU, unlocked only on repeated visual/native failure)
```

The previous per-subtask decomposition approach was superseded because:

- It required a deterministic routing controller that replicated LLM reasoning
- PW and CU need fundamentally different inputs (selectors vs coordinates)
- The LLM is better at flexible recovery than hardcoded fallback paths

## Why Hybrid

Playwright and CU have complementary strengths. Neither alone is sufficient.

```
                    Playwright                 Computer Use
                    ──────────                 ────────────
Speed               Milliseconds               Seconds (screenshot + LLM)
Reliability         Deterministic              Probabilistic (coordinate estimation)
Scope               Browser DOM only           Entire OS
Failure detection   Instant (exception)        Needs visual verification
Native dialogs      Blind                      Can see and interact
Non-browser apps    Impossible                 Full control
CAPTCHAs            Struggles                  Sees what user sees
Structured data     DOM/JSON extraction        OCR from pixels
```

## Architecture

```
USER BROWSER TASK
  │
  v
ORCHESTRATOR classifies as browser domain
  │
  v
SET domain = browser_safe
  │
  v
TOOL PROFILE SYSTEM (tool-profiles.ts)
  │
  ├── browser_safe allowlist:
  │     pw_goto, pw_click, pw_fill, pw_content, pw_links,
  │     pw_wait_for, pw_screenshot, pw_evaluate, pw_scroll,
  │     pw_snapshot, pw_download + tool_search, search_web,
  │     web_fetch, fetch_url
  │
  ├── browser_safe denylist:
  │     pw_promote, all cu_*
  │
  v
LLM SEES ONLY PW TOOLS
  │
  ├── PW succeeds ──────────────────────────► done
  │
  ├── PW structural/content failure ────────► stay browser_safe
  │   (selector wrong, content parse)            (better evidence)
  │
  └── PW visual/native failure (repeated) ──► PROMOTE
                                                │
                                                v
                                          SET domain = browser_hybrid
                                          (extends browser_safe + pw_promote + cu_*)
                                                │
                                                v
                                          LLM NOW SEES PW + CU TOOLS
                                                │
                                                v
                                          done / fail
```

### Key: LLM is the controller within each mode

The orchestrator decides **which tools are available** (deterministic,
policy-based). The LLM decides **how to use them** (flexible, reasoning-based).

This avoids building a rigid browser automation state machine that would need to
handle every PW→CU handoff path in deterministic code.

## Example: "Download Cursor Editor"

### Without hybrid (CU only — slow, fragile)

```
1. cu_screenshot                           2.0s  (take screenshot)
2. LLM thinks about screenshot             1.5s  (API round-trip)
3. cu_open_application Safari              2.0s  (open Safari)
4. cu_screenshot                           2.0s  (verify Safari opened)
5. LLM thinks                             1.5s
6. cu_key cmd+l                            0.3s  (focus address bar)
7. cu_type "cursor editor download"        0.5s
8. cu_key return                           0.3s
9. cu_screenshot                           2.0s  (see search results)
10. LLM thinks                            1.5s  (find link coordinates)
11. cu_left_click [x, y]                   0.3s  (click result)
12. cu_screenshot                          2.0s  (verify page loaded)
13. LLM thinks                            1.5s  (find download button)
14. cu_left_click [x, y]                   0.3s  (click download)
                                          ─────
                                          ~18s  + lots of LLM reasoning
```

### With hybrid (fast path + CU for native)

```
1. pw_goto "https://www.google.com"        0.5s  (instant navigation)
2. pw_fill "[name=q]" "cursor editor"      0.1s  (instant form fill)
3. pw_click "input[type=submit]"           0.1s  (instant submit)
4. pw_wait_for "networkidle"               1.0s  (wait for results)
5. pw_content "a[href*=cursor]"            0.1s  (extract link URL)
6. pw_goto extracted_url                   1.0s  (navigate to cursor.com)
7. pw_click "text=Download"               0.1s  (click download button)
   → FAILS: native download dialog
8. cu_screenshot                           2.0s  (see download dialog)
9. LLM thinks                             1.5s
10. cu_left_click [x, y]                   0.3s  (click "Allow")
                                          ─────
                                          ~7s   + minimal LLM reasoning
```

**2.5x faster.** Steps 1-7 need zero LLM reasoning — Playwright results are
deterministic.

## Promotion Policy: When to Unlock Hybrid

The promotion decision is made by the **orchestrator**, not the LLM. Mode
switching is deterministic. Local LLM classification is used only when the
failure is still ambiguous after structured facts and the keyword fast-path.

### Promote to browser_hybrid

These indicate PW is likely insufficient:

- Repeated `not visible` / `outside viewport` / `click intercepted`
- Native dialog / OS permission popup
- Anti-bot / human verification wall

### Stay in browser_safe

These are solvable within PW:

- Selector not found (try better selector)
- Download navigation (use `pw_download` with URL)
- Content extraction (inspect DOM differently)
- Docs/sidebar discovery (use `pw_links`)

### Detection approach

Three layers, in order:

1. **Structured failure metadata** — `failure.code` / `failure.facts` from the
   shared PW failure enricher (`pw_element_not_visible`,
   `pw_element_outside_viewport`, `pw_click_intercepted`,
   `facts.visualBlocker === true`)
2. **Keyword fast-path** — stable Playwright phrases like `not visible`,
   `outside the viewport`, `another element would receive the click`
3. **Local LLM classification** — only for ambiguous failures that still do not
   have enough evidence after steps 1 and 2

```
PW tool fails
  │
  ├── has structured visual code/facts
  │     → use code directly
  │
  ├── has known visual keyword
  │     → treat as visual blocker
  │
  └── still ambiguous
        → classifyVisualFailure(errorText) via local LLM
        → ~300-600ms, temperature 0, maxTokens 64
        → returns {visual: true/false}
```

Tested on gemma4:e4b (local, on laptop):

| Error                        | Result  | Correct | Time  |
| ---------------------------- | ------- | ------- | ----- |
| Element not visible          | `true`  | yes     | 658ms |
| Selector not found           | `false` | yes     | 583ms |
| Click intercepted by overlay | `true`  | yes     | 642ms |
| Outside viewport             | `true`  | yes     | 342ms |
| Network connection refused   | `false` | yes     | 612ms |
| Page navigation timeout      | `false` | yes     | 577ms |

6/6 correct on the ambiguous fallback samples. The main path is still structured
facts first, then keyword fast-path, then local LLM only if needed.

### CLI testing

```bash
hlvm classify 'Is this Playwright error caused by a VISUAL problem
(element hidden, obscured, intercepted, outside viewport, overlay blocking)?
Reply ONLY {"visual":true} or {"visual":false}.
Error: <paste error text here>'
```

## Shared Browser Context

Playwright and CU can operate on the **same browser instance**.

```
Playwright launches Chromium (headed mode after pw_promote)
  → Playwright does fast DOM operations
  → CU can see the same browser window via cu_screenshot
  → CU can click on the same browser window via cu_left_click
  → Both tools work on the same URL plus storage-backed auth/session state
```

`pw_promote` is storage-first, not full in-memory continuity. URL plus
cookies/localStorage are restored best-effort. Unsaved form inputs,
sessionStorage-only state, scroll position, JS heap state, and live connections
are not guaranteed.

## ToolProfile Infrastructure (Completed)

The first-class ToolProfile system is already implemented in `tool-profiles.ts`.
Browser profiles are declared but not yet activated:

```typescript
// tool-profiles.ts line 82
{
  id: "browser_safe",
  allowlist: [...pw_tools_except_promote, "tool_search", "search_web", "web_fetch", "fetch_url"],
  reasonTemplate: "Headless browser-safe tool profile",
},
{
  id: "browser_hybrid",
  extends: "browser_safe",
  allowlist: ["pw_promote", ...cu_tools],
  reasonTemplate: "Hybrid browser profile with headed computer use",
},
```

Activation is a single call:

```typescript
updateToolProfileLayer(config, "domain", { profileId: "browser_safe" });
// ... later, on promotion:
updateToolProfileLayer(config, "domain", { profileId: "browser_hybrid" });
```

## What Remains

1. **Real-task validation** — compare task success: broad mode vs browser_safe
   vs promoted hybrid
2. **Further continuity only if proven necessary** — sessionStorage/form/scroll
   restoration remains explicitly out of scope for this round
