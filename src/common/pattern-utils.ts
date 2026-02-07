/**
 * Pattern Utilities - SSOT for glob pattern matching
 *
 * Provides full glob pattern support with path-aware matching.
 * Fixes naive filename-only matching that misses nested files.
 *
 * Consolidates:
 * - file-tools.ts:318-327 (naive glob)
 * - 2 other glob implementations in codebase
 *
 * Features:
 * - Full glob syntax: **, *, ?, [abc], [a-z]
 * - Path-aware matching (matches full relative path)
 * - Case-sensitive/insensitive modes
 * - Efficient regex conversion
 */

import { LRUCache } from "./lru-cache.ts";
import { getErrorMessage } from "./utils.ts";

// ============================================================
// Types
// ============================================================

/**
 * Pattern type - string glob or compiled regex
 */
export type Pattern = string | RegExp;

/**
 * Options for glob matching
 */
export interface GlobOptions {
  /** Case-sensitive matching (default: true) */
  caseSensitive?: boolean;
  /** Match against full path vs. filename only (default: true for path-aware) */
  matchPath?: boolean;
}

/**
 * Error thrown when glob pattern is invalid
 */
export class GlobPatternError extends Error {
  constructor(pattern: string, reason: string) {
    super(`Invalid glob pattern "${pattern}": ${reason}`);
    this.name = "GlobPatternError";
  }
}

// ============================================================
// Cache (performance, no behavior change)
// ============================================================

// LRU cache ensures popular patterns stay cached (vs. bare Map that clear()s all at capacity)
const REGEX_CACHE = new LRUCache<string, RegExp>(1000);

function getCacheKey(pattern: string, options: GlobOptions): string {
  const caseSensitive = options.caseSensitive ?? true;
  const matchPath = options.matchPath ?? true;
  return `${pattern}\u0000${caseSensitive}\u0000${matchPath}`;
}

// ============================================================
// Glob Conversion
// ============================================================

/**
 * Convert glob pattern to regular expression
 *
 * Glob syntax:
 * - `*` : Matches any characters except / (or all chars if !matchPath)
 * - `**`: Matches any characters including / (matches any path depth)
 * - `?` : Matches exactly one character except / (or any char if !matchPath)
 * - `[abc]`: Matches one character from set (a, b, or c)
 * - `[a-z]`: Matches one character from range (a through z)
 * - `[!abc]`: Matches one character NOT in set (NOT a, b, or c)
 *
 * Examples:
 * - `*.ts` matches `foo.ts` but not `dir/foo.ts`
 * - `**\/*.ts` matches `foo.ts` and `dir/foo.ts` and `dir/sub/foo.ts`
 * - `src/**\/*.test.ts` matches `src/utils/helpers.test.ts`
 * - `[a-z]*.ts` matches `abc.ts` but not `Abc.ts` (case-sensitive)
 *
 * @param pattern Glob pattern string
 * @param options Matching options
 * @returns Compiled regular expression
 * @throws GlobPatternError if pattern is invalid
 *
 * @example
 * ```ts
 * // Match TypeScript files
 * const regex = globToRegex("*.ts");
 * regex.test("foo.ts")  // => true
 * regex.test("foo.js")  // => false
 *
 * // Match nested test files
 * const testRegex = globToRegex("**\/*.test.ts", { matchPath: true });
 * testRegex.test("src/utils/foo.test.ts")  // => true
 * testRegex.test("foo.test.ts")            // => true
 * testRegex.test("foo.ts")                 // => false
 * ```
 */
