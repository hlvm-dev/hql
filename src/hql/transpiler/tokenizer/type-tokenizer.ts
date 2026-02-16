// src/hql/transpiler/tokenizer/type-tokenizer.ts
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
  /** Effect annotation extracted from (Pure ...) or (Impure ...) wrapper */
  effect?: "Pure" | "Impure";
}

// ============================================================================
// PRE-COMPILED REGEX PATTERNS (avoid compilation in hot loops)
// ============================================================================

/** Matches whitespace characters */
const WHITESPACE_REGEX = /\s/;
/** Matches identifier continuation characters (for keyword boundary check) */
const IDENTIFIER_CHAR_REGEX = /[a-zA-Z0-9_$]/;
/** Matches valid characters inside type annotations */
const VALID_TYPE_CHAR_REGEX = /[a-zA-Z0-9_$#<>,|&?:\s\-\+\.\{\}\[\]\(\)=`'"\/;!\\]/;
/** Matches type continuation start characters */
const TYPE_CONTINUATION_START_REGEX = /[a-zA-Z_$<\{\(\[]/;
/** Matches type delimiter characters (whitespace, closing brackets) */
const TYPE_DELIMITER_REGEX = /[\s\)\]\}]/;
/** Matches conditional type pattern (extends...?...:) */
const CONDITIONAL_TYPE_REGEX = /\bextends\b[^?]*\?[^:]*:/;

// ============================================================================
// BRACKET DEPTH COUNTING
// ============================================================================

/**
 * Generic bracket depth counter.
 * @param text - String to analyze
 * @param open - Opening bracket character
 * @param close - Closing bracket character
 * @returns Depth count (positive = unbalanced open, negative = unbalanced close)
 */
function countDepth(text: string, open: string, close: string): number {
  let depth = 0;
  for (const c of text) {
    if (c === open) depth++;
    else if (c === close) depth--;
  }
  return depth;
}

/** Count angle bracket depth: positive if more '<' than '>' */
export const countAngleBracketDepth = (text: string): number => countDepth(text, "<", ">");

/** Count brace depth: positive if more '{' than '}' */
export const countBraceDepth = (text: string): number => countDepth(text, "{", "}");

/** Count bracket depth: positive if more '[' than ']' */
export const countBracketDepth = (text: string): number => countDepth(text, "[", "]");

/** Count parenthesis depth: positive if more '(' than ')' */
export const countParenDepth = (text: string): number => countDepth(text, "(", ")");

// ============================================================================
// TYPE PARAMETER SPLITTING
// ============================================================================

/**
 * Split a type parameter string respecting bracket nesting.
 * Unlike simple string.split(","), this correctly handles nested types.
 *
 * Example:
 * - Input: "Record<string,number>,Array<T>"
 * - Output: ["Record<string,number>", "Array<T>"]
 *
 * Without depth-aware splitting, we'd incorrectly get:
 * - ["Record<string", "number>", "Array<T>"]
 *
 * @param typeParamString - The type parameter string (without surrounding brackets)
 * @returns Array of individual type parameters
 */
export function splitTypeParameters(typeParamString: string): string[] {
  const params: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of typeParamString) {
    if (char === "<" || char === "(" || char === "[" || char === "{") {
      depth++;
      current += char;
    } else if (char === ">" || char === ")" || char === "]" || char === "}") {
      depth--;
      current += char;
    } else if (char === "," && depth === 0) {
      // Only split on comma when at depth 0 (not inside nested brackets)
      params.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  // Don't forget the last parameter
  if (current.trim()) {
    params.push(current.trim());
  }

  return params;
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
      source.startsWith(kw, pos) &&
      (pos + kw.length >= source.length ||
        !IDENTIFIER_CHAR_REGEX.test(source[pos + kw.length]))
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
  // Uses pre-compiled module-level regex for performance
  return VALID_TYPE_CHAR_REGEX.test(c);
}

// ============================================================================
// TYPE TOKENIZATION
// ============================================================================

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
  while (pos < source.length && WHITESPACE_REGEX.test(source[pos])) {
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
    if (WHITESPACE_REGEX.test(c)) {
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
        while (peekPos < source.length && WHITESPACE_REGEX.test(source[peekPos])) {
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
    } else if (IDENTIFIER_CHAR_REGEX.test(c)) {
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
      } else if (TYPE_CONTINUATION_START_REGEX.test(next)) {
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
  while (pos < source.length && WHITESPACE_REGEX.test(source[pos])) {
    pos++;
  }

  // Check for arrow
  if (pos + 1 < source.length && source[pos] === "=" && source[pos + 1] === ">") {
    type += "=>";
    pos += 2;

    // Skip whitespace after arrow
    while (pos < source.length && WHITESPACE_REGEX.test(source[pos])) {
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
      if (angleDepth === 0 && braceDepth === 0 && TYPE_DELIMITER_REGEX.test(c)) {
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
 * Normalize HQL/Swift type syntax to valid TypeScript.
 *
 * Handles (in order): conditional passthrough, ?T / T? nullables, T[] arrays,
 * (Pure/Impure ...) effect types, (fn/-> [...] R) function types,
 * Swift name mapping (Int→number, String→string, etc.), and
 * generic recursion (Array<Int>→Array<number>, Optional<T>→nullable).
 */

/**
 * Extract effect annotation from a type like (Pure number number) or (Impure string number).
 * Uses depth-aware parsing, NOT regex, to handle nested types correctly.
 */
export function extractEffect(rawType: string): {
  effect?: "Pure" | "Impure";
  innerType: string;
} {
  const trimmed = rawType.trim();
  if (!trimmed.startsWith("(")) return { innerType: rawType };

  let effect: "Pure" | "Impure" | undefined;
  let prefixLen: number;

  if (trimmed.startsWith("(fx ")) {
    effect = "Pure";
    prefixLen = 4;
  } else if (trimmed.startsWith("(fn ") && !trimmed.startsWith("(fn [")) {
    effect = "Impure";
    prefixLen = 4;
  } else if (trimmed.startsWith("(Pure ")) {
    effect = "Pure";
    prefixLen = 6;
  } else if (trimmed.startsWith("(Impure ")) {
    effect = "Impure";
    prefixLen = 8;
  } else {
    return { innerType: rawType };
  }

  // Find matching close paren using depth tracking
  let depth = 1; // we're inside the opening paren
  let i = prefixLen;
  for (; i < trimmed.length && depth > 0; i++) {
    const ch = trimmed[i];
    if (ch === "(" || ch === "[" || ch === "<" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === ">" || ch === "}") depth--;
  }

  if (depth !== 0) return { innerType: rawType }; // malformed, pass through

  const innerType = trimmed.slice(prefixLen, i - 1).trim();
  return { effect, innerType };
}

/**
 * Split effect type parameters on whitespace, respecting nested brackets.
 * Like splitTypeParameters but splits on whitespace instead of comma.
 * e.g. "number number" → ["number", "number"]
 *      "(fn [number] string) number" → ["(fn [number] string)", "number"]
 */
export function splitEffectTypeParams(inner: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of inner) {
    if (char === "(" || char === "[" || char === "<" || char === "{") {
      depth++;
      current += char;
    } else if (char === ")" || char === "]" || char === ">" || char === "}") {
      depth--;
      current += char;
    } else if (/\s/.test(char) && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Maps Swift-style type names to TypeScript equivalents */
const SWIFT_TYPE_MAP: Record<string, string> = {
  // Core Swift types
  "Int": "number",
  "String": "string",
  "Bool": "boolean",
  "Double": "number",
  "Float": "number",
  "Void": "void",
  "Any": "any",
  // Extended Swift numeric types
  "UInt": "number",
  "Int8": "number",
  "Int16": "number",
  "Int32": "number",
  "Int64": "number",
  "UInt8": "number",
  "UInt16": "number",
  "UInt32": "number",
  "UInt64": "number",
  "Float16": "number",
  "Float32": "number",
  "Float64": "number",
  "Float80": "number",
  // Swift Character → TS string (single char is still a string in JS/TS)
  "Character": "string",
  // Swift special types
  "Never": "never",
  "Nothing": "never",
  "AnyObject": "object",
  // Swift Dictionary → TS Map (generic base name, used in step 7)
  "Dictionary": "Map",
};

function wrapNullable(normalizedType: string): string {
  return `(${normalizedType}) | null | undefined`;
}

/**
 * Find the index of the first depth-0 `|` or `&` in a type string.
 * Respects nesting in `<>`, `()`, `[]`, `{}` so that delimiters inside
 * generics, tuples, or function signatures are not matched.
 *
 * @returns The index of the first depth-0 delimiter, or -1 if none found
 */
function findDepthZeroDelimiter(type: string): number {
  let depth = 0;
  for (let i = 0; i < type.length; i++) {
    const c = type[i];
    if (c === "<" || c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ">" || c === ")" || c === "]" || c === "}") {
      depth--;
    } else if ((c === "|" || c === "&") && depth === 0) {
      return i;
    }
  }
  return -1;
}

/**
 * Find the index of the first depth-0 occurrence of a specific character.
 * Respects nesting in `<>`, `()`, `[]`, `{}`.
 *
 * @returns The index of the first depth-0 character, or -1 if none found
 */
function findDepthZeroChar(type: string, charToFind: string): number {
  let depth = 0;
  for (let i = 0; i < type.length; i++) {
    const c = type[i];
    if (c === "<" || c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ">" || c === ")" || c === "]" || c === "}") {
      depth--;
    } else if (c === charToFind && depth === 0) {
      return i;
    }
  }
  return -1;
}

export function normalizeType(type: string): string {
  if (CONDITIONAL_TYPE_REGEX.test(type)) return type;

  // Prefix ?T or postfix T? → nullable
  if (type.startsWith("?")) return wrapNullable(normalizeType(type.slice(1)));
  if (type.endsWith("?") && type.length > 1) return wrapNullable(normalizeType(type.slice(0, -1)));

  // T[] → Array<T>
  const arrayMatch = type.match(/^(.+)\[\]$/);
  if (arrayMatch) return `Array<${normalizeType(arrayMatch[1])}>`;

  // Swift [T] array shorthand → Array<T>
  // Swift [K: V] dictionary shorthand → Map<K, V>
  if (type.startsWith("[") && type.endsWith("]")) {
    const inner = type.slice(1, -1).trim();
    if (inner.length > 0) {
      const colonIdx = findDepthZeroChar(inner, ":");
      if (colonIdx > 0) {
        const keyType = normalizeType(inner.slice(0, colonIdx).trim());
        const valType = normalizeType(inner.slice(colonIdx + 1).trim());
        return `Map<${keyType}, ${valType}>`;
      }

      const parts = splitTypeParameters(inner);
      if (parts.length === 1) return `Array<${normalizeType(parts[0])}>`;
    }
  }

  // Swift (T, U) tuple shorthand → [T, U] TS tuple (only when commas present)
  if (type.startsWith("(") && type.endsWith(")") && type.includes(",")) {
    const inner = type.slice(1, -1);
    const parts = splitTypeParameters(inner);
    if (parts.length >= 2) {
      const normalized = parts.map(p => normalizeType(p.trim()));
      return `[${normalized.join(", ")}]`;
    }
  }

  // (Pure ...) / (Impure ...) effect types → TS function type
  const { effect, innerType } = extractEffect(type);
  if (effect) {
    const parts = splitEffectTypeParams(innerType);
    if (parts.length === 0) return `() => void`;
    const returnType = normalizeType(parts[parts.length - 1]);
    const paramTypes = parts.slice(0, -1);
    if (paramTypes.length === 0) return `() => ${returnType}`;
    const tsParams = paramTypes.map((pt, i) => `arg${i}: ${normalizeType(pt)}`);
    return `(${tsParams.join(", ")}) => ${returnType}`;
  }

  // (fn [params] ReturnType) / (-> [params] ReturnType) → TS function type
  const fnTypeMatch = type.match(/^\((fn|->)\s+\[([^\]]*)\]\s+(.+)\)$/);
  if (fnTypeMatch) {
    const paramTypesStr = fnTypeMatch[2].trim();
    const returnType = normalizeType(fnTypeMatch[3].trim());
    if (!paramTypesStr) return `() => ${returnType}`;
    const paramTypes = paramTypesStr.split(/\s+/).filter(Boolean);
    const tsParams = paramTypes.map((pt, i) => `arg${i}: ${normalizeType(pt)}`);
    return `(${tsParams.join(", ")}) => ${returnType}`;
  }

  // Swift type name → TS equivalent
  const mapped = SWIFT_TYPE_MAP[type];
  if (mapped) return mapped;

  // Generic<Params> → recursively normalize inner types
  const genericMatch = type.match(/^([A-Za-z_$][A-Za-z0-9_$]*)<(.+)>$/);
  if (genericMatch) {
    if (genericMatch[1] === "Optional") return wrapNullable(normalizeType(genericMatch[2].trim()));
    if (genericMatch[1] === "Tuple") {
      const params = splitTypeParameters(genericMatch[2]);
      return `[${params.map(p => normalizeType(p.trim())).join(", ")}]`;
    }
    const baseName = SWIFT_TYPE_MAP[genericMatch[1]] ?? genericMatch[1];
    const params = splitTypeParameters(genericMatch[2]);
    return `${baseName}<${params.map(p => normalizeType(p.trim())).join(", ")}>`;
  }

  // Union (|) and intersection (&) types — split at depth 0, normalize each part
  const delimIndex = findDepthZeroDelimiter(type);
  if (delimIndex !== -1) {
    const delim = type[delimIndex];
    const leftPart = type.substring(0, delimIndex);
    const rightPart = type.substring(delimIndex + 1);
    const leftTrimmed = leftPart.trimEnd();
    const rightTrimmed = rightPart.trimStart();
    const trailingWs = leftPart.substring(leftTrimmed.length);
    const leadingWs = rightPart.substring(0, rightPart.length - rightTrimmed.length);
    return normalizeType(leftTrimmed) + trailingWs + delim + leadingWs + normalizeType(rightTrimmed);
  }

  return type;
}

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
  if (!type) return { name, type: undefined };

  const { effect } = extractEffect(type);
  return {
    name,
    type: normalizeType(type),  // normalizeType now handles (Pure ...) → TS fn type
    effect,                      // separate structured field
  };
}
