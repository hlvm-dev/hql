// src/transpiler/tokenizer/type-tokenizer.ts
// Dedicated TypeScript type tokenizer - handles inline type annotations
//
// This module provides all type-related tokenization and normalization logic.
// It is the single source of truth for TypeScript type handling in HQL.

/**
 * Result of tokenizing a TypeScript type annotation
 */
export interface TypeTokenResult {
  /** The extracted type string */
  type: string;
  /** Position where tokenization ended in source */
  endIndex: number;
  /** Whether the type is syntactically valid (balanced brackets) */
  isValid: boolean;
}

/**
 * Result of extracting type annotation from a symbol
 */
export interface TypeExtractionResult {
  /** The identifier name without type annotation */
  name: string;
  /** The type annotation if present, or undefined */
  type: string | undefined;
}

// ============================================================================
// BRACKET DEPTH COUNTING
// ============================================================================

/**
 * Count angle bracket depth in a string.
 * Returns positive if more '<' than '>', negative if more '>' than '<', zero if balanced.
 *
 * @param text - String to analyze
 * @returns Depth count (positive = unbalanced open, negative = unbalanced close)
 */
export function countAngleBracketDepth(text: string): number {
  let depth = 0;
  for (const c of text) {
    if (c === "<") depth++;
    else if (c === ">") depth--;
  }
  return depth;
}

/**
 * Count brace depth in a string.
 * Returns positive if more '{' than '}', zero if balanced.
 *
 * @param text - String to analyze
 * @returns Depth count (positive = unbalanced open)
 */
export function countBraceDepth(text: string): number {
  let depth = 0;
  for (const c of text) {
    if (c === "{") depth++;
    else if (c === "}") depth--;
  }
  return depth;
}

/**
 * Count bracket depth in a string.
 * Returns positive if more '[' than ']', zero if balanced.
 *
 * @param text - String to analyze
 * @returns Depth count (positive = unbalanced open)
 */
export function countBracketDepth(text: string): number {
  let depth = 0;
  for (const c of text) {
    if (c === "[") depth++;
    else if (c === "]") depth--;
  }
  return depth;
}

/**
 * Count parenthesis depth in a string.
 * Returns positive if more '(' than ')', zero if balanced.
 *
 * @param text - String to analyze
 * @returns Depth count (positive = unbalanced open)
 */
export function countParenDepth(text: string): number {
  let depth = 0;
  for (const c of text) {
    if (c === "(") depth++;
    else if (c === ")") depth--;
  }
  return depth;
}

// ============================================================================
// BALANCED BRACKET SCANNING
// ============================================================================

/**
 * TypeScript type keywords that can appear in inline type annotations.
 * These keywords need special handling as they're followed by more type content.
 */
const TYPE_KEYWORDS = new Set([
  "keyof",
  "typeof",
  "readonly",
  "infer",
  "extends",
  "unique", // unique symbol
  "asserts", // asserts x is T
  "new", // constructor types: new () => T
  "is", // type predicates: x is string
  "abstract", // abstract constructors: abstract new () => T
  "satisfies", // satisfies operator (TS 4.9+)
]);

/**
 * Check if a word at the current position is a type keyword.
 * Returns the keyword if found, or null otherwise.
 */
function matchTypeKeyword(source: string, pos: number): string | null {
  for (const kw of TYPE_KEYWORDS) {
    if (
      source.slice(pos, pos + kw.length) === kw &&
      (pos + kw.length >= source.length ||
        !/[a-zA-Z0-9_$]/.test(source[pos + kw.length]))
    ) {
      return kw;
    }
  }
  return null;
}

/**
 * Valid characters inside type annotations
 */
