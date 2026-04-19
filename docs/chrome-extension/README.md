# Chrome Extension Browser Bridge

HLVM's Chrome Extension lets the AI agent control the user's **real
Chrome browser** — with all their authenticated sessions, cookies, and
extensions. No re-login, no passwords, no 2FA.

Architecture copied from Claude Code (CC). Same content-script approach,
same native messaging protocol, same user experience.

---

## Current Status (for agents picking this up)

**Status: WORKING and TESTED** on real Chrome through `hlvm ask`.

### What's done
- 22 `ch_*` tools registered in `BUILTIN_TOOL_REGISTRY`
- All tools in `REPL_MAIN_THREAD_EAGER_TOOLS` (REPL); discoverable via
  `tool_search` in agent mode
- Content-scripts architecture (no `chrome.debugger`, no yellow banner)
- Native messaging host (Deno binary) spawned by Chrome
- Unix socket bridge between CLI and native host
- CLI commands: `hlvm chrome-ext setup/status/uninstall`
- System prompt auto-injected when ch_* tools present
- 12 unit tests pass
- 21/21 socket-level E2E tests pass
- 10/10 agent-level E2E tests pass (Haiku 4.5, `hlvm ask`)

### How to verify it still works

```bash
# 1. Type check + SSOT
deno task ssot:check
deno check src/hlvm/agent/chrome-ext/mod.ts

# 2. Unit tests
deno test -A tests/unit/agent/chrome-ext.test.ts --no-check

# 3. Load extension (one-time, manual)
#    chrome://extensions → Developer mode → Load unpacked
#    → select: src/hlvm/agent/chrome-ext/extension/

# 4. Install native host
./src/hlvm/agent/chrome-ext/test-local.sh <extension-id>

# 5. E2E through agent (requires Chrome in foreground for screenshots)
deno run -A src/hlvm/cli/cli.ts ask \
  "use ch_tabs to list my chrome browser tabs" \
  --model claude-code/claude-haiku-4-5-20251001 \
  --permission-mode acceptEdits
```

### What's NOT done (future work)

- [ ] Chrome Web Store submission (needs icons, privacy policy, screenshots)
- [ ] Auto-detection of extension connection on session start
- [ ] Startup notification ("Chrome extension connected")
- [ ] GIF recording tool (CC has `gif_creator`)
- [ ] Upload image tool (CC has `upload_image`)

### Implementation plan file

Full journey documented at:
`~/.claude/plans/mutable-soaring-bee.md`

### Key decisions made

1. **Content scripts, not chrome.debugger** — HLVM has native CU
   (HLVM.app) for screenshots and native input, so extension doesn't
   need CDP. Avoids yellow banner, easier Web Store approval.

2. **Builtin tools, not MCP subprocess** — CC uses MCP, HLVM uses
   direct `BUILTIN_TOOL_REGISTRY` registration. Simpler, faster.

3. **No session lock** — CC doesn't lock chrome extension access.
   Multiple sessions can share the extension.

4. **REPL gets all 22 tools eagerly** (`REPL_MAIN_THREAD_EAGER_TOOLS`);
   **agent mode uses `tool_search`** to discover them on demand.
   Tools fail gracefully if extension not connected.

5. **Permission mode matters** — Some tools are L1/L2 safety level.
   `hlvm ask --permission-mode acceptEdits` (or `default` for
   interactive) is required for them to execute.

---

## What It Does

```
USER: "check my Gmail for new emails"

  HLVM agent (Haiku / gemma4)
    → decides: "Gmail needs auth. Use ch_navigate."
    → calls ch_navigate("https://gmail.com")
    → YOUR Chrome navigates to Gmail (already logged in)
    → calls ch_content() to read inbox
    → "You have 3 new emails: ..."

  No password entered. No 2FA prompt. Already logged in.
  You WATCH it happen in your Chrome window.
```

---

## Full Pipeline (how it works end-to-end)

