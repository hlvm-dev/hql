// index.ts - Public API for HQL runtime features

import { getHQLRuntime, HQLRuntime, resetHQLRuntime } from "./hql-runtime.ts";
import { isList, isLiteral, isSymbol, type SExp } from "../s-exp/types.ts";
import { gensym as gensymImpl } from "../gensym.ts";

function setDoc<T>(fn: T, doc: string): void {
  (fn as T & { __doc__?: string }).__doc__ = doc;
}

/**
 * Convert S-expression to JavaScript object
 */
function toJs(sexp: SExp): unknown {
  if (isSymbol(sexp)) {
    return sexp.name;
  } else if (isLiteral(sexp)) {
    return sexp.value;
  } else if (isList(sexp)) {
    return sexp.elements.map(toJs);
  }
  return sexp;
}

/**
 * Evaluate HQL code with persistent runtime state
 * @param {string} source - HQL source code
 * @param {object} [options] - Evaluation options
 * @returns {Promise<string>} Transpiled JavaScript code
 * @example
 * await hqlEval("(+ 1 2)")
 * // → "1 + 2"
 * @example
 * await hqlEval("(macro unless [cond & body] `(if (not ~cond) (do ~@body)))")
 * // Macro defined and available for future evaluations
 */
export async function hqlEval(
  source: string,
  options: { file?: string } = {},
): Promise<string> {
  const runtime = await getHQLRuntime();
  return runtime.eval(source, options.file);
}

/**
 * Expand a macro form one level
 * @param {string|object} form - Macro form to expand
 * @returns {Promise<any>} Expanded form as JavaScript object
 * @example
 * await macroexpand1("(unless false (print 'ok'))")
 * // → "(if (not false) (do (print 'ok')))"
 */
export async function macroexpand1(form: string | SExp): Promise<unknown> {
  const runtime = await getHQLRuntime();
  const expanded = await runtime.macroexpand1(form);
  return toJs(expanded);
}

/**
 * Fully expand all macros in a form
 * @param {string|object} form - Form to expand
 * @returns {Promise<any>} Fully expanded form as JavaScript object
 * @example
 * await macroexpand("(unless false (print 'ok'))")
 * // → "(if (not false) (do (print 'ok')))"
 * @example
 * await macroexpand("(when (> x 5) (print x))")
 * // → "(if (> x 5) (do (print x)) nil)"
 */
export async function macroexpand(form: string | SExp): Promise<unknown> {
  const runtime = await getHQLRuntime();
  const expanded = await runtime.macroexpand(form);
  return toJs(expanded);
}

/**
 * Get all defined macros
 * @returns {Promise<object>} Object mapping macro names to definitions
 * @example
 * await getMacros()
 * // → { unless: {...}, when: {...}, ... }
 */
interface MacroMetadata {
  name: string;
  params: string[];
  restParam?: string | null;
  source?: string;
  definedAt?: unknown;
}

export async function getMacros(): Promise<Record<string, MacroMetadata>> {
  const runtime = await getHQLRuntime();
  const macros = runtime.getMacros();
  const result: Record<string, MacroMetadata> = {};

  for (const [name, def] of macros) {
    result[name] = {
      name: def.name,
      params: def.params,
      restParam: def.restParam,
      source: def.source,
      definedAt: def.definedAt,
    };
  }

  return result;
}

/**
 * Check if a macro is defined
 * @param {string} name - Macro name
 * @returns {Promise<boolean>} True if macro exists
 * @example
 * await hasMacro("unless")
 * // → true
 * @example
 * await hasMacro("nonexistent")
 * // → false
 */
export async function hasMacro(name: string): Promise<boolean> {
  const runtime = await getHQLRuntime();
  return runtime.hasMacro(name);
}

/**
 * Reset the HQL runtime, clearing all macros and state
 * @returns {Promise<void>}
 * @example
 * await resetRuntime()
 * // All runtime macros cleared
 */
export async function resetRuntime(): Promise<void> {
  await resetHQLRuntime();
}

/**
 * Define a macro programmatically
 * @param {string} source - Macro definition source
 * @returns {Promise<void>}
 * @example
 * await defineMacro("(macro when [test & body] `(if ~test (do ~@body)))")
 * // Macro 'when' now available
 */
export async function defineMacro(source: string): Promise<void> {
  const runtime = await getHQLRuntime();
  await runtime.eval(source);
}

/**
 * Generate a unique symbol for use in macros
 * Prevents variable capture by creating guaranteed-unique identifiers
 * @param {string} [prefix="g"] - Optional prefix for generated symbol
 * @returns {string} Unique symbol name
 * @example
 * gensym()
 * // → "g_0"
 * @example
 * gensym("temp")
 * // → "temp_1"
 * @example
 * // Use in macros to avoid variable capture:
 * // (macro with-temp [value & body]
 * //   (var tmp (gensym "temp"))
 * //   `(let (~tmp ~value)
 * //      ~@body))
 */
export function gensym(prefix: string = "g"): string {
  return gensymImpl(prefix).name; // Extract .name from GensymSymbol
}

// Export the runtime class for advanced usage
export { HQLRuntime };

// Initialize documentation
function initDocs() {
  setDoc(
    hqlEval,
    `hqlEval(source, options?)
Evaluate HQL code with persistent runtime state
Parameters:
  source: HQL source code string
  options.file: Optional file path for error reporting
Returns: Transpiled JavaScript code`,
  );

  setDoc(
    macroexpand1,
    `macroexpand1(form)
Expand a macro form one level
Parameters:
  form: Macro form as string or S-expression
Returns: Expanded form as JavaScript object`,
  );

  setDoc(
    macroexpand,
    `macroexpand(form)
Fully expand all macros in a form
Parameters:
  form: Form to expand as string or S-expression
Returns: Fully expanded form as JavaScript object`,
  );

  setDoc(
    getMacros,
    `getMacros()
Get all defined macros
Returns: Object mapping macro names to definitions`,
  );

  setDoc(
    hasMacro,
    `hasMacro(name)
Check if a macro is defined
Parameters:
  name: Macro name to check
Returns: True if macro exists`,
  );

  setDoc(
    resetRuntime,
    `resetRuntime()
Reset the HQL runtime, clearing all macros and state`,
  );

  setDoc(
    defineMacro,
    `defineMacro(source)
Define a macro programmatically
Parameters:
  source: Macro definition source code
Returns: Promise<void>`,
  );

  setDoc(
    gensym,
    `gensym(prefix?)
Generate a unique symbol for use in macros
Prevents variable capture by creating guaranteed-unique identifiers
Parameters:
  prefix: Optional prefix for generated symbol (default: "g")
Returns: Unique symbol name
Examples:
  gensym() → "g_0"
  gensym("temp") → "temp_1"
  Use in macros to avoid variable capture`,
  );
}

initDocs();
