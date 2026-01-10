// src/transpiler/syntax/binding.ts
// Module for handling variable binding expressions (let and var)

import * as IR from "../type/hql_ir.ts";
import type { ListNode, LiteralNode, SymbolNode } from "../type/hql_ast.ts";
import {
  ValidationError,
} from "../../common/error.ts";
import {
  sanitizeIdentifier,
} from "../../common/utils.ts";
import {
  extractAndNormalizeType,
} from "../tokenizer/type-tokenizer.ts";
import { transformIf } from "./conditional.ts";
import {
  transformNonNullElements,
  validateTransformed,
} from "../utils/validation-helpers.ts";
import { astToSExp } from "../utils/ast-to-sexp.ts";
import { couldBePattern, parsePattern } from "../../s-exp/pattern-parser.ts";
import { patternToIR } from "../utils/pattern-to-ir.ts";
import type { SList } from "../../s-exp/types.ts";
import {
  hasHashMapPrefix,
  hasVectorPrefix,
} from "../../common/sexp-utils.ts";
import { DEEP_FREEZE_HELPER } from "../../common/runtime-helper-impl.ts";
import { copyPosition, isExpressionResult } from "../pipeline/hql-ast-to-hql-ir.ts";
import {
  containsAwaitExpression,
  containsYieldExpression,
} from "../utils/ir-tree-walker.ts";

/**
 * Options for binding transformation
 */
interface BindingOptions {
  /** Variable declaration kind */
  kind: "const" | "let" | "var";
  /** Whether to wrap values with Object.freeze() */
  freeze: boolean;
  /** Binding keyword name for error messages */
  keyword: "const" | "let" | "var";
}

/**
 * Unified binding transformation logic for both let and var.
 * Consolidates duplicate code between transformLet and transformVar.
 */
