// src/transpiler/syntax/loop-recur.ts
// Module for handling loop and recur special forms

import * as IR from "../type/hql_ir.ts";
import type { HQLNode, ListNode, LiteralNode, SymbolNode } from "../type/hql_ast.ts";
import { HQLError, TransformError, ValidationError } from "../../common/error.ts";
import { getErrorMessage, sanitizeIdentifier } from "../../common/utils.ts";
import { validateTransformed } from "../utils/validation-helpers.ts";
import { ensureReturnStatement } from "../utils/ir-helpers.ts";
import { copyPosition } from "../pipeline/hql-ast-to-hql-ir.ts";
import { extractMetaSourceLocation } from "../utils/source_location_utils.ts";
import { ARITHMETIC_OPS } from "../keyword/primitives.ts";

// Stack to track the current loop context for recur targeting
const loopContextStack: string[] = [];

// Counter for generating unique loop names
let loopIdCounter = 0;

/**
 * Generate a unique loop identifier for proper recur targeting
 */
export function generateLoopId(): string {
  return `loop_${loopIdCounter++}`;
}

/**
 * Get the current loop context - used by recur to know which loop to target
 */
export function getCurrentLoopContext(): string | undefined {
  return loopContextStack.length > 0
    ? loopContextStack[loopContextStack.length - 1]
    : undefined;
}

/**
 * Push a new loop context to the stack
 */
export function pushLoopContext(loopId: string): void {
  loopContextStack.push(loopId);
}

/**
 * Pop the most recent loop context from the stack
 */
export function popLoopContext(): string | undefined {
  return loopContextStack.pop();
}

/**
 * Check if there's an active loop context
 */
export function hasLoopContext(): boolean {
  return loopContextStack.length > 0;
}

/**
 * Transform a loop special form to its IR representation.
 */
