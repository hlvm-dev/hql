import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  assertSupportedSdkProvider,
  convertToSdkMessages,
  convertToolDefinitionsToSdk,
  mapSdkSources,
  mapSdkUsage,
  normalizeProviderMetadata,
  type SdkConvertibleMessage,
} from "../../../src/hlvm/providers/sdk-runtime.ts";
import type { ToolDefinition } from "../../../src/hlvm/agent/llm-integration.ts";

Deno.test("sdk runtime: supported providers normalize case and reject unknown names", () => {
  assertEquals(assertSupportedSdkProvider("OpenAI"), "openai");
  assertEquals(assertSupportedSdkProvider("ANTHROPIC"), "anthropic");
  assertEquals(assertSupportedSdkProvider("Google"), "google");
  assertEquals(assertSupportedSdkProvider("claude-code"), "claude-code");
  assertEquals(assertSupportedSdkProvider("Ollama"), "ollama");
  assertThrows(() => assertSupportedSdkProvider("invalid-provider"), Error);
  assertThrows(() => assertSupportedSdkProvider(""), Error);
});

Deno.test("sdk runtime: tool definitions convert to a named record and omit empty input", () => {
  const defs: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "search",
        description: "Search the web",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
        },
      },
    },
  ];

  assertEquals(convertToolDefinitionsToSdk(undefined), undefined);
  assertEquals(convertToolDefinitionsToSdk([]), undefined);
  assertEquals(
    Object.keys(convertToolDefinitionsToSdk(defs) ?? {}).sort(),
    ["read_file", "search"],
  );
});

Deno.test("sdk runtime: system messages are consolidated while user and assistant order is preserved", () => {
  const messages: SdkConvertibleMessage[] = [
    { role: "system", content: "System prompt 1" },
    { role: "user", content: "Hello" },
    { role: "system", content: "System prompt 2" },
    { role: "assistant", content: "Hi!" },
  ];

  const result = convertToSdkMessages(messages);
  assertEquals(result.length, 3);
  assertEquals(result[0].role, "system");
  assertEquals(result[0].content, "System prompt 1\n\nSystem prompt 2");
  assertEquals(result[1].role, "user");
  assertEquals(result[2].role, "assistant");
});

Deno.test("sdk runtime: assistant tool calls are serialized and consecutive tool results are grouped", () => {
  const messages: SdkConvertibleMessage[] = [
    {
      role: "assistant",
      content: "Let me search",
      toolCalls: [
        { id: "tc_1", function: { name: "search", arguments: { query: "a" } } },
        { id: "tc_2", function: { name: "read", arguments: { path: "b" } } },
      ],
    },
    {
      role: "tool",
      content: "search result",
      toolCallId: "tc_1",
      toolName: "search",
    },
    {
      role: "tool",
      content: "read result",
      toolCallId: "tc_2",
      toolName: "read",
    },
  ];

  const result = convertToSdkMessages(messages);
  const assistantContent = result[0].content as Array<Record<string, unknown>>;
  const toolContent = result[1].content as Array<Record<string, unknown>>;

  assertEquals(result.length, 2);
  assertEquals(result[0].role, "assistant");
  assertEquals(assistantContent[0].type, "text");
  assertEquals(assistantContent[1].type, "tool-call");
  assertEquals(assistantContent[2].type, "tool-call");
  assertEquals(result[1].role, "tool");
  assertEquals(toolContent.length, 2);
  assertEquals(toolContent[0].toolCallId, "tc_1");
  assertEquals(toolContent[1].toolCallId, "tc_2");
});

Deno.test("sdk runtime: orphaned tool results are dropped and missing ids are repaired only when unambiguous", () => {
  const repaired = convertToSdkMessages([
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { function: { name: "read_file", arguments: { path: "a.ts" } } },
        { function: { name: "search_web", arguments: { query: "b" } } },
      ],
    },
    { role: "tool", content: "file a", toolName: "read_file" },
    { role: "tool", content: "file b", toolName: "search_web" },
  ]);
  const repairedAssistant = repaired[0].content as Array<Record<string, unknown>>;
  const repairedTools = repaired[1].content as Array<Record<string, unknown>>;

  assertEquals(repaired.length, 2);
  assertEquals(repairedTools[0].toolCallId, repairedAssistant[0].toolCallId);
  assertEquals(repairedTools[1].toolCallId, repairedAssistant[1].toolCallId);

  const ambiguous = convertToSdkMessages([
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { function: { name: "read_file", arguments: { path: "a.ts" } } },
        { function: { name: "read_file", arguments: { path: "b.ts" } } },
      ],
    },
    { role: "tool", content: "file a", toolName: "read_file" },
    { role: "tool", content: "file b", toolName: "read_file" },
  ]);

  assertEquals(ambiguous.length, 1);
  assertEquals(ambiguous[0].role, "assistant");

  const orphan = convertToSdkMessages([
    { role: "user", content: "hello" },
    { role: "tool", content: "orphan result", toolCallId: "tc_orphan", toolName: "search" },
  ]);
  assertEquals(orphan.length, 1);
  assertEquals(orphan[0].role, "user");
});

Deno.test("sdk runtime: user multimodal content supports text, images, and files", () => {
  const result = convertToSdkMessages([
    {
      role: "user",
      content: "Analyze these attachments",
      images: [
        { data: "base64-image", mimeType: "image/png" },
        { data: "base64-pdf", mimeType: "application/pdf" },
      ],
    },
  ]);
  const content = result[0].content as Array<Record<string, unknown>>;

  assertEquals(result.length, 1);
  assertEquals(result[0].role, "user");
  assertEquals(content[0].type, "text");
  assertEquals(content[1].type, "image");
  assertEquals(content[1].image, "base64-image");
  assertEquals(content[2].type, "file");
  assertEquals(content[2].data, "base64-pdf");
  assertEquals(content[2].mediaType, "application/pdf");
});

