// src/hql/transpiler/utils/validation-helpers.ts
// DRY utilities for common validation patterns

import { ValidationError } from "../../../common/error.ts";
import * as IR from "../type/hql_ir.ts";
import type { HQLNode, SymbolNode, ListNode } from "../type/hql_ast.ts";

/**
 * Validate that a list has the expected number of elements.
 * This is a DRY helper that replaces ~40 identical validation patterns across syntax files.
 *
 * The expected count includes the operator (first element). So for `(fn x body)`:
 * - list.elements.length should be 3 (fn, x, body)
 * - expectedCount is 3
 * - argCount shown in error is 2 (elements after operator)
 *
 * @param list - The list to validate
 * @param expectedCount - Expected total elements (including operator)
 * @param operatorName - Name of the operator for error messages
 * @param context - Additional context for error (default: "expression")
 * @throws ValidationError if the count doesn't match
 *
 * @example
 * // For (quote expr) - expects exactly 2 elements
 * validateListLength(list, 2, "quote");
 *
 * @example
 * // For (if cond then else) - expects exactly 4 elements
 * validateListLength(list, 4, "if", "conditional");
 */
export function validateListLength(
  list: ListNode,
  expectedCount: number,
  operatorName: string,
  context: string = "expression",
): void {
  if (list.elements.length !== expectedCount) {
    const expectedArgs = expectedCount - 1;
    const actualArgs = list.elements.length - 1;
    throw new ValidationError(
      `${operatorName} requires exactly ${expectedArgs} argument${expectedArgs !== 1 ? "s" : ""}, got ${actualArgs}`,
      `${operatorName} ${context}`,
      `${expectedArgs} argument${expectedArgs !== 1 ? "s" : ""}`,
      `${actualArgs} argument${actualArgs !== 1 ? "s" : ""}`,
    );
  }
}

/**
 * Extract SourcePosition from an HQL node's _meta field.
 * Used to propagate source location through IR transformations for accurate error reporting.
 */
export function extractPosition(node: HQLNode): IR.SourcePosition | undefined {
  const meta = (node as unknown as { _meta?: { line: number; column: number; filePath?: string } })._meta;
  if (meta) {
    return { line: meta.line, column: meta.column, filePath: meta.filePath };
  }
  return undefined;
}

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

    // Create the argument symbol, preserving _meta from the original ...identifier symbol
    // This ensures proper source location tracking for error messages
    const argSymbol: SymbolNode = { type: "symbol", name: argName };
    const originalMeta = (node as unknown as { _meta?: { line: number; column: number; filePath?: string } })._meta;
    if (originalMeta) {
      (argSymbol as unknown as { _meta: { line: number; column: number; filePath?: string } })._meta = {
        ...originalMeta,
        column: originalMeta.column + 3 // Adjust column for "..." prefix
      };
    }

    argNode = transformNode(argSymbol, currentDir);
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
    position: extractPosition(node),
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
    position: extractPosition(node),
  } as IR.IRSpreadAssignment;
}


// =============================================================================
// ERROR FACTORY FUNCTIONS
// =============================================================================
// These factories consolidate ~140+ ValidationError throw patterns across syntax files
// into reusable, consistent one-liner calls.

/**
 * Create an arity error for wrong argument count.
 * 
 * @param operator - The operator/form name (e.g., "if", "let", "fn")
 * @param expected - Expected argument count or range (e.g., 2, "2+", "2-4")
 * @param actual - Actual argument count received
 * @param position - Optional source position for error location
 * @returns ValidationError with consistent formatting
 * 
 * @example
 * // Before (repeated 50+ times):
 * throw new ValidationError(
 *   `if requires at least 2 arguments, got ${args}`,
 *   "if expression",
 *   "2+ arguments",
 *   `${args} arguments`
 * );
 * 
 * // After:
 * throw arityError("if", "2+", args, position);
 */
export function arityError(
  operator: string,
  expected: number | string,
  actual: number,
  position?: IR.SourcePosition,
): ValidationError {
  const expectedStr = typeof expected === "number" 
    ? `exactly ${expected}` 
    : expected;
  return new ValidationError(
    `${operator} requires ${expectedStr} argument${expected === 1 ? "" : "s"}, got ${actual}`,
    `${operator} expression`,
    `${expectedStr} argument${expected === 1 ? "" : "s"}`,
    `${actual} argument${actual === 1 ? "" : "s"}`,
    position,
  );
}

/**
 * Create a type mismatch error.
 * 
 * @param context - Where the error occurred (e.g., "if condition", "let binding")
 * @param expected - What type was expected (e.g., "symbol", "list", "expression")
 * @param actual - What was actually received
 * @param position - Optional source position
 * @returns ValidationError with consistent formatting
 * 
 * @example
 * // Before:
 * throw new ValidationError(
 *   `Expected symbol for binding name, got ${node.type}`,
 *   "let binding",
 *   "symbol",
 *   node.type
 * );
 * 
 * // After:
 * throw typeError("let binding", "symbol", node.type, position);
 */
