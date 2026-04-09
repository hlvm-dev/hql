import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import type { OrchestratorConfig } from "../../../src/hlvm/agent/orchestrator.ts";
import type { FinalResponseMeta } from "../../../src/hlvm/agent/orchestrator.ts";
import type { ToolExecutionResult } from "../../../src/hlvm/agent/orchestrator-state.ts";
import type { ToolFailureMetadata } from "../../../src/hlvm/agent/tool-results.ts";
import type { LLMResponse } from "../../../src/hlvm/agent/tool-call.ts";
import type { ToolCall } from "../../../src/hlvm/agent/tool-call.ts";
import {
  handleFinalResponse,
  handlePostToolExecution,
  handleTextOnlyResponse,
} from "../../../src/hlvm/agent/orchestrator-response.ts";
import {
  initializeLoopState,
  resolveLoopConfig,
} from "../../../src/hlvm/agent/orchestrator-state.ts";
import { resolveTools } from "../../../src/hlvm/agent/registry.ts";
import { createToolProfileState } from "../../../src/hlvm/agent/tool-profiles.ts";
import { buildCitationSourceIndex } from "../../../src/hlvm/agent/tools/web/citation-spans.ts";

Deno.test("handleTextOnlyResponse retries when a model emits a plain-text function-style tool call", () => {
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context: new ContextManager(),
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);

  const result = handleTextOnlyResponse(
    { content: 'search_web({query: "latest Deno blog"})', toolCalls: [] },
    'search_web({query: "latest Deno blog"})',
    state,
    lc,
    config,
  );

  assertEquals(result.action, "continue");
  const messages = config.context.getMessages();
  assertEquals(messages.length, 1);
  assertStringIncludes(
    messages[0]?.content ?? "",
    "Native tool calling required",
  );
});

Deno.test("handleTextOnlyResponse repairs a locally executable plain-text function-style tool call after retry budget is exhausted", () => {
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context: new ContextManager(),
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);
  state.midLoopFormatRetries = lc.maxToolCallRetries;
  const response: LLMResponse = {
    content: 'read_file({"path":"README.md"})',
    toolCalls: [],
  };

  const result = handleTextOnlyResponse(
    response,
    response.content,
    state,
    lc,
    config,
  );

  assertEquals(result.action, "proceed");
  assertEquals(response.content, "");
  assertEquals(response.toolCalls.length, 1);
  assertEquals(response.toolCalls[0]?.toolName, "read_file");
  assertEquals(response.toolCalls[0]?.args.path, "README.md");
});

Deno.test("handleFinalResponse retries when a post-tool answer contains a plain-text function-style tool call", async () => {
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context: new ContextManager(),
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);
  state.toolUses = [{ toolName: "search_web", result: "ok" }];

  const result = await handleFinalResponse(
    'web_fetch({url: "https://deno.com"})',
    {
      toolCallsMade: 0,
      finalResponse: 'web_fetch({url: "https://deno.com"})',
    },
    state,
    lc,
    config,
  );

  assertEquals(result.action, "continue");
  const messages = config.context.getMessages();
  assertEquals(messages.length, 1);
  assertStringIncludes(
    messages[0]?.content ?? "",
    "Do not output tool call JSON",
  );
});

Deno.test("handleFinalResponse retries when the model returns a working-note instead of a direct answer", async () => {
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context: new ContextManager(),
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);
  state.toolUses = [{ toolName: "pw_snapshot", result: "ok" }];

  const result = await handleFinalResponse(
    "Now let me click the Issues tab:",
    {
      toolCallsMade: 0,
      finalResponse: "Now let me click the Issues tab:",
    },
    state,
    lc,
    config,
  );

  assertEquals(result.action, "continue");
  assertEquals(state.finalResponseFormatRetries, 1);
  const messages = config.context.getMessages();
  assertEquals(messages.length, 1);
  assertStringIncludes(
    messages[0]?.content ?? "",
    "Do not narrate your next step as the final answer",
  );
});

Deno.test("handleFinalResponse does not emit citation metadata before a grounding retry", async () => {
  let finalMetaCalls = 0;
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context: new ContextManager(),
    groundingMode: "strict",
    onFinalResponseMeta: () => {
      finalMetaCalls += 1;
    },
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);
  state.toolUses = [
    { toolName: "search_web", result: "non-json formatted result" },
    { toolName: "list_files", result: '{"count": 270, "files": [...]}' },
  ];
  state.passageIndex = buildCitationSourceIndex([
    {
      toolName: "search_web",
      result: {
        provider: "duckduckgo",
        results: [
          {
            title: "Python TaskGroup",
            url: "https://docs.python.org/3/library/asyncio-task.html",
            snippet:
              "TaskGroup provides structured concurrency and cancels sibling tasks on failure.",
          },
        ],
      },
    },
  ]);

  const result = await handleFinalResponse(
    "TaskGroup provides structured concurrency. I found some files in the directory.",
    { toolCallsMade: 0 },
    state,
    lc,
    config,
  );

  assertEquals(result.action, "continue");
  assertEquals(finalMetaCalls, 0);
});

