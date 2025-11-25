// core/src/transpiler/pipeline/parser.ts

import {
  createList,
  createLiteral,
  createNilLiteral,
  createSymbol,
  isSymbol,
  type SExp,
  type SList,
  type SLiteral,
  type SSymbol,
} from "../../s-exp/types.ts";
import { ParseError } from "../../common/error.ts";
import { HQLErrorCode } from "../../common/error-codes.ts";
import { attachSourceLocation } from "../../common/syntax-error-handler.ts";
import { readTextFileSync as platformReadTextFileSync } from "../../platform/platform.ts";

enum TokenType {
  LeftParen,
  RightParen,
  LeftBracket,
  RightBracket,
  LeftBrace,
  RightBrace,
  HashLeftBracket,
  String,
  TemplateLiteral,
  Number,
  Symbol,
  Quote,
  Backtick,
  Unquote,
  UnquoteSplicing,
  Dot,
  Colon,
  Comma,
  Comment,
  Whitespace,
}

interface Token {
  type: TokenType;
  value: string;
  position: SourcePosition;
}

interface SourcePosition {
  line: number;
  column: number;
  offset: number;
  filePath: string;
}

const TOKEN_PATTERNS = {
  TEMPLATE_LITERAL: /^`(?!\(|\[)(?:[^`\\$]|\\[\s\S]|\$(?!\{)|\$\{(?:[^}\\]|\\[\s\S])*\})*`/,
  SPREAD_OPERATOR: /^\.\.\.(?![a-zA-Z_$])/,  // ... not followed by identifier (for inline expressions)
  REST_PARAM: /^\.\.\.([a-zA-Z_$][a-zA-Z0-9_$-]*)/,  // ...identifier for rest parameters
  SPECIAL_TOKENS: /^(#\[|\(|\)|\[|\]|\{|\}|\.|\:|,|'|`|~@|~)/,
  STRING: /^"(?:\\.|[^\\"])*"/,
  COMMENT: /^(;.*|\/\/.*|\/\*[\s\S]*?\*\/)/,
  WHITESPACE: /^\s+/,
  SYMBOL: /^[^\s\(\)\[\]\{\}"'`,;]+/, // Allow : in symbols for named params (y:)
};

/**
 * Parse HQL source code into an S-expression AST
 *
 * Converts raw HQL source text into a structured representation of
 * S-expressions that can be processed by the macro expander and
 * transpiler pipeline. Handles:
 * - List structures: `(...)`, `[...]`, `{...}`
 * - Literals: strings, numbers, booleans, nil
 * - Symbols and identifiers
 * - Quote syntax: `'`, `` ` ``, `~`, `~@`
 * - Comments (line and block)
 *
 * The parser is the first stage in the HQL→JavaScript transpilation
 * pipeline and produces a token stream that preserves source locations
 * for error reporting.
 *
 * @param input - Raw HQL source code as a string
 * @param filePath - Path to source file for error reporting (default: "")
 * @returns Array of S-expression nodes representing the parsed source
 *
 * @throws {ParseError} - If source contains invalid syntax (unmatched delimiters, unterminated strings, etc.)
 *
 * @example
 * // Parse a simple expression
 * const ast = parse("(+ 1 2)");
 * // → [List([Symbol("+"), NumericLiteral(1), NumericLiteral(2)])]
 *
 * @example
 * // Parse a function definition
 * const ast = parse('(defn greet [name] (str "Hello " name))');
 * // → [List([Symbol("defn"), Symbol("greet"), List([Symbol("name")]), ...])]
 *
 * @example
 * // Parse with file path for better error messages
 * const ast = parse('(invalid syntax', "app.hql");
 * // → Throws ParseError with file path and line/column info
 */
export function parse(input: string, filePath: string = ""): SExp[] {
  const tokens = tokenize(input, filePath);

  // We don't call validateTokenBalance here to avoid regressions

  return parseTokens(tokens, input, filePath);
}

/**
 * Analysis result for unclosed string literals
 */
interface UnclosedStringAnalysis {
  /** Whether the string spans multiple lines */
  isMultiline: boolean;
  /** Preview of string content (max 30 chars from first line) */
  preview: string;
}

/**
 * Analyzes an unclosed string to provide context-aware error messages
 *
 * Production design principles:
 * - Performance: O(k) where k=200 (constant time, scans limited content)
 * - Robustness: Handles edge cases (empty, whitespace-only, special chars)
 * - Clarity: Clear distinction between single-line and multi-line strings
 *
 * @param input - Raw input starting with opening quote "
 * @returns Analysis with multiline flag and preview text
 */
