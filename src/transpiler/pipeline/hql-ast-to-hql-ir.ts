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
  LAZY_SEQ_HELPER,
  DELAY_HELPER,
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
  setCurrentSymbolTable as setImportExportSymbolTable,
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
import * as asyncGeneratorsModule from "./transform/async-generators.ts";
import * as tryCatchModule from "./transform/try-catch.ts";
import * as literalsModule from "./transform/literals.ts";
import { globalSymbolTable, type SymbolTable } from "../symbol_table.ts";
import { getSymbolTable, type CompilerContext } from "../compiler-context.ts";

// Module-level symbol table for current IR transformation
// Set by transformToIR, used throughout the transformation
// This enables isolation when context.symbolTable is provided
let currentSymbolTable: SymbolTable = globalSymbolTable;

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

// Pre-compiled regex for extracting generic type parameters (required format)
// Pattern: "Array<T>" matches, but "Array" does not (unlike GENERIC_NAME_REGEX)
const GENERIC_TYPE_PARAMS_REGEX = /^([^<]+)<(.+)>$/;

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
    case IR.IRNodeType.AbstractClassDeclaration:
    case IR.IRNodeType.AbstractMethod:
    case IR.IRNodeType.DeclareStatement:
    case IR.IRNodeType.NamespaceDeclaration:
    case IR.IRNodeType.ConstEnumDeclaration:
    case IR.IRNodeType.FunctionOverload:
    // Native type expressions (should not be wrapped)
    case IR.IRNodeType.TypeReference:
    case IR.IRNodeType.KeyofType:
    case IR.IRNodeType.IndexedAccessType:
    case IR.IRNodeType.ConditionalType:
    case IR.IRNodeType.MappedType:
    case IR.IRNodeType.UnionType:
    case IR.IRNodeType.IntersectionType:
    case IR.IRNodeType.TupleType:
    case IR.IRNodeType.ArrayType:
    case IR.IRNodeType.FunctionTypeExpr:
    case IR.IRNodeType.InferType:
    case IR.IRNodeType.ReadonlyType:
    case IR.IRNodeType.TypeofType:
    case IR.IRNodeType.LiteralType:
    case IR.IRNodeType.RestType:
    case IR.IRNodeType.OptionalType:
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
 * @param nodes - AST nodes to transform
 * @param currentDir - Current directory for path resolution
 * @param context - Optional compiler context for isolated compilation
 */
