// core/src/common/runtime-error-handler.ts - Enhanced version
// Maps JavaScript runtime errors back to HQL source locations with improved accuracy

import { globalErrorReporter, HQLError, RuntimeError } from "./error.ts";
import { globalLogger as logger } from "../logger.ts";
import {
  createJsCallRegex,
  createSExpCallRegex,
  escapeRegExp,
} from "./utils.ts";
import { type RawSourceMap, SourceMapConsumer } from "npm:source-map@0.6.1";
import {
  dirname,
  exists,
  isAbsolute,
  readTextFile,
  resolve,
} from "../platform/platform.ts";
import { ERROR_REPORTED_SYMBOL } from "./error-constants.ts";
import { mapPositionSync } from "../transpiler/pipeline/source-map-support.ts";
import { extractContextLinesFromFile } from "./context-helpers.ts";
import { findSimilarName } from "./string-similarity.ts";
import { getAllKnownIdentifiers } from "./known-identifiers.ts";
import { isHqlFile } from "./import-utils.ts";

// SourceMapConsumer bias constants (from source-map library)
// GREATEST_LOWER_BOUND = 1: When exact position not found, use closest position before
// LEAST_UPPER_BOUND = 2: When exact position not found, use closest position after
const GREATEST_LOWER_BOUND = 1;
const LEAST_UPPER_BOUND = 2;

/**
 * Runtime information about the current execution context
 */
interface RuntimeContext {
  currentHqlFile?: string;
  currentJsFile?: string;  // Path to the generated .mjs file for source map lookups
  sourceMap?: RawSourceMap | null;
  sourceMapConsumer?: SourceMapConsumer | null;
}

// Global runtime context
const runtimeContext: RuntimeContext = {
  currentHqlFile: undefined,
  currentJsFile: undefined,
  sourceMap: null,
  sourceMapConsumer: null,
};

interface JsStackFrame {
  jsFile: string;
  jsLine: number;
  jsColumn: number;
}

async function readFileLines(
  filePath: string,
): Promise<string[] | null> {
  if (!await exists(filePath)) {
    return null;
  }

  try {
    const content = await readTextFile(filePath);
    return content.split(/\r?\n/);
  } catch {
    return null;
  }
}

function normalizeJsPath(raw: string): string {
  const trimmed = raw.replace(/^file:\/\//, "file:///");
  if (trimmed.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(trimmed).pathname);
    } catch {
      return raw.replace(/^file:\/\//, "");
    }
  }
  return raw;
}

function parseStackForJsFrame(stack?: string): JsStackFrame | null {
  if (!stack) return null;
  const lines = stack.split("\n");
  // Match .js, .mjs (ES modules), and .hql files (when source maps have been applied)
  const pattern =
    /(?:at\s+)?(?:.*?\()?((?:file:\/\/)?[^\s)]+\.(?:m?js|hql)):(\d+):(\d+)\)?/;

  // Iterate through lines and pick the first valid user-code frame
  for (const line of lines) {
    const match = line.match(pattern);
    if (match) {
      const filePath = match[1];
      // Filter out internal Deno/V8 frames if needed, but usually we want the top one
      return {
        jsFile: normalizeJsPath(filePath),
        jsLine: parseInt(match[2], 10),
        jsColumn: parseInt(match[3], 10),
      };
    }
  }
  return null;
}

