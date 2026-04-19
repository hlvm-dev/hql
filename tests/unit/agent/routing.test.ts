import { assertEquals } from "jsr:@std/assert";
import {
  applyAdaptiveToolPhase,
  type LoopState,
  type OrchestratorConfig,
} from "../../../src/hlvm/agent/orchestrator.ts";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import { computeFallbackToolFilter } from "../../../src/hlvm/agent/agent-runner.ts";
import { starterPolicy } from "../../../src/hlvm/agent/constants.ts";
import { UsageTracker } from "../../../src/hlvm/agent/usage.ts";
import { getPlatform } from "../../../src/platform/platform.ts";

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

function makeConfig(
  overrides: Partial<OrchestratorConfig> = {},
): OrchestratorConfig {
  return {
    workspace: "/tmp/routing-test",
    context: new ContextManager({ maxTokens: 4096 }),
    ...overrides,
  } as OrchestratorConfig;
}

Deno.test("applyAdaptiveToolPhase caches per-turn request phase classification", async () => {
  const platform = getPlatform();
  const previous = platform.env.get("HLVM_DISABLE_AI_AUTOSTART");
  platform.env.set("HLVM_DISABLE_AI_AUTOSTART", "1");
  try {
    const state = makeLoopState();
    const config = makeConfig({ modelCapability: "agent" });

    assertEquals(state.requestPhaseClassification, undefined);

    const phase1 = await applyAdaptiveToolPhase(
      state,
      config,
      "fix the auth bug",
    );
    assertEquals(phase1, "editing");
    assertEquals(state.requestPhaseClassification?.phase, "editing");

    state.requestPhaseClassification = { phase: "verifying" };

    const phase2 = await applyAdaptiveToolPhase(
      state,
      config,
      "fix the auth bug",
    );
    assertEquals(phase2, "verifying");
    assertEquals(state.requestPhaseClassification.phase, "verifying");
  } finally {
    if (previous === undefined) {
      platform.env.delete("HLVM_DISABLE_AI_AUTOSTART");
    } else {
      platform.env.set("HLVM_DISABLE_AI_AUTOSTART", previous);
    }
  }
});

Deno.test("fallback: native capability-class starter is the floor when user is implicit", () => {
  const model = "ollama/gemma4:e2b";
  const filter = computeFallbackToolFilter({
    fallbackModel: model,
    requestedToolAllowlist: undefined,
    effectiveToolDenylist: [],
    discoveredDeferredTools: [],
  });

  const nativeSurface =
    starterPolicy(filter.capability, undefined, []).allowlist!;
  assertEquals(
    filter.allowlist?.sort(),
    [...nativeSurface].sort(),
    "native starter policy must be used when user was implicit and no discoveries",
  );
});

Deno.test("fallback: does NOT inherit the primary's hybrid domain-layer tools", () => {
  const filter = computeFallbackToolFilter({
    fallbackModel: "ollama/gemma4:e2b",
    requestedToolAllowlist: undefined,
    effectiveToolDenylist: [],
    discoveredDeferredTools: [],
  });

  assertEquals(filter.allowlist?.some((t) => t.startsWith("cu_")), false);
});

Deno.test("fallback: merges in-turn discovered deferred tools onto tier floor", () => {
  const filter = computeFallbackToolFilter({
    fallbackModel: "ollama/gemma4:e2b",
    requestedToolAllowlist: undefined,
    effectiveToolDenylist: [],
    discoveredDeferredTools: ["__test_data_query", "__test_data_summary"],
  });

  assertEquals(filter.allowlist?.includes("__test_data_query"), true);
  assertEquals(filter.allowlist?.includes("__test_data_summary"), true);
  assertEquals(filter.allowlist?.includes("read_file"), true);
});

Deno.test("fallback: user-explicit allowlist is respected and discoveries are merged", () => {
  const filter = computeFallbackToolFilter({
    fallbackModel: "ollama/gemma4:e2b",
    requestedToolAllowlist: ["read_file", "web_fetch"],
    effectiveToolDenylist: [],
    discoveredDeferredTools: ["fetch_url"],
  });

  assertEquals(
    filter.allowlist?.sort(),
    ["fetch_url", "read_file", "web_fetch"],
  );
});

Deno.test("fallback: user-explicit EMPTY allowlist is preserved as zero tools", () => {
  const filter = computeFallbackToolFilter({
    fallbackModel: "ollama/gemma4:e2b",
    requestedToolAllowlist: [],
    effectiveToolDenylist: [],
    discoveredDeferredTools: ["fetch_url"],
  });

  assertEquals(filter.allowlist, []);
});

Deno.test("fallback: denylist is threaded through from effectiveToolDenylist", () => {
  const filter = computeFallbackToolFilter({
    fallbackModel: "ollama/gemma4:e2b",
    requestedToolAllowlist: undefined,
    effectiveToolDenylist: ["complete_task"],
    discoveredDeferredTools: [],
  });

  assertEquals(filter.denylist, ["complete_task"]);
});
