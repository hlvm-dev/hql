// src/interpreter/stdlib-bridge.ts - Bridge stdlib to interpreter
// Wraps JavaScript stdlib functions for use at macro-time

import { STDLIB_PUBLIC_API } from "../lib/stdlib/js/index.js";
import { LazySeq } from "../lib/stdlib/js/internal/lazy-seq.js";
import type { HQLValue, BuiltinFn, Interpreter as IInterpreter, InterpreterEnv } from "./types.ts";
import { isHQLFunction, isSExp } from "./types.ts";
import { Interpreter } from "./interpreter.ts";
import {
  type SList,
  type SSymbol,
  type SLiteral,
  isSymbol,
  isList,
  isLiteral,
} from "../s-exp/types.ts";

// Maximum length when realizing lazy sequences
const MAX_SEQ_LENGTH = 10000;

/**
 * Load all stdlib functions into an interpreter environment
 */
export function loadStdlib(env: InterpreterEnv): void {
  for (const [name, fn] of Object.entries(STDLIB_PUBLIC_API)) {
    if (typeof fn === "function") {
      env.define(name, wrapStdlibFn(fn as (...args: unknown[]) => unknown));
    }
  }
}

/**
 * Wrap a stdlib function for use in the interpreter
 * Handles conversion between HQL values and JavaScript values
 */
function wrapStdlibFn(fn: (...args: unknown[]) => unknown): BuiltinFn {
  return (args: HQLValue[], env: InterpreterEnv, interp: IInterpreter): HQLValue => {
    // Convert HQL values to JS values for the stdlib function
    // Pass interpreter context so HQL functions can be wrapped as callable
    const jsArgs = args.map((a) => hqlToJs(a, interp as Interpreter, env));

    // Call the stdlib function
    const result = fn(...jsArgs);

    // Convert result back to HQL value, realizing any lazy sequences
    return jsToHql(result, MAX_SEQ_LENGTH);
  };
}

/**
 * Convert an HQL value to a JavaScript value
 * Used when calling stdlib functions
 *
 * @param value - The HQL value to convert
 * @param interp - Optional interpreter instance for calling HQL functions
 * @param env - Optional environment for context
 */
export function hqlToJs(
  value: HQLValue,
  interp?: Interpreter,
  env?: InterpreterEnv
): unknown {
  // Null/nil
  if (value === null) {
    return null;
  }

  // Primitives
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }

  // HQL functions -> wrap as JS callable
  if (isHQLFunction(value)) {
    if (interp) {
      // Return callable wrapper that uses interpreter to call the HQL function
      return (...jsArgs: unknown[]) => {
        // Convert JS args to HQL values
        const hqlArgs = jsArgs.map((a) => jsToHql(a)) as HQLValue[];
        // Call the HQL function using the interpreter
        const result = interp.applyHQLFunction(value, hqlArgs);
        // Convert result back to JS for the stdlib function
        return hqlToJs(result, interp, env);
      };
    }
    // No interpreter context - throw error
    return (..._args: unknown[]) => {
      throw new Error(
        `Cannot call HQL function "${value.name || "anonymous"}" directly from stdlib. ` +
        `Use interpreter.eval() instead.`
      );
    };
  }

  // S-expression list -> convert to JS array
  if (isSExp(value) && isList(value)) {
    const list = value as SList;
    // Check for vector form: (vector a b c) -> [a, b, c]
    if (
      list.elements.length > 0 &&
      isSymbol(list.elements[0]) &&
      (list.elements[0] as SSymbol).name === "vector"
    ) {
      return list.elements.slice(1).map((el) => hqlToJs(el as HQLValue, interp, env));
    }
    // Regular list
    return list.elements.map((el) => hqlToJs(el as HQLValue, interp, env));
  }

  // S-expression symbol -> return the name string
  if (isSExp(value) && isSymbol(value)) {
    return (value as SSymbol).name;
  }

  // S-expression literal -> extract value
  if (isSExp(value) && isLiteral(value)) {
    return (value as SLiteral).value;
  }

  // JS array (already converted)
  if (Array.isArray(value)) {
    return value.map((el) => hqlToJs(el, interp, env));
  }

  // Map
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value) {
      obj[String(k)] = hqlToJs(v as HQLValue, interp, env);
    }
    return obj;
  }

  // Set
  if (value instanceof Set) {
    return new Set([...value].map((el) => hqlToJs(el as HQLValue, interp, env)));
  }

  // Built-in function -> pass through
  if (typeof value === "function") {
    return value;
  }

  // Unknown -> return as-is
  return value;
}

/**
 * Convert a JavaScript value to an HQL value
 * Used when returning from stdlib functions
 */
export function jsToHql(value: unknown, maxLength: number = MAX_SEQ_LENGTH): HQLValue {
  // Null/undefined -> nil
  if (value === null || value === undefined) {
    return null;
  }

  // Primitives
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }

  // LazySeq -> realize to array (with limit)
  if (value instanceof LazySeq) {
    const arr = value.toArray(maxLength);
    return arr.map((item) => jsToHql(item, maxLength)) as HQLValue[];
  }

  // Array -> convert elements
  if (Array.isArray(value)) {
    return value.map((item) => jsToHql(item, maxLength)) as HQLValue[];
  }

  // Map
  if (value instanceof Map) {
    const result = new Map<string, HQLValue>();
    for (const [k, v] of value) {
      result.set(String(k), jsToHql(v, maxLength));
    }
    return result;
  }

  // Set
  if (value instanceof Set) {
    return new Set([...value].map((item) => jsToHql(item, maxLength))) as Set<HQLValue>;
  }

  // Plain object -> convert to Map
  if (typeof value === "object" && value !== null && value.constructor === Object) {
    const result = new Map<string, HQLValue>();
    for (const [k, v] of Object.entries(value)) {
      result.set(k, jsToHql(v, maxLength));
    }
    return result;
  }

  // Function -> pass through as builtin
  if (typeof value === "function") {
    // Wrap as builtin function
    // Note: These wrapped functions don't get interpreter context,
    // so they can't call HQL functions. This is acceptable for
    // JS functions returned by stdlib.
    return ((args: HQLValue[]) => {
      const jsArgs = args.map((a) => hqlToJs(a));
      const result = (value as (...a: unknown[]) => unknown)(...jsArgs);
      return jsToHql(result, maxLength);
    }) as BuiltinFn;
  }

  // Unknown -> return as-is (may cause issues, but better than crashing)
  return value as HQLValue;
}