function resolveMappedSourcePath(
  source: string | null | undefined,
  frame: JsStackFrame,
): string | undefined {
  if (!source) return undefined;

  let mappedPath = source;
  if (mappedPath.startsWith("file://")) {
    try {
      mappedPath = decodeURIComponent(new URL(mappedPath).pathname);
    } catch {
      mappedPath = mappedPath.replace(/^file:\/\//, "");
    }
  }

  if (!isAbsolute(mappedPath)) {
    mappedPath = resolve(dirname(frame.jsFile), mappedPath);
  }

  return mappedPath;
}

async function getContextSourceMapConsumer(): Promise<
  SourceMapConsumer | null
> {
  if (!runtimeContext.sourceMap) {
    return null;
  }

  if (!runtimeContext.sourceMapConsumer) {
    runtimeContext.sourceMapConsumer = await new SourceMapConsumer(
      runtimeContext.sourceMap,
    );
  }

  return runtimeContext.sourceMapConsumer;
}

interface HqlMeta {
  filePath?: string;
  line?: number;
  column?: number;
}

function extractMetaFromError(error: Error): HqlMeta | null {
  const candidate = (error as unknown as { __hqlMeta?: HqlMeta }).__hqlMeta;
  if (candidate && typeof candidate === "object") {
    const { filePath, line, column } = candidate;
    if (typeof line === "number") {
      return {
        filePath,
        line,
        column: typeof column === "number" ? column : undefined,
      };
    }
  }
  return null;
}

async function extractHqlMetaFromJs(
  frame: JsStackFrame,
): Promise<{ filePath?: string; line: number; column: number } | null> {
  const lines = await readFileLines(frame.jsFile);
  if (!lines) return null;

  const searchIndex = Math.max(0, frame.jsLine - 1);
  const start = Math.max(0, searchIndex - 10);
  const end = Math.min(lines.length - 1, searchIndex + 10);
  const pattern = /HQL\s+file=([^;]*);line=(\d+);column=(\d+)/;

  let best: {
    filePath?: string;
    line: number;
    column: number;
    distance: number;
    ahead: boolean;
    index: number;
  } | null = null;

  for (let i = start; i <= end; i++) {
    const line = lines[i];
    if (!line) continue;
    const match = line.match(pattern);
    if (!match) continue;

    const decoded = match[1] ? decodeURIComponent(match[1]) : undefined;
    const candidate = {
      filePath: decoded && decoded.length > 0 ? decoded : undefined,
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      distance: Math.abs(i - searchIndex),
      ahead: i >= searchIndex,
      index: i,
    };

    if (
      !best ||
      candidate.distance < best.distance ||
      (candidate.distance === best.distance &&
        (candidate.ahead && !best.ahead ||
          (candidate.ahead === best.ahead &&
            Math.abs(candidate.index - searchIndex) <
              Math.abs(best.index - searchIndex))))
    ) {
      best = candidate;
    }
  }

  if (!best) return null;

  return {
    filePath: best.filePath,
    line: best.line,
    column: best.column,
  };
}

/**
 * Set the current runtime context
 */
export function setRuntimeContext(
  hqlFile?: string,
  jsFile?: string,
  rawMap?: RawSourceMap | null,
): void {
  runtimeContext.currentHqlFile = hqlFile;
  runtimeContext.currentJsFile = jsFile;

  if (rawMap !== undefined) {
    runtimeContext.sourceMap = rawMap;
    if (runtimeContext.sourceMapConsumer) {
      const consumer = runtimeContext.sourceMapConsumer as unknown as {
        destroy?: () => void;
      };
      consumer.destroy?.();
    }
    runtimeContext.sourceMapConsumer = null;
  }
}

// Guard to prevent duplicate event listener registration
let errorHandlerInstalled = false;

/**
 * Global error handler for runtime errors
 */
function installGlobalErrorHandler(): void {
  // Prevent duplicate registration (important for tests and REPL restarts)
  if (errorHandlerInstalled) return;
  errorHandlerInstalled = true;

  // Save the original console.error
  const originalConsoleError = console.error;

  // Override console.error to handle runtime errors
  console.error = async function (...args: unknown[]) {
    for (const arg of args) {
      if (await forwardRuntimeError(arg)) {
        // Prevent double printing: do not call the original console.error for Error instances
        return;
      }
    }

    // For non-Error arguments, call the original console.error
    originalConsoleError.apply(console, args);
  };

  // Add a global unhandled rejection handler
  globalThis.addEventListener(
    "unhandledrejection",
    async (event: PromiseRejectionEvent) => {
      await forwardRuntimeError(event.reason);
    },
  );

  // Add a global error handler
  globalThis.addEventListener("error", async (event: ErrorEvent) => {
    await forwardRuntimeError(event.error);
  });
}

async function forwardRuntimeError(candidate: unknown): Promise<boolean> {
  if (!(candidate instanceof Error)) {
    return false;
  }

  await handleRuntimeError(candidate);
  return true;
}

/**
 * Read some lines from a file, centered around a specific line
 */
async function readContextLines(
  filePath: string,
  errorLine: number,
  contextSize: number = 2,
): Promise<
  { line: number; content: string; isError: boolean; column?: number }[]
> {
  // Use unified context extraction helper
  const result = await extractContextLinesFromFile(
    filePath,
    errorLine,
    undefined,
    contextSize,
  );
  return result || [];
}

/**
 * Initialize the HQL runtime error handling system
 */
export function initializeErrorHandling(): void {
  installGlobalErrorHandler();
  // Note: known-identifiers.ts auto-initializes on import
}

/**
 * No offset correction needed anymore - source maps are properly adjusted
 * when helpers are prepended, so we can trust the line numbers directly.
 */

export async function resolveRuntimeLocation(
  error: Error,
): Promise<{ filePath?: string; line: number; column: number } | null> {
  const directMeta = extractMetaFromError(error);
  if (directMeta) {
    return {
      filePath: directMeta.filePath ?? runtimeContext.currentHqlFile,
      line: directMeta.line ?? 0,
      column: directMeta.column ?? 0,
    };
  }

  // Try to get the frame from the original error's stack (if available)
  // The wrapped RuntimeError's stack only shows wrapper functions, not the actual error location
  // Some errors may have an originalError property (from error wrapping)
  const errorWithOriginal = error as Error & { originalError?: Error };
  const originalError = errorWithOriginal.originalError;
  const stackToParse = originalError?.stack || error.stack;

  let frame = parseStackForJsFrame(stackToParse);

  // Fallback: For syntax errors, the location is in the error message, not the stack
  if (!frame && error.message) {
    const messagePattern = /at ((?:file:\/\/)?[^\s)]+\.(?:m?js|hql)):(\d+):(\d+)/;
    const match = error.message.match(messagePattern);
    if (match) {
      frame = {
        jsFile: normalizeJsPath(match[1]),
        jsLine: parseInt(match[2], 10),
        jsColumn: parseInt(match[3], 10),
      };
    }
  }

  if (frame) {
    // When Deno has already applied source maps (frame points to .hql file), trust its mapping.
    // Our source maps are generated with escodegen's standard source-map library using VLQ encoding,
    // which Deno's V8 engine handles correctly. We verified this produces accurate line numbers.
    if (isHqlFile(frame.jsFile)) {
      return {
        filePath: frame.jsFile,
        line: frame.jsLine,
        column: frame.jsColumn ?? 0,
      };
    }

    const contextConsumer = await getContextSourceMapConsumer();

    if (contextConsumer) {
      // Try GREATEST_LOWER_BOUND first (closest mapping before the position)
      let mapped = contextConsumer.originalPositionFor({
        line: frame.jsLine, // SourceMapConsumer expects 1-indexed line numbers
        column: frame.jsColumn ?? 0,
        bias: GREATEST_LOWER_BOUND,
      });

      // If GREATEST_LOWER_BOUND returns null (can happen with escodegen's intermediate mappings),
      // fall back to LEAST_UPPER_BOUND (closest mapping after the position)
      if (!mapped.source || mapped.line === null) {
        mapped = contextConsumer.originalPositionFor({
          line: frame.jsLine,
          column: frame.jsColumn ?? 0,
          bias: LEAST_UPPER_BOUND,
        });
      }

      if (mapped.source && mapped.line !== null) {
        const filePath = resolveMappedSourcePath(mapped.source, frame) ??
          runtimeContext.currentHqlFile;
        if (filePath) {
          const column = mapped.column !== null && mapped.column !== undefined
            ? mapped.column + 1
            : 0;
          return {
            filePath,
            line: mapped.line, // SourceMapConsumer returns 1-indexed lines, which is what we want
            column,
          };
        }
      }
    }

    const mapped = mapPositionSync(
      frame.jsFile,
      frame.jsLine,
      frame.jsColumn ?? 0,
    );

    if (mapped) {
      const filePath = resolveMappedSourcePath(mapped.source, frame);
      const line = mapped.line ?? 0;
      const column = mapped.column !== null && mapped.column !== undefined
        ? mapped.column + 1
        : 0;

      if (filePath) {
        return { filePath, line, column };
      }

      if (runtimeContext.currentHqlFile) {
        return {
          filePath: runtimeContext.currentHqlFile,
          line,
          column,
        };
      }
    }

    const meta = await extractHqlMetaFromJs(frame);
    if (meta) {
      return meta;
    }
  }

  if (!runtimeContext.currentHqlFile) {
    return null;
  }

  const fallback = await findErrorLocationInSource(
    error,
    runtimeContext.currentHqlFile,
  );
  if (!fallback) {
    return null;
  }

  return {
    filePath: runtimeContext.currentHqlFile,
    line: fallback.line,
    column: fallback.column,
  };
}

