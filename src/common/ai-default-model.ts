/**
 * Default AI model installation helpers.
 */

import { ai } from "../hlvm/api/ai.ts";
import { config } from "../hlvm/api/config.ts";
import { parseModelString } from "../hlvm/providers/index.ts";
import type { ModelInfo, PullProgress } from "../hlvm/providers/types.ts";
import {
  type ConfigKey,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_PROVIDER,
  type HlvmConfig,
} from "./config/types.ts";
import { getErrorMessage } from "./utils.ts";
import { getPlatform } from "../platform/platform.ts";
import { RuntimeError } from "./error.ts";

let defaultModelEnsured = false;
const CLAUDE_CODE_PROVIDER = "claude-code";
const CLAUDE_CODE_AGENT_SUFFIX = ":agent";
const CLAUDE_BOOTSTRAP_CACHE_MS = 30_000;
let claudeBootstrapProbeAt = 0;
let claudeBootstrapProbeResult: string | null = null;

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

function scoreClaudeModel(name: string): number {
  return (getClaudeFamilyScore(name) * 10_000_000) +
    (getClaudeLatestScore(name) * 1_000_000) +
    getClaudeDateScore(name);
}

export function selectPreferredClaudeCodeModel(models: ModelInfo[]): string | null {
  const candidates = models
    .map((model) => normalizeProviderLocalModelName(model.name))
    .filter((name) =>
      name.startsWith("claude-") && !name.endsWith(CLAUDE_CODE_AGENT_SUFFIX)
    );

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const scoreDiff = scoreClaudeModel(b) - scoreClaudeModel(a);
    if (scoreDiff !== 0) return scoreDiff;
    return b.localeCompare(a);
  });

  return candidates[0] ?? null;
}

interface ClaudeBootstrapDeps {
  getSnapshot: () => Pick<HlvmConfig, "model" | "modelConfigured" | "agentMode">;
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

function shouldAutoBootstrapClaude(snapshot: Pick<HlvmConfig, "model" | "modelConfigured">): boolean {
  if (snapshot.modelConfigured) return false;
  return snapshot.model === DEFAULT_MODEL_ID;
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
  await deps.patchConfig({
    model: selectedModelId,
    modelConfigured: true,
    ...(snapshot.agentMode ? {} : { agentMode: "hlvm" }),
  });
  claudeBootstrapProbeResult = selectedModelId;
  return selectedModelId;
}

export function isModelInstalled(models: ModelInfo[], target: string): boolean {
  if (!target) return false;
  const normalizedTarget = target.toLowerCase();
  const hasTag = normalizedTarget.includes(":");
  if (hasTag) {
    return models.some((model) => model.name.toLowerCase() === normalizedTarget);
  }
  const latest = `${normalizedTarget}:latest`;
  return models.some((model) => {
    const name = model.name.toLowerCase();
    return name === normalizedTarget || name === latest;
  });
}

export function getProgressPercent(progress: PullProgress): number | undefined {
  if (typeof progress.percent === "number") {
    return Math.round(progress.percent);
  }
  if (typeof progress.total === "number" && progress.total > 0 && typeof progress.completed === "number") {
    return Math.round((progress.completed / progress.total) * 100);
  }
  return undefined;
}

export async function pullModelWithProgress(
  modelName: string,
  providerName?: string,
  log?: (message: string) => void
): Promise<void> {
  let lastPercent = -1;
  let lastStatus = "";

  for await (const progress of ai.models.pull(modelName, providerName)) {
    if (!log) continue;
    const percent = getProgressPercent(progress);
    const status = (progress.status || "").trim();
    const statusChanged = status && status !== lastStatus;
    const percentChanged = typeof percent === "number" && percent >= lastPercent + 5;

    if (statusChanged || percentChanged) {
      const suffix = typeof percent === "number" ? ` ${percent}%` : "";
      const message = status ? `${status}${suffix}` : `Downloading${suffix}`;
      log(message.trim());
      lastStatus = status;
      if (typeof percent === "number") {
        lastPercent = percent;
      }
    }
  }
}

export async function ensureDefaultModelInstalled(
  options: EnsureDefaultModelOptions = {}
): Promise<boolean> {
  if (defaultModelEnsured) return true;
  if (getPlatform().env.get("HLVM_DISABLE_AI_AUTOSTART")) return false;

  const log = options.log;
  const configuredModel = getConfiguredModel();
  let [providerName, modelName] = parseModelString(configuredModel);

  if (!modelName) {
    providerName = DEFAULT_MODEL_PROVIDER;
    modelName = DEFAULT_MODEL_ID.split("/")[1];
  }

  let models: ModelInfo[] = [];
  try {
    models = await ai.models.list(providerName ?? undefined);
  } catch (error) {
    throw new RuntimeError(
      `AI provider unavailable while checking models. Ensure Ollama is running: ${getErrorMessage(error)}`
    );
  }

  if (isModelInstalled(models, modelName)) {
    defaultModelEnsured = true;
    return true;
  }

  if (log) {
    log(`Downloading default model (${modelName})...`);
  }

  try {
    await pullModelWithProgress(modelName, providerName ?? undefined, log);
  } catch (error) {
    throw new RuntimeError(
      `Default model download failed (${modelName}): ${getErrorMessage(error)}`
    );
  }

  try {
    models = await ai.models.list(providerName ?? undefined);
  } catch (error) {
    throw new RuntimeError(
      `Unable to verify default model installation: ${getErrorMessage(error)}`
    );
  }

  if (!isModelInstalled(models, modelName)) {
    throw new RuntimeError(`Default model download did not complete: ${modelName}`);
  }

  defaultModelEnsured = true;
  if (log) {
    log(`Default model ready: ${modelName}`);
  }
  return true;
}
