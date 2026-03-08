/**
 * Claude Code session memory helpers.
 *
 * Single source of truth for:
 * - session-memory enablement defaults
 * - metadata parsing
 * - claude command construction with optional --resume
 * - init-event session_id capture logic
 */

import { getPlatform } from "../../../../platform/platform.ts";
import { parseSessionMetadata } from "../../../store/session-metadata.ts";

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
  const existingMeta = parseSessionMetadata(metadata);
  const claudeCodeSessionId = typeof existingMeta.claudeCodeSessionId === "string"
    ? existingMeta.claudeCodeSessionId
    : null;
  return { existingMeta, claudeCodeSessionId };
}

/**
 * Resolve the absolute path to the `claude` CLI binary.
 * GUI-spawned processes don't inherit the user's shell PATH, so we probe
 * known install locations before falling back to bare "claude" (PATH lookup).
 */
let _resolvedClaudePath: string | undefined;
function resolveClaudeBinary(): string {
  if (_resolvedClaudePath) return _resolvedClaudePath;

  const platform = getPlatform();
  const home = platform.env.get("HOME") ?? platform.env.get("USERPROFILE") ?? "";
  const isWindows = platform.env.get("OS") === "Windows_NT"
    || (platform.env.get("COMSPEC") ?? "").includes("cmd.exe");

  const candidates: string[] = isWindows
    ? [
        `${home}\\.local\\bin\\claude.exe`,         // npm global (Windows)
        `${platform.env.get("APPDATA") ?? ""}\\npm\\claude.cmd`,  // npm global (Windows alt)
        `${platform.env.get("LOCALAPPDATA") ?? ""}\\Programs\\claude\\claude.exe`, // installer
      ]
    : [
        `${home}/.local/bin/claude`,   // npm global (default on macOS/Linux)
        "/usr/local/bin/claude",       // manual / symlink
        "/opt/homebrew/bin/claude",    // Homebrew (macOS)
      ];

  for (const p of candidates) {
    try {
      const stat = platform.fs.statSync(p);
      if (stat.isFile) {
        _resolvedClaudePath = p;
        return p;
      }
    } catch { /* not found, try next */ }
  }

  _resolvedClaudePath = "claude"; // fallback to PATH
  return _resolvedClaudePath;
}

/** @internal Reset cached binary path (for tests only). */
export function _resetClaudeBinaryCache(): void {
  _resolvedClaudePath = undefined;
}

/**
 * Build Claude Code stream-json command with optional resume token.
 */
export function buildClaudeCodeCommand(
  query: string,
  claudeCodeSessionId: string | null,
): string[] {
  const bin = resolveClaudeBinary();
  return claudeCodeSessionId
    ? [bin, "--resume", claudeCodeSessionId, "-p", query, "--output-format", "stream-json", "--verbose"]
    : [bin, "-p", query, "--output-format", "stream-json", "--verbose"];
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
