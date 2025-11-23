// core/src/transpiler/utils/pattern-to-ir.ts
// Converts Pattern AST nodes to IR nodes for code generation

import * as IR from "../type/hql_ir.ts";
import {
  type ArrayPattern,
  type IdentifierPattern,
  isArrayPattern,
  isIdentifierPattern,
  isObjectPattern,
  isRestPattern,
  isSkipPattern,
  type ObjectPattern,
  type Pattern,
  type RestPattern,
  type SExp,
  type SkipPattern,
} from "../../s-exp/types.ts";
import { sanitizeIdentifier } from "../../common/utils.ts";
import type { HQLNode } from "../type/hql_ast.ts";
import { copyPosition } from "../pipeline/hql-ast-to-hql-ir.ts";

// Type for the transformation function - accepts both HQLNode and SExp since they're structurally compatible
// (SExp is used by pattern parser for default values, HQLNode is the main AST type)
type TransformNodeFn = (node: HQLNode | SExp, dir: string) => IR.IRNode | null;

/**
 * Convert a Pattern AST node to an IR node (identifier or destructuring pattern).
 * Supports default values through IRAssignmentPattern.
 *
 * @param pattern - The pattern to convert
 * @param transformNode - Optional function to convert default value SExp to IR
 * @param currentDir - Current directory for resolving imports
 * @returns IR node (IRIdentifier, IRArrayPattern, IRObjectPattern, or IRAssignmentPattern)
 *
 * @example
 * // Identifier pattern
 * patternToIR({ type: "IdentifierPattern", name: "x" })
 * // → { type: IRNodeType.Identifier, name: "x" }
 *
 * @example
 * // Array pattern with default
 * patternToIR({ type: "ArrayPattern", elements: [...], default: literalNode })
 * // → { type: IRNodeType.AssignmentPattern, left: {...}, right: {...} }
 */
export function patternToIR(
  pattern: Pattern | SkipPattern | RestPattern | null,
  transformNode?: TransformNodeFn,
  currentDir?: string,
):
  | IR.IRIdentifier
  | IR.IRArrayPattern
  | IR.IRObjectPattern
  | IR.IRRestElement
  | IR.IRAssignmentPattern
  | null {
  if (pattern === null) {
    return null;
  }

  // Identifier pattern: x → x (or x = default)
  if (isIdentifierPattern(pattern)) {
    const irPattern = identifierPatternToIR(pattern);
    return wrapWithDefault(
      irPattern,
      pattern.default,
      transformNode,
      currentDir,
    );
  }

  // Array pattern: [x y z] → const [x, y, z] = ... (or with default)
  if (isArrayPattern(pattern)) {
    const irPattern = arrayPatternToIR(pattern, transformNode, currentDir);
    return wrapWithDefault(
      irPattern,
      pattern.default,
      transformNode,
      currentDir,
    );
  }

  // Object pattern: {x y} → const {x, y} = ... (or with default)
  if (isObjectPattern(pattern)) {
    const irPattern = objectPatternToIR(pattern, transformNode, currentDir);
    return wrapWithDefault(
      irPattern,
      pattern.default,
      transformNode,
      currentDir,
    );
  }

  // Skip pattern: _ → treated as null in array pattern
  if (isSkipPattern(pattern)) {
    return null;
  }

  // Rest pattern: & rest → ...rest
  if (isRestPattern(pattern)) {
    return restPatternToIR(pattern);
  }

  throw new Error(`Unknown pattern type: ${JSON.stringify(pattern)}`);
}

/**
 * Helper to wrap a pattern with a default value if present.
 *
 * @param irPattern - The converted IR pattern
 * @param defaultValue - Optional default value SExp
 * @param transformNode - Optional transformer function
 * @param currentDir - Current directory
 * @returns IRAssignmentPattern if default exists, otherwise the original pattern
 */
