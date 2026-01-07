/**
 * HQL REPL Syntax Module
 * Tokenizer, syntax highlighting, and paren matching for REPL input
 */

import { ANSI_COLORS } from "../ansi.ts";
import {
  PRIMITIVE_OPS,
  KERNEL_PRIMITIVES,
  DECLARATION_KEYWORDS,
  BINDING_KEYWORDS,
  JS_LITERAL_KEYWORDS_SET,
} from "../../transpiler/keyword/primitives.ts";
import {
  CONTROL_FLOW_KEYWORDS,
  THREADING_MACROS,
  WORD_LOGICAL_OPERATORS,
  extractMacroNames,
} from "../../common/known-identifiers.ts";

const { SICP_PURPLE, CYAN, RED, YELLOW, DIM_GRAY, BOLD, RESET } = ANSI_COLORS;

// ============================================================
// Token Types
// ============================================================

export type TokenType =
  | "string"
  | "number"
  | "keyword"
  | "macro"      // Distinct from keyword - signals non-standard evaluation
  | "operator"
  | "comment"
  | "boolean"
  | "nil"
  | "symbol"
  | "open-paren"
  | "close-paren"
  | "open-bracket"
  | "close-bracket"
  | "open-brace"
  | "close-brace"
  | "whitespace";

export interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

// ============================================================
// Pre-computed Sets for O(1) Lookup
// ============================================================

// Macros: Threading, quote system, utility macros, type predicates
// These get RED color to distinguish from keywords (signals non-standard evaluation)
const MACRO_SET: ReadonlySet<string> = new Set([
  // Threading macros
  ...THREADING_MACROS,
  // Quote system
  "quote", "quasiquote", "unquote", "unquote-splicing",
  // Word logical operators (macros, not primitives)
  ...WORD_LOGICAL_OPERATORS,
  // Utility macros from embedded macros
  "inc", "dec", "str", "print",
  "when-let", "if-let", "if-not", "when-not",
  "doto", "xor", "min", "max", "with-gensyms",
  // Type predicates (macros)
  "isNull", "isUndefined", "isNil", "isDefined", "notNil",
  "isString", "isNumber", "isBoolean", "isFunction", "isSymbol",
  "isArray", "isObject",
  // Other utility macros
  "isEmpty", "hasElements", "isEmptyList", "contains",
]);

// Keywords: control flow, declarations, bindings, kernel primitives
// These get SICP_PURPLE color
const KEYWORD_SET: ReadonlySet<string> = new Set([
  ...CONTROL_FLOW_KEYWORDS,
  ...DECLARATION_KEYWORDS,
  ...BINDING_KEYWORDS,
  ...KERNEL_PRIMITIVES,
  "fn", "function", "defn", "macro", "import", "export", "new",
  "async", "from", "as", "this",
  // Generator and async forms
  "fn*", "yield", "yield*",
  // Loop control
  "label", "break", "continue",
]);

// Operators from primitives.ts
const OPERATOR_SET: ReadonlySet<string> = PRIMITIVE_OPS;

// Boolean literals
const BOOLEAN_SET: ReadonlySet<string> = new Set(["true", "false"]);

// Nil/null literals
const NIL_SET: ReadonlySet<string> = new Set(["nil", "null", "undefined"]);

// ============================================================
// Tokenizer
// ============================================================

