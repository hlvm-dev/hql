# Computer Use — Overview

HLVM's computer use system gives the AI agent the ability to see and interact with the user's macOS desktop — take screenshots, click, type, scroll, drag, and manage applications. This is a port of Claude Code's computer use implementation, adapted to HLVM's SSOT architecture.

**Status:** Phases 1-3 complete (tool layer + vision gating + E2E verified). Phase 4 (Playwright hybrid) is next.

## Quick Links

| Document | Purpose |
|----------|---------|
| [Architecture](./architecture.md) | System design, data flow, vision gating, component map |
| [Progress](./progress.md) | What's done, what's remaining, current gaps |
| [Hybrid Strategy](./hybrid-strategy.md) | Playwright + CU hybrid approach for browser tasks |

## What It Does

The agent can autonomously control the Mac desktop with **any vision-capable LLM**:

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

**Any vision-capable LLM works as the brain:**
```bash
# Free (local, private, offline)
hlvm ask --model ollama/llava:13b "take a screenshot and describe it"

# Cheap (CC-proxied, no API key needed)
hlvm ask --model claude-code/claude-haiku-4-5-20251001 "open Finder"

# Powerful
hlvm ask --model anthropic/claude-sonnet-4-20250514 "reorganize my desktop"

# OpenAI
hlvm ask --model openai/gpt-4o "find and open VS Code"
```

**CC comparison:**
| | Claude Code | HLVM |
|---|-------------|------|
| CU Tools | 22 | 22 (same set) |
| Brain | Claude only | Any vision-capable LLM |
| Vision gating | N/A (Claude always has vision) | Auto-deny for non-vision models |
| CU system prompt | Injected by Anthropic API backend | Self-contained in binary |
| Cost | Per-token only | Free with local vision models |

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

## Vision Gating

Non-vision models (e.g., `llama3.1:8b` text-only) are **automatically blocked** from CU:
- `cu_*` tools are removed from tool list
- CU system prompt section is suppressed
- Any stray image attachments get text fallback instead of binary injection

Derived from `modelInfo.capabilities` — frontier providers (anthropic/openai/google) default to vision-capable.

## Requirements

- **macOS only** (platform guard rejects non-Darwin)
- **Vision-capable LLM** (auto-detected — non-vision models silently skip CU)
- **Accessibility permissions** (System Preferences > Privacy & Security)
- **`--dangerously-skip-permissions`** for non-interactive use (L2 tools require approval)
