// src/primitives.ts

/**
 * Primitive language forms built into the kernel.
 *
 * Philosophy: Keep the kernel LEAN - only what can't be macros.
 *
 * Why these MUST stay in kernel:
 * - quote/quasiquote/unquote: Core metaprogramming (needed for macros themselves)
 * - if, fn, const, let, var: Core language primitives
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
  "=",    // Assignment
  "===",  // Strict equality
  "==",   // Loose equality
  "!==",  // Strict inequality
  "!=",   // Loose inequality
  "<",
  ">",
  "<=",
  ">=",
  "eq?",  // Lisp-style equality (maps to ===)
  "&&",   // Logical AND
  "||",   // Logical OR
  "!",    // Logical NOT
  "&",    // Bitwise AND
  "|",    // Bitwise OR
  "^",    // Bitwise XOR
  "~",    // Bitwise NOT
  "<<",   // Left shift
  ">>",   // Sign-propagating right shift
  ">>>",  // Zero-fill right shift
  "**",   // Exponentiation
  "??",   // Nullish coalescing
  "typeof",    // Type check
  "instanceof", // Instance check
  "in",        // Property check
  "delete",    // Property deletion
  "void",      // Void operator

  "js-get",
  "js-call",
  "return",
]);

export const KERNEL_PRIMITIVES = new Set([
  "quote",
  "if",
  "const",
  "let",
  "var",
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
