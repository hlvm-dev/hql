/**
 * Shared Tail Position Analysis Utility
 *
 * Provides a centralized, generic way to analyze tail positions in IR trees.
 * Used by both single-function TCO and mutual recursion TCO optimizers.
 *
 * Tail position rules (JavaScript semantics):
 * - BlockStatement: only last statement is in tail position
 * - IfStatement: both branches inherit tail position from parent
 * - ReturnStatement: the argument is always in tail position
 * - ConditionalExpression: both branches inherit tail position
 * - ExpressionStatement: expression is NOT in tail position (except yield* in generators)
 * - VariableDeclaration: initializers are NOT in tail position
 */

import * as IR from "../type/hql_ir.ts";

/**
 * Visitor callback for tail position analysis.
 * Called for each call expression found during analysis.
 *
 * @param call - The call expression found
 * @param inTailPosition - Whether this call is in tail position
 * @returns void (side effects via closure)
 */
export type TailCallVisitor = (call: IR.IRCallExpression, inTailPosition: boolean) => void;

/**
 * Options for tail position analysis
 */
export interface TailPositionAnalyzerOptions {
  /**
   * If true, treat yield* expressions in tail position as propagating tail position
   * to their argument. Used for generator TCO.
   */
  treatYieldDelegateAsTail?: boolean;

  /**
   * If true, treat await expressions in tail position as propagating tail position
   * to their argument. Used for async TCO.
   */
  treatAwaitAsTail?: boolean;
}

/**
 * Analyze tail positions in a function body and visit all call expressions.
 *
 * This is the core utility that eliminates duplication between TCO optimizers.
 * It walks the IR tree, tracking tail position semantics, and calls the visitor
 * for each CallExpression found.
 *
 * @param body - The function body to analyze
 * @param visitor - Callback for each call expression found
 * @param options - Analysis options
 */
export function analyzeTailCalls(
  body: IR.IRBlockStatement,
  visitor: TailCallVisitor,
  options: TailPositionAnalyzerOptions = {},
): void {
  walkStatement(body, true, visitor, options);
}

/**
 * Walk a statement node, tracking tail position.
 */
function walkStatement(
  node: IR.IRNode,
  inTailPosition: boolean,
  visitor: TailCallVisitor,
  options: TailPositionAnalyzerOptions,
): void {
  if (!node) return;

  switch (node.type) {
    case IR.IRNodeType.BlockStatement: {
      const block = node as IR.IRBlockStatement;
      const stmts = block.body;
      // Only the last statement in a block can be in tail position
      stmts.forEach((stmt, i) => {
        walkStatement(stmt, inTailPosition && i === stmts.length - 1, visitor, options);
      });
      break;
    }

    case IR.IRNodeType.ReturnStatement: {
      const ret = node as IR.IRReturnStatement;
      // Return argument is ALWAYS in tail position
      if (ret.argument) {
        walkExpression(ret.argument, true, visitor, options);
      }
      break;
    }

    case IR.IRNodeType.IfStatement: {
      const ifStmt = node as IR.IRIfStatement;
      // Test is never in tail position
      walkExpression(ifStmt.test, false, visitor, options);
      // Both branches inherit tail position
      walkStatement(ifStmt.consequent, inTailPosition, visitor, options);
      if (ifStmt.alternate) {
        walkStatement(ifStmt.alternate, inTailPosition, visitor, options);
      }
      break;
    }

    case IR.IRNodeType.ExpressionStatement: {
      const exprStmt = node as IR.IRExpressionStatement;
      const expr = exprStmt.expression;

      // Special case: yield* in generator functions
      if (
        options.treatYieldDelegateAsTail &&
        inTailPosition &&
        expr.type === IR.IRNodeType.YieldExpression
      ) {
        const yieldExpr = expr as IR.IRYieldExpression;
        if (yieldExpr.delegate && yieldExpr.argument) {
          // yield* argument IS in tail position for generators
          walkExpression(yieldExpr.argument, true, visitor, options);
          break;
        }
      }

      // Normal case: expression statements are NOT in tail position
      walkExpression(expr, false, visitor, options);
      break;
    }

    case IR.IRNodeType.VariableDeclaration: {
      const varDecl = node as IR.IRVariableDeclaration;
      // Variable initializers are never in tail position
      varDecl.declarations.forEach((d) => {
        if (d.init) {
          walkExpression(d.init, false, visitor, options);
        }
      });
      break;
    }

    case IR.IRNodeType.TryStatement: {
      const tryStmt = node as IR.IRTryStatement;
      // Try/catch/finally bodies are not in tail position (returns must be explicit)
      walkStatement(tryStmt.block, false, visitor, options);
      if (tryStmt.handler) {
        walkStatement(tryStmt.handler.body, false, visitor, options);
      }
      if (tryStmt.finalizer) {
        walkStatement(tryStmt.finalizer, false, visitor, options);
      }
      break;
    }

    case IR.IRNodeType.WhileStatement: {
      const whileStmt = node as IR.IRWhileStatement;
      walkExpression(whileStmt.test, false, visitor, options);
      walkStatement(whileStmt.body, false, visitor, options);
      break;
    }

    case IR.IRNodeType.ForStatement: {
      const forStmt = node as IR.IRForStatement;
      if (forStmt.init) walkStatement(forStmt.init, false, visitor, options);
      if (forStmt.test) walkExpression(forStmt.test, false, visitor, options);
      if (forStmt.update) walkExpression(forStmt.update, false, visitor, options);
      walkStatement(forStmt.body, false, visitor, options);
      break;
    }

    case IR.IRNodeType.ForOfStatement: {
      const forOfStmt = node as IR.IRForOfStatement;
      walkExpression(forOfStmt.right, false, visitor, options);
      walkStatement(forOfStmt.body, false, visitor, options);
      break;
    }

    case IR.IRNodeType.LabeledStatement: {
      const labeled = node as IR.IRLabeledStatement;
      walkStatement(labeled.body, inTailPosition, visitor, options);
      break;
    }

    case IR.IRNodeType.ThrowStatement: {
      const throwStmt = node as IR.IRThrowStatement;
      walkExpression(throwStmt.argument, false, visitor, options);
      break;
    }

    // Other statement types don't contain expressions or are terminal
  }
}

