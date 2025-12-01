// core/src/imports.ts - Enhanced error handling for imports

import { globalLogger as logger } from "./logger.ts";
import type { Environment, Value } from "./environment.ts";
import type { MacroFn } from "./environment.ts";
import { evaluateForMacro, expandMacros } from "./s-exp/macro.ts";
import { parse } from "./transpiler/pipeline/parser.ts";
import { readFile, sanitizeIdentifier, getErrorMessage, isObjectValue } from "./common/utils.ts";
import {
  basename,
  dirname,
  extname,
  fromFileUrl,
  resolve,
} from "./platform/platform.ts";

// Global registry to track which symbols are macros
// This persists across file compilations so transpilation can filter them
export const globalMacroRegistry = new Set<string>();

import {
  createTempDirIfNeeded,
  getCachedPath,
  getImportMapping,
  processJavaScriptFile,
} from "./common/hql-cache-tracker.ts";
import {
  isImport,
  isLiteral,
  isSExpNamespaceImport,
  isSExpVectorImport,
  isSymbol,
  type SExp,
  type SList,
  type SLiteral,
  type SSymbol,
} from "./s-exp/types.ts";
import {
  isHqlFile,
  isJsFile,
  isRemoteModule,
  isRemoteUrl,
  isTypeScriptFile,
  registerModulePath,
} from "./common/import-utils.ts";
import {
  formatErrorMessage,
  SourceLocationInfo,
  ValidationError,
  wrapError,
} from "./common/error.ts";
import { ImportError, MacroError } from "./common/error.ts";
import { globalSymbolTable } from "./transpiler/symbol_table.ts";
import {
  createBasicSymbolInfo,
  enrichImportedSymbolInfo,
} from "./transpiler/utils/symbol_info_utils.ts";
import { processVectorElements } from "./transpiler/syntax/data-structure.ts";
import {
  readTextFile as platformReadTextFile,
  readTextFileSync as platformReadTextFileSync,
} from "./platform/platform.ts";

// Cache file contents to avoid re-reading the same file for every import
const fileLineCache = new Map<string, string[] | null>();

