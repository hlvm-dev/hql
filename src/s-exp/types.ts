// core/src/s-exp/types.ts - Modified to support source location metadata

import {
  HASH_MAP_INTERNAL,
  HASH_MAP_USER,
  VECTOR_SYMBOL,
  EMPTY_ARRAY_SYMBOL,
} from "../common/runtime-helper-impl.ts";

export type SExp = SSymbol | SList | SLiteral;

// Destructuring pattern types
export type Pattern = IdentifierPattern | ArrayPattern | ObjectPattern;

export interface IdentifierPattern {
  type: "IdentifierPattern";
  name: string;
  default?: SExp; // Default value expression
  _meta?: SExpMeta;
}

export interface ArrayPattern {
  type: "ArrayPattern";
  elements: (Pattern | SkipPattern | RestPattern | null)[];
  default?: SExp; // Default value expression (for nested patterns)
  _meta?: SExpMeta;
}

export interface ObjectPattern {
  type: "ObjectPattern";
  properties: PropertyPattern[];
  rest?: IdentifierPattern;
  default?: SExp; // Default value expression (for nested patterns)
  _meta?: SExpMeta;
}

export interface PropertyPattern {
  type: "PropertyPattern";
  key: string;
  value: Pattern;
  default?: SExp; // Default value expression
  _meta?: SExpMeta;
}

export interface SkipPattern {
  type: "SkipPattern"; // Represents _ in patterns
  _meta?: SExpMeta;
}

export interface RestPattern {
  type: "RestPattern";
  argument: IdentifierPattern;
  _meta?: SExpMeta;
}

export interface SExpMeta {
  filePath?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  _meta?: SExpMeta; // Allow nested metadata
}

export interface SSymbol {
  type: "symbol";
  name: string;
  _meta?: SExpMeta; // Optional metadata for source location
}

export interface SList {
  type: "list";
  elements: SExp[];
  _meta?: SExpMeta; // Optional metadata for source location
}

export interface SLiteral {
  type: "literal";
  value: string | number | boolean | null;
  _meta?: SExpMeta; // Optional metadata for source location
}

/**
 * Helper functions to create S-expressions
 */
export function createSymbol(name: string): SSymbol {
  return { type: "symbol", name };
}

export function createList(...elements: SExp[]): SList {
  return { type: "list", elements };
}

/**
 * Safely extract _meta from any object that might have it.
 * Returns the metadata object or undefined if not present.
 * This is the single source of truth for _meta access.
 */
export function getMeta(node: unknown): SExpMeta | undefined {
  if (node && typeof node === "object" && "_meta" in node) {
    const meta = (node as { _meta?: SExpMeta })._meta;
    return meta ?? undefined;
  }
  return undefined;
}

/**
 * Copy metadata from a source object to a target object.
 * Works with any object that has a _meta property (SExp, HQLNode, etc.)
 * Returns the target for chaining.
 */
export function copyMeta<T>(source: unknown, target: T): T {
  const meta = getMeta(source);
  if (meta) {
    (target as { _meta?: SExpMeta })._meta = { ...meta };
  }
  return target;
}

/**
 * Create a new list while preserving metadata from a source S-expression.
 * This is essential for source location tracking through transformations.
 *
 * In a production compiler/transpiler, source location must flow through
 * all AST transformations so error messages can point to the original source.
 */
export function createListFrom(source: SExp, elements: SExp[]): SList {
  const list: SList = { type: "list", elements };
  return copyMeta(source, list);
}

export function createLiteral(
  value: string | number | boolean | null,
): SLiteral {
  return { type: "literal", value };
}

export function createNilLiteral(): SLiteral {
  return { type: "literal", value: null };
}

/**
 * Type guards for S-expressions
 */
export function isSymbol(exp: SExp): exp is SSymbol {
  return exp.type === "symbol";
}

export function isList(exp: SExp): exp is SList {
  return exp.type === "list";
}

export function isLiteral(exp: SExp): exp is SLiteral {
  return exp.type === "literal";
}

/**
 * Check if an S-expression is a specific form
 */
export function isForm(exp: SExp, formName: string): boolean {
  return isList(exp) &&
    exp.elements.length > 0 &&
    isSymbol(exp.elements[0]) &&
    exp.elements[0].name === formName;
}

