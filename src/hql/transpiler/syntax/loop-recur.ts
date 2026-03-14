// src/hql/transpiler/syntax/loop-recur.ts
// Module for handling loop and recur special forms

import * as IR from "../type/hql_ir.ts";
import type { HQLNode, ListNode, LiteralNode, SymbolNode } from "../type/hql_ast.ts";
import { HQLError, TransformError, ValidationError } from "../../../common/error.ts";
import { getErrorMessage, sanitizeIdentifier } from "../../../common/utils.ts";
import { validateTransformed } from "../utils/validation-helpers.ts";
import {
  ensureReturnStatement,
  createBlock,
  createId,
  createReturn,
  createNull,
  createExprStmt,
  createCall,
  createFnExpr,
  createVarDecl,
  wrapIIFEResult,
} from "../utils/ir-helpers.ts";
import { copyPosition, copyEndPosition } from "../pipeline/hql-ast-to-hql-ir.ts";
import { extractMetaSourceLocation } from "../utils/source_location_utils.ts";
import { ARITHMETIC_OPS_SET } from "../keyword/primitives.ts";
import { VECTOR_SYMBOL, EMPTY_ARRAY_SYMBOL } from "../../../common/runtime-helper-impl.ts";
import {
  containsAwaitExpression,
  containsYieldExpression,
  containsReturnInScope,
  containsJumpToLabel,
  collectJumpTargets,
  collectForOfStatementsInScope,
} from "../utils/ir-tree-walker.ts";
import { STATEMENT_TYPES } from "../constants/index.ts";

// STATEMENT_TYPES imported from ../constants/index.ts

/**
 * Encapsulates all mutable state for loop/recur compilation.
 * A fresh instance must be created per compilation unit to prevent
 * cross-compilation corruption in concurrent/parallel scenarios.
 */
export interface LoopState {
  loopContextStack: string[];
  loopIdCounter: number;
  forOfLabelTargets: WeakMap<IR.IRForOfStatement, Set<string>>;
}

/** Create a fresh LoopState for one compilation pass. */
export function createLoopState(): LoopState {
  return { loopContextStack: [], loopIdCounter: 0, forOfLabelTargets: new WeakMap() };
}

function generateLoopId(state: LoopState): string {
  return `loop_${state.loopIdCounter++}`;
}

function getCurrentLoopContext(state: LoopState): string | undefined {
  return state.loopContextStack.length > 0
    ? state.loopContextStack[state.loopContextStack.length - 1]
    : undefined;
}

function pushLoopContext(state: LoopState, loopId: string): void {
  state.loopContextStack.push(loopId);
}

function popLoopContext(state: LoopState): string | undefined {
  return state.loopContextStack.pop();
}

/**
 * Check if there's an active loop context
 */
export function hasLoopContext(state: LoopState): boolean {
  return state.loopContextStack.length > 0;
}

/**
 * Transform a loop special form to its IR representation.
 */
