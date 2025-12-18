// core/src/s-exp/macro.ts - Refactored to remove user-level macro support

import {
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
import { HQLError, MacroError } from "../common/error.ts";
import { isGensymSymbol, gensym } from "../gensym.ts";
import { globalLogger as logger } from "../logger.ts";
import { getErrorMessage, isObjectValue, isNullish } from "../common/utils.ts";
import {
  Interpreter,
  createStandardEnv,
  hqlValueToSExp,
  getSpecialForms,
  type InterpreterEnv,
} from "../interpreter/index.ts";

// Constants and caches
const MAX_EXPANSION_ITERATIONS = 100;

// Lazy singleton interpreter for macro-time evaluation
let macroInterpreter: Interpreter | null = null;
// Persistent environment for user-defined functions across macro expansions
let persistentMacroEnv: InterpreterEnv | null = null;

/**
 * Get or create the macro-time interpreter
 */
function getMacroInterpreter(): Interpreter {
  if (!macroInterpreter) {
    macroInterpreter = new Interpreter({ maxCallDepth: 100, maxSeqLength: 10000 });
  }
  return macroInterpreter;
}

/**
 * Get or create the persistent macro environment
 * This environment survives across macro expansions, allowing user-defined
 * functions to be used in later macros (like Clojure).
 */
function getPersistentMacroEnv(): InterpreterEnv {
  if (!persistentMacroEnv) {
    persistentMacroEnv = createStandardEnv();
  }
  return persistentMacroEnv;
}

/**
 * Convert S-expression value to HQL value for interpreter use
 * This is critical for bridging compiler env (S-expressions) to interpreter env (HQL values)
 *
 * IMPORTANT: We ONLY convert S-expression literals (primitives) to HQL values.
 * S-expression lists and symbols are kept as-is because:
 * - `list?` and `symbol?` introspection functions need S-expression objects
 * - Macro expansion works on S-expression AST nodes, not HQL runtime values
 */
function sexpToHqlValue(value: unknown): import("../interpreter/types.ts").HQLValue {
  // If it's already a primitive, return as-is
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }

  // If it's an S-expression literal, extract the primitive value
  // This is the ONLY S-expression type we convert - literals become primitives
  if (isObjectValue(value) && (value as { type?: string }).type === "literal") {
    return (value as unknown as SLiteral).value;
  }

  // S-expression symbols and lists are kept as-is for introspection (list?, symbol?)
  // They will be handled by the interpreter's S-expression aware builtins
  if (isObjectValue(value) && (
    (value as { type?: string }).type === "symbol" ||
    (value as { type?: string }).type === "list"
  )) {
    return value as unknown as import("../interpreter/types.ts").HQLValue;
  }

  // If it's already an array, keep it as-is (runtime HQL arrays)
  if (Array.isArray(value)) {
    return value as unknown as import("../interpreter/types.ts").HQLValue;
  }

  // Functions and other values pass through as-is
  return value as unknown as import("../interpreter/types.ts").HQLValue;
}

/**
 * Resolve a value for the interpreter environment.
 * This is the key to making function arguments work in macros.
 *
 * - S-exp symbols are resolved to actual values if defined in interpreter env
 * - S-exp constructor lists like (empty-map) are evaluated to produce real Maps
 * - Everything else passes through sexpToHqlValue
 *
 * This fixes the problem where (m triple) passes an S-exp symbol instead of the function.
 */
