import { extractMentionedFilePaths } from "./request-paths.ts";

export interface DelegationSignal {
  shouldDelegate: boolean;
  reason: string;
  suggestedPattern: "fan-out" | "specialist" | "batch" | "sequential" | "none";
  taskDomain: "browser" | "general";
  estimatedSubtasks?: number;
}

const PARALLEL_CUE_PATTERN =
  /\b(?:in parallel|parallel(?:ly)?|concurrently|simultaneously)\b/i;
const BATCH_CUE_PATTERN =
  /\b(?:each of these files|process each|for each|across all files|across the .* directory|across .* directory|all files|all modules|every module|every file|each file|each module)\b/i;

async function requestLooksLikeBrowserAutomation(
  request: string,
): Promise<boolean> {
  // Structural short-circuits: tool names and URLs are unambiguous signals
  if (/\b(?:pw|cu)_(?:\*|[a-z0-9_]+)(?![a-z0-9_])/i.test(request)) return true;
  if (/\bhttps?:\/\/|\bwww\./i.test(request)) return true;
  // Browser-action verb + domain-like pattern (e.g., "go to python.org")
  if (/\b(?:go to|open|navigate to|visit)\s+\S*\w+\.(?:com|org|net|dev|io|ai|gov|edu|co|me|app|page|site|wiki)\b/i.test(request)) return true;

  const { classifyBrowserAutomation } = await import(
    "../runtime/local-llm.ts"
  );
  const result = await classifyBrowserAutomation(request);
  return result.isBrowserTask;
}

function detectDeterministicDelegation(
  request: string,
  uniqueFileCount: number,
): DelegationSignal | null {
  if (PARALLEL_CUE_PATTERN.test(request)) {
    return {
      shouldDelegate: true,
      reason: uniqueFileCount >= 2
        ? `${uniqueFileCount} file targets with an explicit parallel cue`
        : "Explicit parallel cue detected",
      suggestedPattern: "fan-out",
      taskDomain: "general",
      estimatedSubtasks: Math.max(2, uniqueFileCount || 2),
    };
  }

  if (BATCH_CUE_PATTERN.test(request)) {
    return {
      shouldDelegate: true,
      reason: "Explicit batch-style cue detected across many targets",
      suggestedPattern: "batch",
      taskDomain: "general",
      estimatedSubtasks: Math.max(2, uniqueFileCount || 2),
    };
  }

  return null;
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

  const structuralSignal = detectDeterministicDelegation(
    trimmed,
    uniqueFiles.size,
  );
  if (structuralSignal) {
    return structuralSignal;
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