// Recursion guard: prevents infinite loop if error handler throws during handling
let isHandlingError = false;

/**
 * Enhanced error handling for runtime errors
 * @returns The RuntimeError that should be thrown, or the original error if handling failed
 */
export async function handleRuntimeError(
  error: Error,
  options: {
    debug?: boolean;
    verboseErrors?: boolean;
    showInternalErrors?: boolean;
  } = {},
): Promise<RuntimeError> {
  // Prevent infinite recursion if error occurs during error handling
  if (isHandlingError) {
    console.error("[HQL] Critical: Error in error handler:", error.message);
    return new RuntimeError(error.message, { originalError: error });
  }
  isHandlingError = true;

  const debugOutput = Boolean(
    options.debug || options.verboseErrors || options.showInternalErrors,
  );

  try {
    // Skip if already handled - just wrap and return
    if (Object.prototype.hasOwnProperty.call(error, ERROR_REPORTED_SYMBOL)) {
      if (error instanceof RuntimeError) {
        return error;
      }
      // Wrap non-RuntimeError that was already handled
      return new RuntimeError(error.message, {
        filePath: runtimeContext.currentHqlFile,
        originalError: error,
      });
    }

    // If error is already an HQLError (ParseError, ImportError, etc.),
    // preserve its error code and information
    if (error instanceof HQLError) {
      const targetFile = error.sourceLocation?.filePath || runtimeContext.currentHqlFile;

      // Create RuntimeError that preserves the original error code
      const hqlError = new RuntimeError(error.message, {
        filePath: targetFile,
        line: error.sourceLocation?.line,
        column: error.sourceLocation?.column,
        originalError: error,
        code: error.code, // Preserve the original error code!
      });

      // Copy context lines if available, or load them if we have location info
      if (error.contextLines && error.contextLines.length > 0) {
        hqlError.contextLines = error.contextLines;
      } else if (error.sourceLocation?.line && targetFile) {
        // Try to load context lines from the source file
        const contextLines = await readContextLines(targetFile, error.sourceLocation.line);
        hqlError.contextLines = contextLines.map((line) => {
          if (line.isError && error.sourceLocation?.column) {
            return { ...line, column: error.sourceLocation.column };
          }
          return line;
        });
      }

      // Report the error
      await globalErrorReporter.reportError(hqlError, debugOutput);

      // Mark as handled
      Object.defineProperty(error, ERROR_REPORTED_SYMBOL, {
        value: true,
        enumerable: false,
      });

      return hqlError;
    }

    // Try to get a meaningful error location
    const locationInfo = await resolveRuntimeLocation(error);

    // Trigger Error.prepareStackTrace by accessing the stack property
    // This ensures the stack is formatted with source map support before wrapping
    const _stack = error.stack;

    // Create a RuntimeError with HQL error code
    const targetFile = locationInfo?.filePath || runtimeContext.currentHqlFile;
    const hqlError = new RuntimeError(error.message, {
      filePath: targetFile,
      line: locationInfo?.line,
      column: locationInfo?.column,
      originalError: error,
    });

    // Update the stack and message to use HQL line numbers instead of JS line numbers
    // This is important for errors that don't get transformed by Error.prepareStackTrace (like SyntaxError)
    if (locationInfo && runtimeContext.currentJsFile) {
      const jsPath = runtimeContext.currentJsFile;
      const hqlPath = locationInfo.filePath;

      if (hqlError.stack && hqlPath) {
        // Replace all occurrences of the JS file path and line with HQL path and line
        // Pattern: /path/to/file.mjs:lineNum:colNum -> /path/to/file.hql:hqlLineNum:colNum
        hqlError.stack = hqlError.stack.replace(
          new RegExp(escapeRegExp(jsPath) + ':(\\d+):(\\d+)', 'g'),
          `${hqlPath}:${locationInfo.line}:${locationInfo.column}`
        );
      }
    }

    // Add context lines if we have a valid location
    if (locationInfo && locationInfo.line && targetFile) {
      const contextLines = await readContextLines(
        targetFile,
        locationInfo.line,
      );
      hqlError.contextLines = contextLines.map((line) => {
        if (line.isError) {
          return { ...line, column: locationInfo.column };
        }
        return line;
      });
    }

    // Override the suggestion method based on the error type
    const suggestion = getErrorSuggestion(error);
    if (suggestion) {
      hqlError.getSuggestion = () => suggestion;
    }

    // Report the error with the enhanced HQL information
    await globalErrorReporter.reportError(hqlError, debugOutput);

    // Mark original error as handled to prevent double-handling
    Object.defineProperty(error, ERROR_REPORTED_SYMBOL, {
      value: true,
      enumerable: false,
    });

    // Return the RuntimeError for the caller to throw
    return hqlError;
  } catch (handlerError) {
    // If our error handler fails, log it and fallback to reporting the original error
    logger.error(
      `Error in runtime error handler: ${
        handlerError instanceof Error
          ? handlerError.message
          : String(handlerError)
      }`,
    );
    await globalErrorReporter.reportError(error, debugOutput);

    // Return a basic RuntimeError wrapping the original
    return new RuntimeError(error.message, {
      filePath: runtimeContext.currentHqlFile,
      originalError: error,
    });
  } finally {
    isHandlingError = false;
  }
}

