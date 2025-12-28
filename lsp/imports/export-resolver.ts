/**
 * ExportResolver - Handle re-export resolution
 *
 * Resolves re-export chains to find original symbol definitions.
 * Handles circular dependencies with cycle detection.
 */

import type { ResolvedExport } from "./types.ts";
import type { ProjectIndex } from "../workspace/project-index.ts";
import type { SymbolInfo } from "../../src/transpiler/symbol_table.ts";

/**
 * Check if a symbol is a re-export (imported AND exported)
 */
export function isReExportedSymbol(symbol: SymbolInfo): boolean {
  return symbol.isExported === true && symbol.isImported === true;
}

/**
 * Resolve a re-export chain to find the original source
 *
 * @param symbolName - The symbol to resolve
 * @param filePath - Starting file path
 * @param index - The ProjectIndex
 * @param visited - Set of visited files (for cycle detection)
 * @returns ResolvedExport with original file, or null if not found
 */
export function resolveReExportChain(
  symbolName: string,
  filePath: string,
  index: ProjectIndex,
  visited: Set<string> = new Set()
): ResolvedExport | null {
  // Cycle detection
  if (visited.has(filePath)) {
    return null;
  }
  visited.add(filePath);

  const fileIndex = index.getFileIndex(filePath);
  if (!fileIndex) return null;

  const exportInfo = fileIndex.exports.get(symbolName);
  if (!exportInfo) return null;

  // If this is a direct export (not re-exported), return it
  if (!exportInfo.isReExport || !exportInfo.originalModule) {
    return {
      symbolName,
      originalFile: filePath,
      chain: [],
      isReExport: false,
    };
  }

  // This is a re-export - find the original source
  const originalModule = exportInfo.originalModule;

  // Try to find the original file in the index
  // The originalModule might be relative like "./original.hql"
  // We need to find a matching file in the index

  const matchingFile = findMatchingFile(originalModule, filePath, index);

  if (matchingFile) {
    // Recursively resolve
    const resolved = resolveReExportChain(symbolName, matchingFile, index, visited);

    if (resolved) {
      // Prepend current file to chain
      return {
        ...resolved,
        chain: [filePath, ...resolved.chain],
        isReExport: true,
      };
    }
  }

  // Couldn't resolve further - return current file as the best we found
  return {
    symbolName,
    originalFile: filePath,
    chain: [],
    isReExport: true,
  };
}

/**
 * Find a file in the index that matches a module path
 */
function findMatchingFile(
  modulePath: string,
  fromFile: string,
  index: ProjectIndex
): string | null {
  // Extract the filename from the module path
  const moduleFileName = modulePath.replace(/^\.\.?\//, "").replace(/\/$/, "");

  for (const filePath of index.getAllFiles()) {
    // Check if file path ends with the module name
    if (filePath.endsWith(moduleFileName) || filePath.endsWith("/" + moduleFileName)) {
      return filePath;
    }
  }

  return null;
}

/**
 * Detect circular re-export dependencies
 *
 * @param index - The ProjectIndex
 * @returns Array of cycles, each cycle is an array of file paths
 */
export function detectCircularReExports(index: ProjectIndex): string[][] {
  const cycles: string[][] = [];
  const allFiles = index.getAllFiles();
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(filePath: string, path: string[]): void {
    if (recursionStack.has(filePath)) {
      // Found a cycle - extract it
      const cycleStart = path.indexOf(filePath);
      if (cycleStart !== -1) {
        const cycle = path.slice(cycleStart);
        cycle.push(filePath);
        cycles.push(cycle);
      }
      return;
    }

    if (visited.has(filePath)) {
      return;
    }

    visited.add(filePath);
    recursionStack.add(filePath);

    const fileIndex = index.getFileIndex(filePath);
    if (fileIndex) {
      for (const [, exportInfo] of fileIndex.exports) {
        if (exportInfo.isReExport && exportInfo.originalModule) {
          const targetFile = findMatchingFile(exportInfo.originalModule, filePath, index);
          if (targetFile) {
            dfs(targetFile, [...path, filePath]);
          }
        }
      }
    }

    recursionStack.delete(filePath);
  }

  for (const file of allFiles) {
    dfs(file, []);
  }

  return cycles;
}

/**
 * Get the full re-export chain for debugging
 */
export function buildExportChain(
  symbolName: string,
  startFile: string,
  index: ProjectIndex
): string[] {
  const result = resolveReExportChain(symbolName, startFile, index);
  return result ? [startFile, ...result.chain, result.originalFile] : [];
}
