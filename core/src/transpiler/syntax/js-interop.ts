// src/transpiler/syntax/js-interop.ts
// Module for handling JavaScript interop operations

import * as IR from "../type/hql_ir.ts";
import { HQLNode, ListNode, LiteralNode, SymbolNode } from "../type/hql_ast.ts";
import {
  perform,
  TransformError,
  ValidationError,
} from "../../common/error.ts";
import {
  transformElements,
  validateTransformed,
  isSpreadOperator,
  transformSpreadOperator,
} from "../utils/validation-helpers.ts";

const IDENTIFIER_REGEX = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Transform arguments, handling spread operators.
 * Similar to array/function spread handling but for method calls.
 */
function transformArgumentsWithSpread(
  args: HQLNode[],
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode[] {
  const result: IR.IRNode[] = [];

  for (const arg of args) {
    if (isSpreadOperator(arg)) {
      result.push(transformSpreadOperator(arg, currentDir, transformNode, "spread in method call"));
    } else {
      const transformed = validateTransformed(
        transformNode(arg, currentDir),
        "method argument",
        "Method argument",
      );
      result.push(transformed);
    }
  }

  return result;
}

function getLiteralString(node: HQLNode): string | null {
  if (node.type === "literal") {
    return String((node as LiteralNode).value);
  }

  if (node.type === "list") {
    const theList = node as ListNode;
    if (
      theList.elements.length === 2 &&
      theList.elements[0].type === "symbol" &&
      (theList.elements[0] as SymbolNode).name === "quote" &&
      theList.elements[1].type === "literal"
    ) {
      return String((theList.elements[1] as LiteralNode).value);
    }
  }

  return null;
}

function resolveMemberProperty(
  property: IR.IRNode,
): { property: IR.IRNode; computed: boolean } {
  if (property.type === IR.IRNodeType.Identifier) {
    return { property, computed: false };
  }

  if (property.type === IR.IRNodeType.StringLiteral) {
    const keyValue = (property as IR.IRStringLiteral).value;
    if (IDENTIFIER_REGEX.test(keyValue)) {
      return {
        property: {
          type: IR.IRNodeType.Identifier,
          name: keyValue,
        } as IR.IRIdentifier,
        computed: false,
      };
    }
  }

  return { property, computed: true };
}

export function extractSymbolOrLiteralName(
  node: HQLNode,
  context: string,
  errorMessage: string,
): string {
  if (node.type === "symbol") {
    return (node as SymbolNode).name;
  }

  const literalValue = getLiteralString(node);
  if (literalValue !== null) {
    return literalValue;
  }

  throw new ValidationError(
    errorMessage,
    context,
    "string literal or symbol",
    node.type,
  );
}

/**
 * Transform JavaScript "new" expressions
 */
export function transformJsNew(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      if (list.elements.length < 2) {
        throw new ValidationError(
          "js-new requires a constructor and optional arguments",
          "js-new",
          "at least 1 argument",
          `${list.elements.length - 1} arguments`,
        );
      }

      const constructor = validateTransformed(
        transformNode(list.elements[1], currentDir),
        "js-new",
        "Constructor",
      );

      let args: IR.IRNode[] = [];
      if (list.elements.length > 2) {
        const argsNode = list.elements[2];
        if (argsNode.type !== "list") {
          throw new ValidationError(
            "js-new arguments must be a list",
            "js-new",
            "list",
            argsNode.type,
          );
        }
        args = transformElements(
          (argsNode as ListNode).elements,
          currentDir,
          transformNode,
          "js-new argument",
          "Argument",
        );
      }

      return {
        type: IR.IRNodeType.NewExpression,
        callee: constructor,
        arguments: args,
      } as IR.IRNewExpression;
    },
    "transformJsNew",
    TransformError,
    [list],
  );
}

/**
 * Transform JavaScript property access
 */
export function transformJsGet(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      if (list.elements.length !== 3) {
        throw new ValidationError(
          `js-get requires exactly 2 arguments, got ${
            list.elements.length - 1
          }`,
          "js-get",
          "2 arguments",
          `${list.elements.length - 1} arguments`,
        );
      }

      const object = validateTransformed(
        transformNode(list.elements[1], currentDir),
        "js-get",
        "Object",
      );

      const literalProperty = getLiteralString(list.elements[2]);
      if (literalProperty !== null) {
        const literalNode = {
          type: IR.IRNodeType.StringLiteral,
          value: literalProperty,
        } as IR.IRStringLiteral;
        const { property, computed } = resolveMemberProperty(literalNode);
        return {
          type: IR.IRNodeType.MemberExpression,
          object,
          property,
          computed,
        } as IR.IRMemberExpression;
      }

      const propExpr = validateTransformed(
        transformNode(list.elements[2], currentDir),
        "js-get",
        "Property",
      );
      const { property, computed } = resolveMemberProperty(propExpr);
      return {
        type: IR.IRNodeType.MemberExpression,
        object,
        property,
        computed,
      } as IR.IRMemberExpression;
    },
    "transformJsGet",
    TransformError,
    [list],
  );
}

/**
 * Transform JavaScript method calls
 */
