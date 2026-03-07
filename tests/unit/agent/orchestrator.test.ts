import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import type { ModelTier } from "../../../src/hlvm/agent/constants.ts";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import {
  executeToolCall,
  executeToolCalls,
  type LLMResponse,
  type LoopConfig,
  type LoopState,
  maybeInjectReminder,
  type OrchestratorConfig,
  processAgentResponse,
  runReActLoop,
  type ToolCall,
} from "../../../src/hlvm/agent/orchestrator.ts";
import { callLLMWithRetry } from "../../../src/hlvm/agent/orchestrator-llm.ts";
import { TOOL_REGISTRY } from "../../../src/hlvm/agent/registry.ts";
import { clearAllL1Confirmations } from "../../../src/hlvm/agent/security/safety.ts";
import { UsageTracker } from "../../../src/hlvm/agent/usage.ts";

const TEST_WORKSPACE = "/tmp/hlvm-test-orchestrator";

type ToolDefinition = (typeof TOOL_REGISTRY)[string];

function resetApprovals(): void {
  clearAllL1Confirmations();
}

function makeResponse(content: string, toolCalls: ToolCall[] = []): LLMResponse {
  return { content, toolCalls };
}

function uniqueToolName(label: string): string {
  return `__orchestrator_test_${label}_${crypto.randomUUID()}`;
}

async function withTemporaryTool<T>(
  name: string,
  tool: ToolDefinition,
  run: (toolName: string) => Promise<T>,
): Promise<T> {
  const previous = TOOL_REGISTRY[name];
  TOOL_REGISTRY[name] = tool;
  try {
    return await run(name);
  } finally {
    if (previous) {
      TOOL_REGISTRY[name] = previous;
    } else {
      delete TOOL_REGISTRY[name];
    }
  }
}

function makeLoopState(overrides: Partial<LoopState> = {}): LoopState {
  return {
    iterations: 0,
    usageTracker: new UsageTracker(),
    denialCountByTool: new Map(),
    totalToolResultBytes: 0,
    toolUses: [],
    groundingRetries: 0,
    noInputRetries: 0,
    toolCallRetries: 0,
    midLoopFormatRetries: 0,
    finalResponseFormatRetries: 0,
    lastToolSignature: "",
    repeatToolCount: 0,
    consecutiveToolFailures: 0,
    emptyResponseRetried: false,
    planState: null,
    lastResponse: "",
    lastToolsIncludedWeb: false,
    iterationsSinceReminder: 3,
    memoryFlushedThisCycle: false,
    memoryRecallInjected: false,
    ...overrides,
  };
}

function makeLoopConfig(overrides: Partial<LoopConfig> = {}): LoopConfig {
  return {
    maxIterations: 50,
    maxDenials: 3,
    llmTimeout: 60_000,
    maxRetries: 3,
    groundingMode: "off",
    llmLimiter: null,
    toolRateLimiter: null,
    maxToolResultBytes: 1_000_000,
    skipCompensation: false,
    maxGroundingRetries: 3,
    noInputEnabled: false,
    maxNoInputRetries: 3,
    requireToolCalls: false,
    maxToolCallRetries: 3,
    maxRepeatToolCalls: 3,
    planningConfig: { mode: "off", requireStepMarkers: false },
    loopDeadline: Date.now() + 600_000,
    totalTimeout: 600_000,
    modelTier: "mid" as ModelTier,
    ...overrides,
  };
}

function makeReminderHarness(): {
  context: ContextManager;
  config: OrchestratorConfig;
} {
  const context = new ContextManager();
  return {
    context,
    config: { workspace: TEST_WORKSPACE, context },
  };
}

