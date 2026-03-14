// src/hql/transpiler/syntax/conditional.ts
// Module for handling conditional expressions (if, cond, etc.)

import * as IR from "../type/hql_ir.ts";
import type { HQLNode, ListNode, SymbolNode } from "../type/hql_ast.ts";
import {
  HQLError,
  TransformError,
  ValidationError,
} from "../../../common/error.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import { extractMetaSourceLocation, withSourceLocationOpts } from "../utils/source_location_utils.ts";
import { extractPosition, validateTransformed, validateListLength } from "../utils/validation-helpers.ts";
import {
  ensureReturnStatement,
  createBlock,
  createReturn,
  createNull,
  createExprStmt,
  createSwitchCase,
  createCall,
  createFnExpr,
  wrapIIFEResult,
} from "../utils/ir-helpers.ts";
import { isExpressionResult, extractMeta, copyPosition } from "../pipeline/hql-ast-to-hql-ir.ts";
import {
  enterIIFE,
  exitIIFE,
  isInsideIIFE,
} from "../pipeline/hql-ast-to-hql-ir.ts";
import { createEarlyReturnObject } from "../utils/return-helpers.ts";
import { STATEMENT_TYPES } from "../constants/index.ts";
import {
  containsNodeTypeInScope,
} from "../utils/ir-tree-walker.ts";

// Sets for efficient type checking in switch statement processing
const TERMINAL_STATEMENT_TYPES = new Set([
  IR.IRNodeType.ReturnStatement,
  IR.IRNodeType.ThrowStatement,
]);

const NON_VALUE_STATEMENT_TYPES = new Set([
  IR.IRNodeType.VariableDeclaration,
  IR.IRNodeType.IfStatement,
  IR.IRNodeType.WhileStatement,
  IR.IRNodeType.ForStatement,
  IR.IRNodeType.ForOfStatement,
]);

const CONTROL_FLOW_STATEMENT_TYPES = new Set([
  IR.IRNodeType.ReturnStatement,
  IR.IRNodeType.ThrowStatement,
  IR.IRNodeType.IfStatement,
  IR.IRNodeType.BreakStatement,
  IR.IRNodeType.ContinueStatement,
  IR.IRNodeType.ForOfStatement,
  IR.IRNodeType.ForStatement,
  IR.IRNodeType.WhileStatement,
]);

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
      : createNull();

    // If explicitly in expression context, always use ConditionalExpression
    if (isExpressionContext) {
      const result = {
        type: IR.IRNodeType.ConditionalExpression,
        test,
        consequent,
        alternate,
      } as IR.IRConditionalExpression;
      copyPosition(list, result);
      return result;
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
          finalAlternate = createReturn(alternate);
        }

        // Both branches have control flow (recur), use if statement
        const result = {
          type: IR.IRNodeType.IfStatement,
          test,
          consequent: finalConsequent,
          alternate: finalAlternate,
        } as IR.IRIfStatement;
        copyPosition(list, result);
        return result;
      }
      // Otherwise, it's a value-returning if in loop, use expression
    }

    // Check if either branch contains control flow statements (not expressions)
    // If so, use IfStatement instead of ConditionalExpression
    // Note: VariableDeclaration is NOT included because HQL's let/var/const
    // are expression-returning - the code generator handles hoisting.
    // LabeledStatement is also not included because label transformation
    // wraps in IIFE when needed, making it expression-returning.
    const hasControlFlow = CONTROL_FLOW_STATEMENT_TYPES.has(consequent.type) ||
      CONTROL_FLOW_STATEMENT_TYPES.has(alternate.type);

    if (hasControlFlow) {
      // Use if statement for control flow
      const result = {
        type: IR.IRNodeType.IfStatement,
        test,
        consequent,
        alternate,
      } as IR.IRIfStatement;
      copyPosition(list, result);
      return result;
    }

    // Default case - create conditional expression
    const result = {
      type: IR.IRNodeType.ConditionalExpression,
      test,
      consequent,
      alternate,
    } as IR.IRConditionalExpression;
    copyPosition(list, result);
    return result;
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
    const result = {
      type: IR.IRNodeType.ThrowStatement,
      argument: createEarlyReturnObject(valueNode),
    } as IR.IRThrowStatement;
    copyPosition(list, result);
    return result;
  }

  // Normal return statement (direct function body)
  const result = createReturn(valueNode);
  copyPosition(list, result);
  return result;
}

