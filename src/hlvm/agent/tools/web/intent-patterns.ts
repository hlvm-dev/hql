/**
 * Shared regex primitives for search intent detection and ranking signal matching.
 *
 * English-only limitation: All patterns match English keywords only. Non-English queries
 * will produce no matches, resulting in all intent booleans being false (generic search
 * with no biases). The `locale` parameter in search tools affects DDG/Google News result
 * filtering, NOT intent detection. This is an accepted limitation.
 */

export const OFFICIAL_DOCS_RE = /\b(official|docs?|documentation|reference|api)\b/i;
export const COMPARISON_RE = /\b(compare|comparison|versus|vs\.?|tradeoffs?|differences?)\b/i;
export const RECENCY_RE = /\b(latest|recent|today|current|new|updated?|changes?)\b/i;
export const RELEASE_NOTES_RE = /\b(changelog|release notes?|what(?:'s| is) new)\b/i;
export const REFERENCE_RE = /\b(reference|api|spec|syntax|manual|guide)\b/i;
export const VERSION_RE = /\bv?\d+(?:\.\d+){1,3}\b/;
export const YEAR_RE = /\b(?:19|20)\d{2}\b/;
export const QUOTED_PHRASE_RE = /"[^"]+"/g;