Deno.test("handleFinalResponse prefers provider-native sources over inferred citations when available", async () => {
  let finalMeta: FinalResponseMeta | undefined;
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context: new ContextManager(),
    onFinalResponseMeta: (meta) => {
      finalMeta = meta;
    },
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);
  state.toolUses = [
    { toolName: "search_web", result: "non-json formatted result" },
  ];
  state.passageIndex = buildCitationSourceIndex([
    {
      toolName: "search_web",
      result: {
        provider: "duckduckgo",
        results: [
          {
            title: "Python TaskGroup",
            url: "https://docs.python.org/3/library/asyncio-task.html",
            snippet:
              "TaskGroup provides structured concurrency and cancels sibling tasks on failure.",
          },
        ],
      },
    },
  ]);

  const result = await handleFinalResponse(
    "TaskGroup provides structured concurrency.",
    {
      toolCallsMade: 0,
      finalResponse: "TaskGroup provides structured concurrency.",
      nativeSources: [{
        id: "src_1",
        sourceType: "url",
        url: "https://ai.google.dev/gemini-api/docs/google-search",
        title: "Google Search grounding",
        providerMetadata: { google: { groundingMetadata: { ok: true } } },
      }],
      providerMetadata: { google: { groundingMetadata: { ok: true } } },
    },
    state,
    lc,
    config,
  );

  assertEquals(result.action, "return");
  assertEquals(finalMeta?.citationSpans?.length, 1);
  assertEquals(
    finalMeta?.citationSpans?.[0]?.url,
    "https://ai.google.dev/gemini-api/docs/google-search",
  );
  assertEquals(finalMeta?.citationSpans?.[0]?.provenance, "provider");
  assertEquals(finalMeta?.providerMetadata?.google !== undefined, true);
});

Deno.test("handleFinalResponse derives provider-native citations from Google grounding metadata when sources are absent", async () => {
  let finalMeta: FinalResponseMeta | undefined;
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context: new ContextManager(),
    onFinalResponseMeta: (meta) => {
      finalMeta = meta;
    },
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);

  const result = await handleFinalResponse(
    "Introducing Deno Sandbox is the latest Deno post.",
    {
      toolCallsMade: 0,
      finalResponse: "Introducing Deno Sandbox is the latest Deno post.",
      providerMetadata: {
        google: {
          groundingMetadata: {
            groundingChunks: [{
              web: {
                uri: "https://deno.com/blog/introducing-deno-sandbox",
                title: "Introducing Deno Sandbox",
              },
            }],
          },
        },
      },
    },
    state,
    lc,
    config,
  );

  assertEquals(result.action, "return");
  assertEquals(finalMeta?.citationSpans?.length, 1);
  assertEquals(
    finalMeta?.citationSpans?.[0]?.url,
    "https://deno.com/blog/introducing-deno-sandbox",
  );
  assertEquals(finalMeta?.citationSpans?.[0]?.provenance, "provider");
});

Deno.test("handlePostToolExecution marks native provider sources as web usage", async () => {
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context: new ContextManager(),
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);

  const directive = await handlePostToolExecution(
    {
      toolCallsMade: 0,
      results: [],
      toolCalls: [],
      toolUses: [],
      toolBytes: 0,
      nativeSources: [{
        id: "src_1",
        sourceType: "url",
        url: "https://example.com",
        title: "Example",
      }],
    },
    state,
    lc,
    config,
    async () => ({ content: "", toolCalls: [] }),
  );

  assertEquals(directive.action, "proceed");
  assertEquals(state.lastToolsIncludedWeb, true);
});

