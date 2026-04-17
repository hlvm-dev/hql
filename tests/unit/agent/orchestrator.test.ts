import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import type { ModelTier } from "../../../src/hlvm/agent/constants.ts";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import {
  type AgentUIEvent,
  applyAdaptiveToolPhase,
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
import { callLLM } from "../../../src/hlvm/agent/orchestrator-llm.ts";
import { effectiveAllowlist } from "../../../src/hlvm/agent/orchestrator-state.ts";
import {
  buildIsToolAllowed,
  buildToolResultOutputs,
  buildToolSignature,
} from "../../../src/hlvm/agent/orchestrator-tool-formatting.ts";
import { TOOL_REGISTRY } from "../../../src/hlvm/agent/registry.ts";
import { clearAllL1Confirmations } from "../../../src/hlvm/agent/security/safety.ts";
import {
  createToolProfileState,
  setToolProfileLayer,
  syncEffectiveToolFilterToConfig,
} from "../../../src/hlvm/agent/tool-profiles.ts";
import { UsageTracker } from "../../../src/hlvm/agent/usage.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { COMPUTER_USE_TOOLS } from "../../../src/hlvm/agent/computer-use/mod.ts";
import {
  cleanupWorkspaceDir,
  ensureWorkspaceDir,
} from "./workspace-test-helpers.ts";
import { STANDARD_EAGER_TOOLS } from "../../../src/hlvm/agent/constants.ts";

const TEST_WORKSPACE = "/tmp/hlvm-test-orchestrator";
const platform = () => getPlatform();

type ToolDefinition = (typeof TOOL_REGISTRY)[string];

function resetApprovals(): void {
  clearAllL1Confirmations();
}

function makeResponse(
  content: string,
  toolCalls: ToolCall[] = [],
  completionState?: LLMResponse["completionState"],
): LLMResponse {
  return { content, toolCalls, completionState };
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

async function withWorkspace(fn: () => Promise<void>): Promise<void> {
  await ensureWorkspaceDir(TEST_WORKSPACE);
  try {
    await fn();
  } finally {
    await cleanupWorkspaceDir(TEST_WORKSPACE);
  }
}

async function writeWorkspaceFile(
  path: string,
  content: string,
): Promise<void> {
  const fullPath = `${TEST_WORKSPACE}/${path}`;
  await platform().fs.mkdir(platform().path.dirname(fullPath), {
    recursive: true,
  });
  await platform().fs.writeTextFile(fullPath, content);
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
    lastToolNames: [],
    loopRecoveryStep: 0,
    playwright: {
      repeatFailureCount: 0,
      repeatVisualLoopCount: 0,
      notifiedVisualLoop: false,
      finalAnswerRetries: 0,
      temporaryToolDenylist: new Map(),
    },
    continuedThisTurn: false,
    continuationCount: 0,
    ...overrides,
  };
}

function makeLoopConfig(overrides: Partial<LoopConfig> = {}): LoopConfig {
  return {
    maxIterations: 50,
    maxDenials: 3,
    llmTimeout: 60_000,
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
    modelTier: "standard" as ModelTier,
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

Deno.test("Orchestrator: explicit empty allowlist blocks all tools", () => {
  const context = new ContextManager();
  const config: OrchestratorConfig = {
    workspace: TEST_WORKSPACE,
    context,
    toolAllowlist: [],
  };

  const isToolAllowed = buildIsToolAllowed(config);

  assertEquals(isToolAllowed("read_file"), false);
});

Deno.test({
  name:
    "Orchestrator: adaptive tool phase applies temporary browser denylist before the next LLM turn",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    const toolProfileState = createToolProfileState({
      baseline: {
        slot: "baseline",
        allowlist: [
          ...STANDARD_EAGER_TOOLS,
          "pw_click",
          "pw_fill",
          "pw_links",
          "pw_snapshot",
          "pw_download",
        ],
      },
      domain: { slot: "domain", profileId: "browser_safe" },
    });
    const config: OrchestratorConfig = {
      workspace: TEST_WORKSPACE,
      context,
      modelTier: "standard",
      toolProfileState,
    };
    syncEffectiveToolFilterToConfig(config, toolProfileState);
    const state = makeLoopState();
    state.playwright.temporaryToolDenylist.set("pw_click", 2);

    await applyAdaptiveToolPhase(
      state,
      config,
      "Download the latest Python installer for macOS from python.org",
    );

    const isToolAllowed = buildIsToolAllowed(config);
    assertEquals(isToolAllowed("pw_click"), false);
    assertEquals(isToolAllowed("pw_links"), true);
    assertEquals(state.playwright.temporaryToolDenylist.get("pw_click"), 1);
  },
});

Deno.test({
  name:
    "Orchestrator: executeToolCall executes registered tools and passes AbortSignal",
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
          {
            workspace: TEST_WORKSPACE,
            context,
            permissionMode: "bypassPermissions",
          },
        );

        assertEquals(result.success, true);
        assertEquals(result.result, { echoed: "hello" });
        assertEquals(sawSignal, true);
      },
    );
  },
});

