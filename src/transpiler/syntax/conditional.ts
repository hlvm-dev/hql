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
import { validateTransformed, validateListLength } from "../utils/validation-helpers.ts";
import { ensureReturnStatement } from "../utils/ir-helpers.ts";
import { isExpressionResult, extractMeta } from "../pipeline/hql-ast-to-hql-ir.ts";
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

    // Check if either branch contains control flow statements (not expressions)
    // If so, use IfStatement instead of ConditionalExpression
    // Note: VariableDeclaration is NOT included because HQL's let/var/const
    // are expression-returning - the code generator handles hoisting.
    // LabeledStatement is also not included because label transformation
    // wraps in IIFE when needed, making it expression-returning.
    const isStatement = (node: IR.IRNode) =>
      node.type === IR.IRNodeType.ReturnStatement ||
      node.type === IR.IRNodeType.ThrowStatement ||
      node.type === IR.IRNodeType.BreakStatement ||
      node.type === IR.IRNodeType.ContinueStatement ||
      node.type === IR.IRNodeType.ForOfStatement ||
      node.type === IR.IRNodeType.ForStatement ||
      node.type === IR.IRNodeType.WhileStatement;

    const hasControlFlow = isStatement(consequent) || isStatement(alternate);

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

      // Extract position from the 'do' list for the IIFE
      const listMeta = extractMeta(list);
      const listPosition = listMeta ? { line: listMeta.line, column: listMeta.column, filePath: listMeta.filePath } : undefined;

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
                position: transformedExpr.position, // Inherit position
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
          // - ForOfStatement, ForStatement, WhileStatement: these are statements,
          //   not expressions, so they can't be the argument of return.
          //   They should be followed by a separate return null.
          // - VariableDeclaration: also a statement, not an expression
          if (
            lastExpr.type === IR.IRNodeType.IfStatement ||
            lastExpr.type === IR.IRNodeType.ThrowStatement ||
            lastExpr.type === IR.IRNodeType.ReturnStatement
          ) {
            bodyStatements.push(lastExpr);
          } else if (
            lastExpr.type === IR.IRNodeType.ForOfStatement ||
            lastExpr.type === IR.IRNodeType.ForStatement ||
            lastExpr.type === IR.IRNodeType.WhileStatement ||
            lastExpr.type === IR.IRNodeType.VariableDeclaration
          ) {
            // These are statements that can't be returned directly
            // Push the statement first, then return null
            bodyStatements.push(lastExpr);
            bodyStatements.push({
              type: IR.IRNodeType.ReturnStatement,
              argument: { type: IR.IRNodeType.NullLiteral } as IR.IRNullLiteral,
              position: lastExpr.position,
            } as IR.IRReturnStatement);
          } else {
            // Create a return statement for the last expression
            bodyStatements.push({
              type: IR.IRNodeType.ReturnStatement,
              argument: lastExpr,
              position: lastExpr.position, // Inherit position
            } as IR.IRReturnStatement);
          }
        }
      } finally {
        // Exit IIFE context
        exitIIFE();
      }

      // Get position for block from first body statement
      const blockPosition = bodyStatements.length > 0 ? bodyStatements[0].position : listPosition;

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
            position: blockPosition,
          } as IR.IRBlockStatement,
          position: listPosition, // Position of the do block
        } as IR.IRFunctionExpression,
        arguments: [],
        position: listPosition, // Position of the do block
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
      validateListLength(list, 2, "throw");

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
      validateListLength(list, 4, "?", "ternary expression");

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

/**
 * Transform a switch expression.
 *
 * EXPRESSION-EVERYWHERE: switch is now an expression that returns the
 * value of the matched case branch.
 *
 * Syntax:
 * (switch expr
 *   (case val1 body...)
 *   (case val2 :fallthrough body...)  ; fallthrough to next case
 *   (default body...))
 *
 * Generates an IIFE-wrapped switch:
 * (() => {
 *   switch (expr) {
 *     case val1: { body...; return lastExpr; }
 *     case val2: { body...; } // fallthrough, no return
 *     default: { body...; return lastExpr; }
 *   }
 * })()
 */
