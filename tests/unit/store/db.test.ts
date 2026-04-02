import { assertEquals } from "jsr:@std/assert";
import { Database } from "@db/sqlite";
import { getConversationsDbPath } from "../../../src/common/paths.ts";
import { getDb, _resetDbForTesting } from "../../../src/hlvm/store/db.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { withTempHlvmDir } from "../helpers.ts";

Deno.test("conversation db migrates schema v1 in place without dropping stored messages", async () => {
  await withTempHlvmDir(async () => {
    const dbPath = getConversationsDbPath();
    const platform = getPlatform();
    platform.fs.mkdirSync(platform.path.dirname(dbPath), { recursive: true });

    const seeded = new Database(dbPath);
    try {
      seeded.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          message_count INTEGER NOT NULL DEFAULT 0,
          session_version INTEGER NOT NULL DEFAULT 0,
          metadata TEXT
        );
        CREATE TABLE host_state (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          "order" INTEGER NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          client_turn_id TEXT,
          request_id TEXT,
          sender_type TEXT NOT NULL DEFAULT 'user',
          sender_detail TEXT,
          attachment_ids TEXT,
          tool_calls TEXT,
          tool_name TEXT,
          tool_call_id TEXT,
          cancelled INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(session_id, "order"),
          UNIQUE(session_id, client_turn_id)
        );
      `);
      seeded.exec("PRAGMA user_version = 1");
      seeded.prepare(
        `INSERT INTO sessions
           (id, title, created_at, updated_at, message_count, session_version)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        "sess-1",
        "Migrated",
        "2026-04-03T00:00:00.000Z",
        "2026-04-03T00:00:00.000Z",
        1,
        1,
      );
      seeded.prepare(
        `INSERT INTO messages
           (session_id, "order", role, content, client_turn_id, request_id,
            sender_type, sender_detail, attachment_ids, tool_calls, tool_name,
            tool_call_id, cancelled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "sess-1",
        1,
        "user",
        "expanded pasted text",
        "turn-1",
        "req-1",
        "user",
        null,
        null,
        null,
        null,
        null,
        0,
        "2026-04-03T00:00:00.000Z",
      );
    } finally {
      seeded.close();
    }

    _resetDbForTesting();
    const migrated = getDb();
    try {
      const version = migrated.prepare("PRAGMA user_version").value<[number]>();
      const displayColumn = migrated.prepare(
        "SELECT name FROM pragma_table_info('messages') WHERE name = 'display_content'",
      ).get<{ name: string }>();
      const row = migrated.prepare(
        "SELECT content, display_content FROM messages WHERE session_id = ?",
      ).get<{ content: string; display_content: string | null }>("sess-1");

      assertEquals(version?.[0], 2);
      assertEquals(displayColumn?.name, "display_content");
      assertEquals(row, {
        content: "expanded pasted text",
        display_content: null,
      });
    } finally {
      _resetDbForTesting();
    }
  });
});
