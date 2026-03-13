// src/hql/transpiler/syntax/primitive.ts
// Module for handling primitive operations (+, -, *, /, etc.)

import * as IR from "../type/hql_ir.ts";
import type { HQLNode, ListNode, SymbolNode } from "../type/hql_ast.ts";
import {
  ValidationError,
} from "../../../common/error.ts";
import { sanitizeIdentifier } from "../../../common/utils.ts";
import { copyPosition } from "../pipeline/hql-ast-to-hql-ir.ts";
import {
  arityError,
  transformElements,
  validateListLength,
} from "../utils/validation-helpers.ts";
import {
  ARITHMETIC_OPS_SET,
  BITWISE_OPS_SET,
  COMPARISON_OPS_SET,
  COMPOUND_ASSIGN_OPS_SET,
  KERNEL_PRIMITIVES,
  LOGICAL_OPS_SET,
  PRIMITIVE_CLASS,
  PRIMITIVE_DATA_STRUCTURE,
  PRIMITIVE_OPS,
  JS_LITERAL_KEYWORDS_SET,
  TYPE_OPS_SET,
} from "../keyword/primitives.ts";
import { createId, createCall, createNum, createMember } from "../utils/ir-helpers.ts";
import { NUMERIC_PATTERN } from "../constants/index.ts";

// ============================================================================
// Shared IR node constructors (DRY: used by all operator transforms)
// ============================================================================

function makeBinaryExpr(op: string, left: IR.IRNode, right: IR.IRNode): IR.IRBinaryExpression {
  return { type: IR.IRNodeType.BinaryExpression, operator: op, left, right } as IR.IRBinaryExpression;
}

function makeUnaryExpr(op: string, argument: IR.IRNode): IR.IRUnaryExpression {
  return { type: IR.IRNodeType.UnaryExpression, operator: op, argument } as IR.IRUnaryExpression;
}

function chainBinaryExprs(op: string, args: IR.IRNode[]): IR.IRNode {
  let result = args[0];
  for (let i = 1; i < args.length; i++) {
    result = makeBinaryExpr(op, result, args[i]);
  }
  return result;
}

// ============================================================================
// Shared helpers (DRY: extracted from 3 near-identical assignment transforms)
// ============================================================================

/**
 * Build a member expression from a dot-notation symbol like "obj.prop" or "obj.a.b".
 * Handles numeric indices (array.0) and standard identifier properties.
 */
function buildMemberFromProperty(object: IR.IRNode, propStr: string): IR.IRMemberExpression {
  if (NUMERIC_PATTERN.test(propStr)) {
    return createMember(object, createNum(parseInt(propStr, 10)), true);
  }
  return createMember(object, createId(sanitizeIdentifier(propStr)));
}

/**
 * Build a member expression chain from dot-notation parts.
 * @param parts - split parts of the dot notation (e.g., ["obj", "a", "b"])
 * @param mapSelfToThis - if true, maps "self" base to "this" (used by = operator)
 */
function buildDotNotationMember(parts: string[], mapSelfToThis: boolean): IR.IRMemberExpression {
  const baseName = mapSelfToThis && parts[0] === "self"
    ? "this"
    : sanitizeIdentifier(parts[0]);

  let memberExpr = buildMemberFromProperty(createId(baseName), parts[1]);
  for (let i = 2; i < parts.length; i++) {
    memberExpr = buildMemberFromProperty(memberExpr, parts[i]);
  }
  return memberExpr;
}

interface AssignmentTargetOptions {
  /** Map "self" to "this" in dot notation base (only = operator) */
  mapSelfToThis?: boolean;
  /** Require list targets to be MemberExpression/OptionalMemberExpression */
  requireMemberExpr?: boolean;
}

/**
 * Resolve a symbol or list node into a valid assignment target (lvalue).
 * Used by =, +=, -=, ??=, &&=, ||= and all other assignment operators.
 */
