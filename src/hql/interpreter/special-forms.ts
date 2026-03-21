// src/hql/interpreter/special-forms.ts - Special form handlers for the HQL interpreter

import type {
  HQLFunction,
  HQLValue,
  Interpreter as IInterpreter,
  InterpreterEnv,
} from "./types.ts";
import { isHQLFunction, isSExp, isTruthy } from "./types.ts";
import { SEQ_SYMBOL } from "../../common/protocol-symbols.ts";
import {
  __hql_splice_to_sexp_items,
  __hql_value_to_sexp,
} from "../../common/runtime-helper-impl.ts";
import { ArityError, SyntaxError } from "./errors.ts";
import {
  createList,
  createNilLiteral,
  createSymbol,
  isList,
  isSymbol,
  isVector,
  type SExp,
  type SList,
  type SLiteral,
  type SSymbol,
} from "../s-exp/types.ts";
import type { ResolvedBindingMeta } from "../s-exp/types.ts";
import {
  processTemplateQuote as processSharedTemplateQuote,
  type TemplateQuoteContext,
} from "../s-exp/template-quote.ts";

/**
 * Map of special form names to their handlers
 */
export type SpecialFormHandler = (
  args: SExp[],
  env: InterpreterEnv,
  interpreter: IInterpreter,
) => HQLValue;

/**
 * Parse function parameters from a parameter list
 * Handles both (a b c) and [a b c] (vector) syntax
 * Supports rest parameters with &
 */
function parseParams(
  paramsExpr: SExp,
): { params: string[]; restParam: string | null } {
  if (!isList(paramsExpr)) {
    throw new SyntaxError("fn", "parameters must be a list or vector");
  }

  const list = paramsExpr as SList;
  const elements = isVector(list) ? list.elements.slice(1) : list.elements;

  const params: string[] = [];
  let restParam: string | null = null;
  let restMode = false;

  for (const elem of elements) {
    if (!isSymbol(elem)) {
      throw new SyntaxError("fn", "parameter must be a symbol");
    }

    const name = (elem as SSymbol).name;

    if (name === "&") {
      restMode = true;
      continue;
    }

    if (restMode) {
      restParam = name;
      break; // Only one rest parameter allowed
    }

    params.push(name);
  }

  return { params, restParam };
}

/**
 * Special form: if
 * (if test then else?)
 */
function handleIf(
  args: SExp[],
  env: InterpreterEnv,
  interpreter: IInterpreter,
): HQLValue {
  if (args.length < 2 || args.length > 3) {
    throw new ArityError("if", "2 or 3", args.length);
  }

  const [test, thenExpr, elseExpr] = args;
  const testResult = interpreter.eval(test, env);

  if (isTruthy(testResult)) {
    return interpreter.eval(thenExpr, env);
  } else if (elseExpr !== undefined) {
    return interpreter.eval(elseExpr, env);
  } else {
    return null;
  }
}

/**
 * Special form: let
 * (let (name1 value1 name2 value2 ...) body...)
 * Or: (let [name1 value1 name2 value2 ...] body...)
 */
function handleLet(
  args: SExp[],
  env: InterpreterEnv,
  interpreter: IInterpreter,
): HQLValue {
  if (args.length < 1) {
    throw new SyntaxError("let", "requires bindings");
  }

  const bindingsExpr = args[0];
  if (!isList(bindingsExpr)) {
    throw new SyntaxError("let", "bindings must be a list or vector");
  }

  const bindingsList = bindingsExpr as SList;
  const elements = isVector(bindingsList)
    ? bindingsList.elements.slice(1)
    : bindingsList.elements;

  if (elements.length % 2 !== 0) {
    throw new SyntaxError("let", "bindings must have even number of forms");
  }

  // Create new scope for let bindings
  const letEnv = env.extend();

  // Process bindings sequentially (each can see previous)
  for (let i = 0; i < elements.length; i += 2) {
    const nameExpr = elements[i];
    const valueExpr = elements[i + 1];

    if (!isSymbol(nameExpr)) {
      throw new SyntaxError("let", "binding name must be a symbol");
    }

    const name = (nameExpr as SSymbol).name;
    const value = interpreter.eval(valueExpr, letEnv);
    letEnv.define(name, value);
  }

  // Evaluate body expressions in let scope
  const bodyExprs = args.slice(1);
  let result: HQLValue = null;
  for (const expr of bodyExprs) {
    result = interpreter.eval(expr, letEnv);
  }

  return result;
}

