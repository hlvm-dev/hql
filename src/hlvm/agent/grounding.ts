/**
 * Grounding Checks - Lightweight validation for tool-grounded responses
 *
 * Purpose:
 * - Detect likely ungrounded answers when tools were used
 * - Flag fabricated tool output or tool calls in plain text
 * - Provide warnings without blocking by default
 */

import { hasTool } from "./registry.ts";
import { isCitationBackedWebToolName } from "./tool-capabilities.ts";
import type { Citation } from "./tools/web/search-provider.ts";

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
  "this",
  "that",
  "with",
  "from",
  "have",
  "been",
  "were",
  "will",
  "your",
  "their",
  "about",
  "would",
  "there",
  "could",
  "other",
  "which",
  "when",
  "each",
  "make",
  "like",
  "into",
  "over",
  "such",
  "after",
  "also",
  "most",
  "some",
  "than",
  "them",
  "then",
  "true",
  "false",
  "null",
  "undefined",
  "string",
  "number",
  "result",
  "error",
  "success",
  "found",
  "total",
  "count",
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
    pattern.lastIndex = 0;
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
  // Pre-filter: skip tools with empty results
  const nonEmptyTools = toolUses.filter((t) => t.result && t.result.length > 0);
  if (nonEmptyTools.length === 0) return false;

  // Tokenize response once into Sets for O(1) lookups.
  // Keep numbers separate so trailing sentence punctuation like "4."
  // still matches a tool result value of "4".
  const responseLower = response.toLowerCase();
  const responseNumbers = new Set(
    responseLower.match(/\b\d+(?:\.\d+)?\b/g) ?? [],
  );
  const responseTokens = new Set(
    responseLower.match(/[a-z_][\w.-]*/g)?.map((t) => t.toLowerCase()) ?? [],
  );
  if (responseNumbers.size === 0 && responseTokens.size === 0) return false;

  // Single-pass: collect unique numbers and significant tokens across all tool results
  const numberSet = new Set<string>();
  const tokenSet = new Set<string>();

  const MAX_NUMBERS = 20;
  const MAX_TOKENS = 50;

  for (const tool of nonEmptyTools) {
    const result = tool.result;

    // Extract numbers (integers and decimals), capped
    if (numberSet.size < MAX_NUMBERS) {
      const numbers = result.match(/\b\d+(?:\.\d+)?\b/g);
      if (numbers) {
        for (const n of numbers) {
          if (numberSet.size >= MAX_NUMBERS) break;
          const num = parseFloat(n);
          if (num > 1 || n.includes(".")) {
            numberSet.add(n);
          }
        }
      }
    }

    // Extract significant tokens (4+ char words, not common English), capped
    if (tokenSet.size < MAX_TOKENS) {
      const tokens = result.match(/[a-zA-Z_][\w.-]{3,}/g);
      if (tokens) {
        for (const t of tokens) {
          if (tokenSet.size >= MAX_TOKENS) break;
          const lower = t.toLowerCase();
          if (!COMMON_WORDS.has(lower)) {
            tokenSet.add(lower);
          }
        }
      }
    }
  }

  // Check numbers first (cheaper — typically fewer)
  for (const n of numberSet) {
    if (responseNumbers.has(n)) return true;
  }

  // Check significant tokens — require at least 2 matches
  let matches = 0;
  for (const token of tokenSet) {
    if (responseTokens.has(token)) {
      matches++;
      if (matches >= 2) return true;
    }
  }

  return false;
}

function toolUseHasCitationPayload(toolUse: ToolUse): boolean {
  try {
    const parsed = JSON.parse(toolUse.result);
    return Boolean(parsed.citation || parsed.citations);
  } catch {
    return false;
  }
}

function isCitationBackedToolUse(toolUse: ToolUse): boolean {
  return isCitationBackedWebToolName(toolUse.toolName) ||
    toolUseHasCitationPayload(toolUse);
}

function usesOnlyCitationBackedWebTools(toolUses: ToolUse[]): boolean {
  return toolUses.length > 0 &&
    toolUses.every((toolUse) => isCitationBackedWebToolName(toolUse.toolName));
}

function toolUseIndicatesEmptyCitationBackedResult(toolUse: ToolUse): boolean {
  if (!isCitationBackedWebToolName(toolUse.toolName)) return false;

  try {
    const parsed = JSON.parse(toolUse.result);
    if (!parsed || typeof parsed !== "object") return false;

    const objectValue = parsed as Record<string, unknown>;
    const results = objectValue.results;
    if (Array.isArray(results) && results.length === 0) return true;

    const count = objectValue.count;
    if (typeof count === "number" && count === 0) return true;
  } catch {
    // Non-JSON tool payloads are treated as non-empty by default.
  }

  return false;
}

function hasCitationData(
  toolUses: ToolUse[],
  citationSpans: Citation[] = [],
): boolean {
  const hasAnyCitations = citationSpans.length > 0 ||
    toolUses.some(toolUseHasCitationPayload);
  if (!hasAnyCitations) return false;
  return toolUses.length > 0 && toolUses.every(isCitationBackedToolUse);
}

export function checkGrounding(
  response: string,
  toolUses: ToolUse[],
  citationSpans: Citation[] = [],
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
    const mentionsBasedOn = lower.includes("based on") ||
      lower.includes("according to");
    const mentionsTool = toolUses.some((tool) => {
      const normalized = tool.toolName.replace(/_/g, " ");
      return lower.includes(normalized) || lower.includes(tool.toolName);
    });
    const incorporatesData = responseIncorporatesToolData(response, toolUses);
    const citationBackedOnly = usesOnlyCitationBackedWebTools(toolUses);
    const emptyCitationBackedResultsOnly = citationBackedOnly &&
      toolUses.every(toolUseIndicatesEmptyCitationBackedResult);
    const hasCitations = hasCitationData(toolUses, citationSpans);

    if (citationBackedOnly && !hasCitations && !emptyCitationBackedResultsOnly) {
      warnings.push(
        "Citation-backed web tools were used but no citations were produced.",
      );
    }

    if (
      !(citationBackedOnly && !hasCitations && !emptyCitationBackedResultsOnly) &&
      !mentionsBasedOn &&
      !mentionsTool &&
      !incorporatesData &&
      !hasCitations
    ) {
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
