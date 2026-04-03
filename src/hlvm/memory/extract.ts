/**
 * Deterministic memory extraction and persistence for completed turns.
 *
 * Canonical non-LLM path for:
 * - explicit "remember that ..." requests
 * - high-confidence preferences/decisions from normal conversation
 * - conservative bug-fix capture from grounded assistant outcomes
 */

import { writeMemoryFacts } from "./pipeline.ts";
import { normalizeWhitespace } from "./store.ts";

export interface ExtractedMemoryFact {
  content: string;
  category: string;
  source: string;
}

export interface PersistMemoryResult {
  written: number;
  linkedEntities: number;
  invalidated: number;
  factIds: number[];
  facts: ExtractedMemoryFact[];
}

const CODE_FENCE_RE = /```[\s\S]*?```/g;
const QUOTE_WRAPPER_RE = /^["'`“”‘’\s]+|["'`“”‘’\s]+$/g;
const TRAILING_PUNCTUATION_RE = /[.?!\s]+$/g;
const MAX_FACT_LENGTH = 240;
const MIN_FACT_LENGTH = 8;

interface ExtractPattern {
  pattern: RegExp;
  category: string;
  source: string;
  build: (match: RegExpExecArray) => string;
}

const USER_IMPLICIT_PATTERNS: ExtractPattern[] = [
  {
    pattern: /\bmy name is\s+([^.!?\n]+)/gi,
    category: "Profile",
    source: "conversation_implicit",
    build: (match) => `User's name is ${cleanValue(match[1] ?? "")}`,
  },
  {
    pattern: /\bmy timezone is\s+([^.!?\n]+)/gi,
    category: "Profile",
    source: "conversation_implicit",
    build: (match) => `User timezone is ${cleanValue(match[1] ?? "")}`,
  },
  {
    pattern: /\bi(?:'m| am) on\s+([^.!?\n]+)/gi,
    category: "Environment",
    source: "conversation_implicit",
    build: (match) => `User is on ${cleanValue(match[1] ?? "")}`,
  },
  {
    pattern: /\bi prefer\s+([^.!?\n]+)/gi,
    category: "Preferences",
    source: "conversation_implicit",
    build: (match) => `User prefers ${cleanValue(match[1] ?? "")}`,
  },
  {
    pattern: /\bi (?:always use|usually use|use)\s+([^.!?\n]+)/gi,
    category: "Preferences",
    source: "conversation_implicit",
    build: (match) => `User uses ${cleanValue(match[1] ?? "")}`,
  },
  {
    pattern: /\bwe decided to\s+([^.!?\n]+)/gi,
    category: "Decisions",
    source: "conversation_implicit",
    build: (match) => `Decision: ${cleanValue(match[1] ?? "")}`,
  },
  {
    pattern: /\b(?:let'?s )?use\s+([^.!?\n]+?)\s+instead of\s+([^.!?\n]+)/gi,
    category: "Decisions",
    source: "conversation_implicit",
    build: (match) =>
      `Decision: use ${cleanValue(match[1] ?? "")} instead of ${
        cleanValue(match[2] ?? "")
      }`,
  },
  {
    pattern: /\bfor production(?:,)? use\s+([^.!?\n]+)/gi,
    category: "Decisions",
    source: "conversation_implicit",
    build: (match) =>
      `Decision: use ${cleanValue(match[1] ?? "")} for production`,
  },
  {
    pattern: /\bdeploy(?:ment)? window(?: is)?\s*[:=-]?\s*([^.!?\n]+)/gi,
    category: "Workflow",
    source: "conversation_implicit",
    build: (match) => `Deployment window: ${cleanValue(match[1] ?? "")}`,
  },
];

const ASSISTANT_OUTCOME_PATTERNS: ExtractPattern[] = [
  {
    pattern: /(?:^|\n)(?:[-*]\s+)?(fixed|resolved)\s+([^.!?\n]+)/gi,
    category: "Bugs",
    source: "conversation_outcome",
    build: (match) =>
      `Bug fix: ${
        cleanSentence(
          `${(match[1] ?? "").toLowerCase()} ${match[2] ?? ""}`,
        )
      }`,
  },
  {
    pattern:
      /(?:^|\n)(?:[-*]\s+)?(?:switched to|migrated to|updated to use)\s+([^.!?\n]+)/gi,
    category: "Decisions",
    source: "conversation_outcome",
    build: (match) => `Decision: ${cleanSentence(`use ${match[1] ?? ""}`)}`,
  },
];

function normalizeContent(value: string): string {
  return normalizeWhitespace(value.replace(CODE_FENCE_RE, " "));
}

function cleanValue(value: string): string {
  return normalizeContent(value)
    .replace(QUOTE_WRAPPER_RE, "")
    .replace(TRAILING_PUNCTUATION_RE, "")
    .trim();
}

function cleanSentence(value: string): string {
  return cleanValue(value)
    .replace(/\s+,/g, ",")
    .replace(/\s+:/g, ":");
}

function normalizeFactKey(fact: ExtractedMemoryFact): string {
  return `${fact.category}\u0000${fact.content.toLowerCase()}`;
}

function isLikelyDurableFact(content: string): boolean {
  const normalized = normalizeContent(content);
  if (
    normalized.length < MIN_FACT_LENGTH || normalized.length > MAX_FACT_LENGTH
  ) {
    return false;
  }
  if (normalized.includes("```")) return false;
  if (
    normalized.includes("{") || normalized.includes("}") ||
    normalized.includes("=>") || normalized.includes("function ")
  ) {
    return false;
  }
  return true;
}

function classifyExplicitCategory(content: string): string {
  const lower = content.toLowerCase();
  if (
    lower.includes("prefer") || lower.includes("use ") ||
    lower.includes("tabs") || lower.includes("spaces")
  ) {
    return "Preferences";
  }
  if (
    lower.includes("decision") || lower.includes("instead of") ||
    lower.includes("for production") || lower.includes("deploy")
  ) {
    return "Decisions";
  }
  if (lower.includes("timezone") || lower.includes("name")) {
    return "Profile";
  }
  return "General";
}

function collectPatternFacts(
  text: string,
  patterns: readonly ExtractPattern[],
): ExtractedMemoryFact[] {
  const facts: ExtractedMemoryFact[] = [];
  for (const spec of patterns) {
    const regex = new RegExp(spec.pattern.source, spec.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const content = cleanSentence(spec.build(match));
      if (!isLikelyDurableFact(content)) continue;
      facts.push({
        content,
        category: spec.category,
        source: spec.source,
      });
    }
  }
  return facts;
}

export function extractExplicitMemoryRequests(
  userMessage: string,
): ExtractedMemoryFact[] {
  const trimmed = userMessage.trim();
  const matches = [
    /^\s*(?:please\s+)?remember(?:\s+that)?\s+(.+?)\s*$/i,
    /^\s*(?:please\s+)?don'?t forget(?:\s+that)?\s+(.+?)\s*$/i,
  ];

  for (const pattern of matches) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    const content = cleanSentence(match[1] ?? "");
    if (!isLikelyDurableFact(content)) return [];
    const normalized = collectPatternFacts(content, USER_IMPLICIT_PATTERNS)
      .map((fact) => ({ ...fact, source: "conversation_explicit" }));
    if (normalized.length > 0) {
      return normalized;
    }
    return [{
      content,
      category: classifyExplicitCategory(content),
      source: "conversation_explicit",
    }];
  }

  return [];
}

export function extractConversationFacts(options: {
  userMessage: string;
  assistantMessage?: string;
}): ExtractedMemoryFact[] {
  const facts: ExtractedMemoryFact[] = [];
  const seen = new Set<string>();

  const addUnique = (source: Iterable<ExtractedMemoryFact>) => {
    for (const fact of source) {
      const key = normalizeFactKey(fact);
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push(fact);
    }
  };

  addUnique(extractExplicitMemoryRequests(options.userMessage));
  addUnique(collectPatternFacts(options.userMessage, USER_IMPLICIT_PATTERNS));
  if (options.assistantMessage) {
    addUnique(
      collectPatternFacts(options.assistantMessage, ASSISTANT_OUTCOME_PATTERNS),
    );
  }

  return facts;
}

function persistFacts(facts: ExtractedMemoryFact[]): PersistMemoryResult {
  if (facts.length === 0) {
    return { written: 0, linkedEntities: 0, invalidated: 0, factIds: [], facts: [] };
  }
  const result = writeMemoryFacts(
    facts.map((fact) => ({
      content: fact.content,
      category: fact.category,
      source: fact.source,
      invalidateConflicts: false,
    })),
  );
  return { ...result, facts };
}

export function persistConversationFacts(options: {
  userMessage: string;
  assistantMessage?: string;
}): PersistMemoryResult {
  return persistFacts(extractConversationFacts(options));
}

export function persistExplicitMemoryRequest(
  userMessage: string,
): PersistMemoryResult {
  return persistFacts(extractExplicitMemoryRequests(userMessage));
}