function analyzeUnclosedString(input: string): UnclosedStringAnalysis {
  // Skip opening quote (we know input[0] === '"')
  const content = input.substring(1);

  // Performance guard: Scan only first 200 chars
  // This is sufficient to detect multiline and extract preview
  // Prevents O(n) scan on megabyte-sized malformed input
  const SCAN_LIMIT = 200;
  const scanContent = content.substring(
    0,
    Math.min(content.length, SCAN_LIMIT),
  );

  // Detect actual newline characters in source
  // (not escaped \n sequences, but actual line breaks)
  const hasNewline = scanContent.includes("\n") || scanContent.includes("\r");

  // Extract preview for error message
  let preview = "";
  const PREVIEW_MAX_LENGTH = 30;

  if (hasNewline) {
    // Multi-line string: show first line only
    // Helps identify which multiline string in large files
    const firstLine = scanContent.split(/\r?\n/)[0];
    preview = firstLine.length > PREVIEW_MAX_LENGTH
      ? firstLine.substring(0, PREVIEW_MAX_LENGTH)
      : firstLine;
  } else {
    // Single-line string: show first 30 chars
    preview = scanContent.length > PREVIEW_MAX_LENGTH
      ? scanContent.substring(0, PREVIEW_MAX_LENGTH)
      : scanContent;
  }

  return {
    isMultiline: hasNewline,
    preview: preview,
  };
}

/**
 * Builds an appropriate error message based on string analysis
 *
 * Message strategy (following TypeScript/Rust best practices):
 * - Single-line: Simple message (easy to locate via line number)
 * - Multi-line: Include preview (hard to locate, preview helps)
 * - Only show preview if meaningful (non-empty)
 *
 * @param analysis - Result from analyzeUnclosedString
 * @returns Human-readable error message
 */
function buildUnclosedStringMessage(analysis: UnclosedStringAnalysis): string {
  if (analysis.isMultiline) {
    // Multi-line string: Add preview if available
    if (analysis.preview.length > 0) {
      return `Multi-line string literal not terminated (starts with "${analysis.preview}...")`;
    } else {
      return `Multi-line string literal not terminated`;
    }
  } else {
    // Single-line string: Keep simple
    return `String literal not terminated`;
  }
}

function tokenize(input: string, filePath: string): Token[] {
  const tokens: Token[] = [];
  let remaining = input, line = 1, column = 1, offset = 0;

  while (remaining.length > 0) {
    const token = matchNextToken(remaining, line, column, offset, filePath);

    if (
      token.type === TokenType.Comment || token.type === TokenType.Whitespace ||
      token.type === TokenType.Comma
    ) {
      // Update position info but don't add these token types
      // Commas are treated as whitespace (like Clojure)
      for (const char of token.value) {
        if (char === "\n") {
          line++;
          column = 1;
        } else {
          column++;
        }
      }
    } else {
      tokens.push(token);
    }

    offset += token.value.length;
    remaining = remaining.substring(token.value.length);
    if (
      token.type !== TokenType.Comment && token.type !== TokenType.Whitespace &&
      token.type !== TokenType.Comma
    ) {
      column += token.value.length;
    }
  }

  return tokens;
}

function getTokenTypeForSpecial(value: string): TokenType {
  switch (value) {
    case "(":
      return TokenType.LeftParen;
    case ")":
      return TokenType.RightParen;
    case "[":
      return TokenType.LeftBracket;
    case "]":
      return TokenType.RightBracket;
    case "{":
      return TokenType.LeftBrace;
    case "}":
      return TokenType.RightBrace;
    case "#[":
      return TokenType.HashLeftBracket;
    case ".":
      return TokenType.Dot;
    case ":":
      return TokenType.Colon;
    case ",":
      return TokenType.Comma;
    case "'":
      return TokenType.Quote;
    case "`":
      return TokenType.Backtick;
    case "~":
      return TokenType.Unquote;
    case "~@":
      return TokenType.UnquoteSplicing;
    default:
      return TokenType.Symbol;
  }
}

function parseTokens(tokens: Token[], input: string, filePath: string): SExp[] {
  const state: ParserState = { tokens, currentPos: 0, input, filePath, quasiquoteDepth: 0 };
  const nodes: SExp[] = [];

  while (state.currentPos < state.tokens.length) {
    nodes.push(parseExpression(state));
  }

  return nodes;
}

