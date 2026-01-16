/**
 * HQL Import Utilities Module
 *
 * Provides shared utilities for working with HQL import statements:
 * - Parsing import statements
 * - Tracking symbol usage
 * - Editing import statements
 * - Resolving exports and re-exports
 */

// Types
export type {
  LSPRange,
  ParsedImport,
  ParsedImportSymbol,
  UnusedImport,
  ResolvedExport,
} from "./types.ts";

// Import Parser
export {
  findAllImports,
  findImportByPath,
  findInsertPosition,
} from "./import-parser.ts";

// Symbol Usage Analyzer
export {
  analyzeUnusedImports,
  findUnusedImports,
} from "./symbol-usage.ts";

// Import Editor
export {
  getRemoveUnusedImportAction,
  getRemoveAllUnusedAction,
  addSymbolToImport,
  createNewImport,
  calculateRelativePath,
} from "./import-editor.ts";

// Export Resolver (Re-export handling)
export {
  isReExportedSymbol,
  resolveReExportChain,
  detectCircularReExports,
} from "./export-resolver.ts";
