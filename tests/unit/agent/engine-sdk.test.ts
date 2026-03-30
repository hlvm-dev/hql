import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import {
  applyPromptCaching,
  buildToolCallRepairFunction,
  filterLocallyExecutableToolCalls,
  getSdkModel,
  mapSdkToolCalls,
  mergeSdkWebCapabilityTools,
  repairMalformedToolCallInput,
  resolveForcedProviderNativeToolChoice,
  resolveProviderNativeRouteFailureFromError,
  SdkAgentEngine,
} from "../../../src/hlvm/agent/engine-sdk.ts";
import { buildExecutionSurface } from "../../../src/hlvm/agent/execution-surface.ts";
import {
  REMOTE_CODE_EXECUTE_TOOL_NAME,
  resolveProviderExecutionPlan,
  resolveWebCapabilityPlan,
} from "../../../src/hlvm/agent/tool-capabilities.ts";
import {
  convertToolDefinitionsToSdk,
  convertToSdkMessages,
  mapSdkUsage,
} from "../../../src/hlvm/providers/sdk-runtime.ts";
import type { Message } from "../../../src/hlvm/agent/context.ts";
import type { ToolDefinition } from "../../../src/hlvm/agent/llm-integration.ts";
import { InvalidToolInputError, NoSuchToolError } from "ai";

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
  assertEquals(
    (assistantContent[0] as { text: string }).text,
    "Let me search for that.",
  );
  assertEquals(assistantContent[1].type, "tool-call");
  assertEquals(
    (assistantContent[1] as { toolCallId: string }).toolCallId,
    "call_123",
  );
  assertEquals(
    (assistantContent[1] as { toolName: string }).toolName,
    "search_code",
  );
  assertEquals(result[1].role, "tool");
  assertEquals(toolContent[0].type, "tool-result");
  assertEquals(
    (toolContent[0] as { toolCallId: string }).toolCallId,
    "call_123",
  );
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
  const invalidContent = invalidArgs[0].content as Array<
    Record<string, unknown>
  >;
  assertEquals((stringContent[0] as { input: unknown }).input, {
    path: "foo.ts",
  });
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

Deno.test("engine sdk: provider-executed native web_search tool calls are excluded from local execution", () => {
  const mapped = mapSdkToolCalls([
    {
      toolCallId: "call_native",
      toolName: "web_search",
      input: { query: "latest deno blog" },
    },
    {
      toolCallId: "call_local",
      toolName: "read_file",
      input: { path: "README.md" },
    },
  ]);

  assertEquals(
    filterLocallyExecutableToolCalls(
      mapped,
      resolveProviderExecutionPlan({
        providerName: "google",
        allowlist: ["web_search"],
        nativeCapabilities: {
          webSearch: true,
          webPageRead: false,
          remoteCodeExecution: false,
        },
      }),
    ),
    [{
      id: "call_local",
      toolName: "read_file",
      args: { path: "README.md" },
    }],
  );
});

Deno.test("engine sdk: explicit single-tool provider-native surfaces force the routed tool choice", () => {
  const providerExecutionPlan = resolveProviderExecutionPlan({
    providerName: "google",
    allowlist: ["web_search"],
    nativeCapabilities: {
      webSearch: true,
      webPageRead: false,
      remoteCodeExecution: false,
    },
  });
  const executionSurface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "google/gemini-2.5-flash-lite",
    pinnedProviderName: "google",
    providerExecutionPlan,
  });

  assertEquals(
    resolveForcedProviderNativeToolChoice({
      allowlist: ["web_search"],
      executionSurface,
      availableToolNames: ["web_search"],
    }),
    { type: "tool", toolName: "web_search" },
  );
});

Deno.test("engine sdk: forced provider-native tool choice stays off when the routed backend is not native", () => {
  const providerExecutionPlan = resolveProviderExecutionPlan({
    providerName: "google",
    allowlist: ["web_search"],
    nativeCapabilities: {
      webSearch: true,
      webPageRead: false,
      remoteCodeExecution: false,
    },
  });
  const executionSurface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "google/gemini-2.5-flash-lite",
    pinnedProviderName: "google",
    providerExecutionPlan,
    fallbackState: {
      suppressedCandidates: [{
        capabilityId: "web.search",
        backendKind: "provider-native",
        toolName: "web_search",
        routePhase: "tool-start",
        failureReason: "provider-native search failed",
      }],
    },
  });

  assertEquals(
    resolveForcedProviderNativeToolChoice({
      allowlist: ["web_search"],
      executionSurface,
      availableToolNames: ["search_web"],
    }),
    undefined,
  );
});

