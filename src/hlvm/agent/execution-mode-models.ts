import { extractModelSuffix, extractProviderName } from "./constants.ts";
import type { ReplAgentExecutionMode } from "./execution-mode.ts";
import type { RuntimeModelDiscoveryResponse } from "../runtime/model-protocol.ts";
import type { ModelInfo, ProviderCapability } from "../providers/types.ts";
import { parseModelParameterSize } from "../../common/model-ranking.ts";

export type ReplAgentExecutionModeModelOverrides = Partial<
  Record<ReplAgentExecutionMode, string>
>;

export interface ExecutionModeModelDetails {
  id: string;
  displayName: string;
  contextWindow?: number;
}

export interface ResolvedExecutionModeModels {
  byMode: Partial<Record<ReplAgentExecutionMode, ExecutionModeModelDetails>>;
}

interface ModelCandidate extends ExecutionModeModelDetails {
  provider: string;
  bareName: string;
  family?: string;
  capabilities: Set<ProviderCapability>;
  parameterScore: number;
  accessible: boolean;
  isAgentVariant: boolean;
}

const OPENAI_PLAN_SUFFIX_RANKS = [
  "",
  "-chat",
  "-codex",
  "-pro",
  "-codex-max",
  "-mini",
  "-nano",
] as const;

const OPENAI_YOLO_SUFFIX_RANKS = [
  "-codex-max",
  "-pro",
  "-codex",
  "-high",
  "",
  "-chat",
  "-mini",
  "-nano",
] as const;

const CLAUDE_PLAN_FAMILIES = ["sonnet", "opus", "haiku"] as const;
const CLAUDE_YOLO_FAMILIES = ["opus", "sonnet", "haiku"] as const;
const GOOGLE_PLAN_TOKENS = ["flash", "pro", "lite"] as const;
const GOOGLE_YOLO_TOKENS = ["pro", "flash", "lite"] as const;

function stripAgentSuffix(name: string): string {
  return name.endsWith(":agent") ? name.slice(0, -":agent".length) : name;
}

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

function mergeCapabilities(
  primary: Set<ProviderCapability>,
  secondary?: ProviderCapability[],
): Set<ProviderCapability> {
  if (!secondary?.length) return primary;
  for (const capability of secondary) {
    primary.add(capability);
  }
  return primary;
}

function toCandidate(
  model: ModelInfo,
  configuredModelId?: string,
): ModelCandidate {
  const id = toCanonicalModelId(model);
  const provider = extractProviderName(id);
  const bareName = stripAgentSuffix(extractModelSuffix(id));
  const accessible = provider === "ollama" ||
    model.metadata?.apiKeyConfigured !== false ||
    id === configuredModelId;
  return {
    id,
    displayName: model.displayName ?? extractModelSuffix(id),
    contextWindow: model.contextWindow,
    provider,
    bareName,
    family: model.family,
    capabilities: new Set(model.capabilities ?? []),
    parameterScore: parseModelParameterSize(model.parameterSize),
    accessible,
    isAgentVariant: extractModelSuffix(id).endsWith(":agent"),
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
    family: current.family ?? incoming.family,
    capabilities: mergeCapabilities(
      new Set(current.capabilities),
      [...incoming.capabilities],
    ),
    parameterScore: Math.max(current.parameterScore, incoming.parameterScore),
    accessible: current.accessible || incoming.accessible,
    isAgentVariant: current.isAgentVariant || incoming.isAgentVariant,
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
    const candidate = toCandidate(model, configuredModelId);
    const existing = byId.get(candidate.id);
    byId.set(candidate.id, existing ? mergeCandidate(existing, candidate) : candidate);
  }

  if (configuredModelId && !byId.has(configuredModelId)) {
    byId.set(configuredModelId, {
      id: configuredModelId,
      displayName: extractModelSuffix(configuredModelId),
      contextWindow: undefined,
      provider: extractProviderName(configuredModelId),
      bareName: stripAgentSuffix(extractModelSuffix(configuredModelId)),
      family: undefined,
      capabilities: new Set(),
      parameterScore: -1,
      accessible: true,
      isAgentVariant: extractModelSuffix(configuredModelId).endsWith(":agent"),
    });
  }

  return byId;
}