function wrapWithDefault(
  irPattern: IR.IRIdentifier | IR.IRArrayPattern | IR.IRObjectPattern,
  defaultValue: SExp | undefined,
  transformNode: TransformNodeFn | undefined,
  currentDir: string | undefined,
):
  | IR.IRIdentifier
  | IR.IRArrayPattern
  | IR.IRObjectPattern
  | IR.IRAssignmentPattern {
  // No default or no transformer → return unwrapped
  if (!defaultValue || !transformNode || !currentDir) {
    return irPattern;
  }

  // Convert default SExp to IR
  const defaultIR = transformNode(defaultValue, currentDir);
  if (!defaultIR) {
    throw new Error(
      `Failed to convert default value: ${JSON.stringify(defaultValue)}`,
    );
  }

  // Wrap in IRAssignmentPattern
  const assignmentPattern: IR.IRAssignmentPattern = {
    type: IR.IRNodeType.AssignmentPattern,
    left: irPattern,
    right: defaultIR,
  };
  // Copy position from the original pattern (left side)
  if (irPattern.position) {
    assignmentPattern.position = irPattern.position;
  }
  return assignmentPattern;
}

/**
 * Convert an IdentifierPattern to IRIdentifier.
 *
 * @param pattern - The identifier pattern
 * @returns IRIdentifier node
 */
function identifierPatternToIR(pattern: IdentifierPattern): IR.IRIdentifier {
  const identifier: IR.IRIdentifier = {
    type: IR.IRNodeType.Identifier,
    name: sanitizeIdentifier(pattern.name),
  };
  copyPosition(pattern, identifier);
  return identifier;
}

/**
 * Convert an ArrayPattern to IRArrayPattern.
 *
 * Handles:
 * - Simple identifiers: [x y z]
 * - Skip patterns: [x _ z]
 * - Rest patterns: [x & rest]
 * - Nested patterns: [[a b] [c d]]
 * - Default values: [x (= 10)]
 *
 * @param pattern - The array pattern
 * @param transformNode - Optional transformer for default values
 * @param currentDir - Current directory
 * @returns IRArrayPattern node
 *
 * @example
 * // [x y z]
 * arrayPatternToIR({
 *   type: "ArrayPattern",
 *   elements: [
 *     { type: "IdentifierPattern", name: "x" },
 *     { type: "IdentifierPattern", name: "y" },
 *     { type: "IdentifierPattern", name: "z" }
 *   ]
 * })
 * // → { type: IRNodeType.ArrayPattern, elements: [
 * //     { type: IRNodeType.Identifier, name: "x" },
 * //     { type: IRNodeType.Identifier, name: "y" },
 * //     { type: IRNodeType.Identifier, name: "z" }
 * //   ]}
 */
function arrayPatternToIR(
  pattern: ArrayPattern,
  transformNode?: TransformNodeFn,
  currentDir?: string,
): IR.IRArrayPattern {
  const elements = pattern.elements.map((elem) => {
    // null (from skip pattern) stays as null
    if (elem === null) {
      return null;
    }

    // Skip pattern becomes null
    if (isSkipPattern(elem)) {
      return null;
    }

    // Rest pattern becomes IRRestElement
    if (isRestPattern(elem)) {
      return restPatternToIR(elem);
    }

    // All other patterns - use patternToIR recursively to handle defaults
    const converted = patternToIR(elem, transformNode, currentDir);

    // Validate result type (only certain types allowed in array patterns)
    if (
      converted && (
        converted.type === IR.IRNodeType.Identifier ||
        converted.type === IR.IRNodeType.ArrayPattern ||
        converted.type === IR.IRNodeType.ObjectPattern ||
        converted.type === IR.IRNodeType.AssignmentPattern
      )
    ) {
      return converted;
    }

    throw new Error(`Invalid array pattern element: ${JSON.stringify(elem)}`);
  });

  const arrayPattern: IR.IRArrayPattern = {
    type: IR.IRNodeType.ArrayPattern,
    elements,
  };
  copyPosition(pattern, arrayPattern);
  return arrayPattern;
}

