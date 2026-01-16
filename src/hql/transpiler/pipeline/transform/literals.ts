/**
 * Literal Value Transformations
 *
 * This module handles:
 * - Primitive literals (null, boolean, number, string)
 * - Template literals with interpolation
 */

import * as IR from "../../type/hql_ir.ts";
import type { HQLNode, ListNode, LiteralNode } from "../../type/hql_ast.ts";
import {
  perform,
  TransformError,
} from "../../../../common/error.ts";

// Type for transform node function passed from main module
export type TransformNodeFn = (node: HQLNode, dir: string) => IR.IRNode | null;

/**
 * Transform a literal node to its IR representation.
 */
export function transformLiteral(lit: LiteralNode): IR.IRNode {
  return perform(
    () => {
      const value = lit.value;

      if (value === null) {
        return { type: IR.IRNodeType.NullLiteral } as IR.IRNullLiteral;
      }

      if (typeof value === "boolean") {
        return {
          type: IR.IRNodeType.BooleanLiteral,
          value,
        } as IR.IRBooleanLiteral;
      }

      if (typeof value === "number") {
        return {
          type: IR.IRNodeType.NumericLiteral,
          value,
        } as IR.IRNumericLiteral;
      }

      return {
        type: IR.IRNodeType.StringLiteral,
        value: String(value),
      } as IR.IRStringLiteral;
    },
    "transformLiteral",
    TransformError,
    [lit],
  );
}

/**
 * Transform a template literal (template-literal "str1" expr1 "str2" ...)
 * Parser produces: (template-literal <string-parts-and-expressions>)
 */
export function transformTemplateLiteral(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRNode {
  return perform(
    () => {
      // list.elements[0] is the "template-literal" symbol
      // Rest are alternating string literals and expressions
      const parts = list.elements.slice(1);

      if (parts.length === 0) {
        // Empty template literal
        return { type: IR.IRNodeType.StringLiteral, value: "" } as IR.IRStringLiteral;
      }

      const quasis: IR.IRNode[] = [];
      const expressions: IR.IRNode[] = [];

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const transformed = transformNode(part, currentDir);
        if (!transformed) continue;

        // Strings go to quasis, everything else is an expression
        if (part.type === "literal" && typeof (part as LiteralNode).value === "string") {
          quasis.push(transformed);
        } else {
          // Before adding an expression, ensure we have a quasi
          if (quasis.length === expressions.length) {
            // Add empty string quasi
            quasis.push({ type: IR.IRNodeType.StringLiteral, value: "" } as IR.IRStringLiteral);
          }
          expressions.push(transformed);
        }
      }

      // Ensure we have one more quasi than expressions (JS template literal requirement)
      if (quasis.length === expressions.length) {
        quasis.push({ type: IR.IRNodeType.StringLiteral, value: "" } as IR.IRStringLiteral);
      }

      return {
        type: IR.IRNodeType.TemplateLiteral,
        quasis,
        expressions,
      } as IR.IRTemplateLiteral;
    },
    "transformTemplateLiteral",
    TransformError,
    [list],
  );
}
