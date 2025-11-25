// core/src/transpiler/utils/validation-helpers.ts
// DRY utilities for common validation patterns

import { ValidationError } from "../../common/error.ts";
import * as IR from "../type/hql_ir.ts";
import type { HQLNode, SymbolNode, ListNode } from "../type/hql_ast.ts";

/**
 * Validate that a syntax transformation produced a non-null IR node
 *
 * Helper function to ensure HQL→IR transformations produce valid nodes.
 * Throws a descriptive ValidationError if the transformation result is null,
 * which helps catch transformation bugs early in the transpilation pipeline.
 *
 * This is a DRY utility that consolidated ~66 identical null-checking patterns
 * across syntax transformers. It provides consistent error messaging and
 * reduces code duplication throughout the codebase.
 *
 * @param node - IR node result from transformation (may be null)
 * @param context - Context string for error reporting (e.g., "if condition", "let value")
 * @param description - Human-readable description of expected value (default: "expression")
 * @returns The validated non-null IR node
 *
 * @throws {ValidationError} - If node is null, with context information
 *
 * @example
 * // Validate a transformation result in syntax transformer
 * const transformed = transformNode(expr, currentDir);
 * const validated = validateTransformed(
 *   transformed,
 *   "if condition",
 *   "boolean expression"
 * );
 * // → Returns transformed node or throws ValidationError with context
 *
 * @example
 * // Used in do block transformation
 * const bodyNode = validateTransformed(
 *   transformNode(bodyExpr, currentDir),
 *   "do block body",
 *   "do body expression"
 * );
 * // → Ensures do block has valid body
 *
 * @example
 * // With default description
 * const node = validateTransformed(
 *   transformNode(arg, currentDir),
 *   "function argument"
 * );
 * // → Uses default "expression" as description
 */
export function validateTransformed(
  node: IR.IRNode | null,
  context: string,
  description: string = "expression",
): IR.IRNode {
  if (!node) {
    throw new ValidationError(
      `${description} transformed to null`,
      context,
      "valid expression",
      "null",
    );
  }
  return node;
}

/**
 * Transform a collection of nodes using the provided transformer and validate the results.
 *
 * @param elements - Nodes to transform
 * @param currentDir - Current directory for relative imports
 * @param transformNode - Transformer function
 * @param context - Context string for error reporting
 * @param description - Human-readable description (default: "value")
 * @returns Array of validated IR nodes
 */
export function transformElements(
  elements: HQLNode[],
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
  context: string,
  description: string = "value",
): IR.IRNode[] {
  return elements
    .map((element) => transformNode(element, currentDir))
    .filter((node): node is IR.IRNode => node !== null)
    .map((node) =>
      validateTransformed(
        node,
        context,
        description,
      )
    );
}

/**
 * Transform nodes and drop null results without additional validation.
 */
