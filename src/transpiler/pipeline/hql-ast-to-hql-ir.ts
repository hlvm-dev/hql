////////////////////////////////////////////////////////////////////////////////
// src/transpiler/pipeline/hql-ast-to-hql-ir.ts - Refactored to use syntax modules
////////////////////////////////////////////////////////////////////////////////

import * as IR from "../type/hql_ir.ts";
import type { HQLNode, ListNode, LiteralNode, SymbolNode } from "../type/hql_ast.ts";
import type {
  ArrayPattern,
  IdentifierPattern,
  ObjectPattern,
  Pattern,
  RestPattern,
  SkipPattern,
} from "../../s-exp/types.ts";
import { sanitizeIdentifier, hyphenToUnderscore } from "../../common/utils.ts";
import {
  HASH_MAP_INTERNAL,
  HASH_MAP_USER,
  RANGE_HELPER,
  LAZY_SEQ_HELPER,
  GET_HELPER,
  GET_NUMERIC_HELPER,
  GET_OP_HELPER,
  VECTOR_SYMBOL,
} from "../../common/runtime-helper-impl.ts";
import { globalLogger as logger } from "../../logger.ts";
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
import {
  processFunctionBody,
  transformStandardFunctionCall,
} from "../syntax/function.ts";
import {
  isDeclarationExport,
  isDefaultExport,
  isNamespaceImport,
  isSingleExport,
  isVectorExport,
  isVectorImport,
} from "../syntax/import-export.ts";
import { FIRST_CLASS_OPERATORS } from "../keyword/primitives.ts";

// Import syntax modules
import * as bindingModule from "../syntax/binding.ts";
import * as classModule from "../syntax/class.ts";
import * as conditionalModule from "../syntax/conditional.ts";
import * as dataStructureModule from "../syntax/data-structure.ts";
import * as enumModule from "../syntax/enum.ts";
import * as functionModule from "../syntax/function.ts";
import * as importExportModule from "../syntax/import-export.ts";
import * as jsInteropModule from "../syntax/js-interop.ts";
import * as loopRecurModule from "../syntax/loop-recur.ts";
import * as primitiveModule from "../syntax/primitive.ts";
import * as quoteModule from "../syntax/quote.ts";
import { globalSymbolTable } from "../symbol_table.ts";

type MetaData = {
  line?: number;
  column?: number;
  filePath?: string;
  [key: string]: unknown;
};

interface MetaCarrier {
  _meta?: MetaData;
}

type TransformNodeFn = (node: HQLNode, dir: string) => IR.IRNode | null;

/**
 * Check if an IR node is an expression (not a statement/declaration)
 * Expressions need to be wrapped in ExpressionStatement at the top level
 */
function isExpression(node: IR.IRNode): boolean {
  switch (node.type) {
    // Literals
    case IR.IRNodeType.StringLiteral:
    case IR.IRNodeType.NumericLiteral:
    case IR.IRNodeType.BooleanLiteral:
    case IR.IRNodeType.NullLiteral:
    case IR.IRNodeType.Identifier:

    // Expressions
    case IR.IRNodeType.CallExpression:
    case IR.IRNodeType.MemberExpression:
    case IR.IRNodeType.CallMemberExpression:
    case IR.IRNodeType.NewExpression:
    case IR.IRNodeType.BinaryExpression:
    case IR.IRNodeType.UnaryExpression:
    case IR.IRNodeType.ConditionalExpression:
    case IR.IRNodeType.ArrayExpression:
    case IR.IRNodeType.FunctionExpression:
    case IR.IRNodeType.ObjectExpression:
    case IR.IRNodeType.AssignmentExpression:
    case IR.IRNodeType.InteropIIFE:
    case IR.IRNodeType.JsMethodAccess:
    case IR.IRNodeType.AwaitExpression:
      return true;

    // Statements and declarations - don't wrap
    case IR.IRNodeType.VariableDeclaration:
    case IR.IRNodeType.FunctionDeclaration:
    case IR.IRNodeType.FnFunctionDeclaration:
    case IR.IRNodeType.ClassDeclaration:
    case IR.IRNodeType.EnumDeclaration:
    case IR.IRNodeType.ReturnStatement:
    case IR.IRNodeType.BlockStatement:
    case IR.IRNodeType.ExpressionStatement:
    case IR.IRNodeType.IfStatement:
    case IR.IRNodeType.ThrowStatement:
    case IR.IRNodeType.TryStatement:
    case IR.IRNodeType.ImportDeclaration:
    case IR.IRNodeType.ExportNamedDeclaration:
    case IR.IRNodeType.ExportVariableDeclaration:
    case IR.IRNodeType.ExportDefaultDeclaration:
    case IR.IRNodeType.TypeAliasDeclaration:
    case IR.IRNodeType.InterfaceDeclaration:
      return false;

    default:
      // Unknown types - be conservative and wrap them
      return true;
  }
}

export function extractMeta(
  source:
    | HQLNode
    | Pattern
    | IdentifierPattern
    | ArrayPattern
    | ObjectPattern
    | RestPattern
    | SkipPattern
    | null
    | undefined,
): MetaData | undefined {
  if (!source || typeof source !== "object") {
    return undefined;
  }
  const carrier = source as MetaCarrier;
  const meta = carrier._meta;
  return (meta && typeof meta === "object") ? meta : undefined;
}

export function setAsyncFlag(node: IR.IRNode | null): void {
  if (!node) {
    return;
  }

  switch (node.type) {
    case IR.IRNodeType.FunctionDeclaration:
      (node as IR.IRFunctionDeclaration).async = true;
      break;
    case IR.IRNodeType.FunctionExpression:
      (node as IR.IRFunctionExpression).async = true;
      break;
    case IR.IRNodeType.FnFunctionDeclaration:
      (node as IR.IRFnFunctionDeclaration).async = true;
      break;
    default:
      break;
  }
}

/**
 * IIFE Context Tracking for Early Returns
 *
 * Tracks nesting depth of IIFEs (from do blocks, if expressions, etc.)
 * Used to determine when return statements need to be transformed to throws
 */
let iifeDepth = 0;

/**
 * Enter an IIFE context (increment depth)
 * Call this when entering do blocks, if expressions, etc.
 */
export function enterIIFE(): void {
  iifeDepth++;
}

/**
 * Exit an IIFE context (decrement depth)
 * Call this when exiting do blocks, if expressions, etc.
 */
export function exitIIFE(): void {
  iifeDepth--;
  if (iifeDepth < 0) {
    logger.warn("IIFE depth became negative - mismatched enter/exit calls");
    iifeDepth = 0;
  }
}

/**
 * Check if we're currently inside an IIFE context
 * Returns true if depth > 0
 */
export function isInsideIIFE(): boolean {
  return iifeDepth > 0;
}

/**
 * Reset IIFE depth (used between transforms)
 */
export function resetIIFEDepth(): void {
  iifeDepth = 0;
}

/**
 * Get current IIFE depth (for save/restore)
 */
export function getIIFEDepth(): number {
  return iifeDepth;
}

/**
 * Set IIFE depth to a specific value (for save/restore)
 */
export function setIIFEDepth(depth: number): void {
  iifeDepth = depth;
}

export function copyPosition(
  source:
    | HQLNode
    | Pattern
    | IdentifierPattern
    | ArrayPattern
    | ObjectPattern
    | RestPattern
    | SkipPattern
    | null
    | undefined,
  target: IR.IRNode | null,
): IR.IRNode | null {
  if (!target || !source) return target;
  const meta = extractMeta(source);
  if (meta) {
    target.position = {
      line: typeof meta.line === "number" ? meta.line : undefined,
      column: typeof meta.column === "number" ? meta.column : undefined,
      filePath: typeof meta.filePath === "string" ? meta.filePath : undefined,
    };
  }
  return target;
}

/**
 * Transform factory to map operators to handler functions
 */
const transformFactory = new Map<
  string,
  (list: ListNode, currentDir: string) => IR.IRNode | null
>();

/**
 * Transform an array of HQL AST nodes into an IR program.
 * Enhanced with better error handling and logging, now wrapped in `perform`.
 */