interface ParserState {
  tokens: Token[];
  currentPos: number;
  input: string;
  filePath: string;
  quasiquoteDepth: number; // Track nesting depth inside quasiquotes
}

/**
 * Helper function to create ParseError options with source context
 */
function errorOptions(position: SourcePosition, state: ParserState) {
  return {
    line: position.line,
    column: position.column,
    offset: position.offset,
    filePath: position.filePath,
    source: state.input,
  };
}

function parseExpression(state: ParserState): SExp {
  if (state.currentPos >= state.tokens.length) {
    const lastPos = state.tokens.length > 0
      ? state.tokens[state.tokens.length - 1].position
      : { line: 1, column: 1, offset: 0, filePath: state.filePath };
    throw new ParseError(
      "Unexpected end of input",
      errorOptions(lastPos, state),
    );
  }

  const token = state.tokens[state.currentPos++];
  return parseExpressionByTokenType(token, state);
}

function parseExpressionByTokenType(token: Token, state: ParserState): SExp {
  let result: SExp;

  switch (token.type) {
    case TokenType.LeftParen:
      result = parseList(state, token.position);
      break;
    case TokenType.RightParen: {
      const lineContext = getLineContext(state.input, token.position.line);
      throw new ParseError(
        `Unexpected ')' - Check for a missing opening '(' in previous lines.\nContext: ${lineContext}`,
        errorOptions(token.position, state),
      );
    }
    case TokenType.LeftBracket:
      result = parseVector(state, token.position);
      break;
    case TokenType.RightBracket:
      throw new ParseError(
        `Unexpected ']' - Check for a missing opening '[' in previous lines.`,
        errorOptions(token.position, state),
      );
    case TokenType.LeftBrace:
      result = parseMap(state, token.position);
      break;
    case TokenType.RightBrace:
      throw new ParseError(
        `Unexpected '}' - Check for a missing opening '{' in previous lines.`,
        errorOptions(token.position, state),
      );
    case TokenType.HashLeftBracket:
      result = parseSet(state, token.position);
      break;
    case TokenType.Quote: {
      const quotedExpr = parseExpression(state);
      result = createList(createSymbol("quote"), quotedExpr);
      break;
    }
    case TokenType.Backtick: {
      state.quasiquoteDepth++;
      const expr = parseExpression(state);
      state.quasiquoteDepth--;
      result = createList(createSymbol("quasiquote"), expr);
      break;
    }
    case TokenType.Unquote: {
      // If we're NOT inside a quasiquote, treat ~ as a regular symbol (bitwise NOT operator)
      if (state.quasiquoteDepth === 0) {
        result = createSymbol("~");
      } else {
        state.quasiquoteDepth--;
        const expr = parseExpression(state);
        state.quasiquoteDepth++;
        result = createList(createSymbol("unquote"), expr);
      }
      break;
    }
    case TokenType.UnquoteSplicing: {
      // UnquoteSplicing (~@) should only work inside quasiquotes
      if (state.quasiquoteDepth === 0) {
        throw new ParseError(
          "Unquote-splicing (~@) can only be used inside a quasiquote (backtick `)",
          errorOptions(token.position, state),
        );
      }
      state.quasiquoteDepth--;
      const expr = parseExpression(state);
      state.quasiquoteDepth++;
      result = createList(createSymbol("unquote-splicing"), expr);
      break;
    }
    case TokenType.Comma:
      result = createSymbol(",");
      break;
    case TokenType.Dot:
      result = parseDotAccess(state, token);
      break;
    case TokenType.String:
      result = parseStringLiteral(token.value);
      break;
    case TokenType.TemplateLiteral:
      result = parseTemplateLiteral(token.value, state, token.position);
      break;
    case TokenType.Number:
      result = createLiteral(Number(token.value));
      break;
    case TokenType.Symbol:
      result = parseSymbol(token.value);
      break;
    default:
      throw new ParseError(
        `Unexpected token type: ${token.type}`,
        token.position,
      );
  }

  // Attach source location to result
  attachSourceLocation(
    result,
    state.filePath,
    token.position.line,
    token.position.column,
  );

  return result;
}

/**
 * Enhanced Import Statement Processing - Detects and validates import statements
 * Uses a more general approach to check structure without hardcoding specific typos
 */
// core/src/transpiler/pipeline/parser.ts
// Only showing the key function that needs updating:

