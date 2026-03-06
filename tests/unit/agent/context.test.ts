import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  ContextManager,
  ContextOverflowError,
  takeLastMessageGroups,
} from "../../../src/hlvm/agent/context.ts";
import type { Message } from "../../../src/hlvm/agent/context.ts";
import { DEFAULT_CONTEXT_CONFIG } from "../../../src/hlvm/agent/constants.ts";

Deno.test("context: message management records timestamps, copies, filters, and stats", () => {
  const context = new ContextManager();
  context.addMessages([
    { role: "system", content: "System" },
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi" },
    { role: "tool", content: "Result" },
  ]);
  const explicitTimestamp = 1234567890;
  context.addMessage({ role: "user", content: "Later", timestamp: explicitTimestamp });

  const firstCopy = context.getMessages();
  const secondCopy = context.getMessagesCopy();
  const stats = context.getStats();

  assertEquals(firstCopy.length, 5);
  assertEquals(firstCopy[0].timestamp! > 0, true);
  assertEquals(firstCopy[4].timestamp, explicitTimestamp);
  assertEquals(firstCopy === secondCopy, false);
  assertEquals(context.getMessagesByRole("user").map((m) => m.content), ["Hello", "Later"]);
  assertEquals(context.getLastMessages(2).map((m) => m.content), ["Result", "Later"]);
  assertEquals(stats.messageCount, 5);
  assertEquals(stats.systemMessages, 1);
  assertEquals(stats.userMessages, 2);
  assertEquals(stats.assistantMessages, 1);
  assertEquals(stats.toolMessages, 1);
  assertEquals(stats.estimatedTokens > 0, true);

  context.clear();
  assertEquals(context.getMessages(), []);
});

Deno.test("context: trimming respects budget, preserveSystem, and minMessages", () => {
  const context = new ContextManager({
    maxTokens: 200,
    preserveSystem: true,
    minMessages: 2,
  });

  context.addMessage({ role: "system", content: "s".repeat(120) });
  context.addMessage({ role: "user", content: "a".repeat(400) });
  context.addMessage({ role: "assistant", content: "b".repeat(400) });
  context.addMessage({ role: "user", content: "c".repeat(400) });

  const messages = context.getMessages();
  assertEquals(messages.length < 4, true);
  assertEquals(messages.some((m) => m.role === "system"), true);
  assertEquals(messages.length >= 2, true);
});

Deno.test("context: summarize overflow inserts a summary while keeping recent messages", () => {
  const context = new ContextManager({
    maxTokens: 50,
    overflowStrategy: "summarize",
    summaryKeepRecent: 2,
    summaryMaxChars: 200,
  });
  const longText = "x".repeat(200);

  context.addMessage({ role: "system", content: "You are helpful." });
  context.addMessage({ role: "user", content: `First ${longText}` });
  context.addMessage({ role: "assistant", content: `Reply ${longText}` });
  context.addMessage({ role: "user", content: `Second ${longText}` });
  context.addMessage({ role: "assistant", content: `Reply 2 ${longText}` });
  context.addMessage({ role: "user", content: `Third ${longText}` });

  const messages = context.getMessages();
  assertEquals(
    messages.some((m) => m.content.startsWith("Summary of earlier context:")),
    true,
  );
  assertEquals(context.getLastMessages(2).map((m) => m.role), ["assistant", "user"]);
});

