// core/src/s-exp/macro.ts - Refactored to remove user-level macro support

import {
  copyMeta,
  createList,
  createListFrom,
  createLiteral,
  createNilLiteral,
  getMeta,
  isDefMacro,
  isList,
  isLiteral,
  isSymbol,
  type SExp,
  type SExpMeta,
  sexpToString,
  type SList,
  type SLiteral,
  type SSymbol,
} from "./types.ts";
import { Environment } from "../environment.ts";
import type { Logger } from "../logger.ts";
import type { MacroFn } from "../environment.ts";
import { HQLError, MacroError, TransformError } from "../common/error.ts";
import { perform } from "../common/error.ts";
import { isGensymSymbol } from "../gensym.ts";
import { LRUCache } from "../common/lru-cache.ts";
import { globalLogger as logger } from "../logger.ts";
import { getErrorMessage, isObjectValue, isNullish } from "../common/utils.ts";

// Constants and caches
const MAX_EXPANSION_ITERATIONS = 100;
// macroCache removed - use env.hasMacro()
export const macroExpansionCache = new LRUCache<string, SExp>(5000);
// symbolRenameMap REMOVED - was part of broken automatic hygiene attempt
// HQL uses manual hygiene (Common Lisp style) with gensym

export interface MacroExpanderOptions {
  verbose?: boolean;
  maxExpandDepth?: number;
  currentFile?: string;
  useCache?: boolean;
  iterationLimit?: number;
}

/**
 * Recursively update _meta for all elements in an S-expression tree.
 * This fixes source location tracking for macro-expanded code.
 *
 * Elements that have _meta from a different file (macro definition file)
 * are updated to use the call site's _meta. Elements from the same file
 * (user code passed to the macro) keep their original _meta.
 *
 * This ensures error messages point to the original source location,
 * not the macro definition file.
 */
function updateMetaRecursively(expr: SExp, callSiteMeta: SExpMeta): void {
  // Skip primitive values - they can't have _meta set on them
  // (e.g., raw boolean false, numbers, strings that aren't wrapped in SLiteral)
  if (typeof expr !== "object" || expr === null) {
    return;
  }

  const exprMeta = getMeta(expr);

  // If this element has no _meta or has _meta from a different file,
  // use the call site's _meta (but preserve the call site's file path)
  if (!exprMeta || (exprMeta.filePath !== callSiteMeta.filePath)) {
    (expr as { _meta?: SExpMeta })._meta = { ...callSiteMeta };
  }

  // Recursively update children
  if (isList(expr)) {
    for (const element of (expr as SList).elements) {
      updateMetaRecursively(element, callSiteMeta);
    }
  }
}

/* Helper: Checks truthiness for S-expression values */
function isTruthy(expr: SExp): boolean {
  if (isLiteral(expr)) {
    const value = expr.value;
    return value !== false && value !== null && value !== undefined;
  }
  return true;
}

interface MacroPlaceholderLiteral extends SLiteral {
  __macroPlaceholder?: boolean;
}

function isSExpLike(value: unknown): value is SExp {
  return isObjectValue(value) && "type" in value;
}

interface RestParameterSplice {
  isRestParameter: boolean;
  elements: SExp[];
}

function isRestParameterSplice(value: unknown): value is RestParameterSplice {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { isRestParameter?: unknown; elements?: unknown };
  return record.isRestParameter === true && Array.isArray(record.elements);
}

/* Helper: Convert a JavaScript value to an S-expression */
function convertJsValueToSExp(value: unknown): SExp {
  if (isNullish(value)) return createNilLiteral();

  // CRITICAL: Check for GensymSymbol BEFORE other type checks
  // GensymSymbol must be converted to a symbol, not a string literal
  if (isGensymSymbol(value)) {
    logger.debug(`Converting GensymSymbol "${value.name}" to symbol`);
    return { type: "symbol", name: value.name } as SSymbol;
  }

  if (Array.isArray(value)) {
    return createList(...value.map((item) => convertJsValueToSExp(item)));
  }
  if (isSExpLike(value)) {
    return value;
  }

  const primitive = typeof value;
  if (
    primitive === "string" || primitive === "number" || primitive === "boolean"
  ) {
    return createLiteral(value as string | number | boolean);
  }

  return createLiteral(String(value));
}

