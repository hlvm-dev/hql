/**
 * Grounding Checks - Lightweight validation for tool-grounded responses
 *
 * Purpose:
 * - Detect likely ungrounded answers when tools were used
 * - Flag fabricated tool output or tool calls in plain text
 * - Provide warnings without blocking by default
 */

import { hasTool } from "./registry.ts";

// ============================================================
// Types
// ============================================================

export interface ToolUse {
  toolName: string;
  result: string;
}

interface GroundingCheckResult {
  grounded: boolean;
  warnings: string[];
}

// ============================================================
// Checks
// ============================================================

const TOOL_NAME_PATTERN = "[a-zA-Z0-9_-]{2,}";

/** Common English words to exclude from token matching (module-level constant) */
const COMMON_WORDS = new Set([
  "this", "that", "with", "from", "have", "been", "were", "will",
  "your", "their", "about", "would", "there", "could", "other",
  "which", "when", "each", "make", "like", "into", "over", "such",
  "after", "also", "most", "some", "than", "them", "then",
  "true", "false", "null", "undefined", "string", "number",
  "result", "error", "success", "found", "total", "count",
]);

const TOOL_CLAIM_PATTERNS: RegExp[] = [
  new RegExp(`\\bTool:\\s*(${TOOL_NAME_PATTERN})`, "gi"),
  new RegExp(`\\btool\\s+call\\s*[:\\s]+(${TOOL_NAME_PATTERN})`, "gi"),
  new RegExp(`"(${TOOL_NAME_PATTERN})"\\s+tool`, "gi"),
  new RegExp("`(" + TOOL_NAME_PATTERN + ")`\\s+tool", "gi"),
  new RegExp(`\\busing\\s+the\\s+(${TOOL_NAME_PATTERN})\\s+tool\\b`, "gi"),
  new RegExp(`\\buse\\s+the\\s+(${TOOL_NAME_PATTERN})\\s+tool\\b`, "gi"),
];

function extractClaimedToolNames(response: string): string[] {
  const names = new Set<string>();
  for (const pattern of TOOL_CLAIM_PATTERNS) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(response)) !== null) {
      if (match[1]) {
        names.add(match[1]);
      }
    }
  }
  return Array.from(names);
}

/**
 * Check if the response incorporates specific data values from tool results.
 *
 * Extracts numbers and significant tokens from tool results and checks
 * if any appear in the response. This handles cases where the model
 * correctly uses tool data without explicitly citing tool names.
 *
 * Example: Tool returns "4", response says "The result is 4" → grounded.
 */
function responseIncorporatesToolData(
  response: string,
  toolUses: ToolUse[],
): boolean {
  const responseLower = response.toLowerCase();

  for (const tool of toolUses) {
    const result = tool.result;
    if (!result || result.length === 0) continue;

    // Extract numbers from tool result (integers and decimals)
    const numbers = result.match(/\b\d+(?:\.\d+)?\b/g);
    if (numbers) {
      // Check for specific numbers (not just "0" or "1" which are too generic)
      const specificNumbers = numbers.filter((n) => {
        const num = parseFloat(n);
        return num > 1 || n.includes(".");
      });
      if (specificNumbers.some((n) => responseLower.includes(n))) {
        return true;
      }
    }

    // Extract significant tokens (4+ char words, not common English)
    const tokens = result.match(/[a-zA-Z_][\w.-]{3,}/g);
    if (tokens) {
      const significantTokens = tokens.filter((t) =>
        !COMMON_WORDS.has(t.toLowerCase())
      );
      // Require at least 2 significant token matches to avoid false positives
      let matches = 0;
      for (const token of significantTokens) {
        if (responseLower.includes(token.toLowerCase())) {
          matches++;
          if (matches >= 2) return true;
        }
      }
    }
  }

  return false;
}

export function checkGrounding(
  response: string,
  toolUses: ToolUse[],
): GroundingCheckResult {
  const warnings: string[] = [];
  const lower = response.toLowerCase();

  // Rule 1: Never fabricate [Tool Result] blocks
  if (response.includes("[Tool Result]")) {
    warnings.push(
      "Response includes '[Tool Result]' which should only be system-generated.",
    );
  }

  // Rule 1b: Avoid fabricated tool result headers
  const toolResultHeaderPattern = /(^|\n)\s*Tool Result\s*(?:[:\-]|$)/i;
  if (toolResultHeaderPattern.test(response)) {
    warnings.push(
      "Response includes a 'Tool Result' header which should only be system-generated.",
    );
  }

  // Rule 1d: Unknown tool names should never be claimed
  const claimedTools = extractClaimedToolNames(response);
  if (claimedTools.length > 0) {
    const unknownTools = claimedTools.filter(
      (name) => !hasTool(name) && /[_-]/.test(name),
    );
    if (unknownTools.length > 0) {
      warnings.push(
        `Response references unknown tool(s): ${unknownTools.join(", ")}.`,
      );
    }
  }

  // Rule 2: If tools were used, response should be grounded in tool data
  if (toolUses.length > 0) {
    const mentionsBasedOn = lower.includes("based on") || lower.includes("according to");
    const mentionsTool = toolUses.some((tool) => {
      const normalized = tool.toolName.replace(/_/g, " ");
      return lower.includes(normalized) || lower.includes(tool.toolName);
    });
    const incorporatesData = responseIncorporatesToolData(response, toolUses);

    if (!mentionsBasedOn && !mentionsTool && !incorporatesData) {
      warnings.push(
        "Response does not cite tool sources. Include tool names or 'Based on ...'.",
      );
    }
  }

  return {
    grounded: warnings.length === 0,
    warnings,
  };
}
