// HQL - ESM module for JSR
// Minimal API for transpiling HQL to JavaScript

import {
  expandHql,
  transpileToJavascript,
} from "./src/transpiler/hql-transpiler.ts";
import { transpileCLI } from "./src/bundler.ts";
import { initializeRuntime } from "./src/common/runtime-initializer.ts";
import {
  getRangeHelperWithDependency,
  getRuntimeHelperSource,
} from "./src/common/runtime-helper-impl.ts";
import {
  getCachedPath,
  getRuntimeCacheDir,
} from "./src/common/hql-cache-tracker.ts";
import {
  basename,
  cwd as platformCwd,
  dirname,
  exists,
  fromFileUrl as platformFromFileUrl,
  isAbsolute as platformIsAbsolute,
  join,
  mkdir as platformMkdir,
  normalize as platformNormalize,
  readTextFile as platformReadTextFile,
  relative as platformRelative,
  resolve as platformResolve,
  toFileUrl as platformToFileUrl,
  useNodePlatform,
  writeTextFile as platformWriteTextFile,
} from "./src/platform/platform.ts";
import * as acorn from "npm:acorn@8.11.3";
import { sexpToString } from "./src/s-exp/types.ts";
import { installSourceMapSupport } from "./src/transpiler/pipeline/source-map-support.ts";
import {
  transformStackTrace,
  withTransformedStackTraces,
} from "./src/transpiler/pipeline/transform-stack-trace.ts";
import {
  handleRuntimeError,
  setRuntimeContext,
} from "./src/common/runtime-error-handler.ts";
import { getErrorConfig } from "./src/common/error-system.ts";
import type { RawSourceMap } from "npm:source-map@0.6.1";
import process from "node:process";

// Import embedded packages for binary compilation
let EMBEDDED_PACKAGES: Record<string, string> = {};
try {
  const embeddedModule = await import("./src/embedded-packages.ts");
  EMBEDDED_PACKAGES = embeddedModule.EMBEDDED_PACKAGES || {};
} catch {
  // No embedded packages (development mode, using file system)
}

// Get the directory where this mod.ts file is located (HQL installation directory)
// This is used to resolve @hql/* stdlib packages relative to the HQL installation,
// not relative to user code location
const HQL_MODULE_DIR = platformFromFileUrl(dirname(import.meta.url));

if (
  typeof globalThis.Deno === "undefined" && typeof process !== "undefined" &&
  process.versions?.node
) {
  try {
    await useNodePlatform();
  } catch {
    // Ignore failures; consumers can invoke useNodePlatform manually.
  }
}

// Install automatic source map support - errors will show HQL positions automatically
installSourceMapSupport();

export interface TranspileResult {
  code: string;
  sourceMap?: string;
}

export interface HQLModule {
  isHQL: (code: string) => boolean;
  transpile: (
    source: string,
    options?: TranspileOptions,
  ) => Promise<string | TranspileResult>;
  run: (source: string, options?: RunOptions) => Promise<unknown>;
  runFile?: (filePath: string, options?: RunOptions) => Promise<unknown>;
  macroexpand?: (
    source: string,
    options?: MacroExpandOptions,
  ) => Promise<string[]>;
  macroexpand1?: (
    source: string,
    options?: MacroExpandOptions,
  ) => Promise<string[]>;
  version: string;
}

export type HqlAdapter = (js: string) => unknown | Promise<unknown>;

export interface MacroExpandOptions {
  baseDir?: string;
  currentFile?: string;
  verbose?: boolean;
}

export interface TranspileOptions extends Record<string, unknown> {
  baseDir?: string;
  currentFile?: string;
  generateSourceMap?: boolean;
  sourceContent?: string;
}

export interface RunOptions extends TranspileOptions {
  adapter?: HqlAdapter;
}

/**
 * Check if a string looks like HQL code
 */
export function isHQL(code: string): boolean {
  const trimmed = code.trim();
  return trimmed.startsWith("(") || trimmed.startsWith("[");
}

/**
 * Transpile HQL source to JavaScript
 * @param source - HQL source code
 * @param options - Options including baseDir for resolving imports
 */
