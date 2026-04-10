import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import {
  buildProviderOptions,
  resolveThinkingProfile,
} from "../../../src/hlvm/agent/engine-sdk.ts";
import { runReActLoop } from "../../../src/hlvm/agent/orchestrator.ts";
import { handlePostToolExecution } from "../../../src/hlvm/agent/orchestrator-response.ts";
import {
  effectiveAllowlist,
  initializeLoopState,
  resolveLoopConfig,
} from "../../../src/hlvm/agent/orchestrator-state.ts";
import type { LLMResponse } from "../../../src/hlvm/agent/tool-call.ts";
import { createToolProfileState } from "../../../src/hlvm/agent/tool-profiles.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import { isMutatingTool } from "../../../src/hlvm/agent/security/safety.ts";

function makeResponse(
  content: string,
  toolCalls: LLMResponse["toolCalls"] = [],
): LLMResponse {
  return { content, toolCalls };
}

Deno.test("adaptive thinking scales by complexity and caps anthropic budget by remaining context", () => {
  const light = resolveThinkingProfile({ thinkingCapable: true });
  assertEquals(light, {
    anthropicBudgetTokens: 5000,
    openaiReasoningEffort: "low",
    googleThinkingLevel: "low",
  });

  const medium = resolveThinkingProfile({
    thinkingCapable: true,
    contextBudget: 128000,
    thinkingState: {
      iteration: 4,
      recentToolCalls: 2,
      phase: "editing",
      remainingContextBudget: 64000,
    },
  });
  assertEquals(medium, {
    anthropicBudgetTokens: 16000,
    openaiReasoningEffort: "medium",
    googleThinkingLevel: "medium",
  });

  const deep = resolveThinkingProfile({
    thinkingCapable: true,
    contextBudget: 128000,
    thinkingState: {
      iteration: 10,
      recentToolCalls: 3,
      consecutiveFailures: 1,
      phase: "verifying",
      remainingContextBudget: 40000,
    },
  });
  assertEquals(deep, {
    anthropicBudgetTokens: 10000,
    openaiReasoningEffort: "high",
    googleThinkingLevel: "high",
  });
});

Deno.test("buildProviderOptions uses adaptive thinking profile for anthropic and openai", () => {
  const anthropic = buildProviderOptions(
    {
      providerName: "anthropic",
      modelId: "claude-sonnet-4-5",
      providerConfig: null,
    },
    {
      thinkingCapable: true,
      contextBudget: 100000,
      thinkingState: {
        iteration: 9,
        recentToolCalls: 3,
        consecutiveFailures: 1,
        phase: "verifying",
        remainingContextBudget: 50000,
      },
    },
  );
  assertEquals(anthropic?.anthropic?.thinking, {
    type: "enabled",
    budgetTokens: 12500,
  });

  const openai = buildProviderOptions(
    { providerName: "openai", modelId: "o3", providerConfig: null },
    {
      thinkingCapable: true,
      thinkingState: {
        iteration: 5,
        recentToolCalls: 2,
        phase: "editing",
      },
    },
  );
  assertEquals(openai?.openai?.reasoningEffort, "medium");
});

Deno.test({
  name:
    "runReActLoop prunes edit-phase tool access after an initial read for edit requests",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const platform = getPlatform();
    const workspace = await platform.fs.makeTempDir({
      prefix: "hlvm-phase-pruning-",
    });
    await platform.fs.writeTextFile(
      platform.path.join(workspace, "src.ts"),
      "export const value = 1;\n",
    );

    const context = new ContextManager();
    let llmCalls = 0;
    let secondTurnAllowlist: string[] | undefined;
    const config = {
      workspace,
      context,
      permissionMode: "bypassPermissions" as const,
      toolProfileState: createToolProfileState({
        baseline: {
          slot: "baseline",
          allowlist: ["read_file", "edit_file", "write_file", "search_web"],
        },
      }),
      modelTier: "constrained" as const,
    };

    try {
      const result = await runReActLoop(
        "Fix src.ts by renaming value to nextValue",
        config,
        async () => {
          llmCalls += 1;
          if (llmCalls === 1) {
            return makeResponse("", [{
              toolName: "read_file",
              args: { path: "src.ts" },
            }]);
          }
          secondTurnAllowlist = effectiveAllowlist(config);
          return makeResponse("done");
        },
      );

      assertEquals(result, "done");
      assertEquals(secondTurnAllowlist?.includes("edit_file"), true);
      assertEquals(secondTurnAllowlist?.includes("write_file"), true);
      assertEquals(secondTurnAllowlist?.includes("search_web"), false);
    } finally {
      await platform.fs.remove(workspace, { recursive: true });
    }
  },
});