Deno.test("handlePostToolExecution adds browser-specific recovery guidance for repeated Playwright timeout failures", async () => {
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context: new ContextManager(),
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);
  const repeatedFailure: {
    toolCallsMade: number;
    results: ToolExecutionResult[];
    toolCalls: ToolCall[];
    toolUses: [];
    toolBytes: number;
  } = {
    toolCallsMade: 1,
    results: [{
      success: false,
      error: "Click failed: Timeout 10000ms exceeded",
      failure: {
        source: "tool",
        kind: "timeout",
        retryable: true,
      } satisfies ToolFailureMetadata,
    }],
    toolCalls: [{
      id: "pw-1",
      toolName: "pw_click",
      args: { selector: "text=Issues" },
    }],
    toolUses: [],
    toolBytes: 0,
  };

  const first = await handlePostToolExecution(
    repeatedFailure,
    state,
    lc,
    config,
    async () => ({ content: "", toolCalls: [] }),
  );
  assertEquals(first.action, "proceed");

  const second = await handlePostToolExecution(
    repeatedFailure,
    state,
    lc,
    config,
    async () => ({ content: "", toolCalls: [] }),
  );
  assertEquals(second.action, "continue");
  const recoveryMsg = config.context.getMessages().at(-1)?.content ?? "";
  assertStringIncludes(recoveryMsg, "[Runtime Directive]");
  assert(
    recoveryMsg.includes(
      "Repeated Playwright failure: selector or timeout mismatch.",
    ) ||
      recoveryMsg.includes(
        "Repeated Playwright failure: visibility or layout blocker.",
      ) ||
      recoveryMsg.includes(
        "Repeated Playwright failure: browser strategy mismatch.",
      ),
    `Expected browser recovery message, got: ${recoveryMsg.slice(0, 160)}`,
  );
});

Deno.test("handlePostToolExecution promotes browser_safe to browser_hybrid on repeated structured visual Playwright failures", async () => {
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context: new ContextManager(),
    toolProfileState: createToolProfileState({
      domain: { slot: "domain", profileId: "browser_safe" },
    }),
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);
  const repeatedFailure = {
    toolCallsMade: 1,
    results: [{
      success: false,
      error: "Click failed: element is not visible",
      failure: {
        source: "tool",
        kind: "timeout",
        retryable: true,
        code: "pw_element_not_visible",
        facts: {
          visualBlocker: true,
          visualReason: "not_visible",
          selector: "text=Issues",
          interaction: "click",
          candidateHref: "https://github.com/denoland/deno/issues",
        },
      } satisfies ToolFailureMetadata,
    }],
    toolCalls: [{
      id: "pw-visual",
      toolName: "pw_click",
      args: { selector: "text=Issues" },
    }],
    toolUses: [],
    toolBytes: 0,
  };

  await handlePostToolExecution(
    repeatedFailure,
    state,
    lc,
    config,
    async () => ({ content: "", toolCalls: [] }),
  );

  const second = await handlePostToolExecution(
    repeatedFailure,
    state,
    lc,
    config,
    async () => ({ content: "", toolCalls: [] }),
  );

  assertEquals(second.action, "continue");
  assertEquals(
    config.toolProfileState?.layers.domain?.profileId,
    "browser_hybrid",
  );
  assertEquals(state.temporaryToolDenylist.get("pw_click"), 2);
  const recoveryMsg = config.context.getMessages().at(-1)?.content ?? "";
  assertStringIncludes(recoveryMsg, "[Runtime Directive]");
  assertStringIncludes(
    recoveryMsg,
    "Repeated Playwright failure: visibility or layout blocker.",
  );
  assertStringIncludes(
    recoveryMsg,
    "https://github.com/denoland/deno/issues",
  );
  assertStringIncludes(recoveryMsg, "Use pw_goto with that URL");
  assertStringIncludes(recoveryMsg, "Hybrid browser mode is available.");
  assertStringIncludes(recoveryMsg, "pw_promote");
  assertStringIncludes(recoveryMsg, "cu_*");
  assertStringIncludes(
    recoveryMsg,
    "pw_click is temporarily blocked for the next 2 turns.",
  );
});

