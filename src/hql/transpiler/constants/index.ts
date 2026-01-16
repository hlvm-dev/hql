// src/hql/transpiler/constants/index.ts
// Centralized constants for HQL transpiler - Single Source of Truth
//
// This module consolidates all hardcoded values that were previously scattered
// across 50+ locations in the codebase. Using these constants:
// 1. Prevents typos and inconsistencies
// 2. Makes changes propagate automatically
// 3. Improves maintainability
// 4. Enables IDE autocomplete and type checking

// ============================================================================
// KEYWORDS - Language reserved words
// ============================================================================

/**
 * Import/export related keywords
 */
export const IMPORT_KEYWORDS = {
  IMPORT: "import",
  EXPORT: "export",
  FROM: "from",
  AS: "as",
  DEFAULT: "default",
} as const;

/**
 * Control flow keywords
 */
export const CONTROL_FLOW_KEYWORDS = {
  IF: "if",
  ELSE: "else",
  COND: "cond",
  WHEN: "when",
  UNLESS: "unless",
  CASE: "case",
  SWITCH: "switch",
  DO: "do",
  RETURN: "return",
  THROW: "throw",
  TRY: "try",
  CATCH: "catch",
  FINALLY: "finally",
} as const;

/**
 * Loop keywords
 */
export const LOOP_KEYWORDS = {
  FOR: "for",
  WHILE: "while",
  LOOP: "loop",
  RECUR: "recur",
  BREAK: "break",
  CONTINUE: "continue",
  FOR_EACH: "for-each",
  FOR_AWAIT_OF: "for-await-of",
} as const;

/**
 * Binding/declaration keywords
 */
export const BINDING_KEYWORDS = {
  VAR: "var",
  LET: "let",
  CONST: "const",
  DEF: "def",
  SET: "set",
  FN: "fn",
  MACRO: "macro",
  ASYNC: "async",
} as const;

/**
 * Class-related keywords
 */
export const CLASS_KEYWORDS = {
  CLASS: "class",
  EXTENDS: "extends",
  CONSTRUCTOR: "constructor",
  STATIC: "static",
  ABSTRACT: "abstract",
  INTERFACE: "interface",
  ENUM: "enum",
  TYPE: "type",
} as const;

/**
 * Switch/case keywords
 */
export const SWITCH_KEYWORDS = {
  CASE: "case",
  DEFAULT: "default",
  FALLTHROUGH: ":fallthrough",
} as const;

// ============================================================================
// OPERATORS - Grouped by category
// ============================================================================

/**
 * Arithmetic operators
 */
export const ARITHMETIC_OPERATORS = new Set([
  "+", "-", "*", "/", "%", "**",
]);

/**
 * Comparison operators
 */
export const COMPARISON_OPERATORS = new Set([
  "===", "==", "!==", "!=", ">", "<", ">=", "<=",
]);

/**
 * Logical operators
 */
export const LOGICAL_OPERATORS = new Set([
  "&&", "||", "!",
]);

/**
 * Bitwise operators
 */
export const BITWISE_OPERATORS = new Set([
  "&", "|", "^", "~", "<<", ">>", ">>>",
]);

/**
 * Assignment operators
 */
export const ASSIGNMENT_OPERATORS = new Set([
  "=", "+=", "-=", "*=", "/=", "%=", "**=",
  "&=", "|=", "^=", "<<=", ">>=", ">>>=",
  "&&=", "||=", "??=",
]);

/**
 * Unary operators
 */
export const UNARY_OPERATORS = new Set([
  "typeof", "delete", "void", "!", "~", "+", "-",
]);

/**
 * All operators combined (for quick lookup)
 */
export const ALL_OPERATORS = new Set([
  ...ARITHMETIC_OPERATORS,
  ...COMPARISON_OPERATORS,
  ...LOGICAL_OPERATORS,
  ...BITWISE_OPERATORS,
  ...ASSIGNMENT_OPERATORS,
  ...UNARY_OPERATORS,
  "instanceof", "in",
]);

// ============================================================================
// SPECIAL SYNTAX MARKERS
// ============================================================================

/**
 * Special syntax prefixes and markers
 */
