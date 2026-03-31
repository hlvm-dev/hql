/**
 * Routing Eval Tests — runs 37 deterministic eval cases against buildExecutionSurface
 */

import { assertEquals } from "jsr:@std/assert";
import { ROUTING_EVAL_CASES } from "./routing-eval-cases.ts";
import {
  evaluateRoutingDecision,
  type RoutingEvalCase,
  type RoutingEvalResult,
} from "../../src/hlvm/agent/routing-eval.ts";
import { buildExecutionSurface } from "../../src/hlvm/agent/execution-surface.ts";
import type { ExecutionTurnContext } from "../../src/hlvm/agent/turn-context.ts";
import type {
  ResolvedProviderExecutionPlan,
  ResolvedWebCapabilityPlan,
  ResolvedRemoteExecutionCapability,
} from "../../src/hlvm/agent/tool-capabilities.ts";
import { selectReasoningPathForTurn } from "../../src/hlvm/agent/reasoning-selector.ts";

// Side-effect import: registers all providers so reasoning selector can
// look up provider capability profiles during eval.
import "../../src/hlvm/providers/index.ts";

// ============================================================================
// Test fixture builders
// ============================================================================

/** Build a minimal ResolvedProviderExecutionPlan for eval */
function buildEvalPlan(
  providerName: string,
  options: {
    hasWebSearch?: boolean;
    hasWebRead?: boolean;
    hasCodeExec?: boolean;
    hasComputerUse?: boolean;
  } = {},
): ResolvedProviderExecutionPlan {
  const webCapabilities: ResolvedWebCapabilityPlan["capabilities"] = {
    web_search: {
      id: "web_search",
      selectors: [],
      customToolName: "web_search",
      nativeToolName: options.hasWebSearch ? "google_web_search" : undefined,
      implementation: options.hasWebSearch ? "native" : "custom",
      activeToolName: options.hasWebSearch ? "google_web_search" : "search_web",
      citationBacked: false,
      rawPayloadCitationEligible: false,
    },
    web_page_read: {
      id: "web_page_read",
      selectors: [],
      customToolName: "web_page_read",
      nativeToolName: options.hasWebRead ? "url_context" : undefined,
      implementation: options.hasWebRead ? "native" : "custom",
      activeToolName: options.hasWebRead ? "url_context" : "web_fetch",
      citationBacked: false,
      rawPayloadCitationEligible: false,
    },
    raw_url_fetch: {
      id: "raw_url_fetch",
      selectors: [],
      customToolName: "raw_url_fetch",
      implementation: "disabled",
      citationBacked: false,
      rawPayloadCitationEligible: false,
    },
  };

  const remoteCodeExecution: ResolvedRemoteExecutionCapability = {
    id: "remote_code_execution",
    selectors: [],
    customToolName: "code_exec",
    nativeToolName: options.hasCodeExec ? "code_execution" : "",
    implementation: options.hasCodeExec ? "native" : "disabled",
    activeToolName: options.hasCodeExec ? "code_execution" : undefined,
    description: "Remote code execution",
  };

  return {
    providerName,
    routingProfile: "conservative",
    web: {
      providerName,
      capabilities: webCapabilities,
    },
    remoteCodeExecution,
    computerUse: {
      available: options.hasComputerUse ?? false,
      activeToolName: options.hasComputerUse ? "computer" : undefined,
    },
  };
}

/** Build a turn context from eval case */
function buildEvalTurnContext(evalCase: RoutingEvalCase): ExecutionTurnContext {
  const visionCount = evalCase.visionAttachmentCount ?? 0;
  const audioCount = evalCase.audioAttachmentCount ?? 0;
  return {
    attachmentCount: visionCount + audioCount,
    attachmentKinds: [
      ...Array(visionCount).fill("image"),
      ...Array(audioCount).fill("audio"),
    ],
    visionEligibleAttachmentCount: visionCount,
    visionEligibleKinds: visionCount > 0 ? ["image"] : [],
    audioEligibleAttachmentCount: audioCount,
    audioEligibleKinds: audioCount > 0 ? ["audio"] : [],
  };
}

/** Determine if a provider has web tools */
function providerHasWebTools(name: string): boolean {
  return ["google", "anthropic", "openai", "claude-code"].includes(name);
}

/** Determine if a provider has code exec */
function providerHasCodeExec(name: string): boolean {
  return ["google", "anthropic", "claude-code"].includes(name);
}

/** Determine if a provider has computer.use */
function providerHasComputerUse(name: string): boolean {
  return ["anthropic", "claude-code"].includes(name);
}

