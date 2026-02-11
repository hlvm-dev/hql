/**
 * Message Utilities
 *
 * Shared helpers for loading complete message histories from SQLite.
 * Used by chat handler, SSE handler, and agent integration.
 */

import { getMessages } from "./conversation-store.ts";
import type { MessageRow } from "./types.ts";

export function loadAllMessages(sessionId: string): MessageRow[] {
  const allMessages: MessageRow[] = [];
  let offset = 0;
  const pageSize = 200;
  while (true) {
    const page = getMessages(sessionId, { limit: pageSize, offset, sort: "asc" });
    allMessages.push(...page.messages);
    if (!page.has_more) break;
    offset += pageSize;
  }
  return allMessages;
}
