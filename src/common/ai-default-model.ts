/**
 * Default AI model installation helpers.
 */

import { ai } from "../hlvm/api/ai.ts";
import { config } from "../hlvm/api/config.ts";
import { parseModelString } from "../hlvm/providers/index.ts";
import type { ModelInfo, PullProgress } from "../hlvm/providers/types.ts";
import { DEFAULT_MODEL_ID } from "./config/defaults.ts";
import { getErrorMessage } from "./utils.ts";
import { getPlatform } from "../platform/platform.ts";

let defaultModelEnsured = false;

export interface EnsureDefaultModelOptions {
  log?: (message: string) => void;
}

function getConfiguredModel(): string {
  const snapshot = config.snapshot;
  if (snapshot?.model && typeof snapshot.model === "string") {
    return snapshot.model;
  }
  return DEFAULT_MODEL_ID;
}

function isModelInstalled(models: ModelInfo[], target: string): boolean {
  if (!target) return false;
  const hasTag = target.includes(":");
  if (hasTag) {
    return models.some((model) => model.name === target);
  }
  const latest = `${target}:latest`;
  return models.some((model) => model.name === target || model.name === latest);
}

function getProgressPercent(progress: PullProgress): number | undefined {
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
    [providerName, modelName] = parseModelString(DEFAULT_MODEL_ID);
  }

  let models: ModelInfo[] = [];
  try {
    models = await ai.models.list(providerName ?? undefined);
  } catch (error) {
    throw new Error(
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
    throw new Error(
      `Default model download failed (${modelName}): ${getErrorMessage(error)}`
    );
  }

  try {
    models = await ai.models.list(providerName ?? undefined);
  } catch (error) {
    throw new Error(
      `Unable to verify default model installation: ${getErrorMessage(error)}`
    );
  }

  if (!isModelInstalled(models, modelName)) {
    throw new Error(`Default model download did not complete: ${modelName}`);
  }

  defaultModelEnsured = true;
  if (log) {
    log(`Default model ready: ${modelName}`);
  }
  return true;
}
