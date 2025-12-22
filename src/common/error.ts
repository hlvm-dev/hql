/*
 * error.ts
 *
 * A unified error handling pipeline for HQL that provides:
 * 1. Standardized error collection, processing, and reporting
 * 2. Error messages with file path, line, and column information
 * 3. Separation of core error info and debug details
 * 4. Support for specialized error types (Parse, Import, Validation, etc.)
 * 5. Source map support for accurate error reporting in HQL code
 *
 * All logic from error-handler.ts has been merged into error.ts. See below for details.
 */

import { globalLogger as logger, Logger } from "../logger.ts";
import { basename } from "../platform/platform.ts";
import {
  formatErrorCode,
  getErrorDocUrl,
  getErrorFixes,
  HQLErrorCode,
} from "./error-codes.ts";
import { ERROR_REPORTED_SYMBOL } from "./error-constants.ts";
import { isObjectValue } from "./utils.ts";
import { readTextFile as platformReadTextFile } from "../platform/platform.ts";
import { extractContextLinesFromSource } from "./context-helpers.ts";

// -----------------------------------------------------------------------------
// Color utilities
// -----------------------------------------------------------------------------

function createColorConfig() {
  return {
    purple: (s: string) => `\x1b[35m${s}\x1b[0m`,
    red: (s: string) => `\x1b[31m${s}\x1b[0m`,
    black: (s: string) => `\x1b[30m${s}\x1b[0m`,
    gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
    bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
    white: (s: string) => `\x1b[37m${s}\x1b[0m`,
    cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  };
}

// -----------------------------------------------------------------------------
// Simple helpers
// -----------------------------------------------------------------------------

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isObjectValue(error)) return JSON.stringify(error);
  return String(error);
}

/**
 * Extract an existing HQL error code from a message string.
 * Returns the error code if found, or null if not present.
 *
 * Matches patterns like: [HQL1001], [HQL3008], etc.
 */
function extractExistingErrorCode(msg: string): HQLErrorCode | null {
  const match = msg.match(/\[HQL(\d{4})\]/);
  if (match && match[1]) {
    const code = parseInt(match[1], 10);
    // Validate that the code is in a valid range (1000-7999)
    if (code >= 1000 && code <= 7999) {
      return code as HQLErrorCode;
    }
  }
  return null;
}

/**
 * Strip existing HQL error code prefix from a message.
 * Returns the message without the [HQLxxxx] prefix.
 */
function stripErrorCodeFromMessage(msg: string): string {
  return msg.replace(/^\[HQL\d{4}\]\s*/, "");
}

/**
 * Enhance error message with error code and location
 *
 * Extracted helper to eliminate duplication across all error constructors
 *
 * @param msg - Base error message
 * @param errorCode - HQL error code
 * @param opts - Location information
 * @returns Enhanced message with code and location
 */
function enhanceErrorMessage(
  msg: string,
  errorCode: HQLErrorCode,
  opts: { filePath?: string; line?: number; column?: number },
): string {
  const codeStr = formatErrorCode(errorCode);

  // Don't add duplicate error codes - strip any existing ones first
  const cleanMsg = stripErrorCodeFromMessage(msg);
  let enhancedMsg = `[${codeStr}] ${cleanMsg}`;

  if (opts.filePath && opts.line && opts.column) {
    enhancedMsg += ` at ${opts.filePath}:${opts.line}:${opts.column}`;
  } else if (opts.line && opts.column) {
    enhancedMsg += ` at line ${opts.line}:${opts.column}`;
  }

  return enhancedMsg;
}

/**
 * Format context lines with line numbers, highlighting, and column pointers
 *
 * Extracted helper to eliminate duplication in formatHQLError()
 * Used for both pre-loaded contextLines and dynamically loaded file content
 */
function formatContextLines(
  contextLines: Array<
    { line: number; content: string; isError: boolean; column?: number }
  >,
  colors: ReturnType<typeof createColorConfig>,
  errorMessage: string,
): string[] {
  const output: string[] = [];

  if (contextLines.length === 0) {
    return output;
  }

  // Calculate line number padding
  const maxLineNumber = Math.max(...contextLines.map((item) => item.line));
  const lineNumPadding = String(maxLineNumber).length;

  // Deduplicate lines (prefer error lines if duplicates exist)
  const lineMap = new Map<
    number,
    { content: string; isError: boolean; column?: number }
  >();
  contextLines.forEach(({ line, content, isError, column }) => {
    if (!lineMap.has(line)) {
      lineMap.set(line, { content, isError, column });
    } else if (isError) {
      // If duplicate, prefer error line
      lineMap.set(line, { content, isError, column });
    }
  });

  // Find error line number for highlighting
  const errorLineObj = contextLines.find(({ isError }) => isError);
  const errorLineNo = errorLineObj ? errorLineObj.line : -1;

  // Format each line
  for (
    const [lineNo, { content: text, isError, column }] of Array.from(
      lineMap.entries(),
    ).sort((a, b) => a[0] - b[0])
  ) {
    const lineNumStr = String(lineNo).padStart(lineNumPadding, " ");

    if (isError || lineNo === errorLineNo) {
      // Error line - highlight in purple
      output.push(` ${colors.purple(lineNumStr)} │ ${text}`);

      // Add column pointer if available
      if (column && column > 0) {
        // Calculate effective column accounting for tabs
        // Tabs display as 4 spaces but occupy 1 char, so add (TAB_WIDTH - 1) extra per tab
        const TAB_WIDTH = 4;
        let effectiveColumn = column;
        const textBefore = text.substring(0, column - 1);
        const tabCount = (textBefore.match(/\t/g) || []).length;
        effectiveColumn += tabCount * (TAB_WIDTH - 1);

        // Create arrow pointer
        const pointer = " ".repeat(lineNumPadding + 3) +
          " ".repeat(effectiveColumn - 1) + colors.red(colors.bold("^"));
        output.push(pointer);

        // Special indicators for function call errors
        const isTooManyArgs = errorMessage.includes("Too many") &&
          errorMessage.includes("arguments");
        const isMissingArg = errorMessage.includes("Missing required") &&
          errorMessage.includes("parameter");

        if (isTooManyArgs || isMissingArg) {
          const errorIndicator = " ".repeat(lineNumPadding + 3) +
            " ".repeat(effectiveColumn - 1) + colors.red(colors.bold("⬆"));
          const errorText = isTooManyArgs
            ? colors.red("Extra argument")
            : colors.red("Missing required argument");
          output.push(`${errorIndicator} ${errorText}`);
        }
      }
    } else {
      // Context line - gray
      output.push(` ${colors.gray(lineNumStr)} │ ${colors.gray(text)}`);
    }
  }

  return output;
}

// Enhancements to formatHQLError function in core/src/common/error.ts

