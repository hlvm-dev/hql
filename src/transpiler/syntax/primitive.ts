// src/transpiler/syntax/primitive.ts
// Module for handling primitive operations (+, -, *, /, etc.)

import * as IR from "../type/hql_ir.ts";
import type { HQLNode, ListNode, SymbolNode } from "../type/hql_ast.ts";
import {
  perform,
  TransformError,
  ValidationError,
} from "../../common/error.ts";
import { sanitizeIdentifier } from "../../common/utils.ts";
import { transformElements, validateListLength } from "../utils/validation-helpers.ts";
import {
  KERNEL_PRIMITIVES,
  PRIMITIVE_CLASS,
  PRIMITIVE_DATA_STRUCTURE,
  PRIMITIVE_OPS,
  JS_LITERAL_KEYWORDS_SET,
} from "../keyword/primitives.ts";

/** Compound assignment operators - cached Set for O(1) lookup */
const COMPOUND_ASSIGN_OPS_SET: ReadonlySet<string> = new Set([
  "+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "<<=", ">>=", ">>>="
]);

/** Pre-compiled regex for numeric index detection (array.0, tuple.1, etc.) */
const NUMERIC_INDEX_REGEX = /^\d+$/;

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

      // Handle "=" operator: can be assignment OR equality comparison
      // - Assignment: (= x 10) where x is a symbol or member expression
      // - Equality: (= 1 1) or (= (+ 1 2) 3) where first arg is a literal/expression
      if (op === "=") {
        return transformEqualsOperator(list, currentDir, transformNode);
      }

      // Handle logical assignment operators (??=, &&=, ||=)
      if (op === "??=" || op === "&&=" || op === "||=") {
        return transformLogicalAssignment(list, currentDir, transformNode, op as "??=" | "&&=" | "||=");
      }

      // Handle compound assignment operators (+=, -=, *=, /=, %=, **=, &=, |=, ^=, <<=, >>=, >>>=)
      // Use module-level Set for O(1) lookup instead of creating array each call
      if (COMPOUND_ASSIGN_OPS_SET.has(op)) {
        return transformCompoundAssignment(list, currentDir, transformNode, op);
      }

      const args = transformElements(
        list.elements.slice(1),
        currentDir,
        transformNode,
        `${op} argument`,
        "Primitive op argument",
      );

      if (op === "+" || op === "-" || op === "*" || op === "/" || op === "%" || op === "**") {
        return transformArithmeticOp(op, args);
      }

      if (
        op === "===" ||
        op === "==" ||
        op === "!==" ||
        op === "!=" ||
        op === "not=" ||
        op === ">" ||
        op === "<" ||
        op === ">=" ||
        op === "<="
      ) {
        return transformComparisonOp(op, args);
      }

      if (op === "&&" || op === "||" || op === "!" || op === "??") {
        return transformLogicalOp(op, args);
      }

      if (op === "&" || op === "|" || op === "^" || op === "~" || op === "<<" || op === ">>" || op === ">>>") {
        return transformBitwiseOp(op, args);
      }

      if (op === "typeof" || op === "delete" || op === "void" || op === "instanceof" || op === "in") {
        return transformTypeOp(op, args);
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
 * Transform comparison operations (===, ==, !==, !=, <, >, <=, >=)
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
        case "===":
          jsOp = "===";  // Strict equality (v2.0)
          break;
        case "==":
          jsOp = "==";   // Loose equality (v2.0)
          break;
        case "!==":
          jsOp = "!==";  // Explicit strict inequality
          break;
        case "!=":
          jsOp = "!=";   // Loose inequality (needed for notNil macro)
          break;
        case "not=":
          jsOp = "!=";   // Lisp-style word-form loose inequality
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
 * Transform bitwise operations (&, |, ^, ~, <<, >>, >>>).
 */
export function transformBitwiseOp(
  op: string,
  args: IR.IRNode[],
): IR.IRNode {
  return perform(
    () => {
      // Bitwise NOT is unary
      if (op === "~") {
        if (args.length !== 1) {
          throw new ValidationError(
            `~ requires exactly 1 argument, got ${args.length}`,
            "bitwise NOT operation",
            "1 argument",
            `${args.length} arguments`,
          );
        }
        return {
          type: IR.IRNodeType.UnaryExpression,
          operator: "~",
          argument: args[0],
        } as IR.IRUnaryExpression;
      }

      // Other bitwise operators are binary
      if (args.length !== 2) {
        throw new ValidationError(
          `${op} requires exactly 2 arguments, got ${args.length}`,
          `${op} operation`,
          "2 arguments",
          `${args.length} arguments`,
        );
      }

      return {
        type: IR.IRNodeType.BinaryExpression,
        operator: op,
        left: args[0],
        right: args[1],
      } as IR.IRBinaryExpression;
    },
    `transformBitwiseOp '${op}'`,
    TransformError,
    [op, args],
  );
}

/**
 * Transform type operations (typeof, instanceof, in, delete, void).
 */
export function transformTypeOp(
  op: string,
  args: IR.IRNode[],
): IR.IRNode {
  return perform(
    () => {
      // typeof, delete, void are unary
      if (op === "typeof" || op === "delete" || op === "void") {
        if (args.length !== 1) {
          throw new ValidationError(
            `${op} requires exactly 1 argument, got ${args.length}`,
            `${op} operation`,
            "1 argument",
            `${args.length} arguments`,
          );
        }

        let argument = args[0];

        // CRITICAL: delete operator needs raw member expression, not safe-access wrapper
        // Convert InteropIIFE (safe property access) to MemberExpression for delete
        if (op === "delete" && argument.type === IR.IRNodeType.InteropIIFE) {
          const interopNode = argument as IR.IRInteropIIFE;
          const memberExpr: IR.IRMemberExpression = {
            type: IR.IRNodeType.MemberExpression,
            object: interopNode.object,
            property: interopNode.property,
            computed: true, // obj["x"] format
          };
          argument = memberExpr;
        }

        return {
          type: IR.IRNodeType.UnaryExpression,
          operator: op as "typeof" | "delete" | "void",
          argument: argument,
        } as IR.IRUnaryExpression;
      }

      // instanceof, in are binary
      if (op === "instanceof" || op === "in") {
        if (args.length !== 2) {
          throw new ValidationError(
            `${op} requires exactly 2 arguments, got ${args.length}`,
            `${op} operation`,
            "2 arguments",
            `${args.length} arguments`,
          );
        }
        return {
          type: IR.IRNodeType.BinaryExpression,
          operator: op as "instanceof" | "in",
          left: args[0],
          right: args[1],
        } as IR.IRBinaryExpression;
      }

      throw new ValidationError(
        `Unknown type operator: ${op}`,
        "type operator",
        "one of: typeof, instanceof, in, delete, void",
        op,
      );
    },
    `transformTypeOp '${op}'`,
    TransformError,
    [op, args],
  );
}

/**
 * Transform logical operations (&&, ||, !, ??).
 * These operators use short-circuit evaluation.
 */
export function transformLogicalOp(
  op: string,
  args: IR.IRNode[],
): IR.IRNode {
  return perform(
    () => {
      // Logical NOT is unary
      if (op === "!") {
        if (args.length !== 1) {
          throw new ValidationError(
            `! requires exactly 1 argument, got ${args.length}`,
            "logical NOT operation",
            "1 argument",
            `${args.length} arguments`,
          );
        }
        return {
          type: IR.IRNodeType.UnaryExpression,
          operator: "!",
          argument: args[0],
        } as IR.IRUnaryExpression;
      }

      // &&, ||, ?? are binary operators (can chain multiple)
      if (args.length < 2) {
        throw new ValidationError(
          `${op} requires at least 2 arguments, got ${args.length}`,
          `${op} operation`,
          "at least 2 arguments",
          `${args.length} arguments`,
        );
      }

      // Chain multiple arguments: (&& a b c) => a && b && c
      let result = args[0];
      for (let i = 1; i < args.length; i++) {
        result = {
          type: IR.IRNodeType.LogicalExpression,
          operator: op as "&&" | "||" | "??",
          left: result,
          right: args[i],
        } as IR.IRLogicalExpression;
      }

      return result;
    },
    `transformLogicalOp '${op}'`,
    TransformError,
    [op, args],
  );
}

/**
 * "=" is ALWAYS assignment (following JavaScript semantics).
 *
 * Valid assignment targets:
 *   - Symbol (variable): (= x 10) → x = 10
 *   - Member expression: (= (. obj prop) 10) → obj.prop = 10
 *   - Dot notation symbol: (= obj.prop 10) → obj.prop = 10
 *
 * Invalid (error):
 *   - Literal: (= 5 10) → Error (use === for comparison)
 *   - Expression: (= (+ 1 2) 10) → Error (use === for comparison)
 *
 * For comparisons, use:
 *   - (=== a b) for strict equality
 *   - (== a b) for loose equality
 */
export function transformEqualsOperator(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      if (list.elements.length < 3) {
        throw new ValidationError(
          `= requires at least 2 arguments`,
          "equals operator",
          "at least 2 arguments",
          `${list.elements.length - 1} arguments`,
        );
      }

      const firstArg = list.elements[1];

      // Literal as first arg - ERROR (can't assign to literal)
      if (firstArg.type === "literal") {
        throw new ValidationError(
          `Cannot assign to a literal value. Use === for comparison.`,
          "= operator",
          "assignable target (variable or member expression)",
          "literal value",
        );
      }

      // Symbol as first arg - ASSIGNMENT
      if (firstArg.type === "symbol") {
        const symbolName = (firstArg as SymbolNode).name;

        // Special literal symbols - ERROR (can't assign to null/undefined/true/false)
        // O(1) Set lookup instead of O(n) array scan
        if (JS_LITERAL_KEYWORDS_SET.has(symbolName)) {
          throw new ValidationError(
            `Cannot assign to '${symbolName}'. Use === for comparison.`,
            "= operator",
            "assignable target (variable or member expression)",
            `'${symbolName}' literal`,
          );
        }

        // All other symbols (including dot notation like obj.prop) - ASSIGNMENT
        return transformAssignment(list, currentDir, transformNode);
      }

      // List as first arg - could be member expression or expression
      if (firstArg.type === "list") {
        const innerList = firstArg as ListNode;

        // Member expression pattern (. obj prop) - ASSIGNMENT
        if (
          innerList.elements.length >= 2 &&
          innerList.elements[0].type === "symbol" &&
          (innerList.elements[0] as SymbolNode).name === "."
        ) {
          return transformAssignment(list, currentDir, transformNode);
        }

        // Other expressions - ERROR (can't assign to expression result)
        throw new ValidationError(
          `Cannot assign to an expression result. Use === for comparison.`,
          "= operator",
          "assignable target (variable or member expression)",
          "expression",
        );
      }

      // Any other type - ERROR (should be unreachable, but handle defensively)
      throw new ValidationError(
        `Invalid assignment target. Use === for comparison.`,
        "= operator",
        "assignable target (variable or member expression)",
        "unknown type",
      );
    },
    "transformEqualsOperator",
    TransformError,
    [list],
  );
}

