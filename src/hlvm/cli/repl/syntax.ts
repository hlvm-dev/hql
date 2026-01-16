/**
 * HLVM REPL Syntax Module
 * Tokenizer, syntax highlighting, and paren matching for REPL input
 */

import { ANSI_COLORS } from "../ansi.ts";
import {
  KERNEL_PRIMITIVES,
  BINDING_KEYWORDS,
  JS_LITERAL_KEYWORDS_SET,
} from "../../../hql/transpiler/keyword/primitives.ts";
import {
  KEYWORD_SET as BASE_KEYWORD_SET,
  OPERATOR_SET,
  MACRO_SET as BASE_MACRO_SET,
} from "../../../common/known-identifiers.ts";

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
// Pre-computed Sets for O(1) Lookup (extend shared sets)
// ============================================================

// Macros: extend BASE_MACRO_SET with syntax-specific entries
const MACRO_SET: ReadonlySet<string> = new Set([
  ...BASE_MACRO_SET,
  // Quote system
  "quote", "quasiquote", "unquote", "unquote-splicing",
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

// Keywords: extend BASE_KEYWORD_SET with syntax-specific entries
const KEYWORD_SET: ReadonlySet<string> = new Set([
  ...BASE_KEYWORD_SET,
  ...BINDING_KEYWORDS,
  ...KERNEL_PRIMITIVES,
  "fn", "function", "defn", "macro", "import", "export", "new",
  "async", "from", "as", "this",
  // Generator and async forms
  "fn*", "yield", "yield*",
  // Loop control
  "label", "break", "continue",
]);

// Boolean literals
const BOOLEAN_SET: ReadonlySet<string> = new Set(["true", "false"]);

// Nil/null literals
const NIL_SET: ReadonlySet<string> = new Set(["nil", "null", "undefined"]);

// Pre-compiled regex patterns for tokenizer hot path (avoid repeated compilation)
const WHITESPACE_REGEX = /\s/;
const DIGIT_REGEX = /[0-9]/;
const HEX_DIGIT_REGEX = /[0-9a-fA-F]/;

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
    if (WHITESPACE_REGEX.test(ch)) {
      const start = i;
      while (i < input.length && WHITESPACE_REGEX.test(input[i])) i++;
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
    if (DIGIT_REGEX.test(ch) || (ch === "-" && i + 1 < input.length && DIGIT_REGEX.test(input[i + 1]))) {
      const start = i;
      if (ch === "-") i++;
      // Integer or float
      while (i < input.length && DIGIT_REGEX.test(input[i])) i++;
      if (i < input.length && input[i] === ".") {
        i++;
        while (i < input.length && DIGIT_REGEX.test(input[i])) i++;
      }
      // BigInt suffix
      if (i < input.length && input[i] === "n") i++;
      // Hex prefix
      if (input.slice(start, i) === "0" && i < input.length && (input[i] === "x" || input[i] === "X")) {
        i++;
        while (i < input.length && HEX_DIGIT_REGEX.test(input[i])) i++;
      }
      tokens.push({ type: "number", value: input.slice(start, i), start, end: i });
      continue;
    }

    // Symbol (identifier, keyword, or operator)
    if (!isDelimiter(ch)) {
      const start = i;
      while (i < input.length && !isDelimiter(input[i]) && !WHITESPACE_REGEX.test(input[i])) i++;
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
// Tokenization Memoization
// ============================================================

// Simple single-entry cache for tokenization
// Avoids repeated tokenization of the same input during a single render cycle
let _lastTokenizeInput: string | null = null;
let _cachedTokens: Token[] | null = null;

function tokenizeCached(input: string): Token[] {
  if (input !== _lastTokenizeInput) {
    _lastTokenizeInput = input;
    _cachedTokens = tokenize(input);
  }
  return _cachedTokens!;
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
 * @param bracketPositions - Optional position(s) of brackets to highlight (single number or array for pairs)
 * @returns ANSI-colored string
 */
export function highlight(input: string, bracketPositions: number | number[] | null = null): string {
  if (input.length === 0) return "";

  const tokens = tokenizeCached(input);
  let result = "";

  // Normalize to Set for O(1) lookup
  const highlightSet = new Set<number>(
    bracketPositions === null ? [] :
    typeof bracketPositions === "number" ? [bracketPositions] :
    bracketPositions
  );

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

    // Check if this token contains any highlighted bracket positions
    // Collect all positions within this token's range
    const matchPositions: number[] = [];
    for (let pos = token.start; pos < token.end; pos++) {
      if (highlightSet.has(pos)) {
        matchPositions.push(pos - token.start); // Convert to token-relative offset
      }
    }

    if (matchPositions.length > 0) {
      // Render token with highlighted brackets
      let tokenResult = "";
      let lastEnd = 0;

      for (const relPos of matchPositions) {
        // Text before this match
        const beforeMatch = token.value.slice(lastEnd, relPos);
        const matchChar = token.value[relPos];

        if (color) {
          tokenResult += color + beforeMatch + RESET;
        } else {
          tokenResult += beforeMatch;
        }
        // Highlight the bracket with bold cyan + underline for visibility
        tokenResult += BOLD + CYAN + matchChar + RESET;
        lastEnd = relPos + 1;
      }

      // Remaining text after last match
      const afterMatch = token.value.slice(lastEnd);
      if (color) {
        tokenResult += color + afterMatch + RESET;
      } else {
        tokenResult += afterMatch;
      }

      result += tokenResult;
    } else if (color) {
      result += color + token.value + RESET;
    } else {
      result += token.value;
    }
  }

  return result;
}

// ============================================================
// Delimiter Pairs (Single Source of Truth)
// ============================================================

/** Maps closing delimiters to their opening counterparts */
export const CLOSE_TO_OPEN: Readonly<Record<string, string>> = { ")": "(", "]": "[", "}": "{" };

/** Maps opening delimiters to their closing counterparts (also used for auto-close) */
export const OPEN_TO_CLOSE: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };

/** Maps opening delimiters to their closing counterparts (including quotes for auto-pair) */
export const AUTO_PAIR_CHARS: Readonly<Record<string, string>> = {
  "(": ")", "[": "]", "{": "}",
  '"': '"', "'": "'"
};

/** All opening delimiters as string for quick checks */
export const OPEN_DELIMITERS = "([{";

/** All closing delimiters as string for quick checks */
export const CLOSE_DELIMITERS = ")]}";

// ============================================================
// Delimiter Pair Operations (Encapsulated Helpers)
// ============================================================

/**
 * Check if cursor is positioned inside an empty delimiter pair: `(|)`, `[|]`, `{|}`
 * Used for auto-delete-pair behavior.
 *
 * @param value - Input text
 * @param cursorPos - Cursor position
 * @returns Object with match info, or null if not inside empty pair
 */
export function isInsideEmptyPair(
  value: string,
  cursorPos: number
): { open: string; close: string } | null {
  if (cursorPos <= 0 || cursorPos >= value.length) return null;

  const charBefore = value[cursorPos - 1];
  const charAfter = value[cursorPos];

  if (charBefore in OPEN_TO_CLOSE && OPEN_TO_CLOSE[charBefore] === charAfter) {
    return { open: charBefore, close: charAfter };
  }
  return null;
}

/**
 * Delete character(s) with auto-pair support.
 * If cursor is inside empty pair `(|)`, deletes both delimiters.
 * Otherwise, deletes n characters before cursor.
 *
 * @param value - Input text
 * @param cursorPos - Cursor position
 * @param n - Number of chars to delete (default 1)
 * @returns New value and cursor position
 */
export function deleteBackWithPairSupport(
  value: string,
  cursorPos: number,
  n: number = 1
): { newValue: string; newCursor: number } {
  if (cursorPos <= 0) {
    return { newValue: value, newCursor: cursorPos };
  }

  // Check for empty pair
  const emptyPair = isInsideEmptyPair(value, cursorPos);
  if (emptyPair) {
    // Delete both opening and closing delimiter
    const newValue = value.slice(0, cursorPos - 1) + value.slice(cursorPos + 1);
    return { newValue, newCursor: cursorPos - 1 };
  }

  // Normal deletion
  const deleteCount = Math.min(n, cursorPos);
  const newValue = value.slice(0, cursorPos - deleteCount) + value.slice(cursorPos);
  return { newValue, newCursor: cursorPos - deleteCount };
}

/**
 * Check if cursor is inside a string of a specific quote type.
 * Used for smart quote insertion (don't auto-pair inside existing string).
 *
 * @param value - Input text
 * @param cursorPos - Cursor position
 * @param quoteChar - Quote character to check (" or ')
 * @returns true if cursor is inside a string delimited by quoteChar
 */
export function isInsideString(value: string, cursorPos: number, quoteChar: string): boolean {
  let inString = false;
  let stringChar = "";
  for (let i = 0; i < cursorPos; i++) {
    const char = value[i];
    if ((char === '"' || char === "'") && (i === 0 || value[i - 1] !== '\\')) {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        stringChar = "";
      }
    }
  }
  return inString && stringChar === quoteChar;
}

/**
 * Check if cursor is inside an empty quote pair: `"|"` or `'|'`
 * Used for auto-delete-quote-pair behavior.
 */
export function isInsideEmptyQuotePair(value: string, cursorPos: number): boolean {
  if (cursorPos <= 0 || cursorPos >= value.length) return false;
  const charBefore = value[cursorPos - 1];
  const charAfter = value[cursorPos];
  return (charBefore === '"' || charBefore === "'") && charBefore === charAfter;
}

// ============================================================
// Balanced Delimiter Scanning
// ============================================================

/**
 * Scan for balanced delimiters, handling strings properly.
 * Internal helper to eliminate duplicate scanning logic.
 */
function scanBalanced(
  input: string,
  startPos: number,
  direction: "forward" | "backward",
  isTarget: (ch: string) => boolean,
  isOpposite: (ch: string) => boolean,
): number | null {
  let depth = 0;
  let inString = false;
  const step = direction === "forward" ? 1 : -1;
  const end = direction === "forward" ? input.length : -1;

  for (let i = startPos; i !== end; i += step) {
    const c = input[i];

    // Handle string boundaries (unescaped quotes)
    if (c === '"' && (i === 0 || input[i - 1] !== "\\")) {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (isTarget(c)) {
      depth++;
    } else if (isOpposite(c)) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
}

/**
 * Find the position of the matching paren for any delimiter.
 * Works for both opening (finds closing) and closing (finds opening) parens.
 *
 * @param input - Input string
 * @param cursorPos - Position to check (should be on a delimiter)
 * @returns Position of matching delimiter, or null if not found/not applicable
 */
export function findMatchingParen(input: string, cursorPos: number): number | null {
  const ch = input[cursorPos];
  if (!ch) return null;

  if (ch in CLOSE_TO_OPEN) {
    const openChar = CLOSE_TO_OPEN[ch];
    return scanBalanced(input, cursorPos, "backward", c => c === ch, c => c === openChar);
  }

  if (ch in OPEN_TO_CLOSE) {
    const closeChar = OPEN_TO_CLOSE[ch];
    return scanBalanced(input, cursorPos, "forward", c => c === ch, c => c === closeChar);
  }

  return null;
}

// ============================================================
// Structural Navigation (S-expression movement)
// ============================================================

/**
 * Find the opening paren of the enclosing s-expression.
 * Internal helper used by backwardUpSexp.
 */
function findSexpStart(input: string, cursorPos: number): number {
  const result = scanBalanced(
    input,
    cursorPos - 1,
    "backward",
    c => CLOSE_DELIMITERS.includes(c),
    c => OPEN_DELIMITERS.includes(c),
  );
  return result ?? 0;
}

/**
 * Move cursor to start of next s-expression.
 * Skips whitespace and finds the next opening paren or atom.
 *
 * @param input - Input string
 * @param cursorPos - Current cursor position
 * @returns New cursor position
 */
export function forwardSexp(input: string, cursorPos: number): number {
  let pos = cursorPos;
  const len = input.length;

  // Skip whitespace
  while (pos < len && /\s/.test(input[pos])) pos++;
  if (pos >= len) return len;

  const ch = input[pos];

  // If on opening delimiter, find matching close
  if (ch in OPEN_TO_CLOSE) {
    const match = findMatchingParen(input, pos);
    return match !== null ? match + 1 : len;
  }

  // If on closing delimiter, move past it
  if (ch in CLOSE_TO_OPEN) {
    return pos + 1;
  }

  // Otherwise, skip the atom (symbol, number, etc.)
  while (pos < len && !/[\s()\[\]{}]/.test(input[pos])) pos++;

  return pos;
}

/**
 * Move cursor to start of previous s-expression.
 *
 * @param input - Input string
 * @param cursorPos - Current cursor position
 * @returns New cursor position
 */
export function backwardSexp(input: string, cursorPos: number): number {
  let pos = cursorPos;

  // Skip whitespace backwards
  while (pos > 0 && /\s/.test(input[pos - 1])) pos--;
  if (pos <= 0) return 0;

  const ch = input[pos - 1];

  // If just after closing delimiter, find matching open
  if (ch in CLOSE_TO_OPEN) {
    const match = findMatchingParen(input, pos - 1);
    return match !== null ? match : 0;
  }

  // If just after opening delimiter, move before it
  if (ch in OPEN_TO_CLOSE) {
    return pos - 1;
  }

  // Otherwise, skip the atom backwards
  pos--;
  while (pos > 0 && !/[\s()\[\]{}]/.test(input[pos - 1])) pos--;

  return pos;
}

/**
 * Find the opening paren of the enclosing s-expression.
 * Useful for navigating "up" in nested structures.
 *
 * @param input - Input string
 * @param cursorPos - Current cursor position
 * @returns Position of the enclosing opening paren, or 0 if at top level
 */
export function backwardUpSexp(input: string, cursorPos: number): number {
  return findSexpStart(input, cursorPos);
}

/**
 * Move down one level into the next s-expression (into a list).
 *
 * @param input - Input string
 * @param cursorPos - Current cursor position
 * @returns Position just after the opening paren, or unchanged if not in front of a list
 */
export function forwardDownSexp(input: string, cursorPos: number): number {
  let pos = cursorPos;
  const len = input.length;

  // Skip whitespace
  while (pos < len && /\s/.test(input[pos])) pos++;
  if (pos >= len) return cursorPos;

  const ch = input[pos];

  // If on opening delimiter, move inside
  if (ch in OPEN_TO_CLOSE) {
    return pos + 1;
  }

  return cursorPos;
}

/**
 * Check if the input has balanced delimiters.
 * More accurate than the simple version in readline.ts because it uses the tokenizer.
 */
export function isBalanced(input: string): boolean {
  const tokens = tokenizeCached(input);
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

/**
 * Get the number of unclosed delimiters (for continuation prompt).
 * Returns total count of unclosed parens + brackets + braces.
 */
export function getUnclosedDepth(input: string): number {
  const tokens = tokenizeCached(input);
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
  }

  // Return total unclosed (only positive values - more opens than closes)
  return Math.max(0, parens) + Math.max(0, brackets) + Math.max(0, braces);
}
