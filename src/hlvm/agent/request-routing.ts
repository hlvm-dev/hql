import type { ModelTier } from "./constants.ts";
import {
  type DelegationSignal,
  detectDeterministicBrowserAutomation,
  detectDeterministicDelegation,
} from "./delegation-heuristics.ts";
import { hasDeterministicPlanningCue } from "./planning.ts";
import { isMainThreadQuerySource } from "./query-tool-routing.ts";
import { extractMentionedFilePaths } from "./request-paths.ts";
import {
  type AllClassification,
  classifyAll,
  type TaskClassification,
} from "../runtime/local-llm.ts";

export type RoutingBehavior = "self_directed" | "assisted";
export type RoutingProvenance =
  | "main_thread"
  | "self_directed_structural"
  | "assisted_classify_all";

export interface RoutingResult {
  tier: ModelTier;
  behavior: RoutingBehavior;
  provenance: RoutingProvenance;
  taskDomain: DelegationSignal["taskDomain"];
  shouldDelegate: boolean;
  delegatePattern: DelegationSignal["suggestedPattern"];
  estimatedSubtasks?: number;
  needsPlan: boolean;
  taskClassification: TaskClassification | null;
  reason: string;
}

export function routingBehaviorForTier(tier: ModelTier): RoutingBehavior {
  return tier === "enhanced" ? "self_directed" : "assisted";
}

export function delegationSignalFromRoutingResult(
  routing: RoutingResult,
): DelegationSignal {
  return {
    shouldDelegate: routing.shouldDelegate,
    reason: routing.reason,
    suggestedPattern: routing.delegatePattern,
    taskDomain: routing.taskDomain,
    estimatedSubtasks: routing.estimatedSubtasks,
  };
}

function buildBaseRoutingResult(
  tier: ModelTier,
  behavior: RoutingBehavior,
  provenance: RoutingProvenance,
  taskClassification: TaskClassification | null,
  needsPlan: boolean,
): RoutingResult {
  return {
    tier,
    behavior,
    provenance,
    taskDomain: "general",
    shouldDelegate: false,
    delegatePattern: "none",
    needsPlan,
    taskClassification,
    reason: "No strong routing signal detected",
  };
}

function uniqueMentionedFileCount(query: string): number {
  return new Set(extractMentionedFilePaths(query)).size;
}

export async function computeRoutingResult(options: {
  query: string;
  tier: ModelTier;
  querySource?: string;
  preComputedClassification?: AllClassification;
}): Promise<RoutingResult> {
  const trimmed = options.query.trim();
  const behavior = routingBehaviorForTier(options.tier);
  const classification = options.preComputedClassification ??
    (
      behavior === "assisted" && trimmed
        ? await classifyAll(trimmed)
        : undefined
    );
  const taskClassification = classification?.taskClassification ?? null;
  const needsPlan = hasDeterministicPlanningCue(trimmed) ||
    classification?.needsPlan === true;
  const base = buildBaseRoutingResult(
    options.tier,
    behavior,
    behavior === "self_directed"
      ? "self_directed_structural"
      : "assisted_classify_all",
    taskClassification,
    needsPlan,
  );

  if (!trimmed) {
    return {
      ...base,
      reason: "Empty request",
    };
  }

  if (isMainThreadQuerySource(options.querySource)) {
    return {
      ...base,
      provenance: "main_thread",
      reason: "Main-thread query source disables request-time delegation",
    };
  }

  const uniqueFileCount = uniqueMentionedFileCount(trimmed);
  if (uniqueFileCount >= 3) {
    return {
      ...base,
      shouldDelegate: true,
      delegatePattern: "fan-out",
      estimatedSubtasks: uniqueFileCount,
      reason: `${uniqueFileCount} distinct file paths detected`,
    };
  }

  if (detectDeterministicBrowserAutomation(trimmed)) {
    return {
      ...base,
      taskDomain: "browser",
      reason: "Deterministic browser cue detected",
    };
  }

  const structuralDelegation = detectDeterministicDelegation(
    trimmed,
    uniqueFileCount,
  );
  if (structuralDelegation) {
    return {
      ...base,
      shouldDelegate: structuralDelegation.shouldDelegate,
      delegatePattern: structuralDelegation.suggestedPattern,
      taskDomain: structuralDelegation.taskDomain,
      estimatedSubtasks: structuralDelegation.estimatedSubtasks,
      reason: structuralDelegation.reason,
    };
  }

  if (behavior === "self_directed") {
    return base;
  }

  if (!classification) {
    return base;
  }

  if (classification.isBrowser) {
    return {
      ...base,
      taskDomain: "browser",
      reason: "classifyAll detected browser intent",
    };
  }

  if (!classification.shouldDelegate) {
    return {
      ...base,
      reason: "classifyAll found no strong delegation signal",
    };
  }

  return {
    ...base,
    shouldDelegate: true,
    delegatePattern: classification.delegatePattern,
    estimatedSubtasks: uniqueFileCount || 2,
    reason:
      `classifyAll classified as ${classification.delegatePattern} delegation`,
  };
}
