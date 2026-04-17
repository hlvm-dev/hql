import { assertEquals } from "jsr:@std/assert";
import {
  buildToolSurface,
  buildTurnRouting,
} from "../../../src/hlvm/agent/routing.ts";
import {
  applyAdaptiveToolPhase,
  type LoopState,
  type OrchestratorConfig,
} from "../../../src/hlvm/agent/orchestrator.ts";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import { computeFallbackToolFilter } from "../../../src/hlvm/agent/agent-runner.ts";
import { computeTierToolFilter } from "../../../src/hlvm/agent/constants.ts";
import { UsageTracker } from "../../../src/hlvm/agent/usage.ts";

Deno.test("routing builds model-driven tool surface with deferred discovery", () => {
  const surface = buildToolSurface({
    modelTier: "standard",
    eagerTools: ["tool_search", "read_file"],
    deniedTools: ["web_fetch"],
    toolSearchUniverseAllowlist: ["read_file", "web_fetch", "search_web"],
  });

  assertEquals(surface.discovery, "tool_search");
  assertEquals(surface.eagerTools, ["read_file", "tool_search"]);
  assertEquals(surface.deniedTools, ["web_fetch"]);
  assertEquals(surface.deferredTools, ["search_web"]);
});

Deno.test("routing disables meta-tool discovery for constrained models", () => {
  const surface = buildToolSurface({
    modelTier: "constrained",
    eagerTools: ["tool_search", "read_file"],
    toolSearchUniverseAllowlist: ["search_web"],
  });

  assertEquals(surface.discovery, "none");
  assertEquals(surface.deferredTools, []);
});

Deno.test("routing disables discovery when tool_search is not in eager surface", () => {
  const surface = buildToolSurface({
    modelTier: "enhanced",
    eagerTools: ["read_file"],
    toolSearchUniverseAllowlist: ["search_web"],
  });

  assertEquals(surface.discovery, "none");
  assertEquals(surface.deferredTools, []);
});

Deno.test("routing output stays limited to model and capacity boundaries", () => {
  const routing = buildTurnRouting({
    selectedModel: "openai/gpt-5.4",
    modelSource: "explicit",
    modelTier: "enhanced",
    eagerTools: ["tool_search"],
  });

  assertEquals(routing.selectedModel, "openai/gpt-5.4");
  assertEquals(routing.modelSource, "explicit");
  assertEquals(routing.modelTier, "enhanced");
  assertEquals("taskDomain" in routing, false);
  assertEquals("needsPlan" in routing, false);
});

// ---------------------------------------------------------------------------
// Contract tests for routing-adjacent fixes
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

Deno.test("applyAdaptiveToolPhase caches per-turn request heuristics", async () => {
  const state = makeLoopState();
  const config = makeConfig({ modelTier: "standard" });

  assertEquals(state.requestHeuristics, undefined);

  // First call: populates cache from the regex classifiers.
  // "fix the auth bug" matches impliesEditing (fix) and not impliesVerification.
  const phase1 = await applyAdaptiveToolPhase(state, config, "fix the auth bug");
  assertEquals(phase1, "editing");
  assertEquals(state.requestHeuristics?.impliesEditing, true);
  assertEquals(state.requestHeuristics?.impliesVerification, false);

  // Mutate the cache to values that contradict the regex. If the cache is
  // actually being read, the second call must use the mutated values and
  // return "verifying". If the regex re-runs each iteration, it would
  // return "editing" again (and this assertion would fail).
  state.requestHeuristics = {
    impliesEditing: false,
    impliesVerification: true,
  };

  const phase2 = await applyAdaptiveToolPhase(state, config, "fix the auth bug");
  assertEquals(phase2, "verifying");
  // Cache was NOT overwritten by the second call.
  assertEquals(state.requestHeuristics.impliesEditing, false);
  assertEquals(state.requestHeuristics.impliesVerification, true);
});

// ---------------------------------------------------------------------------
// computeFallbackToolFilter — createFallbackLLM's routing boundary.
//
// Two regressions guarded here:
//   (a) historical: a fallback silently LOST in-turn discovered deferred
//       tools, breaking any task that depended on them.
//   (b) recent: a naive "preserve primary persistent filter" approach
//       overscoped the fallback — the primary's enhanced baseline +
//       hybrid cu_* tools leaked into a smaller fallback's surface.
//
// The contract: (fallback's own tier surface) ∪ (session discoveries),
// with an empty explicit allowlist preserved as zero.
// ---------------------------------------------------------------------------

Deno.test("fallback: native tier surface is the floor when user is implicit", () => {
  const model = "ollama/gemma4:e2b";
  const filter = computeFallbackToolFilter({
    fallbackModel: model,
    requestedToolAllowlist: undefined,
    effectiveToolDenylist: [],
    discoveredDeferredTools: [],
  });

  const nativeSurface =
    computeTierToolFilter(filter.tier, undefined, []).allowlist!;
  assertEquals(
    filter.allowlist?.sort(),
    [...nativeSurface].sort(),
    "native tier surface must be used when user was implicit and no discoveries",
  );
});

Deno.test("fallback: does NOT inherit the primary's hybrid domain-layer tools", () => {
  // Browser hybrid promotion widens the primary's baseline layer with cu_*
  // tools (see widenBaselineForDomainProfile). My earlier fix mistakenly
  // passed resolvePersistentToolFilter(session.toolProfileState).allowlist
  // through computeTierToolFilter, which does not intersect with tier cap —
  // so the fallback inherited cu_* tools it can't use.
  //
  // The fix pins the invariant: cu_* (and any other primary-baseline-only
  // additions) are NOT inherited. Only session.discoveredDeferredTools
  // crosses the boundary.
  const filter = computeFallbackToolFilter({
    fallbackModel: "ollama/gemma4:e2b",
    requestedToolAllowlist: undefined,
    effectiveToolDenylist: [],
    discoveredDeferredTools: [], // cu_* came from hybrid promotion, not discovery
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
  // Native tier floor still there.
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
