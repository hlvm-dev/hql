/**
 * Conversation Keybindings - Transcript and conversation-surface shortcuts
 */

import type { Keybinding } from "../types.ts";
import { HandlerIds } from "../handler-registry.ts";

export const conversationKeybindings: Keybinding[] = [
  {
    id: "conversation-search",
    display: "Ctrl+R",
    label: "Open transcript search",
    description: "Open transcript history overlay with search active",
    category: "Global",
    action: { type: "HANDLER", id: HandlerIds.CONVERSATION_SEARCH },
  },
  {
    id: "ctrl+o",
    display: "Ctrl+O",
    label: "Transcript history",
    description: "Open the transcript reference overlay",
    category: "Global",
    action: { type: "HANDLER", id: HandlerIds.CONVERSATION_OPEN_HISTORY },
  },
  {
    id: "ctrl+y",
    display: "Ctrl+Y",
    label: "Open latest source",
    description: "Open the latest assistant source URL",
    category: "Global",
    action: { type: "HANDLER", id: HandlerIds.CONVERSATION_OPEN_LATEST_SOURCE },
  },
];
