/**
 * Shared fact extraction for chat and agent flows.
 * Frontier models use LLM-based extraction; all tiers fall back to regex.
 */

import { getFactDb } from "./db.ts";
import { type WriteMemoryFactOptions, writeMemoryFacts } from "./pipeline.ts";
import type { MemoryModelTier } from "./invalidate.ts";

declare const ai: { chat(messages: Array<{ role: string; content: string }>, options?: Record<string, unknown>): AsyncGenerator<string, void, unknown> };

interface SessionMessage {
  role: string;
  content: string;
}

interface ExtractedMemoryFact {
  category: string;
  content: string;
}

interface PersistedExtractionResult {
  factsExtracted: number;
  entitiesCreated: number;
  invalidated: number;
  factIds: number[];
}

const EMPTY_EXTRACTION: PersistedExtractionResult = {
  factsExtracted: 0,
  entitiesCreated: 0,
  invalidated: 0,
  factIds: [],
};

const NOT_NAMES = new Set([
  "thinking",
  "wondering",
  "looking",
  "trying",
  "going",
  "working",
  "happy",
  "sorry",
  "sure",
  "glad",
  "fine",
  "good",
  "great",
  "okay",
  "confused",
  "interested",
  "curious",
  "new",
  "here",
  "back",
  "done",
  "not",
  "a",
  "the",
  "just",
  "also",
  "really",
  "very",
]);

const NAME_PATTERNS = [
  /\bmy name is\s+([A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*){0,3})/i,
  /\bi'?m\s+([A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*){0,3})/i,
  /\bcall me\s+([A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*){0,3})/i,
];

const PREFERENCE_PATTERNS = [
  /\bi (?:prefer|like|use|want|need)\s+([^.!?\n]{3,80})/i,
];

const REMEMBER_PATTERNS = [
  /\b(?:remember|don'?t forget)\s+(?:that\s+)?([^.!?\n]{5,120})/i,
];

const DECISION_PATTERNS = [
  /\b(?:we|i) decided to\s+([^.!?\n]{3,120})/i,
  /\b(?:we|i) chose\s+([^.!?\n]{3,120})/i,
];

const BUG_PATTERNS = [
  /\b(?:fixed|resolved|patched)\s+([^.!?\n]{4,140})/i,
  /\bbug\b([^.!?\n]{4,120})/i,
];

const CODE_FENCE_RE = /^```/;
const COLLAPSE_WHITESPACE_RE = /\s+/g;
const TRAILING_PUNCTUATION_RE = /[.!?,;:]+$/g;
const CODE_FENCE_OPEN_RE = /^```(?:json)?\s*\n?/m;
const CODE_FENCE_CLOSE_RE = /\n?```\s*$/m;
const SENTENCE_SPLIT_RE = /[^.!?\n]+[.!?]?/g;

function shouldSkipText(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (trimmed.length < 8) return true;
  if (CODE_FENCE_RE.test(trimmed)) return true;
  return false;
}

function normalizeExtractedContent(content: string): string {
  return content
    .replace(COLLAPSE_WHITESPACE_RE, " ")
    .replace(TRAILING_PUNCTUATION_RE, "")
    .trim();
}

function sentenceCase(content: string): string {
  if (!content) return content;
  return content.charAt(0).toUpperCase() + content.slice(1);
}

function splitIntoExtractionUnits(text: string): string[] {
  return (text.match(SENTENCE_SPLIT_RE) ?? [])
    .map((unit) => unit.trim())
    .filter(Boolean);
}

function addUniqueFact(
  out: ExtractedMemoryFact[],
  seen: Set<string>,
  fact: ExtractedMemoryFact | null,
): void {
  if (!fact) return;
  const content = normalizeExtractedContent(fact.content);
  if (!content) return;
  const key = factKey(fact.category, content);
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ category: fact.category, content });
}

function factKey(category: string, content: string): string {
  return `${category}\u0000${content.toLowerCase()}`;
}

function extractNameFact(unit: string): ExtractedMemoryFact | null {
  for (const pattern of NAME_PATTERNS) {
    const match = pattern.exec(unit);
    if (!match?.[1]) continue;
    const name = normalizeExtractedContent(match[1]);
    const firstWord = name.toLowerCase().split(/\s+/)[0];
    if (!name || NOT_NAMES.has(firstWord)) continue;
    return {
      category: "Identity",
      content: `User's name: ${name}`,
    };
  }

  return null;
}