function getConfiguredCandidate(
  byId: Map<string, ModelCandidate>,
  configuredModelId?: string,
): ModelCandidate | undefined {
  if (!configuredModelId) return undefined;
  return byId.get(configuredModelId);
}

function getToolCapableCandidates(
  byId: Map<string, ModelCandidate>,
  provider: string,
): ModelCandidate[] {
  return [...byId.values()].filter((candidate) =>
    candidate.provider === provider &&
    candidate.accessible &&
    candidate.capabilities.has("tools") &&
    !candidate.bareName.includes("image") &&
    !candidate.bareName.includes("audio")
  );
}

function getOpenAiStem(name: string): string {
  return stripAgentSuffix(name.toLowerCase())
    .replace(/-(codex-max|codex-mini|codex|chat|pro|high|mini|nano)$/, "");
}

function pickOpenAiVariant(
  configured: ModelCandidate,
  candidates: ModelCandidate[],
  suffixRanks: readonly string[],
): ModelCandidate | undefined {
  const stem = getOpenAiStem(configured.bareName);
  const sameStem = candidates
    .filter((candidate) => getOpenAiStem(candidate.bareName) === stem)
    .sort((a, b) => {
      const aRank = suffixRanks.findIndex((suffix) =>
        a.bareName.toLowerCase() === `${stem}${suffix}`
      );
      const bRank = suffixRanks.findIndex((suffix) =>
        b.bareName.toLowerCase() === `${stem}${suffix}`
      );
      const safeARank = aRank >= 0 ? aRank : suffixRanks.length;
      const safeBRank = bRank >= 0 ? bRank : suffixRanks.length;
      if (safeARank !== safeBRank) return safeARank - safeBRank;
      return (b.contextWindow ?? 0) - (a.contextWindow ?? 0);
    });
  return sameStem[0];
}

function getClaudeVersionKey(name: string): string | null {
  const normalized = stripAgentSuffix(name.toLowerCase());
  const match = normalized.match(/(\d+(?:\.\d+)?(?:-\d{8})?)$/);
  return match?.[1] ?? null;
}

function pickClaudeVariant(
  configured: ModelCandidate,
  candidates: ModelCandidate[],
  familyRanks: readonly string[],
): ModelCandidate | undefined {
  const versionKey = getClaudeVersionKey(configured.bareName);
  const sameVersion = candidates.filter((candidate) =>
    versionKey ? getClaudeVersionKey(candidate.bareName) === versionKey : true
  );
  sameVersion.sort((a, b) => {
    const aRank = familyRanks.findIndex((family) =>
      a.bareName.toLowerCase().includes(family)
    );
    const bRank = familyRanks.findIndex((family) =>
      b.bareName.toLowerCase().includes(family)
    );
    const safeARank = aRank >= 0 ? aRank : familyRanks.length;
    const safeBRank = bRank >= 0 ? bRank : familyRanks.length;
    if (safeARank !== safeBRank) return safeARank - safeBRank;
    return (b.contextWindow ?? 0) - (a.contextWindow ?? 0);
  });
  return sameVersion[0];
}

function pickGoogleVariant(
  configured: ModelCandidate,
  candidates: ModelCandidate[],
  tokenRanks: readonly string[],
): ModelCandidate | undefined {
  const normalizedBase = stripAgentSuffix(configured.bareName.toLowerCase())
    .replace(/-(flash|lite|pro)(-.+)?$/, "");
  const sameFamily = candidates.filter((candidate) =>
    stripAgentSuffix(candidate.bareName.toLowerCase()).startsWith(normalizedBase)
  );
  sameFamily.sort((a, b) => {
    const aRank = tokenRanks.findIndex((token) =>
      a.bareName.toLowerCase().includes(token)
    );
    const bRank = tokenRanks.findIndex((token) =>
      b.bareName.toLowerCase().includes(token)
    );
    const safeARank = aRank >= 0 ? aRank : tokenRanks.length;
    const safeBRank = bRank >= 0 ? bRank : tokenRanks.length;
    if (safeARank !== safeBRank) return safeARank - safeBRank;
    return (b.contextWindow ?? 0) - (a.contextWindow ?? 0);
  });
  return sameFamily[0];
}