export function typeError(
  context: string,
  expected: string,
  actual: string,
  position?: IR.SourcePosition,
): ValidationError {
  return new ValidationError(
    `${context}: expected ${expected}, got ${actual}`,
    context,
    expected,
    actual,
    position,
  );
}

/**
 * Create a syntax error for invalid syntax structure.
 * 
 * @param context - Where the error occurred
 * @param message - Descriptive error message
 * @param position - Optional source position
 * @returns ValidationError
 * 
 * @example
 * throw syntaxError("class definition", "class name must be a symbol", position);
 */
export function syntaxError(
  context: string,
  message: string,
  position?: IR.SourcePosition,
): ValidationError {
  return new ValidationError(
    message,
    context,
    undefined,
    undefined,
    position,
  );
}

/**
 * Create an error for missing required element.
 * 
 * @param context - Where the error occurred
 * @param missing - What is missing
 * @param position - Optional source position
 * @returns ValidationError
 * 
 * @example
 * throw missingError("function definition", "function body", position);
 */
export function missingError(
  context: string,
  missing: string,
  position?: IR.SourcePosition,
): ValidationError {
  return new ValidationError(
    `${context}: missing ${missing}`,
    context,
    missing,
    "nothing",
    position,
  );
}

/**
 * Create an error for unsupported operation.
 * 
 * @param context - Where the error occurred
 * @param operation - What operation was attempted
 * @param position - Optional source position
 * @returns ValidationError
 * 
 * @example
 * throw unsupportedError("pattern matching", "nested spread patterns", position);
 */
export function unsupportedError(
  context: string,
  operation: string,
  position?: IR.SourcePosition,
): ValidationError {
  return new ValidationError(
    `${operation} is not supported in ${context}`,
    context,
    undefined,
    undefined,
    position,
  );
}

/**
 * Validate minimum list length (for variadic forms).
 * 
 * @param list - The list to validate
 * @param minCount - Minimum total elements (including operator)
 * @param operatorName - Name of the operator for error messages
 * @param context - Additional context (default: "expression")
 * @throws ValidationError if list is too short
 * 
 * @example
 * // For (do expr1 expr2 ...) - needs at least 2 elements (do + body)
 * validateMinListLength(list, 2, "do");
 */
export function validateMinListLength(
  list: ListNode,
  minCount: number,
  operatorName: string,
  context: string = "expression",
): void {
  if (list.elements.length < minCount) {
    const minArgs = minCount - 1;
    const actualArgs = list.elements.length - 1;
    throw new ValidationError(
      `${operatorName} requires at least ${minArgs} argument${minArgs !== 1 ? "s" : ""}, got ${actualArgs}`,
      `${operatorName} ${context}`,
      `${minArgs}+ argument${minArgs !== 1 ? "s" : ""}`,
      `${actualArgs} argument${actualArgs !== 1 ? "s" : ""}`,
    );
  }
}

/**
 * Validate list length is within a range.
 * 
 * @param list - The list to validate
 * @param minCount - Minimum total elements (including operator)
 * @param maxCount - Maximum total elements (including operator)
 * @param operatorName - Name of the operator for error messages
 * @param context - Additional context (default: "expression")
 * @throws ValidationError if list length is outside range
 * 
 * @example
 * // For (if test then [else]) - 3-4 elements
 * validateListLengthRange(list, 3, 4, "if", "conditional");
 */
export function validateListLengthRange(
  list: ListNode,
  minCount: number,
  maxCount: number,
  operatorName: string,
  context: string = "expression",
): void {
  if (list.elements.length < minCount || list.elements.length > maxCount) {
    const minArgs = minCount - 1;
    const maxArgs = maxCount - 1;
    const actualArgs = list.elements.length - 1;
    throw new ValidationError(
      `${operatorName} requires ${minArgs}-${maxArgs} arguments, got ${actualArgs}`,
      `${operatorName} ${context}`,
      `${minArgs}-${maxArgs} arguments`,
      `${actualArgs} argument${actualArgs !== 1 ? "s" : ""}`,
    );
  }
}

/**
 * Validate that a node is a symbol and return its name.
 * 
 * @param node - The node to validate
 * @param context - Context for error message
 * @param position - Optional source position
 * @returns The symbol name
 * @throws ValidationError if node is not a symbol
 * 
 * @example
 * const name = validateSymbol(nameNode, "function name", position);
 */
export function validateSymbol(
  node: HQLNode,
  context: string,
  position?: IR.SourcePosition,
): string {
  if (node.type !== "symbol") {
    throw typeError(context, "symbol", node.type, position);
  }
  return (node as SymbolNode).name;
}

/**
 * Validate that a node is a list and return it.
 * 
 * @param node - The node to validate
 * @param context - Context for error message
 * @param position - Optional source position
 * @returns The list node
 * @throws ValidationError if node is not a list
 * 
 * @example
 * const params = validateList(paramsNode, "function parameters", position);
 */
export function validateList(
  node: HQLNode,
  context: string,
  position?: IR.SourcePosition,
): ListNode {
  if (node.type !== "list") {
    throw typeError(context, "list", node.type, position);
  }
  return node as ListNode;
}