export function transformToIR(
  nodes: HQLNode[],
  currentDir: string,
  context?: CompilerContext,
): IR.IRProgram {
  // Use context-specific symbol table if provided, otherwise global
  currentSymbolTable = getSymbolTable(context);
  // Sync import-export module with current symbol table
  setImportExportSymbolTable(currentSymbolTable);

  if (transformFactory.size === 0) {
    initializeTransformFactory();
  }

  // Reset IIFE depth at the start of each transform
  resetIIFEDepth();

  const body: IR.IRNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const ir = transformHQLNodeToIR(nodes[i], currentDir);
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
  // Initialize the async-generators module with helper functions
  asyncGeneratorsModule.initHelpers({
    setAsyncFlag,
    extractMeta,
    copyPosition,
  });

  // Initialize the try-catch module with helper functions
  tryCatchModule.initHelpers({
    extractMeta,
    isExpressionResult,
  });

  perform(
    () => {
      transformFactory.set(
        "quote",
        (list, currentDir) =>
          quoteModule.transformQuote(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "quasiquote",
        (list, currentDir) =>
          quoteModule.transformQuasiquote(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "unquote",
        (list, currentDir) =>
          quoteModule.transformUnquote(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "unquote-splicing",
        (list, currentDir) =>
          quoteModule.transformUnquoteSplicing(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        VECTOR_SYMBOL,
        (list, currentDir) =>
          dataStructureModule.transformVector(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "hash-set",
        (list, currentDir) =>
          dataStructureModule.transformHashSet(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        HASH_MAP_USER,
        (list, currentDir) =>
          dataStructureModule.transformHashMap(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        HASH_MAP_INTERNAL,
        (list, currentDir) =>
          dataStructureModule.transformHashMap(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "new",
        (list, currentDir) =>
          dataStructureModule.transformNew(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "fn",
        (list, currentDir) =>
          functionModule.transformFn(
            list,
            currentDir,
            transformHQLNodeToIR,
            processFunctionBody,
          ),
      );
      // defn is an alias for fn (used for REPL memory persistence)
      transformFactory.set(
        "defn",
        (list, currentDir) =>
          functionModule.transformFn(
            list,
            currentDir,
            transformHQLNodeToIR,
            processFunctionBody,
          ),
      );
      // Generator function: (fn* name [params] body...) or (fn* [params] body...)
      transformFactory.set(
        "fn*",
        (list, currentDir) =>
          asyncGeneratorsModule.transformGeneratorFn(list, currentDir, transformHQLNodeToIR, processFunctionBody),
      );
      // Yield expression: (yield value) or (yield* iterator)
      transformFactory.set(
        "yield",
        (list, currentDir) => asyncGeneratorsModule.transformYield(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "yield*",
        (list, currentDir) => asyncGeneratorsModule.transformYieldDelegate(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "=>",
        (list, currentDir) =>
          functionModule.transformArrowLambda(
            list,
            currentDir,
            transformHQLNodeToIR,
            processFunctionBody,
          ),
      );
      transformFactory.set(
        "async",
        (list, currentDir) => asyncGeneratorsModule.transformAsync(list, currentDir, transformHQLNodeToIR),
      );
      // Note: `range` is no longer a special form - it's a stdlib function
      // available globally via STDLIB_PUBLIC_API injection in runtime-helpers.ts
      transformFactory.set(
        "await",
        (list, currentDir) => asyncGeneratorsModule.transformAwait(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "const",
        (list, currentDir) =>
          bindingModule.transformConst(list, currentDir, transformHQLNodeToIR),
      );
      // def is an alias for const (used for REPL memory persistence)
      transformFactory.set(
        "def",
        (list, currentDir) =>
          bindingModule.transformConst(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "let",
        (list, currentDir) =>
          bindingModule.transformLet(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "var",
        (list, currentDir) =>
          bindingModule.transformVar(list, currentDir, transformHQLNodeToIR),
      );
      // "set!" removed - now handled by "=" operator in primitive.ts
      transformFactory.set(
        "if",
        (list, currentDir) =>
          conditionalModule.transformIf(
            list,
            currentDir,
            transformHQLNodeToIR,
            loopRecurModule.hasLoopContext,
          ),
      );
      transformFactory.set(
        "?",
        (list, currentDir) =>
          conditionalModule.transformTernary(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "template-literal",
        (list, currentDir) =>
          literalsModule.transformTemplateLiteral(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "do",
        (list, currentDir) =>
          conditionalModule.transformDo(list, currentDir, transformHQLNodeToIR),
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
            const transformed = transformHQLNodeToIR(bodyExprs[0], currentDir);
            bodyNode = transformed || { type: IR.IRNodeType.NullLiteral } as IR.IRNullLiteral;
          } else {
            // Multiple expressions - wrap in do
            bodyNode = conditionalModule.transformDo(
              { ...list, elements: [list.elements[0], ...bodyExprs] } as ListNode,
              currentDir,
              transformHQLNodeToIR,
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
      // delay special form for explicit laziness (like Clojure)
      // (delay body) → __hql_delay(() => body)
      transformFactory.set(
        "delay",
        (list, currentDir) => {
          // Get body expressions (skip the 'delay' symbol)
          const bodyExprs = list.elements.slice(1);

          // If no body, return call to __hql_delay with null-returning thunk
          if (bodyExprs.length === 0) {
            return {
              type: IR.IRNodeType.CallExpression,
              callee: { type: IR.IRNodeType.Identifier, name: DELAY_HELPER } as IR.IRIdentifier,
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
            const transformed = transformHQLNodeToIR(bodyExprs[0], currentDir);
            bodyNode = transformed || { type: IR.IRNodeType.NullLiteral } as IR.IRNullLiteral;
          } else {
            // Multiple expressions - wrap in do
            bodyNode = conditionalModule.transformDo(
              { ...list, elements: [list.elements[0], ...bodyExprs] } as ListNode,
              currentDir,
              transformHQLNodeToIR,
            );
          }

          // Create: __hql_delay(() => { return body; })
          return {
            type: IR.IRNodeType.CallExpression,
            callee: { type: IR.IRNodeType.Identifier, name: DELAY_HELPER } as IR.IRIdentifier,
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
        (list, currentDir) => tryCatchModule.transformTry(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "loop",
        (list, currentDir) =>
          loopRecurModule.transformLoop(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "recur",
        (list, currentDir) =>
          loopRecurModule.transformRecur(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "continue",
        (list, currentDir) =>
          loopRecurModule.transformContinue(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "break",
        (list, currentDir) =>
          loopRecurModule.transformBreak(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "for-of",
        (list, currentDir) =>
          loopRecurModule.transformForOf(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "for-await-of",
        (list, currentDir) =>
          loopRecurModule.transformForAwaitOf(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "label",
        (list, currentDir) =>
          loopRecurModule.transformLabel(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "return",
        (list, currentDir) =>
          conditionalModule.transformReturn(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "throw",
        (list, currentDir) =>
          conditionalModule.transformThrow(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "switch",
        (list, currentDir) =>
          conditionalModule.transformSwitch(list, currentDir, transformHQLNodeToIR),
      );
      // case: Expression-based switch (Clojure-style, returns values)
      transformFactory.set(
        "case",
        (list, currentDir) =>
          conditionalModule.transformCase(list, currentDir, transformHQLNodeToIR),
      );

      transformFactory.set(
        "js-new",
        (list, currentDir) =>
          jsInteropModule.transformJsNew(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "js-get",
        (list, currentDir) =>
          jsInteropModule.transformJsGet(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "js-call",
        (list, currentDir) =>
          jsInteropModule.transformJsCall(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "js-get-invoke",
        (list, currentDir) =>
          jsInteropModule.transformJsGetInvoke(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "js-set",
        (list, currentDir) =>
          jsInteropModule.transformJsSet(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "class",
        (list, currentDir) =>
          classModule.transformClass(list, currentDir, transformHQLNodeToIR),
      );
      // method-call is now a macro that expands to js-call
      transformFactory.set(
        "enum",
        (list, currentDir) =>
          enumModule.transformEnumDeclaration(list, currentDir, transformHQLNodeToIR),
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
            return importExportModule.transformDeclarationExport(list, currentDir, transformHQLNodeToIR);
          }
          if (importExportModule.isSingleExport(list)) {
            return importExportModule.transformSingleExport(list);
          }
          if (importExportModule.isVectorExport(list)) {
            return importExportModule.transformVectorExport(list, currentDir);
          }
          if (isDefaultExport(list)) {
            return importExportModule.transformDefaultExport(list, currentDir, transformHQLNodeToIR);
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
          const sourceNode = transformHQLNodeToIR(list.elements[1], currentDir);
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

      // =========================================================================
      // Native TypeScript Type Expression Parser
      // =========================================================================

      /**
       * Parse a type expression from HQL AST to IR type expression
       * Supports native HQL syntax for TypeScript types:
       * - Simple types: number, string, Person
       * - Generic types: Array<T>, Map<K,V>
       * - Union: (| A B C) → A | B | C
       * - Intersection: (& A B C) → A & B & C
       * - Keyof: (keyof T) → keyof T
       * - Indexed access: ([] T K) → T[K]
       * - Conditional: (if-extends T U Then Else) → T extends U ? Then : Else
       * - Tuple: (tuple A B C) → [A, B, C]
       * - Array: (array T) → T[]
       * - Readonly: (readonly T) → readonly T
       * - Infer: (infer T) → infer T
       * - Typeof: (typeof expr) → typeof expr
       * - Mapped: (mapped K T ValueType) → { [K in T]: ValueType }
       * - Function: (-> [params] ReturnType) → (params) => ReturnType
       */
      function parseTypeExpression(node: HQLNode): IR.IRTypeExpression | string {
        // String literal - pass through
        if (node.type === "literal") {
          const value = (node as LiteralNode).value;
          if (typeof value === "string") {
            return value; // String passthrough for complex expressions
          }
          // Literal type (number, boolean)
          return {
            type: IR.IRNodeType.LiteralType,
            value: value as string | number | boolean,
          } as IR.IRLiteralType;
        }

        // Symbol - type reference
        if (node.type === "symbol") {
          const name = (node as SymbolNode).name;
          // Check for generic syntax in symbol: Array<T>
          const genericMatch = name.match(GENERIC_TYPE_PARAMS_REGEX);
          if (genericMatch) {
            const baseName = genericMatch[1];
            const args = genericMatch[2].split(",").map((s) => s.trim());
            return {
              type: IR.IRNodeType.TypeReference,
              name: baseName,
              typeArguments: args.map((arg) => ({
                type: IR.IRNodeType.TypeReference,
                name: arg,
              })) as IR.IRTypeExpression[],
            } as IR.IRTypeReference;
          }
          return {
            type: IR.IRNodeType.TypeReference,
            name,
          } as IR.IRTypeReference;
        }

        // List - compound type expression
        if (node.type === "list") {
          const elements = (node as ListNode).elements;
          if (elements.length === 0) {
            throw new TransformError("Empty type expression", node.position);
          }

          const op = elements[0];
          if (op.type !== "symbol") {
            throw new TransformError(
              "Type expression must start with an operator",
              node.position,
            );
          }

          const opName = (op as SymbolNode).name;

          // Helper to convert element to type expression, checking if it's a string literal
          const toTypeExpr = (el: HQLNode): IR.IRTypeExpression => {
            // If the element is a string literal, check if it's a simple literal or complex expression
            if (el.type === "literal" && typeof (el as LiteralNode).value === "string") {
              const value = (el as LiteralNode).value as string;
              // If it looks like a complex type expression, parse it as TypeReference
              if (value.includes(" ") || value.includes("|") || value.includes("&") ||
                  value.includes("<") || value.includes("(") || value.includes("{")) {
                return { type: IR.IRNodeType.TypeReference, name: value } as IR.IRTypeReference;
              }
              // Otherwise, it's a string literal type like "pending" or "active"
              return { type: IR.IRNodeType.LiteralType, value } as IR.IRLiteralType;
            }
            const parsed = parseTypeExpression(el);
            return typeof parsed === "string"
              ? ({ type: IR.IRNodeType.TypeReference, name: parsed } as IR.IRTypeReference)
              : parsed;
          };

          switch (opName) {
            case "|": {
              // Union type: (| A B C) → A | B | C
              const types = elements.slice(1).map(toTypeExpr);
              return {
                type: IR.IRNodeType.UnionType,
                types,
              } as IR.IRUnionType;
            }

            case "&": {
              // Intersection type: (& A B C) → A & B & C
              const types = elements.slice(1).map(toTypeExpr);
              return {
                type: IR.IRNodeType.IntersectionType,
                types,
              } as IR.IRIntersectionType;
            }

            case "keyof": {
              // Keyof: (keyof T) → keyof T
              if (elements.length < 2) {
                throw new TransformError("keyof requires a type argument", node.position);
              }
              const arg = parseTypeExpression(elements[1]);
              return {
                type: IR.IRNodeType.KeyofType,
                argument: typeof arg === "string"
                  ? ({ type: IR.IRNodeType.TypeReference, name: arg } as IR.IRTypeReference)
                  : arg,
              } as IR.IRKeyofType;
            }

            case "[]":
            case "indexed": {
              // Indexed access: ([] T K) → T[K]
              if (elements.length < 3) {
                throw new TransformError("Indexed access requires object and index types", node.position);
              }
              const objType = parseTypeExpression(elements[1]);
              const idxElement = elements[2];
              // Special handling for index: if it's a string literal, treat as LiteralType
              // This ensures (indexed Person "name") → Person["name"]
              let idxTypeResult: IR.IRTypeExpression;
              if (idxElement.type === "literal" && typeof (idxElement as LiteralNode).value === "string") {
                idxTypeResult = {
                  type: IR.IRNodeType.LiteralType,
                  value: (idxElement as LiteralNode).value as string,
                } as IR.IRLiteralType;
              } else {
                const idxType = parseTypeExpression(idxElement);
                idxTypeResult = typeof idxType === "string"
                  ? ({ type: IR.IRNodeType.TypeReference, name: idxType } as IR.IRTypeReference)
                  : idxType;
              }
              return {
                type: IR.IRNodeType.IndexedAccessType,
                objectType: typeof objType === "string"
                  ? ({ type: IR.IRNodeType.TypeReference, name: objType } as IR.IRTypeReference)
                  : objType,
                indexType: idxTypeResult,
              } as IR.IRIndexedAccessType;
            }

            case "if-extends":
            case "extends": {
              // Conditional: (if-extends T U Then Else) → T extends U ? Then : Else
              if (elements.length < 5) {
                throw new TransformError(
                  "Conditional type requires check, extends, true, and false types",
                  node.position,
                );
              }
              // For check/extends types, use regular parsing (not literal detection)
              const checkType = parseTypeExpression(elements[1]);
              const extendsType = parseTypeExpression(elements[2]);
              const wrapType = (t: IR.IRTypeExpression | string): IR.IRTypeExpression =>
                typeof t === "string"
                  ? ({ type: IR.IRNodeType.TypeReference, name: t } as IR.IRTypeReference)
                  : t;
              // For true/false types, use toTypeExpr for proper string literal handling
              return {
                type: IR.IRNodeType.ConditionalType,
                checkType: wrapType(checkType),
                extendsType: wrapType(extendsType),
                trueType: toTypeExpr(elements[3]),
                falseType: toTypeExpr(elements[4]),
              } as IR.IRConditionalType;
            }

            case "tuple": {
              // Tuple: (tuple A B C) → [A, B, C]
              const tupleElements = elements.slice(1).map((el) => {
                const parsed = parseTypeExpression(el);
                return typeof parsed === "string"
                  ? ({ type: IR.IRNodeType.TypeReference, name: parsed } as IR.IRTypeReference)
                  : parsed;
              });
              return {
                type: IR.IRNodeType.TupleType,
                elements: tupleElements,
              } as IR.IRTupleType;
            }

            case "array": {
              // Array: (array T) → T[]
              if (elements.length < 2) {
                throw new TransformError("array requires an element type", node.position);
              }
              const elemType = parseTypeExpression(elements[1]);
              return {
                type: IR.IRNodeType.ArrayType,
                elementType: typeof elemType === "string"
                  ? ({ type: IR.IRNodeType.TypeReference, name: elemType } as IR.IRTypeReference)
                  : elemType,
              } as IR.IRArrayType;
            }

            case "readonly": {
              // Readonly: (readonly T) → readonly T
              if (elements.length < 2) {
                throw new TransformError("readonly requires a type argument", node.position);
              }
              const arg = parseTypeExpression(elements[1]);
              return {
                type: IR.IRNodeType.ReadonlyType,
                argument: typeof arg === "string"
                  ? ({ type: IR.IRNodeType.TypeReference, name: arg } as IR.IRTypeReference)
                  : arg,
              } as IR.IRReadonlyType;
            }

            case "infer": {
              // Infer: (infer T) → infer T
              if (elements.length < 2) {
                throw new TransformError("infer requires a type parameter", node.position);
              }
              const paramNode = elements[1];
              if (paramNode.type !== "symbol") {
                throw new TransformError("infer type parameter must be a symbol", node.position);
              }
              return {
                type: IR.IRNodeType.InferType,
                typeParameter: (paramNode as SymbolNode).name,
              } as IR.IRInferType;
            }

            case "typeof": {
              // Typeof: (typeof expr) → typeof expr
              if (elements.length < 2) {
                throw new TransformError("typeof requires an expression", node.position);
              }
              const exprNode = elements[1];
              let expression: string;
              if (exprNode.type === "symbol") {
                expression = (exprNode as SymbolNode).name;
              } else if (exprNode.type === "literal") {
                expression = String((exprNode as LiteralNode).value);
              } else {
                throw new TransformError("typeof expression must be a symbol or string", node.position);
              }
              return {
                type: IR.IRNodeType.TypeofType,
                expression,
              } as IR.IRTypeofType;
            }

            case "mapped": {
              // Mapped: (mapped K T ValueType) → { [K in T]: ValueType }
              if (elements.length < 4) {
                throw new TransformError(
                  "mapped type requires parameter, constraint, and value type",
                  node.position,
                );
              }
              const paramNode = elements[1];
              if (paramNode.type !== "symbol") {
                throw new TransformError("mapped type parameter must be a symbol", node.position);
              }
              const constraint = parseTypeExpression(elements[2]);
              const valueType = parseTypeExpression(elements[3]);
              return {
                type: IR.IRNodeType.MappedType,
                typeParameter: (paramNode as SymbolNode).name,
                constraint: typeof constraint === "string"
                  ? ({ type: IR.IRNodeType.TypeReference, name: constraint } as IR.IRTypeReference)
                  : constraint,
                valueType: typeof valueType === "string"
                  ? ({ type: IR.IRNodeType.TypeReference, name: valueType } as IR.IRTypeReference)
                  : valueType,
              } as IR.IRMappedType;
            }

            case "->":
            case "fn": {
              // Function type: (-> [params] ReturnType) → (params) => ReturnType
              if (elements.length < 3) {
                throw new TransformError(
                  "function type requires parameters and return type",
                  node.position,
                );
              }
              // Parse parameters - simplified for now
              const returnType = parseTypeExpression(elements[elements.length - 1]);
              return {
                type: IR.IRNodeType.FunctionTypeExpr,
                parameters: [], // Simplified - full param parsing would be more complex
                returnType: typeof returnType === "string"
                  ? ({ type: IR.IRNodeType.TypeReference, name: returnType } as IR.IRTypeReference)
                  : returnType,
              } as IR.IRFunctionTypeExpr;
            }

            case "...":
            case "rest": {
              // Rest type: (... T) → ...T
              if (elements.length < 2) {
                throw new TransformError("rest type requires a type argument", node.position);
              }
              const arg = parseTypeExpression(elements[1]);
              return {
                type: IR.IRNodeType.RestType,
                argument: typeof arg === "string"
                  ? ({ type: IR.IRNodeType.TypeReference, name: arg } as IR.IRTypeReference)
                  : arg,
              } as IR.IRRestType;
            }

            default: {
              // Unknown operator - treat as generic type reference
              // e.g., (Partial T) → Partial<T>
              const typeArgs = elements.slice(1).map((el) => {
                const parsed = parseTypeExpression(el);
                return typeof parsed === "string"
                  ? ({ type: IR.IRNodeType.TypeReference, name: parsed } as IR.IRTypeReference)
                  : parsed;
              });
              return {
                type: IR.IRNodeType.TypeReference,
                name: opName,
                typeArguments: typeArgs.length > 0 ? typeArgs : undefined,
              } as IR.IRTypeReference;
            }
          }
        }

        // Exhaustive check fallback - should never be reached
        throw new TransformError(`Unknown type expression: ${(node as HQLNode).type}`, (node as HQLNode).position);
      }

      // =========================================================================
      // Type alias declaration: (type Name TypeExpr) or (deftype Name "...")
      // =========================================================================
      // Supports both native syntax and string passthrough:
      //   (type Keys (keyof Person))        → type Keys = keyof Person;
      //   (type Union (| A B C))            → type Union = A | B | C;
      //   (type Complex "T extends U ? X : Y") → type Complex = T extends U ? X : Y;

      const typeAliasHandler = (list: ListNode, _currentDir: string) => {
        if (list.elements.length < 3) {
          throw new ValidationError(
            "type requires at least 2 arguments: name and type expression",
            "type",
            "(type Name TypeExpr)",
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
            "type name must be a symbol or string literal",
            "type",
            "symbol or string name",
            nameNode.type,
          );
        }
        // Parse generic parameters from name like "Name<T, U>"
        let name = fullName;
        let typeParameters: string[] | undefined;
        const genericMatch = fullName.match(GENERIC_TYPE_PARAMS_REGEX);
        if (genericMatch) {
          name = genericMatch[1];
          typeParameters = genericMatch[2].split(",").map((p: string) => p.trim());
        }

        const typeNode = list.elements[2];

        // Try to parse as native type expression
        const parsedType = parseTypeExpression(typeNode);

        // If it's a string, use string passthrough (for complex expressions)
        if (typeof parsedType === "string") {
          return {
            type: IR.IRNodeType.TypeAliasDeclaration,
            name,
            typeExpression: parsedType,
            typeParameters,
          } as IR.IRTypeAliasDeclaration;
        }

        // Otherwise, it's a native type expression - we'll generate TS from the IR
        return {
          type: IR.IRNodeType.TypeAliasDeclaration,
          name,
          typeExpression: parsedType, // Now stores IR node instead of string
          typeParameters,
        } as IR.IRTypeAliasDeclaration & { typeExpression: IR.IRTypeExpression };
      };

      // Register both "type" and "deftype" for backward compatibility
      transformFactory.set("type", typeAliasHandler);
      transformFactory.set("deftype", typeAliasHandler);

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
          const genericMatch = fullName.match(GENERIC_TYPE_PARAMS_REGEX);
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

      // =========================================================================
      // TypeScript: Abstract class declaration (abstract-class)
      // =========================================================================
      transformFactory.set(
        "abstract-class",
        (list: ListNode, currentDir: string) => {
          // (abstract-class Name extends? Parent [...body])
          // (abstract-class Name<T> extends Parent [...body])
          const elements = list.elements.slice(1);
          if (elements.length < 2) {
            throw new TransformError(
              "abstract-class requires at least a name and body",
              list.position,
            );
          }

          // Parse name (may include generics)
          const nameNode = elements[0];
          let name: string;
          let typeParameters: string[] | undefined;

          if (nameNode.type === "symbol") {
            const nameParts = (nameNode as SymbolNode).name.match(
              /^([^<]+)(?:<(.+)>)?$/,
            );
            if (nameParts) {
              name = nameParts[1];
              if (nameParts[2]) {
                typeParameters = nameParts[2].split(",").map((s) => s.trim());
              }
            } else {
              name = (nameNode as SymbolNode).name;
            }
          } else {
            throw new TransformError(
              "abstract-class name must be a symbol",
              nameNode.position,
            );
          }

          let idx = 1;
          let superClass: IR.IRNode | undefined;

          // Check for extends keyword
          if (
            idx < elements.length - 1 &&
            elements[idx].type === "symbol" &&
            (elements[idx] as SymbolNode).name === "extends"
          ) {
            idx++;
            superClass = transformHQLNodeToIR(elements[idx], currentDir) ?? undefined;
            idx++;
          }

          // Parse body - vectors are lists with first element being "vector" symbol
          const bodyNode = elements[idx];
          if (
            !bodyNode ||
            bodyNode.type !== "list" ||
            !(bodyNode as ListNode).elements[0] ||
            (bodyNode as ListNode).elements[0].type !== "symbol" ||
            ((bodyNode as ListNode).elements[0] as SymbolNode).name !== "vector"
          ) {
            throw new TransformError(
              "abstract-class requires a body vector",
              list.position,
            );
          }

          const body: IR.IRNode[] = [];
          // Skip the "vector" symbol at index 0
          const vectorElements = (bodyNode as ListNode).elements.slice(1);
          for (const member of vectorElements) {
            const transformed = transformHQLNodeToIR(member, currentDir);
            if (transformed !== null) {
              body.push(transformed);
            }
          }

          return {
            type: IR.IRNodeType.AbstractClassDeclaration,
            id: { type: IR.IRNodeType.Identifier, name },
            body,
            superClass,
            typeParameters,
          } as IR.IRAbstractClassDeclaration;
        },
      );

      // =========================================================================
      // TypeScript: Abstract method (abstract-method)
      // =========================================================================
      transformFactory.set(
        "abstract-method",
        (list: ListNode, _currentDir: string) => {
          // (abstract-method name [params] :return-type)
          // (abstract-method name<T> [params] :return-type)
          // (abstract-method name "params-string" :return-type)
          const elements = list.elements.slice(1);
          if (elements.length < 2) {
            throw new TransformError(
              "abstract-method requires name and params",
              list.position,
            );
          }

          const nameNode = elements[0];
          let name: string;
          let typeParameters: string[] | undefined;

          if (nameNode.type === "symbol") {
            const nameParts = (nameNode as SymbolNode).name.match(
              /^([^<]+)(?:<(.+)>)?$/,
            );
            if (nameParts) {
              name = nameParts[1];
              if (nameParts[2]) {
                typeParameters = nameParts[2].split(",").map((s) => s.trim());
              }
            } else {
              name = (nameNode as SymbolNode).name;
            }
          } else {
            throw new TransformError(
              "abstract-method name must be a symbol",
              nameNode.position,
            );
          }

          // Parse params (as string for TypeScript signature)
          const paramsNode = elements[1];
          let params = "";
          // Check if it's a vector (list with first element "vector")
          if (
            paramsNode.type === "list" &&
            (paramsNode as ListNode).elements[0]?.type === "symbol" &&
            ((paramsNode as ListNode).elements[0] as SymbolNode).name ===
              "vector"
          ) {
            // Skip the "vector" symbol and process elements
            params = (paramsNode as ListNode).elements
              .slice(1)
              .map((el) => {
                if (el.type === "symbol") {
                  return (el as SymbolNode).name;
                }
                return "";
              })
              .filter((s) => s)
              .join(", ");
          } else if (paramsNode.type === "literal") {
            params = String((paramsNode as LiteralNode).value);
          }

          // Parse return type
          let returnType: string | undefined;
          if (elements.length > 2) {
            const returnNode = elements[2];
            // Keywords start with : in HQL but are symbols internally
            if (returnNode.type === "symbol") {
              const symName = (returnNode as SymbolNode).name;
              // Remove leading : if present
              returnType = symName.startsWith(":")
                ? symName.slice(1)
                : symName;
            } else if (returnNode.type === "literal") {
              returnType = String((returnNode as LiteralNode).value);
            }
          }

          return {
            type: IR.IRNodeType.AbstractMethod,
            key: { type: IR.IRNodeType.Identifier, name },
            params,
            returnType,
            typeParameters,
          } as IR.IRAbstractMethod;
        },
      );

      // =========================================================================
      // TypeScript: Function overload declaration (fn-overload)
      // =========================================================================
      transformFactory.set(
        "fn-overload",
        (list: ListNode, _currentDir: string) => {
          // (fn-overload name "params" :return-type)
          // (fn-overload name<T> "params" :return-type)
          const elements = list.elements.slice(1);
          if (elements.length < 3) {
            throw new TransformError(
              "fn-overload requires name, params, and return type",
              list.position,
            );
          }

          const nameNode = elements[0];
          let name: string;
          let typeParameters: string[] | undefined;

          if (nameNode.type === "symbol") {
            const nameParts = (nameNode as SymbolNode).name.match(
              /^([^<]+)(?:<(.+)>)?$/,
            );
            if (nameParts) {
              name = nameParts[1];
              if (nameParts[2]) {
                typeParameters = nameParts[2].split(",").map((s) => s.trim());
              }
            } else {
              name = (nameNode as SymbolNode).name;
            }
          } else if (nameNode.type === "literal") {
            name = String((nameNode as LiteralNode).value);
          } else {
            throw new TransformError(
              "fn-overload name must be a symbol or string",
              nameNode.position,
            );
          }

          // Parse params (as string)
          const paramsNode = elements[1];
          let params: string;
          if (paramsNode.type === "literal") {
            params = String((paramsNode as LiteralNode).value);
          } else if (
            paramsNode.type === "list" &&
            (paramsNode as ListNode).elements[0]?.type === "symbol" &&
            ((paramsNode as ListNode).elements[0] as SymbolNode).name ===
              "vector"
          ) {
            // Vector: skip first element and process rest
            params = (paramsNode as ListNode).elements
              .slice(1)
              .map((el) => {
                if (el.type === "symbol") {
                  return (el as SymbolNode).name;
                }
                return "";
              })
              .filter((s) => s)
              .join(", ");
          } else {
            throw new TransformError(
              "fn-overload params must be a string or vector",
              paramsNode.position,
            );
          }

          // Parse return type
          const returnNode = elements[2];
          let returnType: string;
          if (returnNode.type === "symbol") {
            const symName = (returnNode as SymbolNode).name;
            returnType = symName.startsWith(":") ? symName.slice(1) : symName;
          } else if (returnNode.type === "literal") {
            returnType = String((returnNode as LiteralNode).value);
          } else {
            throw new TransformError(
              "fn-overload return type must be a keyword or string",
              returnNode.position,
            );
          }

          return {
            type: IR.IRNodeType.FunctionOverload,
            name,
            params,
            returnType,
            typeParameters,
          } as IR.IRFunctionOverload;
        },
      );

      // =========================================================================
      // TypeScript: Declare statement (declare)
      // =========================================================================
      transformFactory.set(
        "declare",
        (list: ListNode, _currentDir: string) => {
          // (declare function "name(params): returnType")
          // (declare var "name: Type")
          // (declare module "name" "body")
          const elements = list.elements.slice(1);
          if (elements.length < 2) {
            throw new TransformError(
              "declare requires a kind and body",
              list.position,
            );
          }

          const kindNode = elements[0];
          if (kindNode.type !== "symbol") {
            throw new TransformError(
              "declare kind must be a symbol",
              kindNode.position,
            );
          }
          const kind = (kindNode as SymbolNode).name as
            | "function"
            | "class"
            | "var"
            | "const"
            | "let"
            | "module"
            | "namespace";

          const bodyNode = elements[1];
          let body: string;
          if (bodyNode.type === "literal") {
            body = String((bodyNode as LiteralNode).value);
          } else if (bodyNode.type === "symbol") {
            body = (bodyNode as SymbolNode).name;
          } else {
            throw new TransformError(
              "declare body must be a string or symbol",
              bodyNode.position,
            );
          }

          return {
            type: IR.IRNodeType.DeclareStatement,
            kind,
            body,
          } as IR.IRDeclareStatement;
        },
      );

      // =========================================================================
      // TypeScript: Namespace declaration (namespace)
      // =========================================================================
      transformFactory.set(
        "namespace",
        (list: ListNode, currentDir: string) => {
          // (namespace Name [...body])
          const elements = list.elements.slice(1);
          if (elements.length < 2) {
            throw new TransformError(
              "namespace requires a name and body",
              list.position,
            );
          }

          const nameNode = elements[0];
          if (nameNode.type !== "symbol") {
            throw new TransformError(
              "namespace name must be a symbol",
              nameNode.position,
            );
          }
          const name = (nameNode as SymbolNode).name;

          const bodyNode = elements[1];
          // Check for vector (list with first element "vector")
          if (
            bodyNode.type !== "list" ||
            !(bodyNode as ListNode).elements[0] ||
            (bodyNode as ListNode).elements[0].type !== "symbol" ||
            ((bodyNode as ListNode).elements[0] as SymbolNode).name !== "vector"
          ) {
            throw new TransformError(
              "namespace body must be a vector",
              bodyNode.position,
            );
          }

          const body: IR.IRNode[] = [];
          // Skip "vector" symbol at index 0
          const vectorElements = (bodyNode as ListNode).elements.slice(1);
          for (const member of vectorElements) {
            const transformed = transformHQLNodeToIR(member, currentDir);
            if (transformed !== null) {
              body.push(transformed);
            }
          }

          return {
            type: IR.IRNodeType.NamespaceDeclaration,
            name,
            body,
          } as IR.IRNamespaceDeclaration;
        },
      );

      // =========================================================================
      // TypeScript: Const enum declaration (const-enum)
      // =========================================================================
      transformFactory.set(
        "const-enum",
        (list: ListNode, _currentDir: string) => {
          // (const-enum Name [A B C] or [(A 1) (B 2)])
          const elements = list.elements.slice(1);
          if (elements.length < 2) {
            throw new TransformError(
              "const-enum requires a name and members",
              list.position,
            );
          }

          const nameNode = elements[0];
          if (nameNode.type !== "symbol") {
            throw new TransformError(
              "const-enum name must be a symbol",
              nameNode.position,
            );
          }
          const name = (nameNode as SymbolNode).name;

          const membersNode = elements[1];
          // Check for vector (list with first element "vector")
          if (
            membersNode.type !== "list" ||
            !(membersNode as ListNode).elements[0] ||
            (membersNode as ListNode).elements[0].type !== "symbol" ||
            ((membersNode as ListNode).elements[0] as SymbolNode).name !==
              "vector"
          ) {
            throw new TransformError(
              "const-enum members must be a vector",
              membersNode.position,
            );
          }

          const members: Array<{ name: string; value?: number | string }> = [];
          // Skip "vector" symbol at index 0
          const vectorElements = (membersNode as ListNode).elements.slice(1);
          for (const el of vectorElements) {
            if (el.type === "symbol") {
              members.push({ name: (el as SymbolNode).name });
            } else if (el.type === "list") {
              const pair = el as ListNode;
              if (pair.elements.length >= 2) {
                const memberName = (pair.elements[0] as SymbolNode).name;
                const valueNode = pair.elements[1];
                let value: number | string | undefined;
                if (valueNode.type === "literal") {
                  const litValue = (valueNode as LiteralNode).value;
                  if (typeof litValue === "number") {
                    value = litValue;
                  } else if (typeof litValue === "string") {
                    value = litValue;
                  }
                }
                members.push({ name: memberName, value });
              }
            }
          }

          return {
            type: IR.IRNodeType.ConstEnumDeclaration,
            id: { type: IR.IRNodeType.Identifier, name },
            members,
          } as IR.IRConstEnumDeclaration;
        },
      );

      // =========================================================================
      // TypeScript: Decorator (decorator) - Used with class/method definitions
      // =========================================================================
      transformFactory.set(
        "decorator",
        (list: ListNode, currentDir: string) => {
          // (decorator @Name) or (decorator (@Name arg1 arg2))
          const elements = list.elements.slice(1);
          if (elements.length < 1) {
            throw new TransformError(
              "decorator requires an expression",
              list.position,
            );
          }

          const expression = transformHQLNodeToIR(elements[0], currentDir);

          return {
            type: IR.IRNodeType.Decorator,
            expression,
          } as IR.IRDecorator;
        },
      );

      transformFactory.set(
        "get",
        (list, currentDir) =>
          dataStructureModule.transformGet(list, currentDir, transformHQLNodeToIR),
      );
      transformFactory.set(
        "js-method",
        (list: ListNode, currentDir: string) => {
          return asyncGeneratorsModule.transformJsMethod(list, currentDir, transformHQLNodeToIR);
        },
      );
      // method-call: (.foo obj args) transforms to obj.foo(args)
      transformFactory.set(
        "method-call",
        (list: ListNode, currentDir: string) => {
          return classModule.transformMethodCall(list, currentDir, transformHQLNodeToIR);
        },
      );
      // optional-method-call: (.?foo obj args) transforms to obj?.foo(args)
      transformFactory.set(
        "optional-method-call",
        (list: ListNode, currentDir: string) => {
          return classModule.transformOptionalMethodCall(list, currentDir, transformHQLNodeToIR);
        },
      );
      // optional-js-method: (.?foo obj) transforms to obj?.foo (property access)
      transformFactory.set(
        "optional-js-method",
        (list: ListNode, currentDir: string) => {
          if (list.elements.length < 3) {
            throw new ValidationError(
              "optional-js-method requires an object and method name",
              "optional-js-method",
              "at least 2 arguments",
              `${list.elements.length - 1} arguments`,
            );
          }
          const object = validateTransformed(
            transformHQLNodeToIR(list.elements[1], currentDir),
            "optional-js-method",
            "Object",
          );
          const methodSpec = list.elements[2];
          let methodName: string;
          if (methodSpec.type === "literal") {
            methodName = String((methodSpec as LiteralNode).value);
          } else if (methodSpec.type === "symbol") {
            methodName = (methodSpec as SymbolNode).name;
          } else {
            throw new ValidationError(
              "Method name must be a string literal or symbol",
              "optional-js-method",
              "string literal or symbol",
              methodSpec.type,
            );
          }
          // If there are more elements, it's a method call with arguments
          if (list.elements.length > 3) {
            const args = transformElements(
              list.elements.slice(3),
              currentDir,
              transformHQLNodeToIR,
              "optional-js-method argument",
              "Argument",
            );
            return {
              type: IR.IRNodeType.OptionalCallExpression,
              callee: {
                type: IR.IRNodeType.OptionalMemberExpression,
                object,
                property: { type: IR.IRNodeType.Identifier, name: methodName } as IR.IRIdentifier,
                computed: false,
                optional: true,
              } as IR.IROptionalMemberExpression,
              arguments: args,
              optional: false,
            } as IR.IROptionalCallExpression;
          }
          // Otherwise, it's just property access (or zero-arg method call)
          return {
            type: IR.IRNodeType.OptionalCallExpression,
            callee: {
              type: IR.IRNodeType.OptionalMemberExpression,
              object,
              property: { type: IR.IRNodeType.Identifier, name: methodName } as IR.IRIdentifier,
              computed: false,
              optional: true,
            } as IR.IROptionalMemberExpression,
            arguments: [],
            optional: false,
          } as IR.IROptionalCallExpression;
        },
      );
    },
    "initializeTransformFactory",
    TransformError,
  );
}

// Re-export transformJsMethod from the async-generators module for backwards compatibility
export const transformJsMethod = asyncGeneratorsModule.transformJsMethod;

// Re-export containsAwait for any external usage
export const containsAwait = asyncGeneratorsModule.containsAwait;

// Re-export buildBlockFromExpressions for any external usage
export const buildBlockFromExpressions = tryCatchModule.buildBlockFromExpressions;

// Re-export literal transforms for any external usage
export const transformLiteral = literalsModule.transformLiteral;
export const transformTemplateLiteral = literalsModule.transformTemplateLiteral;

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
    case IR.IRNodeType.YieldExpression:
    case IR.IRNodeType.AssignmentExpression:
    case IR.IRNodeType.InteropIIFE:
    case IR.IRNodeType.JsMethodAccess:
    case IR.IRNodeType.FunctionExpression:
    case IR.IRNodeType.SequenceExpression:
      return true;
    default:
      return false;
  }
}

/**
 * Transform a single HQL node to its IR representation.
 */
export function transformHQLNodeToIR(
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
          result = literalsModule.transformLiteral(node as LiteralNode);
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
    "transformHQLNodeToIR",
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
    transformHQLNodeToIR,
  );
  if (jsGetInvokeResult) return jsGetInvokeResult;

  const first = list.elements[0];

  // Handle dot method calls (object.method(...))
  // BUT NOT optional chaining (.?foo) - those go through transformBasedOnOperator
  if (
    first.type === "symbol" && (first as SymbolNode).name.startsWith(".") &&
    !(first as SymbolNode).name.startsWith(".?") &&
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
    transformHQLNodeToIR(list.elements[1], currentDir),
    "method call object",
    "Object in method call",
  );

  // Arguments are all elements AFTER the object (starting from the third element)
  // Handle spread operators in arguments
  const args: IR.IRNode[] = [];
  for (const arg of list.elements.slice(2)) {
    if (isSpreadOperator(arg)) {
      args.push(transformSpreadOperator(arg, currentDir, transformHQLNodeToIR, "spread in method call"));
    } else {
      args.push(validateTransformed(
        transformHQLNodeToIR(arg, currentDir),
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
  // First check if this is an optional method call (.?foo)
  if (op.startsWith(".?")) {
    return classModule.transformOptionalMethodCall(list, currentDir, transformHQLNodeToIR);
  }
  // Then check if this is a regular method call (.foo)
  if (op.startsWith(".")) {
    return classModule.transformMethodCall(list, currentDir, transformHQLNodeToIR);
  }

  // Check for import/export forms which have special handling
  // Declaration exports must be checked BEFORE vector exports
  // because both have list as second element
  if (isDeclarationExport(list)) {
    return importExportModule.transformDeclarationExport(list, currentDir, transformHQLNodeToIR);
  }
  if (isSingleExport(list)) {
    return importExportModule.transformSingleExport(list);
  }
  if (isVectorExport(list)) {
    return importExportModule.transformVectorExport(list, currentDir);
  }
  if (isDefaultExport(list)) {
    return importExportModule.transformDefaultExport(list, currentDir, transformHQLNodeToIR);
  }

  if (isVectorImport(list)) {
    return importExportModule.transformVectorImport(list);
  }

  if (isNamespaceImport(list)) {
    return importExportModule.transformNamespaceImport(list, currentDir);
  }

  // Handle optional chaining method calls (obj?.greet "World")
  if (op.includes("?.") && !op.startsWith("js/") && !op.startsWith("...")) {
    return transformOptionalChainMethodCall(list, op, currentDir, transformHQLNodeToIR);
  }

  // Handle dot notation for property access (obj.prop)
  if (jsInteropModule.isDotNotation(op)) {
    return jsInteropModule.transformDotNotation(
      list,
      op,
      currentDir,
      transformHQLNodeToIR,
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
      transformHQLNodeToIR,
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
      transformHQLNodeToIR,
    );
  }

  // This is the critical part - determine if this is a function call or collection access
  if (!isBuiltInOperator(op)) {
    return determineCallOrAccess(list, currentDir, transformHQLNodeToIR);
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
  transformHQLNodeToIR: (node: HQLNode, dir: string) => IR.IRNode | null,
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
      const singleElement = transformHQLNodeToIR(only, currentDir);
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
  const firstTransformed = transformHQLNodeToIR(elements[0], currentDir);
  if (!firstTransformed) {
    throw new TransformError(
      "First element transformed to null",
      JSON.stringify(list),
      "Function or collection access",
    );
  }

  // Handle special patterns for (obj arg) expressions
  if (elements.length === 2) {
    // Check if first element is a js/ prefixed symbol - always treat as function call
    // This prevents js/Promise.resolve(42) from being treated as collection access
    const firstElement = elements[0];
    const isJsInterop = firstElement.type === "symbol" &&
      (firstElement as SymbolNode).name.startsWith("js/");

    if (isJsInterop) {
      return createCallExpression(
        list,
        currentDir,
        transformHQLNodeToIR,
        firstTransformed,
      );
    }

    // In Lisp semantics, (symbol args...) is ALWAYS a function call.
    // Property access must use explicit syntax: obj.key, (js-get obj "key"), or (get obj "key")
    //
    // Previously, this code tried to "guess" intent by treating (symbol "string") as property access,
    // but this was semantically incorrect and caused bugs with imported functions like:
    //   (ask "hello") -> incorrectly became __hql_get(ask, "hello") instead of ask("hello")
    //
    // The only exception is numeric indexing for array-like access patterns like (arr 0),
    // which uses a runtime helper that tries array access first, then function call.
    const secondElement = elements[1];
    const isNumberLiteral = secondElement.type === "literal" &&
      typeof (secondElement as LiteralNode).value === "number";

    if (isNumberLiteral) {
      const keyTransformed = transformHQLNodeToIR(secondElement, currentDir);
      if (!keyTransformed) {
        throw new TransformError(
          "Key transformed to null",
          JSON.stringify(list),
          "Numeric indexing",
        );
      }
      // Numeric indexing: (arr 0) -> try array access first, then function call
      return createNumericAccessWithFallback(firstTransformed, keyTransformed);
    }

    // All other cases: treat as function call (correct Lisp semantics)
    return createCallExpression(
      list,
      currentDir,
      transformHQLNodeToIR,
      firstTransformed,
    );
  }

  // Default case: treat as a function call
  return createCallExpression(
    list,
    currentDir,
    transformHQLNodeToIR,
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
  transformHQLNodeToIR: TransformNodeFn,
  callee: IR.IRNode,
): IR.IRCallExpression {
  const args: IR.IRNode[] = [];
  for (let i = 1; i < list.elements.length; i++) {
    const elem = list.elements[i];

    // Check if this argument is a spread operator (...args or (... expr))
    if (isSpreadOperator(elem)) {
      args.push(transformSpreadOperator(elem, currentDir, transformHQLNodeToIR, "spread in function call"));
    } else {
      const arg = transformHQLNodeToIR(elem, currentDir);
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
  transformHQLNodeToIR: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      // Parse the chain to get the callee as an OptionalMemberExpression/MemberExpression
      const callee = transformOptionalChainSymbol(op);

      // Transform arguments
      const args: IR.IRNode[] = [];
      for (let i = 1; i < list.elements.length; i++) {
        const argResult = transformHQLNodeToIR(list.elements[i], currentDir);
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
      // Handle chained property access: myobj.a.b.c -> myobj.a.b.c (not myobj["a.b.c"])
      if (name.includes(".") && !name.startsWith("js/") && !name.startsWith("...")) {
        const parts = name.split(".");
        const meta = extractMeta(sym);
        const position = meta ? { line: meta.line, column: meta.column, filePath: meta.filePath } : undefined;

        // Build base identifier
        const baseObjectName = sanitizeIdentifier(parts[0]);
        const objectName = baseObjectName === "self" ? "this" : baseObjectName;
        let result: IR.IRNode = {
          type: IR.IRNodeType.Identifier,
          name: objectName,
        } as IR.IRIdentifier;

        // Chain member expressions for each property in the path
        for (let i = 1; i < parts.length; i++) {
          result = {
            type: IR.IRNodeType.MemberExpression,
            object: result,
            property: {
              type: IR.IRNodeType.Identifier,
              name: parts[i],
            } as IR.IRIdentifier,
            computed: false,
            position,
          } as IR.IRMemberExpression;
        }

        return result;
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
        transformHQLNodeToIR(list.elements[0], currentDir),
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
            transformHQLNodeToIR,
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
            transformHQLNodeToIR,
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
      transformHQLNodeToIR(arg, currentDir),
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
