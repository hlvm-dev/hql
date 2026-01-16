/**
 * Stack Trace Transformation Utility
 *
 * Manually transforms JavaScript stack traces to show HQL source positions
 * using generated source maps. This is needed because Deno does not
 * automatically apply source maps for dynamically imported .js files.
 *
 * Usage:
 * ```typescript
 * try {
 *   // HQL code that errors
 * } catch (error) {
 *   const transformed = await transformStackTrace(error);
 *   console.log(transformed);
 * }
 * ```
 */

import { mapPositionSync } from "./source-map-support.ts";
import { globalLogger as logger } from "../../../logger.ts";

// Pre-compiled stack trace parsing patterns
const STACK_FRAME_WITH_PARENS_REGEX = /^(\s+at\s+)(.+?)\s+\((.+):(\d+):(\d+)\)$/;
const STACK_FRAME_NO_PARENS_REGEX = /^(\s+at\s+)(.+):(\d+):(\d+)$/;

/**
 * Transform a JavaScript stack trace to show HQL source positions
 *
 * Parses each line of the stack trace, extracts file:line:column info,
 * looks up the source map, and replaces with HQL positions.
 *
 * @param error - The error with a JavaScript stack trace
 * @returns Transformed stack trace string with HQL positions
 *
 * @example
 * try {
 *   await import("/tmp/output.js");  // HQL-generated code
 * } catch (error) {
 *   const hqlStack = await transformStackTrace(error);
 *   console.log(hqlStack);
 *   // Output: "at divide (math.hql:15:3)"
 * }
 */
export function transformStackTrace(error: Error): string {
  if (!error.stack) {
    return `${error.name}: ${error.message}`;
  }

  const lines = error.stack.split("\n");
  const result: string[] = [];

  // First line is the error message
  result.push(lines[0]);

  // Process each stack frame
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    // Try two regex patterns:
    // 1. With function name: "    at functionName (file:line:column)"
    // 2. Without function name: "    at file:line:column"

    let match = line.match(STACK_FRAME_WITH_PARENS_REGEX);
    let hasFunction = true;

    if (!match) {
      // Try pattern without function name
      match = line.match(STACK_FRAME_NO_PARENS_REGEX);
      hasFunction = false;
    }

    if (match) {
      let indent, funcName, filePath, lineStr, colStr;

      if (hasFunction) {
        [, indent, funcName, filePath, lineStr, colStr] = match;
      } else {
        [, indent, filePath, lineStr, colStr] = match;
        funcName = "<anonymous>";
      }

      const lineNum = parseInt(lineStr, 10);
      const colNum = parseInt(colStr, 10);

      // Normalize file path: remove file:// protocol and query strings
      let normalizedPath = filePath;
      if (normalizedPath.startsWith("file://")) {
        normalizedPath = normalizedPath.substring(7); // Remove "file://"
      }
      // Remove query string if present
      const queryIndex = normalizedPath.indexOf("?");
      if (queryIndex !== -1) {
        normalizedPath = normalizedPath.substring(0, queryIndex);
      }

      // Try to map using source map
      const mapped = mapPositionSync(normalizedPath, lineNum, colNum);

      if (mapped) {
        // Successfully mapped to HQL source!
        const hqlLine = hasFunction
          ? `${indent}${funcName} (${mapped.source}:${mapped.line}:${
            mapped.column + 1
          })`
          : `${indent}${mapped.source}:${mapped.line}:${mapped.column + 1}`;
        result.push(hqlLine);
        logger.debug(
          `Mapped ${filePath}:${lineNum}:${colNum} → ${mapped.source}:${mapped.line}:${mapped.column}`,
        );
      } else {
        // No source map - keep original
        result.push(line);
      }
    } else {
      // Doesn't match expected format - keep original
      result.push(line);
    }
  }

  return result.join("\n");
}

/**
 * Wrap a function to automatically transform stack traces
 *
 * Returns a wrapped version of the function that catches errors
 * and transforms their stack traces before re-throwing.
 *
 * @param fn - Async function to wrap
 * @returns Wrapped function with stack trace transformation
 *
 * @example
 * const runWithSourceMaps = withTransformedStackTraces(async () => {
 *   await import("/tmp/output.js");
 * });
 *
 * try {
 *   await runWithSourceMaps();
 * } catch (error) {
 *   // error.stack now shows HQL positions
 * }
 */
export function withTransformedStackTraces<T>(
  fn: () => Promise<T>,
): () => Promise<T> {
  return async () => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Error) {
        // Transform the stack trace
        error.stack = transformStackTrace(error);
      }
      throw error;
    }
  };
}
