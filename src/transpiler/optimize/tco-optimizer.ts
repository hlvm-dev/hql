/**
 * Tail Call Optimization (TCO) for self-recursive fn functions
 *
 * Transforms tail-recursive functions to while loops automatically.
 * No special syntax required - just write normal recursive code.
 *
 * Example:
 *   (fn factorial [n acc]
 *     (if (<= n 1) acc (factorial (- n 1) (* n acc))))
 *
 * Becomes:
 *   function factorial(n, acc) {
 *     while (true) {
 *       if (n <= 1) return acc;
 *       [n, acc] = [n - 1, n * acc];
 *     }
 *   }
 */

import * as IR from "../type/hql_ir.ts";
import { checkTailRecursion } from "./tail-position-analyzer.ts";

// ============================================================================
// Detection: Uses shared tail-position-analyzer utility
// ============================================================================

/**
 * Check if a node is a call to the specified function
 */
function isRecursiveCall(node: IR.IRNode, funcName: string): boolean {
  return (
    node.type === IR.IRNodeType.CallExpression &&
    (node as IR.IRCallExpression).callee.type === IR.IRNodeType.Identifier &&
    ((node as IR.IRCallExpression).callee as IR.IRIdentifier).name === funcName
  );
}

/**
 * Check if function body has tail-recursive calls.
 * Uses shared tail-position-analyzer utility.
 *
 * Returns true if:
 * - Function contains recursive calls
 * - ALL recursive calls are in tail position
 */
function hasTailRecursion(body: IR.IRBlockStatement, funcName: string): boolean {
  const { hasRecursion, allTailCalls } = checkTailRecursion(body, funcName);
  return hasRecursion && allTailCalls;
}

// ============================================================================
// Transformation: Convert tail calls to parameter reassignment
// ============================================================================

/**
 * Get parameter names from function params (only simple identifiers)
 */
function getParamNames(params: IR.IRNode[]): string[] {
  return params
    .filter((p): p is IR.IRIdentifier => p.type === IR.IRNodeType.Identifier)
    .map(p => p.name);
}

/**
 * Create destructuring assignment: [p1, p2, ...] = [arg1, arg2, ...]
 */
function createParamReassignment(
  paramNames: string[],
  args: IR.IRNode[]
): IR.IRExpressionStatement {
  return {
    type: IR.IRNodeType.ExpressionStatement,
    expression: {
      type: IR.IRNodeType.AssignmentExpression,
      operator: "=",
      left: {
        type: IR.IRNodeType.ArrayPattern,
        elements: paramNames.map(name => ({
          type: IR.IRNodeType.Identifier,
          name
        } as IR.IRIdentifier))
      } as IR.IRArrayPattern,
      right: {
        type: IR.IRNodeType.ArrayExpression,
        elements: args
      } as IR.IRArrayExpression
    } as IR.IRAssignmentExpression
  };
}

/**
 * Transform function body, replacing tail calls with parameter reassignment
 */
function transformBody(
  node: IR.IRNode,
  funcName: string,
  paramNames: string[]
): IR.IRNode {
  switch (node.type) {
    case IR.IRNodeType.BlockStatement: {
      const block = node as IR.IRBlockStatement;
      return {
        type: IR.IRNodeType.BlockStatement,
        body: block.body.map(stmt => transformBody(stmt, funcName, paramNames))
      } as IR.IRBlockStatement;
    }

    case IR.IRNodeType.ReturnStatement: {
      const ret = node as IR.IRReturnStatement;
      if (!ret.argument) return node;

      // Direct tail call
      if (isRecursiveCall(ret.argument, funcName)) {
        const call = ret.argument as IR.IRCallExpression;
        return createParamReassignment(paramNames, call.arguments);
      }

      // Conditional with potential tail calls
      if (ret.argument.type === IR.IRNodeType.ConditionalExpression) {
        const cond = ret.argument as IR.IRConditionalExpression;
        return {
          type: IR.IRNodeType.IfStatement,
          test: cond.test,
          consequent: transformBranch(cond.consequent, funcName, paramNames),
          alternate: transformBranch(cond.alternate, funcName, paramNames)
        } as IR.IRIfStatement;
      }

      return node;
    }

    case IR.IRNodeType.IfStatement: {
      const ifStmt = node as IR.IRIfStatement;
      return {
        type: IR.IRNodeType.IfStatement,
        test: ifStmt.test,
        consequent: transformBody(ifStmt.consequent, funcName, paramNames),
        alternate: ifStmt.alternate
          ? transformBody(ifStmt.alternate, funcName, paramNames)
          : null
      } as IR.IRIfStatement;
    }

    default:
      return node;
  }
}

/**
 * Transform a conditional branch (consequent or alternate)
 */
function transformBranch(
  node: IR.IRNode,
  funcName: string,
  paramNames: string[]
): IR.IRNode {
  // Tail call -> reassignment
  if (isRecursiveCall(node, funcName)) {
    const call = node as IR.IRCallExpression;
    return createParamReassignment(paramNames, call.arguments);
  }

  // Nested conditional
  if (node.type === IR.IRNodeType.ConditionalExpression) {
    const cond = node as IR.IRConditionalExpression;
    return {
      type: IR.IRNodeType.IfStatement,
      test: cond.test,
      consequent: transformBranch(cond.consequent, funcName, paramNames),
      alternate: transformBranch(cond.alternate, funcName, paramNames)
    } as IR.IRIfStatement;
  }

  // Base case -> return
  return {
    type: IR.IRNodeType.ReturnStatement,
    argument: node
  } as IR.IRReturnStatement;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Apply TCO transformation to a function declaration
 *
 * Returns the original function if:
 * - Not recursive
 * - Has recursive calls but not in tail position
 */
export function applyTCO(func: IR.IRFnFunctionDeclaration): IR.IRFnFunctionDeclaration {
  const funcName = func.id.name;

  // Single-pass analysis: check for tail recursion
  if (!hasTailRecursion(func.body, funcName)) {
    return func;
  }

  // Transform body
  const paramNames = getParamNames(func.params);
  const transformedBody = transformBody(func.body, funcName, paramNames);

  // Wrap in while(true)
  return {
    ...func,
    body: {
      type: IR.IRNodeType.BlockStatement,
      body: [{
        type: IR.IRNodeType.WhileStatement,
        test: { type: IR.IRNodeType.BooleanLiteral, value: true } as IR.IRBooleanLiteral,
        body: transformedBody as IR.IRBlockStatement
      } as IR.IRWhileStatement]
    }
  };
}
