/**
 * JavaScript Code Generator - Single TypeScript Pipeline
 *
 * This module implements the unified compilation path:
 *   HQL → IR → TypeScript → tsc → JavaScript + .d.ts + Source Maps
 *
 * All HQL code goes through TypeScript compilation, providing:
 * - Type checking for annotated code
 * - Type inference for all code
 * - .d.ts declaration generation
 * - Source map chaining (HQL → TS → JS = HQL → JS)
 */

import * as IR from "../type/hql_ir.ts";
import { globalLogger as logger } from "../../logger.ts";
import {
  generateTypeScript,
  type TSGeneratorResult,
} from "./ir-to-typescript.ts";
import {
  compileTypeScript,
  formatDiagnostics,
  type TypeDiagnostic,
  PRELUDE_LINE_COUNT,
} from "./ts-compiler.ts";
import {
  chainSourceMaps,
  createSourceMapFromMappings,
  mapTsToHql,
} from "./source-map-chain.ts";

// ============================================================================
// Helpers
// ============================================================================

/** Normalize source file name for TypeScript compilation */
function normalizeSourceFileName(fileName: string): string {
  if (fileName.endsWith(".hql") || fileName.endsWith(".ts")) {
    return fileName;
  }
  // REPL paths like "<repl>:1" need a virtual filename
  if (fileName.startsWith("<") || fileName.includes("<repl>")) {
    return "repl.hql";
  }
  return fileName + ".hql";
}

// ============================================================================
// Types
// ============================================================================

/**
 * The output of JavaScript code generation.
 */
export interface JavaScriptOutput {
  /** Generated JavaScript code */
  code: string;
  /** Source Map v3 JSON string (if requested) */
  sourceMap?: string;
  /** Generated TypeScript code (intermediate) */
  typescript?: string;
  /** Generated .d.ts declarations */
  declarations?: string;
  /** Type errors found during compilation */
  typeErrors?: TypeDiagnostic[];
  /** Whether compilation succeeded (no type errors) */
  success: boolean;
}

/**
 * Options for JavaScript code generation.
 */
