import { getPlatform } from "../platform/platform.ts";

const RESERVED_IDENTIFIER_KEYWORDS = new Set([
  "default",
  "class",
  "function",
  "var",
  "let",
  "const",
  "if",
  "else",
  "for",
  "while",
  "do",
  "return",
  "break",
  "continue",
  "switch",
  "case",
  "try",
  "catch",
  "finally",
  "throw",
  "extends",
  "import",
  "export",
  "from",
  "as",
  "async",
  "await",
  "yield",
  "static",
  "with",
  "debugger",
  "enum",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
]);

const STATIC_HQL_IMPORT_PATTERN =
  /^\s*import[\s{][^;]*from\s+['"]([^'"]+\.hql)['"]/m;
const DYNAMIC_HQL_IMPORT_PATTERN =
  /import\(\s*['"]([^'"]+\.hql)['"]\s*\)/;

/**
 * Pre-compiled regex for splitting text into lines.
 * Handles all newline formats: \n (Unix), \r\n (Windows), \r (old Mac)
 */
export const LINE_SPLIT_REGEX = /\r?\n|\r/;

/**
 * Count the number of lines in text.
 */
export function countLines(text: string): number {
  return text.split(LINE_SPLIT_REGEX).length;
}

/** Cached regex patterns for identifier sanitization (avoid compilation per call) */
const HYPHEN_REGEX = /-/g;
const CAMEL_CASE_REGEX = /-([a-z])/g;
const VALID_START_REGEX = /^[a-zA-Z_$]/;
const INVALID_CHARS_REGEX = /[^a-zA-Z0-9_$]/g;
const QUESTION_MARK_REGEX = /\?/g;

export function sanitizeIdentifier(
  name: string,
  options: { useCamelCase?: boolean } = {},
): string {
  if (name.includes(".")) {
    return name.split(".").map((part) => sanitizeBasicIdentifier(part, options))
      .join(".");
  }

  return sanitizeBasicIdentifier(name, options);
}

function sanitizeBasicIdentifier(
  name: string,
  options: { useCamelCase?: boolean } = {},
): string {
  // JavaScript reserved keywords that cannot be used as identifiers
  // NOTE: Only sanitize keywords that would be used as variable names
  // DO NOT sanitize: this, super, null, true, false, typeof, instanceof, delete, new, void, in, of
  // These are language constructs that should remain as-is when used correctly
  // Check for reserved keywords first (before any transformation)
  if (RESERVED_IDENTIFIER_KEYWORDS.has(name)) {
    return `_${name}`; // Prefix with underscore: "default" → "_default"
  }

  // Handle hyphenated names - uses cached regex patterns for efficiency
  let sanitized: string;

  if (name.includes("-")) {
    if (options.useCamelCase) {
      // Convert to camelCase: "foo-bar" -> "fooBar"
      sanitized = name.replace(CAMEL_CASE_REGEX, (_, char) => char.toUpperCase());
    } else {
      // Convert to snake_case: "foo-bar" -> "foo_bar"
      sanitized = name.replace(HYPHEN_REGEX, "_");
    }
  } else {
    sanitized = name;
  }

  // Ensure starts with valid character - uses cached regex
  if (!VALID_START_REGEX.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }

  // Convert Lisp-style predicate suffix (?) to _QMARK_ for JS compatibility
  // e.g., nil? -> nil_QMARK_, empty? -> empty_QMARK_
  sanitized = sanitized.replace(QUESTION_MARK_REGEX, "_QMARK_");

  // Remove any remaining invalid characters - uses cached regex
  sanitized = sanitized.replace(INVALID_CHARS_REGEX, "");

  return sanitized;
}

export function checkForHqlImports(source: string): boolean {
  return STATIC_HQL_IMPORT_PATTERN.test(source) ||
    DYNAMIC_HQL_IMPORT_PATTERN.test(source);
}

export async function readFile(
  filePath: string,
  context?: string,
): Promise<string> {
  try {
    return await getPlatform().fs.readTextFile(filePath);
  } catch (error) {
    throw new Error(
      `Reading file ${filePath}${context ? ` (${context})` : ""}: ${getErrorMessage(error)}`,
    );
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await getPlatform().fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function findActualFilePath(
  filePath: string,
  logger?: { debug: (msg: string) => void; error: (msg: string) => void },
  alternativePaths: string[] = [],
): Promise<string> {
  if (await fileExists(filePath)) {
    return filePath;
  }

  logger?.debug?.(
    `File not found at ${filePath}, trying alternative locations`,
  );

  for (const alternative of alternativePaths) {
    if (await fileExists(alternative)) {
      logger?.debug?.(`Found file at alternative location: ${alternative}`);
      return alternative;
    }
  }

  const basename = filePath.split("/").pop() ?? filePath;
  const fallbackPath = `${getPlatform().process.cwd()}/${basename}`;

  if (await fileExists(fallbackPath)) {
    logger?.debug?.(`Found file at fallback location: ${fallbackPath}`);
    return fallbackPath;
  }

  const triedPaths = [filePath, ...alternativePaths, fallbackPath].join(", ");
  const message = `File not found: ${filePath}, also tried: ${triedPaths}`;
  logger?.error?.(message);
  throw new Error(message);
}

/**
 * Escape special regex characters in a string
 * DRY utility - consolidates duplicate implementations from error handlers
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Note: createSExpCallRegex and createJsCallRegex were moved to runtime-error-handler.ts
// as internal functions since they were only used there (single consumer pattern)

// ============================================================================
// DRY Utilities - Consolidated patterns used across the codebase
// ============================================================================

/**
 * Truncate a string to a maximum length, appending a suffix if truncated.
 * Consolidates the ad-hoc `x.length > N ? x.slice(0, N) + "..." : x` pattern.
 *
 * @param text - String to truncate
 * @param maxLen - Maximum length (including suffix)
 * @param suffix - Suffix to append when truncated (default: "...")
 * @returns Truncated string
 */
export function truncate(text: string, maxLen: number, suffix = "..."): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, Math.max(0, maxLen - suffix.length)) + suffix;
}

/**
 * Truncate a string keeping both head and tail, eliding the middle.
 * Useful for tool results where error messages and summaries appear at the end.
 *
 * Strategy: keep first ~40% and last ~40% of maxLen, separated by a notice.
 * Falls back to simple prefix truncation for very short maxLen values.
 *
 * @param text - String to truncate
 * @param maxLen - Maximum total length of result
 * @param headRatio - Fraction of maxLen for head (default: 0.4)
 * @returns Head + separator + tail if truncated, original string otherwise
 */
/**
 * Truncate text and report whether truncation occurred.
 * SSOT for truncate-with-flag pattern (used by web tools, etc.).
 */
export function truncateText(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (maxChars <= 0 || text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

export function truncateMiddle(text: string, maxLen: number, headRatio = 0.4): string {
  if (text.length <= maxLen) return text;

  const separator = "\n\n... [truncated middle] ...\n\n";
  const available = maxLen - separator.length;

  // Fall back to simple prefix truncation if maxLen is too small for head+tail
  if (available < 40) return truncate(text, maxLen);

  const headLen = Math.floor(available * headRatio);
  const tailLen = available - headLen;

  return text.slice(0, headLen) + separator + text.slice(text.length - tailLen);
}

/**
 * Safely extract error message from unknown error value.
 * Consolidates the `error instanceof Error ? error.message : String(error)` pattern.
 * Also handles plain objects via JSON.stringify.
 *
 * @param error - Any error value (Error, string, unknown)
 * @returns The error message as a string
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) return JSON.stringify(error);
  return String(error);
}

/**
 * Check if an error is a "file not found" error.
 * Consolidates the scattered `String(error).includes("No such file")` patterns.
 */
export function isFileNotFoundError(error: unknown): boolean {
  const msg = String(error).toLowerCase();
  return msg.includes("no such file") || msg.includes("not found");
}

/**
 * Ensure a value is an Error object.
 * If already an Error, returns it unchanged. Otherwise wraps in new Error.
 * Consolidates the `error instanceof Error ? error : new Error(String(error))` pattern.
 *
 * @param error - Any error value (Error, string, unknown)
 * @returns An Error object
 */
export function ensureError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Normalize path by converting backslashes to forward slashes.
 * Used for cross-platform path consistency.
 *
 * @param path - Path that may contain backslashes
 * @returns Path with forward slashes only
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Convert hyphenated name to underscore format.
 * Used for JavaScript identifier sanitization.
 * Uses cached HYPHEN_REGEX from module top for O(1) pattern access.
 *
 * @param name - Hyphenated name like "foo-bar"
 * @returns Underscored name like "foo_bar"
 */
export function hyphenToUnderscore(name: string): string {
  return name.replace(HYPHEN_REGEX, "_");
}

/**
 * Check if a value is a non-null object (not an array).
 * Type guard that narrows the type to Record<string, unknown>.
 *
 * @param val - Value to check
 * @returns True if val is a non-null object
 */
export function isObjectValue(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null;
}

/**
 * Safely parse a JSON string. Returns the parsed value on success,
 * or the fallback on failure (defaults to the original string).
 */
export function tryParseJson(value: string, fallback?: unknown): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return fallback !== undefined ? fallback : value;
  }
}

/**
 * Check if a value is null or undefined.
 * Uses loose equality (==) for efficiency.
 *
 * @param val - Value to check
 * @returns True if val is null or undefined
 */
export function isNullish(val: unknown): val is null | undefined {
  return val == null;
}

/**
 * Add a name to a Set along with its sanitized version (hyphen → underscore).
 * Used for macro/function registration to support both naming conventions.
 *
 * @param set - Set to add to
 * @param name - Name to add (may contain hyphens)
 */
export function addWithSanitized(set: Set<string>, name: string): void {
  set.add(name);
  const sanitized = hyphenToUnderscore(name);
  if (sanitized !== name) {
    set.add(sanitized);
  }
}

/**
 * Set a value in a Map using both original name and sanitized version.
 * Used for macro/function registration to support both naming conventions.
 *
 * @param map - Map to add to
 * @param name - Name key (may contain hyphens)
 * @param value - Value to associate with both keys
 */
export function setWithSanitized<T>(map: Map<string, T>, name: string, value: T): void {
  map.set(name, value);
  const sanitized = hyphenToUnderscore(name);
  if (sanitized !== name) {
    map.set(sanitized, value);
  }
}

/**
 * Map over array elements starting from index 1 (skipping first element).
 * Efficient alternative to `arr.slice(1).map(fn)` - avoids intermediate array.
 *
 * @param arr - Source array
 * @param fn - Transform function
 * @returns New array with transformed elements from index 1 onwards
 */
export function mapTail<T, R>(arr: readonly T[], fn: (item: T) => R): R[] {
  const len = arr.length - 1;
  if (len <= 0) return [];
  const result: R[] = new Array(len);
  for (let i = 0; i < len; i++) {
    result[i] = fn(arr[i + 1]);
  }
  return result;
}

/**
 * Shared TextEncoder instance — stateless, safe to reuse across the codebase.
 * SSOT: All TextEncoder usage in the agent module uses this.
 */
export const TEXT_ENCODER = new TextEncoder();

/**
 * Generate a UUID using crypto.randomUUID() with Date.now() fallback.
 * SSOT: all non-tool-call UUID generation in the codebase goes through this function.
 */
export function generateUUID(): string {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : String(Date.now());
}

/**
 * FNV-1a hash of a string, returned as hex.
 * SSOT: all string hashing in the codebase goes through this function.
 */
export function hashString(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
