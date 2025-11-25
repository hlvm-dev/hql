// compiler-context.ts - Dependency injection context for HQL compiler
// This allows runtime to inject state while keeping compiler pure

import type { Environment } from "../environment.ts";
import type { SExp } from "../s-exp/types.ts";
import type { MacroFn } from "../environment.ts";

/**
 * Macro definition stored in runtime
 * Contains all information needed to reconstruct a macro
 */
export interface MacroDefinition {
  name: string;
  params: string[];
  restParam?: string | null;
  body: SExp;
  source?: string; // Original source for debugging
  definedAt?: string; // File/location where defined
}

/**
 * Runtime macro storage that can be injected into compiler
 */
export interface MacroRegistry {
  // Macro definitions by name
  macros: Map<string, MacroDefinition>;

  // Macro functions compiled from definitions
  // These are what the compiler actually uses
  functions?: Map<string, MacroFn>;
}

/**
 * Compiler options that can be overridden at runtime
 */
export interface CompilerOptions {
  verbose?: boolean;
  showTiming?: boolean;
  useCache?: boolean;
  maxExpandDepth?: number;
  iterationLimit?: number;
}

/**
 * Context that can be injected into the compiler
 * All fields are optional - compiler uses defaults if not provided
 * This keeps the compiler pure while allowing runtime customization
 */
export interface CompilerContext {
  /**
   * Macro registry from runtime
   * If provided, these macros will be available during compilation
   */
  macroRegistry?: MacroRegistry;

  /**
   * Optional environment overrides
   * Allows runtime to provide pre-configured environment
   */
  environment?: Environment;

  /**
   * Compiler options
   */
  options?: CompilerOptions;

  /**
   * Current file being processed (for error reporting)
   */
  currentFile?: string;

  /**
   * Base directory for imports
   */
  baseDir?: string;

  /**
   * For future expansion - additional runtime features
   */
  extensions?: Record<string, unknown>;
}

/**
 * Result from compiler with optional metadata
 */
/**
 * Type guard to check if context has macro registry
 */
export function hasMacroRegistry(
  context: CompilerContext | undefined,
): boolean {
  return context?.macroRegistry !== undefined &&
    context.macroRegistry.macros.size > 0;
}
