/**
 * Claude Code session memory helpers.
 *
 * Single source of truth for:
 * - session-memory enablement defaults
 * - metadata parsing
 * - claude command construction with optional --resume
 * - init-event session_id capture logic
 */

export interface ParsedSessionMemoryMetadata {
  existingMeta: Record<string, unknown>;
  claudeCodeSessionId: string | null;
}

/**
 * Session memory is ON by default unless explicitly disabled.
 */
export function isSessionMemoryEnabled(sessionMemory: boolean | undefined): boolean {
  return sessionMemory !== false;
}

/**
 * Parse session metadata and recover stored Claude Code session ID.
 * Malformed/non-object metadata is treated as empty metadata.
 */
export function parseSessionMemoryMetadata(
  metadata: string | null | undefined,
): ParsedSessionMemoryMetadata {
  if (!metadata) {
    return { existingMeta: {}, claudeCodeSessionId: null };
  }

  try {
    const parsed = JSON.parse(metadata);
    if (!parsed || typeof parsed !== "object") {
      return { existingMeta: {}, claudeCodeSessionId: null };
    }

    const existingMeta = parsed as Record<string, unknown>;
    const claudeCodeSessionId = typeof existingMeta.claudeCodeSessionId === "string"
      ? existingMeta.claudeCodeSessionId
      : null;
    return { existingMeta, claudeCodeSessionId };
  } catch {
    return { existingMeta: {}, claudeCodeSessionId: null };
  }
}

/**
 * Build Claude Code stream-json command with optional resume token.
 */
export function buildClaudeCodeCommand(
  query: string,
  claudeCodeSessionId: string | null,
): string[] {
  return claudeCodeSessionId
    ? ["claude", "--resume", claudeCodeSessionId, "-p", query, "--output-format", "stream-json", "--verbose"]
    : ["claude", "-p", query, "--output-format", "stream-json", "--verbose"];
}

/**
 * Capture session_id from a Claude Code system/init event.
 * Returns true when metadata was updated.
 */
export function captureSessionIdFromInitEvent(
  event: unknown,
  sessionMemoryEnabled: boolean,
  claudeCodeSessionId: string | null,
  existingMeta: Record<string, unknown>,
): boolean {
  if (!sessionMemoryEnabled || !event || typeof event !== "object") {
    return false;
  }

  const record = event as Record<string, unknown>;
  if (
    record.type === "system" &&
    record.subtype === "init" &&
    typeof record.session_id === "string" &&
    record.session_id !== claudeCodeSessionId
  ) {
    existingMeta.claudeCodeSessionId = record.session_id;
    return true;
  }

  return false;
}
