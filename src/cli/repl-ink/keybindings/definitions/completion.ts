/**
 * Completion Keybindings - Dropdown navigation
 * Source: Input.tsx lines 1219-1274
 */

import type { Keybinding } from "../types.ts";
import { HandlerIds } from "../handler-registry.ts";

export const completionKeybindings: Keybinding[] = [
  {
    id: "tab",
    display: "Tab",
    label: "Complete / drill",
    description: "Complete or enter directory/show params",
    category: "Completion",
    action: { type: "HANDLER", id: HandlerIds.COMPLETION_ACCEPT },
  },
  {
    id: "enter-completion",
    display: "Enter",
    label: "Select completion",
    description: "Choose selected item and close dropdown",
    category: "Completion",
    action: { type: "INFO" },  // Contextual - only in dropdown mode
  },
  {
    id: "up-down-completion",
    display: "Up/Down",
    label: "Navigate completions",
    category: "Completion",
    action: { type: "INFO" },  // Contextual - only in dropdown mode
  },
  {
    id: "ctrl+d",
    display: "Ctrl+D",
    label: "Toggle documentation",
    description: "Show/hide extended documentation panel",
    category: "Completion",
    action: { type: "HANDLER", id: HandlerIds.COMPLETION_TOGGLE_DOCS },
  },
  {
    id: "escape-completion",
    display: "Esc",
    label: "Close dropdown",
    category: "Completion",
    action: { type: "HANDLER", id: HandlerIds.COMPLETION_CANCEL },
  },
  {
    id: "right-accept",
    display: "Right",
    label: "Accept ghost suggestion",
    description: "Accept ghost text when at end of line",
    category: "Completion",
    action: { type: "INFO" },  // Contextual - only with ghost text
  },
];
