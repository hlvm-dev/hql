import { parseModelString } from "../hlvm/providers/index.ts";
import { isOllamaCloudModel } from "../hlvm/providers/ollama/cloud.ts";
import type { ModelInfo, PullProgress } from "../hlvm/providers/types.ts";
import { DEFAULT_MODEL_ID, DEFAULT_MODEL_PROVIDER } from "./config/types.ts";
import { getErrorMessage } from "./utils.ts";

export interface ModelAvailabilityTarget {
  modelId: string;
  providerName?: string;
  modelName: string;
  supportsLocalInstall: boolean;
}

export interface ModelAvailabilitySnapshot extends ModelAvailabilityTarget {
  available: boolean;
  requiresLocalInstall: boolean;
}

export interface ModelAccessRetryResult {
  ok: boolean;
  status: string;
  error?: string;
}

export interface EnsureModelAvailabilityDeps {
  listModels: (providerName?: string) => Promise<ModelInfo[]>;
  pullModel: (
    modelName: string,
    providerName?: string,
    signal?: AbortSignal,
  ) => AsyncIterable<PullProgress>;
  handlePullAuthError?: (
    modelId: string,
    errorMessage: string,
  ) => Promise<ModelAccessRetryResult | null>;
  ensureAccess?: (modelId: string) => Promise<ModelAccessRetryResult>;
}

export interface EnsureModelAvailabilityOptions {
  pull?: boolean;
  signal?: AbortSignal;
  log?: (message: string) => void;
  onProgress?: (progress: PullProgress) => void;
  onPullStart?: (target: ModelAvailabilityTarget) => void;
}

export interface EnsureModelAvailabilityResult
  extends ModelAvailabilitySnapshot {
  ok: boolean;
  status:
    | "external"
    | "available"
    | "missing"
    | "pulled"
    | "check_failed"
    | "pull_failed"
    | "signin_failed"
    | "verification_failed"
    | "access_failed";
  error?: string;
}

export function resolveModelAvailabilityTarget(
  modelId: string,
): ModelAvailabilityTarget {
  let [providerName, modelName] = parseModelString(modelId);
  if (!modelName) {
    [providerName, modelName] = parseModelString(DEFAULT_MODEL_ID);
  }

  const resolvedProvider = providerName ?? DEFAULT_MODEL_PROVIDER;
  return {
    modelId: modelId.includes("/")
      ? modelId
      : `${resolvedProvider}/${modelName}`,
    providerName: resolvedProvider,
    modelName,
    supportsLocalInstall: resolvedProvider === "ollama" &&
      !isOllamaCloudModel(modelName),
  };
}