function resolveValueForInterpreter(
  value: unknown,
  interpEnv: InterpreterEnv
): import("../interpreter/types.ts").HQLValue {
  // If S-exp symbol, try to resolve to actual value in interpreter env
  // This is critical for function references passed as macro arguments
  if (isObjectValue(value) && (value as { type?: string }).type === "symbol") {
    const symbolName = (value as unknown as SSymbol).name;
    // Check if symbol refers to something in interpreter env (user fn, stdlib fn, etc.)
    if (interpEnv.isDefined(symbolName)) {
      return interpEnv.lookup(symbolName);
    }
    // Symbol not defined - keep as S-exp for introspection (symbol?, etc.)
  }

  // If S-exp list that looks like a constructor, evaluate it
  // This fixes {} parsing to (empty-map) not being evaluated to a real Map
  if (isObjectValue(value) && (value as { type?: string }).type === "list") {
    const list = value as unknown as SList;
    if (list.elements.length > 0 && isSymbol(list.elements[0])) {
      const op = (list.elements[0] as SSymbol).name;
      // Evaluate constructor calls that produce runtime values
      if (op === "empty-map" || op === "hash-map" || op === "hash-set" || op === "vector") {
        try {
          const interpreter = getMacroInterpreter();
          return interpreter.eval(list, interpEnv);
        } catch {
          // If evaluation fails, fall through to default
        }
      }
    }
  }

  // Default: use existing conversion
  return sexpToHqlValue(value);
}

/**
 * Bridge compiler Environment to InterpreterEnv
 * Copies ALL bindings from the ENTIRE scope chain (not just immediate scope)
 *
 * This is critical for macro evaluation because:
 * - Macro parameters are bound in a parent scope
 * - Let bindings create child scopes
 * - The interpreter needs access to ALL variables in the chain
 * - User-defined functions from earlier in the file are preserved in persistent env
 */
function bridgeToInterpreterEnv(compilerEnv: Environment): InterpreterEnv {
  // Use persistent env as base to preserve user-defined functions across macro expansions
  const interpEnv = getPersistentMacroEnv().extend();

  // Collect ALL bindings from the entire scope chain
  // Walk up the parent chain and collect all variable bindings
  const allBindings = new Map<string, unknown>();
  let currentEnv: Environment | null = compilerEnv;

  while (currentEnv !== null) {
    // Iterate over variables in this scope
    for (const [name, value] of currentEnv.variables) {
      // Only add if not already defined (inner scope shadows outer)
      if (!allBindings.has(name)) {
        allBindings.set(name, value);
      }
    }
    // Move to parent scope
    currentEnv = currentEnv.getParent();
  }

  // Now copy all collected bindings to interpreter env
  // IMPORTANT: Use resolveValueForInterpreter to properly handle:
  // - S-exp symbols -> actual function values (critical for function args in macros)
  // - S-exp constructors like (empty-map) -> actual Map objects
  for (const [name, value] of allBindings) {
    // Skip if already in standard env (builtins/stdlib)
    if (!interpEnv.isDefined(name)) {
      const hqlValue = resolveValueForInterpreter(value, interpEnv);
      interpEnv.define(name, hqlValue);
    }
  }

  return interpEnv;
}

// Auto-gensym: Map from "foo#" to generated symbol within a quasiquote
type AutoGensymMap = Map<string, SSymbol>;

/**
 * Check if a symbol name is an auto-gensym (ends with #)
 * e.g., "tmp#", "result#", "value#"
 */
function isAutoGensymSymbol(name: string): boolean {
  return name.length > 1 && name.endsWith("#");
}

/**
 * Get or create a gensym for an auto-gensym symbol
 * All occurrences of "foo#" within the same quasiquote map to the same symbol
 */
function getAutoGensym(name: string, autoGensymMap: AutoGensymMap): SSymbol {
  if (autoGensymMap.has(name)) {
    return autoGensymMap.get(name)!;
  }
  // Strip the # suffix and use as prefix for gensym
  const prefix = name.slice(0, -1);
  const generated = gensym(prefix);
  const symbol: SSymbol = { type: "symbol", name: generated.name };
  autoGensymMap.set(name, symbol);
  return symbol;
}
// macroCache removed - use env.hasMacro()
// macroExpansionCache REMOVED - was never actually used for caching
// symbolRenameMap REMOVED - was part of broken automatic hygiene attempt
// HQL uses manual hygiene (Common Lisp style) with gensym