function extractSentenceFact(
  unit: string,
  category: string,
  patterns: RegExp[],
): ExtractedMemoryFact | null {
  for (const pattern of patterns) {
    const match = pattern.exec(unit);
    if (!match?.[0]) continue;
    return {
      category,
      content: sentenceCase(normalizeExtractedContent(match[0])),
    };
  }

  return null;
}

function persistExtractedFacts(
  facts: ExtractedMemoryFact[],
  options?: {
    source?: string;
    invalidateConflicts?: boolean;
    modelTier?: MemoryModelTier;
  },
): PersistedExtractionResult {
  if (facts.length === 0) return EMPTY_EXTRACTION;

  const categories = [...new Set(facts.map((f) => f.category))];
  const placeholders = categories.map(() => "?").join(",");
  const existingRows = getFactDb().prepare(
    `SELECT category, content FROM facts WHERE valid_until IS NULL AND category IN (${placeholders})`,
  ).all(...categories) as Array<{ category: string; content: string }>;
  const seen = new Set(
    existingRows.map((row) => factKey(row.category, row.content)),
  );
  const freshFacts = facts.filter((fact) => {
    const key = factKey(fact.category, fact.content);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (freshFacts.length === 0) return EMPTY_EXTRACTION;

  const entries: WriteMemoryFactOptions[] = freshFacts.map((fact) => ({
    content: fact.content,
    category: fact.category,
    source: options?.source ?? "memory",
    invalidateConflicts: options?.invalidateConflicts ?? false,
    modelTier: options?.modelTier,
  }));
  const result = writeMemoryFacts(entries);

  return {
    factsExtracted: result.written,
    entitiesCreated: result.linkedEntities,
    invalidated: result.invalidated,
    factIds: result.factIds,
  };
}

function extractBaselineFactsFromText(
  text: string,
): ExtractedMemoryFact[] {
  if (shouldSkipText(text)) return [];

  const extracted: ExtractedMemoryFact[] = [];
  const seen = new Set<string>();

  for (const unit of splitIntoExtractionUnits(text)) {
    addUniqueFact(extracted, seen, extractNameFact(unit));
    const rememberFact = extractSentenceFact(
      unit,
      "Preferences",
      REMEMBER_PATTERNS,
    );
    if (rememberFact) {
      addUniqueFact(extracted, seen, rememberFact);
    } else {
      addUniqueFact(
        extracted,
        seen,
        extractSentenceFact(unit, "Preferences", PREFERENCE_PATTERNS),
      );
    }
    addUniqueFact(
      extracted,
      seen,
      extractSentenceFact(unit, "Decisions", DECISION_PATTERNS),
    );
    addUniqueFact(
      extracted,
      seen,
      extractSentenceFact(unit, "Bugs", BUG_PATTERNS),
    );
  }

  return extracted;
}

function extractBaselineFactsFromMessages(
  messages: SessionMessage[],
  options?: {
    limit?: number;
    minMessages?: number;
    role?: string;
  },
): ExtractedMemoryFact[] {
  const role = options?.role ?? "user";
  const limit = options?.limit && options.limit > 0 ? options.limit : 20;
  const minMessages = options?.minMessages ?? 1;
  const relevantMessages = messages
    .filter((message) => message.role === role)
    .map((message) => message.content)
    .filter((content) => !shouldSkipText(content));

  if (relevantMessages.length < minMessages) return [];

  const extracted: ExtractedMemoryFact[] = [];
  const seen = new Set<string>();

  for (const text of relevantMessages.slice(-limit)) {
    for (const fact of extractBaselineFactsFromText(text)) {
      addUniqueFact(extracted, seen, fact);
    }
  }

  return extracted;
}

const LLM_EXTRACTION_PROMPT = `Extract key facts from the following conversation that would be useful to remember for future sessions.

Return a JSON array of objects with "category" and "content" fields.

Categories: Identity, Preferences, Decisions, Bugs, Environment, General

Rules:
- Max 10 facts. Be concise — one sentence per fact.
- Skip trivial/obvious info, code snippets, and transient task details.
- Focus on durable information: who the user is, what they prefer, what was decided and why.

Examples of GOOD extractions:
- {"category": "Identity", "content": "User's name: Alice"}
- {"category": "Preferences", "content": "User prefers Deno over Node for all new projects"}
- {"category": "Decisions", "content": "Chose JWT over session cookies for stateless auth"}

Examples of BAD extractions (too vague or trivial):
- {"category": "General", "content": "We talked about some stuff"}
- {"category": "General", "content": "The user asked a question"}
- {"category": "Bugs", "content": "There was an error"}

Return ONLY the JSON array, no other text.`;

export function parseLLMExtractionResponse(
  text: string,
): ExtractedMemoryFact[] {
  try {
    const cleaned = text.replace(CODE_FENCE_OPEN_RE, "").replace(
      CODE_FENCE_CLOSE_RE,
      "",
    ).trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry: unknown): entry is { category: string; content: string } =>
          typeof entry === "object" && entry !== null &&
          typeof (entry as Record<string, unknown>).category === "string" &&
          typeof (entry as Record<string, unknown>).content === "string" &&
          ((entry as Record<string, unknown>).content as string).trim() !== "",
      )
      .slice(0, 10)
      .map((entry) => ({
        category: entry.category,
        content: entry.content.trim(),
      }));
  } catch {
    return [];
  }
}

