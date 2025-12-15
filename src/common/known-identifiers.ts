/**
 * Known Identifiers Registry for "Did you mean?" suggestions
 *
 * Provides known HQL identifiers for typo suggestions.
 * Stdlib functions are loaded dynamically from core.js at module init,
 * with a static fallback for immediate availability.
 */

// Cache for identifiers (populated on module load)
let _cachedIdentifiers: string[] | null = null;

/**
 * Builtin function names from the interpreter (builtins.ts).
 */
const BUILTIN_NAMES = [
  "+", "-", "*", "/", "%", "mod",
  "=", "==", "===", "!=", "!==", "<", ">", "<=", ">=",
  "nil?", "isNil", "number?", "isNumber", "string?", "isString",
  "boolean?", "isBoolean", "function?", "isFunction", "list?",
  "symbol?", "array?", "isArray",
  "%first", "%rest", "%length", "%nth", "%empty?",
  "name", "gensym", "not", "str",
  "vector", "list", "hash-map", "hash-set",
];

/**
 * Special forms and macros handled by the transpiler.
 */
const SPECIAL_FORM_NAMES = [
  // Core special forms
  "if", "let", "var", "fn", "do", "quote", "quasiquote", "cond",
  "def", "defn", "defmacro", "macro",
  "when", "unless", "case", "and", "or",
  "for", "while", "loop", "recur", "doseq", "dotimes",
  "try", "catch", "finally", "throw",
  "import", "export",
  "new", "js/new", "js/typeof", "js/instanceof", "js/await",
  "->", "->>", "as->", "some->", "some->>", "cond->", "cond->>",
  // Macros from embedded-macros.ts
  "print", "inc", "dec", "str", "set", "length", "match", "doto", "xor",
  "nil?", "empty?", "contains?", "min", "max",
  "if-let", "when-let", "if-not", "when-not",
  "isNull", "isUndefined", "isDefined", "notNil", "rest?", "empty-list?",
];

/**
 * Common stdlib functions (static fallback for immediate availability).
 * These are loaded dynamically from core.js, but this provides immediate
 * availability before async init completes.
 */
const COMMON_STDLIB_NAMES = [
  "first", "rest", "cons", "nth", "count", "second", "last",
  "map", "filter", "reduce", "concat", "flatten", "distinct",
  "take", "drop", "some", "every", "isEmpty",
  "mapIndexed", "keep", "keepIndexed", "mapcat", "groupBy",
  "range", "repeat", "cycle", "iterate",
  "comp", "partial", "apply",
  "get", "getIn", "assoc", "assocIn", "dissoc",
  "update", "updateIn", "merge", "keys",
  "seq", "conj", "into", "realized",
  "isNil", "isSome", "empty",
  // Additional stdlib functions
  "reverse", "repeatedly", "doall", "lazySeq", "vec",
  "notAny", "notEvery", "next", "keyword", "symbol",
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
 * Build the static identifier list.
 */
function buildStaticIdentifiers(): string[] {
  return [...new Set([
    ...BUILTIN_NAMES,
    ...SPECIAL_FORM_NAMES,
    ...COMMON_STDLIB_NAMES,
    ...JS_GLOBAL_NAMES,
  ])];
}

/**
 * Load stdlib exports dynamically and merge with static list.
 */
async function initializeIdentifiers(): Promise<void> {
  const staticIds = buildStaticIdentifiers();

  try {
    const stdlib = await import("../lib/stdlib/js/core.js") as Record<string, unknown>;
    const stdlibIds = Object.keys(stdlib).filter(key =>
      !key.startsWith("_") && typeof stdlib[key] === "function"
    );
    _cachedIdentifiers = [...new Set([...staticIds, ...stdlibIds])];
  } catch {
    _cachedIdentifiers = staticIds;
  }
}

/**
 * Get all known identifiers for "Did you mean?" suggestions.
 * Returns cached list if available, otherwise static fallback.
 */
export function getAllKnownIdentifiers(): string[] {
  return _cachedIdentifiers ?? buildStaticIdentifiers();
}

// Auto-initialize on module load
initializeIdentifiers().catch(() => {});
