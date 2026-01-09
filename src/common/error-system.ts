// core/src/common/error-system.ts - Improved error reporting

// Pre-compiled patterns for error location inference
const TYPO_FOM_REGEX = /\bfom\b/;
const ALPHANUMERIC_REGEX = /[a-zA-Z0-9_]/;

import { HQLError, RuntimeError } from "./error.ts";
import { globalLogger as logger } from "../logger.ts";
import { getErrorMessage } from "./utils.ts";
import {
  handleRuntimeError,
  initializeErrorHandling,
  resolveRuntimeLocation,
} from "./runtime-error-handler.ts";
import { exit as platformExit, readTextFile } from "../platform/platform.ts";
import { extractContextLinesFromSource } from "./context-helpers.ts";

export interface ErrorSystemOptions {
  debug?: boolean;
  verboseErrors?: boolean;
  showInternalErrors?: boolean;
}

const defaultErrorConfig: Required<ErrorSystemOptions> = {
  debug: false,
  verboseErrors: false,
  showInternalErrors: false,
};

let currentErrorConfig: Required<ErrorSystemOptions> = {
  ...defaultErrorConfig,
};

function mergeConfig(
  base: Required<ErrorSystemOptions>,
  overrides: Partial<ErrorSystemOptions>,
): Required<ErrorSystemOptions> {
  return {
    debug: overrides.debug ?? base.debug,
    verboseErrors: overrides.verboseErrors ?? base.verboseErrors,
    showInternalErrors: overrides.showInternalErrors ?? base.showInternalErrors,
  };
}

export function getErrorConfig(): Required<ErrorSystemOptions> {
  return { ...currentErrorConfig };
}

export function updateErrorConfig(
  options: Partial<ErrorSystemOptions>,
): Required<ErrorSystemOptions> {
  currentErrorConfig = mergeConfig(currentErrorConfig, options);
  return getErrorConfig();
}

export function initializeErrorSystem(
  options: Partial<ErrorSystemOptions> = {},
): void {
  updateErrorConfig(options);
  initializeErrorHandling();
}

export interface RunWithErrorHandlingOptions extends ErrorSystemOptions {
  exitOnError?: boolean;
  currentFile?: string;
}

export async function runWithErrorHandling<T>(
  fn: () => Promise<T>,
  options: RunWithErrorHandlingOptions = {},
): Promise<T> {
  const previousConfig = currentErrorConfig;
  const mergedConfig = mergeConfig(currentErrorConfig, options);
  currentErrorConfig = mergedConfig;

  try {
    return await fn();
  } catch (error) {
    if (error instanceof Error) {
      await handleRuntimeError(error, mergedConfig);
      if (options.exitOnError) {
        platformExit(1);
      }
    }
    throw error;
  } finally {
    currentErrorConfig = previousConfig;
  }
}

/**
 * Enhanced error enrichment function that tries to add source context
 * This is especially useful for validation errors that lack source location
 */
