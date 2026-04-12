# Chrome Extension Browser Bridge

HLVM's Chrome Extension bridge connects the CLI to the user's real Chrome
browser — inheriting all authenticated sessions, cookies, and extensions.

Architecture copied from Claude Code (CC). HLVM improves on CC by adding
`chrome.debugger` CDP power (CC uses content scripts only) and keeping
Playwright for headless/CI scenarios.

---

## Architecture Overview

```
═══════════════════════════════════════════════════════════════════════
                     HLVM Browser Architecture
═══════════════════════════════════════════════════════════════════════

                         ┌──────────────┐
                         │  HLVM Agent  │
                         │  (Deno CLI)  │
                         └──────┬───────┘
                                │
                 ┌──────────────┼──────────────┐
                 │              │              │
            ─────▼─────   ─────▼─────   ─────▼─────
           │  pw_* tools │ │ ch_* tools│ │ cu_* tools│
           │ (Playwright)│ │(Extension)│ │ (Desktop) │
            ─────┬─────   ─────┬─────   ─────┬─────
                 │              │              │
                 │              │              │
    ┌────────────▼──┐    ┌─────▼──────┐  ┌───▼────────────┐
    │  Fresh        │    │   Unix     │  │  Native GUI    │
    │  Chromium     │    │   Socket   │  │  Backend       │
    │  (bundled)    │    │            │  │  (HLVM.app)    │
    │               │    │ ~/.hlvm/   │  │                │
    │  • No auth    │    │ chrome-    │  │  • AX targets  │
    │  • Headless   │    │ bridge/    │  │  • Screenshots │
    │  • Fast DOM   │    │ {pid}.sock │  │  • Native I/O  │
    │  • CI/testing │    └─────┬──────┘  └────────────────┘
    └───────────────┘          │
                               │ stdin/stdout
                         ┌─────▼──────────┐
                         │  Native Host   │
                         │  (Deno binary) │
                         │                │
                         │  4-byte LE len │
                         │  + JSON payload│
                         └─────┬──────────┘
                               │ Chrome Native
                               │ Messaging API
                    ┌──────────▼───────────────┐
                    │                          │
                    │   HLVM Chrome Extension  │
                    │   (user's real Chrome)   │
                    │                          │
                    │  ┌────────────────────┐  │
                    │  │ chrome.debugger    │  │  ← Full CDP power
                    │  │ • Page.screenshot  │  │    No --remote-debugging
                    │  │ • Input.dispatch*  │  │    needed!
                    │  │ • Runtime.evaluate │  │
                    │  │ • DOM.*           │  │
                    │  │ • Network.*       │  │
                    │  └────────────────────┘  │
                    │                          │
                    │  ┌────────────────────┐  │
                    │  │ Content Scripts    │  │  ← DOM access fallback
                    │  │ • Read page       │  │
                    │  │ • Inject JS       │  │
                    │  └────────────────────┘  │
                    │                          │
                    │  ┌────────────────────┐  │
                    │  │ User's Sessions   │  │  ← FREE auth
                    │  │ • Cookies         │  │
                    │  │ • localStorage    │  │
                    │  │ • Extensions      │  │
                    │  │ • Password mgr    │  │
                    │  └────────────────────┘  │
                    │                          │
                    └──────────────────────────┘
```

---

## Before vs After

```
═══════════════════════════════════════════════════════════════════
                          BEFORE (pw_* only)
═══════════════════════════════════════════════════════════════════

  User: "Book me a flight on United.com"

  HLVM ──→ chromium.launch() ──→ Fresh Chromium (no cookies)
                                      │
                                      ├── pw_goto("united.com")
                                      ├── ❌ Not logged in
                                      ├── pw_fill(email), pw_fill(password)
                                      ├── ❌ 2FA challenge
                                      ├── ❌ CAPTCHA
                                      ├── pw_promote (headless → headed)
                                      ├── cu_observe, cu_click (manual 2FA)
                                      └── 😩 2-5 minutes, often fails

═══════════════════════════════════════════════════════════════════
                          AFTER (ch_* via extension)
═══════════════════════════════════════════════════════════════════

  User: "Book me a flight on United.com"

  HLVM ──→ Chrome Extension ──→ User's Real Chrome (logged in!)
                                      │
                                      ├── ch_navigate("united.com")
                                      ├── ✅ Already logged in
                                      ├── ch_click("Search flights")
                                      ├── ch_fill(destination)
                                      └── ✅ Done in 15-30 seconds
```

---

## When Each Mode is Used

