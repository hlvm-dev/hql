/**
 * Grounding Checks - Lightweight validation for tool-grounded responses
 *
 * Purpose:
 * - Detect likely ungrounded answers when tools were used
 * - Flag fabricated tool output or tool calls in plain text
 * - Provide warnings without blocking by default
 */

import { getAllTools } from "./registry.ts";

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
  new RegExp(`TOOL_CALL\\s*[:\\s]+(${TOOL_NAME_PATTERN})`, "g"),
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

  // Rule 1c: TOOL_CALL markers should only appear in tool envelopes
  if (/\bTOOL_CALL\b/.test(response)) {
    warnings.push(
      "Response includes 'TOOL_CALL' outside the required tool envelope.",
    );
  }

  // Rule 1d: Unknown tool names should never be claimed
  const claimedTools = extractClaimedToolNames(response);
  if (claimedTools.length > 0) {
    const knownTools = new Set(Object.keys(getAllTools()));
    const unknownTools = claimedTools.filter((name) => !knownTools.has(name));
    if (unknownTools.length > 0) {
      warnings.push(
        `Response references unknown tool(s): ${unknownTools.join(", ")}.`,
      );
    }
  }

  // Rule 2: If tools were used, response should cite sources
  if (toolUses.length > 0) {
    const mentionsBasedOn = lower.includes("based on") || lower.includes("according to");
    const mentionsTool = toolUses.some((tool) => {
      const normalized = tool.toolName.replace(/_/g, " ");
      return lower.includes(normalized) || lower.includes(tool.toolName);
    });

    if (!mentionsBasedOn && !mentionsTool) {
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
