/**
 * Helper Injection System for HQL Runtime
 *
 * This module provides unified helper injection logic used by both:
 * - REPL mode (mod.ts)
 * - Bundle mode (bundler.ts)
 *
 * It detects which runtime helpers (__hql_get, __hql_range, etc.) are needed
 * and injects them into the transpiled JavaScript code.
 */

import { getRuntimeHelperSource, getRangeHelperWithDependency } from "./runtime-helper-impl.ts";
import * as acorn from "npm:acorn@^8.8.0";
import { dirname, resolve, relative } from "../platform/platform.ts";

/**
 * Options for helper injection
 */
export interface HelperInjectionOptions {
  /** Whether to generate source maps (affects injection mode) */
  generateSourceMap?: boolean;
  /** Existing source map to adjust (if any) */
  sourceMap?: string;
  /** Force IIFE wrapping (for REPL mode) */
  forceIIFEWrap?: boolean;
  /** Cached file path for calculating relative stdlib imports (bundler mode) */
  cachedFilePath?: string;
}

/**
 * Result of helper injection
 */
export interface HelperInjectionResult {
  code: string;
  sourceMap?: string;
}

/**
 * Detect which runtime helpers are needed by scanning code
 */
function detectNeededHelpers(code: string): {
  needsGet: boolean;
  needsRange: boolean;
  needsHashMap: boolean;
  needsThrow: boolean;
  needsSequence: boolean;
  needsDeepFreeze: boolean;
} {
  return {
    needsGet: code.includes("__hql_get(") || code.includes("__hql_getNumeric("),
    needsRange: code.includes("__hql_range"),
    needsHashMap: code.includes("__hql_hash_map"),
    needsThrow: code.includes("__hql_throw"),
    needsSequence: code.includes("__hql_toSequence(") || code.includes("__hql_for_each("),
    needsDeepFreeze: code.includes("__hql_deepFreeze("),
  };
}

/**
 * Build helper snippet array based on which helpers are needed
 */
function buildHelperSnippets(helpers: ReturnType<typeof detectNeededHelpers>): string[] {
  const snippets: string[] = [];

  if (helpers.needsGet) {
    snippets.push(`const __hql_get = ${getRuntimeHelperSource("__hql_get")};`);
    snippets.push(`const __hql_getNumeric = __hql_get;`);
  }

  if (helpers.needsRange) {
    // Use special function that includes rangeCore dependency
    snippets.push(getRangeHelperWithDependency());
  }

  if (helpers.needsSequence) {
    snippets.push(`const __hql_toSequence = ${getRuntimeHelperSource("__hql_toSequence")};`);
    snippets.push(`const __hql_for_each = ${getRuntimeHelperSource("__hql_for_each")};`);
  }

  if (helpers.needsHashMap) {
    snippets.push(`const __hql_hash_map = ${getRuntimeHelperSource("__hql_hash_map")};`);
  }

  if (helpers.needsThrow) {
    snippets.push(`const __hql_throw = ${getRuntimeHelperSource("__hql_throw")};`);
  }

  if (helpers.needsDeepFreeze) {
    snippets.push(`const __hql_deepFreeze = ${getRuntimeHelperSource("__hql_deepFreeze")};`);
  }

  return snippets;
}

/**
 * Complete list of HQL stdlib functions that can be imported
 * These are exported from core/lib/stdlib/js/index.js
 */
const STDLIB_FUNCTIONS = [
  // Collection access
  'first', 'rest', 'cons', 'nth', 'count', 'second', 'last',
  // Predicates
  'isEmpty', 'some', 'every', 'notAny', 'notEvery', 'isSome',
  // Sequence operations
  'take', 'drop', 'map', 'filter', 'reduce', 'concat', 'flatten', 'distinct',
  'mapcat', 'mapIndexed', 'keep', 'keepIndexed', 'cycle', 'repeat', 'repeatedly',
  'iterate', 'doall', 'seq',
  // Collection creation/modification
  'vec', 'set', 'into', 'conj', 'empty',
  // Map operations
  'get', 'getIn', 'assoc', 'assocIn', 'dissoc', 'update', 'updateIn',
  'keys', 'merge', 'groupBy',
  // Function utilities
  'apply', 'partial', 'comp',
  // Lazy sequences
  'lazySeq', 'LazySeq', 'range', 'realized'
] as const;

/**
 * Map of runtime helpers to their stdlib dependencies
 * Key: helper function name
 * Value: array of stdlib functions needed by that helper
 */
const HELPER_STDLIB_DEPS: Record<string, string[]> = {
  '__hql_range': ['lazySeq', 'LazySeq'], // range helper uses lazySeq internally
  // Other helpers have no stdlib dependencies currently
};

/**
 * Detect which stdlib functions are needed by scanning code
 *
 * This detects:
 * 1. Direct stdlib function calls in user code (e.g., take(2, [1,2,3]))
 * 2. Stdlib dependencies of runtime helpers (e.g., __hql_range needs lazySeq)
 */
