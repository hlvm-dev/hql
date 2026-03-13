/**
 * Pattern Utilities - SSOT for glob pattern matching
 *
 * Delegates glob-to-regex conversion to `@std/path/glob-to-regexp` with
 * post-processing for path-aware matching and pre-validation for error reporting.
 *
 * Features:
 * - Full glob syntax: **, *, ?, [abc], [a-z], [!abc]
 * - Path-aware matching (matches full relative path)
 * - Case-sensitive/insensitive modes
 * - LRU-cached regex compilation
 */

import { globToRegExp } from "@std/path/posix/glob-to-regexp";
import { LRUCache } from "./lru-cache.ts";

// ============================================================
// Types
// ============================================================

export interface GlobOptions {
  /** Case-sensitive matching (default: true) */
  caseSensitive?: boolean;
  /** Match against full path vs. filename only (default: true for path-aware) */
  matchPath?: boolean;
}

export class GlobPatternError extends Error {
  constructor(pattern: string, reason: string) {
    super(`Invalid glob pattern "${pattern}": ${reason}`);
    this.name = "GlobPatternError";
  }
}

// ============================================================
// Cache
// ============================================================

const REGEX_CACHE = new LRUCache<string, RegExp>(1000);

function getCacheKey(pattern: string, options: GlobOptions): string {
  const caseSensitive = options.caseSensitive ?? true;
  const matchPath = options.matchPath ?? true;
  return `${pattern}\u0000${caseSensitive}\u0000${matchPath}`;
}

// ============================================================
// Glob Conversion
// ============================================================

/** Validate glob pattern before delegating to @std/path */
function validateGlobPattern(pattern: string): void {
  if (!pattern) {
    throw new GlobPatternError(pattern, "Empty pattern");
  }
  // Check for unmatched brackets (count unescaped [ vs ])
  let depth = 0;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "\\" && i + 1 < pattern.length) { i++; continue; }
    if (pattern[i] === "[") depth++;
    else if (pattern[i] === "]") depth--;
  }
  if (depth !== 0) {
    throw new GlobPatternError(pattern, "Unmatched bracket");
  }
}

/**
 * Convert glob pattern to regular expression.
 *
 * Uses `@std/path/glob-to-regexp` with post-processing:
 * - `?` -> `[^/]` in matchPath mode (std lib's `?` matches `/`)
 * - `[^/]*` -> `[\s\S]*` in non-path mode (so `*` matches `/`)
 * - Strips trailing `\/*$` anchor from std lib output
 */
export function globToRegex(pattern: string, options: GlobOptions = {}): RegExp {
  const cacheKey = getCacheKey(pattern, options);
  const cached = REGEX_CACHE.get(cacheKey);
  if (cached) return cached;

  const caseSensitive = options.caseSensitive ?? true;
  const matchPath = options.matchPath ?? true;

  validateGlobPattern(pattern);

  // Delegate to @std/path (posix import = POSIX path semantics)
  const raw = globToRegExp(pattern, {
    caseInsensitive: !caseSensitive,
    globstar: true,
  });

  // Post-process the regex source string
  let source = raw.source;

  // Strip trailing \/*$ that @std/path appends (we anchor ourselves)
  source = source.replace(/\\\/\*\$$/, "$");

  if (matchPath) {
    // @std/path's `?` generates `.` which matches `/` — replace with [^/]
    // The std lib uses `[^/]*` for `*` and `(?:[^/]*(?:\/|$))*` for `**`,
    // so standalone `.` only comes from `?`.
    source = source.replace(
      /(?<![\\[])\.(?![*\]])/g,
      "[^/]",
    );
  } else {
    // In non-path mode: `*` should match everything including `/`
    // Replace `[^/]*` (from `*`) with `[\s\S]*` to match across path separators
    // But preserve globstar patterns (`(?:[^/]*(?:\/|$))*`) which already match `/`
    source = source.replace(/\[\^\/\]\*/g, "[\\s\\S]*");
    // `?` (`.`) should also match `/` — it already does (`.` matches any char)
  }

  const flags = raw.flags;
  try {
    const compiled = new RegExp(source, flags);
    REGEX_CACHE.set(cacheKey, compiled);
    return compiled;
  } catch {
    throw new GlobPatternError(pattern, "Failed to compile regex");
  }
}

// ============================================================
// Pattern Matching
// ============================================================

export function matchGlob(input: string, pattern: string, options?: GlobOptions): boolean {
  return globToRegex(pattern, options).test(input);
}

