/**
 * Utilities for handling early returns and non-local returns
 */

import * as IR from "../type/hql_ir.ts";
import { RETURN_VALUE_VAR, EARLY_RETURN_FLAG } from "../../common/runtime-helper-impl.ts";

/**
 * Check if an IR node tree contains ReturnStatement nodes
 * Used to determine if a function needs try/catch wrapper for early returns
 */
export function containsReturnStatements(
  node: IR.IRNode | null | undefined,
): boolean {
  if (!node) return false;

  // Direct return statement
  if (node.type === IR.IRNodeType.ReturnStatement) {
    return true;
  }

  // Check in block statements
  if (node.type === IR.IRNodeType.BlockStatement) {
    const block = node as IR.IRBlockStatement;
    return block.body.some((stmt) => containsReturnStatements(stmt));
  }

  // Check in if statements
  if (node.type === IR.IRNodeType.IfStatement) {
    const ifStmt = node as IR.IRIfStatement;
    return containsReturnStatements(ifStmt.consequent) ||
      containsReturnStatements(ifStmt.alternate);
  }

  // Check in call expressions (IIFEs from do blocks)
  if (node.type === IR.IRNodeType.CallExpression) {
    const call = node as IR.IRCallExpression;
    if (call.callee.type === IR.IRNodeType.FunctionExpression) {
      const fn = call.callee as IR.IRFunctionExpression;
      return containsReturnStatements(fn.body);
    }
  }

  // Check in try statements
  if (node.type === IR.IRNodeType.TryStatement) {
    const tryStmt = node as IR.IRTryStatement;
    return containsReturnStatements(tryStmt.block) ||
      containsReturnStatements(tryStmt.handler?.body) ||
      containsReturnStatements(tryStmt.finalizer);
  }

  // Check in function expressions (nested functions)
  if (node.type === IR.IRNodeType.FunctionExpression) {
    const fn = node as IR.IRFunctionExpression;
    return containsReturnStatements(fn.body);
  }

  return false;
}

/**
 * Check if an IR node contains ThrowStatements (from transformed early returns)
 * After transformation, early returns become ThrowStatement with special object
 */
function containsThrowStatements(node: IR.IRNode | null | undefined): boolean {
  if (!node) return false;

  // Direct throw statement (early return)
  if (node.type === IR.IRNodeType.ThrowStatement) {
    return true;
  }

  // Check in block statements
  if (node.type === IR.IRNodeType.BlockStatement) {
    const block = node as IR.IRBlockStatement;
    return block.body.some((stmt) => containsThrowStatements(stmt));
  }

  // Check in if statements
  if (node.type === IR.IRNodeType.IfStatement) {
    const ifStmt = node as IR.IRIfStatement;
    return containsThrowStatements(ifStmt.consequent) ||
      containsThrowStatements(ifStmt.alternate);
  }

  // Check in call expressions (IIFEs from do blocks)
  if (node.type === IR.IRNodeType.CallExpression) {
    const call = node as IR.IRCallExpression;
    if (call.callee.type === IR.IRNodeType.FunctionExpression) {
      const fn = call.callee as IR.IRFunctionExpression;
      return containsThrowStatements(fn.body);
    }
    // Also check arguments
    return call.arguments.some((arg) => containsThrowStatements(arg));
  }

  // Check in try statements
  if (node.type === IR.IRNodeType.TryStatement) {
    const tryStmt = node as IR.IRTryStatement;
    return containsThrowStatements(tryStmt.block) ||
      containsThrowStatements(tryStmt.handler?.body) ||
      containsThrowStatements(tryStmt.finalizer);
  }

  // Check in return statements
  if (node.type === IR.IRNodeType.ReturnStatement) {
    const ret = node as IR.IRReturnStatement;
    return containsThrowStatements(ret.argument);
  }

  // Check in expression statements
  if (node.type === IR.IRNodeType.ExpressionStatement) {
    const expr = node as IR.IRExpressionStatement;
    return containsThrowStatements(expr.expression);
  }

  // Check in conditional expressions (ternary)
  if (node.type === IR.IRNodeType.ConditionalExpression) {
    const cond = node as IR.IRConditionalExpression;
    return containsThrowStatements(cond.test) ||
      containsThrowStatements(cond.consequent) ||
      containsThrowStatements(cond.alternate);
  }

  // Check in binary expressions
  if (node.type === IR.IRNodeType.BinaryExpression) {
    const bin = node as IR.IRBinaryExpression;
    return containsThrowStatements(bin.left) ||
      containsThrowStatements(bin.right);
  }

  // Check in unary expressions
  if (node.type === IR.IRNodeType.UnaryExpression) {
    const unary = node as IR.IRUnaryExpression;
    return containsThrowStatements(unary.argument);
  }

  // Check in logical expressions
  if (node.type === IR.IRNodeType.LogicalExpression) {
    const logic = node as IR.IRLogicalExpression;
    return containsThrowStatements(logic.left) ||
      containsThrowStatements(logic.right);
  }

  // Check in assignment expressions
  if (node.type === IR.IRNodeType.AssignmentExpression) {
    const assign = node as IR.IRAssignmentExpression;
    return containsThrowStatements(assign.right);
  }

  // Check in variable declarations
  if (node.type === IR.IRNodeType.VariableDeclaration) {
    const decl = node as IR.IRVariableDeclaration;
    return decl.declarations.some((d) => containsThrowStatements(d.init));
  }

  return false;
}

