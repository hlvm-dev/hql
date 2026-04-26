import { Database } from "@db/sqlite";
import type { ChannelTransportConfig } from "../../../common/config/types.ts";
import { RuntimeError } from "../../../common/error.ts";
import { getPlatform } from "../../../platform/platform.ts";

export interface IMessageChatDbConfig {
  recipientId: string;
  recipientIds?: string[];
  cursor?: number;
  chatId?: number;
}

export interface IMessageInboundRow {
  rowId: number;
  chatId: number;
  chatIdentifier: string;
  text: string;
  attributedBody?: Uint8Array;
  isFromMe: boolean;
  handleId: string | null;
}

export interface IMessageReadResult {
  rows: IMessageInboundRow[];
  cursor: number;
  chatId?: number;
}

export function getDefaultIMessageDbPath(): string {
  const platform = getPlatform();
  const home = platform.env.get("HOME");
  if (!home) {
    throw new RuntimeError(
      "iMessage transport requires HOME to locate Messages chat.db.",
    );
  }
  return platform.path.join(home, "Library", "Messages", "chat.db");
}

export function getDefaultIMessageWalPath(
  dbPath = getDefaultIMessageDbPath(),
): string {
  return `${dbPath}-wal`;
}

export function openIMessageChatDb(
  dbPath = getDefaultIMessageDbPath(),
): Database {
  return new Database(dbPath, {
    readonly: true,
    int64: true,
    unsafeConcurrency: true,
  });
}

export function normalizeIMessageRecipientId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeIMessageRecipientIds(...values: unknown[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      const recipientId = normalizeIMessageRecipientId(item);
      if (!recipientId || seen.has(recipientId)) continue;
      seen.add(recipientId);
      normalized.push(recipientId);
    }
  }
  return normalized;
}

export function readIMessageTransportConfig(
  transport: ChannelTransportConfig | undefined,
): IMessageChatDbConfig | null {
  const recipientId = normalizeIMessageRecipientId(
    transport?.recipientId ?? transport?.appleId ?? transport?.selfId,
  );
  if (!recipientId) return null;

  const recipientIds = normalizeIMessageRecipientIds(
    recipientId,
    transport?.recipientIds,
  );
  const cursor = typeof transport?.cursor === "number" &&
      Number.isInteger(transport.cursor) && transport.cursor >= 0
    ? transport.cursor
    : undefined;
  const chatId = typeof transport?.chatId === "number" &&
      Number.isInteger(transport.chatId) && transport.chatId > 0
    ? transport.chatId
    : undefined;

  return { recipientId, recipientIds, cursor, chatId };
}

export function buildIMessageSetupUrl(recipientId: string): string {
  return `sms:${encodeURIComponent(recipientId)}`;
}

export function getLatestIMessageRowId(db: Database): number {
  const row = db.prepare("SELECT COALESCE(MAX(ROWID), 0) AS rowId FROM message")
    .get() as { rowId: number | bigint | null } | undefined;
  return normalizeRowId(row?.rowId);
}

export function findFirstNewIMessageSelfChatId(
  db: Database,
  recipientIds: string | string[],
  cursor: number,
): number | undefined {
  const ids = normalizeIMessageRecipientIds(recipientIds);
  if (ids.length === 0) return undefined;
  const placeholders = ids.map(() => "?").join(", ");
  const row = db.prepare(`
    SELECT c.ROWID AS chatId
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    JOIN chat c ON c.ROWID = cmj.chat_id
    JOIN chat_handle_join chj ON chj.chat_id = c.ROWID
    JOIN handle h ON h.ROWID = chj.handle_id
    LEFT JOIN handle sender_h ON sender_h.ROWID = m.handle_id
    WHERE m.ROWID > ?
      AND COALESCE(sender_h.id, h.id) IN (${placeholders})
      AND h.id IN (${placeholders})
      AND (
        SELECT COUNT(*)
        FROM chat_handle_join count_chj
        WHERE count_chj.chat_id = c.ROWID
      ) = 1
    ORDER BY m.ROWID ASC
    LIMIT 1
  `).get(cursor, ...ids, ...ids) as { chatId: number | bigint } | undefined;

  const chatId = normalizeRowId(row?.chatId);
  return chatId > 0 ? chatId : undefined;
}

