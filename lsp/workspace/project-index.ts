/**
 * LSP Project Index
 *
 * Workspace-wide symbol index for cross-file navigation.
 *
 * Maintains:
 * - File → FileIndex (symbols, exports, imports per file)
 * - Export name → Files that export it
 * - Import graph (for dependency tracking)
 */

import type { AnalysisResult } from "../analysis.ts";
import type { SymbolInfo } from "../../src/transpiler/symbol_table.ts";
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

  // File → files it imports from
  private importGraph = new Map<string, Set<string>>();

  // File → files that import from it
  private dependentGraph = new Map<string, Set<string>>();

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
      imports: [],
    };

    // Build Map for O(1) import lookups during indexing (optimization: O(N²) → O(N))
    const importsByModule = new Map<string, typeof fileIndex.imports[0]>();

    // Index all symbols
    for (const symbol of analysis.symbols.getAllSymbols()) {
      // Handle imported symbols
      if (symbol.isImported) {
        // Track the import information
        if (symbol.sourceModule) {
          this.addImportInfo(fileIndex, symbol, importsByModule);
        }

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

    // Update import/dependent graphs
    this.updateGraphs(filePath, fileIndex);
  }

  /**
   * Add import information from an imported symbol
   * Uses Map for O(1) lookup instead of O(N) array.find()
   */
  private addImportInfo(
    fileIndex: FileIndex,
    symbol: SymbolInfo,
    importsByModule: Map<string, typeof fileIndex.imports[0]>
  ): void {
    if (!symbol.sourceModule) return;

    // O(1) Map lookup instead of O(N) array.find()
    let importInfo = importsByModule.get(symbol.sourceModule);

    if (!importInfo) {
      // Check if it's a namespace import
      // Namespace imports have kind="import" and no parent
      const isNamespace =
        symbol.kind === "import" || symbol.kind === "namespace";

      importInfo = {
        modulePath: symbol.sourceModule,
        importedSymbols: [],
        isNamespaceImport: isNamespace && !symbol.parent,
        namespaceName: isNamespace ? symbol.name : undefined,
      };
      importsByModule.set(symbol.sourceModule, importInfo);
      fileIndex.imports.push(importInfo);
    }

    // Add the imported symbol
    importInfo.importedSymbols.push({
      name: symbol.name,
      localName: symbol.name,
      line: symbol.location?.line,
      column: symbol.location?.column,
    });
  }

  /**
   * Update import and dependent graphs
   */
  private updateGraphs(filePath: string, fileIndex: FileIndex): void {
    const importedFiles = new Set<string>();

    for (const importInfo of fileIndex.imports) {
      if (importInfo.resolvedPath) {
        importedFiles.add(importInfo.resolvedPath);
      }
    }

    this.importGraph.set(filePath, importedFiles);

    // Update dependent graph (reverse of import graph)
    for (const importedFile of importedFiles) {
      if (!this.dependentGraph.has(importedFile)) {
        this.dependentGraph.set(importedFile, new Set());
      }
      this.dependentGraph.get(importedFile)!.add(filePath);
    }
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

    // Remove from import graph
    this.importGraph.delete(filePath);

    // Remove from dependent graph
    for (const [, deps] of this.dependentGraph) {
      deps.delete(filePath);
    }
    this.dependentGraph.delete(filePath);

    this.fileIndices.delete(filePath);
  }

  /**
   * Get file index for a specific file
   */
  getFileIndex(filePath: string): FileIndex | null {
    return this.fileIndices.get(filePath) ?? null;
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

  /**
   * Get all symbols across all indexed files
   */
  getAllSymbols(): IndexedSymbol[] {
    const results: IndexedSymbol[] = [];

    for (const [, fileIndex] of this.fileIndices) {
      for (const [, symbol] of fileIndex.symbols) {
        results.push(symbol);
      }
    }

    return results;
  }

  /**
   * Get files that depend on (import from) a file
   */
  getDependents(filePath: string): string[] {
    return Array.from(this.dependentGraph.get(filePath) ?? []);
  }

  /**
   * Get files that a file imports from
   */
  getImports(filePath: string): string[] {
    return Array.from(this.importGraph.get(filePath) ?? []);
  }

  /**
   * Get all indexed file paths
   */
  getAllFiles(): string[] {
    return Array.from(this.fileIndices.keys());
  }

  /**
   * Check if a file is indexed
   */
  hasFile(filePath: string): boolean {
    return this.fileIndices.has(filePath);
  }

  /**
   * Get statistics about the index
   */
  getStats(): {
    fileCount: number;
    symbolCount: number;
    exportCount: number;
  } {
    let symbolCount = 0;
    let exportCount = 0;

    for (const [, fileIndex] of this.fileIndices) {
      symbolCount += fileIndex.symbols.size;
      exportCount += fileIndex.exports.size;
    }

    return {
      fileCount: this.fileIndices.size,
      symbolCount,
      exportCount,
    };
  }

  /**
   * Clear the entire index
   */
  clear(): void {
    this.fileIndices.clear();
    this.exportIndex.clear();
    this.importGraph.clear();
    this.dependentGraph.clear();
  }
}