export function transformLoop(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
  state: LoopState,
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
      ((bindings.elements[0] as SymbolNode).name === VECTOR_SYMBOL ||
       (bindings.elements[0] as SymbolNode).name === EMPTY_ARRAY_SYMBOL)
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
    const loopId = generateLoopId(state);
    pushLoopContext(state, loopId); // Push this loop onto the context stack

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
        const param = createId(sanitizeIdentifier(paramName));
        copyPosition(nameNode, param);
        copyEndPosition(bindings, param);
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
      const singleIfWhen = list.elements.length === 3 &&
        list.elements[2].type === "list" &&
        (list.elements[2] as ListNode).elements.length > 0 &&
        (list.elements[2] as ListNode).elements[0].type === "symbol" &&
        ((((list.elements[2] as ListNode).elements[0] as SymbolNode).name === "if") ||
         (((list.elements[2] as ListNode).elements[0] as SymbolNode).name === "when"));

      if (singleIfWhen) {
        const transformed = transformIfForLoop(
          list.elements[2] as ListNode,
          currentDir,
          transformNode,
        );
        bodyBlock = createBlock(transformed ? [transformed] : []);
      } else {
        bodyBlock = transformLoopBody(
          list.elements.slice(2),
          currentDir,
          transformNode,
        );
      }

      // Create the loop function declaration
      const loopFunc: IR.IRFunctionDeclaration = {
        type: IR.IRNodeType.FunctionDeclaration,
        id: createId(loopId),
        params,
        body: bodyBlock,
      };

      // Create IIFE parameters to capture initial values in outer scope
      // This fixes the scoping issue where (loop [n n ...]) would fail
      // because the initial value 'n' would reference the loop param instead of outer 'n'
      const iifeParams: IR.IRIdentifier[] = [];
      const iifeCallArgs: IR.IRNode[] = [];

      for (let i = 0; i < initialValues.length; i++) {
        const initParamName = `__init_${i}`;
        iifeParams.push(createId(initParamName));
        iifeCallArgs.push(initialValues[i]);
      }

      // Create initial function call using IIFE params (which capture outer scope values)
      const initialCall = createCall(
        createId(loopId),
        iifeParams.map(p => createId(p.name)),
      );

      // Check if loop body contains await/yield for async/generator IIFE
      const hasAwaits = containsAwaitExpression(bodyBlock);
      const hasYields = containsYieldExpression(bodyBlock);

      const iifeBody: IR.IRBlockStatement = createBlock([
        loopFunc,
        createReturn(initialCall),
      ]);

      const iife = createCall(
        createFnExpr(iifeParams, iifeBody, { async: hasAwaits, generator: hasYields }),
        iifeCallArgs,
      );

      return wrapIIFEResult(iife, hasYields, hasAwaits);
    } finally {
      // Always pop the loop context, even on error
      popLoopContext(state);
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
function transformIfForLoop(
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
function isRecurExpression(expr: HQLNode): boolean {
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
function isSimpleLoop(bodyExprs: HQLNode[]): boolean {
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
 * Extract recur arguments from a branch that ends with recur.
 * Handles both direct recur and recur wrapped in (do ...).
 */
function extractRecurArgs(branch: HQLNode): HQLNode[] {
  if (isRecurExpression(branch)) {
    return (branch as ListNode).elements.slice(1);
  }
  if (
    branch.type === "list" &&
    branch.elements.length > 0 &&
    branch.elements[0].type === "symbol" &&
    (branch.elements[0] as SymbolNode).name === "do"
  ) {
    const doList = branch as ListNode;
    const lastExpr = doList.elements[doList.elements.length - 1];
    if (isRecurExpression(lastExpr)) {
      return (lastExpr as ListNode).elements.slice(1);
    }
  }
  return [];
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
  // O(1) Set lookup instead of O(n) array scan
  if (!ARITHMETIC_OPS_SET.has(operator)) {
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
  if (!isLeftParam && !isRightParam || otherOperand === null) {
    return null;
  }

  // CRITICAL: Check if the other operand references any loop parameters.
  // If it does, we CANNOT optimize because we'd use NEW values instead of OLD values.
  // Example: (+ sum i) when both sum and i are loop params - NOT safe to optimize!
  if (referencesAnyParam(otherOperand, paramNames)) {
    return null; // Fall back to temp variables
  }

  // Special case: increment/decrement by 1
  // (+ var 1) or (+ 1 var) → var++
  // (- var 1) → var--
  if (
    otherOperand.type === "literal" &&
    (otherOperand as LiteralNode).value === 1
  ) {
    if (operator === "+" && (isLeftParam || isRightParam)) {
      // i++ (post-increment)
      return createExprStmt({
        type: IR.IRNodeType.UnaryExpression,
        operator: "++",
        argument: param,
        prefix: false, // post-increment
      } as IR.IRUnaryExpression);
    } else if (operator === "-" && isLeftParam) {
      // i-- (post-decrement)
      return createExprStmt({
        type: IR.IRNodeType.UnaryExpression,
        operator: "--",
        argument: param,
        prefix: false, // post-decrement
      } as IR.IRUnaryExpression);
    }
  }

  // General case: compound assignment
  // (+ var n) → var += n
  // (- var n) → var -= n
  // (* var n) → var *= n
  // (/ var n) → var /= n

  // For subtraction and division, param must be on the left
  // Use direct comparison instead of array creation + includes (O(1) vs O(n) + allocation)
  if ((operator === "-" || operator === "/") && !isLeftParam) {
    return null;
  }

  // Transform the other operand
  const transformedOther = transformNode(otherOperand, currentDir);
  if (!transformedOther) {
    return null;
  }

  // Map operator to compound assignment
  const compoundOp = operator + "="; // +=, -=, *=, /=

  return createExprStmt({
    type: IR.IRNodeType.AssignmentExpression,
    operator: compoundOp,
    left: param,
    right: transformedOther,
  } as IR.IRAssignmentExpression);
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
function transformSimpleLoop(
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
  // Pattern: (if done? result (recur ...)) -> while(!done?) { recur... }; return result
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
    recurArgs = extractRecurArgs(consequent);
  } else if (recurInAlternate && alternate) {
    recurBranch = alternate;
    recurArgs = extractRecurArgs(alternate);
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
        if (!STATEMENT_TYPES.has(transformed.type)) {
          whileBodyStatements.push(createExprStmt(transformed));
        } else {
          whileBodyStatements.push(transformed);
        }
      }
    }
  }

  // Compute new values and assign
  // OPTIMIZATION: Detect simple arithmetic patterns and generate compound assignments
  // Examples: (+ i 1) -> i++, (+ i n) -> i += n, (- i 1) -> i--
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
        const tempId = createId(tempName);
        tempVars.push(tempId);

        // const temp_param = newValue (computed with OLD values)
        whileBodyStatements.push(createVarDecl(tempId, newValue));
      }
    }

    // Second pass: assign temp vars back (if any)
    for (let i = 0; i < params.length; i++) {
      if (tempVars[i] !== null) {
        whileBodyStatements.push(createExprStmt({
          type: IR.IRNodeType.AssignmentExpression,
          operator: "=",
          left: params[i],
          right: tempVars[i],
        } as IR.IRAssignmentExpression));
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
    body: createBlock(whileBodyStatements),
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
    : createNull();

  // Build IIFE:
  // ((__init_0, __init_1) => {
  //   let i = __init_0; let sum = __init_1;
  //   while (test) { body }
  //   return returnValue;
  // })(0, 0)
  //
  // This fixes the scoping issue where (loop [n n ...]) would fail
  // because let n = n would reference the variable being declared

  // Create IIFE parameters to capture initial values in outer scope
  const iifeParams: IR.IRIdentifier[] = [];
  const iifeCallArgs: IR.IRNode[] = [];

  for (let i = 0; i < initialValues.length; i++) {
    const initParamName = `__init_${i}`;
    iifeParams.push(createId(initParamName));
    iifeCallArgs.push(initialValues[i]);
  }

  const iifeBody: IR.IRNode[] = [];

  // Add variable declarations using IIFE params (not original initial values)
  for (let i = 0; i < params.length; i++) {
    iifeBody.push(createVarDecl(params[i], createId(iifeParams[i].name), "let"));
  }

  // Add while statement
  iifeBody.push(whileStmt);

  // Add return statement
  iifeBody.push(createReturn(returnValue));

  // Check if loop body contains await/yield for async/generator IIFE
  const iifeBlockBody: IR.IRBlockStatement = createBlock(iifeBody);
  const hasAwaits = containsAwaitExpression(iifeBlockBody);
  const hasYields = containsYieldExpression(iifeBlockBody);

  // Create IIFE with parameters
  const iife = createCall(
    createFnExpr(iifeParams, iifeBlockBody, { async: hasAwaits, generator: hasYields }),
    iifeCallArgs,
  );

  return wrapIIFEResult(iife, hasYields, hasAwaits);
}

/**
 * Transform a recur special form to its IR representation.
 */
export function transformRecur(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
  state: LoopState,
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
    if (!hasLoopContext(state)) {
      throw new ValidationError(
        "recur must be used inside a loop",
        "recur statement",
        "inside loop context",
        { actualType: "outside loop context", ...extractMetaSourceLocation(list) },
      );
    }

    const loopId = getCurrentLoopContext(state)!;

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
    const loopCall = createCall(createId(loopId), args);

    // Return a return statement with the loop call
    // This is essential for proper tail call optimization
    return createReturn(loopCall);
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
 * Transform a continue statement.
 * (continue) or (continue label)
 */
export function transformContinue(
  list: ListNode,
  _currentDir: string,
  _transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
  state: LoopState,
): IR.IRNode {
  // Validate inside loop context
  if (!hasLoopContext(state)) {
    throw new ValidationError(
      "continue must be inside a loop",
      "continue statement",
      "inside loop context",
      { actualType: "outside loop context", ...extractMetaSourceLocation(list) },
    );
  }

  // Check for optional label
  const label = list.elements.length > 1 && list.elements[1].type === "symbol"
    ? (list.elements[1] as SymbolNode).name
    : undefined;

  const node: IR.IRContinueStatement = {
    type: IR.IRNodeType.ContinueStatement,
    label,
  };
  copyPosition(list, node);
  return node;
}

/**
 * Transform a break statement.
 * (break) or (break label)
 */
export function transformBreak(
  list: ListNode,
  _currentDir: string,
  _transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
  state: LoopState,
): IR.IRNode {
  // Validate inside loop context
  if (!hasLoopContext(state)) {
    throw new ValidationError(
      "break must be inside a loop",
      "break statement",
      "inside loop context",
      { actualType: "outside loop context", ...extractMetaSourceLocation(list) },
    );
  }

  // Check for optional label
  const label = list.elements.length > 1 && list.elements[1].type === "symbol"
    ? (list.elements[1] as SymbolNode).name
    : undefined;

  const node: IR.IRBreakStatement = {
    type: IR.IRNodeType.BreakStatement,
    label,
  };
  copyPosition(list, node);
  return node;
}

/**
 * Helper function to transform a list of body expressions for a loop
 */
function transformLoopBody(
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
        return createBlock([transformedExpr]);
      }

      // Otherwise wrap in return
      return createBlock([createReturn(transformedExpr)]);
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
          bodyNodes.push(createReturn(transformedExpr));
        }
      }
    }
  }

  return createBlock(bodyNodes);
}

