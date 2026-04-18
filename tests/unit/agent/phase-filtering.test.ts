import { assertEquals } from "jsr:@std/assert";
import {
  applyAdaptiveToolPhase,
  COMPLETE_PHASE_CATEGORIES,
  EDIT_PHASE_CATEGORIES,
  type LoopState,
  type OrchestratorConfig,
  VERIFY_PHASE_CATEGORIES,
} from "../../../src/hlvm/agent/orchestrator.ts";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import { effectiveAllowlist } from "../../../src/hlvm/agent/orchestrator-state.ts";
import { TOOL_REGISTRY } from "../../../src/hlvm/agent/registry.ts";
import {
  createToolProfileState,
  resolvePersistentToolFilter,
} from "../../../src/hlvm/agent/tool-profiles.ts";
import { UsageTracker } from "../../../src/hlvm/agent/usage.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    requestPhaseClassification: { phase: "researching" },
    ...overrides,
  };
}

type ToolDefinition = (typeof TOOL_REGISTRY)[string];

const testToolPrefix = "__phase_filter_test_";

function registerTestTool(name: string, category: string): void {
  TOOL_REGISTRY[name] = {
    description: `test tool (${category})`,
    parameters: {},
    category,
    safetyLevel: "safe",
    execute: () => ({ success: true, result: "ok" }),
  } as unknown as ToolDefinition;
}

function cleanupTestTools(): void {
  for (const key of Object.keys(TOOL_REGISTRY)) {
    if (key.startsWith(testToolPrefix)) {
      delete TOOL_REGISTRY[key];
    }
  }
}

