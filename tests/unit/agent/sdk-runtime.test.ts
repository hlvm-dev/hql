import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  assertSupportedSdkProvider,
  convertToolDefinitionsToSdk,
  convertToSdkMessages,
  mapSdkSources,
  mapSdkUsage,
  maybeHandleSdkAuthError,
  maybeHandleSdkRecoverableError,
  normalizeProviderCacheMetrics,
  normalizeProviderMetadata,
  resolveSdkStreamFailure,
  type SdkConvertibleMessage,
} from "../../../src/hlvm/providers/sdk-runtime.ts";
import type { ToolDefinition } from "../../../src/hlvm/agent/llm-integration.ts";
import {
  clearTokenCache,
  getClaudeCodeToken,
} from "../../../src/hlvm/providers/claude-code/auth.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

Deno.test("sdk runtime: supported providers normalize case and reject unknown names", () => {
  assertEquals(assertSupportedSdkProvider("OpenAI"), "openai");
  assertEquals(assertSupportedSdkProvider("ANTHROPIC"), "anthropic");
  assertEquals(assertSupportedSdkProvider("Google"), "google");
  assertEquals(assertSupportedSdkProvider("claude-code"), "claude-code");
  assertEquals(assertSupportedSdkProvider("Ollama"), "ollama");
  assertThrows(() => assertSupportedSdkProvider("invalid-provider"), Error);
  assertThrows(() => assertSupportedSdkProvider(""), Error);
});

Deno.test("sdk runtime: stream wrapper errors defer to underlying provider failures", () => {
  const wrapped = new Error(
    "No output generated. Check the stream for errors.",
  );
  const providerError = Object.assign(
    new Error("OAuth token has expired."),
    { statusCode: 401 },
  );
  const passthrough = new Error("other");

  assertEquals(resolveSdkStreamFailure(wrapped, providerError), providerError);
  assertEquals(
    resolveSdkStreamFailure(passthrough, providerError),
    passthrough,
  );
});

Deno.test("sdk runtime: claude-code auth failures clear token cache for an immediate retry", async () => {
  const platform = getPlatform();
  const previousToken = platform.env.get("CLAUDE_CODE_TOKEN");

  try {
    platform.env.set("CLAUDE_CODE_TOKEN", "stale-token");
    clearTokenCache();
    assertEquals(await getClaudeCodeToken(), "stale-token");

    platform.env.set("CLAUDE_CODE_TOKEN", "fresh-token");
    const shouldRetry = await maybeHandleSdkAuthError("claude-code", {
      statusCode: 401,
      message: "expired",
    });

    assertEquals(shouldRetry, true);
    assertEquals(await getClaudeCodeToken(), "fresh-token");
  } finally {
    clearTokenCache();
    if (previousToken === undefined) {
      platform.env.delete("CLAUDE_CODE_TOKEN");
    } else {
      platform.env.set("CLAUDE_CODE_TOKEN", previousToken);
    }
  }
});

Deno.test("sdk runtime: ollama transient 404s retry once to survive model warm-up races", async () => {
  const shouldRetry = await maybeHandleSdkRecoverableError(
    "ollama",
    {
      statusCode: 404,
      message: "Error",
      responseBody:
        '{"error":"model \\"llama3.1:8b\\" not found, try pulling it first"}',
    },
    { ollamaRetryDelayMs: 0 },
  );

  assertEquals(shouldRetry, true);
});

Deno.test("sdk runtime: non-retryable ollama request rejections fail fast", async () => {
  const shouldRetry = await maybeHandleSdkRecoverableError(
    "ollama",
    {
      statusCode: 400,
      message: "bad request",
      responseBody: '{"error":"invalid format"}',
    },
    { ollamaRetryDelayMs: 0 },
  );

  assertEquals(shouldRetry, false);
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
  const repairedAssistant = repaired[0].content as Array<
    Record<string, unknown>
  >;
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
    {
      role: "tool",
      content: "orphan result",
      toolCallId: "tc_orphan",
      toolName: "search",
    },
  ]);
  assertEquals(orphan.length, 1);
  assertEquals(orphan[0].role, "user");
});

