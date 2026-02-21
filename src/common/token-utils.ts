/**
 * Token Utilities - SSOT for token estimation
 *
 * Provides a single, shared implementation for token estimation
 * based on character length. This avoids duplicate logic across
 * context, usage tracking, and stats.
 */

const DEFAULT_CHARS_PER_TOKEN = 4.0;
const MIN_CHARS_PER_TOKEN = 1.5;
const MAX_CHARS_PER_TOKEN = 8.0;
const ADAPTIVE_ALPHA = 0.2;
const GLOBAL_ESTIMATOR_KEY = "__global__";

interface EstimatorState {
  charsPerToken: number;
  sampleCount: number;
}

const estimatorStates = new Map<string, EstimatorState>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeEstimatorKey(modelKey?: string): string {
  if (!modelKey) return GLOBAL_ESTIMATOR_KEY;
  const normalized = modelKey.trim().toLowerCase();
  return normalized.length > 0 ? normalized : GLOBAL_ESTIMATOR_KEY;
}

function getEstimatorState(key: string): EstimatorState | undefined {
  return estimatorStates.get(key);
}

function setEstimatorState(key: string, state: EstimatorState): void {
  estimatorStates.set(key, state);
}

/**
 * Observe a real token usage sample and adapt the estimator.
 * This keeps context estimation aligned with provider-reported token usage.
 */
export function observeTokenUsage(
  charCount: number,
  tokenCount: number,
  modelKey?: string,
): void {
  if (!Number.isFinite(charCount) || !Number.isFinite(tokenCount)) return;
  if (charCount <= 0 || tokenCount <= 0) return;

  const observedCharsPerToken = clamp(
    charCount / tokenCount,
    MIN_CHARS_PER_TOKEN,
    MAX_CHARS_PER_TOKEN,
  );

  const keys = new Set<string>([
    GLOBAL_ESTIMATOR_KEY,
    normalizeEstimatorKey(modelKey),
  ]);
  for (const key of keys) {
    const existing = getEstimatorState(key);
    const next: EstimatorState = existing
      ? {
        charsPerToken: (existing.charsPerToken * (1 - ADAPTIVE_ALPHA)) +
          (observedCharsPerToken * ADAPTIVE_ALPHA),
        sampleCount: existing.sampleCount + 1,
      }
      : {
        charsPerToken: observedCharsPerToken,
        sampleCount: 1,
      };
    setEstimatorState(key, next);
  }
}

/**
 * Estimate token count from text length.
 *
 * Uses an adaptive chars-per-token estimator calibrated from provider-reported
 * token usage when available; falls back to default 4.0 chars/token.
 */
export function estimateTokensFromCharCount(
  charCount: number,
  modelKey?: string,
): number {
  const modelState = getEstimatorState(normalizeEstimatorKey(modelKey));
  const globalState = getEstimatorState(GLOBAL_ESTIMATOR_KEY);
  const charsPerToken = modelState?.sampleCount
    ? modelState.charsPerToken
    : globalState?.sampleCount
    ? globalState.charsPerToken
    : DEFAULT_CHARS_PER_TOKEN;
  return Math.ceil(charCount / charsPerToken);
}

export function estimateTokensFromText(text: string, modelKey?: string): number {
  return estimateTokensFromCharCount(text.length, modelKey);
}

/**
 * Estimate token count for a set of messages.
 */
export function estimateTokensFromMessages(
  messages: Array<{ content: string }>,
  modelKey?: string,
): number {
  const totalChars = getMessageCharCount(messages);
  return estimateTokensFromCharCount(totalChars, modelKey);
}

/** Count total message content characters. */
export function getMessageCharCount(
  messages: Array<{ content: string }>,
): number {
  return messages.reduce((sum, msg) => sum + msg.content.length, 0);
}
