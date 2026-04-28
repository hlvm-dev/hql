/**
 * JavaScript Evaluation for REPL (js ...) form
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
// Set for O(1) regex-preceding-char lookup
const REGEX_PRECEDING_CHARS = new Set("=([,!&|:;{}?");

function stripStringsAndComments(code: string): string {
  const result: string[] = [];
  let i = 0;
  // Track last non-whitespace char to avoid O(n) slice+trimEnd on every '/'
  let lastNonWhitespace = "";

  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];

    // Single-line comment: //
    if (c === "/" && next === "/") {
      const end = code.indexOf("\n", i);
      const len = end === -1 ? code.length - i : end - i;
      result.push(" ".repeat(len));
      i += len;
      continue;
    }
    // Multi-line comment: /* */
    if (c === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      const len = end === -1 ? code.length - i : end + 2 - i;
      result.push(" ".repeat(len));
      i += len;
      continue;
    }
    // Regex literal: /pattern/flags
    // Heuristic: / after these chars is likely regex, not division
    if (c === "/" && i > 0 && REGEX_PRECEDING_CHARS.has(lastNonWhitespace)) {
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
      continue;
    }
    // Strings: ", ', `
    if (c === '"' || c === "'" || c === "`") {
      i = skipQuotedString(code, i, c, result);
      continue;
    }
    // Regular character
    result.push(c);
    if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r") {
      lastNonWhitespace = c;
    }
    i++;
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
function transformJSForRepl(code: string): string {
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

/** Keywords that start statements (not expressions) — used for return-value detection */
const STATEMENT_KEYWORD_RE =
  /^(if|for|while|do|switch|try|throw|return|const|let|var|class|function|async\s+function|import|export)\b/;

/**
 * Wrap transformed JS code in an async IIFE for full JS support (await, etc.).
 *
 * Two-phase approach:
 *   Phase 1 — expression form `(async()=>(CODE))()`: returns value, works for
 *             single expressions like `await fetch(...)`, `1 + 2`, etc.
 *   Phase 2 — block form `(async()=>{CODE})()`: handles multi-statement code.
 *             Injects `return` before the last expression-statement so the
 *             caller gets a meaningful return value.
 */
function wrapForAsyncEval(code: string): string {
  // Phase 1: try as single expression (preserves return value naturally)
  try {
    // deno-lint-ignore no-eval
    new Function(`return (${code})`); // syntax check only — does NOT execute
    return `(async()=>(\n${code}\n))()`;
  } catch { /* not a single expression — fall through to Phase 2 */ }

  // Phase 2: block form — inject `return` before last expression-statement
  const lines = code.split("\n");
  let lastIdx = lines.length - 1;
  while (lastIdx >= 0 && !lines[lastIdx].trim()) lastIdx--;

  if (lastIdx >= 0) {
    const originalLine = lines[lastIdx];
    const indent = originalLine.length - originalLine.trimStart().length;
    const lastLine = originalLine.trimStart();
    let returnPrefix = "";
    let returnCandidate = lastLine;

    const lastSemicolon = lastLine.lastIndexOf(";");
    if (lastSemicolon >= 0 && lastSemicolon < lastLine.length - 1) {
      returnPrefix = lastLine.slice(0, lastSemicolon + 1).trimEnd();
      returnCandidate = lastLine.slice(lastSemicolon + 1).trimStart();
    }

    // Only inject return if last line is a single expression (no semicolons, not a statement keyword)
    if (
      !STATEMENT_KEYWORD_RE.test(returnCandidate) &&
      !returnCandidate.includes(";")
    ) {
      const prefixedReturn = returnPrefix
        ? `${returnPrefix} return (${returnCandidate})`
        : `return (${returnCandidate})`;
      lines[lastIdx] = " ".repeat(indent) + prefixedReturn;
    }
  }

  return `(async()=>{\n${lines.join("\n")}\n})()`;
}

/**
 * Evaluate JavaScript code in REPL context.
 * Wraps code in an async IIFE so `await`, Promises, and all async JS works.
 */
export async function evaluateJS(code: string): Promise<{ value: unknown; logs: string[] }> {
  const transformed = transformJSForRepl(code);
  const logs: string[] = [];
  const toLogString = (arg: unknown): string => {
    if (typeof arg === "string") return arg;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  };
  const pushLog = (...args: unknown[]) => {
    logs.push(args.map(toLogString).join(" "));
  };
  // Shadow console for this eval only (prevents stdout errors).
  const consoleProxy = {
    log: pushLog,
    info: pushLog,
    warn: pushLog,
    error: pushLog,
    debug: pushLog,
    trace: pushLog,
    dir: pushLog,
    dirxml: pushLog,
    table: pushLog,
    group: pushLog,
    groupCollapsed: pushLog,
    groupEnd: () => {},
    time: () => {},
    timeEnd: pushLog,
    timeLog: pushLog,
    timeStamp: () => {},
    profile: () => {},
    profileEnd: () => {},
    clear: () => {},
    count: pushLog,
    countReset: pushLog,
    assert: () => {},
  };
  const globalWithConsole = globalThis as typeof globalThis & {
    console: typeof consoleProxy;
  };
  const originalConsole = globalWithConsole.console;
  globalWithConsole.console = consoleProxy;
  try {
    const asyncCode = wrapForAsyncEval(transformed);
    // deno-lint-ignore no-eval
    const value = await (0, eval)(asyncCode);
    return { value, logs };
  } finally {
    globalWithConsole.console = originalConsole;
  }
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
