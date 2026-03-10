import { extractModelSuffix, extractProviderName } from "./constants.ts";
import type { ReplAgentExecutionMode } from "./execution-mode.ts";
import type { RuntimeModelDiscoveryResponse } from "../runtime/model-protocol.ts";
import type { ModelInfo } from "../providers/types.ts";

export type ReplAgentExecutionModeModelOverrides = Partial<
  Record<ReplAgentExecutionMode, string>
>;

export interface ExecutionModeModelDetails {
  id: string;
  displayName: string;
  contextWindow?: number;
  parameterSize?: string;
}

export interface ResolvedExecutionModeModels {
  byMode: Partial<Record<ReplAgentExecutionMode, ExecutionModeModelDetails>>;
}

interface ModelCandidate extends ExecutionModeModelDetails {}

function getModelProvider(model: ModelInfo): string {
  if (typeof model.metadata?.provider === "string" && model.metadata.provider) {
    return model.metadata.provider;
  }
  return extractProviderName(model.name);
}

function toCanonicalModelId(model: ModelInfo): string {
  if (model.name.includes("/")) return model.name;
  return `${getModelProvider(model)}/${model.name}`;
}

function toCandidate(model: ModelInfo): ModelCandidate {
  const id = toCanonicalModelId(model);
  return {
    id,
    displayName: model.displayName ?? extractModelSuffix(id),
    contextWindow: model.contextWindow,
    parameterSize: model.parameterSize,
  };
}

function mergeCandidate(
  current: ModelCandidate,
  incoming: ModelCandidate,
): ModelCandidate {
  return {
    ...current,
    displayName: current.displayName || incoming.displayName,
    contextWindow: current.contextWindow ?? incoming.contextWindow,
    parameterSize: current.parameterSize ?? incoming.parameterSize,
  };
}

function buildCandidateMap(
  discovery: RuntimeModelDiscoveryResponse | undefined,
  configuredModelId?: string,
): Map<string, ModelCandidate> {
  const byId = new Map<string, ModelCandidate>();
  const discoveredModels = discovery
    ? [
      ...discovery.installedModels,
      ...discovery.remoteModels,
      ...discovery.cloudModels,
    ]
    : [];

  for (const model of discoveredModels) {
    const candidate = toCandidate(model);
    const existing = byId.get(candidate.id);
    byId.set(candidate.id, existing ? mergeCandidate(existing, candidate) : candidate);
  }

  if (configuredModelId && !byId.has(configuredModelId)) {
    byId.set(configuredModelId, {
      id: configuredModelId,
      displayName: extractModelSuffix(configuredModelId),
      contextWindow: undefined,
      parameterSize: undefined,
    });
  }

  return byId;
}

function resolveModeModelDetails(
  mode: ReplAgentExecutionMode,
  byId: Map<string, ModelCandidate>,
  configured: ModelCandidate,
  overrides: ReplAgentExecutionModeModelOverrides,
): ExecutionModeModelDetails {
  const overrideId = overrides[mode];
  if (!overrideId) {
    return {
      id: configured.id,
      displayName: configured.displayName,
      contextWindow: configured.contextWindow,
      parameterSize: configured.parameterSize,
    };
  }

  const override = byId.get(overrideId);
  if (!override) {
    return {
      id: overrideId,
      displayName: extractModelSuffix(overrideId),
    };
  }

  return {
    id: override.id,
    displayName: override.displayName,
    contextWindow: override.contextWindow,
    parameterSize: override.parameterSize,
  };
}

export function resolveExecutionModeModels(
  configuredModelId: string | undefined,
  discovery: RuntimeModelDiscoveryResponse | undefined,
  overrides: ReplAgentExecutionModeModelOverrides = {},
): ResolvedExecutionModeModels {
  if (!configuredModelId) {
    return { byMode: {} };
  }

  const byId = buildCandidateMap(discovery, configuredModelId);
  const configured = byId.get(configuredModelId) ?? {
    id: configuredModelId,
    displayName: extractModelSuffix(configuredModelId),
    contextWindow: undefined,
    parameterSize: undefined,
  };

  return {
    byMode: {
      default: resolveModeModelDetails("default", byId, configured, overrides),
      "auto-edit": resolveModeModelDetails(
        "auto-edit",
        byId,
        configured,
        overrides,
      ),
      plan: resolveModeModelDetails("plan", byId, configured, overrides),
      yolo: resolveModeModelDetails("yolo", byId, configured, overrides),
    },
  };
}

export function getExecutionModeModelForMode(
  mode: ReplAgentExecutionMode,
  resolved: ResolvedExecutionModeModels,
  configuredModelId?: string,
  configuredContextWindow?: number,
): ExecutionModeModelDetails | undefined {
  const modeModel = resolved.byMode[mode];
  if (modeModel) {
    return modeModel;
  }
  if (!configuredModelId) {
    return undefined;
  }
  return {
    id: configuredModelId,
    displayName: extractModelSuffix(configuredModelId),
    contextWindow: configuredContextWindow,
  };
}