Deno.test("handlePostToolExecution tells the model to follow navigatedTo for repeated pw_download_navigated failures", async () => {
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context: new ContextManager(),
    toolProfileState: createToolProfileState({
      domain: { slot: "domain", profileId: "browser_safe" },
    }),
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);
  const repeatedFailure: {
    toolCallsMade: number;
    results: ToolExecutionResult[];
    toolCalls: ToolCall[];
    toolUses: [];
    toolBytes: number;
  } = {
    toolCallsMade: 1,
    results: [{
      success: false,
      error:
        "Click navigated to https://python.org/downloads/release/python-3144/ instead of triggering a download.",
      failure: {
        source: "tool",
        kind: "invalid_state",
        retryable: true,
        code: "pw_download_navigated",
        facts: {
          navigatedTo: "https://python.org/downloads/release/python-3144/",
        },
      } satisfies ToolFailureMetadata,
    }],
    toolCalls: [{
      id: "pw-2",
      toolName: "pw_download",
      args: { selector: "text=Download Python" },
    }],
    toolUses: [],
    toolBytes: 0,
  };

  await handlePostToolExecution(
    repeatedFailure,
    state,
    lc,
    config,
    async () => ({ content: "", toolCalls: [] }),
  );

  const second = await handlePostToolExecution(
    repeatedFailure,
    state,
    lc,
    config,
    async () => ({ content: "", toolCalls: [] }),
  );
  assertEquals(second.action, "continue");
  assertEquals(state.temporaryToolDenylist.get("pw_download"), 2);
  const navigatedMsg = config.context.getMessages().at(-1)?.content ?? "";
  assertStringIncludes(navigatedMsg, "[Runtime Directive]");
  assertStringIncludes(
    navigatedMsg,
    "Repeated Playwright failure: the download trigger navigated instead of downloading.",
  );
  assertStringIncludes(
    navigatedMsg,
    "https://python.org/downloads/release/python-3144/",
  );
  assertStringIncludes(
    navigatedMsg,
    "pw_download is temporarily blocked for the next 2 turns.",
  );
  assertEquals(
    config.toolProfileState?.layers.domain?.profileId,
    "browser_safe",
  );
});

Deno.test("handlePostToolExecution nudges out of repeated Playwright visual loops", async () => {
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context: new ContextManager(),
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);

  const screenshotTurn = {
    toolCallsMade: 1,
    results: [
      {
        success: true,
        result: { captured: true },
      } satisfies ToolExecutionResult,
    ],
    toolCalls: [
      {
        id: "pw-shot",
        toolName: "pw_screenshot",
        args: {},
      } satisfies ToolCall,
    ],
    toolUses: [],
    toolBytes: 0,
  };
  const scrollTurn = {
    toolCallsMade: 1,
    results: [
      {
        success: true,
        result: { scrolled: true },
      } satisfies ToolExecutionResult,
    ],
    toolCalls: [
      {
        id: "pw-scroll",
        toolName: "pw_scroll",
        args: { amount: 3 },
      } satisfies ToolCall,
    ],
    toolUses: [],
    toolBytes: 0,
  };

  await handlePostToolExecution(
    screenshotTurn,
    state,
    lc,
    config,
    async () => ({ content: "", toolCalls: [] }),
  );
  await handlePostToolExecution(
    scrollTurn,
    state,
    lc,
    config,
    async () => ({ content: "", toolCalls: [] }),
  );
  await handlePostToolExecution(
    screenshotTurn,
    state,
    lc,
    config,
    async () => ({ content: "", toolCalls: [] }),
  );

  const fourth = await handlePostToolExecution(
    scrollTurn,
    state,
    lc,
    config,
    async () => ({ content: "", toolCalls: [] }),
  );
  assertEquals(fourth.action, "continue");
  assertStringIncludes(
    config.context.getMessages().at(-1)?.content ?? "",
    "[Runtime Directive]",
  );
  assertStringIncludes(
    config.context.getMessages().at(-1)?.content ?? "",
    "Do not continue visual browsing loops.",
  );
});

