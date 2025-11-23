// core/src/transpiler/utils/ir-helpers.ts
// DRY utilities for common IR node transformations

import * as IR from "../type/hql_ir.ts";

/**
 * Ensure a node is wrapped in a return statement if needed
 *
 * If the node is already a ReturnStatement or IfStatement, returns it as-is.
 * Otherwise, wraps it in a ReturnStatement.
 *
 * This consolidates a pattern that appeared 10+ times across loop-recur.ts,
 * conditional.ts, and function.ts.
 *
 * @param node - The IR node to potentially wrap
 * @returns The node, possibly wrapped in a ReturnStatement
 *
 * @example
 * // Already a return statement - returns as-is
 * const returnNode = { type: IRNodeType.ReturnStatement, argument: expr };
 * ensureReturnStatement(returnNode) === returnNode; // true
 *
 * @example
 * // Regular expression - wraps in return
 * const expr = { type: IRNodeType.Literal, value: 42 };
 * const wrapped = ensureReturnStatement(expr);
 * // → { type: IRNodeType.ReturnStatement, argument: expr }
 */
export function ensureReturnStatement(node: IR.IRNode): IR.IRNode {
  if (
    node.type === IR.IRNodeType.ReturnStatement ||
    node.type === IR.IRNodeType.IfStatement
  ) {
    return node;
  }
  return {
    type: IR.IRNodeType.ReturnStatement,
    argument: node,
  } as IR.IRReturnStatement;
}
