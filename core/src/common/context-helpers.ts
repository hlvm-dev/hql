/**
 * Unified context line extraction helpers.
 * Consolidates duplicate logic across error handlers.
 */

import { exists, readTextFile } from "../platform/platform.ts";
import { globalLogger as logger } from "../logger.ts";

/**
 * Represents a line of source code with context information.
 */
export interface ContextLine {
  /** 1-based line number */
  line: number;
  /** Content of the line */
  content: string;
  /** Whether this is the error line */
  isError: boolean;
  /** Optional column number (only present for error line) */
  column?: number;
}

/**
 * Extract context lines from source code string.
 *
 * @param source - Source code as a string
 * @param errorLine - 1-based line number where error occurred
 * @param errorColumn - Optional column number for the error
 * @param contextSize - Number of lines to show before and after error (default: 2)
 * @returns Array of context lines, or empty array if invalid input
 *
 * @example
 * ```typescript
 * const source = "line 1\nline 2\nline 3\nline 4\nline 5";
 * const context = extractContextLinesFromSource(source, 3, 5, 1);
 * // Returns lines 2, 3 (error), 4 with line 3 marked as error at column 5
 * ```
 */
export function extractContextLinesFromSource(
  source: string,
  errorLine: number,
  errorColumn?: number,
  contextSize: number = 2,
): ContextLine[] {
  if (!source || errorLine <= 0 || !Number.isFinite(errorLine)) {
    return [];
  }

  const lines = source.split(/\r?\n/);

  // Validate line number is in range
  if (errorLine > lines.length) {
    return [];
  }

  const result: ContextLine[] = [];

  // Calculate range (errorLine is 1-based, array is 0-based)
  const startLine = Math.max(0, errorLine - contextSize - 1);
  const endLine = Math.min(lines.length - 1, errorLine - 1 + contextSize);

  // Build context lines
  for (let i = startLine; i <= endLine; i++) {
    const lineNumber = i + 1; // Convert to 1-based
    const isErrorLine = lineNumber === errorLine;

    result.push({
      line: lineNumber,
      content: lines[i] || "",
      isError: isErrorLine,
      column: isErrorLine ? errorColumn : undefined,
    });
  }

  return result;
}

/**
 * Extract context lines from a source file.
 *
 * @param filePath - Path to the source file
 * @param errorLine - 1-based line number where error occurred
 * @param errorColumn - Optional column number for the error
 * @param contextSize - Number of lines to show before and after error (default: 2)
 * @returns Promise resolving to array of context lines, or null if file cannot be read
 *
 * @example
 * ```typescript
 * const context = await extractContextLinesFromFile("./code.hql", 10, 5, 2);
 * if (context) {
 *   context.forEach(line => {
 *     console.log(`${line.line}: ${line.content} ${line.isError ? '<-- ERROR' : ''}`);
 *   });
 * }
 * ```
 */
export async function extractContextLinesFromFile(
  filePath: string,
  errorLine: number,
  errorColumn?: number,
  contextSize: number = 2,
): Promise<ContextLine[] | null> {
  try {
    // Check if file exists
    if (!await exists(filePath)) {
      logger.debug(`Cannot load context: File does not exist: ${filePath}`);
      return null;
    }

    // Read file content
    const source = await readTextFile(filePath);

    // Use sync version to extract lines
    const result = extractContextLinesFromSource(
      source,
      errorLine,
      errorColumn,
      contextSize,
    );

    // Return null if extraction failed
    if (result.length === 0 && errorLine > 0) {
      logger.debug(
        `Cannot load context: Line number ${errorLine} out of range or invalid`,
      );
      return null;
    }

    return result;
  } catch (error) {
    logger.debug(
      `Error loading context lines from ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}