/**
 * Special form: var
 * (var name value)
 * Defines in CURRENT scope (not new scope like let)
 */
function handleVar(
  args: SExp[],
  env: InterpreterEnv,
  interpreter: IInterpreter,
): HQLValue {
  if (args.length !== 2) {
    throw new ArityError("var", 2, args.length);
  }

  const [nameExpr, valueExpr] = args;

  if (!isSymbol(nameExpr)) {
    throw new SyntaxError("var", "name must be a symbol");
  }

  const name = (nameExpr as SSymbol).name;
  const value = interpreter.eval(valueExpr, env);
  env.define(name, value);

  return value;
}

/**
 * Special form: fn
 * (fn [params] body...) - anonymous function
 * (fn name [params] body...) - named function
 */
function handleFn(
  args: SExp[],
  env: InterpreterEnv,
  _interpreter: IInterpreter,
): HQLValue {
  if (args.length < 2) {
    throw new SyntaxError("fn", "requires parameters and body");
  }

  const first = args[0];

  // Named function: (fn name [params] body...)
  if (isSymbol(first)) {
    const name = (first as SSymbol).name;
    const paramsExpr = args[1];
    const { params, restParam } = parseParams(paramsExpr);
    const body = args.slice(2);

    const fn: HQLFunction = {
      type: "hql-function",
      name,
      params,
      restParam,
      body,
      closure: env,
    };

    // Define in environment for recursion support
    env.define(name, fn);

    return fn;
  }

  // Anonymous function: (fn [params] body...)
  if (isList(first)) {
    const { params, restParam } = parseParams(first);
    const body = args.slice(1);

    const fn: HQLFunction = {
      type: "hql-function",
      name: null,
      params,
      restParam,
      body,
      closure: env,
    };

    return fn;
  }

  throw new SyntaxError("fn", "expected name (symbol) or parameters (list)");
}

/**
 * Special form: do
 * (do expr1 expr2 ... exprN)
 * Evaluates all expressions, returns last result
 */
function handleDo(
  args: SExp[],
  env: InterpreterEnv,
  interpreter: IInterpreter,
): HQLValue {
  let result: HQLValue = null;
  for (const expr of args) {
    result = interpreter.eval(expr, env);
  }
  return result;
}

/**
 * Special form: quote
 * (quote expr) or 'expr
 * Returns unevaluated expression
 */
function handleQuote(
  args: SExp[],
  _env: InterpreterEnv,
  _interpreter: IInterpreter,
): HQLValue {
  if (args.length !== 1) {
    throw new ArityError("quote", 1, args.length);
  }
  return args[0];
}

/**
 * Special form: quasiquote
 * Template with unquote/unquote-splicing support
 */
function handleQuasiquote(
  args: SExp[],
  env: InterpreterEnv,
  interpreter: IInterpreter,
): HQLValue {
  if (args.length !== 1) {
    throw new ArityError("quasiquote", 1, args.length);
  }
  return processSharedTemplateQuote(
    args[0],
    "quasiquote",
    createInterpreterTemplateQuoteContext(env, interpreter),
  );
}

/**
 * Special form: syntax-quote
 * (syntax-quote expr) or `expr
 */
function handleSyntaxQuote(
  args: SExp[],
  env: InterpreterEnv,
  interpreter: IInterpreter,
): HQLValue {
  if (args.length !== 1) {
    throw new ArityError("syntax-quote", 1, args.length);
  }
  return processSharedTemplateQuote(
    args[0],
    "syntax-quote",
    createInterpreterTemplateQuoteContext(env, interpreter),
  );
}

