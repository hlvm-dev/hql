/**
 * Grounding Checks - Lightweight validation for tool-grounded responses
 *
 * Purpose:
 * - Detect likely ungrounded answers when tools were used
 * - Flag fabricated "[Tool Result]" blocks
 * - Provide warnings without blocking by default
 */

// ============================================================
// Types
// ============================================================

export interface ToolUse {
  toolName: string;
  result: string;
}

export interface GroundingCheckResult {
  grounded: boolean;
  warnings: string[];
}

// ============================================================
// Checks
// ============================================================

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
