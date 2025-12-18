// src/transpiler/syntax/data-structure.ts
// Module for handling data structure operations (vector, hash-map, etc.)

import * as IR from "../type/hql_ir.ts";
import type { HQLNode, ListNode } from "../type/hql_ast.ts";
import {
  perform,
  TransformError,
  ValidationError,
} from "../../common/error.ts";
import { createGetOperation, transformGet } from "./get.ts";
import {
  transformElements,
  validateTransformed,
  isSpreadOperator,
  transformSpreadOperator,
  transformObjectSpreadOperator,
} from "../utils/validation-helpers.ts";
import {
  normalizeVectorElements,
  type NormalizeVectorOptions,
} from "../../common/sexp-utils.ts";
import { HASH_MAP_INTERNAL } from "../../common/runtime-helper-impl.ts";

// Export the get function to make it available through the module
export { createGetOperation, transformGet };

/**
 * Extract SourcePosition from an HQL node's _meta field.
 * Used to propagate source location through IR transformations for accurate error reporting.
 */
function extractPosition(node: HQLNode): IR.SourcePosition | undefined {
  const meta = (node as unknown as { _meta?: { line: number; column: number; filePath?: string } })._meta;
  if (meta) {
    return { line: meta.line, column: meta.column, filePath: meta.filePath };
  }
  return undefined;
}

/**
 * Process elements in a vector, handling vector keyword and commas
 */
export function processVectorElements<T extends { type: string }>(
  elements: T[],
  options: NormalizeVectorOptions = {},
): T[] {
  return perform(
    () => normalizeVectorElements(elements, options),
    "processVectorElements",
    TransformError,
    [elements],
  );
}

/**
 * Transform vector literals
 */
export function transformVector(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      const elements: IR.IRNode[] = [];

      // Transform each element, detecting spread operators
      for (const elem of list.elements.slice(1)) {
        if (isSpreadOperator(elem)) {
          // Spread element: [...arr]
          elements.push(
            transformSpreadOperator(elem, currentDir, transformNode, "spread in array")
          );
        } else {
          // Regular element
          const transformed = validateTransformed(
            transformNode(elem, currentDir),
            "vector element",
            "Vector element",
          );
          elements.push(transformed);
        }
      }

      return {
        type: IR.IRNodeType.ArrayExpression,
        elements,
        position: extractPosition(list),
      } as IR.IRArrayExpression;
    },
    "transformVector",
    TransformError,
    [list],
  );
}

/**
 * Transform hash-map literals (object literals)
 * Example: (hash-map "a" 1 "b" 2) → {a: 1, b: 2}
 * With spread: (hash-map "a" 1 ...obj "b" 2) → {a: 1, ...obj, b: 2}
 */
export function transformHashMap(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      const args = list.elements.slice(1); // Skip "hash-map" symbol

      // Check if any arguments are spread operators
      const hasSpread = args.some(isSpreadOperator);

      // If no spread, use the standard runtime helper approach
      if (!hasSpread) {
        // Transform all arguments and create a call to __hql_hash_map
        const transformedArgs = args.map((arg) =>
          validateTransformed(
            transformNode(arg, currentDir),
            "hash-map argument",
            "Hash-map argument",
          )
        );

        return {
          type: IR.IRNodeType.CallExpression,
          callee: {
            type: IR.IRNodeType.Identifier,
            name: HASH_MAP_INTERNAL,
            isJS: false,
          } as IR.IRIdentifier,
          arguments: transformedArgs,
          position: extractPosition(list),
        } as IR.IRCallExpression;
      }

      // With spread operators, generate an ObjectExpression
      const properties: (IR.IRObjectProperty | IR.IRSpreadAssignment)[] = [];

      for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (isSpreadOperator(arg)) {
          // Spread property: {...obj}
          properties.push(
            transformObjectSpreadOperator(arg, currentDir, transformNode, "spread in object")
          );
        } else {
          // Regular key-value pair
          // Keys and values come in pairs: key1, value1, key2, value2, ...
          if (i + 1 >= args.length) {
            throw new ValidationError(
              "Hash-map requires key-value pairs",
              "incomplete pair",
              "key-value pair",
              "lone key",
            );
          }

          const key = validateTransformed(
            transformNode(arg, currentDir),
            "hash-map key",
            "Object key",
          );

          const value = validateTransformed(
            transformNode(args[i + 1], currentDir),
            "hash-map value",
            "Object value",
          );

          properties.push({
            type: IR.IRNodeType.ObjectProperty,
            key,
            value,
            computed: false,
          } as IR.IRObjectProperty);

          i++; // Skip the value since we've already processed it
        }
      }

      return {
        type: IR.IRNodeType.ObjectExpression,
        properties,
        position: extractPosition(list),
      } as IR.IRObjectExpression;
    },
    "transformHashMap",
    TransformError,
    [list],
  );
}

/**
 * Transform an empty list into an empty array expression.
 */
export function transformEmptyList(): IR.IRArrayExpression {
  return perform(
    () => {
      return {
        type: IR.IRNodeType.ArrayExpression,
        elements: [],
      } as IR.IRArrayExpression;
    },
    "transformEmptyList",
    TransformError,
  );
}

/**
 * Transform hash-set literals
 */
export function transformHashSet(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      const elements = transformElements(
        list.elements.slice(1),
        currentDir,
        transformNode,
        "hash-set element",
        "Set element",
      );

      return {
        type: IR.IRNodeType.NewExpression,
        callee: {
          type: IR.IRNodeType.Identifier,
          name: "Set",
        } as IR.IRIdentifier,
        arguments: [
          {
            type: IR.IRNodeType.ArrayExpression,
            elements,
          } as IR.IRArrayExpression,
        ],
      } as IR.IRNewExpression;
    },
    "transformHashSet",
    TransformError,
    [list],
  );
}

/**
 * Transform "new" constructor.
 */
export function transformNew(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      if (list.elements.length < 2) {
        throw new ValidationError(
          "'new' requires a constructor",
          "new constructor",
          "at least 1 argument",
          `${list.elements.length - 1} arguments`,
        );
      }

      const constructor = validateTransformed(
        transformNode(list.elements[1], currentDir),
        "new constructor",
        "Constructor",
      );

      const args = transformElements(
        list.elements.slice(2),
        currentDir,
        transformNode,
        "new constructor argument",
        "Constructor argument",
      );

      return {
        type: IR.IRNodeType.NewExpression,
        callee: constructor,
        arguments: args,
      } as IR.IRNewExpression;
    },
    "transformNew",
    TransformError,
    [list],
  );
}
