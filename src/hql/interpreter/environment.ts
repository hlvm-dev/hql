// src/hql/interpreter/environment.ts - Scope management for the HQL interpreter

import type { HQLValue } from "./types.ts";
import { UndefinedSymbolError } from "./errors.ts";
import { hyphenToUnderscore } from "../../common/utils.ts";

/**
 * InterpreterEnv - Manages variable bindings with lexical scoping
 *
 * Each environment has:
 * - A map of name -> value bindings
 * - An optional parent pointer for scope chain
 *
 * Lookup traverses the scope chain until a binding is found.
 * Define always creates/updates in the current scope.
 */
export class InterpreterEnv {
  private bindings: Map<string, HQLValue>;
  private parent: InterpreterEnv | null;

  constructor(parent: InterpreterEnv | null = null) {
    this.bindings = new Map();
    this.parent = parent;
  }

  /**
   * Look up a symbol in the scope chain
   * Throws UndefinedSymbolError if not found
   * Uses single get() instead of has()+get() to avoid double lookup
   */
  /**
   * Look up a symbol in the scope chain
   * Throws UndefinedSymbolError if not found
   * Optimized: Only attempts hyphen-to-underscore conversion if name contains hyphen
   */
  lookup(name: string): HQLValue {
    // Check current scope first - single lookup
    const value = this.bindings.get(name);
    if (value !== undefined) {
      return value;
    }

    // Try hyphen-to-underscore conversion (for kebab-case compatibility)
    // Only perform conversion if the name contains a hyphen (avoid unnecessary work)
    if (name.includes('-')) {
      const underscoreName = hyphenToUnderscore(name);
      const underscoreValue = this.bindings.get(underscoreName);
      if (underscoreValue !== undefined) {
        return underscoreValue;
      }
    }

    // Traverse parent chain
    if (this.parent) {
      return this.parent.lookup(name);
    }

    throw new UndefinedSymbolError(name);
  }

  /**
   * Try to look up a symbol, returning undefined if not found
   * (No exception thrown)
   */
  /**
   * Try to look up a symbol, returning undefined if not found
   * (No exception thrown)
   * Optimized: Uses iterative traversal instead of try/catch
   */
  tryLookup(name: string): HQLValue | undefined {
    // Check current scope first - single lookup
    const value = this.bindings.get(name);
    if (value !== undefined) {
      return value;
    }

    // Try hyphen-to-underscore conversion (for kebab-case compatibility)
    // Only perform conversion if the name contains a hyphen (avoid unnecessary work)
    if (name.includes('-')) {
      const underscoreName = hyphenToUnderscore(name);
      const underscoreValue = this.bindings.get(underscoreName);
      if (underscoreValue !== undefined) {
        return underscoreValue;
      }
    }

    // Traverse parent chain iteratively
    if (this.parent) {
      return this.parent.tryLookup(name);
    }

    return undefined;
  }

  /**
   * Define a binding in the current scope
   * If the name already exists in current scope, it is overwritten
   */
  define(name: string, value: HQLValue): void {
    this.bindings.set(name, value);
  }

  /**
   * Check if a symbol is defined anywhere in the scope chain
   */
  /**
   * Check if a symbol is defined anywhere in the scope chain
   * Optimized: Only attempts hyphen-to-underscore conversion if name contains hyphen
   */
  isDefined(name: string): boolean {
    if (this.bindings.has(name)) {
      return true;
    }

    // Try hyphen-to-underscore conversion only if name contains hyphen
    if (name.includes('-')) {
      const underscoreName = hyphenToUnderscore(name);
      if (this.bindings.has(underscoreName)) {
        return true;
      }
    }

    return this.parent?.isDefined(name) ?? false;
  }

  /**
   * Create a child environment with this environment as parent
   * Used for: function calls, let bindings, etc.
   */
  extend(): InterpreterEnv {
    return new InterpreterEnv(this);
  }

  /**
   * Get all bindings in current scope (for debugging)
   */
  getBindings(): Map<string, HQLValue> {
    return new Map(this.bindings);
  }

  /**
   * Get the parent environment (for debugging)
   */
  getParent(): InterpreterEnv | null {
    return this.parent;
  }

  /**
   * Get depth of scope chain (for debugging/limits)
   */
  getDepth(): number {
    let depth = 1; // Count this environment
    let env = this.parent;
    while (env) {
      depth++;
      env = env.parent;
    }
    return depth;
  }
}
