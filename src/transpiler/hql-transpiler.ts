// core/src/transpiler/hql-transpiler.ts - Modified to support dependency injection
import { parse } from "./pipeline/parser.ts";
import { Environment } from "../environment.ts";
import { expandMacros, MacroExpanderOptions } from "../s-exp/macro.ts";
import { processImports } from "../imports.ts";
import { convertToHqlAst as convert } from "../s-exp/macro-reader.ts";
import { transformAST } from "../transformer.ts";
import { transformSyntax } from "./pipeline/syntax-transformer.ts";
import { SExp } from "../s-exp/types.ts";
import {
  MacroError,
  TransformError,
  TranspilerError,
} from "../common/error.ts";
import { globalLogger as logger } from "../logger.ts";
import { reportError } from "../common/error.ts";
import type { TranspileResult } from "./index.ts";
import type { IRProgram } from "./type/hql_ir.ts";
import { globalSymbolTable } from "../transpiler/symbol_table.ts";
import { HQLNode } from "../transpiler/type/hql_ast.ts";
import { EMBEDDED_MACROS } from "../lib/embedded-macros.ts";
import { CompilerContext, hasMacroRegistry } from "./compiler-context.ts";
import { basename, cwd as platformCwd } from "../platform/platform.ts";

const macroExpressionsCache = new Map<string, SExp[]>();

interface ProcessOptions {
  verbose?: boolean;
  showTiming?: boolean;
  baseDir?: string;
  sourceDir?: string;
  tempDir?: string;
  currentFile?: string;
  /** Generate source maps (default: false) */
  generateSourceMap?: boolean;
  /** Original HQL source code for embedding in source map */
  sourceContent?: string;
}

/**
 * Process HQL source code and return transpiled JavaScript
 * @param hqlSource - The HQL source code to compile
 * @param options - Processing options
 * @param context - Optional dependency injection context for runtime features
 */
export async function transpileToJavascript(
  hqlSource: string,
  options: ProcessOptions = {},
  context?: CompilerContext,
): Promise<TranspileResult> {
  logger.debug("Processing HQL source with S-expression layer");

  // Apply context options if provided
  const mergedOptions = {
    ...options,
    ...(context?.options || {}),
    verbose: options.verbose ?? context?.options?.verbose,
    showTiming: options.showTiming ?? context?.options?.showTiming,
    baseDir: options.baseDir ?? context?.baseDir,
    currentFile: options.currentFile ?? context?.currentFile,
  };

  if (mergedOptions.verbose) {
    logger.setEnabled(true);
  }

  if (mergedOptions.showTiming) {
    logger.setTimingOptions({ showTiming: true });
    logger.startTiming("hql-process", "Total");
  }

  const sourceFilename = basename(
    mergedOptions.currentFile || mergedOptions.baseDir || "unknown",
  );

  // Pass context to environment setup
  const env = await setupEnvironment(mergedOptions, context);
  const sexps = parseSource(hqlSource, mergedOptions);
  const canonicalSexps = transform(sexps, mergedOptions);

  await handleImports(canonicalSexps, env, mergedOptions);

  // Disable caching when runtime macros are present
  const macroOptions = context?.macroRegistry ? { useCache: false } : {};
  const expanded = expand(canonicalSexps, env, mergedOptions, macroOptions);
  const hqlAst = convertSexpsToHqlAst(expanded, mergedOptions);
  const javascript = await transpileHqlAstToJs(hqlAst, mergedOptions, env);

  if (mergedOptions.baseDir) env.setCurrentFile(null);

  if (mergedOptions.showTiming) {
    logger.endTiming("hql-process", "Total");
    logger.logPerformance("hql-process", sourceFilename);
  }

  return javascript;
}

/**
 * Result type for transpileToJavascriptWithIR
 */
export interface TranspileWithIRResult extends TranspileResult {
  ir: IRProgram;
}

/**
 * Process HQL source code and return transpiled JavaScript with IR
 * @param hqlSource - The HQL source code to compile
 * @param options - Processing options
 * @param context - Optional dependency injection context for runtime features
 */
