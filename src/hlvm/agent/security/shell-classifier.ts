// L0 auto-approved (read-only), L1 confirm-once, L2 always confirm.

import { SHELL_ALLOWLIST_L0, SHELL_ALLOWLIST_L1, SHELL_DENYLIST_L0 } from "../constants.ts";

export interface ShellCommandClassification {
  level: "L0" | "L1" | "L2";
  reason: string;
}

const SHELL_METACHAR = /[;|&`<>]|\$\(/;
const ANALYSIS_WHITESPACE = /[\u00a0\u1680\u180e\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]/g;
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

function normalizeCommandForClassification(command: string): string {
  return command
    .replace(/\r\n?/g, "\n")
    .replace(ANALYSIS_WHITESPACE, " ")
    .replace(CONTROL_CHARS, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .trim();
}

function detectEscalatingShellConstruct(normalized: string): string | null {
  if (!normalized) return null;

  if (/(^|\s)(IFS|BASH_ENV|ENV|SHELLOPTS|PROMPT_COMMAND|CDPATH)=/i.test(normalized)) {
    return "Shell parser environment mutation detected";
  }
  if (/`[^`]*`|\$\(|<\(|>\(/.test(normalized)) {
    return "Shell command/process substitution detected";
  }
  if (
    /\b(?:env\s+(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*)?(?:sh|bash|zsh)\s+-c\b/i
      .test(normalized)
  ) {
    return "Shell trampoline detected";
  }
  if (normalized.includes("\n") || /<<<?|<<-/.test(normalized)) {
    return "Multiline shell script or heredoc detected";
  }
  if (
    /\bfind\b[\s\S]*\s-(?:exec|execdir|ok|okdir)\b|\bxargs\b|\bparallel\b/i
      .test(normalized)
  ) {
    return "Executor indirection detected";
  }
  if (/\b(?:curl|wget)\b[\s\S]*\|\s*(?:sh|bash|zsh)\b/i.test(normalized)) {
    return "Remote install/exec pipeline detected";
  }
  if (/\bssh\b[\s\S]*['"][^'"]*['"]/.test(normalized)) {
    return "Remote shell execution detected";
  }
  return null;
}

interface AllowlistMatchReasons {
  l0: string;
  l1: string;
  destructive: string;
  unrecognized: string;
}

function classifyAgainstAllowlists(
  matchTarget: string,
  display: string,
  reasons: AllowlistMatchReasons,
): ShellCommandClassification {
  for (const pattern of SHELL_ALLOWLIST_L0) {
    if (!pattern.test(matchTarget)) continue;
    for (const deny of SHELL_DENYLIST_L0) {
      if (deny.test(matchTarget)) {
        return { level: "L2", reason: `${reasons.destructive}: ${display}` };
      }
    }
    return { level: "L0", reason: `${reasons.l0}: ${display}` };
  }
  for (const pattern of SHELL_ALLOWLIST_L1) {
    if (pattern.test(matchTarget)) {
      return { level: "L1", reason: `${reasons.l1}: ${display}` };
    }
  }
  return { level: "L2", reason: `${reasons.unrecognized}: ${display}` };
}

export function classifyShellCommand(command: string): ShellCommandClassification {
  const trimmed = normalizeCommandForClassification(command);

  const escalatingReason = detectEscalatingShellConstruct(trimmed);
  if (escalatingReason) {
    return { level: "L2", reason: `${escalatingReason}: ${trimmed}` };
  }

  if (SHELL_METACHAR.test(trimmed)) {
    return { level: "L2", reason: `Shell metacharacters detected: ${trimmed}` };
  }

  return classifyAgainstAllowlists(trimmed, trimmed, {
    l0: "Read-only command (auto-approved)",
    l1: "Allow-listed command",
    destructive: "Destructive flag on read-only command",
    unrecognized: "Shell command requires confirmation",
  });
}

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

/** Strip redirect operators, flag unsafe file redirects.
 * Safe: `N>/dev/null`, `N>&N`, `</dev/null`. Unsafe: `> file`, `>> file`, `N> file` to anything else. */
function analyzeRedirects(segment: string): { baseCommand: string; hasUnsafeRedirect: boolean } {
  const anyRedirect = /(\d*>>?\s*)([^\s|&]+)/g;
  let hasUnsafe = false;
  for (const match of segment.matchAll(anyRedirect)) {
    const target = match[2];
    if (target !== "/dev/null" && !target.startsWith("&")) hasUnsafe = true;
  }
  const cleaned = segment.replace(/\d*>>?\s*\S+/g, "").replace(/<\s*\S+/g, "").trim();
  return { baseCommand: cleaned, hasUnsafeRedirect: hasUnsafe };
}

/** Classify a pipeline segment without re-running the metachar pre-filter. */
function classifyBaseCommand(command: string): ShellCommandClassification {
  const trimmed = command.trim();
  if (!trimmed) return { level: "L0", reason: "Empty segment" };
  // Allowlist patterns are anchored like /^sort\s/, so a bare command like "sort"
  // needs a trailing space to match.
  const matchTarget = /\s/.test(trimmed) ? trimmed : trimmed + " ";
  return classifyAgainstAllowlists(matchTarget, trimmed, {
    l0: "Read-only command",
    l1: "Allow-listed command",
    destructive: "Destructive flag",
    unrecognized: "Unrecognized command",
  });
}

/** Classify a command that may contain pipes, analyzing each segment. */
export function classifyShellPipeline(command: string): ShellCommandClassification {
  const trimmed = normalizeCommandForClassification(command);
  const escalatingReason = detectEscalatingShellConstruct(trimmed);
  if (escalatingReason) {
    return { level: "L2", reason: `${escalatingReason}: ${trimmed}` };
  }
  if (!SHELL_METACHAR.test(trimmed)) return classifyShellCommand(trimmed);
  // Chaining (;, &&, ||) is too complex to analyze safely; refuse.
  if (/[;&]/.test(trimmed)) {
    return { level: "L2", reason: "Shell chaining/subshells detected" };
  }
  let highestLevel: "L0" | "L1" | "L2" = "L0";
  for (const segment of splitByPipe(trimmed)) {
    const { baseCommand, hasUnsafeRedirect } = analyzeRedirects(segment.trim());
    if (hasUnsafeRedirect) return { level: "L2", reason: "File redirect detected" };
    const classification = classifyBaseCommand(baseCommand);
    if (classification.level === "L2") return classification;
    if (classification.level === "L1" && highestLevel === "L0") highestLevel = "L1";
  }
  return { level: highestLevel, reason: `Pipeline: all segments ${highestLevel}` };
}