function detectNeededStdlib(
  code: string,
  helpers: ReturnType<typeof detectNeededHelpers>
): Set<string> {
  const needed = new Set<string>();

  // Detect direct stdlib calls in user code
  // Match function calls: functionName( or functionName (
  for (const fn of STDLIB_FUNCTIONS) {
    if (new RegExp(`\\b${fn}\\s*\\(`).test(code)) {
      needed.add(fn);
    }
  }

  // Add stdlib dependencies for helpers that are being used
  if (helpers.needsRange && HELPER_STDLIB_DEPS['__hql_range']) {
    for (const dep of HELPER_STDLIB_DEPS['__hql_range']) {
      needed.add(dep);
    }
  }

  return needed;
}

/**
 * Build import statement for stdlib functions
 *
 * Generates: import { take, map, lazySeq } from "../../../../core/lib/stdlib/js/index.js";
 *
 * The path is relative from the cache directory to the stdlib:
 * - Cache: .hql-cache/1/__external__/path/to/file.ts (4 levels deep)
 * - Stdlib: core/lib/stdlib/js/index.js (in project root)
 * - Relative: ../../../../core/lib/stdlib/js/index.js (up 4 levels to project root)
 */
function buildStdlibImport(stdlibFunctions: Set<string>, cachedFilePath?: string): string {
  if (stdlibFunctions.size === 0) {
    return '';
  }

  const sortedFunctions = Array.from(stdlibFunctions).sort();
  const importList = sortedFunctions.join(', ');

  // Calculate relative import path from cached file to stdlib
  if (cachedFilePath) {
    // Get absolute path to stdlib (resolve from this file's location)
    // This file is at: core/src/common/helper-injector.ts
    // Stdlib is at: core/lib/stdlib/js/index.js
    const thisFileDir = dirname(new URL(import.meta.url).pathname);
    const projectRoot = resolve(thisFileDir, '../../..');  // Up to hql/
    const stdlibPath = resolve(projectRoot, 'core/lib/stdlib/js/index.js');

    // Calculate relative path from cached file's directory to stdlib
    const cachedFileDir = dirname(cachedFilePath);
    const relativePath = relative(cachedFileDir, stdlibPath);

    return `import { ${importList} } from "${relativePath}";\n`;
  }

  // Fallback: use hardcoded path (should only happen if cachedFilePath not provided)
  // This maintains backward compatibility but should not be used in practice
  return `import { ${importList} } from "../../../../core/lib/stdlib/js/index.js";\n`;
}

/**
 * Adjust source map to account for prepended imports and helpers
 */
async function adjustSourceMap(
  code: string,
  sourceMap: string,
  stdlibImport: string,
  helperSnippets: string[]
): Promise<string> {
  // Calculate line offset from imports
  const importLineCount = stdlibImport ? stdlibImport.split("\n").length : 0;

  // Calculate line offset from helpers
  const helperLineCount = helperSnippets.length > 0
    ? helperSnippets.reduce(
        (count, snippet) => count + snippet.split("\n").length,
        0
      ) + 1  // +1 for empty line after helpers
    : 0;

  // Total offset is imports + helpers
  const totalLineOffset = importLineCount + helperLineCount;

  if (totalLineOffset === 0) {
    return sourceMap;
  }

  const mapJson = JSON.parse(sourceMap);

  // Import source-map library for proper manipulation
  const { SourceMapGenerator, SourceMapConsumer } = await import("npm:source-map@0.6.1");

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
  const consumer = await new SourceMapConsumer(mapJson);

  consumer.eachMapping((mapping: any) => {
    // Only add mappings that have valid original positions
    if (
      mapping.source !== null &&
      mapping.originalLine !== null &&
      mapping.originalColumn !== null
    ) {
      generator.addMapping({
        source: mapping.source,
        original: {
          line: mapping.originalLine,
          column: mapping.originalColumn
        },
        generated: {
          line: mapping.generatedLine + totalLineOffset, // Shift down by total line count (imports + helpers)
          column: mapping.generatedColumn
        },
        name: mapping.name || undefined
      });
    }
  });

  return generator.toString();
}

/**
 * Inject imports and helpers with simple prepending (for source maps or ES modules)
 */
function injectImportsAndHelpers(
  code: string,
  stdlibImport: string,
  helperSnippets: string[]
): string {
  // Build the prepended content
  let prepended = '';

  // Add stdlib imports first (if any)
  if (stdlibImport) {
    prepended += stdlibImport;
  }

  // Add helper snippets (if any)
  if (helperSnippets.length > 0) {
    prepended += helperSnippets.join("\n") + "\n\n";
  }

  // If nothing to prepend, return original code
  if (!prepended) {
    return code;
  }

  return prepended + code;
}

/**
 * Inject helpers with IIFE wrapping (for REPL mode)
 */
