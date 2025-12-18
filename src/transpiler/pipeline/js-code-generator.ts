/**
 * JavaScript Code Generator
 *
 * This module provides two compilation paths:
 *
 * 1. ESTree Path (default): IR → ESTree → JavaScript (via escodegen)
 *    - Fast, no type checking
 *    - Used when no type annotations are present
 *
 * 2. TypeScript Path (for typed code): IR → TypeScript → tsc → JavaScript
 *    - Full type checking with tsc
 *    - Generates .d.ts declarations
 *    - Used when type annotations are present
 *
 * Both paths maintain source maps for error reporting.
 */

import * as IR from "../type/hql_ir.ts";
import { globalLogger as logger } from "../../logger.ts";
import {
  convertIRToESTree,
  setSourceFilePath,
  wrapWithRuntimeHelpers,
  type Program,
} from "./ir-to-estree.ts";
import {
  generateTypeScript,
  type TSGeneratorResult,
} from "./ir-to-typescript.ts";
import {
  compileTypeScript,
  formatDiagnostics,
  type TypeDiagnostic,
} from "./ts-compiler.ts";
import {
  chainSourceMaps,
  createSourceMapFromMappings,
  mapTsToHql,
} from "./source-map-chain.ts";
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
// deno-lint-ignore require-await -- Function is async for API consistency and future extensibility
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

  // Set the source file path fallback for source map generation
  // This ensures synthetic nodes (without their own filePath) map to the correct file
  const sourceFileName = options.sourceFilePath || options.currentFilePath || "unknown.hql";
  setSourceFilePath(sourceFileName);

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

  // Configure escodegen generator
  // Using Record instead of any for type safety (escodegen options object)
  const escodegenOptions: Record<string, unknown> = {
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

/**
 * Extended output for TypeScript compilation path
 */
export interface TypeScriptCompilationOutput extends JavaScriptOutput {
  /** TypeScript source (intermediate) */
  typescript?: string;
  /** Generated .d.ts declarations */
  declarations?: string;
  /** Type errors found during compilation */
  typeErrors?: TypeDiagnostic[];
  /** Whether compilation succeeded (no type errors) */
  success: boolean;
}

/**
 * Extended options for TypeScript compilation
 */
export interface GenerateWithTypesOptions extends GenerateJavaScriptOptions {
  /** Whether to fail on type errors (default: false - emit anyway) */
  failOnTypeErrors?: boolean;
  /** Whether to generate .d.ts declarations (default: true) */
  generateDeclarations?: boolean;
  /** TypeScript strict mode (default: true) */
  strict?: boolean;
}

/**
 * Generate JavaScript from HQL IR using the TypeScript compilation path.
 *
 * This function:
 * 1. Generates TypeScript code from IR (with type annotations)
 * 2. Compiles with tsc for type checking
 * 3. Returns JavaScript + declarations + source maps
 *
 * Type errors are reported with HQL source positions.
 *
 * @param ir - The IR program to compile
 * @param options - Compilation options
 * @returns Compilation output with JS, declarations, and type errors
 */
export async function generateJavaScriptWithTypes(
  ir: IR.IRProgram,
  options: GenerateWithTypesOptions = {},
): Promise<TypeScriptCompilationOutput> {
  logger.debug(
    `Starting TypeScript compilation from IR with ${ir.body.length} nodes`,
  );

  const startTime = performance.now();
  const sourceFileName =
    options.sourceFilePath || options.currentFilePath || "module.hql";
  const tsFileName = sourceFileName.replace(/\.hql$/, ".ts");

  // ============================================================================
  // STEP 1: Generate TypeScript from IR
  // ============================================================================
  logger.debug("Generating TypeScript from HQL IR");
  const tsStartTime = performance.now();

  const tsResult: TSGeneratorResult = generateTypeScript(ir, {
    sourceFilePath: sourceFileName,
  });

  const tsTime = performance.now() - tsStartTime;
  logger.debug(
    `TypeScript generation completed in ${tsTime.toFixed(2)}ms: ${tsResult.code.length} chars`,
  );

  // ============================================================================
  // STEP 2: Compile TypeScript with tsc
  // ============================================================================
  logger.debug("Compiling TypeScript with tsc");
  const compileStartTime = performance.now();

  const compileResult = compileTypeScript(tsResult.code, {
    fileName: tsFileName,
    strict: options.strict !== false,
    declaration: options.generateDeclarations !== false,
    sourceMap: options.generateSourceMap !== false,
  });

  const compileTime = performance.now() - compileStartTime;
  logger.debug(
    `tsc compilation completed in ${compileTime.toFixed(2)}ms: ${compileResult.diagnostics.length} diagnostics`,
  );

  // ============================================================================
  // STEP 3: Map type errors to HQL positions
  // ============================================================================
  const hqlTypeErrors: TypeDiagnostic[] = [];

  // Build TS→HQL position map for error mapping
  const tsToHqlMap = new Map<string, { line: number; column: number }>();
  for (const mapping of tsResult.mappings) {
    if (mapping.original) {
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

  // ============================================================================
  // STEP 4: Chain source maps (HQL → TS → JS = HQL → JS)
  // ============================================================================
  let sourceMap: string | undefined;

  if (options.generateSourceMap !== false && compileResult.sourceMap) {
    logger.debug("Chaining source maps");

    const chainedMap = await chainSourceMaps(
      tsResult.mappings,
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
    `Total TypeScript compilation completed in ${totalTime.toFixed(2)}ms`,
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

/**
 * Check if an IR program has type annotations.
 * Used to decide whether to use the TypeScript or ESTree path.
 */
export function hasTypeAnnotations(ir: IR.IRProgram): boolean {
  // Check all nodes recursively for type annotations
  function checkNode(node: IR.IRNode): boolean {
    if (!node) return false;

    // Check identifiers for type annotations
    if (node.type === IR.IRNodeType.Identifier) {
      const id = node as IR.IRIdentifier;
      if (id.typeAnnotation) return true;
    }

    // Check function declarations for return types
    if (node.type === IR.IRNodeType.FnFunctionDeclaration) {
      const fn = node as IR.IRFnFunctionDeclaration;
      if (fn.returnType) return true;
      if (fn.typeParameters && fn.typeParameters.length > 0) return true;
      // Check params
      for (const param of fn.params) {
        if (checkNode(param)) return true;
      }
    }

    if (node.type === IR.IRNodeType.FunctionDeclaration) {
      const fn = node as IR.IRFunctionDeclaration;
      if (fn.returnType) return true;
      if (fn.typeParameters && fn.typeParameters.length > 0) return true;
    }

    if (node.type === IR.IRNodeType.FunctionExpression) {
      const fn = node as IR.IRFunctionExpression;
      if (fn.returnType) return true;
      if (fn.typeParameters && fn.typeParameters.length > 0) return true;
    }

    // Recursively check all properties that might contain nodes
    // deno-lint-ignore no-explicit-any
    const nodeAny = node as any;
    for (const key of Object.keys(nodeAny)) {
      const val = nodeAny[key];
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === "object" && "type" in item) {
            if (checkNode(item)) return true;
          }
        }
      } else if (val && typeof val === "object" && "type" in val) {
        if (checkNode(val)) return true;
      }
    }

    return false;
  }

  for (const node of ir.body) {
    if (checkNode(node)) return true;
  }

  return false;
}

/**
 * Smart code generation that automatically chooses the best path.
 *
 * - If the IR has type annotations, uses the TypeScript path for type checking
 * - Otherwise, uses the fast ESTree path
 *
 * @param ir - The IR program to compile
 * @param options - Compilation options
 * @returns JavaScript output
 */
export async function generateJavaScriptSmart(
  ir: IR.IRProgram,
  options: GenerateWithTypesOptions = {},
): Promise<TypeScriptCompilationOutput> {
  if (hasTypeAnnotations(ir)) {
    logger.debug("Type annotations detected, using TypeScript path");
    return generateJavaScriptWithTypes(ir, options);
  } else {
    logger.debug("No type annotations, using fast ESTree path");
    const result = await generateJavaScript(ir, options);
    return {
      ...result,
      success: true,
      typeErrors: [],
    };
  }
}