/**
 * Format HQL error with proper error message display
 * Improved with better context handling and more accurate error pointers
 * Enhanced for function call errors
 */
export async function formatHQLError(
  error: HQLError,
  isDebug = false,
): Promise<string> {
  const colors = createColorConfig();
  const output: string[] = [];

  // ALWAYS show the error message at the top - not just in debug mode
  const errorType = error.errorType || "Error";
  let message = error.message || "An unknown error occurred";

  // Clean up the message by removing redundant file:line:column references
  // that we'll show in a better format anyway
  message = message.replace(/\s+at\s+\S+:\d+:\d+$/, "");
  message = message.replace(/\s+\(\S+:\d+:\d+\)$/, "");

  // Remove error code from message if it's already at the start (we'll display it separately)
  message = message.replace(/^\[HQL\d+\]\s*/, "");

  // Enhance messages for common function call errors
  if (message.includes("Too many") && message.includes("arguments")) {
    // Already enhanced in the improved error handling
  } else if (
    message.includes("Missing required") && message.includes("parameter")
  ) {
    // Already enhanced in the improved error handling
  }

  // Format error type with code if available
  const errorHeader = error.code
    ? `${
      colors.red(colors.bold(`error[${formatErrorCode(error.code)}]:`))
    } ${message}`
    : `${colors.red(colors.bold(`${errorType}:`))} ${message}`;

  output.push(errorHeader);

  // Display code context with line numbers and column pointer if available
  if (error.contextLines?.length > 0) {
    // Add empty line before context
    output.push("");

    // Use helper to format context lines (eliminates 50 lines of duplication!)
    const formattedLines = formatContextLines(
      error.contextLines,
      colors,
      error.message,
    );
    output.push(...formattedLines);
  } // Try to load context lines if they don't exist but we have source location
  else if (error.sourceLocation?.filePath && error.sourceLocation.line) {
    try {
      const filepath = error.sourceLocation.filePath;
      const line = error.sourceLocation.line;
      const column = error.sourceLocation.column || 1;

      // Add empty line before context
      output.push("");

      // Read file and extract context lines
      const fileContent = await platformReadTextFile(filepath);
      const fileLines = fileContent.split(/\r?\n/);
      const errorIdx = line - 1;

      // Make sure we're in bounds
      if (errorIdx >= 0 && errorIdx < fileLines.length) {
        // Build context lines array
        const contextLines: Array<
          { line: number; content: string; isError: boolean; column?: number }
        > = [];

        // Add context before error (2 lines)
        for (let i = Math.max(0, errorIdx - 2); i < errorIdx; i++) {
          contextLines.push({
            line: i + 1,
            content: fileLines[i],
            isError: false,
          });
        }

        // Add error line with column pointer
        contextLines.push({
          line: line,
          content: fileLines[errorIdx],
          isError: true,
          column: column > 0 ? column : undefined,
        });

        // Add context after error (2 lines)
        for (
          let i = errorIdx + 1;
          i <= Math.min(fileLines.length - 1, errorIdx + 2);
          i++
        ) {
          contextLines.push({
            line: i + 1,
            content: fileLines[i],
            isError: false,
          });
        }

        // Use helper to format (eliminates 50+ lines of duplication!)
        const formattedLines = formatContextLines(
          contextLines,
          colors,
          error.message,
        );
        output.push(...formattedLines);
      } else {
        // Line number is out of bounds
        output.push(
          `${
            colors.gray(
              `Line ${line} is outside the range of file (${fileLines.length} lines)`,
            )
          }`,
        );
      }
    } catch (_readError) {
      // If file can't be read, add a note about the location without context
      output.push("");
      output.push(
        `${
          colors.gray(
            `Could not read source file: ${error.sourceLocation.filePath}`,
          )
        }`,
      );
    }
  }

  // Add empty line before location info
  output.push("");

  // Add IDE-friendly location info with "Where:" prefix
  if (error.sourceLocation?.filePath) {
    const filepath = error.sourceLocation.filePath;
    const line = error.sourceLocation.line || 1;
    const column = error.sourceLocation.column || 1;
    const whereStr = `${filepath}:${line}:${column}`;
    output.push(
      `${colors.purple(colors.bold("Where:"))} ${colors.white(whereStr)}`,
    );
  }

  // Add suggestion if available
  if (error.getSuggestion && typeof error.getSuggestion === "function") {
    const suggestion = error.getSuggestion();
    if (suggestion) {
      output.push(`${colors.cyan(`Suggestion: ${suggestion}`)}`);
    }
  }

  // Add help URL if available
  const helpUrl = error.getHelpUrl?.();
  if (helpUrl) {
    output.push("");
    output.push(
      `${colors.gray("For more information, see:")} ${colors.cyan(helpUrl)}`,
    );
  }

  // Add stack trace only in debug mode
  if (isDebug && error.originalError?.stack) {
    output.push("");
    output.push(colors.gray("Stack trace:"));
    output.push(colors.gray(error.originalError.stack));
  }

  return output.join("\n");
}

// -----------------------------------------------------------------------------
// Simple wrappers (flattened – no special logging)
// -----------------------------------------------------------------------------

export function wrapError(
  _context: string,
  error: unknown,
  _resource: string,
  _currentFile?: string,
): never {
  // Simply rethrow for now – customization can be added later.
  throw error;
}

export function perform<T>(
  fn: () => T,
  _context?: string,
  _ErrorCtor?: unknown,
  _info?: unknown,
): T {
  return fn();
}
// -----------------------------------------------------------------------------
// Error base + enums
// -----------------------------------------------------------------------------

enum ErrorType {
  GENERIC = "Error",
  PARSE = "Parse Error",
  IMPORT = "Import Error",
  VALIDATION = "Validation Error",
  MACRO = "Macro Error",
  TRANSFORM = "Transform Error",
  RUNTIME = "Runtime Error",
  CODEGEN = "Code Generation Error",
  TRANSPILER = "Transpiler Error",
}

export class HQLError extends Error {
  readonly errorType: string;
  code?: HQLErrorCode; // Not readonly - child classes need to set this
  sourceLocation: SourceLocationInfo;
  readonly originalError?: Error;
  contextLines: {
    line: number;
    content: string;
    isError: boolean;
    column?: number;
  }[] = [];
  filename?: string;
  metadata: Record<string, unknown> = {};

