/**
 * Message Utilities
 *
 * Shared helpers for loading complete message histories from SQLite.
 * Used by chat handler, SSE handler, and agent integration.
 */

import { getMessages } from "./conversation-store.ts";
import type { MessageRow } from "./types.ts";

const MAX_PAGES = 500;

export function parseStoredStringArray(
  value: string | null | undefined,
): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return undefined;
    const items = parsed.filter((item): item is string =>
      typeof item === "string"
    );
    return items.length > 0 ? items : undefined;
  } catch {
    return undefined;
  }
}

export function loadAllMessages(sessionId: string): MessageRow[] {
  const allMessages: MessageRow[] = [];
  let offset = 0;
  const pageSize = 200;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = getMessages(sessionId, {
      limit: pageSize,
      offset,
      sort: "asc",
    });
    allMessages.push(...result.messages);
    if (!result.has_more) break;
    offset += pageSize;
  }
  return allMessages;
}

/**
 * Load only the most recent messages for a session.
 * Much faster than loadAllMessages() when only recent context is needed
 * (e.g., agent mode uses last ~10 messages, not the full 100K+ history).
 */
export function loadRecentMessages(
  sessionId: string,
  limit: number,
): MessageRow[] {
  const result = getMessages(sessionId, { limit, sort: "desc" });
  return result.messages.reverse();
}
