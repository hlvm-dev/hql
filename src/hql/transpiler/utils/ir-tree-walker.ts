/**
 * Generic IR Tree Walker
 *
 * Provides utilities for walking IR trees without needing explicit switch-cases.
 * This is a fundamental solution that automatically handles ALL IR node types,
 * including any new ones added in the future.
 */

import * as IR from "../type/hql_ir.ts";

// Module-level constant Set (avoids per-call allocation)
const IR_SKIP_KEYS = new Set(["type", "position", "loc", "start", "end", "range"]);

/**
 * Check if an IR node tree contains any node of the specified type.
 * Uses generic tree walking - automatically handles ALL IR node types.
 *
 * @param node - The root node to search from
 * @param targetType - The IR node type to search for
 * @returns true if any node of the target type is found
 */
export function containsNodeType(
  node: IR.IRNode | null | undefined,
  targetType: IR.IRNodeType,
): boolean {
  if (!node || typeof node !== "object") return false;

  // Direct match
  if (node.type === targetType) return true;

  // Generic tree walk
  return walkChildren(node, (child) => containsNodeType(child, targetType));
}

/**
 * Check if an IR node tree contains any node matching a predicate.
 * Uses generic tree walking - automatically handles ALL IR node types.
 *
 * @param node - The root node to search from
 * @param predicate - Function to test each node
 * @returns true if any node matches the predicate
 */
export function containsMatch(
  node: IR.IRNode | null | undefined,
  predicate: (node: IR.IRNode) => boolean,
): boolean {
  if (!node || typeof node !== "object") return false;

  // Check current node
  if (predicate(node)) return true;

  // Generic tree walk
  return walkChildren(node, (child) => containsMatch(child, predicate));
}

/**
 * Walk all children of an IR node and apply a function.
 * Returns true if any child returns true (for short-circuit evaluation).
 *
 * This is the core generic walker that introspects node properties.
 */
function walkChildren(
  node: IR.IRNode,
  fn: (child: IR.IRNode) => boolean,
): boolean {
  for (const key of Object.keys(node)) {
    if (IR_SKIP_KEYS.has(key)) continue;

    const value = (node as unknown as Record<string, unknown>)[key];
    if (!value || typeof value !== "object") continue;

    // Array of potential IR nodes
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && "type" in item) {
          if (fn(item as IR.IRNode)) return true;
        }
      }
    }
    // Single potential IR node (has a 'type' property with a number value)
    else if ("type" in value && typeof (value as IR.IRNode).type === "number") {
      if (fn(value as IR.IRNode)) return true;
    }
  }

  return false;
}

/**
 * Apply a function to every node in an IR tree (depth-first).
 * Useful for validation, collection, or side-effect-based traversal.
 *
 * @param node - The root node
 * @param fn - Function to call for each node
 */
export function forEachNode(
  node: IR.IRNode | null | undefined,
  fn: (node: IR.IRNode) => void,
): void {
  if (!node || typeof node !== "object") return;

  // Visit current node
  fn(node);

  // Visit children
  walkChildren(node, (child) => {
    forEachNode(child, fn);
    return false; // Continue walking
  });
}

// ============================================================================
// Convenience functions for common searches
// ============================================================================

/**
 * Check if tree contains an AwaitExpression
 */
export function containsAwaitExpression(node: IR.IRNode | null | undefined): boolean {
  return containsNodeType(node ?? null, IR.IRNodeType.AwaitExpression);
}

/**
 * Check if tree contains a YieldExpression
 */
export function containsYieldExpression(node: IR.IRNode | null | undefined): boolean {
  return containsNodeType(node ?? null, IR.IRNodeType.YieldExpression);
}

/**
 * Check if tree contains a ThrowStatement
 */
export function containsThrowStatement(node: IR.IRNode | null | undefined): boolean {
  return containsNodeType(node ?? null, IR.IRNodeType.ThrowStatement);
}

// ============================================================================
// Scope-aware walking utilities
// These stop at function boundaries (where return/break/continue don't escape)
// ============================================================================

/**
 * Check if a node is a function boundary (creates new scope for control flow)
 * Note: HQL's IR uses FunctionExpression for both regular and arrow functions.
 */
function isFunctionBoundary(node: IR.IRNode): boolean {
  return (
    node.type === IR.IRNodeType.FunctionExpression ||
    node.type === IR.IRNodeType.FunctionDeclaration ||
    node.type === IR.IRNodeType.FnFunctionDeclaration
  );
}

/**
 * Check if a node is an IIFE (Immediately Invoked Function Expression)
 * IIFEs are scope wrappers but not real function boundaries for some control flow.
 */
function isIIFE(node: IR.IRNode): boolean {
  if (node.type !== IR.IRNodeType.CallExpression) return false;
  const call = node as IR.IRCallExpression;
  return call.callee.type === IR.IRNodeType.FunctionExpression;
}

/**
 * Options for scope-aware walking
 */
export interface ScopeWalkOptions {
  /** If true, look inside IIFEs instead of stopping at them */
  lookInsideIIFEs?: boolean;
}

/**
 * Walk children in scope - stops at function boundaries.
 * Optionally can look inside IIFEs.
 */
function walkChildrenInScope(
  node: IR.IRNode,
  fn: (child: IR.IRNode) => boolean,
  _options: ScopeWalkOptions = {},
): boolean {
  for (const key of Object.keys(node)) {
    if (IR_SKIP_KEYS.has(key)) continue;

    const value = (node as unknown as Record<string, unknown>)[key];
    if (!value || typeof value !== "object") continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && "type" in item) {
          if (fn(item as IR.IRNode)) return true;
        }
      }
    } else if ("type" in value && typeof (value as IR.IRNode).type === "number") {
      if (fn(value as IR.IRNode)) return true;
    }
  }

  return false;
}

