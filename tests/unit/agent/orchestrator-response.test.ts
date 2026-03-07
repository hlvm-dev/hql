import { assertEquals } from "jsr:@std/assert";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import type { OrchestratorConfig } from "../../../src/hlvm/agent/orchestrator.ts";
import type { FinalResponseMeta } from "../../../src/hlvm/agent/orchestrator.ts";
import { handleFinalResponse } from "../../../src/hlvm/agent/orchestrator-response.ts";
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
