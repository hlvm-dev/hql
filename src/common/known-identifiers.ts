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
 * S-expression type predicates (from builtins.ts, for macro AST inspection).
 * Note: General type predicates (isNil, isNumber, isString, isBoolean,
 * isFunction, isArray) and numeric predicates (isEven, isOdd, etc.)
 * are in stdlib (core.js) and loaded dynamically.
 */
export const BUILTIN_PREDICATE_NAMES = [
  "isList", "isSymbol",  // S-exp AST predicates (interpreter-only)
] as const;

export const BUILTIN_FUNCTION_NAMES = [
  "%first", "%rest", "%length", "%nth", "%empty?",
  "name", "gensym", "not", "str", "mod",
  "vector", "list", "hash-map", "hash-set",
] as const;

/**
 * Special forms handled by the transpiler.
 * KERNEL_PRIMITIVES imported from primitives.ts.
 * Additional forms not in KERNEL_PRIMITIVES listed here.
 */
export const ADDITIONAL_SPECIAL_FORMS = [
  // macro is real HQL syntax: (macro name [params] body)
  // NOTE: defn and defmacro DO NOT EXIST in HQL - removed!
  // NOTE: doseq DOES NOT EXIST in HQL - use (for) instead!
  "macro",
  "case",
  "try", "catch", "finally", "throw",
  "import", "export",
  "new", "js/new", "js/typeof", "js/instanceof", "js/await",
  "some->", "some->>", "cond->", "cond->>",
] as const;

/**
 * Declaration-like special forms for syntax highlighting.
 * These forms appear in declaration context (highlighted as keywords).
 */
export const DECLARATION_SPECIAL_FORMS = ["macro", "import", "export", "new"] as const;

/**
 * Module syntax keywords - fixed parts of import/export syntax.
 * (import [x] from "path") - "from" and "as" are syntax keywords.
 * (class Name (field x)) - "field" is a syntax keyword.
 */
export const MODULE_SYNTAX_KEYWORDS = ["from", "as", "field"] as const;

/**
 * Control flow keywords (for syntax highlighting categorization).
 * These act like keywords even though some are macros.
 */
export const CONTROL_FLOW_KEYWORDS = [
  // From KERNEL_PRIMITIVES
  "if", "do", "loop", "recur", "return",
  // Conditional macros
  "cond", "when", "unless", "match", "case", "default", "else",
  // Loop macros (NOTE: doseq does NOT exist in HQL - use for instead!)
  "for", "while", "dotimes", "repeat",
  // Exception handling
  "try", "catch", "finally", "throw",
  // Async
  "await",
  // Quote forms (from KERNEL_PRIMITIVES)
  "quote", "quasiquote", "unquote", "unquote-splicing",
] as const;

/**
 * Threading macro operators.
 */
export const THREADING_MACROS = [
  "->", "->>", "some->", "some->>", "cond->", "cond->>",
] as const;

/**
 * For-loop syntax keywords - special form syntax in (for ...) construct.
 * Example: (for (i from: 0 to: 10 by: 2) ...)
 */
export const FOR_LOOP_SYNTAX_KEYWORDS = ["to:", "from:", "by:"] as const;

/**
 * Set version for O(1) lookup - use this for .has() checks instead of Array.includes()
 */
export const FOR_LOOP_SYNTAX_KEYWORDS_SET: ReadonlySet<string> = new Set(FOR_LOOP_SYNTAX_KEYWORDS);

/**
 * Word-form logical operators (macros that act like operators).
 * For syntax highlighting categorization.
 */
export const WORD_LOGICAL_OPERATORS = ["and", "or", "not"] as const;

/**
 * Common JS globals accessible in HQL.
 */
export const JS_GLOBAL_NAMES = [
  "console", "Array", "Object", "String", "Number", "Boolean",
  "Map", "Set", "Promise", "JSON", "Math", "Date", "RegExp",
  "Error", "TypeError", "RangeError",
  "setTimeout", "clearTimeout", "fetch",
] as const;

/**
 * Extract macro names from EMBEDDED_MACROS source code.
 * Parses (macro NAME ...) patterns from the HQL source.
 */
export function extractMacroNames(): string[] {
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
 * Exported so grammar generator can await this before calling getAllKnownIdentifiers().
 */
export async function initializeIdentifiers(): Promise<void> {
  if (_cachedIdentifiers !== null) return; // Already initialized

  const staticIds = buildStaticIdentifiers();

  try {
    // Import from index.js which includes both core.js AND self-hosted.js functions
    const stdlib = await import("../lib/stdlib/js/index.js") as Record<string, unknown>;
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
