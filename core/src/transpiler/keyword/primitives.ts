// src/primitives.ts

/**
 * Primitive language forms built into the kernel.
 *
 * Philosophy: Keep the kernel LEAN - only what can't be macros.
 *
 * Why these MUST stay in kernel:
 * - quote/quasiquote/unquote: Core metaprogramming (needed for macros themselves)
 * - if, fn, let, var, set!: Core language primitives
 * - loop/recur: Fundamental control flow (TCO)
 * - do: Needs IIFE with BlockStatement to handle both statements AND expressions
 *       (macro version using nested let can only handle expressions, fails with var/statements)
 * - return: Statement-level control flow
 * - class: OOP construct with complex semantics
 *
 * Moved to macros:
 * - method-call: Now a macro over js-call
 *
 * Candidates to evaluate:
 * - fn, async, await: Complex, likely need kernel support
 * - try: Exception handling with catch/finally
 * - enum: Complex OOP construct (599 lines!)
 * - range: Generates __hql_range call (provided by runtime elsewhere)
 * - import, export: Module system
 */
export const PRIMITIVE_OPS = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "=",
  "==",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "eq?",

  "js-get",
  "js-call",
  "return",
]);

export const KERNEL_PRIMITIVES = new Set([
  "quote",
  "if",
  "let",
  "var",
  "set!",
  "quasiquote",
  "unquote",
  "unquote-splicing",
  "loop",
  "recur",
  "do",
  "return",
  "class",
]);

/**
 * Primitive class operations.
 */
export const PRIMITIVE_CLASS = new Set(["new"]);

/**
 * Primitive data structure operations.
 */
export const PRIMITIVE_DATA_STRUCTURE = new Set([
  "vector",
  "hash-set",
]);
