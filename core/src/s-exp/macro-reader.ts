// src/s-exp/macro-reader.ts - Connects S-expression layer with existing HQL transpiler

import {
  isList,
  isLiteral,
  isSymbol,
  type SExp,
  type SList,
  type SLiteral,
  type SSymbol,
} from "./types.ts";
import type {
  HQLNode,
  ListNode,
  LiteralNode,
  SymbolNode,
} from "../transpiler/type/hql_ast.ts";
import { globalLogger as logger } from "../logger.ts";
import type { Logger } from "../logger.ts";

type MetaCarrier = { _meta?: Record<string, unknown> };

function copyMeta(
  source: MetaCarrier,
  target: MetaCarrier,
): void {
  if (source && source._meta) {
    target._meta = { ...source._meta };
  }
}

/**
 * Options for converting S-expressions to HQL AST
 */
interface ConversionOptions {
  verbose?: boolean;
}

/**
 * Convert S-expressions to HQL AST format
 * This allows the S-expression frontend to connect with the transpiler pipeline
 */
export function convertToHqlAst(
  sexps: SExp[],
  _options: ConversionOptions = {},
): HQLNode[] {
  logger.debug(`Converting ${sexps.length} S-expressions to HQL AST`);
  return sexps.map((sexp) => convertExpr(sexp, logger));
}

/**
 * Convert a single S-expression to an HQL AST node
 */
function convertExpr(sexp: SExp, logger: Logger): HQLNode {
  if (isLiteral(sexp)) {
    // Convert literal node
    return convertLiteral(sexp as SLiteral, logger);
  } else if (isSymbol(sexp)) {
    // Convert symbol node
    return convertSymbol(sexp as SSymbol, logger);
  } else if (isList(sexp)) {
    // Convert list node
    return convertList(sexp as SList, logger);
  } else {
    logger.error(`Unknown S-expression type: ${JSON.stringify(sexp)}`);
    throw new Error(`Unknown S-expression type: ${JSON.stringify(sexp)}`);
  }
}

/**
 * Convert an S-expression literal to an HQL AST literal
 */
function convertLiteral(literal: SLiteral, __logger: Logger): LiteralNode {
  const node: LiteralNode = {
    type: "literal",
    value: literal.value,
  };
  copyMeta(literal as MetaCarrier, node as unknown as MetaCarrier);
  return node;
}

/**
 * Convert an S-expression symbol to an HQL AST symbol
 */
function convertSymbol(symbol: SSymbol, _logger: Logger): SymbolNode {
  const node: SymbolNode = {
    type: "symbol",
    name: symbol.name,
  };
  copyMeta(symbol as MetaCarrier, node as unknown as MetaCarrier);
  return node;
}

/**
 * Convert an S-expression list to an HQL AST list
 */
function convertList(list: SList, logger: Logger): ListNode {
  // Special case: Handle nested property access - ((list-expr) .property)
  // Example: ((vector 1 2 3 4 5) .length)
  if (
    list.elements.length === 2 &&
    list.elements[0].type === "list" &&
    list.elements[1].type === "symbol" &&
    (list.elements[1] as SSymbol).name.startsWith(".")
  ) {
    // Get the object expression and property name
    const object = convertExpr(list.elements[0], logger);
    const propertyName = (list.elements[1] as SSymbol).name.substring(1); // Remove the dot

    // Create a property access pattern using js-get
    const transformed: ListNode = {
      type: "list",
      elements: [
        { type: "symbol", name: "js-get" },
        object,
        { type: "literal", value: propertyName },
      ],
    };
    copyMeta(list as MetaCarrier, transformed as unknown as MetaCarrier);
    return transformed;
  }

  // Default case: convert each element and return a list
  const node: ListNode = {
    type: "list",
    elements: list.elements.map((elem) => convertExpr(elem, logger)),
  };
  copyMeta(list as MetaCarrier, node as unknown as MetaCarrier);
  return node;
}