Deno.test({
  name: "Orchestrator: executeToolCall executes registered tools and passes AbortSignal",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    let sawSignal = false;
    const toolName = uniqueToolName("signal");

    await withTemporaryTool(
      toolName,
      {
        fn: async (
          args: unknown,
          _workspace: string,
          options?: { signal?: AbortSignal },
        ) => {
          sawSignal = options?.signal instanceof AbortSignal;
          return { echoed: (args as { message: string }).message };
        },
        description: "test tool",
        args: { message: "string" },
        safetyLevel: "L0",
      },
      async () => {
        const result = await executeToolCall(
          { toolName, args: { message: "hello" } },
          { workspace: TEST_WORKSPACE, context, permissionMode: "yolo" },
        );

        assertEquals(result.success, true);
        assertEquals(result.result, { echoed: "hello" });
        assertEquals(sawSignal, true);
      },
    );
  },
});

Deno.test({
  name: "Orchestrator: executeToolCall lazy-loads MCP tools on demand",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    const toolName = `mcp_${uniqueToolName("lazy")}`;
    let ensureCalls = 0;

    try {
      const result = await executeToolCall(
        { toolName, args: { message: "hello" } },
        {
          workspace: TEST_WORKSPACE,
          context,
          permissionMode: "yolo",
          ensureMcpLoaded: async () => {
            ensureCalls += 1;
            TOOL_REGISTRY[toolName] = {
              fn: async (args: unknown) =>
                `echo:${String((args as { message?: unknown }).message ?? "")}`,
              description: "lazy mcp test tool",
              args: { message: "string" },
              safetyLevel: "L0",
            };
          },
        },
      );

      assertEquals(ensureCalls, 1);
      assertEquals(result.success, true);
      assertEquals(result.result, "echo:hello");
    } finally {
      delete TOOL_REGISTRY[toolName];
    }
  },
});

Deno.test({
  name: "Orchestrator: executeToolCall threads todo state into todo tools",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    const todoState = { items: [] };

    const writeResult = await executeToolCall(
      {
        toolName: "todo_write",
        args: {
          items: [{ id: "step-1", content: "Track work", status: "pending" }],
        },
      },
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "yolo",
        todoState,
      },
    );
    const readResult = await executeToolCall(
      { toolName: "todo_read", args: {} },
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "yolo",
        todoState,
      },
    );

    assertEquals(writeResult.success, true);
    assertEquals(readResult.success, true);
    assertEquals(todoState.items.length, 1);
    assertEquals(
      (readResult.result as { items: Array<{ id: string }> }).items[0]?.id,
      "step-1",
    );
  },
});

Deno.test({
  name: "Orchestrator: delegate_agent emits delegate lifecycle events",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    const events: string[] = [];

    const result = await executeToolCall(
      {
        toolName: "delegate_agent",
        args: { agent: "web", task: "Inspect docs" },
      },
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "yolo",
        delegate: async () => ({ agent: "web", result: "done" }),
        onAgentEvent: (event) => events.push(event.type),
      },
    );

    assertEquals(result.success, true);
    assertEquals(events.includes("delegate_start"), true);
    assertEquals(events.includes("delegate_end"), true);
  },
});

Deno.test({
  name: "Orchestrator: executeToolCall rejects unknown and blocked tools",
  async fn() {
    resetApprovals();

    const cases: Array<{
      call: ToolCall;
      config?: Partial<OrchestratorConfig>;
      expected: string;
    }> = [
      {
        call: { toolName: "unknown_tool", args: {} },
        expected: "Unknown tool",
      },
      {
        call: { toolName: "search_code", args: { pattern: "test" } },
        config: { toolAllowlist: ["read_file"] },
        expected: "Tool not allowed",
      },
      {
        call: { toolName: "read_file", args: { path: "README.md" } },
        config: {
          toolAllowlist: ["read_file"],
          toolDenylist: ["read_file"],
        },
        expected: "Tool not allowed",
      },
    ];

    for (const testCase of cases) {
      const result = await executeToolCall(testCase.call, {
        workspace: TEST_WORKSPACE,
        context: new ContextManager(),
        permissionMode: "yolo",
        ...testCase.config,
      });

      assertEquals(result.success, false);
      assertStringIncludes(result.error ?? "", testCase.expected);
    }
  },
});