  constructor(
    msg: string,
    opts: {
      errorType?: string | ErrorType;
      sourceLocation?: SourceLocation;
      originalError?: Error;
    } = {},
  ) {
    super(msg);

    this.errorType = typeof opts.errorType === "string"
      ? opts.errorType
      : opts.errorType ?? ErrorType.GENERIC;
    this.originalError = opts.originalError;

    let loc: SourceLocationInfo | undefined;
    if (opts.sourceLocation) {
      loc = opts.sourceLocation instanceof SourceLocationInfo
        ? opts.sourceLocation
        : new SourceLocationInfo(opts.sourceLocation);
    } else if (opts.originalError) {
      loc = SourceLocationInfo.fromError(opts.originalError);
    } else loc = SourceLocationInfo.fromError(this);

    this.sourceLocation = loc ?? new SourceLocationInfo();
    this.filename = this.sourceLocation.filePath;

    if (this.sourceLocation.line || this.sourceLocation.filePath) {
      this.extractSourceAndContext();
    }

    if (!opts.originalError && Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  getSummary(): string {
    const { filePath, line, column } = this.sourceLocation;
    const loc = filePath
      ? `${basename(filePath)}${
        line ? `:${line}${column ? `:${column}` : ""}` : ""
      }`
      : "";
    return loc
      ? `${this.errorType}: ${this.message} (${loc})`
      : `${this.errorType}: ${this.message}`;
  }

  getSuggestion(): string {
    // If we have an error code, try to get fixes from the error info system
    if (this.code) {
      const fixes = getErrorFixes(this.code);
      if (fixes && fixes.length > 0) {
        // Return the first (most common) fix as the suggestion
        return fixes[0];
      }
    }

    // Fallback based on error type
    const errorTypeHints: Record<string, string> = {
      "Parse Error": "Check the syntax near this location. Look for missing or extra parentheses, brackets, or quotes.",
      "Import Error": "Check that the file path is correct and the module exists.",
      "Validation Error": "Check that the expression follows HQL syntax rules.",
      "Transform Error": "The code structure might not be supported. Try simplifying the expression.",
      "Runtime Error": "Check variable names, types, and ensure values are properly initialized.",
      "Codegen Error": "This might be an internal compiler issue. Try simplifying the code.",
      "Macro Error": "Check the macro definition and ensure arguments match the expected pattern.",
    };

    return errorTypeHints[this.errorType] || "Check the code near this location for errors.";
  }

  /**
   * Get documentation URL for this error
   */
  getHelpUrl(): string | null {
    if (this.code) {
      return getErrorDocUrl(this.code);
    }
    return null;
  }

  isCircularDependencyError(): boolean {
    const msg = this.message.toLowerCase();
    return msg.includes("circular") &&
      (msg.includes("dependency") || msg.includes("reference") ||
        msg.includes("import"));
  }

  extractSourceAndContext(): void {
    if (this.contextLines.length) return;
    const src = this.sourceLocation.loadSource();
    if (src && this.sourceLocation.line) {
      this.contextLines = this.sourceLocation.extractContextLines();
    }
  }
}

// -----------------------------------------------------------------------------
// Error classes
// -----------------------------------------------------------------------------

export class ParseError extends HQLError {
  constructor(
    msg: string,
    opts: {
      line: number;
      column: number;
      offset?: number;
      filePath?: string;
      source?: string;
      originalError?: Error;
      code?: HQLErrorCode; // Optional for backward compatibility
    },
  ) {
    // Use provided code or infer from message
    const errorCode = opts.code || inferParseErrorCode(msg);

    // Enhance message with error code and location (using helper)
    const enhancedMsg = enhanceErrorMessage(msg, errorCode, opts);

    super(enhancedMsg, {
      errorType: ErrorType.PARSE,
      sourceLocation: opts,
      originalError: opts.originalError,
    });

    this.code = errorCode;
  }

  override getSuggestion(): string {
    const m = this.message.toLowerCase();
    // More specific checks first
    if (m.includes("unclosed string") || m.includes("string literal not terminated")) {
      return "Add the closing quote to complete the string literal.";
    }
    if (m.includes("unclosed comment")) {
      return "Add the closing delimiter to complete the comment.";
    }
    if (m.includes("unexpected ')'")) {
      return "Check for missing opening parenthesis '(' earlier in the code.";
    }
    if (m.includes("unexpected end of input")) {
      return "Your code ends unexpectedly. Check for unclosed blocks or incomplete expressions.";
    }
    // Generic unclosed (list) check last
    if (
      m.includes("unclosed list") || m.includes("unclosed") ||
      (m.includes("missing") && m.includes("closing"))
    ) return "Add a closing parenthesis ')' to complete the expression.";
    return "Check the syntax near this location.";
  }
}

// -----------------------------------------------------------------------------
// Error code inference functions
// -----------------------------------------------------------------------------

/**
 * Pattern for matching error messages to error codes.
 * Each pattern can have multiple strings (all must match) or a single string.
 */
type ErrorPattern = {
  /** Strings to test - all must be present in message (AND logic) */
  test: string | string[];
  /** Error code to return if pattern matches */
  code: HQLErrorCode;
};

/**
 * Consolidated error code inference using pattern matching.
 * This replaces 7 similar functions with one configurable system.
 *
 * @param msg - Error message to analyze
 * @param patterns - Array of patterns to test
 * @param fallback - Default error code if no pattern matches
 * @param context - Optional context string for additional matching
 * @returns Inferred error code
 */
// Helper: Check if all test patterns match within text (optimized for early exit)
function allTestsMatch(text: string, tests: string[]): boolean {
  for (const test of tests) {
    if (!text.includes(test)) return false;
  }
  return true;
}

// Optimized pattern matching using pre-compiled lowercase patterns
function inferErrorCodeFromCompiledPatterns(
  msg: string,
  compiledPatterns: CompiledErrorPattern[],
  fallback: HQLErrorCode,
  context?: string,
): HQLErrorCode {
  const lower = msg.toLowerCase();
  const lowerContext = context?.toLowerCase();

  for (const { tests, code } of compiledPatterns) {
    if (allTestsMatch(lower, tests)) return code;
    if (lowerContext && allTestsMatch(lowerContext, tests)) return code;
  }

  return fallback;
}

// Pattern mappings for each error type
// Pre-compiled versions with lowercase strings for O(1) matching instead of O(n²)

interface CompiledErrorPattern {
  tests: string[]; // Pre-normalized lowercase strings
  code: HQLErrorCode;
}

const PARSE_ERROR_PATTERNS: ErrorPattern[] = [
  { test: "unclosed list", code: HQLErrorCode.UNCLOSED_LIST },
  { test: "unclosed string", code: HQLErrorCode.UNCLOSED_STRING },
  { test: "unclosed comment", code: HQLErrorCode.UNCLOSED_COMMENT },
  { test: ["unexpected", "')"], code: HQLErrorCode.UNEXPECTED_TOKEN },
  { test: "unexpected end", code: HQLErrorCode.UNEXPECTED_EOF },
  { test: "unexpected character", code: HQLErrorCode.INVALID_CHARACTER },
  { test: "invalid character", code: HQLErrorCode.INVALID_CHARACTER },
];

const IMPORT_ERROR_PATTERNS: ErrorPattern[] = [
  { test: "circular", code: HQLErrorCode.CIRCULAR_IMPORT },
  { test: "module not found", code: HQLErrorCode.MODULE_NOT_FOUND },
  { test: "cannot find", code: HQLErrorCode.MODULE_NOT_FOUND },
  { test: "does not exist", code: HQLErrorCode.MODULE_NOT_FOUND },
  { test: "relative import path", code: HQLErrorCode.INVALID_IMPORT_PATH },
  { test: "not prefixed with", code: HQLErrorCode.INVALID_IMPORT_PATH },
  { test: "not in import map", code: HQLErrorCode.MODULE_NOT_FOUND },
  { test: "does not provide an export", code: HQLErrorCode.EXPORT_NOT_FOUND },
  { test: "unsupported import file type", code: HQLErrorCode.INVALID_IMPORT_PATH },
  { test: "invalid import syntax", code: HQLErrorCode.INVALID_IMPORT_SYNTAX },
  { test: "invalid import statement", code: HQLErrorCode.INVALID_IMPORT_SYNTAX },
  { test: "invalid import path", code: HQLErrorCode.INVALID_IMPORT_PATH },
  { test: "invalid path", code: HQLErrorCode.INVALID_IMPORT_PATH },
  { test: ["export", "not found"], code: HQLErrorCode.EXPORT_NOT_FOUND },
  { test: "failed to resolve", code: HQLErrorCode.IMPORT_RESOLUTION_FAILED },
];

const VALIDATION_ERROR_PATTERNS: ErrorPattern[] = [
  {
    test: ["missing", "argument"],
    code: HQLErrorCode.MISSING_REQUIRED_ARGUMENT,
  },
  { test: ["too many", "argument"], code: HQLErrorCode.TOO_MANY_ARGUMENTS },
  { test: ["invalid", "parameter"], code: HQLErrorCode.INVALID_PARAMETER },
  { test: ["duplicate", "parameter"], code: HQLErrorCode.DUPLICATE_PARAMETER },
  { test: "already been declared", code: HQLErrorCode.INVALID_EXPRESSION }, // Duplicate variable declaration
  { test: "function", code: HQLErrorCode.INVALID_FUNCTION_SYNTAX },
  { test: "class", code: HQLErrorCode.INVALID_CLASS_SYNTAX },
  { test: ["invalid", "variable"], code: HQLErrorCode.INVALID_VARIABLE_NAME },
  { test: ["invalid", "expression"], code: HQLErrorCode.INVALID_EXPRESSION },
];

const MACRO_ERROR_PATTERNS: ErrorPattern[] = [
  { test: "not found", code: HQLErrorCode.MACRO_NOT_FOUND },
  { test: "undefined macro", code: HQLErrorCode.MACRO_NOT_FOUND },
  { test: "recursion", code: HQLErrorCode.MACRO_RECURSION_LIMIT },
  { test: "recursive", code: HQLErrorCode.MACRO_RECURSION_LIMIT },
  { test: "expansion", code: HQLErrorCode.MACRO_EXPANSION_FAILED },
  { test: "expand", code: HQLErrorCode.MACRO_EXPANSION_FAILED },
  { test: ["invalid", "syntax"], code: HQLErrorCode.INVALID_MACRO_SYNTAX },
  {
    test: ["invalid", "definition"],
    code: HQLErrorCode.INVALID_MACRO_DEFINITION,
  },
];

const TRANSFORM_ERROR_PATTERNS: ErrorPattern[] = [
  { test: "unsupported", code: HQLErrorCode.UNSUPPORTED_FEATURE },
  { test: "not supported", code: HQLErrorCode.UNSUPPORTED_FEATURE },
  { test: "invalid ast", code: HQLErrorCode.INVALID_AST_NODE },
  { test: "invalid node", code: HQLErrorCode.INVALID_AST_NODE },
  { test: "type mismatch", code: HQLErrorCode.TRANSFORM_TYPE_MISMATCH },
];

const CODEGEN_ERROR_PATTERNS: ErrorPattern[] = [
  { test: ["invalid", "target"], code: HQLErrorCode.INVALID_CODEGEN_TARGET },
  { test: "source map", code: HQLErrorCode.SOURCEMAP_GENERATION_FAILED },
  { test: "sourcemap", code: HQLErrorCode.SOURCEMAP_GENERATION_FAILED },
];

const RUNTIME_ERROR_PATTERNS: ErrorPattern[] = [
  { test: "is not defined", code: HQLErrorCode.UNDEFINED_VARIABLE },
  { test: "undefined variable", code: HQLErrorCode.UNDEFINED_VARIABLE },
  { test: "is not a function", code: HQLErrorCode.FUNCTION_NOT_FOUND },
  { test: "function not found", code: HQLErrorCode.FUNCTION_NOT_FOUND },
  { test: "type mismatch", code: HQLErrorCode.TYPE_MISMATCH },
  { test: "invalid type", code: HQLErrorCode.TYPE_MISMATCH },
  { test: "division by zero", code: HQLErrorCode.DIVISION_BY_ZERO },
  { test: "null", code: HQLErrorCode.NULL_REFERENCE },
  { test: "undefined", code: HQLErrorCode.NULL_REFERENCE },
];

// Pre-compile patterns at module init for performance (avoid repeated toLowerCase() calls)
function compilePatterns(patterns: ErrorPattern[]): CompiledErrorPattern[] {
  return patterns.map(p => ({
    tests: Array.isArray(p.test) ? p.test.map(t => t.toLowerCase()) : [p.test.toLowerCase()],
    code: p.code
  }));
}

const COMPILED_PARSE_ERROR_PATTERNS = compilePatterns(PARSE_ERROR_PATTERNS);
const COMPILED_IMPORT_ERROR_PATTERNS = compilePatterns(IMPORT_ERROR_PATTERNS);
const COMPILED_VALIDATION_ERROR_PATTERNS = compilePatterns(VALIDATION_ERROR_PATTERNS);
const COMPILED_MACRO_ERROR_PATTERNS = compilePatterns(MACRO_ERROR_PATTERNS);
const COMPILED_TRANSFORM_ERROR_PATTERNS = compilePatterns(TRANSFORM_ERROR_PATTERNS);
const COMPILED_CODEGEN_ERROR_PATTERNS = compilePatterns(CODEGEN_ERROR_PATTERNS);
const COMPILED_RUNTIME_ERROR_PATTERNS = compilePatterns(RUNTIME_ERROR_PATTERNS);

/**
 * Factory function to create error code inferrers
 * Reduces duplication across similar inference functions
 */
function createErrorCodeInferrer(
  patterns: CompiledErrorPattern[],
  fallback: HQLErrorCode,
): (msg: string) => HQLErrorCode {
  return (msg: string) => inferErrorCodeFromCompiledPatterns(msg, patterns, fallback);
}

// Create inferrers using factory pattern
const inferParseErrorCode = createErrorCodeInferrer(
  COMPILED_PARSE_ERROR_PATTERNS,
  HQLErrorCode.INVALID_SYNTAX,
);
const inferImportErrorCode = createErrorCodeInferrer(
  COMPILED_IMPORT_ERROR_PATTERNS,
  HQLErrorCode.INVALID_IMPORT_SYNTAX,
);
const inferMacroErrorCode = createErrorCodeInferrer(
  COMPILED_MACRO_ERROR_PATTERNS,
  HQLErrorCode.MACRO_EXPANSION_FAILED,
);
const inferTransformErrorCode = createErrorCodeInferrer(
  COMPILED_TRANSFORM_ERROR_PATTERNS,
  HQLErrorCode.TRANSFORMATION_FAILED,
);
const inferCodeGenErrorCode = createErrorCodeInferrer(
  COMPILED_CODEGEN_ERROR_PATTERNS,
  HQLErrorCode.CODEGEN_FAILED,
);

/**
 * Infer error code from validation error message (needs context parameter)
 */
function inferValidationErrorCode(msg: string, context: string): HQLErrorCode {
  return inferErrorCodeFromCompiledPatterns(
    msg,
    COMPILED_VALIDATION_ERROR_PATTERNS,
    HQLErrorCode.INVALID_EXPRESSION,
    context,
  );
}

/**
 * Infer error code from runtime error message.
 * First checks if an existing HQL error code is embedded in the message.
 * Then tries to match against known error patterns.
 */
function inferRuntimeErrorCode(msg: string): HQLErrorCode {
  // FIRST: Check if message already contains an HQL error code
  // This handles cases where errors bubble up and get re-wrapped
  const existingCode = extractExistingErrorCode(msg);
  if (existingCode !== null) {
    return existingCode;
  }

  // Also check for common patterns that indicate this is NOT a runtime error
  // but rather a parse/import/validation error that bubbled up

  // Parse error patterns
  const lowerMsg = msg.toLowerCase();
  if (
    lowerMsg.includes("unclosed list") ||
    lowerMsg.includes("unclosed string") ||
    lowerMsg.includes("unclosed comment") ||
    lowerMsg.includes("unexpected token") ||
    lowerMsg.includes("unexpected end of input")
  ) {
    return inferErrorCodeFromCompiledPatterns(
      msg,
      COMPILED_PARSE_ERROR_PATTERNS,
      HQLErrorCode.INVALID_SYNTAX,
    );
  }

  // Import error patterns
  if (
    lowerMsg.includes("module not found") ||
    lowerMsg.includes("cannot find module") ||
    lowerMsg.includes("circular import") ||
    lowerMsg.includes("failed to resolve") ||
    lowerMsg.includes("not prefixed with") ||
    lowerMsg.includes("not in import map") ||
    lowerMsg.includes("relative import path") ||
    lowerMsg.includes("does not provide an export") ||
    (lowerMsg.includes("import") && lowerMsg.includes("invalid"))
  ) {
    return inferErrorCodeFromCompiledPatterns(
      msg,
      COMPILED_IMPORT_ERROR_PATTERNS,
      HQLErrorCode.INVALID_IMPORT_SYNTAX,
    );
  }

  // Validation error patterns
  if (
    lowerMsg.includes("already been declared") ||
    lowerMsg.includes("duplicate") ||
    lowerMsg.includes("invalid function") ||
    lowerMsg.includes("invalid class") ||
    lowerMsg.includes("too many arguments") ||
    lowerMsg.includes("missing required")
  ) {
    return inferErrorCodeFromCompiledPatterns(
      msg,
      COMPILED_VALIDATION_ERROR_PATTERNS,
      HQLErrorCode.INVALID_EXPRESSION,
    );
  }

  // Transform error patterns
  if (
    lowerMsg.includes("transformation failed") ||
    lowerMsg.includes("transform error")
  ) {
    return inferErrorCodeFromCompiledPatterns(
      msg,
      COMPILED_TRANSFORM_ERROR_PATTERNS,
      HQLErrorCode.TRANSFORMATION_FAILED,
    );
  }

  // Default to standard runtime error patterns
  return inferErrorCodeFromCompiledPatterns(
    msg,
    COMPILED_RUNTIME_ERROR_PATTERNS,
    HQLErrorCode.TYPE_MISMATCH,
  );
}

type ImportErrorOptions = SourceLocation & {
  originalError?: Error;
  code?: HQLErrorCode;
};

export class ImportError extends HQLError {
  readonly importPath: string;
  constructor(
    msg: string,
    importPathOrOpts?: string | ImportErrorOptions | SourceLocationInfo,
    optsOrError?: ImportErrorOptions | SourceLocationInfo | Error,
    maybeError?: Error,
  ) {
    let importPath = "unknown";
    const opts: ImportErrorOptions = {};

    const applyOpts = (
      candidate?: ImportErrorOptions | SourceLocationInfo,
    ) => {
      if (!candidate) return;
      if (candidate instanceof SourceLocationInfo) {
        const { filePath, line, column, source } = candidate;
        Object.assign(opts, { filePath, line, column, source });
      } else {
        Object.assign(opts, candidate);
      }
    };

    if (typeof importPathOrOpts === "string") {
      importPath = importPathOrOpts;
      if (optsOrError instanceof Error) {
        opts.originalError = optsOrError;
      } else {
        applyOpts(optsOrError);
      }
      if (maybeError) {
        opts.originalError = maybeError;
      }
    } else {
      applyOpts(importPathOrOpts);
      if (optsOrError instanceof Error) {
        opts.originalError = optsOrError;
      } else {
        applyOpts(optsOrError);
      }
    }

    // Use provided code or infer from message
    const errorCode = opts.code || inferImportErrorCode(msg);

    const { originalError, ...sourceLocation } = opts;

    // Enhance message with error code and location (using helper)
    const enhancedMsg = enhanceErrorMessage(msg, errorCode, opts);

    super(enhancedMsg, {
      errorType: ErrorType.IMPORT,
      sourceLocation,
      originalError,
    });
    this.importPath = importPath;
    this.code = errorCode;
  }

  override getSuggestion(): string {
    if (this.isCircularDependencyError()) {
      return "Restructure code to break the circular dependency chain.";
    }
    if (
      this.message.toLowerCase().includes("cannot find") ||
      this.message.toLowerCase().includes("not found")
    ) {
      return `Check that the file \"${this.importPath}\" exists and the path is correct.`;
    }
    return `Verify the import path for \"${this.importPath}\".`;
  }
}

type ValidationErrorOptions = SourceLocation & {
  expectedType?: string;
  actualType?: string;
  originalError?: Error;
  code?: HQLErrorCode;
};

export class ValidationError extends HQLError {
  readonly context: string;
  readonly expectedType?: string;
  readonly actualType?: string;
  constructor(
    msg: string,
    context: string,
    expectedOrOpts?: string | ValidationErrorOptions,
    actualOrOpts?: string | ValidationErrorOptions,
    maybeOpts?: ValidationErrorOptions,
  ) {
    const opts: ValidationErrorOptions = {};

    if (typeof expectedOrOpts === "string") {
      opts.expectedType = expectedOrOpts;
      if (typeof actualOrOpts === "string") {
        opts.actualType = actualOrOpts;
        if (maybeOpts) Object.assign(opts, maybeOpts);
      } else if (actualOrOpts) {
        Object.assign(opts, actualOrOpts);
      }
    } else if (expectedOrOpts) {
      Object.assign(opts, expectedOrOpts);
    }

    // Use provided code or infer from message
    const errorCode = opts.code || inferValidationErrorCode(msg, context);

    const {
      expectedType,
      actualType,
      originalError,
      ...sourceLocation
    } = opts;

    // Enhance message with error code and location (using helper)
    const enhancedMsg = enhanceErrorMessage(msg, errorCode, opts);

    super(enhancedMsg, {
      errorType: ErrorType.VALIDATION,
      sourceLocation,
      originalError,
    });
    this.context = context;
    this.expectedType = expectedType;
    this.actualType = actualType;
    this.code = errorCode;
  }

  override getSuggestion(): string {
    const m = this.message.toLowerCase();
    const ctx = this.context.toLowerCase();

    // Duplicate declaration
    if (m.includes("already been declared") || m.includes("duplicate")) {
      return "Choose a different variable name or remove the duplicate declaration.";
    }

    // TDZ violation
    if (m.includes("before initialization") || m.includes("temporal dead zone")) {
      return "Move the variable declaration before its first use.";
    }

    // Too many arguments
    if (m.includes("too many") && m.includes("argument")) {
      return "Check the number of arguments you're passing to the function.";
    }

    // Missing argument
    if (m.includes("missing") && m.includes("argument")) {
      return "Make sure you provide all required arguments to the function.";
    }

    // Class-specific suggestions
    if (m.includes("class") || ctx.includes("class")) {
      if (m.includes("requires a name")) {
        return "Classes require: (class Name (field x) (fn method [self] body))";
      }
      return "Check class definition syntax: (class Name body...)";
    }

    // Enum-specific suggestions
    if (m.includes("enum") || ctx.includes("enum")) {
      if (m.includes("requires a name") || m.includes("at least one case")) {
        return "Enums require: (enum Name (case A) (case B)). Example: (enum Color (case Red) (case Blue))";
      }
      return "Check enum definition syntax: (enum Name (case ...) ...)";
    }

    // Loop-specific suggestions
    if (m.includes("loop") || ctx.includes("loop")) {
      if (m.includes("bindings")) {
        return "Loop requires: (loop [var init ...] body). Example: (loop [i 0] (if (< i 10) (recur (+ i 1)) i))";
      }
      return "Check loop syntax: (loop [bindings] body)";
    }

    // Recur-specific suggestions
    if (m.includes("recur") || ctx.includes("recur")) {
      return "The 'recur' form can only be used inside a 'loop' expression.";
    }

    // If-specific suggestions
    if (m.includes("if") || ctx.includes("if")) {
      return "If requires 2 or 3 arguments: (if condition then else?)";
    }

    // Type mismatch
    if (this.expectedType && this.actualType) {
      return `Expected ${this.expectedType} but got ${this.actualType}.`;
    }

    return "Check the code for validation errors.";
  }
}

type MacroErrorOptions = SourceLocation & {
  originalError?: Error;
  code?: HQLErrorCode;
};

export class MacroError extends HQLError {
  readonly macroName: string;
  constructor(
    msg: string,
    macroName: string,
    opts: MacroErrorOptions | string = {},
    maybeOpts?: MacroErrorOptions,
  ) {
    const collected: MacroErrorOptions = {};

    const assignOpts = (input: MacroErrorOptions | string) => {
      if (!input) return;
      if (typeof input === "string") {
        collected.filePath = input;
      } else {
        Object.assign(collected, input);
      }
    };

    assignOpts(opts);
    if (maybeOpts) {
      assignOpts(maybeOpts);
    }

    // Use provided code or infer from message
    const errorCode = collected.code || inferMacroErrorCode(msg);

    const { originalError, ...sourceLocation } = collected;

    // Enhance message with error code and location (using helper)
    const enhancedMsg = enhanceErrorMessage(msg, errorCode, collected);

    super(enhancedMsg, {
      errorType: ErrorType.MACRO,
      sourceLocation,
      originalError,
    });
    this.macroName = macroName;
    this.code = errorCode;
  }

  override getSuggestion(): string {
    const m = this.message.toLowerCase();

    // Specific suggestions based on error type
    if (m.includes("requires a name, parameter list, and body")) {
      return "Macros require: (macro name [params] body). Example: (macro double [x] `(* ~x 2))";
    }
    if (m.includes("name must be a symbol")) {
      return "The macro name must be a valid symbol, not a literal or expression.";
    }
    if (m.includes("parameters must be a list")) {
      return "Macro parameters should be in brackets: (macro name [param1 param2] body)";
    }
    if (m.includes("too few arguments") || m.includes("too many arguments")) {
      return `Check the number of arguments passed to macro '${this.macroName}'.`;
    }
    if (m.includes("unquote") || m.includes("splice")) {
      return "Unquote (~) and splice (~@) can only be used inside quasiquote (`).";
    }

    return `Check usage and arguments of the macro '${this.macroName}'.`;
  }
}

type TransformErrorOptions = SourceLocation & {
  originalError?: Error;
  code?: HQLErrorCode;
};

export class TransformError extends HQLError {
  readonly phase: string;
  constructor(
    msg: string,
    phase: string,
    ...details: Array<TransformErrorOptions | string | Error | object>
  ) {
    const collected: TransformErrorOptions = {};

    const assignOpts = (
      input: TransformErrorOptions | string | Error | object,
    ) => {
      if (!input) return;
      if (typeof input === "string") {
        collected.filePath = input;
      } else if (input instanceof Error) {
        collected.originalError = input;
      } else if (Array.isArray(input)) {
        // ignore arrays used for context metadata
      } else {
        const candidate = input as Record<string, unknown>;
        if (typeof candidate.filePath === "string" && !collected.filePath) {
          collected.filePath = candidate.filePath;
        }
        if (
          typeof candidate.line === "number" && collected.line === undefined
        ) {
          collected.line = candidate.line;
        }
        if (
          typeof candidate.column === "number" && collected.column === undefined
        ) {
          collected.column = candidate.column;
        }
        if (candidate.position && typeof candidate.position === "object") {
          const pos = candidate.position as Record<string, unknown>;
          if (typeof pos.filePath === "string" && !collected.filePath) {
            collected.filePath = pos.filePath;
          }
          if (typeof pos.line === "number" && collected.line === undefined) {
            collected.line = pos.line;
          }
          if (
            typeof pos.column === "number" && collected.column === undefined
          ) {
            collected.column = pos.column;
          }
        }
        if (candidate._meta && typeof candidate._meta === "object") {
          const meta = candidate._meta as Record<string, unknown>;
          if (typeof meta.filePath === "string" && !collected.filePath) {
            collected.filePath = meta.filePath;
          }
          if (typeof meta.line === "number" && collected.line === undefined) {
            collected.line = meta.line;
          }
          if (
            typeof meta.column === "number" && collected.column === undefined
          ) {
            collected.column = meta.column;
          }
        }
        if (candidate.originalError instanceof Error) {
          collected.originalError = candidate.originalError;
        }
        if (typeof candidate.code === "number") {
          collected.code = candidate.code;
        }
      }
    };

    for (const detail of details) {
      assignOpts(detail);
    }

    // Use provided code or infer from message
    const errorCode = collected.code || inferTransformErrorCode(msg);

    const { originalError, ...sourceLocation } = collected;

    // Enhance message with error code and location (using helper)
    const enhancedMsg = enhanceErrorMessage(msg, errorCode, collected);

    super(enhancedMsg, {
      errorType: ErrorType.TRANSFORM,
      sourceLocation,
      originalError,
    });
    this.phase = phase;
    this.code = errorCode;
  }

  override getSuggestion(): string {
    const msg = this.message.toLowerCase();

    // Function-specific suggestions
    if (msg.includes("fn syntax") || msg.includes("function")) {
      if (msg.includes("requires at least parameters and body")) {
        return "Functions require: (fn name [params] body) or (fn [params] body). Example: (fn add [x y] (+ x y))";
      }
      if (msg.includes("missing body expression")) {
        return "Add a body expression after the parameters. Example: (fn double [x] (* x 2))";
      }
      if (msg.includes("parameter list must be a list")) {
        return "Parameters should be in brackets: (fn name [param1 param2] body)";
      }
      if (msg.includes("function name must be a symbol")) {
        return "Function name must be a valid symbol, not a literal or expression.";
      }
    }

    // Class-specific suggestions
    if (msg.includes("class") || this.phase.includes("class")) {
      if (msg.includes("requires a name")) {
        return "Classes require: (class Name (field x) (fn method [self] body))";
      }
      if (msg.includes("field")) {
        return "Class fields should be: (field name) or (field name default-value)";
      }
    }

    // Enum-specific suggestions
    if (msg.includes("enum")) {
      if (msg.includes("requires a name and at least one case")) {
        return "Enums require: (enum Name (case A) (case B value)). Example: (enum Color (case Red) (case Blue))";
      }
    }

    // Loop-specific suggestions
    if (msg.includes("loop") || msg.includes("recur")) {
      if (msg.includes("bindings")) {
        return "Loop requires: (loop [var init ...] body). Example: (loop [i 0] (if (< i 10) (recur (+ i 1)) i))";
      }
      if (msg.includes("inside a loop")) {
        return "The 'recur' form can only be used inside a 'loop' expression.";
      }
    }

    // Conditional-specific suggestions
    if (msg.includes("if") && msg.includes("requires")) {
      return "If requires: (if condition then-expr else-expr). Example: (if (> x 0) \"positive\" \"non-positive\")";
    }

    // Generic phase-based suggestions
    if (this.phase.toLowerCase().includes("ast")) {
      return "Check AST structure around this construct.";
    }
    if (this.phase.toLowerCase().includes("ir")) {
      return "Check IR generation for unsupported constructs.";
    }

    return `Issue occurred during ${this.phase} phase.`;
  }
}

export class RuntimeError extends HQLError {
  constructor(
    msg: string,
    opts: {
      filePath?: string;
      line?: number;
      column?: number;
      source?: string;
      originalError?: Error;
      code?: HQLErrorCode;
    } = {},
  ) {
    // Determine error code with priority:
    // 1. Explicitly provided code
    // 2. Code from originalError if it's an HQLError
    // 3. Inferred from message
    let errorCode = opts.code;

    if (!errorCode && opts.originalError instanceof HQLError) {
      // Preserve error code from wrapped HQLError
      errorCode = opts.originalError.code;
    }

    if (!errorCode) {
      errorCode = inferRuntimeErrorCode(msg);
    }

    // Enhance message with error code and location (using helper)
    const enhancedMsg = enhanceErrorMessage(msg, errorCode, opts);

    super(enhancedMsg, {
      errorType: ErrorType.RUNTIME,
      sourceLocation: opts,
      originalError: opts.originalError,
    });
    this.code = errorCode;

    // Preserve the original error's stack if available (it may have been transformed by Error.prepareStackTrace)
    if (opts.originalError && opts.originalError.stack) {
      this.stack = opts.originalError.stack;
    }
  }

  override getSuggestion(): string {
    const m = this.message.toLowerCase();

    // If wrapped error is an HQLError, delegate to its suggestion
    if (this.originalError instanceof HQLError) {
      const originalSuggestion = this.originalError.getSuggestion();
      if (originalSuggestion && !originalSuggestion.includes("Check runtime type")) {
        return originalSuggestion;
      }
    }

    // Parse error suggestions
    if (m.includes("unclosed list") || m.includes("missing closing parenthesis")) {
      return "Add a closing parenthesis ')' to complete the expression.";
    }
    if (m.includes("unclosed string")) {
      return "Add the closing quote to complete the string literal.";
    }
    if (m.includes("unclosed comment")) {
      return "Add the closing delimiter to complete the comment.";
    }
    if (m.includes("unexpected token") || m.includes("unexpected ')'")) {
      return "Check for mismatched parentheses or unexpected characters.";
    }
    if (m.includes("unexpected end of input")) {
      return "Your code ends unexpectedly. Check for unclosed blocks or incomplete expressions.";
    }

    // Import error suggestions (more specific patterns first)
    if (m.includes("relative import path") || m.includes("not prefixed with")) {
      return "Use a relative path starting with './' or '../', or an absolute path starting with '/'.";
    }
    if (m.includes("module not found") || m.includes("does not exist") || m.includes("not in import map")) {
      return "Check that the file exists and the path is correct.";
    }
    if (m.includes("circular import")) {
      return "Restructure code to break the circular dependency chain.";
    }
    if (m.includes("unsupported import file type")) {
      return "Check that you're importing a valid HQL, JS, or TS file with the correct extension.";
    }
    if (m.includes("does not provide an export")) {
      return "Verify the export name exists in the imported module.";
    }

    // Validation error suggestions
    if (m.includes("already been declared") || m.includes("duplicate")) {
      return "Choose a different name or remove the duplicate declaration.";
    }
    if (m.includes("too many arguments")) {
      return "Check the number of arguments you're passing to the function.";
    }
    if (m.includes("missing required") && m.includes("argument")) {
      return "Make sure you provide all required arguments to the function.";
    }

    // Specific suggestion for missing function body
    if (m.includes("missing body expression")) {
      return "Add a body expression after the parameters. Functions must have at least one expression in the body.";
    }

    // Runtime error suggestions
    if (m.includes("is not defined")) {
      return "Ensure variables are defined before use. Check spelling and scope.";
    }
    if (m.includes("cannot read properties of null") || m.includes("cannot read properties of undefined")) {
      return "Add checks before accessing properties on possibly null/undefined values.";
    }
    if (m.includes("is not a function")) {
      return "Verify the value is a function before invoking it.";
    }

    return "Check the code near this location for errors.";
  }
}

type CodeGenErrorOptions = SourceLocation & {
  nodeType?: string;
  originalError?: Error;
  code?: HQLErrorCode;
};

export class CodeGenError extends HQLError {
  readonly nodeType?: string;
  constructor(
    msg: string,
    nodeTypeOrOpts: string | CodeGenErrorOptions = {},
    node?: unknown,
  ) {
    const opts: CodeGenErrorOptions = typeof nodeTypeOrOpts === "string"
      ? { nodeType: nodeTypeOrOpts }
      : { ...nodeTypeOrOpts };

    if (node && typeof node === "object" && "position" in node) {
      const { line, column, filePath } = (node as Record<string, unknown>)
        .position as {
          line?: number;
          column?: number;
          filePath?: string;
        };
      if (line !== undefined && opts.line === undefined) opts.line = line;
      if (column !== undefined && opts.column === undefined) {
        opts.column = column;
      }
      if (filePath && !opts.filePath) opts.filePath = filePath;
    }

    // Use provided code or infer from message
    const errorCode = opts.code || inferCodeGenErrorCode(msg);

    const { nodeType, originalError, ...sourceLocation } = opts;

    // Enhance message with error code and location (using helper)
    const enhancedMsg = enhanceErrorMessage(msg, errorCode, opts);

    super(enhancedMsg, {
      errorType: ErrorType.CODEGEN,
      sourceLocation,
      originalError,
    });
    this.nodeType = nodeType;
    this.code = errorCode;
  }

  override getSuggestion(): string {
    return this.nodeType
      ? `Problem generating code for ${this.nodeType} node.`
      : "Review complex patterns that might break code generation.";
  }
}

export class TranspilerError extends HQLError {
  constructor(msg: string, opts: Record<string, unknown> = {}) {
    super(msg, { ...opts, errorType: ErrorType.TRANSPILER });
    this.name = "TranspilerError";
  }
}

// -----------------------------------------------------------------------------
// Source‑location helpers
// -----------------------------------------------------------------------------

export interface SourceLocation {
  filePath?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  source?: string;
  offset?: number;
}

export class SourceLocationInfo implements SourceLocation {
  filePath?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  source?: string;

  constructor(opts: SourceLocation = {}) {
    Object.assign(this, opts);
  }

  loadSource(): string | undefined {
    return this.source;
  }

  toString(): string {
    if (!this.filePath) return "<unknown location>";
    const l = this.line ? `:${this.line}` : "";
    const c = this.line && this.column ? `:${this.column}` : "";
    return `${this.filePath}${l}${c}`;
  }

  clone(): SourceLocationInfo {
    return new SourceLocationInfo(this);
  }

  extractContextLines(
    count = 2,
  ): { line: number; content: string; isError: boolean; column?: number }[] {
    const src = this.loadSource();
    if (!src || !this.line) return [];

    // Use unified context extraction helper
    return extractContextLinesFromSource(src, this.line, this.column, count);
  }

  static fromError(err: Error): SourceLocationInfo | undefined {
    if (!err.stack) return undefined;
    const match = err.stack.match(
      /\(?((?:\/|[a-zA-Z]:\\|file:\/\/)[^:)]+):(\d+):(\d+)\)?/,
    );
    if (!match) return undefined;
    const [, filePath, lineStr, colStr] = match;
    const line = Number(lineStr);
    const column = Number(colStr);
    if (isNaN(line) || isNaN(column)) return undefined;
    return new SourceLocationInfo({
      filePath,
      line,
      column,
      source: err.stack,
    });
  }
}

// -----------------------------------------------------------------------------
// Error reporter
// -----------------------------------------------------------------------------

export class ErrorReporter {
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger(false);
  }

