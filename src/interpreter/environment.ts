// src/interpreter/environment.ts - Scope management for the HQL interpreter

import type { HQLValue } from "./types.ts";
import { UndefinedSymbolError } from "./errors.ts";

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
   */
  lookup(name: string): HQLValue {
    // Check current scope first
    if (this.bindings.has(name)) {
      return this.bindings.get(name)!;
    }

    // Try hyphen-to-underscore conversion (for kebab-case compatibility)
    const underscoreName = name.replace(/-/g, "_");
    if (underscoreName !== name && this.bindings.has(underscoreName)) {
      return this.bindings.get(underscoreName)!;
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
  tryLookup(name: string): HQLValue | undefined {
    try {
      return this.lookup(name);
    } catch {
      return undefined;
    }
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
  isDefined(name: string): boolean {
    if (this.bindings.has(name)) {
      return true;
    }

    // Try hyphen-to-underscore conversion
    const underscoreName = name.replace(/-/g, "_");
    if (underscoreName !== name && this.bindings.has(underscoreName)) {
      return true;
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
    let depth = 0;
    // deno-lint-ignore no-this-alias
    let env: InterpreterEnv | null = this;
    while (env) {
      depth++;
      env = env.parent;
    }
    return depth;
  }
}