/**
 * Enhanced Import Statement Processing - Detects and validates import statements
 * Uses a more general approach to check structure without hardcoding specific typos
 */
function parseImportStatement(elements: SExp[]): SList {
  // Check if we're parsing an import statement
  if (
    elements.length > 0 &&
    isSymbol(elements[0]) &&
    elements[0].name === "import"
  ) {
    // Check for simple import (import "module")
    if (elements.length === 2 && elements[1].type === "literal") {
      // This is a simple import - valid
      return createList(...elements);
    }

    // Check for the length to determine the type of import
    if (elements.length >= 3) {
      // We have at least three elements
      const secondElement = elements[1];

      // Case 1: Named import with vector like (import [hello] from "./module.hql")
      if (secondElement.type === "list") {
        // Check if we have the 'from' keyword at index 2
        const thirdElement = elements[2];
        if (isSymbol(thirdElement)) {
          // Check if this is 'from' or a typo like 'fom'
          const keyword = (thirdElement as SSymbol).name;

          if (keyword !== "from") {
            // This is a typo - throw a more specific error
            throw new ParseError(
              `Invalid import statement: expected 'from' but got '${keyword}'`,
              {
                line: (thirdElement._meta?.line || 1),
                column: (thirdElement._meta?.column || 1),
                filePath: (thirdElement._meta?.filePath || ""),
              },
            );
          }
        }
        // This is a named import - it's already structured correctly
        return createList(...elements);
      }

      // Case 2: Namespace import like (import module from "./module.hql")
      if (isSymbol(secondElement)) {
        const thirdElement = elements[2];

        if (isSymbol(thirdElement)) {
          const keyword = (thirdElement as SSymbol).name;

          if (keyword !== "from") {
            // This is a typo in the 'from' keyword
            throw new ParseError(
              `Invalid import statement: expected 'from' but got '${keyword}'`,
              {
                line: (thirdElement._meta?.line || 1),
                column: (thirdElement._meta?.column || 1),
                filePath: (thirdElement._meta?.filePath || ""),
              },
            );
          }

          // Valid namespace import pattern
          return createList(...elements);
        }
      }
    }

    // If we get here, the import statement is malformed
    throw new ParseError(
      'Invalid import statement format. Expected (import "module"), (import module from "./path"), or (import [symbols] from "./path")',
      {
        line: (elements[0]._meta?.line || 1),
        column: (elements[0]._meta?.column || 1),
        filePath: (elements[0]._meta?.filePath || ""),
      },
    );
  }

  // If we get here, it's not a special case or not an import, so just return a normal list
  return createList(...elements);
}

function parseDotAccess(state: ParserState, dotToken: Token): SExp {
  if (state.currentPos < state.tokens.length) {
    const nextToken = state.tokens[state.currentPos++];
    const result = createSymbol("." + nextToken.value);

    // Attach location info - for dot access, use the dot's position
    attachSourceLocation(
      result,
      state.filePath,
      dotToken.position.line,
      dotToken.position.column,
    );

    return result;
  }
  throw new ParseError("Expected property name after '.'", dotToken.position);
}

function parseStringLiteral(tokenValue: string): SExp {
  const str = tokenValue.slice(1, -1).replace(/\\"/g, '"').replace(
    /\\\\/g,
    "\\",
  );
  return createLiteral(str);
}