export interface GenerateJavaScriptOptions {
  /** Path to the source HQL file (for source maps) */
  sourceFilePath?: string;
  /** Current file path being processed */
  currentFilePath?: string;
  /** Whether to generate source maps (default: true) */
  generateSourceMap?: boolean;
  /** Original HQL source code (embedded in source map for debugging) */
  sourceContent?: string;
  /** Enable type checking (default: true) */
  typeCheck?: boolean;
  /** Fail compilation on type errors (default: false - emit anyway) */
  failOnTypeErrors?: boolean;
  /** Generate .d.ts declarations (default: true) */
  generateDeclarations?: boolean;
  /** TypeScript strict mode (default: true) */
  strict?: boolean;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Generate JavaScript from HQL IR using the TypeScript pipeline.
 *
 * This is the SINGLE entry point for all code generation. The pipeline:
 * 1. Generates TypeScript code from IR (with type annotations if present)
 * 2. Compiles with tsc for type checking
 * 3. Returns JavaScript + declarations + source maps
 *
 * Type errors are reported with HQL source positions.
 *
 * @param ir - The IR program to compile
 * @param options - Compilation options
 * @returns Compilation output with JS, declarations, and type errors
 */
export async function generateJavaScript(
  ir: IR.IRProgram,
  options: GenerateJavaScriptOptions = {},
): Promise<JavaScriptOutput> {
  logger.debug(
    `Starting TypeScript pipeline for IR with ${ir.body.length} nodes`,
  );

  const startTime = performance.now();
  const sourceFileName = normalizeSourceFileName(
    options.sourceFilePath || options.currentFilePath || "module.hql"
  );
  const tsFileName = sourceFileName.replace(/\.hql$/, ".ts");

  // ============================================================================
  // STEP 1: Generate TypeScript from IR
  // ============================================================================
  logger.debug("Step 1: Generating TypeScript from HQL IR");
  const tsStartTime = performance.now();

  const tsResult: TSGeneratorResult = generateTypeScript(ir, {
    sourceFilePath: sourceFileName,
  });

  const tsTime = performance.now() - tsStartTime;
  logger.debug(
    `TypeScript generation: ${tsTime.toFixed(2)}ms, ${tsResult.code.length} chars`,
  );

  // ============================================================================
  // STEP 2: Compile TypeScript with tsc
  // ============================================================================
  logger.debug("Step 2: Compiling TypeScript with tsc");
  const compileStartTime = performance.now();

  const compileResult = compileTypeScript(tsResult.code, {
    fileName: tsFileName,
    strict: options.strict !== false,
    declaration: options.generateDeclarations !== false,
    sourceMap: options.generateSourceMap !== false,
  });

  const compileTime = performance.now() - compileStartTime;
  logger.debug(
    `tsc compilation: ${compileTime.toFixed(2)}ms, ${compileResult.diagnostics.length} diagnostics`,
  );

  // ============================================================================
  // STEP 3: Map type errors to HQL positions
  // ============================================================================
  const hqlTypeErrors: TypeDiagnostic[] = [];

  if (options.typeCheck !== false) {
    // Build TS→HQL position map for error mapping
    // Note: tsc diagnostics are ALREADY adjusted to remove the prelude offset
    // (see convertDiagnostics in ts-compiler.ts), so we use direct line numbers here
    const tsToHqlMap = new Map<string, { line: number; column: number }>();
    for (const mapping of tsResult.mappings) {
      if (mapping.original) {
        // Use direct line numbers - diagnostics are already offset-adjusted
        const key = `${mapping.generated.line}:${mapping.generated.column}`;
        tsToHqlMap.set(key, mapping.original);
      }
    }

    for (const diag of compileResult.diagnostics) {
      // Try to map TS position to HQL position
      const hqlPos = mapTsToHql(tsToHqlMap, diag.line, diag.column);

      hqlTypeErrors.push({
        ...diag,
        file: sourceFileName,
        line: hqlPos?.line ?? diag.line,
        column: hqlPos?.column ?? diag.column,
      });
    }

    // Log type errors if any
    if (hqlTypeErrors.length > 0) {
      const errorCount = hqlTypeErrors.filter((e) => e.severity === "error")
        .length;
      const warnCount = hqlTypeErrors.filter((e) => e.severity === "warning")
        .length;
      logger.warn(
        `Type checking found ${errorCount} error(s), ${warnCount} warning(s)`,
      );

      if (options.failOnTypeErrors && errorCount > 0) {
        throw new Error(
          `Type checking failed:\n${formatDiagnostics(hqlTypeErrors)}`,
        );
      }
    }
  }

  // ============================================================================
  // STEP 4: Chain source maps (HQL → TS → JS = HQL → JS)
  // ============================================================================
  let sourceMap: string | undefined;

  if (options.generateSourceMap !== false && compileResult.sourceMap) {
    logger.debug("Step 4: Chaining source maps");

    // Offset the HQL→TS mappings by the prelude line count.
    // The TS compiler prepends runtime helper declarations, shifting all line numbers.
    // Without this offset, the TS→JS source map positions won't match the HQL→TS positions.
    const offsetMappings = tsResult.mappings.map(m => ({
      ...m,
      generated: {
        line: m.generated.line + PRELUDE_LINE_COUNT,
        column: m.generated.column,
      },
    }));

    const chainedMap = await chainSourceMaps(
      offsetMappings,
      compileResult.sourceMap,
      sourceFileName,
      options.sourceContent,
    );

    sourceMap = JSON.stringify(chainedMap.map);
    logger.debug(`Chained source map: ${sourceMap.length} bytes`);
  } else if (options.generateSourceMap !== false) {
    // Fallback: use HQL→TS map only
    const fallbackMap = createSourceMapFromMappings(
      tsResult.mappings,
      sourceFileName,
      tsFileName.replace(/\.ts$/, ".js"),
      options.sourceContent,
    );
    sourceMap = JSON.stringify(fallbackMap);
  }

  // ============================================================================
  // STEP 5: Format output
  // ============================================================================
  let code = compileResult.javascript;

  // Add 'use strict' if not already present
  if (!code.startsWith("'use strict'") && !code.startsWith('"use strict"')) {
    code = `'use strict';\n${code}`;

    // Adjust source map for prepended line
    if (sourceMap) {
      const mapObj = JSON.parse(sourceMap);
      if (mapObj.mappings) {
        mapObj.mappings = `;${mapObj.mappings}`;
      }
      sourceMap = JSON.stringify(mapObj);
    }
  }

  const totalTime = performance.now() - startTime;
  logger.debug(
    `Total pipeline: ${totalTime.toFixed(2)}ms`,
  );

  return {
    code,
    sourceMap,
    typescript: tsResult.code,
    declarations: compileResult.declarations,
    typeErrors: hqlTypeErrors,
    success: compileResult.success,
  };
}

// Re-export types for convenience
export type { TypeDiagnostic } from "./ts-compiler.ts";