// Generate a consistent internal module name from a path
function generateModuleId(modulePath: string): string {
  // Clean up path to create a valid identifier
  return `__module_${modulePath.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

interface SourceLocationHolder {
  sourceLocation?: {
    filePath?: string;
  };
}

function getSourceLocationFilePath(error: unknown): string | undefined {
  if (isObjectValue(error) && "sourceLocation" in error) {
    const { sourceLocation } = error as SourceLocationHolder;
    if (sourceLocation && typeof sourceLocation.filePath === "string") {
      return sourceLocation.filePath;
    }
  }
  return undefined;
}

function isMacroFunction(value: Value): value is MacroFn {
  return typeof value === "function" &&
    Boolean((value as Partial<MacroFn>).isMacro);
}

type ModuleImporter = () => Promise<Record<string, Value>>;

export interface ImportProcessorOptions {
  verbose?: boolean;
  baseDir?: string;
  tempDir?: string;
  processedFiles?: Set<string>;
  inProgressFiles?: Set<string>;
  importMap?: Map<string, string>;
  currentFile?: string;
}

/**
 * Main function to process imports in S-expressions
 */
export async function processImports(
  exprs: SExp[],
  env: Environment,
  options: ImportProcessorOptions = {},
): Promise<void> {
  // Always resolve baseDir relative to this file if not explicitly provided
  const baseDir = options.baseDir ||
    resolve(dirname(fromFileUrl(import.meta.url)), "../../");

  const processedFiles = options.processedFiles || new Set<string>();
  const inProgressFiles = options.inProgressFiles || new Set<string>();
  const importMap = options.importMap || new Map<string, string>();

  try {
    // Set up current file context
    if (options.currentFile) {
      env.setCurrentFile(options.currentFile);
      logger.debug(`Processing imports in file: ${options.currentFile}`);
      inProgressFiles.add(options.currentFile);
    }

    // Initialize temp directory and analyze imports
    const tempDirResult = await createTempDirIfNeeded(
      options,
      "hql_imports_",
      logger,
    );
    const tempDir = tempDirResult.tempDir;
    const importExprs = filterImportExpressions(exprs);

    // Categorize imports and process them
    const { remoteImports, localImports } = categorizeImports(importExprs);

    // Process remote imports in parallel
    if (remoteImports.length > 0) {
      await processImportBatch(
        remoteImports,
        env,
        baseDir,
        {
          ...options,
          tempDir,
          processedFiles,
          inProgressFiles,
          importMap,
        },
        "parallel",
      );
    }

    // Process local imports sequentially
    if (localImports.length > 0) {
      await processImportBatch(
        localImports,
        env,
        baseDir,
        {
          ...options,
          tempDir,
          processedFiles,
          inProgressFiles,
          importMap,
        },
        "sequential",
      );
    }

    // Process definitions and exports for current file
    if (options.currentFile) {
      processImportFileExpressions(exprs, env, options);
    }

    // Mark file as processed
    if (options.currentFile) {
      inProgressFiles.delete(options.currentFile);
      processedFiles.add(options.currentFile);
      logger.debug(`Completed processing imports for: ${options.currentFile}`);
    }
  } catch (error) {
    wrapImportError(
      "Processing file exports and definitions",
      error,
      options.currentFile || "unknown",
      options.currentFile,
    );
  }
}

/**
 * Enhanced error wrapping with source location information
 */
function wrapImportError(
  context: string,
  error: unknown,
  resource: string,
  currentFile?: string,
  lineInfo?: { line: number; column: number },
): never {
  // If error is already an HQLError with a filePath different from the importer, preserve it
  const sourceFile = getSourceLocationFilePath(error);
  if (
    error instanceof Error && sourceFile && currentFile &&
    sourceFile !== currentFile
  ) {
    throw error;
  }
  // For validation errors related to imports, enhance with location info
  if (error instanceof ValidationError) {
    if (
      error.message.includes("not found in module") ||
      error.message.includes("Symbol not found") ||
      error.message.includes("Property") ||
      error.message.includes("Cannot access")
    ) {
      // Extract the symbol or property name from the error message
      const symbolMatch = error.message.match(/['"]([^'"]+)['"]/);
      const symbol = symbolMatch ? symbolMatch[1] : "";

      if (currentFile) {
        let sourceLoc: SourceLocationInfo;
        if (lineInfo) {
          // Use provided line info
          sourceLoc = new SourceLocationInfo({
            filePath: currentFile,
            line: lineInfo.line,
            column: lineInfo.column,
          });
        } else {
          // Create location info without line/column
          sourceLoc = new SourceLocationInfo({
            filePath: currentFile,
          });
        }

        // Enhanced error with context information
        throw new ImportError(
          `Failed to import symbol '${symbol}' from '${resource}':\n  ${error.message}`,
          resource,
          sourceLoc,
          error,
        );
      }
    }
  }

  // Use the original error for other cases
  if (error instanceof Error) {
    throw error;
  } else {
    throw new Error(`${context}: ${String(error)}`);
  }
}

/**
 * Collect export definitions from expressions
 */
function collectExportDefinitions(
  expressions: SExp[],
): { name: string; value: SExp | null }[] {
  const exportDefinitions: { name: string; value: SExp | null }[] = [];

  for (const expr of expressions) {
    if (
      expr.type !== "list" || expr.elements.length === 0 ||
      !isSymbol(expr.elements[0]) || expr.elements[0].name !== "export"
    ) {
      continue;
    }

    // Handle vector exports
    if (expr.elements.length === 2 && expr.elements[1].type === "list") {
      const vectorElements = (expr.elements[1] as SList).elements;
      const elements = processVectorElements(vectorElements, {
        allowJsArrayWrapper: true,
      });

      for (const elem of elements) {
        if (isSymbol(elem)) {
          exportDefinitions.push({ name: (elem as SSymbol).name, value: null });
          logger.debug(`Collected vector export: ${(elem as SSymbol).name}`);

          // Add to symbol table as exported
          globalSymbolTable.update((elem as SSymbol).name, {
            isExported: true,
          });
        }
      }
    } // Handle named exports
    else if (
      expr.elements.length === 3 &&
      expr.elements[1].type === "literal" &&
      typeof (expr.elements[1] as SLiteral).value === "string"
    ) {
      const exportName = (expr.elements[1] as SLiteral).value as string;
      exportDefinitions.push({ name: exportName, value: expr.elements[2] });
      logger.debug(`Collected string export with expression: "${exportName}"`);

      // Add to symbol table as exported
      globalSymbolTable.update(exportName, { isExported: true });
    }
  }

  return exportDefinitions;
}

/**
 * Filter import expressions from S-expressions
 */
function filterImportExpressions(exprs: SExp[]): SList[] {
  const importExprs = exprs.filter(
    (expr) => isImport(expr) && expr.type === "list",
  ) as SList[];
  logger.debug(`Found ${importExprs.length} import expressions to process`);
  return importExprs;
}

/**
 * Categorize imports into remote and local types
 */
function categorizeImports(importExprs: SList[]): {
  remoteImports: SList[];
  localImports: SList[];
} {
  const remoteImports: SList[] = [];
  const localImports: SList[] = [];

  for (const importExpr of importExprs) {
    const modulePath = getModulePathFromImport(importExpr);
    if (isRemoteUrl(modulePath) || isRemoteModule(modulePath)) {
      remoteImports.push(importExpr);
    } else {
      localImports.push(importExpr);
    }
  }

  logger.debug(
    `Categorized imports: ${remoteImports.length} remote, ${localImports.length} local`,
  );
  return { remoteImports, localImports };
}

/**
 * Process imports with configurable concurrency
 */
async function processImportBatch(
  imports: SList[],
  env: Environment,
  baseDir: string,
  options: ImportProcessorOptions,
  mode: "parallel" | "sequential",
): Promise<void> {
  if (imports.length === 0) return;

  logger.debug(
    `Processing ${imports.length} imports in ${mode === "parallel" ? "parallel" : "sequence"}`,
  );

  const processOne = async (importExpr: SList) => {
    try {
      await processImport(importExpr, env, baseDir, options);
    } catch (error) {
      const modulePath = getModulePathFromImport(importExpr);
      const importLine = findImportLineInfo(importExpr, options.currentFile);
      wrapImportError(
        mode === "parallel" ? "Error processing import" : "Processing sequential import",
        error,
        modulePath,
        options.currentFile,
        importLine,
      );
    }
  };

  if (mode === "parallel") {
    await Promise.all(imports.map((importExpr) => processOne(importExpr)));
    return;
  }

  for (const importExpr of imports) {
    await processOne(importExpr);
  }
}

/**
 * Fetch cached lines for a file, reading from disk only once.
 */
function getCachedFileLines(filePath?: string): string[] | null {
  if (!filePath) return null;
  if (fileLineCache.has(filePath)) {
    return fileLineCache.get(filePath)!;
  }

  try {
    const fileContent = platformReadTextFileSync(filePath);
    const lines = fileContent.split("\n");
    fileLineCache.set(filePath, lines);
    return lines;
  } catch (error) {
    const message = getErrorMessage(error);
    logger.debug(`Error caching file lines for ${filePath}: ${message}`);
    fileLineCache.set(filePath, null);
  }

  return null;
}

/**
 * Find line information for an import expression
 */
function findImportLineInfo(
  importExpr: SList,
  currentFile?: string,
): { line: number; column: number } | undefined {
  if (!currentFile) return undefined;

  const lines = getCachedFileLines(currentFile);
  if (!lines) return undefined;

  // Get the import module path to search for
  const modulePath = getModulePathFromImport(importExpr);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Look for vector imports [name1 name2] from "./path"
    if (
      line.includes("import") && line.includes("[") &&
      line.includes("from") && line.includes(modulePath)
    ) {
      // Find the specific symbol in the import vector
      const openBracketPos = line.indexOf("[");
      const closeBracketPos = line.indexOf("]");

      if (openBracketPos > 0 && closeBracketPos > openBracketPos) {
        const importVector = line.substring(
          openBracketPos + 1,
          closeBracketPos,
        );

        // If we're dealing with a vector import that has a non-existent symbol
        if (isSExpVectorImport(importExpr.elements)) {
          for (const elem of (importExpr.elements[1] as SList).elements) {
            if (isSymbol(elem)) {
              const symbolName = (elem as SSymbol).name;
              const symbolPos = importVector.indexOf(symbolName);

              if (symbolPos >= 0) {
                // Return the position of the symbol in the import vector
                return {
                  line: i + 1,
                  column: openBracketPos + 1 + symbolPos,
                };
              }
            }
          }
        }
      }

      // If we didn't find the specific symbol but found the import line
      return {
        line: i + 1,
        column: line.indexOf("import") + 1,
      };
    }

    // Look for namespace imports: import name from "./path"
    if (
      line.includes("import") && line.includes("from") &&
      line.includes(modulePath)
    ) {
      return {
        line: i + 1,
        column: line.indexOf("import") + 1,
      };
    }
  }

  return undefined;
}

/**
 * Process file content, including definitions and exports
 */
function processImportFileExpressions(
  exprs: SExp[],
  env: Environment,
  options: ImportProcessorOptions,
): void {
  try {
    // Process definitions
    processFileDefinitions(exprs, env);

    // Process exports if current file is defined
    if (options.currentFile) {
      const moduleExports = {};
      processFileExportsAndDefinitions(
        exprs,
        env,
        moduleExports,
        options.currentFile,
      );
    }
  } catch (error) {
    if (error instanceof MacroError) throw error;
    wrapImportError(
      "Processing file definitions and exports",
      error,
      options.currentFile || "unknown",
      options.currentFile,
    );
  }
}

/**
 * Extract module path from import expression
 */
function getModulePathFromImport(importExpr: SList): string {
  try {
    if (
      importExpr.elements.length >= 4 &&
      importExpr.elements[2].type === "symbol" &&
      (importExpr.elements[2] as SSymbol).name === "from" &&
      importExpr.elements[3].type === "literal"
    ) {
      return String((importExpr.elements[3] as SLiteral).value);
    } else if (
      importExpr.elements.length === 3 &&
      importExpr.elements[2].type === "literal"
    ) {
      return String((importExpr.elements[2] as SLiteral).value);
    } else if (
      importExpr.elements.length === 2 &&
      importExpr.elements[1].type === "literal"
    ) {
      return String((importExpr.elements[1] as SLiteral).value);
    }
  } catch (_e) {
    // Error parsing import expression, fall back to "unknown"
  }
  return "unknown";
}

/**
 * Process a single import expression
 */
async function processImport(
  importExpr: SList,
  env: Environment,
  baseDir: string,
  options: ImportProcessorOptions,
): Promise<void> {
  const elements = importExpr.elements;

  if (elements.length <= 1) {
    throw new MacroError(
      "Invalid import statement format. Expected (import ...)",
      "import",
    );
  }

  try {
    // Determine import type and process accordingly
    if (elements.length === 2 && elements[1].type === "literal") {
      await processSimpleImport(elements, env, baseDir, options);
    } else if (isSExpNamespaceImport(elements)) {
      await processNamespaceImport(elements, env, baseDir, options);
    } else if (isSExpVectorImport(elements)) {
      await processVectorBasedImport(elements, env, baseDir, options);
    } else {
      // Invalid import syntax - provide helpful error message
      const line = findImportLineInfo(importExpr, options.currentFile);

      // Try to describe what the user attempted
      let attemptDescription = "Unknown syntax";
      if (elements.length === 2) {
        attemptDescription = `Found: (import ${elements[1].type})`;
      } else if (elements.length >= 3) {
        const types = elements.slice(1, 4).map((e) => e.type).join(" ");
        attemptDescription = `Found: (import ${types}${
          elements.length > 4 ? " ..." : ""
        })`;
      }

      throw new ImportError(
        `Invalid import syntax. ${attemptDescription}

Expected one of:
  (import "module-path")                    - Simple import
  (import [foo bar] from "./path")          - Named imports
  (import * as name from "./path")          - Namespace import`,
        "syntax-error",
        {
          filePath: options.currentFile,
          line: line?.line,
          column: line?.column,
        },
      );
    }
  } catch (error) {
    // If the error is already an HQLError with a different filePath, preserve it
    const sourceFile = getSourceLocationFilePath(error);
    if (
      error instanceof Error && sourceFile && options.currentFile &&
      sourceFile !== options.currentFile
    ) {
      throw error;
    }
    const modulePath = getModulePathFromImport(importExpr);
    const line = findImportLineInfo(importExpr, options.currentFile);
    wrapImportError(
      "Processing import",
      error,
      modulePath,
      options.currentFile,
      line,
    );
  }
}

/**
 * Resolve @hql/* stdlib package paths to actual file paths
 * @hql/string -> packages/string/mod.hql
 * Returns original path if it's an @hql/* path (handled specially by loadModule)
 */
function resolveStdlibPath(modulePath: string): string {
  // Keep @hql/* paths as-is - they will be handled by embedded packages
  if (modulePath.startsWith("@hql/")) {
    return modulePath;
  }
  return modulePath;
}

/**
 * Check if a module path is an @hql/* stdlib package
 */
function isStdlibPackage(modulePath: string): boolean {
  return modulePath.startsWith("@hql/");
}

/**
 * Process a simple import statement (import "module-path")
 */
async function processSimpleImport(
  elements: SExp[],
  env: Environment,
  baseDir: string,
  options: ImportProcessorOptions,
): Promise<void> {
  let modulePath = (elements[1] as SLiteral).value as string;
  
  // Special handling for @hql/ packages
  if (isStdlibPackage(modulePath)) {
    // Register with original path, don't try to resolve to filesystem
    registerModulePath(modulePath, modulePath);
    
    await loadHqlModule(
      basename(modulePath),
      modulePath,
      modulePath, // Use modulePath as resolvedPath for embedded modules
      env,
      options
    );
    
    // Register in symbol table
    globalSymbolTable.set({
      name: basename(modulePath, extname(modulePath)),
      kind: "module",
      scope: "global",
      isImported: true,
      sourceModule: modulePath,
      meta: { importedInFile: options.currentFile },
    });
    return;
  }

  const resolvedPath = resolve(baseDir, modulePath);

  logger.debug(
    `Simple import of full module: ${modulePath} => ${resolvedPath}`,
  );

  registerModulePath(modulePath, resolvedPath);

  await loadModule(
    modulePath,
    modulePath,
    resolvedPath,
    env,
    options,
  );

  // Register in symbol table
  globalSymbolTable.set({
    name: basename(modulePath, extname(modulePath)),
    kind: "module",
    scope: "global",
    isImported: true,
    sourceModule: modulePath,
    meta: { importedInFile: options.currentFile },
  });
}

/**
 * Process a namespace import statement (import name from "module-path")
 */
async function processNamespaceImport(
  elements: SExp[],
  env: Environment,
  baseDir: string,
  options: ImportProcessorOptions,
): Promise<void> {
  try {
    if (!isSymbol(elements[1])) {
      throw new ImportError("Module name must be a symbol", "namespace import");
    }
    if (!isLiteral(elements[3]) || typeof elements[3].value !== "string") {
      throw new ImportError(
        "Module path must be a string literal",
        "namespace import",
      );
    }

    const moduleName = (elements[1] as SSymbol).name;
    const modulePath = (elements[3] as SLiteral).value as string;

    registerModulePath(moduleName, modulePath);
    logger.debug(
      `Processing namespace import with "from": ${moduleName} from ${modulePath}`,
    );

    // Special handling for @hql/ packages
    if (isStdlibPackage(modulePath)) {
      await loadHqlModule(
        generateModuleId(modulePath), // Use internal ID
        modulePath,
        modulePath, // Use modulePath as resolvedPath
        env,
        options
      );
      
      // Alias logic remains the same
      const moduleId = generateModuleId(modulePath);
      if (moduleId !== moduleName) {
        if (env.moduleExports.has(moduleId)) {
          const exports = env.moduleExports.get(moduleId)!;
          env.importModule(moduleName, exports);
          logger.debug(`Created module alias: ${moduleName} → ${moduleId}`);
        }
      }
      
      // Register in symbol table
      globalSymbolTable.set({
        name: moduleName,
        kind: "module",
        scope: "global",
        isImported: true,
        sourceModule: modulePath,
        meta: { importedInFile: options.currentFile },
      });
      return;
    }

    const resolvedPath = resolve(baseDir, modulePath);
    // First load the module with a consistent internal ID
    const moduleId = generateModuleId(modulePath);
    await loadModule(moduleId, modulePath, resolvedPath, env, options);

    // Then create an alias with the user-provided name
    // This allows both naming schemes to point to the same module
    if (moduleId !== moduleName) {
      // Copy module exports from the internal ID to the user-facing name
      if (env.moduleExports.has(moduleId)) {
        const exports = env.moduleExports.get(moduleId)!;
        env.importModule(moduleName, exports);
        logger.debug(`Created module alias: ${moduleName} → ${moduleId}`);
      }
    }

    // Register in symbol table
    globalSymbolTable.set({
      name: moduleName,
      kind: "module",
      scope: "global",
      isImported: true,
      sourceModule: modulePath,
      meta: { importedInFile: options.currentFile },
    });
  } catch (error) {
    // If the error is already an HQLError with a different filePath, preserve it
    const sourceFile = getSourceLocationFilePath(error);
    if (
      error instanceof Error && sourceFile && options.currentFile &&
      sourceFile !== options.currentFile
    ) {
      throw error;
    }
    const modulePath = elements[3]?.type === "literal"
      ? String(elements[3].value)
      : "unknown";
    // Try to get line information
    let line = undefined;
    if (options.currentFile) {
      try {
        const content = platformReadTextFileSync(options.currentFile);
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (
            lines[i].includes("import") && lines[i].includes("from") &&
            lines[i].includes(modulePath)
          ) {
            line = { line: i + 1, column: lines[i].indexOf("import") + 1 };
            break;
          }
        }
      } catch (_) {
        // Ignore errors reading the file
      }
    }
    wrapImportError(
      "Processing namespace import",
      error,
      modulePath,
      options.currentFile,
      line,
    );
  }
}

/**
 * Process vector-based import statements (import [a b c] from "module-path")
 */
async function processVectorBasedImport(
  elements: SExp[],
  env: Environment,
  baseDir: string,
  options: ImportProcessorOptions,
): Promise<void> {
  try {
    if (elements[1].type !== "list") {
      throw new ImportError("Import vector must be a list", "syntax-error");
    }
    const symbolsVector = elements[1] as SList;
    if (!isLiteral(elements[3]) || typeof elements[3].value !== "string") {
      throw new ImportError(
        "Module path must be a string literal",
        "syntax-error",
      );
    }

    const modulePath = elements[3].value as string;
    
    let resolvedPath: string;
    let moduleId: string;

    if (isStdlibPackage(modulePath)) {
      resolvedPath = modulePath;
      moduleId = generateModuleId(modulePath);
      await loadHqlModule(moduleId, modulePath, resolvedPath, env, options);
    } else {
      resolvedPath = resolve(baseDir, modulePath);
      // Use a consistent module ID for all import styles
      moduleId = generateModuleId(modulePath);
      await loadModule(moduleId, modulePath, resolvedPath, env, options);
    }

    const vectorElements = processVectorElements(symbolsVector.elements, {
      allowJsArrayWrapper: true,
    });
    const requestedSymbols = extractSymbolsAndAliases(vectorElements);

    // Find line and column information before importing symbols
    const lineInfo = options.currentFile
      ? findImportVectorPosition(
        options.currentFile,
        modulePath,
        Array.from(requestedSymbols.keys()),
      )
      : undefined;

    importSymbols(
      requestedSymbols,
      modulePath,
      moduleId,
      env,
      options.currentFile || "",
      lineInfo,
      resolvedPath,
    );

    // Register in symbol table for each imported symbol
    for (const [symbolName, aliasName] of requestedSymbols.entries()) {
      const finalName = aliasName || symbolName;

      // Check if this is a system macro
      const isMacro = env.isSystemMacro(symbolName);

      // Get the actual value from the environment to determine its type
      // Use a try-catch to handle cases where the symbol might not be available yet
      let importedValue;
      try {
        importedValue = env.lookup(symbolName);
      } catch (_e) {
        // If symbol is not found, we'll proceed with minimal type information
        logger.debug(
          `Warning: Symbol ${symbolName} not fully resolved during import. Using basic type information.`,
        );
        importedValue = undefined;
      }

      // Create basic symbol info
      const basicSymbolInfo = createBasicSymbolInfo(
        finalName,
        "local",
        options.currentFile,
      );

      // Add macro type if detected
      if (isMacro) {
        basicSymbolInfo.kind = "macro";
      }

      // Use the utility function to create properly enriched import symbol info
      const enrichedSymbolInfo = enrichImportedSymbolInfo(
        basicSymbolInfo,
        importedValue,
        symbolName,
        modulePath,
        aliasName || undefined, // Convert null to undefined
      );

      // Add import-specific metadata
      if (!enrichedSymbolInfo.meta) enrichedSymbolInfo.meta = {};
      enrichedSymbolInfo.meta.importedInFile = options.currentFile;
      enrichedSymbolInfo.meta.originalName = symbolName;

      // For functions, mark as JS function for better code generation
      if (enrichedSymbolInfo.kind === "function") {
        enrichedSymbolInfo.meta.isJsFunction = true;
      }

      // For object types with properties, add property information
      if (
        importedValue !== undefined && typeof importedValue === "object" &&
        importedValue !== null
      ) {
        // For small objects, capture property names to help with type checking
        if (
          !Array.isArray(importedValue) &&
          Object.keys(importedValue).length <= 10
        ) {
          enrichedSymbolInfo.meta.properties = Object.keys(importedValue);
        }
      }

      // Cast to proper SymbolInfo type when setting in table
      globalSymbolTable.set(enrichedSymbolInfo);
    }
  } catch (error) {
    // If the error is already an HQLError with a different filePath, preserve it
    const sourceFile = getSourceLocationFilePath(error);
    if (
      error instanceof Error && sourceFile && options.currentFile &&
      sourceFile !== options.currentFile
    ) {
      throw error;
    }
    const modulePath = elements[3]?.type === "literal"
      ? String(elements[3].value)
      : "unknown";
    // Try to find the import position
    let lineInfo = undefined;
    if (options.currentFile) {
      const symbolsVector = elements[1] as SList;
      const vectorElements = processVectorElements(symbolsVector.elements, {
        allowJsArrayWrapper: true,
      });
      const symbols = Array.from(
        extractSymbolsAndAliases(vectorElements).keys(),
      );
      lineInfo = findImportVectorPosition(
        options.currentFile,
        modulePath,
        symbols,
      );
    }
    wrapImportError(
      "Processing vector import",
      error,
      modulePath,
      options.currentFile,
      lineInfo,
    );
  }
}

/**
 * Find the position of a symbol in an import vector
 */
function findImportVectorPosition(
  filePath: string,
  modulePath: string,
  symbols: string[],
): { line: number; column: number } | undefined {
  const lines = getCachedFileLines(filePath);
  if (!lines) return undefined;

  // Find the import statement with both vector and module path
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line.includes("[") && line.includes("from") && line.includes(modulePath)
    ) {
      // First check if any of the symbols are in this line
      for (const symbol of symbols) {
        const symbolPos = line.indexOf(symbol);
        if (symbolPos >= 0) {
          return { line: i + 1, column: symbolPos + 1 };
        }
      }

      // If no specific symbol found, return position of the vector
      const vectorPos = line.indexOf("[");
      if (vectorPos >= 0) {
        return { line: i + 1, column: vectorPos + 1 };
      }

      // Fallback to import keyword position
      return { line: i + 1, column: line.indexOf("import") + 1 };
    }
  }

  return undefined;
}

/**
 * Extract symbol names and their aliases from vector elements
 */
function extractSymbolsAndAliases(
  vectorElements: SExp[],
): Map<string, string | null> {
  const requestedSymbols = new Map<string, string | null>();
  let i = 0;

  while (i < vectorElements.length) {
    if (!isSymbol(vectorElements[i])) {
      i++;
      continue;
    }

    const symbolName = (vectorElements[i] as SSymbol).name;
    if (
      i + 2 < vectorElements.length &&
      isSymbol(vectorElements[i + 1]) &&
      (vectorElements[i + 1] as SSymbol).name === "as" &&
      isSymbol(vectorElements[i + 2])
    ) {
      const aliasName = (vectorElements[i + 2] as SSymbol).name;
      requestedSymbols.set(symbolName, aliasName);
      i += 3;
    } else {
      requestedSymbols.set(symbolName, null);
      i++;
    }
  }

  return requestedSymbols;
}

/**
 * Import symbols from a module with enhanced error context
 */
function importSymbols(
  requestedSymbols: Map<string, string | null>,
  modulePath: string,
  tempModuleName: string,
  env: Environment,
  currentFile: string,
  lineInfo?: { line: number; column: number },
  resolvedModulePath?: string,
): void {
  for (const [symbolName, aliasName] of requestedSymbols.entries()) {
    try {
      // Check for user-defined macros FIRST (before system macros)
      const moduleExports = env.moduleExports.get(tempModuleName);
      const exportedValue = moduleExports?.[symbolName];

      logger.debug(`importSymbols: checking ${symbolName} in ${tempModuleName}`);
      logger.debug(`  moduleExports exists: ${moduleExports !== undefined}`);
      logger.debug(`  moduleExports keys: ${moduleExports ? Object.keys(moduleExports).join(', ') : 'none'}`);
      logger.debug(`  exportedValue: ${exportedValue}`);
      logger.debug(`  isMacroFunction: ${exportedValue ? isMacroFunction(exportedValue) : 'N/A'}`);

      if (exportedValue && isMacroFunction(exportedValue)) {
        // This is a user-defined macro - import it properly
        const macroName = aliasName || symbolName;

        // Use the resolved module path for checking exports
        const sourceFilePath = resolvedModulePath || modulePath;

        // Import the user macro (this checks export list and marks as imported)
        const imported = env.importUserMacro(symbolName, sourceFilePath);

        if (!imported) {
          // Macro exists but was not exported - throw error
          throw new ImportError(
            `Macro '${symbolName}' is not exported from '${modulePath}'`,
            symbolName,
            { filePath: currentFile, line: lineInfo?.line, column: lineInfo?.column },
          );
        }

        // If alias, mark the alias as imported and also store the macro under the alias name
        if (aliasName && aliasName !== symbolName) {
          env.markMacroImported(aliasName);
          // Also store the macro function under the alias name so it can be looked up
          env.macros.set(aliasName, exportedValue as MacroFn);
          const sanitizedAlias = sanitizeIdentifier(aliasName);
          if (sanitizedAlias !== aliasName) {
            env.macros.set(sanitizedAlias, exportedValue as MacroFn);
          }
        }

        // Register in global macro registry for transpilation filtering
        globalMacroRegistry.add(macroName);
        globalMacroRegistry.add(sanitizeIdentifier(macroName)); // Also add sanitized version

        // Register in symbol table as a macro
        globalSymbolTable.set({
          name: macroName,
          kind: "macro",
          scope: "local",
          isImported: true,
          sourceModule: modulePath,
          meta: {
            importedInFile: currentFile,
            originalName: symbolName,
            isUserMacro: true,
          },
        });

        logger.debug(
          `Imported user macro: ${symbolName}${
            aliasName ? ` as ${aliasName}` : ""
          }`,
        );
        continue; // Skip regular symbol import
      }

      // Check for system macros (only if not a user macro)
      // Skip if currentFile is empty (can't import system macros without context)
      if (env.isSystemMacro(symbolName) && currentFile) {
        const success = env.importMacro(
          "system",
          symbolName,
          currentFile,
          aliasName || undefined,
        );
        if (success) {
          logger.debug(
            `Imported system macro ${symbolName}${
              aliasName ? ` as ${aliasName}` : ""
            }`,
          );
        } else {
          logger.warn(`Failed to import system macro ${symbolName}`);
        }
        continue; // Skip regular symbol import
      }

      // Try to import the symbol value
      const moduleLookupKey = `${tempModuleName}.${symbolName}`;
      try {
        const value = env.lookup(moduleLookupKey);
        env.define(aliasName || symbolName, value);
        logger.debug(
          `Imported symbol: ${symbolName}${
            aliasName ? ` as ${aliasName}` : ""
          }`,
        );
      } catch (_lookupError) {
        // Check if this is a deferred import (empty module)
        const moduleExports = env.moduleExports.get(tempModuleName);
        const isDeferredImport = moduleExports &&
          Object.keys(moduleExports).length === 0;

        if (isDeferredImport) {
          // For deferred imports, create a placeholder
          // The actual implementation will come from the JS import
          logger.debug(
            `Creating placeholder for deferred import: ${symbolName} from ${modulePath}`,
          );
          const placeholder = (..._args: unknown[]) => {
            // This will be replaced by the actual JS import
            return undefined;
          };
          env.define(aliasName || symbolName, placeholder);
        } else if (!env.isSystemMacro(symbolName)) {
          // Only throw for non-deferred, non-macro imports
          logger.debug(`Symbol not found in module: ${symbolName}`);

          // Create a validation error with precise information
          let errorMessage =
            `Symbol '${symbolName}' not found in module '${modulePath}'`;

          // Try to get a list of available exports
          if (moduleExports) {
            const exportsList = Object.keys(moduleExports).join(", ");
            if (exportsList) {
              errorMessage += `\nAvailable exports: ${exportsList}`;
            }
          }

          const error = new ValidationError(
            errorMessage,
            "import symbol lookup",
            "defined symbol",
            "undefined symbol",
            {
              filePath: currentFile,
              line: lineInfo?.line,
              column: lineInfo?.column,
            },
          );

          throw error;
        }
      }
    } catch (error) {
      // If the error is already an HQLError with a different filePath, preserve it
      const sourceFile = getSourceLocationFilePath(error);
      if (
        error instanceof Error && sourceFile && currentFile &&
        sourceFile !== currentFile
      ) {
        throw error;
      }
      // Determine if this is an import error (we want specific line info)
      if (error instanceof ValidationError || error instanceof ImportError) {
        // Create a source location with the correct information
        const loc = new SourceLocationInfo({
          filePath: currentFile,
          line: lineInfo?.line,
          column: lineInfo?.column,
        });
        throw new ImportError(
          `Importing '${symbolName}' from '${modulePath}': ${error.message}`,
          modulePath,
          loc,
          error,
        );
      }
      wrapImportError(
        `Importing symbol '${symbolName}' from '${modulePath}'`,
        error,
        modulePath,
        currentFile,
        lineInfo,
      );
    }
  }
}

/**
 * Load a module based on its type
 */
async function loadModule(
  moduleName: string,
  modulePath: string,
  resolvedPath: string,
  env: Environment,
  options: ImportProcessorOptions,
): Promise<void> {
  const processedFiles = options.processedFiles || new Set<string>();
  const inProgressFiles = options.inProgressFiles || new Set<string>();

  try {
    // Skip already processed modules (except HQL which handles this internally)
    if (!isHqlFile(modulePath) && processedFiles.has(resolvedPath)) {
      logger.debug(`Skipping already processed import: ${resolvedPath}`);
      return;
    }

    // Handle circular imports (except HQL which handles this internally)
    if (!isHqlFile(modulePath) && inProgressFiles.has(resolvedPath)) {
      logger.debug(
        `Detected circular import for ${resolvedPath}, will be resolved by parent process`,
      );
      return;
    }

    // Choose loading strategy based on module type
    if (isStdlibPackage(modulePath)) {
      await loadHqlModule(moduleName, modulePath, resolvedPath, env, options);
    } else if (isRemoteModule(modulePath)) {
      await loadRemoteModule(moduleName, modulePath, env);
    } else if (isHqlFile(modulePath)) {
      await loadHqlModule(moduleName, modulePath, resolvedPath, env, options);
    } else if (isJsFile(modulePath)) {
      await loadJavaScriptModule(
        moduleName,
        modulePath,
        resolvedPath,
        env,
        processedFiles,
      );
    } else if (isTypeScriptFile(modulePath)) {
      try {
        await loadTypeScriptModule(
          moduleName,
          modulePath,
          resolvedPath,
          env,
          processedFiles,
        );
      } catch (_error) {
        // Do not log here; let the centralized error handler report it.
        throw new ImportError(
          `Failed to load module: ${modulePath}\nDetails: ${_error}`,
        );
      }
    } else {
      throw new ImportError(
        `Unsupported import file type: ${modulePath}`,
        modulePath,
      );
    }
  } catch (error) {
    wrapError(
      `Loading module ${moduleName} from ${modulePath}`,
      error,
      modulePath,
    );
  }
}

/**
 * Load remote modules (npm, jsr, http)
 */
async function loadRemoteModule(
  moduleName: string,
  modulePath: string,
  env: Environment,
): Promise<void> {
  // Determine module type and configure import sources
  let sources: ModuleImporter[];
  let moduleType: string;

  if (modulePath.startsWith("npm:")) {
    const packageName = modulePath.substring(4);
    sources = [
      () => import(modulePath),
      () => import(`https://esm.sh/${packageName}`),
      () => import(`https://cdn.skypack.dev/${packageName}`),
    ];
    moduleType = "NPM";
  } else if (modulePath.startsWith("jsr:")) {
    sources = [() => import(modulePath)];
    moduleType = "JSR";
  } else {
    sources = [() => import(modulePath)];
    moduleType = "HTTP";
  }

  // Use common import logic (DRY)
  await tryImportSources(
    sources,
    moduleName,
    modulePath,
    env,
    `Imported ${moduleType} module: ${moduleName}${
      moduleType === "NPM" ? ` (${modulePath.substring(4)})` : ""
    }`,
    `Failed to import ${moduleType} module`,
    (message) => new ImportError(message, modulePath),
  );
}

