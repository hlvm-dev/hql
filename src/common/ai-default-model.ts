/**
 * Default AI model installation helpers.
 */

import { ai } from "../hlvm/api/ai.ts";
import { config } from "../hlvm/api/config.ts";
import { parseModelString } from "../hlvm/providers/index.ts";
import { isOllamaCloudModel } from "../hlvm/providers/ollama/cloud.ts";
import type { ModelInfo } from "../hlvm/providers/types.ts";
import {
  type ConfigKey,
  DEFAULT_MODEL_ID,
  type HlvmConfig,
} from "./config/types.ts";
import { buildSelectedModelConfigUpdates } from "./config/model-selection.ts";
import { ensureModelAvailability } from "./model-availability.ts";
import { getPlatform } from "../platform/platform.ts";
import { RuntimeError } from "./error.ts";
import { parseModelParameterSize } from "./model-ranking.ts";

let defaultModelEnsured = false;
const CLAUDE_CODE_PROVIDER = "claude-code";
const OLLAMA_PROVIDER = "ollama";
const CLAUDE_CODE_AGENT_SUFFIX = ":agent";
const CLAUDE_DATE_SUFFIX_REGEX = /-20\d{6}$/;
const CLAUDE_BOOTSTRAP_CACHE_MS = 30_000;
const LEGACY_DEFAULT_MODEL_IDS = new Set([
  "ollama/llama3.1:8b",
]);
let claudeBootstrapProbeAt = 0;
let claudeBootstrapProbeResult: string | null = null;

export {
  getProgressPercent,
  isModelInstalled,
} from "./model-availability.ts";

export interface EnsureDefaultModelOptions {
  log?: (message: string) => void;
}

export function getConfiguredModel(): string {
  const snapshot = config.snapshot;
  if (snapshot?.model && typeof snapshot.model === "string") {
    return snapshot.model;
  }
  return DEFAULT_MODEL_ID;
}

function normalizeProviderLocalModelName(name: string): string {
  const slash = name.indexOf("/");
  return slash >= 0 ? name.slice(slash + 1) : name;
}

function stripClaudeAgentSuffix(name: string): string {
  return name.endsWith(CLAUDE_CODE_AGENT_SUFFIX)
    ? name.slice(0, -CLAUDE_CODE_AGENT_SUFFIX.length)
    : name;
}

function normalizeClaudeMatchKey(name: string): string {
  return stripClaudeAgentSuffix(
    normalizeProviderLocalModelName(name).toLowerCase(),
  )
    .replace(/\./g, "-");
}

function getClaudeFamilyScore(name: string): number {
  const lower = name.toLowerCase();
  if (lower.includes("sonnet")) return 3;
  if (lower.includes("opus")) return 2;
  if (lower.includes("haiku")) return 1;
  return 0;
}

function getClaudeDateScore(name: string): number {
  const match = name.match(/20\d{6}/);
  return match ? parseInt(match[0], 10) : 0;
}

function getClaudeLatestScore(name: string): number {
  return name.toLowerCase().includes("latest") ? 1 : 0;
}

function isAutomaticDefaultCandidate(
  snapshot: Pick<HlvmConfig, "model" | "modelConfigured">,
): boolean {
  if (snapshot.modelConfigured) return false;
  if (snapshot.model === DEFAULT_MODEL_ID) return true;
  return typeof snapshot.model === "string" &&
    LEGACY_DEFAULT_MODEL_IDS.has(snapshot.model);
}

function scoreClaudeModel(name: string): number {
  return (getClaudeFamilyScore(name) * 10_000_000) +
    (getClaudeLatestScore(name) * 1_000_000) +
    getClaudeDateScore(name);
}

export function selectPreferredClaudeCodeModel(
  models: ModelInfo[],
): string | null {
  const candidates = models
    .map((model) => normalizeProviderLocalModelName(model.name))
    .filter((name) =>
      name.startsWith("claude-") &&
      !name.endsWith(CLAUDE_CODE_AGENT_SUFFIX) &&
      !name.includes(".")
    );

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const scoreDiff = scoreClaudeModel(b) - scoreClaudeModel(a);
    if (scoreDiff !== 0) return scoreDiff;
    return b.localeCompare(a);
  });

  return candidates[0] ?? null;
}