function parseTemplateLiteral(
  tokenValue: string,
  _state: ParserState,
  position: SourcePosition,
): SExp {
  // Remove surrounding backticks
  const content = tokenValue.slice(1, -1);

  // Parse template literal into parts and expressions
  const parts: SExp[] = [createSymbol("template-literal")];
  let currentStr = "";
  let i = 0;

  while (i < content.length) {
    if (content[i] === "$" && content[i + 1] === "{") {
      // Found interpolation start
      // Save any accumulated string
      if (currentStr.length > 0) {
        parts.push(createLiteral(currentStr));
        currentStr = "";
      }

      // Find the matching closing brace
      i += 2; // Skip ${
      let braceDepth = 1;
      let exprStr = "";

      while (i < content.length && braceDepth > 0) {
        if (content[i] === "{") braceDepth++;
        else if (content[i] === "}") braceDepth--;

        if (braceDepth > 0) {
          exprStr += content[i];
        }
        i++;
      }

      // Parse the expression
      if (exprStr.trim().length > 0) {
        try {
          const exprTokens = tokenize(exprStr, position.filePath);
          const exprState: ParserState = {
            tokens: exprTokens,
            currentPos: 0,
            input: exprStr,
            filePath: position.filePath,
            quasiquoteDepth: 0,
          };
          const expr = parseExpression(exprState);
          parts.push(expr);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          throw new ParseError(
            `Invalid expression in template literal interpolation: ${exprStr}\nError: ${errorMsg}`,
            position,
          );
        }
      }
    } else if (content[i] === "\\") {
      // Handle escape sequences
      i++;
      if (i < content.length) {
        switch (content[i]) {
          case "n":
            currentStr += "\n";
            break;
          case "t":
            currentStr += "\t";
            break;
          case "r":
            currentStr += "\r";
            break;
          case "\\":
            currentStr += "\\";
            break;
          case "`":
            currentStr += "`";
            break;
          case "$":
            currentStr += "$";
            break;
          default:
            currentStr += content[i];
        }
        i++;
      }
    } else {
      currentStr += content[i];
      i++;
    }
  }

  // Add any remaining string
  if (currentStr.length > 0) {
    parts.push(createLiteral(currentStr));
  }

  // If there's only the symbol and one string part, just return a string literal
  if (parts.length === 2 && parts[1].type === "literal" && typeof parts[1].value === "string") {
    return parts[1];
  }

  return createList(...parts);
}

function parseSymbol(tokenValue: string): SExp {
  if (tokenValue === "true") return createLiteral(true);
  if (tokenValue === "false") return createLiteral(false);
  if (tokenValue === "nil") return createNilLiteral();

  if (tokenValue.startsWith(".")) return createSymbol(tokenValue);

  if (
    tokenValue.includes(".") && !tokenValue.startsWith(".") &&
    !tokenValue.endsWith(".")
  ) {
    return parseDotNotation(tokenValue);
  }

  return createSymbol(tokenValue);
}

function parseDotNotation(tokenValue: string): SExp {
  const parts = tokenValue.split(".");
  const objectName = parts[0];
  const propertyPath = parts.slice(1).join(".");

  // For property access with dashes, use get function
  if (propertyPath.includes("-")) {
    return createList(
      createSymbol("get"),
      createSymbol(objectName),
      createLiteral(propertyPath),
    );
  }

  // Otherwise use normal dot notation
  return createSymbol(tokenValue);
}

/**
 * Enhanced parse list function with special handling for imports and syntax errors
 */