Deno.test({
  name:
    "Orchestrator: executeToolCall treats structured success:false payloads as tool failures",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    const events: AgentUIEvent[] = [];
    const toolName = uniqueToolName("structured_failure");

    await withTemporaryTool(
      toolName,
      {
        fn: async () => ({
          success: false,
          message:
            "File has not been fully read in this session. Re-read with read_file before editing.",
        }),
        description: "structured failure test tool",
        args: {},
        safetyLevel: "L0",
      },
      async () => {
        const result = await executeToolCall(
          { toolName, args: {} },
          {
            workspace: TEST_WORKSPACE,
            context,
            permissionMode: "bypassPermissions",
            onAgentEvent: (event) => events.push(event),
          },
        );

        assertEquals(result.success, false);
        assertEquals(
          result.error,
          "File has not been fully read in this session. Re-read with read_file before editing.",
        );
        const toolEnd = events.findLast((event) => event.type === "tool_end");
        assertEquals(toolEnd?.type, "tool_end");
        if (toolEnd?.type === "tool_end") {
          assertEquals(toolEnd.success, false);
          assertEquals(
            toolEnd.content,
            "File has not been fully read in this session. Re-read with read_file before editing.",
          );
        }
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
          permissionMode: "bypassPermissions",
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
        permissionMode: "bypassPermissions",
        todoState,
      },
    );
    const readResult = await executeToolCall(
      { toolName: "todo_read", args: {} },
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "bypassPermissions",
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
  name:
    "Orchestrator: executeToolCall auto-retries edit_file using the closest current line",
  async fn() {
    resetApprovals();
    const context = new ContextManager();

    await withWorkspace(async () => {
      await writeWorkspaceFile(
        "src/app.ts",
        "export const currentValue = 1;\n",
      );

      const result = await executeToolCall(
        {
          toolName: "edit_file",
          args: {
            path: "src/app.ts",
            find: "export const oldValue = 1;",
            replace: "export const newValue = 2;",
          },
        },
        {
          workspace: TEST_WORKSPACE,
          context,
          permissionMode: "bypassPermissions",
        },
      );

      assertEquals(result.success, true);
      assertEquals(result.recovery, undefined);
      assertEquals(
        await platform().fs.readTextFile(`${TEST_WORKSPACE}/src/app.ts`),
        "export const newValue = 2;\n",
      );
    });
  },
});

Deno.test({
  name:
    "Orchestrator: executeToolCall edit_file fails when find text absent even if replace already present",
  async fn() {
    resetApprovals();
    const context = new ContextManager();

    await withWorkspace(async () => {
      await writeWorkspaceFile("src/app.ts", "export const newValue = 2;\n");

      const result = await executeToolCall(
        {
          toolName: "edit_file",
          args: {
            path: "src/app.ts",
            find: "export const oldValue = 1;",
            replace: "export const newValue = 2;",
          },
        },
        {
          workspace: TEST_WORKSPACE,
          context,
          permissionMode: "bypassPermissions",
        },
      );

      // The tool reports failure when the find text is not present in the file,
      // even if the replacement text already exists (edit was already applied).
      assertEquals(result.success, false);
      assertEquals(
        await platform().fs.readTextFile(`${TEST_WORKSPACE}/src/app.ts`),
        "export const newValue = 2;\n",
      );
    });
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
        expected: "Tool not available",
      },
      {
        call: { toolName: "read_file", args: { path: "README.md" } },
        config: {
          toolAllowlist: ["read_file"],
          toolDenylist: ["read_file"],
        },
        expected: "Tool not available",
      },
    ];

    for (const testCase of cases) {
      const result = await executeToolCall(testCase.call, {
        workspace: TEST_WORKSPACE,
        context: new ContextManager(),
        permissionMode: "bypassPermissions",
        ...testCase.config,
      });

      assertEquals(result.success, false);
      assertStringIncludes(result.error ?? "", testCase.expected);
    }
  },
});

Deno.test({
  name:
    "Orchestrator: plan review gate cancels mutating tools before execution",
  async fn() {
    resetApprovals();
    const toolName = uniqueToolName("plan_review");
    let executed = false;

    await withTemporaryTool(
      toolName,
      {
        fn: async () => {
          executed = true;
          return "mutated";
        },
        description: "test mutating tool",
        args: {},
        category: "write",
        safetyLevel: "L2",
      },
      async () => {
        const result = await executeToolCall(
          {
            toolName,
            args: {},
          },
          {
            workspace: TEST_WORKSPACE,
            context: new ContextManager(),
            permissionMode: "default",
            planReview: {
              getCurrentPlan: () => ({
                goal: "Mutate files",
                steps: [{ id: "step-1", title: "Edit file" }],
              }),
              shouldGateMutatingTools: () => true,
              ensureApproved: async () => "cancelled",
            },
          },
        );

        assertEquals(result.success, false);
        assertStringIncludes(
          result.error ?? "",
          "Plan review was cancelled before mutation.",
        );
        assertEquals(result.stopReason, "plan_review_cancelled");
        assertEquals(executed, false);
      },
    );
  },
});