/**
 * Get a "Did you mean?" suggestion for an unknown identifier.
 * Uses Damerau-Levenshtein distance which handles transpositions.
 * Returns Rust-style suggestion with backticks.
 */
function getDidYouMeanSuggestion(unknownName: string): string | null {
  const candidates = getAllKnownIdentifiers();
  const suggestion = findSimilarName(unknownName, candidates);

  if (suggestion) {
    return `Did you mean \`${suggestion}\`?`;
  }

  return null;
}

/**
 * Get a suggestion based on the type of error
 * Provides comprehensive, context-aware suggestions for all runtime error types
 */
function getErrorSuggestion(error: Error): string | undefined {
  const rawMessage = error.message;
  const normalized = rawMessage.toLowerCase();
  const errorName = error.name?.toLowerCase() ?? "";

  // ==========================================================================
  // Function argument errors
  // ==========================================================================
  if (messageIncludesAll(normalized, "too many", "arguments")) {
    const funcName = matchFirstGroup(
      rawMessage,
      /function ['"]?([^'"]+?)['"]?[.:\s]/,
    ) ?? "";

    return `Check the number of arguments being passed to ${
      funcName ? `'${funcName}'` : "the function"
    }. You might be passing more arguments than the function accepts.`;
  }

  if (messageIncludesAll(normalized, "missing", "argument")) {
    const paramName = matchFirstGroup(
      rawMessage,
      /parameter ['"]?([^'"]+?)['"]?/,
    ) ?? "";

    return `Make sure you provide all required arguments to the function. ${
      paramName ? `The parameter '${paramName}' is missing.` : ""
    }`;
  }

  // ==========================================================================
  // Undefined variable / function not found
  // ==========================================================================
  if (messageIncludesAny(normalized, "is not defined")) {
    const varName = matchFirstGroup(
      rawMessage,
      /['"]?([^'"]+?)['"]?\s+is not defined/,
    ) ?? "";

    // Try to find a similar name - Rust-style prominent suggestion
    const didYouMean = varName ? getDidYouMeanSuggestion(varName) : null;

    if (didYouMean) {
      // Lead with the suggestion (like Rust does)
      return didYouMean;
    }

    return `Check that \`${varName}\` is spelled correctly and has been declared before use.`;
  }

  if (messageIncludesAny(normalized, "is not a function")) {
    const name = matchFirstGroup(
      rawMessage,
      /['"]?([^'"]+?)['"]?\s+is not a function/,
    ) ?? "";

    // Try to find a similar function name - Rust-style
    const didYouMean = name ? getDidYouMeanSuggestion(name) : null;

    if (didYouMean) {
      return didYouMean;
    }

    return `\`${name}\` is not callable. Check that it's a function before invoking.`;
  }

  // ==========================================================================
  // Null/undefined reference errors (Cannot read properties of null/undefined)
  // ==========================================================================
  if (messageIncludesAll(normalized, "cannot read", "null")) {
    const propName = matchFirstGroup(
      rawMessage,
      /reading ['"]?([^'"]+?)['"]?\)?$/,
    ) ?? "";

    return `Attempted to access property '${propName}' on a null value. Add a null check before accessing: (if (not (null? value)) (value.${propName})) or use optional chaining syntax.`;
  }

  if (messageIncludesAll(normalized, "cannot read", "undefined")) {
    const propName = matchFirstGroup(
      rawMessage,
      /reading ['"]?([^'"]+?)['"]?\)?$/,
    ) ?? "";

    return `Attempted to access property '${propName}' on an undefined value. The variable may not be initialized or may have been set incorrectly. Check that the value exists before accessing its properties.`;
  }

  if (messageIncludesAll(normalized, "cannot set", "null")) {
    const propName = matchFirstGroup(
      rawMessage,
      /property ['"]?([^'"]+?)['"]?/,
    ) ?? "";

    return `Cannot set property '${propName}' on null. The object you're trying to modify is null. Ensure the object is properly initialized before setting properties.`;
  }

  if (messageIncludesAll(normalized, "cannot set", "undefined")) {
    const propName = matchFirstGroup(
      rawMessage,
      /property ['"]?([^'"]+?)['"]?/,
    ) ?? "";

    return `Cannot set property '${propName}' on undefined. The object doesn't exist. Make sure to create the object before trying to set its properties.`;
  }

  // ==========================================================================
  // Type errors
  // ==========================================================================
  if (messageIncludesAny(normalized, "type error", "typeerror") || errorName === "typeerror") {
    // Generic type error
    if (messageIncludesAny(normalized, "cannot convert", "is not iterable", "not iterable")) {
      return "Type mismatch: The value cannot be used in this context. Check that you're using the correct type. For iteration, ensure the value is an array, string, or other iterable.";
    }

    if (messageIncludesAny(normalized, "reduce of empty array")) {
      return "Cannot reduce an empty array without an initial value. Either provide an initial value as the second argument to reduce, or ensure the array is not empty.";
    }

    return "A type error occurred. Check that the values you're using have the expected types. Common issues: passing wrong type to a function, using null/undefined where an object is expected.";
  }

  // ==========================================================================
  // Division by zero
  // ==========================================================================
  if (messageIncludesAny(normalized, "division by zero", "divide by zero", "infinity")) {
    return "Division by zero detected. Add a check to ensure the divisor is not zero before dividing: (if (not (= divisor 0)) (/ dividend divisor) default-value)";
  }

  // ==========================================================================
  // Regular expression errors
  // ==========================================================================
  if (messageIncludesAny(normalized, "invalid regular expression", "invalid regex")) {
    const detail = matchFirstGroup(
      rawMessage,
      /invalid regular expression:.*?\/(.+?)\//i,
    ) ?? "";

    return `Invalid regular expression${detail ? `: /${detail}/` : ""}. Common issues: unescaped special characters (use \\\\ for backslash), unbalanced brackets, invalid quantifiers. Check the regex syntax.`;
  }

  if (messageIncludesAny(normalized, "unterminated character class")) {
    return "Unterminated character class in regex. A '[' was opened but not closed with ']'. Make sure all character classes are properly closed.";
  }

  if (messageIncludesAny(normalized, "unterminated group")) {
    return "Unterminated group in regex. A '(' was opened but not closed with ')'. Make sure all groups are properly closed.";
  }

  // ==========================================================================
  // Stack overflow / recursion errors
  // ==========================================================================
  if (messageIncludesAny(normalized, "maximum call stack", "stack overflow", "too much recursion")) {
    return "Maximum call stack size exceeded (stack overflow). This usually means infinite recursion. Check that: (1) recursive functions have a proper base case, (2) there are no accidental infinite loops, (3) mutual recursion terminates.";
  }

  // ==========================================================================
  // JSON parse errors
  // ==========================================================================
  if (messageIncludesAny(normalized, "json", "unexpected token") && errorName === "syntaxerror") {
    const position = matchFirstGroup(rawMessage, /position (\d+)/i);
    const positionHint = position ? ` at position ${position}` : "";

    return `JSON parsing failed${positionHint}. Common issues: missing quotes around keys, trailing commas, single quotes instead of double quotes, unescaped special characters in strings.`;
  }

  if (messageIncludesAll(normalized, "json", "parse")) {
    return "Failed to parse JSON string. Ensure the input is valid JSON: keys must be double-quoted strings, no trailing commas, no comments, and all strings must use double quotes.";
  }

  // ==========================================================================
  // Range errors
  // ==========================================================================
  if (errorName === "rangeerror") {
    if (messageIncludesAny(normalized, "invalid array length")) {
      return "Invalid array length. Array length must be a non-negative integer less than 2^32. Check that you're not passing a negative number or NaN to Array constructor.";
    }

    if (messageIncludesAny(normalized, "invalid string length")) {
      return "String length exceeds maximum allowed size. The operation would create a string that's too large. Consider processing data in smaller chunks.";
    }

    if (messageIncludesAny(normalized, "precision")) {
      return "Number precision out of range. The precision argument must be between 0 and 100 for toFixed/toPrecision methods.";
    }

    return "Value is out of the allowed range. Check that numeric values are within acceptable bounds for the operation.";
  }

  // ==========================================================================
  // Assignment errors (strict mode)
  // ==========================================================================
  if (messageIncludesAny(normalized, "cannot assign to read only", "read-only", "readonly")) {
    const propName = matchFirstGroup(rawMessage, /property ['"]?([^'"]+?)['"]?/i) ?? "";
    return `Cannot assign to read-only property${propName ? ` '${propName}'` : ""}. The property or variable is immutable (defined with const or as a read-only property). If you need to modify it, use let instead of const or make the property writable.`;
  }

  if (messageIncludesAny(normalized, "assignment to constant", "const", "immutable")) {
    return "Cannot reassign a constant variable. Variables declared with 'const' cannot be reassigned. Use 'let' if you need to reassign the variable, or use mutation methods for objects/arrays.";
  }

  // ==========================================================================
  // Promise/async errors
  // ==========================================================================
  if (messageIncludesAny(normalized, "unhandled promise rejection", "promise rejection")) {
    return "An unhandled Promise rejection occurred. Make sure to: (1) use try/catch around await calls, (2) add .catch() handlers to promises, (3) handle all error cases in async functions.";
  }

  if (messageIncludesAny(normalized, "await is only valid", "cannot use await")) {
    return "The 'await' keyword can only be used inside async functions. Either mark the containing function as async, or use .then()/.catch() for Promise handling.";
  }

  // ==========================================================================
  // URI errors
  // ==========================================================================
  if (errorName === "urierror" || messageIncludesAny(normalized, "uri", "malformed", "decode")) {
    return "URI encoding/decoding error. The string contains invalid URI sequences. Make sure to use encodeURIComponent before decoding, and that the input is properly encoded.";
  }

  // ==========================================================================
  // Eval errors (security)
  // ==========================================================================
  if (errorName === "evalerror" || messageIncludesAll(normalized, "eval", "error")) {
    return "Error in eval() call. Avoid using eval() as it poses security risks and makes debugging difficult. Consider using safer alternatives like JSON.parse() for data or Function() for dynamic code.";
  }

  // ==========================================================================
  // Module/import errors
  // ==========================================================================
  if (messageIncludesAny(normalized, "module", "import", "export")) {
    if (messageIncludesAny(normalized, "not found", "cannot find")) {
      return "Module not found. Check that: (1) the file path is correct, (2) the file exists, (3) the module name is spelled correctly, (4) the module is installed if it's a third-party package.";
    }
    if (messageIncludesAny(normalized, "does not provide", "no export")) {
      return "The requested export was not found in the module. Check that: (1) the export name is spelled correctly, (2) you're using the right import syntax (default vs named), (3) the module actually exports what you're trying to import.";
    }
  }

  // ==========================================================================
  // Network errors
  // ==========================================================================
  if (messageIncludesAny(normalized, "network", "fetch", "connection")) {
    if (messageIncludesAny(normalized, "failed", "refused", "timeout")) {
      return "Network request failed. Check your internet connection, verify the URL is correct, and ensure the server is accessible. For CORS issues, the server may need to allow cross-origin requests.";
    }
  }

  // ==========================================================================
  // Generic syntax error (non-parse, runtime syntax issues)
  // ==========================================================================
  if (errorName === "syntaxerror") {
    if (messageIncludesAny(normalized, "unexpected identifier")) {
      return "Unexpected identifier in JavaScript. This might be caused by: missing operators between expressions, forgotten parentheses, or invalid syntax in generated code.";
    }

    if (messageIncludesAny(normalized, "unexpected end")) {
      return "Unexpected end of input. The code is incomplete - check for missing closing braces, parentheses, or quotes.";
    }

    return "Syntax error in generated JavaScript. This might indicate an issue with the HQL code structure. Check for malformed expressions or unsupported syntax.";
  }

  // ==========================================================================
  // Reference error (catch-all for undefined references)
  // ==========================================================================
  if (errorName === "referenceerror") {
    const varName = matchFirstGroup(rawMessage, /(['"]?[^'"]+?)['"]?\s+is not defined/i) ?? "";

    // Try to find a similar name
    const didYouMean = varName ? getDidYouMeanSuggestion(varName) : null;
    const suggestion = didYouMean
      ? `${didYouMean} `
      : "";

    return `Reference error: '${varName}' is not accessible. ${suggestion}This usually means the variable doesn't exist in the current scope. Check spelling, scope, and declaration order.`;
  }

  // ==========================================================================
  // Fallback: Context-aware generic suggestion based on error code
  // ==========================================================================
  return getGenericSuggestion(error);
}