Deno.test("context: tool exchanges stay intact during trim, summary grouping, and compaction", async () => {
  const trimmed = new ContextManager({ maxTokens: 180, minMessages: 2 });
  trimmed.addMessage({ role: "user", content: "a".repeat(320) });
  trimmed.addMessage({ role: "user", content: "b".repeat(320) });
  trimmed.addMessage({
    role: "assistant",
    content: "",
    toolCalls: [{
      id: "call_web_1",
      function: { name: "search_web", arguments: { query: "taskgroup" } },
    }],
  });
  trimmed.addMessage({
    role: "tool",
    content: "c".repeat(320),
    toolName: "search_web",
    toolCallId: "call_web_1",
  });

  const summarized = new ContextManager({
    maxTokens: 60,
    overflowStrategy: "summarize",
    summaryKeepRecent: 1,
    summaryMaxChars: 200,
    minMessages: 1,
  });
  summarized.addMessage({ role: "user", content: "a".repeat(220) });
  summarized.addMessage({ role: "assistant", content: "b".repeat(220) });
  summarized.addMessage({
    role: "assistant",
    content: "",
    toolCalls: [{
      id: "call_search_1",
      function: { name: "search_web", arguments: { query: "asyncio taskgroup" } },
    }],
  });
  summarized.addMessage({
    role: "tool",
    content: "c".repeat(220),
    toolName: "search_web",
    toolCallId: "call_search_1",
  });
  summarized.addMessage({ role: "user", content: "d".repeat(220) });

  const compacted = new ContextManager({
    maxTokens: 120,
    overflowStrategy: "summarize",
    summaryKeepRecent: 1,
    minMessages: 1,
    llmSummarize: async () => "condensed summary",
  });
  compacted.addMessage({ role: "user", content: "a".repeat(240) });
  compacted.addMessage({ role: "assistant", content: "b".repeat(240) });
  compacted.addMessage({
    role: "assistant",
    content: "",
    toolCalls: [{
      id: "call_fetch_1",
      function: { name: "fetch_url", arguments: { url: "https://example.com" } },
    }],
  });
  compacted.addMessage({
    role: "tool",
    content: "c".repeat(240),
    toolName: "fetch_url",
    toolCallId: "call_fetch_1",
  });
  compacted.addMessage({ role: "user", content: "d".repeat(240) });

  await compacted.compactIfNeeded();

  for (const [manager, assistantId, toolId] of [
    [trimmed, "call_web_1", "call_web_1"],
    [summarized, "call_search_1", "call_search_1"],
    [compacted, "call_fetch_1", "call_fetch_1"],
  ] as const) {
    const messages = manager.getMessages();
    const assistantIndex = messages.findIndex((message) =>
      message.role === "assistant" && message.toolCalls?.[0]?.id === assistantId
    );
    const toolIndex = messages.findIndex((message) =>
      message.role === "tool" && message.toolCallId === toolId
    );

    if (toolIndex >= 0) {
      assertEquals(assistantIndex >= 0, true);
      assertEquals(toolIndex, assistantIndex + 1);
    } else {
      assertEquals(assistantIndex, -1);
    }
  }
});

Deno.test("context: takeLastMessageGroups preserves trailing tool exchange boundaries", () => {
  const messages: Message[] = [
    { role: "user", content: "older" },
    {
      role: "assistant",
      content: "",
      toolCalls: [{
        id: "call_search_1",
        function: { name: "search_web", arguments: { query: "taskgroup" } },
      }],
    },
    {
      role: "tool",
      content: "results",
      toolName: "search_web",
      toolCallId: "call_search_1",
    },
    { role: "assistant", content: "done" },
  ];

  const recent = takeLastMessageGroups(messages, 2);
  assertEquals(recent.map((message) => message.role), ["assistant", "tool", "assistant"]);
  assertEquals(recent[0].toolCalls?.[0]?.id, "call_search_1");
  assertEquals(recent[1].toolCallId, "call_search_1");
});

Deno.test("context: fail overflow throws during add and config tightening", () => {
  const addContext = new ContextManager({ maxTokens: 50, overflowStrategy: "fail" });
  addContext.addMessage({ role: "user", content: "short" });
  assertThrows(
    () => addContext.addMessage({ role: "user", content: "a".repeat(400) }),
    ContextOverflowError,
  );

  const updateContext = new ContextManager({ maxTokens: 200 });
  updateContext.addMessage({ role: "user", content: "a".repeat(400) });
  updateContext.addMessage({ role: "assistant", content: "b".repeat(400) });
  assertThrows(
    () => updateContext.updateConfig({ maxTokens: 50, overflowStrategy: "fail" }),
    ContextOverflowError,
  );
});

Deno.test("context: truncateResult preserves short output and truncates long output midstream", () => {
  const context = new ContextManager({ maxResultLength: 200 });
  const long = "HEAD_CONTENT_" + "x".repeat(500) + "_TAIL_CONTENT";

  assertEquals(context.truncateResult("short"), "short");
  const truncated = context.truncateResult(long);
  assertEquals(truncated.length <= 200, true);
  assertEquals(truncated.startsWith("HEAD_CONTENT_"), true);
  assertEquals(truncated.endsWith("_TAIL_CONTENT"), true);
  assertEquals(truncated.includes("[truncated middle]"), true);
});

Deno.test("context: default config, getConfig, and updateConfig stay coherent", () => {
  const context = new ContextManager();
  assertEquals(context.getConfig(), DEFAULT_CONTEXT_CONFIG);

  const configurable = new ContextManager({ maxTokens: 10000, minMessages: 1 });
  for (let i = 0; i < 5; i++) {
    configurable.addMessage({ role: "user", content: "a".repeat(1000) });
  }

  const beforeCount = configurable.getMessages().length;
  configurable.updateConfig({ maxTokens: 500, maxResultLength: 1000 });
  const afterConfig = configurable.getConfig();

  assertEquals(afterConfig.maxTokens, 500);
  assertEquals(afterConfig.maxResultLength, 1000);
  assertEquals(configurable.getMessages().length < beforeCount, true);
});
