/**
 * Shell Command Classifier
 *
 * SSOT for determining shell_exec safety level based on allow-lists.
 * Shared by safety classifier and shell tools.
 *
 * Three levels:
 * - L0: Read-only commands, auto-approved (same trust as read_file/list_files)
 * - L1: Low-risk commands, prompt once per session
 * - L2: Everything else, always prompt
 */

import { SHELL_ALLOWLIST_L0, SHELL_ALLOWLIST_L1, SHELL_DENYLIST_L0 } from "../constants.ts";

export interface ShellCommandClassification {
  level: "L0" | "L1" | "L2";
  reason: string;
}

const SHELL_METACHAR = /[;|&`<>]|\$\(/;

export function classifyShellCommand(command: string): ShellCommandClassification {
  const trimmed = command.trim();

  // Shell metacharacters bypass allowlist — always require confirmation
  if (SHELL_METACHAR.test(trimmed)) {
    return {
      level: "L2",
      reason: `Shell metacharacters detected: ${trimmed}`,
    };
  }

  for (const pattern of SHELL_ALLOWLIST_L0) {
    if (pattern.test(trimmed)) {
      // Deny-list check: destructive flags on otherwise-safe commands
      for (const deny of SHELL_DENYLIST_L0) {
        if (deny.test(trimmed)) {
          return {
            level: "L2",
            reason: `Destructive flag on read-only command: ${trimmed}`,
          };
        }
      }
      return {
        level: "L0",
        reason: `Read-only command (auto-approved): ${trimmed}`,
      };
    }
  }

  for (const pattern of SHELL_ALLOWLIST_L1) {
    if (pattern.test(trimmed)) {
      return {
        level: "L1",
        reason: `Allow-listed command: ${trimmed}`,
      };
    }
  }

  return {
    level: "L2",
    reason: `Shell command requires confirmation: ${trimmed}`,
  };
}

// ============================================================
// Pipeline-Aware Classifier
// ============================================================

/** Split command by pipe operator outside quotes */
function splitByPipe(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inSingle = false, inDouble = false, escaped = false;
  for (const ch of command) {
    if (escaped) { current += ch; escaped = false; continue; }
    if (ch === "\\") { current += ch; escaped = true; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; continue; }
    if (ch === "|" && !inSingle && !inDouble) {
      segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) segments.push(current);
  return segments;
}

/** Strip redirect operators, flag unsafe file redirects */
function analyzeRedirects(segment: string): { baseCommand: string; hasUnsafeRedirect: boolean } {
  // Safe: N>/dev/null, N>&N, </dev/null
  // Unsafe: > file, >> file, N> file (where file != /dev/null)
  const anyRedirect = /(\d*>>?\s*)([^\s|&]+)/g;
  let hasUnsafe = false;
  // Check each redirect
  for (const match of segment.matchAll(anyRedirect)) {
    const target = match[2];
    if (target !== "/dev/null" && !target.startsWith("&")) {
      hasUnsafe = true;
    }
  }
  // Strip all redirects for base command classification
  const cleaned = segment.replace(/\d*>>?\s*\S+/g, "").replace(/<\s*\S+/g, "").trim();
  return { baseCommand: cleaned, hasUnsafeRedirect: hasUnsafe };
}

/** Classify a single command against allowlists (WITHOUT metachar pre-filter) */
function classifyBaseCommand(command: string): ShellCommandClassification {
  const trimmed = command.trim();
  if (!trimmed) return { level: "L0", reason: "Empty segment" };

  // Many allowlist patterns expect `\s` after the command name (e.g. /^sort\s/).
  // For bare commands like "sort" in a pipeline, append a space so they match.
  const matchTarget = /\s/.test(trimmed) ? trimmed : trimmed + " ";

  for (const pattern of SHELL_ALLOWLIST_L0) {
    if (pattern.test(matchTarget)) {
      for (const deny of SHELL_DENYLIST_L0) {
        if (deny.test(matchTarget)) {
          return { level: "L2", reason: `Destructive flag: ${trimmed}` };
        }
      }
      return { level: "L0", reason: `Read-only command: ${trimmed}` };
    }
  }
  for (const pattern of SHELL_ALLOWLIST_L1) {
    if (pattern.test(matchTarget)) {
      return { level: "L1", reason: `Allow-listed command: ${trimmed}` };
    }
  }
  return { level: "L2", reason: `Unrecognized command: ${trimmed}` };
}

/** Classify a command that may contain pipes, analyzing each segment */
export function classifyShellPipeline(command: string): ShellCommandClassification {
  const trimmed = command.trim();
  // No metacharacters → fast path via existing classifier
  if (!SHELL_METACHAR.test(trimmed)) {
    return classifyShellCommand(trimmed);
  }
  // Chaining (;, &&, ||) or subshells ($()) → L2 (too complex to analyze)
  if (/[;&]|`|\$\(/.test(trimmed)) {
    return { level: "L2", reason: "Shell chaining/subshells detected" };
  }
  // Pipeline: split by pipe, classify each segment
  const segments = splitByPipe(trimmed);
  let highestLevel: "L0" | "L1" | "L2" = "L0";
  for (const segment of segments) {
    const { baseCommand, hasUnsafeRedirect } = analyzeRedirects(segment.trim());
    if (hasUnsafeRedirect) return { level: "L2", reason: "File redirect detected" };
    const classification = classifyBaseCommand(baseCommand);
    if (classification.level === "L2") return classification;
    if (classification.level === "L1" && highestLevel === "L0") highestLevel = "L1";
  }
  return { level: highestLevel, reason: `Pipeline: all segments ${highestLevel}` };
}
