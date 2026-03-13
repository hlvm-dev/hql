/**
 * Docstring Extraction from JSDoc/TSDoc Blocks
 *
 * HQL adopts industry-standard JSDoc/TSDoc as the canonical doc format.
 * We only treat blocks that start with `/**` and end with `* /` as docstrings
 * (space added to avoid closing this comment).
 * next definition form (def/defn/fn/let/const/import/macro).
 *
 * @example
 * ```
 * / ** 
 *  * Adds two numbers together.
 *  * @param x First number
 *  * @param y Second number
 *  * /
 * (def add (fn [x y] (+ x y)))
 * ```
 * → Extracts: "add" → "/** ... * /" (space added to avoid closing this comment)
 */

/**
 * Definition forms that create named bindings.
 * We look for these keywords after an opening paren.
 */
const DEFINITION_KEYWORDS = new Set([
  "def",      // (def name value)
  "defn",     // (defn name [params] body) - macro
  "fn",       // (fn name [params] body) - named fn
  "let",      // (let [name val ...] body)
  "const",    // (const name value) - if supported
  "var",      // (var name value) - if supported
  "import",   // (import [name] from "...")
  "macro",    // (macro name [params] body)
]);

/**
 * Extract docstrings from source code.
 *
 * Scans for JSDoc/TSDoc blocks followed by definition forms and associates
 * the full comment block with the defined name.
 *
 * @param source - HQL source code
 * @returns Map of name → JSDoc/TSDoc block (including /** ... * /)
 */
export function extractDocstrings(source: string): Map<string, string> {
  const docstrings = new Map<string, string>();
  const lines = source.split('\n');

  let pendingDocBlock: string | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines (but don't clear pending doc block)
    if (!trimmed) {
      i++;
      continue;
    }

    if (!pendingDocBlock && trimmed.startsWith('/**')) {
      const extracted = extractJsDocBlock(lines, i);
      pendingDocBlock = extracted.block;
      i = extracted.endIndex + 1;
      continue;
    }

    // Check for definition form
    if (pendingDocBlock && trimmed.startsWith('(')) {
      const names = extractDefinedNames(trimmed);

      if (names.length > 0) {
        for (const name of names) {
          docstrings.set(name, pendingDocBlock);
        }
      }
    }

    // Clear pending doc block on non-empty line
    pendingDocBlock = null;
    i++;
  }

  return docstrings;
}

/**
 * Extract a JSDoc/TSDoc block starting at the given line.
 * Returns the full block string and the index of the final line.
 */
export function extractJsDocBlock(lines: string[], startIndex: number): { block: string; endIndex: number } {
  const rawLines: string[] = [];
  let endIndex = startIndex;

  for (let i = startIndex; i < lines.length; i++) {
    const currentLine = lines[i];
    rawLines.push(currentLine);
    endIndex = i;
    if (currentLine.includes('*/')) {
      break;
    }
  }

  return { block: normalizeDocBlock(rawLines), endIndex };
}

function normalizeDocBlock(lines: string[]): string {
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const minIndent = indents.length > 0
    ? indents.reduce((a, b) => (a < b ? a : b))
    : 0;
  return lines.map((line) => line.slice(minIndent)).join('\n').trimEnd();
}

/**
 * Strip leading comments (line or block) and blank lines from source.
 * Used to detect whether input should be treated as HQL or JS.
 */
export function stripLeadingComments(source: string): string {
  const lines = source.split("\n");
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === "") {
      index++;
      continue;
    }

    if (isLineComment(trimmed)) {
      index++;
      continue;
    }

    if (trimmed.startsWith("/*")) {
      index = findBlockCommentEnd(lines, index) + 1;
      continue;
    }

    break;
  }

  const remaining = lines.slice(index);
  if (remaining.length > 0) {
    remaining[0] = remaining[0].trimStart();
  }
  return remaining.join("\n");
}

function findBlockCommentEnd(lines: string[], startIndex: number): number {
  for (let i = startIndex; i < lines.length; i++) {
    if (lines[i].includes("*/")) {
      return i;
    }
  }
  return lines.length - 1;
}

export function isLineComment(trimmedLine: string): boolean {
  return trimmedLine.startsWith("//") || trimmedLine.startsWith(";");
}

/**
 * Extract names being defined from a definition form.
 *
 * Handles:
 * - (def name ...)        → ["name"]
 * - (defn name ...)       → ["name"]
 * - (fn name [...] ...)   → ["name"]
 * - (let [a 1 b 2] ...)   → ["a", "b"]
 * - (import [a b] from..) → ["a", "b"]
 */
function extractDefinedNames(line: string): string[] {
  // Match: (keyword name or (keyword [
  const keywordMatch = line.match(/^\((\S+)/);
  if (!keywordMatch) return [];

  const keyword = keywordMatch[1];
  if (!DEFINITION_KEYWORDS.has(keyword)) return [];

  const names: string[] = [];

  // Handle different definition forms
  switch (keyword) {
    case "def":
    case "defn":
    case "const":
    case "var":
    case "macro": {
      // (def NAME ...) or (defn NAME ...)
      const nameMatch = line.match(/^\(\S+\s+([a-zA-Z_$][a-zA-Z0-9_$-]*)/);
      if (nameMatch) {
        names.push(nameMatch[1]);
      }
      break;
    }

    case "fn": {
      // (fn NAME [...] ...) - named function
      // Skip if no name: (fn [...] ...)
      const fnMatch = line.match(/^\(fn\s+([a-zA-Z_$][a-zA-Z0-9_$-]*)\s*\[/);
      if (fnMatch) {
        names.push(fnMatch[1]);
      }
      break;
    }

    case "let": {
      // (let [a 1 b 2 ...] ...)
      // Extract binding names from the vector
      const letMatch = line.match(/^\(let\s*\[([^\]]*)/);
      if (letMatch) {
        const bindings = letMatch[1];
        // Extract names (every other token, starting from first)
        const tokens = bindings.split(/\s+/).filter(t => t);
        for (let i = 0; i < tokens.length; i += 2) {
          const name = tokens[i];
          if (name && /^[a-zA-Z_$][a-zA-Z0-9_$-]*$/.test(name)) {
            names.push(name);
          }
        }
      }
      break;
    }

    case "import": {
      // (import [a b c] from "...")
      // (import name from "...")
      const importVectorMatch = line.match(/^\(import\s*\[([^\]]*)\]/);
      if (importVectorMatch) {
        const imports = importVectorMatch[1];
        const tokens = imports.split(/\s+/).filter(t => t && t !== "as");
        for (const token of tokens) {
          if (/^[a-zA-Z_$][a-zA-Z0-9_$-]*$/.test(token)) {
            names.push(token);
          }
        }
      } else {
        // Namespace import: (import name from "...")
        const importNameMatch = line.match(/^\(import\s+([a-zA-Z_$][a-zA-Z0-9_$-]*)\s+from/);
        if (importNameMatch) {
          names.push(importNameMatch[1]);
        }
      }
      break;
    }
  }

  return names;
}