function isMacroPlaceholder(expr: SExp): boolean {
  return isLiteral(expr) &&
    Boolean((expr as MacroPlaceholderLiteral).__macroPlaceholder);
}

/* Helper: Extract macro definition parts */
function processMacroDefinition(
  macroForm: SList,
): {
  macroName: string;
  params: string[];
  restParam: string | null;
  body: SExp[];
} {
  const loc = getMeta(macroForm) || {};

  if (macroForm.elements.length < 4) {
    throw new MacroError(
      "Macro definition requires a name, parameter list, and body. Syntax: (macro name [params] body)",
      "unknown",
      loc,
    );
  }
  const macroNameExp = macroForm.elements[1];
  if (!isSymbol(macroNameExp)) {
    throw new MacroError(
      "Macro name must be a symbol",
      "unknown",
      getMeta(macroNameExp) || loc,
    );
  }
  const macroName = macroNameExp.name;
  const paramsExp = macroForm.elements[2];
  if (!isList(paramsExp)) {
    throw new MacroError(
      "Macro parameters must be a list",
      macroName,
      getMeta(paramsExp) || loc,
    );
  }
  const { params, restParam } = processParamList(paramsExp);
  const body = macroForm.elements.slice(3);
  return { macroName, params, restParam, body };
}

/* Helper: Process a parameter list (including rest parameters) */
const isRestMarker = (symbol: SSymbol): boolean => symbol.name === "&";

/**
 * Check if a list is a vector form (starts with 'vector' symbol)
 * Vectors are created when parsing [...] syntax
 */
function isVectorForm(list: SList): boolean {
  return list.elements.length > 0 &&
    isSymbol(list.elements[0]) &&
    (list.elements[0] as SSymbol).name === "vector";
}

function processParamList(
  paramsExp: SList,
): { params: string[]; restParam: string | null } {
  const params: string[] = [];
  let restParam: string | null = null;
  let restMode = false;

  // Handle vector form: [a b c] parses as (vector a b c)
  // We need to skip the 'vector' symbol at the start
  const elements = isVectorForm(paramsExp)
    ? paramsExp.elements.slice(1)
    : paramsExp.elements;

  elements.forEach((param, index) => {
    if (!isSymbol(param)) {
      throw new Error(
        `Macro parameter at position ${index + 1} must be a symbol, got: ${
          sexpToString(param)
        }`,
      );
    }

    if (isRestMarker(param)) {
      restMode = true;
      return;
    }

    if (restMode) {
      if (restParam !== null) {
        throw new Error(
          `Multiple rest parameters not allowed: found '${restParam}' and '${param.name}'`,
        );
      }
      restParam = param.name;
      return;
    }

    params.push(param.name);
  });

  return { params, restParam };
}

/* Exported: Register a global macro definition */
export function defineMacro(
  macroForm: SList,
  env: Environment,
  logger: Logger,
): void {
  try {
    const { macroName, params, restParam, body } = processMacroDefinition(
      macroForm,
    );
    const macroFn = createMacroFunction(
      macroName,
      params,
      restParam,
      body,
      logger,
    );

    // BUG FIX: Only clear caches if we are redefining an existing macro
    // This prevents wiping the cache 50+ times during standard library loading
    if (env.hasMacro(macroName)) {
      macroExpansionCache.clear();
      logger.debug(`Redefined global macro ${macroName} (caches cleared)`);
    } else {
      logger.debug(`Registered global macro ${macroName}`);
    }
    
    env.defineMacro(macroName, macroFn);
  } catch (error) {
    // Preserve HQLError instances (MacroError, ValidationError, etc.)
    if (error instanceof HQLError) {
      throw error;
    }
    const macroName = macroForm.elements[1] && isSymbol(macroForm.elements[1])
      ? (macroForm.elements[1] as SSymbol).name
      : "unknown";
    throw new MacroError(
      `Failed to define macro: ${
        getErrorMessage(error)
      }`,
      macroName,
      {
        filePath: env.getCurrentFile() || undefined,
        originalError: error instanceof Error ? error : undefined,
      },
    );
  }
}

