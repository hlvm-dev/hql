/**
 * Conversation Store Tests
 *
 * Verifies SQLite-backed session and message CRUD operations.
 */

import {
  assertEquals,
  assertExists,
} from "jsr:@std/assert";
import {
  createSession,
  getSession,
  listSessions,
  updateSession,
  deleteSession,
  getOrCreateSession,
  insertMessage,
  getMessages,
  getMessage,
  updateMessage,
  deleteMessage,
  getMessageByClientTurnId,
  validateExpectedVersion,
} from "../../../src/hlvm/store/conversation-store.ts";
import { setupStoreTestDb } from "../_shared/store-test-db.ts";

// MARK: - Session Operations

Deno.test({
  name: "Store: createSession - creates a session with title",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Test Session");
      assertExists(session.id);
      assertEquals(session.title, "Test Session");
      assertEquals(session.message_count, 0);
      assertEquals(session.session_version, 0);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: createSession - creates a session with default empty title",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession();
      assertEquals(session.title, "");
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: createSession - with custom ID",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Custom ID", "my-custom-id");
      assertEquals(session.id, "my-custom-id");
      assertEquals(session.title, "Custom ID");
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: getSession - returns null for non-existent session",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = getSession("non-existent");
      assertEquals(session, null);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: listSessions - returns all sessions",
  fn() {
    const db = setupStoreTestDb();
    try {
      createSession("First");
      createSession("Second");
      const sessions = listSessions();
      assertEquals(sessions.length, 2);
      const titles = sessions.map((s) => s.title).sort();
      assertEquals(titles, ["First", "Second"]);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: updateSession - updates title",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Original");
      const updated = updateSession(session.id, { title: "Updated" });
      assertExists(updated);
      assertEquals(updated!.title, "Updated");
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: updateSession - returns null for non-existent session",
  fn() {
    const db = setupStoreTestDb();
    try {
      const result = updateSession("non-existent", { title: "X" });
      assertEquals(result, null);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: deleteSession - removes session",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Delete Me");
      const result = deleteSession(session.id);
      assertEquals(result, true);
      assertEquals(getSession(session.id), null);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: deleteSession - returns false for non-existent",
  fn() {
    const db = setupStoreTestDb();
    try {
      assertEquals(deleteSession("non-existent"), false);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: getOrCreateSession - creates new session",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = getOrCreateSession("new-id");
      assertEquals(session.id, "new-id");
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: getOrCreateSession - returns existing session (idempotent)",
  fn() {
    const db = setupStoreTestDb();
    try {
      const first = getOrCreateSession("idempotent-id");
      const second = getOrCreateSession("idempotent-id");
      assertEquals(first.id, second.id);
      assertEquals(first.created_at, second.created_at);
    } finally {
      db.close();
    }
  },
});

// MARK: - Message Operations

Deno.test({
  name: "Store: insertMessage - increments order, version, and count",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Msg Test");
      const msg1 = insertMessage({
        session_id: session.id,
        role: "user",
        content: "Hello",
      });
      assertEquals(msg1.order, 1);
      assertEquals(msg1.content, "Hello");

      const msg2 = insertMessage({
        session_id: session.id,
        role: "assistant",
        content: "Hi!",
      });
      assertEquals(msg2.order, 2);

      const updated = getSession(session.id)!;
      assertEquals(updated.message_count, 2);
      assertEquals(updated.session_version, 2);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: insertMessage - dedup on client_turn_id",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Dedup Test");
      const msg1 = insertMessage({
        session_id: session.id,
        role: "user",
        content: "First",
        client_turn_id: "turn-1",
      });

      const msg2 = insertMessage({
        session_id: session.id,
        role: "user",
        content: "Duplicate",
        client_turn_id: "turn-1",
      });

      assertEquals(msg1.id, msg2.id);
      assertEquals(msg2.content, "First");

      const updated = getSession(session.id)!;
      assertEquals(updated.message_count, 1);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: insertMessage - with custom created_at",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Timestamp Test");
      const customTs = "2024-01-15T10:30:00.000Z";
      const msg = insertMessage({
        session_id: session.id,
        role: "user",
        content: "Past message",
        created_at: customTs,
      });
      assertEquals(msg.created_at, customTs);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: getMessages - offset paging",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Paging Test");
      for (let i = 0; i < 5; i++) {
        insertMessage({
          session_id: session.id,
          role: "user",
          content: `Message ${i}`,
        });
      }

      const page1 = getMessages(session.id, { limit: 2, offset: 0, sort: "asc" });
      assertEquals(page1.messages.length, 2);
      assertEquals(page1.has_more, true);
      assertEquals(page1.total, 5);
      assertEquals(page1.messages[0].content, "Message 0");

      const page2 = getMessages(session.id, { limit: 2, offset: 2, sort: "asc" });
      assertEquals(page2.messages.length, 2);
      assertEquals(page2.messages[0].content, "Message 2");

      const page3 = getMessages(session.id, { limit: 2, offset: 4, sort: "asc" });
      assertEquals(page3.messages.length, 1);
      assertEquals(page3.has_more, false);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: getMessages - cursor paging (after_order)",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Cursor Test");
      for (let i = 0; i < 5; i++) {
        insertMessage({
          session_id: session.id,
          role: "user",
          content: `Message ${i}`,
        });
      }

      const page1 = getMessages(session.id, { limit: 2, sort: "asc", after_order: 0 });
      assertEquals(page1.messages.length, 2);
      assertEquals(page1.messages[0].order, 1);
      assertEquals(page1.messages[1].order, 2);
      assertEquals(page1.cursor, 2);

      const page2 = getMessages(session.id, { limit: 2, sort: "asc", after_order: page1.cursor! });
      assertEquals(page2.messages.length, 2);
      assertEquals(page2.messages[0].order, 3);
      assertEquals(page2.cursor, 4);

      const page3 = getMessages(session.id, { limit: 2, sort: "asc", after_order: page2.cursor! });
      assertEquals(page3.messages.length, 1);
      assertEquals(page3.has_more, false);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: getMessages - cursor paging desc (after_order)",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Desc Cursor Test");
      for (let i = 0; i < 5; i++) {
        insertMessage({
          session_id: session.id,
          role: "user",
          content: `Message ${i}`,
        });
      }

      const page1 = getMessages(session.id, { limit: 2, sort: "desc", after_order: 5 });
      assertEquals(page1.messages.length, 2);
      assertEquals(page1.messages[0].order, 4);
      assertEquals(page1.messages[1].order, 3);
      assertEquals(page1.cursor, 3);

      const page2 = getMessages(session.id, { limit: 2, sort: "desc", after_order: page1.cursor! });
      assertEquals(page2.messages.length, 2);
      assertEquals(page2.messages[0].order, 2);
      assertEquals(page2.messages[1].order, 1);
      assertEquals(page2.has_more, false);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: getMessages - sort desc",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Sort Test");
      insertMessage({ session_id: session.id, role: "user", content: "First" });
      insertMessage({ session_id: session.id, role: "user", content: "Second" });

      const result = getMessages(session.id, { sort: "desc" });
      assertEquals(result.messages[0].content, "Second");
      assertEquals(result.messages[1].content, "First");
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: getMessages - has_more false on exact page boundary",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Boundary Test");
      for (let i = 0; i < 4; i++) {
        insertMessage({
          session_id: session.id,
          role: "user",
          content: `Message ${i}`,
        });
      }

      const page1 = getMessages(session.id, { limit: 2, offset: 0, sort: "asc" });
      assertEquals(page1.has_more, true);

      const page2 = getMessages(session.id, { limit: 2, offset: 2, sort: "asc" });
      assertEquals(page2.messages.length, 2);
      assertEquals(page2.has_more, false);

      const cursor1 = getMessages(session.id, { limit: 2, sort: "asc", after_order: 0 });
      assertEquals(cursor1.has_more, true);

      const cursor2 = getMessages(session.id, { limit: 2, sort: "asc", after_order: cursor1.cursor! });
      assertEquals(cursor2.messages.length, 2);
      assertEquals(cursor2.has_more, false);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: getMessage - returns single row",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Get Single");
      const msg = insertMessage({
        session_id: session.id,
        role: "user",
        content: "Find me",
      });

      const found = getMessage(msg.id);
      assertExists(found);
      assertEquals(found!.content, "Find me");

      assertEquals(getMessage(99999), null);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: updateMessage - updates content and cancelled",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Update Msg");
      const msg = insertMessage({
        session_id: session.id,
        role: "assistant",
        content: "Original",
      });

      updateMessage(msg.id, { content: "Updated" });
      const updated = getMessage(msg.id)!;
      assertEquals(updated.content, "Updated");

      updateMessage(msg.id, { cancelled: true });
      const cancelled = getMessage(msg.id)!;
      assertEquals(cancelled.cancelled, 1);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: updateMessage - bumps session_version",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Version Bump");
      const msg = insertMessage({
        session_id: session.id,
        role: "assistant",
        content: "Original",
      });

      const versionAfterInsert = getSession(session.id)!.session_version;
      assertEquals(versionAfterInsert, 1);

      updateMessage(msg.id, { content: "Edited" });
      const versionAfterUpdate = getSession(session.id)!.session_version;
      assertEquals(versionAfterUpdate, 2);

      updateMessage(msg.id, { cancelled: true });
      const versionAfterCancel = getSession(session.id)!.session_version;
      assertEquals(versionAfterCancel, 3);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: deleteMessage - removes row and decrements count",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Delete Msg");
      const msg = insertMessage({
        session_id: session.id,
        role: "user",
        content: "Delete me",
      });

      assertEquals(getSession(session.id)!.message_count, 1);

      const result = deleteMessage(msg.id, session.id);
      assertEquals(result, true);
      assertEquals(getMessage(msg.id), null);
      assertEquals(getSession(session.id)!.message_count, 0);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: deleteMessage - returns false for wrong session",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Owner Test");
      const msg = insertMessage({
        session_id: session.id,
        role: "user",
        content: "Owned",
      });

      assertEquals(deleteMessage(msg.id, "wrong-session"), false);
      assertExists(getMessage(msg.id));
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: validateExpectedVersion - pass and fail",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Version Test");
      assertEquals(validateExpectedVersion(session.id, 0), true);

      insertMessage({ session_id: session.id, role: "user", content: "Bump" });
      assertEquals(validateExpectedVersion(session.id, 1), true);
      assertEquals(validateExpectedVersion(session.id, 0), false);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Store: getMessageByClientTurnId - finds matching message",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Turn ID Test");
      insertMessage({
        session_id: session.id,
        role: "user",
        content: "Tracked",
        client_turn_id: "turn-abc",
      });

      const found = getMessageByClientTurnId(session.id, "turn-abc");
      assertExists(found);
      assertEquals(found!.content, "Tracked");

      assertEquals(getMessageByClientTurnId(session.id, "non-existent"), null);
    } finally {
      db.close();
    }
  },
});
