////////////////////////////////////////////////////////////////////////////////
// src/transpiler/pipeline/hql-ast-to-hql-ir.ts - Refactored to use syntax modules
////////////////////////////////////////////////////////////////////////////////

import * as IR from "../type/hql_ir.ts";
import { HQLNode, ListNode, LiteralNode, SymbolNode } from "../type/hql_ast.ts";
import type {
  ArrayPattern,
  IdentifierPattern,
  ObjectPattern,
  Pattern,
  RestPattern,
  SkipPattern,
} from "../../s-exp/types.ts";
import { sanitizeIdentifier } from "../../common/utils.ts";
import { globalLogger as logger } from "../../logger.ts";
import {
  perform,
  TransformError,
  ValidationError,
} from "../../common/error.ts";
import {
  transformElements,
  validateTransformed,
} from "../utils/validation-helpers.ts";
import {
  processFunctionBody,
  transformStandardFunctionCall,
} from "../syntax/function.ts";
import {
  isDefaultExport,
  isNamespaceImport,
  isVectorExport,
  isVectorImport,
} from "../syntax/import-export.ts";

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
        "vector",
        (list, currentDir) =>
          dataStructureModule.transformVector(list, currentDir, transformNode),
      );
      transformFactory.set(
        "hash-set",
        (list, currentDir) =>
          dataStructureModule.transformHashSet(list, currentDir, transformNode),
      );
      transformFactory.set(
        "hash-map",
        (list, currentDir) =>
          dataStructureModule.transformHashMap(list, currentDir, transformNode),
      );
      transformFactory.set(
        "__hql_hash_map",
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
              name: "__hql_range",
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
          if (importExportModule.isVectorExport(list)) {
            return importExportModule.transformVectorExport(list, currentDir);
          }
          if (isDefaultExport(list)) {
            return importExportModule.transformDefaultExport(list, currentDir, transformNode);
          }
          throw new ValidationError(
            "Invalid export statement format",
            "export",
            "(export [names]) or (export default <expr>)",
            "invalid format",
          );
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
          "(async fn ...)",
          `${list.elements.length - 1} arguments`,
        );
      }

      const target = list.elements[1];
      if (target.type !== "symbol" || (target as SymbolNode).name !== "fn") {
        throw new ValidationError(
          "async currently supports 'fn' definitions",
          "async",
          "fn",
          target.type,
        );
      }

      const fnList: ListNode = {
        type: "list",
        elements: list.elements.slice(1),
      };

      const transformed = functionModule.transformFn(
        fnList,
        currentDir,
        transformNode,
        processFunctionBody,
      );

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

          handler = {
            type: IR.IRNodeType.CatchClause,
            param,
            body: buildBlockFromExpressions(
              catchBodyForms,
              currentDir,
              transformNode,
              true,
            ),
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

      const tryStatement: IR.IRTryStatement = {
        type: IR.IRNodeType.TryStatement,
        block: tryBlock,
        handler,
        finalizer,
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
      };

      const functionExpression: IR.IRFunctionExpression = {
        type: IR.IRNodeType.FunctionExpression,
        id: null,
        params: [],
        body: functionBody,
        async: needsAsync, // BUGFIX: Mark as async if contains await
      };

      return {
        type: IR.IRNodeType.CallExpression,
        callee: functionExpression,
        arguments: [],
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
  const args = list.elements.slice(2).map((arg) =>
    validateTransformed(
      transformNode(arg, currentDir),
      "method argument",
      "Method argument",
    )
  );

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
  if (isVectorExport(list)) {
    return importExportModule.transformVectorExport(list, currentDir);
  }

  if (isVectorImport(list)) {
    return importExportModule.transformVectorImport(list);
  }

  if (isNamespaceImport(list)) {
    return importExportModule.transformNamespaceImport(list, currentDir);
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
      name: "__hql_get",
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
      name: "__hql_getNumeric",
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
    const arg = transformNode(list.elements[i], currentDir);
    if (!arg) {
      throw new TransformError(
        `Argument ${i} transformed to null`,
        JSON.stringify(list),
        "Function argument",
      );
    }
    args.push(arg);
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
        name = name.replace(/-/g, "_");
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
        } // Handle property access (list).property
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

      // If the inner expression is a function, treat it as an IIFE with zero arguments
      // This handles cases like ((fn [] 42)) which should invoke the function immediately
      if (innerExpr.type === IR.IRNodeType.FunctionExpression) {
        return {
          type: IR.IRNodeType.CallExpression,
          callee: innerExpr as IR.IRFunctionExpression,
          arguments: [],
        } as IR.IRCallExpression;
      }

      return innerExpr;
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
