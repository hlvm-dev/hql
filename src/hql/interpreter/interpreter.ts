// src/hql/interpreter/interpreter.ts - Core tree-walk interpreter for HQL
// Evaluates S-expressions at macro-time

import {
  type SExp,
  type SList,
  type SSymbol,
  type SLiteral,
  isSymbol,
  isList,
  isLiteral,
} from "../s-exp/types.ts";
import type {
  HQLValue,
  HQLFunction,
  InterpreterConfig,
  Interpreter as IInterpreter,
  BuiltinFn,
  InterpreterEnv as IInterpreterEnv,
} from "./types.ts";
import { isHQLFunction, DEFAULT_CONFIG } from "./types.ts";
import { isTaggedBuiltinFn } from "./stdlib-bridge.ts";
import { getSpecialForms, type SpecialFormHandler } from "./special-forms.ts";
import { InterpreterError, MaxCallDepthError, UndefinedSymbolError } from "./errors.ts";
import { getErrorMessage, mapTail } from "../../common/utils.ts";

/**
 * Tree-walk interpreter for HQL
 *
 * Evaluates S-expressions directly without compilation.
 * Used for:
 * - Macro expansion (evaluating macro bodies)
 * - REPL (immediate feedback)
 * - eval function at runtime
 */
export class Interpreter implements IInterpreter {
  private config: Required<InterpreterConfig>;
  private callDepth = 0;
  private specialForms: Map<string, SpecialFormHandler>;

  constructor(config?: InterpreterConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.specialForms = getSpecialForms();
  }

  /**
   * Evaluate an S-expression in an environment
   */
  eval(expr: SExp, env: IInterpreterEnv): HQLValue {
    // 1. Literals -> return value directly
    if (isLiteral(expr)) {
      const lit = expr as SLiteral;
      return lit.value as HQLValue;
    }

    // 2. Symbols -> lookup in environment
    if (isSymbol(expr)) {
      const sym = expr as SSymbol;
      try {
        return env.lookup(sym.name);
      } catch (e) {
        if (e instanceof UndefinedSymbolError) {
          throw e;
        }
        throw new InterpreterError(`Error looking up symbol "${sym.name}": ${getErrorMessage(e)}`);
      }
    }

    // 3. Lists -> dispatch to special form or function call
    if (isList(expr)) {
      return this.evalList(expr as SList, env);
    }

    // Unknown expression type
    throw new InterpreterError(`Unknown expression type: ${JSON.stringify(expr)}`);
  }

  /**
   * Evaluate a list expression
   * Either a special form or a function call
   */
  private evalList(list: SList, env: IInterpreterEnv): HQLValue {
    // Empty list -> null
    if (list.elements.length === 0) {
      return null;
    }

    const first = list.elements[0];

    // Check for special forms
    if (isSymbol(first)) {
      const opName = (first as SSymbol).name;
      const handler = this.specialForms.get(opName);
      if (handler) {
        return handler(list.elements.slice(1), env, this);
      }
    }

    // Otherwise, it's a function call
    return this.evalFunctionCall(list, env);
  }

  /**
   * Evaluate a function call
   * 1. Evaluate the operator to get the callee
   * 2. Evaluate all arguments
   * 3. Apply the function
   */
  private evalFunctionCall(list: SList, env: IInterpreterEnv): HQLValue {
    const callee = this.eval(list.elements[0], env);
    const args = mapTail(list.elements, (arg) => this.eval(arg, env));
    return this.applyFunction(callee, args, env);
  }

  /**
   * Apply a function to arguments
   */
  private applyFunction(
    callee: HQLValue,
    evaluatedArgs: HQLValue[],
    env: IInterpreterEnv
  ): HQLValue {
    // HQL function (defined with fn)
    if (isHQLFunction(callee)) {
      return this.applyHQLFunction(callee, evaluatedArgs);
    }

    // Tagged built-in function (from builtins or stdlib) - expects (args, env, interp) signature
    if (isTaggedBuiltinFn(callee)) {
      return (callee as BuiltinFn)(evaluatedArgs, env, this);
    }

    // Raw JS function (user imports) - expects spread arguments (...args)
    if (typeof callee === "function") {
      // Call with spread arguments, not the BuiltinFn signature
      return (callee as (...args: unknown[]) => unknown)(...evaluatedArgs) as HQLValue;
    }

    throw new InterpreterError(
      `Cannot call ${typeof callee}: ${JSON.stringify(callee).slice(0, 100)}`
    );
  }

  /**
   * Apply an HQL function (defined with fn)
   *
   * Key insight: We extend the CLOSURE environment, not the call environment.
   * This implements lexical scoping.
   */
  public applyHQLFunction(fn: HQLFunction, args: HQLValue[]): HQLValue {
    // Check call depth
    this.callDepth++;
    if (this.callDepth > this.config.maxCallDepth) {
      this.callDepth--;
      throw new MaxCallDepthError(this.callDepth, this.config.maxCallDepth);
    }

    try {
      // Create new scope extending the closure (lexical scoping)
      const fnEnv = fn.closure.extend();

      // Bind regular parameters
      for (let i = 0; i < fn.params.length; i++) {
        const param = fn.params[i];
        const arg = args[i] ?? null;
        fnEnv.define(param, arg);
      }

      // Bind rest parameter if present
      if (fn.restParam) {
        const restArgs = args.slice(fn.params.length);
        fnEnv.define(fn.restParam, restArgs);
      }

      // Evaluate body expressions, return last result
      let result: HQLValue = null;
      for (const bodyExpr of fn.body) {
        result = this.eval(bodyExpr, fnEnv);
      }

      return result;
    } finally {
      this.callDepth--;
    }
  }

  /**
   * Get the current call depth (for debugging)
   */
  getCallDepth(): number {
    return this.callDepth;
  }

  /**
   * Reset the interpreter state
   */
  reset(): void {
    this.callDepth = 0;
  }
}