Deno.test({
  name: "Orchestrator: executeToolCall routes delegate_agent through delegate handler",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    let captured: Record<string, unknown> | null = null;

    const result = await executeToolCall(
      {
        toolName: "delegate_agent",
        args: { agent: "web", task: "test delegation" },
      },
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "yolo",
        delegate: async (args) => {
          captured = args as Record<string, unknown>;
          return { ok: true };
        },
      },
    );

    assertEquals(result.success, true);
    assertEquals(captured?.["agent"], "web");
    assertEquals(captured?.["task"], "test delegation");
    assertStringIncludes(String(result.returnDisplay), '"ok": true');
  },
});

Deno.test({
  name: "Orchestrator: executeToolCall shell_exec preflight blocks complex syntax but allows simple commands",
  async fn() {
    resetApprovals();
    const rejects = [
      "ls | grep foo",
      "echo hi && rm -rf /",
      "echo hello > file.txt",
      "cat < input.txt",
      "echo line >> log.txt",
      "cmd 2>&1",
      "cat << EOF",
    ];

    for (const command of rejects) {
      const result = await executeToolCall(
        { toolName: "shell_exec", args: { command } },
        {
          workspace: TEST_WORKSPACE,
          context: new ContextManager(),
          permissionMode: "yolo",
        },
      );

      assertEquals(result.success, false);
      assertStringIncludes(
        result.error ?? result.llmContent ?? "",
        "shell_exec does not support",
      );
    }

    const allowed = await executeToolCall(
      { toolName: "shell_exec", args: { command: "echo hello world" } },
      {
        workspace: TEST_WORKSPACE,
        context: new ContextManager(),
        permissionMode: "yolo",
      },
    );

    assertEquals(allowed.success, true);
  },
});

Deno.test({
  name: "Orchestrator: executeToolCalls respects continueOnError",
  async fn() {
    resetApprovals();
    const toolName = uniqueToolName("continue");

    await withTemporaryTool(
      toolName,
      {
        fn: async () => "ok",
        description: "test tool",
        args: {},
        safetyLevel: "L0",
      },
      async () => {
        const calls: ToolCall[] = [
          { toolName: "unknown_tool", args: {} },
          { toolName, args: {} },
        ];

        const stopOnError = await executeToolCalls(calls, {
          workspace: TEST_WORKSPACE,
          context: new ContextManager(),
          permissionMode: "yolo",
          continueOnError: false,
        });
        assertEquals(stopOnError.length, 1);
        assertEquals(stopOnError[0].success, false);

        const continueOnError = await executeToolCalls(calls, {
          workspace: TEST_WORKSPACE,
          context: new ContextManager(),
          permissionMode: "yolo",
          continueOnError: true,
        });
        assertEquals(continueOnError.length, 2);
        assertEquals(continueOnError[0].success, false);
        assertEquals(continueOnError[1].success, true);
      },
    );
  },
});

Deno.test({
  name: "Orchestrator: executeToolCalls enforces tool rate limits",
  async fn() {
    resetApprovals();
    const toolName = uniqueToolName("rate_limit");

    await withTemporaryTool(
      toolName,
      {
        fn: async () => "ok",
        description: "test tool",
        args: {},
        safetyLevel: "L0",
      },
      async () => {
        const results = await executeToolCalls(
          [
            { toolName, args: {} },
            { toolName, args: {} },
          ],
          {
            workspace: TEST_WORKSPACE,
            context: new ContextManager(),
            permissionMode: "yolo",
            toolRateLimit: { maxCalls: 1, windowMs: 1000 },
          },
        );

        assertEquals(results.length, 2);
        assertEquals(results[0].success, true);
        assertEquals(results[1].success, false);
        assertStringIncludes(results[1].error ?? "", "rate limit");
      },
    );
  },
});