export function selectPreferredOllamaCloudModel(
  models: ModelInfo[],
): string | null {
  const candidates = models
    .map((model) => ({
      model,
      normalizedName: normalizeProviderLocalModelName(model.name),
    }))
    .filter(({ model, normalizedName }) =>
      isOllamaCloudModel(normalizedName) &&
      (model.capabilities?.includes("tools") ?? false)
    );

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const sizeDiff = parseModelParameterSize(b.model.parameterSize) -
      parseModelParameterSize(a.model.parameterSize);
    if (sizeDiff !== 0) return sizeDiff;
    return b.normalizedName.localeCompare(a.normalizedName);
  });

  return candidates[0]?.normalizedName ?? null;
}

function findBestClaudeMatch(
  requestedModelName: string,
  availableModels: string[],
): string | null {
  const requestedLocal = normalizeProviderLocalModelName(requestedModelName);
  const requestedHasAgent = requestedLocal.endsWith(CLAUDE_CODE_AGENT_SUFFIX);
  const requestedBase = stripClaudeAgentSuffix(requestedLocal);
  const requestedKey = normalizeClaudeMatchKey(requestedLocal);

  const availableSet = new Set(availableModels);
  if (availableSet.has(requestedLocal)) return requestedLocal;
  if (availableSet.has(requestedBase)) {
    const maybeAgent = requestedHasAgent
      ? `${requestedBase}${CLAUDE_CODE_AGENT_SUFFIX}`
      : requestedBase;
    if (availableSet.has(maybeAgent)) return maybeAgent;
    return requestedBase;
  }

  const normalizedToOriginal = new Map<string, string>();
  for (const model of availableModels) {
    const key = normalizeClaudeMatchKey(model);
    if (!normalizedToOriginal.has(key)) {
      normalizedToOriginal.set(key, model);
    }
  }

  const normalizedExact = normalizedToOriginal.get(requestedKey);
  if (normalizedExact) {
    const normalizedBase = stripClaudeAgentSuffix(normalizedExact);
    if (!requestedHasAgent) return normalizedBase;
    const agentVariant = `${normalizedBase}${CLAUDE_CODE_AGENT_SUFFIX}`;
    return availableSet.has(agentVariant) ? agentVariant : normalizedBase;
  }

  const candidates = availableModels
    .filter((model) => {
      const base = stripClaudeAgentSuffix(model);
      const key = normalizeClaudeMatchKey(base);
      return key === requestedKey || key.startsWith(`${requestedKey}-`);
    })
    .map((model) => stripClaudeAgentSuffix(model));

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const scoreDiff = scoreClaudeModel(b) - scoreClaudeModel(a);
    if (scoreDiff !== 0) return scoreDiff;
    const aHasDate = CLAUDE_DATE_SUFFIX_REGEX.test(a) ? 1 : 0;
    const bHasDate = CLAUDE_DATE_SUFFIX_REGEX.test(b) ? 1 : 0;
    if (aHasDate !== bHasDate) return bHasDate - aHasDate;
    return b.localeCompare(a);
  });

  const selectedBase = candidates[0];
  if (!selectedBase) return null;
  if (!requestedHasAgent) return selectedBase;

  const agentVariant = `${selectedBase}${CLAUDE_CODE_AGENT_SUFFIX}`;
  return availableSet.has(agentVariant) ? agentVariant : selectedBase;
}

interface ClaudeBootstrapDeps {
  getSnapshot: () => Pick<
    HlvmConfig,
    "model" | "modelConfigured" | "agentMode"
  >;
  getStatus: (providerName?: string) => Promise<{ available: boolean }>;
  listModels: (providerName?: string) => Promise<ModelInfo[]>;
  patchConfig: (updates: Partial<Record<ConfigKey, unknown>>) => Promise<void>;
  now: () => number;
}