export function isDefMacro(exp: SExp): boolean {
  return isForm(exp, "macro");
}

export function isImport(exp: SExp): boolean {
  return isForm(exp, "import");
}

/**
 * Pattern helper functions
 */
export function createIdentifierPattern(
  name: string,
  defaultValue?: SExp,
): IdentifierPattern {
  return { type: "IdentifierPattern", name, default: defaultValue };
}

export function createArrayPattern(
  elements: (Pattern | SkipPattern | RestPattern | null)[],
  defaultValue?: SExp,
): ArrayPattern {
  return { type: "ArrayPattern", elements, default: defaultValue };
}

export function createObjectPattern(
  properties: PropertyPattern[],
  rest?: IdentifierPattern,
  defaultValue?: SExp,
): ObjectPattern {
  return { type: "ObjectPattern", properties, rest, default: defaultValue };
}

export function createPropertyPattern(
  key: string,
  value: Pattern,
  defaultValue?: SExp,
): PropertyPattern {
  return { type: "PropertyPattern", key, value, default: defaultValue };
}

export function createSkipPattern(): SkipPattern {
  return { type: "SkipPattern" };
}

export function createRestPattern(argument: IdentifierPattern): RestPattern {
  return { type: "RestPattern", argument };
}

/**
 * Type guards for patterns
 */
export function isIdentifierPattern(
  p: Pattern | SkipPattern | RestPattern | null,
): p is IdentifierPattern {
  return p !== null && p.type === "IdentifierPattern";
}

export function isArrayPattern(
  p: Pattern | SkipPattern | RestPattern | null,
): p is ArrayPattern {
  return p !== null && p.type === "ArrayPattern";
}

export function isObjectPattern(
  p: Pattern | SkipPattern | RestPattern | null,
): p is ObjectPattern {
  return p !== null && p.type === "ObjectPattern";
}

export function isSkipPattern(
  p: Pattern | SkipPattern | RestPattern | null,
): p is SkipPattern {
  return p !== null && p.type === "SkipPattern";
}

export function isRestPattern(
  p: Pattern | SkipPattern | RestPattern | null,
): p is RestPattern {
  return p !== null && p.type === "RestPattern";
}

/**
 * Check if an S-expression could be a destructuring pattern in binding position.
 * This is context-sensitive: [x y] is a pattern in binding position,
 * but a literal array in expression position.
 *
 * A list/map is potentially a pattern if it contains only:
 * - Symbols (identifiers)
 * - Nested lists/maps (nested patterns)
 * - Special symbols like & (rest) or _ (skip)
 * - Lists starting with = (defaults)
 */