```
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║  $ hlvm ask "check my Gmail"                                    ║
║       │                                                          ║
║       ▼                                                          ║
║  ┌──────────────────────────────────────┐                       ║
║  │  HLVM Agent (LLM)                    │                       ║
║  │                                      │                       ║
║  │  Sees 22 ch_* tools in its tool list │                       ║
║  │  System prompt says:                 │                       ║
║  │  "ch_* = real Chrome with auth"      │                       ║
║  │  "pw_* = clean headless browser"     │                       ║
║  │                                      │                       ║
║  │  Decides: ch_navigate("gmail.com")   │                       ║
║  └──────────────┬───────────────────────┘                       ║
║                 │                                                ║
║                 │ Tool call via orchestrator                     ║
║                 ▼                                                ║
║  ┌──────────────────────────────────────┐                       ║
║  │  tools.ts → bridge.ts               │                       ║
║  │                                      │                       ║
║  │  chromeExtRequest("navigate",        │                       ║
║  │    {url: "gmail.com"})               │                       ║
║  │                                      │                       ║
║  │  Connects to Unix socket:            │                       ║
║  │  ~/.hlvm/chrome-bridge/{pid}.sock    │                       ║
║  │                                      │                       ║
║  │  Sends: 4-byte length + JSON         │                       ║
║  └──────────────┬───────────────────────┘                       ║
║                 │                                                ║
║                 │ Unix Socket                                    ║
║                 ▼                                                ║
║  ┌──────────────────────────────────────┐                       ║
║  │  native-host.ts                      │                       ║
║  │  (standalone Deno process)           │                       ║
║  │                                      │                       ║
║  │  Chrome spawns this when extension   │                       ║
║  │  loads. Relays messages between      │                       ║
║  │  socket (CLI) and stdin/stdout       │                       ║
║  │  (Chrome native messaging).          │                       ║
║  └──────────────┬───────────────────────┘                       ║
║                 │                                                ║
║                 │ Chrome Native Messaging (stdin/stdout)         ║
║                 ▼                                                ║
║  ┌──────────────────────────────────────────────────────────┐   ║
║  │  Chrome Extension (background.js)                         │   ║
║  │                                                          │   ║
║  │  Receives: {method: "navigate", params: {url: ...}}      │   ║
║  │                                                          │   ║
║  │  Dispatches via Chrome APIs:                             │   ║
║  │    navigate    → chrome.tabs.update(tabId, {url})        │   ║
║  │    click       → chrome.scripting.executeScript(el.click) │   ║
║  │    content     → chrome.scripting.executeScript(innerText)│   ║
║  │    screenshot  → chrome.tabs.captureVisibleTab()         │   ║
║  │    tabs        → chrome.tabs.query({})                   │   ║
║  │    evaluate    → chrome.scripting.executeScript(MAIN)     │   ║
║  │    ... (22 methods total)                                │   ║
║  │                                                          │   ║
║  │  Returns: {title: "Gmail", url: "...", tabId: 42}       │   ║
║  └──────────────────────────┬───────────────────────────────┘   ║
║                             │                                    ║
║                             ▼                                    ║
║  ┌──────────────────────────────────────────────────────────┐   ║
║  │  YOUR REAL CHROME                                         │   ║
║  │                                                          │   ║
║  │  [Gmail]  [GitHub]  [Slack]  ← all logged in             │   ║
║  │                                                          │   ║
║  │  You watch the AI navigate, click, read pages.           │   ║
║  │  All using YOUR cookies and sessions.                    │   ║
║  └──────────────────────────────────────────────────────────┘   ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## Three Browser Systems in HLVM

```
  User request
        │
        ▼
  ┌─ Needs auth? ────────────── YES ──→  ch_* (Chrome Extension)
  │     │                                 User's real Chrome
  │    NO                                 All sessions, cookies
  │     │
  │     ▼
  ├─ Needs clean browser? ──── YES ──→  pw_* (Playwright)
  │     │                                 Fresh headless Chromium
  │    NO                                 No auth, fast, CI-safe
  │     │
  │     ▼
  └─ Desktop app? ──────────── YES ──→  cu_* (Computer Use)
                                          Native macOS AX targets
                                          Full-page screenshots
