/**
 * Shared baseline fact extraction for chat and agent flows.
 */

import { getFactDb } from "./db.ts";
import { type WriteMemoryFactOptions, writeMemoryFacts } from "./pipeline.ts";
import type { MemoryModelTier } from "./invalidate.ts";

export interface SessionMessage {
  role: string;
  content: string;
}

export interface ExtractedMemoryFact {
  category: string;
  content: string;
}

export interface PersistedExtractionResult {
  factsExtracted: number;
  entitiesCreated: number;
  invalidated: number;
  factIds: number[];
}

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

function shouldSkipText(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (trimmed.length < 8) return true;
  if (/^```/.test(trimmed)) return true;
  return false;
}

function normalizeExtractedContent(content: string): string {
  return content
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/g, "")
    .trim();
}

function sentenceCase(content: string): string {
  if (!content) return content;
  return content.charAt(0).toUpperCase() + content.slice(1);
}

function splitIntoExtractionUnits(text: string): string[] {
  return (text.match(/[^.!?\n]+[.!?]?/g) ?? [])
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
  const key = `${fact.category}\u0000${content.toLowerCase()}`;
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
  if (facts.length === 0) {
    return {
      factsExtracted: 0,
      entitiesCreated: 0,
      invalidated: 0,
      factIds: [],
    };
  }

  const existingRows = getFactDb().prepare(
    "SELECT category, content FROM facts WHERE valid_until IS NULL",
  ).all() as Array<{ category: string; content: string }>;
  const seen = new Set(
    existingRows.map((row) => factKey(row.category, row.content)),
  );
  const freshFacts = facts.filter((fact) => {
    const key = factKey(fact.category, fact.content);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (freshFacts.length === 0) {
    return {
      factsExtracted: 0,
      entitiesCreated: 0,
      invalidated: 0,
      factIds: [],
    };
  }

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

export function extractBaselineFactsFromText(
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

export function extractBaselineFactsFromMessages(
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

export function extractConversationFacts(
  messages: SessionMessage[],
): ExtractedMemoryFact[] {
  return extractBaselineFactsFromMessages(messages, {
    limit: 20,
    minMessages: 1,
    role: "user",
  });
}

export function extractAndPersistBaselineFactsFromText(
  text: string,
  options?: {
    source?: string;
    invalidateConflicts?: boolean;
    modelTier?: MemoryModelTier;
  },
): PersistedExtractionResult {
  return persistExtractedFacts(extractBaselineFactsFromText(text), options);
}

export function extractAndPersistBaselineFactsFromMessages(
  messages: SessionMessage[],
  options?: {
    source?: string;
    invalidateConflicts?: boolean;
    modelTier?: MemoryModelTier;
    limit?: number;
    minMessages?: number;
    role?: string;
  },
): PersistedExtractionResult {
  return persistExtractedFacts(
    extractBaselineFactsFromMessages(messages, options),
    options,
  );
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

export function extractSessionFacts(
  messages: SessionMessage[],
  modelTier: MemoryModelTier,
): { factsExtracted: number; entitiesCreated: number } {
  if (modelTier !== "frontier") {
    return { factsExtracted: 0, entitiesCreated: 0 };
  }

  const result = extractAndPersistBaselineFactsFromMessages(messages, {
    source: "extracted",
    modelTier,
    limit: 20,
    minMessages: 2,
    role: "user",
  });

  return {
    factsExtracted: result.factsExtracted,
    entitiesCreated: result.entitiesCreated,
  };
}