export async function transpile(
  source: string,
  options: TranspileOptions = {},
): Promise<string | TranspileResult> {
  // Default baseDir to directory of currentFile if provided, otherwise current working directory
  const baseDir = options.baseDir ?? 
    (options.currentFile ? dirname(options.currentFile) : platformCwd());

  const transpileOptions: TranspileOptions = {
    ...options,
    baseDir,
    currentFile: options.currentFile,
  };
  const result = await transpileToJavascript(source, transpileOptions);

  // Add runtime helper functions if needed (must happen before returning source maps)
  const needsGet = result.code.includes("__hql_get(") ||
    result.code.includes("__hql_getNumeric(");
  const needsRange = result.code.includes("__hql_range");
  const needsHashMap = result.code.includes("__hql_hash_map");
  const needsThrow = result.code.includes("__hql_throw");
  const needsSequence = result.code.includes("__hql_toSequence(") ||
    result.code.includes("__hql_for_each(");
  const needsDeepFreeze = result.code.includes("__hql_deepFreeze(");
  const needsMatchObj = result.code.includes("__hql_match_obj(");

  // If source maps are requested, inject helpers WITHOUT IIFE wrapping
  if (options.generateSourceMap && result.sourceMap) {
    const helperSnippets: string[] = [];

    if (needsGet) {
      helperSnippets.push(
        `const __hql_get = ${getRuntimeHelperSource("__hql_get")};`,
      );
      helperSnippets.push(`const __hql_getNumeric = __hql_get;`);
    }

    if (needsRange) {
      // Use special function that includes rangeCore dependency
      helperSnippets.push(getRangeHelperWithDependency());
    }

    if (needsSequence) {
      helperSnippets.push(
        `const __hql_toSequence = ${
          getRuntimeHelperSource("__hql_toSequence")
        };`,
      );
      helperSnippets.push(
        `const __hql_for_each = ${getRuntimeHelperSource("__hql_for_each")};`,
      );
    }

    if (needsHashMap) {
      helperSnippets.push(
        `const __hql_hash_map = ${getRuntimeHelperSource("__hql_hash_map")};`,
      );
    }

    if (needsThrow) {
      helperSnippets.push(
        `const __hql_throw = ${getRuntimeHelperSource("__hql_throw")};`,
      );
    }

    if (needsDeepFreeze) {
      helperSnippets.push(
        `const __hql_deepFreeze = ${
          getRuntimeHelperSource("__hql_deepFreeze")
        };`,
      );
    }

    if (needsMatchObj) {
      helperSnippets.push(
        `const __hql_match_obj = ${getRuntimeHelperSource("__hql_match_obj")};`,
      );
    }

    // Prepend helpers to code WITHOUT wrapping
    // CRITICAL: 'use strict' must be FIRST for strict mode to be in effect
    // If it comes after any statement (like helper definitions), it's just a string expression
    let userCode = result.code;
    let useStrictDirective = "";

    // Extract 'use strict' if present at the start of user code
    const strictMatch = userCode.match(/^(['"]use strict['"];?\s*\n?)/);
    if (strictMatch) {
      useStrictDirective = "'use strict';\n";
      userCode = userCode.slice(strictMatch[0].length);
    }

    const codeWithHelpers = helperSnippets.length > 0
      ? `${useStrictDirective}${helperSnippets.join("\n")}\n\n${userCode}`
      : result.code;

    // Adjust source map to account for line offset from:
    // Helper functions prepended above (if any)
    // NOTE: js-code-generator.ts already adjusted for 'use strict' by prepending `;` to mappings,
    // so we DON'T add useStrictOffset here (that would be double-counting)
    // PROPER SOLUTION: Shift all generated line numbers in the source map mappings
    if (result.sourceMap) {
      // Calculate total line offset from helpers only (NOT 'use strict' - that's already handled)
      // CRITICAL: Count ACTUAL lines in helpers, not just number of helper snippets!
      // Each helper can be multi-line (e.g. __hql_get is 11 lines)
      const helperLineCount = helperSnippets.length > 0
        ? helperSnippets.reduce((count, snippet) => count + snippet.split("\n").length, 0) + 1  // +1 for empty line after helpers
        : 0;
      const totalLineOffset = helperLineCount;

      if (totalLineOffset > 0) {
        const mapJson = JSON.parse(result.sourceMap);

        // Import the SourceMapGenerator to properly adjust mappings
      const { SourceMapGenerator } = await import("npm:source-map@0.6.1");

      // Create a new source map with adjusted line numbers
      const generator = new SourceMapGenerator({
        file: mapJson.file
      });

      // Re-add source content if it exists
      if (mapJson.sourcesContent) {
        mapJson.sources.forEach((source: string, i: number) => {
          if (mapJson.sourcesContent[i]) {
            generator.setSourceContent(source, mapJson.sourcesContent[i]);
          }
        });
      }

      // Parse the original mappings and shift all generated lines down
      const { SourceMapConsumer } = await import("npm:source-map@0.6.1");
      const consumer = await new SourceMapConsumer(mapJson);

      interface MappingItem {
        source: string | null;
        originalLine: number | null;
        originalColumn: number | null;
        generatedLine: number;
        generatedColumn: number;
        name: string | null;
      }

      consumer.eachMapping((mapping: MappingItem) => {
        // Only add mappings that have valid original positions
        // Source maps can have generated-only mappings (no original source)
        // Skip those since we can't shift them properly
        if (mapping.source !== null &&
            mapping.originalLine !== null &&
            mapping.originalColumn !== null) {
          generator.addMapping({
            source: mapping.source,
            original: {
              line: mapping.originalLine,
              column: mapping.originalColumn
            },
            generated: {
              line: mapping.generatedLine + totalLineOffset, // Shift down by total offset
              column: mapping.generatedColumn
            },
            name: mapping.name || undefined
          });
        }
        // Skip generated-only mappings - they don't map back to HQL source
      });

        // Note: consumer cleanup handled by garbage collection
        // destroy() method exists but not in TypeScript types

        return {
          code: codeWithHelpers,
          sourceMap: generator.toString(),
        };
      }
    }

    return {
      code: codeWithHelpers,
      sourceMap: result.sourceMap,
    };
  }

  // For non-source-map mode, use IIFE wrapping as before
  // BUT: Don't wrap if code has ES module exports or imports (would break module syntax)
  const hasExports = result.code.includes("export ") &&
    result.code.match(/^\s*export\s+/m);
  const hasImports = result.code.includes("import ") &&
    result.code.match(/^\s*import\s+/m);

  if (
    !hasExports &&
    !hasImports &&
    (needsGet || needsRange || needsSequence || needsThrow || needsHashMap ||
      needsDeepFreeze || needsMatchObj)
  ) {
    const helperSnippets: string[] = [];

    if (needsGet) {
      helperSnippets.push(
        `const __hql_get = ${getRuntimeHelperSource("__hql_get")};`,
      );
      helperSnippets.push(`const __hql_getNumeric = __hql_get;`);
    }

    if (needsRange) {
      // Use special function that includes rangeCore dependency
      helperSnippets.push(getRangeHelperWithDependency());
    }

    if (needsSequence) {
      helperSnippets.push(
        `const __hql_toSequence = ${
          getRuntimeHelperSource("__hql_toSequence")
        };`,
      );
      helperSnippets.push(
        `const __hql_for_each = ${getRuntimeHelperSource("__hql_for_each")};`,
      );
    }

    if (needsHashMap) {
      helperSnippets.push(
        `const __hql_hash_map = ${getRuntimeHelperSource("__hql_hash_map")};`,
      );
    }

    if (needsThrow) {
      helperSnippets.push(
        `const __hql_throw = ${getRuntimeHelperSource("__hql_throw")};`,
      );
    }

    if (needsDeepFreeze) {
      helperSnippets.push(
        `const __hql_deepFreeze = ${
          getRuntimeHelperSource("__hql_deepFreeze")
        };`,
      );
    }

    if (needsMatchObj) {
      helperSnippets.push(
        `const __hql_match_obj = ${getRuntimeHelperSource("__hql_match_obj")};`,
      );
    }

    // Use an IIFE to avoid polluting scope and handle redeclaration
    const runtimeFunctions = helperSnippets.length
      ? `\n${helperSnippets.join("\n")}\n`
      : "";

    // Extract "use strict" directive if present (BUGFIX: must be statement, not inside return)
    const trimmedCode = result.code.trim();
    let useStrictDirective = "";
    let codeWithoutStrict = trimmedCode;
    const firstLine = trimmedCode.split("\n")[0];
    if (firstLine === '"use strict";' || firstLine === "'use strict';") {
      useStrictDirective = '    "use strict";\n';
      const lines = trimmedCode.split("\n");
      codeWithoutStrict = lines.slice(1).join("\n").trim();
    }

    // Parse JavaScript using acorn (standard JS parser)
    // Note: acorn returns ESTree AST nodes. We use minimal typing here to avoid
    // pulling in full @types/estree. The actual runtime behavior is what matters.
    interface AcornNode {
      type: string;
      start: number;
      end: number;
      body?: AcornNode[];
      expression?: AcornNode;
    }

    const ast = acorn.parse(codeWithoutStrict, {
      ecmaVersion: 2020,
      sourceType: "module",
      locations: true
    }) as unknown as { body: AcornNode[] };

    const statements = ast.body;
    const hasStatements = statements.length > 1 ||
      statements.some((statement) =>
        statement.type !== 'ExpressionStatement' &&
        statement.type !== 'EmptyStatement'
      );

    if (hasStatements) {
      const precedingStatements = statements.slice(0, -1);
      const lastStatement = statements[statements.length - 1];

      // Extract source code for a statement using its position
      const getStatementSource = (statement: AcornNode): string => {
        return codeWithoutStrict.slice(statement.start, statement.end).trim();
      };

      const formatStatement = (statement: AcornNode): string => {
        const source = getStatementSource(statement);
        return source
          .split("\n")
          .map((line) => `    ${line}`)
          .join("\n");
      };

      const formattedPreceding = precedingStatements
        .map((statement) => formatStatement(statement))
        .join("\n");

      let formattedLast: string;
      if (lastStatement.type === 'ExpressionStatement') {
        // Extract just the expression part (without trailing semicolon)
        const expr = lastStatement.expression;
        if (!expr || typeof expr.start !== 'number' || typeof expr.end !== 'number') {
          throw new Error("Invalid expression node in REPL wrapper");
        }
        const expressionSource = codeWithoutStrict
          .slice(expr.start, expr.end)
          .trim();
        formattedLast = `    return ${expressionSource};`;
      } else if (
        lastStatement.type === 'ReturnStatement' ||
        lastStatement.type === 'ThrowStatement'
      ) {
        formattedLast = formatStatement(lastStatement);
      } else {
        const source = getStatementSource(lastStatement);
        const formattedBody = source
          .split("\n")
          .map((line) => `    ${line}`)
          .join("\n");
        formattedLast = `${formattedBody}\n    return undefined;`;
      }

      const wrappedCode = `
(function() {${runtimeFunctions}

  return (function() {
${useStrictDirective}${
        formattedPreceding ? formattedPreceding + "\n" : ""
      }${formattedLast}
  })();
})()`;
      return wrappedCode;
    } else {
      // Single expression: wrap in return as before
      const finalExpression = codeWithoutStrict.endsWith(";")
        ? codeWithoutStrict.slice(0, -1)
        : codeWithoutStrict;

      const formattedExpression = finalExpression
        .split("\n")
        .map((line) => `      ${line}`)
        .join("\n");

      const wrappedCode = `
(function() {${runtimeFunctions}

  // Execute the transpiled code and ensure the last expression value is returned
  return (function() {
${useStrictDirective}    return (
${formattedExpression}
    );
  })();
})()`;
      return wrappedCode;
    }
  } else if ((hasExports || hasImports) && (needsGet || needsRange || needsSequence || needsThrow || needsHashMap || needsDeepFreeze || needsMatchObj)) {
    // Code has ES module exports/imports AND needs helpers
    // Prepend helpers WITHOUT wrapping (like source map mode)
    const helperSnippets: string[] = [];

    if (needsGet) {
      helperSnippets.push(
        `const __hql_get = ${getRuntimeHelperSource("__hql_get")};`,
      );
      helperSnippets.push(`const __hql_getNumeric = __hql_get;`);
    }

    if (needsRange) {
      helperSnippets.push(getRangeHelperWithDependency());
    }

    if (needsSequence) {
      helperSnippets.push(
        `const __hql_toSequence = ${
          getRuntimeHelperSource("__hql_toSequence")
        };`,
      );
      helperSnippets.push(
        `const __hql_for_each = ${getRuntimeHelperSource("__hql_for_each")};`,
      );
    }

    if (needsHashMap) {
      helperSnippets.push(
        `const __hql_hash_map = ${getRuntimeHelperSource("__hql_hash_map")};`,
      );
    }

    if (needsThrow) {
      helperSnippets.push(
        `const __hql_throw = ${getRuntimeHelperSource("__hql_throw")};`,
      );
    }

    if (needsDeepFreeze) {
      helperSnippets.push(
        `const __hql_deepFreeze = ${
          getRuntimeHelperSource("__hql_deepFreeze")
        };`,
      );
    }

    if (needsMatchObj) {
      helperSnippets.push(
        `const __hql_match_obj = ${getRuntimeHelperSource("__hql_match_obj")};`,
      );
    }

    // Prepend helpers to code WITHOUT wrapping
    return helperSnippets.length > 0
      ? `${helperSnippets.join("\n")}\n\n${result.code}`
      : result.code;
  }

  return result.code;
}

/**
 * Wrap JavaScript code for ES module export
 * Parses the JS, finds the last expression, and wraps in export default
 * so that import() returns the last expression value (like eval does)
 */
function wrapCodeForModuleExport(code: string): string {
  // Parse JavaScript using acorn
  interface AcornNode {
    type: string;
    start: number;
    end: number;
    expression?: AcornNode;
  }

  try {
    const ast = acorn.parse(code, {
      ecmaVersion: 2020,
      sourceType: "module",
      locations: true,
    }) as unknown as { body: AcornNode[] };

    const statements = ast.body;
    if (statements.length === 0) {
      return `export default undefined;`;
    }

    const lastStatement = statements[statements.length - 1];
    const precedingCode = code.slice(0, lastStatement.start).trim();
    const lastCode = code.slice(lastStatement.start, lastStatement.end).trim();

    // Build the wrapped code
    let body: string;
    let returnStmt: string;

    if (lastStatement.type === "ExpressionStatement" && lastStatement.expression) {
      // Last statement is an expression - return its value
      const expr = code.slice(lastStatement.expression.start, lastStatement.expression.end);
      body = precedingCode;
      returnStmt = `return ${expr};`;
    } else {
      // Last statement is not an expression (e.g., declaration) - execute it and return undefined
      body = precedingCode ? `${precedingCode}\n${lastCode}` : lastCode;
      returnStmt = `return undefined;`;
    }

    // Wrap in async IIFE with export default
    if (body) {
      return `export default (async () => {\n${body}\n${returnStmt}\n})();`;
    } else {
      return `export default (async () => {\n${returnStmt}\n})();`;
    }
  } catch {
    // If parsing fails, wrap the whole code and return undefined
    return `export default (async () => {\n${code}\nreturn undefined;\n})();`;
  }
}

/**
 * Run HQL code by transpiling and evaluating
 * @param source - HQL source code
 * @param options - Options including baseDir and optional adapter
 */
export async function run(
  source: string,
  options: RunOptions = {},
): Promise<unknown> {
  const baseDir = options.baseDir || platformCwd();
  const currentFile = options.currentFile
    ? (platformIsAbsolute(options.currentFile)
      ? options.currentFile
      : platformResolve(baseDir, options.currentFile))
    : join(baseDir, "<anonymous>.hql");
  const importerDir = dirname(currentFile);
  const runtimeDir = await getRuntimeCacheDir();
  const compiledModules = new Map<string, Promise<string>>();
  const moduleOutputs = new Map<string, string>();

  // Enable source maps for better error reporting when working with actual files
  // For REPL/eval cases (anonymous files), keep source maps off by default
  // to avoid breaking return value expectations
  const isRealFile = Boolean(
    currentFile && !currentFile.includes("<anonymous>"),
  );
  const transpileOptions: RunOptions = {
    ...options,
    currentFile: currentFile, // Use resolved absolute path
    // Enable source maps by default for real files, otherwise only when explicitly requested
    generateSourceMap: options.generateSourceMap ?? isRealFile,
    sourceContent: options.sourceContent ?? source,
  };

  const transpileResult = await transpile(source, transpileOptions);
  const initialJs = typeof transpileResult === "string"
    ? transpileResult
    : transpileResult.code;
  const sourceMap = typeof transpileResult === "string"
    ? undefined
    : transpileResult.sourceMap;

  // Parse source map for runtime error handling
  const parsedSourceMap: RawSourceMap | null = sourceMap
    ? JSON.parse(sourceMap) as RawSourceMap
    : null;

  const processed = await processModuleCode(initialJs, {
    importerDir,
    baseDir,
    runtimeDir,
    compiledModules,
    moduleOutputs,
    isEntry: true,
  });
  const js = processed.code;

  await initializeRuntime();

  if (options.adapter) {
    // Use provided adapter (e.g., HLVM's eval context)
    return await options.adapter(js);
  }

  // Check if code has ESM imports/exports - if so, write the JS next to the source baseDir for correct relative resolution
  const shouldUseModuleLoader = processed.hasImports ||
    (js.includes("export ") && js.match(/^\s*export\s+/m));

  // Skip TypeScript compilation - escodegen already produces valid JavaScript
  // Running ts.transpileModule() would destroy our carefully crafted source maps
  const compiledJs = js;

  if (shouldUseModuleLoader) {
    try {
      await platformMkdir(runtimeDir, { recursive: true });
    } catch { /* ignore */ }
    const fileName = `rt-${Date.now()}-${
      Math.random().toString(36).slice(2)
    }.mjs`;
    const outPath = platformResolve(runtimeDir, fileName);

    // Write source map if available
    if (sourceMap) {
      const mapPath = `${outPath}.map`;

      // Fix source map file path to match actual output path
      const mapJson = JSON.parse(sourceMap);
      mapJson.file = outPath; // Update to actual runtime file path
      const correctedSourceMap = JSON.stringify(mapJson);

      await platformWriteTextFile(mapPath, correctedSourceMap);
      const codeWithSourceMap = `${compiledJs}\n//# sourceMappingURL=${
        basename(mapPath)
      }`;
      await platformWriteTextFile(outPath, codeWithSourceMap);
    } else {
      await platformWriteTextFile(outPath, compiledJs);
    }

    try {
      // Set runtime context for better error location resolution
      // Pass the parsed source map and JS file path so runtime errors can map back to HQL source
      setRuntimeContext(currentFile, outPath, parsedSourceMap);

      const module = await import(platformToFileUrl(outPath).href);
      return "default" in module ? module.default : module;
    } catch (runtimeError) {
      // Enhance error with HQL context before rethrowing
      if (runtimeError instanceof Error) {
        throw await handleRuntimeError(runtimeError, getErrorConfig());
      }
      throw runtimeError;
    }
  }

  // Default: eval in isolated scope (for code without imports)
  // If source map is available, write temp file and import instead of eval
  if (sourceMap) {
    try {
      await platformMkdir(runtimeDir, { recursive: true });
    } catch { /* ignore */ }
    const fileName = `rt-eval-${Date.now()}-${
      Math.random().toString(36).slice(2)
    }.mjs`;
    const outPath = platformResolve(runtimeDir, fileName);
    const mapPath = `${outPath}.map`;

    // Wrap code in export default to return last expression value
    // ES modules don't automatically export the result like eval() does
    const wrappedCode = wrapCodeForModuleExport(compiledJs);
    const wrapperLineOffset = 1; // "export default (async () => {" adds 1 line

    // Fix source map file path and adjust line numbers for wrapper
    const mapJson = JSON.parse(sourceMap);
    mapJson.file = outPath; // Update to actual runtime file path

    // Shift all generated line numbers down to account for wrapper prefix
    if (mapJson.mappings && wrapperLineOffset > 0) {
      // Add empty line mappings for wrapper prefix (semicolons = empty lines)
      const emptyLines = ";".repeat(wrapperLineOffset);
      mapJson.mappings = emptyLines + mapJson.mappings;
    }
    const correctedSourceMap = JSON.stringify(mapJson);

    await platformWriteTextFile(mapPath, correctedSourceMap);
    const codeWithSourceMap = `${wrappedCode}\n//# sourceMappingURL=${
      basename(mapPath)
    }`;
    await platformWriteTextFile(outPath, codeWithSourceMap);

    try {
      // Set runtime context for better error location resolution
      // Pass the ADJUSTED source map (with wrapper offset) so runtime errors can map back to HQL source
      setRuntimeContext(currentFile, outPath, mapJson as RawSourceMap);

      const module = await import(platformToFileUrl(outPath).href);
      // IMPORTANT: module.default is a Promise from the async IIFE wrapper
      // We must await it here so errors are caught by this try/catch
      const result = "default" in module ? await module.default : module;
      return result;
    } catch (runtimeError) {
      // Enhance error with HQL context before rethrowing
      if (runtimeError instanceof Error) {
        throw await handleRuntimeError(runtimeError, getErrorConfig());
      }
      throw runtimeError;
    }
  }

  // Fallback: eval without source maps
  try {
    // Set runtime context for better error location resolution
    // Pass the parsed source map so runtime errors can map back to HQL source
    setRuntimeContext(currentFile, undefined, parsedSourceMap);

    const AsyncFunction =
      Object.getPrototypeOf(async function () {}).constructor;
    const evaluate = new AsyncFunction("source", "return eval(source);");
    return await evaluate(compiledJs);
  } catch (runtimeError) {
    // Enhance error with HQL context before rethrowing
    if (runtimeError instanceof Error) {
      throw await handleRuntimeError(runtimeError, getErrorConfig());
    }
    throw runtimeError;
  }
}

async function macroexpandInternal(
  source: string,
  iterationLimit: number | undefined,
  options: MacroExpandOptions = {},
  macroOverrides: { maxExpandDepth?: number } = {},
): Promise<string[]> {
  const processOptions = {
    baseDir: options.baseDir ?? platformCwd(),
    currentFile: options.currentFile,
    verbose: options.verbose,
  };

  const expanded = await expandHql(source, processOptions, {
    iterationLimit,
    currentFile: options.currentFile,
    verbose: options.verbose,
    maxExpandDepth: macroOverrides.maxExpandDepth,
  });

  return expanded.map((expr) => sexpToString(expr));
}

export function macroexpand(
  source: string,
  options: MacroExpandOptions = {},
): Promise<string[]> {
  return macroexpandInternal(source, undefined, options);
}

export function macroexpand1(
  source: string,
  options: MacroExpandOptions = {},
): Promise<string[]> {
  return macroexpandInternal(source, 1, options, { maxExpandDepth: 0 });
}

export {
  DenoPlatform,
  getPlatform,
  type Platform,
  setPlatform,
  useNodePlatform,
} from "./src/platform/platform.ts";

interface ModuleProcessingContext {
  importerDir: string;
  baseDir: string;
  runtimeDir: string;
  compiledModules: Map<string, Promise<string>>;
  moduleOutputs: Map<string, string>;
  isEntry: boolean;
}

interface ModuleProcessingResult {
  code: string;
  hasImports: boolean;
}

async function processModuleCode(
  js: string,
  context: ModuleProcessingContext,
): Promise<ModuleProcessingResult> {
  const importStatements: string[] = [];
  const importRegex = /^\s*import[\s\S]*?;\s*$/gm;
  const bodyWithoutImports = js.replace(importRegex, (statement) => {
    importStatements.push(statement.trim());
    return "";
  });

  if (importStatements.length === 0) {
    if (context.isEntry) {
      return { code: js, hasImports: false };
    }
    const trimmed = bodyWithoutImports.trimEnd();
    return {
      code: trimmed.length > 0 ? `${trimmed}\n` : trimmed,
      hasImports: false,
    };
  }

  const updatedImports: string[] = [];
  const seenImports = new Set<string>();
  for (const statement of importStatements) {
    const rewritten = await rewriteImportStatement(statement, context);
    if (rewritten && !seenImports.has(rewritten)) {
      seenImports.add(rewritten);
      updatedImports.push(rewritten);
    }
  }

  const joinedImports = updatedImports.join("\n");
  // Remove 'use strict'; directive if present - it will be re-added by the generated IIFE if needed
  const cleanBody = bodyWithoutImports.trim().replace(/^['"]use strict['"];?\s*\n?/, "");
  const trimmedBody = cleanBody.trim().replace(/;+\s*$/, "");

  // Check for existing exports in the body
  const hasExports = cleanBody.includes("export ") && !!cleanBody.match(/^\s*export\s+/m);

  if (context.isEntry && !hasExports) {
    // For entry modules with imports but NO existing exports, wrap the result in export default
    let expressionBody: string;
    if (trimmedBody.length === 0) {
      expressionBody = "undefined";
    } else {
      // Check if body has multiple top-level statements (not counting semicolons inside nested structures)
      // Count semicolons at nesting level 0 (outside all braces/brackets/parens)
      let depth = 0;
      let topLevelSemicolons = 0;
      for (let i = 0; i < trimmedBody.length; i++) {
        const char = trimmedBody[i];
        if (char === '{' || char === '[' || char === '(') depth++;
        else if (char === '}' || char === ']' || char === ')') depth--;
        else if (char === ';' && depth === 0) topLevelSemicolons++;
      }
      const hasMultipleStatements = topLevelSemicolons > 0;

      if (hasMultipleStatements) {
        // Wrap in async IIFE to make it a single expression (supports top-level await)
        const statements = trimmedBody.split(/;[\s\n]*/).filter((s) =>
          s.trim()
        );
        const lastStatement = statements.pop()?.trim() || "undefined";
        const bodyStatements = statements.map((s) => s.trim() + ";").join("\n");
        expressionBody =
          `(async () => {\n${bodyStatements}\nreturn ${lastStatement};\n})()`;
      } else {
        expressionBody = trimmedBody;
      }
    }
    const segments = [joinedImports, `export default ${expressionBody};`]
      .filter((segment) => segment.length > 0);
    return { code: `${segments.join("\n")}\n`, hasImports: true };
  }

  // Non-entry modules just return code with imports
  const bodySegment = trimmedBody.length > 0 ? `${trimmedBody}\n` : "";
  const segments = [joinedImports, bodySegment].filter((segment) =>
    segment.length > 0
  );
  return { code: segments.join("\n"), hasImports: true };
}

async function rewriteImportStatement(
  statement: string,
  context: ModuleProcessingContext,
): Promise<string> {
  const fromMatch = statement.match(/from\s+["']([^"']+)["']/);
  const bareMatch = fromMatch
    ? null
    : statement.match(/import\s+["']([^"']+)["']/);
  let specifier = fromMatch?.[1] ?? bareMatch?.[1];

  if (!specifier) {
    return statement;
  }

  let replacement = specifier;

  // Resolve @hql/* stdlib packages to embedded or actual paths
  if (specifier.startsWith("@hql/")) {
    // For compiled binary or dev mode with embedded packages
    if (EMBEDDED_PACKAGES[specifier]) {
      const compiledPath = await compileHqlModule(specifier, context);
      replacement = platformToFileUrl(compiledPath).href;
      
      if (fromMatch) {
        return statement.replace(fromMatch[1], replacement);
      }
      if (bareMatch) {
        return statement.replace(bareMatch[1], replacement);
      }
      return statement;
    }
    
    // Fallback for dev mode if not in EMBEDDED_PACKAGES (should generally be there now)
    const packageName = specifier.replace("@hql/", "");
    specifier = platformResolve(HQL_MODULE_DIR, `packages/${packageName}/mod.hql`);
    replacement = specifier;
  }

  if (
    !specifier.startsWith(".") && !specifier.startsWith("/") &&
    !specifier.startsWith("file:")
  ) {
    return statement;
  }

  const resolvedPath = resolveSpecifierPath(context.importerDir, specifier);
  const hqlPath = await resolveHqlModulePath(resolvedPath);

  if (hqlPath) {
    const compiledPath = await compileHqlModule(hqlPath, context);
    replacement = platformToFileUrl(compiledPath).href;
  } else {
    replacement = platformToFileUrl(resolvedPath).href;
  }

  if (fromMatch) {
    return statement.replace(fromMatch[1], replacement);
  }
  if (bareMatch) {
    return statement.replace(bareMatch[1], replacement);
  }
  return statement;
}

function resolveSpecifierPath(importerDir: string, specifier: string): string {
  if (specifier.startsWith("file:")) {
    return platformFromFileUrl(specifier);
  }
  if (platformIsAbsolute(specifier)) {
    return specifier;
  }
  return platformResolve(importerDir, specifier);
}

async function resolveHqlModulePath(
  resolvedPath: string,
): Promise<string | null> {
  if (resolvedPath.endsWith(".hql") && await exists(resolvedPath)) {
    return resolvedPath;
  }

  if (!resolvedPath.endsWith(".hql")) {
    const withExtension = `${resolvedPath}.hql`;
    if (await exists(withExtension)) {
      return withExtension;
    }
  }

  return null;
}

async function compileHqlModule(
  modulePath: string,
  context: ModuleProcessingContext,
): Promise<string> {
  const normalized = platformNormalize(modulePath);
  const existing = context.compiledModules.get(normalized);
  if (existing) {
    const precomputed = context.moduleOutputs.get(normalized);
    if (precomputed) {
      return precomputed;
    }
    return await existing;
  }

  const relativePath = platformRelative(context.baseDir, normalized).replace(
    /\\/g,
    "/",
  );
  
  // For @hql/ packages, use the package name as the relative path base to ensure unique cache location
  const isHqlPackage = modulePath.startsWith("@hql/");
  const targetRel = isHqlPackage 
    ? modulePath.replace("@hql/", "hql_packages/") + ".mjs"
    : relativePath.replace(/\.hql$/i, ".mjs");
    
  const outputPath = platformResolve(context.runtimeDir, targetRel);
  context.moduleOutputs.set(normalized, outputPath);

  const compilationPromise = (async () => {
    // Check if this is an embedded @hql/ package first
    let source: string;
    
    if (EMBEDDED_PACKAGES[modulePath]) {
        source = EMBEDDED_PACKAGES[modulePath];
    } else {
      // Fallback logic for other embedded paths or file system
      const isEmbeddedPackage = Object.keys(EMBEDDED_PACKAGES).some(key =>
        normalized.includes(key.replace("@hql/", "packages/"))
      );

      if (isEmbeddedPackage) {
        // Find the matching embedded package
        const packageKey = Object.keys(EMBEDDED_PACKAGES).find(key =>
          normalized.includes(key.replace("@hql/", "packages/"))
        );
        if (packageKey) {
          source = EMBEDDED_PACKAGES[packageKey];
        } else {
          source = await platformReadTextFile(normalized);
        }
      } else {
        source = await platformReadTextFile(normalized);
      }
    }

    // IMPORTANT: Use the module's directory as baseDir for resolving relative imports,
    // not the entry point's baseDir. This ensures imports like "./foo.hql" resolve
    // correctly relative to the importing file.
    const transpileResult = await transpile(source, {
      baseDir: dirname(normalized),
      currentFile: normalized,
      generateSourceMap: true,
    });
    const moduleJs = typeof transpileResult === "string"
      ? transpileResult
      : transpileResult.code;
    const sourceMap = typeof transpileResult === "string"
      ? undefined
      : transpileResult.sourceMap;

    const processed = await processModuleCode(moduleJs, {
      importerDir: dirname(normalized),
      baseDir: context.baseDir,
      runtimeDir: context.runtimeDir,
      compiledModules: context.compiledModules,
      moduleOutputs: context.moduleOutputs,
      isEntry: false,
    });

    await platformMkdir(dirname(outputPath), { recursive: true });

    if (sourceMap) {
      const mapPath = `${outputPath}.map`;
      const mapJson = JSON.parse(sourceMap);
      mapJson.file = outputPath;
      await platformWriteTextFile(mapPath, JSON.stringify(mapJson));
      
      const codeWithMap = `${processed.code}\n//# sourceMappingURL=${basename(mapPath)}`;
      await platformWriteTextFile(outputPath, codeWithMap);
    } else {
      await platformWriteTextFile(outputPath, processed.code);
    }
    
    return outputPath;
  })();

  context.compiledModules.set(normalized, compilationPromise);
  return await compilationPromise;
}

/**
 * Convenience: Run an HQL file from disk with proper baseDir/currentFile
 */
export async function runFile(
  filePath: string,
  options: RunOptions = {},
): Promise<unknown> {
  const absPath = platformIsAbsolute(filePath)
    ? filePath
    : platformResolve(platformCwd(), filePath);
  const code = await platformReadTextFile(absPath);
  const baseDir = dirname(absPath);
  // First try the simple transpile + dynamic import path, which supports HTTP/JSR/npm imports at runtime
  try {
    return await run(code, { ...options, baseDir, currentFile: absPath });
  } catch (simpleErr) {
    // If it's a RuntimeError (user code error), don't try fallback - just rethrow
    if (simpleErr && typeof simpleErr === "object" && "code" in simpleErr) {
      throw simpleErr;
    }

    // If that fails (e.g., complex graphs needing bundling), fall back to bundler-based compile+run
    try {
      const cacheOutPath = await getCachedPath(absPath, ".bundle.js", {
        createDir: true,
        preserveRelative: true,
      });
      const outPath = await transpileCLI(absPath, cacheOutPath, {
        verbose: false,
        showTiming: false,
        force: true,
      });
      const modUrl = "file://" + outPath;
      const m = await import(modUrl);
      return m?.default ?? m;
    } catch (e) {
      throw e;
    }
  }
}

// Export runtime features
export {
  defineMacro,
  gensym,
  getMacros,
  hasMacro,
  hqlEval,
  HQLRuntime,
  macroexpand as macroexpandRuntime,
  macroexpand1 as macroexpand1Runtime,
  resetRuntime,
} from "./src/runtime/index.ts";

export const version = "7.8.22";

const hql: HQLModule = {
  isHQL,
  transpile,
  run,
  runFile,
  macroexpand,
  macroexpand1,
  version,
} as HQLModule;
export default hql;

// Export source map utilities
export { transformStackTrace, withTransformedStackTraces };

// Export tooling API
export {
  mapPosition,
  loadSourceMap,
  invalidateSourceMapCache,
} from "./src/transpiler/pipeline/source-map-support.ts";
