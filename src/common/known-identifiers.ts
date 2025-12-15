/**
 * Known Identifiers Registry for "Did you mean?" suggestions
 *
 * Provides known HQL identifiers for typo suggestions.
 * All identifiers are loaded DYNAMICALLY from their source:
 * - Stdlib functions: from core.js exports
 * - Macros: parsed from EMBEDDED_MACROS source
 * - Operators: from primitives.ts (single source of truth)
 * - Builtins & special forms: static (these are truly fixed)
 */

import { EMBEDDED_MACROS } from "../lib/embedded-macros.ts";
import { ALL_OPERATOR_NAMES, KERNEL_PRIMITIVES } from "../transpiler/keyword/primitives.ts";

// Cache for identifiers (populated on module load)
let _cachedIdentifiers: string[] | null = null;

/**
 * Builtin function names from the interpreter (builtins.ts).
 * Operators are imported from primitives.ts (single source of truth).
 */
const BUILTIN_PREDICATE_NAMES = [
  "nil?", "isNil", "number?", "isNumber", "string?", "isString",
  "boolean?", "isBoolean", "function?", "isFunction", "list?",
  "symbol?", "array?", "isArray",
];

const BUILTIN_FUNCTION_NAMES = [
  "%first", "%rest", "%length", "%nth", "%empty?",
  "name", "gensym", "not", "str", "mod",
  "vector", "list", "hash-map", "hash-set",
];

/**
 * Special forms handled by the transpiler.
 * KERNEL_PRIMITIVES imported from primitives.ts.
 * Additional forms not in KERNEL_PRIMITIVES listed here.
 */
const ADDITIONAL_SPECIAL_FORMS = [
  "defn", "defmacro", "macro",
  "case", "doseq",
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
    ...ALL_OPERATOR_NAMES,
    ...BUILTIN_PREDICATE_NAMES,
    ...BUILTIN_FUNCTION_NAMES,
    ...[...KERNEL_PRIMITIVES],
    ...ADDITIONAL_SPECIAL_FORMS,
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
