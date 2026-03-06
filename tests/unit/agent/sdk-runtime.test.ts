/**
 * SDK Runtime Tests
 *
 * Unit tests for the pure conversion functions in sdk-runtime.ts.
 * No provider mocking needed — these are all pure transformations.
 */

import {
  assertEquals,
  assertThrows,
} from "jsr:@std/assert";
import {
  assertSupportedSdkProvider,
  convertToSdkMessages,
  convertToolDefinitionsToSdk,
  mapSdkUsage,
  type SdkConvertibleMessage,
} from "../../../src/hlvm/providers/sdk-runtime.ts";
import type { ToolDefinition } from "../../../src/hlvm/agent/llm-integration.ts";

// ============================================================
// assertSupportedSdkProvider
// ============================================================

Deno.test({
  name: "assertSupportedSdkProvider: valid provider names",
  fn() {
    assertEquals(assertSupportedSdkProvider("openai"), "openai");
    assertEquals(assertSupportedSdkProvider("anthropic"), "anthropic");
    assertEquals(assertSupportedSdkProvider("google"), "google");
    assertEquals(assertSupportedSdkProvider("claude-code"), "claude-code");
    assertEquals(assertSupportedSdkProvider("ollama"), "ollama");
  },
});

Deno.test({
  name: "assertSupportedSdkProvider: case normalization",
  fn() {
    assertEquals(assertSupportedSdkProvider("OpenAI"), "openai");
    assertEquals(assertSupportedSdkProvider("ANTHROPIC"), "anthropic");
    assertEquals(assertSupportedSdkProvider("Google"), "google");
    assertEquals(assertSupportedSdkProvider("Ollama"), "ollama");
  },
});

Deno.test({
  name: "assertSupportedSdkProvider: invalid provider throws",
  fn() {
    assertThrows(
      () => assertSupportedSdkProvider("invalid-provider"),
      Error,
      "Unsupported SDK provider",
    );
    assertThrows(
      () => assertSupportedSdkProvider(""),
      Error,
      "Unsupported SDK provider",
    );
  },
});

// ============================================================
// convertToolDefinitionsToSdk
// ============================================================

Deno.test({
  name: "convertToolDefinitionsToSdk: undefined returns undefined",
  fn() {
    assertEquals(convertToolDefinitionsToSdk(undefined), undefined);
  },
});

Deno.test({
  name: "convertToolDefinitionsToSdk: empty array returns undefined",
  fn() {
    assertEquals(convertToolDefinitionsToSdk([]), undefined);
  },
});

Deno.test({
  name: "convertToolDefinitionsToSdk: populated array returns record",
  fn() {
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
    const result = convertToolDefinitionsToSdk(defs);
    assertEquals(result !== undefined, true);
    assertEquals(Object.keys(result!).sort(), ["read_file", "search"]);
  },
});

// ============================================================
// convertToSdkMessages: system message consolidation
// (Regression test for multiple-system-messages bug)
// ============================================================

Deno.test({
  name: "convertToSdkMessages: consolidates multiple system messages",
  fn() {
    const messages: SdkConvertibleMessage[] = [
      { role: "system", content: "System prompt 1" },
      { role: "user", content: "Hello" },
      { role: "system", content: "System prompt 2" },
      { role: "assistant", content: "Hi!" },
      { role: "system", content: "System prompt 3" },
    ];
    const result = convertToSdkMessages(messages);
    // All system messages must be consolidated into position 0
    const systemMessages = result.filter((m) => m.role === "system");
    assertEquals(systemMessages.length, 1);
    assertEquals(result[0].role, "system");
    assertEquals(
      result[0].content,
      "System prompt 1\n\nSystem prompt 2\n\nSystem prompt 3",
    );
    // Non-system messages preserved in order
    assertEquals(result[1].role, "user");
    assertEquals(result[2].role, "assistant");
    assertEquals(result.length, 3);
  },
});

Deno.test({
  name: "convertToSdkMessages: no system messages produces no system entry",
  fn() {
    const messages: SdkConvertibleMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ];
    const result = convertToSdkMessages(messages);
    assertEquals(result.length, 2);
    assertEquals(result[0].role, "user");
    assertEquals(result[1].role, "assistant");
  },
});