export async function transpileToJavascriptWithIR(
  hqlSource: string,
  options: ProcessOptions = {},
  context?: CompilerContext,
): Promise<TranspileWithIRResult> {
  logger.debug("Processing HQL source with S-expression layer (with IR)");

  // Apply context options if provided
  const mergedOptions = {
    ...options,
    ...(context?.options || {}),
    verbose: options.verbose ?? context?.options?.verbose,
    showTiming: options.showTiming ?? context?.options?.showTiming,
    baseDir: options.baseDir ?? context?.baseDir,
    currentFile: options.currentFile ?? context?.currentFile,
  };

  if (mergedOptions.verbose) {
    logger.setEnabled(true);
  }

  if (mergedOptions.showTiming) {
    logger.setTimingOptions({ showTiming: true });
    logger.startTiming("hql-process", "Total");
  }

  const sourceFilename = basename(
    mergedOptions.currentFile || mergedOptions.baseDir || "unknown",
  );

  // Pass context to environment setup
  const env = await setupEnvironment(mergedOptions, context);
  const sexps = parseSource(hqlSource, mergedOptions);
  const canonicalSexps = transform(sexps, mergedOptions);

  await handleImports(canonicalSexps, env, mergedOptions);

  // Disable caching when runtime macros are present
  const macroOptions = context?.macroRegistry ? { useCache: false } : {};
  const expanded = expand(canonicalSexps, env, mergedOptions, macroOptions);
  const hqlAst = convertSexpsToHqlAst(expanded, mergedOptions);
  const javascript = await transpileHqlAstToJsWithIR(hqlAst, mergedOptions, env);

  if (mergedOptions.baseDir) env.setCurrentFile(null);

  if (mergedOptions.showTiming) {
    logger.endTiming("hql-process", "Total");
    logger.logPerformance("hql-process", sourceFilename);
  }

  return javascript;
}

/**
 * Expand HQL macros without full transpilation
 *
 * Performs macro expansion on HQL source code and returns the expanded
 * S-expressions without completing the full transpilation to JavaScript.
 * This is useful for:
 * - Debugging macro expansions
 * - REPL implementations that need to inspect expanded code
 * - Tools that analyze HQL code structure
 * - Testing macro behavior
 *
 * The expansion process includes:
 * 1. Parsing source into S-expressions
 * 2. Transforming syntax sugar into canonical forms
 * 3. Processing imports
 * 4. Expanding all macros (recursively)
 *
 * @param hqlSource - Raw HQL source code to expand
 * @param options - Processing options (baseDir, currentFile, timing, etc.)
 * @param macroOptions - Macro expander options (useCache, maxDepth, etc.)
 * @param context - Optional compiler context for dependency injection
 * @returns Promise resolving to array of expanded S-expressions
 *
 * @throws {ParseError} - If source has syntax errors
 * @throws {MacroError} - If macro expansion fails
 * @throws {Error} - If import resolution fails
 *
 * @example
 * // Expand a simple macro
 * const expanded = await expandHql('(when true (print "yes"))');
 * // → Expands 'when' macro to 'if' form
 *
 * @example
 * // Debug custom macro expansion
 * const code = '(my-macro x y)';
 * const expanded = await expandHql(code, { verbose: true });
 * console.log(expanded);
 * // → See how my-macro expanded
 */
export async function expandHql(
  hqlSource: string,
  options: ProcessOptions = {},
  macroOptions: MacroExpanderOptions = {},
  context?: CompilerContext,
): Promise<SExp[]> {
  // Apply context options if provided
  const mergedOptions = {
    ...options,
    ...(context?.options || {}),
    baseDir: options.baseDir ?? context?.baseDir,
    currentFile: options.currentFile ?? context?.currentFile,
  };

  const env = await setupEnvironment(mergedOptions, context);
  const sexps = parseSource(hqlSource, mergedOptions);
  const canonicalSexps = transform(sexps, mergedOptions);

  await handleImports(canonicalSexps, env, mergedOptions);

  const expanded = expand(canonicalSexps, env, mergedOptions, macroOptions);

  if (mergedOptions.baseDir) env.setCurrentFile(null);

  return expanded;
}