  async reportError(error: Error | HQLError, isDebug = false): Promise<void> {
    // Prevent double reporting: if already reported, do nothing
    if (isObjectValue(error)) {
      if (Reflect.get(error, ERROR_REPORTED_SYMBOL)) {
        return;
      }
      // Mark as reported
      Reflect.set(error, ERROR_REPORTED_SYMBOL, true);
    }
    try {
      // Inline formatter logic
      const formattedError = error instanceof HQLError
        ? await formatHQLError(error, isDebug)
        : formatErrorMessage(error);
      console.error(formattedError);
    } catch (_formatError) {
      // Fallback in case formatting itself fails
      console.error(`Error: ${error.message}`);
      if (isDebug) {
        console.error(error.stack);
      }
    }
  }

  createParseError(
    message: string,
    line: number,
    column: number,
    filePath: string,
    source?: string,
  ): ParseError {
    return new ParseError(message, { line, column, filePath, source });
  }

  createValidationError(
    message: string,
    context: string,
    expectedType?: string,
    actualType?: string,
    filePath?: string,
    line?: number,
    column?: number,
  ): ValidationError {
    return new ValidationError(message, context, {
      expectedType,
      actualType,
      filePath,
      line,
      column,
    });
  }

  createRuntimeError(
    message: string,
    filePath?: string,
    line?: number,
    column?: number,
  ): RuntimeError {
    return new RuntimeError(message, { filePath, line, column });
  }
}

export const globalErrorReporter = new ErrorReporter(logger);

export async function reportError(
  error: Error | HQLError,
  isDebug = false,
): Promise<void> {
  await globalErrorReporter.reportError(error, isDebug);
}

export const ErrorPipeline = {
  reportError,
  perform,
  wrapError,
  // classes
  HQLError,
  ParseError,
  ImportError,
  ValidationError,
  MacroError,
  TransformError,
  RuntimeError,
  CodeGenError,
  TranspilerError,
  ErrorType,
  SourceLocationInfo,
};

export default ErrorPipeline;
