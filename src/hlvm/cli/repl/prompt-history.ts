import type { ReplState } from "./state.ts";

export type PromptHistorySource =
  | "evaluate"
  | "command"
  | "conversation"
  | "interaction";

export function shouldRecordPromptHistory(
  source: PromptHistorySource,
): boolean {
  return source !== "evaluate";
}

export function recordPromptHistory(
  replState: Pick<ReplState, "addHistory">,
  input: string,
  source: PromptHistorySource,
): void {
  if (!shouldRecordPromptHistory(source)) {
    return;
  }
  replState.addHistory(input);
}

const DEFAULT_RECENT_PROMPT_LIMIT = 20;

const RECENCY_QUERY_PATTERNS = [
  /\blast time\b/i,
  /\bmost recent\b/i,
  /\bprevious\b/i,
  /\blast command\b/i,
  /\bwhat did i do\b/i,
  /\bwhat did i ask\b/i,
  /\bwhat was the last\b/i,
  /\brecently\b/i,
  /\bbefore that\b/i,
  /\bbefore then\b/i,
  /\bearlier than that\b/i,
  /\bfurther back\b/i,
  /\bfarther back\b/i,
];

export function isPromptRecencyQuery(input: string): boolean {
  const normalized = input.trim();
  return RECENCY_QUERY_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function getRecentPromptEntries(
  history: readonly string[],
  currentInput: string,
  limit = DEFAULT_RECENT_PROMPT_LIMIT,
): string[] {
  const normalizedCurrent = currentInput.trim();
  const entries = history
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.at(-1) === normalizedCurrent) {
    entries.pop();
  }

  return entries.slice(-limit).reverse();
}

export function buildRecentPromptHistoryContext(
  history: readonly string[],
  currentInput: string,
  limit = DEFAULT_RECENT_PROMPT_LIMIT,
): string | null {
  if (!isPromptRecencyQuery(currentInput)) {
    return null;
  }

  const recent = getRecentPromptEntries(history, currentInput, limit);
  if (recent.length === 0) {
    return null;
  }

  return [
    "# Recent REPL Prompt History",
    "Use this as the authoritative source for chronology questions about what the user asked in this REPL.",
    'Answer questions like "last time", "before that", "previous", and "what did I ask" from this history only.',
    "Do not use durable memory to infer missing chronology. If this history is insufficient, say so plainly.",
    "This list is ordered most recent first.",
    ...recent.map((entry, index) => `${index + 1}. ${entry}`),
  ].join("\n");
}
