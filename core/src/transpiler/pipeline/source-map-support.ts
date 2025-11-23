/**
 * Runtime Source Map Support for HQL
 *
 * This module provides runtime integration for source maps, transforming
 * JavaScript stack traces to show original HQL file:line:column positions.
 *
 * Key Functions:
 * - loadSourceMap: Load and cache source maps for transpiled files
 * - mapPosition: Convert JS position to HQL position using source map
 * - installSourceMapSupport: Hook into Error.prepareStackTrace
 *
 * @module source-map-support
 */

import { SourceMapConsumer } from "npm:source-map@0.6.1";
import { globalLogger as logger } from "../../logger.ts";
import {
  getEnv as platformGetEnv,
  readTextFile as platformReadTextFile,
  readTextFileSync as platformReadTextFileSync,
  fromFileUrl as platformFromFileUrl,
} from "../../platform/platform.ts";

/**
 * Represents a position in source code
 */
export interface Position {
  /** Source file path */
  source: string;
  /** Line number (1-indexed) */
  line: number;
  /** Column number (0-indexed, Source Map spec) */
  column: number;
  /** Function name at this position (if available) */
  name?: string;
}

/**
 * Cache for loaded source map consumers
 * Key: JavaScript file path
 * Value: SourceMapConsumer instance
 */
const sourceMapCache = new Map<string, SourceMapConsumer>();

/**
 * Load a source map from a .js.map file
 *
 * Loads the source map for a given JavaScript file and caches it
 * for future lookups. The cache prevents redundant file I/O and
 * source map parsing.
 *
 * @param jsFilePath - Path to the JavaScript file (e.g., "/path/to/output.js")
 * @returns SourceMapConsumer instance, or null if source map not found
 *
 * @example
 * const consumer = await loadSourceMap("/tmp/output.js");
 * if (consumer) {
 *   const original = consumer.originalPositionFor({ line: 10, column: 5 });
 *   console.log(original);  // { source: "app.hql", line: 5, column: 2 }
 * }
 */