Deno.test("sdk runtime: user multimodal content supports text attachments, images, and files", () => {
  const result = convertToSdkMessages([
    {
      role: "user",
      content: "Analyze these attachments",
      attachments: [
        {
          mode: "text",
          attachmentId: "att_text",
          fileName: "notes.txt",
          mimeType: "text/plain",
          kind: "text",
          conversationKind: "text",
          size: 12,
          text: "alpha\nbeta",
        },
        {
          mode: "binary",
          attachmentId: "att_image",
          fileName: "image.png",
          mimeType: "image/png",
          kind: "image",
          conversationKind: "image",
          size: 3,
          data: "base64-image",
        },
        {
          mode: "binary",
          attachmentId: "att_pdf",
          fileName: "report.pdf",
          mimeType: "application/pdf",
          kind: "pdf",
          conversationKind: "pdf",
          size: 3,
          data: "base64-pdf",
        },
      ],
    },
  ]);
  const content = result[0].content as Array<Record<string, unknown>>;

  assertEquals(result.length, 1);
  assertEquals(result[0].role, "user");
  assertEquals(content[0].type, "text");
  assertEquals(content[1].type, "text");
  assertEquals(
    content[1].text,
    "Attached file (notes.txt, text/plain):\nalpha\nbeta",
  );
  assertEquals(content[2].type, "image");
  assertEquals(content[2].image, "base64-image");
  assertEquals(content[3].type, "file");
  assertEquals(content[3].data, "base64-pdf");
  assertEquals(content[3].mediaType, "application/pdf");
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
  assertEquals(
    normalizeProviderMetadata({ google: { groundingMetadata: true } }),
    {
      google: { groundingMetadata: true },
    },
  );
  assertEquals(normalizeProviderMetadata("bad"), undefined);
});

Deno.test("sdk runtime: provider cache metrics normalize camelCase and snake_case counters", () => {
  assertEquals(
    normalizeProviderCacheMetrics({
      usage: {
        cacheReadInputTokens: 21,
        cacheCreationInputTokens: 13,
      },
    }),
    {
      cacheReadInputTokens: 21,
      cacheCreationInputTokens: 13,
    },
  );
  assertEquals(
    normalizeProviderCacheMetrics({
      providerMetadata: {
        anthropic: {
          cache_read_input_tokens: 34,
          cache_creation_input_tokens: 8,
        },
      },
    }),
    {
      cacheReadInputTokens: 34,
      cacheCreationInputTokens: 8,
    },
  );
  assertEquals(
    normalizeProviderCacheMetrics({
      providerMetadata: { openai: { foo: "bar" } },
    }),
    undefined,
  );
});