function isValidTypeChar(c: string): boolean {
  // Includes:
  // - Identifiers: a-zA-Z0-9_$
  // - Private fields: #
  // - Brackets: <>, {}, [], ()
  // - Operators: |, &, ?, :, =, -, +, !
  // - Separators: ,, ., ;, whitespace
  // - Template literals: `, ', "
  // - Import paths: /
  // - Unicode escapes: \
  return /[a-zA-Z0-9_$#<>,|&?:\s\-\+\.\{\}\[\]\(\)=`'"\/;!\\]/.test(c);
}

/**
 * Scan balanced brackets/braces from a starting position.
 * Handles both angle brackets (<>) and braces ({}) for type annotations.
 * This handles cases like `x:Record<string,number>` or `x:Map<string,{id:number}>`
 * where delimiters would normally split the symbol.
 *
 * @param input - The full input string
 * @param cursor - Position after the initial symbol match
 * @param angleDepth - Current angle bracket depth (positive means unbalanced '<')
 * @param braceDepth - Current brace depth (positive means unbalanced '{')
 * @returns Additional characters to append to the symbol, or empty string if none
 */
export function scanBalancedBrackets(
  input: string,
  cursor: number,
  angleDepth: number,
  braceDepth: number = 0,
): string {
  if (angleDepth <= 0 && braceDepth <= 0) return "";

  let result = "";
  let pos = cursor;

  while (pos < input.length && (angleDepth > 0 || braceDepth > 0)) {
    const c = input[pos];

    // Stop at delimiters that close the containing context
    if (c === ")" || c === "]") break;

    // Track bracket depths
    if (c === "<") {
      angleDepth++;
      result += c;
      pos++;
    } else if (c === ">") {
      angleDepth--;
      result += c;
      pos++;
    } else if (c === "{") {
      braceDepth++;
      result += c;
      pos++;
    } else if (c === "}") {
      braceDepth--;
      result += c;
      pos++;
    } else if (isValidTypeChar(c)) {
      result += c;
      pos++;
    } else {
      // Invalid character for type parameter, stop
      break;
    }

    // If balanced, check for trailing []
    if (angleDepth === 0 && braceDepth === 0) {
      if (pos + 1 < input.length && input[pos] === "[" && input[pos + 1] === "]") {
        result += "[]";
        pos += 2;
      }
      break;
    }
  }

  return result;
}

// ============================================================================
// TYPE TOKENIZATION
// ============================================================================

/**
 * Check if a symbol value looks like it contains a type annotation.
 * Used to determine whether to apply type scanning logic.
 *
 * @param value - Symbol value to check
 * @returns True if the value appears to contain a type annotation
 */
export function looksLikeTypeAnnotation(value: string): boolean {
  // Contains a colon (type annotation separator)
  if (value.includes(":")) return true;
  // Starts with identifier followed by angle bracket (generic)
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*</.test(value)) return true;
  return false;
}

/**
 * Tokenize a TypeScript type annotation from source string.
 * Handles: generics, unions, intersections, arrays, tuples,
 * object literals, function types, conditional types, mapped types,
 * type keywords (keyof, typeof, readonly, infer), template literals.
 *
 * This is the main entry point for type tokenization when processing
 * inline type annotations in the parser.
 *
 * @param source - Source string
 * @param startIndex - Position to start tokenizing from
 * @returns TypeTokenResult with extracted type, end position, and validity
 */
