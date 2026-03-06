import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  createSession,
  insertMessage,
} from "../../../src/hlvm/store/conversation-store.ts";
import {
  handleCreateSession,
  handleDeleteSession,
  handleGetSession,
  handleListSessions,
  handleUpdateSession,
} from "../../../src/hlvm/cli/repl/handlers/sessions.ts";
import {
  handleDeleteMessage,
  handleGetMessage,
  handleGetMessages,
  handleUpdateMessage,
} from "../../../src/hlvm/cli/repl/handlers/messages.ts";
import {
  cancelSessionRequests,
  handleSessionCancel,
  isAgentReady,
  markAgentReady,
} from "../../../src/hlvm/cli/repl/handlers/chat.ts";
import { setupStoreTestDb } from "../_shared/store-test-db.ts";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(path: string): Request {
  return new Request(`http://localhost${path}`, { method: "GET" });
}

async function withDb(fn: () => Promise<void> | void): Promise<void> {
  const db = setupStoreTestDb();
  try {
    await fn();
  } finally {
    db.close();
  }
}

Deno.test("handlers: sessions support list, create, get, and empty-id validation", async () => {
  await withDb(async () => {
    const empty = await handleListSessions().json();
    assertEquals(empty.sessions, []);

    const createdResp = await handleCreateSession(jsonRequest({ title: "  New Chat  " }));
    assertEquals(createdResp.status, 201);
    const created = await createdResp.json();
    assertExists(created.id);
    assertEquals(created.title, "New Chat");

    const listed = await handleListSessions().json();
    assertEquals(listed.sessions.length, 1);
    assertEquals(listed.sessions[0].id, created.id);

    const fetchedResp = handleGetSession(getRequest(`/api/sessions/${created.id}`), {
      id: created.id,
    });
    assertEquals(fetchedResp.status, 200);
    const fetched = await fetchedResp.json();
    assertEquals(fetched.title, "New Chat");

    const invalidResp = await handleCreateSession(jsonRequest({ id: "   ", title: "X" }));
    assertEquals(invalidResp.status, 400);
    const invalid = await invalidResp.json();
    assertEquals(invalid.error, "Session id cannot be empty");
  });
});

Deno.test("handlers: sessions update, delete, cascade messages, and 404 when missing", async () => {
  await withDb(async () => {
    const session = createSession("Original");
    insertMessage({ session_id: session.id, role: "user", content: "Hello" });
    insertMessage({ session_id: session.id, role: "assistant", content: "Hi" });

    const updatedResp = await handleUpdateSession(jsonRequest({ title: "Renamed" }), {
      id: session.id,
    });
    assertEquals(updatedResp.status, 200);
    const updated = await updatedResp.json();
    assertEquals(updated.title, "Renamed");

    const deletedResp = handleDeleteSession(getRequest(`/api/sessions/${session.id}`), {
      id: session.id,
    });
    assertEquals(deletedResp.status, 200);
    assertEquals((await deletedResp.json()).deleted, true);

    assertEquals(
      handleGetSession(getRequest(`/api/sessions/${session.id}`), { id: session.id }).status,
      404,
    );
    assertEquals(
      handleGetMessages(getRequest(`/api/sessions/${session.id}/messages`), { id: session.id }).status,
      404,
    );
    assertEquals(
      handleDeleteSession(getRequest("/api/sessions/missing"), { id: "missing" }).status,
      404,
    );
    assertEquals(
      (await handleUpdateSession(jsonRequest({ title: "X" }), { id: "missing" }).then((r) => r.status)),
      404,
    );
  });
});

Deno.test("handlers: message listing supports pagination and cursor order in both directions", async () => {
  await withDb(async () => {
    const session = createSession("Messages");
    for (let i = 0; i < 5; i++) {
      insertMessage({ session_id: session.id, role: "user", content: `Msg ${i}` });
    }

    const asc = await handleGetMessages(
      getRequest(`/api/sessions/${session.id}/messages?limit=2&sort=asc`),
      { id: session.id },
    ).json();
    assertEquals(asc.messages.length, 2);
    assertEquals(asc.has_more, true);
    assertEquals(asc.total, 5);

    const afterAsc = await handleGetMessages(
      getRequest(`/api/sessions/${session.id}/messages?after_order=2&limit=10&sort=asc`),
      { id: session.id },
    ).json();
    assertEquals(afterAsc.messages.map((m: { order: number }) => m.order), [3, 4, 5]);

    const afterDesc = await handleGetMessages(
      getRequest(`/api/sessions/${session.id}/messages?after_order=4&limit=10&sort=desc`),
      { id: session.id },
    ).json();
    assertEquals(afterDesc.messages.map((m: { order: number }) => m.order), [3, 2, 1]);
  });
});