function getClaudeBootstrapDeps(): ClaudeBootstrapDeps {
  return {
    getSnapshot: () => config.snapshot,
    getStatus: (providerName?: string) => ai.status(providerName),
    listModels: (providerName?: string) => ai.models.list(providerName),
    patchConfig: async (updates) => {
      await config.patch(updates);
    },
    now: () => Date.now(),
  };
}

function shouldAutoBootstrapClaude(
  snapshot: Pick<HlvmConfig, "model" | "modelConfigured">,
): boolean {
  return isAutomaticDefaultCandidate(snapshot);
}

/**
 * Auto-select Claude Code for first-time users when available.
 *
 * Eligibility:
 * - modelConfigured is false/undefined
 * - model is still the default model (user has not chosen a custom baseline)
 *
 * Behavior:
 * - If Claude Code auth is available, choose the best Claude model and persist it.
 * - If unavailable, leave existing model untouched.
 */
export async function autoConfigureInitialClaudeCodeModel(
  depsOverride: Partial<ClaudeBootstrapDeps> = {},
): Promise<string | null> {
  const deps = { ...getClaudeBootstrapDeps(), ...depsOverride };
  const snapshot = deps.getSnapshot();
  if (!shouldAutoBootstrapClaude(snapshot)) return null;

  const now = deps.now();
  if (now - claudeBootstrapProbeAt < CLAUDE_BOOTSTRAP_CACHE_MS) {
    return claudeBootstrapProbeResult;
  }

  claudeBootstrapProbeAt = now;
  claudeBootstrapProbeResult = null;

  let status: { available: boolean };
  try {
    status = await deps.getStatus(CLAUDE_CODE_PROVIDER);
  } catch {
    return null;
  }
  if (!status.available) return null;

  let models: ModelInfo[];
  try {
    models = await deps.listModels(CLAUDE_CODE_PROVIDER);
  } catch {
    return null;
  }

  const preferred = selectPreferredClaudeCodeModel(models);
  if (!preferred) return null;

  const selectedModelId = `${CLAUDE_CODE_PROVIDER}/${preferred}`;
  await deps.patchConfig(buildSelectedModelConfigUpdates(selectedModelId));
  claudeBootstrapProbeResult = selectedModelId;
  return selectedModelId;
}

interface OllamaCloudBootstrapDeps {
  getSnapshot: () => Pick<
    HlvmConfig,
    "model" | "modelConfigured" | "agentMode"
  >;
  listCatalogModels: (providerName?: string) => Promise<ModelInfo[]>;
  patchConfig: (updates: Partial<Record<ConfigKey, unknown>>) => Promise<void>;
}

function getOllamaCloudBootstrapDeps(): OllamaCloudBootstrapDeps {
  return {
    getSnapshot: () => config.snapshot,
    listCatalogModels: (providerName?: string) =>
      ai.models.catalog(providerName),
    patchConfig: async (updates) => {
      await config.patch(updates);
    },
  };
}

/**
 * Auto-select the strongest Ollama cloud model for first-time users when
 * Claude Code is unavailable. This avoids silently defaulting back to a local
 * Llama baseline.
 */
export async function autoConfigureInitialOllamaCloudModel(
  depsOverride: Partial<OllamaCloudBootstrapDeps> = {},
): Promise<string | null> {
  const deps = { ...getOllamaCloudBootstrapDeps(), ...depsOverride };
  const snapshot = deps.getSnapshot();
  if (!isAutomaticDefaultCandidate(snapshot)) return null;

  let models: ModelInfo[];
  try {
    models = await deps.listCatalogModels(OLLAMA_PROVIDER);
  } catch {
    return null;
  }

  const preferred = selectPreferredOllamaCloudModel(models);
  if (!preferred) return null;

  const selectedModelId = `${OLLAMA_PROVIDER}/${preferred}`;
  await deps.patchConfig(buildSelectedModelConfigUpdates(selectedModelId));
  return selectedModelId;
}