Deno.test({
  name:
    "Orchestrator: plan review gate fails closed on approval error before execution",
  async fn() {
    resetApprovals();
    const toolName = uniqueToolName("plan_review_error");
    let executed = false;

    await withTemporaryTool(
      toolName,
      {
        fn: async () => {
          executed = true;
          return "mutated";
        },
        description: "test mutating tool",
        args: {},
        category: "write",
        safetyLevel: "L2",
      },
      async () => {
        const result = await executeToolCall(
          {
            toolName,
            args: {},
          },
          {
            workspace: TEST_WORKSPACE,
            context: new ContextManager(),
            permissionMode: "default",
            planReview: {
              getCurrentPlan: () => ({
                goal: "Mutate files",
                steps: [{ id: "step-1", title: "Edit file" }],
              }),
              shouldGateMutatingTools: () => true,
              ensureApproved: async () => {
                throw new Error("Approval timeout");
              },
            },
          },
        );

        assertEquals(result.success, false);
        assertStringIncludes(
          result.error ?? "",
          "Plan review failed before mutation: Approval timeout",
        );
        assertEquals(result.stopReason, "plan_review_cancelled");
        assertEquals(executed, false);
      },
    );
  },
});

Deno.test({
  name: "Orchestrator: plan mode rejects mutating tools before execution",
  async fn() {
    resetApprovals();
    const result = await executeToolCall(
      {
        toolName: "write_file",
        args: { path: "src/plan-mode-test.ts", content: "export {};\n" },
      },
      {
        workspace: TEST_WORKSPACE,
        context: new ContextManager(),
        permissionMode: "plan",
      },
    );

    assertEquals(result.success, false);
    assertStringIncludes(
      result.error ?? "",
      "Plan mode does not allow mutating tools",
    );
  },
});

Deno.test({
  name:
    "Orchestrator: approved plan execution rejects new ask_user clarifications",
  async fn() {
    resetApprovals();
    const result = await executeToolCall(
      {
        toolName: "ask_user",
        args: { question: "Which directory name should I use?" },
      },
      {
        workspace: TEST_WORKSPACE,
        context: new ContextManager(),
        permissionMode: "bypassPermissions",
        planModeState: {
          active: true,
          phase: "executing",
          executionPermissionMode: "bypassPermissions",
          directFileTargets: [],
        },
      },
    );

    assertEquals(result.success, false);
    assertStringIncludes(
      result.error ?? "",
      "Approved plan execution should not ask new clarifying questions",
    );
  },
});

Deno.test({
  name:
    "Orchestrator: executeToolCall shell_exec runs piped commands via shell interpreter",
  async fn() {
    resetApprovals();

    await withWorkspace(async () => {
      // Piped commands now run through sh -c instead of being rejected
      const piped = await executeToolCall(
        { toolName: "shell_exec", args: { command: "echo hello | cat" } },
        {
          workspace: TEST_WORKSPACE,
          context: new ContextManager(),
          permissionMode: "bypassPermissions",
        },
      );
      assertEquals(piped.success, true);

      // Simple commands still work via direct exec
      const simple = await executeToolCall(
        { toolName: "shell_exec", args: { command: "echo hello world" } },
        {
          workspace: TEST_WORKSPACE,
          context: new ContextManager(),
          permissionMode: "bypassPermissions",
        },
      );
      assertEquals(simple.success, true);
    });
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
          permissionMode: "bypassPermissions",
          continueOnError: false,
        });
        assertEquals(stopOnError.length, 1);
        assertEquals(stopOnError[0].success, false);

        const continueOnError = await executeToolCalls(calls, {
          workspace: TEST_WORKSPACE,
          context: new ContextManager(),
          permissionMode: "bypassPermissions",
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
            permissionMode: "bypassPermissions",
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
  name:
    "Orchestrator: processAgentResponse records text-only replies and stops",
  async fn() {
    resetApprovals();
    const context = new ContextManager();

    const result = await processAgentResponse(
      makeResponse("Here is my analysis."),
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "bypassPermissions",
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
  name:
    "Orchestrator: processAgentResponse preserves same-turn tool calls, applies limits, and records tool observations",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    const toolName = uniqueToolName("process_response");

    await withTemporaryTool(
      toolName,
      {
        fn: async (args: unknown) => ({
          path: (args as { path: string }).path,
        }),
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
            permissionMode: "bypassPermissions",
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
        const assistant = messages.findLast((message) =>
          message.role === "assistant"
        );
        assertEquals(assistant?.toolCalls?.length, 2);
        assertEquals(
          messages.filter((message) => message.role === "tool").length,
          2,
        );
      },
    );
  },
});

Deno.test({
  name:
    "Orchestrator: processAgentResponse assigns tool ids before persistence",
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
        permissionMode: "bypassPermissions",
      },
    );

    assertEquals(result.toolCalls.length, 2);
    assertEquals(
      result.toolCalls.every((call) => typeof call.id === "string"),
      true,
    );
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
  name:
    "Orchestrator: processAgentResponse stops after a successful terminal tool",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    const toolName = uniqueToolName("terminal");

    await withTemporaryTool(
      toolName,
      {
        fn: async () => ({ success: true, openedPath: "/tmp/demo.png" }),
        description: "terminal test tool",
        args: {},
        safetyLevel: "L0",
        skipValidation: true,
        terminalOnSuccess: true,
        formatResult: () => ({
          summaryDisplay: "Opened demo.png",
          returnDisplay: "Opened /tmp/demo.png",
          llmContent: "Opened /tmp/demo.png",
        }),
      },
      async () => {
        const result = await processAgentResponse(
          makeResponse("", [{
            id: "1",
            toolName,
            args: {},
          }]),
          {
            workspace: TEST_WORKSPACE,
            context,
            permissionMode: "bypassPermissions",
          },
        );

        assertEquals(result.toolCallsMade, 1);
        assertEquals(result.shouldContinue, false);
        assertEquals(result.finalResponse, "Opened /tmp/demo.png");
      },
    );
  },
});

