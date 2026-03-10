/**
 * Composer Keybindings - Chat/composer-specific actions
 */

import type { Keybinding } from "../types.ts";
import { HandlerIds } from "../handler-registry.ts";

export const composerKeybindings: Keybinding[] = [
  {
    id: "shift+tab",
    display: "Shift+Tab",
    label: "Cycle agent mode",
    description: "Cycle default, accept-edits, plan, and full-auto modes",
    category: "Composer",
    action: { type: "HANDLER", id: HandlerIds.COMPOSER_CYCLE_MODE },
  },
  {
    id: "ctrl+enter-force",
    display: "Ctrl+Enter",
    label: "Force-send (interrupt)",
    description: "Stop current response and immediately send your message",
    category: "Composer",
    action: { type: "HANDLER", id: HandlerIds.COMPOSER_FORCE_SUBMIT },
  },
];