Deno.test("handleFinalResponse promotes an approved plan-mode draft into execution", async () => {
  const context = new ContextManager();
  const phaseEvents: string[] = [];
  const uiEvents: string[] = [];
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context,
    permissionMode: "plan",
    toolAllowlist: ["read_file"],
    toolFilterState: { allowlist: ["read_file"] },
    toolFilterBaseline: { allowlist: ["read_file"] },
    planModeState: {
      active: true,
      phase: "researching",
      executionPermissionMode: "acceptEdits",
      executionAllowlist: ["read_file", "write_file"],
      planningAllowlist: ["read_file"],
    },
    planReview: {
      getCurrentPlan: () => undefined,
      shouldGateMutatingTools: () => false,
      ensureApproved: async () => "approved",
    },
    onAgentEvent: (event) => {
      uiEvents.push(event.type);
      if (event.type === "plan_phase_changed") {
        phaseEvents.push(event.phase);
      }
    },
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);

  const result = await handleFinalResponse(
    [
      "PLAN",
      '{"goal":"Implement plan mode","steps":[{"id":"step-1","title":"Edit the UI"}]}',
      "END_PLAN",
    ].join("\n"),
    { toolCallsMade: 0 },
    state,
    lc,
    config,
  );

  assertEquals(result.action, "continue");
  assert(uiEvents.includes("plan_created"));
  assertEquals(phaseEvents, ["drafting", "reviewing", "executing"]);
  assertEquals(config.planModeState?.phase, "executing");
  assertEquals(config.permissionMode, "acceptEdits");
  assertEquals(config.toolAllowlist, ["read_file", "write_file"]);
  assertEquals(config.toolFilterState?.allowlist, ["read_file", "write_file"]);
  assertEquals(config.toolFilterBaseline?.allowlist, [
    "read_file",
    "write_file",
  ]);
  assertEquals(lc.planningConfig.requireStepMarkers, true);
  assertEquals(state.planState?.plan.goal, "Implement plan mode");
  assertEquals(context.getMessages().length, 1);
  assertStringIncludes(
    context.getMessages()[0]?.content ?? "",
    "[Runtime Directive]",
  );
  assertStringIncludes(
    context.getMessages()[0]?.content ?? "",
    "STEP_DONE <id>",
  );
  assertStringIncludes(
    context.getMessages()[0]?.content ?? "",
    "[step-1] Edit the UI",
  );
  assertStringIncludes(
    context.getMessages()[0]?.content ?? "",
    "shell_exec with rg -n or sed -n",
  );
  assertStringIncludes(
    context.getMessages()[0]?.content ?? "",
    "shell_exec accepts one simple command only",
  );
  assertStringIncludes(
    context.getMessages()[0]?.content ?? "",
    "Do not use git stash, git reset",
  );
  assertStringIncludes(
    context.getMessages()[0]?.content ?? "",
    "Use git_diff/git_status for repo inspection",
  );
  assertStringIncludes(
    context.getMessages()[0]?.content ?? "",
    "skip extra search_code or whole-file shell_exec and move straight to edit_file",
  );
});

Deno.test("handleFinalResponse narrows plan execution tools and restores the execution denylist", async () => {
  const context = new ContextManager();
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context,
    permissionMode: "plan",
    toolAllowlist: ["read_file"],
    toolDenylist: ["complete_task"],
    toolFilterState: { allowlist: ["read_file"], denylist: ["complete_task"] },
    toolFilterBaseline: {
      allowlist: ["read_file"],
      denylist: ["complete_task"],
    },
    planModeState: {
      active: true,
      phase: "researching",
      executionPermissionMode: "acceptEdits",
      executionAllowlist: undefined,
      executionDenylist: [],
      planningAllowlist: ["read_file"],
    },
    planReview: {
      getCurrentPlan: () => undefined,
      shouldGateMutatingTools: () => false,
      ensureApproved: async () => "approved",
    },
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);

  const result = await handleFinalResponse(
    [
      "PLAN",
      JSON.stringify({
        goal: "Add a comment",
        steps: [{
          id: "step-1",
          title: "Patch the component",
          tools: ["read_file", "edit_file"],
        }],
      }),
      "END_PLAN",
    ].join("\n"),
    { toolCallsMade: 0 },
    state,
    lc,
    config,
  );

  assertEquals(result.action, "continue");
  assertEquals(config.permissionMode, "acceptEdits");
  assertEquals(config.toolDenylist, undefined);
  assertEquals(config.toolFilterState?.denylist, undefined);
  assertEquals(config.toolFilterBaseline?.denylist, undefined);
  assertEquals(config.toolAllowlist, [
    "complete_task",
    "edit_file",
    "list_files",
    "read_file",
    "search_code",
    "shell_exec",
    "todo_read",
    "todo_write",
    "undo_edit",
    "write_file",
  ]);
  assertEquals(config.toolFilterBaseline?.allowlist, [
    "complete_task",
    "edit_file",
    "list_files",
    "read_file",
    "search_code",
    "shell_exec",
    "todo_read",
    "todo_write",
    "undo_edit",
    "write_file",
  ]);
});