export function globToRegex(pattern: string, options: GlobOptions = {}): RegExp {
  const cacheKey = getCacheKey(pattern, options);
  const cached = REGEX_CACHE.get(cacheKey);
  if (cached) return cached;

  const caseSensitive = options.caseSensitive ?? true;
  const matchPath = options.matchPath ?? true;

  // Validate pattern
  if (!pattern) {
    throw new GlobPatternError(pattern, "Empty pattern");
  }

  // Escape regex special chars, but preserve glob special chars
  // We'll process glob chars in order of precedence to avoid conflicts
  let regex = pattern;

  // 1. Handle character classes [abc] and [a-z] and [!abc] FIRST
  //    Convert negation [!...] to [^...] but use placeholder to protect ^ from escaping
  regex = regex.replace(/\[!/g, "[<<<NEGATION>>>");

  // 2. Escape regex special chars (except those used in glob: *, ?, [, ])
  //    NOTE: We don't escape [ and ] because they're used for character classes
  regex = regex.replace(/[.+^${}()|\\]/g, "\\$&");

  // 3. Restore negation placeholder to ^
  regex = regex.replace(/<<<NEGATION>>>/g, "^");

  // 4. Handle ** (globstar - matches any path depth)
  //    Must be handled BEFORE single * to avoid conflicts
  //    Replace ** with placeholder to protect from single * replacement
  regex = regex.replace(/\*\*/g, "<<<GLOBSTAR>>>");

  // 5. Handle * (matches anything except / in path mode)
  if (matchPath) {
    // In path mode: * matches anything except /
    regex = regex.replace(/\*/g, "[^/]*");
  } else {
    // In non-path mode: * matches anything
    regex = regex.replace(/\*/g, ".*");
  }

  // 6. Handle ? (matches single char except / in path mode)
  if (matchPath) {
    // In path mode: ? matches one char except /
    regex = regex.replace(/\?/g, "[^/]");
  } else {
    // In non-path mode: ? matches any single char
    regex = regex.replace(/\?/g, ".");
  }

  // 7. Restore ** (globstar - matches everything including /)
  //    Special handling: **/ at start should be optional to match zero path components
  //    e.g., **/*.txt should match both file.txt and dir/file.txt
  regex = regex.replace(/<<<GLOBSTAR>>>\//g, "(?:.*\\/)?");
  regex = regex.replace(/<<<GLOBSTAR>>>/g, ".*");

  // Anchor pattern (match entire string)
  regex = `^${regex}$`;

  // Compile regex
  const flags = caseSensitive ? "" : "i";
  try {
    const compiled = new RegExp(regex, flags);
    REGEX_CACHE.set(cacheKey, compiled);
    return compiled;
  } catch (error) {
    throw new GlobPatternError(
      pattern,
      `Failed to compile regex: ${getErrorMessage(error)}`
    );
  }
}

// ============================================================
// Pattern Matching
// ============================================================

/**
 * Test if string matches glob pattern
 *
 * Convenience wrapper around globToRegex() for one-off matches.
 * For repeated matching with same pattern, use globToRegex() once
 * and reuse the compiled regex.
 *
 * @param input String to test
 * @param pattern Glob pattern
 * @param options Matching options
 * @returns True if input matches pattern
 *
 * @example
 * ```ts
 * // Simple filename matching
 * matchGlob("foo.ts", "*.ts")  // => true
 * matchGlob("foo.js", "*.ts")  // => false
 *
 * // Path matching
 * matchGlob("src/utils/foo.ts", "src/**\/*.ts", { matchPath: true })  // => true
 * matchGlob("src/utils/foo.js", "src/**\/*.ts", { matchPath: true })  // => false
 *
 * // Case-insensitive
 * matchGlob("Foo.TS", "*.ts", { caseSensitive: false })  // => true
 * matchGlob("Foo.TS", "*.ts", { caseSensitive: true })   // => false
 * ```
 */
export function matchGlob(input: string, pattern: string, options?: GlobOptions): boolean {
  const regex = globToRegex(pattern, options);
  return regex.test(input);
}

/**
 * Test if string matches any of the given patterns
 *
 * Useful for allow-lists where any match is sufficient.
 *
 * @param input String to test
 * @param patterns Array of glob patterns or compiled regexes
 * @param options Matching options (used only for string patterns)
 * @returns True if input matches any pattern
 *
 * @example
 * ```ts
 * const patterns = ["*.ts", "*.tsx"];
 * matchAny("foo.ts", patterns)   // => true
 * matchAny("foo.tsx", patterns)  // => true
 * matchAny("foo.js", patterns)   // => false
 * ```
 */
export function matchAny(input: string, patterns: Pattern[], options?: GlobOptions): boolean {
  for (const pattern of patterns) {
    const regex = typeof pattern === "string"
      ? globToRegex(pattern, options)
      : pattern;
    if (regex.test(input)) {
      return true;
    }
  }
  return false;
}

/**
 * Filter array of strings by glob pattern
 *
 * @param inputs Strings to filter
 * @param pattern Glob pattern
 * @param options Matching options
 * @returns Filtered array of matching strings
 *
 * @example
 * ```ts
 * const files = ["foo.ts", "bar.js", "baz.ts"];
 * filterByGlob(files, "*.ts")  // => ["foo.ts", "baz.ts"]
 * ```
 */
export function filterByGlob(inputs: string[], pattern: string, options?: GlobOptions): string[] {
  const regex = globToRegex(pattern, options);
  return inputs.filter(input => regex.test(input));
}