/**
 * Set up the environment for HQL processing
 * @param options - Processing options
 * @param context - Optional compiler context with injected dependencies
 */
async function setupEnvironment(
  options: ProcessOptions,
  context?: CompilerContext,
): Promise<Environment> {
  if (options.showTiming) {
    logger.startTiming("hql-process", "Environment setup");
  }

  // Use provided environment or create new one
  let env: Environment;
  if (context?.environment) {
    env = context.environment;
    logger.debug("Using injected environment from context");
  } else {
    env = await getGlobalEnv(options);
  }

  // Register runtime macros if provided
  if (hasMacroRegistry(context)) {
    logger.debug(
      `Registering ${context!.macroRegistry!.macros.size} runtime macros`,
    );
    // If we have functions compiled, use them
    if (context!.macroRegistry!.functions) {
      for (const [name, fn] of context!.macroRegistry!.functions) {
        env.defineMacro(name, fn);
        logger.debug(`Registered runtime macro function: ${name}`);
      }
    }
  }

  if (options.currentFile) {
    env.setCurrentFile(options.currentFile);
  } else if (options.baseDir) {
    env.setCurrentFile(options.baseDir);
  }

  if (options.showTiming) logger.endTiming("hql-process", "Environment setup");
  return env;
}

/**
 * Parse source code into S-expressions
 */
function parseSource(source: string, options: ProcessOptions): SExp[] {
  if (options.showTiming) logger.startTiming("hql-process", "Parsing");

  const sexps = parse(source, options.currentFile);
  logger.debug(`Parsed ${sexps.length} S-expressions`);

  if (options.showTiming) logger.endTiming("hql-process", "Parsing");
  return sexps;
}

/**
 * Transform parsed S-expressions into canonical form
 */
function transform(sexps: SExp[], options: ProcessOptions): SExp[] {
  if (options.showTiming) logger.startTiming("hql-process", "Syntax transform");

  const canonicalSexps = transformSyntax(sexps);

  if (options.showTiming) logger.endTiming("hql-process", "Syntax transform");
  return canonicalSexps;
}

/**
 * Process imports with error handling
 */
async function handleImports(
  sexps: SExp[],
  env: Environment,
  options: ProcessOptions,
): Promise<void> {
  if (options.showTiming) {
    logger.startTiming("hql-process", "Import processing");
  }

  await processImports(sexps, env, {
    verbose: options.verbose,
    baseDir: options.baseDir || platformCwd(),
    tempDir: options.tempDir,
    currentFile: options.currentFile,
  });

  if (options.showTiming) logger.endTiming("hql-process", "Import processing");
}

/**
 * Expand macros in the S-expressions
 */
function expand(
  sexps: SExp[],
  env: Environment,
  options: ProcessOptions,
  macroOptions: MacroExpanderOptions = {},
): SExp[] {
  if (options.showTiming) logger.startTiming("hql-process", "Macro expansion");

  try {
    const expanded = expandMacros(sexps, env, {
      verbose: macroOptions.verbose ?? options.verbose,
      currentFile: macroOptions.currentFile ?? options.currentFile,
      useCache: macroOptions.useCache ?? true,
      iterationLimit: macroOptions.iterationLimit,
      maxExpandDepth: macroOptions.maxExpandDepth,
    });

    if (options.showTiming) logger.endTiming("hql-process", "Macro expansion");
    return expanded;
  } catch (error) {
    if (options.showTiming) logger.endTiming("hql-process", "Macro expansion");

    // Handle macro errors specifically
    if (error instanceof MacroError) {
      reportError(error);
    }
    throw error;
  }
}

/**
 * Convert S-expressions to HQL AST with optional timing
 */
function convertSexpsToHqlAst(
  sexps: SExp[],
  options: ProcessOptions,
): HQLNode[] {
  if (options.showTiming) logger.startTiming("hql-process", "AST conversion");

  try {
    const hqlAst = convert(sexps, { verbose: options.verbose });

    if (options.showTiming) logger.endTiming("hql-process", "AST conversion");
    return hqlAst;
  } catch (error) {
    if (options.showTiming) logger.endTiming("hql-process", "AST conversion");

    // Handle transform errors
    if (error instanceof TransformError) {
      reportError(error);
    }
    throw error;
  }
}

