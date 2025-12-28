/**
 * ImportStatementEditor - Generate text edits for modifying import statements
 *
 * Handles:
 * - Adding symbols to existing imports
 * - Removing symbols from imports
 * - Deleting entire import statements
 * - Creating new import statements
 */

import {
  CodeAction,
  CodeActionKind,
  TextEdit,
} from "npm:vscode-languageserver@9.0.1";
import type { TextDocument } from "npm:vscode-languageserver-textdocument@1.0.11";
import type { UnusedImport, ParsedImport, LSPRange } from "./types.ts";
import { findAllImports, findImportByPath } from "./import-parser.ts";
import * as path from "node:path";

/**
 * Create a code action to remove an unused import symbol
 */
export function getRemoveUnusedImportAction(
  doc: TextDocument,
  unused: UnusedImport
): CodeAction | null {
  const text = doc.getText();
  const lines = text.split("\n");
  const importLine = lines[unused.importLine];

  if (!importLine) return null;

  // Find the import statement
  const imports = findAllImports(text);
  const targetImport = imports.find((imp) => imp.line === unused.importLine);

  if (!targetImport) return null;

  let edit: TextEdit;

  if (unused.isNamespace) {
    // Remove entire namespace import
    edit = deleteEntireImport(doc, targetImport);
  } else if (targetImport.symbols.length === 1) {
    // Last symbol - remove entire import
    edit = deleteEntireImport(doc, targetImport);
  } else {
    // Remove just this symbol from the list
    edit = removeSymbolFromImport(doc, targetImport, unused.symbolName);
  }

  return {
    title: `Remove unused import '${unused.symbolName}'`,
    kind: CodeActionKind.QuickFix,
    edit: {
      changes: {
        [doc.uri]: [edit],
      },
    },
  };
}

/**
 * Create a code action to remove all unused imports
 */
export function getRemoveAllUnusedAction(
  doc: TextDocument,
  allUnused: UnusedImport[]
): CodeAction | null {
  if (allUnused.length === 0) return null;

  const text = doc.getText();
  const imports = findAllImports(text);
  const edits: TextEdit[] = [];

  // Group unused by import line
  const unusedByLine = new Map<number, UnusedImport[]>();
  for (const unused of allUnused) {
    const existing = unusedByLine.get(unused.importLine) ?? [];
    existing.push(unused);
    unusedByLine.set(unused.importLine, existing);
  }

  // Process each import line
  for (const [lineNum, unusedList] of unusedByLine) {
    const targetImport = imports.find((imp) => imp.line === lineNum);
    if (!targetImport) continue;

    // Check if all symbols in this import are unused
    const allSymbolsUnused = targetImport.symbols.every((sym) =>
      unusedList.some(
        (u) => u.symbolName === sym.name || u.symbolName === sym.alias
      )
    );

    if (allSymbolsUnused || targetImport.isNamespace) {
      // Remove entire import
      edits.push(deleteEntireImport(doc, targetImport));
    } else {
      // Remove individual symbols
      for (const unused of unusedList) {
        edits.push(removeSymbolFromImport(doc, targetImport, unused.symbolName));
      }
    }
  }

  // Deduplicate and sort edits (process from bottom to top to preserve line numbers)
  const uniqueEdits = deduplicateEdits(edits);
  uniqueEdits.sort((a, b) => b.range.start.line - a.range.start.line);

  return {
    title: "Remove all unused imports",
    kind: CodeActionKind.QuickFix,
    edit: {
      changes: {
        [doc.uri]: uniqueEdits,
      },
    },
  };
}

/**
 * Delete an entire import statement
 */
export function deleteEntireImport(
  doc: TextDocument,
  imp: ParsedImport
): TextEdit {
  const text = doc.getText();
  const lines = text.split("\n");

  // Include the newline after the import
  const endLine = imp.line + 1;
  const endChar = endLine < lines.length ? 0 : lines[imp.line].length;

  return {
    range: {
      start: { line: imp.line, character: 0 },
      end: { line: Math.min(endLine, lines.length - 1), character: endChar },
    },
    newText: "",
  };
}