export function tokenizeType(source: string, startIndex: number): TypeTokenResult {
  let pos = startIndex;
  let type = "";
  let angleDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;

  // Skip leading whitespace
  while (pos < source.length && /\s/.test(source[pos])) {
    pos++;
  }

  // Determine if type is nullable (starts with ?)
  const isNullable = source[pos] === "?";
  if (isNullable) {
    type += "?";
    pos++;
  }

  // Track if we just saw a union/intersection operator and need to continue
  let afterOperator = false;
  // Track if we're expecting a type after a keyword
  let afterKeyword = false;

  // Stack of bracket depths for active conditional types.
  // Each entry stores the total bracket depth at which 'extends' was encountered.
  const conditionalStack: number[] = [];

  // Current total bracket depth
  const currentDepth = () => angleDepth + braceDepth + bracketDepth + parenDepth;

  // Tokenize the type expression
  while (pos < source.length) {
    const c = source[pos];

    // Handle template literal types
    if (c === "`") {
      let templateType = "`";
      pos++;
      while (pos < source.length && source[pos] !== "`") {
        templateType += source[pos];
        pos++;
      }
      if (pos < source.length) {
        templateType += "`";
        pos++;
      }
      type += templateType;
      afterOperator = false;
      afterKeyword = false;
      continue;
    }

    // Handle string literal types (single and double quotes)
    if (c === '"' || c === "'") {
      const quote = c;
      let stringType = quote;
      pos++;
      while (pos < source.length && source[pos] !== quote) {
        // Handle escaped quotes
        if (source[pos] === "\\" && pos + 1 < source.length) {
          stringType += source[pos] + source[pos + 1];
          pos += 2;
        } else {
          stringType += source[pos];
          pos++;
        }
      }
      if (pos < source.length) {
        stringType += quote;
        pos++;
      }
      type += stringType;
      afterOperator = false;
      afterKeyword = false;
      continue;
    }

    // Handle delimiters that end a type in HQL context
    if (
      (c === ")" || c === "]" || c === "}") &&
      angleDepth === 0 &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenDepth === 0 &&
      conditionalStack.length === 0 &&
      !afterOperator &&
      !afterKeyword
    ) {
      break;
    }

    // Handle whitespace
    if (/\s/.test(c)) {
      if (
        angleDepth === 0 &&
        braceDepth === 0 &&
        bracketDepth === 0 &&
        parenDepth === 0 &&
        conditionalStack.length === 0 &&
        !afterOperator &&
        !afterKeyword
      ) {
        // Skip whitespace and check what follows
        let peekPos = pos;
        while (peekPos < source.length && /\s/.test(source[peekPos])) {
          peekPos++;
        }

        // Check for continuation: operators, keywords, or conditional operators
        const nextChar = source[peekPos];
        const keyword = matchTypeKeyword(source, peekPos);

        if (nextChar === "|" || nextChar === "&") {
          // Union/intersection continues
          type += c;
          pos++;
          continue;
        } else if (nextChar === "?" && conditionalStack.length > 0) {
          // Conditional type continues
          type += c;
          pos++;
          continue;
        } else if (
          peekPos + 1 < source.length &&
          source[peekPos] === "=" &&
          source[peekPos + 1] === ">"
        ) {
          // Function return arrow (=>) - continue scanning return type
          type += c;
          pos++;
          continue;
        } else if (keyword) {
          // Type keyword continues (e.g., `T extends keyof U`)
          type += c;
          pos++;
          continue;
        } else {
          // End of type
          break;
        }
      }
      type += c;
      pos++;
      continue;
    }

    // Check for type keyword at word boundary
    const keyword = matchTypeKeyword(source, pos);
    if (keyword) {
      type += keyword;
      pos += keyword.length;
      afterKeyword = true;
      afterOperator = false;
      if (keyword === "extends") {
        conditionalStack.push(currentDepth());
      }
      continue;
    }

    // Handle conditional type operators ? and :
    if (c === "?" && conditionalStack.length > 0 && currentDepth() === conditionalStack[conditionalStack.length - 1]) {
      // This is a conditional type ternary operator
      type += c;
      pos++;
      afterOperator = true; // Need a type after ?
      continue;
    }

    if (c === ":" && conditionalStack.length > 0 && currentDepth() === conditionalStack[conditionalStack.length - 1]) {
      // This is a conditional type false branch separator
      type += c;
      pos++;
      conditionalStack.pop(); // Close one level of conditional
      afterOperator = true; // Need a type after :
      continue;
    }

    // Track bracket depths
    if (c === "<") {
      angleDepth++;
      afterOperator = false;
      afterKeyword = false;
    } else if (c === ">") {
      // Check if this is part of => arrow (not a closing angle bracket)
      const prevChar = type.length > 0 ? type[type.length - 1] : "";
      if (prevChar === "=") {
        // This is => arrow, need to continue for return type
        afterOperator = true;
        afterKeyword = false;
      } else {
        angleDepth--;
        afterOperator = false;
        afterKeyword = false;
      }
    } else if (c === "{") {
      braceDepth++;
      afterOperator = false;
      afterKeyword = false;
    } else if (c === "}") {
      braceDepth--;
      afterOperator = false;
      afterKeyword = false;
    } else if (c === "[") {
      bracketDepth++;
      afterOperator = false;
      afterKeyword = false;
    } else if (c === "]") {
      bracketDepth--;
      afterOperator = false;
      afterKeyword = false;
    } else if (c === "(") {
      parenDepth++;
      afterOperator = false;
      afterKeyword = false;
    } else if (c === ")") {
      parenDepth--;
      afterOperator = false;
      afterKeyword = false;
    } else if (c === "|" || c === "&") {
      // Union or intersection operator - continue scanning
      afterOperator = true;
      afterKeyword = false;
    } else if (/[a-zA-Z_$0-9]/.test(c)) {
      // Regular identifier character - clear operator and keyword flags
      afterOperator = false;
      afterKeyword = false;
    }

    // Valid type character
    if (isValidTypeChar(c)) {
      type += c;
      pos++;
    } else {
      // Invalid character, stop
      break;
    }

    // Check for completion when balanced
    if (
      angleDepth === 0 &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenDepth === 0 &&
      conditionalStack.length === 0 &&
      !afterOperator &&
      !afterKeyword
    ) {
      // Peek ahead for array suffix or continuation
      const next = source[pos];
      if (next === "[") {
        // Check for array suffix []
        if (pos + 1 < source.length && source[pos + 1] === "]") {
          type += "[]";
          pos += 2;
        }
      } else if (next === "|" || next === "&") {
        // Union or intersection continues the type
        continue;
      } else if (/[a-zA-Z_$<\{\(\[]/.test(next)) {
        // More type content
        continue;
      }
    }
  }

  const isValid =
    angleDepth === 0 &&
    braceDepth === 0 &&
    bracketDepth === 0 &&
    parenDepth === 0 &&
    conditionalStack.length === 0;

  return {
    type: type.trim(),
    endIndex: pos,
    isValid,
  };
}

/**
 * Tokenize an inline object type annotation.
 * Handles syntax like :{name:string, age:number}
 *
 * @param source - Source string
 * @param startIndex - Position at the opening '{' (after ':')
 * @returns TypeTokenResult with the complete object type
 */
export function tokenizeObjectType(source: string, startIndex: number): TypeTokenResult {
  let braceDepth = 1;
  let pos = startIndex + 1; // After '{'
  let type = "{";

  while (pos < source.length && braceDepth > 0) {
    const c = source[pos];
    type += c;
    if (c === "{") braceDepth++;
    else if (c === "}") braceDepth--;
    pos++;
  }

  // Check for trailing []
  if (pos + 1 < source.length && source[pos] === "[" && source[pos + 1] === "]") {
    type += "[]";
    pos += 2;
  }

  return {
    type,
    endIndex: pos,
    isValid: braceDepth === 0,
  };
}

/**
 * Tokenize a tuple type annotation.
 * Handles syntax like [string, number] or [...T]
 *
 * @param source - Source string
 * @param startIndex - Position at the opening '['
 * @returns TypeTokenResult with the complete tuple type
 */
export function tokenizeTupleType(source: string, startIndex: number): TypeTokenResult {
  let bracketDepth = 1;
  let pos = startIndex + 1; // After '['
  let type = "[";

  while (pos < source.length && bracketDepth > 0) {
    const c = source[pos];
    type += c;
    if (c === "[") bracketDepth++;
    else if (c === "]") bracketDepth--;
    pos++;
  }

  return {
    type,
    endIndex: pos,
    isValid: bracketDepth === 0,
  };
}

/**
 * Tokenize a function type annotation.
 * Handles syntax like (a: number, b: string) => boolean
 *
 * @param source - Source string
 * @param startIndex - Position at the opening '('
 * @returns TypeTokenResult with the complete function type
 */
export function tokenizeFunctionType(source: string, startIndex: number): TypeTokenResult {
  let parenDepth = 1;
  let pos = startIndex + 1; // After '('
  let type = "(";

  // Scan parameter list
  while (pos < source.length && parenDepth > 0) {
    const c = source[pos];
    type += c;
    if (c === "(") parenDepth++;
    else if (c === ")") parenDepth--;
    pos++;
  }

  // Skip whitespace before arrow
  while (pos < source.length && /\s/.test(source[pos])) {
    pos++;
  }

  // Check for arrow
  if (pos + 1 < source.length && source[pos] === "=" && source[pos + 1] === ">") {
    type += "=>";
    pos += 2;

    // Skip whitespace after arrow
    while (pos < source.length && /\s/.test(source[pos])) {
      pos++;
    }

    // Scan return type
    let angleDepth = 0;
    let braceDepth = 0;

    while (pos < source.length) {
      const c = source[pos];

      if (c === "<") angleDepth++;
      else if (c === ">") angleDepth--;
      else if (c === "{") braceDepth++;
      else if (c === "}") braceDepth--;

      // Stop at delimiters when balanced
      if (angleDepth === 0 && braceDepth === 0 && /[\s\)\]\}]/.test(c)) {
        break;
      }

      type += c;
      pos++;
    }
  }

  return {
    type,
    endIndex: pos,
    isValid: parenDepth === 0,
  };
}

