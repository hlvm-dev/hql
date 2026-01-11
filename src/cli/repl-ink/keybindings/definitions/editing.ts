/**
 * Editing Keybindings - Line editing shortcuts
 * Source: Input.tsx lines 1383-1409
 */

import type { Keybinding } from "../types.ts";

export const editingKeybindings: Keybinding[] = [
  {
    id: "ctrl+a",
    display: "Ctrl+A",
    label: "Jump to start of line",
    category: "Editing",
    action: { type: "INFO" },
  },
  {
    id: "ctrl+e",
    display: "Ctrl+E",
    label: "Jump to end of line",
    description: "Also accepts ghost suggestion when at end",
    category: "Editing",
    action: { type: "INFO" },
  },
  {
    id: "ctrl+u",
    display: "Ctrl+U",
    label: "Delete to start of line",
    category: "Editing",
    action: { type: "INFO" },
  },
  {
    id: "ctrl+k",
    display: "Ctrl+K",
    label: "Delete to end of line",
    category: "Editing",
    action: { type: "INFO" },
  },
  {
    id: "ctrl+w",
    display: "Ctrl+W",
    label: "Delete word backward",
    description: "LISP-aware - respects parentheses",
    category: "Editing",
    action: { type: "INFO" },
  },
];