export function couldBePattern(exp: SExp): boolean {
  // Symbols can be patterns (identifier patterns)
  if (isSymbol(exp)) {
    return true;
  }

  // Literals are never patterns
  if (isLiteral(exp)) {
    return false;
  }

  // Lists could be array patterns [x y z] or object patterns {x y}
  if (isList(exp)) {
    // Empty list is valid pattern
    if (exp.elements.length === 0) {
      return true;
    }

    // Check if this is an object pattern: (hash-map x x y y ...) or (__hql_hash_map x x y y ...)
    // Parser generates (hash-map key1 value1 key2 value2 ...) for {key1 key2}
    // Syntax transformer may convert hash-map to __hql_hash_map
    if (
      isSymbol(exp.elements[0]) &&
      (exp.elements[0].name === HASH_MAP_USER ||
        exp.elements[0].name === HASH_MAP_INTERNAL)
    ) {
      // Must have even number of elements after hash-map (key-value pairs)
      const numPairs = exp.elements.length - 1;
      if (numPairs % 2 !== 0) {
        return false; // Odd number - invalid
      }

      // Check each key-value pair
      for (let i = 1; i < exp.elements.length; i += 2) {
        const key = exp.elements[i];
        const value = exp.elements[i + 1];

        // Key must be a symbol or string literal (from {x: y} syntax)
        const isValidKey = isSymbol(key) ||
          (isLiteral(key) && typeof (key as SLiteral).value === "string");
        if (!isValidKey) {
          return false;
        }

        // Value must be a symbol or nested pattern (not a literal)
        if (isLiteral(value)) {
          return false; // Literal value = object literal, not pattern
        }

        // Value can be symbol or nested pattern
        if (!isSymbol(value) && !couldBePattern(value)) {
          return false;
        }
      }

      return true; // Valid object pattern
    }

    // Check if all elements could be pattern elements (array pattern)
    for (let i = 0; i < exp.elements.length; i++) {
      const elem = exp.elements[i];

      // Check for rest pattern: & identifier
      if (isSymbol(elem) && elem.name === "&") {
        // Must be followed by an identifier and be second-to-last
        if (i !== exp.elements.length - 2) {
          return false; // & must be second-to-last
        }
        const nextElem = exp.elements[i + 1];
        if (!isSymbol(nextElem)) {
          return false; // & must be followed by symbol
        }
        return true; // Valid rest pattern
      }

      // Check for default value: (= expr)
      if (
        isList(elem) && elem.elements.length === 2 &&
        isSymbol(elem.elements[0]) && elem.elements[0].name === "="
      ) {
        continue; // Valid default
      }

      // Symbol (identifier or _)
      if (isSymbol(elem)) {
        continue; // Valid
      }

      // Nested pattern
      if (couldBePattern(elem)) {
        continue; // Valid nested pattern
      }

      // If we get here, element is not a valid pattern element
      // Check if it's a literal value (makes this an array literal, not pattern)
      if (isLiteral(elem)) {
        return false; // Contains literal → this is an array literal, not pattern
      }

      // Lists that are function calls (not patterns)
      if (isList(elem) && elem.elements.length > 0) {
        const first = elem.elements[0];
        // If starts with symbol that's not =, it's likely a function call
        if (isSymbol(first) && first.name !== "=") {
          return false; // Likely a function call
        }
      }
    }

    return true; // All elements are valid pattern elements
  }

  return false;
}

/**
 * Convert S-expression to a readable string for debugging
 */
export function sexpToString(exp: SExp): string {
  if (isSymbol(exp)) {
    return exp.name;
  } else if (isLiteral(exp)) {
    if (exp.value === null) {
      return "nil";
    } else if (typeof exp.value === "string") {
      return `"${exp.value}"`;
    } else {
      return String(exp.value);
    }
  } else if (isList(exp)) {
    return `(${exp.elements.map(sexpToString).join(" ")})`;
  } else {
    return String(exp);
  }
}

export interface SexpToJsOptions {
  vectorAsArray?: boolean;
}

export function sexpToJs(
  exp: SExp,
  options: SexpToJsOptions = {},
): unknown {
  if (isSymbol(exp)) {
    return exp.name;
  }
  if (isLiteral(exp)) {
    return exp.value;
  }
  if (isList(exp)) {
    if (options.vectorAsArray && isVector(exp)) {
      return exp.elements.slice(1).map((elem) => sexpToJs(elem, options));
    }
    return exp.elements.map((elem) => sexpToJs(elem, options));
  }
  return exp;
}

/**
 * Check if an import is vector-based
 */
export function isSExpVectorImport(elements: SExp[]): boolean {
  return elements.length >= 4 &&
    elements[1].type === "list" &&
    isSymbol(elements[2]) &&
    elements[2].name === "from";
}

/**
 * Check if an import is namespace-based with "from" syntax
 * Format: (import name from "path")
 */
export function isSExpNamespaceImport(elements: SExp[]): boolean {
  return elements.length === 4 &&
    isSymbol(elements[1]) &&
    isSymbol(elements[2]) &&
    elements[2].name === "from" &&
    isLiteral(elements[3]) &&
    typeof elements[3].value === "string";
}

/**
 * Check if an S-expression is a vector (list starting with 'vector' or 'empty-array' symbol)
 */
export function isVector(exp: SExp): boolean {
  return isList(exp) &&
    exp.elements.length > 0 &&
    isSymbol(exp.elements[0]) &&
    (exp.elements[0].name === VECTOR_SYMBOL || exp.elements[0].name === EMPTY_ARRAY_SYMBOL);
}

/**
 * Set source location for an S-expression
 */
