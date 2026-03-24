import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  getMemoryMdPath,
  resetHlvmDirCacheForTests,
  setHlvmDirForTests,
} from "../../../src/common/paths.ts";
import type { MessageRow } from "../../../src/hlvm/store/types.ts";
import { registerAttachmentFromPath } from "../../../src/hlvm/attachments/service.ts";
import { withTempHlvmDir } from "../helpers.ts";
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
import { withGlobalTestLock } from "../_shared/global-test-lock.ts";

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
    attachment_ids: null,
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

Deno.test("chat context: mixed attachments survive replay for chat and agent builders", async () => {
  await withTempHlvmDir(async () => {
    const platform = getPlatform();
    const tmpDir = await platform.fs.makeTempDir({ prefix: "chat-ctx-" });
    const imagePath = platform.path.join(tmpDir, "test.png");
    const pdfPath = platform.path.join(tmpDir, "test.pdf");
    const textPath = platform.path.join(tmpDir, "notes.txt");
    await platform.fs.writeFile(
      imagePath,
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
    await platform.fs.writeFile(
      pdfPath,
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    );
    await platform.fs.writeTextFile(
      textPath,
      "Attachment-backed notes\nSecond line",
    );

    try {
      const imageAttachment = await registerAttachmentFromPath(imagePath);
      const pdfAttachment = await registerAttachmentFromPath(pdfPath);
      const textAttachment = await registerAttachmentFromPath(textPath);
      const requestMessages = [{
        role: "system" as const,
        content: "retain explicit history",
      }, {
        role: "user" as const,
        content: "see image",
        attachment_ids: [
          imageAttachment.id,
          pdfAttachment.id,
          textAttachment.id,
        ],
      }];

      const chat = await buildChatProviderMessages({
        requestMessages,
        storedMessages: [],
        modelKey: "test-chat/plain",
      });
      const chatUser = chat.messages.find((message) => message.role === "user");
      assertExists(chatUser);
      assertEquals(chatUser.attachments?.length, 3);
      assertEquals(
        chatUser.attachments?.map((attachment) =>
          `${attachment.mode}:${attachment.mimeType}`
        ),
        [
          "binary:image/png",
          "binary:application/pdf",
          "text:text/plain",
        ],
      );

      const agent = await buildAgentHistoryMessages({
        requestMessages,
        storedMessages: [],
        maxGroups: 4,
        modelKey: "test-chat/plain",
      });
      const agentUser = agent.find((message) => message.role === "user");
      assertExists(agentUser);
      assertEquals(
        agentUser.attachments?.map((attachment) =>
          `${attachment.mode}:${attachment.mimeType}`
        ),
        [
          "binary:image/png",
          "binary:application/pdf",
          "text:text/plain",
        ],
      );
      const imagePayload = agentUser.attachments?.[0];
      const pdfPayload = agentUser.attachments?.[1];
      const textPayload = agentUser.attachments?.[2];
      assertEquals(
        imagePayload?.mode === "binary" &&
          imagePayload.data.length > 0,
        true,
      );
      assertEquals(
        pdfPayload?.mode === "binary" &&
          pdfPayload.data.length > 0,
        true,
      );
      assertEquals(
        textPayload?.mode === "text" &&
          textPayload.text.includes("Attachment-backed notes"),
        true,
      );
    } finally {
      await platform.fs.remove(tmpDir, { recursive: true });
    }
  });
});

Deno.test("chat context: PDF attachments fall back to extracted text for text-only models", async () => {
  await withTempHlvmDir(async () => {
    const requestMessages: Array<{
      role: "system" | "user";
      content: string;
      attachment_ids?: string[];
    }> = [{
      role: "system" as const,
      content: "retain explicit history",
    }, {
      role: "user" as const,
      content: "summarize this pdf",
    }];
    const platform = getPlatform();
    const tmpDir = await platform.fs.makeTempDir({ prefix: "chat-ctx-pdf-" });
    const pdfPath = platform.path.join(tmpDir, "report.pdf");
    await platform.fs.writeTextFile(
      pdfPath,
      `%PDF-1.4
1 0 obj
(Hello PDF fallback)
endobj
%%EOF`,
    );

    try {
      const attachment = await registerAttachmentFromPath(pdfPath);
      requestMessages[1].attachment_ids = [attachment.id];

      const chat = await buildChatProviderMessages({
        requestMessages,
        storedMessages: [],
        modelKey: "ollama/llama3.2",
      });
      const userMessage = chat.messages.find((message) =>
        message.role === "user"
      );
      assertExists(userMessage);
      assertEquals(userMessage.attachments?.[0]?.mode, "text");
      assertEquals(
        userMessage.attachments?.[0]?.mode === "text" &&
          userMessage.attachments[0].text.length > 0,
        true,
      );
    } finally {
      await platform.fs.remove(tmpDir, { recursive: true });
    }
  });
});

Deno.test("chat context: disablePersistentMemory suppresses memory injection for plain chat", async () => {
  await withGlobalTestLock(async () => {
    const platform = getPlatform();
    const tmpDir = await platform.fs.makeTempDir({
      prefix: "chat-ctx-memory-",
    });
    setHlvmDirForTests(tmpDir);

    try {
      await platform.fs.mkdir(platform.path.dirname(getMemoryMdPath()), {
        recursive: true,
      });
      await platform.fs.writeTextFile(
        getMemoryMdPath(),
        "Explicit note for chat",
      );

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
      resetHlvmDirCacheForTests();
      await platform.fs.remove(tmpDir, { recursive: true });
    }
  });
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