export function transformToIR(
  nodes: HQLNode[],
  currentDir: string,
): IR.IRProgram {
  if (transformFactory.size === 0) {
    initializeTransformFactory();
  }

  // Reset IIFE depth at the start of each transform
  resetIIFEDepth();

  const body: IR.IRNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const ir = transformNode(nodes[i], currentDir);
    if (ir) {
      // Wrap expressions in ExpressionStatement when at top level
      // Statements can be added directly
      if (isExpression(ir)) {
        body.push({
          type: IR.IRNodeType.ExpressionStatement,
          expression: ir,
          position: ir.position, // Inherit position from wrapped expression
        } as IR.IRExpressionStatement);
      } else {
        body.push(ir);
      }
    }
  }
  return { type: IR.IRNodeType.Program, body };
}

/**
 * Initialize the transform factory with handlers for each operation
 */
function initializeTransformFactory(): void {
  perform(
    () => {
      transformFactory.set(
        "quote",
        (list, currentDir) =>
          quoteModule.transformQuote(list, currentDir, transformNode),
      );
      transformFactory.set(
        "quasiquote",
        (list, currentDir) =>
          quoteModule.transformQuasiquote(list, currentDir, transformNode),
      );
      transformFactory.set(
        "unquote",
        (list, currentDir) =>
          quoteModule.transformUnquote(list, currentDir, transformNode),
      );
      transformFactory.set(
        "unquote-splicing",
        (list, currentDir) =>
          quoteModule.transformUnquoteSplicing(list, currentDir, transformNode),
      );
      transformFactory.set(
        VECTOR_SYMBOL,
        (list, currentDir) =>
          dataStructureModule.transformVector(list, currentDir, transformNode),
      );
      transformFactory.set(
        "hash-set",
        (list, currentDir) =>
          dataStructureModule.transformHashSet(list, currentDir, transformNode),
      );
      transformFactory.set(
        HASH_MAP_USER,
        (list, currentDir) =>
          dataStructureModule.transformHashMap(list, currentDir, transformNode),
      );
      transformFactory.set(
        HASH_MAP_INTERNAL,
        (list, currentDir) =>
          dataStructureModule.transformHashMap(list, currentDir, transformNode),
      );
      transformFactory.set(
        "new",
        (list, currentDir) =>
          dataStructureModule.transformNew(list, currentDir, transformNode),
      );
      transformFactory.set(
        "fn",
        (list, currentDir) =>
          functionModule.transformFn(
            list,
            currentDir,
            transformNode,
            processFunctionBody,
          ),
      );
      // Generator function: (fn* name [params] body...) or (fn* [params] body...)
      transformFactory.set(
        "fn*",
        (list, currentDir) =>
          transformGeneratorFn(list, currentDir, transformNode, processFunctionBody),
      );
      // Yield expression: (yield value) or (yield* iterator)
      transformFactory.set(
        "yield",
        (list, currentDir) => transformYield(list, currentDir, transformNode),
      );
      transformFactory.set(
        "yield*",
        (list, currentDir) => transformYieldDelegate(list, currentDir, transformNode),
      );
      transformFactory.set(
        "=>",
        (list, currentDir) =>
          functionModule.transformArrowLambda(
            list,
            currentDir,
            transformNode,
            processFunctionBody,
          ),
      );
      transformFactory.set(
        "async",
        (list, currentDir) => transformAsync(list, currentDir, transformNode),
      );
      // Simple built-in range implementation - just call a runtime function
      transformFactory.set(
        "range",
        (list, currentDir) => {
          // Transform it as a regular function call to a built-in 'range' function
          // The runtime will need to provide this function
          const args = transformElements(
            list.elements.slice(1),
            currentDir,
            transformNode,
            "range argument",
            "Range argument",
          );

          if (args.length > 3) {
            throw new ValidationError(
              "range requires 0-3 arguments",
              "range",
              "(range) or (range end) or (range start end) or (range start end step)",
              `${args.length} arguments`,
            );
          }

          // Generate a simple function call that will be provided at runtime
          return {
            type: IR.IRNodeType.CallExpression,
            callee: {
              type: IR.IRNodeType.Identifier,
              name: RANGE_HELPER,
            } as IR.IRIdentifier,
            arguments: args,
          } as IR.IRCallExpression;
        },
      );
      transformFactory.set(
        "await",
        (list, currentDir) => transformAwait(list, currentDir, transformNode),
      );
      transformFactory.set(
        "const",
        (list, currentDir) =>
          bindingModule.transformConst(list, currentDir, transformNode),
      );
      // def is an alias for const (Clojure-style immutable binding)
      transformFactory.set(
        "def",
        (list, currentDir) =>
          bindingModule.transformConst(list, currentDir, transformNode),
      );
      transformFactory.set(
        "let",
        (list, currentDir) =>
          bindingModule.transformLet(list, currentDir, transformNode),
      );
      transformFactory.set(
        "var",
        (list, currentDir) =>
          bindingModule.transformVar(list, currentDir, transformNode),
      );
      // "set!" removed - now handled by "=" operator in primitive.ts
      transformFactory.set(
        "if",
        (list, currentDir) =>
          conditionalModule.transformIf(
            list,
            currentDir,
            transformNode,
            loopRecurModule.hasLoopContext,
          ),
      );
      transformFactory.set(
        "?",
        (list, currentDir) =>
          conditionalModule.transformTernary(list, currentDir, transformNode),
      );
      transformFactory.set(
        "template-literal",
        (list, currentDir) =>
          transformTemplateLiteral(list, currentDir),
      );
      transformFactory.set(
        "do",
        (list, currentDir) =>
          conditionalModule.transformDo(list, currentDir, transformNode),
      );
      // lazy-seq special form for self-hosted stdlib (Clojure-style lazy sequences)
      // (lazy-seq body) → __hql_lazy_seq(() => body)
      transformFactory.set(
        "lazy-seq",
        (list, currentDir) => {
          // Get body expressions (skip the 'lazy-seq' symbol)
          const bodyExprs = list.elements.slice(1);

          // If no body, return call to __hql_lazy_seq with null-returning thunk
          if (bodyExprs.length === 0) {
            return {
              type: IR.IRNodeType.CallExpression,
              callee: { type: IR.IRNodeType.Identifier, name: LAZY_SEQ_HELPER } as IR.IRIdentifier,
              arguments: [{
                type: IR.IRNodeType.FunctionExpression,
                id: null,
                params: [],
                body: {
                  type: IR.IRNodeType.BlockStatement,
                  body: [{
                    type: IR.IRNodeType.ReturnStatement,
                    argument: { type: IR.IRNodeType.NullLiteral } as IR.IRNullLiteral,
                  } as IR.IRReturnStatement],
                } as IR.IRBlockStatement,
              } as IR.IRFunctionExpression],
            } as IR.IRCallExpression;
          }

          // Transform body - if multiple expressions, use do
          let bodyNode: IR.IRNode;
          if (bodyExprs.length === 1) {
            const transformed = transformNode(bodyExprs[0], currentDir);
            bodyNode = transformed || { type: IR.IRNodeType.NullLiteral } as IR.IRNullLiteral;
          } else {
            // Multiple expressions - wrap in do
            bodyNode = conditionalModule.transformDo(
              { ...list, elements: [list.elements[0], ...bodyExprs] } as ListNode,
              currentDir,
              transformNode,
            );
          }

          // Create: __hql_lazy_seq(() => { return body; })
          return {
            type: IR.IRNodeType.CallExpression,
            callee: { type: IR.IRNodeType.Identifier, name: LAZY_SEQ_HELPER } as IR.IRIdentifier,
            arguments: [{
              type: IR.IRNodeType.FunctionExpression,
              id: null,
              params: [],
              body: {
                type: IR.IRNodeType.BlockStatement,
                body: [{
                  type: IR.IRNodeType.ReturnStatement,
                  argument: bodyNode,
                } as IR.IRReturnStatement],
              } as IR.IRBlockStatement,
            } as IR.IRFunctionExpression],
          } as IR.IRCallExpression;
        },
      );
      transformFactory.set(
        "try",
        (list, currentDir) => transformTry(list, currentDir, transformNode),
      );
      transformFactory.set(
        "loop",
        (list, currentDir) =>
          loopRecurModule.transformLoop(list, currentDir, transformNode),
      );
      transformFactory.set(
        "recur",
        (list, currentDir) =>
          loopRecurModule.transformRecur(list, currentDir, transformNode),
      );
      transformFactory.set(
        "continue",
        (list, currentDir) =>
          loopRecurModule.transformContinue(list, currentDir, transformNode),
      );
      transformFactory.set(
        "break",
        (list, currentDir) =>
          loopRecurModule.transformBreak(list, currentDir, transformNode),
      );
      transformFactory.set(
        "for-of",
        (list, currentDir) =>
          loopRecurModule.transformForOf(list, currentDir, transformNode),
      );
      transformFactory.set(
        "for-await-of",
        (list, currentDir) =>
          loopRecurModule.transformForAwaitOf(list, currentDir, transformNode),
      );
      transformFactory.set(
        "label",
        (list, currentDir) =>
          loopRecurModule.transformLabel(list, currentDir, transformNode),
      );
      transformFactory.set(
        "return",
        (list, currentDir) =>
          conditionalModule.transformReturn(list, currentDir, transformNode),
      );
      transformFactory.set(
        "throw",
        (list, currentDir) =>
          conditionalModule.transformThrow(list, currentDir, transformNode),
      );
      transformFactory.set(
        "switch",
        (list, currentDir) =>
          conditionalModule.transformSwitch(list, currentDir, transformNode),
      );

      transformFactory.set(
        "js-new",
        (list, currentDir) =>
          jsInteropModule.transformJsNew(list, currentDir, transformNode),
      );
      transformFactory.set(
        "js-get",
        (list, currentDir) =>
          jsInteropModule.transformJsGet(list, currentDir, transformNode),
      );
      transformFactory.set(
        "js-call",
        (list, currentDir) =>
          jsInteropModule.transformJsCall(list, currentDir, transformNode),
      );
      transformFactory.set(
        "js-get-invoke",
        (list, currentDir) =>
          jsInteropModule.transformJsGetInvoke(list, currentDir, transformNode),
      );
      transformFactory.set(
        "js-set",
        (list, currentDir) =>
          jsInteropModule.transformJsSet(list, currentDir, transformNode),
      );
      transformFactory.set(
        "class",
        (list, currentDir) =>
          classModule.transformClass(list, currentDir, transformNode),
      );
      // method-call is now a macro that expands to js-call
      transformFactory.set(
        "enum",
        (list, currentDir) =>
          enumModule.transformEnumDeclaration(list, currentDir, transformNode),
      );
      transformFactory.set(
        "import",
        (list, currentDir) => {
          // Simple import without specifiers (import "module")
          if (
            list.elements.length === 2 && list.elements[1].type === "literal"
          ) {
            const source = (list.elements[1] as LiteralNode).value as string;
            return {
              type: IR.IRNodeType.ImportDeclaration,
              source,
              specifiers: [],
            } as IR.IRImportDeclaration;
          } // Check if it's a vector import or namespace import
          else if (importExportModule.isVectorImport(list)) {
            return importExportModule.transformVectorImport(list);
          } else if (importExportModule.isNamespaceImport(list)) {
            return importExportModule.transformNamespaceImport(
              list,
              currentDir,
            );
          } else {
            throw new ValidationError(
              "Invalid import statement format",
              "import",
              '(import "module") or (import name from "module") or (import [names] from "module")',
              "invalid format",
            );
          }
        },
      );
      transformFactory.set(
        "export",
        (list, currentDir) => {
          if (importExportModule.isDeclarationExport(list)) {
            return importExportModule.transformDeclarationExport(list, currentDir, transformNode);
          }
          if (importExportModule.isSingleExport(list)) {
            return importExportModule.transformSingleExport(list);
          }
          if (importExportModule.isVectorExport(list)) {
            return importExportModule.transformVectorExport(list, currentDir);
          }
          if (isDefaultExport(list)) {
            return importExportModule.transformDefaultExport(list, currentDir, transformNode);
          }
          throw new ValidationError(
            "Invalid export statement format",
            "export",
            "(export [names]) or (export default <expr>) or (export (decl ...))",
            "invalid format",
          );
        },
      );
      // Dynamic import: (import-dynamic "./module.js") -> import("./module.js")
      transformFactory.set(
        "import-dynamic",
        (list, currentDir) => {
          if (list.elements.length !== 2) {
            throw new ValidationError(
              "import-dynamic requires exactly one argument (the module path)",
              "import-dynamic",
              '(import-dynamic "./module.js")',
              `${list.elements.length - 1} arguments`,
            );
          }
          const sourceNode = transformNode(list.elements[1], currentDir);
          if (!sourceNode) {
            throw new ValidationError(
              "import-dynamic source cannot be null",
              "import-dynamic",
              "expression",
              "null",
            );
          }
          return {
            type: IR.IRNodeType.DynamicImport,
            source: sourceNode,
          } as IR.IRDynamicImport;
        },
      );
      // BigInt literal: (bigint-literal "123") -> 123n
      transformFactory.set(
        "bigint-literal",
        (list, _currentDir) => {
          if (list.elements.length !== 2) {
            throw new ValidationError(
              "bigint-literal requires exactly one argument",
              "bigint-literal",
              "(bigint-literal value)",
              `${list.elements.length - 1} arguments`,
            );
          }
          const valueNode = list.elements[1];
          let value: string;
          if (valueNode.type === "literal") {
            value = String((valueNode as LiteralNode).value);
          } else {
            throw new ValidationError(
              "bigint-literal value must be a literal",
              "bigint-literal",
              "literal value",
              valueNode.type,
            );
          }
          return {
            type: IR.IRNodeType.BigIntLiteral,
            value,
          } as IR.IRBigIntLiteral;
        },
      );

      // Type alias declaration: (deftype Name "type-expression")
      // With generics: (deftype Name<T> "type-expression")
      transformFactory.set(
        "deftype",
        (list, _currentDir) => {
          if (list.elements.length < 3) {
            throw new ValidationError(
              "deftype requires at least 2 arguments: name and type expression",
              "deftype",
              "(deftype Name \"type-expression\")",
              `${list.elements.length - 1} arguments`,
            );
          }
          const nameNode = list.elements[1];
          let fullName: string;
          if (nameNode.type === "symbol") {
            fullName = (nameNode as SymbolNode).name;
          } else if (nameNode.type === "literal") {
            // Allow string literal for names with special characters like "Pair<A, B>"
            fullName = String((nameNode as LiteralNode).value);
          } else {
            throw new ValidationError(
              "deftype name must be a symbol or string literal",
              "deftype",
              "symbol or string name",
              nameNode.type,
            );
          }
          // Parse generic parameters from name like "Name<T, U>"
          let name = fullName;
          let typeParameters: string[] | undefined;
          const genericMatch = fullName.match(/^([^<]+)<(.+)>$/);
          if (genericMatch) {
            name = genericMatch[1];
            typeParameters = genericMatch[2].split(",").map((p: string) => p.trim());
          }
          const typeNode = list.elements[2];
          let typeExpression: string;
          if (typeNode.type === "literal") {
            typeExpression = String((typeNode as LiteralNode).value);
          } else if (typeNode.type === "symbol") {
            typeExpression = (typeNode as SymbolNode).name;
          } else {
            throw new ValidationError(
              "deftype type expression must be a string literal or symbol",
              "deftype",
              "string literal or symbol",
              typeNode.type,
            );
          }
          return {
            type: IR.IRNodeType.TypeAliasDeclaration,
            name,
            typeExpression,
            typeParameters,
          } as IR.IRTypeAliasDeclaration;
        },
      );

      // Interface declaration: (interface Name "{ body }")
      // With generics: (interface Name<T> "{ body }")
      // With extends: (interface Name extends Base "{ body }")
      transformFactory.set(
        "interface",
        (list, _currentDir) => {
          if (list.elements.length < 3) {
            throw new ValidationError(
              "interface requires at least 2 arguments: name and body",
              "interface",
              "(interface Name \"{ ... }\")",
              `${list.elements.length - 1} arguments`,
            );
          }
          let idx = 1;
          const nameNode = list.elements[idx];
          let fullName: string;
          if (nameNode.type === "symbol") {
            fullName = (nameNode as SymbolNode).name;
          } else if (nameNode.type === "literal") {
            // Allow string literal for names with special characters like "Box<A, B>"
            fullName = String((nameNode as LiteralNode).value);
          } else {
            throw new ValidationError(
              "interface name must be a symbol or string literal",
              "interface",
              "symbol or string name",
              nameNode.type,
            );
          }
          // Parse generic parameters from name like "Name<T, U>"
          let name = fullName;
          let typeParameters: string[] | undefined;
          const genericMatch = fullName.match(/^([^<]+)<(.+)>$/);
          if (genericMatch) {
            name = genericMatch[1];
            typeParameters = genericMatch[2].split(",").map((p: string) => p.trim());
          }
          idx++;
          // Check for extends clause
          let extendsClause: string[] | undefined;
          if (list.elements[idx]?.type === "symbol" &&
              (list.elements[idx] as SymbolNode).name === "extends") {
            idx++;
            extendsClause = [];
            // Collect all extends types until we hit the body string
            while (idx < list.elements.length - 1 &&
                   list.elements[idx].type === "symbol") {
              extendsClause.push((list.elements[idx] as SymbolNode).name);
              idx++;
            }
          }
          const bodyNode = list.elements[idx];
          let body: string;
          if (bodyNode.type === "literal") {
            body = String((bodyNode as LiteralNode).value);
          } else {
            throw new ValidationError(
              "interface body must be a string literal",
              "interface",
              "string literal body",
              bodyNode.type,
            );
          }
          return {
            type: IR.IRNodeType.InterfaceDeclaration,
            name,
            body,
            typeParameters,
            extends: extendsClause,
          } as IR.IRInterfaceDeclaration;
        },
      );

      transformFactory.set(
        "get",
        (list, currentDir) =>
          dataStructureModule.transformGet(list, currentDir, transformNode),
      );
      transformFactory.set(
        "js-method",
        (list: ListNode, currentDir: string) => {
          return transformJsMethod(list, currentDir, transformNode);
        },
      );
    },
    "initializeTransformFactory",
    TransformError,
  );
}

