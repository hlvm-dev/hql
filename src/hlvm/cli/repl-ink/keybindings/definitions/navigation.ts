/**
 * Navigation Keybindings - Cursor movement
 * Source: Input.tsx lines 929-1000
 */

import type { Keybinding } from "../types.ts";
import { HandlerIds } from "../handler-registry.ts";

export const navigationKeybindings: Keybinding[] = [
  // Word navigation
  {
    id: "alt+left",
    display: "Alt+Left",
    displayByPlatform: { darwin: "Opt+Left", win32: "Ctrl+Left" },
    label: "Word backward",
    category: "Navigation",
    action: { type: "HANDLER", id: HandlerIds.NAV_WORD_BACK },
  },
  {
    id: "alt+right",
    display: "Alt+Right",
    displayByPlatform: { darwin: "Opt+Right", win32: "Ctrl+Right" },
    label: "Word forward",
    category: "Navigation",
    action: { type: "HANDLER", id: HandlerIds.NAV_WORD_FORWARD },
  },

  // S-expression navigation
  {
    id: "ctrl+up",
    display: "Ctrl+Up",
    label: "Backward up sexp",
    description: "Move to opening paren of enclosing list",
    category: "Navigation",
    action: { type: "HANDLER", id: HandlerIds.NAV_SEXP_UP },
  },
  {
    id: "ctrl+down",
    display: "Ctrl+Down",
    label: "Forward down sexp",
    description: "Move into next list",
    category: "Navigation",
    action: { type: "HANDLER", id: HandlerIds.NAV_SEXP_DOWN },
  },
  {
    id: "alt+up",
    display: "Alt+Up",
    label: "Backward sexp",
    description: "Move back by s-expression",
    category: "Navigation",
    action: { type: "HANDLER", id: HandlerIds.NAV_SEXP_BACK },
  },
  {
    id: "alt+down",
    display: "Alt+Down",
    label: "Forward sexp",
    description: "Move forward by s-expression",
    category: "Navigation",
    action: { type: "HANDLER", id: HandlerIds.NAV_SEXP_FORWARD },
  },

  // Multi-line (Option+Enter — industry standard: Claude Code, Codex)
  {
    id: "alt+enter",
    display: "Alt+Enter",
    displayByPlatform: { darwin: "Opt+Enter" },
    label: "Insert newline",
    description: "For multi-line input",
    category: "Navigation",
    action: { type: "HANDLER", id: HandlerIds.NAV_INSERT_NEWLINE },
  },

  // Arrow navigation (contextual - behavior changes based on cursor position)
  {
    id: "up-arrow",
    display: "Up",
    label: "Move to start / history",
    description: "Move to line start, then navigate history",
    category: "Navigation",
    action: { type: "INFO" },  // Contextual - can't execute from palette
  },
  {
    id: "down-arrow",
    display: "Down",
    label: "Move to end / history",
    description: "Move to line end, then navigate history",
    category: "Navigation",
    action: { type: "INFO" },  // Contextual - can't execute from palette
  },
];