/**
 * Check if an IR node is inside a CallExpression (IIFE) and contains returns/throws
 * This helps determine if a function needs try/catch wrapper for early returns
 */
export function containsNestedReturns(
  node: IR.IRNode | null | undefined,
): boolean {
  if (!node) return false;

  // Check in call expressions (IIFEs and callback functions)
  if (node.type === IR.IRNodeType.CallExpression) {
    const call = node as IR.IRCallExpression;

    // Check IIFE (callee is a function expression)
    if (call.callee.type === IR.IRNodeType.FunctionExpression) {
      const fn = call.callee as IR.IRFunctionExpression;
      // Check for throw statements (transformed early returns)
      // IMPORTANT: Do NOT check for return statements here.
      // IIFEs naturally have return statements for their expression value.
      // These are local to the IIFE and should not trigger wrapping of the parent.
      // Only explicit throws (from transformed user returns) indicate non-local returns.
      if (containsThrowStatements(fn.body)) {
        return true;
      }
    }

    // Check callback function arguments (like __hql_for_each(seq, callback))
    // IMPORTANT: Only check for THROWS (transformed early returns), not returns.
    // For-loop callbacks have generated returns for expression values, which are
    // NOT user early returns. Only throws indicate actual user early returns.
    if (call.arguments) {
      for (const arg of call.arguments) {
        if (arg.type === IR.IRNodeType.FunctionExpression) {
          const fn = arg as IR.IRFunctionExpression;
          if (containsThrowStatements(fn.body)) {
            return true;
          }
        }
      }
    }
  }

  // Check in block statements
  if (node.type === IR.IRNodeType.BlockStatement) {
    const block = node as IR.IRBlockStatement;
    return block.body.some((stmt) => containsNestedReturns(stmt));
  }

  // Check in if statements
  if (node.type === IR.IRNodeType.IfStatement) {
    const ifStmt = node as IR.IRIfStatement;
    return containsNestedReturns(ifStmt.consequent) ||
      containsNestedReturns(ifStmt.alternate);
  }

  // Check in try statements
  if (node.type === IR.IRNodeType.TryStatement) {
    const tryStmt = node as IR.IRTryStatement;
    return containsNestedReturns(tryStmt.block) ||
      containsNestedReturns(tryStmt.handler?.body) ||
      containsNestedReturns(tryStmt.finalizer);
  }

  // Check in return statements (the argument may be an IIFE from do blocks)
  if (node.type === IR.IRNodeType.ReturnStatement) {
    const retStmt = node as IR.IRReturnStatement;
    return containsNestedReturns(retStmt.argument);
  }

  // Check in expression statements
  if (node.type === IR.IRNodeType.ExpressionStatement) {
    const exprStmt = node as IR.IRExpressionStatement;
    return containsNestedReturns(exprStmt.expression);
  }

  // Check in variable declarations
  if (node.type === IR.IRNodeType.VariableDeclaration) {
    const varDecl = node as IR.IRVariableDeclaration;
    return varDecl.declarations.some((decl) =>
      containsNestedReturns(decl.init)
    );
  }

  return false;
}

