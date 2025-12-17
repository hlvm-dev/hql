/**
 * LSP Document Symbols Feature
 *
 * Provides document outline (symbol tree) for navigation.
 * Shows all symbols defined in a document with their hierarchy.
 */

import {
  DocumentSymbol,
  SymbolKind,
  Range,
} from "npm:vscode-languageserver@9.0.1";
import type { SymbolTable, SymbolInfo } from "../../src/transpiler/symbol_table.ts";
import { toLSPPosition } from "../utils/position.ts";

/**
 * Map HQL symbol kinds to LSP SymbolKind
 */
export function symbolKindToLSP(kind: string): SymbolKind {
  const map: Record<string, SymbolKind> = {
    function: SymbolKind.Function,
    fn: SymbolKind.Function,
    variable: SymbolKind.Variable,
    macro: SymbolKind.Function,
    class: SymbolKind.Class,
    enum: SymbolKind.Enum,
    "enum-case": SymbolKind.EnumMember,
    field: SymbolKind.Field,
    method: SymbolKind.Method,
    import: SymbolKind.Module,
    constant: SymbolKind.Constant,
    module: SymbolKind.Module,
    namespace: SymbolKind.Namespace,
    type: SymbolKind.TypeParameter,
    interface: SymbolKind.Interface,
    property: SymbolKind.Property,
  };
  return map[kind] ?? SymbolKind.Variable;
}

/**
 * Create LSP Range from symbol location
 * HQL locations are 1-indexed, LSP is 0-indexed
 */
function createSymbolRange(symbol: SymbolInfo): Range {
  const line = symbol.location?.line ?? 1;
  const column = symbol.location?.column ?? 1;

  return {
    start: toLSPPosition({ line, column }),
    end: toLSPPosition({ line, column: column + symbol.name.length }),
  };
}

/**
 * Format detail string for symbol (parameters, type, etc.)
 */
function formatDetail(symbol: SymbolInfo): string | undefined {
  if (symbol.params && symbol.params.length > 0) {
    const paramStr = symbol.params.map((p) => p.name).join(" ");
    return `[${paramStr}]`;
  }
  if (symbol.type) {
    return symbol.type;
  }
  return undefined;
}

/**
 * Get children symbols for classes and enums
 */
function getChildrenSymbols(symbol: SymbolInfo): DocumentSymbol[] {
  const children: DocumentSymbol[] = [];
  const parentRange = createSymbolRange(symbol);

  // Add methods for classes
  if (symbol.methods && symbol.methods.length > 0) {
    for (const method of symbol.methods) {
      children.push({
        name: method.name,
        kind: SymbolKind.Method,
        range: parentRange, // Methods don't have their own location
        selectionRange: parentRange,
        detail: method.params
          ? `[${method.params.map((p) => p.name).join(" ")}]`
          : undefined,
      });
    }
  }

  // Add fields for classes
  if (symbol.fields && symbol.fields.length > 0) {
    for (const field of symbol.fields) {
      children.push({
        name: field.name,
        kind: SymbolKind.Field,
        range: parentRange,
        selectionRange: parentRange,
        detail: field.type,
      });
    }
  }

  // Add cases for enums
  if (symbol.cases && symbol.cases.length > 0) {
    for (const caseName of symbol.cases) {
      children.push({
        name: caseName,
        kind: SymbolKind.EnumMember,
        range: parentRange,
        selectionRange: parentRange,
      });
    }
  }

  return children;
}

/**
 * Get document symbols for outline view
 *
 * @param symbols - Symbol table from document analysis
 * @returns Array of DocumentSymbol for VSCode outline
 */
export function getDocumentSymbols(
  symbols: SymbolTable | null
): DocumentSymbol[] {
  if (!symbols) return [];

  const result: DocumentSymbol[] = [];

  for (const symbol of symbols.getAllSymbols()) {
    // Skip imported symbols - they're defined in other files
    if (symbol.isImported) continue;

    // Skip symbols without location (shouldn't happen, but be safe)
    if (!symbol.location) continue;

    // Skip child symbols (enum cases, etc.) - they're handled as children
    if (symbol.parent) continue;

    const range = createSymbolRange(symbol);
    const children = getChildrenSymbols(symbol);

    const docSymbol: DocumentSymbol = {
      name: symbol.name,
      kind: symbolKindToLSP(symbol.kind),
      range: range,
      selectionRange: range,
      detail: formatDetail(symbol),
    };

    // Add children if any
    if (children.length > 0) {
      docSymbol.children = children;
    }

    result.push(docSymbol);
  }

  return result;
}