export function transformLoop(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  try {
    // Verify loop syntax: (loop [bindings...] body...)
    if (list.elements.length < 3) {
      throw new ValidationError(
        "loop requires bindings and at least one body expression",
        "loop statement",
        "bindings and body",
        { actualType: `${list.elements.length - 1} elements`, ...extractMetaSourceLocation(list) },
      );
    }

    const bindingsNode = list.elements[1];
    if (bindingsNode.type !== "list") {
      throw new ValidationError(
        "loop bindings must be a list",
        "loop bindings",
        "list",
        { actualType: bindingsNode.type, ...extractMetaSourceLocation(bindingsNode) },
      );
    }

    let bindings = bindingsNode as ListNode;

    // Handle vector syntax: (loop [n 0 acc 1] ...) is parsed as (loop (vector n 0 acc 1) ...)
    // Strip the "vector" prefix to normalize both () and [] syntax
    if (
      bindings.elements.length > 0 &&
      bindings.elements[0].type === "symbol" &&
      ((bindings.elements[0] as SymbolNode).name === "vector" ||
       (bindings.elements[0] as SymbolNode).name === "empty-array")
    ) {
      bindings = {
        ...bindings,
        elements: bindings.elements.slice(1),
      } as ListNode;
    }

    if (bindings.elements.length % 2 !== 0) {
      throw new ValidationError(
        "loop bindings require an even number of forms",
        "loop bindings",
        "even number",
        { actualType: String(bindings.elements.length), ...extractMetaSourceLocation(bindings) },
      );
    }

    // Create a unique ID for this loop context
    const loopId = generateLoopId();
    pushLoopContext(loopId); // Push this loop onto the context stack

    try {
      // Extract parameter names and initial values
      const params: IR.IRIdentifier[] = [];
      const initialValues: IR.IRNode[] = [];

      for (let i = 0; i < bindings.elements.length; i += 2) {
        const nameNode = bindings.elements[i];
        if (nameNode.type !== "symbol") {
          throw new ValidationError(
            "loop binding names must be symbols",
            "loop binding name",
            "symbol",
            { actualType: nameNode.type, ...extractMetaSourceLocation(nameNode) },
          );
        }

        const paramName = (nameNode as SymbolNode).name;
        const param: IR.IRIdentifier = {
          type: IR.IRNodeType.Identifier,
          name: sanitizeIdentifier(paramName),
        };
        copyPosition(nameNode, param);
        params.push(param);

        // Transform the initial value
        const valueNode = validateTransformed(
          transformNode(bindings.elements[i + 1], currentDir),
          "loop binding value",
          `Binding value for '${paramName}'`,
        );
        initialValues.push(valueNode);
      }

      // Check if this is a simple loop that can be optimized to native while
      const bodyExprs = list.elements.slice(2);
      if (isSimpleLoop(bodyExprs)) {
        // Optimize to native while loop
        return transformSimpleLoop(
          params,
          initialValues,
          bodyExprs[0],
          currentDir,
          transformNode,
        );
      }

      // Complex loop: use recursive function (original implementation)
      // Transform the body expressions
      // For a loop, we'll wrap all body expressions in a single block statement
      // This ensures the recur call is properly tail-recursive
      let bodyBlock: IR.IRBlockStatement;

      // Special case: If there's only one expression in the body and it's an if/when
      // we'll transform it specially to ensure proper tail recursion
      if (list.elements.length === 3 && list.elements[2].type === "list") {
        const bodyExpr = list.elements[2] as ListNode;
        if (
          bodyExpr.elements.length > 0 && bodyExpr.elements[0].type === "symbol"
        ) {
          const op = (bodyExpr.elements[0] as SymbolNode).name;

          if (op === "if" || op === "when") {
            // Ensure we add a return statement for the if/when result
            // This is a critical fix to ensure the result is returned
            const transformed = transformIfForLoop(
              bodyExpr,
              currentDir,
              transformNode,
            );
            if (transformed) {
              bodyBlock = {
                type: IR.IRNodeType.BlockStatement,
                body: [transformed],
              };
            } else {
              bodyBlock = {
                type: IR.IRNodeType.BlockStatement,
                body: [],
              };
            }
          } else {
            // Regular case: transform all body expressions
            bodyBlock = transformLoopBody(
              list.elements.slice(2),
              currentDir,
              transformNode,
            );
          }
        } else {
          // Regular case: transform all body expressions
          bodyBlock = transformLoopBody(
            list.elements.slice(2),
            currentDir,
            transformNode,
          );
        }
      } else {
        // Regular case: transform all body expressions
        bodyBlock = transformLoopBody(
          list.elements.slice(2),
          currentDir,
          transformNode,
        );
      }

      // Create the loop function declaration
      const loopFunc: IR.IRFunctionDeclaration = {
        type: IR.IRNodeType.FunctionDeclaration,
        id: {
          type: IR.IRNodeType.Identifier,
          name: loopId,
        },
        params,
        body: bodyBlock,
      };

      // Create initial function call with binding values
      const initialCall: IR.IRCallExpression = {
        type: IR.IRNodeType.CallExpression,
        callee: {
          type: IR.IRNodeType.Identifier,
          name: loopId,
        },
        arguments: initialValues,
      };

      const iife: IR.IRCallExpression = {
        type: IR.IRNodeType.CallExpression,
        callee: {
          type: IR.IRNodeType.FunctionExpression,
          id: null,
          params: [],
          body: {
            type: IR.IRNodeType.BlockStatement,
            body: [
              loopFunc,
              {
                type: IR.IRNodeType.ReturnStatement,
                argument: initialCall,
              } as IR.IRReturnStatement,
            ],
          } as IR.IRBlockStatement,
        },
        arguments: [],
      };

      return iife;
    } finally {
      // Always pop the loop context, even on error
      popLoopContext();
    }
  } catch (error) {
    // Preserve HQLError instances (ValidationError, ParseError, etc.)
    if (error instanceof HQLError) {
      throw error;
    }
    throw new TransformError(
      `Failed to transform loop: ${
        getErrorMessage(error)
      }`,
      "loop transformation",
      "valid loop expression",
      list,
    );
  }
}

