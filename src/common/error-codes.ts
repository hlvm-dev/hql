/**
 * Standardized Error Codes for HQL
 *
 * Error codes follow the pattern: HQL<category><number>
 * - 1000-1999: Parse errors
 * - 2000-2999: Import errors
 * - 3000-3999: Validation errors
 * - 4000-4999: Transform errors
 * - 5000-5999: Runtime errors
 * - 6000-6999: Code generation errors
 * - 7000-7999: Macro errors
 *
 * This enables:
 * - Searchable error codes in documentation
 * - Consistent error categorization
 * - Easy filtering in logs
 * - Links to detailed error explanations
 */

export enum HQLErrorCode {
  // ============================================================================
  // Parse Errors (1000-1999)
  // ============================================================================

  /** Unclosed list - missing closing parenthesis */
  UNCLOSED_LIST = 1001,

  /** Unclosed string literal - missing closing quote */
  UNCLOSED_STRING = 1002,

  /** Unexpected token in input */
  UNEXPECTED_TOKEN = 1003,

  /** Unexpected end of file */
  UNEXPECTED_EOF = 1004,

  /** Invalid syntax - general parse error */
  INVALID_SYNTAX = 1005,

  /** Unclosed comment block */
  UNCLOSED_COMMENT = 1006,

  /** Invalid character in input */
  INVALID_CHARACTER = 1007,

  // ============================================================================
  // Import Errors (2000-2999)
  // ============================================================================

  /** Invalid import statement syntax */
  INVALID_IMPORT_SYNTAX = 2001,

  /** Module or file not found */
  MODULE_NOT_FOUND = 2002,

  /** Circular import dependency detected */
  CIRCULAR_IMPORT = 2003,

  /** Invalid import path */
  INVALID_IMPORT_PATH = 2004,

  /** Import resolution failed */
  IMPORT_RESOLUTION_FAILED = 2005,

  /** Named export not found in module */
  EXPORT_NOT_FOUND = 2006,

  // ============================================================================
  // Validation Errors (3000-3999)
  // ============================================================================

  /** Invalid function definition syntax */
  INVALID_FUNCTION_SYNTAX = 3001,

  /** Invalid class definition syntax */
  INVALID_CLASS_SYNTAX = 3002,

  /** Missing required function argument */
  MISSING_REQUIRED_ARGUMENT = 3003,

  /** Too many arguments provided to function */
  TOO_MANY_ARGUMENTS = 3004,

  /** Invalid parameter definition */
  INVALID_PARAMETER = 3005,

  /** Invalid variable name */
  INVALID_VARIABLE_NAME = 3006,

  /** Duplicate parameter name */
  DUPLICATE_PARAMETER = 3007,

  /** Invalid expression in context */
  INVALID_EXPRESSION = 3008,

  // ============================================================================
  // Transform Errors (4000-4999)
  // ============================================================================

  /** General transformation failed */
  TRANSFORMATION_FAILED = 4001,

  /** Unsupported language feature */
  UNSUPPORTED_FEATURE = 4002,

  /** Invalid AST node type */
  INVALID_AST_NODE = 4003,

  /** Type mismatch during transformation */
  TRANSFORM_TYPE_MISMATCH = 4004,

  // ============================================================================
  // Runtime Errors (5000-5999)
  // ============================================================================

  /** Undefined variable reference */
  UNDEFINED_VARIABLE = 5001,

  /** Type mismatch at runtime */
  TYPE_MISMATCH = 5002,

  /** Division by zero */
  DIVISION_BY_ZERO = 5003,

  /** Null or undefined dereference */
  NULL_REFERENCE = 5004,

  /** Function not found */
  FUNCTION_NOT_FOUND = 5005,

  // ============================================================================
  // Code Generation Errors (6000-6999)
  // ============================================================================

  /** Failed to generate code for node */
  CODEGEN_FAILED = 6001,

  /** Invalid code generation target */
  INVALID_CODEGEN_TARGET = 6002,

  /** Source map generation failed */
  SOURCEMAP_GENERATION_FAILED = 6003,

  // ============================================================================
  // Macro Errors (7000-7999)
  // ============================================================================

  /** Invalid macro definition */
  INVALID_MACRO_DEFINITION = 7001,

  /** Macro expansion failed */
  MACRO_EXPANSION_FAILED = 7002,

  /** Invalid macro syntax */
  INVALID_MACRO_SYNTAX = 7003,

  /** Macro not found */
  MACRO_NOT_FOUND = 7004,

  /** Recursive macro expansion limit exceeded */
  MACRO_RECURSION_LIMIT = 7005,
}

const ERROR_DOC_URLS: Partial<Record<HQLErrorCode, string>> = {};

/**
 * Format error code for display
 *
 * @param code - The error code enum value
 * @returns Formatted string like "HQL1001"
 *
 * @example
 * formatErrorCode(HQLErrorCode.UNCLOSED_LIST) // "HQL1001"
 */
export function formatErrorCode(code: HQLErrorCode): string {
  return `HQL${code}`;
}

/**
 * Get documentation URL for an error code
 *
 * @param code - The error code enum value
 * @returns URL to error documentation, or null if not available
 *
 * @example
 * getErrorDocUrl(HQLErrorCode.UNCLOSED_LIST)
 * // null (documentation not yet available)
 */
export function getErrorDocUrl(code: HQLErrorCode): string | null {
  // TODO: Add documentation URLs when docs are published
  // Placeholder for future documentation at hlvm-dev or similar domain
  return ERROR_DOC_URLS[code] ?? null;
}
