// src/hql/transpiler/constants/index.ts
// Centralized constants for HQL transpiler.

import * as IR from "../type/hql_ir.ts";

// ============================================================================
// LIMITS AND THRESHOLDS
// ============================================================================

/**
 * Parser limits to prevent resource exhaustion
 */
// ============================================================================
// REGEX PATTERNS
// ============================================================================

/** Matches strings consisting entirely of digits (e.g. "0", "123"). Used for numeric index detection. */
export const NUMERIC_PATTERN = /^\d+$/;

export const PARSER_LIMITS = {
  /** Maximum nesting depth for parsing */
  MAX_PARSING_DEPTH: 128,
  /** Maximum quasiquote nesting depth */
  MAX_QUASIQUOTE_DEPTH: 32,
} as const;

// ============================================================================
// IR NODE TYPE SETS
// ============================================================================

/** Shared set of IR node types that are statements (not expressions).
 *  Used by conditional.ts and loop-recur.ts for "wrap in ExpressionStatement if not a statement" checks. */
export const STATEMENT_TYPES: ReadonlySet<IR.IRNodeType> = new Set([
  IR.IRNodeType.ExpressionStatement,
  IR.IRNodeType.VariableDeclaration,
  IR.IRNodeType.ReturnStatement,
  IR.IRNodeType.IfStatement,
  IR.IRNodeType.WhileStatement,
  IR.IRNodeType.ForStatement,
  IR.IRNodeType.ForOfStatement,
  IR.IRNodeType.ContinueStatement,
  IR.IRNodeType.BreakStatement,
  IR.IRNodeType.ThrowStatement,
]);