export function transformSwitch(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      if (list.elements.length < 2) {
        throw new ValidationError(
          "switch requires a discriminant expression",
          "switch expression",
          "(switch expr (case val body...) ...)",
          `${list.elements.length - 1} arguments`,
        );
      }

      // Transform the discriminant expression
      const discriminant = validateTransformed(
        transformNode(list.elements[1], currentDir),
        "switch discriminant",
        "Switch expression",
      );

      // Process case clauses
      const cases: IR.IRSwitchCase[] = [];
      let hasDefault = false;

      for (let i = 2; i < list.elements.length; i++) {
        const caseNode = list.elements[i];

        if (caseNode.type !== "list") {
          throw new ValidationError(
            "switch case must be a list",
            "switch case",
            "(case val body...) or (default body...)",
            caseNode.type,
          );
        }

        const caseList = caseNode as ListNode;
        if (caseList.elements.length < 1) {
          throw new ValidationError(
            "switch case cannot be empty",
            "switch case",
            "(case val body...) or (default body...)",
            "empty list",
          );
        }

        const caseType = caseList.elements[0];
        if (caseType.type !== "symbol") {
          throw new ValidationError(
            "switch case must start with 'case' or 'default'",
            "switch case",
            "'case' or 'default'",
            caseType.type,
          );
        }

        const caseKeyword = (caseType as SymbolNode).name;

        if (caseKeyword === "case") {
          if (caseList.elements.length < 2) {
            throw new ValidationError(
              "case requires a test value",
              "case clause",
              "(case val body...)",
              `${caseList.elements.length - 1} elements`,
            );
          }

          // Check for :fallthrough keyword
          let fallthrough = false;
          let bodyStartIndex = 2;

          if (caseList.elements.length >= 3) {
            const maybeKeyword = caseList.elements[2];
            if (maybeKeyword.type === "symbol" &&
                (maybeKeyword as SymbolNode).name === ":fallthrough") {
              fallthrough = true;
              bodyStartIndex = 3;
            }
          }

          // Transform test value
          const test = validateTransformed(
            transformNode(caseList.elements[1], currentDir),
            "case test",
            "Case value",
          );

          // Transform body statements
          const bodyElements = caseList.elements.slice(bodyStartIndex);
          const consequent: IR.IRNode[] = [];

          for (let j = 0; j < bodyElements.length; j++) {
            const isLast = j === bodyElements.length - 1;
            const stmt = transformNode(bodyElements[j], currentDir);

            if (stmt) {
              // EXPRESSION-EVERYWHERE: Last expression becomes return value
              // (unless fallthrough, then no return)
              if (isLast && !fallthrough) {
                // Make last expression the return value
                if (stmt.type === IR.IRNodeType.ReturnStatement ||
                    stmt.type === IR.IRNodeType.ThrowStatement) {
                  // Already a return/throw, use as-is
                  consequent.push(stmt);
                } else if (stmt.type === IR.IRNodeType.ExpressionStatement) {
                  // Unwrap ExpressionStatement and return the expression
                  consequent.push({
                    type: IR.IRNodeType.ReturnStatement,
                    argument: (stmt as IR.IRExpressionStatement).expression,
                  } as IR.IRReturnStatement);
                } else if (stmt.type === IR.IRNodeType.VariableDeclaration ||
                           stmt.type === IR.IRNodeType.IfStatement ||
                           stmt.type === IR.IRNodeType.WhileStatement ||
                           stmt.type === IR.IRNodeType.ForStatement ||
                           stmt.type === IR.IRNodeType.ForOfStatement) {
                  // Statements that don't produce values - return null after
                  consequent.push(stmt);
                  consequent.push({
                    type: IR.IRNodeType.ReturnStatement,
                    argument: { type: IR.IRNodeType.NullLiteral } as IR.IRNullLiteral,
                  } as IR.IRReturnStatement);
                } else {
                  // Expression - wrap in return
                  consequent.push({
                    type: IR.IRNodeType.ReturnStatement,
                    argument: stmt,
                  } as IR.IRReturnStatement);
                }
              } else {
                // Not the last expression, or fallthrough - wrap as statement
                if (stmt.type !== IR.IRNodeType.ExpressionStatement &&
                    stmt.type !== IR.IRNodeType.VariableDeclaration &&
                    stmt.type !== IR.IRNodeType.ReturnStatement &&
                    stmt.type !== IR.IRNodeType.IfStatement &&
                    stmt.type !== IR.IRNodeType.WhileStatement &&
                    stmt.type !== IR.IRNodeType.ForStatement &&
                    stmt.type !== IR.IRNodeType.ForOfStatement &&
                    stmt.type !== IR.IRNodeType.ContinueStatement &&
                    stmt.type !== IR.IRNodeType.BreakStatement &&
                    stmt.type !== IR.IRNodeType.ThrowStatement) {
                  consequent.push({
                    type: IR.IRNodeType.ExpressionStatement,
                    expression: stmt,
                  } as IR.IRExpressionStatement);
                } else {
                  consequent.push(stmt);
                }
              }
            }
          }

          // If no body, return null
          if (consequent.length === 0 && !fallthrough) {
            consequent.push({
              type: IR.IRNodeType.ReturnStatement,
              argument: { type: IR.IRNodeType.NullLiteral } as IR.IRNullLiteral,
            } as IR.IRReturnStatement);
          }

          cases.push({
            type: IR.IRNodeType.SwitchCase,
            test,
            consequent,
            fallthrough,
          } as IR.IRSwitchCase);
        } else if (caseKeyword === "default") {
          hasDefault = true;

          // Transform body statements
          const bodyElements = caseList.elements.slice(1);
          const consequent: IR.IRNode[] = [];

          for (let j = 0; j < bodyElements.length; j++) {
            const isLast = j === bodyElements.length - 1;
            const stmt = transformNode(bodyElements[j], currentDir);

            if (stmt) {
              // EXPRESSION-EVERYWHERE: Last expression becomes return value
              if (isLast) {
                if (stmt.type === IR.IRNodeType.ReturnStatement ||
                    stmt.type === IR.IRNodeType.ThrowStatement) {
                  consequent.push(stmt);
                } else if (stmt.type === IR.IRNodeType.ExpressionStatement) {
                  consequent.push({
                    type: IR.IRNodeType.ReturnStatement,
                    argument: (stmt as IR.IRExpressionStatement).expression,
                  } as IR.IRReturnStatement);
                } else if (stmt.type === IR.IRNodeType.VariableDeclaration ||
                           stmt.type === IR.IRNodeType.IfStatement ||
                           stmt.type === IR.IRNodeType.WhileStatement ||
                           stmt.type === IR.IRNodeType.ForStatement ||
                           stmt.type === IR.IRNodeType.ForOfStatement) {
                  consequent.push(stmt);
                  consequent.push({
                    type: IR.IRNodeType.ReturnStatement,
                    argument: { type: IR.IRNodeType.NullLiteral } as IR.IRNullLiteral,
                  } as IR.IRReturnStatement);
                } else {
                  consequent.push({
                    type: IR.IRNodeType.ReturnStatement,
                    argument: stmt,
                  } as IR.IRReturnStatement);
                }
              } else {
                if (stmt.type !== IR.IRNodeType.ExpressionStatement &&
                    stmt.type !== IR.IRNodeType.VariableDeclaration &&
                    stmt.type !== IR.IRNodeType.ReturnStatement &&
                    stmt.type !== IR.IRNodeType.IfStatement &&
                    stmt.type !== IR.IRNodeType.WhileStatement &&
                    stmt.type !== IR.IRNodeType.ForStatement &&
                    stmt.type !== IR.IRNodeType.ForOfStatement &&
                    stmt.type !== IR.IRNodeType.ContinueStatement &&
                    stmt.type !== IR.IRNodeType.BreakStatement &&
                    stmt.type !== IR.IRNodeType.ThrowStatement) {
                  consequent.push({
                    type: IR.IRNodeType.ExpressionStatement,
                    expression: stmt,
                  } as IR.IRExpressionStatement);
                } else {
                  consequent.push(stmt);
                }
              }
            }
          }

          // If no body, return null
          if (consequent.length === 0) {
            consequent.push({
              type: IR.IRNodeType.ReturnStatement,
              argument: { type: IR.IRNodeType.NullLiteral } as IR.IRNullLiteral,
            } as IR.IRReturnStatement);
          }

          cases.push({
            type: IR.IRNodeType.SwitchCase,
            test: null, // null test means default case
            consequent,
            fallthrough: false,
          } as IR.IRSwitchCase);
        } else {
          throw new ValidationError(
            "switch case must be 'case' or 'default'",
            "switch case",
            "'case' or 'default'",
            caseKeyword,
          );
        }
      }

      // If no default case, add one that returns null
      if (!hasDefault) {
        cases.push({
          type: IR.IRNodeType.SwitchCase,
          test: null,
          consequent: [{
            type: IR.IRNodeType.ReturnStatement,
            argument: { type: IR.IRNodeType.NullLiteral } as IR.IRNullLiteral,
          } as IR.IRReturnStatement],
          fallthrough: false,
        } as IR.IRSwitchCase);
      }

      // Create the switch statement
      const switchStmt: IR.IRSwitchStatement = {
        type: IR.IRNodeType.SwitchStatement,
        discriminant,
        cases,
      };

      // EXPRESSION-EVERYWHERE: Wrap in IIFE to make switch an expression
      // (() => { switch(expr) { case v1: return r1; ... } })()
      const iife: IR.IRCallExpression = {
        type: IR.IRNodeType.CallExpression,
        callee: {
          type: IR.IRNodeType.FunctionExpression,
          id: null,
          params: [],
          body: {
            type: IR.IRNodeType.BlockStatement,
            body: [switchStmt],
          } as IR.IRBlockStatement,
        } as IR.IRFunctionExpression,
        arguments: [],
      };

      return iife;
    },
    "transformSwitch",
    TransformError,
    [list],
  );
}

