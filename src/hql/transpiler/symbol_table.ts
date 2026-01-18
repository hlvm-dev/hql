// src/hql/transpiler/symbol_table.ts
// Enhanced Symbol Table for HQL Transpiler with more comprehensive tracking

import type { HQLNode } from "./type/hql_ast.ts";
import type { IRNode } from "./type/hql_ir.ts";
import { globalLogger as logger } from "../../logger.ts";

// Comprehensive SymbolKind for all HQL constructs
export type SymbolKind =
  | "variable"
  | "function"
  | "macro"
  | "fn"
  | "type"
  | "enum"
  | "enum-case"
  | "class"
  | "method"
  | "interface"
  | "module"
  | "import"
  | "export"
  | "namespace"
  | "operator"
  | "constant"
  | "property"
  | "special-form"
  | "builtin"
  | "alias";

// Enhanced scope types
export type SymbolScope =
  | "global"
  | "local"
  | "parameter"
  | "module"
  | "class"
  | "namespace"
  | "function"
  | "block";

// Enhanced symbol info with more comprehensive tracking
export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  type?: string; // e.g., 'Set', 'Array', 'Function', 'Color', etc.
  scope: SymbolScope;
  parent?: string; // e.g., enclosing class, enum, module
  params?: { name: string; type?: string }[];
  returnType?: string;
  cases?: string[]; // for enums
  associatedValues?: { name: string; type?: string }[]; // for enum-cases
  fields?: { name: string; type?: string }[]; // for class
  methods?: {
    name: string;
    params?: { name: string; type?: string }[];
    returnType?: string;
  }[];
  sourceModule?: string; // for import/export
  aliasOf?: string; // for aliases
  isExported?: boolean;
  isImported?: boolean;
  definition?: HQLNode | IRNode; // Reference to AST/IR node that defines this symbol
  references?: (HQLNode | IRNode)[]; // References to all usages of this symbol
  location?: { filePath: string; line: number; column: number }; // Source location
  documentation?: string; // Optional documentation comment
  attributes?: Record<string, unknown>; // Additional attributes (e.g., mutability, visibility)
  meta?: Record<string, unknown>; // extensible for future use
}

export class SymbolTable {
  private table: Map<string, SymbolInfo> = new Map();
  private parent: SymbolTable | null;
  private scopeName: string; // Track current scope name for better debugging
  private maxSize: number; // Limit to prevent unbounded growth in long-running processes

  constructor(parent: SymbolTable | null = null, scopeName: string = "global", maxSize: number = 50000) {
    this.parent = parent;
    this.scopeName = scopeName;
    this.maxSize = maxSize;
  }

  /**
   * Register a symbol in the current scope
   */
  set(symbol: SymbolInfo) {
    logger.debug(
      `Symbol table (${this.scopeName}): setting ${symbol.name} as ${symbol.kind}${
        symbol.type ? " (" + symbol.type + ")" : ""
      }`,
    );

    // Bound memory: evict oldest entries when limit exceeded
    // This is a simple FIFO eviction (Map maintains insertion order)
    if (this.table.size >= this.maxSize && !this.table.has(symbol.name)) {
      const firstKey = this.table.keys().next().value;
      if (firstKey !== undefined) {
        this.table.delete(firstKey);
      }
    }

    this.table.set(symbol.name, symbol);
    return symbol; // Return for chaining
  }

  /**
   * Get a symbol from current scope or parent scopes
   * Uses single get() instead of has()+get() to avoid double lookup
   */
  get(name: string): SymbolInfo | undefined {
    const local = this.table.get(name);
    if (local !== undefined) return local;
    if (this.parent) return this.parent.get(name);
    return undefined;
  }

  /**
   * Check if a symbol exists in current or any parent scope
   */
  /**
   * Check if a symbol exists in current or any parent scope
   * Optimized: Uses direct has() calls instead of get() to avoid retrieving symbol info
   */
  has(name: string): boolean {
    if (this.table.has(name)) return true;
    if (this.parent) return this.parent.has(name);
    return false;
  }

  /**
   * Check if a symbol exists directly in the current scope
   */
  hasInCurrentScope(name: string): boolean {
    return this.table.has(name);
  }

  /**
   * Update properties of an existing symbol
   * Uses single get() instead of has()+get() to avoid double lookup
   */
  update(name: string, updates: Partial<SymbolInfo>): boolean {
    const current = this.table.get(name);
    if (current !== undefined) {
      this.table.set(name, { ...current, ...updates });
      return true;
    }

    // Try to update in parent scope if not found here
    if (this.parent) {
      return this.parent.update(name, updates);
    }

    return false; // Symbol not found anywhere
  }

  /**
   * Create a new child scope
   */
  createChildScope(scopeName: string): SymbolTable {
    return new SymbolTable(this, scopeName);
  }

  /**
   * Get all symbols in this scope and all parent scopes
   * Uses iterative approach to avoid O(D²) copying from recursive spread
   */
  getAllSymbols(): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];

    // Add symbols from current scope first
    for (const symbol of this.table.values()) {
      symbols.push(symbol);
    }

    // Walk up the parent chain iteratively
    let current = this.parent;
    while (current !== null) {
      for (const symbol of current.table.values()) {
        symbols.push(symbol);
      }
      current = current.parent;
    }

    return symbols;
  }

  /**
   * Clear the current scope only
   */
  clear() {
    this.table.clear();
  }

  /**
   * Delete a symbol from the table
   */
  delete(name: string): boolean {
    return this.table.delete(name);
  }

  /**
   * For debugging - dump symbol table contents
   */
  dump(): Record<string, SymbolInfo> {
    return Object.fromEntries(this.table.entries());
  }
}

/**
 * Global symbol table instance for backwards compatibility.
 *
 * For parallel compilation or LSP scenarios, use getSymbolTable(context)
 * from compiler-context.ts instead, which returns an isolated table
 * when context.symbolTable is provided.
 *
 * @see getSymbolTable - Use this instead for new code
 */
export const globalSymbolTable = new SymbolTable(null, "global");