Deno.test("engine sdk: provider-executed native web_fetch is excluded only on the dedicated conservative surface", () => {
  const mapped = mapSdkToolCalls([
    {
      toolCallId: "call_native_fetch",
      toolName: "web_fetch",
      input: {},
    },
    {
      toolCallId: "call_local",
      toolName: "read_file",
      input: { path: "README.md" },
    },
  ]);

  assertEquals(
    filterLocallyExecutableToolCalls(
      mapped,
      resolveProviderExecutionPlan({
        providerName: "google",
        allowlist: ["web_fetch"],
        nativeCapabilities: {
          webSearch: true,
          webPageRead: true,
          remoteCodeExecution: true,
        },
      }),
    ),
    [{
      id: "call_local",
      toolName: "read_file",
      args: { path: "README.md" },
    }],
  );
});

Deno.test("engine sdk: provider-executed remote_code_execute is excluded from local execution", () => {
  const mapped = mapSdkToolCalls([
    {
      toolCallId: "call_native_remote",
      toolName: "code_execution",
      input: { code: "print(1)" },
    },
    {
      toolCallId: "call_local",
      toolName: "read_file",
      input: { path: "README.md" },
    },
  ]);

  assertEquals(
    filterLocallyExecutableToolCalls(
      mapped,
      resolveProviderExecutionPlan({
        providerName: "google",
        allowlist: [REMOTE_CODE_EXECUTE_TOOL_NAME],
        nativeCapabilities: {
          webSearch: true,
          webPageRead: true,
          remoteCodeExecution: true,
        },
      }),
    ),
    [{
      id: "call_local",
      toolName: "read_file",
      args: { path: "README.md" },
    }],
  );
});

Deno.test("engine sdk: native provider tools replace custom tools only when the resolved execution plan activates them", () => {
  const customSearchTool = convertToolDefinitionsToSdk([{
    type: "function",
    function: {
      name: "search_web",
      description: "Search the web",
      parameters: { type: "object", properties: {} },
    },
  }])!.search_web;
  const nativeSearchTool = convertToolDefinitionsToSdk([{
    type: "function",
    function: {
      name: "web_search",
      description: "Native web search",
      parameters: { type: "object", properties: {} },
    },
  }])!.web_search;
  const readFileTool = convertToolDefinitionsToSdk([{
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file",
      parameters: { type: "object", properties: {} },
    },
  }])!.read_file;
  const webFetchTool = convertToolDefinitionsToSdk([{
    type: "function",
    function: {
      name: "web_fetch",
      description: "Fetch a readable page",
      parameters: { type: "object", properties: {} },
    },
  }])!.web_fetch;
  const remoteCodeTool = convertToolDefinitionsToSdk([{
    type: "function",
    function: {
      name: REMOTE_CODE_EXECUTE_TOOL_NAME,
      description: "Remote code execution",
      parameters: { type: "object", properties: {} },
    },
  }])![REMOTE_CODE_EXECUTE_TOOL_NAME];
  const nativePlan = resolveWebCapabilityPlan({
    providerName: "openai",
    nativeCapabilities: {
      webSearch: true,
      webPageRead: false,
      remoteCodeExecution: false,
    },
  });
  const customPlan = resolveWebCapabilityPlan({
    providerName: "google",
    nativeCapabilities: {
      webSearch: false,
      webPageRead: false,
      remoteCodeExecution: false,
    },
  });
  const providerPlan = resolveProviderExecutionPlan({
    providerName: "google",
    allowlist: ["web_fetch", REMOTE_CODE_EXECUTE_TOOL_NAME],
    nativeCapabilities: {
      webSearch: true,
      webPageRead: true,
      remoteCodeExecution: true,
    },
  });

  assertEquals(
    Object.keys(mergeSdkWebCapabilityTools(
      {
        search_web: customSearchTool,
        read_file: readFileTool,
        web_fetch: webFetchTool,
      },
      { web_search: nativeSearchTool },
      nativePlan,
    )).sort(),
    ["read_file", "web_fetch", "web_search"],
  );
  assertEquals(
    mergeSdkWebCapabilityTools(
      { search_web: customSearchTool },
      {},
      nativePlan,
    ).search_web,
    customSearchTool,
  );
  assertEquals(
    mergeSdkWebCapabilityTools(
      { search_web: customSearchTool },
      { web_search: nativeSearchTool },
      customPlan,
    ).search_web,
    customSearchTool,
  );
  assertEquals(
    Object.keys(mergeSdkWebCapabilityTools(
      {
        web_fetch: webFetchTool,
        [REMOTE_CODE_EXECUTE_TOOL_NAME]: remoteCodeTool,
      },
      {
        web_fetch: nativeSearchTool,
        [REMOTE_CODE_EXECUTE_TOOL_NAME]: nativeSearchTool,
      },
      providerPlan,
    )).sort(),
    [REMOTE_CODE_EXECUTE_TOOL_NAME, "web_fetch"],
  );
});

