// src/transpiler/syntax/conditional.ts
// Module for handling conditional expressions (if, cond, etc.)

import * as IR from "../type/hql_ir.ts";
import type { HQLNode, ListNode, SymbolNode } from "../type/hql_ast.ts";
import {
  HQLError,
  perform,
  TransformError,
  ValidationError,
} from "../../common/error.ts";
import { getErrorMessage } from "../../common/utils.ts";
import { extractMetaSourceLocation, withSourceLocationOpts } from "../utils/source_location_utils.ts";
import { validateTransformed } from "../utils/validation-helpers.ts";
import { ensureReturnStatement } from "../utils/ir-helpers.ts";
import { isExpressionResult } from "../pipeline/hql-ast-to-hql-ir.ts";
import {
  enterIIFE,
  exitIIFE,
  isInsideIIFE,
} from "../pipeline/hql-ast-to-hql-ir.ts";
import { createEarlyReturnObject } from "../utils/return-helpers.ts";

/**
 * Check if an HQL AST node contains a return statement
 * Used to determine if a do block needs an IIFE wrapper even with a single expression
 */
function containsReturn(node: HQLNode | null | undefined): boolean {
  if (!node) return false;

  if (node.type === "list") {
    const listNode = node as ListNode;
    if (listNode.elements.length > 0 && listNode.elements[0]?.type === "symbol") {
      const sym = listNode.elements[0] as SymbolNode;

      // Direct return found
      if (sym.name === "return") return true;

      // Recursively check do blocks
      if (sym.name === "do") {
        return listNode.elements.slice(1).some(containsReturn);
      }

      // Recursively check if branches
      if (sym.name === "if") {
        return containsReturn(listNode.elements[2]) ||
          containsReturn(listNode.elements[3]);
      }

      // Check for loops - return inside for/while/loop
      if (sym.name === "for" || sym.name === "while" || sym.name === "loop") {
        return listNode.elements.slice(1).some(containsReturn);
      }
    }

    // Check all children for nested returns
    return listNode.elements.some(containsReturn);
  }

  return false;
}

/**
 * Check if an if expression contains recur in its branches
 * This helps determine if it should be a statement (for control flow) or expression (for values)
 */
function checkForRecur(list: ListNode): boolean {
  // Recursively check if a node or any nested nodes contain recur
  const checkNode = (node: HQLNode | null | undefined): boolean => {
    if (!node) return false;

    // Direct recur
    if (node.type === "list") {
      const listNode = node as ListNode;
      if (listNode.elements[0]?.type === "symbol") {
        const sym = listNode.elements[0] as SymbolNode;
        if (sym.name === "recur") return true;

        // Check do blocks for recur
        if (sym.name === "do") {
          // Check last expression in do block
          const lastExpr = listNode.elements[listNode.elements.length - 1];
          return checkNode(lastExpr);
        }

        // CRITICAL FIX: Recursively check nested if expressions
        if (sym.name === "if") {
          // Check consequent (then branch) - element[2]
          const hasThenRecur = listNode.elements[2]
            ? checkNode(listNode.elements[2])
            : false;
          // Check alternate (else branch) - element[3]
          const hasElseRecur = listNode.elements[3]
            ? checkNode(listNode.elements[3])
            : false;
          return hasThenRecur || hasElseRecur;
        }
      }
    }
    return false;
  };

  // Check consequent (then branch)
  const hasThenRecur = list.elements[2] ? checkNode(list.elements[2]) : false;
  // Check alternate (else branch)
  const hasElseRecur = list.elements[3] ? checkNode(list.elements[3]) : false;

  // If either branch has recur, treat as control flow statement
  return hasThenRecur || hasElseRecur;
}

/**
 * Transform an if expression.
 */