function transformBinding(
  list: ListNode,
  currentDir: string,
  transformNode: (
    node: ListNode | SymbolNode | LiteralNode,
    dir: string,
  ) => IR.IRNode | null,
  options: BindingOptions,
): IR.IRNode {
  const { kind, freeze, keyword } = options;

  // Handle global binding form: (let/var name value) OR (let/var [pattern] value)
  if (list.elements.length === 3) {
    const bindingTarget = list.elements[1];

    // Check if it's a destructuring pattern
    if (bindingTarget.type === "list") {
      const listNode = bindingTarget as ListNode;
      const hadVectorPrefix = hasVectorPrefix(listNode);
      const hadHashMapPrefix = hasHashMapPrefix(listNode);
      const sexp = astToSExp(bindingTarget);

      // Check if this list is a pattern AND came from vector/hash-map syntax
      if ((hadVectorPrefix || hadHashMapPrefix) && couldBePattern(sexp)) {
        let patternSexp = sexp;
        if (hadVectorPrefix && sexp.type === "list" && hasVectorPrefix(sexp)) {
          patternSexp = { ...sexp, elements: sexp.elements.slice(1) } as SList;
        }

        const pattern = parsePattern(patternSexp);
        const patternIR = patternToIR(pattern, transformNode, currentDir);

        if (!patternIR) {
          throw new ValidationError(
            "Invalid destructuring pattern",
            `${keyword} binding pattern`,
            "valid pattern",
            "null pattern",
          );
        }

        const valueNode = list.elements[2];
        const init = validateTransformed(
          transformIfOrValue(valueNode, currentDir, transformNode),
          `${keyword} value`,
          `${keyword.charAt(0).toUpperCase() + keyword.slice(1)} value`,
        );

        const declarator: IR.IRVariableDeclarator = {
          type: IR.IRNodeType.VariableDeclarator,
          id: patternIR,
          init,
        };
        copyPosition(bindingTarget, declarator);

        return {
          type: IR.IRNodeType.VariableDeclaration,
          kind,
          declarations: [declarator],
        } as IR.IRVariableDeclaration;
      }
    }

    // Handle simple identifier binding
    if (bindingTarget.type === "symbol") {
      const nameNode = bindingTarget as SymbolNode;

      // Extract type annotation if present (e.g., "x:number")
      const { name, type: typeAnnotation } = extractAndNormalizeType(nameNode.name);

      // Validate for var: cannot use for property assignment
      if (keyword === "var" && name.includes(".") && !name.startsWith(".")) {
        throw new ValidationError(
          `Cannot use 'var' for property assignment. Use '=' instead.\nHint: Change (var ${name} ...) to (= ${name} ...)`,
          "var declaration",
          "new variable name (without dots)",
          `property access '${name}'`,
        );
      }

      const id = {
        type: IR.IRNodeType.Identifier,
        name: sanitizeIdentifier(name),
      } as IR.IRIdentifier;

      const valueNode = list.elements[2];
      let init = validateTransformed(
        transformIfOrValue(valueNode, currentDir, transformNode),
        `${keyword} value`,
        `${keyword.charAt(0).toUpperCase() + keyword.slice(1)} value`,
      );

      // Wrap with freeze for immutable bindings
      if (freeze) {
        init = wrapWithFreeze(init);
      }

      const declarator: IR.IRVariableDeclarator = {
        type: IR.IRNodeType.VariableDeclarator,
        id,
        init,
        typeAnnotation,
      };
      copyPosition(bindingTarget, declarator);

      return {
        type: IR.IRNodeType.VariableDeclaration,
        kind,
        declarations: [declarator],
      } as IR.IRVariableDeclaration;
    }
  }

  // Handle specific case: (let/var (name value) body...) or (let/var ([pattern] value) body...)
  if (
    list.elements.length >= 2 &&
    list.elements[1].type === "list" &&
    (list.elements[1] as ListNode).elements.length === 2
  ) {
    const bindingList = list.elements[1] as ListNode;
    const nameNode = bindingList.elements[0];
    const valueNode = bindingList.elements[1];

    // Check if nameNode is a destructuring pattern (e.g., [a b] parses to (vector a b))
    if (nameNode.type === "list") {
      const patternListNode = nameNode as ListNode;
      const hadVectorPrefix = hasVectorPrefix(patternListNode);
      const hadHashMapPrefix = hasHashMapPrefix(patternListNode);
      const sexp = astToSExp(nameNode);

      if ((hadVectorPrefix || hadHashMapPrefix) && couldBePattern(sexp)) {
        // This is a destructuring pattern form: (let ([pattern] value) body...)
        let patternSexp = sexp;
        if (hadVectorPrefix && sexp.type === "list" && hasVectorPrefix(sexp)) {
          patternSexp = { ...sexp, elements: sexp.elements.slice(1) } as SList;
        }

        const pattern = parsePattern(patternSexp);
        const patternIR = patternToIR(pattern, transformNode, currentDir);

        if (!patternIR) {
          throw new ValidationError(
            "Invalid destructuring pattern",
            `${keyword} binding pattern`,
            "valid pattern",
            "null pattern",
          );
        }

        const init = validateTransformed(
          transformIfOrValue(valueNode, currentDir, transformNode),
          `${keyword} value`,
          `${keyword.charAt(0).toUpperCase() + keyword.slice(1)} value`,
        );

        const declarator: IR.IRVariableDeclarator = {
          type: IR.IRNodeType.VariableDeclarator,
          id: patternIR,
          init,
        };
        copyPosition(nameNode, declarator);

        const variableDecl: IR.IRVariableDeclaration = {
          type: IR.IRNodeType.VariableDeclaration,
          kind,
          declarations: [declarator],
        };

        // If there are body expressions, wrap in IIFE
        if (list.elements.length > 2) {
          const bodyExprs = list.elements.slice(2);
          const bodyNodes = transformNonNullElements(bodyExprs, currentDir, transformNode);

          const bodyStmts = bodyNodes.map((node, i) => {
            const isLast = i === bodyNodes.length - 1;
            if (isLast && node.type !== IR.IRNodeType.ReturnStatement) {
              return {
                type: IR.IRNodeType.ReturnStatement,
                argument: node,
              } as IR.IRReturnStatement;
            }
            if (isExpressionResult(node)) {
              return {
                type: IR.IRNodeType.ExpressionStatement,
                expression: node,
              } as IR.IRExpressionStatement;
            }
            return node;
          });

          const bodyBlock: IR.IRBlockStatement = {
            type: IR.IRNodeType.BlockStatement,
            body: [variableDecl, ...bodyStmts],
          };
          const hasAwaits = containsAwaitExpression(bodyBlock);
          const hasYields = containsYieldExpression(bodyBlock);

          const iife: IR.IRCallExpression = {
            type: IR.IRNodeType.CallExpression,
            callee: {
              type: IR.IRNodeType.FunctionExpression,
              id: null,
              params: [],
              body: bodyBlock,
              async: hasAwaits,
              generator: hasYields,
            } as IR.IRFunctionExpression,
            arguments: [],
          };

          if (hasYields) {
            return {
              type: IR.IRNodeType.YieldExpression,
              argument: iife,
              delegate: true,
            } as IR.IRYieldExpression;
          } else if (hasAwaits) {
            return {
              type: IR.IRNodeType.AwaitExpression,
              argument: iife,
            } as IR.IRAwaitExpression;
          }

          return iife;
        }

        return variableDecl;
      }
    }

    if (nameNode.type !== "symbol") {
      throw new ValidationError(
        "Binding name must be a symbol",
        `${keyword} binding name`,
        "symbol",
        nameNode.type,
      );
    }

    const name = (nameNode as SymbolNode).name;
    let valueExpr = validateTransformed(
      transformIfOrValue(valueNode, currentDir, transformNode),
      `${keyword} binding value`,
      `Binding value for '${name}'`,
    );

    // Wrap with freeze for immutable bindings
    if (freeze) {
      valueExpr = wrapWithFreeze(valueExpr);
    }

    const idNode: IR.IRIdentifier = {
      type: IR.IRNodeType.Identifier,
      name: sanitizeIdentifier(name),
    };
    copyPosition(nameNode, idNode);

    const declarator: IR.IRVariableDeclarator = {
      type: IR.IRNodeType.VariableDeclarator,
      id: idNode,
      init: valueExpr,
    };
    copyPosition(nameNode, declarator);

    const variableDecl: IR.IRVariableDeclaration = {
      type: IR.IRNodeType.VariableDeclaration,
      kind,
      declarations: [declarator],
    };

    // If there are body expressions
    if (list.elements.length > 2) {
      const bodyExprs = list.elements.slice(2);
      const bodyNodes = transformNonNullElements(bodyExprs, currentDir, transformNode);

      const bodyStmts = bodyNodes.map((node, i) => {
        const isLast = i === bodyNodes.length - 1;
        if (isLast && node.type !== IR.IRNodeType.ReturnStatement) {
          return {
            type: IR.IRNodeType.ReturnStatement,
            argument: node,
          } as IR.IRReturnStatement;
        }
        // Wrap non-last expressions in ExpressionStatement
        if (isExpressionResult(node)) {
          return {
            type: IR.IRNodeType.ExpressionStatement,
            expression: node,
          } as IR.IRExpressionStatement;
        }
        return node;
      });

      // Check if body contains await/yield - IIFE needs to be async/generator
      const bodyBlock: IR.IRBlockStatement = {
        type: IR.IRNodeType.BlockStatement,
        body: [variableDecl, ...bodyStmts],
      };
      const hasAwaits = containsAwaitExpression(bodyBlock);
      const hasYields = containsYieldExpression(bodyBlock);

      const iife: IR.IRCallExpression = {
        type: IR.IRNodeType.CallExpression,
        callee: {
          type: IR.IRNodeType.FunctionExpression,
          id: null,
          params: [],
          body: bodyBlock,
          async: hasAwaits,
          generator: hasYields,
        } as IR.IRFunctionExpression,
        arguments: [],
      };

      // For generator IIFEs, wrap in yield*; for async, wrap in await
      if (hasYields) {
        return {
          type: IR.IRNodeType.YieldExpression,
          argument: iife,
          delegate: true,
        } as IR.IRYieldExpression;
      }
      if (hasAwaits) {
        return {
          type: IR.IRNodeType.AwaitExpression,
          argument: iife,
        } as IR.IRAwaitExpression;
      }

      return iife;
    }

    return variableDecl;
  }

  // Handle standard local binding form: (let/var (name1 value1 ...) body...)
  if (list.elements.length >= 2 && list.elements[1].type === "list") {
    const bindingsNode = list.elements[1] as ListNode;
    const bodyExprs = list.elements.slice(2);
    return processBindings(bindingsNode, bodyExprs, currentDir, transformNode, kind);
  }

  throw new ValidationError(
    `Invalid ${keyword} form`,
    `${keyword} expression`,
    `(${keyword} name value) or (${keyword} (bindings...) body...)`,
    "invalid form",
  );
}

