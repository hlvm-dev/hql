/**
 * Utilities for handling early returns and non-local returns
 */

import * as IR from "../type/hql_ir.ts";
import { RETURN_VALUE_VAR, EARLY_RETURN_FLAG } from "../../common/runtime-helper-impl.ts";
import {
  containsThrowStatement,
  containsMatch,
} from "./ir-tree-walker.ts";

/**
 * Check if an IR node contains ThrowStatements (from transformed early returns)
 * After transformation, early returns become ThrowStatement with special object
 *
 * Uses generic tree walker - automatically handles ALL IR node types.
 */
const containsThrowStatements = containsThrowStatement;

/**
 * Check if an IR node contains IIFEs or callback functions with throws (early returns)
 * This helps determine if a function needs try/catch wrapper for early returns.
 *
 * Uses generic tree walker - automatically handles ALL IR node types.
 *
 * IMPORTANT: Only checks for THROWS (transformed early returns), not returns.
 * IIFEs and callbacks naturally have return statements for their expression value.
 * These are local returns and should not trigger wrapping of the parent.
 * Only explicit throws (from transformed user returns) indicate non-local returns.
 */
export function containsNestedReturns(
  node: IR.IRNode | null | undefined,
): boolean {
  if (!node) return false;

  // Use generic walker to find any CallExpression that has an IIFE or callback with throws
  return containsMatch(node, (n) => {
    if (n.type !== IR.IRNodeType.CallExpression) return false;

    const call = n as IR.IRCallExpression;

    // Check IIFE (callee is a function expression)
    if (call.callee.type === IR.IRNodeType.FunctionExpression) {
      const fn = call.callee as IR.IRFunctionExpression;
      if (containsThrowStatements(fn.body)) {
        return true;
      }
    }

    // Check callback function arguments (like __hql_for_each(seq, callback))
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

    return false;
  });
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
