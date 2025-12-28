/**
 * SymbolUsageAnalyzer - Track symbol usages to detect unused imports
 *
 * Detects:
 * - Symbols that are imported but never used
 * - Symbols that are only used in the import statement
 * - Symbols that are re-exported (counts as usage)
 */

import type { UnusedImport, LSPRange, ParsedImport } from "./types.ts";
import { findAllImports } from "./import-parser.ts";

/**
 * Analyze a document for unused imports
 */
export function analyzeUnusedImports(
  text: string,
  _filePath: string
): UnusedImport[] {
  const imports = findAllImports(text);
  const unusedImports: UnusedImport[] = [];

  for (const imp of imports) {
    for (const sym of imp.symbols) {
      const localName = sym.alias ?? sym.name;

      // Check if symbol is used outside of import/export statements
      if (!isSymbolUsed(text, localName, imp.line)) {
        unusedImports.push({
          symbolName: localName,
          originalName: sym.alias ? sym.name : undefined,
          isNamespace: imp.isNamespace,
          range: sym.range,
          importLine: imp.line,
          modulePath: imp.modulePath,
        });
      }
    }
  }

  return unusedImports;
}

/**
 * Check if a symbol is used in the document (excluding import/export lines)
 */
export function isSymbolUsed(
  text: string,
  symbolName: string,
  importLine: number
): boolean {
  const lines = text.split("\n");

  // Check for re-export (symbol is exported)
  if (isSymbolReExported(text, symbolName)) {
    return true;
  }

  // Check for property access on namespace (e.g., math.add)
  if (isNamespacePropertyAccessed(text, symbolName, importLine)) {
    return true;
  }

  // Look for usages on other lines
  for (let i = 0; i < lines.length; i++) {
    if (i === importLine) continue; // Skip the import line

    const line = lines[i];

    // Skip export lines - re-exports are handled above
    if (line.trim().startsWith("(export ")) continue;

    // Check if symbol is used on this line (not in string or comment)
    if (isSymbolOnLine(line, symbolName)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if symbol is re-exported
 */
function isSymbolReExported(text: string, symbolName: string): boolean {
  const lines = text.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("(export ")) continue;

    // Check for: (export [... symbolName ...])
    if (trimmed.includes("[")) {
      const bracketStart = trimmed.indexOf("[");
      const bracketEnd = trimmed.indexOf("]");
      if (bracketStart !== -1 && bracketEnd !== -1) {
        const exports = trimmed.substring(bracketStart + 1, bracketEnd);
        const symbols = exports.split(/[\s,]+/).filter((s) => s.length > 0);
        if (symbols.includes(symbolName)) {
          return true;
        }
      }
    }

    // Check for: (export symbolName)
    const singleExportMatch = trimmed.match(/^\(export\s+(\w+)\)$/);
    if (singleExportMatch && singleExportMatch[1] === symbolName) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a namespace is accessed via property (e.g., math.add)
 */
function isNamespacePropertyAccessed(
  text: string,
  namespaceName: string,
  importLine: number
): boolean {
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (i === importLine) continue;

    const line = lines[i];
    // Check for pattern: namespaceName.something
    const pattern = new RegExp(
      `(?<![a-zA-Z0-9_\\-?!])${escapeRegex(namespaceName)}\\.`,
      "g"
    );

    // Make sure it's not in a string or comment
    let match;
    while ((match = pattern.exec(line)) !== null) {
      if (!isPositionInStringOrComment(line, match.index)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a symbol appears on a line (not in string or comment)
 */
function isSymbolOnLine(line: string, symbolName: string): boolean {
  // Skip comment lines
  const trimmed = line.trim();
  if (trimmed.startsWith(";")) return false;

  // Build regex for whole-word match
  const pattern = new RegExp(
    `(?<![a-zA-Z0-9_\\-?!])${escapeRegex(symbolName)}(?![a-zA-Z0-9_\\-?!])`,
    "g"
  );

  let match;
  while ((match = pattern.exec(line)) !== null) {
    if (!isPositionInStringOrComment(line, match.index)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a position in a line is inside a string or comment
 */
function isPositionInStringOrComment(line: string, position: number): boolean {
  // Check if position is after a semicolon (comment)
  const semicolonIdx = line.indexOf(";");
  if (semicolonIdx !== -1 && position > semicolonIdx) {
    return true;
  }

  // Check if position is inside a string
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < position; i++) {
    const char = line[i];
    const prevChar = i > 0 ? line[i - 1] : "";

    if (!inString && (char === '"' || char === "'")) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && prevChar !== "\\") {
      inString = false;
    }
  }

  return inString;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find all locations where a symbol is used
 */
export function findAllUsages(text: string, symbolName: string): LSPRange[] {
  const usages: LSPRange[] = [];
  const lines = text.split("\n");
  const pattern = new RegExp(
    `(?<![a-zA-Z0-9_\\-?!])${escapeRegex(symbolName)}(?![a-zA-Z0-9_\\-?!])`,
    "g"
  );

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    let match;

    while ((match = pattern.exec(line)) !== null) {
      if (!isPositionInStringOrComment(line, match.index)) {
        usages.push({
          start: { line: lineIdx, character: match.index },
          end: { line: lineIdx, character: match.index + symbolName.length },
        });
      }
    }
  }

  return usages;
}

/**
 * Find unused symbols from a list of parsed imports
 */
export function findUnusedImports(
  text: string,
  imports: ParsedImport[]
): UnusedImport[] {
  const unusedImports: UnusedImport[] = [];

  for (const imp of imports) {
    for (const sym of imp.symbols) {
      const localName = sym.alias ?? sym.name;

      if (!isSymbolUsed(text, localName, imp.line)) {
        unusedImports.push({
          symbolName: localName,
          originalName: sym.alias ? sym.name : undefined,
          isNamespace: imp.isNamespace,
          range: sym.range,
          importLine: imp.line,
          modulePath: imp.modulePath,
        });
      }
    }
  }

  return unusedImports;
}
