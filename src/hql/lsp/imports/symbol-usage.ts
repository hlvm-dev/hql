/**
 * SymbolUsageAnalyzer - Track symbol usages to detect unused imports
 *
 * Detects:
 * - Symbols that are imported but never used
 * - Symbols that are only used in the import statement
 * - Symbols that are re-exported (counts as usage)
 */

import type { UnusedImport, ParsedImport } from "./types.ts";
import { findAllImports } from "./import-parser.ts";

/**
 * Analyze a document for unused imports
 *
 * Convenience function that parses imports and finds unused ones.
 */
export function analyzeUnusedImports(
  text: string,
  _filePath: string
): UnusedImport[] {
  const imports = findAllImports(text);
  return findUnusedImports(text, imports);
}

/**
 * Check if a symbol is used in the document (excluding import/export lines)
 *
 * For multiline imports, importStartLine and importEndLine define the range to skip.
 * Accepts pre-split lines to avoid repeated text.split() calls (optimization).
 */
function isSymbolUsed(
  lines: string[],
  symbolName: string,
  importStartLine: number,
  importEndLine: number
): boolean {
  // Check for re-export (symbol is exported)
  if (isSymbolReExported(lines, symbolName)) {
    return true;
  }

  // Check for property access on namespace (e.g., math.add)
  if (isNamespacePropertyAccessed(lines, symbolName, importStartLine, importEndLine)) {
    return true;
  }

  // Pre-compile pattern once for use in loop (optimization: compile once, not per line)
  const symbolPattern = new RegExp(
    `(?<![a-zA-Z0-9_\\-?!])${escapeRegex(symbolName)}(?![a-zA-Z0-9_\\-?!])`,
    "g"
  );

  // Look for usages on other lines
  for (let i = 0; i < lines.length; i++) {
    // Skip all lines within the import statement range
    if (i >= importStartLine && i <= importEndLine) continue;

    const line = lines[i];

    // Skip export lines - re-exports are handled above
    if (line.trim().startsWith("(export ")) continue;

    // Check if symbol is used on this line (not in string or comment)
    if (isSymbolOnLine(line, symbolName, symbolPattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if symbol is re-exported
 * Accepts pre-split lines to avoid repeated text.split() calls (optimization).
 */
function isSymbolReExported(lines: string[], symbolName: string): boolean {
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
 * Accepts pre-split lines to avoid repeated text.split() calls (optimization).
 */
function isNamespacePropertyAccessed(
  lines: string[],
  namespaceName: string,
  importStartLine: number,
  importEndLine: number
): boolean {
  // Hoist RegExp outside loop (optimization: compile once, not per line)
  const pattern = new RegExp(
    `(?<![a-zA-Z0-9_\\-?!])${escapeRegex(namespaceName)}\\.`,
    "g"
  );

  for (let i = 0; i < lines.length; i++) {
    // Skip all lines within the import statement range
    if (i >= importStartLine && i <= importEndLine) continue;

    const line = lines[i];
    // Reset lastIndex for reuse of global regex
    pattern.lastIndex = 0;

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
 * Accepts optional pre-compiled pattern for performance when called in loops
 */
function isSymbolOnLine(
  line: string,
  symbolName: string,
  precompiledPattern?: RegExp
): boolean {
  // Skip comment lines
  const trimmed = line.trim();
  if (trimmed.startsWith(";")) return false;

  // Use pre-compiled pattern if provided, otherwise create one
  const pattern = precompiledPattern ?? new RegExp(
    `(?<![a-zA-Z0-9_\\-?!])${escapeRegex(symbolName)}(?![a-zA-Z0-9_\\-?!])`,
    "g"
  );

  // Reset lastIndex for reuse of global regex
  pattern.lastIndex = 0;

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
 * Find unused symbols from a list of parsed imports
 */
export function findUnusedImports(
  text: string,
  imports: ParsedImport[]
): UnusedImport[] {
  const unusedImports: UnusedImport[] = [];

  // Split text once and reuse (optimization: 3S splits → 1 split)
  const lines = text.split("\n");

  for (const imp of imports) {
    // For multiline imports, we need to skip all lines in the import range
    const importStartLine = imp.range.start.line;
    const importEndLine = imp.range.end.line;

    for (const sym of imp.symbols) {
      const localName = sym.alias ?? sym.name;

      if (!isSymbolUsed(lines, localName, importStartLine, importEndLine)) {
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
