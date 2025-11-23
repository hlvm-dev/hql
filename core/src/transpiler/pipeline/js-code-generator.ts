/**
 * JavaScript Code Generator using ESTree and escodegen
 *
 * This module replaces the TypeScript AST approach with ESTree + escodegen
 * to achieve 100% accurate source maps. Instead of:
 *   IR → TS AST → String (lose positions) → Reconstruct source map (broken)
 *
 * We now do:
 *   IR → ESTree (preserve .loc) → JavaScript + Source Map (escodegen)
 *
 * This provides token-level source map accuracy with zero heuristics.
 * escodegen is the correct tool for ESTree (unlike @babel/generator which requires Babel AST).
 */

import * as IR from "../type/hql_ir.ts";
import { globalLogger as logger } from "../../logger.ts";
import {
  convertIRToESTree,
  wrapWithRuntimeHelpers,
  type Program,
} from "./ir-to-estree.ts";
// @ts-ignore - Deno npm import
import * as escodegen from "npm:escodegen@2.1.0";

/**
 * The output of JavaScript code generation, including code and source map.
 */
export interface JavaScriptOutput {
  /** Generated JavaScript code */
  code: string;
  /** Source Map v3 JSON string (if requested) */
  sourceMap?: string;
}

/**
 * Options for JavaScript code generation
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
}

/**
 * Generate JavaScript code from HQL IR using ESTree + escodegen
 *
 * This is the main entry point for code generation. It converts HQL IR to ESTree AST,
 * then uses escodegen to produce JavaScript code with perfect source maps.
 *
 * Unlike the TypeScript AST approach, escodegen tracks positions during generation,
 * resulting in 100% token-level accuracy for error reporting.
 *
 * @param ir - The IR program to convert to JavaScript
 * @param options - Generation options including source file path and source map settings
 * @returns JavaScriptOutput with code and source map
 *
 * @example
 * const ir = parseAndTransform(hqlSource);
 * const output = await generateJavaScript(ir, {
 *   sourceFilePath: 'test.hql',
 *   generateSourceMap: true,
 *   sourceContent: hqlSource
 * });
 * console.log(output.code);        // Generated JavaScript
 * console.log(output.sourceMap);   // Source Map v3 JSON
 */
export async function generateJavaScript(
  ir: IR.IRProgram,
  options: GenerateJavaScriptOptions = {},
): Promise<JavaScriptOutput> {
  logger.debug(
    `Starting JavaScript code generation from IR with ${ir.body.length} nodes`,
  );

  const startTime = performance.now();

  // ============================================================================
  // STEP 1: Convert IR → ESTree AST
  // ============================================================================
  logger.debug("Converting HQL IR to ESTree AST");
  const conversionStartTime = performance.now();

  const estreeProgram = convertIRToESTree(ir) as Program;

  // Wrap with runtime helpers (if needed)
  const finalProgram = wrapWithRuntimeHelpers(estreeProgram);

  const conversionTime = performance.now() - conversionStartTime;
  logger.debug(
    `IR to ESTree conversion completed in ${conversionTime.toFixed(2)}ms`,
  );

  // ============================================================================
  // STEP 2: Generate JavaScript + Source Map using escodegen
  // ============================================================================
  logger.debug("Generating JavaScript code with escodegen");
  const generateStartTime = performance.now();

  const sourceFileName = options.sourceFilePath || options.currentFilePath || "unknown.hql";

  // Configure escodegen generator
  const escodegenOptions: any = {
    format: {
      indent: {
        style: '  ',      // 2-space indentation
      },
      compact: false,     // Generate readable code
      semicolons: true,   // CRITICAL: Always add semicolons to prevent ASI issues
    },
  };

  // Add source map if requested
  if (options.generateSourceMap !== false) {
    escodegenOptions.sourceMap = true;
    escodegenOptions.sourceMapWithCode = true;
    escodegenOptions.file = sourceFileName;
  }

  // Generate code with escodegen
  const output = escodegen.generate(finalProgram, escodegenOptions);

  const generateTime = performance.now() - generateStartTime;
  logger.debug(
    `escodegen code generation completed in ${generateTime.toFixed(2)}ms`,
  );

  // ============================================================================
  // STEP 3: Format output
  // ============================================================================
  let code: string;
  let sourceMap: string | undefined;

  if (options.generateSourceMap !== false && output.map) {
    // escodegen with sourceMapWithCode returns { code, map }
    code = output.code;

    // Convert source map to JSON and manually add source content
    // escodegen doesn't support embedding source content directly, so we add it manually
    const sourceMapString = output.map.toString();
    const mapObj = JSON.parse(sourceMapString);

    // Add source content if provided (escodegen doesn't do this automatically)
    if (options.sourceContent) {
      mapObj.sourcesContent = [options.sourceContent];
      logger.debug(`Added ${options.sourceContent.length} chars of source content to source map`);
    }

    // Add 'use strict' to enable strict mode (required for frozen object errors to throw)
    // We need to adjust the source map to account for the prepended line
    code = `'use strict';\n${code}`;

    // Adjust source map for the prepended 'use strict' line
    // The mappings string uses semicolons to separate lines.
    // A single semicolon represents an empty mapping for that line.
    // We prepend one semicolon to account for the 'use strict' line that now occupies line 1
    if (mapObj.mappings) {
      mapObj.mappings = `;${mapObj.mappings}`;
      logger.debug('Adjusted source map for prepended "use strict" line');
    }

    sourceMap = JSON.stringify(mapObj);

    // NOTE: Don't add sourceMappingURL comment here - mod.ts will add it
    // with the correct relative path when writing the .mjs file

    logger.debug(`Generated source map: ${sourceMap.length} bytes`);
  } else {
    // escodegen without source maps returns just a string
    code = typeof output === 'string' ? output : output.code;
    // Add 'use strict' even without source maps
    code = `'use strict';\n${code}`;
  }

  const totalTime = performance.now() - startTime;
  logger.debug(
    `Total code generation completed in ${totalTime.toFixed(2)}ms with ${code.length} characters`,
  );

  return { code, sourceMap };
}
