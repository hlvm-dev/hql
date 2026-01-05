/**
 * Async/Await and Generator Function Transformations
 *
 * This module handles:
 * - async/await expressions
 * - Generator functions (fn*)
 * - yield/yield* expressions
 * - Await detection in IR trees
 */

import * as IR from "../../type/hql_ir.ts";
import type { HQLNode, ListNode, SymbolNode } from "../../type/hql_ast.ts";
import {
  perform,
  TransformError,
  ValidationError,
} from "../../../common/error.ts";
import { validateTransformed } from "../../utils/validation-helpers.ts";
import * as functionModule from "../../syntax/function.ts";
import { processFunctionBody } from "../../syntax/function.ts";
import * as jsInteropModule from "../../syntax/js-interop.ts";

// Type for transform node function passed from main module
export type TransformNodeFn = (node: HQLNode, dir: string) => IR.IRNode | null;

// Type for metadata returned from extractMeta
type MetaData = {
  line?: number;
  column?: number;
  filePath?: string;
  [key: string]: unknown;
};

// Import helper functions that will be provided by the main module
// These are set via initHelpers to avoid circular dependency issues
let _setAsyncFlag: (node: IR.IRNode | null) => void;
let _extractMeta: (node: HQLNode | null | undefined) => MetaData | undefined;
let _copyPosition: (source: HQLNode, target: IR.IRNode) => void;

/**
 * Initialize helper functions from the main module.
 * Must be called before using any transform functions.
 */
export function initHelpers(helpers: {
  setAsyncFlag: (node: IR.IRNode | null) => void;
  extractMeta: (node: HQLNode | null | undefined) => MetaData | undefined;
  copyPosition: (source: HQLNode, target: IR.IRNode) => void;
}): void {
  _setAsyncFlag = helpers.setAsyncFlag;
  _extractMeta = helpers.extractMeta;
  _copyPosition = helpers.copyPosition;
}

/**
 * Transform async function wrapper: (async fn ...) or (async fn* ...)
 */
export function transformAsync(
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

      _setAsyncFlag(transformed);

      return transformed;
    },
    "transformAsync",
    TransformError,
    [list],
  );
}

/**
 * Transform await expression: (await expr)
 *
 * IMPORTANT: HQL await has enhanced semantics for async iterators.
 * When awaiting an async generator/iterator, it automatically consumes
 * the entire stream and returns the concatenated result.
 *
 * This enables a single function to support both modes:
 * - (ask "hello")         → returns async iterator → REPL streams live
 * - (await (ask "hello")) → consumes iterator → returns full string
 *
 * Implementation: wraps argument in __hql_consume_async_iter runtime helper
 */
export function transformAwait(
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

      // Wrap argument in __hql_consume_async_iter helper
      // This helper:
      // 1. Awaits the value (handles Promises)
      // 2. If result is async iterator, consumes it and returns concatenated string
      // 3. Otherwise returns the awaited value unchanged
      const wrappedArgument: IR.IRCallExpression = {
        type: IR.IRNodeType.CallExpression,
        callee: {
          type: IR.IRNodeType.Identifier,
          name: "__hql_consume_async_iter",
        } as IR.IRIdentifier,
        arguments: [argument],
      };

      return {
        type: IR.IRNodeType.AwaitExpression,
        argument: wrappedArgument,
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
export function transformGeneratorFn(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
  processFnBody: (body: HQLNode[], dir: string) => IR.IRNode[],
): IR.IRNode {
  return perform(
    () => {
      // Transform as regular fn, then set generator flag
      const transformed = functionModule.transformFn(
        list,
        currentDir,
        transformNode,
        processFnBody,
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
export function transformYield(
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
      _copyPosition(list, node);
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
export function transformYieldDelegate(
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
      _copyPosition(list, node);
      return node;
    },
    "transformYieldDelegate",
    TransformError,
    [list],
  );
}

/**
 * Transform js-method access: (js-method obj methodName)
 */
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
      const meta = _extractMeta(list);
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

/**
 * Check if an IR node or its descendants contain an await expression.
 * Uses generic tree walker - automatically handles ALL IR node types.
 */
export { containsAwaitExpression as containsAwait } from "../../utils/ir-tree-walker.ts";
