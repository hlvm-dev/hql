/**
 * Token Utilities - SSOT for token estimation
 *
 * Provides a single, shared implementation for token estimation
 * based on character length. This avoids duplicate logic across
 * context, usage tracking, and stats.
 */

/**
 * Estimate token count from text length.
 *
 * Simple heuristic: 4 characters ≈ 1 token.
 * Used consistently throughout the agent core.
 */
function estimateTokensFromCharCount(charCount: number): number {
  return Math.ceil(charCount / 4);
}

export function estimateTokensFromText(text: string): number {
  return estimateTokensFromCharCount(text.length);
}

/**
 * Estimate token count for a set of messages.
 */
export function estimateTokensFromMessages(
  messages: Array<{ content: string }>
): number {
  const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
  return estimateTokensFromCharCount(totalChars);
}