Deno.test("handlePostToolExecution escalates loop recovery before hard stop", async () => {
  const context = new ContextManager();
  const config = {
    workspace: "/tmp",
    context,
    maxToolCallRepeat: 1,
  };
  const lc = resolveLoopConfig(config);
  const state = initializeLoopState(config);
  const repeatedBatch = {
    toolCallsMade: 1,
    toolCalls: [{
      id: "call_1",
      toolName: "search_code",
      args: { pattern: "value" },
    }],
    results: [{
      success: true,
      result: { success: true, matches: [] },
    }],
    toolUses: [{
      toolName: "search_code",
      result: '{"matches":[]}',
    }],
    toolBytes: 14,
  };

  const first = await handlePostToolExecution(
    repeatedBatch,
    state,
    lc,
    config,
    async () => makeResponse(""),
  );
  assertEquals(first.action, "continue");
  assertStringIncludes(
    context.getMessages().at(-1)?.content ?? "",
    "Change approach now",
  );

  const second = await handlePostToolExecution(
    repeatedBatch,
    state,
    lc,
    config,
    async () => makeResponse(""),
  );
  assertEquals(second.action, "continue");
  assertEquals(state.playwright.temporaryToolDenylist.get("search_code"), 2);
  assertStringIncludes(
    context.getMessages().at(-1)?.content ?? "",
    "temporarily blocked",
  );

  const third = await handlePostToolExecution(
    repeatedBatch,
    state,
    lc,
    config,
    async () => makeResponse(""),
  );
  assertEquals(third.action, "continue");
  assertStringIncludes(
    context.getMessages().at(-1)?.content ?? "",
    "Loop recovery escalation",
  );

  const fourth = await handlePostToolExecution(
    repeatedBatch,
    state,
    lc,
    config,
    async () => makeResponse(""),
  );
  assertEquals(fourth.action, "return");
  assertStringIncludes(
    fourth.action === "return" ? fourth.value : "",
    "Tool call loop detected.",
  );
});

// ---------------------------------------------------------------------------
// isMutatingTool: L0 shell commands are non-mutating
// ---------------------------------------------------------------------------

Deno.test("isMutatingTool treats L0 shell_exec as non-mutating", () => {
  assertEquals(
    isMutatingTool("shell_exec", undefined, { command: "du -sh /tmp" }),
    false,
  );
});

Deno.test("isMutatingTool treats destructive shell_exec as mutating", () => {
  assertEquals(
    isMutatingTool("shell_exec", undefined, { command: "rm -rf /tmp/foo" }),
    true,
  );
});

Deno.test("isMutatingTool defaults shell_exec to mutating without args", () => {
  assertEquals(isMutatingTool("shell_exec"), true);
});

// ---------------------------------------------------------------------------
// isMutatingTool: pipeline-aware classification
// ---------------------------------------------------------------------------

Deno.test("isMutatingTool treats L0 piped shell_exec as non-mutating", () => {
  assertEquals(
    isMutatingTool("shell_exec", undefined, { command: "du -sh /tmp | sort" }),
    false,
  );
});

Deno.test("isMutatingTool treats file-redirect shell_exec as mutating", () => {
  assertEquals(
    isMutatingTool("shell_exec", undefined, { command: "ls /tmp > output.txt" }),
    true,
  );
});

Deno.test("isMutatingTool treats read-only pipeline chain as non-mutating", () => {
  assertEquals(
    isMutatingTool("shell_exec", undefined, { command: "cat file | grep pattern | wc -l" }),
    false,
  );
});

Deno.test("isMutatingTool treats pipeline containing destructive command as mutating", () => {
  assertEquals(
    isMutatingTool("shell_exec", undefined, { command: "find . -name '*.ts' | xargs rm" }),
    true,
  );
});
