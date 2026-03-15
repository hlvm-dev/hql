import { parseModelString } from "../providers/registry.ts";
import { isOllamaCloudModel } from "../providers/ollama/cloud.ts";
import { getErrorMessage } from "../../common/utils.ts";
import {
  runRuntimeOllamaSignin,
  verifyRuntimeModelAccess,
} from "./host-client.ts";

const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_WAIT_INTERVAL_MS = 2_000;

interface RunOllamaCloudSigninOptions {
  onOutput?: (line: string) => void;
}

interface VerifyOllamaCloudAccessOptions {
  onError?: (message: string) => void;
}

interface EnsureOllamaCloudAccessOptions {
  onOutput?: (line: string) => void;
  onError?: (message: string) => void;
  onWaiting?: () => void;
  timeoutMs?: number;
  intervalMs?: number;
  runSignin?: () => Promise<boolean>;
  verifyAccess?: (modelId: string) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
}

interface EnsureOllamaCloudAccessResult {
  ok: boolean;
  status: "available" | "ready" | "signin_failed" | "verification_failed";
}

export function isOllamaCloudModelId(modelId: string): boolean {
  const [providerName, modelName] = parseModelString(modelId);
  return providerName === "ollama" && isOllamaCloudModel(modelName);
}

export async function runOllamaCloudSignin(
  options: RunOllamaCloudSigninOptions = {},
): Promise<boolean> {
  try {
    const result = await runRuntimeOllamaSignin();
    for (const line of result.output) {
      options.onOutput?.(line);
    }
    return result.success;
  } catch {
    return false;
  }
}

export async function verifyOllamaCloudAccess(
  modelId: string,
  options: VerifyOllamaCloudAccessOptions = {},
): Promise<boolean> {
  try {
    return await verifyRuntimeModelAccess(modelId);
  } catch (error) {
    const message = getErrorMessage(error);
    options.onError?.(message);
    return false;
  }
}

export async function ensureOllamaCloudAccess(
  modelId: string,
  options: EnsureOllamaCloudAccessOptions = {},
): Promise<EnsureOllamaCloudAccessResult> {
  const verifyAccess = options.verifyAccess ??
    ((id: string) => verifyOllamaCloudAccess(id, options));
  const runSignin = options.runSignin ??
    (() => runOllamaCloudSignin(options));
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS;
  const sleep = options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  if (await verifyAccess(modelId)) {
    return { ok: true, status: "available" };
  }

  if (!(await runSignin())) {
    return { ok: false, status: "signin_failed" };
  }

  options.onWaiting?.();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await verifyAccess(modelId)) {
      return { ok: true, status: "ready" };
    }
    await sleep(intervalMs);
  }

  return { ok: false, status: "verification_failed" };
}