export function readNewIMessageRows(
  db: Database,
  config: IMessageChatDbConfig,
): IMessageReadResult {
  const currentCursor = config.cursor ?? 0;
  const recipientIds = normalizeIMessageRecipientIds(
    config.recipientId,
    config.recipientIds,
  );
  const scopedChatId = config.chatId ??
    findFirstNewIMessageSelfChatId(db, recipientIds, currentCursor);
  const messageScope = buildMessageScopeSql(scopedChatId);
  if (!messageScope) {
    return {
      rows: [],
      cursor: currentCursor,
    };
  }

  const messageColumns = getTableColumns(db, "message");
  const rows = db.prepare(`
    SELECT
      m.ROWID AS rowId,
      c.ROWID AS chatId,
      c.chat_identifier AS chatIdentifier,
      m.text AS text,
      m.is_from_me AS isFromMe,
      h.id AS handleId,
      ${
    selectOptionalColumn(messageColumns, "associated_message_type", "0")
  } AS associatedMessageType,
      ${
    selectOptionalColumn(messageColumns, "attributedBody", "NULL")
  } AS attributedBody,
      ${
    selectOptionalColumn(messageColumns, "date_retracted", "0")
  } AS dateRetracted,
      ${selectOptionalColumn(messageColumns, "date_edited", "0")} AS dateEdited,
      ${selectOptionalColumn(messageColumns, "is_unsent", "0")} AS isUnsent
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    JOIN chat c ON c.ROWID = cmj.chat_id
    LEFT JOIN handle h ON h.ROWID = m.handle_id
    WHERE m.ROWID > ?
      AND (${messageScope.sql})
    ORDER BY m.ROWID ASC
    LIMIT 100
  `).all(currentCursor, ...messageScope.params) as Array<{
    rowId: number | bigint;
    chatId: number | bigint;
    chatIdentifier: string | null;
    text: string | null;
    isFromMe: number | bigint | boolean | null;
    handleId: string | null;
    associatedMessageType: number | bigint | boolean | null;
    attributedBody: Uint8Array | null;
    dateRetracted: number | bigint | null;
    dateEdited: number | bigint | null;
    isUnsent: number | bigint | boolean | null;
  }>;

  let nextCursor = currentCursor;
  let nextChatId = scopedChatId;
  const messages: IMessageInboundRow[] = [];
  for (const row of rows) {
    const rowId = normalizeRowId(row.rowId);
    if (rowId > nextCursor) nextCursor = rowId;
    const text = typeof row.text === "string" ? row.text : "";
    const attributedBody = row.attributedBody instanceof Uint8Array
      ? row.attributedBody
      : null;
    if (!text.trim() && (!attributedBody || attributedBody.length === 0)) {
      continue;
    }
    if (isTruthySqliteValue(row.associatedMessageType)) continue;
    if (normalizeRowId(row.dateRetracted) > 0) continue;
    if (normalizeRowId(row.dateEdited) > 0) continue;
    if (isTruthySqliteValue(row.isUnsent)) continue;
    nextChatId = normalizeRowId(row.chatId);

    messages.push({
      rowId,
      chatId: nextChatId,
      chatIdentifier: row.chatIdentifier ?? "",
      text,
      ...(attributedBody ? { attributedBody } : {}),
      isFromMe: isTruthySqliteValue(row.isFromMe),
      handleId: row.handleId,
    });
  }

  return {
    rows: messages,
    cursor: nextCursor,
    ...(nextChatId ? { chatId: nextChatId } : {}),
  };
}

function buildMessageScopeSql(
  chatId: number | undefined,
): { sql: string; params: Array<string | number> } | null {
  if (chatId) {
    return { sql: "c.ROWID = ?", params: [chatId] };
  }
  return null;
}

function normalizeRowId(value: number | bigint | null | undefined): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return 0;
}

function isTruthySqliteValue(value: number | bigint | boolean | null): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value !== 0n;
  if (typeof value === "number") return value !== 0;
  return false;
}

function getTableColumns(db: Database, tableName: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<
    { name?: string }
  >;
  return new Set(
    rows.map((row) => row.name).filter((name): name is string => !!name),
  );
}

function selectOptionalColumn(
  columns: Set<string>,
  column: string,
  fallbackSql: string,
): string {
  return columns.has(column) ? `m.${column}` : fallbackSql;
}