export function transformNonNullElements(
  elements: HQLNode[],
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode[] {
  return elements
    .map((element) => transformNode(element, currentDir))
    .filter((node): node is IR.IRNode => node !== null);
}

/**
 * Check if a node is a spread operator.
 * Supports two forms:
 * 1. Symbol form: ...identifier (e.g., ...arr)
 * 2. List form: (... expression) (e.g., (... [1 2]), (... (getArray)))
 *
 * @param node - AST node to check
 * @returns true if node is a spread operator in either form
 */
export function isSpreadOperator(node: HQLNode): boolean {
  // Form 1: ...identifier (symbol with "..." prefix)
  if (node.type === "symbol" && (node as SymbolNode).name.startsWith("...")) {
    return true;
  }

  // Form 2: (... expression) (list with "..." operator)
  if (node.type === "list") {
    const list = node as ListNode;
    if (list.elements.length >= 2 &&
        list.elements[0].type === "symbol" &&
        (list.elements[0] as SymbolNode).name === "...") {
      return true;
    }
  }

  return false;
}

/**
 * Internal helper: Transform the argument of a spread operator.
 * Handles both symbol form (...identifier) and list form ((... expression)).
 *
 * @param node - The spread operator node (symbol or list)
 * @param currentDir - Current directory
 * @param transformNode - Transform function
 * @param context - Context for error messages
 * @returns The transformed argument node
 * @throws ValidationError if the argument is invalid
 */
function transformSpreadArgument(
  node: HQLNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
  context: string,
): IR.IRNode {
  let argNode: IR.IRNode | null = null;

  // Form 1: ...identifier (symbol form)
  if (node.type === "symbol") {
    const symbolName = (node as SymbolNode).name;
    const argName = symbolName.slice(3); // Remove '...' prefix

    argNode = transformNode(
      { type: "symbol", name: argName } as SymbolNode,
      currentDir,
    );
  }
  // Form 2: (... expression) (list form)
  else if (node.type === "list") {
    const list = node as ListNode;
    if (list.elements.length !== 2) {
      throw new ValidationError(
        "Spread operator (... expr) requires exactly one argument",
        context,
        "single expression",
        `${list.elements.length - 1} arguments`,
      );
    }

    // Transform the expression directly (second element in list)
    argNode = transformNode(list.elements[1], currentDir);
  }

  if (!argNode) {
    throw new ValidationError(
      "Spread argument must be a valid expression",
      context,
      "valid expression",
      "null",
    );
  }

  return argNode;
}

/**
 * Transform a spread operator node into a SpreadElement IR node.
 * DRY utility to handle ...spread syntax consistently across arrays, function calls, and objects.
 * Supports both symbol form (...identifier) and list form ((... expression)).
 *
 * @param node - The spread operator node (symbol starting with "..." or list with "..." operator)
 * @param currentDir - Current directory for imports
 * @param transformNode - Transform function
 * @param context - Context for error messages (e.g., "spread in array")
 * @returns SpreadElement IR node
 * @throws ValidationError if the spread argument is invalid
 *
 * @example
 * // Symbol form - In array: [1 ...arr 2]
 * if (isSpreadOperator(elem)) {
 *   elements.push(transformSpreadOperator(elem, currentDir, transformNode, "spread in array"));
 * }
 *
 * @example
 * // List form - Inline expression: [1 (... [2 3]) 4]
 * if (isSpreadOperator(elem)) {
 *   elements.push(transformSpreadOperator(elem, currentDir, transformNode, "spread in array"));
 * }
 *
 * @example
 * // In function call: (func ...args) or (func (... [1 2]))
 * if (isSpreadOperator(arg)) {
 *   args.push(transformSpreadOperator(arg, currentDir, transformNode, "spread in function call"));
 * }
 */
export function transformSpreadOperator(
  node: HQLNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
  context: string,
): IR.IRSpreadElement {
  const argument = transformSpreadArgument(node, currentDir, transformNode, context);

  return {
    type: IR.IRNodeType.SpreadElement,
    argument,
  } as IR.IRSpreadElement;
}

/**
 * Transform a spread operator node into a SpreadAssignment IR node (for object literals).
 * DRY utility for {...obj} syntax in object literals.
 * Supports both symbol form (...identifier) and list form ((... expression)).
 *
 * @param node - The spread operator node (symbol starting with "..." or list with "..." operator)
 * @param currentDir - Current directory for imports
 * @param transformNode - Transform function
 * @param context - Context for error messages (e.g., "spread in object")
 * @returns SpreadAssignment IR node
 * @throws ValidationError if the spread argument is invalid
 *
 * @example
 * // Symbol form - In object: {"a": 1, ...obj}
 * if (isSpreadOperator(elem)) {
 *   properties.push(transformObjectSpreadOperator(elem, currentDir, transformNode, "spread in object"));
 * }
 *
 * @example
 * // List form - Inline expression: {"a": 1, (... {"b": 2})}
 * if (isSpreadOperator(elem)) {
 *   properties.push(transformObjectSpreadOperator(elem, currentDir, transformNode, "spread in object"));
 * }
 */
export function transformObjectSpreadOperator(
  node: HQLNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
  context: string,
): IR.IRSpreadAssignment {
  const expression = transformSpreadArgument(node, currentDir, transformNode, context);

  return {
    type: IR.IRNodeType.SpreadAssignment,
    expression,
  } as IR.IRSpreadAssignment;
}
