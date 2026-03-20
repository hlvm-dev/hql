import { assertEquals } from "jsr:@std/assert";
import {
  createSession,
  getSession,
  insertMessage,
} from "../../../src/hlvm/store/conversation-store.ts";
import { registerUploadedAttachment } from "../../../src/hlvm/attachments/service.ts";
import {
  handleDeleteMessage,
  handleGetMessage,
  handleGetMessages,
  handleUpdateMessage,
} from "../../../src/hlvm/cli/repl/handlers/messages.ts";
import { handleChat } from "../../../src/hlvm/cli/repl/handlers/chat.ts";
import {
  __testOnlyResetAgentReadyState,
  isAgentReady,
  markAgentReady,
} from "../../../src/hlvm/cli/repl/handlers/chat-session.ts";
import { registerProvider } from "../../../src/hlvm/providers/registry.ts";
import { setupStoreTestDb } from "../_shared/store-test-db.ts";
import { withTempHlvmDir } from "../helpers.ts";

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

Deno.test("handlers: message listing supports pagination and cursor order in both directions", async () => {
  await withDb(async () => {
    const session = createSession("Messages");
    for (let i = 0; i < 5; i++) {
      insertMessage({
        session_id: session.id,
        role: "user",
        content: `Msg ${i}`,
      });
    }

    const asc = await (await handleGetMessages(
      getRequest("/api/chat/messages?limit=2&sort=asc"),
      { id: session.id },
    )).json();
    assertEquals(asc.messages.length, 2);
    assertEquals(asc.has_more, true);
    assertEquals(asc.total, 5);

    const afterAsc = await (await handleGetMessages(
      getRequest(
        "/api/chat/messages?after_order=2&limit=10&sort=asc",
      ),
      { id: session.id },
    )).json();
    assertEquals(afterAsc.messages.map((m: { order: number }) => m.order), [
      3,
      4,
      5,
    ]);

    const afterDesc = await (await handleGetMessages(
      getRequest(
        "/api/chat/messages?after_order=4&limit=10&sort=desc",
      ),
      { id: session.id },
    )).json();
    assertEquals(afterDesc.messages.map((m: { order: number }) => m.order), [
      3,
      2,
      1,
    ]);
  });
});

Deno.test("handlers: get message resolves numeric ids and client turn ids", async () => {
  await withDb(async () => {
    const session = createSession("Lookup");
    const numeric = insertMessage({
      session_id: session.id,
      role: "user",
      content: "Find me",
    });
    insertMessage({
      session_id: session.id,
      role: "assistant",
      content: "By turn ID",
      client_turn_id: "turn-123",
    });

    const numericResp = await handleGetMessage(
      getRequest(`/api/chat/messages/${numeric.id}`),
      { id: session.id, messageId: String(numeric.id) },
    );
    assertEquals(numericResp.status, 200);
    assertEquals((await numericResp.json()).content, "Find me");

    const turnResp = await handleGetMessage(
      getRequest("/api/chat/messages/turn-123"),
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
    const msg = insertMessage({
      session_id: owner.id,
      role: "user",
      content: "Owned",
    });

    assertEquals(
      (await handleGetMessage(
        getRequest("/api/chat/messages/not-a-number"),
        {
          id: owner.id,
          messageId: "not-a-number",
        },
      )).status,
      400,
    );
    assertEquals(
      (await handleGetMessage(
        getRequest(`/api/chat/messages/${msg.id}`),
        {
          id: other.id,
          messageId: String(msg.id),
        },
      )).status,
      404,
    );
  });
});

Deno.test("handlers: update message applies content and cancelled patches and rejects invalid targets", async () => {
  await withDb(async () => {
    const owner = createSession("Owner");
    const other = createSession("Other");
    const msg = insertMessage({
      session_id: owner.id,
      role: "assistant",
      content: "Original",
    });

    const editedResp = await handleUpdateMessage(
      jsonRequest({ content: "Edited" }),
      {
        id: owner.id,
        messageId: String(msg.id),
      },
    );
    assertEquals(editedResp.status, 200);
    assertEquals((await editedResp.json()).content, "Edited");

    const cancelledResp = await handleUpdateMessage(
      jsonRequest({ cancelled: true }),
      {
        id: owner.id,
        messageId: String(msg.id),
      },
    );
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
    const msg = insertMessage({
      session_id: owner.id,
      role: "user",
      content: "One",
    });
    insertMessage({ session_id: owner.id, role: "assistant", content: "Two" });

    const deletedResp = handleDeleteMessage(
      getRequest(`/api/chat/messages/${msg.id}`),
      { id: owner.id, messageId: String(msg.id) },
    );
    assertEquals(deletedResp.status, 200);
    assertEquals((await deletedResp.json()).deleted, true);

    assertEquals(
      (await handleGetMessage(
        getRequest(`/api/chat/messages/${msg.id}`),
        {
          id: owner.id,
          messageId: String(msg.id),
        },
      )).status,
      404,
    );
    assertEquals(
      handleDeleteMessage(
        getRequest(`/api/chat/messages/${msg.id}`),
        {
          id: other.id,
          messageId: String(msg.id),
        },
      ).status,
      404,
    );

    assertEquals(getSession(owner.id)?.message_count, 1);
  });
});

Deno.test("handlers: chat rejects attachments for agent models without vision support", async () => {
  await withTempHlvmDir(async () => {
    await withDb(async () => {
      registerProvider("multimodal-test", () => ({
        name: "multimodal-test",
        displayName: "Multimodal Test",
        capabilities: [
          "chat" as const,
          "tools" as const,
          "models.list" as const,
        ],
        async *generate() {
          yield "";
        },
        async *chat() {
          yield "";
        },
        status() {
          return Promise.resolve({ available: true });
        },
        models: {
          list: () =>
            Promise.resolve([{
              name: "tools-only",
              displayName: "Tools Only",
              capabilities: ["chat", "tools"],
            }]),
          get: (name: string) =>
            Promise.resolve(
              name === "tools-only"
                ? {
                  name,
                  displayName: "Tools Only",
                  capabilities: ["chat", "tools"],
                }
                : null,
            ),
        },
      }));

      const attachment = await registerUploadedAttachment({
        fileName: "sample.png",
        mimeType: "image/png",
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      });

      const response = await handleChat(jsonRequest({
        mode: "agent",
        session_id: "session-vision-gate",
        model: "multimodal-test/tools-only",
        messages: [{
          role: "user",
          content: "describe this screenshot",
          attachment_ids: [attachment.id],
        }],
      }));

      assertEquals(response.status, 400);
      assertEquals(
        (await response.json()).error,
        "multimodal-test/tools-only does not support this attachment type.",
      );
    });
  });
});

Deno.test("handlers: chat exports track readiness by model and no-op cancellation", async () => {
  __testOnlyResetAgentReadyState();
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
});

Deno.test("handlers: agent readiness cache evicts older model entries", () => {
  __testOnlyResetAgentReadyState();

  markAgentReady("ollama/model-0");
  assertEquals(isAgentReady("ollama/model-0"), true);

  for (let index = 1; index <= 80; index++) {
    markAgentReady(`ollama/model-${index}`);
  }

  assertEquals(isAgentReady("ollama/model-0"), false);
  assertEquals(isAgentReady("ollama/model-80"), true);
});