async function extractFactsWithLLM(
  messages: SessionMessage[],
  model?: string,
): Promise<ExtractedMemoryFact[]> {
  try {
    const formatted = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-20)
      .map((m) => {
        const content = m.content.length > 600
          ? m.content.slice(0, 600) + "..."
          : m.content;
        return `[${m.role}]: ${content}`;
      })
      .join("\n\n");

    const prompt = `${LLM_EXTRACTION_PROMPT}\n\n--- Conversation ---\n${formatted}`;
    const opts: Record<string, unknown> = {
      stream: false,
      maxTokens: 1000,
      temperature: 0,
    };
    if (model) opts.model = model;

    const gen = ai.chat([{ role: "user", content: prompt }], opts);
    let text = "";
    for await (const chunk of gen) text += chunk;
    return parseLLMExtractionResponse(text);
  } catch {
    return [];
  }
}

export function extractConversationFacts(
  messages: SessionMessage[],
): ExtractedMemoryFact[] {
  return extractBaselineFactsFromMessages(messages, {
    limit: 20,
    minMessages: 1,
    role: "user",
  });
}

export function persistConversationFacts(
  messages: SessionMessage[],
  options?: {
    source?: string;
    invalidateConflicts?: boolean;
    modelTier?: MemoryModelTier;
  },
): PersistedExtractionResult {
  return persistExtractedFacts(extractConversationFacts(messages), {
    source: options?.source ?? "extracted",
    invalidateConflicts: options?.invalidateConflicts ?? false,
    modelTier: options?.modelTier,
  });
}

export async function extractSessionFacts(
  messages: SessionMessage[],
  modelTier: MemoryModelTier,
  model?: string,
): Promise<{ factsExtracted: number; entitiesCreated: number }> {
  if (modelTier !== "frontier") {
    return { factsExtracted: 0, entitiesCreated: 0 };
  }

  // Try LLM extraction first, fall back to regex
  const llmFacts = await extractFactsWithLLM(messages, model);
  if (llmFacts.length > 0) {
    const result = persistExtractedFacts(llmFacts, {
      source: "extracted",
      invalidateConflicts: false,
      modelTier,
    });
    return {
      factsExtracted: result.factsExtracted,
      entitiesCreated: result.entitiesCreated,
    };
  }

  // Fallback to regex-based extraction
  const fallbackOpts = {
    source: "extracted" as const,
    modelTier,
    limit: 20,
    minMessages: 2,
    role: "user",
  };
  const result = persistExtractedFacts(
    extractBaselineFactsFromMessages(messages, fallbackOpts),
    fallbackOpts,
  );

  return {
    factsExtracted: result.factsExtracted,
    entitiesCreated: result.entitiesCreated,
  };
}
