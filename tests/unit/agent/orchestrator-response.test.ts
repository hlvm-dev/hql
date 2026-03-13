import { assertEquals } from "jsr:@std/assert";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import type { OrchestratorConfig } from "../../../src/hlvm/agent/orchestrator.ts";
import type { FinalResponseMeta } from "../../../src/hlvm/agent/orchestrator.ts";
import {
  handleFinalResponse,
  handlePostToolExecution,
} from "../../../src/hlvm/agent/orchestrator-response.ts";
import {
  initializeLoopState,
  resolveLoopConfig,
} from "../../../src/hlvm/agent/orchestrator-state.ts";
import { buildCitationSourceIndex } from "../../../src/hlvm/agent/tools/web/citation-spans.ts";

Deno.test("handleFinalResponse does not emit citation metadata before a grounding retry", () => {
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

  const result = handleFinalResponse(
    "TaskGroup provides structured concurrency. I found some files in the directory.",
    { toolCallsMade: 0 },
    state,
    lc,
    config,
  );

  assertEquals(result.action, "continue");
  assertEquals(finalMetaCalls, 0);
});

Deno.test("handleFinalResponse prefers provider-native sources over inferred citations when available", () => {
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

  const result = handleFinalResponse(
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
  assertEquals(finalMeta?.citationSpans?.[0]?.url, "https://ai.google.dev/gemini-api/docs/google-search");
  assertEquals(finalMeta?.citationSpans?.[0]?.provenance, "provider");
  assertEquals(finalMeta?.providerMetadata?.google !== undefined, true);
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
  assertEquals(messages[0].role, "system");
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
