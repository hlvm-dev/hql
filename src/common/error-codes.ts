/**
 * Standardized Error Codes for HQL and runtime-platform integration.
 *
 * Error codes follow domain-aware prefixes:
 * - HQL<category><number>: HQL language and compiler/runtime errors
 * - HLVM<category><number>: HLVM host transport/protocol errors
 * - PRV<category><number>: Provider/API integration errors
 *
 * HQL language errors keep the historical category ranges:
 * - 1000-1999: Parse errors
 * - 2000-2999: Import errors
 * - 3000-3999: Validation errors
 * - 4000-4999: Transform errors
 * - 5000-5999: Runtime errors
 * - 6000-6999: Code generation errors
 * - 7000-7999: Macro errors
 *
 * Non-HQL domains use dedicated non-overlapping spaces:
 * - HLVM5006-5099: HLVM runtime host transport/protocol errors
 * - PRV9001-9099: External provider/API integration errors
 *
 * This enables:
 * - Searchable error codes in documentation
 * - Consistent error categorization
 * - Easy filtering in logs
 * - Links to detailed error explanations
 */

/**
 * Symbol used to mark errors as reported to prevent double-reporting.
 * Shared across error handling modules.
 */
export const ERROR_REPORTED_SYMBOL = Symbol.for("__hql_error_reported__");

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

export enum HLVMErrorCode {
  /** Runtime host request or lifecycle failure */
  REQUEST_FAILED = 5006,
  /** Runtime host request was rejected by the local host */
  REQUEST_REJECTED = 5007,
  /** Runtime host payload is too large for a request */
  REQUEST_TOO_LARGE = 5008,
  /** Runtime host transport/network error */
  TRANSPORT_ERROR = 5009,
  /** Runtime host stream read or parser error */
  STREAM_ERROR = 5010,
  /** Local AI engine startup or validation failure */
  AI_ENGINE_STARTUP_FAILED = 5011,
  /** Bootstrap materialization (engine + model) failed */
  BOOTSTRAP_FAILED = 5020,
  /** Fallback model pull during bootstrap failed */
  BOOTSTRAP_MODEL_PULL_FAILED = 5021,
  /** Bootstrap verification found missing or corrupt assets */
  BOOTSTRAP_VERIFICATION_FAILED = 5022,
  /** Bootstrap recovery could not repair degraded state */
  BOOTSTRAP_RECOVERY_FAILED = 5023,
  /** Bootstrap manifest file is missing or unparseable */
  BOOTSTRAP_MANIFEST_CORRUPT = 5024,
}

export enum ProviderErrorCode {
  /** Provider returned a generic request failure */
  REQUEST_FAILED = 9001,
  /** Provider rejected the request payload or capabilities */
  REQUEST_REJECTED = 9002,
  /** Provider rejected due to payload size */
  REQUEST_TOO_LARGE = 9003,
  /** Provider rejected due to authentication/authorization */
  AUTH_FAILED = 9004,
  /** Provider reported rate limiting */
  RATE_LIMITED = 9005,
  /** Provider is unavailable or returning 5xx errors */
  SERVICE_UNAVAILABLE = 9006,
  /** Transport or DNS/network failure during provider request */
  NETWORK_ERROR = 9007,
  /** Provider request timed out */
  REQUEST_TIMEOUT = 9008,
  /** Provider stream or protocol-level parse failure */
  STREAM_ERROR = 9009,
}

type ErrorCodeByDomain = HQLErrorCode | HLVMErrorCode | ProviderErrorCode;
export type UnifiedErrorCode = ErrorCodeByDomain;

const HQLErrorCodeSet = new Set(
  (Object.values(HQLErrorCode) as number[]).filter((value) =>
    Number.isInteger(value),
  ),
);
const HLVMErrorCodeSet = new Set(
  (Object.values(HLVMErrorCode) as number[]).filter((value) =>
    Number.isInteger(value),
  ),
);
const ProviderErrorCodeSet = new Set(
  (Object.values(ProviderErrorCode) as number[]).filter((value) =>
    Number.isInteger(value),
  ),
);

const ERROR_CODE_PREFIX_REGEX = /^\[(HQL|HLVM|PRV)(\d{4})\]\s*/;