function createInterpreterTemplateQuoteContext(
  env: InterpreterEnv,
  interpreter: IInterpreter,
): TemplateQuoteContext {
  const interpreterEnv = env as InterpreterEnv & {
    getCurrentFile?(): string;
    lookupImportedBinding?(name: string): ResolvedBindingMeta | undefined;
  };

  return {
    mode: "evaluate",
    currentFile: interpreterEnv.getCurrentFile?.() || undefined,
    fail(formName, message) {
      throw new SyntaxError(formName, message);
    },
    resolveNonLocalBinding(symbol) {
      const importedBinding = interpreterEnv.lookupImportedBinding?.(symbol.name);
      if (importedBinding) {
        return importedBinding;
      }
      if (getSpecialForms().has(symbol.name)) {
        return {
          kind: "module",
          exportName: symbol.name,
          modulePath: "<special-form>",
        };
      }
      if (env.isDefined(symbol.name)) {
        return {
          kind: "module",
          exportName: symbol.name,
          modulePath: "<builtin>",
        };
      }
      return undefined;
    },
    createLocalBinding(name) {
      return {
        kind: "local",
        exportName: name,
        lexicalId: `interp-template-local-${crypto.randomUUID()}`,
      };
    },
    createAutoGensym(baseName) {
      return createSymbol(`${baseName}_${crypto.randomUUID().slice(0, 8)}`);
    },
    evaluateUnquote(expr) {
      return hqlValueToSExp(interpreter.eval(expr, env));
    },
    spliceValueToElements(value) {
      return __hql_splice_to_sexp_items(value) as SExp[];
    },
  };
}

/**
 * Special form: cond
 * (cond (test1 result1) (test2 result2) ... (else resultN))
 */
function handleCond(
  args: SExp[],
  env: InterpreterEnv,
  interpreter: IInterpreter,
): HQLValue {
  for (const clause of args) {
    if (!isList(clause)) {
      throw new SyntaxError("cond", "clauses must be lists");
    }

    const clauseList = clause as SList;
    if (clauseList.elements.length < 2) {
      throw new SyntaxError("cond", "each clause needs test and result");
    }

    const test = clauseList.elements[0];
    const result = clauseList.elements[1];

    // Check for else clause
    if (isSymbol(test) && (test as SSymbol).name === "else") {
      return interpreter.eval(result, env);
    }

    // Evaluate test
    const testResult = interpreter.eval(test, env);

    if (isTruthy(testResult)) {
      return interpreter.eval(result, env);
    }
  }

  return null;
}

// SEQ_SYMBOL imported from common/protocol-symbols.ts (Single Source of Truth)

/**
 * Convert HQL value to S-expression
 * Used for quasiquote results
 */
export function hqlValueToSExp(value: HQLValue): SExp {
  return __hql_value_to_sexp(value) as SExp;
}

/**
 * Special form: ! (logical not)
 * (! value)
 */
function handleNot(
  args: SExp[],
  env: InterpreterEnv,
  interpreter: IInterpreter,
): HQLValue {
  if (args.length !== 1) {
    throw new ArityError("!", "1", args.length);
  }
  const value = interpreter.eval(args[0], env);
  return !isTruthy(value);
}

// Cached special forms map - created once at module load (O(1) lookup vs O(n) creation)
let _specialFormsCache: Map<string, SpecialFormHandler> | null = null;

/**
 * Get all special form handlers (cached for O(1) access)
 */
export function getSpecialForms(): Map<string, SpecialFormHandler> {
  if (_specialFormsCache) return _specialFormsCache;

  const forms = new Map<string, SpecialFormHandler>();

  forms.set("if", handleIf);
  forms.set("let", handleLet);
  forms.set("var", handleVar);
  forms.set("fn", handleFn);
  forms.set("do", handleDo);
  forms.set("quote", handleQuote);
  forms.set("syntax-quote", handleSyntaxQuote);
  forms.set("quasiquote", handleQuasiquote);
  forms.set("cond", handleCond);
  forms.set("!", handleNot);

  _specialFormsCache = forms;
  return forms;
}