/**
 * Transform assignment operation (=).
 * Handles: (= target value)
 * Compiles to: target = value
 */
export function transformAssignment(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      validateListLength(list, 3, "=", "assignment expression");

      const targetNode = list.elements[1];
      const valueNode = list.elements[2];

      // Handle both simple symbols and member expressions (like this.x)
      let target: IR.IRNode;

      if (targetNode.type === "symbol") {
        const symbolName = (targetNode as SymbolNode).name;

        // Check if it's a dot-notation symbol like "this.x" or "obj.prop"
        if (symbolName.includes(".") && !symbolName.startsWith(".")) {
          const parts = symbolName.split(".");
          const baseObjectName = parts[0];
          // Sanitize base object: "self" -> "this", reserved keywords -> _keyword
          const sanitizedBase = baseObjectName === "self" ? "this" : sanitizeIdentifier(baseObjectName);

          // Helper to create member expression based on property type
          const createMember = (object: IR.IRNode, propStr: string): IR.IRMemberExpression => {
             // Check for numeric index (e.g. array.0 or tuple.1)
             // Uses pre-compiled module-level regex for performance
             if (NUMERIC_INDEX_REGEX.test(propStr)) {
                 return {
                    type: IR.IRNodeType.MemberExpression,
                    object,
                    property: {
                        type: IR.IRNodeType.NumericLiteral,
                        value: parseInt(propStr, 10)
                    } as IR.IRNumericLiteral,
                    computed: true
                 };
             }
             
             // Standard identifier property
             // We sanitize the property name to handle HQL identifiers (e.g. "my-prop" -> "my_prop")
             return {
                 type: IR.IRNodeType.MemberExpression,
                 object,
                 property: {
                     type: IR.IRNodeType.Identifier,
                     name: sanitizeIdentifier(propStr)
                 } as IR.IRIdentifier,
                 computed: false
             };
          };

          let memberExpr = createMember(
              { 
                type: IR.IRNodeType.Identifier, 
                name: sanitizedBase 
              } as IR.IRIdentifier,
              parts[1]
          );

          // Handle nested properties like obj.a.b.c
          for (let i = 2; i < parts.length; i++) {
            memberExpr = createMember(memberExpr, parts[i]);
          }

          target = memberExpr;
        } else {
          // Simple variable assignment: (= x 10)
          target = {
            type: IR.IRNodeType.Identifier,
            name: sanitizeIdentifier(symbolName),
          } as IR.IRIdentifier;
        }
      } else if (targetNode.type === "list") {
        // Could be a member expression like (. this x) or transformed member expression
        const transformedTarget = transformNode(targetNode, currentDir);
        if (!transformedTarget) {
          throw new ValidationError(
            "Invalid assignment target",
            "assignment target",
            "symbol or member expression",
            targetNode.type,
          );
        }
        target = transformedTarget;
      } else {
        throw new ValidationError(
          "Assignment target must be a symbol or member expression",
          "assignment target",
          "symbol or member expression",
          targetNode.type,
        );
      }

      const args = transformElements(
        [valueNode],
        currentDir,
        transformNode,
        "assignment value",
        "Assignment value",
      );

      if (args.length === 0 || !args[0]) {
        throw new ValidationError(
          "Assignment value is required",
          "assignment value",
          "valid expression",
          "null",
        );
      }

      // Create an assignment expression
      return {
        type: IR.IRNodeType.AssignmentExpression,
        operator: "=",
        left: target,
        right: args[0],
      } as IR.IRAssignmentExpression;
    },
    "transformAssignment",
    TransformError,
    [list],
  );
}

