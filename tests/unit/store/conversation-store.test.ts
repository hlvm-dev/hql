import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  cancelRequestMessages,
  createSession,
  deleteMessage,
  deleteSession,
  getMessage,
  getMessageByClientTurnId,
  getMessages,
  getOrCreateSession,
  getSession,
  insertMessage,
  listSessions,
  setSessionTitleIfEmpty,
  updateMessage,
  updateSession,
  validateExpectedVersion,
} from "../../../src/hlvm/store/conversation-store.ts";
import {
  pushSSEEvent,
  replayAfter,
} from "../../../src/hlvm/store/sse-store.ts";
import { setupStoreTestDb } from "../_shared/store-test-db.ts";

async function withDb(fn: () => Promise<void> | void): Promise<void> {
  const db = setupStoreTestDb();
  try {
    await fn();
  } finally {
    db.close();
  }
}

Deno.test("conversation store: session lifecycle covers create, get, list, update, and delete", async () => {
  await withDb(() => {
    const defaultSession = createSession();
    const custom = createSession("Custom ID", "my-custom-id");
    pushSSEEvent(custom.id, "message_added", { text: "buffered" });

    assertEquals(defaultSession.title, "");
    assertEquals(custom.id, "my-custom-id");
    assertEquals(listSessions().map((session) => session.title).sort(), [
      "",
      "Custom ID",
    ]);

    const updated = updateSession(custom.id, { title: "Updated" });
    assertExists(updated);
    assertEquals(updated.title, "Updated");
    assertEquals(getSession("non-existent"), null);
    assertEquals(updateSession("non-existent", { title: "X" }), null);

    assertEquals(deleteSession(custom.id), true);
    assertEquals(getSession(custom.id), null);
    assertEquals(replayAfter(custom.id, null).events.length, 0);
    assertEquals(deleteSession("non-existent"), false);
  });
});

Deno.test("conversation store: setSessionTitleIfEmpty only writes an empty title once", async () => {
  await withDb(() => {
    const empty = createSession();
    const titled = createSession("Already set");

    assertEquals(setSessionTitleIfEmpty(empty.id, "Derived title"), true);
    assertEquals(setSessionTitleIfEmpty(empty.id, "Second title"), false);
    assertEquals(setSessionTitleIfEmpty(titled.id, "Ignored"), false);

    assertEquals(getSession(empty.id)?.title, "Derived title");
    assertEquals(getSession(titled.id)?.title, "Already set");
  });
});

Deno.test("conversation store: getOrCreateSession is idempotent", async () => {
  await withDb(() => {
    const first = getOrCreateSession("idempotent-id");
    const second = getOrCreateSession("idempotent-id");

    assertEquals(first.id, second.id);
    assertEquals(first.created_at, second.created_at);
  });
});

Deno.test("conversation store: insertMessage handles ordering, versioning, dedup, and timestamps", async () => {
  await withDb(() => {
    const session = createSession("Messages");
    const first = insertMessage({
      session_id: session.id,
      role: "user",
      content: "Hello",
    });
    const second = insertMessage({
      session_id: session.id,
      role: "assistant",
      content: "Hi",
    });
    const deduped = insertMessage({
      session_id: session.id,
      role: "user",
      content: "Duplicate",
      client_turn_id: "turn-1",
    });
    const duplicateAgain = insertMessage({
      session_id: session.id,
      role: "user",
      content: "Ignored",
      client_turn_id: "turn-1",
    });
    const customTs = insertMessage({
      session_id: session.id,
      role: "user",
      content: "Past message",
      display_content: "[Pasted text #1 +2 lines]",
      created_at: "2024-01-15T10:30:00.000Z",
    });

    assertEquals(first.order, 1);
    assertEquals(second.order, 2);
    assertEquals(deduped.id, duplicateAgain.id);
    assertEquals(duplicateAgain.content, "Duplicate");
    assertEquals(customTs.created_at, "2024-01-15T10:30:00.000Z");
    assertEquals(customTs.display_content, "[Pasted text #1 +2 lines]");
    assertEquals(getSession(session.id)?.message_count, 4);
    assertEquals(getSession(session.id)?.session_version, 4);
  });
});