/**
 * Transform if expression specifically for loop body
 * Ensures proper return statements for both branches
 */
export function transformIfForLoop(
  ifExpr: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  try {
    // Validate if syntax: (if test then else?)
    if (ifExpr.elements.length < 3) {
      throw new ValidationError(
        "if requires test and then clause",
        "if statement",
        "test and then clause",
        { actualType: `${ifExpr.elements.length - 1} elements`, ...extractMetaSourceLocation(ifExpr) },
      );
    }

    // Transform test expression
    const test = validateTransformed(
      transformNode(ifExpr.elements[1], currentDir),
      "if test",
      "Test expression",
    );

    // Transform 'then' expression - wrap in return if not already a return or recur
    const thenExpr = ifExpr.elements[2];
    let consequent: IR.IRNode | null = null;

    if (isRecurExpression(thenExpr)) {
      // If it's recur, transform directly - recur generates its own return
      consequent = validateTransformed(
        transformNode(thenExpr, currentDir),
        "if consequent",
        "Then clause (recur)",
      );
    } else {
      // Otherwise ensure it's returned
      const transformed = validateTransformed(
        transformNode(thenExpr, currentDir),
        "if consequent",
        "Then clause",
      );

      // Ensure the node is wrapped in a return statement if needed
      consequent = ensureReturnStatement(transformed);
    }

    // Transform 'else' expression if it exists
    let alternate: IR.IRNode | null = null;
    if (ifExpr.elements.length > 3) {
      const elseExpr = ifExpr.elements[3];

      if (isRecurExpression(elseExpr)) {
        // If it's recur, transform directly - recur generates its own return
        alternate = transformNode(elseExpr, currentDir);
      } else {
        // Otherwise ensure it's returned
        const transformed = transformNode(elseExpr, currentDir);
        if (transformed) {
          alternate = ensureReturnStatement(transformed);
        }
      }
    }

    // Create the if statement with proper return statements
    return {
      type: IR.IRNodeType.IfStatement,
      test,
      consequent,
      alternate,
    } as IR.IRIfStatement;
  } catch (error) {
    // Preserve HQLError instances (ValidationError, ParseError, etc.)
    if (error instanceof HQLError) {
      throw error;
    }
    throw new TransformError(
      `Failed to transform if for loop: ${
        getErrorMessage(error)
      }`,
      "if in loop transformation",
      "valid if expression",
      ifExpr,
    );
  }
}

/**
 * Check if a given expression is a recur expression
 */
export function isRecurExpression(expr: HQLNode): boolean {
  return expr.type === "list" &&
    expr.elements.length > 0 &&
    expr.elements[0].type === "symbol" &&
    (expr.elements[0] as SymbolNode).name === "recur";
}

/**
 * Analyze if a loop can be optimized to a native while loop.
 *
 * Simple loop criteria:
 * 1. Single expression in body
 * 2. Body is an if statement
 * 3. If-true branch ends with recur (possibly wrapped in do)
 * 4. If-false branch returns a value
 * 5. No complex control flow
 *
 * Example of simple loop:
 * (loop [i 0 sum 0]
 *   (if (< i 100)
 *     (recur (+ i 1) (+ sum i))
 *     sum))
 *
 * Can be converted to:
 * let i = 0; let sum = 0;
 * while (i < 100) {
 *   const newI = i + 1;
 *   const newSum = sum + i;
 *   i = newI;
 *   sum = newSum;
 * }
 * return sum;
 */
export function isSimpleLoop(bodyExprs: HQLNode[]): boolean {
  // Must have exactly one body expression
  if (bodyExprs.length !== 1) {
    return false;
  }

  const bodyExpr = bodyExprs[0];

  // Body must be a list (an expression)
  if (bodyExpr.type !== "list") {
    return false;
  }

  const bodyList = bodyExpr as ListNode;

  // Body must be an if statement
  if (
    bodyList.elements.length < 3 ||
    bodyList.elements[0].type !== "symbol" ||
    (bodyList.elements[0] as SymbolNode).name !== "if"
  ) {
    return false;
  }

  // Check if either branch ends with recur (for optimizing to while loop)
  const consequent = bodyList.elements[2];
  const alternate = bodyList.elements.length > 3 ? bodyList.elements[3] : null;

  // Check consequent (then branch) for recur
  if (branchEndsWithRecur(consequent)) {
    return true;
  }

  // Check alternate (else branch) for recur
  if (alternate && branchEndsWithRecur(alternate)) {
    return true;
  }

  return false;
}

