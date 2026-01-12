/**
 * Paredit Keybindings - Structural S-expression editing
 *
 * Uses Option+lowercase (Alt on Windows/Linux):
 * - Option sends ESC sequence which terminals pass through
 * - Lowercase avoids Unicode character issues (Option+Shift problematic)
 * - Same pattern as Option+B/F for word navigation
 *
 * Keyboard layout (| = cursor):
 *
 *   SLURP (pull IN):
 *     Opt+S = forward   (a|) b   →  (a| b)    S for Slurp
 *     Opt+A = backward  a (|b)   →  (a |b)    A left of S
 *
 *   BARF (push OUT):
 *     Opt+X = forward   (a| b)   →  (a|) b    X for eXpel
 *     Opt+Z = backward  (a |b)   →  a (|b)    Z left of X
 *
 *   STRUCTURE:
 *     Opt+W = Wrap      |foo     →  (|foo)    W for Wrap
 *     Opt+U = Unwrap    ((|a))   →  (|a)      U for Unwrap
 *     Opt+R = Raise     (x (|y)) →  (|y)      R for Raise
 *     Opt+T = Transpose (a |b)   →  (b |a)    T for Transpose
 *     Opt+K = Kill      (a |b c) →  (a |)     K for Kill
 */

import type { Keybinding } from "../types.ts";
import { HandlerIds } from "../handler-registry.ts";

export const pareditKeybindings: Keybinding[] = [
  // ═══════════════════════════════════════════════════════════════════
  // SLURP: Pull expression INTO the current list
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "slurp-forward",
    display: "⌥S",
    label: "Slurp forward",
    description: "(a|) b → (a| b) — pull next expr in",
    category: "Paredit",
    action: { type: "HANDLER", id: HandlerIds.PAREDIT_SLURP_FORWARD },
  },
  {
    id: "slurp-backward",
    display: "⌥A",
    label: "Slurp backward",
    description: "a (|b) → (a |b) — pull prev expr in",
    category: "Paredit",
    action: { type: "HANDLER", id: HandlerIds.PAREDIT_SLURP_BACKWARD },
  },

  // ═══════════════════════════════════════════════════════════════════
  // BARF: Push expression OUT OF the current list
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "barf-forward",
    display: "⌥X",
    label: "Barf forward",
    description: "(a| b) → (a|) b — push last expr out",
    category: "Paredit",
    action: { type: "HANDLER", id: HandlerIds.PAREDIT_BARF_FORWARD },
  },
  {
    id: "barf-backward",
    display: "⌥Z",
    label: "Barf backward",
    description: "(a |b) → a (|b) — push first expr out",
    category: "Paredit",
    action: { type: "HANDLER", id: HandlerIds.PAREDIT_BARF_BACKWARD },
  },

  // ═══════════════════════════════════════════════════════════════════
  // STRUCTURE: Wrap, Unwrap, Raise, Transpose, Kill
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "wrap",
    display: "⌥W",
    label: "Wrap in parens",
    description: "|foo → (|foo) — wrap sexp in ()",
    category: "Paredit",
    action: { type: "HANDLER", id: HandlerIds.PAREDIT_WRAP },
  },
  {
    id: "splice",
    display: "⌥U",
    label: "Unwrap (splice)",
    description: "((|a)) → (|a) — remove surrounding ()",
    category: "Paredit",
    action: { type: "HANDLER", id: HandlerIds.PAREDIT_SPLICE },
  },
  {
    id: "raise",
    display: "⌥R",
    label: "Raise sexp",
    description: "(x (|y)) → (|y) — replace parent",
    category: "Paredit",
    action: { type: "HANDLER", id: HandlerIds.PAREDIT_RAISE },
  },
  {
    id: "transpose",
    display: "⌥T",
    label: "Transpose sexps",
    description: "(a |b) → (b |a) — swap expressions",
    category: "Paredit",
    action: { type: "HANDLER", id: HandlerIds.PAREDIT_TRANSPOSE },
  },
  {
    id: "kill",
    display: "⌥K",
    label: "Kill sexp",
    description: "(a |b c) → (a | c) — delete sexp",
    category: "Paredit",
    action: { type: "HANDLER", id: HandlerIds.PAREDIT_KILL },
  },
];
