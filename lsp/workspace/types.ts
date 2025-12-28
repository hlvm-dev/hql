/**
 * LSP Workspace Types
 *
 * Shared types for workspace-wide symbol tracking and cross-file navigation.
 */

import type { SymbolInfo } from "../../src/transpiler/symbol_table.ts";

/**
 * Unique identifier for a symbol across the workspace
 * Format: "filePath#symbolName"
 */
export type SymbolId = string;

/**
 * Create a unique symbol ID
 */
export function createSymbolId(filePath: string, symbolName: string): SymbolId {
  return `${filePath}#${symbolName}`;
}

/**
 * Export information for a symbol
 */
export interface ExportInfo {
  symbolName: string;
  localName: string;
  symbolId: SymbolId;
  isReExport: boolean;
  originalModule?: string;
}

/**
 * Import information from a file
 */
export interface ImportInfo {
  modulePath: string; // Raw path from source: "./math.hql"
  resolvedPath?: string; // Absolute path (resolved lazily)
  importedSymbols: ImportedSymbol[];
  isNamespaceImport: boolean;
  namespaceName?: string;
}

export interface ImportedSymbol {
  name: string;
  localName: string;
  line?: number;
  column?: number;
}

/**
 * Indexed symbol with workspace metadata
 */
export interface IndexedSymbol {
  info: SymbolInfo;
  symbolId: SymbolId;
  filePath: string;
}

/**
 * File-level index
 */
export interface FileIndex {
  filePath: string;
  lastModified: number;

  // All symbols defined in this file
  symbols: Map<string, IndexedSymbol>;

  // Symbols exported from this file
  exports: Map<string, ExportInfo>;

  // Imports in this file
  imports: ImportInfo[];
}
