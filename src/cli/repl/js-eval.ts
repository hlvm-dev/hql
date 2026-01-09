/**
 * JavaScript Evaluation for Polyglot REPL
 *
 * Transforms JavaScript code to persist variables to globalThis,
 * enabling cross-eval and cross-language (HQL ↔ JS) interoperability.
 */

// =============================================================================
// Constants - Patterns defined once, used everywhere
// =============================================================================

const JS_IDENT = "[a-zA-Z_$][a-zA-Z0-9_$]*";

// Patterns for matching declarations (cached at module level for performance)
const PATTERNS = {
  letConst: new RegExp(`\\b(let|const)\\s+(${JS_IDENT})\\s*=`, "g"),
  varDecl: new RegExp(`\\b(?:let|const|var)\\s+(${JS_IDENT})`, "g"),
  fnDecl: new RegExp(`(?:^|[{};])\\s*(?:async\\s+)?function\\s*\\*?\\s*(${JS_IDENT})\\s*\\(`, "gm"),
  classDecl: new RegExp(`\\bclass\\s+(${JS_IDENT})`, "g"),
} as const;

// Regex flag pattern (pre-compiled for hot path in stripStringsAndComments)
const REGEX_FLAG_PATTERN = /[gimsuy]/;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Skip a quoted string, pushing spaces to result array.
 * Handles escape sequences. Returns new index position.
 */
function skipQuotedString(
  code: string,
  start: number,
  quote: string,
  result: string[]
): number {
  result.push(" "); // opening quote
  let i = start + 1;

  while (i < code.length && code[i] !== quote) {
    result.push(" ");
    if (code[i] === "\\") {
      i++;
      if (i < code.length) result.push(" ");
    }
    i++;
  }

  if (i < code.length) {
    result.push(" "); // closing quote
    i++;
  }
  return i;
}

/**
 * Extract all first capture groups from regex matches.
 */
function extractMatches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map(m => m[1]);
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Strip strings, comments, and regex literals from code.
 * Returns code with these replaced by spaces (preserving positions).
 * This allows safe regex matching on the result.
 */
function stripStringsAndComments(code: string): string {
  const result: string[] = [];
  let i = 0;

  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];

    // Single-line comment: //
    if (c === "/" && next === "/") {
      const end = code.indexOf("\n", i);
      const len = end === -1 ? code.length - i : end - i;
      result.push(" ".repeat(len));
      i += len;
    }
    // Multi-line comment: /* */
    else if (c === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      const len = end === -1 ? code.length - i : end + 2 - i;
      result.push(" ".repeat(len));
      i += len;
    }
    // Regex literal: /pattern/flags
    // Heuristic: / after these chars is likely regex, not division
    else if (c === "/" && i > 0) {
      const prev = code.slice(0, i).trimEnd().slice(-1);
      if ("=([,!&|:;{}?".includes(prev)) {
        result.push(" ");
        i++;
        while (i < code.length && code[i] !== "/") {
          result.push(" ");
          if (code[i] === "\\") { i++; if (i < code.length) result.push(" "); }
          else if (code[i] === "[") {
            // Character class [...] - scan until ]
            i++;
            while (i < code.length && code[i] !== "]") {
              result.push(" ");
              if (code[i] === "\\") { i++; if (i < code.length) result.push(" "); }
              i++;
            }
          }
          i++;
        }
        if (i < code.length) { result.push(" "); i++; }
        // Skip flags (g, i, m, s, u, y) - use pre-compiled regex
        while (i < code.length && REGEX_FLAG_PATTERN.test(code[i])) {
          result.push(" ");
          i++;
        }
      } else {
        result.push(c);
        i++;
      }
    }
    // Strings: ", ', `
    else if (c === '"' || c === "'" || c === "`") {
      i = skipQuotedString(code, i, c, result);
    }
    // Regular character
    else {
      result.push(c);
      i++;
    }
  }

  return result.join("");
}

/**
 * Transform JS code for REPL persistence.
 * Variables are assigned to globalThis for cross-eval access.
 *
 * Transformations:
 * - let x = val       →  let x = globalThis.x = val
 * - const y = val     →  const y = globalThis.y = val
 * - function foo(){}  →  function foo(){}; globalThis.foo = foo;
 * - async function x  →  async function x(){}; globalThis.x = x;
 * - function* gen()   →  function* gen(){}; globalThis.gen = gen;
 * - class Bar {}      →  class Bar {}; globalThis.Bar = Bar;
 *
 * Note: `var` automatically goes to globalThis in indirect eval.
 */
export function transformJSForRepl(code: string): string {
  const stripped = stripStringsAndComments(code);

  // Transform let/const in-place with offset tracking
  let transformed = code;
  let offset = 0;

  for (const match of stripped.matchAll(PATTERNS.letConst)) {
    const name = match[2];
    const start = match.index! + offset;
    const end = start + match[0].length;

    const replacement = transformed.slice(start, end).replace(
      PATTERNS.letConst,
      `$1 $2 = globalThis.${name} =`
    );

    transformed = transformed.slice(0, start) + replacement + transformed.slice(end);
    offset += replacement.length - match[0].length;
  }

  // Collect function/class declarations for appending
  const fnNames = extractMatches(stripped, PATTERNS.fnDecl);
  const classNames = extractMatches(stripped, PATTERNS.classDecl);
  const appendNames = [...fnNames, ...classNames];

  if (appendNames.length > 0) {
    const suffix = appendNames.map(n => `globalThis.${n} = ${n}`).join("; ");
    transformed += "; " + suffix + ";";
  }

  return transformed;
}

/**
 * Evaluate JavaScript code in REPL context.
 * Uses indirect eval for global scope execution.
 */
export function evaluateJS(code: string): unknown {
  const transformed = transformJSForRepl(code);
  // deno-lint-ignore no-eval
  return (0, eval)(transformed);
}

/**
 * Extract binding names from JS code for state tracking.
 */
export function extractJSBindings(code: string): string[] {
  const stripped = stripStringsAndComments(code);
  return [
    ...extractMatches(stripped, PATTERNS.varDecl),
    ...extractMatches(stripped, PATTERNS.fnDecl),
    ...extractMatches(stripped, PATTERNS.classDecl),
  ];
}
