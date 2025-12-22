// src/transpiler/syntax/quote.ts
// Module for handling quoting and unquoting operations

import * as IR from "../type/hql_ir.ts";
import type { HQLNode, ListNode, LiteralNode, SymbolNode } from "../type/hql_ast.ts";
import { TransformError, ValidationError } from "../../common/error.ts";
import { perform } from "../../common/error.ts";
import { validateTransformed, validateListLength } from "../utils/validation-helpers.ts";
import { isSymbolWithName } from "../../common/sexp-utils.ts";

/**
 * Transform a quoted expression.
 */
export function transformQuote(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      validateListLength(list, 2, "quote");

      const quoted = list.elements[1];
      if (quoted.type === "literal") {
        // Create the appropriate literal based on the type
        const value = (quoted as LiteralNode).value;
        if (value === null) {
          return { type: IR.IRNodeType.NullLiteral } as IR.IRNullLiteral;
        } else if (typeof value === "boolean") {
          return {
            type: IR.IRNodeType.BooleanLiteral,
            value,
          } as IR.IRBooleanLiteral;
        } else if (typeof value === "number") {
          return {
            type: IR.IRNodeType.NumericLiteral,
            value,
          } as IR.IRNumericLiteral;
        }
        return {
          type: IR.IRNodeType.StringLiteral,
          value: String(value),
        } as IR.IRStringLiteral;
      } else if (quoted.type === "symbol") {
        return {
          type: IR.IRNodeType.StringLiteral,
          value: (quoted as SymbolNode).name,
        } as IR.IRStringLiteral;
      } else if (quoted.type === "list") {
        if ((quoted as ListNode).elements.length === 0) {
          return {
            type: IR.IRNodeType.ArrayExpression,
            elements: [],
          } as IR.IRArrayExpression;
        }

        const elements: IR.IRNode[] = (quoted as ListNode).elements.map((
          elem,
        ) =>
          transformQuote(
            {
              type: "list",
              elements: [{ type: "symbol", name: "quote" }, elem],
            },
            currentDir,
            transformNode,
          )
        );
        return {
          type: IR.IRNodeType.ArrayExpression,
          elements,
        } as IR.IRArrayExpression;
      }

      throw new ValidationError(
        `Unsupported quoted expression: ${
          IR.IRNodeType[(quoted as IR.IRNode).type]
        }`,
        "quote",
        "literal, symbol, or list",
        IR.IRNodeType[(quoted as IR.IRNode).type],
      );
    },
    "transformQuote",
    TransformError,
    [list],
  );
}

/**
 * Transform quasiquoted expressions
 */
export function transformQuasiquote(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      validateListLength(list, 2, "quasiquote");

      const transformed = validateTransformed(
        buildQuasiquoteIR(
          list.elements[1],
          0, // BUG FIX: Start at depth 0 for nested quasiquote support
          currentDir,
          transformNode,
        ),
        "quasiquote",
        "Quasiquoted expression",
      );
      return transformed;
    },
    "transformQuasiquote",
    TransformError,
    [list],
  );
}

