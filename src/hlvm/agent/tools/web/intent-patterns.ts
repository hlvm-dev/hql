/**
 * Shared regex primitives for search intent detection and ranking signal matching.
 *
 * English-only limitation: All patterns match English keywords only. Non-English queries
 * will produce no matches, resulting in all intent booleans being false (generic search
 * with no biases). The `locale` parameter in search tools affects DDG/Google News result
 * filtering, NOT intent detection. This is an accepted limitation.
 */

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildWordRegex(terms: readonly string[]): RegExp {
  return new RegExp(`\\b(?:${terms.map(escapeRegex).join("|")})\\b`, "i");
}

export const OFFICIAL_DOCS_TERMS = [
  "official",
  "doc",
  "docs",
  "documentation",
  "reference",
  "api",
] as const;
export const COMPARISON_TERMS = [
  "compare",
  "comparison",
  "versus",
  "vs",
  "tradeoff",
  "tradeoffs",
  "difference",
  "differences",
] as const;
const RECENCY_TERMS = [
  "latest",
  "recent",
  "recently",
  "today",
  "current",
  "new",
  "newest",
  "updated",
  "update",
  "change",
  "changes",
  "lately",
  "upcoming",
] as const;
export const REFERENCE_TERMS = [
  "reference",
  "api",
  "spec",
  "syntax",
  "manual",
  "guide",
] as const;

export const OFFICIAL_DOCS_RE = buildWordRegex(OFFICIAL_DOCS_TERMS);
export const COMPARISON_RE = /\b(compare|comparison|versus|vs\.?|tradeoffs?|differences?)\b/i;
export const RECENCY_RE = buildWordRegex(RECENCY_TERMS);
export const RELEASE_NOTES_RE = /\b(changelog|release notes?|what(?:'s| is) new)\b/i;
export const REFERENCE_RE = buildWordRegex(REFERENCE_TERMS);
export const VERSION_RE = /\bv?\d+(?:\.\d+){1,3}\b/;
export const YEAR_RE = /\b(?:19|20)\d{2}\b/;
