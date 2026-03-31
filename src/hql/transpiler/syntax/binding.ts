// src/hql/transpiler/syntax/binding.ts
// Module for handling variable binding expressions (let and var)

import * as IR from "../type/hql_ir.ts";
import type { ListNode, LiteralNode, SymbolNode } from "../type/hql_ast.ts";
import { ValidationError } from "../../../common/error.ts";
import { extractAndNormalizeType } from "../tokenizer/type-tokenizer.ts";
import { transformIf } from "./conditional.ts";
import {
  transformNonNullElements,
  validateTransformed,
} from "../utils/validation-helpers.ts";
import { couldBePattern, parsePattern } from "../../s-exp/pattern-parser.ts";
import { patternToIR } from "../utils/pattern-to-ir.ts";
import { getMeta, type SList } from "../../s-exp/types.ts";
import {
  hasHashMapPrefix,
  hasVectorPrefix,
} from "../../../common/sexp-utils.ts";
import { DEEP_FREEZE_HELPER } from "../../../common/runtime-helper-impl.ts";
import {
  copyEndPosition,
  copyPosition,
  isExpressionResult,
} from "../pipeline/hql-ast-to-hql-ir.ts";
import {
  containsAwaitExpression,
  containsYieldExpression,
} from "../utils/ir-tree-walker.ts";
import {
  createBlock,
  createCall,
  createExprStmt,
  createFnExpr,
  createId,
  createVarDecl,
  ensureReturnStatement,
  wrapIIFEResult,
} from "../utils/ir-helpers.ts";
import {
  type BindingResolutionContext,
  identifierFromBindingRecord,
  registerDeclaredBinding,
  withLexicalScope,
} from "../utils/binding-resolution.ts";

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
  bindingContext: BindingResolutionContext,
  options: BindingOptions,
): IR.IRNode {
  const { kind, freeze, keyword } = options;

  // Handle global binding form: (let/var name value) OR (let/var [pattern] value)
  if (list.elements.length === 3) {
    const bindingTarget = list.elements[1];

    // Check if it's a destructuring pattern or a Clojure-style binding vector
    if (bindingTarget.type === "list") {
      const listNode = bindingTarget as ListNode;
      const hadVectorPrefix = hasVectorPrefix(listNode);
      const hadHashMapPrefix = hasHashMapPrefix(listNode);

      // Clojure-style binding vector: (let [name1 val1 name2 val2 ...] body)
      // Detect by: vector prefix + even pairs + first element is symbol +
      // second element is NOT a simple symbol (it's an expression/literal).
      // This distinguishes from destructuring: (let [x y] [1 2]) where all
      // elements are symbols.
      if (hadVectorPrefix) {
        const innerElements = listNode.elements.slice(1); // strip "vector" prefix
        const isPairCount = innerElements.length >= 2 &&
          innerElements.length % 2 === 0;
        const bindingNamePositionsAreSymbols = innerElements
          .filter((_e, i) => i % 2 === 0)
          .every((e) => e.type === "symbol");
        // In a binding vector, value position is an expression. But destructuring
        // patterns with defaults/nesting also place non-symbols here:
        //   [x (= 10)] , [x [y z]]
        // So we explicitly exclude pattern-like second elements.
        const secondElem = innerElements[1];
        const secondIsNotSymbol = secondElem?.type !== "symbol";
        const secondIsDefaultForm = !!(
          secondElem &&
          secondElem.type === "list" &&
          secondElem.elements.length === 2 &&
          secondElem.elements[0]?.type === "symbol" &&
          secondElem.elements[0].name === "="
        );
        const secondList = secondElem?.type === "list"
          ? secondElem as ListNode
          : null;
        const secondVecInner = secondList && hasVectorPrefix(secondList)
          ? secondList.elements.slice(1)
          : null;
        const secondIsSpreadLiteral = !!(
          secondVecInner &&
          secondVecInner.some((e) =>
            e.type === "symbol" && (e as SymbolNode).name.startsWith("...")
          )
        );
        const secondLooksLikePattern = !!(
          secondList &&
          !secondIsSpreadLiteral &&
          (hasVectorPrefix(secondList) || hasHashMapPrefix(secondList) ||
            secondIsDefaultForm)
        );

        const shouldTreatAsBindingVector = isPairCount &&
          bindingNamePositionsAreSymbols &&
          secondIsNotSymbol &&
          !secondIsDefaultForm &&
          !secondLooksLikePattern;

        if (shouldTreatAsBindingVector) {
          const bindingsNode = {
            ...listNode,
            elements: innerElements,
          } as ListNode;
          const bodyExprs = list.elements.slice(2);
          return processBindings(
            bindingsNode,
            bodyExprs,
            currentDir,
            transformNode,
            bindingContext,
            kind,
          );
        }
      }

      const sexp = bindingTarget;

      // Check if this list is a pattern AND came from vector/hash-map syntax
      if ((hadVectorPrefix || hadHashMapPrefix) && couldBePattern(sexp)) {
        let patternSexp = sexp;
        if (hadVectorPrefix && sexp.type === "list" && hasVectorPrefix(sexp)) {
          patternSexp = { ...sexp, elements: sexp.elements.slice(1) } as SList;
        }

        const pattern = parsePattern(patternSexp);
        const patternIR = patternToIR(
          pattern,
          bindingContext,
          transformNode,
          currentDir,
        );

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

        const finalInit = freeze ? wrapWithFreeze(init) : init;
        const decl = createVarDecl(patternIR, finalInit, kind);
        copyPosition(bindingTarget, decl.declarations[0]);
        copyEndPosition(list, decl.declarations[0]);

        return decl;
      }
    }

    // Handle simple identifier binding
    if (bindingTarget.type === "symbol") {
      const nameNode = bindingTarget as SymbolNode;

      // Extract type annotation if present (e.g., "x:number")
      const { name, type: typeAnnotation } = extractAndNormalizeType(
        nameNode.name,
      );

      // Validate for var: cannot use for property assignment
      if (keyword === "var" && name.includes(".") && !name.startsWith(".")) {
        throw new ValidationError(
          `Cannot use 'var' for property assignment. Use '=' instead.\nHint: Change (var ${name} ...) to (= ${name} ...)`,
          "var declaration",
          "new variable name (without dots)",
          `property access '${name}'`,
        );
      }

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

      const bindingRecord = registerDeclaredBinding(
        bindingContext,
        name,
        nameNode.name,
        getMeta(nameNode)?.resolvedBinding,
      );
      const id = identifierFromBindingRecord(bindingRecord, nameNode.name);

      const decl = createVarDecl(id, init, kind);
      decl.declarations[0].typeAnnotation = typeAnnotation;
      copyPosition(bindingTarget, decl.declarations[0]);
      copyEndPosition(list, decl.declarations[0]);

      return decl;
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
      const sexp = nameNode;

      if ((hadVectorPrefix || hadHashMapPrefix) && couldBePattern(sexp)) {
        // This is a destructuring pattern form: (let ([pattern] value) body...)
        let patternSexp = sexp;
        if (hadVectorPrefix && sexp.type === "list" && hasVectorPrefix(sexp)) {
          patternSexp = { ...sexp, elements: sexp.elements.slice(1) } as SList;
        }

        return withLexicalScope(bindingContext, () => {
          const init = validateTransformed(
            transformIfOrValue(valueNode, currentDir, transformNode),
            `${keyword} value`,
            `${keyword.charAt(0).toUpperCase() + keyword.slice(1)} value`,
          );

          const pattern = parsePattern(patternSexp);
          const patternIR = patternToIR(
            pattern,
            bindingContext,
            transformNode,
            currentDir,
          );

          if (!patternIR) {
            throw new ValidationError(
              "Invalid destructuring pattern",
              `${keyword} binding pattern`,
              "valid pattern",
              "null pattern",
            );
          }

          const variableDecl = createVarDecl(patternIR, init, kind);
          copyPosition(nameNode, variableDecl.declarations[0]);
          copyEndPosition(list, variableDecl.declarations[0]);

          // If there are body expressions, wrap in IIFE
          if (list.elements.length > 2) {
            const bodyExprs = list.elements.slice(2);
            const bodyNodes = transformNonNullElements(
              bodyExprs,
              currentDir,
              transformNode,
            );

            const bodyStmts = bodyNodes.map((node, i) => {
              const isLast = i === bodyNodes.length - 1;
              if (isLast && node.type !== IR.IRNodeType.ReturnStatement) {
                return ensureReturnStatement(node);
              }
              if (isExpressionResult(node)) {
                return createExprStmt(node);
              }
              return node;
            });

            return makeIIFE(createBlock([variableDecl, ...bodyStmts]));
          }

          return variableDecl;
        });
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

    return withLexicalScope(bindingContext, () => {
      const bindingRecord = registerDeclaredBinding(
        bindingContext,
        name,
        (nameNode as SymbolNode).name,
        getMeta(nameNode)?.resolvedBinding,
      );
      const idNode = identifierFromBindingRecord(bindingRecord, nameNode.name);
      copyPosition(nameNode, idNode);
      copyEndPosition(list, idNode);

      const variableDecl = createVarDecl(idNode, valueExpr, kind);
      copyPosition(nameNode, variableDecl.declarations[0]);
      copyEndPosition(list, variableDecl.declarations[0]);

      // If there are body expressions
      if (list.elements.length > 2) {
        const bodyExprs = list.elements.slice(2);
        const bodyNodes = transformNonNullElements(
          bodyExprs,
          currentDir,
          transformNode,
        );

        const bodyStmts = bodyNodes.map((node, i) => {
          const isLast = i === bodyNodes.length - 1;
          if (isLast && node.type !== IR.IRNodeType.ReturnStatement) {
            return ensureReturnStatement(node);
          }
          // Wrap non-last expressions in ExpressionStatement
          if (isExpressionResult(node)) {
            return createExprStmt(node);
          }
          return node;
        });

        return makeIIFE(createBlock([variableDecl, ...bodyStmts]));
      }

      return variableDecl;
    });
  }

  // Handle standard local binding form: (let/var (name1 value1 ...) body...)
  // Also handles Clojure-style (let [name1 val1 ...] body...) with vector prefix
  if (list.elements.length >= 2 && list.elements[1].type === "list") {
    const rawBindingsNode = list.elements[1] as ListNode;
    // Strip vector prefix if present (Clojure-style [name val ...] binding vector)
    const bindingsNode = hasVectorPrefix(rawBindingsNode)
      ? {
        ...rawBindingsNode,
        elements: rawBindingsNode.elements.slice(1),
      } as ListNode
      : rawBindingsNode;
    const bodyExprs = list.elements.slice(2);
    return processBindings(
      bindingsNode,
      bodyExprs,
      currentDir,
      transformNode,
      bindingContext,
      kind,
    );
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
  bindingContext: BindingResolutionContext,
): IR.IRNode {
  return transformBinding(list, currentDir, transformNode, bindingContext, {
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
  bindingContext: BindingResolutionContext,
): IR.IRNode {
  return transformBinding(list, currentDir, transformNode, bindingContext, {
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
  bindingContext: BindingResolutionContext,
): IR.IRNode {
  return transformBinding(list, currentDir, transformNode, bindingContext, {
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
  bindingContext: BindingResolutionContext,
  kind: "const" | "let" | "var",
): IR.IRNode {
  return withLexicalScope(bindingContext, () => {
    const variableDeclarations: IR.IRNode[] = [];

    for (let i = 0; i < bindingsNode.elements.length; i += 2) {
      if (i + 1 >= bindingsNode.elements.length) {
        throw new ValidationError(
          `Incomplete binding pair in ${kind}`,
          `${kind} binding`,
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
        const sexp = nameNode;

        if ((hadVectorPrefix || hadHashMapPrefix) && couldBePattern(sexp)) {
          const valueExpr = validateTransformed(
            transformIfOrValue(valueNode, currentDir, transformNode),
            `${kind} binding value`,
            `Binding value for pattern`,
          );

          let patternSexp = sexp;
          if (
            hadVectorPrefix && sexp.type === "list" && hasVectorPrefix(sexp)
          ) {
            patternSexp = {
              ...sexp,
              elements: sexp.elements.slice(1),
            } as SList;
          }

          const pattern = parsePattern(patternSexp);
          const patternIR = patternToIR(
            pattern,
            bindingContext,
            transformNode,
            currentDir,
          );

          if (!patternIR) {
            throw new ValidationError(
              "Invalid destructuring pattern",
              `${kind} binding pattern`,
              "valid pattern",
              "null pattern",
            );
          }

          const finalValue = kind === "const"
            ? wrapWithFreeze(valueExpr)
            : valueExpr;
          variableDeclarations.push(createVarDecl(patternIR, finalValue, kind));
          continue;
        }
      }

      // Regular symbol binding
      if (nameNode.type !== "symbol") {
        throw new ValidationError(
          "Binding name must be a symbol or destructuring pattern",
          `${kind} binding name`,
          "symbol or pattern",
          nameNode.type,
        );
      }

      // Extract type annotation if present (e.g., "x:number")
      const { name, type: typeAnnotation } = extractAndNormalizeType(
        (nameNode as SymbolNode).name,
      );

      const valueExpr = validateTransformed(
        transformIfOrValue(valueNode, currentDir, transformNode),
        `${kind} binding value`,
        `Binding value for '${name}'`,
      );

      const bindingRecord = registerDeclaredBinding(
        bindingContext,
        name,
        (nameNode as SymbolNode).name,
        getMeta(nameNode)?.resolvedBinding,
      );
      const idNode = identifierFromBindingRecord(
        bindingRecord,
        (nameNode as SymbolNode).name,
      );
      copyPosition(nameNode, idNode);
      copyEndPosition(bindingsNode, idNode);

      const finalValue = kind === "const"
        ? wrapWithFreeze(valueExpr)
        : valueExpr;
      const decl = createVarDecl(idNode, finalValue, kind);
      decl.declarations[0].typeAnnotation = typeAnnotation;
      copyPosition(nameNode, decl.declarations[0]);
      copyEndPosition(bindingsNode, decl.declarations[0]);
      variableDeclarations.push(decl);
    }

    // Process body expressions
    const bodyStatements = transformNonNullElements(
      bodyExprs,
      currentDir,
      transformNode,
    );

    // Bindings need implicit return: wrap last body expression in return statement
    const bodyStmts = bodyStatements.map((node, i) => {
      const isLast = i === bodyStatements.length - 1;
      if (isLast && node.type !== IR.IRNodeType.ReturnStatement) {
        return ensureReturnStatement(node);
      }
      if (isExpressionResult(node)) {
        return createExprStmt(node);
      }
      return node;
    });

    return makeIIFE(createBlock([...variableDeclarations, ...bodyStmts]));
  });
}

/**
 * Create an IIFE from a block, wrapping in yield-delegate or await if the
 * block contains generator or async expressions. DRY helper used by all
 * binding forms that need IIFE-scoped blocks.
 */
function makeIIFE(bodyBlock: IR.IRBlockStatement): IR.IRNode {
  const hasAwaits = containsAwaitExpression(bodyBlock);
  const hasYields = containsYieldExpression(bodyBlock);

  const iife = createCall(
    createFnExpr([], bodyBlock, { async: hasAwaits, generator: hasYields }),
    [],
  );

  return wrapIIFEResult(iife, hasYields, hasAwaits);
}

/**
 * Wrap an IR node with __hql_deepFreeze() to ensure deep immutability
 * This is used for let bindings to prevent mutation of reference types
 * Uses recursive freezing to freeze nested objects/arrays
 */
/**
 * Check if a node is a primitive literal that doesn't need Object.freeze().
 * Primitives (strings, numbers, booleans, null, bigints) are already immutable
 * in JavaScript, so wrapping them in deepFreeze is a no-op at runtime cost.
 */
function isPrimitiveLiteral(node: IR.IRNode): boolean {
  switch (node.type) {
    case IR.IRNodeType.StringLiteral:
    case IR.IRNodeType.NumericLiteral:
    case IR.IRNodeType.BooleanLiteral:
    case IR.IRNodeType.NullLiteral:
    case IR.IRNodeType.BigIntLiteral:
      return true;
    default:
      return false;
  }
}

function wrapWithFreeze(node: IR.IRNode): IR.IRNode {
  if (isPrimitiveLiteral(node)) return node;
  return createCall(createId(DEEP_FREEZE_HELPER), [node]);
}
