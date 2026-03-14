import { extractMentionedFilePaths } from "./request-paths.ts";

export interface DelegationSignal {
  shouldDelegate: boolean;
  reason: string;
  suggestedPattern: "fan-out" | "specialist" | "batch" | "sequential" | "none";
  estimatedSubtasks?: number;
}

const FAN_OUT_PATTERNS = [
  /\b(in parallel|concurrently|simultaneously|at the same time)\b/i,
  /\b(for each|for every)\b/i,
];

const BATCH_PATTERNS = [
  /\b(across all|every (?:file|module|component|test))\b/i,
  /\b(all files|each module|each component|all modules)\b/i,
];

export function evaluateDelegationSignal(
  request: string,
): DelegationSignal {
  const trimmed = request.trim();

  // Too small: < 50 words -> don't delegate
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 50) {
    // Check for explicit parallel cues even in short requests
    for (const pattern of FAN_OUT_PATTERNS) {
      if (pattern.test(trimmed)) {
        const fileMatches = extractMentionedFilePaths(trimmed);
        return {
          shouldDelegate: true,
          reason: "Explicit parallel work cue detected",
          suggestedPattern: "fan-out",
          estimatedSubtasks: fileMatches?.length ?? 2,
        };
      }
    }

    return {
      shouldDelegate: false,
      reason: "Task is small (< 50 words) with no parallel cues",
      suggestedPattern: "none",
    };
  }

  // Multi-file: 3+ distinct file paths -> fan-out
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

  // Parallel cues -> fan-out
  for (const pattern of FAN_OUT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        shouldDelegate: true,
        reason: "Parallel work cue detected",
        suggestedPattern: "fan-out",
        estimatedSubtasks: uniqueFiles.size || 2,
      };
    }
  }

  // Batch cues -> batch
  for (const pattern of BATCH_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        shouldDelegate: true,
        reason: "Batch processing cue detected",
        suggestedPattern: "batch",
      };
    }
  }

  // Default: no strong signal
  return {
    shouldDelegate: false,
    reason: "No strong delegation signal detected",
    suggestedPattern: "none",
  };
}