Deno.test("handleFinalResponse accepts a markdown PLAN block in plan mode", async () => {
  const context = new ContextManager();
  const phaseEvents: string[] = [];
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context,
    permissionMode: "plan",
    toolAllowlist: ["read_file"],
    toolFilterState: { allowlist: ["read_file"] },
    planModeState: {
      active: true,
      phase: "researching",
      executionPermissionMode: "acceptEdits",
      executionAllowlist: ["read_file", "write_file"],
      planningAllowlist: ["read_file"],
    },
    planReview: {
      getCurrentPlan: () => undefined,
      shouldGateMutatingTools: () => false,
      ensureApproved: async () => "approved",
    },
    onAgentEvent: (event) => {
      if (event.type === "plan_phase_changed") {
        phaseEvents.push(event.phase);
      }
    },
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);

  const result = await handleFinalResponse(
    [
      "PLAN",
      "Goal: Implement plan mode review UI",
      "Steps:",
      "1. Read the current conversation panel",
      "2. Render a structured plan review card",
      "END_PLAN",
    ].join("\n"),
    { toolCallsMade: 0 },
    state,
    lc,
    config,
  );

  assertEquals(result.action, "continue");
  assertEquals(phaseEvents, ["drafting", "reviewing", "executing"]);
  assertEquals(state.planState?.plan.goal, "Implement plan mode review UI");
  assertEquals(state.planState?.plan.steps.map((step) => step.title), [
    "Read the current conversation panel",
    "Render a structured plan review card",
  ]);
});

Deno.test("handleFinalResponse converts plain-text default follow-up questions into an interaction", async () => {
  const context = new ContextManager();
  let capturedQuestion = "";
  let capturedOptionsLength = 0;
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context,
    onInteraction: async (event) => {
      capturedQuestion = event.question ?? "";
      capturedOptionsLength = event.options?.length ?? 0;
      return { approved: true, userInput: "yes" };
    },
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);
  state.toolUses = [{ toolName: "list_files", result: "{ found: true }" }];

  const result = await handleFinalResponse(
    "I found Firefox in /Applications. Would you like me to try shell access to automate this instead?",
    { toolCallsMade: 0 },
    state,
    lc,
    config,
  );

  assertEquals(result.action, "continue");
  assertEquals(
    capturedQuestion,
    "Would you like me to try shell access to automate this instead?",
  );
  assertEquals(capturedOptionsLength, 2);
  assertEquals(context.getMessages().length, 1);
  assertEquals(context.getMessages()[0]?.role, "user");
  assertStringIncludes(
    context.getMessages()[0]?.content ?? "",
    "[Follow-up answer] yes",
  );
});

Deno.test("handleFinalResponse continues instead of asking permission for already-requested follow-up work", async () => {
  let interactionCalled = false;
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context: new ContextManager(),
    currentUserRequest:
      "Go to the MDN Fetch API page. Extract the first paragraph under Concepts and usage and the first code example.",
    onInteraction: async () => {
      interactionCalled = true;
      return { approved: true, userInput: "yes" };
    },
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);
  state.toolUses = [{ toolName: "pw_links", result: "{ found: true }" }];

  const result = await handleFinalResponse(
    'I found the "Using Fetch" guide. If you\'d like, I can open it and extract the first code example from there.',
    { toolCallsMade: 0 },
    state,
    lc,
    config,
  );

  assertEquals(result.action, "continue");
  assertEquals(interactionCalled, false);
  const lastMessage = config.context.getMessages().at(-1)?.content ?? "";
  assertStringIncludes(
    lastMessage,
    "Do not ask the user for permission to continue with work already required",
  );
});

Deno.test("handleFinalResponse returns plain-text default follow-up unchanged when the interaction is cancelled", async () => {
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context: new ContextManager(),
    onInteraction: async () => ({ approved: false }),
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);
  state.toolUses = [{ toolName: "list_files", result: "{ found: true }" }];

  const response =
    "I can open Terminal for you. Would you like me to open it now?";
  const result = await handleFinalResponse(
    response,
    { toolCallsMade: 0 },
    state,
    lc,
    config,
  );

  assertEquals(result.action, "return");
  assertEquals(result.action === "return" ? result.value : "", response);
});

Deno.test("handleFinalResponse does not convert generic wrap-up questions into interactions", async () => {
  let interactionCalled = false;
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context: new ContextManager(),
    onInteraction: async () => {
      interactionCalled = true;
      return { approved: true, userInput: "yes" };
    },
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);
  state.toolUses = [{ toolName: "list_files", result: "{ found: true }" }];

  const response = "Would you like me to help with anything else?";
  const result = await handleFinalResponse(
    response,
    { toolCallsMade: 0 },
    state,
    lc,
    config,
  );

  assertEquals(interactionCalled, false);
  assertEquals(result.action, "return");
  assertEquals(result.action === "return" ? result.value : "", response);
});

