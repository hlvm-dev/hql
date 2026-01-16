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
import {
  refreshKeybindingLookup,
  matchCustomKeybinding,
  isDefaultDisabled,
  getEffectiveDisplay,
} from "./keybinding-lookup.ts";

// Register all keybindings on module load
registry.registerAll(allKeybindings);

// Initialize keybinding lookup with custom bindings from config
refreshKeybindingLookup();

// Re-export registry and types
export { registry } from "./registry.ts";
export { getDisplay, CATEGORY_ORDER } from "./types.ts";
export type {
  Keybinding,
  KeybindingMatch,
  KeybindingCategory,
  KeybindingAction,
} from "./types.ts";

// Re-export keybinding lookup functions
export {
  refreshKeybindingLookup,
  matchCustomKeybinding,
  isDefaultDisabled,
  getEffectiveDisplay,
} from "./keybinding-lookup.ts";

// Re-export handler registry functions
export { executeHandler, registerHandler, unregisterHandler, HandlerIds } from "./handler-registry.ts";