export function transformIf(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
  isInLoopContext: () => boolean,
  isExpressionContext: boolean = false,
): IR.IRNode {
  try {
    if (list.elements.length < 3 || list.elements.length > 4) {
      throw new ValidationError(
        `if requires 2 or 3 arguments, got ${list.elements.length - 1}`,
        "if expression",
        "2 or 3 arguments",
        { actualType: `${list.elements.length - 1} arguments`, ...extractMetaSourceLocation(list) },
      );
    }

    const test = validateTransformed(
      transformNode(list.elements[1], currentDir),
      "if test",
      "Test condition",
    );

    const consequent = validateTransformed(
      transformNode(list.elements[2], currentDir),
      "if consequent",
      "Then branch",
    );

    const alternate = list.elements.length > 3
      ? validateTransformed(
        transformNode(list.elements[3], currentDir),
        "if alternate",
        "Else branch",
      )
      : ({ type: IR.IRNodeType.NullLiteral } as IR.IRNullLiteral);

    // If explicitly in expression context, always use ConditionalExpression
    if (isExpressionContext) {
      return {
        type: IR.IRNodeType.ConditionalExpression,
        test,
        consequent,
        alternate,
      } as IR.IRConditionalExpression;
    }

    // IMPORTANT: Check loop context FIRST before general control flow
    // In loops, we need special handling to wrap value branches in returns
    if (isInLoopContext()) {
      // Check if branches contain recur (control flow)
      const hasRecurInBranches = checkForRecur(list);

      if (hasRecurInBranches) {
        // Wrap value-returning branches in ReturnStatement if needed
        const finalConsequent = ensureReturnStatement(consequent);

        let finalAlternate = alternate;
        if (
          alternate.type !== IR.IRNodeType.ReturnStatement &&
          alternate.type !== IR.IRNodeType.IfStatement &&
          alternate.type !== IR.IRNodeType.NullLiteral
        ) {
          finalAlternate = {
            type: IR.IRNodeType.ReturnStatement,
            argument: alternate,
          } as IR.IRReturnStatement;
        }

        // Both branches have control flow (recur), use if statement
        return {
          type: IR.IRNodeType.IfStatement,
          test,
          consequent: finalConsequent,
          alternate: finalAlternate,
        } as IR.IRIfStatement;
      }
      // Otherwise, it's a value-returning if in loop, use expression
    }

    // Check if either branch contains control flow statements (return, throw)
    // If so, use IfStatement instead of ConditionalExpression
    const hasControlFlow = consequent.type === IR.IRNodeType.ReturnStatement ||
      consequent.type === IR.IRNodeType.ThrowStatement ||
      alternate.type === IR.IRNodeType.ReturnStatement ||
      alternate.type === IR.IRNodeType.ThrowStatement;

    if (hasControlFlow) {
      // Use if statement for control flow
      return {
        type: IR.IRNodeType.IfStatement,
        test,
        consequent,
        alternate,
      } as IR.IRIfStatement;
    }

    // Default case - create conditional expression
    return {
      type: IR.IRNodeType.ConditionalExpression,
      test,
      consequent,
      alternate,
    } as IR.IRConditionalExpression;
  } catch (error) {
    // Preserve HQLError instances (ValidationError, ParseError, etc.)
    if (error instanceof HQLError) {
      throw error;
    }
    throw new TransformError(
      `Failed to transform if: ${
        getErrorMessage(error)
      }`,
      "if transformation",
      withSourceLocationOpts({ phase: "valid if expression" }, list),
    );
  }
}

/**
 * Transform a cond expression to nested conditional expressions
 */

/**
 * Transform a "return" statement
 * If inside an IIFE, transforms to throw for non-local return
 * Otherwise, creates a normal return statement
 */
export function transformReturn(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      // Verify we have at least one argument
      if (list.elements.length < 2) {
        throw new ValidationError(
          "return requires an expression to return",
          "return statement",
          "expression to return",
          "no expression provided",
        );
      }

      // Get the value to return
      const valueNode = validateTransformed(
        transformNode(list.elements[1], currentDir),
        "return value",
        "Return value",
      );

      // Check if we're inside an IIFE (do block, try block, etc.)
      // If so, transform to throw for non-local return
      if (isInsideIIFE()) {
        return {
          type: IR.IRNodeType.ThrowStatement,
          argument: createEarlyReturnObject(valueNode),
        } as IR.IRThrowStatement;
      }

      // Normal return statement (direct function body)
      return {
        type: IR.IRNodeType.ReturnStatement,
        argument: valueNode,
      } as IR.IRReturnStatement;
    },
    "transformReturn",
    TransformError,
    [list],
  );
}

/**
 * Transform a "do" expression - executes multiple expressions in sequence
 */