/**
 * Tokenize HQL input string into tokens.
 * Single-pass O(n) tokenizer.
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // Whitespace
    if (/\s/.test(ch)) {
      const start = i;
      while (i < input.length && /\s/.test(input[i])) i++;
      tokens.push({ type: "whitespace", value: input.slice(start, i), start, end: i });
      continue;
    }

    // Comment (;)
    if (ch === ";") {
      const start = i;
      while (i < input.length && input[i] !== "\n") i++;
      tokens.push({ type: "comment", value: input.slice(start, i), start, end: i });
      continue;
    }

    // String literal
    if (ch === '"') {
      const start = i;
      i++; // Skip opening quote
      while (i < input.length) {
        if (input[i] === "\\") {
          i += 2; // Skip escape sequence
          continue;
        }
        if (input[i] === '"') {
          i++; // Include closing quote
          break;
        }
        i++;
      }
      tokens.push({ type: "string", value: input.slice(start, i), start, end: i });
      continue;
    }

    // Delimiters
    if (ch === "(") {
      tokens.push({ type: "open-paren", value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "close-paren", value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === "[") {
      tokens.push({ type: "open-bracket", value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === "]") {
      tokens.push({ type: "close-bracket", value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === "{") {
      tokens.push({ type: "open-brace", value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === "}") {
      tokens.push({ type: "close-brace", value: ch, start: i, end: i + 1 });
      i++;
      continue;
    }

    // Number (including negative numbers)
    if (/[0-9]/.test(ch) || (ch === "-" && i + 1 < input.length && /[0-9]/.test(input[i + 1]))) {
      const start = i;
      if (ch === "-") i++;
      // Integer or float
      while (i < input.length && /[0-9]/.test(input[i])) i++;
      if (i < input.length && input[i] === ".") {
        i++;
        while (i < input.length && /[0-9]/.test(input[i])) i++;
      }
      // BigInt suffix
      if (i < input.length && input[i] === "n") i++;
      // Hex prefix
      if (input.slice(start, i) === "0" && i < input.length && (input[i] === "x" || input[i] === "X")) {
        i++;
        while (i < input.length && /[0-9a-fA-F]/.test(input[i])) i++;
      }
      tokens.push({ type: "number", value: input.slice(start, i), start, end: i });
      continue;
    }

    // Symbol (identifier, keyword, or operator)
    if (!isDelimiter(ch)) {
      const start = i;
      while (i < input.length && !isDelimiter(input[i]) && !/\s/.test(input[i])) i++;
      const value = input.slice(start, i);
      const type = classifySymbol(value);
      tokens.push({ type, value, start, end: i });
      continue;
    }

    // Unknown character - treat as symbol
    tokens.push({ type: "symbol", value: ch, start: i, end: i + 1 });
    i++;
  }

  return tokens;
}

function isDelimiter(ch: string): boolean {
  return "()[]{}\"';,".includes(ch);
}

function classifySymbol(value: string): TokenType {
  if (MACRO_SET.has(value)) return "macro";  // Check macros first (RED)
  if (KEYWORD_SET.has(value)) return "keyword";
  if (OPERATOR_SET.has(value)) return "operator";
  if (BOOLEAN_SET.has(value)) return "boolean";
  if (NIL_SET.has(value) || JS_LITERAL_KEYWORDS_SET.has(value)) return "nil";
  return "symbol";
}

// ============================================================
// Syntax Highlighter
// ============================================================

/**
 * Color map for token types.
 * SICP Theme (Structure and Interpretation of Computer Programs):
 * - Keywords: SICP_PURPLE (#663399) - special forms, control flow
 * - Macros: RED - threading, quote, utility macros (distinct from keywords)
 * - Strings: RED (SICP accent color)
 * - Numbers: CYAN
 * - Booleans: YELLOW
 * - Nil/null: DIM_GRAY
 * - Delimiters: DIM_GRAY (subtle)
 * - Function calls: SICP_PURPLE (symbols in function position)
 */
const TOKEN_COLORS: Partial<Record<TokenType, string>> = {
  string: RED,
  number: CYAN,
  keyword: SICP_PURPLE,
  macro: RED,           // Macros get red (SICP accent) - distinct from keywords
  operator: CYAN,
  comment: DIM_GRAY,
  boolean: YELLOW,
  nil: DIM_GRAY,
  // Delimiters - subtle gray to fade into background
  "open-paren": DIM_GRAY,
  "close-paren": DIM_GRAY,
  "open-bracket": DIM_GRAY,
  "close-bracket": DIM_GRAY,
  "open-brace": DIM_GRAY,
  "close-brace": DIM_GRAY,
};

// Color for symbols in function position (after open paren)
const FUNCTION_CALL_COLOR = SICP_PURPLE;

