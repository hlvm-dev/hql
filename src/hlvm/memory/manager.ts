/**
 * Memory Manager - DB-first context assembly for system prompt injection.
 */

import { estimateTokensFromText } from "../../common/token-utils.ts";
import { getValidFacts } from "./facts.ts";
import { warnMemory } from "./store.ts";

const LARGE_CONTEXT_THRESHOLD = 32_000;
const MEDIUM_CONTEXT_THRESHOLD = 16_000;
const MEMORY_SIZE_WARNING = 3000;
const MEMORY_MAX_TOKENS = 6000;
const MEMORY_BUDGET_RATIO = 0.15;

function maxFactsForContext(contextWindow: number): number {
  if (contextWindow >= LARGE_CONTEXT_THRESHOLD) return 120;
  if (contextWindow >= MEDIUM_CONTEXT_THRESHOLD) return 60;
  return 30;
}

function groupFactsForPrompt(facts: ReturnType<typeof getValidFacts>): string {
  const grouped = new Map<string, string[]>();

  for (const fact of facts) {
    const category = fact.category || "General";
    const entries = grouped.get(category) ?? [];
    entries.push(`- ${fact.content}`);
    grouped.set(category, entries);
  }

  return [...grouped.entries()]
    .map(([category, entries]) => `## ${category}\n${entries.join("\n")}`)
    .join("\n\n");
}

export function buildMemorySystemMessage(memoryContext: string): string {
  return [
    "# Your Memory",
    "This memory is durable, global, and non-chronological.",
    "Use it for facts, preferences, and prior decisions.",
    'Do not use it to answer recency questions like "last time", "most recent", or "what did we just do" unless the same chronology is confirmed by session history or an explicit recent-history context.',
    "If recent prompt history or explicit chronology context is provided, treat that as authoritative and do not fill chronology gaps from memory.",
    "",
    memoryContext,
  ].join("\n");
}

export async function loadMemoryContext(
  contextWindow: number,
): Promise<string> {
  const maxFacts = maxFactsForContext(contextWindow);
  const facts = getValidFacts({ limit: maxFacts });
  if (facts.length === 0) return "";

  const combined = groupFactsForPrompt(facts);
  const maxTokens = Math.min(
    Math.floor(contextWindow * MEMORY_BUDGET_RATIO),
    MEMORY_MAX_TOKENS,
  );
  const tokens = estimateTokensFromText(combined);

  if (tokens > maxTokens) {
    const maxChars = maxTokens * 4;
    const truncated = combined.slice(0, maxChars);
    const lastNewline = truncated.lastIndexOf("\n");
    const finalContent = lastNewline > 0
      ? truncated.slice(0, lastNewline) +
        "\n\n[Memory truncated — consider consolidating facts]"
      : truncated;
    await warnMemory(
      `Memory context truncated from ~${tokens} to ~${maxTokens} tokens.`,
    );
    return finalContent;
  }

  if (tokens > MEMORY_SIZE_WARNING) {
    await warnMemory(
      `Memory context is large (~${tokens} tokens). Consider consolidating facts.`,
    );
  }

  return combined;
}