/**
 * Transform a case expression (Clojure-style expression-based switch).
 *
 * EXPRESSION-EVERYWHERE: case is an expression that returns the matched value.
 * This follows Clojure's case semantics.
 *
 * Syntax:
 * (case expr
 *   val1 result1
 *   val2 result2
 *   default-result)    ; optional default (odd number of args after expr)
 *
 * Examples:
 * (case day
 *   :monday "Start of week"
 *   :friday "Almost weekend"
 *   "Just another day")
 *
 * (def result (case status
 *               :ok "Success"
 *               :error "Failed"))
 *
 * Generates an IIFE-wrapped switch that returns values:
 * (() => {
 *   switch (expr) {
 *     case val1: return result1;
 *     case val2: return result2;
 *     default: return defaultResult;
 *   }
 * })()
 */
export function transformCase(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      if (list.elements.length < 2) {
        throw new ValidationError(
          "case requires a test expression",
          "case expression",
          "(case expr val1 result1 val2 result2 ... [default])",
          `${list.elements.length - 1} arguments`,
        );
      }

      // Transform the discriminant expression
      const discriminant = validateTransformed(
        transformNode(list.elements[1], currentDir),
        "case discriminant",
        "Case expression",
      );

      // Process case pairs: val1 result1 val2 result2 ...
      // If odd number of remaining elements, last one is default
      const caseArgs = list.elements.slice(2);
      const hasDefault = caseArgs.length % 2 === 1;
      const pairCount = Math.floor(caseArgs.length / 2);

      const cases: IR.IRSwitchCase[] = [];

      // Process each test-value/result pair
      for (let i = 0; i < pairCount; i++) {
        const testNode = caseArgs[i * 2];
        const resultNode = caseArgs[i * 2 + 1];

        // Transform test value
        const test = validateTransformed(
          transformNode(testNode, currentDir),
          "case test",
          `Case test value ${i + 1}`,
        );

        // Transform result - wrap in ReturnStatement for IIFE
        const result = validateTransformed(
          transformNode(resultNode, currentDir),
          "case result",
          `Case result ${i + 1}`,
        );

        cases.push({
          type: IR.IRNodeType.SwitchCase,
          test,
          consequent: [{
            type: IR.IRNodeType.ReturnStatement,
            argument: result,
          } as IR.IRReturnStatement],
          fallthrough: false,
        } as IR.IRSwitchCase);
      }

      // Add default case
      if (hasDefault) {
        // Explicit default value provided
        const defaultResult = validateTransformed(
          transformNode(caseArgs[caseArgs.length - 1], currentDir),
          "case default",
          "Default result",
        );

        cases.push({
          type: IR.IRNodeType.SwitchCase,
          test: null, // null test means default case
          consequent: [{
            type: IR.IRNodeType.ReturnStatement,
            argument: defaultResult,
          } as IR.IRReturnStatement],
          fallthrough: false,
        } as IR.IRSwitchCase);
      } else {
        // No default provided - return null for unmatched cases
        cases.push({
          type: IR.IRNodeType.SwitchCase,
          test: null,
          consequent: [{
            type: IR.IRNodeType.ReturnStatement,
            argument: { type: IR.IRNodeType.NullLiteral } as IR.IRNullLiteral,
          } as IR.IRReturnStatement],
          fallthrough: false,
        } as IR.IRSwitchCase);
      }

      // Create the switch statement
      const switchStmt: IR.IRSwitchStatement = {
        type: IR.IRNodeType.SwitchStatement,
        discriminant,
        cases,
      };

      // EXPRESSION-EVERYWHERE: Wrap in IIFE to make it an expression
      // (() => { switch(expr) { case v1: return r1; ... } })()
      const iife: IR.IRCallExpression = {
        type: IR.IRNodeType.CallExpression,
        callee: {
          type: IR.IRNodeType.FunctionExpression,
          id: null,
          params: [],
          body: {
            type: IR.IRNodeType.BlockStatement,
            body: [switchStmt],
          } as IR.IRBlockStatement,
        } as IR.IRFunctionExpression,
        arguments: [],
      };

      return iife;
    },
    "transformCase",
    TransformError,
    [list],
  );
}