/**
 * Highlight input string with ANSI colors.
 * Uses context-aware highlighting for function position detection.
 *
 * @param input - Raw input string
 * @param matchPos - Optional position of matching paren to highlight
 * @returns ANSI-colored string
 */
export function highlight(input: string, matchPos: number | null = null): string {
  if (input.length === 0) return "";

  const tokens = tokenize(input);
  let result = "";

  // Pre-compute which tokens are in function position (after open-paren, skipping whitespace)
  // OPTIMIZED: Single forward pass O(n) instead of O(n²) backward scans
  const functionPositionTokens = new Set<number>();
  let lastNonWhitespaceType: string | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "whitespace") continue;

    // Check if this token is in function position (right after open-paren)
    if ((token.type === "symbol" || token.type === "operator") &&
        lastNonWhitespaceType === "open-paren") {
      functionPositionTokens.add(i);
    }

    lastNonWhitespaceType = token.type;
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const isFunctionPosition = functionPositionTokens.has(i);

    // Determine color with priority:
    // 1. Macros ALWAYS stay red (even in function position) - signals non-standard evaluation
    // 2. Function position gets purple (for user-defined functions, operators)
    // 3. Otherwise use token type color
    let color: string | undefined;
    if (token.type === "macro") {
      color = TOKEN_COLORS.macro;  // Always red
    } else if (isFunctionPosition) {
      color = FUNCTION_CALL_COLOR;  // Purple for function position
    } else {
      color = TOKEN_COLORS[token.type];
    }

    // Check if this token contains the matching paren position
    if (matchPos !== null && token.start <= matchPos && matchPos < token.end) {
      // Highlight the matching paren
      const beforeMatch = token.value.slice(0, matchPos - token.start);
      const matchChar = token.value[matchPos - token.start];
      const afterMatch = token.value.slice(matchPos - token.start + 1);

      if (color) {
        result += color + beforeMatch + RESET;
        result += BOLD + CYAN + matchChar + RESET;
        result += color + afterMatch + RESET;
      } else {
        result += beforeMatch;
        result += BOLD + CYAN + matchChar + RESET;
        result += afterMatch;
      }
    } else if (color) {
      result += color + token.value + RESET;
    } else {
      result += token.value;
    }
  }

  return result;
}

// ============================================================
// Paren Matching
// ============================================================

const CLOSE_TO_OPEN: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/**
 * Find the position of the matching opening paren for a closing paren.
 *
 * @param input - Input string
 * @param cursorPos - Position to check (should be at or after a closing paren)
 * @returns Position of matching open paren, or null if not found/not applicable
 */
export function findMatchingParen(input: string, cursorPos: number): number | null {
  // Check if cursor is on or just after a closing delimiter
  const ch = input[cursorPos];
  if (!ch || !(ch in CLOSE_TO_OPEN)) return null;

  const openChar = CLOSE_TO_OPEN[ch];
  let depth = 0;
  let inString = false;

  // Scan backwards to find matching opener
  for (let i = cursorPos; i >= 0; i--) {
    const c = input[i];

    // Handle string boundaries (simple approach - doesn't handle escapes perfectly)
    if (c === '"' && (i === 0 || input[i - 1] !== "\\")) {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    // Skip comments (scan back to find if we're in a comment)
    // Simple heuristic: if there's a ; before us on this line, skip
    // This is imperfect but works for most cases

    if (c === ch) {
      depth++;
    } else if (c === openChar) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return null;
}

/**
 * Check if the input has balanced delimiters.
 * More accurate than the simple version in readline.ts because it uses the tokenizer.
 */
export function isBalanced(input: string): boolean {
  const tokens = tokenize(input);
  let parens = 0, brackets = 0, braces = 0;

  for (const token of tokens) {
    switch (token.type) {
      case "open-paren": parens++; break;
      case "close-paren": parens--; break;
      case "open-bracket": brackets++; break;
      case "close-bracket": brackets--; break;
      case "open-brace": braces++; break;
      case "close-brace": braces--; break;
    }
    // Early exit if unbalanced (more closes than opens)
    if (parens < 0 || brackets < 0 || braces < 0) return false;
  }

  return parens === 0 && brackets === 0 && braces === 0;
}