/**
 * Load an HQL module
 */
async function loadHqlModule(
  moduleName: string,
  modulePath: string,
  resolvedPath: string,
  env: Environment,
  options: ImportProcessorOptions,
): Promise<void> {
  const processedFiles = options.processedFiles || new Set<string>();
  const inProgressFiles = options.inProgressFiles || new Set<string>();
  const tempDir = options.tempDir || "";
  const importMap = options.importMap || new Map<string, string>();

  // Skip if already processed
  if (processedFiles.has(resolvedPath)) {
    logger.debug(`Skipping already processed module: ${resolvedPath}`);
    return;
  }

  // Check for circular imports
  if (inProgressFiles.has(resolvedPath)) {
    logger.debug(
      `Detected circular import for ${resolvedPath}, handling with pre-registration`,
    );

    try {
      // Read and parse to find exports for pre-registration
      const fileContent = await readFile(resolvedPath, options.currentFile);
      const importedExprs = parse(fileContent);

      // Extract exports ahead of time
      const exportDefinitions = collectExportDefinitions(importedExprs);

      // Check if any exports are macros - circular macro imports are not supported
      // We need to expand macros in the file to determine this
      const tempEnv = env.extend();
      tempEnv.setCurrentFile(resolvedPath);
      expandMacros(importedExprs, tempEnv, {
        verbose: options.verbose,
        currentFile: resolvedPath,
      });

      // Re-set current file since expandMacros clears it at the end
      tempEnv.setCurrentFile(resolvedPath);

      for (const { name } of exportDefinitions) {
        if (tempEnv.hasMacro(name)) {
          throw new Error(
            `Circular import involving macro '${name}' detected.\n` +
              `File: ${resolvedPath}\n` +
              `Macros cannot be used in circular imports because they need to be expanded at compile-time.\n` +
              `Please restructure your code to avoid circular dependencies with macros.`,
          );
        }
      }

      // For circular imports (without macros), we need to pre-register empty module
      // to allow imports to succeed, then fill it later
      const emptyExports: Record<string, Value> = {};
      env.importModule(moduleName, emptyExports);

      for (const { name } of exportDefinitions) {
        logger.debug(`Pre-registering export for circular dependency: ${name}`);
        // Register placeholder null values that will be replaced later when fully processed
        emptyExports[name] = null;
      }

      return;
    } catch (error) {
      // If it's our circular macro error, re-throw it
      if (
        error instanceof Error &&
        error.message.includes("Circular import involving macro")
      ) {
        throw error;
      }
      logger.warn(
        `Failed to pre-register exports for circular dependency: ${resolvedPath}`,
      );
      return;
    }
  }

  // Mark as in progress to detect circular imports
  inProgressFiles.add(resolvedPath);

  const previousCurrentFile = env.getCurrentFile();
  try {
    // Read and parse the HQL file
    let fileContent: string;
    let importedExprs: SExp[];

    // Check if this is an embedded macro file
    const { isEmbeddedFile, getEmbeddedContent } = await import(
      "./lib/embedded-macros.ts"
    );

    // Also check embedded packages for @hql/* imports
    const { EMBEDDED_PACKAGES } = await import("./embedded-packages.ts");

    // Helper to check embedded packages by modulePath (e.g., "@hql/http")
    const getEmbeddedPackageContent = (path: string): string | undefined => {
      // Check direct match first (e.g., "@hql/http")
      if (EMBEDDED_PACKAGES[path]) {
        return EMBEDDED_PACKAGES[path];
      }
      // Check if path ends with a package path pattern
      for (const key of Object.keys(EMBEDDED_PACKAGES)) {
        if (path.endsWith(`packages/${key.replace("@hql/", "")}/mod.hql`)) {
          return EMBEDDED_PACKAGES[key];
        }
      }
      return undefined;
    };

    // First check embedded packages (for @hql/* imports in compiled binary)
    const embeddedPkgContent = getEmbeddedPackageContent(modulePath) ||
                               getEmbeddedPackageContent(resolvedPath);
    if (embeddedPkgContent) {
      fileContent = embeddedPkgContent;
      importedExprs = parse(fileContent, resolvedPath);
      logger.debug(`Using embedded package content for ${modulePath}`);
    } else if (isEmbeddedFile(resolvedPath)) {
      const embeddedContent = getEmbeddedContent(resolvedPath);
      if (embeddedContent) {
        fileContent = embeddedContent;
        importedExprs = parse(fileContent, resolvedPath);
        logger.debug(`Using embedded macro content for ${resolvedPath}`);
      } else {
        // Fallback to reading from disk
        fileContent = await readFile(resolvedPath, options.currentFile);
        importedExprs = parse(fileContent, resolvedPath);
      }
    } else {
      // Try to read the file normally
      try {
        fileContent = await readFile(resolvedPath, options.currentFile);
        importedExprs = parse(fileContent, resolvedPath);
      } catch (_readError) {
        // If file reading fails, generate deferred import
        // This allows imports to work in JSR package context
        logger.debug(
          `File not found, generating deferred import for ${resolvedPath}`,
        );

        // Register empty module to prevent errors
        // The transpiler will generate the import statement
        // and the actual implementation will come from JS at runtime
        const emptyModule = {};
        env.importModule(moduleName, emptyModule);

        // Store this as a deferred import - the transpiler will handle it
        return;
      }
    }

    // Set context for processing
    env.setCurrentFile(resolvedPath);

    // Process definitions first - create stubs for functions and variables
    processFileDefinitions(importedExprs, env);

    // Create module exports object early for circular dependencies
    // We pass an empty object to importModule, but it creates its own internal object
    env.importModule(moduleName, {});

    // IMPORTANT: Get the actual object that importModule stored, not our original empty object
    const moduleExports = env.moduleExports.get(moduleName)!;

    // Process imports - allow circular references to find the pre-registered module
    await processImports(importedExprs, env, {
      verbose: options.verbose,
      baseDir: dirname(resolvedPath),
      tempDir,
      processedFiles,
      inProgressFiles,
      importMap,
      currentFile: resolvedPath,
    });

    // Expand macros to register macro definitions in the environment
    expandMacros(importedExprs, env, {
      verbose: options.verbose,
      currentFile: resolvedPath,
    });

    // Re-set current file since expandMacros clears it
    env.setCurrentFile(resolvedPath);

    // Now process exports and fill in the module exports
    processFileExportsAndDefinitions(
      importedExprs,
      env,
      moduleExports,
      resolvedPath,
    );

    // Clear current file after processing
    env.setCurrentFile(null);

    logger.debug(`Imported HQL module: ${moduleName}`);
  } catch (error) {
    // If the error is a ParseError or HQLError with a different filePath, preserve it
    const sourceFile = getSourceLocationFilePath(error);
    if (
      error instanceof Error &&
      (error.name === "ParseError" || error.name === "HQLError") &&
      sourceFile &&
      sourceFile !== options.currentFile
    ) {
      throw error;
    }
    wrapError(
      `Importing HQL module ${moduleName}`,
      error,
      modulePath,
      options.currentFile,
    );
  } finally {
    env.setCurrentFile(previousCurrentFile);
    inProgressFiles.delete(resolvedPath);
    processedFiles.add(resolvedPath);
  }
}

