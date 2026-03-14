// src/hql/transpiler/syntax/get.ts
// Module for handling get operations that replace the runtime get function

import * as IR from "../type/hql_ir.ts";
import type { HQLNode, ListNode } from "../type/hql_ast.ts";
import { copyPosition } from "../pipeline/hql-ast-to-hql-ir.ts";
import {
  validateTransformed,
  validateListLengthRange,
} from "../utils/validation-helpers.ts";
import { GET_HELPER } from "../../../common/runtime-helper-impl.ts";
import { createCall, createId } from "../utils/ir-helpers.ts";

/**
 * Transform collection 'get' operation to IR.
 * This is the entry point from hql-ast-to-hql-ir.ts
 */
export function transformGet(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  // get requires 2-3 arguments: collection, key, and optional default
  validateListLengthRange(list, 3, 4, "get", "operation");

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

  const result = createGetOperation(collection, index, defaultValue);
  copyPosition(list, result);
  return result;
}

/**
 * Create a special node to represent a get operation
 * This will be transformed into appropriate JavaScript during code generation
 */
function createGetOperation(
  collection: IR.IRNode,
  key: IR.IRNode,
  defaultValue: IR.IRNode | null = null,
): IR.IRNode {
  const args = defaultValue
    ? [collection, key, defaultValue]
    : [collection, key];
  return createCall(createId(GET_HELPER), args);
}