function parseList(state: ParserState, listStartPos: SourcePosition): SList {
  const elements: SExp[] = [];

  // Check if this might be an enum declaration
  let isEnum = false;
  if (
    state.currentPos < state.tokens.length &&
    state.tokens[state.currentPos].type === TokenType.Symbol &&
    state.tokens[state.currentPos].value === "enum"
  ) {
    isEnum = true;
  }

  // Check if this might be a function declaration
  let fnKeywordFound = false;
  if (
    state.currentPos < state.tokens.length &&
    state.tokens[state.currentPos].type === TokenType.Symbol &&
    state.tokens[state.currentPos].value === "fn"
  ) {
    fnKeywordFound = true;
  }

  // Check if this might be an import declaration
  let importKeywordFound = false;
  if (
    state.currentPos < state.tokens.length &&
    state.tokens[state.currentPos].type === TokenType.Symbol &&
    state.tokens[state.currentPos].value === "import"
  ) {
    importKeywordFound = true;
  }

  // Process all tokens until we reach the closing parenthesis
  while (
    state.currentPos < state.tokens.length &&
    state.tokens[state.currentPos].type !== TokenType.RightParen
  ) {
    // Special handling for enum syntax with separate colon
    if (
      isEnum && elements.length === 2 &&
      state.tokens[state.currentPos].type === TokenType.Colon
    ) {
      // Skip the colon token
      state.currentPos++;

      // Ensure we have a type after the colon
      if (
        state.currentPos < state.tokens.length &&
        state.tokens[state.currentPos].type === TokenType.Symbol
      ) {
        // Get the enum name (already parsed) and the type
        const enumNameSym = elements[1];
        if (isSymbol(enumNameSym)) {
          const typeName = state.tokens[state.currentPos].value;

          // Replace the enum name with combined enum name and type
          elements[1] = createSymbol(`${enumNameSym.name}:${typeName}`);

          // Skip the type token since we've incorporated it
          state.currentPos++;
        }
      } else {
        throw new ParseError(
          "Expected type name after colon in enum declaration",
          state.tokens[state.currentPos - 1].position,
        );
      }
    } // Error: Named-arg sugar x: is not supported at call sites
    else if (
      elements.length >= 1 &&
      state.currentPos < state.tokens.length &&
      state.tokens[state.currentPos].type === TokenType.Symbol &&
      state.tokens[state.currentPos].value.endsWith(":")
    ) {
      const tokenValue = state.tokens[state.currentPos].value;

      // Special exception: loop keywords (to:, from:, by:) are NOT named-args
      // They're special form syntax for the 'for' construct
      const isLoopKeyword = ["to:", "from:", "by:"].includes(tokenValue);

      if (isLoopKeyword) {
        // Parse loop keywords as regular symbols
        const paramSymbol = createSymbol(tokenValue);
        attachSourceLocation(
          paramSymbol,
          state.filePath,
          state.tokens[state.currentPos].position.line,
          state.tokens[state.currentPos].position.column,
        );
        elements.push(paramSymbol);
        state.currentPos++;

        if (state.currentPos < state.tokens.length) {
          elements.push(parseExpression(state));
        } else {
          throw new ParseError(
            `Expected value after '${tokenValue}'`,
            state.tokens[state.currentPos - 1].position,
          );
        }
      } else {
        // Reject any other x: syntax at call sites
        const paramName = tokenValue.slice(0, -1);
        throw new ParseError(
          `[HQL1001] Named-arg sugar \`${paramName}:\` is not supported. ` +
          `Call with a JSON map, e.g. (fn-call {"${paramName}": value})`,
          state.tokens[state.currentPos].position,
        );
      }
    }
    // Error for deprecated return type annotation (->)
    else if (
      fnKeywordFound &&
      elements.length > 0 &&
      state.currentPos < state.tokens.length &&
      state.tokens[state.currentPos].type === TokenType.Symbol &&
      state.tokens[state.currentPos].value === "->"
    ) {
      throw new ParseError(
        `Return type annotation '->' is no longer supported. ` +
        `HQL uses dynamic typing - remove the return type annotation.`,
        state.tokens[state.currentPos].position,
      );
    } else {
      elements.push(parseExpression(state));
    }
  }

  // Check for unclosed list
  if (state.currentPos >= state.tokens.length) {
    // Extract file information from the source if available
    let errorMessage = "Unclosed list";

    if (state.input) {
      // Get a more accurate column position
      // First, determine the line where the unclosed list starts
      const lines = state.input.split("\n");
      const lineNumber = listStartPos.line;

      // Get the line of text where the error occurred
      const errorLine = lines[lineNumber - 1] || "";

      // For better error reporting, identify the full expression that is unclosed
      // Point to the end of the line where the closing parenthesis should be
      const lastColumn = errorLine.length;

      // Add more context to the error message
      errorMessage =
        `Unclosed list starting at line ${lineNumber}. Check for a missing closing parenthesis ')'`;

      // Create a precise error position that points to the end of the line
      // where the closing parenthesis is likely missing
      throw new ParseError(errorMessage, {
        line: lineNumber,
        column: lastColumn, // Point to the end of the line
        offset: listStartPos.offset + errorLine.length,
        filePath: state.filePath,
        source: state.input,
      });
    } else {
      // Fallback to less precise position if input source isn't available
      const lastTokenPos = state.tokens.length > 0
        ? state.tokens[state.tokens.length - 1].position
        : listStartPos;

      throw new ParseError(errorMessage, errorOptions(lastTokenPos, state));
    }
  }

  // Move past the closing parenthesis
  state.currentPos++;

  // Check if this is an import statement and handle it specially
  let result: SList;
  if (importKeywordFound) {
    result = parseImportStatement(elements);
  } else {
    result = createList(...elements);
  }

  // Attach source location (using both start and end positions)
  attachSourceLocation(
    result,
    state.filePath,
    listStartPos.line,
    listStartPos.column,
  );

  return result;
}

/**
 * Match the next token from the input string with enhanced error context
 * Improves error messages and location tracking
 */
