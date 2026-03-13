import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  getMemoryMdPath,
  resetHlvmDirCacheForTests,
} from "../../../src/common/paths.ts";
import type { MessageRow } from "../../../src/hlvm/store/types.ts";
import {
  buildAgentHistoryMessages,
  buildChatProviderMessages,
  buildReplayMessages,
  buildRequestMessagesToPersist,
  resolveChatContextBudget,
  trimReplayMessages,
  validateChatRequestMessages,
} from "../../../src/hlvm/cli/repl/handlers/chat-context.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

function createStoredMessage(
  id: number,
  patch: Partial<MessageRow>,
): MessageRow {
  return {
    id,
    session_id: "session-1",
    order: id,
    role: "user",
    content: "",
    client_turn_id: null,
    request_id: `request-${Math.ceil(id / 2)}`,
    sender_type: "user",
    sender_detail: null,
    image_paths: null,
    tool_calls: null,
    tool_name: null,
    tool_call_id: null,
    cancelled: 0,
    created_at: new Date(id * 1_000).toISOString(),
    ...patch,
  };
}

Deno.test("chat context: explicit request messages override stored session history", async () => {
  const replay = await buildReplayMessages({
    requestMessages: [
      { role: "system", content: "Speak like a pirate." },
      { role: "user", content: "hello" },
    ],
    storedMessages: [
      createStoredMessage(1, { role: "user", content: "stale" }),
      createStoredMessage(2, { role: "assistant", content: "stale-reply" }),
    ],
  });

  assertEquals(
    replay.map((message) => [message.role, message.content]),
    [
      ["system", "Speak like a pirate."],
      ["user", "hello"],
    ],
  );
});

Deno.test("chat context: validates that the current turn ends with a user message", () => {
  assertEquals(
    validateChatRequestMessages([
      { role: "system", content: "You are helpful." },
      { role: "assistant", content: "Ready." },
    ]),
    "Last message must be a user turn",
  );
  assertEquals(
    validateChatRequestMessages([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "hello" },
    ]),
    null,
  );
});

Deno.test("chat context: single-turn requests fall back to stored session transcript", async () => {
  const replay = await buildReplayMessages({
    requestMessages: [{ role: "user", content: "current" }],
    storedMessages: [
      createStoredMessage(1, { role: "user", content: "before" }),
      createStoredMessage(2, { role: "assistant", content: "before-reply" }),
      createStoredMessage(3, {
        role: "user",
        content: "current",
        request_id: "request-2",
      }),
      createStoredMessage(4, {
        role: "assistant",
        content: "",
        request_id: "request-2",
      }),
    ],
    assistantMessageId: 4,
  });

  assertEquals(
    replay.map((message) => [message.role, message.content]),
    [
      ["user", "before"],
      ["assistant", "before-reply"],
      ["user", "current"],
    ],
  );
});

Deno.test("chat context: cancelled request groups are excluded from future replay", async () => {
  const replay = await buildReplayMessages({
    requestMessages: [{ role: "user", content: "hello" }],
    storedMessages: [
      createStoredMessage(1, {
        role: "user",
        content: "before",
        request_id: "request-1",
      }),
      createStoredMessage(2, {
        role: "assistant",
        content: "before-reply",
        request_id: "request-1",
      }),
      createStoredMessage(3, {
        role: "user",
        content: "cancel me",
        request_id: "request-2",
      }),
      createStoredMessage(4, {
        role: "assistant",
        content: "partial",
        request_id: "request-2",
        cancelled: 1,
      }),
      createStoredMessage(5, {
        role: "user",
        content: "hello",
        request_id: "request-3",
      }),
      createStoredMessage(6, {
        role: "assistant",
        content: "",
        request_id: "request-3",
      }),
    ],
    assistantMessageId: 6,
  });

  assertEquals(
    replay.map((message) => [message.role, message.content]),
    [
      ["user", "before"],
      ["assistant", "before-reply"],
      ["user", "hello"],
    ],
  );
});

Deno.test("chat context: explicit request history persists only the new visible tail", () => {
  const toPersist = buildRequestMessagesToPersist({
    requestMessages: [
      { role: "system", content: "Speak like a pirate." },
      { role: "user", content: "first" },
      { role: "assistant", content: "reply:first" },
      { role: "user", content: "second" },
    ],
    storedMessages: [
      createStoredMessage(1, {
        role: "system",
        content: "Speak like a pirate.",
        request_id: "request-1",
        sender_type: "system",
      }),
      createStoredMessage(2, {
        role: "user",
        content: "first",
        request_id: "request-1",
      }),
      createStoredMessage(3, {
        role: "assistant",
        content: "reply:first",
        request_id: "request-1",
        sender_type: "llm",
      }),
      createStoredMessage(4, {
        role: "tool",
        content: "hidden-tool-output",
        request_id: "request-1",
        sender_type: "agent",
        tool_name: "shell_exec",
      }),
    ],
    fallbackClientTurnId: "current-user-turn",
  });

  assertEquals(
    toPersist.map((
      message,
    ) => [message.role, message.content, message.clientTurnId ?? ""]),
    [["user", "second", "current-user-turn"]],
  );
});

