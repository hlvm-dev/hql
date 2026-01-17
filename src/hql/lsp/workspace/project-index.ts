/**
 * LSP Project Index
 *
 * Workspace-wide symbol index for cross-file navigation.
 *
 * Maintains:
 * - File → FileIndex (symbols, exports per file)
 * - Export name → Files that export it
 */

import type { AnalysisResult } from "../analysis.ts";
import type { SymbolInfo } from "../../transpiler/symbol_table.ts";
import {
  type FileIndex,
  type IndexedSymbol,
  type ExportInfo,
  createSymbolId,
} from "./types.ts";

export class ProjectIndex {
  // Primary storage: file path → file index
  private fileIndices = new Map<string, FileIndex>();

  // Derived indices (maintained incrementally)
  // Export name → files that export it
  private exportIndex = new Map<string, Set<string>>();

  /**
   * Index a single file from analysis result
   */
  indexFile(filePath: string, analysis: AnalysisResult): void {
    // Remove old data for this file first
    this.removeFile(filePath);

    const fileIndex: FileIndex = {
      filePath,
      lastModified: Date.now(),
      symbols: new Map(),
      exports: new Map(),
    };

    // Index all symbols
    for (const symbol of analysis.symbols.getAllSymbols()) {
      // Handle imported symbols
      if (symbol.isImported) {
        // Check if this is a re-export (imported AND exported)
        if (symbol.isExported && symbol.sourceModule) {
          const symbolId = createSymbolId(filePath, symbol.name);
          const exportInfo: ExportInfo = {
            symbolName: symbol.name,
            localName: symbol.name,
            symbolId,
            isReExport: true,
            originalModule: symbol.sourceModule,
          };

          fileIndex.exports.set(symbol.name, exportInfo);

          // Update export index - re-exports also count as exports
          if (!this.exportIndex.has(symbol.name)) {
            this.exportIndex.set(symbol.name, new Set());
          }
          this.exportIndex.get(symbol.name)!.add(filePath);
        }

        continue;
      }

      const symbolId = createSymbolId(filePath, symbol.name);

      const indexedSymbol: IndexedSymbol = {
        info: symbol,
        symbolId,
        filePath,
      };

      fileIndex.symbols.set(symbol.name, indexedSymbol);

      // Track exports
      if (symbol.isExported) {
        const exportInfo: ExportInfo = {
          symbolName: symbol.name,
          localName: symbol.name,
          symbolId,
          isReExport: false,
        };

        fileIndex.exports.set(symbol.name, exportInfo);

        // Update export index
        if (!this.exportIndex.has(symbol.name)) {
          this.exportIndex.set(symbol.name, new Set());
        }
        this.exportIndex.get(symbol.name)!.add(filePath);
      }
    }

    // Store file index
    this.fileIndices.set(filePath, fileIndex);
  }

  /**
   * Remove a file from the index
   */
  removeFile(filePath: string): void {
    const existing = this.fileIndices.get(filePath);
    if (!existing) return;

    // Remove from export index
    for (const [name] of existing.exports) {
      this.exportIndex.get(name)?.delete(filePath);
      // Clean up empty sets
      if (this.exportIndex.get(name)?.size === 0) {
        this.exportIndex.delete(name);
      }
    }

    this.fileIndices.delete(filePath);
  }

  /**
   * Get an exported symbol by name from a specific file
   * Follows re-export chains to find the original definition
   */
  getExportedSymbol(symbolName: string, filePath: string): SymbolInfo | null {
    const fileIndex = this.fileIndices.get(filePath);
    if (!fileIndex) return null;

    const exportInfo = fileIndex.exports.get(symbolName);
    if (!exportInfo) return null;

    // Handle re-exports - follow chain to original
    if (exportInfo.isReExport && exportInfo.originalModule) {
      const originalFile = this.findFileForModule(exportInfo.originalModule, filePath);
      if (originalFile) {
        return this.getExportedSymbol(symbolName, originalFile);
      }
      return null;
    }

    const symbol = fileIndex.symbols.get(exportInfo.localName);
    return symbol?.info ?? null;
  }

  /**
   * Find a file in the index that matches a module path
   */
  private findFileForModule(modulePath: string, _fromFile: string): string | null {
    // Extract the filename from the module path
    const moduleFileName = modulePath.replace(/^\.\.?\//, "").replace(/\/$/, "");

    for (const filePath of this.fileIndices.keys()) {
      // Check if file path ends with the module name
      if (filePath.endsWith(moduleFileName) || filePath.endsWith("/" + moduleFileName)) {
        return filePath;
      }
    }

    return null;
  }

  /**
   * Find all files that export a symbol name
   */
  findExports(symbolName: string): string[] {
    const filePaths = this.exportIndex.get(symbolName);
    return filePaths ? Array.from(filePaths) : [];
  }

  /**
   * Search symbols by name (fuzzy matching)
   */
  searchSymbols(query: string, maxResults = 100): IndexedSymbol[] {
    const results: IndexedSymbol[] = [];
    const queryLower = query.toLowerCase();

    for (const [, fileIndex] of this.fileIndices) {
      for (const [name, symbol] of fileIndex.symbols) {
        if (results.length >= maxResults) break;

        // Simple substring match
        if (name.toLowerCase().includes(queryLower)) {
          results.push(symbol);
        }
      }
      if (results.length >= maxResults) break;
    }

    return results;
  }
}