// ============================================================================
// TYPE NORMALIZATION
// ============================================================================

/**
 * Normalize HQL type syntax to valid TypeScript.
 *
 * Transformations:
 * - ?T → (T) | null | undefined  (nullable shorthand)
 * - T[] → Array<T>               (array shorthand)
 *
 * Preserves:
 * - T extends U ? A : B          (conditional types - NOT transformed)
 *
 * @param type - Type string with HQL type syntax
 * @returns Normalized type string with valid TypeScript syntax
 *
 * @example
 * ```typescript
 * normalizeType("?string")     // → "(string) | null | undefined"
 * normalizeType("number[]")    // → "Array<number>"
 * normalizeType("?string[]")   // → "(Array<string>) | null | undefined"
 * normalizeType("string")      // → "string"
 * ```
 */
export function normalizeType(type: string): string {
  // 1. Check for conditional type FIRST (contains "extends...?...:")
  //    These should NOT be transformed
  if (/\bextends\b[^?]*\?[^:]*:/.test(type)) {
    return type;
  }

  // 2. Handle ?T nullable prefix → (T) | null | undefined
  if (type.startsWith("?")) {
    const innerType = normalizeType(type.slice(1));
    return `(${innerType}) | null | undefined`;
  }

  // 3. Handle T[] → Array<T>
  const arrayMatch = type.match(/^(.+)\[\]$/);
  if (arrayMatch) {
    const elementType = normalizeType(arrayMatch[1]);
    return `Array<${elementType}>`;
  }

  return type;
}