/** Build execution surface from an eval case */
function buildSurfaceForEval(evalCase: RoutingEvalCase) {
  const hasWeb = providerHasWebTools(evalCase.pinnedProviderName);
  const hasCode = providerHasCodeExec(evalCase.pinnedProviderName);
  const hasComputer = providerHasComputerUse(evalCase.pinnedProviderName);
  const plan = buildEvalPlan(evalCase.pinnedProviderName, {
    hasWebSearch: hasWeb,
    hasWebRead: hasWeb,
    hasCodeExec: hasCode,
    hasComputerUse: hasComputer,
  });

  const turnContext = buildEvalTurnContext(evalCase);

  // Determine vision/audio direct kinds based on provider
  const isCloudWithVision = ["google", "anthropic", "openai", "claude-code"].includes(
    evalCase.pinnedProviderName,
  );
  const isGoogleWithAudio = evalCase.pinnedProviderName === "google";

  const directVisionKinds = isCloudWithVision && turnContext.visionEligibleAttachmentCount > 0
    ? (["image"] as const)
    : ([] as const);
  const directAudioKinds = isGoogleWithAudio && turnContext.audioEligibleAttachmentCount > 0
    ? (["audio"] as const)
    : ([] as const);

  const taskCapabilityContext = {
    requestedCapabilities: (evalCase.requestedCapabilities ?? []) as import("../../src/hlvm/agent/semantic-capabilities.ts").SemanticCapabilityId[],
    source: "none" as const,
    matchedCueLabels: [] as string[],
  };

  const providerStatuses = [
    { providerName: evalCase.pinnedProviderName, available: true, isPinned: true },
    ...(evalCase.pinnedProviderName !== "google" ? [{ providerName: "google", available: true, isPinned: false }] : []),
    ...(evalCase.pinnedProviderName !== "anthropic" ? [{ providerName: "anthropic", available: true, isPinned: false }] : []),
    ...(evalCase.pinnedProviderName !== "openai" ? [{ providerName: "openai", available: true, isPinned: false }] : []),
  ];

  const surface = buildExecutionSurface({
    runtimeMode: evalCase.runtimeMode,
    activeModelId: evalCase.pinnedModelId,
    pinnedProviderName: evalCase.pinnedProviderName,
    providerExecutionPlan: plan,
    constraints: evalCase.constraints,
    taskCapabilityContext,
    responseShapeContext: evalCase.responseShapeContext,
    turnContext,
    computerUseRequested: evalCase.computerUseRequested,
    providerNativeStructuredOutputAvailable: evalCase.providerNativeStructuredOutputAvailable,
    directVisionKinds,
    directAudioKinds,
    localCodeExecAvailable: true,
    localVisionAvailable: evalCase.localVisionAvailable,
    providers: providerStatuses,
    mcpCandidates: evalCase.mcpCandidates,
  });

  // Run reasoning selection in auto mode
  if (evalCase.runtimeMode === "auto") {
    const availableProviders = providerStatuses
      .filter((p) => p.available)
      .map((p) => p.providerName);

    const localVisionModelId = evalCase.localVisionModelId ??
      (evalCase.localVisionAvailable ? "ollama/llava:latest" : undefined);

    const selection = selectReasoningPathForTurn({
      pinnedModelId: evalCase.pinnedModelId,
      pinnedProviderName: evalCase.pinnedProviderName,
      surface,
      availableProviders,
      turnContext,
      computerUseRequested: evalCase.computerUseRequested,
      localVisionModelId,
    });

    if (selection) {
      surface.reasoningSelection = selection;
    }
  }

  return surface;
}

// ============================================================================
// Test runner
// ============================================================================

// Run each eval case as an individual Deno test
for (const evalCase of ROUTING_EVAL_CASES) {
  Deno.test(`routing eval [${evalCase.dimension}] ${evalCase.id}: ${evalCase.name}`, () => {
    const surface = buildSurfaceForEval(evalCase);
    const result = evaluateRoutingDecision(evalCase, surface);

    if (!result.passed) {
      const failureReport = result.failures.join("\n  ");
      throw new Error(
        `Eval case ${result.caseId} (${result.caseName}) FAILED:\n  ${failureReport}`,
      );
    }
  });
}

// Summary test
Deno.test("routing eval: all 40 cases defined and structured", () => {
  assertEquals(ROUTING_EVAL_CASES.length, 40);

  // Verify all 7 dimensions are covered
  const dimensions = new Set(ROUTING_EVAL_CASES.map((c) => c.dimension));
  assertEquals(dimensions.size, 7);
  assertEquals(dimensions.has("privacy"), true);
  assertEquals(dimensions.has("locality"), true);
  assertEquals(dimensions.has("capability-fit"), true);
  assertEquals(dimensions.has("quality"), true);
  assertEquals(dimensions.has("cost"), true);
  assertEquals(dimensions.has("availability"), true);
  assertEquals(dimensions.has("mcp-fallback"), true);

  // Verify unique IDs
  const ids = ROUTING_EVAL_CASES.map((c) => c.id);
  assertEquals(new Set(ids).size, ids.length, "Duplicate eval case IDs found");
});
