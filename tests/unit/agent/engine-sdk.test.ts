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
import {
  convertToSdkMessages,
  convertToolDefinitionsToSdk,
  mapSdkUsage,
} from "../../../src/hlvm/providers/sdk-runtime.ts";
import type { Message } from "../../../src/hlvm/agent/context.ts";
import type { ToolDefinition } from "../../../src/hlvm/agent/llm-integration.ts";

Deno.test("engine sdk: convertToSdkMessages preserves basic roles and assistant text", () => {
  const messages: Message[] = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello!" },
    { role: "assistant", content: "I can help with that." },
  ];
  const result = convertToSdkMessages(messages);

  assertEquals(result.length, 3);
  assertEquals(result[0].role, "system");
  assertEquals(result[0].content, "You are a helpful assistant.");
  assertEquals(result[1].role, "user");
  assertEquals(result[1].content, "Hello!");
  assertEquals(result[2].role, "assistant");
  assertEquals(result[2].content, "I can help with that.");
});

Deno.test("engine sdk: assistant tool calls become content parts and tool results are linked", () => {
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
    {
      role: "tool",
      content: "File contents here",
      toolName: "search_code",
      toolCallId: "call_123",
    },
  ];
  const result = convertToSdkMessages(messages);
  const assistantContent = result[0].content as Array<Record<string, unknown>>;
  const toolContent = result[1].content as Array<Record<string, unknown>>;

  assertEquals(result.length, 2);
  assertEquals(result[0].role, "assistant");
  assertEquals(assistantContent[0].type, "text");
  assertEquals((assistantContent[0] as { text: string }).text, "Let me search for that.");
  assertEquals(assistantContent[1].type, "tool-call");
  assertEquals((assistantContent[1] as { toolCallId: string }).toolCallId, "call_123");
  assertEquals((assistantContent[1] as { toolName: string }).toolName, "search_code");
  assertEquals(result[1].role, "tool");
  assertEquals(toolContent[0].type, "tool-result");
  assertEquals((toolContent[0] as { toolCallId: string }).toolCallId, "call_123");
});

Deno.test("engine sdk: tool-call argument parsing tolerates object, string, and invalid JSON inputs", () => {
  const stringArgs = convertToSdkMessages([
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
  ]);
  const invalidArgs = convertToSdkMessages([
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
  ]);

  const stringContent = stringArgs[0].content as Array<Record<string, unknown>>;
  const invalidContent = invalidArgs[0].content as Array<Record<string, unknown>>;
  assertEquals((stringContent[0] as { input: unknown }).input, { path: "foo.ts" });
  assertEquals((invalidContent[0] as { input: unknown }).input, {});
});

Deno.test("engine sdk: SDK tool definitions and tool-call mappings preserve names and args", () => {
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

  const toolCalls = mapSdkToolCalls([
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
  ]);
  assertEquals(toolCalls.length, 2);
  assertEquals(toolCalls[0].id, "call_abc");
  assertEquals(toolCalls[0].toolName, "search_code");
  assertEquals(toolCalls[0].args, { query: "hello", path: "src/" });
  assertEquals(toolCalls[1].id, "call_def");
  assertEquals(toolCalls[1].toolName, "read_file");
  assertEquals(toolCalls[1].args, { path: "foo.ts" });
});

Deno.test("engine sdk: usage mapping preserves values and defaults missing counts to zero", () => {
  assertEquals(
    mapSdkUsage({
      inputTokens: 100,
      outputTokens: 50,
    }),
    { inputTokens: 100, outputTokens: 50 },
  );
  assertEquals(
    mapSdkUsage({
      inputTokens: undefined,
      outputTokens: undefined,
    }),
    { inputTokens: 0, outputTokens: 0 },
  );
  assertEquals(mapSdkUsage(undefined), undefined);
});

Deno.test("engine sdk: SdkAgentEngine exposes llm and summarizer factories", () => {
  const engine = new SdkAgentEngine();
  assertEquals(typeof engine.createLLM({ model: "ollama/test" }), "function");
  assertEquals(typeof engine.createSummarizer("ollama/test"), "function");
});

Deno.test("engine sdk: getSdkModel rejects unsupported provider prefixes", async () => {
  await assertRejects(
    () => getSdkModel("unknown-provider/model"),
    Error,
    "Unsupported SDK provider",
  );
});