function resolveAssignmentTarget(
  targetNode: HQLNode,
  operator: string,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
  options: AssignmentTargetOptions = {},
): IR.IRNode {
  if (targetNode.type === "symbol") {
    const symbolName = (targetNode as SymbolNode).name;

    if (symbolName.includes(".") && !symbolName.startsWith(".")) {
      return buildDotNotationMember(symbolName.split("."), options.mapSelfToThis === true);
    }

    return createId(sanitizeIdentifier(symbolName));
  }

  if (targetNode.type === "list") {
    const transformed = transformNode(targetNode, currentDir);
    if (!transformed) {
      throw new ValidationError(
        `${operator} target must be a valid lvalue`,
        operator,
        "symbol or member expression",
        targetNode.type,
      );
    }
    if (
      options.requireMemberExpr &&
      transformed.type !== IR.IRNodeType.MemberExpression &&
      transformed.type !== IR.IRNodeType.OptionalMemberExpression
    ) {
      throw new ValidationError(
        `${operator} target must be a valid lvalue`,
        operator,
        "identifier or member expression",
        targetNode.type,
      );
    }
    return transformed;
  }

  throw new ValidationError(
    `${operator} target must be a symbol or member expression`,
    operator,
    "symbol or member expression",
    targetNode.type,
  );
}

// ============================================================================
// Main dispatch
// ============================================================================

/**
 * Transform primitive operations (+, -, *, /, etc.).
 */
export function transformPrimitiveOp(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  const op = (list.elements[0] as SymbolNode).name;

  // Handle "=" operator: can be assignment OR equality comparison
  // - Assignment: (= x 10) where x is a symbol or member expression
  // - Equality: (= 1 1) or (= (+ 1 2) 3) where first arg is a literal/expression
  if (op === "=") {
    return transformEqualsOperator(list, currentDir, transformNode);
  }

  // Handle all assignment operators (logical: ??=, &&=, ||= and compound: +=, -=, etc.)
  if (op === "??=" || op === "&&=" || op === "||=" || COMPOUND_ASSIGN_OPS_SET.has(op)) {
    return transformCompoundAssignment(list, currentDir, transformNode, op);
  }

  const args = transformElements(
    list.elements.slice(1),
    currentDir,
    transformNode,
    `${op} argument`,
    "Primitive op argument",
  );

  let result: IR.IRNode;

  // O(1) Set-based dispatch instead of chained string equality checks
  if (ARITHMETIC_OPS_SET.has(op)) {
    result = transformArithmeticOp(op, args);
  } else if (COMPARISON_OPS_SET.has(op)) {
    result = transformComparisonOp(op, args);
  } else if (LOGICAL_OPS_SET.has(op)) {
    result = transformLogicalOp(op, args);
  } else if (BITWISE_OPS_SET.has(op)) {
    result = transformBitwiseOp(op, args);
  } else if (TYPE_OPS_SET.has(op)) {
    result = transformTypeOp(op, args);
  } else {
    result = createCall(createId(op), args);
  }

  copyPosition(list, result);
  return result;
}

/**
 * Transform arithmetic operations (+, -, *, /, %)
 */
function transformArithmeticOp(
  op: string,
  args: IR.IRNode[],
): IR.IRNode {
  if (args.length === 0) {
    throw arityError(op, "at least 1", 0);
  }

  if (args.length === 1 && (op === "+" || op === "-")) {
    return makeUnaryExpr(op, args[0]);
  }

  if (args.length === 1) {
    const defaultValue = op === "*" || op === "/" ? 1 : 0;
    return makeBinaryExpr(op, args[0], createNum(defaultValue));
  }

  return chainBinaryExprs(op, args);
}

/**
 * Transform comparison operations (===, ==, !==, !=, <, >, <=, >=).
 * All HQL comparison operators map directly to their JS equivalents.
 */
function transformComparisonOp(
  op: string,
  args: IR.IRNode[],
): IR.IRNode {
  if (args.length !== 2) {
    throw arityError(op, 2, args.length);
  }
  return makeBinaryExpr(op, args[0], args[1]);
}

/**
 * Transform bitwise operations (&, |, ^, ~, <<, >>, >>>).
 */