/** Returns whether the code belongs to the HQL code domain. */
export function isHQLErrorCode(code: UnifiedErrorCode): code is HQLErrorCode {
  return HQLErrorCodeSet.has(code);
}

/** Returns whether the code belongs to the HLVM code domain. */
export function isHLVMErrorCode(code: UnifiedErrorCode): code is HLVMErrorCode {
  return HLVMErrorCodeSet.has(code);
}

/** Returns whether the code belongs to the provider code domain. */
export function isProviderErrorCode(
  code: UnifiedErrorCode,
): code is ProviderErrorCode {
  return ProviderErrorCodeSet.has(code);
}

/** Parses a structured error code prefix from an error message. */
export function parseErrorCodeFromMessage(
  message: string,
): UnifiedErrorCode | null {
  const match = message.match(ERROR_CODE_PREFIX_REGEX);
  if (!match) return null;
  const rawCode = Number(match[2]);
  if (Number.isNaN(rawCode)) return null;
  if (match[1] === "HQL" && isHQLErrorCode(rawCode as UnifiedErrorCode)) {
    return rawCode as HQLErrorCode;
  }
  if (match[1] === "HLVM" && isHLVMErrorCode(rawCode as UnifiedErrorCode)) {
    return rawCode as HLVMErrorCode;
  }
  if (match[1] === "PRV" && isProviderErrorCode(rawCode as UnifiedErrorCode)) {
    return rawCode as ProviderErrorCode;
  }
  return null;
}

/** Removes leading error-code prefix for readable messages. */
export function stripErrorCodeFromMessage(message: string): string {
  return message.replace(ERROR_CODE_PREFIX_REGEX, "");
}

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
      'Escape internal quotes with backslash: \\"',
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
      'Use correct syntax: (import [name] from "path")',
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

