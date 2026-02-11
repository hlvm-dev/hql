/**
 * Message Utilities
 *
 * Shared helpers for loading complete message histories from SQLite.
 * Used by chat handler, SSE handler, and agent integration.
 */

import { getMessages } from "./conversation-store.ts";
import type { MessageRow } from "./types.ts";

const MAX_PAGES = 500;

export function loadAllMessages(sessionId: string): MessageRow[] {
  const allMessages: MessageRow[] = [];
  let offset = 0;
  const pageSize = 200;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = getMessages(sessionId, { limit: pageSize, offset, sort: "asc" });
    allMessages.push(...result.messages);
    if (!result.has_more) break;
    offset += pageSize;
  }
  return allMessages;
}
