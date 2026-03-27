/**
 * Conversation Keybindings - Transcript and conversation-surface shortcuts
 */

import type { Keybinding } from "../types.ts";
import { HandlerIds } from "../handler-registry.ts";

export const conversationKeybindings: Keybinding[] = [
  {
    id: "ctrl+o",
    display: "Ctrl+O",
    label: "Transcript history",
    description: "Open the compact transcript/history viewer",
    category: "Conversation",
    action: { type: "HANDLER", id: HandlerIds.CONVERSATION_OPEN_HISTORY },
  },
  {
    id: "ctrl+y",
    display: "Ctrl+Y",
    label: "Open latest source",
    description: "Open the latest assistant source URL",
    category: "Conversation",
    action: { type: "HANDLER", id: HandlerIds.CONVERSATION_OPEN_LATEST_SOURCE },
  },
  {
    id: "pgup-pgdn",
    display: "PgUp/PgDn",
    label: "Scroll terminal",
    description: "Scroll conversation output in the terminal",
    category: "Conversation",
    action: { type: "INFO" },
  },
];