function injectHelpersWithIIFE(code: string, helperSnippets: string[]): string {
  const runtimeFunctions = helperSnippets.length > 0
    ? `\n${helperSnippets.join("\n")}\n`
    : "";

  // Extract "use strict" directive if present
  const trimmedCode = code.trim();
  let useStrictDirective = "";
  let codeWithoutStrict = trimmedCode;
  const firstLine = trimmedCode.split("\n")[0];
  if (firstLine === '"use strict";' || firstLine === "'use strict';") {
    useStrictDirective = '    "use strict";\n';
    const lines = trimmedCode.split("\n");
    codeWithoutStrict = lines.slice(1).join("\n").trim();
  }

  // Parse JavaScript to determine structure
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
    // Multiple statements: handle preceding + last
    const precedingStatements = statements.slice(0, -1);
    const lastStatement = statements[statements.length - 1];

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
      // Extract just the expression part
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

    return `
(function() {${runtimeFunctions}

  return (function() {
${useStrictDirective}${formattedPreceding ? formattedPreceding + "\n" : ""}${formattedLast}
  })();
})()`;
  } else {
    // Single expression: wrap in return
    const finalExpression = codeWithoutStrict.endsWith(";")
      ? codeWithoutStrict.slice(0, -1)
      : codeWithoutStrict;

    const formattedExpression = finalExpression
      .split("\n")
      .map((line) => `      ${line}`)
      .join("\n");

    return `
(function() {${runtimeFunctions}

  // Execute the transpiled code and ensure the last expression value is returned
  return (function() {
${useStrictDirective}    return (
${formattedExpression}
    );
  })();
})()`;
  }
}

/**
 * Main entry point: Inject runtime helpers and stdlib imports into transpiled code
 *
 * This function handles three modes:
 * 1. Source map mode: Prepend imports/helpers and adjust source maps
 * 2. ES module mode: Prepend imports/helpers without wrapping
 * 3. IIFE mode: Wrap code and helpers in IIFE (for REPL - NO imports, uses globals)
 */
export async function injectRuntimeHelpers(
  code: string,
  options: HelperInjectionOptions = {}
): Promise<HelperInjectionResult> {
  // Detect which helpers are needed
  const helpers = detectNeededHelpers(code);
  const needsAnyHelper = helpers.needsGet || helpers.needsRange || helpers.needsSequence ||
    helpers.needsThrow || helpers.needsHashMap || helpers.needsDeepFreeze;

  // Detect which stdlib functions are needed
  const neededStdlib = detectNeededStdlib(code, helpers);

  // If no helpers or stdlib needed, return code as-is
  if (!needsAnyHelper && neededStdlib.size === 0) {
    return {
      code,
      sourceMap: options.sourceMap
    };
  }

  // Build helper snippets
  const helperSnippets = buildHelperSnippets(helpers);

  // Check if code has ES module syntax (export/import statements)
  const hasExports = code.includes("export ") && code.match(/^\s*export\s+/m);
  const hasImports = code.includes("import ") && code.match(/^\s*import\s+/m);
  const isModule = hasExports || hasImports;

  // Generate stdlib imports for bundler mode (when forceIIFEWrap !== true)
  // REPL mode (forceIIFEWrap === true) always uses globals, never imports
  // Bundler mode generates imports even for non-module code (esbuild will bundle them)
  const shouldGenerateStdlibImports = options.forceIIFEWrap !== true;
  const stdlibImport = shouldGenerateStdlibImports ? buildStdlibImport(neededStdlib, options.cachedFilePath) : '';

  // MODE 1: Source map mode - prepend imports/helpers and adjust source map
  if (options.generateSourceMap && options.sourceMap) {
    const codeWithImportsAndHelpers = injectImportsAndHelpers(code, stdlibImport, helperSnippets);
    const adjustedSourceMap = await adjustSourceMap(code, options.sourceMap, stdlibImport, helperSnippets);

    return {
      code: codeWithImportsAndHelpers,
      sourceMap: adjustedSourceMap
    };
  }

  // MODE 2: ES module mode - prepend imports/helpers without wrapping
  // CRITICAL: Never wrap code with export/import in IIFE (invalid JS)
  if (isModule) {
    return {
      code: injectImportsAndHelpers(code, stdlibImport, helperSnippets),
      sourceMap: options.sourceMap
    };
  }

  // MODE 3: IIFE mode - wrap code and helpers (for REPL)
  // IMPORTANT: Only for non-module code (no exports/imports)
  // REPL uses globals, so NO stdlib imports
  if (options.forceIIFEWrap === true) {
    return {
      code: injectHelpersWithIIFE(code, helperSnippets),
      sourceMap: options.sourceMap
    };
  }

  // Default: simple prepending (for bundler mode, non-module code)
  return {
    code: injectImportsAndHelpers(code, stdlibImport, helperSnippets),
    sourceMap: options.sourceMap
  };
}