/* Expand all macros in a list of S-expressions */
export function expandMacros(
  exprs: SExp[],
  env: Environment,
  options: MacroExpanderOptions = {},
): SExp[] {
  const currentFile = options.currentFile;
  const useCache = options.useCache !== false;
  logger.debug(
    `Starting macro expansion on ${exprs.length} expressions${
      currentFile ? ` in ${currentFile}` : ""
    }`,
  );

  if (currentFile) {
    env.setCurrentFile(currentFile);
    logger.debug(`Setting current file to: ${currentFile}`);
  }

  // Process macro definitions
  for (const expr of exprs) {
    if (isDefMacro(expr) && isList(expr)) {
      defineMacro(expr as SList, env, logger);
    }
  }

  let currentExprs = [...exprs];
  let iteration = 0;
  const iterationLimit = options.iterationLimit ?? MAX_EXPANSION_ITERATIONS;
  let continueExpanding = true;
  while (continueExpanding && iteration < iterationLimit) {
    iteration++;
    logger.debug(`Macro expansion iteration ${iteration}`);

    const newExprs = currentExprs.map((expr) => {
      // Optimization: Avoid serializing every expression for cache key in hot loop
      // Only check cache if it's a potential macro call (symbol or list starting with symbol)
      // This is a heuristic to avoid O(N) serialization for literals
      
      // For now, we skip the cache lookup in the hot loop to avoid the O(TreeSize) stringification
      // The macro expansion is fast enough without this specific cache level if we avoid the stringify cost
      
      // If we really need caching here later, we should use a structural hash or WeakMap
      
      const expandedExpr = expandMacroExpression(expr, env, options, 0);
      return expandedExpr;
    });

    // Optimization: Use reference equality to detect changes
    // This requires expandMacroExpression to return the original object if unchanged
    let changed = false;
    if (currentExprs.length !== newExprs.length) {
      changed = true;
    } else {
      for (let i = 0; i < currentExprs.length; i++) {
        if (currentExprs[i] !== newExprs[i]) {
          changed = true;
          break;
        }
      }
    }
    
    currentExprs = newExprs;

    if (!changed) {
      logger.debug(`No changes in iteration ${iteration}, fixed point reached`);
      break;
    }

    if (iteration >= iterationLimit) {
      logger.debug(
        `Reached iteration limit (${iterationLimit}), stopping expansion`,
      );
      continueExpanding = false;
    }
  }

  if (
    iteration >= MAX_EXPANSION_ITERATIONS &&
    (!options.iterationLimit ||
      options.iterationLimit >= MAX_EXPANSION_ITERATIONS)
  ) {
    logger.warn(
      `Macro expansion reached maximum iterations (${MAX_EXPANSION_ITERATIONS}). Check for infinite recursion.`,
    );
  }
  logger.debug(`Completed macro expansion after ${iteration} iterations`);

  currentExprs = filterMacroDefinitions(currentExprs, logger);
  if (currentFile) {
    env.setCurrentFile(null);
    logger.debug(`Clearing current file`);
  }
  return currentExprs;
}

/* Evaluate an S-expression for macro expansion */
export function evaluateForMacro(
  expr: SExp,
  env: Environment,
  logger: Logger,
): SExp {
  logger.debug(`Evaluating for macro: ${sexpToString(expr)}`);
  if (isLiteral(expr)) return expr;
  if (isSymbol(expr)) return evaluateSymbol(expr as SSymbol, env, logger);
  if (isList(expr)) return evaluateList(expr as SList, env, logger);
  return expr;
}

/* Evaluate a symbol for macro expansion, including module property access */
function evaluateSymbol(expr: SSymbol, env: Environment, logger: Logger): SExp {
  if (expr.name.includes(".") && !expr.name.startsWith(".")) {
    const parts = expr.name.split(".");
    const moduleName = parts[0];
    const propertyPath = parts.slice(1).join(".");
    try {
      const moduleValue = env.lookup(moduleName);
      // Optional export validation
      const macroContext = env.getCurrentMacroContext();
      const currentFile = env.getCurrentFile();
      if (macroContext && currentFile) {
        // Reserved for future validation hooks
      }

      let result: unknown = moduleValue;
      if (isObjectValue(result) && propertyPath in result) {
        const record = result as Record<string, unknown>;
        result = record[propertyPath];
      } else {
        logger.debug(
          `Property '${propertyPath}' not found in module '${moduleName}'`,
        );
        return expr;
      }
      return convertJsValueToSExp(result);
    } catch {
      logger.debug(
        `Module property access failed: ${expr.name} during macro evaluation`,
      );
      return expr;
    }
  }
  try {
    const value = env.lookup(expr.name);
    return convertJsValueToSExp(value);
  } catch (e) {
    logger.debug(
      `Symbol lookup failed for '${expr.name}' during macro evaluation: ${e}`,
    );
    return expr;
  }
}

