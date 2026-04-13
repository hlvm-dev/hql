import { AI_NO_OUTPUT_FALLBACK_TEXT } from "../../common/ai-messages.ts";
import { isOllamaAuthErrorMessage } from "../../common/ollama-auth.ts";
import { getErrorMessage } from "../../common/utils.ts";
import { sleep } from "../../common/timeout-utils.ts";
import { ai } from "../api/ai.ts";

interface ModelAccessProbeResult {
  available: boolean;
  authRequired?: boolean;
  error?: string;
}

export interface WaitForModelAccessOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  onRetry?: (result: ModelAccessProbeResult, elapsedMs: number) => void;
}

const MODEL_ACCESS_TIMEOUT_MS = 60_000;
const MODEL_ACCESS_POLL_INTERVAL_MS = 2_000;

/** Probe model access with a tiny non-streaming chat request on the runtime side. */
export async function probeModelAccess(
  modelId: string,
): Promise<ModelAccessProbeResult> {
  let stream: AsyncIterator<string> | null = null;
  try {
    stream = ai.chat(
      [{ role: "user", content: "ok" }],
      {
        model: modelId,
        stream: false,
        maxTokens: 1,
        temperature: 0,
      },
    )[Symbol.asyncIterator]();
    const first = await stream.next();
    if (first.done) return { available: false };

    const chunk = String(first.value ?? "").trim();
    if (
      chunk.length === 0 || chunk.startsWith("Error:") ||
      chunk === AI_NO_OUTPUT_FALLBACK_TEXT
    ) {
      return { available: false };
    }

    return { available: true };
  } catch (error) {
    const message = getErrorMessage(error);
    if (isOllamaAuthErrorMessage(message)) {
      return { available: false, authRequired: true };
    }
    return { available: false, error: message };
  } finally {
    try {
      await stream?.return?.();
    } catch {
      // Iterator already closed.
    }
  }
}

export async function waitForModelAccess(
  modelId: string,
  options: WaitForModelAccessOptions = {},
): Promise<ModelAccessProbeResult> {
  const timeoutMs = options.timeoutMs ?? MODEL_ACCESS_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? MODEL_ACCESS_POLL_INTERVAL_MS;
  const startedAt = Date.now();
  const deadline = Date.now() + timeoutMs;

  let result = await probeModelAccess(modelId);
  while (
    !result.available &&
    !result.authRequired &&
    Date.now() < deadline
  ) {
    options.onRetry?.(result, Date.now() - startedAt);
    await sleep(pollIntervalMs);
    result = await probeModelAccess(modelId);
  }

  return result;
}
