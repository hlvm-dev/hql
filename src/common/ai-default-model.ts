/**
 * Default AI model installation helpers.
 */

import { ai } from "../hlvm/api/ai.ts";
import { config } from "../hlvm/api/config.ts";
import { parseModelString } from "../hlvm/providers/index.ts";
import type { ModelInfo } from "../hlvm/providers/types.ts";
import {
  AUTO_MODEL_ID,
  type ConfigKey,
  DEFAULT_OLLAMA_ENDPOINT,
  type HlvmConfig,
} from "./config/types.ts";
import {
  getConfiguredModel as getConfiguredModelFromConfig,
} from "./config/selectors.ts";
import {
  buildSelectedModelConfigUpdates,
  buildSelectedModelConfigUpdatesPreservingAgentMode,
} from "./config/model-selection.ts";
import { ensureModelAvailability } from "./model-availability.ts";
import { getPlatform } from "../platform/platform.ts";
import { RuntimeError } from "./error.ts";
import { LOCAL_FALLBACK_MODEL_ID } from "../hlvm/runtime/local-fallback.ts";
import {
  LEGACY_LOCAL_FALLBACK_IDENTITIES,
  TIERED_LOCAL_FALLBACK_IDENTITIES,
} from "../hlvm/runtime/bootstrap-manifest.ts";

let defaultModelEnsured = false;
const CLAUDE_CODE_PROVIDER = "claude-code";
const CLAUDE_CODE_AGENT_SUFFIX = ":agent";
const CLAUDE_DATE_SUFFIX_REGEX = /-20\d{6}$/;
const CLAUDE_BOOTSTRAP_SUCCESS_CACHE_MS = 30_000;
const CLAUDE_BOOTSTRAP_FAILURE_CACHE_MS = 5_000;
const LEGACY_LOCAL_FALLBACK_MODEL_IDS = LEGACY_LOCAL_FALLBACK_IDENTITIES.map(
  (identity) => `ollama/${identity.modelId}`,
);
const TIERED_LOCAL_FALLBACK_MODEL_IDS = TIERED_LOCAL_FALLBACK_IDENTITIES.map(
  (identity) => `ollama/${identity.modelId}`,
);
const LEGACY_DEFAULT_MODEL_IDS = new Set([
  "ollama/llama3.1:8b",
  "ollama/mistral-large-3:675b-cloud",
  LOCAL_FALLBACK_MODEL_ID,
  ...TIERED_LOCAL_FALLBACK_MODEL_IDS,
  ...LEGACY_LOCAL_FALLBACK_MODEL_IDS,
]);
type ClaudeBootstrapProbeCache =
  | { state: "empty" }
  | { state: "success"; at: number; modelId: string }
  | { state: "failure"; at: number };

let claudeBootstrapProbeCache: ClaudeBootstrapProbeCache = { state: "empty" };

function getCachedClaudeBootstrapProbe(now: number): string | null | undefined {
  if (claudeBootstrapProbeCache.state === "success") {
    return now - claudeBootstrapProbeCache.at < CLAUDE_BOOTSTRAP_SUCCESS_CACHE_MS
      ? claudeBootstrapProbeCache.modelId
      : undefined;
  }
  if (claudeBootstrapProbeCache.state === "failure") {
    return now - claudeBootstrapProbeCache.at < CLAUDE_BOOTSTRAP_FAILURE_CACHE_MS
      ? null
      : undefined;
  }
  return undefined;
}

function setClaudeBootstrapProbeSuccess(now: number, modelId: string): void {
  claudeBootstrapProbeCache = { state: "success", at: now, modelId };
}

function setClaudeBootstrapProbeFailure(now: number): void {
  claudeBootstrapProbeCache = { state: "failure", at: now };
}

export function __resetClaudeBootstrapProbeCacheForTesting(): void {
  claudeBootstrapProbeCache = { state: "empty" };
}

export {
  getProgressPercent,
  isModelInstalled,
} from "./model-availability.ts";

export interface EnsureDefaultModelOptions {
  log?: (message: string) => void;
}

