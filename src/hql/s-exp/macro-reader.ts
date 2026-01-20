// src/hql/s-exp/macro-reader.ts - Connects S-expression layer with existing HQL transpiler

import {
  createListFrom,
  createLiteral,
  createSymbol,
  isList,
  isLiteral,
  isSymbol,
  type SExp,
  type SList,
  type SSymbol,
} from "./types.ts";
import { globalLogger as logger } from "../../logger.ts";
import type { Logger } from "../../logger.ts";
import { ParseError } from "../../common/error.ts";

/**
 * Options for normalizing S-expressions for the transpiler
 */
interface ConversionOptions {
  verbose?: boolean;
}

/**
 * Normalize S-expressions for the transpiler pipeline
 */
export function convertToHqlAst(
  sexps: SExp[],
  _options: ConversionOptions = {},
): SExp[] {
  logger.debug(`Normalizing ${sexps.length} S-expressions for transpiler`);
  return sexps.map((sexp) => normalizeExpr(sexp, logger));
}

/**
 * Normalize a single S-expression
 */
function normalizeExpr(sexp: SExp, logger: Logger): SExp {
  if (isLiteral(sexp) || isSymbol(sexp)) {
    return sexp;
  }
  if (isList(sexp)) {
    return normalizeList(sexp as SList, logger);
  }
  logger.error(`Unknown S-expression type: ${JSON.stringify(sexp)}`);
  throw new ParseError(`Unknown S-expression type: ${JSON.stringify(sexp)}`, { line: 0, column: 0 });
}

/**
 * Normalize an S-expression list
 */
function normalizeList(list: SList, logger: Logger): SExp {
  // Performance: Cache first two elements to avoid repeated array access
  const first = list.elements[0];
  const second = list.elements[1];

  // Special case: Handle nested property access - ((list-expr) .property)
  // Example: ((vector 1 2 3 4 5) .length)
  if (
    list.elements.length === 2 &&
    isList(first) &&
    isSymbol(second) &&
    (second as SSymbol).name.startsWith(".")
  ) {
    // Get the object expression and property name
    const object = normalizeExpr(first, logger);
    const propertyName = (second as SSymbol).name.substring(1); // Remove the dot

    // Create a property access pattern using js-get
    return createListFrom(list, [
      createSymbol("js-get"),
      object,
      createLiteral(propertyName),
    ]);
  }

  // Default case: normalize each element and return a list
  const elements = list.elements.map((elem) => normalizeExpr(elem, logger));
  return createListFrom(list, elements);
}