/**
 * Provide a context-aware generic suggestion when no specific pattern matches
 */
function getGenericSuggestion(error: Error): string {
  const errorName = error.name?.toLowerCase() ?? "";

  // Map error types to helpful generic messages
  const suggestions: Record<string, string> = {
    "typeerror": "Check that values have the expected types. Ensure you're not calling methods on null/undefined or using incompatible types.",
    "referenceerror": "Check that all variables and functions are defined before use. Look for typos in names or scope issues.",
    "rangeerror": "A value is out of its allowed range. Check numeric bounds and array/string lengths.",
    "syntaxerror": "Check the syntax near this location. Look for missing or extra punctuation, brackets, or quotes.",
    "urierror": "Check URI encoding/decoding. Ensure strings are properly encoded before decoding.",
    "evalerror": "Avoid using eval(). Use safer alternatives like JSON.parse() or structured data parsing.",
    "internalerror": "An internal error occurred. This might be due to resource limits (stack, memory). Try simplifying the code.",
  };

  if (errorName && suggestions[errorName]) {
    return suggestions[errorName];
  }

  // Ultimate fallback with actionable advice
  return "Check the code near this location for errors. Common issues: undefined variables, null references, type mismatches, or missing imports.";
}

function matchFirstGroup(message: string, pattern: RegExp): string | null {
  const result = message.match(pattern);
  return result && result[1] ? result[1] : null;
}

