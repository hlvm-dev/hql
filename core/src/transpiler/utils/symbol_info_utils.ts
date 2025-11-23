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
  filePath?: string,
): SymbolInfo {
  return {
    name,
    kind: "variable", // Default kind, can be updated later
    scope,
    meta: { definedInFile: filePath || "global" },
  };
}

/**
 * Determine the appropriate kind and type for a value and enrich the SymbolInfo
 */
export function enrichSymbolInfoWithValueType(
  symbolInfo: SymbolInfo,
  value: unknown,
): SymbolInfo {
  // Make a copy to avoid mutating the original
  const result = { ...symbolInfo };

  if (typeof value === "function") {
    result.kind = "function";
    result.type = "Function";

    // Try to detect special function types
    const functionValue = value as MacroLikeFunction;
    if ("isUserMacro" in functionValue && functionValue.isUserMacro) {
      result.kind = "macro";
    } else if (
      "isSystemMacro" in functionValue && functionValue.isSystemMacro
    ) {
      // Use 'macro' for system macros too, with a meta flag
      result.kind = "macro";
      if (!result.meta) result.meta = {};
      result.meta.isSystem = true;
    } else if (
      "isHqlConstructor" in functionValue && functionValue.isHqlConstructor
    ) {
      // Use 'function' for constructors with a meta flag
      if (!result.meta) result.meta = {};
      result.meta.isConstructor = true;
    }

    // Extract function parameters
    extractFunctionParams(result, functionValue);
  } else if (typeof value === "object") {
    result.kind = "variable";

    if (value === null) {
      result.type = "Null";
    } else if (Array.isArray(value)) {
      result.type = "Array";

      // Store collection info in meta
      if (!result.meta) result.meta = {};
      result.meta.isCollection = true;
      result.meta.length = value.length;

      // Infer element type if array is not empty
      if (value.length > 0) {
        const firstType = typeof value[0];
        result.meta.elementType = firstType.charAt(0).toUpperCase() +
          firstType.slice(1);
      }
    } else {
      // Regular object
      result.type = "Object";

      // Store object info in meta
      if (!result.meta) result.meta = {};
      result.meta.isObject = true;

      const keys = Object.keys(value);
      result.meta.propertyCount = keys.length;

      // Store sample of property names for debugging
      if (keys.length > 0) {
        result.meta.sampleProperties = keys.slice(0, Math.min(5, keys.length));
      }
    }
  } else {
    // Primitive types
    result.kind = "variable";
    const typeName = typeof value;
    result.type = typeName.charAt(0).toUpperCase() + typeName.slice(1);

    // Add value info for primitive constants
    if (!result.meta) result.meta = {};

    // For string/number/boolean, store sample of actual value
    if (
      typeof value === "string" || typeof value === "number" ||
      typeof value === "boolean"
    ) {
      const stringValue = String(value);
      result.meta.sampleValue = stringValue.length > 50
        ? stringValue.substring(0, 47) + "..."
        : stringValue;
    }
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
