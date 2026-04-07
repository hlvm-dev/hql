import { extractMentionedFilePaths } from "./request-paths.ts";

export interface DelegationSignal {
  shouldDelegate: boolean;
  reason: string;
  suggestedPattern: "fan-out" | "specialist" | "batch" | "sequential" | "none";
  estimatedSubtasks?: number;
}

export async function evaluateDelegationSignal(
  request: string,
): Promise<DelegationSignal> {
  const trimmed = request.trim();
  if (!trimmed) {
    return {
      shouldDelegate: false,
      reason: "Empty request",
      suggestedPattern: "none",
    };
  }

  // Multi-file: 3+ distinct file paths -> fan-out (structural, not semantic)
  const fileMatches = extractMentionedFilePaths(trimmed);
  const uniqueFiles = fileMatches ? new Set(fileMatches) : new Set<string>();
  if (uniqueFiles.size >= 3) {
    return {
      shouldDelegate: true,
      reason: `${uniqueFiles.size} distinct file paths detected`,
      suggestedPattern: "fan-out",
      estimatedSubtasks: uniqueFiles.size,
    };
  }

  const { classifyDelegation } = await import("../runtime/local-llm.ts");
  const result = await classifyDelegation(trimmed);

  if (!result.shouldDelegate) {
    return {
      shouldDelegate: false,
      reason: "No strong delegation signal detected",
      suggestedPattern: "none",
    };
  }

  return {
    shouldDelegate: true,
    reason: `LLM classified as ${result.pattern} delegation`,
    suggestedPattern: result.pattern === "sequential" ? "sequential" : result.pattern,
    estimatedSubtasks: uniqueFiles.size || 2,
  };
}
