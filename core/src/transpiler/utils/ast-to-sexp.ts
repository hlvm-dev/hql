// core/src/transpiler/utils/ast-to-sexp.ts
// Convert AST nodes to S-expressions for pattern parsing

import type {
  HQLNode,
} from "../type/hql_ast.ts";
import {
  createList,
  createLiteral,
  createSymbol,
  type SExp,
} from "../../s-exp/types.ts";

/**
 * Convert an AST node to an S-expression.
 *
 * AST nodes and S-expressions have identical structure,
 * just with different type names. This function converts between them.
 *
 * @param node - The AST node to convert
 * @returns Equivalent S-expression
 *
 * @example
 * astToSExp({ type: "symbol", name: "x" })
 * // → { type: "symbol", name: "x" }
 *
 * @example
 * astToSExp({ type: "list", elements: [{ type: "symbol", name: "x" }] })
 * // → { type: "list", elements: [{ type: "symbol", name: "x" }] }
 */
export function astToSExp(node: HQLNode): SExp {
  if (node.type === "symbol") {
    return createSymbol(node.name);
  }

  if (node.type === "literal") {
    return createLiteral(node.value);
  }

  if (node.type === "list") {
    const elements = node.elements.map(astToSExp);
    return createList(...elements);
  }

  throw new Error(`Unknown AST node type: ${JSON.stringify(node)}`);
}
