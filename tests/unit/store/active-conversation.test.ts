import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  _resetActiveConversationForTesting,
  closeActiveConversationSession,
  getActiveConversationSessionId,
  resolveConversationSessionId,
} from "../../../src/hlvm/store/active-conversation.ts";
import {
  deleteSession,
  getHostStateValue,
  getSession,
} from "../../../src/hlvm/store/conversation-store.ts";
import { setupStoreTestDb } from "../_shared/store-test-db.ts";

const ACTIVE_SESSION_KEY = "active_conversation_session_id";

async function withDb(fn: () => Promise<void> | void): Promise<void> {
  const db = setupStoreTestDb();
  _resetActiveConversationForTesting();
  try {
    await fn();
  } finally {
    _resetActiveConversationForTesting();
    db.close();
  }
}

Deno.test("active conversation: explicit session IDs create and bind durable sessions", async () => {
  await withDb(() => {
    const sessionId = resolveConversationSessionId("explicit-session");

    assertEquals(sessionId, "explicit-session");
    assertExists(getSession(sessionId));
    assertEquals(getActiveConversationSessionId(), sessionId);
    assertEquals(getHostStateValue(ACTIVE_SESSION_KEY), sessionId);
  });
});

Deno.test("active conversation: restores the persisted active session after in-memory reset", async () => {
  await withDb(async () => {
    const sessionId = resolveConversationSessionId("persisted-session");

    await closeActiveConversationSession();

    assertEquals(getActiveConversationSessionId(), sessionId);
    assertEquals(getHostStateValue(ACTIVE_SESSION_KEY), sessionId);
  });
});

Deno.test("active conversation: stale persisted active session falls back to the most recent existing session", async () => {
  await withDb(async () => {
    resolveConversationSessionId("older-session");
    const fallbackSessionId = resolveConversationSessionId("fallback-session");
    const staleSessionId = resolveConversationSessionId("stale-session");

    assertEquals(getHostStateValue(ACTIVE_SESSION_KEY), staleSessionId);

    deleteSession(staleSessionId);
    await closeActiveConversationSession();

    assertEquals(getActiveConversationSessionId(), fallbackSessionId);
    assertEquals(getHostStateValue(ACTIVE_SESSION_KEY), fallbackSessionId);
  });
});

Deno.test("active conversation: creates a new active session when none exist", async () => {
  await withDb(() => {
    const sessionId = getActiveConversationSessionId();

    assertExists(getSession(sessionId));
    assertEquals(getHostStateValue(ACTIVE_SESSION_KEY), sessionId);
  });
});

Deno.test("active conversation: stateless explicit session IDs do not overwrite the durable active binding", async () => {
  await withDb(async () => {
    const activeSessionId = resolveConversationSessionId();
    const statelessSessionId = resolveConversationSessionId("hidden-session", {
      stateless: true,
    });

    assertEquals(statelessSessionId, "hidden-session");
    assertExists(getSession(statelessSessionId));
    assertEquals(getActiveConversationSessionId(), activeSessionId);
    assertEquals(getHostStateValue(ACTIVE_SESSION_KEY), activeSessionId);

    await closeActiveConversationSession();

    assertEquals(getActiveConversationSessionId(), activeSessionId);
    assertEquals(getHostStateValue(ACTIVE_SESSION_KEY), activeSessionId);
  });
});

Deno.test("active conversation: reserved channel sessions never become the durable active binding", async () => {
  await withDb(() => {
    const activeSessionId = resolveConversationSessionId("visible-session");
    const channelSessionId = resolveConversationSessionId("channel:telegram:123456789");

    assertEquals(channelSessionId, "channel:telegram:123456789");
    assertEquals(getActiveConversationSessionId(), activeSessionId);
    assertEquals(getHostStateValue(ACTIVE_SESSION_KEY), activeSessionId);
  });
});
