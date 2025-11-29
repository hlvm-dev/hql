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

/**
 * Global error handler for runtime errors
 */
function installGlobalErrorHandler(): void {
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
    if (frame.jsFile.endsWith(".hql")) {
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
  }
}

/**
 * Get a suggestion based on the type of error
 */
function getErrorSuggestion(error: Error): string | undefined {
  const rawMessage = error.message;
  const normalized = rawMessage.toLowerCase();

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

  if (messageIncludesAny(normalized, "is not defined", "is not a function")) {
    const funcName = matchFirstGroup(
      rawMessage,
      /['"]?([^'"]+?)['"]?\s+is not/,
    ) ?? "";

    return `Check that '${funcName}' is defined and spelled correctly. It might be a typo or the function might not be defined in this scope.`;
  }

  return undefined;
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
