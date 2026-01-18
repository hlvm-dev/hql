// src/hql/transpiler/utils/symbol-registry.ts
// =============================================================================
// SYMBOL REGISTRATION UTILITIES
// =============================================================================
// This module consolidates the 17+ scattered globalSymbolTable.set() calls
// across environment.ts, imports.ts, macro-registry.ts, and hql-transpiler.ts
// into reusable, consistent helper functions.
//
// Benefits:
// - Single source of truth for symbol registration patterns
// - Consistent metadata structure
// - Reduced duplication (~150 lines saved)
// - Easier to maintain and extend

import { globalSymbolTable, type SymbolInfo, type SymbolKind, type SymbolScope } from "../symbol_table.ts";

/**
 * Location information for a symbol definition.
 * Matches the SymbolInfo.location type from symbol_table.ts
 */
export interface SymbolLocation {
  filePath: string;
  line: number;
  column: number;
}

/**
 * Register a builtin function/special form in the global symbol table.
 *
 * @param name - The builtin name (e.g., "if", "+", "cons")
 * @param type - Optional type annotation (default: "Function")
 * @param isCore - Whether this is a core builtin (default: true)
 *
 * @example
 * registerBuiltin("if");
 * registerBuiltin("+", "Function");
 * registerBuiltin("cons", "Function", true);
 */
export function registerBuiltin(
  name: string,
  type: string = "Function",
  isCore: boolean = true,
): void {
  globalSymbolTable.set({
    name,
    kind: "builtin",
    scope: "global",
    type,
    meta: { isCore },
  });
}

/**
 * Register multiple builtins at once.
 *
 * @param names - Array of builtin names
 * @param type - Optional type annotation (default: "Function")
 *
 * @example
 * registerBuiltins(["+", "-", "*", "/"], "Function");
 */
export function registerBuiltins(
  names: string[],
  type: string = "Function",
): void {
  for (const name of names) {
    registerBuiltin(name, type);
  }
}

/**
 * Register a macro in the global symbol table.
 *
 * @param name - The macro name
 * @param sourceFile - File where the macro is defined
 * @param isSystem - Whether this is a system macro (default: false)
 * @param isExported - Whether the macro is exported (default: false)
 *
 * @example
 * registerMacro("defn", "system", true);
 * registerMacro("my-macro", "/path/to/file.hql", false, true);
 */
export function registerMacro(
  name: string,
  sourceFile: string,
  isSystem: boolean = false,
  isExported: boolean = false,
): void {
  globalSymbolTable.set({
    name,
    kind: "macro",
    scope: "global",
    isExported,
    meta: {
      isSystemMacro: isSystem,
      sourceFile,
    },
  });
}

/**
 * Register an imported module in the global symbol table.
 *
 * @param name - The module name (usually basename without extension)
 * @param sourcePath - The full module path
 * @param importedInFile - The file that imported this module
 *
 * @example
 * registerModule("utils", "./utils.hql", "/path/to/main.hql");
 */
export function registerModule(
  name: string,
  sourcePath: string,
  importedInFile?: string,
): void {
  globalSymbolTable.set({
    name,
    kind: "module",
    scope: "global",
    isImported: true,
    sourceModule: sourcePath,
    meta: importedInFile ? { importedInFile } : undefined,
  });
}

/**
 * Register an imported symbol in the symbol table.
 *
 * @param name - The local name of the imported symbol
 * @param sourceModule - The module the symbol is imported from
 * @param originalName - Original name in source module (if aliased)
 * @param kind - The kind of symbol (default: "import")
 *
 * @example
 * registerImport("map", "hql/core");
 * registerImport("myMap", "hql/core", "map"); // aliased import
 */
export function registerImport(
  name: string,
  sourceModule: string,
  originalName?: string,
  kind: SymbolKind = "import",
): void {
  const info: SymbolInfo = {
    name,
    kind,
    scope: "module",
    isImported: true,
    sourceModule,
  };

  if (originalName && originalName !== name) {
    info.aliasOf = originalName;
  }

  globalSymbolTable.set(info);
}

/**
 * Register an exported symbol in the symbol table.
 *
 * @param name - The exported name
 * @param sourceFile - The file exporting the symbol
 * @param kind - The kind of symbol being exported (default: "export")
 * @param parent - Parent symbol (e.g., class name for methods)
 *
 * @example
 * registerExport("myFunction", "/path/to/file.hql", "function");
 */
export function registerExport(
  name: string,
  sourceFile: string,
  kind: SymbolKind = "export",
  parent?: string,
): void {
  globalSymbolTable.set({
    name,
    kind,
    scope: "module",
    isExported: true,
    sourceModule: sourceFile,
    parent,
  });
}

