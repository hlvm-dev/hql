// src/hql/s-exp/pattern-parser.ts
// Converts S-expressions to destructuring pattern AST nodes

import {
  type ArrayPattern,
  couldBePattern,
  createArrayPattern,
  createIdentifierPattern,
  createObjectPattern,
  createPropertyPattern,
  createRestPattern,
  createSkipPattern,
  type IdentifierPattern,
  isList,
  isLiteral,
  isSymbol,
  type ObjectPattern,
  type Pattern,
  type PropertyPattern,
  type RestPattern,
  type SExp,
  type SkipPattern,
  type SList,
} from "./types.ts";
import {
  hasHashMapPrefix,
  isSymbolWithName,
} from "../../common/sexp-utils.ts";
import {
  HASH_MAP_INTERNAL,
  HASH_MAP_USER,
  VECTOR_SYMBOL,
  EMPTY_ARRAY_SYMBOL,
} from "../../common/runtime-helper-impl.ts";
import { ParseError } from "../../common/error.ts";

// Re-export couldBePattern so it can be imported from this module
export { couldBePattern } from "./types.ts";

/**
 * Check if an S-expression is a default value form: (= expr).
 *
 * @param elem - The S-expression to check
 * @returns true if elem is (= expr) form, false otherwise
 *
 * @example
 * // Default value form
 * isDefaultValueForm(createList(createSymbol("="), createNumber(10)))
 * // → true
 *
 * @example
 * // Not a default value form
 * isDefaultValueForm(createSymbol("x"))
 * // → false
 */
function isDefaultValueForm(elem: SExp | undefined): boolean {
  return !!(
    elem &&
    isList(elem) &&
    elem.elements.length === 2 &&
    isSymbol(elem.elements[0]) &&
    elem.elements[0].name === "="
  );
}

/**
 * Parse an S-expression into a destructuring pattern.
 *
 * @param exp - The S-expression to parse (must pass couldBePattern check)
 * @returns The parsed Pattern AST node
 *
 * @example
 * // Simple identifier
 * parsePattern(createSymbol("x"))
 * // → { type: "IdentifierPattern", name: "x" }
 *
 * @example
 * // Array pattern
 * parsePattern(createList(createSymbol("x"), createSymbol("y")))
 * // → { type: "ArrayPattern", elements: [...] }
 *
 * @throws {Error} If the expression is not a valid pattern
 */
export function parsePattern(exp: SExp): Pattern {
  // Identifier pattern: x
  if (isSymbol(exp)) {
    return parseIdentifierPattern(exp);
  }

  // Check if this is a hash-map (object pattern) or array pattern
  if (isList(exp)) {
    // Object pattern: (hash-map x x y y ...) or (__hql_hash_map x x y y ...)
    if (hasHashMapPrefix(exp)) {
      return parseObjectPattern(exp);
    }

    // Array pattern: [x y z] which becomes (vector x y z)
    // Strip the "vector" or "empty-array" prefix before parsing
    let arrayExp = exp;
    if (
      exp.elements.length > 0 &&
      (isSymbolWithName(exp.elements[0], VECTOR_SYMBOL) ||
        isSymbolWithName(exp.elements[0], EMPTY_ARRAY_SYMBOL))
    ) {
      arrayExp = { ...exp, elements: exp.elements.slice(1) };
    }
    return parseArrayPattern(arrayExp);
  }

  throw new ParseError(`Invalid pattern: ${JSON.stringify(exp)}`, { line: 0, column: 0 });
}

/**
 * Parse an identifier pattern.
 *
 * @param exp - Symbol S-expression
 * @returns IdentifierPattern
 *
 * @example
 * parseIdentifierPattern(createSymbol("x"))
 * // → { type: "IdentifierPattern", name: "x" }
 *
 * @example
 * parseIdentifierPattern(createSymbol("_"))
 * // → { type: "IdentifierPattern", name: "_" }
 */
function parseIdentifierPattern(exp: SExp): IdentifierPattern {
  if (!isSymbol(exp)) {
    throw new ParseError(`Expected symbol for identifier pattern, got: ${exp.type}`, { line: 0, column: 0 });
  }

  return createIdentifierPattern(exp.name);
}