export async function loadSourceMap(
  jsFilePath: string,
): Promise<SourceMapConsumer | null> {
  // Normalize file path - convert file:// URLs to regular paths
  let normalizedPath = jsFilePath;
  if (jsFilePath.startsWith("file://")) {
    try {
      normalizedPath = platformFromFileUrl(jsFilePath);
    } catch (error) {
      logger.debug(`Failed to normalize file URL ${jsFilePath}: ${
        error instanceof Error ? error.message : String(error)
      }`);
    }
  }

  // Check cache first
  if (sourceMapCache.has(normalizedPath)) {
    logger.debug(`Source map cache hit: ${normalizedPath}`);
    return sourceMapCache.get(normalizedPath)!;
  }

  // Attempt to load .js.map file
  const mapFilePath = normalizedPath + ".map";

  try {
    logger.debug(`Loading source map from ${mapFilePath}`);

    const mapContent = await platformReadTextFile(mapFilePath);
    const mapJson = JSON.parse(mapContent);

    // Create SourceMapConsumer
    const consumer = await new SourceMapConsumer(mapJson);

    // Cache for future use
    sourceMapCache.set(normalizedPath, consumer);

    logger.debug(`Source map loaded and cached: ${normalizedPath}`);

    return consumer;
  } catch (error) {
    logger.debug(
      `Failed to load external source map for ${normalizedPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // If external .map file not found, try to extract inline source map from JS file
  try {
    logger.debug(`Checking for inline source map in ${normalizedPath}`);

    const jsContent = await platformReadTextFile(normalizedPath);
    const sourceMapMatch = jsContent.match(
      /\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/
    );

    if (sourceMapMatch && sourceMapMatch[1]) {
      logger.debug(`Found inline source map in ${normalizedPath}`);

      // Decode base64 source map
      const base64 = sourceMapMatch[1];
      const decoded = atob(base64);
      const mapJson = JSON.parse(decoded);

      const consumer = await new SourceMapConsumer(mapJson);
      sourceMapCache.set(normalizedPath, consumer);

      logger.debug(`Inline source map loaded and cached: ${normalizedPath}`);

      return consumer;
    }
  } catch (error) {
    logger.debug(
      `Failed to load inline source map for ${normalizedPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return null;
}

/**
 * Map a JavaScript position to original HQL position
 *
 * Uses the source map to find the original HQL source location
 * for a given position in generated JavaScript code.
 *
 * @param jsFilePath - Path to the JavaScript file
 * @param line - Line number in JavaScript (1-indexed)
 * @param column - Column number in JavaScript (0-indexed)
 * @returns Original HQL position, or null if mapping not found
 *
 * @example
 * const original = await mapPosition("/tmp/output.js", 127, 5);
 * if (original) {
 *   console.log(`HQL location: ${original.source}:${original.line}:${original.column}`);
 *   // Output: "HQL location: app.hql:5:2"
 * }
 */
export async function mapPosition(
  jsFilePath: string,
  line: number,
  column: number,
): Promise<Position | null> {
  const consumer = await loadSourceMap(jsFilePath);

  if (!consumer) {
    return null;
  }

  try {
    const original = consumer.originalPositionFor({
      line,
      column,
      bias: SourceMapConsumer.GREATEST_LOWER_BOUND,
    });

    if (!original.source || original.line === null) {
      return null;
    }

    return {
      source: original.source,
      line: original.line,
      column: original.column ?? 0,
      name: original.name ?? undefined,
    };
  } catch (error) {
    logger.warn(
      `Failed to map position ${line}:${column} in ${jsFilePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

/**
 * Load a source map from a .js.map file (synchronous version)
 *
 * This is the synchronous version of loadSourceMap(), used by
 * Error.prepareStackTrace which must be synchronous in V8.
 *
 * @param jsFilePath - Path to the JavaScript file
 * @returns SourceMapConsumer instance, or null if source map not found
 *
 * @example
 * const consumer = loadSourceMapSync("/tmp/output.js");
 * if (consumer) {
 *   const original = consumer.originalPositionFor({ line: 10, column: 5 });
 * }
 */
function loadSourceMapSync(
  jsFilePath: string,
): SourceMapConsumer | null {
  // Normalize file path - convert file:// URLs to regular paths
  let normalizedPath = jsFilePath;
  if (jsFilePath.startsWith("file://")) {
    try {
      normalizedPath = platformFromFileUrl(jsFilePath);
    } catch (error) {
      logger.debug(`Failed to normalize file URL ${jsFilePath}: ${
        error instanceof Error ? error.message : String(error)
      }`);
    }
  }

  // Check cache first
  if (sourceMapCache.has(normalizedPath)) {
    logger.debug(`Source map cache hit (sync): ${normalizedPath}`);
    return sourceMapCache.get(normalizedPath)!;
  }

  // Attempt to load .js.map file synchronously
  const mapFilePath = normalizedPath + ".map";

  try {
    logger.debug(`Loading source map (sync) from ${mapFilePath}`);

    // Use synchronous file read
    const mapContent = platformReadTextFileSync(mapFilePath);
    const mapJson = JSON.parse(mapContent);

    // Create SourceMapConsumer synchronously
    // In source-map@0.6.1, the constructor is synchronous and returns the instance directly
    const consumer = new SourceMapConsumer(mapJson);

    // Cache for future use
    sourceMapCache.set(normalizedPath, consumer);

    logger.debug(`Source map loaded and cached (sync): ${normalizedPath}`);

    return consumer;
  } catch (error) {
    logger.debug(
      `Failed to load external source map for ${normalizedPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // If external .map file not found, try to extract inline source map from JS file
  try {
    logger.debug(`Checking for inline source map in ${normalizedPath}`);

    const jsContent = platformReadTextFileSync(normalizedPath);
    const sourceMapMatch = jsContent.match(
      /\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/
    );

    if (sourceMapMatch && sourceMapMatch[1]) {
      logger.debug(`Found inline source map in ${normalizedPath}`);

      // Decode base64 source map
      const base64 = sourceMapMatch[1];
      const decoded = atob(base64);
      const mapJson = JSON.parse(decoded);

      const consumer = new SourceMapConsumer(mapJson);
      sourceMapCache.set(normalizedPath, consumer);

      logger.debug(`Inline source map loaded and cached (sync): ${normalizedPath}`);

      return consumer;
    }
  } catch (error) {
    logger.debug(
      `Failed to load inline source map for ${normalizedPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return null;
}

/**
 * Map a JavaScript position to original HQL position (synchronous version)
 *
 * This is the synchronous version of mapPosition(), used by
 * Error.prepareStackTrace which must be synchronous in V8.
 *
 * @param jsFilePath - Path to the JavaScript file
 * @param line - Line number in JavaScript (1-indexed)
 * @param column - Column number in JavaScript (0-indexed)
 * @returns Original HQL position, or null if mapping not found
 *
 * @example
 * const original = mapPositionSync("/tmp/output.js", 127, 5);
 * if (original) {
 *   console.log(`HQL location: ${original.source}:${original.line}:${original.column}`);
 * }
 */
export function mapPositionSync(
  jsFilePath: string,
  line: number,
  column: number,
): Position | null {
  const consumer = loadSourceMapSync(jsFilePath);

  if (!consumer) {
    return null;
  }

  try {
    const original = consumer.originalPositionFor({
      line,
      column,
      bias: SourceMapConsumer.GREATEST_LOWER_BOUND,
    });

    if (!original.source || original.line === null) {
      return null;
    }

    return {
      source: original.source,
      line: original.line,
      column: original.column ?? 0,
      name: original.name ?? undefined,
    };
  } catch (error) {
    logger.warn(
      `Failed to map position (sync) ${line}:${column} in ${jsFilePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}


/**
 * Represents a single call site in a stack trace
 */
interface CallSite {
  getFileName(): string | null;
  getLineNumber(): number | null;
  getColumnNumber(): number | null;
  getFunctionName(): string | null;
  getTypeName(): string | null;
  getMethodName(): string | null;
  isNative(): boolean;
  isConstructor(): boolean;
  toString(): string;
}

/**
 * Install source map support for runtime error handling
 *
 * Hooks into Error.prepareStackTrace to automatically transform
 * stack traces to show HQL source positions. Should be called
 * once during HQL runtime initialization.
 *
 * @example
 * // In mod.ts initialization:
 * installSourceMapSupport();
 *
 * // Now all errors will show HQL positions:
 * throw new Error("Something went wrong");
 * // Error: Something went wrong
 * //   at myFunction (app.hql:42:10)
 */
export function installSourceMapSupport(): void {
  // @ts-ignore - Error.prepareStackTrace is a V8/Deno extension
  if (typeof Error.prepareStackTrace !== "undefined") {
    logger.warn(
      "Error.prepareStackTrace already defined - source map support may conflict",
    );
  }

  // @ts-ignore - Error.prepareStackTrace is a V8/Deno extension
  Error.prepareStackTrace = (
    error: Error,
    structuredStackTrace: CallSite[],
  ) => {
    // Note: prepareStackTrace must be synchronous in V8
    // We use synchronous source map loading to transform positions

    logger.debug(`[prepareStackTrace] Processing error: ${error.message}`);
    logger.debug(
      `[prepareStackTrace] Stack frames: ${structuredStackTrace.length}`,
    );

    const message = error.message || "Error";
    const name = error.name || "Error";
    let result = `${name}: ${message}\n`;

    // Filter internal HQL runtime frames for cleaner stack traces
    const isInternalFrame = (fileName: string | null): boolean => {
      if (!fileName) return false;

      // Hide HQL runtime internals
      if (fileName.includes("runtime-helpers.ts")) return true;
      if (fileName.includes("core/src/common/runtime-helper")) return true;

      // Hide transpiler internals (unless user wants verbose output)
      if (fileName.includes("core/src/transpiler/")) return true;
      if (fileName.includes("core/src/transformer")) return true;

      // Hide Deno runtime internals
      if (fileName.includes("ext:")) return true;
      if (fileName.includes("deno:")) return true;

      return false;
    };

    // Check if user wants verbose stack traces
    const verbose = platformGetEnv("HQL_VERBOSE") === "1";

    // Filter frames unless verbose mode
    const framesToProcess = verbose
      ? structuredStackTrace
      : structuredStackTrace.filter((frame) =>
        !isInternalFrame(frame.getFileName())
      );

    const hiddenCount = structuredStackTrace.length - framesToProcess.length;

    logger.debug(`[prepareStackTrace] Filtered ${hiddenCount} internal frames`);

    for (const frame of framesToProcess) {
      const fileName = frame.getFileName();
      const lineNumber = frame.getLineNumber();
      const columnNumber = frame.getColumnNumber();
      const functionName = frame.getFunctionName();

      // Native frames - return as-is
      if (frame.isNative()) {
        result += `    at ${functionName || "<anonymous>"} (native)\n`;
        continue;
      }

      // No file information - return basic format
      if (!fileName || lineNumber === null) {
        result += `    at ${functionName || "<anonymous>"}\n`;
        continue;
      }

      // Try to map position using source map (synchronously!)
      logger.debug(
        `[prepareStackTrace] Trying to map: ${fileName}:${lineNumber}:${columnNumber}`,
      );
      const mapped = mapPositionSync(
        fileName,
        lineNumber,
        columnNumber ?? 0,
      );

      if (mapped) {
        // Successfully mapped to HQL source
        logger.debug(
          `[prepareStackTrace] ✅ Mapped to: ${mapped.source}:${mapped.line}:${mapped.column}`,
        );
        const mappedName = mapped.name || functionName || "<anonymous>";
        const location = `${mapped.source}:${mapped.line}:${mapped.column + 1}`; // +1 for 1-indexed column display
        result += `    at ${mappedName} (${location})\n`;
      } else {
        logger.debug(`[prepareStackTrace] ❌ No mapping found`);
        // No source map - use original JS position
        const originalName = functionName || "<anonymous>";
        const location = columnNumber !== null
          ? `${fileName}:${lineNumber}:${columnNumber}`
          : `${fileName}:${lineNumber}`;
        result += `    at ${originalName} (${location})\n`;
      }
    }

    // Add note about hidden frames if any were filtered
    if (hiddenCount > 0 && !verbose) {
      result += `\n(${hiddenCount} internal frame${
        hiddenCount === 1 ? "" : "s"
      } hidden. Set HQL_VERBOSE=1 to show all)\n`;
    }

    return result;
  };

  logger.debug("Source map support installed via Error.prepareStackTrace");
}