function messageIncludesAll(message: string, ...needles: string[]): boolean {
  return needles.every((needle) => message.includes(needle));
}

function messageIncludesAny(message: string, ...needles: string[]): boolean {
  return needles.some((needle) => message.includes(needle));
}

function extractSearchKeywords(message: string): string[] {
  const tokens = message
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3);

  return Array.from(new Set(tokens));
}

async function findErrorLocationInSource(
  error: Error,
  hqlFile: string,
): Promise<{ line: number; column: number } | null> {
  const lines = await readFileLines(hqlFile);
  if (!lines) {
    return null;
  }
  try {
    const rawMessage = error.message;
    const normalizedMessage = rawMessage.toLowerCase();

    // Special handling for function argument errors
    if (messageIncludesAll(normalizedMessage, "too many", "arguments")) {
      const funcName = matchFirstGroup(
        rawMessage,
        /function ['"]?([^'"]+?)['"]?[.:\s]/,
      );

      if (funcName) {
        const match = findFunctionCall(lines, funcName);
        if (match) {
          return {
            line: match.line,
            column: match.column,
          };
        }
      }
    }

    // Missing required arguments
    if (messageIncludesAll(normalizedMessage, "missing", "argument")) {
      const funcName = matchFirstGroup(
        rawMessage,
        /function ['"]?([^'"]+?)['"]?/,
      );

      if (funcName) {
        const match = findFunctionCall(lines, funcName);
        if (match) {
          return {
            line: match.line,
            column: match.column,
          };
        }
      }
    }

    // Default to searching for the function name or error keywords
    const keywords = extractSearchKeywords(normalizedMessage);

    for (let i = 0; i < lines.length; i++) {
      for (const keyword of keywords) {
        if (lines[i].includes(keyword)) {
          return {
            line: i + 1,
            column: lines[i].indexOf(keyword) + 1,
          };
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

interface FunctionCallLocation {
  line: number;
  column: number;
}

function findFunctionCall(
  lines: string[],
  funcName: string,
): FunctionCallLocation | null {
  const sexpPattern = createSExpCallRegex(funcName);
  const jsPattern = createJsCallRegex(funcName);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sexpIndex = line.search(sexpPattern);
    if (sexpIndex >= 0) {
      return { line: i + 1, column: sexpIndex + 1 };
    }

    const jsIndex = line.search(jsPattern);
    if (jsIndex >= 0) {
      return { line: i + 1, column: jsIndex + 1 };
    }
  }

  return null;
}
