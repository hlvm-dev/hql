// src/transpiler/utils/member-expression.ts
// Shared utilities for creating IR MemberExpression nodes from dot notation paths

import * as IR from "../type/hql_ir.ts";

// Regex for valid JavaScript identifiers (exported for reuse)
export const IDENTIFIER_REGEX = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

// Regex for private field identifiers (#name)
export const PRIVATE_IDENTIFIER_REGEX = /^#[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Determines if a property should use computed access (obj[prop]) or dot access (obj.prop)
 *
 * @param property - The IR node representing the property
 * @param isLiteralKey - Whether the property comes from a literal value in source code
 * @returns Object with resolved property node and computed flag
 */
export function resolveMemberProperty(
  property: IR.IRNode,
  isLiteralKey = false,
): { property: IR.IRNode; computed: boolean } {
  // If the property is an Identifier from a variable reference (not a literal),
  // we need computed access (obj[key]) to use the variable's value
  if (property.type === IR.IRNodeType.Identifier && !isLiteralKey) {
    return { property, computed: true };
  }

  if (property.type === IR.IRNodeType.StringLiteral) {
    const keyValue = (property as IR.IRStringLiteral).value;
    // Handle regular identifiers and private field identifiers (#name)
    if (IDENTIFIER_REGEX.test(keyValue) || PRIVATE_IDENTIFIER_REGEX.test(keyValue)) {
      return {
        property: {
          type: IR.IRNodeType.Identifier,
          name: keyValue,
        } as IR.IRIdentifier,
        computed: false,
      };
    }
  }

  return { property, computed: true };
}

/**
 * Creates an IRMemberExpression from an object and property
 *
 * @param object - The object IR node
 * @param property - The property IR node
 * @param isLiteralKey - Whether the property is a literal key
 * @returns IRMemberExpression node
 */
export function createMemberExpression(
  object: IR.IRNode,
  property: IR.IRNode,
  isLiteralKey = false,
): IR.IRMemberExpression {
  const resolved = resolveMemberProperty(property, isLiteralKey);
  return {
    type: IR.IRNodeType.MemberExpression,
    object,
    property: resolved.property,
    computed: resolved.computed,
  } as IR.IRMemberExpression;
}

/**
 * Creates a chain of MemberExpressions from a dot-separated path string
 *
 * @param basePath - The dot-separated path (e.g., "console.log", "window.document.body")
 * @param position - Optional source position for error reporting
 * @returns The IRNode representing the member access chain
 *
 * @example
 * createMemberChainFromPath("console.log")
 * // Returns: { type: MemberExpression, object: {type: Identifier, name: "console"}, property: {type: Identifier, name: "log"} }
 *
 * @example
 * createMemberChainFromPath("a.b.c")
 * // Returns: a.b.c as nested MemberExpressions
 */
export function createMemberChainFromPath(
  basePath: string,
  position?: IR.SourcePosition,
): IR.IRNode {
  const parts = basePath.split(".").filter(p => p.length > 0);

  if (parts.length === 0) {
    throw new Error(`Invalid member chain path: "${basePath}"`);
  }

  if (parts.length === 1) {
    return {
      type: IR.IRNodeType.Identifier,
      name: parts[0],
      position,
    } as IR.IRIdentifier;
  }

  // Build chain from left to right
  let result: IR.IRNode = {
    type: IR.IRNodeType.Identifier,
    name: parts[0],
    position,
  } as IR.IRIdentifier;

  for (let i = 1; i < parts.length; i++) {
    result = {
      type: IR.IRNodeType.MemberExpression,
      object: result,
      property: {
        type: IR.IRNodeType.Identifier,
        name: parts[i],
      } as IR.IRIdentifier,
      computed: false,
      position,
    } as IR.IRMemberExpression;
  }

  return result;
}

/**
 * Creates a member expression with a string literal property
 * Used for dynamic property access like obj["some-key"]
 *
 * @param object - The object IR node
 * @param propertyName - The property name as a string
 * @returns IRMemberExpression node
 */
export function createMemberExpressionWithLiteral(
  object: IR.IRNode,
  propertyName: string,
): IR.IRMemberExpression {
  const literalNode: IR.IRStringLiteral = {
    type: IR.IRNodeType.StringLiteral,
    value: propertyName,
  };
  return createMemberExpression(object, literalNode, true);
}