Deno.test({
  name: "Orchestrator: processAgentResponse records text-only replies and stops",
  async fn() {
    resetApprovals();
    const context = new ContextManager();

    const result = await processAgentResponse(
      makeResponse("Here is my analysis."),
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "yolo",
      },
    );

    assertEquals(result.toolCallsMade, 0);
    assertEquals(result.shouldContinue, false);
    const messages = context.getMessages();
    assertEquals(messages.length, 1);
    assertEquals(messages[0].role, "assistant");
    assertEquals(messages[0].content, "Here is my analysis.");
  },
});

Deno.test({
  name: "Orchestrator: processAgentResponse preserves same-turn tool calls, applies limits, and records tool observations",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    const toolName = uniqueToolName("process_response");

    await withTemporaryTool(
      toolName,
      {
        fn: async (args: unknown) => ({ path: (args as { path: string }).path }),
        description: "test tool",
        args: { path: "string" },
        safetyLevel: "L0",
        skipValidation: true,
      },
      async () => {
        const result = await processAgentResponse(
          makeResponse("Inspecting code.", [
            {
              id: "1",
              toolName,
              args: { path: "src" },
            },
            {
              id: "2",
              toolName,
              args: { path: "src" },
            },
            {
              id: "3",
              toolName,
              args: { path: "tests" },
            },
          ]),
          {
            workspace: TEST_WORKSPACE,
            context,
            permissionMode: "yolo",
            maxToolCalls: 2,
          },
        );

        assertEquals(result.toolCallsMade, 2);
        assertEquals(result.shouldContinue, true);
        assertEquals(result.results[0].success, true);
        assertEquals(result.results[1].success, true);
        const returnedPaths = result.results
          .map((execution) => (execution.result as { path: string }).path)
          .sort();
        assertEquals(returnedPaths, ["src", "src"]);

        const messages = context.getMessages();
        const assistant = messages.findLast((message) => message.role === "assistant");
        assertEquals(assistant?.toolCalls?.length, 2);
        assertEquals(messages.filter((message) => message.role === "tool").length, 2);
      },
    );
  },
});

Deno.test({
  name: "Orchestrator: processAgentResponse assigns tool ids before persistence",
  async fn() {
    clearAllL1Confirmations();

    const context = new ContextManager();
    const result = await processAgentResponse(
      makeResponse("Inspecting code.", [
        { toolName: "search_code", args: { pattern: "test" } },
        { toolName: "search_code", args: { pattern: "other" } },
      ]),
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "yolo",
      },
    );

    assertEquals(result.toolCalls.length, 2);
    assertEquals(result.toolCalls.every((call) => typeof call.id === "string"), true);
    const assistant = context.getMessages().findLast((message) =>
      message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0
    );
    assertEquals(
      assistant?.toolCalls?.every((call) => typeof call.id === "string"),
      true,
    );
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop returns final answers and passes AbortSignal to the LLM",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    let sawSignal = false;

    const result = await runReActLoop(
      "What is the answer?",
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "yolo",
      },
      async (_messages: unknown[], signal?: AbortSignal) => {
        sawSignal = signal instanceof AbortSignal;
        return makeResponse("42");
      },
    );

    assertEquals(result, "42");
    assertEquals(sawSignal, true);
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop rejects text tool-call JSON fallback",
  async fn() {
    resetApprovals();
    const context = new ContextManager();

    const result = await runReActLoop(
      "Find test code",
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "yolo",
        maxToolCallRetries: 1,
      },
      async () =>
        makeResponse('{"toolName":"search_code","args":{"pattern":"test"}}'),
    );

    assertStringIncludes(result, "Native tool calling required");
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop retries transient provider rate limits",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    let calls = 0;

    const result = await runReActLoop(
      "Rate limit task",
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "yolo",
        maxRetries: 2,
      },
      async () => {
        calls += 1;
        if (calls < 2) {
          throw new Error("Rate limit exceeded (429)");
        }
        return makeResponse("done");
      },
    );

    assertEquals(result, "done");
    assertEquals(calls, 2);
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop does not retry AbortError and enforces llm rate limits",
  async fn() {
    resetApprovals();

    let abortCalls = 0;
    await assertRejects(
      () =>
        runReActLoop(
          "Abort task",
          {
            workspace: TEST_WORKSPACE,
            context: new ContextManager(),
            permissionMode: "yolo",
            maxRetries: 3,
          },
          async () => {
            abortCalls += 1;
            const error = new Error("aborted");
            error.name = "AbortError";
            throw error;
          },
        ),
      Error,
    );
    assertEquals(abortCalls, 1);

    const toolName = uniqueToolName("llm_limit");
    await withTemporaryTool(
      toolName,
      {
        fn: async () => "ok",
        description: "test tool",
        args: {},
        safetyLevel: "L0",
      },
      async () => {
        await assertRejects(
          () =>
            runReActLoop(
              "do rate limited run",
              {
                workspace: TEST_WORKSPACE,
                context: new ContextManager(),
                permissionMode: "yolo",
                llmRateLimit: { maxCalls: 1, windowMs: 1000 },
              },
              async () => makeResponse("", [{ toolName, args: {} }]),
            ),
          Error,
          "rate limit",
        );
      },
    );
  },
});

