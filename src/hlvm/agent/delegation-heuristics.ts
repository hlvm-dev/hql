import { extractMentionedFilePaths } from "./request-paths.ts";

export interface DelegationSignal {
  shouldDelegate: boolean;
  reason: string;
  suggestedPattern: "fan-out" | "specialist" | "batch" | "sequential" | "none";
  taskDomain: "browser" | "general";
  estimatedSubtasks?: number;
}

async function requestLooksLikeBrowserAutomation(
  request: string,
): Promise<boolean> {
  // Structural short-circuits: tool names, URLs, and browser-intent phrases
  if (/\b(?:pw|cu)_(?:\*|[a-z0-9_]+)(?![a-z0-9_])/i.test(request)) return true;
  if (/\bhttps?:\/\/|\bwww\./i.test(request)) return true;
  if (/\b(?:go to|open|navigate to|visit|browse)\b.*\b\w+\.\w{2,}\b/i.test(request)) return true;

  const { classifyBrowserAutomation } = await import(
    "../runtime/local-llm.ts"
  );
  const result = await classifyBrowserAutomation(request);
  return result.isBrowserTask;
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
      taskDomain: "general",
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
      taskDomain: "general",
      estimatedSubtasks: uniqueFiles.size,
    };
  }

  if (await requestLooksLikeBrowserAutomation(trimmed)) {
    return {
      shouldDelegate: false,
      reason: "Browser interaction task detected",
      suggestedPattern: "none",
      taskDomain: "browser",
    };
  }

  const { classifyDelegation } = await import("../runtime/local-llm.ts");
  const result = await classifyDelegation(trimmed);

  if (!result.shouldDelegate) {
    return {
      shouldDelegate: false,
      reason: "No strong delegation signal detected",
      suggestedPattern: "none",
      taskDomain: "general",
    };
  }

  return {
    shouldDelegate: true,
    reason: `LLM classified as ${result.pattern} delegation`,
    suggestedPattern: result.pattern === "sequential"
      ? "sequential"
      : result.pattern,
    taskDomain: "general",
    estimatedSubtasks: uniqueFiles.size || 2,
  };
}
