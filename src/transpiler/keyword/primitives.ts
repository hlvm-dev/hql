// src/primitives.ts

/**
 * Primitive language forms built into the kernel.
 *
 * Philosophy: Keep the kernel LEAN - only what can't be macros.
 *
 * Why these MUST stay in kernel:
 * - quote/quasiquote/unquote: Core metaprogramming (needed for macros themselves)
 * - if, fn, let, var, =: Core language primitives
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

  // Logical operators (v2.0)
  "&&",   // Logical AND
  "||",   // Logical OR
  "!",    // Logical NOT
  "??",   // Nullish coalescing

  // Logical assignment operators (v2.0)
  "??=",  // Nullish coalescing assignment
  "&&=",  // Logical AND assignment
  "||=",  // Logical OR assignment

  // Compound assignment operators (v2.0)
  "+=",   // Addition assignment
  "-=",   // Subtraction assignment
  "*=",   // Multiplication assignment
  "/=",   // Division assignment
  "%=",   // Remainder assignment
  "**=",  // Exponentiation assignment

  // Bitwise operators (v2.0)
  "&",    // Bitwise AND
  "|",    // Bitwise OR
  "^",    // Bitwise XOR
  "~",    // Bitwise NOT
  "<<",   // Left shift
  ">>",   // Sign-propagating right shift
  ">>>",  // Zero-fill right shift

  // Bitwise assignment operators (v2.0)
  "&=",   // Bitwise AND assignment
  "|=",   // Bitwise OR assignment
  "^=",   // Bitwise XOR assignment
  "<<=",  // Left shift assignment
  ">>=",  // Right shift assignment
  ">>>=", // Unsigned right shift assignment

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

/**
 * Arithmetic operators - used for loop optimization AND syntax highlighting.
 */
export const ARITHMETIC_OPS = ["+", "-", "*", "/", "%", "**"] as const;

/** Set version for O(1) lookup */
export const ARITHMETIC_OPS_SET: ReadonlySet<string> = new Set(ARITHMETIC_OPS);

/**
 * Comparison operators - for syntax highlighting categorization.
 */
export const COMPARISON_OPS = ["===", "==", "!==", "!=", "<", ">", "<=", ">="] as const;

/**
 * Logical operators (symbol form) - for syntax highlighting categorization.
 * Note: word-form (and, or, not) are in known-identifiers.ts WORD_LOGICAL_OPERATORS.
 */
export const LOGICAL_OPS = ["&&", "||", "!", "??"] as const;

/**
 * Bitwise operators - for syntax highlighting categorization.
 */
export const BITWISE_OPS = ["&", "|", "^", "~", "<<", ">>", ">>>"] as const;

/**
 * First-class operators - can be used as values (passed to higher-order functions).
 * When used in value position, transpiler calls __hql_get_op("+") at runtime.
 * This is a SUBSET of PRIMITIVE_OPS.
 */
export const FIRST_CLASS_OPERATORS = new Set([
  // Arithmetic
  "+", "-", "*", "/", "%", "**",
  // Comparison
  "===", "==", "!==", "!=", "<", ">", "<=", ">=",
  // Logical
  "&&", "||", "!",
  // Bitwise
  "~", "&", "|", "^", "<<", ">>", ">>>",
]);

/**
 * All operator names for external use (e.g., "Did you mean?" suggestions).
 */
export const ALL_OPERATOR_NAMES = [...PRIMITIVE_OPS] as const;

/**
 * Declaration keywords - forms that declare new named entities.
 */
export const DECLARATION_KEYWORDS = ["fn", "function", "class", "enum"] as const;

/**
 * Binding keywords - forms that bind values to names.
 */
export const BINDING_KEYWORDS = ["let", "var", "const"] as const;

/**
 * All declaration and binding keywords combined.
 * Used for checking if a form is a declaration export.
 */
export const ALL_DECLARATION_BINDING_KEYWORDS = [
  ...DECLARATION_KEYWORDS,
  ...BINDING_KEYWORDS,
] as const;

/** Set version for O(1) lookup */
export const ALL_DECLARATION_BINDING_KEYWORDS_SET: ReadonlySet<string> = new Set(ALL_DECLARATION_BINDING_KEYWORDS);

/**
 * JavaScript literal keywords - values that transpile directly to JS literals.
 * These are language constants that should never change.
 */
export const JS_LITERAL_KEYWORDS = ["null", "undefined", "true", "false"] as const;

/** Set version for O(1) lookup */
export const JS_LITERAL_KEYWORDS_SET: ReadonlySet<string> = new Set(JS_LITERAL_KEYWORDS);

/**
 * HQL-specific constant keywords (in addition to JS literals).
 */
const HQL_CONSTANT_KEYWORDS = ["nil"] as const;

/**
 * All constant keywords combined.
 */
export const ALL_CONSTANT_KEYWORDS = [...JS_LITERAL_KEYWORDS, ...HQL_CONSTANT_KEYWORDS] as const;
