// src/hql/interpreter/index.ts - Public API exports for HQL interpreter
// Used by macro system and potentially REPL/eval

import { InterpreterEnv } from "./environment.ts";
import { loadBuiltins } from "./builtins.ts";
import { loadStdlib } from "./stdlib-bridge.ts";

// Core exports
export { Interpreter } from "./interpreter.ts";
export { InterpreterEnv } from "./environment.ts";
export { loadStdlib, hqlToJs, jsToHql } from "./stdlib-bridge.ts";
export { loadBuiltins } from "./builtins.ts";
export { hqlValueToSExp, getSpecialForms } from "./special-forms.ts";

// Re-export types
export type {
  HQLValue,
  HQLFunction,
  InterpreterConfig,
  BuiltinFn,
  Interpreter as IInterpreter,
} from "./types.ts";
export { isHQLFunction, isBuiltinFn, isTruthy, isSExp, DEFAULT_CONFIG } from "./types.ts";

// Re-export errors
export {
  InterpreterError,
  UndefinedSymbolError,
  ArityError,
  TypeError,
  SyntaxError,
  MaxCallDepthError,
} from "./errors.ts";

/**
 * Create a standard interpreter environment with all builtins and stdlib
 */
export function createStandardEnv(): InterpreterEnv {
  const env = new InterpreterEnv();
  loadBuiltins(env);
  loadStdlib(env);
  return env;
}
