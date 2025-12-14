/**
 * Known Identifiers Registry for "Did you mean?" suggestions
 *
 * Provides a curated list of known HQL identifiers for typo suggestions.
 * The stdlib functions are loaded dynamically at module initialization,
 * with a static fallback for reliability.
 */

// Cache for all identifiers (populated on first access or async init)
let _cachedIdentifiers: string[] | null = null;
let _initPromise: Promise<void> | null = null;

/**
 * Builtin function names from the interpreter (builtins.ts).
 */
const BUILTIN_NAMES = [
  // Arithmetic
  "+", "-", "*", "/", "%", "mod",
  // Comparison
  "=", "==", "===", "!=", "!==", "<", ">", "<=", ">=",
  // Type predicates
  "nil?", "isNil", "number?", "isNumber", "string?", "isString",
  "boolean?", "isBoolean", "function?", "isFunction", "list?",
  "symbol?", "array?", "isArray",
  // S-expression operations
  "%first", "%rest", "%length", "%nth", "%empty?",
  // Meta
  "name", "gensym", "not", "str",
  // Collection constructors
  "vector", "list", "hash-map", "hash-set",
];

/**
 * Special forms and macros handled by the transpiler.
 */
const SPECIAL_FORM_NAMES = [
  // Core forms
  "if", "let", "var", "fn", "do", "quote", "quasiquote", "cond",
  // Definitions
  "def", "defn", "defmacro", "macro",
  // Control flow
  "when", "unless", "case", "and", "or",
  // Loops
  "for", "while", "loop", "recur", "doseq", "dotimes",
  // Exceptions
  "try", "catch", "finally", "throw",
  // Modules
  "import", "export",
  // Interop
  "new", "js/new", "js/typeof", "js/instanceof", "js/await",
  // Threading macros
  "->", "->>", "as->", "some->", "some->>", "cond->", "cond->>",
];

/**
 * Common stdlib functions (static fallback).
 * These are the most commonly used functions that should always be suggested.
 */
const COMMON_STDLIB_NAMES = [
  // Core collection functions
  "first", "rest", "cons", "nth", "count", "second", "last",
  "map", "filter", "reduce", "concat", "flatten", "distinct",
  "take", "drop", "some", "every", "isEmpty",
  // Higher-order
  "mapIndexed", "keep", "keepIndexed", "mapcat", "groupBy",
  // Utilities
  "range", "repeat", "cycle", "iterate",
  "comp", "partial", "apply", "identity",
  // Map operations
  "get", "getIn", "assoc", "assocIn", "dissoc",
  "update", "updateIn", "merge", "keys", "vals",
  // Collection conversion
  "toArray", "toSet", "seq", "conj", "into", "realize",
  // I/O
  "print", "println",
  // Predicates
  "isNil", "isSome", "empty",
];

/**
 * Common JS globals accessible in HQL.
 */
const JS_GLOBAL_NAMES = [
  "console", "Array", "Object", "String", "Number", "Boolean",
  "Map", "Set", "Promise", "JSON", "Math", "Date", "RegExp",
  "Error", "TypeError", "RangeError",
  "setTimeout", "clearTimeout", "fetch",
];

/**
 * Build the static identifier list (always available).
 */
function buildStaticIdentifiers(): string[] {
  const all = new Set<string>([
    ...BUILTIN_NAMES,
    ...SPECIAL_FORM_NAMES,
    ...COMMON_STDLIB_NAMES,
    ...JS_GLOBAL_NAMES,
  ]);
  return Array.from(all);
}

/**
 * Dynamically load all stdlib exports and merge with static list.
 */
async function loadStdlibExports(): Promise<string[]> {
  try {
    const stdlib = await import("../lib/stdlib/js/core.js") as Record<string, unknown>;
    return Object.keys(stdlib).filter(key => {
      if (key.startsWith("__") || key.startsWith("_")) return false;
      if (typeof stdlib[key] !== "function") return false;
      return true;
    });
  } catch {
    return [];
  }
}

/**
 * Initialize the identifier cache with full stdlib.
 * Call this at application startup for complete suggestions.
 */
export async function initializeKnownIdentifiers(): Promise<void> {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const staticIds = buildStaticIdentifiers();
    const stdlibIds = await loadStdlibExports();

    const all = new Set<string>([...staticIds, ...stdlibIds]);
    _cachedIdentifiers = Array.from(all);
  })();

  return _initPromise;
}

/**
 * Get all known identifiers.
 * Returns cached list if available, otherwise static fallback.
 */
export function getAllKnownIdentifiers(): string[] {
  if (_cachedIdentifiers) {
    return _cachedIdentifiers;
  }
  // Return static list immediately, will be enhanced after async init
  return buildStaticIdentifiers();
}

/**
 * Clear the identifier cache (for testing).
 */
export function clearIdentifierCache(): void {
  _cachedIdentifiers = null;
  _initPromise = null;
}

// Auto-initialize on module load (non-blocking)
initializeKnownIdentifiers().catch(() => {});