export async function enrichErrorWithContext(
  error: Error | HQLError,
  filePath?: string,
): Promise<Error | HQLError> {
  let workingError: Error | HQLError = error;

  // If it's already an HQLError with context, don't modify it
  if (
    workingError instanceof HQLError &&
    workingError.contextLines &&
    workingError.contextLines.length > 0
  ) {
    return workingError;
  }

  const runtimeCandidate = workingError instanceof HQLError
    ? workingError.originalError
    : workingError;

  let mappedLocation:
    | { filePath?: string; line?: number; column?: number }
    | null = null;
  if (runtimeCandidate instanceof Error) {
    try {
      mappedLocation = await resolveRuntimeLocation(runtimeCandidate);
    } catch (mappingError) {
      logger.debug(
        `Failed to resolve runtime location: ${
          mappingError instanceof Error
            ? mappingError.message
            : String(mappingError)
        }`,
      );
    }
  }

  if (mappedLocation) {
    const resolvedFile = mappedLocation.filePath ?? filePath;

    if (workingError instanceof HQLError) {
      if (resolvedFile && !workingError.sourceLocation.filePath) {
        workingError.sourceLocation.filePath = resolvedFile;
      }
      if (mappedLocation.line && !workingError.sourceLocation.line) {
        workingError.sourceLocation.line = mappedLocation.line;
      }
      if (mappedLocation.column && !workingError.sourceLocation.column) {
        workingError.sourceLocation.column = mappedLocation.column;
      }
    } else {
      workingError = new RuntimeError(workingError.message, {
        filePath: resolvedFile,
        line: mappedLocation.line,
        column: mappedLocation.column,
        originalError: workingError,
      });
    }

    if (!filePath && resolvedFile) {
      filePath = resolvedFile;
    }
  }

  // If it's an HQLError but missing source location info, try to add it
  if (workingError instanceof HQLError) {
    if (!workingError.sourceLocation.filePath && filePath) {
      workingError.sourceLocation.filePath = filePath;
    }
  }

  // Extract the source file path from the error or use provided filePath
  const sourcePath = workingError instanceof HQLError
    ? workingError.sourceLocation.filePath || filePath
    : filePath;

  // Can't add context without a source file
  if (!sourcePath) {
    return workingError;
  }

  try {
    // Try to read the source file
    const content = await readTextFile(sourcePath);

    if (workingError instanceof HQLError) {
      // If we have line info, use it
      if (workingError.sourceLocation.line) {
        // Use unified context extraction helper
        workingError.contextLines = extractContextLinesFromSource(
          content,
          workingError.sourceLocation.line,
          workingError.sourceLocation.column,
          2,
        );
      } else {
        // If we don't have line info, try to infer from error message
        workingError = inferErrorLocationFromMessage(workingError, content);
      }
    } else {
      const hqlError = new HQLError(workingError.message, {
        errorType: "Error",
        originalError: workingError,
        sourceLocation: { filePath: sourcePath },
      });

      const enhancedError = inferErrorLocationFromMessage(hqlError, content);
      return enhancedError;
    }
  } catch (readError) {
    logger.debug(
      `Failed to read source file for context: ${getErrorMessage(readError)}`,
    );
  }

  return workingError;
}

/**
 * Infer error location from the error message
 */
function inferErrorLocationFromMessage(
  error: HQLError,
  fileContent: string,
): HQLError {
  const lines = fileContent.split("\n");
  const errorMsg = error.message.toLowerCase();

  // Look for specific error patterns

  // Import errors - check for import statements
  if (errorMsg.includes("import")) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("import")) {
        // Check for common import typos
        if (errorMsg.includes("invalid") && TYPO_FOM_REGEX.test(line)) {
          const pos = line.search(TYPO_FOM_REGEX);
          error.sourceLocation.line = i + 1;
          error.sourceLocation.column = pos + 1;

          // Add suggestion
          error.getSuggestion = () => "Did you mean 'from' instead of 'fom'?";
          break;
        } else {
          error.sourceLocation.line = i + 1;
          error.sourceLocation.column = line.indexOf("import") + 1;
          break;
        }
      }
    }
  } // Undefined variables or function calls
  else if (
    errorMsg.includes("is not defined") ||
    errorMsg.includes("is not a function")
  ) {
    const match = errorMsg.match(/['"]?([a-zA-Z0-9_]+)['"]?\s+is\s+not/i);
    if (match && match[1]) {
      const name = match[1];

      // Look for the name in the file
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const pos = line.indexOf(name);

        if (
          pos >= 0 && (pos === 0 || !isAlphaNumeric(line[pos - 1])) &&
          (pos + name.length >= line.length ||
            !isAlphaNumeric(line[pos + name.length]))
        ) {
          error.sourceLocation.line = i + 1;
          error.sourceLocation.column = pos + 1;
          break;
        }
      }
    }
  }

  // Add context lines if we found a line - use shared helper to avoid duplication
  if (error.sourceLocation.line) {
    error.contextLines = extractContextLinesFromSource(
      fileContent,
      error.sourceLocation.line,
      error.sourceLocation.column,
      2,
    );
  }

  return error;
}

/**
 * Check if a character is alphanumeric or underscore
 */
function isAlphaNumeric(char: string): boolean {
  return ALPHANUMERIC_REGEX.test(char);
}

// Re-export setRuntimeContext as setErrorContext for cleaner API
export { setRuntimeContext as setErrorContext } from "./runtime-error-handler.ts";