export function transformDo(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      // Get body expressions (skip the 'do' symbol)
      const bodyExprs = list.elements.slice(1);

      // If no body, return null
      if (bodyExprs.length === 0) {
        return { type: IR.IRNodeType.NullLiteral } as IR.IRNullLiteral;
      }

      // If only one expression AND it doesn't contain a return, transform directly
      // If it contains a return, we still need the IIFE wrapper for proper early return handling
      if (bodyExprs.length === 1 && !containsReturn(bodyExprs[0])) {
        const expr = transformNode(bodyExprs[0], currentDir);
        return expr ||
          ({ type: IR.IRNodeType.NullLiteral } as IR.IRNullLiteral);
      }

      // Multiple expressions - create statements for IIFE body
      const bodyStatements: IR.IRNode[] = [];

      // Enter IIFE context (for tracking nested returns)
      enterIIFE();

      try {
        // Transform all except the last expression
        for (let i = 0; i < bodyExprs.length - 1; i++) {
          const transformedExpr = transformNode(bodyExprs[i], currentDir);
          if (transformedExpr) {
            // Wrap expressions in ExpressionStatement for proper block statement body
            if (isExpressionResult(transformedExpr)) {
              bodyStatements.push({
                type: IR.IRNodeType.ExpressionStatement,
                expression: transformedExpr,
              } as IR.IRExpressionStatement);
            } else {
              bodyStatements.push(transformedExpr);
            }
          }
        }

        // Transform the last expression - it's the return value
        const lastExpr = transformNode(
          bodyExprs[bodyExprs.length - 1],
          currentDir,
        );

        if (lastExpr) {
          // CRITICAL FIX: Don't wrap certain statements in ReturnStatement
          // - IfStatement: contains recur in loop, has its own return logic
          // - ThrowStatement: early return via throw, shouldn't be wrapped
          // - ReturnStatement: already a return, don't double-wrap
          if (
            lastExpr.type === IR.IRNodeType.IfStatement ||
            lastExpr.type === IR.IRNodeType.ThrowStatement ||
            lastExpr.type === IR.IRNodeType.ReturnStatement
          ) {
            bodyStatements.push(lastExpr);
          } else {
            // Create a return statement for the last expression
            bodyStatements.push({
              type: IR.IRNodeType.ReturnStatement,
              argument: lastExpr,
            } as IR.IRReturnStatement);
          }
        }
      } finally {
        // Exit IIFE context
        exitIIFE();
      }

      // Return an IIFE (Immediately Invoked Function Expression)
      return {
        type: IR.IRNodeType.CallExpression,
        callee: {
          type: IR.IRNodeType.FunctionExpression,
          id: null,
          params: [],
          body: {
            type: IR.IRNodeType.BlockStatement,
            body: bodyStatements,
          } as IR.IRBlockStatement,
        } as IR.IRFunctionExpression,
        arguments: [],
      } as IR.IRCallExpression;
    },
    "transformDo",
    TransformError,
    [list],
  );
}

/**
 * Transform a "throw" statement
 */
export function transformThrow(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      // Verify we have exactly one argument
      if (list.elements.length !== 2) {
        throw new ValidationError(
          "throw requires exactly one expression to throw",
          "throw statement",
          "1 expression",
          `${list.elements.length - 1} arguments`,
        );
      }

      // Get the value to throw
      const valueNode = validateTransformed(
        transformNode(list.elements[1], currentDir),
        "throw value",
        "Throw value",
      );

      // Create a throw statement
      return {
        type: IR.IRNodeType.ThrowStatement,
        argument: valueNode,
      } as IR.IRThrowStatement;
    },
    "transformThrow",
    TransformError,
    [list],
  );
}

/**
 * Transform a ternary operator expression (? cond then else)
 * This is a simpler, expression-only version of if
 */
export function transformTernary(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      // Verify we have exactly three arguments
      if (list.elements.length !== 4) {
        throw new ValidationError(
          "ternary operator (?) requires exactly 3 arguments (condition, true-value, false-value)",
          "ternary expression",
          "3 arguments",
          `${list.elements.length - 1} arguments`,
        );
      }

      const test = validateTransformed(
        transformNode(list.elements[1], currentDir),
        "ternary test",
        "Condition expression",
      );

      const consequent = validateTransformed(
        transformNode(list.elements[2], currentDir),
        "ternary consequent",
        "True branch value",
      );

      const alternate = validateTransformed(
        transformNode(list.elements[3], currentDir),
        "ternary alternate",
        "False branch value",
      );

      // Ternary is always a ConditionalExpression (never a statement)
      return {
        type: IR.IRNodeType.ConditionalExpression,
        test,
        consequent,
        alternate,
      } as IR.IRConditionalExpression;
    },
    "transformTernary",
    TransformError,
    [list],
  );
}