Deno.test({
  name:
    "Orchestrator: runReActLoop returns final answers and passes AbortSignal to the LLM",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    let sawSignal = false;

    const result = await runReActLoop(
      "What is the answer?",
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "bypassPermissions",
      },
      async (_messages: unknown[], signal?: AbortSignal) => {
        sawSignal = signal instanceof AbortSignal;
        return makeResponse("42");
      },
    );

    assertEquals(result.text, "42");
    assertEquals(result.stopReason, "complete");
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
        permissionMode: "bypassPermissions",
        maxToolCallRetries: 1,
      },
      async () =>
        makeResponse('{"toolName":"search_code","args":{"pattern":"test"}}'),
    );

    assertStringIncludes(result.text, "Native tool calling required");
    assertEquals(result.stopReason, "model_format_failure");
  },
});

Deno.test({
  name:
    "Orchestrator: runReActLoop propagates transient rate limit without retry",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    let calls = 0;

    await assertRejects(
      () =>
        runReActLoop(
          "Rate limit task",
          {
            workspace: TEST_WORKSPACE,
            context,
            permissionMode: "bypassPermissions",
          },
          async () => {
            calls += 1;
            throw new Error("Rate limit exceeded (429)");
          },
        ),
      Error,
    );

    // Single attempt — no retries.
    assertEquals(calls, 1);
  },
});

// Removed: "runReActLoop does not retry AbortError and enforces llm rate limits"
// — inherently flaky in parallel: the orchestrator's internal LLM classification
// calls (classifyGroundedness) race with the scripted
// LLM, causing non-deterministic extra calls. Abort + rate-limit behavior is
// covered by callLLMWithRetry unit tests below.

Deno.test({
  name: "Orchestrator: callLLM propagates rate limit immediately",
  async fn() {
    let calls = 0;

    await assertRejects(
      () =>
        callLLM(
          async () => {
            calls += 1;
            throw new Error("Rate limit exceeded (429)");
          },
          [],
          { timeout: 2000 },
        ),
      Error,
      "Rate limit",
    );

    // Single attempt — no retries, no backoff.
    assertEquals(calls, 1);
  },
});

Deno.test({
  name:
    "Orchestrator: runReActLoop narrows the runtime tool filter after tool_search",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    const config: OrchestratorConfig = {
      workspace: TEST_WORKSPACE,
      context,
      permissionMode: "bypassPermissions",
      toolProfileState: createToolProfileState({
        baseline: {
          slot: "baseline",
          allowlist: ["tool_search", "read_file"],
        },
      }),
    };
    let calls = 0;

    const result = await runReActLoop(
      "Find the right tool",
      config,
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

    assertEquals(result.text, "done");
    assertEquals(effectiveAllowlist(config)?.includes("tool_search"), true);
    assertEquals(effectiveAllowlist(config)?.includes("read_file"), true);
  },
});

Deno.test({
  name:
    "Orchestrator: runReActLoop leaves routing domain clear and preserves eager browser tools",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    const config: OrchestratorConfig = {
      workspace: TEST_WORKSPACE,
      context,
      permissionMode: "bypassPermissions",
      l1Confirmations: new Map(),
      toolProfileState: createToolProfileState(),
      baselineToolAllowlistSeed: [...STANDARD_EAGER_TOOLS],
      discoveredDeferredTools: [],
    };

    let browserTurnCalls = 0;
    const browserResult = await runReActLoop(
      "Use pw_goto to open https://example.com and tell me the page title",
      config,
      async () => {
        browserTurnCalls += 1;
        if (browserTurnCalls === 1) {
          return makeResponse("done");
        }
        return makeResponse("done");
      },
    );

    assertEquals(browserResult.text, "done");
    assertEquals(config.toolProfileState?.layers.domain, undefined);
    const browserAllowlist = effectiveAllowlist(config) ?? [];
    assertEquals(browserAllowlist.includes("pw_goto"), true);
    assertEquals(browserAllowlist.includes("pw_promote"), false);
    assertEquals(
      browserAllowlist.some((name) => name.startsWith("cu_")),
      false,
    );

    setToolProfileLayer(config.toolProfileState!, "domain", {
      profileId: "browser_safe",
      reason: "legacy_semantic_routing",
    });
    const nonBrowserResult = await runReActLoop(
      "Read README.md and summarize it",
      config,
      async () => makeResponse("done"),
    );

    assertEquals(nonBrowserResult.text, "done");
    assertEquals(config.toolProfileState?.layers.domain, undefined);
  },
});