export interface EnsureInitialModelConfiguredOptions {
  allowFirstRunSetup?: boolean;
  runFirstTimeSetup?: () => Promise<string | null>;
}

export interface EnsureInitialModelConfiguredResult {
  model: string;
  modelConfigured: boolean;
  autoConfiguredClaude: boolean;
  autoConfiguredOllamaCloud: boolean;
  firstRunConfigured: boolean;
  reconciledClaudeModel: boolean;
}

interface InitialModelConfigDeps {
  getSnapshot: () => Pick<
    HlvmConfig,
    "model" | "modelConfigured" | "agentMode"
  >;
  getStatus: (providerName?: string) => Promise<{ available: boolean }>;
  listModels: (providerName?: string) => Promise<ModelInfo[]>;
  listCatalogModels: (providerName?: string) => Promise<ModelInfo[]>;
  patchConfig: (updates: Partial<Record<ConfigKey, unknown>>) => Promise<void>;
  now: () => number;
  syncSnapshot: () => Promise<
    Pick<HlvmConfig, "model" | "modelConfigured" | "agentMode">
  >;
}

function getInitialModelConfigDeps(): InitialModelConfigDeps {
  const bootstrapDeps = getClaudeBootstrapDeps();
  const resolveDeps = getClaudeModelResolveDeps();
  return {
    getSnapshot: bootstrapDeps.getSnapshot,
    getStatus: bootstrapDeps.getStatus,
    listModels: resolveDeps.listModels,
    listCatalogModels: (providerName?: string) =>
      ai.models.catalog(providerName),
    patchConfig: bootstrapDeps.patchConfig,
    now: bootstrapDeps.now,
    syncSnapshot: async () => config.snapshot,
  };
}

export async function ensureInitialModelConfigured(
  options: EnsureInitialModelConfiguredOptions = {},
  depsOverride: Partial<InitialModelConfigDeps> = {},
): Promise<EnsureInitialModelConfiguredResult> {
  const deps = { ...getInitialModelConfigDeps(), ...depsOverride };
  let snapshot = deps.getSnapshot();
  let autoConfiguredClaude = false;
  let autoConfiguredOllamaCloud = false;
  let firstRunConfigured = false;
  let reconciledClaudeModel = false;

  if (shouldAutoBootstrapClaude(snapshot)) {
    const autoModel = await autoConfigureInitialClaudeCodeModel({
      getSnapshot: deps.getSnapshot,
      getStatus: deps.getStatus,
      listModels: deps.listModels,
      patchConfig: deps.patchConfig,
      now: deps.now,
    });
    if (autoModel) {
      autoConfiguredClaude = true;
      snapshot = await deps.syncSnapshot();
    }
  }

  if (
    isAutomaticDefaultCandidate(snapshot) &&
    options.allowFirstRunSetup &&
    typeof options.runFirstTimeSetup === "function"
  ) {
    const setupModel = await options.runFirstTimeSetup();
    if (setupModel) {
      firstRunConfigured = true;
      snapshot = await deps.syncSnapshot();
    }
  }

  if (isAutomaticDefaultCandidate(snapshot)) {
    const autoModel = await autoConfigureInitialOllamaCloudModel({
      getSnapshot: deps.getSnapshot,
      listCatalogModels: deps.listCatalogModels,
      patchConfig: deps.patchConfig,
    });
    if (autoModel) {
      autoConfiguredOllamaCloud = true;
      snapshot = await deps.syncSnapshot();
    }
  }

  if (snapshot.model) {
    const repaired = await reconcileConfiguredClaudeCodeModel({
      getSnapshot: () => ({ model: snapshot.model }),
      listModels: deps.listModels,
      patchConfig: deps.patchConfig,
    });
    if (repaired) {
      reconciledClaudeModel = true;
      snapshot = await deps.syncSnapshot();
    }
  }

  const configuredModel = snapshot.model && typeof snapshot.model === "string"
    ? snapshot.model
    : DEFAULT_MODEL_ID;

  return {
    model: await resolveCompatibleClaudeCodeModel(configuredModel, {
      listModels: deps.listModels,
    }),
    modelConfigured: snapshot.modelConfigured === true,
    autoConfiguredClaude,
    autoConfiguredOllamaCloud,
    firstRunConfigured,
    reconciledClaudeModel,
  };
}