Deno.test("handleFinalResponse returns to planning when plan review requests revision", async () => {
  const context = new ContextManager();
  const phaseEvents: string[] = [];
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context,
    permissionMode: "plan",
    planModeState: {
      active: true,
      phase: "researching",
      executionPermissionMode: "acceptEdits",
      executionAllowlist: ["read_file", "write_file"],
      planningAllowlist: ["read_file"],
    },
    planReview: {
      getCurrentPlan: () => undefined,
      shouldGateMutatingTools: () => false,
      ensureApproved: async () => "revise",
    },
    onAgentEvent: (event) => {
      if (event.type === "plan_phase_changed") {
        phaseEvents.push(event.phase);
      }
    },
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);

  const result = await handleFinalResponse(
    [
      "PLAN",
      '{"goal":"Implement plan mode","steps":[{"id":"step-1","title":"Edit the UI"}]}',
      "END_PLAN",
    ].join("\n"),
    { toolCallsMade: 0 },
    state,
    lc,
    config,
  );

  assertEquals(result.action, "continue");
  assertEquals(state.planState, null);
  assertEquals(config.permissionMode, "plan");
  assertEquals(config.planModeState?.phase, "researching");
  assertEquals(phaseEvents, ["drafting", "reviewing", "researching"]);
  assertEquals(context.getMessages().length, 1);
  assertStringIncludes(
    context.getMessages()[0]?.content ?? "",
    "Revise the plan",
  );
});

Deno.test("handleFinalResponse returns a cancellation message when plan review is cancelled", async () => {
  const context = new ContextManager();
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context,
    permissionMode: "plan",
    planModeState: {
      active: true,
      phase: "researching",
      executionPermissionMode: "acceptEdits",
      executionAllowlist: ["read_file", "write_file"],
      planningAllowlist: ["read_file"],
    },
    planReview: {
      getCurrentPlan: () => undefined,
      shouldGateMutatingTools: () => false,
      ensureApproved: async () => "cancelled",
    },
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);

  const result = await handleFinalResponse(
    [
      "PLAN",
      '{"goal":"Implement plan mode","steps":[{"id":"step-1","title":"Edit the UI"}]}',
      "END_PLAN",
    ].join("\n"),
    { toolCallsMade: 0 },
    state,
    lc,
    config,
  );

  assertEquals(result.action, "return");
  assertStringIncludes(
    result.action === "return" ? result.value : "",
    "Plan review was cancelled. No changes were made.",
  );
  assertEquals(state.planState, null);
  assertEquals(config.permissionMode, "plan");
  assertEquals(context.getMessages().length, 0);
});

Deno.test("handleFinalResponse turns plain-text planning questions into clarification requests", async () => {
  const context = new ContextManager();
  let askedQuestion = "";
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context,
    permissionMode: "plan",
    planModeState: {
      active: true,
      phase: "researching",
      executionPermissionMode: "acceptEdits",
      executionAllowlist: ["read_file", "write_file"],
      planningAllowlist: ["read_file", "ask_user"],
    },
    onInteraction: async (event) => {
      askedQuestion = event.question ?? "";
      return {
        approved: true,
        userInput: "Refactor the Swift parser loop handling.",
      };
    },
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);

  const result = await handleFinalResponse(
    "What concrete task do you want me to plan?",
    { toolCallsMade: 0 },
    state,
    lc,
    config,
  );

  assertEquals(result.action, "continue");
  assertEquals(
    askedQuestion,
    "What concrete task do you want me to plan?",
  );
  assertEquals(context.getMessages().length, 1);
  assertStringIncludes(
    context.getMessages()[0]?.content ?? "",
    "[Clarification] Refactor the Swift parser loop handling.",
  );
});

Deno.test("handleFinalResponse retries once when plan mode gets prose instead of a structured plan", async () => {
  const context = new ContextManager();
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context,
    permissionMode: "plan",
    planModeState: {
      active: true,
      phase: "researching",
      executionPermissionMode: "acceptEdits",
      executionAllowlist: ["read_file", "write_file"],
      planningAllowlist: ["read_file"],
    },
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);

  const first = await handleFinalResponse(
    "I would inspect the parser and then update the tests.",
    { toolCallsMade: 0 },
    state,
    lc,
    config,
  );

  assertEquals(first.action, "continue");
  assertEquals(state.finalResponseFormatRetries, 1);
  assertStringIncludes(
    context.getMessages()[0]?.content ?? "",
    "Either ask one concise clarification with ask_user or return ONLY a PLAN",
  );

  const second = await handleFinalResponse(
    "I would inspect the parser and then update the tests.",
    { toolCallsMade: 0 },
    state,
    lc,
    config,
  );

  assertEquals(second.action, "return");
  assertStringIncludes(
    second.action === "return" ? second.value : "",
    "Plan mode could not produce a structured plan.",
  );
});

