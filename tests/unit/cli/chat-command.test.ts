import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import type { AIProvider, ModelInfo } from "../../../src/hlvm/providers/index.ts";
import {
  registerProvider,
  setDefaultProvider,
} from "../../../src/hlvm/providers/index.ts";
import { log } from "../../../src/hlvm/api/log.ts";
import {
  chatCommand,
  parseChatArgs,
} from "../../../src/hlvm/cli/commands/chat.ts";
import {
  getMessages,
  listSessions,
} from "../../../src/hlvm/store/conversation-store.ts";
import { setupStoreTestDb } from "../_shared/store-test-db.ts";

const CHAT_MODEL: ModelInfo = {
  name: "plain",
  capabilities: ["chat"],
};

const chatProvider: AIProvider = {
  name: "test-chat-cli",
  displayName: "Test Chat CLI",
  capabilities: ["chat", "generate"],
  async *generate(prompt: string) {
    yield `generated:${prompt}`;
  },
  async *chat(messages) {
    const lastUser = [...messages].reverse().find((message) =>
      message.role === "user"
    )?.content ?? "";
    yield `reply:${lastUser}`;
  },
  models: {
    list() {
      return Promise.resolve([CHAT_MODEL]);
    },
    get(name: string) {
      return Promise.resolve(name === CHAT_MODEL.name ? CHAT_MODEL : null);
    },
  },
  status() {
    return Promise.resolve({ available: true });
  },
};

async function withChatCommandHarness(
  fn: (helpers: { output: () => string }) => Promise<void> | void,
): Promise<void> {
  const db = setupStoreTestDb();
  const raw = log.raw as { write: (text: string) => void };
  const originalWrite = raw.write;
  let output = "";

  raw.write = (text: string) => {
    output += text;
  };
  registerProvider("test-chat-cli", () => chatProvider, { isDefault: true });
  setDefaultProvider("test-chat-cli");

  try {
    await fn({ output: () => output });
  } finally {
    raw.write = originalWrite;
    setDefaultProvider("ollama");
    db.close();
  }
}

Deno.test("chat command: rejects bare --resume because plain chat has no picker", async () => {
  await assertRejects(
    async () => {
      parseChatArgs(["--resume", "--model", "test-chat-cli/plain", "hello"]);
    },
    Error,
    "--resume requires a session id",
  );
});

Deno.test("chat command: one-shot plain chat persists user and assistant messages", async () => {
  await withChatCommandHarness(async ({ output }) => {
    await chatCommand(["--model", "test-chat-cli/plain", "hello"]);

    assertStringIncludes(output(), "reply:hello");

    const sessions = listSessions();
    assertEquals(sessions.length, 1);
    const stored = getMessages(sessions[0].id, { sort: "asc" }).messages;
    assertEquals(stored.map((message) => message.role), ["user", "assistant"]);
    assertEquals(stored[1]?.content, "reply:hello");
  });
});

Deno.test("chat command: --continue reuses the latest persisted chat session", async () => {
  await withChatCommandHarness(async () => {
    await chatCommand(["--model", "test-chat-cli/plain", "first"]);
    const firstSessionId = listSessions()[0]?.id;

    await chatCommand(["--model", "test-chat-cli/plain", "--continue", "second"]);

    const sessions = listSessions();
    assertEquals(sessions.length, 1);
    assertEquals(sessions[0]?.id, firstSessionId);
    assertEquals(sessions[0]?.message_count, 4);
  });
});

Deno.test("chat command: --resume <id> and --new keep session boundaries explicit", async () => {
  await withChatCommandHarness(async () => {
    await chatCommand(["--model", "test-chat-cli/plain", "first"]);
    const firstSessionId = listSessions()[0]?.id;

    await chatCommand([
      "--model",
      "test-chat-cli/plain",
      "--resume",
      firstSessionId,
      "second",
    ]);

    let sessions = listSessions();
    assertEquals(sessions.length, 1);
    assertEquals(sessions[0]?.message_count, 4);

    await chatCommand(["--model", "test-chat-cli/plain", "--new", "third"]);

    sessions = listSessions();
    assertEquals(sessions.length, 2);
    assertEquals(sessions.some((session) => session.id === firstSessionId), true);
  });
});