Deno.test({
  name: "Orchestrator: callLLMWithRetry aborts during retry backoff",
  async fn() {
    const controller = new AbortController();
    let calls = 0;
    const startedAt = Date.now();

    const abortTimer = setTimeout(() => controller.abort(), 50);
    try {
      await assertRejects(
        () =>
          callLLMWithRetry(
            async () => {
              calls += 1;
              throw new Error("Rate limit exceeded (429)");
            },
            [],
            { timeout: 2000, maxRetries: 4, signal: controller.signal },
          ),
        Error,
        "aborted",
      );
    } finally {
      clearTimeout(abortTimer);
    }

    assertEquals(calls, 1);
    assertEquals(Date.now() - startedAt < 900, true);
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop narrows the runtime tool filter after tool_search",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    const toolFilterState: { allowlist?: string[]; denylist?: string[] } = {};
    let calls = 0;

    const result = await runReActLoop(
      "Find the right tool",
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "yolo",
        toolFilterState,
      },
      async () => {
        calls += 1;
        if (calls === 1) {
          return makeResponse("", [
            { toolName: "tool_search", args: { query: "read file", limit: 3 } },
          ]);
        }
        return makeResponse("done");
      },
    );

    assertEquals(result, "done");
    assertEquals(toolFilterState.allowlist?.includes("tool_search"), true);
    assertEquals(toolFilterState.allowlist?.includes("read_file"), true);
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop detects repeated tool loops",
  async fn() {
    resetApprovals();
    const context = new ContextManager();

    const result = await runReActLoop(
      "Find something",
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "yolo",
      },
      async () =>
        makeResponse("searching again", [
          { toolName: "search_code", args: { pattern: "test" } },
        ]),
    );

    assertEquals(
      result.includes("Maximum iterations") || result.includes("Tool call loop detected"),
      true,
    );
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop retries context overflow with a trimmed context budget",
  async fn() {
    resetApprovals();
    const context = new ContextManager({
      maxTokens: 3000,
      overflowStrategy: "trim",
      minMessages: 1,
    });
    context.addMessage({ role: "system", content: "sys" });
    for (let i = 0; i < 4; i++) {
      context.addMessage({ role: "user", content: "x".repeat(2000) });
    }

    const seenMessageCounts: number[] = [];
    const result = await runReActLoop(
      "Overflow retry task",
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "yolo",
        maxRetries: 3,
      },
      async (messages: import("../../../src/hlvm/agent/context.ts").Message[]) => {
        seenMessageCounts.push(messages.length);
        if (messages.length > 4) {
          throw new Error("maximum context length is 100 tokens");
        }
        return makeResponse("ok");
      },
    );

    assertEquals(result, "ok");
    assertEquals(seenMessageCounts.length, 2);
    assertEquals(seenMessageCounts[0] > seenMessageCounts[1], true);
    assertEquals(seenMessageCounts[1] <= 4, true);
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop auto-delegates plan steps",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    let calls = 0;
    let delegated = false;

    const result = await runReActLoop(
      "Plan test",
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "yolo",
        groundingMode: "off",
        planning: { mode: "always", requireStepMarkers: true },
        delegate: async () => {
          delegated = true;
          return { note: "delegated" };
        },
      },
      async () => {
        calls += 1;
        if (calls === 1) {
          return makeResponse(`PLAN\n{"goal":"Test","steps":[{"id":"step-1","title":"Research","agent":"web","goal":"Find details"}]}\nEND_PLAN`);
        }
        return makeResponse("Done.\nSTEP_DONE step-1");
      },
    );

    assertEquals(delegated, true);
    assertStringIncludes(result, "Done.");
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop stops after repeated denials and suggests ask_user",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    let calls = 0;

    const result = await runReActLoop(
      "Write a test file",
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "default",
        maxDenials: 2,
        onInteraction: async () => ({ approved: false }),
      },
      async () => {
        calls += 1;
        if (calls <= 2) {
          return makeResponse("Let me write the file.", [
            { toolName: "write_file", args: { path: "test.ts", content: "test" } },
          ]);
        }
        return makeResponse("Clarify with the user via ask_user.");
      },
    );

    assertEquals(calls, 3);
    assertStringIncludes(result, "ask_user");
    const maxDenialsMessage = context.getMessages().find((message) =>
      message.content.includes("Maximum denials (2)")
    );
    assertEquals(maxDenialsMessage !== undefined, true);
    assertStringIncludes(maxDenialsMessage?.content ?? "", "ask_user");
  },
});

