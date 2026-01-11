/**
 * Global Keybindings - App-level shortcuts
 * Source: App.tsx lines 323-340
 */

import type { Keybinding } from "../types.ts";

export const globalKeybindings: Keybinding[] = [
  {
    id: "ctrl+c",
    display: "Ctrl+C",
    label: "Exit REPL",
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
];
