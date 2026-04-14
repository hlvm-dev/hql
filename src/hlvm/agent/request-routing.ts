import type { ModelTier } from "./constants.ts";
import { hasDeterministicPlanningCue } from "./planning.ts";
import { isMainThreadQuerySource } from "./query-tool-routing.ts";
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

export type TaskDomain = "general" | "code" | "browser" | "data";

export interface RoutingResult {
  tier: ModelTier;
  behavior: RoutingBehavior;
  provenance: RoutingProvenance;
  taskDomain: TaskDomain;
  needsPlan: boolean;
  taskClassification: TaskClassification | null;
  reason: string;
}

export function routingBehaviorForTier(tier: ModelTier): RoutingBehavior {
  return tier === "enhanced" ? "self_directed" : "assisted";
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
    needsPlan,
    taskClassification,
    reason: "No strong routing signal detected",
  };
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
      reason: "Main-thread query source",
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

  return {
    ...base,
    reason: "classifyAll routing",
  };
}
