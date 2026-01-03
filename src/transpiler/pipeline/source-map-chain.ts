/**
 * Source Map Chaining - Combines HQL→TS and TS→JS source maps
 *
 * When HQL code is compiled through TypeScript, we get two source maps:
 * 1. HQL → TypeScript (from ir-to-typescript.ts)
 * 2. TypeScript → JavaScript (from tsc)
 *
 * This module chains them together so that:
 * - Runtime errors in JavaScript point back to original HQL source
 * - Type errors (already in TS positions) can be mapped to HQL
 */

// @deno-types="npm:@types/source-map@0.5.7"
import { SourceMapConsumer, SourceMapGenerator } from "source-map";
import type { RawSourceMap } from "source-map";

// deno-lint-ignore no-explicit-any
type AnySourceMapGenerator = any;
import type { SourceMapping } from "./ir-to-typescript.ts";
import { globalLogger as logger } from "../../logger.ts";
import { getErrorMessage } from "../../common/utils.ts";

// ============================================================================
// Types
// ============================================================================

export interface ChainedSourceMap {
  /** The final source map (JS → HQL) */
  map: RawSourceMap;
  /** Map from TS positions to HQL positions for type error mapping */
  tsToHql: Map<string, { line: number; column: number }>;
}

// ============================================================================
// Source Map Chaining
// ============================================================================

/**
 * Chain HQL→TS and TS→JS source maps to create a final HQL→JS source map.
 *
 * @param hqlToTsMappings - Mappings from ir-to-typescript.ts
 * @param tsToJsMapJson - Source map JSON from tsc
 * @param hqlSourcePath - Path to original HQL source file
 * @param hqlSource - Original HQL source code (optional, for inline source)
 * @returns Combined source map
 */
export async function chainSourceMaps(
  hqlToTsMappings: SourceMapping[],
  tsToJsMapJson: string,
  hqlSourcePath: string,
  hqlSource?: string,
): Promise<ChainedSourceMap> {
  // Parse the TS→JS source map
  let tsToJsMap: RawSourceMap;
  try {
    tsToJsMap = JSON.parse(tsToJsMapJson) as RawSourceMap;
  } catch (e: unknown) {
    logger.warn("[source-map-chain] Failed to parse TS→JS source map:", getErrorMessage(e));
    return createEmptyChainedMap(hqlSourcePath, hqlSource);
  }

  // Build a lookup map from TS positions to HQL positions
  const tsToHqlMap = new Map<string, { line: number; column: number }>();
  for (const mapping of hqlToTsMappings) {
    if (mapping.original) {
      const key = `${mapping.generated.line}:${mapping.generated.column}`;
      tsToHqlMap.set(key, mapping.original);
    }
  }

  // Create the consumer for TS→JS map
  const tsToJsConsumer = await new SourceMapConsumer(tsToJsMap);

  try {
    // Create a new generator for the final HQL→JS map
    const generator = new SourceMapGenerator({
      file: tsToJsMap.file || "output.js",
    }) as AnySourceMapGenerator;

    // Add the original HQL source if provided
    if (hqlSource) {
      generator.setSourceContent(hqlSourcePath, hqlSource);
    }

    // Iterate through all mappings in the TS→JS map
    // deno-lint-ignore no-explicit-any
    tsToJsConsumer.eachMapping((mapping: any) => {
      // Skip mappings without original positions
      if (
        mapping.originalLine === null ||
        mapping.originalColumn === null
      ) {
        return;
      }

      // Look up the HQL position for this TS position
      const tsKey = `${mapping.originalLine}:${mapping.originalColumn}`;
      const hqlPos = tsToHqlMap.get(tsKey);

      if (hqlPos) {
        // We found a mapping chain: JS → TS → HQL
        generator.addMapping({
          generated: {
            line: mapping.generatedLine,
            column: mapping.generatedColumn,
          },
          original: {
            line: hqlPos.line,
            column: hqlPos.column,
          },
          source: hqlSourcePath,
          name: mapping.name || undefined,
        });
      }
      // If no HQL mapping found, we could either:
      // - Skip the mapping (loses some precision)
      // - Keep the TS mapping (but that's not HQL source)
      // For now, we skip to keep the map clean
    });

    const finalMap = generator.toJSON();

    return {
      map: finalMap,
      tsToHql: tsToHqlMap,
    };
  } finally {
    // Clean up the consumer (destroy method may not exist in all versions)
    if (typeof (tsToJsConsumer as AnySourceMapGenerator).destroy === "function") {
      (tsToJsConsumer as AnySourceMapGenerator).destroy();
    }
  }
}

/**
 * Map a TypeScript position to HQL position using the cached lookup.
 * Useful for mapping type errors back to HQL source.
 */
export function mapTsToHql(
  tsToHql: Map<string, { line: number; column: number }>,
  tsLine: number,
  tsColumn: number,
): { line: number; column: number } | null {
  // Try exact match first
  const exactKey = `${tsLine}:${tsColumn}`;
  const exact = tsToHql.get(exactKey);
  if (exact) return exact;

  // Try nearby positions (column might be off by a few)
  for (let colOffset = 1; colOffset <= 10; colOffset++) {
    const nearKey = `${tsLine}:${tsColumn - colOffset}`;
    const near = tsToHql.get(nearKey);
    if (near) return near;
  }

  // Try the same line with column 0 (line-level mapping)
  const lineKey = `${tsLine}:0`;
  const lineMatch = tsToHql.get(lineKey);
  if (lineMatch) return lineMatch;

  return null;
}

/**
 * Create a simple source map from HQL→TS mappings only.
 * Used when TS→JS source map is not available.
 */
export function createSourceMapFromMappings(
  mappings: SourceMapping[],
  hqlSourcePath: string,
  outputFileName: string,
  hqlSource?: string,
): RawSourceMap {
  const generator = new SourceMapGenerator({
    file: outputFileName,
  }) as AnySourceMapGenerator;

  if (hqlSource) {
    generator.setSourceContent(hqlSourcePath, hqlSource);
  }

  for (const mapping of mappings) {
    if (mapping.original) {
      generator.addMapping({
        generated: mapping.generated,
        original: mapping.original,
        source: hqlSourcePath,
        name: mapping.name || undefined,
      });
    }
  }

  return generator.toJSON() as RawSourceMap;
}

/**
 * Create an empty chained map (fallback when chaining fails).
 */
function createEmptyChainedMap(
  sourcePath: string,
  source?: string,
): ChainedSourceMap {
  const generator = new SourceMapGenerator({
    file: "output.js",
  }) as AnySourceMapGenerator;

  if (source) {
    generator.setSourceContent(sourcePath, source);
  }

  return {
    map: generator.toJSON() as RawSourceMap,
    tsToHql: new Map(),
  };
}