function makeConfig(
  overrides: Partial<OrchestratorConfig> = {},
): OrchestratorConfig {
  return {
    workspace: "/tmp/phase-test",
    context: new ContextManager({ maxTokens: 4096 }),
    ...overrides,
  } as OrchestratorConfig;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("applyAdaptiveToolPhase skips filtering for standard-tier models", async () => {
  registerTestTool(`${testToolPrefix}read`, "read");
  registerTestTool(`${testToolPrefix}write`, "write");
  try {
    const state = makeLoopState({ lastToolNames: [] });
    const config = makeConfig({ modelTier: "standard" });
    const phase = await applyAdaptiveToolPhase(state, config, "fix the bug");
    assertEquals(effectiveAllowlist(config), undefined);
    assertEquals(typeof phase, "string");
  } finally {
    cleanupTestTools();
  }
});

Deno.test("applyAdaptiveToolPhase skips filtering for enhanced-tier models", async () => {
  registerTestTool(`${testToolPrefix}read`, "read");
  registerTestTool(`${testToolPrefix}shell`, "shell");
  try {
    const state = makeLoopState({ lastToolNames: [] });
    const config = makeConfig({ modelTier: "enhanced" });
    await applyAdaptiveToolPhase(state, config, "run the tests");
    assertEquals(effectiveAllowlist(config), undefined);
  } finally {
    cleanupTestTools();
  }
});

Deno.test("applyAdaptiveToolPhase applies filtering for constrained-tier models", async () => {
  registerTestTool(`${testToolPrefix}read`, "read");
  registerTestTool(`${testToolPrefix}write`, "write");
  try {
    const state = makeLoopState({ lastToolNames: [] });
    const config = makeConfig({
      modelTier: "constrained",
      toolAllowlist: [`${testToolPrefix}read`, `${testToolPrefix}write`],
    });
    await applyAdaptiveToolPhase(state, config, "read the file");
    assertEquals(Array.isArray(effectiveAllowlist(config)), true);
  } finally {
    cleanupTestTools();
  }
});

Deno.test("applyAdaptiveToolPhase decrements and expires the temporary Playwright denylist across turns", async () => {
  registerTestTool(`${testToolPrefix}read`, "read");
  try {
    const state = makeLoopState({
      playwright: {
        repeatFailureCount: 0,
        repeatVisualLoopCount: 0,
        notifiedVisualLoop: false,
        finalAnswerRetries: 0,
        temporaryToolDenylist: new Map([["pw_click", 2]]),
      },
    });
    const config = makeConfig({
      modelTier: "constrained",
      toolAllowlist: [`${testToolPrefix}read`, "pw_click"],
    });

    await applyAdaptiveToolPhase(state, config, "read the file");
    assertEquals(state.playwright.temporaryToolDenylist.get("pw_click"), 1);

    await applyAdaptiveToolPhase(state, config, "read the file");
    assertEquals(state.playwright.temporaryToolDenylist.has("pw_click"), false);
  } finally {
    cleanupTestTools();
  }
});

Deno.test("constrained-model EDIT phase includes shell category", () => {
  assertEquals(EDIT_PHASE_CATEGORIES.has("shell"), true);
});

Deno.test("constrained-model VERIFY phase includes write category", () => {
  assertEquals(VERIFY_PHASE_CATEGORIES.has("write"), true);
});

Deno.test("constrained-model COMPLETE phase includes shell category", () => {
  assertEquals(COMPLETE_PHASE_CATEGORIES.has("shell"), true);
});

Deno.test("tool_search narrowing uses baseline allowlist", async () => {
  // Simulate that tool_search narrows against the baseline, not the
  // phase-filtered subset. We import handlePostToolExecution and verify
  // the intersection uses the baseline.
  const { handlePostToolExecution } = await import(
    "../../../src/hlvm/agent/orchestrator-response.ts"
  );
  const { resolveLoopConfig } = await import(
    "../../../src/hlvm/agent/orchestrator-state.ts"
  );

  const readTool = `${testToolPrefix}read_tool`;
  const writeTool = `${testToolPrefix}write_tool`;
  const searchTool = "tool_search";

  registerTestTool(readTool, "read");
  registerTestTool(writeTool, "write");

  try {
    const state = makeLoopState({ lastToolNames: [searchTool] });
    const config = makeConfig({
      modelTier: "constrained",
      // Baseline includes both tools; phase filtering might exclude write.
      toolAllowlist: [readTool, writeTool, searchTool],
    });
    const lc = resolveLoopConfig(config);

    // Simulate tool_search returning writeTool in its result.
    const result = {
      toolCallsMade: 1,
      results: [{
        success: true,
        result: { matches: [{ name: writeTool }] },
      }],
      toolCalls: [{ toolName: searchTool, args: { query: "write" }, id: "tc-1" }],
      toolUses: [],
      toolBytes: 0,
    };

    const llmFn = async () => ({ content: "", toolCalls: [] });
    await handlePostToolExecution(result, state, lc, config, llmFn);

    // After tool_search, writeTool should be in the allowlist because the
    // baseline includes it (even though the phase-filtered set did not).
    const allowlist = effectiveAllowlist(config);
    assertEquals(
      allowlist?.includes(writeTool),
      true,
      `Expected ${writeTool} in allowlist after tool_search narrows against baseline`,
    );
  } finally {
    cleanupTestTools();
  }
});

Deno.test("tool_search narrowing does not persist via toolSearchAllowlist", async () => {
  const { handlePostToolExecution } = await import(
    "../../../src/hlvm/agent/orchestrator-response.ts"
  );
  const { resolveLoopConfig } = await import(
    "../../../src/hlvm/agent/orchestrator-state.ts"
  );

  const readTool = `${testToolPrefix}read_tool2`;
  const searchTool = "tool_search";

  registerTestTool(readTool, "read");

  try {
    const state = makeLoopState({ lastToolNames: [searchTool] });
    const config = makeConfig({
      modelTier: "constrained",
      toolAllowlist: [readTool, searchTool],
      toolProfileState: createToolProfileState({
        baseline: {
          slot: "baseline",
          allowlist: [readTool, searchTool],
        },
      }),
    });
    const lc = resolveLoopConfig(config);

    const result = {
      toolCallsMade: 1,
      results: [{
        success: true,
        result: { matches: [{ name: readTool }] },
      }],
      toolCalls: [{ toolName: searchTool, args: { query: "read" }, id: "tc-2" }],
      toolUses: [],
      toolBytes: 0,
    };

    const llmFn = async () => ({ content: "", toolCalls: [] });
    await handlePostToolExecution(result, state, lc, config, llmFn);

    // Verify toolSearchAllowlist property does NOT exist on state
    assertEquals(
      "toolSearchAllowlist" in state,
      false,
      "toolSearchAllowlist should not exist on LoopState",
    );
  } finally {
    cleanupTestTools();
  }
});

Deno.test("tool_search discovery can expand the session baseline before turn-local narrowing", async () => {
  const { handlePostToolExecution } = await import(
    "../../../src/hlvm/agent/orchestrator-response.ts"
  );
  const { resolveLoopConfig } = await import(
    "../../../src/hlvm/agent/orchestrator-state.ts"
  );

  const searchTool = "tool_search";
  const deferredTool = "search_web";

  const state = makeLoopState({ lastToolNames: [searchTool] });
  const config = makeConfig({
    modelTier: "standard",
    toolAllowlist: [searchTool],
    toolProfileState: createToolProfileState({
      baseline: {
        slot: "baseline",
        allowlist: [searchTool],
      },
    }),
    onToolSearchDiscovered: () => [searchTool, deferredTool],
  });
  const lc = resolveLoopConfig(config);

  const result = {
    toolCallsMade: 1,
    results: [{
      success: true,
      result: { matches: [{ name: deferredTool }] },
    }],
    toolCalls: [{ toolName: searchTool, args: { query: "web search" }, id: "tc-3" }],
    toolUses: [],
    toolBytes: 0,
  };

  const llmFn = async () => ({ content: "", toolCalls: [] });
  await handlePostToolExecution(result, state, lc, config, llmFn);

  assertEquals(
    resolvePersistentToolFilter(config.toolProfileState!).allowlist?.includes(
      deferredTool,
    ),
    true,
  );
  assertEquals(effectiveAllowlist(config)?.includes(deferredTool), true);
});
