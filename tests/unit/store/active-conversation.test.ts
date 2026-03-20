import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  _resetActiveConversationForTesting,
  getActiveConversationSessionId,
  resolveConversationSessionId,
} from "../../../src/hlvm/store/active-conversation.ts";
import { getSession } from "../../../src/hlvm/store/conversation-store.ts";
import { setupStoreTestDb } from "../_shared/store-test-db.ts";

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
  });
});

Deno.test("active conversation: stateless explicit session IDs do not rebind the active session", async () => {
  await withDb(() => {
    const activeSessionId = resolveConversationSessionId();
    const statelessSessionId = resolveConversationSessionId("hidden-session", {
      stateless: true,
    });

    assertEquals(statelessSessionId, "hidden-session");
    assertExists(getSession(statelessSessionId));
    assertEquals(getActiveConversationSessionId(), activeSessionId);
  });
});