Deno.test("chat context: image attachments survive replay for chat and agent builders", async () => {
  const platform = getPlatform();
  const tmpDir = await platform.fs.makeTempDir({ prefix: "chat-ctx-" });
  const imagePath = platform.path.join(tmpDir, "test.png");
  await platform.fs.writeFile(
    imagePath,
    new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  );

  try {
    const requestMessages = [{
      role: "system" as const,
      content: "retain explicit history",
    }, {
      role: "user" as const,
      content: "see image",
      image_paths: [imagePath],
    }];

    const chat = await buildChatProviderMessages({
      requestMessages,
      storedMessages: [],
      modelKey: "test-chat/plain",
    });
    const chatUser = chat.messages.find((message) => message.role === "user");
    assertExists(chatUser);
    assertEquals((chatUser.images?.length ?? 0) > 0, true);

    const agent = await buildAgentHistoryMessages({
      requestMessages,
      storedMessages: [],
      maxGroups: 4,
      modelKey: "test-chat/plain",
    });
    const agentUser = agent.find((message) => message.role === "user");
    assertExists(agentUser);
    assertEquals(agentUser.images?.[0]?.mimeType, "image/png");
    assertEquals((agentUser.images?.[0]?.data.length ?? 0) > 0, true);
  } finally {
    await platform.fs.remove(tmpDir, { recursive: true });
  }
});

Deno.test("chat context: disablePersistentMemory suppresses memory injection for plain chat", async () => {
  const platform = getPlatform();
  const tmpDir = await platform.fs.makeTempDir({ prefix: "chat-ctx-memory-" });
  platform.env.set("HLVM_DIR", tmpDir);
  resetHlvmDirCacheForTests();

  try {
    await platform.fs.mkdir(platform.path.dirname(getMemoryMdPath()), {
      recursive: true,
    });
    await platform.fs.writeTextFile(getMemoryMdPath(), "Explicit note for chat");

    const enabled = await buildChatProviderMessages({
      requestMessages: [{ role: "user", content: "hello" }],
      storedMessages: [],
      modelKey: "test-chat/plain",
    });
    const disabled = await buildChatProviderMessages({
      requestMessages: [{ role: "user", content: "hello" }],
      storedMessages: [],
      disablePersistentMemory: true,
      modelKey: "test-chat/plain",
    });

    assertEquals(
      enabled.messages.some((message) =>
        message.role === "system" &&
        message.content?.includes("# Your Memory")
      ),
      true,
    );
    assertEquals(
      disabled.messages.some((message) =>
        message.role === "system" &&
        message.content?.includes("# Your Memory")
      ),
      false,
    );
  } finally {
    platform.env.delete("HLVM_DIR");
    resetHlvmDirCacheForTests();
    await platform.fs.remove(tmpDir, { recursive: true });
  }
});

Deno.test("chat context: agent replay reconstructs prior tool results and reorders them before the final assistant reply", async () => {
  const history = await buildAgentHistoryMessages({
    requestMessages: [{ role: "user", content: "follow-up" }],
    storedMessages: [
      createStoredMessage(1, {
        role: "user",
        content: "initial",
        request_id: "request-1",
      }),
      createStoredMessage(2, {
        role: "assistant",
        content: "final reply",
        sender_type: "agent",
        request_id: "request-1",
      }),
      createStoredMessage(3, {
        role: "tool",
        content: "observed-from-tool",
        sender_type: "agent",
        request_id: "request-1",
        tool_name: "shell_exec",
      }),
      createStoredMessage(4, {
        role: "user",
        content: "follow-up",
        request_id: "request-2",
      }),
      createStoredMessage(5, {
        role: "assistant",
        content: "",
        sender_type: "agent",
        request_id: "request-2",
      }),
    ],
    assistantMessageId: 5,
    maxGroups: 8,
    modelKey: "test-chat/plain",
  });

  const syntheticAssistantIndex = history.findIndex((message) =>
    message.role === "assistant" &&
    message.toolCalls?.[0]?.function.name === "shell_exec"
  );
  const toolIndex = history.findIndex((message) =>
    message.role === "tool" && message.content === "observed-from-tool"
  );
  const finalAssistantIndex = history.findIndex((message) =>
    message.role === "assistant" && message.content === "final reply"
  );

  assertEquals(syntheticAssistantIndex >= 0, true);
  assertEquals(toolIndex > syntheticAssistantIndex, true);
  assertEquals(finalAssistantIndex > toolIndex, true);
});

Deno.test("chat context: resolves chat memory/context budget from model metadata", () => {
  const resolved = resolveChatContextBudget({
    name: "plain",
    contextWindow: 131_072,
    capabilities: ["chat"],
  });

  assertEquals(resolved.rawLimit, 131_072);
  assertEquals(resolved.budget, 126_976);
  assertEquals(resolved.source, "model_info");
});

Deno.test("chat context: trims by token budget instead of raw message count", () => {
  const trimmed = trimReplayMessages(
    [
      { role: "user", content: "a".repeat(500) },
      { role: "assistant", content: "b".repeat(500) },
      { role: "user", content: "keep-me" },
    ],
    110,
    "test-chat/plain",
  );

  assertEquals(
    trimmed.some((message) => message.content === "a".repeat(500)),
    false,
  );
  assertEquals(
    trimmed.some((message) => message.content === "b".repeat(500)),
    false,
  );
  assertEquals(trimmed[trimmed.length - 1]?.content, "keep-me");
});