/**
 * Helper to transform if-expressions or regular values
 */
function transformIfOrValue(
  valueNode: ListNode | SymbolNode | LiteralNode,
  currentDir: string,
  transformNode: (
    node: ListNode | SymbolNode | LiteralNode,
    dir: string,
  ) => IR.IRNode | null,
): IR.IRNode | null {
  if (
    valueNode.type === "list" &&
    (valueNode as ListNode).elements[0]?.type === "symbol" &&
    ((valueNode as ListNode).elements[0] as SymbolNode).name === "if"
  ) {
    return transformIf(
      valueNode as ListNode,
      currentDir,
      transformNode,
      () => false,
      true,
    );
  }
  return transformNode(valueNode, currentDir);
}

/**
 * Transform a 'const' expression (immutable binding) - v2.0
 * Handles both forms:
 * 1. (const name value) - Global immutable binding
 * 2. (const (name1 value1 name2 value2...) body...) - Local immutable binding block
 */
export function transformConst(
  list: ListNode,
  currentDir: string,
  transformNode: (
    node: ListNode | SymbolNode | LiteralNode,
    dir: string,
  ) => IR.IRNode | null,
): IR.IRNode {
  return transformBinding(list, currentDir, transformNode, {
    kind: "const",
    freeze: true,
    keyword: "const",
  });
}

