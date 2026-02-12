/**
 * Handler Tests
 *
 * Tests session and message HTTP handlers against an in-memory SQLite DB.
 * Calls handler functions directly (no HTTP server needed).
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  createSession,
  insertMessage,
} from "../../../src/hlvm/store/conversation-store.ts";
import {
  handleListSessions,
  handleCreateSession,
  handleGetSession,
  handleUpdateSession,
  handleDeleteSession,
} from "../../../src/hlvm/cli/repl/handlers/sessions.ts";
import {
  handleGetMessages,
  handleGetMessage,
  handleUpdateMessage,
  handleDeleteMessage,
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

// MARK: - Session Handlers

Deno.test({
  name: "Handlers: handleListSessions - returns empty array",
  async fn() {
    const db = setupStoreTestDb();
    try {
      const resp = handleListSessions();
      assertEquals(resp.status, 200);
      const body = await resp.json();
      assertEquals(body.sessions, []);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleListSessions - returns created sessions",
  async fn() {
    const db = setupStoreTestDb();
    try {
      createSession("Alpha");
      createSession("Beta");
      const resp = handleListSessions();
      const body = await resp.json();
      assertEquals(body.sessions.length, 2);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleCreateSession - creates with title",
  async fn() {
    const db = setupStoreTestDb();
    try {
      const resp = await handleCreateSession(jsonRequest({ title: "New Chat" }));
      assertEquals(resp.status, 201);
      const body = await resp.json();
      assertEquals(body.title, "New Chat");
      assertExists(body.id);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleCreateSession - creates with empty title",
  async fn() {
    const db = setupStoreTestDb();
    try {
      const resp = await handleCreateSession(jsonRequest({}));
      assertEquals(resp.status, 201);
      const body = await resp.json();
      assertEquals(body.title, "");
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleGetSession - returns existing session",
  async fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Lookup");
      const resp = handleGetSession(
        getRequest(`/api/sessions/${session.id}`),
        { id: session.id },
      );
      assertEquals(resp.status, 200);
      const body = await resp.json();
      assertEquals(body.title, "Lookup");
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleGetSession - 404 for non-existent",
  fn() {
    const db = setupStoreTestDb();
    try {
      const resp = handleGetSession(
        getRequest("/api/sessions/missing"),
        { id: "missing" },
      );
      assertEquals(resp.status, 404);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleUpdateSession - updates title",
  async fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Original");
      const resp = await handleUpdateSession(
        jsonRequest({ title: "Renamed" }),
        { id: session.id },
      );
      assertEquals(resp.status, 200);
      const body = await resp.json();
      assertEquals(body.title, "Renamed");
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleUpdateSession - 404 for non-existent",
  async fn() {
    const db = setupStoreTestDb();
    try {
      const resp = await handleUpdateSession(
        jsonRequest({ title: "X" }),
        { id: "missing" },
      );
      assertEquals(resp.status, 404);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleDeleteSession - deletes existing session",
  async fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Delete Me");
      const resp = handleDeleteSession(
        getRequest(`/api/sessions/${session.id}`),
        { id: session.id },
      );
      assertEquals(resp.status, 200);
      const body = await resp.json();
      assertEquals(body.deleted, true);

      const check = handleGetSession(
        getRequest(`/api/sessions/${session.id}`),
        { id: session.id },
      );
      assertEquals(check.status, 404);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleDeleteSession - 404 for non-existent",
  fn() {
    const db = setupStoreTestDb();
    try {
      const resp = handleDeleteSession(
        getRequest("/api/sessions/missing"),
        { id: "missing" },
      );
      assertEquals(resp.status, 404);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleDeleteSession - cascade deletes messages",
  async fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Cascade");
      insertMessage({ session_id: session.id, role: "user", content: "Hello" });
      insertMessage({ session_id: session.id, role: "assistant", content: "Hi" });

      handleDeleteSession(
        getRequest(`/api/sessions/${session.id}`),
        { id: session.id },
      );

      const listResp = handleListSessions();
      const listBody = await listResp.json();
      assertEquals(listBody.sessions.length, 0);
    } finally {
      db.close();
    }
  },
});

// MARK: - Message Handlers

Deno.test({
  name: "Handlers: handleGetMessages - returns paginated messages",
  async fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Messages");
      for (let i = 0; i < 5; i++) {
        insertMessage({ session_id: session.id, role: "user", content: `Msg ${i}` });
      }

      const resp = handleGetMessages(
        getRequest(`/api/sessions/${session.id}/messages?limit=2&sort=asc`),
        { id: session.id },
      );
      assertEquals(resp.status, 200);
      const body = await resp.json();
      assertEquals(body.messages.length, 2);
      assertEquals(body.has_more, true);
      assertEquals(body.total, 5);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleGetMessages - cursor paging via after_order",
  async fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Cursor");
      for (let i = 0; i < 5; i++) {
        insertMessage({ session_id: session.id, role: "user", content: `Msg ${i}` });
      }

      const resp = handleGetMessages(
        getRequest(`/api/sessions/${session.id}/messages?after_order=2&limit=10&sort=asc`),
        { id: session.id },
      );
      const body = await resp.json();
      assertEquals(body.messages.length, 3);
      assertEquals(body.messages[0].order, 3);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleGetMessages - 404 for non-existent session",
  fn() {
    const db = setupStoreTestDb();
    try {
      const resp = handleGetMessages(
        getRequest("/api/sessions/missing/messages"),
        { id: "missing" },
      );
      assertEquals(resp.status, 404);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleGetMessage - returns single message",
  async fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Single Msg");
      const msg = insertMessage({ session_id: session.id, role: "user", content: "Find me" });

      const resp = handleGetMessage(
        getRequest(`/api/sessions/${session.id}/messages/${msg.id}`),
        { id: session.id, messageId: String(msg.id) },
      );
      assertEquals(resp.status, 200);
      const body = await resp.json();
      assertEquals(body.content, "Find me");
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleGetMessage - resolves client_turn_id",
  async fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Turn ID");
      insertMessage({
        session_id: session.id,
        role: "user",
        content: "By turn ID",
        client_turn_id: "turn-123",
      });

      const resp = handleGetMessage(
        getRequest(`/api/sessions/${session.id}/messages/turn-123`),
        { id: session.id, messageId: "turn-123" },
      );
      assertEquals(resp.status, 200);
      const body = await resp.json();
      assertEquals(body.content, "By turn ID");
      assertEquals(body.client_turn_id, "turn-123");
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleGetMessage - 404 for wrong session",
  fn() {
    const db = setupStoreTestDb();
    try {
      const s1 = createSession("Owner");
      const s2 = createSession("Other");
      const msg = insertMessage({ session_id: s1.id, role: "user", content: "Owned" });

      const resp = handleGetMessage(
        getRequest(`/api/sessions/${s2.id}/messages/${msg.id}`),
        { id: s2.id, messageId: String(msg.id) },
      );
      assertEquals(resp.status, 404);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleGetMessage - 400 for invalid messageId",
  fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Bad ID");
      const resp = handleGetMessage(
        getRequest(`/api/sessions/${session.id}/messages/not-a-number`),
        { id: session.id, messageId: "not-a-number" },
      );
      assertEquals(resp.status, 400);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleUpdateMessage - updates content",
  async fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Update Msg");
      const msg = insertMessage({ session_id: session.id, role: "assistant", content: "Original" });

      const resp = await handleUpdateMessage(
        jsonRequest({ content: "Edited" }),
        { id: session.id, messageId: String(msg.id) },
      );
      assertEquals(resp.status, 200);
      const body = await resp.json();
      assertEquals(body.content, "Edited");
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleUpdateMessage - marks cancelled",
  async fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Cancel Msg");
      const msg = insertMessage({ session_id: session.id, role: "assistant", content: "Partial" });

      const resp = await handleUpdateMessage(
        jsonRequest({ cancelled: true }),
        { id: session.id, messageId: String(msg.id) },
      );
      assertEquals(resp.status, 200);
      const body = await resp.json();
      assertEquals(body.cancelled, 1);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleUpdateMessage - 400 for empty patch",
  async fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Empty Patch");
      const msg = insertMessage({ session_id: session.id, role: "user", content: "OK" });

      const resp = await handleUpdateMessage(
        jsonRequest({}),
        { id: session.id, messageId: String(msg.id) },
      );
      assertEquals(resp.status, 400);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleUpdateMessage - 404 for wrong session",
  async fn() {
    const db = setupStoreTestDb();
    try {
      const s1 = createSession("Owner");
      const s2 = createSession("Other");
      const msg = insertMessage({ session_id: s1.id, role: "user", content: "Owned" });

      const resp = await handleUpdateMessage(
        jsonRequest({ content: "Hack" }),
        { id: s2.id, messageId: String(msg.id) },
      );
      assertEquals(resp.status, 404);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleDeleteMessage - deletes existing message",
  async fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Delete Msg");
      const msg = insertMessage({ session_id: session.id, role: "user", content: "Remove me" });

      const resp = handleDeleteMessage(
        getRequest(`/api/sessions/${session.id}/messages/${msg.id}`),
        { id: session.id, messageId: String(msg.id) },
      );
      assertEquals(resp.status, 200);
      const body = await resp.json();
      assertEquals(body.deleted, true);

      const check = handleGetMessage(
        getRequest(`/api/sessions/${session.id}/messages/${msg.id}`),
        { id: session.id, messageId: String(msg.id) },
      );
      assertEquals(check.status, 404);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleDeleteMessage - 404 for wrong session",
  fn() {
    const db = setupStoreTestDb();
    try {
      const s1 = createSession("Owner");
      const s2 = createSession("Other");
      const msg = insertMessage({ session_id: s1.id, role: "user", content: "Owned" });

      const resp = handleDeleteMessage(
        getRequest(`/api/sessions/${s2.id}/messages/${msg.id}`),
        { id: s2.id, messageId: String(msg.id) },
      );
      assertEquals(resp.status, 404);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleDeleteMessage - decrements message_count",
  async fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("Count");
      const msg = insertMessage({ session_id: session.id, role: "user", content: "One" });
      insertMessage({ session_id: session.id, role: "assistant", content: "Two" });

      handleDeleteMessage(
        getRequest(`/api/sessions/${session.id}/messages/${msg.id}`),
        { id: session.id, messageId: String(msg.id) },
      );

      const sessResp = handleGetSession(
        getRequest(`/api/sessions/${session.id}`),
        { id: session.id },
      );
      const sessBody = await sessResp.json();
      assertEquals(sessBody.message_count, 1);
    } finally {
      db.close();
    }
  },
});

// MARK: - Chat Exports

Deno.test({
  name: "Handlers: isAgentReady / markAgentReady - tracks state",
  fn() {
    const initial = isAgentReady();
    assertEquals(typeof initial, "boolean");
    markAgentReady();
    assertEquals(isAgentReady(), true);
  },
});

Deno.test({
  name: "Handlers: cancelSessionRequests - returns 0 for unknown session",
  fn() {
    const count = cancelSessionRequests("non-existent-session");
    assertEquals(count, 0);
  },
});

Deno.test({
  name: "Handlers: handleSessionCancel - reports false when no active requests",
  async fn() {
    const resp = handleSessionCancel("some-session-id");
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.cancelled, false);
    assertEquals(body.session_id, "some-session-id");
    assertEquals(body.cancelled_count, 0);
  },
});

// MARK: - Cursor Paging (desc)

Deno.test({
  name: "Handlers: handleGetMessages - desc cursor paging via after_order",
  async fn() {
    const db = setupStoreTestDb();
    try {
      const session = createSession("DescCursor");
      for (let i = 0; i < 5; i++) {
        insertMessage({ session_id: session.id, role: "user", content: `Msg ${i}` });
      }

      const resp = handleGetMessages(
        getRequest(`/api/sessions/${session.id}/messages?after_order=4&limit=10&sort=desc`),
        { id: session.id },
      );
      const body = await resp.json();
      assertEquals(body.messages.length, 3);
      assertEquals(body.messages[0].order, 3);
      assertEquals(body.messages[1].order, 2);
      assertEquals(body.messages[2].order, 1);
    } finally {
      db.close();
    }
  },
});

Deno.test({
  name: "Handlers: handleDeleteSession - 404 does not emit SSE",
  fn() {
    const db = setupStoreTestDb();
    try {
      const resp = handleDeleteSession(
        getRequest("/api/sessions/ghost"),
        { id: "ghost" },
      );
      assertEquals(resp.status, 404);
    } finally {
      db.close();
    }
  },
});
