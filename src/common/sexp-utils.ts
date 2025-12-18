// core/src/common/sexp-utils.ts
// Shared helpers for working with S-expression style node arrays.

import { HASH_MAP_INTERNAL, HASH_MAP_USER } from "./runtime-helper-impl.ts";

interface BaseNode {
  type: string;
}

interface SymbolNodeLike extends BaseNode {
  type: "symbol";
  name: string;
}

interface LiteralNodeLike extends BaseNode {
  type: "literal";
  value: string;
}

function isSymbolNodeLike(node: BaseNode): node is SymbolNodeLike {
  return node.type === "symbol" &&
    typeof (node as { name?: unknown }).name === "string";
}

function isLiteralNodeLike(node: BaseNode): node is LiteralNodeLike {
  return node.type === "literal" &&
    typeof (node as { value?: unknown }).value === "string";
}

export interface NormalizeVectorOptions {
  /**
   * When true, handles `(js-call Array "of" ...)` wrappers produced by macro transformations.
   */
  allowJsArrayWrapper?: boolean;
}

/**
 * Removes wrapper entries (e.g. `vector`, `(js-call Array "of" ...)`) and stray commas
 * from an array of S-expression nodes while preserving ordering of the actual elements.
 */
export function normalizeVectorElements<T extends BaseNode>(
  elements: T[],
  options: NormalizeVectorOptions = {},
): T[] {
  let startIndex = 0;

  if (
    elements.length > 0 && isSymbolNodeLike(elements[0]) &&
    elements[0].name === "vector"
  ) {
    startIndex = 1;
  } else if (
    options.allowJsArrayWrapper &&
    elements.length > 3 &&
    isSymbolNodeLike(elements[0]) && elements[0].name === "js-call" &&
    isSymbolNodeLike(elements[1]) && elements[1].name === "Array" &&
    isLiteralNodeLike(elements[2]) && elements[2].value === "of"
  ) {
    startIndex = 3;
  }

  return elements.slice(startIndex).filter((elem) =>
    !(isSymbolNodeLike(elem) && elem.name === ",")
  );
}

/**
 * Interface for list-like nodes that have an elements array
 */
interface ListLike {
  elements: BaseNode[];
}

/**
 * Check if a node is a symbol with a specific name
 *
 * @param node - The node to check
 * @param name - The expected symbol name
 * @returns true if the node is a symbol with the given name
 *
 * @example
 * isSymbolWithName({type: "symbol", name: "vector"}, "vector") // → true
 * isSymbolWithName({type: "symbol", name: "list"}, "vector")   // → false
 */
export function isSymbolWithName(node: unknown, name: string): boolean {
  return (
    node !== null &&
    node !== undefined &&
    typeof node === "object" &&
    (node as BaseNode).type === "symbol" &&
    (node as SymbolNodeLike).name === name
  );
}

/**
 * Check if a list has a "vector" prefix
 *
 * @param list - A list-like node with elements array
 * @returns true if the first element is the symbol "vector"
 *
 * @example
 * hasVectorPrefix({elements: [{type: "symbol", name: "vector"}, ...]}) // → true
 * hasVectorPrefix({elements: [{type: "symbol", name: "list"}, ...]})   // → false
 * hasVectorPrefix({elements: []})                                      // → false
 */
export function hasVectorPrefix(list: ListLike): boolean {
  return list.elements.length > 0 &&
    isSymbolWithName(list.elements[0], "vector");
}

/**
 * Check if a list has a "hash-map" or "__hql_hash_map" prefix
 *
 * @param list - A list-like node with elements array
 * @returns true if the first element is the symbol "hash-map" or "__hql_hash_map"
 *
 * @example
 * hasHashMapPrefix({elements: [{type: "symbol", name: "hash-map"}, ...]})     // → true
 * hasHashMapPrefix({elements: [{type: "symbol", name: "__hql_hash_map"}, ...]}) // → true
 * hasHashMapPrefix({elements: [{type: "symbol", name: "vector"}, ...]})       // → false
 */
export function hasHashMapPrefix(list: ListLike): boolean {
  if (list.elements.length === 0) {
    return false;
  }
  const first = list.elements[0];
  return isSymbolWithName(first, HASH_MAP_USER) ||
    isSymbolWithName(first, HASH_MAP_INTERNAL);
}
