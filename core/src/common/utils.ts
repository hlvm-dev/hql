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

  // Handle hyphenated names
  let sanitized: string;

  if (name.includes("-")) {
    if (options.useCamelCase) {
      // Convert to camelCase: "foo-bar" -> "fooBar"
      sanitized = name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    } else {
      // Convert to snake_case: "foo-bar" -> "foo_bar"
      sanitized = name.replace(/-/g, "_");
    }
  } else {
    sanitized = name;
  }

  // Ensure starts with valid character
  if (!/^[a-zA-Z_$]/.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }

  // Remove any remaining invalid characters
  sanitized = sanitized.replace(/[^a-zA-Z0-9_$]/g, "");

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
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Reading file ${filePath}${context ? ` (${context})` : ""}: ${message}`,
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
    const message = error instanceof Error ? error.message : String(error);
    logger?.debug?.(`Failed to read file ${filePath}: ${message}`);
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
 * Create a word-boundary regex pattern for matching a word.
 * Escapes special regex characters and adds word boundaries.
 *
 * @param word - Word to match with word boundaries
 * @param flags - Optional regex flags (e.g., "g", "i")
 * @returns RegExp with word boundaries
 *
 * @example
 * ```typescript
 * const pattern = createWordBoundaryRegex("foo");
 * pattern.test("foo bar"); // true
 * pattern.test("foobar");  // false
 * ```
 */
export function createWordBoundaryRegex(word: string, flags?: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(word)}\\b`, flags);
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