Deno.test({
  name: "convertToSdkMessages: tool call messages with camelCase conventions",
  fn() {
    const messages: SdkConvertibleMessage[] = [
      {
        role: "assistant",
        content: "Let me search",
        toolCalls: [{
          id: "tc_1",
          function: { name: "search", arguments: { query: "test" } },
        }],
      },
    ];
    const result = convertToSdkMessages(messages);
    assertEquals(result.length, 1);
    assertEquals(result[0].role, "assistant");
    // deno-lint-ignore no-explicit-any
    const content = (result[0] as any).content;
    assertEquals(Array.isArray(content), true);
    assertEquals(content.length, 2); // text + tool-call
    assertEquals(content[0].type, "text");
    assertEquals(content[1].type, "tool-call");
    assertEquals(content[1].toolName, "search");
  },
});

Deno.test({
  name: "convertToSdkMessages: standalone tool result messages are dropped as orphans",
  fn() {
    const messages: SdkConvertibleMessage[] = [
      {
        role: "tool",
        content: "Search results here",
        toolCallId: "tc_1",
        toolName: "search",
      },
    ];
    const result = convertToSdkMessages(messages);
    assertEquals(result.length, 0);
  },
});

Deno.test({
  name: "convertToSdkMessages: groups consecutive tool results after assistant tool uses",
  fn() {
    const messages: SdkConvertibleMessage[] = [
      {
        role: "assistant",
        content: "",
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
    assertEquals(result.length, 2);
    assertEquals(result[0].role, "assistant");
    assertEquals(result[1].role, "tool");
    // deno-lint-ignore no-explicit-any
    const content = (result[1] as any).content;
    assertEquals(Array.isArray(content), true);
    assertEquals(content.length, 2);
    assertEquals(content[0].toolCallId, "tc_1");
    assertEquals(content[1].toolCallId, "tc_2");
  },
});

Deno.test({
  name: "convertToSdkMessages: drops orphan tool results without matching preceding assistant tool use",
  fn() {
    const messages: SdkConvertibleMessage[] = [
      { role: "user", content: "hello" },
      {
        role: "tool",
        content: "orphan result",
        toolCallId: "tc_orphan",
        toolName: "search",
      },
    ];

    const result = convertToSdkMessages(messages);
    assertEquals(result.length, 1);
    assertEquals(result[0].role, "user");
  },
});

Deno.test({
  name: "convertToSdkMessages: user message with images",
  fn() {
    const messages: SdkConvertibleMessage[] = [
      {
        role: "user",
        content: "What is in this image?",
        images: ["data:image/png;base64,abc123"],
      },
    ];
    const result = convertToSdkMessages(messages);
    assertEquals(result.length, 1);
    assertEquals(result[0].role, "user");
    // deno-lint-ignore no-explicit-any
    const content = (result[0] as any).content;
    assertEquals(Array.isArray(content), true);
    assertEquals(content[0].type, "text");
    assertEquals(content[1].type, "image");
  },
});

Deno.test({
  name: "convertToSdkMessages: user message with structured image + file media",
  fn() {
    const messages: SdkConvertibleMessage[] = [
      {
        role: "user",
        content: "Analyze these attachments",
        images: [
          { data: "base64-image", mimeType: "image/png" },
          { data: "base64-pdf", mimeType: "application/pdf" },
        ],
      },
    ];
    const result = convertToSdkMessages(messages);
    assertEquals(result.length, 1);
    assertEquals(result[0].role, "user");
    // deno-lint-ignore no-explicit-any
    const content = (result[0] as any).content;
    assertEquals(Array.isArray(content), true);
    assertEquals(content[0].type, "text");
    assertEquals(content[1].type, "image");
    assertEquals(content[1].image, "base64-image");
    assertEquals(content[2].type, "file");
    assertEquals(content[2].data, "base64-pdf");
    assertEquals(content[2].mediaType, "application/pdf");
  },
});

// ============================================================
// mapSdkUsage
// ============================================================

Deno.test({
  name: "mapSdkUsage: undefined returns undefined",
  fn() {
    assertEquals(mapSdkUsage(undefined), undefined);
  },
});

Deno.test({
  name: "mapSdkUsage: normal values passed through",
  fn() {
    const result = mapSdkUsage({ inputTokens: 100, outputTokens: 50 });
    assertEquals(result, { inputTokens: 100, outputTokens: 50 });
  },
});

Deno.test({
  name: "mapSdkUsage: undefined tokens default to 0",
  fn() {
    const result = mapSdkUsage({
      inputTokens: undefined,
      outputTokens: undefined,
    });
    assertEquals(result, { inputTokens: 0, outputTokens: 0 });
  },
});

Deno.test({
  name: "mapSdkUsage: zero values preserved",
  fn() {
    const result = mapSdkUsage({ inputTokens: 0, outputTokens: 0 });
    assertEquals(result, { inputTokens: 0, outputTokens: 0 });
  },
});