/**
 * Transform a "do" expression - executes multiple expressions in sequence
 *
 * OPTIMIZATION: Uses comma operator (SequenceExpression) when all children
 * are pure expressions. Falls back to IIFE when statements are present.
 */
export function transformDo(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  // Get body expressions (skip the 'do' symbol)
  const bodyExprs = list.elements.slice(1);

  // If no body, return null
  if (bodyExprs.length === 0) {
    return createNull();
  }

  // If only one expression AND it doesn't contain a return, transform directly
  // If it contains a return, we still need the IIFE wrapper for proper early return handling
  if (bodyExprs.length === 1 && !containsReturn(bodyExprs[0])) {
    const expr = transformNode(bodyExprs[0], currentDir);
    return expr || createNull();
  }

  // Extract position from the 'do' list
  const listMeta = extractMeta(list);
  const listPosition = listMeta ? {
    line: listMeta.line,
    column: listMeta.column,
    endLine: typeof listMeta.endLine === "number" ? listMeta.endLine : undefined,
    endColumn: typeof listMeta.endColumn === "number" ? listMeta.endColumn : undefined,
    filePath: listMeta.filePath,
  } as IR.SourcePosition : undefined;

  // First pass: Check if any expression contains return (AST level check)
  const hasReturnInAST = bodyExprs.some(containsReturn);

  // Transform all body expressions
  const transformedExprs: IR.IRNode[] = [];
  for (const expr of bodyExprs) {
    const transformed = transformNode(expr, currentDir);
    if (transformed) {
      transformedExprs.push(transformed);
    }
  }

  // OPTIMIZATION: Check if we can use comma operator (SequenceExpression)
  // Requirements:
  // 1. No early returns in AST
  // 2. All transformed nodes are pure expressions (not statements)
  const canUseCommaOperator = !hasReturnInAST &&
    transformedExprs.every(node => isExpressionResult(node));

  if (canUseCommaOperator && transformedExprs.length > 0) {
    // Use native JS comma operator: (expr1, expr2, expr3) => returns last value
    return {
      type: IR.IRNodeType.SequenceExpression,
      expressions: transformedExprs,
      position: listPosition,
    } as IR.IRSequenceExpression;
  }

  // Fall back to IIFE for statements or control flow
  const bodyStatements: IR.IRNode[] = [];

  // Enter IIFE context (for tracking nested returns)
  enterIIFE();

  try {
    // Transform all except the last expression
    for (let i = 0; i < transformedExprs.length - 1; i++) {
      const transformedExpr = transformedExprs[i];
      // Wrap expressions in ExpressionStatement for proper block statement body
      if (isExpressionResult(transformedExpr)) {
        bodyStatements.push({ ...createExprStmt(transformedExpr), position: transformedExpr.position });
      } else {
        bodyStatements.push(transformedExpr);
      }
    }

    // Handle the last expression - it's the return value
    const lastExpr = transformedExprs[transformedExprs.length - 1];

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
        bodyStatements.push({ ...createReturn(createNull()), position: lastExpr.position });
      } else {
        // Create a return statement for the last expression
        bodyStatements.push({ ...createReturn(lastExpr), position: lastExpr.position });
      }
    }
  } finally {
    // Exit IIFE context
    exitIIFE();
  }

  // Get position for block from first body statement
  const blockPosition = bodyStatements.length > 0 ? bodyStatements[0].position : listPosition;

  // Check if the IIFE body contains any yield or await expressions
  // If so, we need to make the IIFE a generator/async and wrap appropriately
  // Check for yield/await in scope (stops at function boundaries)
  // This ensures that yield inside a nested fn* generator doesn't trigger
  // the outer do-block to become a generator
  const hasYields = bodyStatements.some(stmt =>
    containsNodeTypeInScope(stmt, IR.IRNodeType.YieldExpression));
  const hasAwaits = bodyStatements.some(stmt =>
    containsNodeTypeInScope(stmt, IR.IRNodeType.AwaitExpression));

  const iifeFn = createFnExpr([], createBlock(bodyStatements, blockPosition), {
    generator: hasYields, // Make it a generator if yields are present
    async: hasAwaits, // Make it async if awaits are present (can be async generator)
  });
  iifeFn.position = listPosition;
  const iifeCall: IR.IRCallExpression = { ...createCall(iifeFn, []), position: listPosition };

  // If yields are present, wrap the IIFE call with yield*
  // This delegates to the generator IIFE, properly handling all yields
  if (hasYields) {
    return {
      type: IR.IRNodeType.YieldExpression,
      delegate: true,
      argument: iifeCall,
      position: listPosition,
    } as IR.IRYieldExpression;
  }

  // If awaits are present, wrap the IIFE call with await
  // This awaits the async IIFE, properly handling all awaits
  if (hasAwaits) {
    return {
      type: IR.IRNodeType.AwaitExpression,
      argument: iifeCall,
      position: listPosition,
    } as IR.IRAwaitExpression;
  }

  return iifeCall;
}

