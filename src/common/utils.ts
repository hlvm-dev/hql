import {
  cwd as platformCwd,
  readTextFile as platformReadTextFile,
} from "../platform/platform.ts";

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

/** Cached regex patterns for identifier sanitization (avoid compilation per call) */
const HYPHEN_REGEX = /-/g;
const CAMEL_CASE_REGEX = /-([a-z])/g;
const VALID_START_REGEX = /^[a-zA-Z_$]/;
const INVALID_CHARS_REGEX = /[^a-zA-Z0-9_$]/g;

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
    return await platformReadTextFile(filePath);
  } catch (error) {
    throw new Error(
      `Reading file ${filePath}${context ? ` (${context})` : ""}: ${getErrorMessage(error)}`,
    );
  }
}

export async function tryReadFile(
  filePath: string,
  logger?: { debug: (msg: string) => void },
): Promise<string | null> {
  try {
    const content = await platformReadTextFile(filePath);
    logger?.debug?.(
      `Successfully read ${content.length} bytes from ${filePath}`,
    );
    return content;
  } catch (error) {
    logger?.debug?.(`Failed to read file ${filePath}: ${getErrorMessage(error)}`);
    return null;
  }
}

export async function findActualFilePath(
  filePath: string,
  logger?: { debug: (msg: string) => void; error: (msg: string) => void },
  alternativePaths: string[] = [],
): Promise<string> {
  if (await tryReadFile(filePath, logger) !== null) {
    return filePath;
  }

  logger?.debug?.(
    `File not found at ${filePath}, trying alternative locations`,
  );

  for (const alternative of alternativePaths) {
    if (await tryReadFile(alternative, logger) !== null) {
      logger?.debug?.(`Found file at alternative location: ${alternative}`);
      return alternative;
    }
  }

  const basename = filePath.split("/").pop() ?? filePath;
  const fallbackPath = `${platformCwd()}/${basename}`;

  if (await tryReadFile(fallbackPath, logger) !== null) {
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

/**
 * Create a regex pattern for matching S-expression function calls.
 * Matches patterns like: (funcName ...)
 *
 * @param funcName - Function name to match
 * @returns RegExp for matching S-expression calls
 *
 * @example
 * ```typescript
 * const pattern = createSExpCallRegex("map");
 * pattern.test("(map fn list)"); // true
 * pattern.test("map(...)");      // false
 * ```
 */
export function createSExpCallRegex(funcName: string): RegExp {
  return new RegExp(`\\(\\s*${escapeRegExp(funcName)}\\b`);
}

/**
 * Create a regex pattern for matching JavaScript function calls.
 * Matches patterns like: funcName(...)
 *
 * @param funcName - Function name to match
 * @returns RegExp for matching JS-style calls
 *
 * @example
 * ```typescript
 * const pattern = createJsCallRegex("foo");
 * pattern.test("foo()");   // true
 * pattern.test("(foo)");   // false
 * ```
 */
export function createJsCallRegex(funcName: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(funcName)}\\s*\\(`);
}

// ============================================================================
// DRY Utilities - Consolidated patterns used across the codebase
// ============================================================================

/**
 * Safely extract error message from unknown error value.
 * Consolidates the `error instanceof Error ? error.message : String(error)` pattern.
 *
 * @param error - Any error value (Error, string, unknown)
 * @returns The error message as a string
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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


