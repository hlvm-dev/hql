/**
 * AST-based Import Extraction Adapter
 *
 * Extracts import information directly from the HQL AST,
 * replacing the regex-based parser for multiline support
 * and consistency with the core parser.
 */

import { parse } from "../../src/transpiler/pipeline/parser.ts";
import {
  type SExp,
  type SList,
  type SSymbol,
  isSymbol,
  isList,
  isLiteral,
} from "../../src/s-exp/types.ts";
import type { ParsedImport, ParsedImportSymbol, LSPRange } from "./types.ts";

/**
 * Find all imports in HQL text using AST parser
 *
 * This handles multiline imports correctly unlike regex-based parsing.
 */
export function findAllImportsViaAST(
  text: string,
  filePath: string = ""
): ParsedImport[] {
  try {
    const ast = parse(text, filePath);
    return extractImportsFromAST(ast, text);
  } catch {
    // On parse error, return empty array (graceful degradation)
    return [];
  }
}

/**
 * Extract imports from a pre-parsed AST
 *
 * Use this when you already have the AST to avoid re-parsing.
 */
export function extractImportsFromAST(
  ast: SExp[],
  text: string
): ParsedImport[] {
  const imports: ParsedImport[] = [];

  for (const node of ast) {
    if (!isList(node) || node.elements.length === 0) continue;

    const head = node.elements[0];
    if (!isSymbol(head) || head.name !== "import") continue;

    const parsed = parseImportNode(node, text);
    if (parsed) {
      imports.push(parsed);
    }
  }

  return imports;
}

/**
 * Convert a single import AST node to ParsedImport
 */