function buildQuasiquoteIR(
  node: HQLNode,
  depth: number, // BUG FIX: Added depth parameter for nested quasiquote support
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode | null {
  if (node.type === "list") {
    const list = node as ListNode;

    if (list.elements.length > 0) {
      const head = list.elements[0];

      // BUG FIX: Handle nested quasiquote
      if (isSymbolWithName(head, "quasiquote")) {
        validateListLength(list, 2, "quasiquote");
        // Process inner quasiquote at increased depth
        return buildQuasiquoteIR(
          list.elements[1],
          depth + 1,
          currentDir,
          transformNode,
        );
      }

      if (isSymbolWithName(head, "unquote")) {
        validateListLength(list, 2, "unquote");
        if (depth === 0) {
          // At depth 0, unquote evaluates/transforms the expression
          return transformNode(list.elements[1], currentDir);
        } else {
          // At depth > 0, process at depth-1
          // This handles both single unquote (depth 1) and nested unquotes (depth > 1)
          return buildQuasiquoteIR(
            list.elements[1],
            depth - 1,
            currentDir,
            transformNode,
          );
        }
      }

      if (isSymbolWithName(head, "unquote-splicing")) {
        if (depth > 0) {
          // At depth > 0, handle as nested unquote-splicing
          validateListLength(list, 2, "unquote-splicing");
          const innerProcessed = buildQuasiquoteIR(
            list.elements[1],
            depth - 1,
            currentDir,
            transformNode,
          );
          if (innerProcessed === null) {
            throw new ValidationError(
              "unquote-splicing expression resulted in null",
              "quasiquote",
              "valid expression",
              "null",
            );
          }
          return {
            type: IR.IRNodeType.ArrayExpression,
            elements: [
              {
                type: IR.IRNodeType.StringLiteral,
                value: "unquote-splicing",
              } as IR.IRStringLiteral,
              innerProcessed,
            ],
          } as IR.IRArrayExpression;
        }
        throw new ValidationError(
          "unquote-splicing may only appear within a list context",
          "quasiquote",
          "list element",
          "top-level",
        );
      }
    }

    const segments: IR.IRNode[] = [];
    let chunk: IR.IRNode[] = [];
    let hasSplice = false;

    const flushChunk = () => {
      if (chunk.length === 0) return;
      segments.push({
        type: IR.IRNodeType.ArrayExpression,
        elements: chunk,
      } as IR.IRArrayExpression);
      chunk = [];
    };

    for (const element of list.elements) {
      if (depth === 0 && isUnquoteSplicing(element)) {
        if ((element as ListNode).elements.length !== 2) {
          throw new ValidationError(
            "unquote-splicing requires exactly one argument",
            "quasiquote",
            "1 argument",
            `${(element as ListNode).elements.length - 1} arguments`,
          );
        }
        hasSplice = true;
        flushChunk();
        const spliced = validateTransformed(
          transformNode(
            (element as ListNode).elements[1],
            currentDir,
          ),
          "quasiquote",
          "Unquote-spliced expression",
        );
        segments.push(spliced);
      } else {
        const converted = validateTransformed(
          buildQuasiquoteIR(element, depth, currentDir, transformNode),
          "quasiquote",
          "Quasiquoted sub-expression",
        );
        chunk.push(converted);
      }
    }

    flushChunk();

    if (!hasSplice) {
      if (segments.length === 0) {
        return {
          type: IR.IRNodeType.ArrayExpression,
          elements: [],
        } as IR.IRArrayExpression;
      }
      return segments[0];
    }

    if (
      segments.length === 0 ||
      segments[0].type !== IR.IRNodeType.ArrayExpression
    ) {
      segments.unshift({
        type: IR.IRNodeType.ArrayExpression,
        elements: [],
      } as IR.IRArrayExpression);
    }

    const baseArray = segments.shift()!;
    return {
      type: IR.IRNodeType.CallExpression,
      callee: {
        type: IR.IRNodeType.MemberExpression,
        object: baseArray,
        property: {
          type: IR.IRNodeType.Identifier,
          name: "concat",
        } as IR.IRIdentifier,
        computed: false,
      } as IR.IRMemberExpression,
      arguments: segments,
    } as IR.IRCallExpression;
  }

  return quoteAtom(node, currentDir, transformNode);
}

function quoteAtom(
  node: HQLNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode | null {
  const quoteForm: ListNode = {
    type: "list",
    elements: [
      { type: "symbol", name: "quote" },
      node,
    ],
  };
  return transformQuote(quoteForm, currentDir, transformNode);
}

function isUnquoteSplicing(node: HQLNode): node is ListNode {
  if (node.type !== "list") return false;
  const list = node as ListNode;
  if (list.elements.length === 0) return false;
  return isSymbolWithName(list.elements[0], "unquote-splicing");
}

/**
 * Transform unquote expressions
 */
export function transformUnquote(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      validateListLength(list, 2, "unquote");

      const transformed = validateTransformed(
        transformNode(list.elements[1], currentDir),
        "unquote",
        "Unquoted expression",
      );
      return transformed;
    },
    "transformUnquote",
    TransformError,
    [list],
  );
}

/**
 * Transform unquote-splicing expressions
 */
export function transformUnquoteSplicing(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      validateListLength(list, 2, "unquote-splicing");

      const transformed = validateTransformed(
        transformNode(list.elements[1], currentDir),
        "unquote-splicing",
        "Unquote-spliced expression",
      );
      return transformed;
    },
    "transformUnquoteSplicing",
    TransformError,
    [list],
  );
}