Deno.test("sdk runtime: usage mapping preserves values and defaults missing tokens to zero", () => {
  assertEquals(mapSdkUsage(undefined), undefined);
  assertEquals(
    mapSdkUsage({ inputTokens: 100, outputTokens: 50 }),
    { inputTokens: 100, outputTokens: 50 },
  );
  assertEquals(
    mapSdkUsage({ inputTokens: undefined, outputTokens: undefined }),
    { inputTokens: 0, outputTokens: 0 },
  );
});

Deno.test("sdk runtime: native sources and provider metadata normalize to plain records", () => {
  const sources = mapSdkSources([
    {
      type: "source",
      sourceType: "url",
      id: "src_1",
      url: "https://example.com",
      title: "Example",
      providerMetadata: { openai: { source: "web-search" } },
    },
    {
      type: "source",
      sourceType: "document",
      id: "doc_1",
      title: "Report",
      mediaType: "application/pdf",
      filename: "report.pdf",
    },
  ]);

  assertEquals(sources?.length, 2);
  assertEquals(sources?.[0]?.sourceType, "url");
  assertEquals(sources?.[0]?.providerMetadata?.openai !== undefined, true);
  assertEquals(normalizeProviderMetadata({ google: { groundingMetadata: true } }), {
    google: { groundingMetadata: true },
  });
  assertEquals(normalizeProviderMetadata("bad"), undefined);
});

Deno.test("sdk runtime: _sdkResponseMessages passthrough preserves assistant message with reasoning", () => {
  // Simulate an SDK assistant message with a ReasoningPart + text + tool-call
  const sdkAssistantMessage = {
    role: "assistant" as const,
    content: [
      { type: "reasoning", text: "Let me think about this..." },
      { type: "text", text: "I'll search for that." },
      { type: "tool-call", toolCallId: "tc_sdk_1", toolName: "search", input: { query: "test" } },
    ],
  };

  const messages: SdkConvertibleMessage[] = [
    { role: "user", content: "Find something" },
    {
      role: "assistant",
      content: "I'll search for that.",
      toolCalls: [{ id: "tc_sdk_1", function: { name: "search", arguments: { query: "test" } } }],
      _sdkResponseMessages: [sdkAssistantMessage],
    },
    { role: "tool", content: "Found it", toolCallId: "tc_sdk_1", toolName: "search" },
  ];

  const result = convertToSdkMessages(messages);
  assertEquals(result.length, 3);
  assertEquals(result[0].role, "user");

  // The assistant message should be the SDK-native one (with reasoning)
  assertEquals(result[1].role, "assistant");
  const assistantContent = result[1].content as Array<Record<string, unknown>>;
  assertEquals(assistantContent[0].type, "reasoning");
  assertEquals(assistantContent[1].type, "text");
  assertEquals(assistantContent[2].type, "tool-call");

  // Tool result should still correlate via pendingToolCalls extracted from SDK message
  assertEquals(result[2].role, "tool");
  const toolContent = result[2].content as Array<Record<string, unknown>>;
  assertEquals(toolContent[0].toolCallId, "tc_sdk_1");
});

Deno.test("sdk runtime: _sdkResponseMessages fallback when no assistant found in SDK messages", () => {
  // Edge case: _sdkResponseMessages exists but has no assistant message
  const messages: SdkConvertibleMessage[] = [
    {
      role: "assistant",
      content: "Plain text response",
      _sdkResponseMessages: [{ role: "system", content: "not an assistant" }],
    },
  ];

  const result = convertToSdkMessages(messages);
  assertEquals(result.length, 1);
  assertEquals(result[0].role, "assistant");
  // Falls back to reconstructed message (plain string content)
  assertEquals(result[0].content, "Plain text response");
});

Deno.test("sdk runtime: assistant without _sdkResponseMessages reconstructs normally", () => {
  // Transcript-loaded messages won't have _sdkResponseMessages
  const messages: SdkConvertibleMessage[] = [
    {
      role: "assistant",
      content: "I found the answer.",
      toolCalls: [{ id: "tc_1", function: { name: "read_file", arguments: { path: "a.ts" } } }],
    },
    { role: "tool", content: "file contents", toolCallId: "tc_1", toolName: "read_file" },
  ];

  const result = convertToSdkMessages(messages);
  assertEquals(result.length, 2);
  assertEquals(result[0].role, "assistant");
  const parts = result[0].content as Array<Record<string, unknown>>;
  assertEquals(parts[0].type, "text");
  assertEquals(parts[1].type, "tool-call");
  assertEquals(result[1].role, "tool");
});

Deno.test("sdk runtime: _sdkResponseMessages text-only assistant (no tool calls)", () => {
  const sdkAssistantMessage = {
    role: "assistant" as const,
    content: [
      { type: "reasoning", text: "Thinking deeply..." },
      { type: "text", text: "Here is the answer." },
    ],
  };

  const messages: SdkConvertibleMessage[] = [
    {
      role: "assistant",
      content: "Here is the answer.",
      _sdkResponseMessages: [sdkAssistantMessage],
    },
  ];

  const result = convertToSdkMessages(messages);
  assertEquals(result.length, 1);
  assertEquals(result[0].role, "assistant");
  const content = result[0].content as Array<Record<string, unknown>>;
  assertEquals(content[0].type, "reasoning");
  assertEquals(content[1].type, "text");
});
