/**
 * Shared relevant-memory recall formatting for chat and agent mode.
 */

import { truncate } from "../../common/utils.ts";
import { type RetrievalResult, retrieveMemory } from "./retrieve.ts";

const DEFAULT_MEMORY_RECALL_RESULT_LIMIT = 3;
const MEMORY_RECALL_MAX_QUERY_CHARS = 400;
const MEMORY_RECALL_RESULT_CHARS = 220;

function formatMemoryRecall(results: RetrievalResult[]): string {
  const lines = results.map((result) => {
    const source = result.file.split(/[\\/]/).pop() ?? result.file;
    const excerpt = truncate(
      result.text.replace(/\s+/g, " ").trim(),
      MEMORY_RECALL_RESULT_CHARS,
    );
    return `- [${result.date}] ${source}: ${excerpt}`;
  });

  return [
    "[Memory Recall] Relevant notes from earlier work:",
    ...lines,
    "Use these only when they match the current task.",
  ].join("\n");
}

export interface RelevantMemoryRecall {
  message: { role: "system"; content: string };
  results: RetrievalResult[];
}

export function buildRelevantMemoryRecall(
  query: string,
  limit = DEFAULT_MEMORY_RECALL_RESULT_LIMIT,
): RelevantMemoryRecall | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const results = retrieveMemory(
    trimmed.slice(0, MEMORY_RECALL_MAX_QUERY_CHARS),
    limit,
  );
  if (results.length === 0) return null;

  return {
    message: {
      role: "system",
      content: formatMemoryRecall(results),
    },
    results,
  };
}
