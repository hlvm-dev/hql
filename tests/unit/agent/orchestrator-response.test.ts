import { assertEquals } from "jsr:@std/assert";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import type { OrchestratorConfig } from "../../../src/hlvm/agent/orchestrator.ts";
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