function matchNextToken(
  input: string,
  line: number,
  column: number,
  offset: number,
  filePath: string,
): Token {
  const position: SourcePosition = { line, column, offset, filePath };

  // Define patterns to match
  let match;

  // First check for template literals (must come before special tokens to catch backticks)
  match = input.match(TOKEN_PATTERNS.TEMPLATE_LITERAL);
  if (match) return { type: TokenType.TemplateLiteral, value: match[0], position };

  // Check for spread operator (...) before rest parameters (for inline expressions)
  match = input.match(TOKEN_PATTERNS.SPREAD_OPERATOR);
  if (match) return { type: TokenType.Symbol, value: match[0], position };

  // Check for rest parameters (...identifier) before special tokens (to prevent ... being split into dots)
  match = input.match(TOKEN_PATTERNS.REST_PARAM);
  if (match) return { type: TokenType.Symbol, value: match[0], position };

  // Then check for special tokens
  match = input.match(TOKEN_PATTERNS.SPECIAL_TOKENS);
  if (match) {
    return {
      type: getTokenTypeForSpecial(match[0]),
      value: match[0],
      position,
    };
  }

  // Then check for strings
  match = input.match(TOKEN_PATTERNS.STRING);
  if (match) return { type: TokenType.String, value: match[0], position };

  // Then check for comments
  match = input.match(TOKEN_PATTERNS.COMMENT);
  if (match) return { type: TokenType.Comment, value: match[0], position };

  // Then check for whitespace
  match = input.match(TOKEN_PATTERNS.WHITESPACE);
  if (match) return { type: TokenType.Whitespace, value: match[0], position };

  // Finally check for symbols
  match = input.match(TOKEN_PATTERNS.SYMBOL);
  if (match) {
    const value = match[0];
    // If it's a number, return as number token
    if (!isNaN(Number(value))) {
      return { type: TokenType.Number, value, position };
    }
    // Otherwise return as symbol token
    return { type: TokenType.Symbol, value, position };
  }

  // Check for unclosed string literal
  // If we see an opening quote but the STRING pattern didn't match,
  // it means the string is not properly closed
  if (input[0] === '"') {
    // Analyze string to provide context-aware error message
    const analysis = analyzeUnclosedString(input);
    const message = buildUnclosedStringMessage(analysis);

    throw new ParseError(
      message,
      {
        line: position.line,
        column: position.column,
        filePath: position.filePath,
        source: input,
        code: HQLErrorCode.UNCLOSED_STRING,
      },
    );
  }

  // If we get here, there's an unexpected character
  // Provide enhanced error context
  const unexpectedChar = input[0] || "end of file";
  let errorContext = "";

  // Get some context for a better error message
  try {
    if (filePath) {
      const content = platformReadTextFileSync(filePath);
      const lines = content.split("\n");

      if (line > 0 && line <= lines.length) {
        const lineContent = lines[line - 1];
        // Create a pointer to the unexpected character
        const pointer = " ".repeat(column - 1) + "^";
        errorContext = `\n${lineContent}\n${pointer}`;
      }
    }
  } catch (_e) {
    // If we can't read the file, continue without extra context
  }

  throw new ParseError(
    `Unexpected character: '${unexpectedChar}' at line ${line}, column ${column}${errorContext}`,
    {
      line: position.line,
      column: position.column,
      filePath: position.filePath,
      source: input,
    },
  );
}

function parseVector(state: ParserState, startPos: SourcePosition): SList {
  const elements: SExp[] = [];
  while (
    state.currentPos < state.tokens.length &&
    state.tokens[state.currentPos].type !== TokenType.RightBracket
  ) {
    elements.push(parseExpression(state));

    // Check if we need a comma (not at the end of the array)
    if (
      state.currentPos < state.tokens.length &&
      state.tokens[state.currentPos].type === TokenType.Comma
    ) {
      state.currentPos++; // Skip optional comma
    }
  }
  if (state.currentPos >= state.tokens.length) {
    throw new ParseError("Unclosed vector", errorOptions(startPos, state));
  }

  // Move past the closing bracket
  state.currentPos++;

  let result: SList;
  if (elements.length === 0) {
    result = createList(createSymbol("empty-array"));
  } else {
    result = createList(createSymbol("vector"), ...elements);
  }

  // Attach source location
  attachSourceLocation(
    result,
    state.filePath,
    startPos.line,
    startPos.column,
  );

  return result;
}

