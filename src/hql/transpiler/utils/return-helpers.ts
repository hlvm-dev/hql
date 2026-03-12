/**
 * Utilities for handling early returns and non-local returns
 */

import * as IR from "../type/hql_ir.ts";
import { RETURN_VALUE_VAR, EARLY_RETURN_FLAG } from "../../../common/runtime-helper-impl.ts";
import {
  containsThrowStatement,
  containsMatch,
} from "./ir-tree-walker.ts";
import { createBlock, createId, createReturn, createMember } from "./ir-helpers.ts";

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
      if (containsThrowStatement(fn.body)) {
        return true;
      }
    }

    // Check callback function arguments (like __hql_for_each(seq, callback))
    if (call.arguments) {
      for (const arg of call.arguments) {
        if (arg.type === IR.IRNodeType.FunctionExpression) {
          const fn = arg as IR.IRFunctionExpression;
          if (containsThrowStatement(fn.body)) {
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
        key: createId(EARLY_RETURN_FLAG),
        value: {
          type: IR.IRNodeType.BooleanLiteral,
          value: true,
        } as IR.IRBooleanLiteral,
        shorthand: false,
        computed: false,
      } as IR.IRObjectProperty,
      {
        type: IR.IRNodeType.ObjectProperty,
        key: createId("value"),
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
  const errorParam = createId(RETURN_VALUE_VAR);

  // Check: __hql_ret__ && __hql_ret__.__hql_early_return__
  const checkCondition: IR.IRBinaryExpression = {
    type: IR.IRNodeType.BinaryExpression,
    operator: "&&",
    left: createId(RETURN_VALUE_VAR),
    right: createMember(createId(RETURN_VALUE_VAR), createId(EARLY_RETURN_FLAG)),
  };

  // Return: __hql_ret__.value
  const returnValue = createReturn(
    createMember(createId(RETURN_VALUE_VAR), createId("value")),
  );

  // Rethrow: throw __hql_ret__
  const rethrow: IR.IRThrowStatement = {
    type: IR.IRNodeType.ThrowStatement,
    argument: createId(RETURN_VALUE_VAR),
  };

  // if (__hql_ret__ && __hql_ret__.__hql_early_return__) return __hql_ret__.value; else throw __hql_ret__;
  const catchBody: IR.IRBlockStatement = createBlock([
    {
      type: IR.IRNodeType.IfStatement,
      test: checkCondition,
      consequent: returnValue,
      alternate: rethrow,
    } as IR.IRIfStatement,
  ]);

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

  return createBlock([tryStatement]);
}
