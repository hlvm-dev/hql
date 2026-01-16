// src/hql/transpiler/syntax/get.ts
// Module for handling get operations that replace the runtime get function

import * as IR from "../type/hql_ir.ts";
import type { HQLNode, ListNode } from "../type/hql_ast.ts";
import {
  perform,
  TransformError,
  ValidationError,
} from "../../../common/error.ts";
import { validateTransformed } from "../utils/validation-helpers.ts";
import { GET_HELPER } from "../../../common/runtime-helper-impl.ts";

/**
 * Transform collection 'get' operation to IR.
 * This is the entry point from hql-ast-to-hql-ir.ts
 */
export function transformGet(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      if (list.elements.length < 3 || list.elements.length > 4) {
        throw new ValidationError(
          "get operation requires a collection, key, and optional default",
          "get operation",
          "2 or 3 arguments",
          `${list.elements.length - 1} arguments`,
        );
      }

      const collection = validateTransformed(
        transformNode(list.elements[1], currentDir),
        "get operation",
        "Collection",
      );

      const index = validateTransformed(
        transformNode(list.elements[2], currentDir),
        "get operation",
        "Index",
      );

      const defaultValue = list.elements.length === 4
        ? transformNode(list.elements[3], currentDir)
        : null;

      return createGetOperation(collection, index, defaultValue);
    },
    "transformGet",
    TransformError,
    [list],
  );
}

/**
 * Create a special node to represent a get operation
 * This will be transformed into appropriate JavaScript during code generation
 */
export function createGetOperation(
  collection: IR.IRNode,
  key: IR.IRNode,
  defaultValue: IR.IRNode | null = null,
): IR.IRNode {
  const args = defaultValue
    ? [collection, key, defaultValue]
    : [collection, key];
  return {
    type: IR.IRNodeType.CallExpression,
    callee: {
      type: IR.IRNodeType.Identifier,
      name: GET_HELPER,
    } as IR.IRIdentifier,
    arguments: args,
  } as IR.IRCallExpression;
}

/**
 * Convert a get() call directly to property access or function call
 * This simplifies the approach by analyzing the object and key at compile time
 * when possible, and falling back to runtime checks when needed
 */
/**
 * Convert a getNumeric() call to a runtime helper that tries array access first, then function call
 * This resolves the ambiguity between array indexing and function calls at runtime
 */
