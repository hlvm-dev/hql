import { AI_NO_OUTPUT_FALLBACK_TEXT } from "../../common/ai-messages.ts";
import { isOllamaAuthErrorMessage } from "../../common/ollama-auth.ts";
import { getErrorMessage } from "../../common/utils.ts";
import { ai } from "../api/ai.ts";
import { log } from "../api/log.ts";

interface ModelAccessProbeResult {
  available: boolean;
  authRequired?: boolean;
  error?: string;
}

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
    log.error(`Cloud access check failed: ${message}`);
    return { available: false, error: message };
  } finally {
    try {
      await stream?.return?.();
    } catch {
      // Iterator already closed.
    }
  }
}