```
  User request comes in
        │
        ▼
  ┌─ Needs auth? ──────────────────── YES ──→  ch_* (Extension)
  │     │                                       User's Chrome
  │    NO                                       All sessions
  │     │
  │     ▼
  ├─ Needs speed / CI? ────────────── YES ──→  pw_* (Playwright)
  │     │                                       Fresh Chromium
  │    NO                                       Headless, fast
  │     │
  │     ▼
  ├─ Visual blocker (CAPTCHA/dialog)? YES ──→  pw_promote → cu_*
  │     │                                       Headed + Desktop AX
  │    NO
  │     │
  │     ▼
  └─ Desktop app (not browser)? ──── YES ──→  cu_* (Desktop)
                                                Native AX targets
```

---

## User Setup Guide

### Step 1: Install the Chrome Extension

Load the unpacked extension during development:

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select the directory: `src/hlvm/agent/chrome-ext/extension/`
5. The HLVM Browser Bridge extension should appear

### Step 2: Install the Native Messaging Host

```bash
hlvm chrome-ext setup
```

This command:
- Creates a wrapper script at `~/.hlvm/chrome-bridge/chrome-bridge-host.sh`
- Installs native messaging host manifests for all detected Chromium browsers
- Manifests are placed in each browser's `NativeMessagingHosts/` directory

### Step 3: Verify

```bash
hlvm chrome-ext status
```

Should show:
- Browser detected (Chrome, Brave, Edge, etc.)
- Native host manifest installed
- Extension connection status

### Uninstall

```bash
hlvm chrome-ext uninstall
```

Removes all native host manifests and the wrapper script.

---

## Protocol Specification

### Native Messaging Protocol (Chrome ↔ Native Host)

Chrome uses a length-prefixed binary protocol on stdin/stdout:

```
┌───────────────────────────────────────┐
│  4 bytes: UInt32 LE   │  N bytes     │
│  (message length)     │  (UTF-8 JSON)│
└───────────────────────────────────────┘
```

- Max message size: 1MB (host→Chrome), 64MB (Chrome→host)
- All debug output goes to stderr (stdout is protocol-only)

### Message Types (Chrome → Native Host)

| Type             | Purpose                  | Response Type      |
| ---------------- | ------------------------ | ------------------ |
| `ping`           | Keepalive check          | `pong`             |
| `get_status`     | Query host version       | `status_response`  |
| `tool_response`  | Tool result from browser | Forwarded to CLI   |
| `notification`   | Event from browser       | Forwarded to CLI   |

### Message Types (Native Host → Chrome)

| Type               | Purpose                    |
| ------------------ | -------------------------- |
| `pong`             | Ping response              |
| `status_response`  | Version + client count     |
| `mcp_connected`    | CLI client connected       |
| `mcp_disconnected` | CLI client disconnected    |
| `tool_request`     | Tool call from CLI         |
| `error`            | Protocol/parsing error     |

### Socket Protocol (CLI ↔ Native Host)

Same 4-byte LE length prefix + JSON framing, over Unix domain socket.

**Socket path**: `~/.hlvm/chrome-bridge/{pid}.sock`

**Request format**:
```json
{
  "id": "req_1_1712345678000",
  "method": "navigate",
  "params": { "url": "https://example.com" }
}
```

**Response format**:
```json
{
  "id": "req_1_1712345678000",
  "result": { "title": "Example", "url": "https://example.com", "tabId": 42 }
}
```

**Error format**:
```json
{
  "id": "req_1_1712345678000",
  "error": "Element not found: #submit-button"
}
```

---

## Tool Reference

### Navigation