function transformBitwiseOp(
  op: string,
  args: IR.IRNode[],
): IR.IRNode {
  if (op === "~") {
    if (args.length !== 1) {
      throw arityError("~", 1, args.length);
    }
    return makeUnaryExpr("~", args[0]);
  }

  if (args.length !== 2) {
    throw arityError(op, 2, args.length);
  }
  return makeBinaryExpr(op, args[0], args[1]);
}

/**
 * Transform type operations (typeof, instanceof, in, delete, void).
 */
function transformTypeOp(
  op: string,
  args: IR.IRNode[],
): IR.IRNode {
  if (op === "typeof" || op === "delete" || op === "void") {
    if (args.length !== 1) {
      throw arityError(op, 1, args.length);
    }

    let argument = args[0];

    // CRITICAL: delete operator needs raw member expression, not safe-access wrapper
    // Convert InteropIIFE (safe property access) to MemberExpression for delete
    if (op === "delete" && argument.type === IR.IRNodeType.InteropIIFE) {
      const interopNode = argument as IR.IRInteropIIFE;
      argument = createMember(interopNode.object, interopNode.property, true);
    }

    return makeUnaryExpr(op, argument);
  }

  if (op === "instanceof" || op === "in") {
    if (args.length !== 2) {
      throw arityError(op, 2, args.length);
    }
    return makeBinaryExpr(op, args[0], args[1]);
  }

  throw new ValidationError(
    `Unknown type operator: ${op}`,
    "type operator",
    "one of: typeof, instanceof, in, delete, void",
    op,
  );
}

/**
 * Transform logical operations (&&, ||, !, ??).
 * These operators use short-circuit evaluation.
 */
function transformLogicalOp(
  op: string,
  args: IR.IRNode[],
): IR.IRNode {
  if (op === "!") {
    if (args.length !== 1) {
      throw arityError("!", 1, args.length);
    }
    return makeUnaryExpr("!", args[0]);
  }

  if (args.length < 2) {
    throw arityError(op, "at least 2", args.length);
  }

  let result = args[0];
  for (let i = 1; i < args.length; i++) {
    result = {
      type: IR.IRNodeType.LogicalExpression,
      operator: op as "&&" | "||" | "??",
      left: result,
      right: args[i],
    } as IR.IRLogicalExpression;
  }

  return result;
}

/**
 * "=" is ALWAYS assignment (following JavaScript semantics).
 *
 * Valid assignment targets:
 *   - Symbol (variable): (= x 10) → x = 10
 *   - Member expression: (= (. obj prop) 10) → obj.prop = 10
 *   - Dot notation symbol: (= obj.prop 10) → obj.prop = 10
 *
 * Invalid (error):
 *   - Literal: (= 5 10) → Error (use === for comparison)
 *   - Expression: (= (+ 1 2) 10) → Error (use === for comparison)
 *
 * For comparisons, use:
 *   - (=== a b) for strict equality
 *   - (== a b) for loose equality
 */