Deno.test("engine sdk: execution surface can suppress remote_code_execute after a routed fallback", () => {
  const remoteCodeTool = convertToolDefinitionsToSdk([{
    type: "function",
    function: {
      name: REMOTE_CODE_EXECUTE_TOOL_NAME,
      description: "Remote code execution",
      parameters: { type: "object", properties: {} },
    },
  }])![REMOTE_CODE_EXECUTE_TOOL_NAME];
  const providerPlan = resolveProviderExecutionPlan({
    providerName: "google",
    allowlist: [REMOTE_CODE_EXECUTE_TOOL_NAME],
    nativeCapabilities: {
      webSearch: true,
      webPageRead: true,
      remoteCodeExecution: true,
    },
    autoRequestedRemoteCodeExecution: true,
  });
  const downgradedSurface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "google/gemini-2.5-pro",
    pinnedProviderName: "google",
    providerExecutionPlan: providerPlan,
    taskCapabilityContext: {
      requestedCapabilities: ["code.exec"],
      source: "task-text",
      matchedCueLabels: ["calculate"],
    },
    fallbackState: {
      suppressedCandidates: [{
        capabilityId: "code.exec",
        backendKind: "provider-native",
        toolName: REMOTE_CODE_EXECUTE_TOOL_NAME,
        routePhase: "turn-start",
        failureReason: "provider sandbox unavailable",
      }],
    },
  });

  assertEquals(
    REMOTE_CODE_EXECUTE_TOOL_NAME in mergeSdkWebCapabilityTools(
      { [REMOTE_CODE_EXECUTE_TOOL_NAME]: remoteCodeTool },
      { [REMOTE_CODE_EXECUTE_TOOL_NAME]: remoteCodeTool },
      providerPlan,
      downgradedSurface,
    ),
    false,
  );
});

Deno.test("engine sdk: provider-native capability rejection can be mapped back to the selected routed capability", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "google/gemini-2.5-pro",
    pinnedProviderName: "google",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "google",
      allowlist: [REMOTE_CODE_EXECUTE_TOOL_NAME],
      nativeCapabilities: {
        webSearch: true,
        webPageRead: true,
        remoteCodeExecution: true,
      },
      autoRequestedRemoteCodeExecution: true,
    }),
    taskCapabilityContext: {
      requestedCapabilities: ["code.exec"],
      source: "task-text",
      matchedCueLabels: ["calculate"],
    },
  });

  assertEquals(
    resolveProviderNativeRouteFailureFromError({
      executionSurface: surface,
      error:
        new Error("Unsupported tool remote_code_execute for this provider"),
    }),
    {
      capabilityId: "code.exec",
      backendKind: "provider-native",
      toolName: "remote_code_execute",
      routePhase: "turn-start",
      failureReason: "Unsupported tool remote_code_execute for this provider",
    },
  );
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