/**
 * Transform logical assignment operations (??=, &&=, ||=).
 * Handles: (??= target value), (&&= target value), (||= target value)
 * Compiles to: target ??= value, target &&= value, target ||= value
 */
export function transformLogicalAssignment(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
  operator: "??=" | "&&=" | "||=",
): IR.IRNode {
  return perform(
    () => {
      validateListLength(list, 3, operator, "logical assignment expression");

      const targetNode = list.elements[1];
      const valueNode = list.elements[2];

      // Handle both simple symbols and member expressions (like this.x)
      let target: IR.IRNode;

      if (targetNode.type === "symbol") {
        const symbolName = (targetNode as SymbolNode).name;

        // Check for dot notation: obj.prop or obj.nested.prop
        if (symbolName.includes(".")) {
          // Build member expression from dot notation
          const parts = symbolName.split(".");
          const sanitizedBase = sanitizeIdentifier(parts[0]);

          // Helper to create member expression based on property type
          const createMember = (object: IR.IRNode, propStr: string): IR.IRMemberExpression => {
            // Check for numeric index (e.g. array.0 or tuple.1)
            // Uses pre-compiled module-level regex for performance
            if (NUMERIC_INDEX_REGEX.test(propStr)) {
              return {
                type: IR.IRNodeType.MemberExpression,
                object,
                property: {
                  type: IR.IRNodeType.NumericLiteral,
                  value: parseInt(propStr, 10)
                } as IR.IRNumericLiteral,
                computed: true
              };
            }
            // Standard identifier property
            return {
              type: IR.IRNodeType.MemberExpression,
              object,
              property: {
                type: IR.IRNodeType.Identifier,
                name: sanitizeIdentifier(propStr)
              } as IR.IRIdentifier,
              computed: false
            };
          };

          let memberExpr = createMember(
            { type: IR.IRNodeType.Identifier, name: sanitizedBase } as IR.IRIdentifier,
            parts[1]
          );

          // Handle nested properties like obj.a.b.c
          for (let i = 2; i < parts.length; i++) {
            memberExpr = createMember(memberExpr, parts[i]);
          }

          target = memberExpr;
        } else {
          target = {
            type: IR.IRNodeType.Identifier,
            name: sanitizeIdentifier(symbolName),
          } as IR.IRIdentifier;
        }
      } else if (targetNode.type === "list") {
        // Handle (. obj prop) or other member access patterns
        const transformed = transformNode(targetNode, currentDir);
        if (
          !transformed ||
          (transformed.type !== IR.IRNodeType.MemberExpression &&
           transformed.type !== IR.IRNodeType.OptionalMemberExpression)
        ) {
          throw new ValidationError(
            `${operator} target must be a valid lvalue`,
            operator,
            "identifier or member expression",
            targetNode.type,
          );
        }
        target = transformed;
      } else {
        throw new ValidationError(
          `${operator} target must be a symbol or member expression`,
          operator,
          "symbol or member expression",
          targetNode.type,
        );
      }

      const value = transformNode(valueNode, currentDir);
      if (!value) {
        throw new ValidationError(
          `${operator} value cannot be null`,
          operator,
          "expression",
          "null",
        );
      }

      return {
        type: IR.IRNodeType.AssignmentExpression,
        operator,
        left: target,
        right: value,
      } as IR.IRAssignmentExpression;
    },
    "transformLogicalAssignment",
    TransformError,
    [list],
  );
}