// forOfLabelTargets is now part of LoopState (see createLoopState)

// ============================================================================
// Scope-aware tree walking utilities (using generic ir-tree-walker)
// These functions use the generic walker instead of brittle switch-case patterns.
// ============================================================================

/**
 * Collect all labeled break/continue target names from IR nodes.
 * Uses generic tree walker - automatically handles ALL IR node types.
 */
function collectLabeledJumpTargets(nodes: IR.IRNode[]): Set<string> {
  const targets = new Set<string>();
  for (const node of nodes) {
    const nodeTargets = collectJumpTargets(node);
    for (const target of nodeTargets) {
      targets.add(target);
    }
  }
  return targets;
}

/**
 * Collect all ForOfStatement nodes from an IR tree (at any depth).
 * Uses generic tree walker with lookInsideIIFEs option.
 */
function collectForOfNodes(node: IR.IRNode): IR.IRForOfStatement[] {
  return collectForOfStatementsInScope(node, { lookInsideIIFEs: true });
}

/**
 * Check if IR body contains any return statements in scope.
 * Uses generic tree walker - stops at function boundaries and IIFEs.
 */
function containsReturnInBody(nodes: IR.IRNode[]): boolean {
  for (const node of nodes) {
    // Don't look inside IIFEs - return inside IIFE is scoped to IIFE
    if (containsReturnInScope(node, { lookInsideIIFEs: false })) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a node contains any break/continue statements targeting a specific label.
 * Uses generic tree walker with lookInsideIIFEs option.
 */
function hasBreakOrContinueTargeting(node: IR.IRNode, labelName: string): boolean {
  return containsJumpToLabel(node, labelName, { lookInsideIIFEs: true });
}

/**
 * Transform a for-of statement.
 * (for-of [x collection] body...)
 *
 * EXPRESSION-EVERYWHERE: for-of is now an expression that returns nil.
 * This follows Clojure's doseq semantics - iteration for side effects,
 * always returns nil but IS an expression.
 *
 * Generates:
 * (() => {
 *   for (const x of collection) { body }
 *   return null;
 * })()
 *
 * For async (for-await-of):
 * (async () => {
 *   for await (const x of collection) { body }
 *   return null;
 * })()
 */
export function transformForOf(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
  state: LoopState,
  isAwait: boolean = false,
): IR.IRNode {
  // Validate syntax: (for-of [binding collection] body...)
  if (list.elements.length < 3) {
    throw new ValidationError(
      `for-of requires binding and body`,
      "for-of statement",
      "[binding collection] body",
      { actualType: `${list.elements.length - 1} elements`, ...extractMetaSourceLocation(list) },
    );
  }

  const bindingsNode = list.elements[1];
  if (bindingsNode.type !== "list") {
    throw new ValidationError(
      "for-of binding must be a vector [var collection]",
      "for-of binding",
      "vector",
      { actualType: bindingsNode.type, ...extractMetaSourceLocation(bindingsNode) },
    );
  }

  let bindings = bindingsNode as ListNode;

  // Handle vector syntax: strip "vector" prefix if present
  if (
    bindings.elements.length > 0 &&
    bindings.elements[0].type === "symbol" &&
    ((bindings.elements[0] as SymbolNode).name === VECTOR_SYMBOL ||
     (bindings.elements[0] as SymbolNode).name === EMPTY_ARRAY_SYMBOL)
  ) {
    bindings = {
      ...bindings,
      elements: bindings.elements.slice(1),
    } as ListNode;
  }

  if (bindings.elements.length !== 2) {
    throw new ValidationError(
      "for-of binding requires exactly [var collection]",
      "for-of binding",
      "2 elements",
      { actualType: String(bindings.elements.length), ...extractMetaSourceLocation(bindings) },
    );
  }

  // Get binding variable name
  const varNode = bindings.elements[0];
  if (varNode.type !== "symbol") {
    throw new ValidationError(
      "for-of binding variable must be a symbol",
      "for-of binding variable",
      "symbol",
      { actualType: varNode.type, ...extractMetaSourceLocation(varNode) },
    );
  }

  const varName = sanitizeIdentifier((varNode as SymbolNode).name);

  // Transform the collection/iterable expression
  const collectionNode = bindings.elements[1];
  const collection = transformNode(collectionNode, currentDir);
  if (!collection) {
    throw new ValidationError(
      "for-of collection must be a valid expression",
      "for-of collection",
      "expression",
      { actualType: "null", ...extractMetaSourceLocation(collectionNode) },
    );
  }

  // Push loop context for continue/break
  const loopId = generateLoopId(state);
  pushLoopContext(state, loopId);

  try {
    // Transform body expressions
    const bodyExprs = list.elements.slice(2);
    const bodyStatements: IR.IRNode[] = [];

    for (const expr of bodyExprs) {
      const transformed = transformNode(expr, currentDir);
      if (transformed) {
        // Wrap expressions in ExpressionStatement if needed
        if (!STATEMENT_TYPES.has(transformed.type)) {
          bodyStatements.push(createExprStmt(transformed));
        } else {
          bodyStatements.push(transformed);
        }
      }
    }

    // Create the for-of statement
    const forOfNode: IR.IRForOfStatement = {
      type: IR.IRNodeType.ForOfStatement,
      left: createVarDecl(varName, null),
      right: collection,
      body: createBlock(bodyStatements),
      await: isAwait,
    };
    copyPosition(list, forOfNode);

    // Check if body contains labeled break/continue targeting ancestor labels.
    // If any targeted label is in our ancestor chain (loopContextStack),
    // we can't wrap in IIFE here - the outermost targeted label will handle it.
    //
    // GENERAL SOLUTION: This works for ANY nesting depth because:
    // 1. We collect ALL targeted labels from the body
    // 2. We check if ANY of them are ancestors (in loopContextStack)
    // 3. If so, we defer IIFE creation to the label (which will check if it's outermost)
    const targetedLabels = collectLabeledJumpTargets(bodyStatements);

    if (targetedLabels.size > 0) {
      // Check if any targeted label is in our ancestor chain
      const ancestorLabelsInScope = new Set(state.loopContextStack);
      const hasAncestorTarget = [...targetedLabels].some(label => ancestorLabelsInScope.has(label));

      if (hasAncestorTarget) {
        // Store the targets so transformLabel can use them later
        state.forOfLabelTargets.set(forOfNode, targetedLabels);
        // Return as statement - the ancestor label will wrap in IIFE
        return forOfNode;
      }
    }

    // Check if body contains return statements - if so, DON'T wrap in IIFE
    // because return needs to escape to the outer function, not the IIFE.
    // This is critical for (for [x coll] (if test (return x))) patterns.
    const bodyContainsReturn = containsReturnInBody(bodyStatements);
    if (bodyContainsReturn) {
      // Return the raw for-of statement without IIFE wrapper
      return forOfNode;
    }

    // EXPRESSION-EVERYWHERE: Wrap for-of in IIFE that returns null
    // This makes for-of an expression like Clojure's doseq
    //
    // Generated code:
    // (() => { for (const x of coll) { ... }; return null; })()
    // or for async:
    // (async () => { for await (const x of coll) { ... }; return null; })()
    const iifeBody: IR.IRBlockStatement = createBlock([
      forOfNode,
      createReturn(createNull()),
    ]);

    // Check if body contains await/yield (beyond for-await-of itself)
    const hasAwaits = isAwait || containsAwaitExpression(forOfNode.body);
    const hasYields = containsYieldExpression(forOfNode.body);

    const iife = createCall(
      createFnExpr([], iifeBody, { async: hasAwaits, generator: hasYields }),
      [],
    );
    copyPosition(list, iife);

    const result = wrapIIFEResult(iife, hasYields, hasAwaits);
    if (result !== iife) copyPosition(list, result);
    return result;
  } finally {
    popLoopContext(state);
  }
}

/**
 * Transform a for-await-of statement.
 * (for-await-of [x asyncIterable] body...)
 *
 * Generates: for await (const x of asyncIterable) { body }
 */
export function transformForAwaitOf(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
  state: LoopState,
): IR.IRNode {
  return transformForOf(list, currentDir, transformNode, state, true);
}

/**
 * Transform a labeled statement.
 * (label name statement)
 *
 * Example:
 * (label outer
 *   (while true
 *     (while true
 *       (when condition
 *         (break outer)))))
 *
 * Generates:
 * outer: while (true) {
 *   while (true) {
 *     if (condition) {
 *       break outer;
 *     }
 *   }
 * }
 *
 * EXPRESSION-EVERYWHERE: When this label contains a for-of (at ANY depth) that has
 * labeled break/continue targeting this label, AND this label is the OUTERMOST
 * targeted label, we wrap the entire body in an IIFE with this label inside.
 *
 * This works for ANY nesting depth:
 *
 * (label outer (for-of [x items] (break outer)))
 * (label outer (do (for-of [x items] (break outer))))
 * (label outer (if cond (for-of [x items] (break outer))))
 * (label outer (label inner (for-of [x items] (break outer) (break inner))))
 *
 * All generate:
 * (() => {
 *   outer: <body with for-of>
 *   return null;
 * })()
 */
export function transformLabel(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
  state: LoopState,
): IR.IRNode {
  if (list.elements.length < 3) {
    throw new ValidationError(
      "label requires a name and a statement",
      "label statement",
      "(label name statement)",
      { actualType: `${list.elements.length - 1} elements`, ...extractMetaSourceLocation(list) },
    );
  }

  const nameNode = list.elements[1];
  if (nameNode.type !== "symbol") {
    throw new ValidationError(
      "label name must be a symbol",
      "label name",
      "symbol",
      { actualType: nameNode.type, ...extractMetaSourceLocation(nameNode) },
    );
  }

  const labelName = sanitizeIdentifier((nameNode as SymbolNode).name);

  // Push label context so break/continue can reference it
  // NOTE: We keep this label in the stack during the needsIIFE check
  // so we can properly determine if we're the outermost targeted label
  pushLoopContext(state, labelName);

  try {
    // Transform the body statement
    const bodyNode = list.elements[2];
    const body = transformNode(bodyNode, currentDir);
    if (!body) {
      throw new ValidationError(
        "label body must be a valid statement",
        "label body",
        "statement",
        { actualType: "null", ...extractMetaSourceLocation(bodyNode) },
      );
    }

    // GENERALIZED SOLUTION: Find ALL for-of nodes in the body (at any depth)
    // and check if any of them target this label. If we're the outermost
    // targeted label, wrap in IIFE.
    //
    // This works for ANY nesting depth because:
    // 1. collectForOfNodes finds for-of at any depth in the IR tree
    // 2. forOfLabelTargets tells us which labels each for-of targets
    // 3. We check the loopContextStack (excluding self) to see if any ancestor is targeted
    // 4. If no ancestor is targeted but we are, we're the outermost - wrap in IIFE
    const forOfNodes = collectForOfNodes(body);
    let needsIIFE = false;
    let hasAsyncForOf = false;

    for (const forOf of forOfNodes) {
      const targets = state.forOfLabelTargets.get(forOf);
      if (targets && targets.has(labelName)) {
        // This for-of targets our label
        // Check if any ANCESTOR label (excluding self) is also targeted
        // Ancestors are all stack items except the current one (which is us)
        const ancestorStack = state.loopContextStack.slice(0, -1);  // Exclude self
        const ancestorTargeted = ancestorStack.some(ancestor => targets.has(ancestor));

        if (!ancestorTargeted) {
          // We're the outermost targeted label - we should wrap in IIFE
          needsIIFE = true;
          if (forOf.await) {
            hasAsyncForOf = true;
          }
          // Don't break - continue checking to find if any for-await-of exists
        }
      }
    }

    // EXPRESSION-EVERYWHERE: Also check for break/continue targeting this label
    // even without for-of. This ensures (label x (break x)) returns null.
    if (!needsIIFE && hasBreakOrContinueTargeting(body, labelName)) {
      needsIIFE = true;
    }

    if (needsIIFE) {
      // Check if body is already an IIFE (e.g., from `do` block)
      // If so, we need to unwrap it and put its content inside our IIFE with the label
      let actualBody: IR.IRNode = body;
      let isBodyAsync = hasAsyncForOf;
      let isBodyGenerator = false;

      if (body.type === IR.IRNodeType.CallExpression) {
        const callExpr = body as IR.IRCallExpression;
        if (callExpr.callee.type === IR.IRNodeType.FunctionExpression) {
          const funcExpr = callExpr.callee as IR.IRFunctionExpression;
          // This is an IIFE - unwrap it
          // We'll use its body as the content for our labeled block
          actualBody = funcExpr.body;
          if (funcExpr.async) {
            isBodyAsync = true;
          }
          if (funcExpr.generator) {
            isBodyGenerator = true;
          }
        }
      }

      // Also check if the body contains await/yield that wasn't from an IIFE
      if (!isBodyAsync && containsAwaitExpression(actualBody)) {
        isBodyAsync = true;
      }
      if (!isBodyGenerator && containsYieldExpression(actualBody)) {
        isBodyGenerator = true;
      }

      // Create labeled block with the (potentially unwrapped) body
      const labeledBody: IR.IRLabeledStatement = {
        type: IR.IRNodeType.LabeledStatement,
        label: labelName,
        body: actualBody,
      };
      copyPosition(list, labeledBody);

      // Create IIFE body: labeled block + return null
      // Note: if actualBody is already a BlockStatement from an unwrapped IIFE,
      // we wrap it in the label. The return null is still needed.
      const iifeBodyStatements: IR.IRNode[] = [labeledBody];

      // ALWAYS add return null AFTER the labeled statement.
      // This is needed because when `break label` is used, control jumps
      // past the labeled block to here. If the body also ends with a return,
      // that handles normal completion, but we still need this one for breaks.
      iifeBodyStatements.push(createReturn(createNull()));

      const iifeBody: IR.IRBlockStatement = createBlock(iifeBodyStatements);

      const iife = createCall(
        createFnExpr([], iifeBody, { async: isBodyAsync, generator: isBodyGenerator }),
        [],
      );
      copyPosition(list, iife);

      return wrapIIFEResult(iife, isBodyGenerator, isBodyAsync);
    }

    // Normal case: just wrap body with label (no IIFE needed)
    const node: IR.IRLabeledStatement = {
      type: IR.IRNodeType.LabeledStatement,
      label: labelName,
      body,
    };
    copyPosition(list, node);
    return node;
  } finally {
    popLoopContext(state);
  }
}