export interface MacroExpanderOptions {
  verbose?: boolean;
  maxExpandDepth?: number;
  currentFile?: string;
  iterationLimit?: number;
}

/**
 * Update _meta for all elements in an S-expression tree.
 * This fixes source location tracking for macro-expanded code.
 *
 * All elements in the expanded expression are updated to use the call site's
 * _meta. This ensures error messages point to where the user wrote the macro
 * call, not where the macro was defined.
 *
 * Note: This means user arguments passed to the macro will also get the call
 * site position. This is intentional - the entire macro call logically exists
 * at the call site, and errors should point there.
 *
 * Uses iterative approach with explicit stack to avoid stack overflow
 * on deeply nested ASTs.
 */
function updateMetaRecursively(expr: SExp, callSiteMeta: SExpMeta): void {
  // Use explicit stack instead of recursion to prevent stack overflow
  const stack: SExp[] = [expr];

  while (stack.length > 0) {
    const current = stack.pop()!;

    // Skip primitive values - they can't have _meta set on them
    if (typeof current !== "object" || current === null) {
      continue;
    }

    const exprMeta = getMeta(current);

    // Update to call site position for macro-expanded code when:
    // 1. No existing metadata
    // 2. Different source file (macro definition in another file)
    // 3. Same file but expression comes from earlier in file (macro definition)
    //
    // This fixes the bug where same-file macros would keep positions
    // from the macro definition instead of the call site.
    const shouldUpdate = !exprMeta ||
        exprMeta.filePath !== callSiteMeta.filePath ||
        (exprMeta.line !== undefined && callSiteMeta.line !== undefined &&
         exprMeta.line < callSiteMeta.line);

    if (shouldUpdate) {
      (current as { _meta?: SExpMeta })._meta = { ...callSiteMeta };
    }

    // Push children onto stack for processing
    if (isList(current)) {
      // Push in reverse order so we process left-to-right
      const elements = (current as SList).elements;
      for (let i = elements.length - 1; i >= 0; i--) {
        stack.push(elements[i]);
      }
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

  // Functions should not reach here in normal operation.
  // If they do, it means a function was looked up but not called,
  // which is a macro evaluation error.
  if (typeof value === "function") {
    throw new MacroError(
      "Cannot convert function to S-expression. Functions must be called, not referenced as values in macro context.",
      "convertJsValueToSExp"
    );
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

    if (env.hasMacro(macroName)) {
      logger.debug(`Redefined global macro ${macroName}`);
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

  // Handle vector form [a b] -> (vector a b)
  // This is needed when macro args are passed to let bindings
  const elements = isVectorForm(bindingsList)
    ? bindingsList.elements.slice(1)
    : bindingsList.elements;

  if (elements.length % 2 !== 0) {
    throw new MacroError(
      "let bindings must have an even number of forms",
      "let",
    );
  }
  const letEnv = env.extend();
  for (let i = 0; i < elements.length; i += 2) {
    const name = elements[i];
    const value = elements[i + 1];
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

/**
 * Check if an expression is a named function definition: (fn name [params] body...)
 */
function isNamedFnDefinition(list: SList): boolean {
  if (list.elements.length < 3) return false;
  const first = list.elements[0];
  if (!isSymbol(first) || (first as SSymbol).name !== "fn") return false;
  const second = list.elements[1];
  return isSymbol(second);
}

/**
 * Register a named function definition in the persistent macro environment
 *
 * (fn name [params] body...) - named function
 *
 * When a named function is encountered during macro expansion, we:
 * 1. Evaluate it using the interpreter
 * 2. Store the resulting HQL function in the persistent macro environment
 *
 * This enables user-defined functions to be used in later macros, like Clojure.
 */
function registerNamedFnInMacroEnv(
  expr: SList,
  logger: Logger
): void {
  const fnName = (expr.elements[1] as SSymbol).name;

  // Evaluate the fn form using the interpreter to create an HQL function
  try {
    const interpreter = getMacroInterpreter();
    const interpEnv = getPersistentMacroEnv();
    interpreter.eval(expr, interpEnv);

    // The interpreter's handleFn already defines the function in its env
    logger.debug(`Registered user function '${fnName}' in macro environment`);
  } catch (error) {
    // If evaluation fails, silently continue - function will still be transpiled
    logger.debug(`Could not evaluate fn '${fnName}' at macro-time: ${getErrorMessage(error)}`);
  }
}

/**
 * Pre-expand macro calls in a list of arguments.
 * This is used by both evaluateFunctionCall and expandMacroExpression
 * to ensure nested macro calls are expanded before passing to outer operations.
 *
 * DRY: This helper consolidates the pre-expansion pattern used in multiple places.
 *
 * @param args - The arguments to process
 * @param env - The environment for macro lookup
 * @param expandFn - The function to use for expanding macro calls
 * @returns Arguments with nested macro calls expanded
 */
function preExpandMacroArgs<T>(
  args: SExp[],
  env: Environment,
  expandFn: (arg: SExp) => T,
): (SExp | T)[] {
  return args.map((arg) => {
    if (isList(arg)) {
      const argList = arg as SList;
      if (argList.elements.length > 0 && isSymbol(argList.elements[0])) {
        const argOp = (argList.elements[0] as SSymbol).name;
        if (env.hasMacro(argOp)) {
          return expandFn(arg);
        }
      }
    }
    return arg;
  });
}

// Cache special forms from interpreter (canonical source of truth)
let _specialFormsCache: Set<string> | null = null;
function getSpecialFormsSet(): Set<string> {
  if (!_specialFormsCache) {
    _specialFormsCache = new Set(getSpecialForms().keys());
  }
  return _specialFormsCache;
}

/**
 * Check if an operator is known (can be evaluated).
 *
 * This function determines whether a list form like (op ...) can be evaluated
 * during macro expansion. Known operators include:
 * - Special forms (from interpreter's canonical list)
 * - Macros (defined in environment)
 * - Macro primitives (% prefix convention)
 * - Functions (defined in compiler or interpreter environment)
 *
 * Unknown operators (like 'case', 'default') are treated as syntax/data,
 * allowing code-generating macros to receive them unevaluated.
 */
function isKnownOperator(op: string, env: Environment): boolean {
  // Special forms - use interpreter's canonical list
  if (getSpecialFormsSet().has(op)) return true;

  // Macros
  if (env.hasMacro(op)) return true;

  // Macro primitives (% prefix convention)
  if (op.startsWith("%")) return true;

  // Try compiler env (user-defined functions, stdlib bindings)
  try {
    const value = env.lookup(op);
    if (typeof value === "function") return true;
  } catch {
    // Not found in compiler env
  }

  // Try interpreter's persistent env (stdlib functions, arithmetic operators, etc.)
  try {
    const interpEnv = getPersistentMacroEnv();
    if (interpEnv.isDefined(op)) return true;
  } catch {
    // Not found
  }

  return false;
}

/**
 * Evaluate an argument for a macro call.
 *
 * This carefully handles the distinction between:
 * - Evaluable expressions (known operators): evaluate them for computation macros
 * - Syntax/data forms (unknown operators like 'case'): preserve for code-generating macros
 *
 * This enables BOTH patterns:
 * - Code-generating macros like `match` that receive syntax as data
 * - Compile-time computation macros like `count-sum` that need evaluated args
 *
 * Examples:
 *   - (count-sum (- n 1)) → evaluates (- n 1) because '-' is known
 *   - (match x (case pat res)) → preserves (case pat res) because 'case' is unknown
 */
function evaluateArgumentForMacro(
  arg: SExp,
  env: Environment,
  logger: Logger,
): SExp {
  // Non-list expressions: evaluate normally (symbols resolve, literals pass through)
  if (!isList(arg)) {
    return evaluateForMacro(arg, env, logger);
  }

  const argList = arg as SList;
  if (argList.elements.length === 0) {
    return arg;
  }

  const first = argList.elements[0];

  // Non-symbol head (IIFE, etc.): evaluate normally
  if (!isSymbol(first)) {
    return evaluateForMacro(arg, env, logger);
  }

  const op = (first as SSymbol).name;

  // Check if operator is known (evaluable)
  if (isKnownOperator(op, env)) {
    return evaluateForMacro(arg, env, logger);
  }

  // Unknown operator - this is likely syntax/data for a code-generating macro
  // Return as-is without evaluating (prevents errors on forms like (case x (if guard) y))
  logger.debug(`Preserving '${op}' form as syntax in macro argument`);
  return arg;
}

/* Evaluate a macro call
 *
 * HYBRID SEMANTICS: Evaluate arguments with known operators, preserve unknown syntax.
 *
 * This combines the best of both worlds:
 * - Computation macros (like count-sum) get evaluated arguments: (- n 1) → 2
 * - Code-generating macros (like match) get syntax preserved: (case x y) stays as-is
 *
 * The distinction is based on whether the argument's operator is KNOWN (function,
 * macro, special form, builtin) or UNKNOWN (syntax marker like 'case', 'default').
 *
 * Examples:
 *   - (count-sum (- 3 1)) - '-' is known, so (- 3 1) evaluates to 2
 *   - (__match_impl__ val (case x y)) - 'case' is unknown, so (case x y) stays as syntax
 */
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

  // Evaluate arguments with hybrid semantics:
  // - Known operators (functions, macros, special forms): evaluate
  // - Unknown operators (syntax markers like 'case'): preserve as-is
  const args = list.elements.slice(1).map((arg) =>
    evaluateArgumentForMacro(arg, env, logger)
  );

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

/* Evaluate a function call - ALL HQL functions work in macros automatically
 *
 * Strategy: Try interpreter first, fall back to compiler env.
 *
 * The interpreter has stdlib loaded, so all HQL functions work automatically.
 * Compiler primitives (%first, %rest, etc.) are:
 *   - NOT defined in interpreter builtins
 *   - NOT copied during bridgeToInterpreterEnv (filtered out)
 * So they naturally fall through to compiler env lookup.
 *
 * ZERO special cases. ZERO hardcoded lists. Clean architectural separation.
 */
function evaluateFunctionCall(
  list: SList,
  env: Environment,
  logger: Logger,
): SExp {
  const first = list.elements[0];
  if (isSymbol(first)) {
    const op = (first as SSymbol).name;

    // Macro primitives (% prefix) go directly to compiler env - they're designed for S-exps
    if (op.startsWith("%")) {
      try {
        const fn = env.lookup(op);
        if (typeof fn === "function") {
          const evalArgs = evaluateArguments(list.elements.slice(1), env, logger);
          const callable = fn as (...args: unknown[]) => unknown;
          return convertJsValueToSExp(callable(...evalArgs));
        }
      } catch {
        logger.debug(`Macro primitive '${op}' not found in compiler env`);
      }
    }

    // For everything else: try interpreter first (handles S-exp conversion for stdlib)
    try {
      const interpreter = getMacroInterpreter();
      const interpEnv = bridgeToInterpreterEnv(env);

      if (interpEnv.isDefined(op)) {
        logger.debug(`Using interpreter for '${op}'`);

        // Pre-expand macro calls in arguments before passing to interpreter.
        // The interpreter doesn't know about HQL macros, so we expand them first.
        // Example: (+ (double x) 5) where 'double' is a macro -> (+ 10 5)
        const expandedArgs = preExpandMacroArgs(
          list.elements.slice(1),
          env,
          (arg) => evaluateForMacro(arg, env, logger),
        );
        const expandedList = createListFrom(list, [first, ...expandedArgs]);

        const result = interpreter.eval(expandedList, interpEnv);
        return hqlValueToSExp(result);
      }
    } catch (interpError) {
      logger.debug(
        `Interpreter evaluation failed for '${op}': ${getErrorMessage(interpError)}`
      );
      // Fall through to compiler env
    }

    // Fall back to compiler env
    try {
      const fn = env.lookup(op);
      if (typeof fn === "function") {
        const evalArgs = evaluateArguments(list.elements.slice(1), env, logger);
        const callable = fn as (...args: unknown[]) => unknown;
        return convertJsValueToSExp(callable(...evalArgs));
      }
    } catch {
      logger.debug(`Function '${op}' not found in compiler env`);
    }
  }

  // Fallback: return the list with evaluated elements
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
  // Create auto-gensym map for this quasiquote template
  // All foo# symbols within this template will map to the same generated symbol
  const autoGensymMap: AutoGensymMap = new Map();
  return processQuasiquotedExpr(expr.elements[1], 0, env, logger, autoGensymMap);
}

/* Process a quasiquoted expression with depth tracking for nested quasiquotes
 * BUG FIX: Added depth parameter to properly handle nested quasiquotes
 * - depth=0: we're at the outermost quasiquote level
 * - depth>0: we're inside nested quasiquotes
 * - unquote decrements depth
 * - nested quasiquote increments depth
 *
 * AUTO-GENSYM: Symbols ending with # (e.g., tmp#, result#) are automatically
 * replaced with unique gensyms. All occurrences of the same foo# within
 * the same quasiquote template map to the same generated symbol.
 */
function processQuasiquotedExpr(
  expr: SExp,
  depth: number,
  env: Environment,
  logger: Logger,
  autoGensymMap: AutoGensymMap = new Map(),
): SExp {
  // Handle auto-gensym symbols (e.g., tmp#, value#)
  // Only at depth 0 - nested quasiquotes get their own context
  if (isSymbol(expr) && depth === 0) {
    const symName = (expr as SSymbol).name;
    if (isAutoGensymSymbol(symName)) {
      const generated = getAutoGensym(symName, autoGensymMap);
      logger.debug(`Auto-gensym: ${symName} -> ${generated.name}`);
      return generated;
    }
    return expr;
  }

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
    // Note: nested quasiquotes get a fresh autoGensymMap for their own scope
    const innerProcessed = processQuasiquotedExpr(
      list.elements[1],
      depth + 1,
      env,
      logger,
      depth === 0 ? new Map() : autoGensymMap,
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
        autoGensymMap,
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
        autoGensymMap,
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
        const elements = (spliced as SList).elements;
        // Skip "vector" prefix if present - vectors returned from interpreter
        // are represented as (vector a b c), but we want to splice [a b c]
        if (
          elements.length > 0 &&
          isSymbol(elements[0]) &&
          (elements[0] as SSymbol).name === "vector"
        ) {
          processedElements.push(...elements.slice(1));
        } else {
          processedElements.push(...elements);
        }
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
        processQuasiquotedExpr(element, depth, env, logger, autoGensymMap),
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

  // Register named fn definitions in persistent macro env for use in macros
  // This is similar to Clojure's incremental evaluation model
  if (isList(expr) && isNamedFnDefinition(expr as SList)) {
    registerNamedFnInMacroEnv(expr as SList, logger);
    // Continue with normal expansion (don't return early)
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

      // Arguments to compile-time macros need careful handling.
      // For code-generating macros (using quasiquote), args should be passed as code.
      // But for compile-time evaluation macros, args need to be evaluated first.
      //
      // We only pre-expand MACRO calls in arguments, keeping other expressions as code.
      // This preserves macro semantics (receiving code as data) while enabling
      // patterns like (dec1 (dec1 5)) where nested macros need expansion.
      // DRY: Uses preExpandMacroArgs helper for consistent pre-expansion logic.
      const args = preExpandMacroArgs(
        list.elements.slice(1),
        env,
        (arg) => expandMacroExpression(arg, env, options, depth + 1),
      );
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
