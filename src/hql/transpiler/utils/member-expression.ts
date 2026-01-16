// src/hql/transpiler/utils/member-expression.ts
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
