/**
 * Grounding Checks - Lightweight validation for tool-grounded responses
 *
 * Purpose:
 * - Detect likely ungrounded answers when tools were used
 * - Flag fabricated tool output or tool calls in plain text
 * - Provide warnings without blocking by default
 */

import { hasTool } from "./registry.ts";
import type { Citation } from "./tools/web/search-provider.ts";

const CITATION_BACKED_WEB_TOOL_NAMES = new Set([
  "search_web",
  "web_fetch",
  "fetch_url",
]);

function isCurrentCitationBackedWebTool(toolName: string): boolean {
  return CITATION_BACKED_WEB_TOOL_NAMES.has(toolName);
}

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
  return [...names];
}

/**
 * Check if the response incorporates specific data values from tool results
 * using LLM classification. Falls back to false on error.
 */
async function responseIncorporatesToolData(
  response: string,
  toolUses: ToolUse[],
): Promise<boolean> {
  const nonEmptyTools = toolUses.filter((t) => t.result && t.result.length > 0);
  if (nonEmptyTools.length === 0) return false;

  const { classifyGroundedness } = await import("../runtime/local-llm.ts");
  const toolSummaries = nonEmptyTools
    .map((t) => `${t.toolName}: ${JSON.stringify(t.result).slice(0, 100)}`)
    .join("\n");
  const result = await classifyGroundedness(response, toolSummaries);
  return result.incorporatesData;
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
  return isCurrentCitationBackedWebTool(toolUse.toolName) ||
    toolUseHasCitationPayload(toolUse);
}

function usesOnlyCitationBackedWebTools(toolUses: ToolUse[]): boolean {
  return toolUses.length > 0 &&
    toolUses.every((toolUse) => isCurrentCitationBackedWebTool(toolUse.toolName));
}

function toolUseIndicatesEmptyCitationBackedResult(toolUse: ToolUse): boolean {
  if (!isCurrentCitationBackedWebTool(toolUse.toolName)) return false;

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

export async function checkGrounding(
  response: string,
  toolUses: ToolUse[],
  citationSpans: Citation[] = [],
): Promise<GroundingCheckResult> {
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
    const incorporatesData = await responseIncorporatesToolData(response, toolUses);
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