/**
 * Helper to check if a branch (consequent or alternate) ends with recur
 */
function branchEndsWithRecur(branch: HQLNode): boolean {
  // Direct recur
  if (isRecurExpression(branch)) {
    return true;
  }

  // Recur wrapped in (do ...)
  if (
    branch.type === "list" &&
    branch.elements.length > 0 &&
    branch.elements[0].type === "symbol" &&
    (branch.elements[0] as SymbolNode).name === "do"
  ) {
    const doList = branch as ListNode;
    const lastExpr = doList.elements[doList.elements.length - 1];
    return isRecurExpression(lastExpr);
  }

  return false;
}

/**
 * Check if an HQL node references any of the given parameter names.
 */
function referencesAnyParam(node: HQLNode, paramNames: Set<string>): boolean {
  if (node.type === "symbol") {
    return paramNames.has((node as SymbolNode).name);
  } else if (node.type === "list") {
    const list = node as ListNode;
    return list.elements.some((el) => referencesAnyParam(el, paramNames));
  }
  return false;
}

/**
 * Try to optimize arithmetic updates to compound assignments.
 *
 * Patterns detected:
 * - (+ var 1) or (+ 1 var) → var++
 * - (- var 1) → var--
 * - (+ var n) → var += n  (only if n doesn't reference other loop params)
 * - (- var n) → var -= n  (only if n doesn't reference other loop params)
 * - (* var n) → var *= n  (only if n doesn't reference other loop params)
 * - (/ var n) → var /= n  (only if n doesn't reference other loop params)
 *
 * CRITICAL: We can only optimize if the "other operand" doesn't reference
 * any loop parameters that are being updated. Otherwise, we'd use NEW values
 * instead of OLD values, breaking semantics.
 *
 * Returns an ExpressionStatement with the optimized assignment, or null if not optimizable.
 */
