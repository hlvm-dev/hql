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
import { getErrorMessage } from "../../common/utils.ts";

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
 * Clear the source map cache for a specific file or all files
 * 
 * Use this when a file has been recompiled and its source map
 * needs to be reloaded.
 * 
 * @param jsFilePath - Path to the JavaScript file to invalidate. If omitted, clears entire cache.
 */
export function invalidateSourceMapCache(jsFilePath?: string): void {
  if (jsFilePath) {
    // Normalize file path
    let normalizedPath = jsFilePath;
    if (jsFilePath.startsWith("file://")) {
      try {
        normalizedPath = platformFromFileUrl(jsFilePath);
      } catch (error) {
        // Ignore error
      }
    }
    
    sourceMapCache.delete(normalizedPath);
    logger.debug(`Source map cache invalidated for: ${normalizedPath}`);
  } else {
    sourceMapCache.clear();
    logger.debug("Source map cache cleared completely");
  }
}

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
        getErrorMessage(error)
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
        getErrorMessage(error)
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
        getErrorMessage(error)
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
        getErrorMessage(error)
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
  const DEBUG = Deno.env.get("HQL_DEBUG_ERROR") === "1";

  // Normalize file path - convert file:// URLs to regular paths
  let normalizedPath = jsFilePath;
  if (jsFilePath.startsWith("file://")) {
    try {
      normalizedPath = platformFromFileUrl(jsFilePath);
    } catch (error) {
      logger.debug(`Failed to normalize file URL ${jsFilePath}: ${
        getErrorMessage(error)
      }`);
    }
  }

  if (DEBUG) {
    console.log("[loadSourceMapSync] Normalized path:", normalizedPath);
  }

  // Check cache first
  if (sourceMapCache.has(normalizedPath)) {
    logger.debug(`Source map cache hit (sync): ${normalizedPath}`);
    if (DEBUG) {
      console.log("[loadSourceMapSync] Cache hit!");
    }
    return sourceMapCache.get(normalizedPath)!;
  }

  // Attempt to load .js.map file synchronously
  const mapFilePath = normalizedPath + ".map";

  if (DEBUG) {
    console.log("[loadSourceMapSync] Trying external map:", mapFilePath);
  }

  try {
    logger.debug(`Loading source map (sync) from ${mapFilePath}`);

    // Use synchronous file read
    const mapContent = platformReadTextFileSync(mapFilePath);
    const mapJson = JSON.parse(mapContent);

    if (DEBUG) {
      console.log("[loadSourceMapSync] Loaded external map, sources:", mapJson.sources);
    }

    // Create SourceMapConsumer synchronously
    // In source-map@0.6.1, the constructor is synchronous and returns the instance directly
    const consumer = new SourceMapConsumer(mapJson);

    // Cache for future use
    sourceMapCache.set(normalizedPath, consumer);

    logger.debug(`Source map loaded and cached (sync): ${normalizedPath}`);

    return consumer;
  } catch (error) {
    if (DEBUG) {
      console.log("[loadSourceMapSync] External map failed:", getErrorMessage(error));
    }
    logger.debug(
      `Failed to load external source map for ${normalizedPath}: ${
        getErrorMessage(error)
      }`,
    );
  }

  // If external .map file not found, try to extract inline source map from JS file
  if (DEBUG) {
    console.log("[loadSourceMapSync] Trying inline source map from:", normalizedPath);
  }

  try {
    logger.debug(`Checking for inline source map in ${normalizedPath}`);

    const jsContent = platformReadTextFileSync(normalizedPath);

    if (DEBUG) {
      console.log("[loadSourceMapSync] File read, length:", jsContent.length);
    }

    const sourceMapMatch = jsContent.match(
      /\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/
    );

    if (sourceMapMatch && sourceMapMatch[1]) {
      logger.debug(`Found inline source map in ${normalizedPath}`);

      if (DEBUG) {
        console.log("[loadSourceMapSync] Found inline source map!");
      }

      // Decode base64 source map
      const base64 = sourceMapMatch[1];
      const decoded = atob(base64);
      const mapJson = JSON.parse(decoded);

      if (DEBUG) {
        console.log("[loadSourceMapSync] Inline map sources:", mapJson.sources);
      }

      const consumer = new SourceMapConsumer(mapJson);
      sourceMapCache.set(normalizedPath, consumer);

      logger.debug(`Inline source map loaded and cached (sync): ${normalizedPath}`);

      return consumer;
    } else {
      if (DEBUG) {
        console.log("[loadSourceMapSync] No inline source map found in file");
      }
    }
  } catch (error) {
    if (DEBUG) {
      console.log("[loadSourceMapSync] Inline map failed:", getErrorMessage(error));
    }
    logger.debug(
      `Failed to load inline source map for ${normalizedPath}: ${
        getErrorMessage(error)
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
  const DEBUG = Deno.env.get("HQL_DEBUG_ERROR") === "1";
  if (DEBUG) {
    console.log("[mapPositionSync] Looking up:", jsFilePath, line, column);
  }

  const consumer = loadSourceMapSync(jsFilePath);

  if (!consumer) {
    if (DEBUG) {
      console.log("[mapPositionSync] No consumer found for:", jsFilePath);
    }
    return null;
  }

  if (DEBUG) {
    console.log("[mapPositionSync] Consumer found, looking up position...");
  }

  try {
    const original = consumer.originalPositionFor({
      line,
      column,
      bias: SourceMapConsumer.GREATEST_LOWER_BOUND,
    });

    if (original.source && original.line !== null) {
      if (DEBUG) {
        console.log("[mapPositionSync] Direct mapping found:", original);
      }
      return {
        source: original.source,
        line: original.line,
        column: original.column ?? 0,
        name: original.name ?? undefined,
      };
    }

    // No direct mapping found. This can happen when Deno/V8 partially applies source maps:
    // It transforms the line number using the source map but keeps the original filename.
    // In this case, the line number we receive is already the source line number,
    // so we need to look up in the source file's source map instead.
    if (DEBUG) {
      console.log("[mapPositionSync] No direct mapping, checking source map chain...");
    }

    // Get the sources from this source map
    const sources = (consumer as unknown as { sources: string[] }).sources;
    if (sources && sources.length > 0) {
      // The source file might have its own source map
      const sourceFile = sources[0];
      if (DEBUG) {
        console.log("[mapPositionSync] Source file from map:", sourceFile);
      }

      // Resolve the source file path relative to the JS file
      const jsDir = jsFilePath.substring(0, jsFilePath.lastIndexOf('/'));
      const resolvedSource = sourceFile.startsWith('/')
        ? sourceFile
        : jsDir + '/' + sourceFile;

      if (DEBUG) {
        console.log("[mapPositionSync] Resolved source path:", resolvedSource);
      }

      // Try to load the source file's source map
      // The source file should have a .map file with the same name
      const sourceConsumer = loadSourceMapSync(resolvedSource);
      if (sourceConsumer) {
        if (DEBUG) {
          console.log("[mapPositionSync] Found source map for:", resolvedSource);
        }

        // Look up in the source file's source map using the line/column we received
        // (which is already the source line number due to V8's partial source map application)
        const chained = sourceConsumer.originalPositionFor({
          line,
          column,
          bias: SourceMapConsumer.GREATEST_LOWER_BOUND,
        });

        if (chained.source && chained.line !== null) {
          if (DEBUG) {
            console.log("[mapPositionSync] Chained mapping found:", chained);
          }
          return {
            source: chained.source,
            line: chained.line,
            column: chained.column ?? 0,
            name: chained.name ?? undefined,
          };
        }
      }
    }

    if (DEBUG) {
      console.log("[mapPositionSync] No mapping found after chain lookup");
    }
    return null;
  } catch (error) {
    logger.warn(
      `Failed to map position (sync) ${line}:${column} in ${jsFilePath}: ${
        getErrorMessage(error)
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