export function transformJsCall(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      if (list.elements.length < 2) {
        throw new ValidationError(
          `js-call requires at least 1 argument, got ${
            list.elements.length - 1
          }`,
          "js-call",
          "at least 1 argument",
          `${list.elements.length - 1} arguments`,
        );
      }

      const firstArg = validateTransformed(
        transformNode(list.elements[1], currentDir),
        "js-call",
        "Function or object",
      );

      // Check if element 2 is a literal string (method name)
      // If so: (js-call obj "method" args...) -> obj.method(args...)
      // If not: (js-call func args...) -> func(args...)
      const literalMethod = list.elements[2] ? getLiteralString(list.elements[2]) : null;

      if (literalMethod !== null) {
        // Method call: (js-call obj "method" args...)
        const args = transformArgumentsWithSpread(
          list.elements.slice(3),
          currentDir,
          transformNode,
        );

        const literalNode = {
          type: IR.IRNodeType.StringLiteral,
          value: literalMethod,
        } as IR.IRStringLiteral;
        const { property, computed } = resolveMemberProperty(literalNode);
        return {
          type: IR.IRNodeType.CallExpression,
          callee: {
            type: IR.IRNodeType.MemberExpression,
            object: firstArg,
            property,
            computed,
          },
          arguments: args,
        };
      }

      // Direct function call: (js-call func args...)
      const args = transformArgumentsWithSpread(
        list.elements.slice(2),
        currentDir,
        transformNode,
      );

      return {
        type: IR.IRNodeType.CallExpression,
        callee: firstArg,
        arguments: args,
      };
    },
    "transformJsCall",
    TransformError,
    [list],
  );
}

/**
 * Transform JavaScript property setting
 */
export function transformJsSet(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      if (list.elements.length !== 4) {
        throw new ValidationError(
          "js-set requires exactly 3 arguments: object, key, and value",
          "js-set",
          "3 arguments",
          `${list.elements.length - 1} arguments`,
        );
      }

      const object = validateTransformed(
        transformNode(list.elements[1], currentDir),
        "js-set",
        "Object",
      );
      const key = validateTransformed(
        transformNode(list.elements[2], currentDir),
        "js-set",
        "Key",
      );
      const value = validateTransformed(
        transformNode(list.elements[3], currentDir),
        "js-set",
        "Value",
      );
      const { property, computed } = resolveMemberProperty(key);

      // Create a property assignment directly, not a function call
      return {
        type: IR.IRNodeType.AssignmentExpression,
        operator: "=",
        left: {
          type: IR.IRNodeType.MemberExpression,
          object,
          property,
          computed,
        },
        right: value,
      };
    },
    "transformJsSet",
    TransformError,
    [list],
  );
}

/**
 * Transform JavaScript property access with optional invocation
 */
export function transformJsGetInvoke(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      if (list.elements.length !== 3) {
        throw new ValidationError(
          `js-get-invoke requires exactly 2 arguments, got ${
            list.elements.length - 1
          }`,
          "js-get-invoke",
          "2 arguments",
          `${list.elements.length - 1} arguments`,
        );
      }

      const object = validateTransformed(
        transformNode(list.elements[1], currentDir),
        "js-get-invoke",
        "Object",
      );

      // Get the property name
      const propertyName = extractSymbolOrLiteralName(
        list.elements[2],
        "js-get-invoke",
        "js-get-invoke property must be a string literal or symbol",
      );

      // Create the IR node for the js-get-invoke operation
      // This transforms to an IIFE that checks if the property is a method at runtime
      return {
        type: IR.IRNodeType.InteropIIFE,
        object,
        property: {
          type: IR.IRNodeType.StringLiteral,
          value: propertyName,
        } as IR.IRStringLiteral,
      } as IR.IRInteropIIFE;
    },
    "transformJsGetInvoke",
    TransformError,
    [list],
  );
}

/**
 * Handle the special case for js-get-invoke.
 */
export function transformJsGetInvokeSpecialCase(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode | null {
  return perform(
    () => {
      if (
        list.elements.length === 3 &&
        list.elements[0].type === "symbol" &&
        (list.elements[0] as SymbolNode).name === "js-get-invoke"
      ) {
        const object = validateTransformed(
          transformNode(list.elements[1], currentDir),
          "js-get-invoke",
          "Object",
        );

        const property = validateTransformed(
          transformNode(list.elements[2], currentDir),
          "js-get-invoke",
          "Property",
        );
        const { property: memberProperty, computed } = resolveMemberProperty(
          property,
        );
        return {
          type: IR.IRNodeType.MemberExpression,
          object,
          property: memberProperty,
          computed,
        } as IR.IRMemberExpression;
      }
      return null;
    },
    "transformJsGetInvokeSpecialCase",
    TransformError,
    [list],
  );
}

/**
 * Check if a string represents dot notation (obj.prop)
 */
export function isDotNotation(op: string): boolean {
  // Exclude spread operators (...identifier) from dot notation
  return op.includes(".") && !op.startsWith("js/") && !op.startsWith("...");
}

/**
 * Transform dot notation expressions to IR
 */
export function transformDotNotation(
  list: ListNode,
  op: string,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      const parts = op.split(".");
      const objectName = parts[0];
      const property = parts.slice(1).join(".");

      const objectExpr = {
        type: IR.IRNodeType.Identifier,
        name: objectName,
      } as IR.IRIdentifier;

      if (list.elements.length === 1) {
        return {
          type: IR.IRNodeType.InteropIIFE,
          object: objectExpr,
          property: {
            type: IR.IRNodeType.StringLiteral,
            value: property,
          } as IR.IRStringLiteral,
        } as IR.IRInteropIIFE;
      }

      const args = transformElements(
        list.elements.slice(1),
        currentDir,
        transformNode,
        "method argument",
        "Method argument",
      );
      const literalNode = {
        type: IR.IRNodeType.StringLiteral,
        value: property,
      } as IR.IRStringLiteral;
      const { property: memberProperty, computed } = resolveMemberProperty(
        literalNode,
      );

      return {
        type: IR.IRNodeType.CallExpression,
        callee: {
          type: IR.IRNodeType.MemberExpression,
          object: objectExpr,
          property: memberProperty,
          computed,
        } as IR.IRMemberExpression,
        arguments: args,
      } as IR.IRCallExpression;
    },
    `transformDotNotation '${op}'`,
    TransformError,
    [list],
  );
}
