/**
 * Keybinding Definitions - Aggregates all categories
 */

import { globalKeybindings } from "./global.ts";
import { editingKeybindings } from "./editing.ts";
import { navigationKeybindings } from "./navigation.ts";
import { completionKeybindings } from "./completion.ts";
import { historyKeybindings } from "./history.ts";
import { pareditKeybindings } from "./paredit.ts";
import { commandKeybindings } from "./commands.ts";
import type { Keybinding } from "../types.ts";

/**
 * All keybinding definitions combined.
 * Import this to register all keybindings at once.
 */
export const allKeybindings: readonly Keybinding[] = [
  ...globalKeybindings,
  ...editingKeybindings,
  ...navigationKeybindings,
  ...completionKeybindings,
  ...historyKeybindings,
  ...pareditKeybindings,
  ...commandKeybindings,
];

// Re-export individual categories for fine-grained access
export {
  globalKeybindings,
  editingKeybindings,
  navigationKeybindings,
  completionKeybindings,
  historyKeybindings,
  pareditKeybindings,
  commandKeybindings,
};