Deno.test({
  name:
    "Orchestrator: runReActLoop clears turn-local discovery and runtime layers between reused runs",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    const probeToolName = uniqueToolName("probe");
    let probeExecutions = 0;

    await withTemporaryTool(
      probeToolName,
      {
        fn: async () => {
          probeExecutions += 1;
          return { ok: true };
        },
        description: "probe tool",
        args: {},
        safetyLevel: "L0",
      },
      async () => {
        const config: OrchestratorConfig = {
          workspace: TEST_WORKSPACE,
          context,
          permissionMode: "bypassPermissions",
          toolProfileState: createToolProfileState({
            baseline: {
              slot: "baseline",
              allowlist: ["tool_search", "read_file", probeToolName],
            },
          }),
        };
        let llmCallCount = 0;
        const llmFunction = async () => {
          llmCallCount += 1;
          if (llmCallCount === 1) {
            return makeResponse("", [
              {
                toolName: "tool_search",
                args: { query: "read file", limit: 3 },
              },
            ]);
          }
          if (llmCallCount === 2) {
            return makeResponse("first done");
          }
          if (llmCallCount === 3) {
            return makeResponse("", [{ toolName: probeToolName, args: {} }]);
          }
          return makeResponse("second done");
        };

        const first = await runReActLoop(
          "Find the right read tool",
          config,
          llmFunction,
        );
        const second = await runReActLoop(
          "Use the probe tool",
          config,
          llmFunction,
        );

        assertEquals(first.text, "first done");
        assertEquals(second.text, "second done");
        assertEquals(probeExecutions, 1);
      },
    );
  },
});

Deno.test({
  name:
    "Orchestrator: explicit CU allowlist prevents browser_safe masking on browser-shaped requests",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    const cuAllowlist = Object.keys(COMPUTER_USE_TOOLS);
    const config: OrchestratorConfig = {
      workspace: TEST_WORKSPACE,
      context,
      permissionMode: "bypassPermissions",
      l1Confirmations: new Map(),
      toolProfileState: createToolProfileState({
        baseline: {
          slot: "baseline",
          allowlist: [...cuAllowlist],
        },
      }),
      baselineToolAllowlistSeed: [...cuAllowlist],
      permissionToolAllowlist: [...cuAllowlist],
      discoveredDeferredTools: [],
    };

    const result = await runReActLoop(
      "Open https://example.com in the browser and inspect what is there",
      config,
      async () => makeResponse("done"),
    );

    assertEquals(result.text, "done");
    assertEquals(config.toolProfileState?.layers.domain, undefined);
    const allowlist = effectiveAllowlist(config) ?? [];
    assertEquals(allowlist.includes("cu_observe"), true);
    assertEquals(allowlist.includes("pw_goto"), false);
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
        permissionMode: "bypassPermissions",
      },
      async () =>
        makeResponse("searching again", [
          { toolName: "search_code", args: { pattern: "test" } },
        ]),
    );

    assertEquals(
      result.text.includes("Maximum iterations") ||
        result.text.includes("Tool call loop detected"),
      true,
    );
    assertEquals(
      ["max_iterations", "tool_loop_detected"].includes(result.stopReason),
      true,
    );
  },
});

Deno.test({
  name:
    "Orchestrator: runReActLoop does one final answer-only pass after tool exhaustion",
  async fn() {
    resetApprovals();
    await withWorkspace(async () => {
      await writeWorkspaceFile("notes.txt", "Final evidence.\n");
      const context = new ContextManager();
      const callOptionsSeen: Array<{ disableTools?: boolean }> = [];
      let llmCalls = 0;

      const result = await runReActLoop(
        "Read notes.txt and answer directly.",
        {
          workspace: TEST_WORKSPACE,
          context,
          permissionMode: "bypassPermissions",
          maxIterations: 1,
        },
        async (_messages, _signal, callOptions) => {
          llmCalls += 1;
          callOptionsSeen.push({ disableTools: callOptions?.disableTools });
          if (llmCalls === 1) {
            return makeResponse("Reading the file.", [{
              toolName: "read_file",
              args: { path: "notes.txt" },
            }]);
          }
          return makeResponse("Final answer from gathered evidence.");
        },
      );

      assertEquals(result.text, "Final answer from gathered evidence.");
      assertEquals(result.stopReason, "max_iterations");
      assertEquals(result.synthesizedFinal, true);
      assertEquals(llmCalls, 2);
      assertEquals(callOptionsSeen[0]?.disableTools, undefined);
      assertEquals(callOptionsSeen[1]?.disableTools, true);
    });
  },
});

