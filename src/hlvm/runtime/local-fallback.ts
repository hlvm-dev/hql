/**
 * SSOT local fallback — single source of truth for the last-resort local model,
 * error classification, and the generic fallback chain used by ALL LLM call sites.
 *
 * All callers (agent mode, direct chat, serve) import from here instead of
 * maintaining their own constants, error classification, and readiness checks.
 */

import { LOCAL_FALLBACK_MODEL } from "./bootstrap-manifest.ts";
import { classifyError } from "../agent/error-taxonomy.ts";

// ============================================================
// Constants
// ============================================================

/** Fully-qualified model ID for the baseline local fallback. */
export const LOCAL_FALLBACK_MODEL_ID = `ollama/${LOCAL_FALLBACK_MODEL}`;

export async function resolveLocalFallbackModelId(): Promise<string> {
  const { findAvailableLocalFallbackModel } = await import(
    "./bootstrap-manifest.ts"
  );
  const availableModel = await findAvailableLocalFallbackModel();
  return availableModel ? `ollama/${availableModel}` : LOCAL_FALLBACK_MODEL_ID;
}

// ============================================================
// Error Classification
// ============================================================

/**
 * Classify an error for local fallback purposes.
 *
 * Returns the error class string if the error warrants trying the local
 * fallback (truthy), or `null` if it does not (falsy).
 *
 * Callers that also need the error class for tracing use this directly;
 * callers that only need a boolean check use `isLocalFallbackWorthy`.
 *
 * Worthy: rate_limit, transient, timeout, unknown, and
 * permanent with 401/403 status (auth failure = cloud key bad,
 * but the local fallback can still answer).
 */
export async function classifyForLocalFallback(
  error: unknown,
): Promise<string | null> {
  const { class: errorClass, message } = await classifyError(error);
  switch (errorClass) {
    case "rate_limit":
    case "transient":
    case "timeout":
    case "unknown":
      return errorClass;
    case "permanent": {
      // Cloud credential/quota failures should still try local fallback.
      // Invalid prompts, tool schemas, model IDs, and user-denied actions should not.
      const status = (error as { status?: number; statusCode?: number })
        ?.statusCode ??
        (error as { status?: number; statusCode?: number })?.status;
      if (status === 401 || status === 403) return errorClass;
      if (
        /api[ _-]?key|authentication_error|invalid_grant|oauth token|claude login|re-authenticate|http 40[13]|unauthorized|quota|insufficient_quota|billing/i
          .test(message)
      ) {
        return errorClass;
      }
      return null;
    }
    case "abort":
    case "context_overflow":
      return null;
  }
}

/** Boolean convenience wrapper around `classifyForLocalFallback`. */
export async function isLocalFallbackWorthy(error: unknown): Promise<boolean> {
  return (await classifyForLocalFallback(error)) !== null;
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
  const fallbackModelId = await resolveLocalFallbackModelId();
  return isRuntimeReadyForAiRequests() &&
    await isFallbackModelAvailable(fallbackModelId.split("/").pop());
}

// ============================================================
// Generic Fallback Chain (SSOT for all LLM call sites)
// ============================================================

/** Local last-resort model config. */
export interface LastResortFallback {
  model: string;
  isAvailable: () => Promise<boolean>;
}

/** Configuration for the generic fallback chain. */
export interface FallbackChainConfig<T> {
  /** Concrete primary model ID, when known. Used only for tracing/reporting. */
  primaryModel?: string;
  /** Execute the primary model call. */
  tryPrimary: () => Promise<T>;
  /** Scored fallback model IDs to try in order. */
  fallbacks: string[];
  /** Optional dynamic guard for cases where fallback becomes unsafe after partial output. */
  canFallback?: () => boolean;
  /** Execute a scored fallback model call. */
  tryFallback: (model: string) => Promise<T>;
  /** Local last-resort model. */
  lastResort?: LastResortFallback;
  /** Execute the last-resort model call. Falls back to tryFallback if omitted. */
  tryLastResort?: (model: string) => Promise<T>;
  /** Trace callback for observability. */
  onTrace?: (from: string, to: string, reason: string) => void;
  /** Called after a fallback-worthy model failure is classified. */
  onModelFailure?: (
    model: string,
    error: unknown,
    reason: string,
  ) => void | Promise<void>;
  /** Called when all fallbacks exhausted AND last-resort unavailable. Must throw. */
  onLastResortUnavailable?: (originalError: unknown) => never;
}

/**
 * Generic fallback chain — immediate last-resort on fallback-worthy failures.
 *
 * Flow:
 * 1. Try primary
 * 2. On fallback-worthy error + last-resort ready → jump to last-resort immediately
 * 3. Last-resort NOT ready → try scored fallbacks as degraded path
 * 4. All exhausted → onLastResortUnavailable or throw original
 *
 * Non-fallback-worthy errors (invalid request, abort, context_overflow) propagate immediately.
 */
export async function withFallbackChain<T>(
  config: FallbackChainConfig<T>,
): Promise<T> {
  try {
    return await config.tryPrimary();
  } catch (error) {
    const reason = await classifyForLocalFallback(error);
    if (!reason) throw error;
    const primaryModel = config.primaryModel ?? "primary";
    await config.onModelFailure?.(primaryModel, error, reason);
    if (config.canFallback && !config.canFallback()) throw error;

    const lastResortReady = config.lastResort != null &&
      await config.lastResort.isAvailable();

    // Fast path: local last-resort is ready — use it immediately.
    // Cloud fallbacks waste time (retries, backoff) for the same outcome.
    if (lastResortReady) {
      config.onTrace?.(
        primaryModel,
        config.lastResort!.model,
        reason,
      );
      const tryLr = config.tryLastResort ?? config.tryFallback;
      return await tryLr(config.lastResort!.model);
    }

    // Degraded path: last-resort NOT ready — try scored fallbacks.
    for (const model of config.fallbacks) {
      config.onTrace?.(primaryModel, model, reason);
      try {
        return await config.tryFallback(model);
      } catch (fbError) {
        const fbReason = await classifyForLocalFallback(fbError);
        if (!fbReason) throw fbError;
        await config.onModelFailure?.(model, fbError, fbReason);
      }
    }

    if (config.onLastResortUnavailable) {
      config.onLastResortUnavailable(error);
    }

    throw error;
  }
}