Deno.test("handlers: get message resolves numeric ids and client turn ids", async () => {
  await withDb(async () => {
    const session = createSession("Lookup");
    const numeric = insertMessage({ session_id: session.id, role: "user", content: "Find me" });
    insertMessage({
      session_id: session.id,
      role: "assistant",
      content: "By turn ID",
      client_turn_id: "turn-123",
    });

    const numericResp = handleGetMessage(
      getRequest(`/api/sessions/${session.id}/messages/${numeric.id}`),
      { id: session.id, messageId: String(numeric.id) },
    );
    assertEquals(numericResp.status, 200);
    assertEquals((await numericResp.json()).content, "Find me");

    const turnResp = handleGetMessage(
      getRequest(`/api/sessions/${session.id}/messages/turn-123`),
      { id: session.id, messageId: "turn-123" },
    );
    assertEquals(turnResp.status, 200);
    const turnBody = await turnResp.json();
    assertEquals(turnBody.content, "By turn ID");
    assertEquals(turnBody.client_turn_id, "turn-123");
  });
});

Deno.test("handlers: get message rejects invalid ids and wrong-session access", async () => {
  await withDb(async () => {
    const owner = createSession("Owner");
    const other = createSession("Other");
    const msg = insertMessage({ session_id: owner.id, role: "user", content: "Owned" });

    assertEquals(
      handleGetMessage(getRequest(`/api/sessions/${owner.id}/messages/not-a-number`), {
        id: owner.id,
        messageId: "not-a-number",
      }).status,
      400,
    );
    assertEquals(
      handleGetMessage(getRequest(`/api/sessions/${other.id}/messages/${msg.id}`), {
        id: other.id,
        messageId: String(msg.id),
      }).status,
      404,
    );
  });
});

Deno.test("handlers: update message applies content and cancelled patches and rejects invalid targets", async () => {
  await withDb(async () => {
    const owner = createSession("Owner");
    const other = createSession("Other");
    const msg = insertMessage({ session_id: owner.id, role: "assistant", content: "Original" });

    const editedResp = await handleUpdateMessage(jsonRequest({ content: "Edited" }), {
      id: owner.id,
      messageId: String(msg.id),
    });
    assertEquals(editedResp.status, 200);
    assertEquals((await editedResp.json()).content, "Edited");

    const cancelledResp = await handleUpdateMessage(jsonRequest({ cancelled: true }), {
      id: owner.id,
      messageId: String(msg.id),
    });
    assertEquals(cancelledResp.status, 200);
    assertEquals((await cancelledResp.json()).cancelled, 1);

    assertEquals(
      (await handleUpdateMessage(jsonRequest({}), {
        id: owner.id,
        messageId: String(msg.id),
      })).status,
      400,
    );
    assertEquals(
      (await handleUpdateMessage(jsonRequest({ content: "Hack" }), {
        id: other.id,
        messageId: String(msg.id),
      })).status,
      404,
    );
  });
});

Deno.test("handlers: delete message removes the row and updates session counts", async () => {
  await withDb(async () => {
    const owner = createSession("Count");
    const other = createSession("Other");
    const msg = insertMessage({ session_id: owner.id, role: "user", content: "One" });
    insertMessage({ session_id: owner.id, role: "assistant", content: "Two" });

    const deletedResp = handleDeleteMessage(
      getRequest(`/api/sessions/${owner.id}/messages/${msg.id}`),
      { id: owner.id, messageId: String(msg.id) },
    );
    assertEquals(deletedResp.status, 200);
    assertEquals((await deletedResp.json()).deleted, true);

    assertEquals(
      handleGetMessage(getRequest(`/api/sessions/${owner.id}/messages/${msg.id}`), {
        id: owner.id,
        messageId: String(msg.id),
      }).status,
      404,
    );
    assertEquals(
      handleDeleteMessage(getRequest(`/api/sessions/${other.id}/messages/${msg.id}`), {
        id: other.id,
        messageId: String(msg.id),
      }).status,
      404,
    );

    const sessionResp = handleGetSession(getRequest(`/api/sessions/${owner.id}`), { id: owner.id });
    assertEquals((await sessionResp.json()).message_count, 1);
  });
});

Deno.test("handlers: chat exports track readiness by model and no-op cancellation", async () => {
  const modelA = "ollama/llama3.2:1b";
  const modelB = "openai/gpt-4.1-mini";

  assertEquals(typeof isAgentReady(), "boolean");
  assertEquals(isAgentReady(modelA), false);
  assertEquals(isAgentReady(modelB), false);

  markAgentReady();
  markAgentReady(modelA);

  assertEquals(isAgentReady(), true);
  assertEquals(isAgentReady(modelA), true);
  assertEquals(isAgentReady(modelB), false);
  assertEquals(cancelSessionRequests("missing-session"), 0);

  const cancelResp = handleSessionCancel("missing-session");
  assertEquals(cancelResp.status, 200);
  const cancelBody = await cancelResp.json();
  assertEquals(cancelBody, {
    cancelled: false,
    session_id: "missing-session",
    cancelled_count: 0,
  });
});