/**
 * Parse an array destructuring pattern.
 *
 * Handles:
 * - Simple identifiers: [x y z]
 * - Skip pattern: [x _ z]
 * - Rest pattern: [x & rest]
 * - Default values: [x (= 10)]
 * - Nested patterns: [[a b] [c d]]
 * - Mixed: [x _ [y z] (= 10) & rest]
 *
 * @param exp - List S-expression representing array pattern
 * @returns ArrayPattern AST node
 *
 * @example
 * // [x y z]
 * parseArrayPattern(createList(
 *   createSymbol("x"),
 *   createSymbol("y"),
 *   createSymbol("z")
 * ))
 * // → { type: "ArrayPattern", elements: [
 * //     { type: "IdentifierPattern", name: "x" },
 * //     { type: "IdentifierPattern", name: "y" },
 * //     { type: "IdentifierPattern", name: "z" }
 * //   ]}
 *
 * @example
 * // [x & rest]
 * parseArrayPattern(createList(
 *   createSymbol("x"),
 *   createSymbol("&"),
 *   createSymbol("rest")
 * ))
 * // → { type: "ArrayPattern", elements: [
 * //     { type: "IdentifierPattern", name: "x" },
 * //     { type: "RestPattern", argument: { type: "IdentifierPattern", name: "rest" } }
 * //   ]}
 *
 * @throws {Error} If pattern is invalid (literals, invalid rest position, etc.)
 */
function parseArrayPattern(exp: SExp): ArrayPattern {
  if (!isList(exp)) {
    throw new ParseError(`Expected list for array pattern, got: ${exp.type}`, { line: 0, column: 0 });
  }

  const elements: (Pattern | SkipPattern | RestPattern | null)[] = [];

  for (let i = 0; i < exp.elements.length; i++) {
    const elem = exp.elements[i];
    // Performance: Cache next element access once per iteration (avoids repeated array lookup)
    const nextElem = i + 1 < exp.elements.length ? exp.elements[i + 1] : undefined;

    // Handle rest pattern: & identifier
    if (isSymbol(elem) && elem.name === "&") {
      // Check if there's a next element
      if (nextElem === undefined) {
        throw new ParseError(
          `Rest pattern (&) must be followed by identifier`,
          { line: 0, column: 0 }
        );
      }

      // Check if next element is a symbol
      if (!isSymbol(nextElem)) {
        throw new ParseError(
          `Rest pattern (&) must be followed by identifier, got: ${nextElem?.type}`,
          { line: 0, column: 0 }
        );
      }

      // Check if & is at second-to-last position
      if (i !== exp.elements.length - 2) {
        throw new ParseError(
          `Rest pattern (&) must be second-to-last element, found at position ${i}`,
          { line: 0, column: 0 }
        );
      }

      // Create rest pattern and add to elements
      const restArg = createIdentifierPattern(nextElem.name);
      const restPattern = createRestPattern(restArg);
      elements.push(restPattern);

      // Skip the next element (we've consumed it)
      break;
    }

    // Handle skip pattern: _
    if (isSymbol(elem) && elem.name === "_") {
      // Check if next element is a default value
      if (isDefaultValueForm(nextElem)) {
        throw new ParseError(
          `Skip pattern (_) cannot have default value`,
          { line: 0, column: 0 }
        );
      }
      elements.push(createSkipPattern());
      continue;
    }

    // Handle default value: (= expr)
    // If this element is (= expr), it means there was an error (should follow a pattern)
    if (isDefaultValueForm(elem)) {
      throw new ParseError(
        `Default value (= expr) must follow a pattern element, found at position ${i}`,
        { line: 0, column: 0 }
      );
    }

    // Handle nested pattern: [x [y z]]
    if (isList(elem) && couldBePattern(elem)) {
      // Use parsePattern instead of parseArrayPattern to handle "vector" prefix stripping
      let nestedPattern = parsePattern(elem);

      // Check if next element is a default value
      if (isDefaultValueForm(nextElem)) {
        // Attach default to pattern (nextElem is guaranteed to be a list)
        const defaultValue = (nextElem as SList).elements[1];
        nestedPattern = { ...nestedPattern, default: defaultValue };
        i++; // Skip the next element (we've consumed it)
      }

      elements.push(nestedPattern);
      continue;
    }

    // Handle identifier: x, y, z
    if (isSymbol(elem)) {
      let pattern = parseIdentifierPattern(elem);

      // Check if next element is a default value
      if (isDefaultValueForm(nextElem)) {
        // Attach default to pattern (nextElem is guaranteed to be a list)
        const defaultValue = (nextElem as SList).elements[1];
        pattern = createIdentifierPattern(elem.name, defaultValue);
        i++; // Skip the next element (we've consumed it)
      }

      elements.push(pattern);
      continue;
    }

    // Invalid element
    if (isLiteral(elem)) {
      throw new ParseError(
        `Array pattern cannot contain literal values. Found: ${
          JSON.stringify(elem.value)
        }`,
        { line: 0, column: 0 }
      );
    }

    // Function call or other invalid element
    throw new ParseError(
      `Invalid element in array pattern: ${JSON.stringify(elem)}`,
      { line: 0, column: 0 }
    );
  }

  return createArrayPattern(elements);
}

