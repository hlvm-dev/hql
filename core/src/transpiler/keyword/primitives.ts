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
  // Arithmetic operators
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",  // Exponentiation (v2.0)

  // Assignment operator (v2.0 - now assignment, not equality!)
  "=",

  // Comparison operators (v2.0)
  "===",  // Strict equality
  "==",   // Loose equality
  "!==",  // Strict inequality
  "!=",   // Loose inequality
  "<",
  ">",
  "<=",
  ">=",
  "eq?",  // Compatibility: maps to ===

  // Logical operators (v2.0)
  "&&",   // Logical AND
  "||",   // Logical OR
  "!",    // Logical NOT
  "??",   // Nullish coalescing

  // Bitwise operators (v2.0)
  "&",    // Bitwise AND
  "|",    // Bitwise OR
  "^",    // Bitwise XOR
  "~",    // Bitwise NOT
  "<<",   // Left shift
  ">>",   // Sign-propagating right shift
  ">>>",  // Zero-fill right shift

  // Type and special operators (v2.0)
  "typeof",
  "instanceof",
  "in",
  "delete",
  "void",

  // JS Interop
  "js-get",
  "js-call",
  "return",
]);

export const KERNEL_PRIMITIVES = new Set([
  "quote",
  "if",
  "const",  // v2.0: Immutable binding
  "let",    // v2.0: Mutable block-scoped binding (changed from immutable)
  "var",    // Function-scoped binding (unchanged)
  // "set!" removed - now the "=" operator in PRIMITIVE_OPS
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