function parseMap(state: ParserState, startPos: SourcePosition): SList {
  const entries: SExp[] = [];
  while (
    state.currentPos < state.tokens.length &&
    state.tokens[state.currentPos].type !== TokenType.RightBrace
  ) {
    const key = parseExpression(state);

    // Check if key is a symbol ending with : (like "x:" in {x: y})
    if (key.type === "symbol" && (key as SSymbol).name.endsWith(":")) {
      // Strip the : and convert to string literal for hash-map
      // This ensures {x: 1} generates __hql_hash_map("x", 1) not __hql_hash_map(x, 1)
      // Also supports destructuring patterns like {x: newX}
      const keyName = (key as SSymbol).name.slice(0, -1);
      const stringKey: SLiteral = {
        type: "literal",
        value: keyName,
        _meta: (key as SSymbol)._meta,
      };
      // Parse the value
      const value = parseExpression(state);
      entries.push(stringKey, value);
    } // Check if there's a colon token after the key
    else if (
      state.currentPos < state.tokens.length &&
      state.tokens[state.currentPos].type === TokenType.Colon
    ) {
      // Explicit key:value syntax with separate colon token
      state.currentPos++; // Skip colon
      const value = parseExpression(state);
      entries.push(key, value);
    } else {
      // No colon found - could be shorthand {x y} or nested pattern {x {y z}}
      // Check if this is a rest pattern marker (&)
      if (key.type === "symbol" && (key as SSymbol).name === "&") {
        // Parse the rest argument (must be present)
        if (
          state.currentPos >= state.tokens.length ||
          state.tokens[state.currentPos].type === TokenType.RightBrace
        ) {
          throw new ParseError(
            "Rest pattern '&' must be followed by an identifier",
            errorOptions(startPos, state),
          );
        }
        const restArg = parseExpression(state);
        if (restArg.type !== "symbol") {
          throw new ParseError(
            "Rest pattern argument must be an identifier",
            errorOptions(startPos, state),
          );
        }
        // Add & and rest argument (don't duplicate)
        entries.push(key, restArg);
      } // Check if next token is a nested structure (object or array)
      else if (
        state.currentPos < state.tokens.length &&
        (state.tokens[state.currentPos].type === TokenType.LeftBrace ||
          state.tokens[state.currentPos].type === TokenType.LeftBracket)
      ) {
        // There's a nested pattern/structure following - parse it as the value
        // This handles: {x {y z}}, {x [a b]}, etc.
        const value = parseExpression(state);
        entries.push(key, value);
      } else {
        // Shorthand syntax: {x y} → {x: x, y: y}
        // Only allowed when key is a symbol
        if (key.type !== "symbol") {
          const errorPos = state.currentPos < state.tokens.length
            ? state.tokens[state.currentPos].position
            : startPos;
          throw new ParseError(
            "Expected ':' after key in map literal (shorthand only allowed for symbol keys)",
            errorPos,
          );
        }
        // Duplicate the key as the value
        entries.push(key, key);
      }
    }

    // Check if we need a comma (not at the end of the object)
    if (
      state.currentPos < state.tokens.length &&
      state.tokens[state.currentPos].type === TokenType.Comma
    ) {
      state.currentPos++; // Skip optional comma
    }
  }
  if (state.currentPos >= state.tokens.length) {
    throw new ParseError("Unclosed map", errorOptions(startPos, state));
  }

  // Move past the closing brace
  state.currentPos++;

  let result: SList;
  if (entries.length === 0) {
    result = createList(createSymbol("empty-map"));
  } else {
    result = createList(createSymbol("hash-map"), ...entries);
  }

  // Attach source location
  attachSourceLocation(
    result,
    state.filePath,
    startPos.line,
    startPos.column,
  );

  return result;
}

function parseSet(state: ParserState, startPos: SourcePosition): SList {
  const elements: SExp[] = [];
  while (
    state.currentPos < state.tokens.length &&
    state.tokens[state.currentPos].type !== TokenType.RightBracket
  ) {
    elements.push(parseExpression(state));

    // Check if we need a comma (not at the end of the set)
    if (
      state.currentPos < state.tokens.length &&
      state.tokens[state.currentPos].type === TokenType.Comma
    ) {
      state.currentPos++; // Skip optional comma
    }
  }
  if (state.currentPos >= state.tokens.length) {
    throw new ParseError("Unclosed set", errorOptions(startPos, state));
  }

  // Move past the closing bracket
  state.currentPos++;

  let result: SList;
  if (elements.length === 0) {
    result = createList(createSymbol("empty-set"));
  } else {
    result = createList(createSymbol("hash-set"), ...elements);
  }

  // Attach source location
  attachSourceLocation(
    result,
    state.filePath,
    startPos.line,
    startPos.column,
  );

  return result;
}

/**
 * Get line context for better error messages
 */
function getLineContext(input: string, lineNumber: number): string {
  if (!input) return "";

  const lines = input.split("\n");
  if (lineNumber <= 0 || lineNumber > lines.length) return "";

  return lines[lineNumber - 1].trim();
}
