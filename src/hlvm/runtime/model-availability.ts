import {
  ensureModelAvailability,
  getModelAvailability,
  resolveModelAvailabilityTarget,
  type EnsureModelAvailabilityOptions,
  type EnsureModelAvailabilityResult,
  type ModelAvailabilitySnapshot,
} from "../../common/model-availability.ts";
import { isOllamaAuthErrorMessage } from "../../common/ollama-auth.ts";
import {
  listRuntimeInstalledModels,
  pullRuntimeModelViaHost,
} from "./host-client.ts";
import {
  ensureOllamaCloudAccess,
  isOllamaCloudModelId,
} from "./ollama-cloud-access.ts";

interface RuntimeEnsureModelAvailableOptions
  extends EnsureModelAvailabilityOptions {
  requireCloudAccess?: boolean;
  onCloudWaiting?: () => void;
  onCloudError?: (message: string) => void;
  onCloudOutput?: (line: string) => void;
}

function createCloudAccessFailure(status: string): {
  ok: boolean;
  status: string;
  error?: string;
} {
  const messages: Record<string, string> = {
    signin_failed: "Cloud sign-in failed.",
    verification_failed: "Cloud sign-in was not completed.",
  };
  return { ok: false, status, error: messages[status] ?? "Cloud access is unavailable." };
}

export async function getRuntimeModelAvailability(
  modelId: string,
): Promise<ModelAvailabilitySnapshot> {
  return await getModelAvailability(modelId, {
    listModels: listRuntimeInstalledModels,
  });
}

export async function ensureRuntimeModelAvailable(
  modelId: string,
  options: RuntimeEnsureModelAvailableOptions = {},
): Promise<EnsureModelAvailabilityResult> {
  const resolveCloudAccess = async (fullModelId: string) => {
    const access = await ensureOllamaCloudAccess(fullModelId, {
      onWaiting: options.onCloudWaiting,
      onError: options.onCloudError,
      onOutput: options.onCloudOutput,
    });
    return access.ok
      ? { ok: true, status: access.status }
      : createCloudAccessFailure(access.status);
  };

  return await ensureModelAvailability(
    modelId,
    {
      listModels: listRuntimeInstalledModels,
      pullModel: pullRuntimeModelViaHost,
      handlePullAuthError: async (
        fullModelId: string,
        errorMessage: string,
      ) => {
        if (
          !isOllamaCloudModelId(fullModelId) ||
          !isOllamaAuthErrorMessage(errorMessage)
        ) {
          return null;
        }
        return await resolveCloudAccess(fullModelId);
      },
      ensureAccess: options.requireCloudAccess && isOllamaCloudModelId(modelId)
        ? resolveCloudAccess
        : undefined,
    },
    options,
  );
}

export { resolveModelAvailabilityTarget };