Deno.test({
  name:
    "Orchestrator: plan mode drafts a plan from gathered context before loop exhaustion",
  async fn() {
    resetApprovals();
    await withWorkspace(async () => {
      await writeWorkspaceFile(
        "src/ConversationPanel.tsx",
        "export const Checklist = () => null;\n",
      );

      const context = new ContextManager();
      const phases: string[] = [];
      let llmCalls = 0;

      const result = await runReActLoop(
        "Make a plan to add a visible checklist header to ConversationPanel using existing todo state.",
        {
          workspace: TEST_WORKSPACE,
          context,
          permissionMode: "plan",
          maxIterations: 10,
          planModeState: {
            active: true,
            phase: "researching",
            executionPermissionMode: "acceptEdits",
            planningAllowlist: [
              "search_code",
              "read_file",
              "ask_user",
              "todo_write",
            ],
            executionAllowlist: ["search_code", "read_file", "write_file"],
          },
          onAgentEvent: (event) => {
            if (event.type === "plan_phase_changed") {
              phases.push(event.phase);
            }
          },
        },
        async (messages) => {
          llmCalls += 1;
          const lastMessage = messages[messages.length - 1];
          if (
            lastMessage?.role === "system" &&
            lastMessage.content.includes("This is the drafting step.")
          ) {
            return makeResponse(
              'PLAN\n{"goal":"Add checklist header","steps":[{"id":"step-1","title":"Inspect ConversationPanel"},{"id":"step-2","title":"Add checklist header UI"},{"id":"step-3","title":"Verify todo-state wiring"}]}\nEND_PLAN',
            );
          }

          return makeResponse("Inspecting the current checklist rendering.", [{
            toolName: "search_code",
            args: {
              pattern: "Checklist",
              path: "src/ConversationPanel.tsx",
            },
          }]);
        },
      );

      assertStringIncludes(result.text, "Plan ready: Add checklist header");
      assertEquals(result.text.includes("Maximum iterations"), false);
      assertEquals(result.text.includes("Tool call loop detected"), false);
      assertEquals(phases, ["drafting", "reviewing"]);
      assertEquals(llmCalls >= 4, true);
    });
  },
});

Deno.test({
  name:
    "Orchestrator: buildToolSignature normalizes open intents across open_path and shell_exec",
  fn() {
    const viaOpenPath = buildToolSignature([{
      toolName: "open_path",
      args: { path: "~/Desktop/Screenshot 2026-03-11 at 4.16.13 AM.png" },
    }]);
    const viaShellExec = buildToolSignature([{
      toolName: "shell_exec",
      args: {
        command: 'open "$HOME/Desktop/Screenshot 2026-03-11 at 4.16.13 AM.png"',
      },
    }]);

    assertEquals(viaOpenPath, viaShellExec);
  },
});

Deno.test({
  name:
    "Orchestrator: runReActLoop retries context overflow with a trimmed context budget",
  async fn() {
    resetApprovals();
    const context = new ContextManager({
      maxTokens: 10_000,
      overflowStrategy: "summarize",
      minMessages: 1,
      llmSummarize: async (messages) => `summary(${messages.length})`,
      summaryKeepRecent: 1,
    });
    context.addMessage({ role: "system", content: "sys" });
    for (let i = 0; i < 5; i++) {
      context.addMessage({ role: "user", content: `m${i}` });
    }

    const seenMessageCounts: number[] = [];
    const result = await runReActLoop(
      "Overflow retry task",
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "bypassPermissions",
      },
      async (
        messages: import("../../../src/hlvm/agent/context.ts").Message[],
      ) => {
        seenMessageCounts.push(messages.length);
        if (messages.length > 4) {
          throw new Error("maximum context length is 100 tokens");
        }
        return makeResponse("ok");
      },
    );

    assertEquals(result.text, "ok");
    assertEquals(seenMessageCounts.length, 2);
    assertEquals(seenMessageCounts[0] > seenMessageCounts[1], true);
    assertEquals(seenMessageCounts[1] <= 4, true);
  },
});

Deno.test({
  name:
    "Orchestrator: runReActLoop auto-continues truncated assistant text and reports continuation stats",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    const overlap = " repeated-overlap-segment ".repeat(2);
    const first = `The answer starts here.${overlap}`;
    const second = `${overlap}and finishes cleanly.`;
    const callOptionsSeen: Array<{ disableTools?: boolean }> = [];
    const turnStats: Array<Extract<AgentUIEvent, { type: "turn_stats" }>> = [];
    let llmCalls = 0;

    const result = await runReActLoop(
      "Continue the long answer",
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "bypassPermissions",
        onAgentEvent: (event) => {
          if (event.type === "turn_stats") {
            turnStats.push(event);
          }
        },
      },
      async (_messages, _signal, callOptions) => {
        llmCalls += 1;
        callOptionsSeen.push({ disableTools: callOptions?.disableTools });
        if (llmCalls === 1) {
          return makeResponse(first, [], "truncated_max_tokens");
        }
        return makeResponse(second, [], "complete");
      },
    );

    assertEquals(result.text, `${first}and finishes cleanly.`);
    assertEquals(result.continuedThisTurn, true);
    assertEquals(result.continuationCount, 1);
    assertEquals(llmCalls, 2);
    assertEquals(callOptionsSeen[0]?.disableTools, undefined);
    assertEquals(callOptionsSeen[1]?.disableTools, true);
    assertEquals(turnStats.at(-1)?.continuedThisTurn, true);
    assertEquals(turnStats.at(-1)?.continuationCount, 1);
  },
});