Deno.test({
  name: "Orchestrator: maybeInjectReminder enforces cooldown and injects the correct reminder by priority",
  fn() {
    {
      const { config, context } = makeReminderHarness();
      const state = makeLoopState({ iterationsSinceReminder: 0, lastToolsIncludedWeb: true });
      const injected = maybeInjectReminder(state, makeLoopConfig(), config);

      assertEquals(injected, false);
      assertEquals(context.getMessages().length, 0);
      assertEquals(state.iterationsSinceReminder, 1);
    }

    {
      const { config, context } = makeReminderHarness();
      const state = makeLoopState({
        iterations: 7,
        iterationsSinceReminder: 3,
        lastToolsIncludedWeb: true,
      });
      const injected = maybeInjectReminder(
        state,
        makeLoopConfig({ modelTier: "weak" }),
        config,
      );

      assertEquals(injected, true);
      const reminder = context.getMessages().find((message) => message.role === "user");
      assertStringIncludes(reminder?.content ?? "", "web content");
      assertEquals(state.lastToolsIncludedWeb, false);
      assertEquals(state.iterationsSinceReminder, 0);
    }

    {
      const { config, context } = makeReminderHarness();
      const weakPeriodic = maybeInjectReminder(
        makeLoopState({ iterations: 7, iterationsSinceReminder: 3 }),
        makeLoopConfig({ modelTier: "weak" }),
        config,
      );
      assertEquals(weakPeriodic, true);
      assertStringIncludes(context.getMessages()[0]?.content ?? "", "dedicated tools");
    }

    {
      const { config, context } = makeReminderHarness();
      const midPeriodic = maybeInjectReminder(
        makeLoopState({ iterations: 7, iterationsSinceReminder: 3 }),
        makeLoopConfig({ modelTier: "mid" }),
        config,
      );
      assertEquals(midPeriodic, false);
      assertEquals(context.getMessages().length, 0);
    }
  },
});
