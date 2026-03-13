/**
 * Memory Manager - canonical memory prompt assembly for all AI surfaces.
 *
 * Two sources (priority order):
 *   1. ~/.hlvm/memory/MEMORY.md  — user-authored, free-form notes
 *   2. memory.db facts           — auto-learned by the agent
 */

import { estimateTokensFromText } from "../../common/token-utils.ts";
import { readExplicitMemory } from "./explicit.ts";
import { getValidFacts } from "./facts.ts";
import { warnMemory } from "./store.ts";

const LARGE_CONTEXT_THRESHOLD = 32_000;
const MEDIUM_CONTEXT_THRESHOLD = 16_000;
const MEMORY_SIZE_WARNING = 3000;
const MEMORY_MAX_TOKENS = 6000;
const MEMORY_BUDGET_RATIO = 0.15;
const MEMORY_SYSTEM_MESSAGE_HEADER = "# Your Memory";

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

function truncateToTokenBudget(
  content: string,
  maxTokens: number,
): { text: string; tokens: number; truncated: boolean } {
  const tokens = estimateTokensFromText(content);
  if (tokens <= maxTokens) return { text: content, tokens, truncated: false };

  const maxChars = maxTokens * 4;
  const sliced = content.slice(0, maxChars);
  const lastNewline = sliced.lastIndexOf("\n");
  const text = lastNewline > 0 ? sliced.slice(0, lastNewline) : sliced;
  return { text, tokens: maxTokens, truncated: true };
}

export function buildMemorySystemMessage(memoryContext: string): string {
  return [
    MEMORY_SYSTEM_MESSAGE_HEADER,
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
  const maxTokens = Math.min(
    Math.floor(contextWindow * MEMORY_BUDGET_RATIO),
    MEMORY_MAX_TOKENS,
  );

  // --- Priority 1: User-authored MEMORY.md ---
  const rawMd = await readExplicitMemory();
  let mdSection = "";
  let remainingTokens = maxTokens;

  if (rawMd.length > 0) {
    const result = truncateToTokenBudget(rawMd, remainingTokens);
    mdSection = result.text;
    remainingTokens -= result.tokens;
    if (result.truncated) {
      await warnMemory(
        "MEMORY.md truncated to fit token budget. Consider shortening it.",
      );
    }
  }

  // --- Priority 2: Auto-learned DB facts ---
  let dbSection = "";
  if (remainingTokens > 0) {
    const maxFacts = maxFactsForContext(contextWindow);
    const facts = getValidFacts({ limit: maxFacts });

    if (facts.length > 0) {
      const grouped = groupFactsForPrompt(facts);
      const result = truncateToTokenBudget(grouped, remainingTokens);
      dbSection = result.text;

      if (result.truncated) {
        dbSection += "\n\n[Memory truncated — consider consolidating facts]";
        await warnMemory(
          `Memory context truncated to ~${maxTokens} tokens.`,
        );
      } else if (result.tokens > MEMORY_SIZE_WARNING) {
        await warnMemory(
          `Memory context is large (~${result.tokens} tokens). Consider consolidating facts.`,
        );
      }
    }
  }

  // --- Combine ---
  if (mdSection && dbSection) return `${mdSection}\n\n---\n\n${dbSection}`;
  return mdSection || dbSection;
}

export function isMemorySystemMessage(content: string): boolean {
  return content.startsWith(MEMORY_SYSTEM_MESSAGE_HEADER);
}

export async function loadMemorySystemMessage(
  contextWindow: number,
): Promise<{ role: "system"; content: string } | null> {
  const memoryContext = await loadMemoryContext(contextWindow);
  if (!memoryContext) return null;
  return {
    role: "system",
    content: buildMemorySystemMessage(memoryContext),
  };
}