export function isModelInstalled(models: ModelInfo[], target: string): boolean {
  if (!target) return false;
  const normalizedTarget = target.toLowerCase();
  const hasTag = normalizedTarget.includes(":");
  if (hasTag) {
    return models.some((model) =>
      model.name.toLowerCase() === normalizedTarget
    );
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
  if (
    typeof progress.total === "number" && progress.total > 0 &&
    typeof progress.completed === "number"
  ) {
    return Math.round((progress.completed / progress.total) * 100);
  }
  return undefined;
}

async function consumeModelPullProgress(
  progressStream: AsyncIterable<PullProgress>,
  options: {
    log?: (message: string) => void;
    onProgress?: (progress: PullProgress) => void;
  } = {},
): Promise<void> {
  let lastPercent = -1;
  let lastStatus = "";

  for await (const progress of progressStream) {
    options.onProgress?.(progress);
    if (!options.log) continue;
    const percent = getProgressPercent(progress);
    const status = (progress.status || "").trim();
    const statusChanged = status && status !== lastStatus;
    const percentChanged = typeof percent === "number" &&
      percent >= lastPercent + 5;

    if (statusChanged || percentChanged) {
      const suffix = typeof percent === "number" ? ` ${percent}%` : "";
      const message = status ? `${status}${suffix}` : `Downloading${suffix}`;
      options.log(message.trim());
      lastStatus = status;
      if (typeof percent === "number") {
        lastPercent = percent;
      }
    }
  }
}

export async function logModelPullProgress(
  progressStream: AsyncIterable<PullProgress>,
  log?: (message: string) => void,
): Promise<void> {
  await consumeModelPullProgress(progressStream, { log });
}

export async function getModelAvailability(
  modelId: string,
  deps: Pick<EnsureModelAvailabilityDeps, "listModels">,
): Promise<ModelAvailabilitySnapshot> {
  const target = resolveModelAvailabilityTarget(modelId);
  if (!target.supportsLocalInstall) {
    return {
      ...target,
      available: true,
      requiresLocalInstall: false,
    };
  }

  const models = await deps.listModels(target.providerName);
  const available = isModelInstalled(models, target.modelName);
  return {
    ...target,
    available,
    requiresLocalInstall: !available,
  };
}

function toFailureResult(
  target: ModelAvailabilityTarget,
  status: EnsureModelAvailabilityResult["status"],
  error?: string,
  available = false,
): EnsureModelAvailabilityResult {
  return {
    ...target,
    available,
    requiresLocalInstall: !available && target.supportsLocalInstall,
    ok: false,
    status,
    error,
  };
}

function normalizeAccessFailureStatus(
  status: string,
): EnsureModelAvailabilityResult["status"] {
  switch (status) {
    case "signin_failed":
      return "signin_failed";
    case "verification_failed":
      return "verification_failed";
    default:
      return "access_failed";
  }
}

async function verifyInstalledModel(
  target: ModelAvailabilityTarget,
  deps: Pick<EnsureModelAvailabilityDeps, "listModels">,
): Promise<boolean> {
  const models = await deps.listModels(target.providerName);
  return isModelInstalled(models, target.modelName);
}

export async function ensureModelAvailability(
  modelId: string,
  deps: EnsureModelAvailabilityDeps,
  options: EnsureModelAvailabilityOptions = {},
): Promise<EnsureModelAvailabilityResult> {
  const target = resolveModelAvailabilityTarget(modelId);

  let availability: ModelAvailabilitySnapshot;
  try {
    availability = await getModelAvailability(modelId, deps);
  } catch (error) {
    return toFailureResult(
      target,
      "check_failed",
      `AI provider unavailable while checking models: ${
        getErrorMessage(error)
      }`,
    );
  }

  if (!target.supportsLocalInstall) {
    if (deps.ensureAccess) {
      const access = await deps.ensureAccess(target.modelId);
      if (!access.ok) {
        return toFailureResult(
          target,
          normalizeAccessFailureStatus(access.status),
          access.error,
          availability.available,
        );
      }
    }
    return {
      ...availability,
      ok: true,
      status: "external",
    };
  }

  let action: EnsureModelAvailabilityResult["status"] = "available";

  if (!availability.available) {
    if (!options.pull) {
      return {
        ...availability,
        ok: false,
        status: "missing",
      };
    }

    options.onPullStart?.(target);

    const runPull = async (): Promise<void> => {
      await consumeModelPullProgress(
        deps.pullModel(target.modelName, target.providerName, options.signal),
        {
          log: options.log,
          onProgress: options.onProgress,
        },
      );
    };

    try {
      await runPull();
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      const authRecovery = await deps.handlePullAuthError?.(
        target.modelId,
        errorMessage,
      ) ?? null;
      if (authRecovery) {
        if (!authRecovery.ok) {
          return toFailureResult(
            target,
            normalizeAccessFailureStatus(authRecovery.status),
            authRecovery.error,
          );
        }
        try {
          await runPull();
        } catch (retryError) {
          return toFailureResult(
            target,
            "pull_failed",
            `Model download failed (${target.modelName}): ${
              getErrorMessage(retryError)
            }`,
          );
        }
      } else {
        return toFailureResult(
          target,
          "pull_failed",
          `Model download failed (${target.modelName}): ${errorMessage}`,
        );
      }
    }

    try {
      availability = {
        ...target,
        available: await verifyInstalledModel(target, deps),
        requiresLocalInstall: false,
      };
    } catch (error) {
      return toFailureResult(
        target,
        "check_failed",
        `Unable to verify model installation: ${getErrorMessage(error)}`,
      );
    }

    if (!availability.available) {
      return toFailureResult(
        target,
        "pull_failed",
        `Model download did not complete: ${target.modelName}`,
      );
    }

    action = "pulled";
  }

  if (deps.ensureAccess) {
    const access = await deps.ensureAccess(target.modelId);
    if (!access.ok) {
      return toFailureResult(
        target,
        normalizeAccessFailureStatus(access.status),
        access.error,
        availability.available,
      );
    }
  }

  return {
    ...availability,
    ok: true,
    status: action,
  };
}