```

---

## 22 Tools (all tested, all working)

### Navigation
| Tool | Args | What it does |
|------|------|--------------|
| `ch_navigate` | `url` | Go to URL in user's Chrome |
| `ch_back` | — | Browser back button |

### Interaction
| Tool | Args | What it does |
|------|------|--------------|
| `ch_click` | `selector?`, `x?`, `y?` | Click element or coordinates |
| `ch_fill` | `selector`, `value` | Set form input value |
| `ch_type` | `text`, `selector?`, `pressEnter?` | Type text (DOM events) |
| `ch_hover` | `selector` | Hover over element |
| `ch_scroll` | `direction?`, `amount?` | Scroll page |
| `ch_select_option` | `selector`, `value` | Pick dropdown option |

### Content Reading
| Tool | Args | What it does |
|------|------|--------------|
| `ch_evaluate` | `expression` | Run JavaScript in page |
| `ch_screenshot` | `format?` | Viewport screenshot |
| `ch_content` | `maxChars?` | Extract page text |
| `ch_links` | `limit?` | Extract all links |
| `ch_find` | `query` | Search text on page (regex) |
| `ch_wait_for` | `selector?`, `event?`, `timeout?` | Wait for element |

### Tab Management
| Tool | Args | What it does |
|------|------|--------------|
| `ch_tabs` | — | List all open tabs |
| `ch_tab_create` | `url?`, `active?` | Open new tab |
| `ch_tab_close` | `tabId?` | Close a tab |
| `ch_tab_select` | `tabId` | Switch to tab |

### Window
| Tool | Args | What it does |
|------|------|--------------|
| `ch_resize_window` | `width`, `height` | Resize browser window |

### Monitoring
| Tool | Args | What it does |
|------|------|--------------|
| `ch_enable_monitoring` | — | Start console + network capture |
| `ch_console` | `since?` | Read console messages |
| `ch_network` | `since?` | Read network requests |

### Delegated to CU (not in extension)
| Need | Use instead |
|------|-------------|
| Full-page screenshot | `cu_screenshot` |
| Accessibility tree | `cu_observe` |
| Native mouse/keyboard | `cu_click`, `cu_type` |

---

## How Tools Are Exposed to the LLM

```
BUILTIN_TOOL_REGISTRY (registry.ts)
  └── CHROME_EXT_TOOLS (22 tools from chrome-ext/tools.ts)
        └── All in REPL_MAIN_THREAD_EAGER_TOOLS (constants.ts, REPL)
        └── Deferred for agent mode; reachable via tool_search
              └── System prompt (sections.ts) adds guidance:
                    "ch_* = auth'd Chrome, pw_* = headless"
```

The LLM decides which tool to use based on the task. No manual
activation needed. No skill gate. Same as how CC works.

When the extension is NOT connected, ch_* tools fail gracefully:
`"No Chrome extension bridge found. Install the extension and
run 'hlvm chrome-ext setup'."`

---

## Setup (Development Mode)

### Quick Setup

```bash
# 1. Load extension in Chrome
#    chrome://extensions → Developer mode ON → Load unpacked
#    → select: src/hlvm/agent/chrome-ext/extension/
#    → note the extension ID Chrome assigns

# 2. Install native messaging host
./src/hlvm/agent/chrome-ext/test-local.sh <extension-id>

# 3. Restart Chrome

# 4. Verify — extension icon should show "Connected"
```

### CLI Setup

```bash
hlvm chrome-ext setup      # Install native host manifests
hlvm chrome-ext status     # Check connection status
hlvm chrome-ext uninstall  # Remove native host manifests
```

### What `hlvm chrome-ext setup` Does

1. Creates wrapper script: `~/.hlvm/chrome-bridge/chrome-bridge-host.sh`
2. Installs native messaging manifest for all detected browsers:
   - Chrome: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
   - Brave: `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/`
   - Arc, Edge, Chromium, Vivaldi, Opera — all supported
3. Manifest tells Chrome where the native host binary is

---

## Architecture Details

### Extension Approach: Content Scripts (not chrome.debugger)

The extension uses `chrome.scripting.executeScript()` and `chrome.tabs`
APIs — NOT `chrome.debugger`. This means:

- No yellow "debugging this browser" banner
- No `debugger` permission needed
- Easier Chrome Web Store approval
- Same approach as Claude Code

Heavy operations (full-page screenshots, native input, accessibility
tree) are delegated to HLVM's computer-use module (cu_* tools) which
has native Swift capabilities via HLVM.app.

### Protocol

All communication uses 4-byte little-endian length prefix + UTF-8 JSON:

