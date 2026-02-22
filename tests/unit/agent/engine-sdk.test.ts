/**
 * SdkAgentEngine Tests
 *
 * Unit tests for message/tool conversion functions and structural checks.
 * These do NOT require a live LLM — they test the pure conversion layer.
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
} from "jsr:@std/assert";
import {
  getSdkModel,
  mapSdkToolCalls,
  SdkAgentEngine,
} from "../../../src/hlvm/agent/engine-sdk.ts";
import { convertToSdkMessages, convertToolDefinitionsToSdk, mapSdkUsage } from "../../../src/hlvm/providers/sdk-runtime.ts";
import type { Message } from "../../../src/hlvm/agent/context.ts";
import type { ToolDefinition } from "../../../src/hlvm/agent/llm-integration.ts";

// ============================================================
// convertToSdkMessages
// ============================================================

Deno.test({
  name: "convertToSdkMessages: system message",
  fn() {
    const messages: Message[] = [
      { role: "system", content: "You are a helpful assistant." },
    ];
    const result = convertToSdkMessages(messages);
    assertEquals(result.length, 1);
    assertEquals(result[0].role, "system");
    assertEquals(result[0].content, "You are a helpful assistant.");
  },
});

Deno.test({
  name: "convertToSdkMessages: user message",
  fn() {
    const messages: Message[] = [
      { role: "user", content: "Hello!" },
    ];
    const result = convertToSdkMessages(messages);
    assertEquals(result.length, 1);
    assertEquals(result[0].role, "user");
    assertEquals(result[0].content, "Hello!");
  },
});

Deno.test({
  name: "convertToSdkMessages: assistant message without tool calls",
  fn() {
    const messages: Message[] = [
      { role: "assistant", content: "I can help with that." },
    ];
    const result = convertToSdkMessages(messages);
    assertEquals(result.length, 1);
    assertEquals(result[0].role, "assistant");
    assertEquals(result[0].content, "I can help with that.");
  },
});

Deno.test({
  name: "convertToSdkMessages: assistant message with tool calls",
  fn() {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "Let me search for that.",
        toolCalls: [
          {
            id: "call_123",
            function: {
              name: "search_code",
              arguments: { query: "test", path: "src/" },
            },
          },
        ],
      },
    ];
    const result = convertToSdkMessages(messages);
    assertEquals(result.length, 1);
    assertEquals(result[0].role, "assistant");
    // Should be content parts array
    const content = result[0].content as Array<Record<string, unknown>>;
    assertEquals(content.length, 2); // text + tool-call
    assertEquals(content[0].type, "text");
    assertEquals((content[0] as { text: string }).text, "Let me search for that.");
    assertEquals(content[1].type, "tool-call");
    assertEquals((content[1] as { toolCallId: string }).toolCallId, "call_123");
    assertEquals((content[1] as { toolName: string }).toolName, "search_code");
    assertEquals((content[1] as { input: unknown }).input, { query: "test", path: "src/" });
  },
});

Deno.test({
  name: "convertToSdkMessages: assistant with tool calls, string arguments parsed",
  fn() {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_456",
            function: {
              name: "read_file",
              arguments: '{"path":"foo.ts"}',
            },
          },
        ],
      },
    ];
    const result = convertToSdkMessages(messages);
    const content = result[0].content as Array<Record<string, unknown>>;
    // Empty content should not produce a text part
    assertEquals(content.length, 1);
    assertEquals(content[0].type, "tool-call");
    assertEquals((content[0] as { input: unknown }).input, { path: "foo.ts" });
  },
});

Deno.test({
  name: "convertToSdkMessages: assistant with invalid JSON tool args does not throw",
  fn() {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_invalid",
            function: {
              name: "read_file",
              arguments: "{invalid-json",
            },
          },
        ],
      },
    ];
    const result = convertToSdkMessages(messages);
    const content = result[0].content as Array<Record<string, unknown>>;
    assertEquals(content.length, 1);
    assertEquals(content[0].type, "tool-call");
    assertEquals((content[0] as { input: unknown }).input, {});
  },
});

Deno.test({
  name: "convertToSdkMessages: tool message",
  fn() {
    const messages: Message[] = [
      {
        role: "tool",
        content: "File contents here",
        toolName: "read_file",
        toolCallId: "call_789",
      },
    ];
    const result = convertToSdkMessages(messages);
    assertEquals(result.length, 1);
    assertEquals(result[0].role, "tool");
    const content = result[0].content as Array<Record<string, unknown>>;
    assertEquals(content.length, 1);
    assertEquals(content[0].type, "tool-result");
    assertEquals((content[0] as { toolCallId: string }).toolCallId, "call_789");
    assertEquals((content[0] as { toolName: string }).toolName, "read_file");
    const output = (content[0] as { output: { type: string; value: string } }).output;
    assertEquals(output.type, "text");
    assertEquals(output.value, "File contents here");
  },
});

// ============================================================
// convertToSdkTools
// ============================================================

Deno.test({
  name: "convertToolDefinitionsToSdk: converts ToolDefinition[] to SDK tools",
  fn() {
    const defs: ToolDefinition[] = [
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "File path" },
            },
            required: ["path"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "shell_exec",
          description: "Execute a shell command",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string" },
            },
            required: ["command"],
          },
        },
      },
    ];

    const sdkTools = convertToolDefinitionsToSdk(defs)!;
    assertExists(sdkTools["read_file"]);
    assertExists(sdkTools["shell_exec"]);
    assertEquals(Object.keys(sdkTools).length, 2);
  },
});

// ============================================================
// mapSdkToolCalls
// ============================================================

Deno.test({
  name: "mapSdkToolCalls: maps SDK tool calls to our ToolCall format",
  fn() {
    const sdkCalls = [
      {
        toolCallId: "call_abc",
        toolName: "search_code",
        input: { query: "hello", path: "src/" },
      },
      {
        toolCallId: "call_def",
        toolName: "read_file",
        input: { path: "foo.ts" },
      },
    ];

    const result = mapSdkToolCalls(sdkCalls);
    assertEquals(result.length, 2);
    assertEquals(result[0].id, "call_abc");
    assertEquals(result[0].toolName, "search_code");
    assertEquals(result[0].args, { query: "hello", path: "src/" });
    assertEquals(result[1].id, "call_def");
    assertEquals(result[1].toolName, "read_file");
    assertEquals(result[1].args, { path: "foo.ts" });
  },
});

Deno.test({
  name: "mapSdkToolCalls: empty array returns empty",
  fn() {
    assertEquals(mapSdkToolCalls([]), []);
  },
});

// ============================================================
// mapSdkUsage
// ============================================================

Deno.test({
  name: "mapSdkUsage: maps token counts",
  fn() {
    const result = mapSdkUsage({
      inputTokens: 100,
      outputTokens: 50,
    });
    assertEquals(result, { inputTokens: 100, outputTokens: 50 });
  },
});

Deno.test({
  name: "mapSdkUsage: handles undefined counts as 0",
  fn() {
    const result = mapSdkUsage({
      inputTokens: undefined,
      outputTokens: undefined,
    });
    assertEquals(result, { inputTokens: 0, outputTokens: 0 });
  },
});

Deno.test({
  name: "mapSdkUsage: returns undefined for no usage",
  fn() {
    assertEquals(mapSdkUsage(undefined), undefined);
  },
});

// ============================================================
// SdkAgentEngine (structural — no live LLM needed)
// ============================================================

Deno.test({
  name: "SdkAgentEngine.createLLM returns a function",
  fn() {
    const engine = new SdkAgentEngine();
    const llm = engine.createLLM({ model: "ollama/test" });
    assertEquals(typeof llm, "function");
  },
});

Deno.test({
  name: "SdkAgentEngine.createSummarizer returns a function",
  fn() {
    const engine = new SdkAgentEngine();
    const summarizer = engine.createSummarizer("ollama/test");
    assertEquals(typeof summarizer, "function");
  },
});

Deno.test({
  name: "getSdkModel: unknown provider fails fast",
  async fn() {
    await assertRejects(
      () => getSdkModel("unknown-provider/model"),
      Error,
      "Unsupported SDK provider",
    );
  },
});
