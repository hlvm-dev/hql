/**
 * Docstring Extraction from Comments
 *
 * Extracts documentation comments that precede HQL definitions.
 * Works with all definition forms: def, defn, fn, let, const, import, etc.
 *
 * Supported comment styles:
 * - ; lisp style
 * - // js style
 * - block style: slash-star ... star-slash (single line)
 *
 * @example
 * ```
 * ; Adds two numbers together
 * (def add (fn [x y] (+ x y)))
 * ```
 * → Extracts: "add" → "Adds two numbers together"
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
 * Scans for comment lines followed by definition forms,
 * associates the comment text with the defined name.
 *
 * @param source - HQL source code
 * @returns Map of name → docstring
 */
export function extractDocstrings(source: string): Map<string, string> {
  const docstrings = new Map<string, string>();
  const lines = source.split('\n');

  let pendingComments: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines (but don't clear pending comments)
    if (!trimmed) {
      i++;
      continue;
    }

    // Accumulate comment lines
    const comment = extractCommentText(trimmed);
    if (comment !== null) {
      pendingComments.push(comment);
      i++;
      continue;
    }

    // Check for definition form
    if (pendingComments.length > 0 && trimmed.startsWith('(')) {
      const names = extractDefinedNames(trimmed, lines, i);

      if (names.length > 0) {
        const docstring = pendingComments.join(' ').trim();
        for (const name of names) {
          if (docstring) {
            docstrings.set(name, docstring);
          }
        }
      }
    }

    // Clear pending comments on non-comment, non-empty line
    pendingComments = [];
    i++;
  }

  return docstrings;
}

/**
 * Extract comment text from a line, or null if not a comment.
 */
function extractCommentText(line: string): string | null {
  // Lisp-style: ; comment
  if (line.startsWith(';')) {
    return line.replace(/^;+\s*/, '').trim();
  }

  // JS-style: // comment
  if (line.startsWith('//')) {
    return line.replace(/^\/\/+\s*/, '').trim();
  }

  // Block comment on single line: /* comment */
  const blockMatch = line.match(/^\/\*\s*(.*?)\s*\*\/$/);
  if (blockMatch) {
    return blockMatch[1].trim();
  }

  return null;
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
function extractDefinedNames(line: string, _lines: string[], _lineIndex: number): string[] {
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

/**
 * Merge new docstrings into existing map.
 * New entries override existing ones.
 */
export function mergeDocstrings(
  existing: Map<string, string>,
  newDocs: Map<string, string>
): Map<string, string> {
  const merged = new Map(existing);
  for (const [name, doc] of newDocs) {
    merged.set(name, doc);
  }
  return merged;
}