// Correct version of transformJsMethod with proper handling of transformNode
export function transformJsMethod(
  list: ListNode,
  currentDir: string,
  transformNodeFunc: TransformNodeFn,
): IR.IRNode | null {
  return perform(
    () => {
      if (list.elements.length !== 3) {
        throw new ValidationError(
          `js-method requires exactly 2 arguments, got ${
            list.elements.length - 1
          }`,
          "js-method",
          "2 arguments",
          `${list.elements.length - 1} arguments`,
        );
      }

      const object = validateTransformed(
        transformNodeFunc(list.elements[1], currentDir),
        "js-method",
        "Object",
      );

      const methodName = jsInteropModule.extractSymbolOrLiteralName(
        list.elements[2],
        "js-method",
        "Method name must be a string literal or symbol",
      );

      // Create a JsMethodAccess node with position for source map accuracy
      const meta = extractMeta(list);
      return {
        type: IR.IRNodeType.JsMethodAccess,
        object,
        method: methodName,
        position: meta ? { line: meta.line, column: meta.column, filePath: meta.filePath } : undefined,
      } as IR.IRJsMethodAccess;
    },
    "transformJsMethod",
    TransformError,
    [list],
  );
}

function transformAsync(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRNode | null {
  return perform(
    () => {
      if (list.elements.length < 2) {
        throw new ValidationError(
          "async requires a function form",
          "async",
          "(async fn ...) or (async fn* ...)",
          `${list.elements.length - 1} arguments`,
        );
      }

      const target = list.elements[1];
      const targetName = target.type === "symbol" ? (target as SymbolNode).name : "";
      const isGenerator = targetName === "fn*";
      const isRegularFn = targetName === "fn";

      if (!isGenerator && !isRegularFn) {
        throw new ValidationError(
          "async currently supports 'fn' and 'fn*' definitions",
          "async",
          "fn or fn*",
          target.type === "symbol" ? targetName : target.type,
        );
      }

      const fnList: ListNode = {
        type: "list",
        elements: list.elements.slice(1),
      };

      let transformed: IR.IRNode;
      if (isGenerator) {
        // Async generator: (async fn* name [params] body...)
        transformed = transformGeneratorFn(fnList, currentDir, transformNode, processFunctionBody);
      } else {
        // Regular async function: (async fn name [params] body...)
        transformed = functionModule.transformFn(
          fnList,
          currentDir,
          transformNode,
          processFunctionBody,
        );
      }

      setAsyncFlag(transformed);

      return transformed;
    },
    "transformAsync",
    TransformError,
    [list],
  );
}

function transformAwait(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRNode {
  return perform(
    () => {
      if (list.elements.length !== 2) {
        throw new ValidationError(
          "await requires exactly one argument",
          "await",
          "1 argument",
          `${list.elements.length - 1} arguments`,
        );
      }

      const argument = validateTransformed(
        transformNode(list.elements[1], currentDir),
        "await",
        "await operand",
      );

      return {
        type: IR.IRNodeType.AwaitExpression,
        argument,
      } as IR.IRAwaitExpression;
    },
    "transformAwait",
    TransformError,
    [list],
  );
}

/**
 * Transform a generator function: (fn* name [params] body...) or (fn* [params] body...)
 */
function transformGeneratorFn(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
  processFunctionBody: (body: HQLNode[], dir: string) => IR.IRNode[],
): IR.IRNode {
  return perform(
    () => {
      // Transform as regular fn, then set generator flag
      const transformed = functionModule.transformFn(
        list,
        currentDir,
        transformNode,
        processFunctionBody,
      );

      // Set generator flag on the function based on its type
      if (transformed.type === IR.IRNodeType.FunctionExpression) {
        (transformed as IR.IRFunctionExpression).generator = true;
      } else if (transformed.type === IR.IRNodeType.FunctionDeclaration) {
        (transformed as IR.IRFunctionDeclaration).generator = true;
      } else if (transformed.type === IR.IRNodeType.FnFunctionDeclaration) {
        // Named fn function
        (transformed as IR.IRFnFunctionDeclaration).generator = true;
      } else if (transformed.type === IR.IRNodeType.VariableDeclaration) {
        // Named function becomes variable declaration with function expression
        const decl = transformed as IR.IRVariableDeclaration;
        if (decl.declarations[0]?.init?.type === IR.IRNodeType.FunctionExpression) {
          (decl.declarations[0].init as IR.IRFunctionExpression).generator = true;
        }
      }

      return transformed;
    },
    "transformGeneratorFn",
    TransformError,
    [list],
  );
}

/**
 * Transform yield expression: (yield value)
 */
function transformYield(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRNode {
  return perform(
    () => {
      // yield can have 0 or 1 argument
      if (list.elements.length > 2) {
        throw new ValidationError(
          "yield takes at most one argument",
          "yield",
          "0 or 1 argument",
          `${list.elements.length - 1} arguments`,
        );
      }

      let argument: IR.IRNode | null = null;
      if (list.elements.length === 2) {
        argument = validateTransformed(
          transformNode(list.elements[1], currentDir),
          "yield",
          "yield operand",
        );
      }

      const node: IR.IRYieldExpression = {
        type: IR.IRNodeType.YieldExpression,
        argument,
        delegate: false,
      };
      copyPosition(list, node);
      return node;
    },
    "transformYield",
    TransformError,
    [list],
  );
}

/**
 * Transform yield* expression: (yield* iterator)
 */
function transformYieldDelegate(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRNode {
  return perform(
    () => {
      if (list.elements.length !== 2) {
        throw new ValidationError(
          "yield* requires exactly one argument",
          "yield*",
          "1 argument",
          `${list.elements.length - 1} arguments`,
        );
      }

      const argument = validateTransformed(
        transformNode(list.elements[1], currentDir),
        "yield*",
        "yield* operand",
      );

      const node: IR.IRYieldExpression = {
        type: IR.IRNodeType.YieldExpression,
        argument,
        delegate: true,
      };
      copyPosition(list, node);
      return node;
    },
    "transformYieldDelegate",
    TransformError,
    [list],
  );
}

/**
 * Check if an IR node or its descendants contain an await expression
 */
function containsAwait(node: IR.IRNode | null): boolean {
  if (!node) return false;

  // Direct match
  if (node.type === IR.IRNodeType.AwaitExpression) {
    return true;
  }

  // Recursively check common node types
  switch (node.type) {
    case IR.IRNodeType.BlockStatement:
      return (node as IR.IRBlockStatement).body.some(containsAwait);

    case IR.IRNodeType.ExpressionStatement:
      return containsAwait((node as IR.IRExpressionStatement).expression);

    case IR.IRNodeType.ReturnStatement:
      return containsAwait((node as IR.IRReturnStatement).argument || null);

    case IR.IRNodeType.CallExpression: {
      const call = node as IR.IRCallExpression;
      return containsAwait(call.callee as IR.IRNode) ||
        call.arguments.some(containsAwait);
    }

    case IR.IRNodeType.BinaryExpression: {
      const bin = node as IR.IRBinaryExpression;
      return containsAwait(bin.left) || containsAwait(bin.right);
    }

    case IR.IRNodeType.UnaryExpression:
      return containsAwait((node as IR.IRUnaryExpression).argument);

    case IR.IRNodeType.ConditionalExpression: {
      const cond = node as IR.IRConditionalExpression;
      return containsAwait(cond.test) ||
        containsAwait(cond.consequent) ||
        containsAwait(cond.alternate);
    }

    case IR.IRNodeType.ArrayExpression:
      return (node as IR.IRArrayExpression).elements.some(containsAwait);

    case IR.IRNodeType.ObjectExpression:
      return (node as IR.IRObjectExpression).properties.some((prop) => {
        if (prop.type === IR.IRNodeType.ObjectProperty) {
          return containsAwait((prop as IR.IRObjectProperty).value);
        }
        return false;
      });

    case IR.IRNodeType.MemberExpression: {
      const member = node as IR.IRMemberExpression;
      return containsAwait(member.object) || containsAwait(member.property);
    }

    case IR.IRNodeType.TryStatement: {
      const tryStmt = node as IR.IRTryStatement;
      return containsAwait(tryStmt.block) ||
        (tryStmt.handler ? containsAwait(tryStmt.handler.body) : false) ||
        (tryStmt.finalizer ? containsAwait(tryStmt.finalizer) : false);
    }

    case IR.IRNodeType.CatchClause:
      return containsAwait((node as IR.IRCatchClause).body);

    case IR.IRNodeType.IfStatement: {
      const ifStmt = node as IR.IRIfStatement;
      return containsAwait(ifStmt.test) ||
        containsAwait(ifStmt.consequent) ||
        (ifStmt.alternate ? containsAwait(ifStmt.alternate) : false);
    }

    case IR.IRNodeType.VariableDeclaration:
      return (node as IR.IRVariableDeclaration).declarations.some(
        containsAwait,
      );

    case IR.IRNodeType.VariableDeclarator:
      return containsAwait((node as IR.IRVariableDeclarator).init || null);

    default:
      return false;
  }
}

function transformTry(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRNode {
  return perform(
    () => {
      if (list.elements.length < 2) {
        throw new ValidationError(
          "try requires a body",
          "try",
          "body expressions",
          `${list.elements.length - 1} arguments`,
        );
      }

      const clauses = list.elements.slice(1);
      const bodyForms: HQLNode[] = [];
      let index = 0;

      const isClause = (expr: HQLNode, name: string): boolean =>
        expr.type === "list" && expr.elements.length > 0 &&
        expr.elements[0].type === "symbol" &&
        ((expr.elements[0] as SymbolNode).name === name);

      while (index < clauses.length) {
        const current = clauses[index];
        if (isClause(current, "catch") || isClause(current, "finally")) {
          break;
        }
        bodyForms.push(current);
        index++;
      }

      if (bodyForms.length === 0) {
        throw new ValidationError(
          "try requires at least one body expression",
          "try",
          "body expression",
          "none",
        );
      }

      const tryBlock = buildBlockFromExpressions(
        bodyForms,
        currentDir,
        transformNode,
        true,
      );

      let handler: IR.IRCatchClause | null = null;
      let finalizer: IR.IRBlockStatement | null = null;

      while (index < clauses.length) {
        const clause = clauses[index];
        if (
          clause.type !== "list" || clause.elements.length === 0 ||
          clause.elements[0].type !== "symbol"
        ) {
          throw new ValidationError(
            "Invalid clause in try",
            "try clause",
            "catch/finally",
            JSON.stringify(clause),
          );
        }

        const clauseName = (clause.elements[0] as SymbolNode).name;
        if (clauseName === "catch") {
          if (handler) {
            throw new ValidationError(
              "Multiple catch clauses are not supported",
              "try",
              "single catch",
              "multiple",
            );
          }

          let bodyStart = 1;
          let param: IR.IRIdentifier | null = null;
          if (
            clause.elements.length > 1 && clause.elements[1].type === "symbol"
          ) {
            const paramName = sanitizeIdentifier(
              (clause.elements[1] as SymbolNode).name,
            );
            param = { type: IR.IRNodeType.Identifier, name: paramName };
            bodyStart = 2;
          } else if (
            clause.elements.length > 1 && clause.elements[1].type === "literal"
          ) {
            const paramName = sanitizeIdentifier(
              String((clause.elements[1] as LiteralNode).value),
            );
            param = { type: IR.IRNodeType.Identifier, name: paramName };
            bodyStart = 2;
          }

          const catchBodyForms = clause.elements.slice(bodyStart);
          if (catchBodyForms.length === 0) {
            throw new ValidationError(
              "catch requires a body",
              "catch",
              "body expressions",
              "none",
            );
          }

          // Extract position from catch clause
          const catchMeta = extractMeta(clause);
          const catchPosition = catchMeta ? { line: catchMeta.line, column: catchMeta.column, filePath: catchMeta.filePath } : undefined;

          handler = {
            type: IR.IRNodeType.CatchClause,
            param,
            body: buildBlockFromExpressions(
              catchBodyForms,
              currentDir,
              transformNode,
              true,
            ),
            position: catchPosition, // Add position
          };
        } else if (clauseName === "finally") {
          if (finalizer) {
            throw new ValidationError(
              "Multiple finally clauses are not supported",
              "try",
              "single finally",
              "multiple",
            );
          }

          const finallyForms = clause.elements.slice(1);
          if (finallyForms.length === 0) {
            throw new ValidationError(
              "finally requires a body",
              "finally",
              "body expressions",
              "none",
            );
          }

          finalizer = buildBlockFromExpressions(
            finallyForms,
            currentDir,
            transformNode,
            false,
          );
        } else {
          throw new ValidationError(
            `Unknown clause '${clauseName}' in try statement`,
            "try",
            "catch/finally",
            clauseName,
          );
        }

        index++;
      }

      // Extract position from the 'try' list
      const listMeta = extractMeta(list);
      const listPosition = listMeta ? { line: listMeta.line, column: listMeta.column, filePath: listMeta.filePath } : undefined;

      const tryStatement: IR.IRTryStatement = {
        type: IR.IRNodeType.TryStatement,
        block: tryBlock,
        handler,
        finalizer,
        position: listPosition, // Add position
      };

      // BUGFIX: Detect if try/catch/finally contain await expressions
      // If they do, the wrapper IIFE must be async
      const needsAsync = containsAwait(tryBlock) ||
        (handler ? containsAwait(handler.body) : false) ||
        (finalizer ? containsAwait(finalizer) : false);

      // The IIFE needs to contain just the try statement
      // ESTree/escodegen should handle this properly without a return
      const functionBody: IR.IRBlockStatement = {
        type: IR.IRNodeType.BlockStatement,
        body: [tryStatement],
        position: listPosition, // Add position
      };

      const functionExpression: IR.IRFunctionExpression = {
        type: IR.IRNodeType.FunctionExpression,
        id: null,
        params: [],
        body: functionBody,
        async: needsAsync, // BUGFIX: Mark as async if contains await
        position: listPosition, // Add position
      };

      return {
        type: IR.IRNodeType.CallExpression,
        callee: functionExpression,
        arguments: [],
        position: listPosition, // Add position
      } as IR.IRCallExpression;
    },
    "transformTry",
    TransformError,
    [list],
  );
}

function buildBlockFromExpressions(
  expressions: HQLNode[],
  currentDir: string,
  transformNode: TransformNodeFn,
  ensureReturn = false,
): IR.IRBlockStatement {
  const statements: IR.IRNode[] = [];
  const lastIndex = expressions.length - 1;

  expressions.forEach((expr, index) => {
    const transformed = transformNode(expr, currentDir);
    if (!transformed) return;

    const isLast = index === lastIndex;

    if (ensureReturn && isLast && isExpressionResult(transformed)) {
      statements.push({
        type: IR.IRNodeType.ReturnStatement,
        argument: transformed,
      } as IR.IRReturnStatement);
      return;
    }

    if (isExpressionResult(transformed)) {
      statements.push({
        type: IR.IRNodeType.ExpressionStatement,
        expression: transformed,
      } as IR.IRExpressionStatement);
    } else {
      statements.push(transformed);
    }
  });

  return {
    type: IR.IRNodeType.BlockStatement,
    body: statements,
  };
}

export function isExpressionResult(node: IR.IRNode): boolean {
  switch (node.type) {
    case IR.IRNodeType.CallExpression:
    case IR.IRNodeType.MemberExpression:
    case IR.IRNodeType.CallMemberExpression:
    case IR.IRNodeType.NewExpression:
    case IR.IRNodeType.BinaryExpression:
    case IR.IRNodeType.UnaryExpression:
    case IR.IRNodeType.ConditionalExpression:
    case IR.IRNodeType.ArrayExpression:
    case IR.IRNodeType.ObjectExpression:
    case IR.IRNodeType.Identifier:
    case IR.IRNodeType.StringLiteral:
    case IR.IRNodeType.NumericLiteral:
    case IR.IRNodeType.BooleanLiteral:
    case IR.IRNodeType.NullLiteral:
    case IR.IRNodeType.AwaitExpression:
    case IR.IRNodeType.AssignmentExpression:
    case IR.IRNodeType.InteropIIFE:
    case IR.IRNodeType.JsMethodAccess:
    case IR.IRNodeType.FunctionExpression:
      return true;
    default:
      return false;
  }
}

/**
 * Transform a single HQL node to its IR representation.
 */
export function transformNode(
  node: HQLNode,
  currentDir: string,
): IR.IRNode | null {
  return perform(
    () => {
      if (!node) {
        throw new ValidationError(
          "Cannot transform null or undefined node",
          "node transformation",
          "valid HQL node",
          "null or undefined",
        );
      }

      logger.debug(`Transforming node of type: ${node.type}`);

      // Dispatch based on node type
      let result: IR.IRNode | null;
      switch (node.type) {
        case "literal":
          result = transformLiteral(node as LiteralNode);
          break;
        case "symbol":
          result = transformSymbol(node as SymbolNode);
          break;
        case "list":
          result = transformList(node as ListNode, currentDir);
          break;
        default: {
          const fallback = (node as { type?: string }).type ?? "unknown";
          logger.warn(`Unknown node type: ${fallback}`);
          result = null;
        }
      }
      return copyPosition(node, result);
    },
    "transformNode",
    TransformError,
    [node],
  );
}

/**
 * Transform a list node, handling special forms and function calls.
 */
function transformList(list: ListNode, currentDir: string): IR.IRNode | null {
  if (list.elements.length === 0) {
    return dataStructureModule.transformEmptyList();
  }

  // Special case for js-get-invoke
  const jsGetInvokeResult = jsInteropModule.transformJsGetInvokeSpecialCase(
    list,
    currentDir,
    transformNode,
  );
  if (jsGetInvokeResult) return jsGetInvokeResult;

  const first = list.elements[0];

  // Handle dot method calls (object.method(...))
  if (
    first.type === "symbol" && (first as SymbolNode).name.startsWith(".") &&
    list.elements.length >= 2
  ) {
    return transformDotMethodCall(list, currentDir);
  }

  if (first.type === "symbol") {
    const op = (first as SymbolNode).name;

    // Skip macro definitions
    if (op === "macro" || op === "macro") {
      logger.debug(`Skipping macro definition: ${op}`);
      return { type: IR.IRNodeType.NullLiteral } as IR.IRNullLiteral;
    }


    // Delegate to appropriate handler based on operation type
    return transformBasedOnOperator(list, op, currentDir);
  }

  // Handle nested lists
  if (first.type === "list") {
    return transformNestedList(list, currentDir);
  }

  // Default case: standard function call
  return transformStandardFunctionCall(list, currentDir);
}

/**
 * Transform dot method calls (.methodName object arg1 arg2...)
 */
function transformDotMethodCall(list: ListNode, currentDir: string): IR.IRNode {
  const methodSymbol = list.elements[0] as SymbolNode;
  const methodName = methodSymbol.name.substring(1);

  // The object is the SECOND element (after the method name)
  const object = validateTransformed(
    transformNode(list.elements[1], currentDir),
    "method call object",
    "Object in method call",
  );

  // Arguments are all elements AFTER the object (starting from the third element)
  // Handle spread operators in arguments
  const args: IR.IRNode[] = [];
  for (const arg of list.elements.slice(2)) {
    if (isSpreadOperator(arg)) {
      args.push(transformSpreadOperator(arg, currentDir, transformNode, "spread in method call"));
    } else {
      args.push(validateTransformed(
        transformNode(arg, currentDir),
        "method argument",
        "Method argument",
      ));
    }
  }

  // Create the call expression with member expression as callee
  return {
    type: IR.IRNodeType.CallExpression,
    callee: {
      type: IR.IRNodeType.MemberExpression,
      object: object,
      property: {
        type: IR.IRNodeType.Identifier,
        name: methodName,
      } as IR.IRIdentifier,
      computed: false,
    } as IR.IRMemberExpression,
    arguments: args,
  } as IR.IRCallExpression;
}

/**
 * Transform list based on the operator type
 */
function transformBasedOnOperator(
  list: ListNode,
  op: string,
  currentDir: string,
): IR.IRNode | null {
  // First check if this is a method call
  if (op.startsWith(".")) {
    return classModule.transformMethodCall(list, currentDir, transformNode);
  }

  // Check for import/export forms which have special handling
  // Declaration exports must be checked BEFORE vector exports
  // because both have list as second element
  if (isDeclarationExport(list)) {
    return importExportModule.transformDeclarationExport(list, currentDir, transformNode);
  }
  if (isSingleExport(list)) {
    return importExportModule.transformSingleExport(list);
  }
  if (isVectorExport(list)) {
    return importExportModule.transformVectorExport(list, currentDir);
  }
  if (isDefaultExport(list)) {
    return importExportModule.transformDefaultExport(list, currentDir, transformNode);
  }

  if (isVectorImport(list)) {
    return importExportModule.transformVectorImport(list);
  }

  if (isNamespaceImport(list)) {
    return importExportModule.transformNamespaceImport(list, currentDir);
  }

  // Handle optional chaining method calls (obj?.greet "World")
  if (op.includes("?.") && !op.startsWith("js/") && !op.startsWith("...")) {
    return transformOptionalChainMethodCall(list, op, currentDir, transformNode);
  }

  // Handle dot notation for property access (obj.prop)
  if (jsInteropModule.isDotNotation(op)) {
    return jsInteropModule.transformDotNotation(
      list,
      op,
      currentDir,
      transformNode,
    );
  }

  // Handle registered fn functions
  const fnDef = functionModule.getFnFunction(op);
  if (fnDef) {
    logger.debug(`Processing call to fn function ${op}`);
    return functionModule.processFnFunctionCall(
      op,
      fnDef,
      list.elements.slice(1),
      currentDir,
      transformNode,
      list, // Pass source list for position extraction
    );
  }

  // Handle registered fx functions
  // REMOVED: fx function call handling

  // Handle built-in operations via the transform factory
  const handler = transformFactory.get(op);
  if (handler) {
    return perform(
      () => handler(list, currentDir),
      `handler for '${op}'`,
      TransformError,
      [list],
    );
  }

  // Handle primitive operations
  if (primitiveModule.isPrimitiveOp(op)) {
    return primitiveModule.transformPrimitiveOp(
      list,
      currentDir,
      transformNode,
    );
  }

  // This is the critical part - determine if this is a function call or collection access
  if (!isBuiltInOperator(op)) {
    return determineCallOrAccess(list, currentDir, transformNode);
  }

  // Fallback to standard function call
  return transformStandardFunctionCall(list, currentDir);
}

/**
 * Check if an operator is a built-in syntax or primitive
 */
function isBuiltInOperator(op: string): boolean {
  return (
    primitiveModule.isKernelPrimitive(op) ||
    primitiveModule.isPrimitiveDataStructure(op) ||
    primitiveModule.isPrimitiveClass(op) ||
    op.startsWith("js-")
  );
}

/**
 * Determines if a list represents a function call or a collection access.
 * For example, (myFunction arg) is a function call, while (myArray 0) is a collection access.
 * This function makes the determination based on structural analysis rather than naming patterns.
 */
/**
 * Determines if a list represents a function call or a collection access.
 */
function determineCallOrAccess(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  const elements = list.elements;

  // Handle empty list case
  if (elements.length === 0) {
    return dataStructureModule.transformEmptyList();
  }

  // Handle single-element list
  if (elements.length === 1) {
    const only = elements[0];
    // If it's a symbol, treat as function call with zero args
    if (only.type === "symbol") {
      return {
        type: IR.IRNodeType.CallExpression,
        callee: {
          type: IR.IRNodeType.Identifier,
          name: sanitizeIdentifier(only.name),
        },
        arguments: [],
      } as IR.IRCallExpression;
    } else {
      // Otherwise, just transform the single element (for e.g., nested list)
      const singleElement = transformNode(only, currentDir);
      if (!singleElement) {
        throw new TransformError(
          "Single element transformed to null",
          JSON.stringify(list),
          "Single element transformation",
        );
      }
      return singleElement;
    }
  }

  // Transform the first element
  const firstTransformed = transformNode(elements[0], currentDir);
  if (!firstTransformed) {
    throw new TransformError(
      "First element transformed to null",
      JSON.stringify(list),
      "Function or collection access",
    );
  }

  // Handle special patterns for (obj arg) expressions
  if (elements.length === 2) {
    const symbolInfo = globalSymbolTable.get(
      (firstTransformed as IR.IRIdentifier).name,
    );

    if (symbolInfo?.kind == "function") {
      return createCallExpression(
        list,
        currentDir,
        transformNode,
        firstTransformed,
      );
    }

    const secondElement = elements[1];

    // Special case 1: Property access with string literals (person "hobbies") -> get(person, "hobbies")
    const isStringLiteral = (secondElement.type === "literal" &&
      typeof (secondElement as LiteralNode).value === "string") ||
      (secondElement.type === "symbol" &&
        (secondElement as SymbolNode).name.startsWith('"'));

    if (isStringLiteral) {
      const keyTransformed = transformNode(secondElement, currentDir);
      if (!keyTransformed) {
        throw new TransformError(
          "Key transformed to null",
          JSON.stringify(list),
          "Function or collection access",
        );
      }

      // Generate property access via get function
      return createPropertyAccessWithFallback(firstTransformed, keyTransformed);
    }

    // Special case 2: Handle numeric indexing patterns - (obj 0) expressions
    // Example: For constructs like (entry 0), (array 1), etc.
    const isNumberLiteral = secondElement.type === "literal" &&
      typeof (secondElement as LiteralNode).value === "number";

    if (isNumberLiteral) {
      const keyTransformed = transformNode(secondElement, currentDir);
      if (!keyTransformed) {
        throw new TransformError(
          "Key transformed to null",
          JSON.stringify(list),
          "Function or collection access",
        );
      }

      // Create a numeric fallback that tries both array access and function call
      // This resolves the ambiguity at runtime without using any hacks or heuristics
      return createNumericAccessWithFallback(firstTransformed, keyTransformed);
    } else {
      // For non-numeric cases (including function calls)
      return createCallExpression(
        list,
        currentDir,
        transformNode,
        firstTransformed,
      );
    }
  }

  // Default case: treat as a function call
  return createCallExpression(
    list,
    currentDir,
    transformNode,
    firstTransformed,
  );
}

/**
 * Generate an IR node for property access with function call fallback
 */
function createPropertyAccessWithFallback(
  objectNode: IR.IRNode,
  keyNode: IR.IRNode,
): IR.IRNode {
  // Simply generate a call to a get function that will check the property first
  // and fall back to function call if needed
  // Equivalent to: get(person, "hobbies")
  return {
    type: IR.IRNodeType.CallExpression,
    callee: {
      type: IR.IRNodeType.Identifier,
      name: GET_HELPER,
    } as IR.IRIdentifier,
    arguments: [objectNode, keyNode],
  } as IR.IRCallExpression;
}

// Create a numeric access with fallback to function call
// This will try array access first, and if that fails, it will call the target as a function
function createNumericAccessWithFallback(
  objectNode: IR.IRNode,
  keyNode: IR.IRNode,
): IR.IRNode {
  return {
    type: IR.IRNodeType.CallExpression,
    callee: {
      type: IR.IRNodeType.Identifier,
      name: GET_NUMERIC_HELPER,
    } as IR.IRIdentifier,
    arguments: [objectNode, keyNode],
  } as IR.IRCallExpression;
}

/**
 * Helper function to create a call expression
 */
function createCallExpression(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
  callee: IR.IRNode,
): IR.IRCallExpression {
  const args: IR.IRNode[] = [];
  for (let i = 1; i < list.elements.length; i++) {
    const elem = list.elements[i];

    // Check if this argument is a spread operator (...args or (... expr))
    if (isSpreadOperator(elem)) {
      args.push(transformSpreadOperator(elem, currentDir, transformNode, "spread in function call"));
    } else {
      const arg = transformNode(elem, currentDir);
      if (!arg) {
        throw new TransformError(
          `Argument ${i} transformed to null`,
          JSON.stringify(list),
          "Function argument",
        );
      }
      args.push(arg);
    }
  }

  return {
    type: IR.IRNodeType.CallExpression,
    callee: callee,
    arguments: args,
  } as IR.IRCallExpression;
}

/**
 * Transform a literal node to its IR representation.
 */
function transformLiteral(lit: LiteralNode): IR.IRNode {
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
function transformTemplateLiteral(
  list: ListNode,
  currentDir: string,
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

// FIRST_CLASS_OPERATORS imported from ../keyword/primitives.ts (single source of truth)

/**
 * Parse optional chain segments from a symbol like "user?.name" or "data?.user?.address?.city"
 * Returns array of segments: [{name: "user", optional: false}, {name: "name", optional: true}]
 */
function parseOptionalChainSegments(name: string): { name: string; optional: boolean }[] {
  const segments: { name: string; optional: boolean }[] = [];

  // Split by both ?. and . while preserving which type of access it was
  // E.g., "obj?.a.b?.c" -> ["obj", "?.a", ".b", "?.c"]
  let current = "";
  let i = 0;

  while (i < name.length) {
    if (name[i] === "?" && name[i + 1] === ".") {
      // Found optional access
      if (current) {
        segments.push({ name: current, optional: false });
      }
      current = "";
      i += 2; // Skip ?.
      // Parse the property name
      while (i < name.length && name[i] !== "?" && name[i] !== ".") {
        current += name[i];
        i++;
      }
      if (current) {
        segments.push({ name: current, optional: true });
        current = "";
      }
    } else if (name[i] === ".") {
      // Found regular access
      if (current) {
        segments.push({ name: current, optional: false });
      }
      current = "";
      i++; // Skip .
      // Parse the property name
      while (i < name.length && name[i] !== "?" && name[i] !== ".") {
        current += name[i];
        i++;
      }
      if (current) {
        segments.push({ name: current, optional: false });
        current = "";
      }
    } else {
      current += name[i];
      i++;
    }
  }

  if (current) {
    segments.push({ name: current, optional: false });
  }

  return segments;
}

/**
 * Transform optional chain symbol to IR.
 * E.g., "user?.name" -> OptionalMemberExpression(Identifier("user"), "name", optional: true)
 * E.g., "data?.user?.address" -> OptionalMemberExpression(OptionalMemberExpression(Identifier("data"), "user"), "address")
 */
function transformOptionalChainSymbol(name: string): IR.IRNode {
  const segments = parseOptionalChainSegments(name);

  if (segments.length === 0) {
    throw new TransformError(`Invalid optional chain: ${name}`, name, "optional chain");
  }

  // Start with the first segment as an identifier
  const baseObjectName = sanitizeIdentifier(segments[0].name);
  const objectName = baseObjectName === "self" ? "this" : baseObjectName;

  let current: IR.IRNode = {
    type: IR.IRNodeType.Identifier,
    name: objectName,
  } as IR.IRIdentifier;

  // Build chain from left to right
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const propName = sanitizeIdentifier(seg.name);
    const propNode: IR.IRIdentifier = {
      type: IR.IRNodeType.Identifier,
      name: propName,
    };

    if (seg.optional) {
      current = {
        type: IR.IRNodeType.OptionalMemberExpression,
        object: current,
        property: propNode,
        computed: false,
        optional: true,
      } as IR.IROptionalMemberExpression;
    } else {
      current = {
        type: IR.IRNodeType.MemberExpression,
        object: current,
        property: propNode,
        computed: false,
      } as IR.IRMemberExpression;
    }
  }

  return current;
}

/**
 * Transform optional chain method calls.
 * E.g., (obj?.greet "World") -> obj?.greet("World")
 */
function transformOptionalChainMethodCall(
  list: ListNode,
  op: string,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      // Parse the chain to get the callee as an OptionalMemberExpression/MemberExpression
      const callee = transformOptionalChainSymbol(op);

      // Transform arguments
      const args: IR.IRNode[] = [];
      for (let i = 1; i < list.elements.length; i++) {
        const argResult = transformNode(list.elements[i], currentDir);
        if (argResult) {
          args.push(argResult);
        }
      }

      // Create a regular CallExpression with the optional chain callee
      return {
        type: IR.IRNodeType.CallExpression,
        callee,
        arguments: args,
      } as IR.IRCallExpression;
    },
    `transformOptionalChainMethodCall '${op}'`,
    TransformError,
    [list],
  );
}

/**
 * Transform a symbol node to its IR representation.
 */
function transformSymbol(sym: SymbolNode): IR.IRNode {
  return perform(
    () => {
      let name = sym.name;
      let isJS = false;

      // Special handling for placeholder symbol
      if (name === "_") {
        // Transform it to a string literal "_" instead of an identifier
        return {
          type: IR.IRNodeType.StringLiteral,
          value: "_",
        } as IR.IRStringLiteral;
      }

      // Handle operators as first-class values (e.g., for (reduce + 0 nums))
      // When an operator symbol appears in value position, call runtime lookup
      if (FIRST_CLASS_OPERATORS.has(name)) {
        return {
          type: IR.IRNodeType.CallExpression,
          callee: { type: IR.IRNodeType.Identifier, name: GET_OP_HELPER } as IR.IRIdentifier,
          arguments: [{ type: IR.IRNodeType.StringLiteral, value: name } as IR.IRStringLiteral],
        } as IR.IRCallExpression;
      }

      // Handle optional chaining: user?.name, data?.user?.address
      if (name.includes("?.") && !name.startsWith("js/") && !name.startsWith("...")) {
        return transformOptionalChainSymbol(name);
      }

      // Exclude spread operators (...identifier) from dot notation handling
      if (name.includes(".") && !name.startsWith("js/") && !name.startsWith("...")) {
        const parts = name.split(".");
        const baseObjectName = sanitizeIdentifier(parts[0]);
        const objectName = baseObjectName === "self" ? "this" : baseObjectName;
        const propertyName = parts.slice(1).join(".");
        // Include position from the source symbol for accurate error mapping
        const meta = extractMeta(sym);
        return {
          type: IR.IRNodeType.InteropIIFE,
          object: {
            type: IR.IRNodeType.Identifier,
            name: objectName,
          } as IR.IRIdentifier,
          property: {
            type: IR.IRNodeType.StringLiteral,
            value: propertyName,
          } as IR.IRStringLiteral,
          position: meta ? { line: meta.line, column: meta.column, filePath: meta.filePath } : undefined,
        } as IR.IRInteropIIFE;
      }

      if (name.startsWith("js/")) {
        name = name.slice(3);
        isJS = true;
      }

      if (!isJS) {
        name = sanitizeIdentifier(name);
      } else {
        name = hyphenToUnderscore(name);
      }

      return { type: IR.IRNodeType.Identifier, name, isJS } as IR.IRIdentifier;
    },
    `transformSymbol '${sym.name}'`,
    TransformError,
    [sym],
  );
}

/**
 * Transform a nested list (list where first element is also a list).
 */
function transformNestedList(list: ListNode, currentDir: string): IR.IRNode {
  return perform(
    () => {
      const innerExpr = validateTransformed(
        transformNode(list.elements[0], currentDir),
        "nested list",
        "Inner list",
      );

      if (list.elements.length > 1) {
        const second = list.elements[1];

        // Handle method call notation (list).method(args)
        if (
          second.type === "symbol" &&
          (second as SymbolNode).name.startsWith(".")
        ) {
          return transformNestedMethodCall(list, innerExpr, currentDir);
        } // IIFE: If inner expr is a function, treat subsequent elements as arguments, not property access
        // This fixes ((fn [x] x) arg) -> function call, not property access
        else if (innerExpr.type === IR.IRNodeType.FunctionExpression) {
          const args = transformElements(
            list.elements.slice(1),
            currentDir,
            transformNode,
            "function argument",
            "Argument",
          );
          return {
            type: IR.IRNodeType.CallExpression,
            callee: innerExpr,
            arguments: args,
          } as IR.IRCallExpression;
        } // Handle property access (list).property - but only for non-function inner expressions
        else if (second.type === "symbol") {
          return {
            type: IR.IRNodeType.MemberExpression,
            object: innerExpr,
            property: {
              type: IR.IRNodeType.Identifier,
              name: sanitizeIdentifier((second as SymbolNode).name),
            } as IR.IRIdentifier,
            computed: false,
          } as IR.IRMemberExpression;
        } // Function call with the nested list as the callee
        else {
          const args = transformElements(
            list.elements.slice(1),
            currentDir,
            transformNode,
            "function argument",
            "Argument",
          );

          return {
            type: IR.IRNodeType.CallExpression,
            callee: innerExpr,
            arguments: args,
          } as IR.IRCallExpression;
        }
      }

      // A single-element nested list ((expr)) means: evaluate expr and call the result
      // This handles both ((fn [] 42)) and ((outer)) where outer returns a function
      // In Lisp/Clojure semantics, wrapping in extra parens = call the result
      return {
        type: IR.IRNodeType.CallExpression,
        callee: innerExpr as unknown as IR.IRFunctionExpression,
        arguments: [],
      } as IR.IRCallExpression;
    },
    "transformNestedList",
    TransformError,
    [list],
  );
}

/**
 * Handle nested method calls like ((foo) .bar arg1 arg2)
 */
function transformNestedMethodCall(
  list: ListNode,
  innerExpr: IR.IRNode,
  currentDir: string,
): IR.IRNode {
  const methodName = (list.elements[1] as SymbolNode).name.substring(1);
  const args = list.elements.slice(2).map((arg) =>
    validateTransformed(
      transformNode(arg, currentDir),
      "method argument",
      "Argument",
    )
  );

  return {
    type: IR.IRNodeType.CallExpression,
    callee: {
      type: IR.IRNodeType.MemberExpression,
      object: innerExpr,
      property: {
        type: IR.IRNodeType.Identifier,
        name: methodName,
      } as IR.IRIdentifier,
      computed: false,
    } as IR.IRMemberExpression,
    arguments: args,
  } as IR.IRCallExpression;
}
