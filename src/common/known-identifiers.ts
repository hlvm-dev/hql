/**
 * Known Identifiers Registry for "Did you mean?" suggestions
 *
 * This module maintains lists of known HQL identifiers that can be used
 * to provide helpful suggestions when a user mistypes a name.
 */

/**
 * Standard library functions from src/lib/stdlib/js/core.js
 * These are available at runtime via imports
 */
export const STDLIB_FUNCTIONS: readonly string[] = [
  // Collection functions (Iterable handling)
  "first",
  "rest",
  "cons",
  "nth",
  "count",
  "second",
  "last",
  "isEmpty",
  "some",
  "every",
  "notAny",
  "notEvery",
  "take",
  "drop",
  "map",
  "filter",
  "reduce",
  "concat",
  "flatten",
  "distinct",
  "mapIndexed",
  "keep",
  "keepIndexed",
  "mapcat",
  "range",
  "groupBy",
  "realize",
  "toArray",
  "toSet",
  "seq",
  "conj",
  "into",
  "pour",
  "cycle",

  // Map/Object functions
  "get",
  "getIn",
  "assoc",
  "assocIn",
  "dissoc",
  "update",
  "updateIn",
  "merge",
  "keys",
  "vals",
  "zip",
  "zipWith",

  // Function utilities
  "comp",
  "partial",
  "apply",
  "iterate",

  // I/O functions
  "print",
  "println",
  "readFile",
  "writeFile",
  "appendFile",
  "fileExists",
  "deleteFile",

  // String functions
  "str",
  "subs",
  "split",
  "join",
  "trim",
  "upper",
  "lower",
  "replace",
  "includes",
  "startsWith",
  "endsWith",
  "padStart",
  "padEnd",
  "repeat",
  "reverse",
  "charAt",
  "indexOf",
  "lastIndexOf",

  // Math functions
  "abs",
  "ceil",
  "floor",
  "round",
  "sqrt",
  "pow",
  "min",
  "max",
  "random",
  "randomInt",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "log",
  "log10",
  "exp",
  "sign",
  "trunc",

  // Type conversion
  "parseInt",
  "parseFloat",
  "toString",
  "toNumber",
  "toBoolean",

  // Utility functions
  "identity",
  "constantly",
  "juxt",
  "complement",
] as const;

/**
 * Built-in functions available in HQL (from builtins.ts)
 * These are primitive operations available at compile/interpret time
 */
export const BUILTIN_FUNCTIONS: readonly string[] = [
  // Arithmetic operators
  "+",
  "-",
  "*",
  "/",
  "%",
  "mod",

  // Comparison operators
  "=",
  "==",
  "===",
  "!=",
  "!==",
  "<",
  ">",
  "<=",
  ">=",

  // Type predicates
  "nil?",
  "isNil",
  "number?",
  "isNumber",
  "string?",
  "isString",
  "boolean?",
  "isBoolean",
  "function?",
  "isFunction",
  "list?",
  "symbol?",
  "array?",
  "isArray",

  // Logic
  "not",
  "and",
  "or",

  // Meta operations
  "name",
  "gensym",

  // Type coercion
  "str",

  // Collection constructors
  "vector",
  "list",
  "hash-map",
  "hash-set",
] as const;

/**
 * Special forms in HQL (keywords with special semantics)
 */
export const SPECIAL_FORMS: readonly string[] = [
  // Definitions
  "def",
  "let",
  "fn",
  "defn",
  "defmacro",
  "macro",

  // Control flow
  "if",
  "cond",
  "when",
  "unless",
  "case",
  "do",

  // Loops
  "for",
  "while",
  "loop",
  "recur",
  "doseq",
  "dotimes",

  // Exception handling
  "try",
  "catch",
  "finally",
  "throw",

  // Modules
  "import",
  "export",
  "require",

  // Interop
  "js/new",
  "js/typeof",
  "js/instanceof",
  "js/await",
  "js/yield",
  "new",

  // Data structures
  "quote",
  "quasiquote",
  "unquote",
  "unquote-splicing",

  // Class system
  "defclass",
  "definterface",
  "defprotocol",
  "extend-type",
  "extend-protocol",
] as const;

/**
 * Common JavaScript global objects and functions that are accessible in HQL
 */
export const JS_GLOBALS: readonly string[] = [
  // Console
  "console",

  // Types
  "Array",
  "Object",
  "String",
  "Number",
  "Boolean",
  "Symbol",
  "BigInt",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",

  // Error types
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",

  // Async
  "Promise",

  // Utilities
  "JSON",
  "Math",
  "Date",
  "RegExp",

  // Global functions
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "fetch",

  // Node/Deno globals
  "Deno",
  "process",
] as const;

/**
 * Get all known identifiers combined
 * @returns Array of all known identifier names
 */
export function getAllKnownIdentifiers(): string[] {
  return [
    ...STDLIB_FUNCTIONS,
    ...BUILTIN_FUNCTIONS,
    ...SPECIAL_FORMS,
    ...JS_GLOBALS,
  ];
}

/**
 * Get stdlib function names only (for runtime error suggestions)
 * @returns Array of stdlib function names
 */
export function getStdlibFunctions(): string[] {
  return [...STDLIB_FUNCTIONS];
}

/**
 * Get builtin function names only
 * @returns Array of builtin function names
 */
export function getBuiltinFunctions(): string[] {
  return [...BUILTIN_FUNCTIONS];
}

/**
 * Get special form names only
 * @returns Array of special form names
 */
export function getSpecialForms(): string[] {
  return [...SPECIAL_FORMS];
}

/**
 * Check if an identifier is a known HQL function or form
 * @param name - The identifier to check
 * @returns true if the identifier is known
 */
export function isKnownIdentifier(name: string): boolean {
  return (
    (STDLIB_FUNCTIONS as readonly string[]).includes(name) ||
    (BUILTIN_FUNCTIONS as readonly string[]).includes(name) ||
    (SPECIAL_FORMS as readonly string[]).includes(name) ||
    (JS_GLOBALS as readonly string[]).includes(name)
  );
}

/**
 * Get the category of a known identifier
 * @param name - The identifier to categorize
 * @returns The category name or null if not known
 */
export function getIdentifierCategory(
  name: string,
): "stdlib" | "builtin" | "special-form" | "js-global" | null {
  if ((STDLIB_FUNCTIONS as readonly string[]).includes(name)) return "stdlib";
  if ((BUILTIN_FUNCTIONS as readonly string[]).includes(name)) return "builtin";
  if ((SPECIAL_FORMS as readonly string[]).includes(name)) return "special-form";
  if ((JS_GLOBALS as readonly string[]).includes(name)) return "js-global";
  return null;
}