```
┌──────────────────────────────────────────┐
│  4 bytes: UInt32 LE    │  N bytes        │
│  (message length)      │  (UTF-8 JSON)   │
└──────────────────────────────────────────┘
```

Three layers use the same framing:
1. **CLI ↔ Native Host**: Unix socket (`~/.hlvm/chrome-bridge/{pid}.sock`)
2. **Native Host ↔ Chrome**: stdin/stdout (Chrome native messaging)
3. Same JSON schema: `{id, method, params}` → `{id, result}` or `{id, error}`

### SSOT Constants (common.ts)

All configuration is centralized:

| Constant | Value | Used by |
|----------|-------|---------|
| `NATIVE_HOST_IDENTIFIER` | `com.hlvm.chrome_bridge` | setup.ts, native-host.ts |
| `CHROME_BRIDGE_DIR_NAME` | `chrome-bridge` | setup.ts, common.ts, native-host.ts |
| `CHROME_BRIDGE_WRAPPER_NAME` | `chrome-bridge-host.sh` | setup.ts |
| `MAX_MESSAGE_SIZE` | `1048576` (1MB) | bridge.ts, native-host.ts |
| `EXTENSION_IDS.prod` | placeholder | setup.ts (update for Web Store) |
| `CHROMIUM_BROWSERS` | 7 browser configs | setup.ts, common.ts |

`native-host.ts` mirrors these values (documented) because it's a
standalone binary that can't import from the HLVM module graph.

---

## File Structure

```
src/hlvm/agent/chrome-ext/
├── mod.ts              # Barrel re-export
├── bridge.ts           # Socket connection + request/response
├── common.ts           # Browser configs, paths, constants (SSOT)
├── setup.ts            # Native host manifest installation
├── tools.ts            # 22 ch_* tool definitions (chTool factory)
├── types.ts            # TypeScript type definitions
├── prompt.ts           # System prompt for LLM (ch_* vs pw_* vs cu_*)
├── native-host.ts      # Standalone Deno binary (Chrome NM protocol)
├── test-local.sh       # Quick local setup script
└── extension/
    ├── manifest.json   # MV3 manifest (no debugger permission)
    ├── background.js   # Service worker: NM connection + dispatch
    ├── content.js      # Console monitoring (MAIN world injection)
    ├── popup.html      # Connection status UI
    ├── popup.js        # Popup logic
    └── icons/          # 16/48/128 PNG icons

src/hlvm/agent/shared/
└── session-lock.ts     # Generic lock class (used by CU, not by chrome-ext)

Modified files:
├── src/hlvm/agent/registry.ts        # CHROME_EXT_TOOLS in BUILTIN_TOOL_REGISTRY
├── src/hlvm/agent/tool-profiles.ts   # browser_chrome profile
├── src/hlvm/agent/constants.ts       # ch_* in REPL_MAIN_THREAD_EAGER_TOOLS
├── src/hlvm/agent/agent-runner.ts    # Browser domain adds ch_* to allowlist
├── src/hlvm/agent/orchestrator.ts    # Browser domain adds ch_* to allowlist
├── src/hlvm/prompt/sections.ts       # renderChromeExtGuidance()
├── src/hlvm/cli/cli.ts               # chrome-ext command registered
├── src/hlvm/cli/commands/chrome-ext.ts  # setup/status/uninstall
└── scripts/ssot-check.ts            # SSOT allowlist for extension code
```

---

## CC vs HLVM Comparison

```
                    CC (Claude Code)       HLVM
                    ────────────────       ────
  Extension?        ✓ Chrome Web Store    ✓ Dev mode (store later)
  Approach?         Content scripts        Content scripts (SAME)
  Native Host?      Node.js (Bun)          Deno
  Auth sessions?    ✓                      ✓
  Debugger banner?  None                   None (SAME)
  Playwright?       ✗                      ✓ (headless/CI)
  Desktop AX?       L1 (coords)            L3 (native targets)
  Tools?            17                     22
  Screenshot?       ✗ (in extension)       ✓ captureVisibleTab
  GIF recording?    ✓ gif_creator          ✗ (future)
  Upload image?     ✓ upload_image         ✗ (future)
```

---

## Testing

### Unit Tests