function parseImportNode(node: SList, text: string): ParsedImport | null {
  if (node.elements.length < 4) return null;

  const importSpec = node.elements[1];
  let sourceModule: string | undefined;
  let pathRange: LSPRange | undefined;
  let pathNode: SExp | undefined;

  // Find "from" keyword and extract module path
  for (let i = 2; i < node.elements.length - 1; i++) {
    const elem = node.elements[i];
    if (isSymbol(elem) && elem.name === "from") {
      pathNode = node.elements[i + 1];
      if (isLiteral(pathNode) && typeof pathNode.value === "string") {
        sourceModule = pathNode.value;
        const meta = pathNode._meta;
        if (meta) {
          // HQL uses 1-indexed, LSP uses 0-indexed
          const startLine = (meta.line ?? 1) - 1;
          const startCol = (meta.column ?? 1) - 1;
          pathRange = {
            start: { line: startLine, character: startCol },
            end: {
              line: (meta.endLine ?? meta.line ?? 1) - 1,
              character:
                (meta.endColumn ?? (meta.column ?? 1) + sourceModule.length + 2) - 1,
            },
          };
        }
      }
      break;
    }
  }

  if (!sourceModule) return null;

  // Calculate import statement range from _meta
  const nodeMeta = node._meta;
  const startLine = (nodeMeta?.line ?? 1) - 1;
  const startCol = (nodeMeta?.column ?? 1) - 1;

  // Calculate end position - use endLine/endColumn if available,
  // otherwise find the closing paren by scanning the text
  let endLine = startLine;
  let endCol = 0;

  if (nodeMeta?.endLine !== undefined && nodeMeta?.endColumn !== undefined) {
    endLine = nodeMeta.endLine - 1;
    endCol = nodeMeta.endColumn - 1;
  } else {
    // Fallback: find the matching closing paren by scanning text
    const endPos = findMatchingCloseParen(text, startLine, startCol);
    endLine = endPos.line;
    endCol = endPos.column;
  }

  const statementRange: LSPRange = {
    start: { line: startLine, character: startCol },
    end: { line: endLine, character: endCol },
  };

  // Handle namespace import: (import name from "module")
  if (isSymbol(importSpec)) {
    const symbolMeta = importSpec._meta;
    const symStartLine = (symbolMeta?.line ?? 1) - 1;
    const symStartCol = (symbolMeta?.column ?? 1) - 1;

    return {
      range: statementRange,
      pathRange: pathRange!,
      modulePath: sourceModule,
      isNamespace: true,
      namespaceName: importSpec.name,
      symbols: [
        {
          name: importSpec.name,
          range: {
            start: { line: symStartLine, character: symStartCol },
            end: {
              line: symStartLine,
              character: symStartCol + importSpec.name.length,
            },
          },
        },
      ],
      line: startLine,
    };
  }

  // Handle named import: (import [a b c] from "module")
  if (isList(importSpec)) {
    const symbols: ParsedImportSymbol[] = [];
    const specMeta = importSpec._meta;

    // Calculate symbols range (the [...] part)
    const symbolsRange = specMeta
      ? {
          start: {
            line: (specMeta.line ?? 1) - 1,
            character: (specMeta.column ?? 1) - 1,
          },
          end: {
            line: (specMeta.endLine ?? specMeta.line ?? 1) - 1,
            character: (specMeta.endColumn ?? 999) - 1,
          },
        }
      : undefined;

    // Filter out parser artifacts (vector, empty-array markers)
    const elements = importSpec.elements.filter(
      (e) => !isSymbol(e) || (e.name !== "vector" && e.name !== "empty-array")
    );

    let i = 0;
    while (i < elements.length) {
      const elem = elements[i];
      if (!isSymbol(elem)) {
        i++;
        continue;
      }

      const symbolMeta = elem._meta;
      const symStartLine = (symbolMeta?.line ?? 1) - 1;
      const symStartCol = (symbolMeta?.column ?? 1) - 1;

      // Check for alias pattern: name as alias
      const nextElem = elements[i + 1];
      const afterAs = elements[i + 2];
      if (
        i + 2 < elements.length &&
        isSymbol(nextElem) &&
        nextElem.name === "as" &&
        isSymbol(afterAs)
      ) {
        const aliasElem = afterAs;
        const aliasMeta = aliasElem._meta;
        const aliasEndCol =
          (aliasMeta?.column ?? 1) - 1 + aliasElem.name.length;

        symbols.push({
          name: elem.name,
          alias: aliasElem.name,
          range: {
            start: { line: symStartLine, character: symStartCol },
            end: {
              line: (aliasMeta?.line ?? 1) - 1,
              character: aliasEndCol,
            },
          },
        });
        i += 3;
      } else if (elem.name !== "as") {
        // Regular symbol (not "as" keyword)
        symbols.push({
          name: elem.name,
          range: {
            start: { line: symStartLine, character: symStartCol },
            end: {
              line: symStartLine,
              character: symStartCol + elem.name.length,
            },
          },
        });
        i++;
      } else {
        // Skip standalone "as" keyword
        i++;
      }
    }

    return {
      range: statementRange,
      symbolsRange,
      pathRange: pathRange!,
      modulePath: sourceModule,
      isNamespace: false,
      symbols,
      line: startLine,
    };
  }

  return null;
}

/**
 * Find the matching closing paren for an import statement.
 * Scans from the starting position, counting parens until balanced.
 */
function findMatchingCloseParen(
  text: string,
  startLine: number,
  startCol: number
): { line: number; column: number } {
  const lines = text.split("\n");
  let depth = 0;
  let inString = false;
  let stringChar = "";

  for (let lineIdx = startLine; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const startIdx = lineIdx === startLine ? startCol : 0;

    for (let colIdx = startIdx; colIdx < line.length; colIdx++) {
      const char = line[colIdx];
      const prevChar = colIdx > 0 ? line[colIdx - 1] : "";

      // Handle string boundaries
      if (!inString && (char === '"' || char === "'")) {
        inString = true;
        stringChar = char;
      } else if (inString && char === stringChar && prevChar !== "\\") {
        inString = false;
      } else if (!inString) {
        // Track paren depth
        if (char === "(") {
          depth++;
        } else if (char === ")") {
          depth--;
          if (depth === 0) {
            // Found the matching close paren
            return { line: lineIdx, column: colIdx + 1 };
          }
        }
      }
    }
  }

  // Fallback: return end of start line if no match found
  return {
    line: startLine,
    column: lines[startLine]?.length ?? 0,
  };
}