/**
 * Convert an ObjectPattern to IRObjectPattern.
 *
 * @param pattern - The object pattern
 * @param transformNode - Optional transformer for default values
 * @param currentDir - Current directory
 * @returns IRObjectPattern node
 *
 * @example
 * // {x y}
 * objectPatternToIR({
 *   type: "ObjectPattern",
 *   properties: [
 *     { type: "PropertyPattern", key: "x", value: { type: "IdentifierPattern", name: "x" } },
 *     { type: "PropertyPattern", key: "y", value: { type: "IdentifierPattern", name: "y" } }
 *   ]
 * })
 * // → { type: IRNodeType.ObjectPattern, properties: [
 * //     { type: IRNodeType.ObjectProperty, key: { type: IRNodeType.Identifier, name: "x" },
 * //       value: { type: IRNodeType.Identifier, name: "x" }, shorthand: true },
 * //     { type: IRNodeType.ObjectProperty, key: { type: IRNodeType.Identifier, name: "y" },
 * //       value: { type: IRNodeType.Identifier, name: "y" }, shorthand: true }
 * //   ]}
 */
function objectPatternToIR(
  pattern: ObjectPattern,
  transformNode?: TransformNodeFn,
  currentDir?: string,
): IR.IRObjectPattern {
  const properties: IR.IRObjectPatternProperty[] = pattern.properties.map(
    (prop) => {
      // Convert key to IR
      const key: IR.IRIdentifier = {
        type: IR.IRNodeType.Identifier,
        name: sanitizeIdentifier(prop.key),
      };
      // Copy position from property value (best we can do for key)
      copyPosition(prop.value, key);

      // Convert value pattern to IR (with potential default from property)
      let valueIR = patternToIR(prop.value, transformNode, currentDir);

      // If property itself has a default (from {x: y = 10} syntax), wrap it
      if (prop.default && transformNode && currentDir) {
        const defaultIR = transformNode(prop.default, currentDir);
        if (defaultIR && valueIR) {
          const assignmentPattern: IR.IRAssignmentPattern = {
            type: IR.IRNodeType.AssignmentPattern,
            left: valueIR as
              | IR.IRIdentifier
              | IR.IRArrayPattern
              | IR.IRObjectPattern,
            right: defaultIR,
          };
          // Copy position from the original value pattern
          if (valueIR.position) {
            assignmentPattern.position = valueIR.position;
          }
          valueIR = assignmentPattern;
        }
      }

      if (!valueIR) {
        throw new Error(
          `Object pattern property value cannot be null: ${prop.key}`,
        );
      }

      // Check if this is shorthand ({x} instead of {x: x})
      const isShorthand = isIdentifierPattern(prop.value) &&
        prop.value.name === prop.key;

      const property: IR.IRObjectPatternProperty = {
        type: IR.IRNodeType.ObjectProperty,
        key,
        value: valueIR as
          | IR.IRIdentifier
          | IR.IRArrayPattern
          | IR.IRObjectPattern
          | IR.IRAssignmentPattern,
        shorthand: isShorthand,
        computed: false,
      };
      copyPosition(prop.value, property);
      return property;
    },
  );

  // Handle rest pattern if present
  let rest: IR.IRRestElement | undefined = undefined;
  if (pattern.rest) {
    const restArgument: IR.IRIdentifier = {
      type: IR.IRNodeType.Identifier,
      name: sanitizeIdentifier(pattern.rest.name),
    };
    copyPosition(pattern.rest, restArgument);

    rest = {
      type: IR.IRNodeType.RestElement,
      argument: restArgument,
    };
    copyPosition(pattern.rest, rest);
  }

  const objectPattern: IR.IRObjectPattern = {
    type: IR.IRNodeType.ObjectPattern,
    properties,
    rest,
  };
  copyPosition(pattern, objectPattern);
  return objectPattern;
}

/**
 * Convert a RestPattern to IRRestElement.
 *
 * @param pattern - The rest pattern
 * @returns IRRestElement node
 *
 * @example
 * // & rest
 * restPatternToIR({
 *   type: "RestPattern",
 *   argument: { type: "IdentifierPattern", name: "rest" }
 * })
 * // → { type: IRNodeType.RestElement, argument: { type: IRNodeType.Identifier, name: "rest" } }
 */
function restPatternToIR(pattern: RestPattern): IR.IRRestElement {
  const restElement: IR.IRRestElement = {
    type: IR.IRNodeType.RestElement,
    argument: identifierPatternToIR(pattern.argument),
  };
  copyPosition(pattern, restElement);
  return restElement;
}
