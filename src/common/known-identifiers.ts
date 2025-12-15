/**
 * Known Identifiers Registry for "Did you mean?" suggestions
 *
 * Provides known HQL identifiers for typo suggestions.
 * All identifiers are loaded DYNAMICALLY from their source:
 * - Stdlib functions: from core.js exports
 * - Macros: parsed from EMBEDDED_MACROS source
 * - Builtins & special forms: static (these are truly fixed)
 */

import { EMBEDDED_MACROS } from "../lib/embedded-macros.ts";

// Cache for identifiers (populated on module load)
let _cachedIdentifiers: string[] | null = null;

/**
 * Builtin function names from the interpreter (builtins.ts).
 * These are truly static - defined in TypeScript, not HQL.
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
 * Special forms handled by the transpiler.
 * These are truly static - hardcoded in the transpiler, not defined as macros.
 */
const SPECIAL_FORM_NAMES = [
  "if", "let", "var", "fn", "do", "quote", "quasiquote",
  "def", "defn", "defmacro", "macro",
  "case", "loop", "recur", "doseq",
  "try", "catch", "finally", "throw",
  "import", "export",
  "new", "js/new", "js/typeof", "js/instanceof", "js/await",
  "some->", "some->>", "cond->", "cond->>",
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
 * Extract macro names from EMBEDDED_MACROS source code.
 * Parses (macro NAME ...) patterns from the HQL source.
 */
function extractMacroNames(): string[] {
  const allSource = Object.values(EMBEDDED_MACROS).join("\n");
  const macroRegex = /\(macro\s+([^\s\[\]]+)/g;
  const macros = new Set<string>();

  let match;
  while ((match = macroRegex.exec(allSource)) !== null) {
    macros.add(match[1]);
  }

  return [...macros];
}

/**
 * Build the static identifier list (for immediate availability).
 */
function buildStaticIdentifiers(): string[] {
  return [...new Set([
    ...BUILTIN_NAMES,
    ...SPECIAL_FORM_NAMES,
    ...extractMacroNames(),
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
