# Computer Use — Hybrid Playwright + CU Strategy

## Core Principle

**Per-subtask routing, not per-task fallback.**

Don't try Playwright for the whole task and fall back to CU if it fails. Instead, decompose the task into subtasks and pick the best tool for each one.

```
Task = [subtask1, subtask2, ..., subtaskN]

For each subtask:
  1. Try Playwright (fast, deterministic, instant success/fail)
  2. If failed → CU loop (screenshot → decide → act → screenshot → verify)
  3. Repeat CU until subtask verified
  4. Next subtask
```

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
┌──────────────────────────────────────────────────────────┐
│                    Agent (LLM)                            │
│                                                          │
│  System prompt includes both tool sets                   │
│  LLM picks best tool per subtask                         │
└────────────┬─────────────────────────┬───────────────────┘
             │                         │
    ┌────────▼────────┐       ┌────────▼────────┐
    │   Playwright    │       │  Computer Use   │
    │   Tools         │       │  Tools          │
    │                 │       │                 │
    │  pw_goto        │       │  cu_screenshot  │
    │  pw_click       │       │  cu_left_click  │
    │  pw_fill        │       │  cu_type        │
    │  pw_content     │       │  cu_key         │
    │  pw_wait_for    │       │  cu_scroll      │
    │  pw_screenshot  │       │  cu_open_app    │
    │  pw_evaluate    │       │  ...18 more     │
    └────────┬────────┘       └────────┬────────┘
             │                         │
    ┌────────▼────────┐       ┌────────▼────────┐
    │   Chromium      │       │   macOS         │
    │   (headless or  │       │   CGEvent +     │
    │    headed)      │       │   screencapture │
    └─────────────────┘       └─────────────────┘
```

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

**2.5x faster.** Steps 1-7 need zero LLM reasoning — Playwright results are deterministic.

## Subtask Classification

The LLM (or a routing heuristic) classifies each subtask:

| Subtask Type | Try First | Fallback |
|-------------|-----------|----------|
| Navigate to URL | Playwright | CU (type in address bar) |
| Click element by text | Playwright | CU (screenshot + coordinate) |
| Fill form field | Playwright | CU (click field + type) |
| Read page text | Playwright | CU (screenshot + OCR/vision) |
| Wait for page load | Playwright | CU (sleep + screenshot) |
| Download file | Playwright | CU (handle native dialog) |
| Interact with native app | CU only | — |
| Handle system dialog | CU only | — |
| Verify visual state | CU only | — |
| CAPTCHA / visual puzzle | CU only | — |

## Playwright Failure → CU Handoff

When Playwright fails, the CU fallback is a **retry loop**, not a single attempt:

```
Playwright subtask fails (selector not found, timeout, etc.)
  │
  ▼
CU retry loop:
  1. cu_screenshot (observe current state)
  2. LLM analyzes screenshot (what went wrong? what do I see?)
  3. LLM picks CU action (click, type, scroll, etc.)
  4. Execute CU action
  5. cu_screenshot (verify result)
  6. LLM checks: subtask accomplished?
     → Yes: move to next subtask
     → No: go to step 2 (max N retries)
```

CU retries are bounded (e.g., max 5 attempts per subtask). If CU also fails after max retries, the subtask is reported as failed.

## Shared Browser Context

Key insight: Playwright and CU can operate on the **same browser instance**.

```
Playwright launches Chromium (headed mode, not headless)
  → Playwright does fast DOM operations
  → CU can see the same browser window via cu_screenshot
  → CU can click on the same browser window via cu_left_click
  → Both tools work on the same page state
```

This means the handoff from Playwright to CU is seamless — no browser restart, no URL re-navigation. CU just picks up where Playwright left off visually.

## Implementation Plan

### Phase 4a: Playwright Tools
Add tools that mirror CU's interface but use Playwright internally:

```typescript
// Proposed tool signatures
pw_goto:       { url: string }
pw_click:      { selector: string, text?: string }
pw_fill:       { selector: string, value: string }
pw_content:    { selector?: string } → page text/HTML
pw_wait_for:   { condition: "networkidle" | "selector", selector?: string }
pw_screenshot: {} → image (Playwright's built-in screenshot)
pw_evaluate:   { script: string } → result
```

### Phase 4b: Routing Logic
Agent system prompt instructs LLM on when to use each tool set:

```
For browser tasks:
- Use pw_* tools for navigation, clicking, form filling, content reading
- Use cu_* tools for native dialogs, visual verification, non-browser apps
- If a pw_* tool fails, retry with the equivalent cu_* tool
```

### Phase 4c: Browser Lifecycle
```typescript
// Browser singleton (like executor singleton)
let _browser: Browser | undefined;

function getBrowser(): Browser {
  if (_browser) return _browser;
  _browser = await chromium.launch({ headless: false });
  return _browser;
}
```

## Not In Scope

- **Headless mode** — CU needs to see the browser, so headed mode required for hybrid
- **Multiple browser tabs** — Keep it simple, one tab at a time
- **Browser DevTools protocol** — Use Playwright's API, not raw CDP
- **Automated subtask decomposition** — LLM does this naturally via tool selection