```bash
deno test -A tests/unit/agent/chrome-ext.test.ts --no-check
# 12 tests: SessionLock, tool registration, constants, bridge, prompt
```

### Socket-Level E2E

```bash
# Direct socket test (bypasses LLM, tests extension pipeline)
# See test-local.sh for setup, then run socket tests from CLI
# 21/21 tools pass
```

### Agent-Level E2E

```bash
# Through real HLVM agent with Haiku
deno run -A src/hlvm/cli/cli.ts ask \
  "use ch_tabs to list my chrome tabs" \
  --model claude-code/claude-haiku-4-5-20251001 \
  --permission-mode acceptEdits

# Tested 10/10 tools through full agent pipeline — all pass
```

### Verified E2E Results (on real Chrome)

| Tool | Agent Test | Socket Test |
|------|-----------|-------------|
| ch_tabs | ✓ Listed 8 tabs | ✓ |
| ch_navigate | ✓ "Example Domain" | ✓ |
| ch_content | ✓ Read page text | ✓ |
| ch_links | ✓ Found links | ✓ |
| ch_evaluate | ✓ document.title | ✓ |
| ch_screenshot | ✓ 23KB PNG | ✓ |
| ch_scroll | ✓ Scrolled down | ✓ |
| ch_find | ✓ 2 matches | ✓ |
| ch_click | ✓ Clicked link | ✓ |
| ch_back | ✓ Went back | ✓ |
| ch_fill | — | ✓ |
| ch_type | — | ✓ |
| ch_hover | — | ✓ |
| ch_select_option | — | ✓ |
| ch_tab_create | — | ✓ |
| ch_tab_close | — | ✓ |
| ch_tab_select | — | ✓ |
| ch_resize_window | — | ✓ |
| ch_wait_for | — | ✓ |
| ch_enable_monitoring | — | ✓ |
| ch_console | — | ✓ |
| ch_network | — | ✓ |

---

## Troubleshooting

### "No Chrome extension bridge found"

Extension not connected or native host not installed.

1. Is Chrome open? Extension requires Chrome running.
2. Is extension loaded? Check `chrome://extensions`
3. Run `hlvm chrome-ext setup` to install native host manifest
4. Restart Chrome after installing manifest

### Screenshot fails with "image readback failed"

Chrome must be in the **foreground** on macOS. The extension brings
Chrome to front automatically, but if it fails:

1. Click on Chrome window to bring it to front
2. Retry the screenshot

### Tool says "Tool not available"

The tool isn't in the LLM's eager tool list. This shouldn't happen
after the constants.ts update, but if it does:

1. In REPL: check `REPL_MAIN_THREAD_EAGER_TOOLS` in constants.ts includes ch_* tools
2. In agent mode: discover via `tool_search({query:"select:ch_navigate"})`

### Extension keeps disconnecting

MV3 service workers can be killed after 30s idle. The native messaging
port keeps it alive, but if disconnects happen:

1. Check `chrome://serviceworker-internals/`
2. Extension auto-reconnects after 3s
3. Reload extension in `chrome://extensions`

---

## Design Decisions

### Why Content Scripts (not chrome.debugger)?

- No yellow debugging banner → better UX
- No `debugger` permission → easier Web Store approval
- HLVM has native CU (HLVM.app) for screenshots/AX/native input
- Same approach as Claude Code → proven at scale

### Why No Lock?

CC doesn't lock chrome extension access. Multiple sessions can share
the extension. The extension handles requests sequentially. No need
for session locking (unlike CU which controls exclusive desktop input).

### Why No Session State?

The extension manages its own state (active tab, debugger attachments).
The CLI doesn't need to track this — it just sends requests and gets
responses. Simpler, less code, fewer bugs.

### Why Builtin Tools (not MCP)?

CC uses MCP subprocess for chrome tools. HLVM uses direct builtin
registration. Simpler (no subprocess), faster (no IPC), same result.
The `chTool()` factory eliminates all boilerplate.

---

## Future Work

- [ ] Chrome Web Store submission (needs icons, privacy policy)
- [ ] GIF recording (CC has gif_creator)
- [ ] Upload image (CC has upload_image)
- [ ] Auto-detect extension on startup (CC does this)
- [ ] Startup notification ("Chrome extension connected")
