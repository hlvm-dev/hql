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

/**
 * Base URL for error documentation
 * Can be configured via HQL_ERROR_DOC_BASE_URL environment variable
 */
const ERROR_DOC_BASE_URL =
  (typeof Deno !== "undefined" && Deno.env?.get?.("HQL_ERROR_DOC_BASE_URL")) ||
  "https://hql-lang.dev/errors";

/**
 * Detailed error information including description and common causes
 */
interface ErrorInfo {
  /** Short description of the error */
  description: string;
  /** Common causes of this error */
  causes: string[];
  /** How to fix this error */
  fixes: string[];
}

/**
 * Comprehensive error information for all HQL error codes
 */
const ERROR_INFO: Record<HQLErrorCode, ErrorInfo> = {
  // ============================================================================
  // Parse Errors (1000-1999)
  // ============================================================================
  [HQLErrorCode.UNCLOSED_LIST]: {
    description: "A list expression is missing its closing parenthesis.",
    causes: [
      "Forgot to add closing ')' at the end of an expression",
      "Nested parentheses are unbalanced",
      "Copy-paste error left incomplete expression",
    ],
    fixes: [
      "Count opening and closing parentheses to ensure they match",
      "Use an editor with bracket matching to find the unclosed list",
      "Add the missing ')' at the appropriate location",
    ],
  },
  [HQLErrorCode.UNCLOSED_STRING]: {
    description: "A string literal is missing its closing quote.",
    causes: [
      "Forgot to add closing quote at end of string",
      "String contains unescaped quote character",
      "Multi-line string not properly formatted",
    ],
    fixes: [
      "Add the closing quote to complete the string",
      "Escape internal quotes with backslash: \\\"",
      "For multi-line strings, ensure proper escaping",
    ],
  },
  [HQLErrorCode.UNEXPECTED_TOKEN]: {
    description: "An unexpected character or token was found in the code.",
    causes: [
      "Extra closing parenthesis without matching opening",
      "Invalid character in identifier",
      "Misplaced operator or punctuation",
    ],
    fixes: [
      "Check for extra ')' characters",
      "Ensure identifiers only contain valid characters",
      "Review the syntax near the error location",
    ],
  },
  [HQLErrorCode.UNEXPECTED_EOF]: {
    description: "The code ended unexpectedly before a complete expression.",
    causes: [
      "File ends in the middle of an expression",
      "Missing closing delimiters at end of file",
      "Incomplete function or macro definition",
    ],
    fixes: [
      "Complete the unfinished expression",
      "Add missing closing parentheses or quotes",
      "Check that all blocks are properly closed",
    ],
  },
  [HQLErrorCode.INVALID_SYNTAX]: {
    description: "The code contains invalid syntax that cannot be parsed.",
    causes: [
      "Malformed expression structure",
      "Invalid use of special forms",
      "Syntax not supported by HQL",
    ],
    fixes: [
      "Review the HQL syntax documentation",
      "Check for typos in keywords",
      "Ensure expressions follow correct structure",
    ],
  },
  [HQLErrorCode.UNCLOSED_COMMENT]: {
    description: "A block comment is missing its closing delimiter.",
    causes: [
      "Forgot to close multi-line comment with */",
      "Nested comments not properly closed",
      "Comment delimiter typo",
    ],
    fixes: [
      "Add the closing */ to complete the comment",
      "Check for nested comments and close each one",
      "Ensure comment delimiters are correctly typed",
    ],
  },
  [HQLErrorCode.INVALID_CHARACTER]: {
    description: "An invalid or unexpected character was found.",
    causes: [
      "Non-ASCII character in identifier",
      "Invalid Unicode character",
      "Control character in source code",
    ],
    fixes: [
      "Remove or replace the invalid character",
      "Use only ASCII characters in identifiers",
      "Check for invisible characters (copy-paste issues)",
    ],
  },

  // ============================================================================
  // Import Errors (2000-2999)
  // ============================================================================
  [HQLErrorCode.INVALID_IMPORT_SYNTAX]: {
    description: "The import statement has incorrect syntax.",
    causes: [
      "Missing required parts of import statement",
      "Incorrect keyword usage (use 'from' not 'fom')",
      "Invalid destructuring syntax",
    ],
    fixes: [
      "Use correct syntax: (import [name] from \"path\")",
      "Check spelling of 'import' and 'from' keywords",
      "Verify destructuring brackets are correct",
    ],
  },
  [HQLErrorCode.MODULE_NOT_FOUND]: {
    description: "The specified module or file could not be found.",
    causes: [
      "File path is incorrect or file doesn't exist",
      "Module name is misspelled",
      "Module not installed or not in import map",
    ],
    fixes: [
      "Verify the file exists at the specified path",
      "Check spelling of module name",
      "Add module to import map or install it",
    ],
  },
  [HQLErrorCode.CIRCULAR_IMPORT]: {
    description: "A circular dependency was detected between modules.",
    causes: [
      "Module A imports B, and B imports A",
      "Chain of imports forms a cycle",
      "Indirect circular dependency through multiple files",
    ],
    fixes: [
      "Restructure code to break the circular dependency",
      "Move shared code to a separate module",
      "Use lazy loading or dependency injection",
    ],
  },
  [HQLErrorCode.INVALID_IMPORT_PATH]: {
    description: "The import path is invalid or malformed.",
    causes: [
      "Path doesn't start with './', '../', or valid prefix",
      "Invalid characters in path",
      "Unsupported file extension",
    ],
    fixes: [
      "Use relative paths starting with './' or '../'",
      "Use valid import map entries for bare specifiers",
      "Ensure file extension is supported (.hql, .ts, .js)",
    ],
  },
  [HQLErrorCode.IMPORT_RESOLUTION_FAILED]: {
    description: "Failed to resolve the import to a valid module.",
    causes: [
      "Import map configuration error",
      "Network error fetching remote module",
      "Permission denied accessing file",
    ],
    fixes: [
      "Check import map configuration",
      "Verify network connectivity for remote imports",
      "Check file permissions",
    ],
  },
  [HQLErrorCode.EXPORT_NOT_FOUND]: {
    description: "The requested export was not found in the module.",
    causes: [
      "Export name is misspelled",
      "Module doesn't export the requested name",
      "Using wrong import syntax (default vs named)",
    ],
    fixes: [
      "Check the export name spelling",
      "Verify what the module actually exports",
      "Use correct import syntax for the export type",
    ],
  },

  // ============================================================================
  // Validation Errors (3000-3999)
  // ============================================================================
  [HQLErrorCode.INVALID_FUNCTION_SYNTAX]: {
    description: "The function definition has incorrect syntax.",
    causes: [
      "Missing function name or parameter list",
      "Invalid parameter syntax",
      "Missing function body",
    ],
    fixes: [
      "Use correct syntax: (fn name [params] body)",
      "Ensure parameters are in square brackets",
      "Provide a function body expression",
    ],
  },
  [HQLErrorCode.INVALID_CLASS_SYNTAX]: {
    description: "The class definition has incorrect syntax.",
    causes: [
      "Missing class name or body",
      "Invalid method definitions",
      "Incorrect inheritance syntax",
    ],
    fixes: [
      "Use correct syntax: (class Name (method ...))",
      "Ensure methods are properly defined",
      "Check extends syntax if using inheritance",
    ],
  },
  [HQLErrorCode.MISSING_REQUIRED_ARGUMENT]: {
    description: "A required function argument was not provided.",
    causes: [
      "Calling function with too few arguments",
      "Forgot to pass required parameter",
      "Argument order is incorrect",
    ],
    fixes: [
      "Provide all required arguments to the function",
      "Check the function signature for required params",
      "Verify argument order matches parameter order",
    ],
  },
  [HQLErrorCode.TOO_MANY_ARGUMENTS]: {
    description: "Too many arguments were passed to the function.",
    causes: [
      "Passing more arguments than function accepts",
      "Accidentally duplicated an argument",
      "Using wrong function (similar name)",
    ],
    fixes: [
      "Remove extra arguments",
      "Check the function signature for expected params",
      "Verify you're calling the correct function",
    ],
  },
  [HQLErrorCode.INVALID_PARAMETER]: {
    description: "A parameter definition is invalid.",
    causes: [
      "Parameter name is not a valid identifier",
      "Invalid default value syntax",
      "Rest parameter not at end of list",
    ],
    fixes: [
      "Use valid identifier for parameter name",
      "Check default value syntax",
      "Move rest parameter (&rest) to end",
    ],
  },
  [HQLErrorCode.INVALID_VARIABLE_NAME]: {
    description: "The variable name is invalid or reserved.",
    causes: [
      "Using a reserved keyword as variable name",
      "Variable name starts with invalid character",
      "Using special characters in name",
    ],
    fixes: [
      "Choose a different name that isn't reserved",
      "Start variable names with a letter or underscore",
      "Use only alphanumeric characters and underscores",
    ],
  },
  [HQLErrorCode.DUPLICATE_PARAMETER]: {
    description: "The same parameter name is used multiple times.",
    causes: [
      "Copy-paste error duplicated parameter",
      "Typo made two params look the same",
      "Refactoring left duplicate names",
    ],
    fixes: [
      "Rename one of the duplicate parameters",
      "Remove the duplicate parameter",
      "Review parameter list for uniqueness",
    ],
  },
  [HQLErrorCode.INVALID_EXPRESSION]: {
    description: "The expression is invalid in this context.",
    causes: [
      "Using statement where expression expected",
      "Invalid left-hand side of assignment",
      "Expression type not allowed here",
    ],
    fixes: [
      "Use an expression instead of a statement",
      "Ensure assignment target is a valid identifier",
      "Check what expressions are valid in this context",
    ],
  },

  // ============================================================================
  // Transform Errors (4000-4999)
  // ============================================================================
  [HQLErrorCode.TRANSFORMATION_FAILED]: {
    description: "Failed to transform the code to JavaScript.",
    causes: [
      "Internal compiler error",
      "Unsupported code construct",
      "Invalid AST structure",
    ],
    fixes: [
      "Simplify the problematic code",
      "Report this as a potential compiler bug",
      "Check for unsupported features",
    ],
  },
  [HQLErrorCode.UNSUPPORTED_FEATURE]: {
    description: "This feature is not supported in the current context.",
    causes: [
      "Using feature not yet implemented",
      "Feature not available in target environment",
      "Deprecated feature removed",
    ],
    fixes: [
      "Use an alternative approach",
      "Check documentation for supported features",
      "Update to a newer version if feature was added",
    ],
  },
  [HQLErrorCode.INVALID_AST_NODE]: {
    description: "The AST contains an invalid or unexpected node type.",
    causes: [
      "Internal compiler error",
      "Corrupted AST from plugin/macro",
      "Version mismatch",
    ],
    fixes: [
      "Report this as a potential compiler bug",
      "Check macro/plugin for AST generation issues",
      "Ensure all components are same version",
    ],
  },
  [HQLErrorCode.TRANSFORM_TYPE_MISMATCH]: {
    description: "Type mismatch during code transformation.",
    causes: [
      "Incompatible types in expression",
      "Wrong type passed to special form",
      "Type inference failure",
    ],
    fixes: [
      "Ensure types are compatible",
      "Add explicit type annotations",
      "Check documentation for expected types",
    ],
  },

  // ============================================================================
  // Runtime Errors (5000-5999)
  // ============================================================================
  [HQLErrorCode.UNDEFINED_VARIABLE]: {
    description: "A variable is used but has not been defined.",
    causes: [
      "Variable name is misspelled",
      "Variable not in scope",
      "Variable used before declaration",
    ],
    fixes: [
      "Check spelling of variable name",
      "Ensure variable is defined before use",
      "Check variable scope (let vs const)",
    ],
  },
  [HQLErrorCode.TYPE_MISMATCH]: {
    description: "Operation received wrong type of value.",
    causes: [
      "Passing string where number expected",
      "Using wrong type in arithmetic",
      "Incompatible types in comparison",
    ],
    fixes: [
      "Convert value to correct type",
      "Check function documentation for expected types",
      "Use type checking before operation",
    ],
  },
  [HQLErrorCode.DIVISION_BY_ZERO]: {
    description: "Attempted to divide by zero.",
    causes: [
      "Divisor is zero or evaluates to zero",
      "Variable that should be non-zero is zero",
      "Missing check for zero divisor",
    ],
    fixes: [
      "Add check for zero before dividing",
      "Ensure divisor cannot be zero",
      "Handle the zero case explicitly",
    ],
  },
  [HQLErrorCode.NULL_REFERENCE]: {
    description: "Attempted to access property of null or undefined.",
    causes: [
      "Variable is null or undefined",
      "Function returned null unexpectedly",
      "Optional value not checked",
    ],
    fixes: [
      "Add null/undefined check before access",
      "Use optional chaining (?.) for safe access",
      "Ensure value is initialized before use",
    ],
  },
  [HQLErrorCode.FUNCTION_NOT_FOUND]: {
    description: "Attempted to call something that is not a function.",
    causes: [
      "Variable is not a function",
      "Function name is misspelled",
      "Calling a property instead of method",
    ],
    fixes: [
      "Verify the value is actually a function",
      "Check spelling of function name",
      "Use correct method call syntax",
    ],
  },

  // ============================================================================
  // Code Generation Errors (6000-6999)
  // ============================================================================
  [HQLErrorCode.CODEGEN_FAILED]: {
    description: "Failed to generate JavaScript code.",
    causes: [
      "Internal compiler error",
      "Unsupported expression type",
      "Invalid AST structure",
    ],
    fixes: [
      "Report this as a potential compiler bug",
      "Simplify the problematic expression",
      "Check for unsupported features",
    ],
  },
  [HQLErrorCode.INVALID_CODEGEN_TARGET]: {
    description: "Invalid target for code generation.",
    causes: [
      "Unsupported output format",
      "Invalid configuration option",
      "Target environment not supported",
    ],
    fixes: [
      "Use a supported target format",
      "Check configuration options",
      "Verify target environment is valid",
    ],
  },
  [HQLErrorCode.SOURCEMAP_GENERATION_FAILED]: {
    description: "Failed to generate source map.",
    causes: [
      "File path issues",
      "Memory constraints",
      "Internal error",
    ],
    fixes: [
      "Check file paths are valid",
      "Try with smaller files",
      "Report if issue persists",
    ],
  },

  // ============================================================================
  // Macro Errors (7000-7999)
  // ============================================================================
  [HQLErrorCode.INVALID_MACRO_DEFINITION]: {
    description: "The macro definition is invalid.",
    causes: [
      "Missing macro name or body",
      "Invalid parameter syntax",
      "Reserved name used",
    ],
    fixes: [
      "Use correct syntax: (macro name [params] body)",
      "Ensure parameters use valid syntax",
      "Choose non-reserved name for macro",
    ],
  },
  [HQLErrorCode.MACRO_EXPANSION_FAILED]: {
    description: "Macro expansion failed during compilation.",
    causes: [
      "Error in macro body execution",
      "Invalid arguments passed to macro",
      "Macro produced invalid code",
    ],
    fixes: [
      "Check macro implementation for errors",
      "Verify arguments match macro signature",
      "Ensure macro produces valid HQL code",
    ],
  },
  [HQLErrorCode.INVALID_MACRO_SYNTAX]: {
    description: "Invalid syntax in macro usage or definition.",
    causes: [
      "Wrong number of arguments",
      "Invalid quoting/unquoting",
      "Syntax quote issues",
    ],
    fixes: [
      "Check macro documentation for correct usage",
      "Verify quoting syntax is correct",
      "Match argument count to definition",
    ],
  },
  [HQLErrorCode.MACRO_NOT_FOUND]: {
    description: "The macro is not defined.",
    causes: [
      "Macro name is misspelled",
      "Macro not imported",
      "Macro defined after use",
    ],
    fixes: [
      "Check spelling of macro name",
      "Import the macro from its module",
      "Define macro before using it",
    ],
  },
  [HQLErrorCode.MACRO_RECURSION_LIMIT]: {
    description: "Macro expansion exceeded recursion limit.",
    causes: [
      "Macro calls itself infinitely",
      "Mutual recursion between macros",
      "Missing termination condition",
    ],
    fixes: [
      "Add base case to stop recursion",
      "Check for unintended recursive calls",
      "Simplify macro to avoid deep nesting",
    ],
  },
};

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
 * @returns URL to error documentation
 *
 * @example
 * getErrorDocUrl(HQLErrorCode.UNCLOSED_LIST)
 * // "https://hql-lang.dev/errors/HQL1001"
 */
export function getErrorDocUrl(code: HQLErrorCode): string {
  return `${ERROR_DOC_BASE_URL}/HQL${code}`;
}

/**
 * Get detailed error information for an error code
 *
 * @param code - The error code enum value
 * @returns Detailed error information including description, causes, and fixes
 */
export function getErrorInfo(code: HQLErrorCode): ErrorInfo {
  return ERROR_INFO[code];
}

/**
 * Get error description for an error code
 *
 * @param code - The error code enum value
 * @returns Short description of the error
 */
export function getErrorDescription(code: HQLErrorCode): string {
  return ERROR_INFO[code]?.description ?? "An error occurred.";
}

/**
 * Get common causes for an error code
 *
 * @param code - The error code enum value
 * @returns Array of common causes
 */
export function getErrorCauses(code: HQLErrorCode): string[] {
  return ERROR_INFO[code]?.causes ?? [];
}

/**
 * Get fixes for an error code
 *
 * @param code - The error code enum value
 * @returns Array of potential fixes
 */
export function getErrorFixes(code: HQLErrorCode): string[] {
  return ERROR_INFO[code]?.fixes ?? [];
}