/* Evaluate a list expression during macro expansion */
function evaluateList(expr: SList, env: Environment, logger: Logger): SExp {
  if (expr.elements.length === 0) return expr;
  const first = expr.elements[0];
  if (isSymbol(first)) {
    const op = (first as SSymbol).name;
    switch (op) {
      case "quote":
        return evaluateQuote(expr);
      case "quasiquote":
        return evaluateQuasiquote(expr, env, logger);
      case "unquote":
      case "unquote-splicing":
        throw new MacroError(`${op} not in quasiquote context`, op);
      case "if":
        return evaluateIf(expr, env, logger);
      case "cond":
        return evaluateCond(expr, env, logger);
      case "let":
        return evaluateLet(expr, env, logger);
      case "var":
        return evaluateVar(expr, env, logger);
    }
    if (env.hasMacro(op)) return evaluateMacroCall(expr, env, logger);
    try {
      return evaluateFunctionCall(expr, env, logger);
    } catch (error) {
      throw new MacroError(
        `Error evaluating function call '${op}': ${
          getErrorMessage(error)
        }`,
        op,
      );
    }
  }
  return createListFrom(
    expr,
    expr.elements.map((elem) => evaluateForMacro(elem, env, logger)),
  );
}

/* Evaluate a quoted expression */
function evaluateQuote(list: SList): SExp {
  if (list.elements.length !== 2) {
    throw new MacroError("quote requires exactly one argument", "quote");
  }
  return list.elements[1];
}

/* Evaluate an "if" expression */
function evaluateIf(list: SList, env: Environment, logger: Logger): SExp {
  if (list.elements.length < 3 || list.elements.length > 4) {
    throw new MacroError(
      `'if' requires 2 or 3 arguments, got ${list.elements.length - 1}`,
      "if",
    );
  }
  const test = evaluateForMacro(list.elements[1], env, logger);
  if (isTruthy(test)) {
    return evaluateForMacro(list.elements[2], env, logger);
  }
  return list.elements.length > 3
    ? evaluateForMacro(list.elements[3], env, logger)
    : createNilLiteral();
}

/* Evaluate a "cond" expression */
function evaluateCond(list: SList, env: Environment, logger: Logger): SExp {
  for (let i = 1; i < list.elements.length; i++) {
    const clause = list.elements[i];
    if (!isList(clause)) {
      throw new MacroError("cond clauses must be lists", "cond");
    }
    const clauseList = clause as SList;
    if (clauseList.elements.length < 2) {
      throw new MacroError(
        "cond clauses must have a test and a result",
        "cond",
      );
    }
    const test = evaluateForMacro(clauseList.elements[0], env, logger);
    if (isTruthy(test)) {
      return evaluateForMacro(clauseList.elements[1], env, logger);
    }
  }
  return createNilLiteral();
}

/* Evaluate a "let" expression */
function evaluateLet(list: SList, env: Environment, logger: Logger): SExp {
  if (list.elements.length < 2) {
    throw new MacroError(
      "let requires bindings and at least one body form",
      "let",
    );
  }
  const bindings = list.elements[1];
  if (!isList(bindings)) {
    throw new MacroError("let bindings must be a list", "let");
  }
  const bindingsList = bindings as SList;
  if (bindingsList.elements.length % 2 !== 0) {
    throw new MacroError(
      "let bindings must have an even number of forms",
      "let",
    );
  }
  const letEnv = env.extend();
  for (let i = 0; i < bindingsList.elements.length; i += 2) {
    const name = bindingsList.elements[i];
    const value = bindingsList.elements[i + 1];
    if (!isSymbol(name)) {
      throw new MacroError("let binding names must be symbols", "let");
    }
    letEnv.define(
      (name as SSymbol).name,
      evaluateForMacro(value, letEnv, logger),
    );
  }
  let result: SExp = createNilLiteral();
  for (let i = 2; i < list.elements.length; i++) {
    result = evaluateForMacro(list.elements[i], letEnv, logger);
  }
  return result;
}

