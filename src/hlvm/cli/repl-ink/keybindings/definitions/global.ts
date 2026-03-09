/**
 * Global Keybindings - App-level shortcuts
 * Source: App.tsx lines 323-340
 */

import type { Keybinding } from "../types.ts";

export const globalKeybindings: Keybinding[] = [
  {
    id: "question-mark",
    display: "?",
    label: "Show shortcuts",
    description: "Open shortcuts overlay when the prompt is empty",
    category: "Global",
    action: { type: "INFO" },
  },
  {
    id: "ctrl+c",
    display: "Ctrl+C",
    label: "Exit",
    category: "Global",
    action: { type: "HANDLER", id: "app.exit" },
  },
  {
    id: "ctrl+l",
    display: "Ctrl+L",
    label: "Clear screen",
    category: "Global",
    action: { type: "HANDLER", id: "app.clear" },
  },
  {
    id: "ctrl+p",
    display: "Ctrl+P",
    label: "Command palette",
    description: "Open searchable command palette",
    category: "Global",
    action: { type: "HANDLER", id: "app.openPalette" },
  },
  {
    id: "ctrl+b",
    display: "Ctrl+B",
    label: "Background tasks",
    description: "Open background tasks overlay",
    category: "Global",
    action: { type: "HANDLER", id: "app.openTasks" },
  },
  {
    id: "shift+tab",
    display: "Shift+Tab",
    label: "Cycle agent mode",
    description: "Cycle default, accept-edits, and plan modes",
    category: "Global",
    action: { type: "INFO" },
  },
  {
    id: "ctrl+o",
    display: "Ctrl+O",
    label: "Toggle latest section",
    description: "Expand or collapse the latest tool or thinking block",
    category: "Global",
    action: { type: "INFO" },
  },
  {
    id: "ctrl+y",
    display: "Ctrl+Y",
    label: "Open latest source",
    description: "Open the latest assistant source URL",
    category: "Global",
    action: { type: "INFO" },
  },
  {
    id: "pgup-pgdn",
    display: "PgUp/PgDn",
    label: "Scroll terminal",
    description: "Scroll conversation output in the terminal",
    category: "Global",
    action: { type: "INFO" },
  },
  {
    id: "esc-global",
    display: "Esc",
    label: "Cancel or close",
    description: "Cancel the running agent or close the current overlay",
    category: "Global",
    action: { type: "INFO" },
  },
];