const HLVM_ERROR_INFO: Record<HLVMErrorCode, ErrorInfo> = {
  [HLVMErrorCode.REQUEST_FAILED]: {
    description: "A request to the local HLVM runtime host failed.",
    causes: [
      "Runtime host returned an error response",
      "Runtime host build did not match the current client",
      "Runtime host could not start, stop, or stream a response",
    ],
    fixes: [
      "Restart HLVM so the client and runtime host use the same build",
      "Check provider or model availability if the host rejected the request",
      "Retry after the local runtime host finishes initializing",
    ],
  },
  [HLVMErrorCode.REQUEST_REJECTED]: {
    description:
      "The local HLVM runtime host rejected the request before streaming a response.",
    causes: [
      "Invalid request payload or missing required fields",
      "Model does not support requested capability (tools, attachments, etc.)",
      "Provider is not available or lacks approval for the selected model",
    ],
    fixes: [
      "Review the request body and required parameters for /api/chat requests",
      "Retry with a supported model for the requested operation",
      "If approval is required, authorize the provider first",
    ],
  },
  [HLVMErrorCode.REQUEST_TOO_LARGE]: {
    description:
      "The local HLVM runtime host rejected a request payload that exceeded limits.",
    causes: [
      "Request body exceeded the local runtime host JSON body limit",
      "Inlined images or large prompt content inflated the payload",
      "Very large `content` or attachment metadata in one request",
    ],
    fixes: [
      "Reduce prompt size or split context into smaller turns",
      "Avoid attaching very large images in the same request",
      "Use a model/provider path that accepts smaller per-turn payloads",
    ],
  },
  [HLVMErrorCode.TRANSPORT_ERROR]: {
    description:
      "The local HLVM runtime request failed before a structured response was returned.",
    causes: [
      "Local host process was unavailable or unreachable",
      "Connection-level failure while opening or reading the HTTP session",
      "Transient network or runtime startup problem",
    ],
    fixes: [
      "Verify the local HLVM host is running on the expected port",
      "Retry if the host was restarting or temporarily unavailable",
      "Check runtime logs for repeated startup failures",
    ],
  },
  [HLVMErrorCode.STREAM_ERROR]: {
    description:
      "The streaming response from the local HLVM runtime host was malformed or could not be parsed.",
    causes: [
      "Host returned non-NDJSON event data",
      "Corrupted JSON in a stream event",
      "Unexpected stream protocol output from a handler bug",
    ],
    fixes: [
      "Retry the request to confirm whether the issue is transient",
      "Collect host logs for the failing request and event stream",
      "Report if malformed stream responses recur",
    ],
  },
  [HLVMErrorCode.AI_ENGINE_STARTUP_FAILED]: {
    description:
      "The local AI engine could not be validated or did not become ready after startup.",
    causes: [
      "Cached embedded engine binary is invalid or from the wrong program",
      "Embedded AI engine resource is missing or corrupted",
      "The HLVM-owned local AI endpoint was unavailable or failed to become reachable on 127.0.0.1:11439",
    ],
    fixes: [
      "Remove the cached embedded engine so HLVM can extract a fresh copy",
      "Verify the embedded AI engine resource or rebuild HLVM with a valid Ollama binary",
      "Check whether the embedded Ollama runtime can start and respond on 127.0.0.1:11439",
    ],
  },
  [HLVMErrorCode.BOOTSTRAP_FAILED]: {
    description: "Bootstrap materialization (engine extraction + model pull) failed.",
    causes: [
      "Embedded AI engine resource is missing or corrupted in the binary",
      "Disk space insufficient for model download",
      "Network unavailable during model pull",
    ],
    fixes: [
      "Run `hlvm bootstrap --repair` to retry",
      "Ensure sufficient disk space (~5 GB for the fallback model)",
      "Check network connectivity and retry",
    ],
  },
  [HLVMErrorCode.BOOTSTRAP_MODEL_PULL_FAILED]: {
    description: "The fallback model could not be pulled during bootstrap.",
    causes: [
      "AI engine not running or not reachable on 127.0.0.1:11439",
      "Model name is invalid or unavailable in the Ollama registry",
      "Download interrupted or disk full",
    ],
    fixes: [
      "Verify the AI engine is running: `hlvm bootstrap --status`",
      "Check network connectivity and disk space",
      "Run `hlvm bootstrap --repair` to retry the model pull",
    ],
  },
  [HLVMErrorCode.BOOTSTRAP_VERIFICATION_FAILED]: {
    description: "Bootstrap verification found missing or corrupt assets.",
    causes: [
      "Engine binary was deleted or overwritten",
      "Model files were removed from the HLVM model store",
      "Manifest hashes no longer match the files on disk",
    ],
    fixes: [
      "Run `hlvm bootstrap --repair` to restore missing assets",
      "Run `hlvm bootstrap` for a full re-materialization",
    ],
  },
  [HLVMErrorCode.BOOTSTRAP_RECOVERY_FAILED]: {
    description: "Bootstrap recovery could not repair the degraded state.",
    causes: [
      "Embedded engine resource is missing from the binary",
      "Repeated model pull failures",
      "File system permissions prevent writing to ~/.hlvm/.runtime/",
    ],
    fixes: [
      "Check file permissions on ~/.hlvm/.runtime/",
      "Rebuild HLVM with an embedded AI engine and reinstall",
      "Run `hlvm bootstrap` manually with verbose logging",
    ],
  },
  [HLVMErrorCode.BOOTSTRAP_MANIFEST_CORRUPT]: {
    description: "The bootstrap manifest file is missing or unparseable.",
    causes: [
      "manifest.json was manually edited or deleted",
      "Disk corruption or incomplete write",
    ],
    fixes: [
      "Run `hlvm bootstrap` to create a fresh manifest",
      "Run `hlvm bootstrap --repair` to regenerate from existing assets",
    ],
  },
};

