/**
 * Conversation Keybindings - Transcript and conversation-surface shortcuts
 */

import type { Keybinding } from "../types.ts";
import { HandlerIds } from "../handler-registry.ts";

export const conversationKeybindings: Keybinding[] = [
  {
    id: "conversation-search",
    display: "Ctrl+R",
    label: "Search transcript",
    description: "Search the visible conversation transcript",
    category: "Conversation",
    action: { type: "HANDLER", id: HandlerIds.CONVERSATION_SEARCH },
  },
  {
    id: "conversation-search-next",
    display: "Ctrl+R (in transcript search)",
    label: "Next transcript match",
    description: "Select the next transcript search match",
    category: "Conversation",
    action: { type: "INFO" },
  },
  {
    id: "conversation-search-prev",
    display: "Ctrl+S (in transcript search)",
    label: "Previous transcript match",
    description: "Select the previous transcript search match",
    category: "Conversation",
    action: { type: "INFO" },
  },
  {
    id: "ctrl+o",
    display: "Ctrl+O",
    label: "Transcript history",
    description: "Open the transcript reference overlay",
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