/**
 * Transform HQL AST to JavaScript
 */
async function transpileHqlAstToJs(
  hqlAst: HQLNode[],
  options: ProcessOptions,
  env?: Environment,
): Promise<TranspileResult> {
  if (options.showTiming) {
    logger.startTiming("hql-process", "JS transformation");
  }

  try {
    const result = await transformAST(
      hqlAst,
      options.baseDir || platformCwd(),
      {
        verbose: options.verbose,
        currentFile: options.currentFile,
        generateSourceMap: options.generateSourceMap,
        sourceContent: options.sourceContent,
      },
      env,
    );

    if (options.showTiming) {
      logger.endTiming("hql-process", "JS transformation");
    }
    return result;
  } catch (error) {
    if (options.showTiming) {
      logger.endTiming("hql-process", "JS transformation");
    }

    // Handle transform errors
    if (error instanceof TransformError) {
      reportError(error);
    }
    throw error;
  }
}

/**
 * Transform HQL AST to JavaScript and return IR
 */
async function transpileHqlAstToJsWithIR(
  hqlAst: HQLNode[],
  options: ProcessOptions,
  env?: Environment,
): Promise<TranspileWithIRResult> {
  if (options.showTiming) {
    logger.startTiming("hql-process", "JS transformation");
  }

  try {
    const result = await transformAST(
      hqlAst,
      options.baseDir || platformCwd(),
      {
        verbose: options.verbose,
        currentFile: options.currentFile,
        generateSourceMap: options.generateSourceMap,
        sourceContent: options.sourceContent,
      },
      env,
    );

    if (options.showTiming) {
      logger.endTiming("hql-process", "JS transformation");
    }
    return {
      code: result.code,
      sourceMap: result.sourceMap,
      ir: result.ir as IRProgram,
    };
  } catch (error) {
    if (options.showTiming) {
      logger.endTiming("hql-process", "JS transformation");
    }

    // Handle transform errors
    if (error instanceof TransformError) {
      reportError(error);
    }
    throw error;
  }
}

/**
 * Load built-in system macros from the standard library files
 */
export async function loadSystemMacros(
  env: Environment,
  options: ProcessOptions,
): Promise<void> {
  try {
    const macroPaths = Object.keys(EMBEDDED_MACROS);
    for (const macroPath of macroPaths) {
      if (env.hasProcessedFile(macroPath)) continue;

      // Mark as processed immediately to prevent cycles
      env.markFileProcessed(macroPath);

      const macroSource =
        EMBEDDED_MACROS[macroPath as keyof typeof EMBEDDED_MACROS];

      const macroExps = macroExpressionsCache.get(macroPath) ||
        parse(macroSource);
      macroExpressionsCache.set(macroPath, macroExps);

      const transformed = transformSyntax(macroExps);

      await processImports(transformed, env, {
        verbose: options.verbose || false,
        baseDir: ".",
        currentFile: macroPath,
      });

      // Process macros in system files - only macro is used
      expandMacros(transformed, env, {
        verbose: options.verbose,
        currentFile: macroPath,
      });

      // Register in symbol table
      globalSymbolTable.set({
        name: basename(macroPath, ".hql"),
        kind: "module",
        scope: "global",
        meta: { isCore: true, isMacroModule: true },
      });
    }

    logger.debug("System macros loaded successfully");
  } catch (error) {
    if (error instanceof Error) {
      throw new TranspilerError(`Loading system macro files: ${error.message}`);
    } else {
      throw new TranspilerError(`Loading system macro files: ${String(error)}`);
    }
  }
}

/**
 * Get or initialize the global environment
 */
async function getGlobalEnv(options: ProcessOptions): Promise<Environment> {
  // Always create a fresh environment - no more global singleton
  logger.debug("Starting new global environment initialization");
  
  const t = performance.now();
  logger.debug("Initializing global environment");

  const env = await Environment.createStandard();
  await loadSystemMacros(env, options);

  logger.debug(
    `Global environment initialization took ${
      (performance.now() - t).toFixed(2)
    }ms`,
  );

  return env;
}
