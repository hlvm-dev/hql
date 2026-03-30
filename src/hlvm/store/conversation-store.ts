/**
 * Conversation Store
 *
 * Session + message CRUD backed by SQLite.
 * All operations use prepared statements (cached by @db/sqlite).
 */

import { getDb } from "./db.ts";
import type {
  InsertMessageOpts,
  MessageRow,
  PagedMessages,
  PageOpts,
  SessionRow,
} from "./types.ts";
import { clearSessionBuffer } from "./sse-store.ts";

// MARK: - Session Operations

export function createSession(title?: string, id?: string): SessionRow {
  const db = getDb();
  const sessionId = id ?? crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO sessions (id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run(sessionId, title ?? "", now, now);

  return getSession(sessionId)!;
}

export function getSession(id: string): SessionRow | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT id, title, created_at, updated_at, message_count, session_version, metadata
     FROM sessions WHERE id = ?`,
  ).get<SessionRow>(id);
  return row ?? null;
}

export function listSessions(): SessionRow[] {
  const db = getDb();
  return db.prepare(
    `SELECT id, title, created_at, updated_at, message_count, session_version, metadata
     FROM sessions ORDER BY updated_at DESC, rowid DESC`,
  ).all<SessionRow>();
}

export function getHostStateValue(key: string): string | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT value FROM host_state WHERE key = ?",
  ).get<{ value: string }>(key);
  return row?.value ?? null;
}

export function setHostStateValue(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO host_state (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  ).run(key, value, new Date().toISOString());
}

export function deleteHostStateValue(key: string): void {
  const db = getDb();
  db.prepare("DELETE FROM host_state WHERE key = ?").run(key);
}

export function updateSession(
  id: string,
  patch: { title?: string; metadata?: string | null },
): SessionRow | null {
  const db = getDb();
  const existing = getSession(id);
  if (!existing) return null;

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (patch.title !== undefined) {
    updates.push("title = ?");
    values.push(patch.title);
  }
  if (patch.metadata !== undefined) {
    updates.push("metadata = ?");
    values.push(patch.metadata);
  }

  if (updates.length === 0) return existing;

  updates.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(
    `UPDATE sessions SET ${updates.join(", ")} WHERE id = ?`,
  ).run(...values);

  return getSession(id);
}

export function deleteSession(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  if (result > 0) {
    clearSessionBuffer(id);
  }
  return result > 0;
}

export function getOrCreateSession(id: string): SessionRow {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO sessions (id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run(id, "", now, now);

  return getSession(id)!;
}

// MARK: - Session Version Helpers

/**
 * Bump session_version + updated_at, optionally adjusting message_count.
 * SSOT for all session-version mutations.
 */
function bumpSessionVersion(
  sessionId: string,
  now?: string,
  messageCountDelta?: number,
): void {
  const db = getDb();
  const ts = now ?? new Date().toISOString();

  const countClause = messageCountDelta !== undefined
    ? `, message_count = ${
      messageCountDelta >= 0
        ? `message_count + ${messageCountDelta}`
        : `MAX(message_count + ${messageCountDelta}, 0)`
    }`
    : "";
  db.prepare(
    `UPDATE sessions
     SET session_version = session_version + 1${countClause},
         updated_at = ?
     WHERE id = ?`,
  ).run(ts, sessionId);
}

// MARK: - Message Operations

function getMaxOrder(sessionId: string): number {
  const db = getDb();
  const row = db.prepare(
    `SELECT COALESCE(MAX("order"), 0) as max_order FROM messages WHERE session_id = ?`,
  ).value<[number]>(sessionId);
  return row?.[0] ?? 0;
}

export function insertMessage(opts: InsertMessageOpts): MessageRow {
  const db = getDb();
  const now = opts.created_at ?? new Date().toISOString();

  if (opts.client_turn_id) {
    const existing = getMessageByClientTurnId(
      opts.session_id,
      opts.client_turn_id,
    );
    if (existing) return existing;
  }

  // Atomic: getMaxOrder + INSERT + session UPDATE in a single transaction
  db.exec("BEGIN");
  try {
    const order = getMaxOrder(opts.session_id) + 1;

    db.prepare(
      `INSERT INTO messages
         (session_id, "order", role, content, client_turn_id, request_id,
          sender_type, sender_detail, attachment_ids, tool_calls, tool_name,
          tool_call_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      opts.session_id,
      order,
      opts.role,
      opts.content,
      opts.client_turn_id ?? null,
      opts.request_id ?? null,
      opts.sender_type ?? "user",
      opts.sender_detail ?? null,
      opts.attachment_ids ? JSON.stringify(opts.attachment_ids) : null,
      opts.tool_calls ? JSON.stringify(opts.tool_calls) : null,
      opts.tool_name ?? null,
      opts.tool_call_id ?? null,
      now,
    );

    bumpSessionVersion(opts.session_id, now, 1);

    const id = db.lastInsertRowId;
    const result = db.prepare(
      `SELECT * FROM messages WHERE id = ?`,
    ).get<MessageRow>(Number(id))!;

    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function getMessages(
  sessionId: string,
  opts?: PageOpts,
): PagedMessages {
  const db = getDb();
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const sort = opts?.sort === "asc" ? "ASC" : "DESC";

  let messages: MessageRow[];
  let total: number;
  let consumed: number;

  if (opts?.after_order !== undefined) {
    const op = sort === "ASC" ? ">" : "<";
    messages = db.prepare(
      `SELECT * FROM messages
       WHERE session_id = ? AND "order" ${op} ?
       ORDER BY "order" ${sort}
       LIMIT ?`,
    ).all<MessageRow>(sessionId, opts.after_order, limit);

    const countRow = db.prepare(
      `SELECT COUNT(*) FROM messages WHERE session_id = ? AND "order" ${op} ?`,
    ).value<[number]>(sessionId, opts.after_order);
    total = countRow?.[0] ?? 0;
    consumed = messages.length;
  } else {
    const offset = Math.max(opts?.offset ?? 0, 0);
    messages = db.prepare(
      `SELECT * FROM messages
       WHERE session_id = ?
       ORDER BY "order" ${sort}
       LIMIT ? OFFSET ?`,
    ).all<MessageRow>(sessionId, limit, offset);

    const countRow = db.prepare(
      `SELECT COUNT(*) FROM messages WHERE session_id = ?`,
    ).value<[number]>(sessionId);
    total = countRow?.[0] ?? 0;
    consumed = offset + messages.length;
  }

  return {
    messages,
    total,
    has_more: consumed < total,
    session_version: getSession(sessionId)?.session_version ?? 0,
    cursor: messages[messages.length - 1]?.order,
  };
}

export function getMessage(id: number): MessageRow | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT * FROM messages WHERE id = ?`,
  ).get<MessageRow>(id);
  return row ?? null;
}

export function deleteMessage(id: number, sessionId: string): boolean {
  const db = getDb();
  const result = db.prepare(
    "DELETE FROM messages WHERE id = ? AND session_id = ?",
  ).run(id, sessionId);

  if (result > 0) {
    bumpSessionVersion(sessionId, undefined, -1);
    return true;
  }
  return false;
}

export function updateMessage(
  id: number,
  patch: { cancelled?: boolean; content?: string },
): void {
  const db = getDb();
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (patch.cancelled !== undefined) {
    updates.push("cancelled = ?");
    values.push(patch.cancelled ? 1 : 0);
  }
  if (patch.content !== undefined) {
    updates.push("content = ?");
    values.push(patch.content);
  }

  if (updates.length === 0) return;
  values.push(id);

  db.prepare(
    `UPDATE messages SET ${updates.join(", ")} WHERE id = ?`,
  ).run(...values);

  const msg = getMessage(id);
  if (msg) {
    bumpSessionVersion(msg.session_id);
  }
}

export function cancelRequestMessages(
  sessionId: string,
  requestId: string,
  options?: { assistantMessageId?: number; assistantContent?: string },
): number {
  const db = getDb();

  db.exec("BEGIN");
  try {
    const changed = db.prepare(
      `UPDATE messages
       SET cancelled = 1
       WHERE session_id = ? AND request_id = ? AND cancelled = 0`,
    ).run(sessionId, requestId);

    if (options?.assistantMessageId !== undefined) {
      const updates: string[] = ["cancelled = 1"];
      const values: (string | number)[] = [];

      if (options.assistantContent !== undefined) {
        updates.push("content = ?");
        values.push(options.assistantContent);
      }

      values.push(options.assistantMessageId, sessionId);
      db.prepare(
        `UPDATE messages
         SET ${updates.join(", ")}
         WHERE id = ? AND session_id = ?`,
      ).run(...values);
    }

    if (changed > 0) {
      bumpSessionVersion(sessionId);
    }

    db.exec("COMMIT");
    return changed;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getMessageByClientTurnId(
  sessionId: string,
  clientTurnId: string,
): MessageRow | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT * FROM messages WHERE session_id = ? AND client_turn_id = ?`,
  ).get<MessageRow>(sessionId, clientTurnId);
  return row ?? null;
}

export function validateExpectedVersion(
  sessionId: string,
  expected: number,
): boolean {
  const session = getSession(sessionId);
  return session ? session.session_version === expected : expected === 0;
}