/**
 * Walk an expression node, tracking tail position.
 */
function walkExpression(
  node: IR.IRNode,
  inTailPosition: boolean,
  visitor: TailCallVisitor,
  options: TailPositionAnalyzerOptions,
): void {
  if (!node) return;

  switch (node.type) {
    case IR.IRNodeType.CallExpression: {
      const call = node as IR.IRCallExpression;
      // Visit this call with its tail position status
      visitor(call, inTailPosition);
      // Arguments are never in tail position
      call.arguments.forEach((arg) => walkExpression(arg, false, visitor, options));
      // Callee is never in tail position (it's evaluated before the call)
      if (call.callee.type !== IR.IRNodeType.Identifier) {
        walkExpression(call.callee as IR.IRNode, false, visitor, options);
      }
      break;
    }

    case IR.IRNodeType.ConditionalExpression: {
      const cond = node as IR.IRConditionalExpression;
      // Test is never in tail position
      walkExpression(cond.test, false, visitor, options);
      // Both branches inherit tail position
      walkExpression(cond.consequent, inTailPosition, visitor, options);
      walkExpression(cond.alternate, inTailPosition, visitor, options);
      break;
    }

    case IR.IRNodeType.BinaryExpression: {
      const bin = node as IR.IRBinaryExpression;
      // Binary operands are never in tail position
      walkExpression(bin.left, false, visitor, options);
      walkExpression(bin.right, false, visitor, options);
      break;
    }

    case IR.IRNodeType.LogicalExpression: {
      const logic = node as IR.IRLogicalExpression;
      // Left is never in tail position
      walkExpression(logic.left, false, visitor, options);
      // Right MAY be in tail position for && and ||
      walkExpression(logic.right, inTailPosition, visitor, options);
      break;
    }

    case IR.IRNodeType.UnaryExpression: {
      const unary = node as IR.IRUnaryExpression;
      walkExpression(unary.argument, false, visitor, options);
      break;
    }

    case IR.IRNodeType.MemberExpression: {
      const mem = node as IR.IRMemberExpression;
      walkExpression(mem.object, false, visitor, options);
      if (mem.computed) {
        walkExpression(mem.property, false, visitor, options);
      }
      break;
    }

    case IR.IRNodeType.ArrayExpression: {
      const arr = node as IR.IRArrayExpression;
      arr.elements.forEach((el) => {
        if (el) walkExpression(el, false, visitor, options);
      });
      break;
    }

    case IR.IRNodeType.ObjectExpression: {
      const obj = node as IR.IRObjectExpression;
      obj.properties.forEach((prop) => {
        if (prop.type === IR.IRNodeType.ObjectProperty) {
          walkExpression((prop as IR.IRObjectProperty).value, false, visitor, options);
        } else if (prop.type === IR.IRNodeType.SpreadAssignment) {
          walkExpression((prop as IR.IRSpreadAssignment).expression, false, visitor, options);
        }
      });
      break;
    }

    case IR.IRNodeType.YieldExpression: {
      const yieldExpr = node as IR.IRYieldExpression;
      if (yieldExpr.argument) {
        // For yield*, argument may be in tail position if option set
        const argTail = !!(options.treatYieldDelegateAsTail && yieldExpr.delegate && inTailPosition);
        walkExpression(yieldExpr.argument, argTail, visitor, options);
      }
      break;
    }

    case IR.IRNodeType.AwaitExpression: {
      const awaitExpr = node as IR.IRAwaitExpression;
      // For await, argument may be in tail position if option set
      const argTail = !!(options.treatAwaitAsTail && inTailPosition);
      walkExpression(awaitExpr.argument, argTail, visitor, options);
      break;
    }

    case IR.IRNodeType.SequenceExpression: {
      const seq = node as IR.IRSequenceExpression;
      // Only last expression in sequence can be in tail position
      seq.expressions.forEach((expr, i) => {
        walkExpression(expr, inTailPosition && i === seq.expressions.length - 1, visitor, options);
      });
      break;
    }

    case IR.IRNodeType.AssignmentExpression: {
      const assign = node as IR.IRAssignmentExpression;
      walkExpression(assign.left, false, visitor, options);
      walkExpression(assign.right, false, visitor, options);
      break;
    }

    case IR.IRNodeType.NewExpression: {
      const newExpr = node as IR.IRNewExpression;
      walkExpression(newExpr.callee, false, visitor, options);
      newExpr.arguments.forEach((arg) => walkExpression(arg, false, visitor, options));
      break;
    }

    case IR.IRNodeType.SpreadElement: {
      const spread = node as IR.IRSpreadElement;
      walkExpression(spread.argument, false, visitor, options);
      break;
    }

    case IR.IRNodeType.TemplateLiteral: {
      const template = node as IR.IRTemplateLiteral;
      template.expressions.forEach((expr) => walkExpression(expr, false, visitor, options));
      break;
    }

    // Literals, identifiers, and other terminal nodes - nothing to walk
  }
}