/**
 * Transform a "throw" statement
 */
export function transformThrow(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  validateListLength(list, 2, "throw");

  // Get the value to throw
  const valueNode = validateTransformed(
    transformNode(list.elements[1], currentDir),
    "throw value",
    "Throw value",
  );

  // Create a throw statement
  const result = {
    type: IR.IRNodeType.ThrowStatement,
    argument: valueNode,
  } as IR.IRThrowStatement;
  copyPosition(list, result);
  return result;
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
  const result = {
    type: IR.IRNodeType.ConditionalExpression,
    test,
    consequent,
    alternate,
  } as IR.IRConditionalExpression;
  copyPosition(list, result);
  return result;
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
 *   (case val2 :fallthrough body...)  // fallthrough to next case
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

/**
 * Process a statement for switch case body.
 * Handles wrapping the last expression as a return value.
 */
function processSwitchBodyStatement(
  stmt: IR.IRNode,
  isLast: boolean,
  fallthrough: boolean,
  consequent: IR.IRNode[],
): void {
  // Not the last expression, or fallthrough case - wrap as statement if needed
  if (!isLast || fallthrough) {
    if (!STATEMENT_TYPES.has(stmt.type)) {
      consequent.push(createExprStmt(stmt));
    } else {
      consequent.push(stmt);
    }
    return;
  }

  // Last expression becomes return value
  if (TERMINAL_STATEMENT_TYPES.has(stmt.type)) {
    // Already a return/throw, use as-is
    consequent.push(stmt);
  } else if (stmt.type === IR.IRNodeType.ExpressionStatement) {
    // Unwrap ExpressionStatement and return the expression
    consequent.push(createReturn((stmt as IR.IRExpressionStatement).expression));
  } else if (NON_VALUE_STATEMENT_TYPES.has(stmt.type)) {
    // Statements that don't produce values - return null after
    consequent.push(stmt);
    consequent.push(createReturn(createNull()));
  } else {
    // Expression - wrap in return
    consequent.push(createReturn(stmt));
  }
}

/** Single-pass partition of switch cases into default + regular cases. */
function partitionSwitchCases(
  cases: IR.IRSwitchCase[],
): { defaultCase: IR.IRSwitchCase; regularCases: IR.IRSwitchCase[] } {
  let defaultCase: IR.IRSwitchCase | undefined;
  const regularCases: IR.IRSwitchCase[] = [];
  for (const c of cases) {
    if ((c as IR.IRSwitchCase).test === null) {
      defaultCase = c as IR.IRSwitchCase;
    } else {
      regularCases.push(c as IR.IRSwitchCase);
    }
  }
  return { defaultCase: defaultCase!, regularCases };
}

/**
 * Build a right-to-left chain of ternary expressions from switch cases.
 * Shared by transformSwitch (when canUseTernary) and transformCase.
 *
 * (discriminant === v1 ? r1 : discriminant === v2 ? r2 : defaultValue)
 */
function buildTernaryChain(
  cases: IR.IRSwitchCase[],
  discriminant: IR.IRNode,
  position: IR.SourcePosition | undefined,
): IR.IRNode {
  const { defaultCase, regularCases } = partitionSwitchCases(cases);

  let result: IR.IRNode = (defaultCase.consequent[0] as IR.IRReturnStatement).argument!;

  for (let i = regularCases.length - 1; i >= 0; i--) {
    const caseItem = regularCases[i];
    const test = caseItem.test!;
    const value = (caseItem.consequent[0] as IR.IRReturnStatement).argument!;

    const condition: IR.IRBinaryExpression = {
      type: IR.IRNodeType.BinaryExpression,
      operator: "===",
      left: discriminant,
      right: test,
    };

    result = {
      type: IR.IRNodeType.ConditionalExpression,
      test: condition,
      consequent: value,
      alternate: result,
      position,
    } as IR.IRConditionalExpression;
  }

  return result;
}

export function transformSwitch(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
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
          processSwitchBodyStatement(stmt, isLast, fallthrough, consequent);
        }
      }

      // If no body, return null
      if (consequent.length === 0 && !fallthrough) {
        consequent.push(createReturn(createNull()));
      }

      cases.push(createSwitchCase(test, consequent, fallthrough));
    } else if (caseKeyword === "default") {
      hasDefault = true;

      // Transform body statements
      const bodyElements = caseList.elements.slice(1);
      const consequent: IR.IRNode[] = [];

      for (let j = 0; j < bodyElements.length; j++) {
        const isLast = j === bodyElements.length - 1;
        const stmt = transformNode(bodyElements[j], currentDir);
        if (stmt) {
          processSwitchBodyStatement(stmt, isLast, false, consequent);
        }
      }

      // If no body, return null
      if (consequent.length === 0) {
        consequent.push(createReturn(createNull()));
      }

      cases.push(createSwitchCase(null, consequent));
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
    cases.push(createSwitchCase(null, [createReturn(createNull())]));
  }

  // OPTIMIZATION: Check if we can use chained ternaries instead of IIFE
  // A switch is "simple" if:
  // 1. No case has fallthrough
  // 2. Each case has exactly one element in consequent (the return statement)
  const canUseTernary = cases.every(c => {
    const sc = c as IR.IRSwitchCase;
    // No fallthrough allowed
    if (sc.fallthrough) return false;
    // Must have exactly one element which is a ReturnStatement
    if (sc.consequent.length !== 1) return false;
    return sc.consequent[0].type === IR.IRNodeType.ReturnStatement;
  });

  if (canUseTernary) {
    return buildTernaryChain(cases, discriminant, extractPosition(list));
  }

  // Complex switch (fallthrough or multiple statements): use IIFE
  // Create the switch statement
  const switchStmt: IR.IRSwitchStatement = {
    type: IR.IRNodeType.SwitchStatement,
    discriminant,
    cases,
  };

  // EXPRESSION-EVERYWHERE: Wrap in IIFE to make switch an expression
  // (() => { switch(expr) { case v1: return r1; ... } })()
  // Check if switch contains await/yield - IIFE needs to be async/generator
  const switchBody: IR.IRBlockStatement = createBlock([switchStmt]);
  const hasYields = containsNodeTypeInScope(switchBody, IR.IRNodeType.YieldExpression);
  const hasAwaits = containsNodeTypeInScope(switchBody, IR.IRNodeType.AwaitExpression);

  const iife = createCall(
    createFnExpr([], switchBody, { async: hasAwaits, generator: hasYields }),
    [],
  );

  const result = wrapIIFEResult(iife, hasYields, hasAwaits);
  copyPosition(list, result);
  return result;
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
 *   default-result)    // optional default (odd number of args after expr)
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

    cases.push(createSwitchCase(test, [createReturn(result)]));
  }

  // Add default case
  if (hasDefault) {
    // Explicit default value provided
    const defaultResult = validateTransformed(
      transformNode(caseArgs[caseArgs.length - 1], currentDir),
      "case default",
      "Default result",
    );

    cases.push(createSwitchCase(null, [createReturn(defaultResult)]));
  } else {
    // No default provided - return null for unmatched cases
    cases.push(createSwitchCase(null, [createReturn(createNull())]));
  }

  // OPTIMIZATION: case expressions are always simple (no fallthrough), use ternary chain
  return buildTernaryChain(cases, discriminant, extractPosition(list));
}