function transformEqualsOperator(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  if (list.elements.length < 3) {
    throw arityError("=", "at least 2", list.elements.length - 1);
  }

  const firstArg = list.elements[1];

  // Literal as first arg - ERROR (can't assign to literal)
  if (firstArg.type === "literal") {
    throw new ValidationError(
      `Cannot assign to a literal value. Use === for comparison.`,
      "= operator",
      "assignable target (variable or member expression)",
      "literal value",
    );
  }

  // Symbol as first arg - ASSIGNMENT
  if (firstArg.type === "symbol") {
    const symbolName = (firstArg as SymbolNode).name;

    // Special literal symbols - ERROR (can't assign to null/undefined/true/false)
    // O(1) Set lookup instead of O(n) array scan
    if (JS_LITERAL_KEYWORDS_SET.has(symbolName)) {
      throw new ValidationError(
        `Cannot assign to '${symbolName}'. Use === for comparison.`,
        "= operator",
        "assignable target (variable or member expression)",
        `'${symbolName}' literal`,
      );
    }

    // Reject optional chaining in assignment target
    if (symbolName.includes("?.")) {
      throw new ValidationError(
        `Cannot assign to optional chain expression '${symbolName}'. Optional chaining is read-only.`,
        "= operator",
        "assignable target (variable or member expression)",
        "optional chain expression",
      );
    }

    // All other symbols (including dot notation like obj.prop) - ASSIGNMENT
    return transformAssignment(list, currentDir, transformNode);
  }

  // List as first arg - could be member expression or expression
  if (firstArg.type === "list") {
    const innerList = firstArg as ListNode;

    // Member expression pattern (. obj prop) - ASSIGNMENT
    if (
      innerList.elements.length >= 2 &&
      innerList.elements[0].type === "symbol" &&
      (innerList.elements[0] as SymbolNode).name === "."
    ) {
      return transformAssignment(list, currentDir, transformNode);
    }

    // Other expressions - ERROR (can't assign to expression result)
    throw new ValidationError(
      `Cannot assign to an expression result. Use === for comparison.`,
      "= operator",
      "assignable target (variable or member expression)",
      "expression",
    );
  }

  // Any other type - ERROR (should be unreachable, but handle defensively)
  throw new ValidationError(
    `Invalid assignment target. Use === for comparison.`,
    "= operator",
    "assignable target (variable or member expression)",
    "unknown type",
  );
}

/**
 * Transform assignment operation (=).
 * Handles: (= target value)
 * Compiles to: target = value
 */
function transformAssignment(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  validateListLength(list, 3, "=", "assignment expression");

  const targetNode = list.elements[1];
  const valueNode = list.elements[2];

  const target = resolveAssignmentTarget(targetNode, "=", currentDir, transformNode, { mapSelfToThis: true });

  const args = transformElements(
    [valueNode],
    currentDir,
    transformNode,
    "assignment value",
    "Assignment value",
  );

  if (args.length === 0 || !args[0]) {
    throw new ValidationError(
      "Assignment value is required",
      "assignment value",
      "valid expression",
      "null",
    );
  }

  // Create an assignment expression
  const result = {
    type: IR.IRNodeType.AssignmentExpression,
    operator: "=",
    left: target,
    right: args[0],
  } as IR.IRAssignmentExpression;
  copyPosition(list, result);
  return result;
}

/**
 * Transform compound assignment operators (+=, -=, *=, /=, %=, **=, &=, |=, ^=, <<=, >>=, >>>=)
 *
 * Syntax: (operator target value)
 * Examples:
 *   (+= x 10) → x += 10
 *   (*= arr.0 2) → arr[0] *= 2
 *   (**= base 2) → base **= 2
 */
function transformCompoundAssignment(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
  operator: string,
): IR.IRNode {
  validateListLength(list, 3, operator, "compound assignment expression");

  const targetNode = list.elements[1];
  const valueNode = list.elements[2];

  const target = resolveAssignmentTarget(targetNode, operator, currentDir, transformNode, { requireMemberExpr: true });

  const value = transformNode(valueNode, currentDir);
  if (!value) {
    throw new ValidationError(
      `${operator} value cannot be null`,
      operator,
      "expression",
      "null",
    );
  }

  const result = {
    type: IR.IRNodeType.AssignmentExpression,
    operator,
    left: target,
    right: value,
  } as IR.IRAssignmentExpression;
  copyPosition(list, result);
  return result;
}

/**
 * Check if a primitive operation is supported
 */
export function isPrimitiveOp(symbolName: string): boolean {
  return PRIMITIVE_OPS.has(symbolName);
}

/**
 * Check if a kernel primitive is supported
 */
export function isKernelPrimitive(symbolName: string): boolean {
  return KERNEL_PRIMITIVES.has(symbolName);
}

/**
 * Check if a primitive data structure is supported
 */
export function isPrimitiveDataStructure(symbolName: string): boolean {
  return PRIMITIVE_DATA_STRUCTURE.has(symbolName);
}

/**
 * Check if a primitive class is supported
 */
export function isPrimitiveClass(symbolName: string): boolean {
  return PRIMITIVE_CLASS.has(symbolName);
}
