// src/hql/interpreter/index.ts - Public API exports for HQL interpreter
// Used by macro system and potentially REPL/eval

import { InterpreterEnv } from "./environment.ts";
import { loadBuiltins } from "./builtins.ts";
import { loadStdlib } from "./stdlib-bridge.ts";

// Core exports - only what's externally imported
export { Interpreter } from "./interpreter.ts";
export { InterpreterEnv } from "./environment.ts";
export { hqlValueToSExp, getSpecialForms } from "./special-forms.ts";

/**
 * Create a standard interpreter environment with all builtins and stdlib
 */
export function createStandardEnv(): InterpreterEnv {
  const env = new InterpreterEnv();
  loadBuiltins(env);
  loadStdlib(env);
  return env;
}
