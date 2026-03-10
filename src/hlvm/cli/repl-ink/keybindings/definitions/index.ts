/**
 * Keybinding Definitions - Aggregates all categories
 */

import { globalKeybindings as rawGlobalKeybindings } from "./global.ts";
import { conversationKeybindings } from "./conversation.ts";
import { composerKeybindings } from "./composer.ts";
import { editingKeybindings } from "./editing.ts";
import { navigationKeybindings } from "./navigation.ts";
import { completionKeybindings } from "./completion.ts";
import { historyKeybindings } from "./history.ts";
import { pareditKeybindings } from "./paredit.ts";
import { commandKeybindings } from "./commands.ts";
import type { Keybinding } from "../types.ts";

const OMITTED_GLOBAL_KEYBINDING_IDS = new Set(["question-mark"]);

// Keep the runtime keybinding registry aligned with the current REPL UX:
// bare "?" must remain normal text input, not a reserved global shortcut.
export const globalKeybindings: readonly Keybinding[] = rawGlobalKeybindings
  .filter((binding) => !OMITTED_GLOBAL_KEYBINDING_IDS.has(binding.id));

/**
 * All keybinding definitions combined.
 * Import this to register all keybindings at once.
 */
export const allKeybindings: readonly Keybinding[] = [
  ...globalKeybindings,
  ...conversationKeybindings,
  ...composerKeybindings,
  ...editingKeybindings,
  ...navigationKeybindings,
  ...completionKeybindings,
  ...historyKeybindings,
  ...pareditKeybindings,
  ...commandKeybindings,
];

// Re-export individual categories for fine-grained access
export {
  conversationKeybindings,
  composerKeybindings,
  editingKeybindings,
  navigationKeybindings,
  completionKeybindings,
  historyKeybindings,
  pareditKeybindings,
  commandKeybindings,
};