// Backward compatibility alias
export { normalizeType as normalizeArrayType };

// ============================================================================
// TYPE EXTRACTION FROM SYMBOLS
// ============================================================================

/**
 * Find the colon separating a parameter name from its type annotation.
 *
 * This function correctly handles complex type annotations with nested
 * angle brackets like `Array<Record<string, number>>` or `(x: A) => B`,
 * where naive indexOf(":") would incorrectly split inside the generic.
 *
 * @param paramSymbol - Symbol string potentially containing name:type
 * @returns Index of the type-separating colon, or -1 if not found
 *
 * @example
 * ```typescript
 * findTypeAnnotationColon("x:number")                    // → 1
 * findTypeAnnotationColon("x:Array<Record<string,number>>")  // → 1
 * findTypeAnnotationColon("x")                           // → -1
 * ```
 */
export function findTypeAnnotationColon(paramSymbol: string): number {
  let angleDepth = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < paramSymbol.length; i++) {
    const char = paramSymbol[i];

    if (char === "<") angleDepth++;
    else if (char === ">") angleDepth--;
    else if (char === "(") parenDepth++;
    else if (char === ")") parenDepth--;
    else if (char === "{") braceDepth++;
    else if (char === "}") braceDepth--;
    else if (char === "[") bracketDepth++;
    else if (char === "]") bracketDepth--;
    else if (
      char === ":" &&
      angleDepth === 0 &&
      parenDepth === 0 &&
      braceDepth === 0 &&
      bracketDepth === 0
    ) {
      return i;
    }
  }

  return -1;
}

/**
 * Extract type annotation from a symbol string.
 * Separates the identifier name from its type annotation.
 *
 * @param symbol - Symbol string like "x:number" or "data:Array<string>"
 * @returns Object with name and optional type
 *
 * @example
 * ```typescript
 * extractTypeFromSymbol("x:number")           // → { name: "x", type: "number" }
 * extractTypeFromSymbol("data:Array<string>") // → { name: "data", type: "Array<string>" }
 * extractTypeFromSymbol("x")                  // → { name: "x", type: undefined }
 * ```
 */
export function extractTypeFromSymbol(symbol: string): TypeExtractionResult {
  const colonIndex = findTypeAnnotationColon(symbol);

  if (colonIndex === -1) {
    return { name: symbol, type: undefined };
  }

  const name = symbol.slice(0, colonIndex).trim();
  const type = symbol.slice(colonIndex + 1).trim();

  return {
    name,
    type: type || undefined,
  };
}

/**
 * Extract and normalize type annotation from a symbol string.
 * Combines extraction and normalization in one call.
 *
 * @param symbol - Symbol string like "x:?number" or "arr:string[]"
 * @returns Object with name and normalized type
 *
 * @example
 * ```typescript
 * extractAndNormalizeType("x:?number")    // → { name: "x", type: "(number) | null | undefined" }
 * extractAndNormalizeType("arr:string[]") // → { name: "arr", type: "Array<string>" }
 * ```
 */
export function extractAndNormalizeType(symbol: string): TypeExtractionResult {
  const { name, type } = extractTypeFromSymbol(symbol);

  return {
    name,
    type: type ? normalizeType(type) : undefined,
  };
}
