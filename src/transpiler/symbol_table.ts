// core/src/transpiler/symbol_table.ts
// Enhanced Symbol Table for HQL Transpiler with more comprehensive tracking

import type { HQLNode } from "./type/hql_ast.ts";
import type { IRNode } from "./type/hql_ir.ts";
import { globalLogger as logger } from "../logger.ts";

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
  | "field"
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

  constructor(parent: SymbolTable | null = null, scopeName: string = "global") {
    this.parent = parent;
    this.scopeName = scopeName;
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
    this.table.set(symbol.name, symbol);
    return symbol; // Return for chaining
  }

  /**
   * Get a symbol from current scope or parent scopes
   */
  get(name: string): SymbolInfo | undefined {
    if (this.table.has(name)) return this.table.get(name);
    if (this.parent) return this.parent.get(name);
    return undefined;
  }

  /**
   * Check if a symbol exists in current or any parent scope
   */
  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  /**
   * Check if a symbol exists directly in the current scope
   */
  hasInCurrentScope(name: string): boolean {
    return this.table.has(name);
  }

  /**
   * Update properties of an existing symbol
   */
  update(name: string, updates: Partial<SymbolInfo>): boolean {
    if (this.table.has(name)) {
      const current = this.table.get(name)!;
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
   * Add a reference to a symbol
   */
  addReference(name: string, reference: HQLNode | IRNode): boolean {
    if (this.table.has(name)) {
      const info = this.table.get(name)!;
      if (!info.references) {
        info.references = [];
      }
      info.references.push(reference);
      return true;
    }

    if (this.parent) {
      return this.parent.addReference(name, reference);
    }

    return false;
  }

  /**
   * Create a new child scope
   */
  createChildScope(scopeName: string): SymbolTable {
    return new SymbolTable(this, scopeName);
  }

  /**
   * Get all symbols in the current scope only
   */
  getAllSymbolsInCurrentScope(): SymbolInfo[] {
    return Array.from(this.table.values());
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
   * Get all symbols of a specific kind
   */
  getSymbolsByKind(kind: SymbolKind): SymbolInfo[] {
    return this.getAllSymbols().filter((s) => s.kind === kind);
  }

  /**
   * Get all symbols in a specific scope
   */
  getSymbolsByScope(scope: SymbolScope): SymbolInfo[] {
    return this.getAllSymbols().filter((s) => s.scope === scope);
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

  /**
   * Method to check if a symbol is a specific type of collection
   */
  isCollection(name: string): boolean {
    const info = this.get(name);
    if (!info || !info.type) return false;

    return info.type === "Array" || info.type === "Set" || info.type === "Map";
  }

  /**
   * Method to get the specific collection type
   */
  getCollectionType(name: string): string | undefined {
    const info = this.get(name);
    if (!info) return undefined;
    return info.type;
  }

  /**
   * Get all symbols that are exported
   */
  getExportedSymbols(): SymbolInfo[] {
    return this.getAllSymbols().filter((s) => s.isExported);
  }

  /**
   * Get all symbols that are imported
   */
  getImportedSymbols(): SymbolInfo[] {
    return this.getAllSymbols().filter((s) => s.isImported);
  }

  /**
   * Find symbols by their source module
   */
  getSymbolsBySourceModule(modulePath: string): SymbolInfo[] {
    return this.getAllSymbols().filter((s) => s.sourceModule === modulePath);
  }

  /**
   * Get parent scope
   */
  getParentScope(): SymbolTable | null {
    return this.parent;
  }

  /**
   * Get scope name
   */
  getScopeName(): string {
    return this.scopeName;
  }
}

// Global symbol table instance for the whole transpiler
export const globalSymbolTable = new SymbolTable(null, "global");