/**
 * Parse an object destructuring pattern.
 *
 * Handles hash-map forms: (hash-map key1 value1 key2 value2 ...)
 * Generated from shorthand syntax: {x y} → (hash-map x x y y)
 *
 * @param exp - List S-expression starting with "hash-map"
 * @returns ObjectPattern AST node
 *
 * @example
 * // {x y}
 * parseObjectPattern(createList(
 *   createSymbol("hash-map"),
 *   createSymbol("x"), createSymbol("x"),
 *   createSymbol("y"), createSymbol("y")
 * ))
 * // → { type: "ObjectPattern", properties: [
 * //     { type: "PropertyPattern", key: "x", value: { type: "IdentifierPattern", name: "x" } },
 * //     { type: "PropertyPattern", key: "y", value: { type: "IdentifierPattern", name: "y" } }
 * //   ]}
 *
 * @throws {Error} If pattern structure is invalid
 */
function parseObjectPattern(exp: SExp): ObjectPattern {
  if (!isList(exp)) {
    throw new ParseError(`Expected list for object pattern, got: ${exp.type}`, { line: 0, column: 0 });
  }

  // Verify it starts with "hash-map" or "__hql_hash_map"
  if (
    exp.elements.length === 0 ||
    !isSymbol(exp.elements[0]) ||
    (exp.elements[0].name !== HASH_MAP_USER &&
      exp.elements[0].name !== HASH_MAP_INTERNAL)
  ) {
    throw new ParseError(
      `Expected hash-map for object pattern, got: ${JSON.stringify(exp)}`,
      { line: 0, column: 0 }
    );
  }

  const properties: PropertyPattern[] = [];
  let rest: IdentifierPattern | undefined = undefined;

  // Parse key-value pairs
  for (let i = 1; i < exp.elements.length; i += 2) {
    const keyExp = exp.elements[i];
    const valueExp = exp.elements[i + 1];

    // Check for rest pattern: & identifier
    if (isSymbol(keyExp) && keyExp.name === "&") {
      // Validate rest argument
      if (!valueExp) {
        throw new ParseError(
          `Rest pattern (&) must be followed by identifier`,
          { line: 0, column: 0 }
        );
      }
      if (!isSymbol(valueExp)) {
        throw new ParseError(
          `Rest pattern (&) must be followed by identifier, got: ${valueExp.type}`,
          { line: 0, column: 0 }
        );
      }

      // Check if & is at second-to-last position
      if (i !== exp.elements.length - 2) {
        throw new ParseError(
          `Rest pattern (&) must be last in object pattern, found at position ${i}`,
          { line: 0, column: 0 }
        );
      }

      // Create rest pattern
      rest = createIdentifierPattern(valueExp.name);
      break; // Rest must be last, we're done
    }

    // Key can be a symbol or string literal (from {x: y} syntax)
    let key: string;
    if (isSymbol(keyExp)) {
      key = keyExp.name;
    } else if (isLiteral(keyExp) && typeof keyExp.value === "string") {
      key = keyExp.value;
    } else {
      throw new ParseError(
        `Object pattern key must be a symbol or string, got: ${keyExp.type}`,
        { line: 0, column: 0 }
      );
    }

    // Parse value as a pattern (can be identifier, array, or nested object)
    const value = parsePattern(valueExp);

    // Create property pattern
    const property = createPropertyPattern(key, value);
    properties.push(property);
  }

  return createObjectPattern(properties, rest);
}
