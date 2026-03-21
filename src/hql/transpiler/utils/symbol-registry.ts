// src/hql/transpiler/utils/symbol-registry.ts
// =============================================================================
// SYMBOL REGISTRATION UTILITIES
// =============================================================================
// Reusable helpers for registering symbols in the global symbol table.

import { globalSymbolTable } from "../symbol_table.ts";
import { canonicalizeModuleId } from "./module-identity.ts";

/**
 * Register a builtin function/special form in the global symbol table.
 *
 * @param name - The builtin name (e.g., "if", "+", "cons")
 * @param type - Optional type annotation (default: "Function")
 */
function registerBuiltin(
  name: string,
  type: string = "Function",
): void {
  globalSymbolTable.set({
    name,
    kind: "builtin",
    scope: "global",
    type,
  });
}

/**
 * Register multiple builtins at once.
 *
 * @param names - Array of builtin names
 * @param type - Optional type annotation (default: "Function")
 */
export function registerBuiltins(
  names: string[],
  type: string = "Function",
): void {
  for (const name of names) {
    registerBuiltin(name, type);
  }
}

/**
 * Register a macro in the global symbol table.
 *
 * @param name - The macro name
 * @param sourceFile - File where the macro is defined
 * @param _isSystem - Unused (kept for caller compatibility)
 * @param isExported - Whether the macro is exported (default: false)
 */
export function registerMacro(
  name: string,
  sourceFile: string,
  _isSystem: boolean = false,
  isExported: boolean = false,
): void {
  globalSymbolTable.set({
    name,
    kind: "macro",
    scope: "global",
    isExported,
    sourceModule: canonicalizeModuleId(sourceFile, sourceFile),
  });
}