/**
 * Transform a 'let' expression (mutable, block-scoped binding) - v2.0
 * Changed in v2.0: Now creates mutable bindings (was immutable in v1.x)
 * Handles both forms:
 * 1. (let name value) - Global mutable block-scoped binding
 * 2. (let (name1 value1 name2 value2...) body...) - Local mutable binding block
 */
export function transformLet(
  list: ListNode,
  currentDir: string,
  transformNode: (
    node: ListNode | SymbolNode | LiteralNode,
    dir: string,
  ) => IR.IRNode | null,
): IR.IRNode {
  return transformBinding(list, currentDir, transformNode, {
    kind: "let",
    freeze: false,
    keyword: "let",
  });
}

/**
 * Transform a 'var' expression (mutable, function-scoped binding).
 * Handles both forms:
 * 1. (var name value) - Global mutable binding
 * 2. (var (name1 value1 name2 value2...) body...) - Local mutable binding block
 */
export function transformVar(
  list: ListNode,
  currentDir: string,
  transformNode: (
    node: ListNode | SymbolNode | LiteralNode,
    dir: string,
  ) => IR.IRNode | null,
): IR.IRNode {
  return transformBinding(list, currentDir, transformNode, {
    kind: "var",
    freeze: false,
    keyword: "var",
  });
}

/**
 * Process bindings for let/var expressions and create an IIFE containing the bindings and body
 */