/**
 * Evaluate a var expression during macro expansion
 *
 * (var name value) creates a binding in the CURRENT environment (not a new scope like let)
 * This is CRITICAL for gensym to work in macros:
 *   (macro with-temp [value & body]
 *     (var tmp (gensym "temp"))    ; ← Creates binding in macro's environment
 *     `(let (~tmp ~value) ~@body)) ; ← Uses the bound value
 *
 * Returns the evaluated value
 */
function evaluateVar(list: SList, env: Environment, logger: Logger): SExp {
  if (list.elements.length !== 3) {
    throw new MacroError(
      "var requires exactly a name and a value: (var name value)",
      "var",
    );
  }

  const name = list.elements[1];
  if (!isSymbol(name)) {
    throw new MacroError("var binding name must be a symbol", "var");
  }

  const value = list.elements[2];
  const evaluatedValue = evaluateForMacro(value, env, logger);

  // Define in CURRENT environment (not a new scope)
  env.define((name as SSymbol).name, evaluatedValue);

  logger.debug(`Defined var '${(name as SSymbol).name}' in macro environment`);

  // Return the evaluated value
  return evaluatedValue;
}

/* Evaluate a macro call */
function evaluateMacroCall(
  list: SList,
  env: Environment,
  logger: Logger,
): SExp {
  const op = (list.elements[0] as SSymbol).name;
  const macroFn = env.getMacro(op);
  if (!macroFn) {
    throw new MacroError(`Macro not found: ${op}`, op);
  }
  const args = list.elements.slice(1);
  const expanded = macroFn(args, env);
  return evaluateForMacro(expanded, env, logger);
}

/* Helper: Evaluate arguments for function calls
 *
 * This function evaluates macro-time arguments and extracts values appropriately:
 * - Literals: extract the primitive value (number, string, boolean)
 * - Symbols: return as-is (S-expression symbol)
 * - Lists: return as-is (S-expression list) - NOT converted to JS arrays
 *
 * This preserves S-expression type information for introspection functions
 * like `list?` and `symbol?` while still extracting primitive values for
 * arithmetic and comparison operations.
 */
function evaluateArguments(
  args: SExp[],
  env: Environment,
  logger: Logger,
): unknown[] {
  return args.map((arg) => {
    const evalArg = evaluateForMacro(arg, env, logger);
    // Extract primitive values from literals
    if (isLiteral(evalArg)) return evalArg.value;
    // Return S-expressions (lists, symbols) as-is to preserve type information
    return evalArg;
  });
}

/* Helper: Centralize math operations during function calls */
function tryMathOperation(op: string, args: unknown[], logger: Logger): SExp {
  try {
    const asNumber = (value: unknown): number => {
      if (typeof value === "number") return value;
      throw new Error(`Expected numeric argument, received ${typeof value}`);
    };

    if (op === "Math.abs" || op.endsWith(".abs")) {
      return createLiteral(Math.abs(asNumber(args[0])));
    }
    if (op === "Math.round" || op.endsWith(".round")) {
      return createLiteral(Math.round(asNumber(args[0])));
    }
    if (op === "Math.max" || op.endsWith(".max")) {
      const numbers = args.map(asNumber);
      return createLiteral(Math.max(...numbers));
    }
  } catch (callError) {
    logger.debug(
      `Error calling math function ${op}: ${
        callError instanceof Error ? callError.message : String(callError)
      }`,
    );
    return createLiteral(0);
  }
  // Should not reach here if op matches math functions
  return createLiteral(0);
}

