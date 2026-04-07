# Computer Use — Overview

HLVM's computer use system gives the AI agent the ability to see and interact with the user's macOS desktop — take screenshots, click, type, scroll, drag, and manage applications. This is a port of Claude Code's computer use implementation, adapted to HLVM's SSOT architecture.

## Quick Links

| Document | Purpose |
|----------|---------|
| [Architecture](./architecture.md) | System design, data flow, component map |
| [Progress](./progress.md) | What's done, what's remaining, current gaps |
| [Hybrid Strategy](./hybrid-strategy.md) | Playwright + CU hybrid approach for browser tasks |

## What It Does

The agent can autonomously control the Mac desktop:

```
User: "Open Safari, search for Cursor, and download it"
  → Agent calls cu_screenshot (sees desktop)
  → Agent calls cu_open_application (opens Safari)
  → Agent calls cu_key cmd+l (focuses address bar)
  → Agent calls cu_type "cursor editor download" + cu_key return
  → Agent calls cu_screenshot (sees Google results)
  → Agent calls cu_left_click at download link coordinates
  → Agent calls cu_screenshot (sees download page)
  → Agent calls cu_left_click on download button
  → Done
```

## 22 Tools (CC Parity)

All tools match the Anthropic SDK `computer_20250124` spec.

| Category | Tools | Safety |
|----------|-------|--------|
| Screenshot | `cu_screenshot`, `cu_zoom` | L1 (read) |
| Cursor | `cu_cursor_position` | L0 (read) |
| Click | `cu_left_click`, `cu_right_click`, `cu_middle_click`, `cu_double_click`, `cu_triple_click` | L2 (write) |
| Mouse | `cu_mouse_move`, `cu_left_mouse_down`, `cu_left_mouse_up`, `cu_left_click_drag` | L2 (write) |
| Keyboard | `cu_type`, `cu_key`, `cu_hold_key` | L2 (write) |
| Clipboard | `cu_read_clipboard`, `cu_write_clipboard` | L0/L2 |
| Scroll | `cu_scroll` | L2 (write) |
| Apps | `cu_list_granted_applications`, `cu_open_application`, `cu_request_access` | L0/L2 |
| Wait | `cu_wait` (sleep + screenshot) | L1 (read) |

## Requirements

- **macOS only** (platform guard rejects non-Darwin)
- **Vision-capable LLM** (needs to interpret screenshots)
- **Accessibility permissions** (System Preferences > Privacy & Security)
