// src/hql/transpiler/constants/index.ts
// Centralized constants for HQL transpiler.

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
