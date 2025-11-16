// src/transpiler/syntax/primitive.ts
// Module for handling primitive operations (+, -, *, /, etc.)

import * as IR from "../type/hql_ir.ts";
import { HQLNode, ListNode, SymbolNode } from "../type/hql_ast.ts";
import {
  perform,
  TransformError,
  ValidationError,
} from "../../common/error.ts";
import { transformElements } from "../utils/validation-helpers.ts";
import {
  KERNEL_PRIMITIVES,
  PRIMITIVE_CLASS,
  PRIMITIVE_DATA_STRUCTURE,
  PRIMITIVE_OPS,
} from "../keyword/primitives.ts";

/**
 * Transform primitive operations (+, -, *, /, etc.).
 */
export function transformPrimitiveOp(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      const op = (list.elements[0] as SymbolNode).name;
      const args = transformElements(
        list.elements.slice(1),
        currentDir,
        transformNode,
        `${op} argument`,
        "Primitive op argument",
      );

      if (op === "+" || op === "-" || op === "*" || op === "/" || op === "%") {
        return transformArithmeticOp(op, args);
      }

      if (
        op === "=" ||
        op === "==" ||
        op === "eq?" ||
        op === "!=" ||
        op === ">" ||
        op === "<" ||
        op === ">=" ||
        op === "<="
      ) {
        return transformComparisonOp(op, args);
      }

      return {
        type: IR.IRNodeType.CallExpression,
        callee: { type: IR.IRNodeType.Identifier, name: op } as IR.IRIdentifier,
        arguments: args,
      } as IR.IRCallExpression;
    },
    "transformPrimitiveOp",
    TransformError,
    [list],
  );
}

/**
 * Transform arithmetic operations (+, -, *, /, %)
 */
export function transformArithmeticOp(
  op: string,
  args: IR.IRNode[],
): IR.IRNode {
  return perform(
    () => {
      if (args.length === 0) {
        throw new ValidationError(
          `${op} requires at least one argument`,
          `${op} operation`,
          "at least 1 argument",
          "0 arguments",
        );
      }

      if (args.length === 1 && (op === "+" || op === "-")) {
        return {
          type: IR.IRNodeType.UnaryExpression,
          operator: op,
          argument: args[0],
        } as IR.IRUnaryExpression;
      }

      if (args.length === 1) {
        const defaultValue = op === "*" || op === "/" ? 1 : 0;
        return {
          type: IR.IRNodeType.BinaryExpression,
          operator: op,
          left: args[0],
          right: {
            type: IR.IRNodeType.NumericLiteral,
            value: defaultValue,
          } as IR.IRNumericLiteral,
        } as IR.IRBinaryExpression;
      }

      let result = args[0];
      for (let i = 1; i < args.length; i++) {
        result = {
          type: IR.IRNodeType.BinaryExpression,
          operator: op,
          left: result,
          right: args[i],
        } as IR.IRBinaryExpression;
      }
      return result;
    },
    `transformArithmeticOp '${op}'`,
    TransformError,
    [op, args],
  );
}

/**
 * Transform comparison operations (=, !=, <, >, <=, >=)
 */
export function transformComparisonOp(
  op: string,
  args: IR.IRNode[],
): IR.IRNode {
  return perform(
    () => {
      if (args.length !== 2) {
        throw new ValidationError(
          `${op} requires exactly 2 arguments, got ${args.length}`,
          `${op} operation`,
          "2 arguments",
          `${args.length} arguments`,
        );
      }

      let jsOp: string;
      switch (op) {
        case "=":
        case "==":
        case "eq?":
          jsOp = "===";
          break;
        case "!=":
          jsOp = "!==";
          break;
        case ">":
        case "<":
        case ">=":
        case "<=":
          jsOp = op;
          break;
        default:
          jsOp = "===";
      }

      return {
        type: IR.IRNodeType.BinaryExpression,
        operator: jsOp,
        left: args[0],
        right: args[1],
      } as IR.IRBinaryExpression;
    },
    `transformComparisonOp '${op}'`,
    TransformError,
    [op, args],
  );
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
