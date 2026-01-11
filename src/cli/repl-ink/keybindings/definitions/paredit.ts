/**
 * Paredit Keybindings - Structural editing
 * Source: Input.tsx lines 1007-1021, 1344-1379
 */

import type { Keybinding } from "../types.ts";

export const pareditKeybindings: Keybinding[] = [
  // Slurp operations
  {
    id: "slurp-forward",
    display: "Ctrl+Shift+)",
    label: "Slurp forward",
    description: "Pull next expression into current list",
    category: "Paredit",
    action: { type: "INFO" },
  },
  {
    id: "slurp-backward",
    display: "Ctrl+Shift+(",
    label: "Slurp backward",
    description: "Pull previous expression into current list",
    category: "Paredit",
    action: { type: "INFO" },
  },

  // Barf operations
  {
    id: "barf-forward",
    display: "Ctrl+Shift+}",
    label: "Barf forward",
    description: "Push last expression out of current list",
    category: "Paredit",
    action: { type: "INFO" },
  },
  {
    id: "barf-backward",
    display: "Ctrl+Shift+{",
    label: "Barf backward",
    description: "Push first expression out of current list",
    category: "Paredit",
    action: { type: "INFO" },
  },

  // Structural operations
  {
    id: "wrap",
    display: "Alt+(",
    label: "Wrap in parens",
    description: "Wrap current s-expression in parentheses",
    category: "Paredit",
    action: { type: "INFO" },
  },
  {
    id: "splice",
    display: "Alt+S",
    label: "Splice (unwrap)",
    description: "Remove surrounding parentheses",
    category: "Paredit",
    action: { type: "INFO" },
  },
  {
    id: "raise",
    display: "Alt+R",
    label: "Raise sexp",
    description: "Replace parent with current expression",
    category: "Paredit",
    action: { type: "INFO" },
  },
  {
    id: "kill",
    display: "Ctrl+Shift+K",
    label: "Kill sexp",
    description: "Delete entire s-expression at cursor",
    category: "Paredit",
    action: { type: "INFO" },
  },
  {
    id: "transpose",
    display: "Ctrl+Shift+T",
    label: "Transpose sexps",
    description: "Swap adjacent s-expressions",
    category: "Paredit",
    action: { type: "INFO" },
  },
];