export function getConfiguredModel(): string {
  return getConfiguredModelFromConfig(config.snapshot);
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

/**
 * True when the user has NOT explicitly chosen a model and the current model
 * is a known default/legacy value eligible for automatic upgrade to auto-routing.
 * Respects `modelConfigured: true` — never overrides an explicit user choice.
 *
 * All known defaults (LOCAL_FALLBACK_MODEL_ID and legacy models) are members
 * of LEGACY_DEFAULT_MODEL_IDS — candidate detection is one Set lookup.
 */
function isAutomaticDefaultCandidate(
  snapshot: Pick<HlvmConfig, "model" | "modelConfigured">,
): boolean {
  if (snapshot.modelConfigured) return false;
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
  if (!isAutomaticDefaultCandidate(snapshot)) return null;

  const now = deps.now();
  const cached = getCachedClaudeBootstrapProbe(now);
  if (cached !== undefined) {
    return cached;
  }

  let status: { available: boolean };
  try {
    status = await deps.getStatus(CLAUDE_CODE_PROVIDER);
  } catch {
    setClaudeBootstrapProbeFailure(now);
    return null;
  }
  if (!status.available) {
    setClaudeBootstrapProbeFailure(now);
    return null;
  }

  let models: ModelInfo[];
  try {
    models = await deps.listModels(CLAUDE_CODE_PROVIDER);
  } catch {
    setClaudeBootstrapProbeFailure(now);
    return null;
  }

  const preferred = selectPreferredClaudeCodeModel(models);
  if (!preferred) {
    setClaudeBootstrapProbeFailure(now);
    return null;
  }

  const selectedModelId = `${CLAUDE_CODE_PROVIDER}/${preferred}`;
  await deps.patchConfig(
    snapshot.agentMode
      ? buildSelectedModelConfigUpdatesPreservingAgentMode(selectedModelId)
      : buildSelectedModelConfigUpdates(selectedModelId),
  );
  setClaudeBootstrapProbeSuccess(now, selectedModelId);
  return selectedModelId;
}

type AutoUpgradeDeps = Pick<ClaudeBootstrapDeps, "getSnapshot" | "patchConfig">;

/**
 * Upgrade an unconfigured legacy default model to auto-routing.
 * No-ops when model is already explicitly configured (modelConfigured: true).
 */
export async function upgradeDefaultToAutoRouting(
  depsOverride: Partial<AutoUpgradeDeps> = {},
): Promise<string | null> {
  const fallback = getClaudeBootstrapDeps();
  const deps: AutoUpgradeDeps = {
    getSnapshot: depsOverride.getSnapshot ?? fallback.getSnapshot,
    patchConfig: depsOverride.patchConfig ?? fallback.patchConfig,
  };
  const snapshot = deps.getSnapshot();
  if (!isAutomaticDefaultCandidate(snapshot)) return null;

  await deps.patchConfig({
    model: AUTO_MODEL_ID,
    endpoint: DEFAULT_OLLAMA_ENDPOINT,
    agentMode: "hlvm",
    modelConfigured: true,
  });
  return AUTO_MODEL_ID;
}

export interface EnsureInitialModelConfiguredOptions {
  allowFirstRunSetup?: boolean;
  runFirstTimeSetup?: () => Promise<string | null>;
}

export interface EnsureInitialModelConfiguredResult {
  model: string;
  modelConfigured: boolean;
  autoConfiguredLocalFallback: boolean;
  firstRunConfigured: boolean;
  reconciledClaudeModel: boolean;
}

interface InitialModelConfigDeps {
  getSnapshot: () => Pick<
    HlvmConfig,
    "model" | "modelConfigured" | "agentMode"
  >;
  listModels: (providerName?: string) => Promise<ModelInfo[]>;
  patchConfig: (updates: Partial<Record<ConfigKey, unknown>>) => Promise<void>;
  syncSnapshot: () => Promise<
    Pick<HlvmConfig, "model" | "modelConfigured" | "agentMode">
  >;
}

function getInitialModelConfigDeps(): InitialModelConfigDeps {
  const bootstrapDeps = getClaudeBootstrapDeps();
  const resolveDeps = getClaudeModelResolveDeps();
  return {
    getSnapshot: bootstrapDeps.getSnapshot,
    listModels: resolveDeps.listModels,
    patchConfig: bootstrapDeps.patchConfig,
    syncSnapshot: async () => config.snapshot,
  };
}

export async function ensureInitialModelConfigured(
  options: EnsureInitialModelConfiguredOptions = {},
  depsOverride: Partial<InitialModelConfigDeps> = {},
): Promise<EnsureInitialModelConfiguredResult> {
  const deps = { ...getInitialModelConfigDeps(), ...depsOverride };
  let snapshot = deps.getSnapshot();
  let autoConfiguredLocalFallback = false;
  let firstRunConfigured = false;
  let reconciledClaudeModel = false;

  // Upgrade unconfigured legacy defaults (gemma4, llama3.1, mistral-large) to auto-routing.
  if (isAutomaticDefaultCandidate(snapshot)) {
    const localModel = await upgradeDefaultToAutoRouting({
      getSnapshot: deps.getSnapshot,
      patchConfig: deps.patchConfig,
    });
    if (localModel) {
      autoConfiguredLocalFallback = true;
      snapshot = await deps.syncSnapshot();
    }
  }

  // Interactive first-run setup (if still unconfigured after auto upgrade).
  if (isAutomaticDefaultCandidate(snapshot)) {
    if (
      options.allowFirstRunSetup &&
      typeof options.runFirstTimeSetup === "function"
    ) {
      const setupModel = await options.runFirstTimeSetup();
      if (setupModel) {
        firstRunConfigured = true;
      }
      snapshot = await deps.syncSnapshot();
    }
  }

  // Repair dotted Claude aliases (e.g. claude-sonnet-4.5 → claude-sonnet-4-5-20250929).
  if (
    typeof snapshot.model === "string" &&
    snapshot.model.startsWith(`${CLAUDE_CODE_PROVIDER}/`)
  ) {
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

  const configuredModel = getConfiguredModelFromConfig(snapshot);

  return {
    model: await resolveCompatibleClaudeCodeModel(configuredModel, {
      listModels: deps.listModels,
    }),
    modelConfigured: snapshot.modelConfigured === true,
    autoConfiguredLocalFallback,
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