function pickLargestToolCandidate(
  configured: ModelCandidate,
  candidates: ModelCandidate[],
): ModelCandidate | undefined {
  const sorted = [...candidates].sort((a, b) => {
    if (a.parameterScore !== b.parameterScore) {
      return b.parameterScore - a.parameterScore;
    }
    return (b.contextWindow ?? 0) - (a.contextWindow ?? 0);
  });
  return sorted[0] ?? configured;
}

function pickNonAgentClaudeSibling(
  byId: Map<string, ModelCandidate>,
  configured: ModelCandidate,
): ModelCandidate {
  if (!configured.isAgentVariant) return configured;
  const nonAgentId = `${configured.provider}/${configured.bareName}`;
  return byId.get(nonAgentId) ?? configured;
}

function pickPlanCandidate(
  byId: Map<string, ModelCandidate>,
  configured: ModelCandidate,
): ModelCandidate {
  const baseConfigured = pickNonAgentClaudeSibling(byId, configured);
  const candidates = getToolCapableCandidates(byId, baseConfigured.provider);
  if (candidates.length === 0) return baseConfigured;

  if (baseConfigured.provider === "openai") {
    return pickOpenAiVariant(baseConfigured, candidates, OPENAI_PLAN_SUFFIX_RANKS) ??
      baseConfigured;
  }
  if (
    baseConfigured.provider === "anthropic" ||
    baseConfigured.provider === "claude-code"
  ) {
    return pickClaudeVariant(baseConfigured, candidates, CLAUDE_PLAN_FAMILIES) ??
      baseConfigured;
  }
  if (baseConfigured.provider === "google") {
    return pickGoogleVariant(baseConfigured, candidates, GOOGLE_PLAN_TOKENS) ??
      baseConfigured;
  }
  return baseConfigured;
}

function pickYoloCandidate(
  byId: Map<string, ModelCandidate>,
  configured: ModelCandidate,
): ModelCandidate {
  const baseConfigured = pickNonAgentClaudeSibling(byId, configured);
  const candidates = getToolCapableCandidates(byId, baseConfigured.provider);
  if (candidates.length === 0) return baseConfigured;

  if (baseConfigured.provider === "openai") {
    return pickOpenAiVariant(baseConfigured, candidates, OPENAI_YOLO_SUFFIX_RANKS) ??
      baseConfigured;
  }
  if (
    baseConfigured.provider === "anthropic" ||
    baseConfigured.provider === "claude-code"
  ) {
    return pickClaudeVariant(baseConfigured, candidates, CLAUDE_YOLO_FAMILIES) ??
      baseConfigured;
  }
  if (baseConfigured.provider === "google") {
    return pickGoogleVariant(baseConfigured, candidates, GOOGLE_YOLO_TOKENS) ??
      baseConfigured;
  }
  return pickLargestToolCandidate(baseConfigured, candidates) ?? baseConfigured;
}

function toDetails(candidate: ModelCandidate): ExecutionModeModelDetails {
  return {
    id: candidate.id,
    displayName: candidate.displayName,
    contextWindow: candidate.contextWindow,
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
  const configured = getConfiguredCandidate(byId, configuredModelId);
  if (!configured) {
    return {
      byMode: {
        default: {
          id: configuredModelId,
          displayName: extractModelSuffix(configuredModelId),
        },
        "auto-edit": {
          id: configuredModelId,
          displayName: extractModelSuffix(configuredModelId),
        },
        plan: {
          id: configuredModelId,
          displayName: extractModelSuffix(configuredModelId),
        },
        yolo: {
          id: configuredModelId,
          displayName: extractModelSuffix(configuredModelId),
        },
      },
    };
  }

  const resolveOverride = (
    mode: ReplAgentExecutionMode,
    fallback: ModelCandidate,
  ): ExecutionModeModelDetails => {
    const overrideId = overrides[mode];
    if (!overrideId) return toDetails(fallback);
    const override = byId.get(overrideId);
    return override ? toDetails(override) : {
      id: overrideId,
      displayName: extractModelSuffix(overrideId),
    };
  };

  return {
    byMode: {
      default: resolveOverride("default", configured),
      "auto-edit": resolveOverride("auto-edit", configured),
      plan: resolveOverride("plan", pickPlanCandidate(byId, configured)),
      yolo: resolveOverride("yolo", pickYoloCandidate(byId, configured)),
    },
  };
}

export function formatExecutionModeModelDisplayName(modelId?: string): string {
  return modelId ? extractModelSuffix(modelId) : "";
}