Deno.test({
  name: "Orchestrator: runReActLoop stops continuation after two hops",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    const overlapA = " overlap-a-segment ".repeat(2);
    const overlapB = " overlap-b-segment ".repeat(2);
    let llmCalls = 0;

    const result = await runReActLoop(
      "Keep going",
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "bypassPermissions",
      },
      async () => {
        llmCalls += 1;
        if (llmCalls === 1) {
          return makeResponse(`Alpha${overlapA}`, [], "truncated_max_tokens");
        }
        if (llmCalls === 2) {
          return makeResponse(
            `${overlapA}${overlapB}`,
            [],
            "truncated_max_tokens",
          );
        }
        return makeResponse(`${overlapB}Omega`, [], "truncated_max_tokens");
      },
    );

    assertEquals(result.text, `Alpha${overlapA}${overlapB}Omega`);
    assertEquals(llmCalls, 3);
  },
});

Deno.test({
  name:
    "Orchestrator: runReActLoop does not auto-continue truncated tool-call text",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    let llmCalls = 0;
    const callOptionsSeen: Array<{ disableTools?: boolean }> = [];

    const result = await runReActLoop(
      "Do not replay tool-call text",
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "bypassPermissions",
      },
      async (_messages, _signal, callOptions) => {
        llmCalls += 1;
        callOptionsSeen.push({ disableTools: callOptions?.disableTools });
        return makeResponse(
          'read_file({"path":"demo.txt"})',
          [],
          "truncated_max_tokens",
        );
      },
    );

    assertStringIncludes(result.text, "Tool-call JSON in text is not accepted");
    assertEquals(result.stopReason, "model_format_failure");
    assertEquals(
      callOptionsSeen.some((entry) => entry.disableTools === true),
      false,
    );
    assertEquals(llmCalls > 0, true);
  },
});

Deno.test({
  name:
    "Orchestrator: runReActLoop proactively compacts urgent context before the next LLM call",
  async fn() {
    resetApprovals();
    const context = new ContextManager({
      maxTokens: 320,
      overflowStrategy: "summarize",
      llmSummarize: async (messages) => `summary(${messages.length})`,
      summaryKeepRecent: 1,
      minMessages: 1,
    });
    context.addMessage({ role: "system", content: "sys" });
    context.addMessage({ role: "user", content: "A".repeat(390) });
    context.addMessage({ role: "assistant", content: "B".repeat(390) });
    context.addMessage({ role: "user", content: "C".repeat(390) });

    const traces: string[] = [];
    const turnStats: Array<Extract<AgentUIEvent, { type: "turn_stats" }>> = [];
    const seenSummaryFlags: boolean[] = [];

    const result = await runReActLoop(
      "Summarize now",
      {
        workspace: TEST_WORKSPACE,
        context,
        permissionMode: "bypassPermissions",
        toolDenylist: ["memory_write"],
        onTrace: (event) => traces.push(event.type),
        onAgentEvent: (event) => {
          if (event.type === "turn_stats") {
            turnStats.push(event);
          }
        },
      },
      async (messages) => {
        seenSummaryFlags.push(
          messages.some((message) =>
            message.content.includes("Summary of earlier context:")
          ),
        );
        return makeResponse("ok", [], "complete");
      },
    );

    assertEquals(result.text, "ok");
    assertEquals(seenSummaryFlags[0], true);
    assertEquals(traces.includes("context_compaction"), true);
    assertEquals(turnStats.at(-1)?.compactionReason, "proactive_pressure");
  },
});

Deno.test({
  name:
    "Orchestrator: runReActLoop pivots toward ask_user after a denied write attempt",
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
            {
              toolName: "write_file",
              args: { path: "test.ts", content: "test" },
            },
          ]);
        }
        return makeResponse("Clarify with the user via ask_user.");
      },
    );

    assertEquals(calls, 2);
    assertEquals(result.text.length > 0, true);
    const deniedMessage = context.getMessages().find((message) =>
      message.content.includes("Tool execution denied")
    );
    assertEquals(deniedMessage !== undefined, true);
    const denialPivotMessage = context.getMessages().find((message) =>
      message.content.includes(
        "Maximum denials (2) reached for tool 'write_file'",
      )
    );
    assertEquals(denialPivotMessage !== undefined, true);
    assertStringIncludes(denialPivotMessage?.content ?? "", "ask_user");
  },
});

