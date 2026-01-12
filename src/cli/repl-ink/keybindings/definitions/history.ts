/**
 * History Keybindings - History search mode
 * Source: Input.tsx lines 808-879
 */

import type { Keybinding } from "../types.ts";
import { HandlerIds } from "../handler-registry.ts";

export const historyKeybindings: Keybinding[] = [
  {
    id: "ctrl+r",
    display: "Ctrl+R",
    label: "Search history",
    description: "Enter reverse history search mode",
    category: "History",
    action: { type: "HANDLER", id: HandlerIds.HISTORY_SEARCH },
  },
  {
    id: "ctrl+r-next",
    display: "Ctrl+R (in search)",
    label: "Next match",
    description: "Select next history match",
    category: "History",
    action: { type: "INFO" },  // Contextual - only in search mode
  },
  {
    id: "ctrl+s",
    display: "Ctrl+S (in search)",
    label: "Previous match",
    description: "Select previous history match",
    category: "History",
    action: { type: "INFO" },  // Contextual - only in search mode
  },
  {
    id: "enter-history",
    display: "Enter (in search)",
    label: "Confirm selection",
    description: "Use selected history entry",
    category: "History",
    action: { type: "INFO" },  // Contextual - only in search mode
  },
  {
    id: "escape-history",
    display: "Esc (in search)",
    label: "Cancel search",
    category: "History",
    action: { type: "INFO" },  // Contextual - only in search mode
  },
];
