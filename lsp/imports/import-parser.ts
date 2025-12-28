/**
 * ImportStatementParser - Parse and extract information from HQL import statements
 *
 * HQL import syntax:
 *   Named: (import [a b c] from "./module.hql")
 *   Namespace: (import name from "./module.hql")
 *   Aliased: (import [add as sum] from "./module.hql")
 */

import type { ParsedImport, ParsedImportSymbol, LSPRange } from "./types.ts";

/**
 * Find all import statements in HQL code
 */
export function findAllImports(text: string): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const lines = text.split("\n");

  // Regex to match import statements
  // Matches: (import [...] from "...") or (import name from "...")
  const importRegex = /^\s*\(import\s+/;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (!importRegex.test(line)) continue;

    const parsed = parseImportLine(line, lineIdx);
    if (parsed) {
      imports.push(parsed);
    }
  }

  return imports;
}

/**
 * Parse a single import statement line
 */
function parseImportLine(line: string, lineIdx: number): ParsedImport | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("(import ")) return null;

  // Find the module path
  const fromMatch = trimmed.match(/from\s+"([^"]+)"/);
  if (!fromMatch) return null;

  const modulePath = fromMatch[1];
  const fromIndex = trimmed.indexOf("from");
  const pathStart = trimmed.indexOf('"', fromIndex) + 1;
  const pathEnd = trimmed.indexOf('"', pathStart);

  // Determine if named import or namespace import
  const afterImport = trimmed.substring(8).trim(); // After "(import "

  if (afterImport.startsWith("[")) {
    // Named import: (import [a b c] from "...")
    return parseNamedImport(line, lineIdx, modulePath, pathStart, pathEnd);
  } else {
    // Namespace import: (import name from "...")
    return parseNamespaceImport(line, lineIdx, modulePath, pathStart, pathEnd);
  }
}

/**
 * Parse a named import: (import [a b c] from "...")
 */
function parseNamedImport(
  line: string,
  lineIdx: number,
  modulePath: string,
  pathStart: number,
  pathEnd: number
): ParsedImport {
  const symbols: ParsedImportSymbol[] = [];

  // Find the symbol list [....]
  const bracketStart = line.indexOf("[");
  const bracketEnd = line.indexOf("]");

  if (bracketStart !== -1 && bracketEnd !== -1) {
    const symbolsStr = line.substring(bracketStart + 1, bracketEnd);

    // Split by whitespace or comma, handling aliases
    const symbolTokens = symbolsStr.split(/[\s,]+/).filter((s) => s.length > 0);

    let i = 0;
    let currentPos = bracketStart + 1;

    while (i < symbolTokens.length) {
      const token = symbolTokens[i];

      // Skip empty tokens
      if (!token) {
        i++;
        continue;
      }

      // Find position in line
      const tokenStart = line.indexOf(token, currentPos);
      const tokenEnd = tokenStart + token.length;

      // Check for alias: "name as alias"
      if (symbolTokens[i + 1] === "as" && symbolTokens[i + 2]) {
        const alias = symbolTokens[i + 2];
        const aliasEnd = line.indexOf(alias, tokenEnd) + alias.length;

        symbols.push({
          name: token,
          alias: alias,
          range: {
            start: { line: lineIdx, character: tokenStart },
            end: { line: lineIdx, character: aliasEnd },
          },
        });
        currentPos = aliasEnd;
        i += 3;
      } else if (token !== "as") {
        symbols.push({
          name: token,
          range: {
            start: { line: lineIdx, character: tokenStart },
            end: { line: lineIdx, character: tokenEnd },
          },
        });
        currentPos = tokenEnd;
        i++;
      } else {
        i++;
      }
    }
  }

  return {
    range: {
      start: { line: lineIdx, character: 0 },
      end: { line: lineIdx, character: line.length },
    },
    symbolsRange:
      bracketStart !== -1
        ? {
            start: { line: lineIdx, character: bracketStart },
            end: { line: lineIdx, character: bracketEnd + 1 },
          }
        : undefined,
    pathRange: {
      start: { line: lineIdx, character: pathStart },
      end: { line: lineIdx, character: pathEnd },
    },
    modulePath,
    isNamespace: false,
    symbols,
    line: lineIdx,
  };
}

/**
 * Parse a namespace import: (import name from "...")
 */
function parseNamespaceImport(
  line: string,
  lineIdx: number,
  modulePath: string,
  pathStart: number,
  pathEnd: number
): ParsedImport {
  // Extract namespace name
  const afterImport = line.substring(line.indexOf("import") + 7).trim();
  const nameEnd = afterImport.indexOf(" ");
  const namespaceName = afterImport.substring(0, nameEnd);

  const nameStart = line.indexOf(namespaceName, line.indexOf("import") + 7);

  return {
    range: {
      start: { line: lineIdx, character: 0 },
      end: { line: lineIdx, character: line.length },
    },
    pathRange: {
      start: { line: lineIdx, character: pathStart },
      end: { line: lineIdx, character: pathEnd },
    },
    modulePath,
    isNamespace: true,
    namespaceName,
    symbols: [
      {
        name: namespaceName,
        range: {
          start: { line: lineIdx, character: nameStart },
          end: { line: lineIdx, character: nameStart + namespaceName.length },
        },
      },
    ],
    line: lineIdx,
  };
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
 * Get all imported symbol names from text
 */
export function getImportedSymbols(text: string): string[] {
  const imports = findAllImports(text);
  const symbols: string[] = [];

  for (const imp of imports) {
    for (const sym of imp.symbols) {
      // Use alias if present, otherwise use name
      symbols.push(sym.alias ?? sym.name);
    }
  }

  return symbols;
}

/**
 * Find the import statement containing a specific symbol
 */
export function findImportContainingSymbol(
  text: string,
  symbolName: string
): ParsedImport | null {
  const imports = findAllImports(text);

  for (const imp of imports) {
    for (const sym of imp.symbols) {
      if (sym.name === symbolName || sym.alias === symbolName) {
        return imp;
      }
    }
  }

  return null;
}

/**
 * Find the best position to insert a new import statement
 * Returns line number (0-indexed)
 */
export function findInsertPosition(text: string): number {
  const lines = text.split("\n");
  let lastImportLine = 0;
  let foundNonImport = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines and comments at the top
    if (!line || line.startsWith(";")) {
      continue;
    }

    if (line.startsWith("(import ")) {
      lastImportLine = i + 1; // Insert after this import
      foundNonImport = false;
    } else {
      foundNonImport = true;
      break;
    }
  }

  return lastImportLine;
}