/**
 * Transform compound assignment operators (+=, -=, *=, /=, %=, **=, &=, |=, ^=, <<=, >>=, >>>=)
 *
 * Syntax: (operator target value)
 * Examples:
 *   (+= x 10) → x += 10
 *   (*= arr.0 2) → arr[0] *= 2
 *   (**= base 2) → base **= 2
 */
export function transformCompoundAssignment(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
  operator: string,
): IR.IRNode {
  return perform(
    () => {
      validateListLength(list, 3, operator, "compound assignment expression");

      const targetNode = list.elements[1];
      const valueNode = list.elements[2];

      // Handle both simple symbols and member expressions (like this.x)
      let target: IR.IRNode;

      if (targetNode.type === "symbol") {
        const symbolName = (targetNode as SymbolNode).name;

        // Check for dot notation: obj.prop or obj.nested.prop
        if (symbolName.includes(".")) {
          // Build member expression from dot notation
          const parts = symbolName.split(".");
          const sanitizedBase = sanitizeIdentifier(parts[0]);

          // Helper to create member expression based on property type
          const createMember = (object: IR.IRNode, propStr: string): IR.IRMemberExpression => {
            // Check for numeric index (e.g. array.0 or tuple.1)
            // Uses pre-compiled module-level regex for performance
            if (NUMERIC_INDEX_REGEX.test(propStr)) {
              return {
                type: IR.IRNodeType.MemberExpression,
                object,
                property: {
                  type: IR.IRNodeType.NumericLiteral,
                  value: parseInt(propStr, 10)
                } as IR.IRNumericLiteral,
                computed: true
              };
            }
            // Standard identifier property
            return {
              type: IR.IRNodeType.MemberExpression,
              object,
              property: {
                type: IR.IRNodeType.Identifier,
                name: sanitizeIdentifier(propStr)
              } as IR.IRIdentifier,
              computed: false
            };
          };

          let memberExpr = createMember(
            { type: IR.IRNodeType.Identifier, name: sanitizedBase } as IR.IRIdentifier,
            parts[1]
          );

          // Handle nested properties like obj.a.b.c
          for (let i = 2; i < parts.length; i++) {
            memberExpr = createMember(memberExpr, parts[i]);
          }

          target = memberExpr;
        } else {
          target = {
            type: IR.IRNodeType.Identifier,
            name: sanitizeIdentifier(symbolName),
          } as IR.IRIdentifier;
        }
      } else if (targetNode.type === "list") {
        // Handle (. obj prop) or other member access patterns
        const transformed = transformNode(targetNode, currentDir);
        if (
          !transformed ||
          (transformed.type !== IR.IRNodeType.MemberExpression &&
           transformed.type !== IR.IRNodeType.OptionalMemberExpression)
        ) {
          throw new ValidationError(
            `${operator} target must be a valid lvalue`,
            operator,
            "identifier or member expression",
            targetNode.type,
          );
        }
        target = transformed;
      } else {
        throw new ValidationError(
          `${operator} target must be a symbol or member expression`,
          operator,
          "symbol or member expression",
          targetNode.type,
        );
      }

      const value = transformNode(valueNode, currentDir);
      if (!value) {
        throw new ValidationError(
          `${operator} value cannot be null`,
          operator,
          "expression",
          "null",
        );
      }

      return {
        type: IR.IRNodeType.AssignmentExpression,
        operator,
        left: target,
        right: value,
      } as IR.IRAssignmentExpression;
    },
    "transformCompoundAssignment",
    TransformError,
    [list],
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