/**
 * Load a TypeScript module by transpiling it to JavaScript first
 */
async function loadTypeScriptModule(
  moduleName: string,
  modulePath: string,
  resolvedPath: string,
  env: Environment,
  processedFiles: Set<string>,
): Promise<void> {
  try {
    logger.debug(`TypeScript import detected: ${resolvedPath}`);

    // Convert TypeScript to JavaScript
    const jsOutPath = await getCachedPath(resolvedPath, ".js", {
      createDir: true,
      preserveRelative: true,
    });
    await transpileTypeScriptToJavaScript(resolvedPath, jsOutPath);

    // Use the JavaScript file instead
    logger.debug(`Using transpiled JavaScript: ${jsOutPath}`);
    const jsModulePath = modulePath.replace(/\.tsx?$/, ".js");

    // Use the standard JavaScript module loader for the transpiled file
    await loadJavaScriptModule(
      moduleName,
      jsModulePath,
      jsOutPath,
      env,
      processedFiles,
    );
  } catch (error) {
    throw new ImportError(
      `Importing TypeScript module ${moduleName}: ${
        getErrorMessage(error)
      }`,
      modulePath,
    );
  }
}

/**
 * Load a JavaScript module
 */
async function loadJavaScriptModule(
  moduleName: string,
  modulePath: string,
  resolvedPath: string,
  env: Environment,
  processedFiles: Set<string>,
): Promise<void> {
  try {
    let finalModuleUrl = `file://${resolvedPath}`;

    // Check if JS file contains HQL imports or needs processing
    const jsSource = await platformReadTextFile(resolvedPath);
    logger.debug(`Checking JS file ${resolvedPath} for imports...`);
    if (
      hasHqlImports(jsSource) ||
      jsSource.includes("import") && jsSource.includes("from")
    ) {
      logger.debug(`JS file ${resolvedPath} needs import processing.`);

      // Process the file and its imports recursively
      await processJavaScriptFile(resolvedPath);

      // Get the cached path
      const cachedPath = getImportMapping(resolvedPath);
      if (cachedPath) {
        finalModuleUrl = `file://${cachedPath}`;
        logger.debug(`Using cached JS file: ${cachedPath}`);
      }
    }

    // Import and register the module
    const module = await import(finalModuleUrl);
    env.importModule(moduleName, module);
    processedFiles.add(resolvedPath);

    logger.debug(`Imported JS module: ${moduleName} from ${finalModuleUrl}`);
  } catch (error) {
    throw new ImportError(
      `Importing JS module ${moduleName}: ${
        getErrorMessage(error)
      }`,
      modulePath,
    );
  }
}

