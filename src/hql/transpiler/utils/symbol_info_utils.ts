// Utility functions for working with SymbolInfo objects
// This centralizes all symbol info creation and manipulation to ensure consistency

import type { SymbolInfo, SymbolScope } from "../symbol_table.ts";

type MacroLikeFunction =
  & ((...args: unknown[]) => unknown)
  & Record<string, unknown>;

/**
 * Create a basic SymbolInfo object with the required fields
 */
export function createBasicSymbolInfo(
  name: string,
  scope: SymbolScope = "global",
  _filePath?: string,
): SymbolInfo {
  return {
    name,
    kind: "variable",
    scope,
  };
}

/**
 * Determine the appropriate kind and type for a value and enrich the SymbolInfo
 */
export function enrichSymbolInfoWithValueType(
  symbolInfo: SymbolInfo,
  value: unknown,
): SymbolInfo {
  const result = { ...symbolInfo };

  if (typeof value === "function") {
    result.kind = "function";
    result.type = "Function";

    const functionValue = value as MacroLikeFunction;
    if ("isUserMacro" in functionValue && functionValue.isUserMacro) {
      result.kind = "macro";
    } else if (
      "isSystemMacro" in functionValue && functionValue.isSystemMacro
    ) {
      result.kind = "macro";
    }

    extractFunctionParams(result, functionValue);
  } else if (typeof value === "object") {
    result.kind = "variable";
    result.type = value === null
      ? "Null"
      : Array.isArray(value)
      ? "Array"
      : "Object";
  } else {
    result.kind = "variable";
    const typeName = typeof value;
    result.type = typeName[0].toUpperCase() + typeName.slice(1);
  }

  return result;
}

/**
 * Extract function parameters from a function value and add them to the SymbolInfo
 */
function extractFunctionParams(
  symbolInfo: SymbolInfo,
  functionValue: MacroLikeFunction,
): void {
  try {
    const funcStr = functionValue.toString();
    const paramMatch = funcStr.match(/^\s*function\s*[^(]*\(([^)]*)\)/s) ||
      funcStr.match(/^\s*\(([^)]*)\)\s*=>/s);

    if (paramMatch && paramMatch[1]) {
      const params = paramMatch[1].split(",").map((p) => p.trim()).filter(
        Boolean,
      );
      symbolInfo.params = params.map((p) => ({ name: p }));
    }
  } catch (_e) {
    // Ignore signature extraction failures
  }
}

/**
 * Enrich SymbolInfo for imported values
 */
export function enrichImportedSymbolInfo(
  symbolInfo: SymbolInfo,
  importedValue: unknown,
  symbolName: string,
  modulePath: string,
  aliasName?: string,
): SymbolInfo {
  // Start with basic import information
  const result = { ...symbolInfo };
  result.isImported = true;
  result.sourceModule = modulePath;
  if (aliasName && aliasName !== symbolName) {
    result.aliasOf = symbolName;
  }

  // Now enrich with type information from the imported value
  if (importedValue !== undefined) {
    return enrichSymbolInfoWithValueType(result, importedValue);
  }

  return result;
}
