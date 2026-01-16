/**
 * ImportStatementParser - Parse and extract information from HQL import statements
 *
 * HQL import syntax:
 *   Named: (import [a b c] from "./module.hql")
 *   Namespace: (import name from "./module.hql")
 *   Aliased: (import [add as sum] from "./module.hql")
 *
 * This module now uses AST-based parsing for correct multiline handling.
 */

import type { ParsedImport } from "./types.ts";
import { findAllImportsViaAST } from "./ast-import-adapter.ts";

/**
 * Find all import statements in HQL code
 *
 * Uses AST-based parsing for correct multiline support.
 */
export function findAllImports(text: string): ParsedImport[] {
  return findAllImportsViaAST(text);
}

/**
 * Find an import statement by module path
 */
export function findImportByPath(
  text: string,
  modulePath: string
): ParsedImport | null {
  const imports = findAllImports(text);
  return imports.find((imp) => imp.modulePath === modulePath) ?? null;
}

/**
 * Find the best position to insert a new import statement
 * Returns line number (0-indexed)
 *
 * Note: This uses simple text scanning since it doesn't need
 * full parsing - it just looks for import patterns at line starts.
 */
export function findInsertPosition(text: string): number {
  const lines = text.split("\n");
  let lastImportLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines and comments at the top
    if (!line || line.startsWith(";")) {
      continue;
    }

    // Check if line starts an import (handles multiline)
    if (line.startsWith("(import ")) {
      lastImportLine = i + 1; // Insert after this import
    } else {
      break;
    }
  }

  return lastImportLine;
}