/* Evaluate a function call with improved error handling */
function evaluateFunctionCall(
  list: SList,
  env: Environment,
  logger: Logger,
): SExp {
  const first = list.elements[0];
  if (isSymbol(first)) {
    const op = (first as SSymbol).name;
    try {
      const fn = env.lookup(op);
      if (typeof fn === "function") {
        const evalArgs = evaluateArguments(list.elements.slice(1), env, logger);
        if (
          op === "Math.abs" || op.endsWith(".abs") ||
          op === "Math.round" || op.endsWith(".round") ||
          op === "Math.max" || op.endsWith(".max")
        ) {
          return tryMathOperation(op, evalArgs, logger);
        }
        const callable = fn as (...args: unknown[]) => unknown;
        return convertJsValueToSExp(callable(...evalArgs));
      }
    } catch {
      logger.debug(`Function '${op}' not found during macro expansion`);
    }
  }
  return createListFrom(
    list,
    list.elements.map((elem) => evaluateForMacro(elem, env, logger)),
  );
}

/* Evaluate a quasiquoted expression */
function evaluateQuasiquote(
  expr: SList,
  env: Environment,
  logger: Logger,
): SExp {
  if (expr.elements.length !== 2) {
    throw new MacroError(
      "quasiquote requires exactly one argument",
      "quasiquote",
    );
  }
  logger.debug(`Evaluating quasiquote: ${sexpToString(expr.elements[1])}`);
  return processQuasiquotedExpr(expr.elements[1], 0, env, logger);
}

/* Process a quasiquoted expression with depth tracking for nested quasiquotes
 * BUG FIX: Added depth parameter to properly handle nested quasiquotes
 * - depth=0: we're at the outermost quasiquote level
 * - depth>0: we're inside nested quasiquotes
 * - unquote decrements depth
 * - nested quasiquote increments depth
 */
function processQuasiquotedExpr(
  expr: SExp,
  depth: number,
  env: Environment,
  logger: Logger,
): SExp {
  if (!isList(expr)) return expr;
  const list = expr as SList;
  if (list.elements.length === 0) return expr;
  const first = list.elements[0];

  // Check for nested quasiquote - increment depth
  if (isSymbol(first) && (first as SSymbol).name === "quasiquote") {
    if (list.elements.length !== 2) {
      throw new MacroError(
        "quasiquote requires exactly one argument",
        "quasiquote",
      );
    }
    // Process inner quasiquote at increased depth
    const innerProcessed = processQuasiquotedExpr(
      list.elements[1],
      depth + 1,
      env,
      logger,
    );
    // At depth 0, expand the inner quasiquote fully
    // At depth > 0, preserve the quasiquote form as data
    if (depth === 0) {
      return innerProcessed;
    } else {
      return createListFrom(list, [{ type: "symbol", name: "quasiquote" }, innerProcessed]);
    }
  }

  // Check for unquote - evaluate if depth=0, otherwise decrement depth
  if (isSymbol(first) && (first as SSymbol).name === "unquote") {
    if (list.elements.length !== 2) {
      throw new MacroError("unquote requires exactly one argument", "unquote");
    }
    if (depth === 0) {
      // At depth 0, unquote evaluates the expression
      logger.debug(`Evaluating unquote: ${sexpToString(list.elements[1])}`);
      return evaluateForMacro(list.elements[1], env, logger);
    } else if (depth === 1) {
      // At depth 1, unquote gives us the unevaluated expression
      // Don't process further - just return the expression as data
      return list.elements[1];
    } else {
      // At depth > 1, unquote decrements depth and wraps in unquote form
      const innerProcessed = processQuasiquotedExpr(
        list.elements[1],
        depth - 1,
        env,
        logger,
      );
      return createListFrom(list, [{ type: "symbol", name: "unquote" }, innerProcessed]);
    }
  }

  if (isSymbol(first) && (first as SSymbol).name === "unquote-splicing") {
    if (depth > 0) {
      // Handle unquote-splicing at nested depth
      if (list.elements.length !== 2) {
        throw new MacroError(
          "unquote-splicing requires exactly one argument",
          "unquote-splicing",
        );
      }
      const innerProcessed = processQuasiquotedExpr(
        list.elements[1],
        depth - 1,
        env,
        logger,
      );
      return createListFrom(list, [
        { type: "symbol", name: "unquote-splicing" },
        innerProcessed,
      ]);
    }
    throw new MacroError(
      "unquote-splicing not in list context",
      "unquote-splicing",
    );
  }

  // Process list elements, handling unquote-splicing at depth 0
  const processedElements: SExp[] = [];
  for (const element of list.elements) {
    if (
      depth === 0 &&
      isList(element) &&
      (element as SList).elements.length > 0 &&
      isSymbol((element as SList).elements[0]) &&
      ((element as SList).elements[0] as SSymbol).name === "unquote-splicing"
    ) {
      const spliceList = element as SList;
      if (spliceList.elements.length !== 2) {
        throw new MacroError(
          "unquote-splicing requires exactly one argument",
          "unquote-splicing",
        );
      }
      const splicedExpr = spliceList.elements[1];
      logger.debug(`Processing unquote-splicing: ${sexpToString(splicedExpr)}`);
      const spliced = evaluateForMacro(splicedExpr, env, logger);
      logger.debug(`Evaluated unquote-splicing to: ${sexpToString(spliced)}`);
      if (isList(spliced)) {
        processedElements.push(...(spliced as SList).elements);
      } else if (isRestParameterSplice(spliced)) {
        processedElements.push(...spliced.elements);
      } else {
        logger.warn(
          `unquote-splicing received a non-list value: ${
            sexpToString(spliced)
          }`,
        );
        processedElements.push(spliced);
      }
    } else {
      processedElements.push(
        processQuasiquotedExpr(element, depth, env, logger),
      );
    }
  }
  // Preserve _meta from original list for source location tracking
  return createListFrom(list, processedElements);
}

