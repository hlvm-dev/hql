/**
 * Keybindings Registry - Public API
 *
 * Central export point for the keybindings system.
 * Usage:
 *   import { registry, getDisplay } from "./keybindings/index.ts";
 *   const results = registry.search("clear");
 */

import { registry } from "./registry.ts";
import { allKeybindings } from "./definitions/index.ts";

// Register all keybindings on module load
registry.registerAll(allKeybindings);

// Re-export
export { registry } from "./registry.ts";
export {
  getDisplay,
  getPlatform,
  CATEGORY_ORDER,
} from "./types.ts";
export type {
  Keybinding,
  KeybindingMatch,
  KeybindingCategory,
  KeybindingAction,
  Platform,
} from "./types.ts";

// Export definition categories for direct access
export {
  allKeybindings,
  globalKeybindings,
  editingKeybindings,
  navigationKeybindings,
  completionKeybindings,
  historyKeybindings,
  pareditKeybindings,
  commandKeybindings,
} from "./definitions/index.ts";