const PROVIDER_ERROR_INFO: Record<ProviderErrorCode, ErrorInfo> = {
  [ProviderErrorCode.REQUEST_FAILED]: {
    description: "Provider request failed before a response was successfully produced.",
    causes: [
      "Provider endpoint returned an unexpected error",
      "Network-level interruption in the provider call",
      "Transient provider outage",
    ],
    fixes: [
      "Retry the request after a short delay",
      "Check provider status before retrying",
      "Switch to an alternate provider if available",
    ],
  },
  [ProviderErrorCode.REQUEST_REJECTED]: {
    description:
      "Provider rejected the request payload, capability, or runtime context.",
    causes: [
      "Payload format is invalid for the selected provider model",
      "Required capability (tools, files, vision) is not supported",
      "Model is not available in the current provider region or tier",
    ],
    fixes: [
      "Validate prompt, attachments, and tool usage against provider limits",
      "Retry with a supported model or lower-complexity request",
      "Upgrade the provider account or select supported features",
    ],
  },
  [ProviderErrorCode.REQUEST_TOO_LARGE]: {
    description:
      "Provider rejected the request because payload size exceeded limits.",
    causes: [
      "Prompt or attachment metadata exceeded provider limits",
      "Image/text payload too large for request",
      "Exceeded rate limits with large batch or context size",
    ],
    fixes: [
      "Reduce prompt size before sending",
      "Split large attachments across separate turns",
      "Compress or shrink attached binary content",
    ],
  },
  [ProviderErrorCode.AUTH_FAILED]: {
    description:
      "Provider authentication or authorization failed for the request.",
    causes: [
      "Missing or invalid API key",
      "OAuth token expired or revoked",
      "Account lacks required model access",
    ],
    fixes: [
      "Verify API key / token configuration",
      "Re-authenticate with the provider",
      "Check provider billing and model access permissions",
    ],
  },
  [ProviderErrorCode.RATE_LIMITED]: {
    description: "Provider returned a rate limit or quota error.",
    causes: [
      "Requests exceeded provider rate limit",
      "Quota is exhausted for the current billing period",
      "Burst traffic exceeded request cap",
    ],
    fixes: [
      "Retry after the provider's rate-limit window",
      "Reduce request volume",
      "Add backoff and request deduplication in retry logic",
    ],
  },
  [ProviderErrorCode.SERVICE_UNAVAILABLE]: {
    description: "Provider endpoint is temporarily unavailable.",
    causes: [
      "Provider returned 5xx",
      "Maintenance or regional instability",
      "Temporary internal error",
    ],
    fixes: [
      "Retry with exponential backoff",
      "Check provider status page",
      "Switch to another model/provider for continuity",
    ],
  },
  [ProviderErrorCode.NETWORK_ERROR]: {
    description: "Provider call failed due to network transport issues.",
    causes: [
      "DNS/connection failure",
      "TLS or proxy network interruption",
      "Firewall blocked outbound provider traffic",
    ],
    fixes: [
      "Retry from a stable network",
      "Check proxy/firewall configuration",
      "Try again after a short delay",
    ],
  },
  [ProviderErrorCode.REQUEST_TIMEOUT]: {
    description: "Provider request timed out before completion.",
    causes: [
      "Provider latency spike",
      "Large payload/model inference time",
      "Network timeout threshold too low",
    ],
    fixes: [
      "Retry with a larger timeout if configured",
      "Split work into smaller requests",
      "Use shorter prompts or smaller context windows",
    ],
  },
  [ProviderErrorCode.STREAM_ERROR]: {
    description: "Provider stream or protocol output could not be parsed.",
    causes: [
      "Unexpected streaming payload format",
      "Provider SDK protocol mismatch",
      "Interrupted stream connection",
    ],
    fixes: [
      "Retry the request",
      "Switch to non-streaming mode if supported",
      "Report if stream errors continue for the same provider/model",
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
 * formatErrorCode(HLVMErrorCode.REQUEST_REJECTED) // "HLVM5007"
 * formatErrorCode(ProviderErrorCode.AUTH_FAILED) // "PRV9004"
 */
export function formatErrorCode(code: UnifiedErrorCode): string {
  if (isHQLErrorCode(code)) {
    return `HQL${code}`;
  }
  if (isHLVMErrorCode(code)) {
    return `HLVM${code}`;
  }
  if (isProviderErrorCode(code)) {
    return `PRV${code}`;
  }
  return `UNK${code}`;
}

/**
 * Get fixes for an error code
 *
 * @param code - The error code enum value
 * @returns Array of potential fixes
 */
export function getErrorFixes(code: UnifiedErrorCode): string[] {
  if (isHQLErrorCode(code)) return ERROR_INFO[code]?.fixes ?? [];
  if (isHLVMErrorCode(code)) return HLVM_ERROR_INFO[code]?.fixes ?? [];
  if (isProviderErrorCode(code)) return PROVIDER_ERROR_INFO[code]?.fixes ?? [];
  return [];
}