/* Modified expandMacroExpression with visualization support */
function expandMacroExpression(
  expr: SExp,
  env: Environment,
  options: MacroExpanderOptions,
  depth: number,
): SExp {
  const maxDepth = options.maxExpandDepth || 100;

  if (depth > maxDepth) {
    if (options.maxExpandDepth === undefined) {
      logger.warn(
        `Reached maximum expansion depth (${maxDepth}). Possible recursive macro?`,
        "macro",
      );
    }
    return expr;
  }

  if (isList(expr) && isDefMacro(expr)) {
    defineMacro(expr as SList, env, logger);
    const placeholder = createNilLiteral();
    Object.defineProperty(placeholder, "__macroPlaceholder", {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return placeholder;
  }

  if (!isList(expr)) return expr;

  const list = expr as SList;
  if (list.elements.length === 0) return list;

  const first = list.elements[0];
  if (isSymbol(first)) {
    const op = (first as SSymbol).name;
    if (op === "macro") return expr;

    if (env.hasMacro(op)) {
      const macroFn = env.getMacro(op);
      if (!macroFn) return expr;

      const args = list.elements.slice(1);
      const originalExpr = list;

      logger.debug(`Expanding macro ${op} at depth ${depth}`, "macro");

      const expanded = macroFn(args, env);

      // CRITICAL: Copy _meta from original call site to expanded expression
      // This ensures error messages point to the original source location,
      // not the macro definition file. Without this, errors would show
      // line numbers from the macro definition (e.g., core.hql:185)
      // instead of the actual call site (e.g., user.hql:2).
      const callSiteMeta = getMeta(originalExpr);
      if (callSiteMeta) {
        // Recursively update _meta for all elements in the expanded expression
        // that have a different filePath (i.e., from the macro definition file)
        updateMetaRecursively(expanded, callSiteMeta);
      }

      visualizeMacroExpansion(originalExpr, expanded, op, logger);
      return expandMacroExpression(expanded, env, options, depth + 1);
    }
  }

  let hasChanged = false;
  const expandedElements = list.elements.map((elem) => {
    const expanded = expandMacroExpression(elem, env, options, depth + 1);
    if (expanded !== elem) {
      hasChanged = true;
    }
    return expanded;
  });

  const cleanedElements = expandedElements.filter((elem) =>
    !isMacroPlaceholder(elem)
  );
  
  if (cleanedElements.length !== expandedElements.length) {
    hasChanged = true;
  }

  // Optimization: If nothing changed, return the original object
  // This allows reference equality checks in the main loop
  if (!hasChanged) {
    return list;
  }

  // Use createListFrom to preserve source location through transformation
  return createListFrom(list, cleanedElements);
}

/* Filter out macro definitions from the final S-expression list */
function filterMacroDefinitions(exprs: SExp[], logger: Logger): SExp[] {
  return exprs.filter((expr) => {
    if (isDefMacro(expr)) {
      logger.debug(`Filtering out macro definition: ${sexpToString(expr)}`);
      return false;
    }
    return !isMacroPlaceholder(expr);
  });
}

/* Visualize the macro expansion process with ASCII graphics */
function visualizeMacroExpansion(
  original: SExp,
  expanded: SExp,
  macroName: string,
  logger: Logger,
): void {
  if (!logger.isNamespaceEnabled("macro")) return;

  const originalStr = sexpToString(original);
  const expandedStr = sexpToString(expanded);
  const separator = "=".repeat(80);
  const header = `MACRO EXPANSION: ${macroName}`;
  const headerLine = `== ${header} ${
    "=".repeat(Math.max(0, separator.length - header.length - 4))
  }`;

  logger.log({
    text: `\n${separator}\n${headerLine}\n${separator}\n`,
    namespace: "macro",
  });
  logger.log({
    text: `ORIGINAL:\n${formatExpression(originalStr)}`,
    namespace: "macro",
  });
  logger.log({
    text: `\n   |\n   V\n`,
    namespace: "macro",
  });
  logger.log({
    text: `EXPANDED:\n${formatExpression(expandedStr)}\n`,
    namespace: "macro",
  });
  logger.log({ text: separator, namespace: "macro" });
}

/* Format an S-expression string for readability */
function formatExpression(expr: string): string {
  let indentLevel = 0;
  let result = "";
  let inString = false;

  for (let i = 0; i < expr.length; i++) {
    const char = expr[i];
    if (char === '"' && (i === 0 || expr[i - 1] !== "\\")) {
      inString = !inString;
      result += char;
      continue;
    }
    if (inString) {
      result += char;
      continue;
    }
    switch (char) {
      case "(":
        result += char;
        indentLevel++;
        if (i + 1 < expr.length && expr[i + 1] !== ")") {
          result += "\n" + " ".repeat(indentLevel * 2);
        }
        break;
      case ")":
        indentLevel--;
        result = result.endsWith(" ") ? result.trimEnd() : result;
        result += char;
        break;
      case " ":
        if (i > 0 && expr[i - 1] !== "(" && expr[i - 1] !== " ") {
          result += "\n" + " ".repeat(indentLevel * 2);
        }
        break;
      default:
        result += char;
    }
  }
  return result;
}
/* Create a macro function */
function createMacroFunction(
  macroName: string,
  params: string[],
  restParam: string | null,
  body: SExp[],
  logger: Logger,
): MacroFn {
  const macroFn = (args: SExp[], callEnv: Environment): SExp => {
    logger.debug(`Expanding macro ${macroName} with ${args.length} args`);
    callEnv.setCurrentMacroContext(`macro_${macroName}`);
    const macroEnv = createMacroEnv(callEnv, params, restParam, args, logger);
    let result: SExp = createNilLiteral();
    for (const expr of body) {
      result = evaluateForMacro(expr, macroEnv, logger);
    }
    // applyHygiene REMOVED - was broken, HQL uses manual hygiene with gensym
    callEnv.setCurrentMacroContext(null);
    logger.debug(`Macro ${macroName} expanded to: ${sexpToString(result)}`);
    return result;
  };

  Object.defineProperty(macroFn, "isMacro", { value: true });
  Object.defineProperty(macroFn, "macroName", { value: macroName });

  return macroFn;
}

/* applyHygiene REMOVED - was broken and unused
 * HQL uses manual hygiene (Common Lisp style) with gensym
 * Users should call (gensym) to generate unique names in macros
 */

/* Create a new environment for macro expansion with parameter bindings */
function createMacroEnv(
  parent: Environment,
  params: string[],
  restParam: string | null,
  args: SExp[],
  logger: Logger,
): Environment {
  const env = parent.extend();

  // Bind regular parameters
  for (let i = 0; i < params.length; i++) {
    const paramValue = i < args.length ? args[i] : createNilLiteral();
    env.define(params[i], paramValue);
  }

  // Bind rest parameter
  if (restParam !== null) {
    const restArgs = args.slice(params.length);
    logger.debug(
      `Creating rest parameter '${restParam}' with ${restArgs.length} elements`,
    );
    const restList = createList(...restArgs);
    Object.defineProperty(restList, "isRestParameter", { value: true });
    env.define(restParam, restList);
  }

  return env;
}
