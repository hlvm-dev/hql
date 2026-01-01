/**
 * Try/Catch/Finally Exception Handling Transformations
 *
 * This module handles:
 * - try/catch/finally expressions
 * - Block building from expressions
 * - Exception handler construction
 */

import * as IR from "../../type/hql_ir.ts";
import type { HQLNode, ListNode, LiteralNode, SymbolNode } from "../../type/hql_ast.ts";
import {
  perform,
  TransformError,
  ValidationError,
} from "../../../common/error.ts";
import { sanitizeIdentifier } from "../../../common/utils.ts";
import { containsAwait } from "./async-generators.ts";

// Type for transform node function passed from main module
export type TransformNodeFn = (node: HQLNode, dir: string) => IR.IRNode | null;

// Type for metadata
type MetaData = {
  line?: number;
  column?: number;
  filePath?: string;
  [key: string]: unknown;
};

// Helper functions provided by main module
let _extractMeta: (node: HQLNode | null | undefined) => MetaData | undefined;
let _isExpressionResult: (node: IR.IRNode) => boolean;

/**
 * Initialize helper functions from the main module.
 */
export function initHelpers(helpers: {
  extractMeta: (node: HQLNode | null | undefined) => MetaData | undefined;
  isExpressionResult: (node: IR.IRNode) => boolean;
}): void {
  _extractMeta = helpers.extractMeta;
  _isExpressionResult = helpers.isExpressionResult;
}

/**
 * Transform try/catch/finally expression
 *
 * Syntax:
 *   (try body... (catch e body...) (finally body...))
 */
export function transformTry(
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
          const catchMeta = _extractMeta(clause);
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
            position: catchPosition,
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
      const listMeta = _extractMeta(list);
      const listPosition = listMeta ? { line: listMeta.line, column: listMeta.column, filePath: listMeta.filePath } : undefined;

      const tryStatement: IR.IRTryStatement = {
        type: IR.IRNodeType.TryStatement,
        block: tryBlock,
        handler,
        finalizer,
        position: listPosition,
      };

      // BUGFIX: Detect if try/catch/finally contain await expressions
      // If they do, the wrapper IIFE must be async
      const needsAsync = containsAwait(tryBlock) ||
        (handler ? containsAwait(handler.body) : false) ||
        (finalizer ? containsAwait(finalizer) : false);

      // The IIFE needs to contain just the try statement
      const functionBody: IR.IRBlockStatement = {
        type: IR.IRNodeType.BlockStatement,
        body: [tryStatement],
        position: listPosition,
      };

      const functionExpression: IR.IRFunctionExpression = {
        type: IR.IRNodeType.FunctionExpression,
        id: null,
        params: [],
        body: functionBody,
        async: needsAsync,
        position: listPosition,
      };

      return {
        type: IR.IRNodeType.CallExpression,
        callee: functionExpression,
        arguments: [],
        position: listPosition,
      } as IR.IRCallExpression;
    },
    "transformTry",
    TransformError,
    [list],
  );
}

/**
 * Build a block statement from a list of expressions
 *
 * @param expressions - HQL expressions to transform
 * @param currentDir - Current directory for imports
 * @param transformNode - Node transformation function
 * @param ensureReturn - If true, wrap last expression in return statement
 */
export function buildBlockFromExpressions(
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

    if (ensureReturn && isLast && _isExpressionResult(transformed)) {
      statements.push({
        type: IR.IRNodeType.ReturnStatement,
        argument: transformed,
      } as IR.IRReturnStatement);
      return;
    }

    if (_isExpressionResult(transformed)) {
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
