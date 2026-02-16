// src/hql/transpiler/utils/ir-helpers.ts
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
  if (node.type === IR.IRNodeType.ReturnStatement) {
    return node;
  }
  // For IfStatement, recursively ensure returns in leaf branches
  if (node.type === IR.IRNodeType.IfStatement) {
    const ifStmt = node as IR.IRIfStatement;
    return {
      ...ifStmt,
      consequent: ensureReturnStatement(ifStmt.consequent),
      alternate: ifStmt.alternate ? ensureReturnStatement(ifStmt.alternate) : ifStmt.alternate,
    } as IR.IRIfStatement;
  }
  // ThrowStatement doesn't need a return wrapper
  if (node.type === IR.IRNodeType.ThrowStatement) {
    return node;
  }
  return createReturn(node);
}

// ============================================================================
// IR Node Builder Functions
// Eliminate ~200 `as IR.*` type assertions scattered across syntax files.
// ============================================================================

export function createId(
  name: string,
  opts?: { originalName?: string; isJS?: boolean; typeAnnotation?: string; effectAnnotation?: "Pure" | "Impure" },
): IR.IRIdentifier {
  const node: IR.IRIdentifier = { type: IR.IRNodeType.Identifier, name };
  if (opts?.originalName) node.originalName = opts.originalName;
  if (opts?.isJS) node.isJS = opts.isJS;
  if (opts?.typeAnnotation) node.typeAnnotation = opts.typeAnnotation;
  if (opts?.effectAnnotation) node.effectAnnotation = opts.effectAnnotation;
  return node;
}

export function createReturn(arg: IR.IRNode): IR.IRReturnStatement {
  return { type: IR.IRNodeType.ReturnStatement, argument: arg };
}

export function createSwitchCase(
  test: IR.IRNode | null,
  consequent: IR.IRNode[],
  fallthrough?: boolean,
): IR.IRSwitchCase {
  const node: IR.IRSwitchCase = { type: IR.IRNodeType.SwitchCase, test, consequent };
  if (fallthrough) node.fallthrough = fallthrough;
  return node;
}

export function createCall(
  callee: IR.IRIdentifier | IR.IRMemberExpression | IR.IRFunctionExpression,
  args: IR.IRNode[],
): IR.IRCallExpression {
  return { type: IR.IRNodeType.CallExpression, callee, arguments: args };
}

export function createStr(value: string): IR.IRStringLiteral {
  return { type: IR.IRNodeType.StringLiteral, value };
}

export function createNull(): IR.IRNullLiteral {
  return { type: IR.IRNodeType.NullLiteral };
}

export function createExprStmt(expr: IR.IRNode): IR.IRExpressionStatement {
  return { type: IR.IRNodeType.ExpressionStatement, expression: expr };
}

export function createFnExpr(
  params: (IR.IRIdentifier | IR.IRArrayPattern | IR.IRObjectPattern)[],
  body: IR.IRBlockStatement,
  opts?: { id?: IR.IRIdentifier | null; async?: boolean; generator?: boolean; returnType?: string; typeParameters?: string[]; usesThis?: boolean },
): IR.IRFunctionExpression {
  const node: IR.IRFunctionExpression = {
    type: IR.IRNodeType.FunctionExpression,
    id: opts?.id ?? null,
    params,
    body,
  };
  if (opts?.async) node.async = opts.async;
  if (opts?.generator) node.generator = opts.generator;
  if (opts?.returnType) node.returnType = opts.returnType;
  if (opts?.typeParameters) node.typeParameters = opts.typeParameters;
  if (opts?.usesThis) node.usesThis = opts.usesThis;
  return node;
}

export function createMember(
  obj: IR.IRNode,
  prop: IR.IRNode,
  computed = false,
): IR.IRMemberExpression {
  return { type: IR.IRNodeType.MemberExpression, object: obj, property: prop, computed };
}

export function createVarDecl(
  name: string | IR.IRIdentifier | IR.IRArrayPattern | IR.IRObjectPattern | IR.IRRestElement | IR.IRAssignmentPattern,
  init: IR.IRNode | null,
  kind: "const" | "let" | "var" = "const",
): IR.IRVariableDeclaration {
  const id = typeof name === "string" ? createId(name) : name;
  return {
    type: IR.IRNodeType.VariableDeclaration,
    kind,
    declarations: [{
      type: IR.IRNodeType.VariableDeclarator,
      id,
      init,
    }],
  };
}

export function createNum(value: number): IR.IRNumericLiteral {
  return { type: IR.IRNodeType.NumericLiteral, value };
}

export function createArr(elements: IR.IRNode[]): IR.IRArrayExpression {
  return { type: IR.IRNodeType.ArrayExpression, elements };
}
