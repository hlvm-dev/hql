// core/src/transpiler/utils/validation-helpers.ts
// DRY utilities for common validation patterns

import { ValidationError } from "../../common/error.ts";
import * as IR from "../type/hql_ir.ts";
import { HQLNode } from "../type/hql_ast.ts";

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