function processBindings(
  bindingsNode: ListNode,
  bodyExprs: (ListNode | SymbolNode | LiteralNode)[],
  currentDir: string,
  transformNode: (
    node: ListNode | SymbolNode | LiteralNode,
    dir: string,
  ) => IR.IRNode | null,
  kind: "const" | "let" | "var",
): IR.IRNode {
  // Process bindings as pairs
  const bindings: Array<{
    name: string;
    value: IR.IRNode;
    nameNode: SymbolNode;
    typeAnnotation?: string;
  }> = [];

  // Track pattern bindings separately (destructuring creates IR patterns, not names)
  const patternDeclarations: IR.IRVariableDeclaration[] = [];

  for (let i = 0; i < bindingsNode.elements.length; i += 2) {
    if (i + 1 >= bindingsNode.elements.length) {
      throw new ValidationError(
        `Incomplete binding pair in ${kind === "const" ? "let" : "var"}`,
        `${kind === "const" ? "let" : "var"} binding`,
        "name-value pair",
        "incomplete pair",
      );
    }

    const nameNode = bindingsNode.elements[i];
    const valueNode = bindingsNode.elements[i + 1];

    // Check if nameNode is a destructuring pattern (array or object)
    if (nameNode.type === "list") {
      const listNode = nameNode as ListNode;
      const hadVectorPrefix = hasVectorPrefix(listNode);
      const hadHashMapPrefix = hasHashMapPrefix(listNode);
      const sexp = astToSExp(nameNode);

      if ((hadVectorPrefix || hadHashMapPrefix) && couldBePattern(sexp)) {
        // Handle destructuring pattern
        let patternSexp = sexp;
        if (hadVectorPrefix && sexp.type === "list" && hasVectorPrefix(sexp)) {
          patternSexp = { ...sexp, elements: sexp.elements.slice(1) } as SList;
        }

        const pattern = parsePattern(patternSexp);
        const patternIR = patternToIR(pattern, transformNode, currentDir);

        if (!patternIR) {
          throw new ValidationError(
            "Invalid destructuring pattern",
            `${kind === "const" ? "let" : "var"} binding pattern`,
            "valid pattern",
            "null pattern",
          );
        }

        // Transform the value
        const valueExpr = validateTransformed(
          valueNode.type === "list" &&
            (valueNode as ListNode).elements[0]?.type === "symbol" &&
            ((valueNode as ListNode).elements[0] as SymbolNode).name === "if"
            ? transformIf(
              valueNode as ListNode,
              currentDir,
              transformNode,
              () => false,
              true,
            )
            : transformNode(valueNode, currentDir),
          `${kind === "const" ? "let" : "var"} binding value`,
          `Binding value for pattern`,
        );

        const finalValue = kind === "const" ? wrapWithFreeze(valueExpr) : valueExpr;

        const declarator: IR.IRVariableDeclarator = {
          type: IR.IRNodeType.VariableDeclarator,
          id: patternIR,
          init: finalValue,
        };

        patternDeclarations.push({
          type: IR.IRNodeType.VariableDeclaration,
          kind,
          declarations: [declarator],
        } as IR.IRVariableDeclaration);

        continue;
      }
    }

    // Regular symbol binding
    if (nameNode.type !== "symbol") {
      throw new ValidationError(
        "Binding name must be a symbol or destructuring pattern",
        `${kind === "const" ? "let" : "var"} binding name`,
        "symbol or pattern",
        nameNode.type,
      );
    }

    // Extract type annotation if present (e.g., "x:number")
    const { name, type: typeAnnotation } = extractAndNormalizeType((nameNode as SymbolNode).name);

    // Check if the value is an if-expression
    const valueExpr = validateTransformed(
      valueNode.type === "list" &&
        (valueNode as ListNode).elements[0]?.type === "symbol" &&
        ((valueNode as ListNode).elements[0] as SymbolNode).name === "if"
        ? transformIf(
          valueNode as ListNode,
          currentDir,
          transformNode,
          () => false,
          true,
        )
        : transformNode(valueNode, currentDir),
      `${kind === "const" ? "let" : "var"} binding value`,
      `Binding value for '${name}'`,
    );

    // Wrap with freeze if it's a const binding (let)
    const finalValue = kind === "const" ? wrapWithFreeze(valueExpr) : valueExpr;
    bindings.push({
      name,
      value: finalValue,
      nameNode: nameNode as SymbolNode,
      typeAnnotation,
    });
  }

  // Create variable declarations for all bindings
  const variableDeclarations: IR.IRNode[] = bindings.map((b) => {
    const idNode: IR.IRIdentifier = {
      type: IR.IRNodeType.Identifier,
      name: sanitizeIdentifier(b.name),
    };
    copyPosition(b.nameNode, idNode);

    const declarator: IR.IRVariableDeclarator = {
      type: IR.IRNodeType.VariableDeclarator,
      id: idNode,
      init: b.value,
      typeAnnotation: b.typeAnnotation,
    };
    copyPosition(b.nameNode, declarator);

    return {
      type: IR.IRNodeType.VariableDeclaration,
      kind, // Use appropriate binding type
      declarations: [declarator],
    } as IR.IRVariableDeclaration;
  });

  // Process body expressions
  const bodyStatements = transformNonNullElements(
    bodyExprs,
    currentDir,
    transformNode,
  );

  // Bindings need implicit return: wrap last body expression in return statement
  const bodyStmts = bodyStatements.map((node, i) => {
    const isLast = i === bodyStatements.length - 1;
    // If it's the last statement and not already a return, wrap it in return
    if (isLast && node.type !== IR.IRNodeType.ReturnStatement) {
      return {
        type: IR.IRNodeType.ReturnStatement,
        argument: node,
      } as IR.IRReturnStatement;
    }
    // Wrap non-last expressions in ExpressionStatement
    if (isExpressionResult(node)) {
      return {
        type: IR.IRNodeType.ExpressionStatement,
        expression: node,
      } as IR.IRExpressionStatement;
    }
    return node;
  });

  // Create an IIFE to contain our block of code
  // Check if body contains await/yield - IIFE needs to be async/generator
  const bodyBlock: IR.IRBlockStatement = {
    type: IR.IRNodeType.BlockStatement,
    body: [...patternDeclarations, ...variableDeclarations, ...bodyStmts],
  };
  const hasAwaits = containsAwaitExpression(bodyBlock);
  const hasYields = containsYieldExpression(bodyBlock);

  const iife: IR.IRCallExpression = {
    type: IR.IRNodeType.CallExpression,
    callee: {
      type: IR.IRNodeType.FunctionExpression,
      id: null,
      params: [],
      body: bodyBlock,
      async: hasAwaits,
      generator: hasYields,
    } as IR.IRFunctionExpression,
    arguments: [],
  };

  // For generator IIFEs, wrap in yield*; for async, wrap in await
  if (hasYields) {
    return {
      type: IR.IRNodeType.YieldExpression,
      argument: iife,
      delegate: true,
    } as IR.IRYieldExpression;
  }
  if (hasAwaits) {
    return {
      type: IR.IRNodeType.AwaitExpression,
      argument: iife,
    } as IR.IRAwaitExpression;
  }

  return iife;
}

/**
 * Wrap an IR node with __hql_deepFreeze() to ensure deep immutability
 * This is used for let bindings to prevent mutation of reference types
 * Uses recursive freezing to freeze nested objects/arrays
 */
function wrapWithFreeze(node: IR.IRNode): IR.IRNode {
  return {
    type: IR.IRNodeType.CallExpression,
    callee: {
      type: IR.IRNodeType.Identifier,
      name: DEEP_FREEZE_HELPER,
    } as IR.IRIdentifier,
    arguments: [node],
  } as IR.IRCallExpression;
}