Deno.test("handlePostToolExecution drafts a plan after plan-mode research using markdown PLAN output", async () => {
  const context = new ContextManager();
  const phaseEvents: string[] = [];
  let draftVisibleToolCount = -1;
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context,
    permissionMode: "plan",
    currentUserRequest:
      "Make a plan to add a visible checklist header to ConversationPanel.",
    toolAllowlist: ["read_file", "search_code"],
    toolDenylist: [],
    toolFilterState: {
      allowlist: ["read_file", "search_code"],
      denylist: [],
    },
    planModeState: {
      active: true,
      phase: "researching",
      executionPermissionMode: "acceptEdits",
      executionAllowlist: ["read_file", "write_file"],
      planningAllowlist: ["read_file"],
    },
    onAgentEvent: (event) => {
      if (event.type === "plan_phase_changed") {
        phaseEvents.push(event.phase);
      }
    },
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);
  state.iterations = lc.maxIterations - 1;

  const directive = await handlePostToolExecution(
    {
      toolCallsMade: 1,
      toolCalls: [{
        id: "call_1",
        toolName: "read_file",
        args: {
          path: "src/hlvm/cli/repl-ink/components/ConversationPanel.tsx",
        },
      }],
      results: [{
        success: true,
        result: { success: true, content: "component body" },
      }],
      toolUses: [{
        toolName: "read_file",
        result: "component body",
      }],
      toolBytes: 128,
    },
    state,
    lc,
    config,
    async () => ({
      content: (() => {
        draftVisibleToolCount = Object.keys(resolveTools({
          allowlist: config.toolFilterState?.allowlist ?? config.toolAllowlist,
          denylist: config.toolFilterState?.denylist ?? config.toolDenylist,
        })).length;
        return [
          "PLAN",
          "Goal: Add a visible checklist header to ConversationPanel",
          "Steps:",
          "1. Inspect the existing todo-derived checklist rendering",
          "2. Update the header section to show the checklist state",
          "3. Verify the conversation panel behavior with targeted tests",
          "END_PLAN",
        ].join("\n");
      })(),
      toolCalls: [],
    }),
  );

  assertEquals(directive.action, "return");
  assertStringIncludes(
    directive.action === "return" ? directive.value : "",
    "Plan ready: Add a visible checklist header to ConversationPanel",
  );
  assertEquals(config.planModeState?.phase, "reviewing");
  assertEquals(phaseEvents, ["drafting", "reviewing"]);
  assertEquals(draftVisibleToolCount, 0);
  assertEquals(config.toolFilterState?.allowlist, ["read_file", "search_code"]);
  assertEquals(config.toolFilterState?.denylist, undefined);
});

Deno.test("handlePostToolExecution injects one edit_file recovery message", async () => {
  const context = new ContextManager();
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context,
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);

  const directive = await handlePostToolExecution(
    {
      toolCallsMade: 1,
      toolCalls: [{
        id: "call_1",
        toolName: "edit_file",
        args: {
          path: "src/app.ts",
          find: "const oldValue = 1;",
          replace: "const newValue = 2;",
        },
      }],
      results: [{
        success: true,
        result: {
          success: false,
          message: "Pattern not found in file: const oldValue = 1;",
        },
        recovery: {
          kind: "edit_file_target_not_found",
          path: "src/app.ts",
          requestedFind: "const oldValue = 1;",
          excerpt: "export const newValue = 2;",
          closestCurrentLine: "export const newValue = 2;",
        },
      }],
      toolUses: [],
      toolBytes: 0,
    },
    state,
    lc,
    config,
    async () => ({ content: "", toolCalls: [] }),
  );

  assertEquals(directive.action, "proceed");
  const messages = context.getMessages();
  assertEquals(messages.length, 1);
  assertEquals(messages[0].role, "user");
  assertStringIncludes(messages[0].content, "[Runtime Directive]");
  assertEquals(
    messages[0].content.includes("exact line as your next find string"),
    true,
  );
});

Deno.test("handlePostToolExecution does not inject recovery for normal successful tool batches", async () => {
  const context = new ContextManager();
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context,
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);

  const directive = await handlePostToolExecution(
    {
      toolCallsMade: 1,
      toolCalls: [{
        id: "call_1",
        toolName: "read_file",
        args: { path: "src/app.ts" },
      }],
      results: [{
        success: true,
        result: { success: true, content: "ok" },
      }],
      toolUses: [],
      toolBytes: 0,
    },
    state,
    lc,
    config,
    async () => ({ content: "", toolCalls: [] }),
  );

  assertEquals(directive.action, "proceed");
  assertEquals(context.getMessages().length, 0);
});