Deno.test("engine sdk: applyPromptCaching decorates anthropic system, last message, and last tool", () => {
  const messages = convertToSdkMessages([
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Read src/app.ts" },
  ]);
  const defs: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "edit_file",
        description: "Edit a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" }, find: { type: "string" } },
          required: ["path", "find"],
        },
      },
    },
  ];
  const tools = convertToolDefinitionsToSdk(defs)!;
  const decorated = applyPromptCaching(
    {
      providerName: "anthropic",
      modelId: "claude-sonnet",
      providerConfig: null,
    },
    messages,
    tools,
    { anthropic: { thinking: { type: "enabled", budgetTokens: 1000 } } },
    "tool-schema-signature",
    "tool-filter-signature",
  );

  const systemProviderOptions =
    (decorated.messages[0] as Record<string, unknown>)
      .providerOptions as Record<string, unknown>;
  const lastMessageContent = (decorated.messages[1] as Record<string, unknown>)
    .content as Array<Record<string, unknown>>;
  const lastMessagePartOptions = lastMessageContent[0]
    .providerOptions as Record<string, unknown>;
  const lastTool = decorated.tools.edit_file as Record<string, unknown>;

  assertEquals(
    ((systemProviderOptions.anthropic as Record<string, unknown>)
      .cacheControl as Record<string, unknown>).type,
    "ephemeral",
  );
  assertEquals(
    ((lastMessagePartOptions.anthropic as Record<string, unknown>)
      .cacheControl as Record<string, unknown>).type,
    "ephemeral",
  );
  assertEquals(
    ((((lastTool.providerOptions as Record<string, unknown>)
      .anthropic) as Record<string, unknown>).cacheControl as Record<
        string,
        unknown
      >).type,
    "ephemeral",
  );
  assertEquals(
    ((decorated.providerOptions?.anthropic as Record<string, unknown>)
      .thinking as Record<string, unknown>).type,
    "enabled",
  );
});

Deno.test("engine sdk: applyPromptCaching adds stable openai promptCacheKey and preserves provider options", () => {
  const messages = convertToSdkMessages([
    { role: "system", content: "System prompt" },
    { role: "user", content: "Hello" },
  ]);
  const defs: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    },
  ];
  const tools = convertToolDefinitionsToSdk(defs)!;

  const first = applyPromptCaching(
    { providerName: "openai", modelId: "gpt-5", providerConfig: null },
    messages,
    tools,
    { openai: { reasoningEffort: "high" } },
    "tool-schema-signature",
    "tool-filter-signature",
  );
  const second = applyPromptCaching(
    { providerName: "openai", modelId: "gpt-5", providerConfig: null },
    messages,
    tools,
    { openai: { reasoningEffort: "high" } },
    "tool-schema-signature",
    "tool-filter-signature",
  );

  const firstOpenAI = first.providerOptions?.openai as Record<string, unknown>;
  const secondOpenAI = second.providerOptions?.openai as Record<
    string,
    unknown
  >;
  assertEquals(firstOpenAI.promptCacheKey, secondOpenAI.promptCacheKey);
  assertEquals(firstOpenAI.reasoningEffort, "high");
});

Deno.test("engine sdk: malformed tool-call repair unwraps wrapped JSON args", () => {
  assertEquals(
    repairMalformedToolCallInput(
      '{"input":"{\\"path\\":\\"foo.ts\\"}"}',
    ),
    '{"path":"foo.ts"}',
  );
});

Deno.test("engine sdk: repair hook repairs invalid input but ignores unknown tools", async () => {
  const repair = buildToolCallRepairFunction();

  const repaired = await repair({
    system: undefined,
    messages: [],
    toolCall: {
      type: "tool-call",
      toolCallId: "call_1",
      toolName: "read_file",
      input: '{"input":"{\\"path\\":\\"foo.ts\\"}"}',
    },
    tools: {},
    inputSchema: async () => ({
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    }),
    error: new InvalidToolInputError({
      toolName: "read_file",
      toolInput: '{"input":"{\\"path\\":\\"foo.ts\\"}"}',
      cause: new Error("bad input"),
    }),
  });
  const ignored = await repair({
    system: undefined,
    messages: [],
    toolCall: {
      type: "tool-call",
      toolCallId: "call_2",
      toolName: "missing_tool",
      input: '{"path":"foo.ts"}',
    },
    tools: {},
    inputSchema: async () => ({
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    }),
    error: new NoSuchToolError({ toolName: "missing_tool" }),
  });

  assertEquals(repaired?.input, '{"path":"foo.ts"}');
  assertEquals(ignored, null);
});