/**
 * Create the special early return object that will be thrown
 * Format: { __hql_early_return__: true, value: <returnValue> }
 */
export function createEarlyReturnObject(
  value: IR.IRNode,
): IR.IRObjectExpression {
  return {
    type: IR.IRNodeType.ObjectExpression,
    properties: [
      {
        type: IR.IRNodeType.ObjectProperty,
        key: {
          type: IR.IRNodeType.Identifier,
          name: EARLY_RETURN_FLAG,
        } as IR.IRIdentifier,
        value: {
          type: IR.IRNodeType.BooleanLiteral,
          value: true,
        } as IR.IRBooleanLiteral,
        shorthand: false,
        computed: false,
      } as IR.IRObjectProperty,
      {
        type: IR.IRNodeType.ObjectProperty,
        key: {
          type: IR.IRNodeType.Identifier,
          name: "value",
        } as IR.IRIdentifier,
        value: value,
        shorthand: false,
        computed: false,
      } as IR.IRObjectProperty,
    ],
  } as IR.IRObjectExpression;
}

/**
 * Create a try/catch wrapper for handling early returns
 * Wraps function body to catch early return throws and convert to actual returns
 */
export function wrapWithEarlyReturnHandler(
  body: IR.IRBlockStatement,
): IR.IRBlockStatement {
  const errorParam: IR.IRIdentifier = {
    type: IR.IRNodeType.Identifier,
    name: RETURN_VALUE_VAR,
  };

  // Check: __hql_ret__ && __hql_ret__.__hql_early_return__
  const checkCondition: IR.IRBinaryExpression = {
    type: IR.IRNodeType.BinaryExpression,
    operator: "&&",
    left: {
      type: IR.IRNodeType.Identifier,
      name: RETURN_VALUE_VAR,
    } as IR.IRIdentifier,
    right: {
      type: IR.IRNodeType.MemberExpression,
      object: {
        type: IR.IRNodeType.Identifier,
        name: RETURN_VALUE_VAR,
      } as IR.IRIdentifier,
      property: {
        type: IR.IRNodeType.Identifier,
        name: EARLY_RETURN_FLAG,
      } as IR.IRIdentifier,
      computed: false,
    } as IR.IRMemberExpression,
  };

  // Return: __hql_ret__.value
  const returnValue: IR.IRReturnStatement = {
    type: IR.IRNodeType.ReturnStatement,
    argument: {
      type: IR.IRNodeType.MemberExpression,
      object: {
        type: IR.IRNodeType.Identifier,
        name: RETURN_VALUE_VAR,
      } as IR.IRIdentifier,
      property: {
        type: IR.IRNodeType.Identifier,
        name: "value",
      } as IR.IRIdentifier,
      computed: false,
    } as IR.IRMemberExpression,
  };

  // Rethrow: throw __hql_ret__
  const rethrow: IR.IRThrowStatement = {
    type: IR.IRNodeType.ThrowStatement,
    argument: {
      type: IR.IRNodeType.Identifier,
      name: RETURN_VALUE_VAR,
    } as IR.IRIdentifier,
  };

  // if (__hql_ret__ && __hql_ret__.__hql_early_return__) return __hql_ret__.value; else throw __hql_ret__;
  const catchBody: IR.IRBlockStatement = {
    type: IR.IRNodeType.BlockStatement,
    body: [
      {
        type: IR.IRNodeType.IfStatement,
        test: checkCondition,
        consequent: returnValue,
        alternate: rethrow,
      } as IR.IRIfStatement,
    ],
  };

  const catchClause: IR.IRCatchClause = {
    type: IR.IRNodeType.CatchClause,
    param: errorParam,
    body: catchBody,
  };

  const tryStatement: IR.IRTryStatement = {
    type: IR.IRNodeType.TryStatement,
    block: body,
    handler: catchClause,
    finalizer: null,
  };

  return {
    type: IR.IRNodeType.BlockStatement,
    body: [tryStatement],
  };
}
