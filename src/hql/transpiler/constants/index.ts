// src/hql/transpiler/constants/index.ts
// Centralized constants for HQL transpiler.

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