/**
 * Remove a single symbol from an import statement
 */
export function removeSymbolFromImport(
  doc: TextDocument,
  imp: ParsedImport,
  symbolName: string
): TextEdit {
  const text = doc.getText();
  const lines = text.split("\n");
  const line = lines[imp.line];

  if (!line) {
    return {
      range: imp.range,
      newText: "",
    };
  }

  // Find bracket positions
  const bracketStart = line.indexOf("[");
  const bracketEnd = line.indexOf("]");

  if (bracketStart === -1 || bracketEnd === -1) {
    // Shouldn't happen for named imports, but handle gracefully
    return {
      range: imp.range,
      newText: "",
    };
  }

  // Get the symbols part
  const symbolsPart = line.substring(bracketStart + 1, bracketEnd);

  // Build new symbols list without the removed symbol
  const symbols: string[] = [];
  const tokens = symbolsPart.split(/[\s,]+/).filter((s) => s.length > 0);

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    // Handle alias: "name as alias"
    if (tokens[i + 1] === "as" && tokens[i + 2]) {
      const alias = tokens[i + 2];
      // Skip if this is the symbol we're removing (check both name and alias)
      if (token !== symbolName && alias !== symbolName) {
        symbols.push(`${token} as ${alias}`);
      }
      i += 3;
    } else if (token !== "as") {
      // Regular symbol
      if (token !== symbolName) {
        symbols.push(token);
      }
      i++;
    } else {
      i++;
    }
  }

  // Reconstruct the import statement
  const prefix = line.substring(0, bracketStart + 1);
  const suffix = line.substring(bracketEnd);
  const newLine = `${prefix}${symbols.join(" ")}${suffix}`;

  return {
    range: {
      start: { line: imp.line, character: 0 },
      end: { line: imp.line, character: line.length },
    },
    newText: newLine,
  };
}

/**
 * Add a symbol to an existing import statement
 */
export function addSymbolToImport(
  doc: TextDocument,
  imp: ParsedImport,
  symbolName: string
): TextEdit {
  const text = doc.getText();
  const lines = text.split("\n");
  const line = lines[imp.line];

  if (!line || imp.isNamespace) {
    // Can't add to namespace import
    return {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      newText: "",
    };
  }

  const bracketEnd = line.indexOf("]");
  if (bracketEnd === -1) {
    return {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      newText: "",
    };
  }

  // Insert the new symbol before the closing bracket
  const newLine =
    line.substring(0, bracketEnd) + " " + symbolName + line.substring(bracketEnd);

  return {
    range: {
      start: { line: imp.line, character: 0 },
      end: { line: imp.line, character: line.length },
    },
    newText: newLine,
  };
}

/**
 * Create a new import statement
 */
export function createNewImport(symbols: string[], modulePath: string): string {
  if (symbols.length === 0) return "";
  return `(import [${symbols.join(" ")}] from "${modulePath}")\n`;
}

/**
 * Create a namespace import statement
 */
export function createNamespaceImport(
  namespaceName: string,
  modulePath: string
): string {
  return `(import ${namespaceName} from "${modulePath}")\n`;
}

/**
 * Calculate relative path from one file to another
 */
export function calculateRelativePath(
  fromFile: string,
  toFile: string
): string {
  const fromDir = path.dirname(fromFile);
  let relativePath = path.relative(fromDir, toFile);

  // Ensure path starts with ./ or ../
  if (!relativePath.startsWith(".") && !relativePath.startsWith("/")) {
    relativePath = "./" + relativePath;
  }

  return relativePath;
}

/**
 * Deduplicate text edits by range
 */
function deduplicateEdits(edits: TextEdit[]): TextEdit[] {
  const seen = new Set<string>();
  const result: TextEdit[] = [];

  for (const edit of edits) {
    const key = `${edit.range.start.line}:${edit.range.start.character}-${edit.range.end.line}:${edit.range.end.character}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(edit);
    }
  }

  return result;
}