interface ClaudeModelRepairDeps {
  getSnapshot: () => Pick<HlvmConfig, "model">;
  listModels: (providerName?: string) => Promise<ModelInfo[]>;
  patchConfig: (updates: Partial<Record<ConfigKey, unknown>>) => Promise<void>;
}

function getClaudeModelRepairDeps(): ClaudeModelRepairDeps {
  return {
    getSnapshot: () => config.snapshot,
    listModels: (providerName?: string) => ai.models.list(providerName),
    patchConfig: async (updates) => {
      await config.patch(updates);
    },
  };
}

interface ClaudeModelResolveDeps {
  listModels: (providerName?: string) => Promise<ModelInfo[]>;
}

function getClaudeModelResolveDeps(): ClaudeModelResolveDeps {
  return {
    listModels: (providerName?: string) => ai.models.list(providerName),
  };
}

/**
 * Resolve Claude Code model aliases (e.g. dotted "claude-sonnet-4.5") to a
 * compatible provider-native model id when possible.
 *
 * Returns the original model id when no better match can be found.
 */
export async function resolveCompatibleClaudeCodeModel(
  modelId: string,
  depsOverride: Partial<ClaudeModelResolveDeps> = {},
): Promise<string> {
  const deps = { ...getClaudeModelResolveDeps(), ...depsOverride };
  const [providerName, modelName] = parseModelString(modelId);
  if (providerName !== CLAUDE_CODE_PROVIDER || !modelName) {
    return modelId;
  }

  let models: ModelInfo[];
  try {
    models = await deps.listModels(CLAUDE_CODE_PROVIDER);
  } catch {
    return modelId;
  }
  if (models.length === 0) return modelId;

  const available = models
    .map((m) => normalizeProviderLocalModelName(m.name))
    .filter((name) => name.startsWith("claude-"));

  const repaired = findBestClaudeMatch(modelName, available);
  if (!repaired) return modelId;
  return `${CLAUDE_CODE_PROVIDER}/${repaired}`;
}

/**
 * Repair legacy Claude Code model ids (e.g. dotted aliases like "claude-sonnet-4.5")
 * by mapping them to available provider-native ids from live model discovery.
 *
 * Returns the repaired full model id when patched, otherwise null.
 */
export async function reconcileConfiguredClaudeCodeModel(
  depsOverride: Partial<ClaudeModelRepairDeps> = {},
): Promise<string | null> {
  const deps = { ...getClaudeModelRepairDeps(), ...depsOverride };
  const snapshot = deps.getSnapshot();
  if (!snapshot.model) return null;

  const repairedFullModel = await resolveCompatibleClaudeCodeModel(
    snapshot.model,
    {
      listModels: deps.listModels,
    },
  );
  if (repairedFullModel === snapshot.model) return null;

  await deps.patchConfig(buildSelectedModelConfigUpdates(repairedFullModel));
  return repairedFullModel;
}

export async function ensureDefaultModelInstalled(
  options: EnsureDefaultModelOptions = {},
): Promise<boolean> {
  if (defaultModelEnsured) return true;
  if (getPlatform().env.get("HLVM_DISABLE_AI_AUTOSTART")) return false;

  const result = await ensureModelAvailability(
    getConfiguredModel(),
    {
      listModels: (providerName?: string) => ai.models.list(providerName),
      pullModel: (
        modelName: string,
        providerName?: string,
      ) => ai.models.pull(modelName, providerName),
    },
    {
      pull: true,
      log: options.log,
    },
  );

  if (!result.ok) {
    throw new RuntimeError(
      result.error ?? `Default model unavailable: ${result.modelName}`,
    );
  }

  defaultModelEnsured = true;
  return true;
}