Deno.test("sdk runtime: _sdkResponseMessages passthrough preserves assistant message with reasoning", () => {
  // Simulate an SDK assistant message with a ReasoningPart + text + tool-call
  const sdkAssistantMessage = {
    role: "assistant" as const,
    content: [
      { type: "reasoning", text: "Let me think about this..." },
      { type: "text", text: "I'll search for that." },
      {
        type: "tool-call",
        toolCallId: "tc_sdk_1",
        toolName: "search",
        input: { query: "test" },
      },
    ],
  };

  const messages: SdkConvertibleMessage[] = [
    { role: "user", content: "Find something" },
    {
      role: "assistant",
      content: "I'll search for that.",
      toolCalls: [{
        id: "tc_sdk_1",
        function: { name: "search", arguments: { query: "test" } },
      }],
      _sdkResponseMessages: [sdkAssistantMessage],
    },
    {
      role: "tool",
      content: "Found it",
      toolCallId: "tc_sdk_1",
      toolName: "search",
    },
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

Deno.test("sdk runtime: _sdkResponseMessages repairs missing tool-call parts from persisted toolCalls", () => {
  const sdkAssistantMessage = {
    role: "assistant" as const,
    content: [
      { type: "reasoning", text: "Need multiple form fills." },
      { type: "text", text: "I'll fill the fields now." },
      {
        type: "tool-call",
        toolCallId: "tc_sdk_1",
        toolName: "pw_fill",
        input: { selector: "input[name='name']", value: "John" },
      },
      {
        type: "tool-call",
        toolCallId: "tc_sdk_2",
        toolName: "pw_fill",
        input: { selector: "input[name='phone']", value: "555-1234" },
      },
    ],
  };

  const messages: SdkConvertibleMessage[] = [
    {
      role: "assistant",
      content: "I'll fill the fields now.",
      toolCalls: [
        {
          id: "tc_sdk_1",
          function: {
            name: "pw_fill",
            arguments: { selector: "input[name='name']", value: "John" },
          },
        },
        {
          id: "tc_sdk_2",
          function: {
            name: "pw_fill",
            arguments: { selector: "input[name='phone']", value: "555-1234" },
          },
        },
        {
          id: "tc_sdk_3",
          function: {
            name: "pw_fill",
            arguments: {
              selector: "input[name='email']",
              value: "john@test.com",
            },
          },
        },
      ],
      _sdkResponseMessages: [sdkAssistantMessage],
    },
    {
      role: "tool",
      content: "name fill failed",
      toolCallId: "tc_sdk_1",
      toolName: "pw_fill",
    },
    {
      role: "tool",
      content: "phone fill failed",
      toolCallId: "tc_sdk_2",
      toolName: "pw_fill",
    },
    {
      role: "tool",
      content: "email fill failed",
      toolCallId: "tc_sdk_3",
      toolName: "pw_fill",
    },
  ];

  const result = convertToSdkMessages(messages);
  assertEquals(result.length, 2);
  assertEquals(result[0].role, "assistant");
  const assistantContent = result[0].content as Array<Record<string, unknown>>;
  assertEquals(
    assistantContent.filter((part) => part.type === "tool-call").length,
    3,
  );
  assertEquals(result[1].role, "tool");
  const toolContent = result[1].content as Array<Record<string, unknown>>;
  assertEquals(toolContent.length, 3);
  assertEquals(toolContent[0].toolCallId, "tc_sdk_1");
  assertEquals(toolContent[1].toolCallId, "tc_sdk_2");
  assertEquals(toolContent[2].toolCallId, "tc_sdk_3");
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
      toolCalls: [{
        id: "tc_1",
        function: { name: "read_file", arguments: { path: "a.ts" } },
      }],
    },
    {
      role: "tool",
      content: "file contents",
      toolCallId: "tc_1",
      toolName: "read_file",
    },
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

Deno.test("sdk runtime: audio and video attachments produce file parts with correct mediaType", () => {
  const result = convertToSdkMessages([
    {
      role: "user",
      content: "Listen to this",
      attachments: [
        {
          mode: "binary",
          attachmentId: "att_audio",
          fileName: "song.mp3",
          mimeType: "audio/mpeg",
          kind: "audio",
          conversationKind: "audio",
          size: 1000,
          data: "base64-audio",
        },
        {
          mode: "binary",
          attachmentId: "att_video",
          fileName: "clip.mp4",
          mimeType: "video/mp4",
          kind: "video",
          conversationKind: "video",
          size: 2000,
          data: "base64-video",
        },
      ],
    },
  ]);

  assertEquals(result.length, 1);
  assertEquals(result[0].role, "user");
  const content = result[0].content as Array<Record<string, unknown>>;
  assertEquals(content[0].type, "text");
  assertEquals(content[0].text, "Listen to this");
  assertEquals(content[1].type, "file");
  assertEquals(content[1].data, "base64-audio");
  assertEquals(content[1].mediaType, "audio/mpeg");
  assertEquals(content[2].type, "file");
  assertEquals(content[2].data, "base64-video");
  assertEquals(content[2].mediaType, "video/mp4");
});