| Tool           | Args                        | Description                           |
| -------------- | --------------------------- | ------------------------------------- |
| `ch_navigate`  | `url: string`               | Navigate to URL (user's auth)         |
| `ch_back`      | —                           | Navigate back in history              |

### Interaction

| Tool              | Args                                | Description                  |
| ----------------- | ----------------------------------- | ---------------------------- |
| `ch_click`        | `selector?`, `x?`, `y?`            | Click by selector or coords  |
| `ch_fill`         | `selector`, `value`                 | Fill form input (direct set) |
| `ch_type`         | `text`, `selector?`, `pressEnter?`  | Type character by character  |
| `ch_hover`        | `selector`                          | Hover without clicking       |
| `ch_scroll`       | `direction?`, `amount?`             | Scroll page                  |
| `ch_select_option`| `selector`, `value`                 | Select dropdown option       |

### Content Reading

| Tool           | Args                        | Description                           |
| -------------- | --------------------------- | ------------------------------------- |
| `ch_evaluate`  | `expression`                | Execute JS in page context            |
| `ch_screenshot`| `fullPage?`, `format?`      | Capture screenshot (via CDP)          |
| `ch_snapshot`  | —                           | Accessibility tree (CDP AX)           |
| `ch_content`   | `maxChars?`                 | Extract page text                     |
| `ch_links`     | `limit?`                    | Extract all links with hrefs          |
| `ch_wait_for`  | `selector?`, `event?`, `timeout?` | Wait for element/network       |

### Tab Management

| Tool            | Args                   | Description                    |
| --------------- | ---------------------- | ------------------------------ |
| `ch_tabs`       | —                      | List all open tabs             |
| `ch_tab_create` | `url?`, `active?`      | Create new tab                 |
| `ch_tab_close`  | `tabId?`               | Close a tab                    |
| `ch_tab_select` | `tabId`                | Switch to a tab                |

### Monitoring

| Tool         | Args       | Description                              |
| ------------ | ---------- | ---------------------------------------- |
| `ch_monitor` | —          | Enable console/network monitoring        |
| `ch_console` | `since?`   | Read buffered console messages           |
| `ch_network` | `since?`   | Read buffered network requests           |

---

## File Structure

```
src/hlvm/agent/chrome-ext/
├── mod.ts              # Barrel re-export
├── bridge.ts           # Backend resolution (socket detection + communication)
├── lock.ts             # Session lock (copied from CU lock pattern)
├── common.ts           # Browser paths, socket paths, detection
├── setup.ts            # Native host manifest installation
├── tools.ts            # ch_* tool definitions (20 tools)
├── types.ts            # Type definitions
├── session-state.ts    # Runtime session state
├── prompt.ts           # System prompt fragment for LLM
├── native-host.ts      # Standalone Deno binary for Chrome NM protocol
└── extension/
    ├── manifest.json   # Manifest V3 extension config
    ├── background.js   # Service worker: NM connection + tool dispatch
    ├── cdp.js          # chrome.debugger CDP wrapper
    ├── content.js      # Content script (DOM fallback)
    ├── popup.html      # Popup UI
    └── popup.js        # Popup logic
```

---

## Comparison: Claude Code vs HLVM

```
                    CC (Claude Code)          HLVM
                    ────────────────          ────
  Extension?        ✅ Yes                    ✅ Yes (same pattern)
  Native Host?      ✅ Node.js                ✅ Deno
  Auth sessions?    ✅ Yes                    ✅ Yes
  Playwright?       ❌ No                     ✅ Yes (kept for headless/CI)
  Headless/CI?      ❌ No                     ✅ Yes (pw_*)
  Desktop AX?       ❌ L1 only (coords)       ✅ L1+L2+L3 (native)
  chrome.debugger?  ❌ Content scripts only    ✅ Full CDP power
  Native targets?   ❌ No                     ✅ Yes (HLVM.app)
```

| What CC Does | What HLVM Does |
|---|---|
| Content scripts for DOM access | `chrome.debugger` for full CDP (screenshot, AX tree, network, console) |
| No headless browser | Playwright for clean headless automation |
| Screenshot coordinate guessing (L1) | Native AX targets (L3) via HLVM.app |
| Node.js native host | Deno native host |
| MCP-proxied tools | Direct builtin tool registry |

---

## Troubleshooting

### "No active Chrome extension bridge found"

The native host is not running or no socket was found.

1. Check that the extension is installed: `chrome://extensions/`
2. Check that the native host manifest is installed: `hlvm chrome-ext status`
3. Try reinstalling: `hlvm chrome-ext setup`
4. Check Chrome's native messaging log: `chrome://extensions/` → Errors

### "Chrome extension is in use by another session"

Another HLVM session holds the chrome-ext lock.

1. Wait for the other session to finish
2. If the other session crashed, the lock will auto-recover (PID-based stale detection)
3. Manual recovery: `rm ~/.hlvm/chrome-ext.lock`

### Yellow "debugging this browser" banner

This is expected when `ch_*` tools attach `chrome.debugger` to a tab.
The banner is dismissible and reappears on next attachment. This is a
Chrome security feature and cannot be suppressed.

### Extension disconnects frequently

Manifest V3 service workers can be killed after 30s of inactivity.
The native messaging port keeps the worker alive while connected.
If disconnects persist:

1. Check `chrome://serviceworker-internals/` for the extension's worker
2. The extension auto-reconnects after 3s (configurable in background.js)

### Tools fail with "Element not found"

1. Use `ch_content` or `ch_snapshot` to inspect the current page state
2. Verify the CSS selector is correct
3. Use `ch_wait_for` before interacting with dynamically loaded elements
4. Try `ch_evaluate` with custom JS for complex selectors

---

## Security Model

- **Socket permissions**: Unix socket created with `0o600` (owner-only read/write)
- **Socket directory**: Created with `0o700` (owner-only access)
- **Stale socket cleanup**: Dead PIDs detected, sockets removed on startup
- **Extension manifest**: Only registered extension IDs can connect
- **No remote access**: Unix sockets are local-only (no network exposure)
- **Lock isolation**: Chrome-ext lock is separate from CU lock — no cross-contamination