/**
 * Check if an IR node tree contains any node of the specified type,
 * but stop at function boundaries (scope-aware).
 *
 * @param node - The root node to search from
 * @param targetType - The IR node type to search for
 * @param options - Walking options (e.g., lookInsideIIFEs)
 * @returns true if any node of the target type is found in scope
 */
export function containsNodeTypeInScope(
  node: IR.IRNode | null | undefined,
  targetType: IR.IRNodeType,
  options: ScopeWalkOptions = {},
): boolean {
  if (!node || typeof node !== "object") return false;

  // Direct match
  if (node.type === targetType) return true;

  // Stop at function boundaries (but optionally look inside IIFEs)
  if (isFunctionBoundary(node)) {
    return false;
  }

  // Special handling for IIFEs
  if (isIIFE(node) && options.lookInsideIIFEs) {
    const call = node as IR.IRCallExpression;
    const funcExpr = call.callee as IR.IRFunctionExpression;
    // Look inside the IIFE body
    return containsNodeTypeInScope(funcExpr.body, targetType, options);
  }

  // Generic tree walk
  return walkChildrenInScope(node, (child) =>
    containsNodeTypeInScope(child, targetType, options)
  );
}

/**
 * Check if an IR node tree contains any node matching a predicate,
 * but stop at function boundaries (scope-aware).
 */
export function containsMatchInScope(
  node: IR.IRNode | null | undefined,
  predicate: (node: IR.IRNode) => boolean,
  options: ScopeWalkOptions = {},
): boolean {
  if (!node || typeof node !== "object") return false;

  // Check current node
  if (predicate(node)) return true;

  // Stop at function boundaries
  if (isFunctionBoundary(node)) {
    return false;
  }

  // Special handling for IIFEs
  if (isIIFE(node) && options.lookInsideIIFEs) {
    const call = node as IR.IRCallExpression;
    const funcExpr = call.callee as IR.IRFunctionExpression;
    return containsMatchInScope(funcExpr.body, predicate, options);
  }

  // Generic tree walk
  return walkChildrenInScope(node, (child) =>
    containsMatchInScope(child, predicate, options)
  );
}

/**
 * Apply a function to every node in scope (stops at function boundaries).
 */
export function forEachNodeInScope(
  node: IR.IRNode | null | undefined,
  fn: (node: IR.IRNode) => void,
  options: ScopeWalkOptions = {},
): void {
  if (!node || typeof node !== "object") return;

  // Visit current node
  fn(node);

  // Stop at function boundaries
  if (isFunctionBoundary(node)) {
    return;
  }

  // Special handling for IIFEs
  if (isIIFE(node) && options.lookInsideIIFEs) {
    const call = node as IR.IRCallExpression;
    const funcExpr = call.callee as IR.IRFunctionExpression;
    forEachNodeInScope(funcExpr.body, fn, options);
    return;
  }

  // Visit children
  walkChildrenInScope(node, (child) => {
    forEachNodeInScope(child, fn, options);
    return false; // Continue walking
  });
}

/**
 * Collect all nodes matching a predicate within scope.
 */
export function collectNodesInScope<T extends IR.IRNode>(
  node: IR.IRNode | null | undefined,
  predicate: (node: IR.IRNode) => node is T,
  options: ScopeWalkOptions = {},
): T[] {
  const results: T[] = [];
  forEachNodeInScope(node, (n) => {
    if (predicate(n)) {
      results.push(n);
    }
  }, options);
  return results;
}

// ============================================================================
// Scope-aware convenience functions
// ============================================================================

/**
 * Check if tree contains a ReturnStatement in scope (stops at function boundaries)
 */
export function containsReturnInScope(
  node: IR.IRNode | null | undefined,
  options: ScopeWalkOptions = {},
): boolean {
  return containsNodeTypeInScope(node, IR.IRNodeType.ReturnStatement, options);
}

/**
 * Check if tree contains a break/continue targeting a specific label
 */
export function containsJumpToLabel(
  node: IR.IRNode | null | undefined,
  labelName: string,
  options: ScopeWalkOptions = {},
): boolean {
  return containsMatchInScope(node, (n) => {
    if (n.type === IR.IRNodeType.BreakStatement) {
      return (n as IR.IRBreakStatement).label === labelName;
    }
    if (n.type === IR.IRNodeType.ContinueStatement) {
      return (n as IR.IRContinueStatement).label === labelName;
    }
    return false;
  }, options);
}

/**
 * Collect all labeled break/continue target names from a node tree in scope.
 */
export function collectJumpTargets(
  node: IR.IRNode | null | undefined,
  options: ScopeWalkOptions = {},
): Set<string> {
  const targets = new Set<string>();
  forEachNodeInScope(node, (n) => {
    if (n.type === IR.IRNodeType.BreakStatement) {
      const label = (n as IR.IRBreakStatement).label;
      if (label) targets.add(label);
    }
    if (n.type === IR.IRNodeType.ContinueStatement) {
      const label = (n as IR.IRContinueStatement).label;
      if (label) targets.add(label);
    }
  }, options);
  return targets;
}

/**
 * Collect all ForOfStatement nodes in scope
 */
export function collectForOfStatementsInScope(
  node: IR.IRNode | null | undefined,
  options: ScopeWalkOptions = {},
): IR.IRForOfStatement[] {
  return collectNodesInScope(
    node,
    (n): n is IR.IRForOfStatement => n.type === IR.IRNodeType.ForOfStatement,
    options,
  );
}
