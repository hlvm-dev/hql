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
import { TOOL_REGISTRY } from "../../../src/hlvm/agent/registry.ts";
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
    lastTeamSummarySignature: "",
    lastToolNames: [],
    loopRecoveryStep: 0,
    temporaryToolDenylist: new Map(),
    continuedThisTurn: false,
    continuationCount: 0,
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
    toolFilterState: { allowlist: undefined, denylist: undefined },
    ...overrides,
  } as OrchestratorConfig;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("applyAdaptiveToolPhase skips filtering for mid-tier models", () => {
  registerTestTool(`${testToolPrefix}read`, "read");
  registerTestTool(`${testToolPrefix}write`, "write");
  try {
    const state = makeLoopState({ lastToolNames: [] });
    const config = makeConfig({ modelTier: "mid" });
    const phase = applyAdaptiveToolPhase(state, config, "fix the bug");
    // Phase is derived but tool filtering is NOT applied —
    // toolFilterState.allowlist remains undefined.
    assertEquals(config.toolFilterState?.allowlist, undefined);
    assertEquals(typeof phase, "string");
  } finally {
    cleanupTestTools();
  }
});

Deno.test("applyAdaptiveToolPhase skips filtering for frontier-tier models", () => {
  registerTestTool(`${testToolPrefix}read`, "read");
  registerTestTool(`${testToolPrefix}shell`, "shell");
  try {
    const state = makeLoopState({ lastToolNames: [] });
    const config = makeConfig({ modelTier: "frontier" });
    applyAdaptiveToolPhase(state, config, "run the tests");
    assertEquals(config.toolFilterState?.allowlist, undefined);
  } finally {
    cleanupTestTools();
  }
});

Deno.test("applyAdaptiveToolPhase applies filtering for weak-tier models", () => {
  registerTestTool(`${testToolPrefix}read`, "read");
  registerTestTool(`${testToolPrefix}write`, "write");
  try {
    const state = makeLoopState({ lastToolNames: [] });
    const config = makeConfig({ modelTier: "weak" });
    applyAdaptiveToolPhase(state, config, "read the file");
    // For weak models, phase filtering IS applied — allowlist gets populated.
    assertEquals(Array.isArray(config.toolFilterState?.allowlist), true);
  } finally {
    cleanupTestTools();
  }
});

Deno.test("weak-model EDIT phase includes shell category", () => {
  assertEquals(EDIT_PHASE_CATEGORIES.has("shell"), true);
});

Deno.test("weak-model VERIFY phase includes write category", () => {
  assertEquals(VERIFY_PHASE_CATEGORIES.has("write"), true);
});

Deno.test("weak-model COMPLETE phase includes shell category", () => {
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
      modelTier: "weak",
      // Baseline includes both tools; phase filtering might exclude write.
      toolFilterBaseline: {
        allowlist: [readTool, writeTool, searchTool],
        denylist: undefined,
      },
      // Current effective allowlist is narrowed by phase to just read.
      toolAllowlist: [readTool, searchTool],
      toolFilterState: {
        allowlist: [readTool, searchTool],
        denylist: undefined,
      },
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
    const allowlist = config.toolFilterState?.allowlist ?? config.toolAllowlist;
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
      modelTier: "weak",
      toolFilterBaseline: {
        allowlist: [readTool, searchTool],
        denylist: undefined,
      },
      toolAllowlist: [readTool, searchTool],
      toolFilterState: {
        allowlist: [readTool, searchTool],
        denylist: undefined,
      },
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