/**
 * Check if source code has HQL imports (local implementation)
 */
function hasHqlImports(source: string): boolean {
  return source.includes(".hql") && (
    source.includes("import") ||
    source.includes("require")
  );
}

/**
 * Transpile TypeScript to JavaScript using esbuild
 */
async function transpileTypeScriptToJavaScript(
  tsPath: string,
  jsPath: string,
): Promise<void> {
  try {
    const esbuild = await import("npm:esbuild@^0.17.0");

    await esbuild.build({
      entryPoints: [tsPath],
      outfile: jsPath,
      format: "esm",
      target: "es2020",
      bundle: false,
      platform: "neutral",
    });

    logger.debug(`Transpiled ${tsPath} to ${jsPath}`);
  } catch (error) {
    throw new Error(
      `Failed to transpile TypeScript: ${
        getErrorMessage(error)
      }`,
    );
  }
}

/**
 * Helper function to try importing from multiple sources
 */
async function tryImportSources(
  sources: ModuleImporter[],
  moduleName: string,
  modulePath: string,
  env: Environment,
  loggerMsg: string,
  errorMsg: string,
  createError: (message: string) => Error = (message) => new Error(message),
): Promise<void> {
  try {
    const importResults = await Promise.allSettled(sources.map((fn) => fn()));
    const successfulImport = importResults.find((result) =>
      result.status === "fulfilled"
    );
    if (successfulImport && successfulImport.status === "fulfilled") {
      env.importModule(moduleName, successfulImport.value);
      logger.debug(loggerMsg);
    } else {
      const errors = importResults
        .filter((result): result is PromiseRejectedResult =>
          result.status === "rejected"
        )
        .map((result) =>
          typeof result.reason === "string"
            ? result.reason
            : (result.reason?.message || String(result.reason))
        )
        .join("; ");
      throw createError(`${errorMsg}: ${errors}`);
    }
  } catch (error) {
    wrapError(loggerMsg, error, modulePath);
  }
}