/**
 * Register a variable or constant in the symbol table.
 *
 * @param name - The variable name
 * @param scope - The scope (global, module, local)
 * @param options - Additional options
 *
 * @example
 * registerVariable("counter", "local", { type: "number", filePath: "main.hql" });
 * registerVariable("PI", "global", { isConst: true, type: "number" });
 */
export function registerVariable(
  name: string,
  scope: SymbolScope = "local",
  options: {
    type?: string;
    isConst?: boolean;
    filePath?: string;
    location?: SymbolLocation;
  } = {},
): void {
  const { type, isConst = false, filePath, location } = options;

  globalSymbolTable.set({
    name,
    kind: isConst ? "constant" : "variable",
    scope,
    type,
    location,
    meta: filePath ? { sourceFile: filePath } : undefined,
  });
}

/**
 * Register a function in the symbol table.
 *
 * @param name - The function name
 * @param scope - The scope
 * @param options - Function details
 *
 * @example
 * registerFunction("add", "module", {
 *   params: [{ name: "a", type: "number" }, { name: "b", type: "number" }],
 *   returnType: "number",
 *   filePath: "math.hql"
 * });
 */
export function registerFunction(
  name: string,
  scope: SymbolScope = "module",
  options: {
    params?: { name: string; type?: string }[];
    returnType?: string;
    filePath?: string;
    isExported?: boolean;
    location?: SymbolLocation;
  } = {},
): void {
  const { params, returnType, filePath, isExported, location } = options;

  globalSymbolTable.set({
    name,
    kind: "function",
    scope,
    params,
    returnType,
    isExported,
    location,
    meta: filePath ? { sourceFile: filePath } : undefined,
  });
}

/**
 * Register a class in the symbol table.
 *
 * @param name - The class name
 * @param options - Class details
 *
 * @example
 * registerClass("Point", {
 *   fields: [{ name: "x", type: "number" }, { name: "y", type: "number" }],
 *   methods: [{ name: "distance", returnType: "number" }],
 *   filePath: "geometry.hql"
 * });
 */
export function registerClass(
  name: string,
  options: {
    fields?: { name: string; type?: string }[];
    methods?: { name: string; params?: { name: string; type?: string }[]; returnType?: string }[];
    filePath?: string;
    isExported?: boolean;
    location?: SymbolLocation;
  } = {},
): void {
  const { fields, methods, filePath, isExported, location } = options;

  globalSymbolTable.set({
    name,
    kind: "class",
    scope: "module",
    fields,
    methods,
    isExported,
    location,
    meta: filePath ? { sourceFile: filePath } : undefined,
  });
}

/**
 * Register an enum in the symbol table.
 *
 * @param name - The enum name
 * @param cases - The enum case names
 * @param options - Additional options
 *
 * @example
 * registerEnum("Color", ["Red", "Green", "Blue"], { filePath: "types.hql" });
 */
export function registerEnum(
  name: string,
  cases: string[],
  options: {
    filePath?: string;
    isExported?: boolean;
    location?: SymbolLocation;
  } = {},
): void {
  const { filePath, isExported, location } = options;

  globalSymbolTable.set({
    name,
    kind: "enum",
    scope: "module",
    cases,
    isExported,
    location,
    meta: filePath ? { sourceFile: filePath } : undefined,
  });
}

/**
 * Register a type alias in the symbol table.
 *
 * @param name - The type name
 * @param aliasOf - The type it aliases
 * @param options - Additional options
 *
 * @example
 * registerTypeAlias("UserId", "string", { filePath: "types.hql" });
 */
export function registerTypeAlias(
  name: string,
  aliasOf: string,
  options: {
    filePath?: string;
    isExported?: boolean;
    location?: SymbolLocation;
  } = {},
): void {
  const { filePath, isExported, location } = options;

  globalSymbolTable.set({
    name,
    kind: "type",
    scope: "module",
    aliasOf,
    isExported,
    location,
    meta: filePath ? { sourceFile: filePath } : undefined,
  });
}

/**
 * Batch register symbols with a common configuration.
 *
 * @param symbols - Array of symbol configurations
 *
 * @example
 * batchRegister([
 *   { name: "x", kind: "variable", scope: "local" },
 *   { name: "y", kind: "variable", scope: "local" },
 * ]);
 */
export function batchRegister(symbols: SymbolInfo[]): void {
  for (const symbol of symbols) {
    globalSymbolTable.set(symbol);
  }
}
