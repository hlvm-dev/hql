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
import { globalLogger as logger } from "../../../logger.ts";
import { getErrorMessage } from "../../../common/utils.ts";

// ============================================================================
// Types
// ============================================================================

/** Per-line sorted lookup from TS positions to HQL positions */
export type TsToHqlLookup = Map<number, Array<{ col: number; hqlLine: number; hqlCol: number }>>;

export interface ChainedSourceMap {
  /** The final source map (JS → HQL) */
  map: RawSourceMap;
  /** Map from TS line to sorted column entries for type error mapping */
  tsToHql: TsToHqlLookup;
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
  lineOffset: number = 0,
): Promise<ChainedSourceMap> {
  // Parse the TS→JS source map
  let tsToJsMap: RawSourceMap;
  try {
    tsToJsMap = JSON.parse(tsToJsMapJson) as RawSourceMap;
  } catch (e: unknown) {
    logger.warn("[source-map-chain] Failed to parse TS→JS source map:", getErrorMessage(e));
    return createEmptyChainedMap(hqlSourcePath, hqlSource);
  }

  // Build per-line sorted lookup from TS positions to HQL positions
  // Apply lineOffset inline to avoid allocating a new array of offset mappings
  const tsToHqlLookup: TsToHqlLookup = new Map();
  for (const mapping of hqlToTsMappings) {
    if (mapping.original) {
      const tsLine = mapping.generated.line + lineOffset;
      const tsCol = mapping.generated.column;
      if (!tsToHqlLookup.has(tsLine)) {
        tsToHqlLookup.set(tsLine, []);
      }
      tsToHqlLookup.get(tsLine)!.push({
        col: tsCol,
        hqlLine: mapping.original.line,
        hqlCol: mapping.original.column,
      });
    }
  }
  // Sort each line's entries by column for binary search
  for (const entries of tsToHqlLookup.values()) {
    entries.sort((a, b) => a.col - b.col);
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

      // Look up the HQL position for this TS position using binary search
      const hqlPos = mapTsToHql(tsToHqlLookup, mapping.originalLine, mapping.originalColumn);

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
      tsToHql: tsToHqlLookup,
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
  tsToHql: TsToHqlLookup,
  tsLine: number,
  tsColumn: number,
): { line: number; column: number } | null {
  const entries = tsToHql.get(tsLine);
  if (!entries || entries.length === 0) return null;

  // Binary search for largest col <= tsColumn
  let lo = 0;
  let hi = entries.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].col <= tsColumn) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (best === -1) {
    // All entries have col > tsColumn, use first entry as fallback
    return { line: entries[0].hqlLine, column: entries[0].hqlCol };
  }

  return { line: entries[best].hqlLine, column: entries[best].hqlCol };
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
    tsToHql: new Map() as TsToHqlLookup,
  };
}