// Removed: loadNpmModule, loadJsrModule, loadHttpModule
// These three functions were nearly identical wrappers around tryImportSources.
// Consolidated into loadRemoteModule() above for DRY compliance.

/**
 * Process file definitions (let, fn, macro) for variables, functions and macros
 */
function processFileDefinitions(
  exprs: SExp[],
  env: Environment,
): void {
  try {
    logger.debug("Processing file definitions for macros and variables");

    for (const expr of exprs) {
      if (
        expr.type !== "list" || expr.elements.length === 0 ||
        !isSymbol(expr.elements[0])
      ) {
        continue;
      }

      const op = expr.elements[0].name;

      if (op === "let" && expr.elements.length === 3) {
        processLetDefinition(expr, env);
      } else if (op === "fn" && expr.elements.length >= 4) {
        processFunctionDefinition(expr, env);
      }
    }
  } catch (error) {
    wrapError("Processing file definitions", error, env.getCurrentFile() || "");
  }
}

/**
 * Process a let definition
 */
function processLetDefinition(
  expr: SList,
  env: Environment,
): void {
  try {
    if (!isSymbol(expr.elements[1])) return;

    const name = expr.elements[1].name;
    const value = evaluateForMacro(expr.elements[2], env, logger);

    env.define(name, isLiteral(value) ? value.value : value);
    logger.debug(`Registered variable for macros: ${name}`);
  } catch (error) {
    const symbolName = isSymbol(expr.elements[1])
      ? expr.elements[1].name
      : "unknown";
    wrapError(
      `Processing let declaration for '${symbolName}'`,
      error,
      env.getCurrentFile() || "",
    );
  }
}