export const SYNTAX_MARKERS = {
  /** Private field prefix */
  PRIVATE_PREFIX: "#",
  /** Spread/rest operator */
  SPREAD: "...",
  /** Property access dot */
  DOT: ".",
  /** Optional chaining */
  OPTIONAL_CHAIN: "?.",
  /** Nullish coalescing */
  NULLISH_COALESCE: "??",
  /** JS interop prefix */
  JS_INTEROP: "js/",
  /** Type annotation prefix */
  TYPE_ANNOTATION: ":",
  /** Keyword argument suffix */
  KEYWORD_ARG_SUFFIX: ":",
  /** Generator function marker */
  GENERATOR_MARKER: "fn*",
  /** Async function marker */
  ASYNC_MARKER: "async",
} as const;

// ============================================================================
// DATA STRUCTURE SYMBOLS
// ============================================================================

/**
 * Data structure constructor symbols
 */
export const DATA_STRUCTURE_SYMBOLS = {
  VECTOR: "vector",
  EMPTY_ARRAY: "empty-array",
  HASH_MAP: "hash-map",
  HASH_MAP_INTERNAL: "%hash-map",
  HASH_SET: "hash-set",
  EMPTY_MAP: "empty-map",
} as const;

/**
 * Set of all data structure constructor names (for quick lookup)
 */
export const DATA_STRUCTURE_NAMES: Set<string> = new Set(Object.values(DATA_STRUCTURE_SYMBOLS));

// ============================================================================
// FORM POSITIONS - Element indices in list structures
// ============================================================================

/**
 * Import form structure: (import [symbols] from "path")
 */
export const IMPORT_FORM = {
  KEYWORD: 0,
  SYMBOLS: 1,
  FROM_KEYWORD: 2,
  SOURCE: 3,
} as const;

/**
 * Export form structure: (export default expr) or (export [symbols])
 */
export const EXPORT_FORM = {
  KEYWORD: 0,
  DEFAULT_OR_SYMBOLS: 1,
  EXPR: 2,
} as const;

/**
 * If form structure: (if test consequent alternate?)
 */
export const IF_FORM = {
  KEYWORD: 0,
  TEST: 1,
  CONSEQUENT: 2,
  ALTERNATE: 3,
} as const;

/**
 * Let form structure: (let (bindings...) body...)
 */
export const LET_FORM = {
  KEYWORD: 0,
  BINDINGS: 1,
  BODY_START: 2,
} as const;

/**
 * Function form structure: (fn name? [params] body...)
 */
export const FN_FORM = {
  KEYWORD: 0,
  NAME_OR_PARAMS: 1,
  PARAMS_OR_BODY: 2,
} as const;

/**
 * Class form structure: (class Name body...)
 */
export const CLASS_FORM = {
  KEYWORD: 0,
  NAME: 1,
  BODY_START: 2,
} as const;

/**
 * Switch/case form structure
 */
export const CASE_FORM = {
  KEYWORD: 0,
  TEST_VALUE: 1,
  MAYBE_FALLTHROUGH: 2,
  BODY_START: 2, // or 3 if fallthrough present
} as const;

// ============================================================================
// LIMITS AND THRESHOLDS
// ============================================================================

/**
 * Parser limits to prevent resource exhaustion
 */
export const PARSER_LIMITS = {
  /** Maximum nesting depth for parsing */
  MAX_PARSING_DEPTH: 128,
  /** Maximum quasiquote nesting depth */
  MAX_QUASIQUOTE_DEPTH: 32,
  /** Maximum template string nesting */
  MAX_TEMPLATE_DEPTH: 16,
} as const;

// ============================================================================
// FILE EXTENSIONS
// ============================================================================

/**
 * Recognized file extensions
 */
export const FILE_EXTENSIONS = {
  HQL: ".hql",
  JS: ".js",
  TS: ".ts",
  MJS: ".mjs",
  CJS: ".cjs",
  JSON: ".json",
} as const;

/**
 * Set of HQL file extensions
 */
export const HQL_EXTENSIONS = new Set([".hql"]);

/**
 * Set of JavaScript file extensions
 */
export const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

/**
 * Set of TypeScript file extensions
 */
export const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

// ============================================================================
// TYPE CHECKING UTILITIES
// ============================================================================

/**
 * Check if a string is any operator
 */
export function isOperator(op: string): boolean {
  return ALL_OPERATORS.has(op);
}

/**
 * Check if a string is a data structure constructor
 */
export function isDataStructureConstructor(name: string): boolean {
  return DATA_STRUCTURE_NAMES.has(name);
}
