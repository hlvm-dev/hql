/**
 * End-of-session fact extraction.
 */

import { insertFact } from "./facts.ts";
import { linkFactEntities } from "./entities.ts";
import type { MemoryModelTier } from "./invalidate.ts";

interface SessionMessage {
  role: string;
  content: string;
}

const PREF_PATTERNS = [
  /\bI (?:prefer|like|use)\s+(.{3,120})/i,
  /\b(?:we|I) decided to\s+(.{3,120})/i,
  /\b(?:we|I) chose\s+(.{3,120})/i,
];

const BUG_PATTERNS = [
  /\b(?:fixed|resolved|patched)\s+(.{4,140})/i,
  /\bbug\b.{4,120}/i,
];

function shouldSkipMessage(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (trimmed.length < 8) return true;
  if (/^```/.test(trimmed)) return true;
  return false;
}

function extractFactsFromText(text: string): Array<{ category: string; content: string }> {
  const facts: Array<{ category: string; content: string }> = [];

  for (const pattern of PREF_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[0]) {
      facts.push({ category: "Preferences", content: match[0].trim() });
      break;
    }
  }

  for (const pattern of BUG_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[0]) {
      facts.push({ category: "Bugs", content: match[0].trim() });
      break;
    }
  }

  return facts;
}

export function extractSessionFacts(
  messages: SessionMessage[],
  modelTier: MemoryModelTier,
): { factsExtracted: number; entitiesCreated: number } {
  if (modelTier !== "frontier") return { factsExtracted: 0, entitiesCreated: 0 };

  const userMessages = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .filter((content) => !shouldSkipMessage(content));

  if (userMessages.length < 2) {
    return { factsExtracted: 0, entitiesCreated: 0 };
  }

  let factsExtracted = 0;
  let entitiesCreated = 0;

  for (const text of userMessages.slice(-20)) {
    const extracted = extractFactsFromText(text);
    for (const fact of extracted) {
      const factId = insertFact({
        content: fact.content,
        category: fact.category,
        source: "extracted",
      });
      factsExtracted++;
      entitiesCreated += linkFactEntities(factId, fact.content);
    }
  }

  return { factsExtracted, entitiesCreated };
}