/**
 * Process a function definition
 */
function processFunctionDefinition(
  expr: SList,
  env: Environment,
): void {
  try {
    if (!isSymbol(expr.elements[1]) || expr.elements[2].type !== "list") return;

    const fnName = expr.elements[1].name;
    const fn = (...args: unknown[]) => {
      try {
        return `${fnName}(${args.join(", ")})`;
      } catch (error) {
        logger.error(
          `Error executing function ${fnName}: ${formatErrorMessage(error)}`,
        );
        return null;
      }
    };

    Object.defineProperty(fn, "isDefFunction", { value: true });
    env.define(fnName, fn);

    logger.debug(`Registered function for macros: ${fnName}`);
  } catch (error) {
    const symbolName = isSymbol(expr.elements[1])
      ? expr.elements[1].name
      : "unknown";
    wrapError(
      `Processing function declaration for '${symbolName}'`,
      error,
      env.getCurrentFile() || "",
    );
  }
}

/**
 * Process file exports and definitions
 */
function processFileExportsAndDefinitions(
  expressions: SExp[],
  env: Environment,
  moduleExports: Record<string, Value>,
  filePath: string,
): void {
  try {
    // Collect and process exports
    const exportDefinitions = collectExportDefinitions(expressions);

    // For handling circular dependencies, we should first pre-register
    // all exports with placeholder values if they're not already in the moduleExports
    for (const { name } of exportDefinitions) {
      if (moduleExports[name] === undefined) {
        moduleExports[name] = null;
      }
    }

    for (const { name, value } of exportDefinitions) {
      try {
        // Check if this is a macro and export it directly
        if (env.hasMacro(name)) {
          const macroFn = env.getMacro(name);
          logger.debug(`processFileExportsAndDefinitions: macroFn for ${name} is ${macroFn ? 'defined' : 'undefined'}`);
          if (macroFn) {
            moduleExports[name] = macroFn;
            logger.debug(`processFileExportsAndDefinitions: added ${name} to moduleExports, keys now: ${Object.keys(moduleExports).join(', ')}`);

            // Mark this macro as exported from the current file
            env.markMacroExported(name);

            // Register in global macro registry
            globalMacroRegistry.add(name);
            globalMacroRegistry.add(sanitizeIdentifier(name));

            logger.debug(`Added macro export: "${name}"`);
            continue;
          }
        }

        // Try to evaluate the export expression if present
        if (value) {
          try {
            const evaluatedValue = evaluateForMacro(value, env, logger);
            moduleExports[name] = evaluatedValue;
            logger.debug(`Added export "${name}" with evaluated expression`);
            continue;
          } catch (evalError) {
            logger.debug(
              `Failed to evaluate expression for export "${name}": ${
                formatErrorMessage(evalError)
              }`,
            );
          }
        }

        // Fall back to looking up the value from environment
        try {
          const lookupValue = env.lookup(name);
          moduleExports[name] = lookupValue;
          logger.debug(`Added export "${name}" with looked-up value`);
        } catch (lookupError) {
          // Only warn if the export wasn't pre-registered (which would indicate a circular dependency)
          if (moduleExports[name] === undefined) {
            logger.warn(`Symbol not found for export: "${name}"`);
          } else {
            logger.debug(
              `Symbol not found for export "${name}", using placeholder for circular dependency`,
            );
          }

          // Special handling for HQL files
          if (filePath.endsWith(".hql")) {
            // Only assign null if not already set (preserve pre-registered values)
            if (moduleExports[name] === undefined) {
              moduleExports[name] = null;
            }
          } else {
            wrapError(
              `Lookup failed for export "${name}"`,
              lookupError,
              filePath,
              filePath,
            );
          }
        }
      } catch (error) {
        if (
          !(error instanceof ValidationError &&
            error.message.includes("Symbol not found"))
        ) {
          wrapError(
            `Failed to export symbol "${name}"`,
            error,
            filePath,
            filePath,
          );
        }
      }
    }
  } catch (error) {
    wrapError(
      "Processing file exports and definitions",
      error,
      filePath,
      filePath,
    );
  }
}