// ============================================================================
// Helper functions for common use cases
// ============================================================================

/**
 * Check if a function has tail recursion (all recursive calls in tail position).
 * Used by single-function TCO optimizer.
 *
 * @param body - Function body
 * @param funcName - Name of the function to check for recursion
 * @returns { hasRecursion, allTailCalls } - Whether function has recursion and if all calls are tail calls
 */
export function checkTailRecursion(
  body: IR.IRBlockStatement,
  funcName: string,
): { hasRecursion: boolean; allTailCalls: boolean } {
  let hasRecursion = false;
  let allTailCalls = true;

  analyzeTailCalls(body, (call, inTailPosition) => {
    // Check if this is a recursive call
    if (
      call.callee.type === IR.IRNodeType.Identifier &&
      (call.callee as IR.IRIdentifier).name === funcName
    ) {
      hasRecursion = true;
      if (!inTailPosition) {
        allTailCalls = false;
      }
    }
  });

  return { hasRecursion, allTailCalls };
}

/**
 * Find all tail calls to a set of known functions.
 * Used by mutual recursion TCO optimizer.
 *
 * @param body - Function body
 * @param funcName - Name of the current function
 * @param knownFunctions - Set of function names to look for
 * @param options - Additional options
 * @returns Set of function names that are called in tail position
 */
export function findTailCallsToFunctions(
  body: IR.IRBlockStatement,
  funcName: string,
  knownFunctions: Set<string>,
  options: {
    includeSelfCalls?: boolean;
    treatYieldDelegateAsTail?: boolean;
  } = {},
): Set<string> {
  const tailCalls = new Set<string>();

  analyzeTailCalls(
    body,
    (call, inTailPosition) => {
      if (!inTailPosition) return;

      // Check if callee is an identifier
      if (call.callee.type !== IR.IRNodeType.Identifier) return;

      const calleeName = (call.callee as IR.IRIdentifier).name;

      // Check if it's a known function
      if (!knownFunctions.has(calleeName)) return;

      // Exclude self calls unless requested
      if (calleeName === funcName && !options.includeSelfCalls) return;

      tailCalls.add(calleeName);
    },
    { treatYieldDelegateAsTail: options.treatYieldDelegateAsTail },
  );

  return tailCalls;
}

/**
 * Get the name of a function being called, if it's a simple identifier.
 */
export function getCalleeName(call: IR.IRCallExpression): string | null {
  if (call.callee.type === IR.IRNodeType.Identifier) {
    return (call.callee as IR.IRIdentifier).name;
  }
  return null;
}