Deno.test("conversation store: getMessages supports offset and cursor pagination in both directions", async () => {
  await withDb(() => {
    const session = createSession("Paging");
    for (let i = 0; i < 5; i++) {
      insertMessage({
        session_id: session.id,
        role: "user",
        content: `Message ${i}`,
      });
    }

    const offsetPage = getMessages(session.id, {
      limit: 2,
      offset: 2,
      sort: "asc",
    });
    const ascCursor = getMessages(session.id, {
      limit: 2,
      sort: "asc",
      after_order: 2,
    });
    const descCursor = getMessages(session.id, {
      limit: 2,
      sort: "desc",
      after_order: 5,
    });
    const descAll = getMessages(session.id, { sort: "desc" });

    assertEquals(offsetPage.messages.map((message) => message.content), [
      "Message 2",
      "Message 3",
    ]);
    assertEquals(offsetPage.has_more, true);
    assertEquals(offsetPage.total, 5);
    assertEquals(ascCursor.messages.map((message) => message.order), [3, 4]);
    assertEquals(ascCursor.cursor, 4);
    assertEquals(descCursor.messages.map((message) => message.order), [4, 3]);
    assertEquals(descAll.messages[0].content, "Message 4");
  });
});

Deno.test("conversation store: getMessage and getMessageByClientTurnId resolve stored rows", async () => {
  await withDb(() => {
    const session = createSession("Lookup");
    const message = insertMessage({
      session_id: session.id,
      role: "user",
      content: "Tracked",
      client_turn_id: "turn-abc",
    });

    assertEquals(getMessage(message.id)?.content, "Tracked");
    assertEquals(getMessage(99999), null);
    assertEquals(
      getMessageByClientTurnId(session.id, "turn-abc")?.content,
      "Tracked",
    );
    assertEquals(getMessageByClientTurnId(session.id, "missing"), null);
  });
});

Deno.test("conversation store: updateMessage edits content, display content, cancellation, and session version", async () => {
  await withDb(() => {
    const session = createSession("Update Msg");
    const message = insertMessage({
      session_id: session.id,
      role: "assistant",
      content: "Original",
      display_content: "[Pasted text #1]",
    });
    assertEquals(getSession(session.id)?.session_version, 1);

    updateMessage(message.id, {
      content: "Updated",
      display_content: "[Pasted text #1 +1 lines]",
    });
    assertEquals(getMessage(message.id)?.content, "Updated");
    assertEquals(
      getMessage(message.id)?.display_content,
      "[Pasted text #1 +1 lines]",
    );
    assertEquals(getSession(session.id)?.session_version, 2);

    updateMessage(message.id, { cancelled: true });
    assertEquals(getMessage(message.id)?.cancelled, 1);
    assertEquals(getSession(session.id)?.session_version, 3);
  });
});

Deno.test("conversation store: cancelRequestMessages cancels the full persisted request group", async () => {
  await withDb(() => {
    const session = createSession("Cancel Request");
    const user = insertMessage({
      session_id: session.id,
      role: "user",
      content: "hello world",
      request_id: "req-1",
    });
    const assistant = insertMessage({
      session_id: session.id,
      role: "assistant",
      content: "",
      request_id: "req-1",
    });
    const baselineVersion = getSession(session.id)?.session_version ?? 0;

    const changed = cancelRequestMessages(session.id, "req-1", {
      assistantMessageId: assistant.id,
      assistantContent: "partial reply",
    });

    assertEquals(changed, 2);
    assertEquals(getMessage(user.id)?.cancelled, 1);
    assertEquals(getMessage(assistant.id)?.cancelled, 1);
    assertEquals(getMessage(assistant.id)?.content, "partial reply");
    assertEquals(
      getSession(session.id)?.session_version,
      baselineVersion + 1,
    );
  });
});

Deno.test("conversation store: deleteMessage enforces ownership and decrements counts", async () => {
  await withDb(() => {
    const owner = createSession("Owner Test");
    const other = createSession("Other Test");
    const message = insertMessage({
      session_id: owner.id,
      role: "user",
      content: "Owned",
    });

    assertEquals(deleteMessage(message.id, "wrong-session"), false);
    assertExists(getMessage(message.id));

    assertEquals(deleteMessage(message.id, owner.id), true);
    assertEquals(getMessage(message.id), null);
    assertEquals(getSession(owner.id)?.message_count, 0);
    assertEquals(getSession(other.id)?.message_count, 0);
  });
});

Deno.test("conversation store: validateExpectedVersion reflects the live session version", async () => {
  await withDb(() => {
    const session = createSession("Version Test");
    assertEquals(validateExpectedVersion(session.id, 0), true);

    insertMessage({ session_id: session.id, role: "user", content: "Bump" });
    assertEquals(validateExpectedVersion(session.id, 1), true);
    assertEquals(validateExpectedVersion(session.id, 0), false);
  });
});
