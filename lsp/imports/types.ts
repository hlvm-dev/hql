/**
 * Shared types for HQL import handling utilities
 */

/**
 * Range in an HQL document (0-indexed, matching LSP)
 */
export interface LSPRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

/**
 * Represents a parsed import statement from an HQL document
 */
export interface ParsedImport {
  /** Full range of the import statement */
  range: LSPRange;
  /** Range of the [symbols] vector, if named import */
  symbolsRange?: LSPRange;
  /** Range of the module path string */
  pathRange: LSPRange;
  /** The module path (e.g., "./math.hql", "npm:lodash") */
  modulePath: string;
  /** Whether this is a namespace import (import x from "...") */
  isNamespace: boolean;
  /** Namespace name if isNamespace is true */
  namespaceName?: string;
  /** Individual imported symbols with their ranges */
  symbols: ParsedImportSymbol[];
  /** Line number (0-indexed) where the import starts */
  line: number;
}

/**
 * A single symbol within an import statement
 */
export interface ParsedImportSymbol {
  /** The symbol name */
  name: string;
  /** Alias if renamed (e.g., "add as sum" -> alias is "sum") */
  alias?: string;
  /** Range of this symbol in the document */
  range: LSPRange;
}

/**
 * Information about an unused import
 */
export interface UnusedImport {
  /** The symbol name that is unused */
  symbolName: string;
  /** Original name if aliased */
  originalName?: string;
  /** Whether this is a namespace import */
  isNamespace: boolean;
  /** Range of the symbol in the import statement */
  range: LSPRange;
  /** Line number of the import statement */
  importLine: number;
  /** The module path */
  modulePath: string;
}

/**
 * Result of resolving a re-export chain
 */
export interface ResolvedExport {
  /** The symbol name */
  symbolName: string;
  /** Original name if renamed during re-export */
  originalName?: string;
  /** Absolute path to the file where originally defined */
  originalFile: string;
  /** Chain of files through which symbol was re-exported */
  chain: string[];
  /** Whether this is a re-export (vs direct export) */
  isReExport: boolean;
}

/**
 * Suggestion for auto-importing a symbol
 */
export interface ImportSuggestion {
  /** The symbol to import */
  symbolName: string;
  /** Path to use in the import statement */
  modulePath: string;
  /** Absolute file path */
  absolutePath: string;
  /** Kind of symbol (function, class, etc.) */
  kind: string;
  /** Whether to prefer this source over others */
  isPreferred: boolean;
  /** Ranking score (higher = better) */
  score: number;
}