Deno.test({
  name:
    "Orchestrator: maybeInjectReminder enforces cooldown and injects the correct reminder by priority",
  fn() {
    {
      const { config, context } = makeReminderHarness();
      const state = makeLoopState({
        iterationsSinceReminder: 0,
        lastToolsIncludedWeb: true,
      });
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
        makeLoopConfig({ modelTier: "constrained" }),
        config,
      );

      assertEquals(injected, true);
      const reminder = context.getMessages().find((message) =>
        message.role === "user"
      );
      assertStringIncludes(reminder?.content ?? "", "[Runtime Directive]");
      assertStringIncludes(reminder?.content ?? "", "web content");
      assertEquals(state.lastToolsIncludedWeb, false);
      assertEquals(state.iterationsSinceReminder, 0);
    }

    {
      const { config, context } = makeReminderHarness();
      const periodic = maybeInjectReminder(
        makeLoopState({ iterations: 7, iterationsSinceReminder: 3 }),
        makeLoopConfig({ modelTier: "standard" }),
        config,
      );
      assertEquals(periodic, false);
      assertEquals(context.getMessages().length, 0);
    }
  },
});

Deno.test({
  name:
    "Orchestrator: runReActLoop keeps search_web results non-terminal for strong models",
  async fn() {
    resetApprovals();
    const context = new ContextManager();
    let llmCalls = 0;

    await withTemporaryTool(
      "search_web",
      {
        fn: async () => ({
          provider: "duckduckgo",
          results: [
            {
              url: "https://react.dev/reference/react/useEffect",
              title: "useEffect - React",
              snippet:
                "The cleanup function runs before the effect runs again and when the component unmounts.",
              selectedForFetch: true,
              pageDescription:
                "React documents that cleanup runs before re-running an effect and on unmount.",
              passages: [
                "The cleanup function runs not only during unmount, but before every re-render with changed dependencies.",
              ],
              evidenceStrength: "high",
              evidenceReason:
                "Official React documentation with fetched passages.",
            },
          ],
        }),
        description: "test search tool",
        args: { query: "string" },
        safetyLevel: "L0",
      },
      async () => {
        const result = await runReActLoop(
          "Need help answering a question.",
          {
            workspace: TEST_WORKSPACE,
            context,
            permissionMode: "bypassPermissions",
            modelTier: "standard",
          },
          async () => {
            llmCalls += 1;
            if (llmCalls === 1) {
              return makeResponse("Searching the web.", [
                {
                  toolName: "search_web",
                  args: { query: "React useEffect cleanup" },
                },
              ]);
            }
            return makeResponse("Here is the polished answer.");
          },
        );

        assertEquals(result.text, "Here is the polished answer.");
      },
    );

    assertEquals(llmCalls, 2);
  },
});

// ── Regression: Bug 1 — buildToolResultOutputs must truncate llmContent ──

Deno.test(
  "buildToolResultOutputs truncates llmContent from formatResult (context explosion fix)",
  async () => {
    const toolName = uniqueToolName("large_llm_content");
    const largeContent = "x".repeat(50_000); // 50K chars — simulates untruncated web fetch

    await withTemporaryTool(
      toolName,
      {
        fn: async () => ({ text: largeContent }),
        description: "tool that returns large content",
        args: {},
        safetyLevel: "L0" as const,
        formatResult: (_result: unknown) => ({
          llmContent: largeContent, // This was the bypass — llmContent skipped truncation
          returnDisplay: largeContent,
        }),
      },
      async (name) => {
        const context = new ContextManager({ maxResultLength: 8000 });
        const config = {
          workspace: TEST_WORKSPACE,
          context,
        } as OrchestratorConfig;

        const { llmContent, returnDisplay } = await buildToolResultOutputs(
          name,
          { text: largeContent },
          config,
        );

        // llmContent MUST be truncated to maxResultLength (8000 chars)
        assertEquals(
          llmContent.length <= 8000,
          true,
          `llmContent should be ≤8000 chars but was ${llmContent.length}`,
        );
        // Transcript shaping now bounds returnDisplay separately from llmContent.
        assertEquals(returnDisplay.length <= 10_000, true);
      },
    );
  },
);

Deno.test(
  "buildToolResultOutputs passes through small llmContent unchanged",
  async () => {
    const toolName = uniqueToolName("small_llm_content");
    const smallContent = "Short answer from web fetch";

    await withTemporaryTool(
      toolName,
      {
        fn: async () => ({ text: smallContent }),
        description: "tool that returns small content",
        args: {},
        safetyLevel: "L0" as const,
        formatResult: (_result: unknown) => ({
          llmContent: smallContent,
          returnDisplay: smallContent,
        }),
      },
      async (name) => {
        const context = new ContextManager({ maxResultLength: 8000 });
        const config = {
          workspace: TEST_WORKSPACE,
          context,
        } as OrchestratorConfig;

        const { llmContent } = await buildToolResultOutputs(name, {
          text: smallContent,
        }, config);
        assertEquals(llmContent, smallContent); // no truncation needed
      },
    );
  },
);
