// src/common/error-system.ts - Improved error reporting

// Pre-compiled patterns for error location inference
const TYPO_FOM_REGEX = /\bfom\b/;

import { HQLError, RuntimeError } from "./error.ts";
import { globalLogger as logger } from "../logger.ts";
import { getErrorMessage, LINE_SPLIT_REGEX } from "./utils.ts";
import {
  handleRuntimeError,
  initializeErrorHandling,
  resolveRuntimeLocation,
} from "./runtime-error-handler.ts";
import { getPlatform } from "../platform/platform.ts";
import { extractContextLinesFromSource } from "./context-helpers.ts";

interface ErrorSystemOptions {
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
        getPlatform().process.exit(1);
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

  // Early return: already has context lines
  if (
    workingError instanceof HQLError &&
    workingError.contextLines &&
    workingError.contextLines.length > 0
  ) {
    return workingError;
  }

  // Attempt to resolve source-map location from runtime stack
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
        `Failed to resolve runtime location: ${getErrorMessage(mappingError)}`,
      );
    }
  }

  // Apply mapped location to the error
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

  // Backfill filePath on HQLError if still missing
  if (workingError instanceof HQLError && !workingError.sourceLocation.filePath && filePath) {
    workingError.sourceLocation.filePath = filePath;
  }

  // Determine source path for context extraction
  const sourcePath = workingError instanceof HQLError
    ? workingError.sourceLocation.filePath || filePath
    : filePath;

  // Early return: no source file to read
  if (!sourcePath) return workingError;

  try {
    const content = await getPlatform().fs.readTextFile(sourcePath);

    if (!(workingError instanceof HQLError)) {
      // Wrap plain Error as HQLError and infer location
      const hqlError = new HQLError(workingError.message, {
        errorType: "Error",
        originalError: workingError,
        sourceLocation: { filePath: sourcePath },
      });
      return inferErrorLocationFromMessage(hqlError, content);
    }

    if (workingError.sourceLocation.line) {
      workingError.contextLines = extractContextLinesFromSource(
        content,
        workingError.sourceLocation.line,
        workingError.sourceLocation.column,
        2,
      );
    } else {
      workingError = inferErrorLocationFromMessage(workingError, content);
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
  const lines = fileContent.split(LINE_SPLIT_REGEX);
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
  const c = char.charCodeAt(0);
  return (c >= 48 && c <= 57) ||  // 0-9
         (c >= 65 && c <= 90) ||  // A-Z
         (c >= 97 && c <= 122) || // a-z
         c === 95;                // _
}

// Re-export setRuntimeContext as setErrorContext for cleaner API
export { setRuntimeContext as setErrorContext } from "./runtime-error-handler.ts";
