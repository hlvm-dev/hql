import type { ModelTier } from "./constants.ts";
import { getDeferredToolNames } from "./registry.ts";

export type TurnModelSource = "explicit" | "auto";
export type ToolDiscoveryMode = "tool_search" | "none";

export interface ToolSurface {
  eagerTools: string[];
  deferredTools: string[];
  deniedTools: string[];
  discovery: ToolDiscoveryMode;
}

export interface TurnRouting {
  selectedModel: string;
  modelSource: TurnModelSource;
  modelTier: ModelTier;
  toolSurface: ToolSurface;
  reason: string;
}

export interface BuildTurnRoutingOptions {
  selectedModel: string;
  modelSource: TurnModelSource;
  modelTier: ModelTier;
  eagerTools?: readonly string[];
  deniedTools?: readonly string[];
  toolOwnerId?: string;
  toolSearchUniverseAllowlist?: readonly string[];
}

function uniqueSorted(items: Iterable<string>): string[] {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b));
}

export function buildToolSurface(
  options: Pick<
    BuildTurnRoutingOptions,
    | "modelTier"
    | "eagerTools"
    | "deniedTools"
    | "toolOwnerId"
    | "toolSearchUniverseAllowlist"
  >,
): ToolSurface {
  const eagerTools = uniqueSorted(options.eagerTools ?? []);
  const deniedTools = uniqueSorted(options.deniedTools ?? []);
  const eagerSet = new Set(eagerTools);
  const deniedSet = new Set(deniedTools);
  const universeSet = options.toolSearchUniverseAllowlist
    ? new Set(options.toolSearchUniverseAllowlist)
    : null;
  const discovery: ToolDiscoveryMode =
    options.modelTier !== "constrained" && eagerSet.has("tool_search")
      ? "tool_search"
      : "none";
  const deferredTools = discovery === "tool_search"
    ? uniqueSorted(
      getDeferredToolNames(options.toolOwnerId).filter((name) =>
        (!universeSet || universeSet.has(name)) &&
        !eagerSet.has(name) &&
        !deniedSet.has(name)
      ),
    )
    : [];

  return {
    eagerTools,
    deferredTools,
    deniedTools,
    discovery,
  };
}

export function buildTurnRouting(
  options: BuildTurnRoutingOptions,
): TurnRouting {
  const toolSurface = buildToolSurface(options);
  const discoveryLabel = toolSurface.discovery === "tool_search"
    ? `${toolSurface.deferredTools.length} deferred tools via tool_search`
    : "no tool discovery";
  return {
    selectedModel: options.selectedModel,
    modelSource: options.modelSource,
    modelTier: options.modelTier,
    toolSurface,
    reason:
      `Model-driven routing: ${options.modelSource} model, ${options.modelTier} tier, ${toolSurface.eagerTools.length} eager tools, ${discoveryLabel}`,
  };
}
