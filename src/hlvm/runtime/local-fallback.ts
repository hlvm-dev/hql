/**
 * SSOT local fallback — single source of truth for the gemma4 last-resort model.
 *
 * All callers (agent mode, direct chat, serve) import from here instead of
 * maintaining their own constants, error classification, and readiness checks.
 */

import { LOCAL_FALLBACK_MODEL } from "./bootstrap-manifest.ts";
import { classifyError } from "../agent/error-taxonomy.ts";

/** Fully-qualified model ID for the local gemma4 fallback. */
export const LOCAL_FALLBACK_MODEL_ID = `ollama/${LOCAL_FALLBACK_MODEL}`;

/**
 * Classify an error for local fallback purposes.
 *
 * Returns the error class string if the error warrants trying the local
 * gemma4 fallback (truthy), or `null` if it does not (falsy).
 *
 * Callers that also need the error class for tracing use this directly;
 * callers that only need a boolean check use `isLocalFallbackWorthy`.
 *
 * Worthy: rate_limit, transient, timeout, unknown, and
 * permanent with 401/403 status (auth failure = cloud key bad,
 * but local gemma4 can still answer).
 */
export function classifyForLocalFallback(error: unknown): string | null {
  const { class: errorClass } = classifyError(error);
  switch (errorClass) {
    case "rate_limit":
    case "transient":
    case "timeout":
    case "unknown":
      return errorClass;
    case "permanent": {
      // Auth failures (bad cloud key) should still try local fallback
      const status = (error as { statusCode?: number })?.statusCode;
      return (status === 401 || status === 403) ? errorClass : null;
    }
    case "abort":
    case "context_overflow":
      return null;
  }
}

/** Boolean convenience wrapper around `classifyForLocalFallback`. */
export function isLocalFallbackWorthy(error: unknown): boolean {
  return classifyForLocalFallback(error) !== null;
}

/**
 * Whether the local fallback model is on disk AND the runtime is accepting requests.
 * Both conditions must hold — callers should never skip either check.
 */
export async function isLocalFallbackReady(): Promise<boolean> {
  const [{ isFallbackModelAvailable }, { isRuntimeReadyForAiRequests }] =
    await Promise.all([
      import("./bootstrap-verify.ts"),
      import("../cli/commands/serve.ts"),
    ]);
  return isRuntimeReadyForAiRequests() && await isFallbackModelAvailable();
}
