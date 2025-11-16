// src/transpiler/syntax/data-structure.ts
// Module for handling data structure operations (vector, hash-map, etc.)

import * as IR from "../type/hql_ir.ts";
import { HQLNode, ListNode } from "../type/hql_ast.ts";
import {
  perform,
  TransformError,
  ValidationError,
} from "../../common/error.ts";
import { createGetOperation, transformGet } from "./get.ts";
import {
  transformElements,
  validateTransformed,
} from "../utils/validation-helpers.ts";
import {
  normalizeVectorElements,
  NormalizeVectorOptions,
} from "../../common/sexp-utils.ts";

// Export the get function to make it available through the module
export { createGetOperation, transformGet };

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
      const elements = transformElements(
        list.elements.slice(1),
        currentDir,
        transformNode,
        "vector element",
        "Vector element",
      );
      return {
        type: IR.IRNodeType.ArrayExpression,
        elements,
      } as IR.IRArrayExpression;
    },
    "transformVector",
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