function tryOptimizeArithmetic(
  param: IR.IRIdentifier,
  recurArg: HQLNode,
  allParams: IR.IRIdentifier[],
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRExpressionStatement | null {
  // Build set of all parameter names
  const paramNames = new Set(allParams.map((p) => p.name));
  // Must be a list (function call)
  if (recurArg.type !== "list") {
    return null;
  }

  const list = recurArg as ListNode;

  // Must have operator + 2 operands
  if (list.elements.length !== 3) {
    return null;
  }

  // First element must be a symbol (operator)
  if (list.elements[0].type !== "symbol") {
    return null;
  }

  const operator = (list.elements[0] as SymbolNode).name;

  // Must be arithmetic operator (from primitives.ts single source of truth)
  if (!ARITHMETIC_OPS.includes(operator as typeof ARITHMETIC_OPS[number])) {
    return null;
  }

  const left = list.elements[1];
  const right = list.elements[2];

  // Check if either operand is the param
  let isLeftParam = false;
  let isRightParam = false;
  let otherOperand: HQLNode | null = null;

  if (left.type === "symbol" && (left as SymbolNode).name === param.name) {
    isLeftParam = true;
    otherOperand = right;
  } else if (
    right.type === "symbol" && (right as SymbolNode).name === param.name
  ) {
    isRightParam = true;
    otherOperand = left;
  }

  // One operand must be the param
  if (!isLeftParam && !isRightParam) {
    return null;
  }

  // CRITICAL: Check if the other operand references any loop parameters.
  // If it does, we CANNOT optimize because we'd use NEW values instead of OLD values.
  // Example: (+ sum i) when both sum and i are loop params - NOT safe to optimize!
  if (referencesAnyParam(otherOperand!, paramNames)) {
    return null; // Fall back to temp variables
  }

  // Special case: increment/decrement by 1
  // (+ var 1) or (+ 1 var) → var++
  // (- var 1) → var--
  if (
    otherOperand!.type === "literal" &&
    (otherOperand as LiteralNode).value === 1
  ) {
    if (operator === "+" && (isLeftParam || isRightParam)) {
      // i++ (post-increment)
      return {
        type: IR.IRNodeType.ExpressionStatement,
        expression: {
          type: IR.IRNodeType.UnaryExpression,
          operator: "++",
          argument: param,
          prefix: false, // post-increment
        } as IR.IRUnaryExpression,
      } as IR.IRExpressionStatement;
    } else if (operator === "-" && isLeftParam) {
      // i-- (post-decrement)
      return {
        type: IR.IRNodeType.ExpressionStatement,
        expression: {
          type: IR.IRNodeType.UnaryExpression,
          operator: "--",
          argument: param,
          prefix: false, // post-decrement
        } as IR.IRUnaryExpression,
      } as IR.IRExpressionStatement;
    }
  }

  // General case: compound assignment
  // (+ var n) → var += n
  // (- var n) → var -= n
  // (* var n) → var *= n
  // (/ var n) → var /= n

  // For subtraction and division, param must be on the left
  if (["-", "/"].includes(operator) && !isLeftParam) {
    return null;
  }

  // Transform the other operand
  const transformedOther = transformNode(otherOperand!, currentDir);
  if (!transformedOther) {
    return null;
  }

  // Map operator to compound assignment
  const compoundOp = operator + "="; // +=, -=, *=, /=

  return {
    type: IR.IRNodeType.ExpressionStatement,
    expression: {
      type: IR.IRNodeType.AssignmentExpression,
      operator: compoundOp,
      left: param,
      right: transformedOther,
    } as IR.IRAssignmentExpression,
  } as IR.IRExpressionStatement;
}

/**
 * Transform a simple loop to a native while loop.
 *
 * Input:
 * (loop [i 0 sum 0]
 *   (if (< i 100)
 *     (recur (+ i 1) (+ sum i))
 *     sum))
 *
 * Output IR for:
 * (() => {
 *   let i = 0;
 *   let sum = 0;
 *   while (i < 100) {
 *     const temp_i = i + 1;
 *     const temp_sum = sum + i;
 *     i = temp_i;
 *     sum = temp_sum;
 *   }
 *   return sum;
 * })()
 */
export function transformSimpleLoop(
  params: IR.IRIdentifier[],
  initialValues: IR.IRNode[],
  bodyExpr: HQLNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  const bodyList = bodyExpr as ListNode;

  // Extract if components
  const testExpr = bodyList.elements[1];
  const consequent = bodyList.elements[2];
  const alternate = bodyList.elements.length > 3 ? bodyList.elements[3] : null;

  // Determine which branch has recur to decide loop structure
  const recurInConsequent = branchEndsWithRecur(consequent);
  const recurInAlternate = alternate && branchEndsWithRecur(alternate);

  // Transform the test condition
  let test = validateTransformed(
    transformNode(testExpr, currentDir),
    "while test",
    "While loop test condition",
  );

  // If recur is in alternate (else branch), negate the condition
  // Pattern: (if done? result (recur ...)) → while(!done?) { recur... }; return result
  if (recurInAlternate && !recurInConsequent) {
    test = {
      type: IR.IRNodeType.UnaryExpression,
      operator: "!",
      prefix: true,
      argument: test,
    } as IR.IRUnaryExpression;
  }

  // Extract recur arguments and the branch containing recur
  let recurArgs: HQLNode[] = [];
  let recurBranch: HQLNode = consequent;

  if (recurInConsequent) {
    recurBranch = consequent;
    if (isRecurExpression(consequent)) {
      // Direct recur: (recur ...)
      const recurList = consequent as ListNode;
      recurArgs = recurList.elements.slice(1);
    } else if (
      consequent.type === "list" &&
      consequent.elements.length > 0 &&
      consequent.elements[0].type === "symbol" &&
      (consequent.elements[0] as SymbolNode).name === "do"
    ) {
      // Recur in do: (do ... (recur ...))
      const doList = consequent as ListNode;
      const lastExpr = doList.elements[doList.elements.length - 1];
      if (isRecurExpression(lastExpr)) {
        const recurList = lastExpr as ListNode;
        recurArgs = recurList.elements.slice(1);
      }
    }
  } else if (recurInAlternate && alternate) {
    recurBranch = alternate;
    if (isRecurExpression(alternate)) {
      // Direct recur: (recur ...)
      const recurList = alternate as ListNode;
      recurArgs = recurList.elements.slice(1);
    } else if (
      alternate.type === "list" &&
      alternate.elements.length > 0 &&
      alternate.elements[0].type === "symbol" &&
      (alternate.elements[0] as SymbolNode).name === "do"
    ) {
      // Recur in do: (do ... (recur ...))
      const doList = alternate as ListNode;
      const lastExpr = doList.elements[doList.elements.length - 1];
      if (isRecurExpression(lastExpr)) {
        const recurList = lastExpr as ListNode;
        recurArgs = recurList.elements.slice(1);
      }
    }
  }

  // Build while body:
  // 1. All statements from do block (if any)
  // 2. Compute new values for loop variables (const temp_i = ...)
  // 3. Assign temp values back to loop variables (i = temp_i)
  //
  // Special case: Zero-parameter loops (from while macro)
  // These just execute the body without any parameter updates

  const whileBodyStatements: IR.IRNode[] = [];

  // Add statements from do block (if recurBranch is do)
  if (
    recurBranch.type === "list" &&
    recurBranch.elements.length > 0 &&
    recurBranch.elements[0].type === "symbol" &&
    (recurBranch.elements[0] as SymbolNode).name === "do"
  ) {
    const doList = recurBranch as ListNode;
    // Transform all expressions except the last (recur)
    for (let i = 1; i < doList.elements.length - 1; i++) {
      const transformed = transformNode(doList.elements[i], currentDir);
      if (transformed) {
        // Wrap in ExpressionStatement if it's an expression
        if (
          transformed.type !== IR.IRNodeType.ExpressionStatement &&
          transformed.type !== IR.IRNodeType.VariableDeclaration &&
          transformed.type !== IR.IRNodeType.ReturnStatement &&
          transformed.type !== IR.IRNodeType.IfStatement &&
          transformed.type !== IR.IRNodeType.WhileStatement
        ) {
          whileBodyStatements.push({
            type: IR.IRNodeType.ExpressionStatement,
            expression: transformed,
          } as IR.IRExpressionStatement);
        } else {
          whileBodyStatements.push(transformed);
        }
      }
    }
  }

  // Compute new values and assign
  // OPTIMIZATION: Detect simple arithmetic patterns and generate compound assignments
  // Examples: (+ i 1) → i++, (+ i n) → i += n, (- i 1) → i--
  //
  // CRITICAL: To preserve semantics, all updates must use OLD values.
  // Strategy: Collect optimized updates separately, add them AFTER temp var assignments.
  // This ensures dependent variables (like sum += i) use OLD values before i is modified.
  //
  // Skip this step for zero-parameter loops (while macro)
  const tempVars: (IR.IRIdentifier | null)[] = [];
  const optimizedUpdates: IR.IRExpressionStatement[] = [];

  if (params.length > 0) {
    // First pass: compute new values using temp vars OR detect optimizable patterns
    for (let i = 0; i < params.length; i++) {
      const param = params[i];
      const recurArg = recurArgs[i];

      // Try to detect simple increment/decrement patterns
      const optimized = tryOptimizeArithmetic(
        param,
        recurArg,
        params, // Pass all params for dependency checking
        currentDir,
        transformNode,
      );

      if (optimized) {
        // Store optimized update for later (will be added LAST)
        optimizedUpdates.push(optimized);
        // Push null to tempVars to keep indices aligned
        tempVars.push(null);
      } else {
        // Fall back to temp variable approach
        const newValue = validateTransformed(
          transformNode(recurArg, currentDir),
          "recur argument",
          `New value for ${param.name}`,
        );

        const tempName = `__hql_temp_${param.name}`;
        const tempId: IR.IRIdentifier = {
          type: IR.IRNodeType.Identifier,
          name: tempName,
        };
        tempVars.push(tempId);

        // const temp_param = newValue (computed with OLD values)
        whileBodyStatements.push({
          type: IR.IRNodeType.VariableDeclaration,
          declarations: [{
            type: IR.IRNodeType.VariableDeclarator,
            id: tempId,
            init: newValue,
          }],
          kind: "const",
        } as IR.IRVariableDeclaration);
      }
    }

    // Second pass: assign temp vars back (if any)
    for (let i = 0; i < params.length; i++) {
      if (tempVars[i] !== null) {
        whileBodyStatements.push({
          type: IR.IRNodeType.ExpressionStatement,
          expression: {
            type: IR.IRNodeType.AssignmentExpression,
            operator: "=",
            left: params[i],
            right: tempVars[i],
          } as IR.IRAssignmentExpression,
        } as IR.IRExpressionStatement);
      }
    }

    // Third pass: add optimized updates LAST (after temp vars are assigned)
    // This ensures all dependent computations use OLD values
    whileBodyStatements.push(...optimizedUpdates);
  }

  // Create while statement
  const whileStmt: IR.IRWhileStatement = {
    type: IR.IRNodeType.WhileStatement,
    test,
    body: {
      type: IR.IRNodeType.BlockStatement,
      body: whileBodyStatements,
    } as IR.IRBlockStatement,
  };

  // Transform return value (from the branch that doesn't have recur)
  // - If recur is in consequent: return alternate
  // - If recur is in alternate: return consequent
  let returnValueBranch: HQLNode | null;
  if (recurInAlternate && !recurInConsequent) {
    returnValueBranch = consequent; // Return from then-branch when recur is in else-branch
  } else {
    returnValueBranch = alternate; // Default: return from else-branch
  }

  const returnValue = returnValueBranch
    ? validateTransformed(
      transformNode(returnValueBranch, currentDir),
      "loop return value",
      "Loop return value",
    )
    : { type: IR.IRNodeType.NullLiteral } as IR.IRNullLiteral;

  // Build IIFE:
  // (() => {
  //   let i = 0; let sum = 0;
  //   while (test) { body }
  //   return returnValue;
  // })()

  const iifeBody: IR.IRNode[] = [];

  // Add variable declarations
  for (let i = 0; i < params.length; i++) {
    iifeBody.push({
      type: IR.IRNodeType.VariableDeclaration,
      declarations: [{
        type: IR.IRNodeType.VariableDeclarator,
        id: params[i],
        init: initialValues[i],
      }],
      kind: "let",
    } as IR.IRVariableDeclaration);
  }

  // Add while statement
  iifeBody.push(whileStmt);

  // Add return statement
  iifeBody.push({
    type: IR.IRNodeType.ReturnStatement,
    argument: returnValue,
  } as IR.IRReturnStatement);

  // Create IIFE
  const iife: IR.IRCallExpression = {
    type: IR.IRNodeType.CallExpression,
    callee: {
      type: IR.IRNodeType.FunctionExpression,
      id: null,
      params: [],
      body: {
        type: IR.IRNodeType.BlockStatement,
        body: iifeBody,
      } as IR.IRBlockStatement,
    },
    arguments: [],
  };

  return iife;
}

/**
 * Transform a recur special form to its IR representation.
 */
export function transformRecur(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  try {
    // Verify that we have at least the recur keyword
    if (list.elements.length < 1) {
      throw new ValidationError(
        "Invalid recur form",
        "recur statement",
        "recur with arguments",
        { actualType: "incomplete recur form", ...extractMetaSourceLocation(list) },
      );
    }

    // Get the current loop context (last item on the stack)
    if (!hasLoopContext()) {
      throw new ValidationError(
        "recur must be used inside a loop",
        "recur statement",
        "inside loop context",
        { actualType: "outside loop context", ...extractMetaSourceLocation(list) },
      );
    }

    const loopId = getCurrentLoopContext()!;

    // Transform all the argument expressions
    const args: IR.IRNode[] = [];
    for (let i = 1; i < list.elements.length; i++) {
      const transformedArg = validateTransformed(
        transformNode(list.elements[i], currentDir),
        "recur argument",
        `Argument ${i} in recur`,
      );
      args.push(transformedArg);
    }

    // Create a direct function call to the loop function
    const loopCall: IR.IRCallExpression = {
      type: IR.IRNodeType.CallExpression,
      callee: {
        type: IR.IRNodeType.Identifier,
        name: loopId,
      } as IR.IRIdentifier,
      arguments: args,
    };

    // Return a return statement with the loop call
    // This is essential for proper tail call optimization
    return {
      type: IR.IRNodeType.ReturnStatement,
      argument: loopCall,
    } as IR.IRReturnStatement;
  } catch (error) {
    // Preserve HQLError instances (ValidationError, ParseError, etc.)
    if (error instanceof HQLError) {
      throw error;
    }
    throw new TransformError(
      `Failed to transform recur: ${
        getErrorMessage(error)
      }`,
      "recur transformation",
      "valid recur expression",
      list,
    );
  }
}

/**
 * Helper function to transform a list of body expressions for a loop
 */
export function transformLoopBody(
  bodyExprs: HQLNode[],
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRBlockStatement {
  // If only one expression and it's not already a return, wrap it in return
  if (bodyExprs.length === 1 && !isRecurExpression(bodyExprs[0])) {
    const transformedExpr = transformNode(bodyExprs[0], currentDir);
    if (transformedExpr) {
      // If it's already a return or if statement, use it directly
      if (
        transformedExpr.type === IR.IRNodeType.ReturnStatement ||
        transformedExpr.type === IR.IRNodeType.IfStatement
      ) {
        return {
          type: IR.IRNodeType.BlockStatement,
          body: [transformedExpr],
        };
      }

      // Otherwise wrap in return
      return {
        type: IR.IRNodeType.BlockStatement,
        body: [{
          type: IR.IRNodeType.ReturnStatement,
          argument: transformedExpr,
        } as IR.IRReturnStatement],
      };
    }
  }

  // For multiple expressions, handle each one
  const bodyNodes: IR.IRNode[] = [];

  // Process all except the last one normally
  for (let i = 0; i < bodyExprs.length - 1; i++) {
    const transformedExpr = transformNode(bodyExprs[i], currentDir);
    if (transformedExpr) {
      bodyNodes.push(transformedExpr);
    }
  }

  // Handle the last expression specially - wrap in return if needed
  if (bodyExprs.length > 0) {
    const lastExpr = bodyExprs[bodyExprs.length - 1];

    if (isRecurExpression(lastExpr)) {
      // Recur already returns appropriately
      const transformedExpr = transformNode(lastExpr, currentDir);
      if (transformedExpr) {
        bodyNodes.push(transformedExpr);
      }
    } else {
      // Transform the last expression
      const transformedExpr = transformNode(lastExpr, currentDir);
      if (transformedExpr) {
        // If it's already a return or if statement, use it directly
        if (
          transformedExpr.type === IR.IRNodeType.ReturnStatement ||
          transformedExpr.type === IR.IRNodeType.IfStatement
        ) {
          bodyNodes.push(transformedExpr);
        } else {
          // Otherwise wrap in return
          bodyNodes.push({
            type: IR.IRNodeType.ReturnStatement,
            argument: transformedExpr,
          } as IR.IRReturnStatement);
        }
      }
    }
  }

  return {
    type: IR.IRNodeType.BlockStatement,
    body: bodyNodes,
  };
}
