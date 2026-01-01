// src/interpreter/stdlib-bridge.ts - Bridge stdlib to interpreter
// Wraps JavaScript stdlib functions for use at macro-time

import { STDLIB_PUBLIC_API } from "../lib/stdlib/js/index.js";
import { LazySeq, SEQ } from "../lib/stdlib/js/internal/seq-protocol.js";
import type { HQLValue, BuiltinFn, Interpreter as IInterpreter, InterpreterEnv } from "./types.ts";
import { isHQLFunction, isSExp } from "./types.ts";
import type { Interpreter } from "./interpreter.ts";
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

/** Marker symbol to identify wrapped BuiltinFn functions */
export const BUILTIN_MARKER = Symbol.for("hql-builtin-fn");

/**
 * Type guard: Check if function is a tagged BuiltinFn
 * BuiltinFn expects (args: HQLValue[], env, interp) => HQLValue
 * Regular JS functions expect (...args) => result
 */
export function isTaggedBuiltinFn(value: unknown): boolean {
  if (typeof value !== "function") return false;
  // Use symbol property access - cast through unknown for type safety
  const fn = value as unknown as Record<symbol, unknown>;
  return fn[BUILTIN_MARKER] === true;
}

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
  const wrapped: BuiltinFn = (args: HQLValue[], env: InterpreterEnv, interp: IInterpreter): HQLValue => {
    // Convert HQL values to JS values for the stdlib function
    // Pass interpreter context so HQL functions can be wrapped as callable
    const jsArgs = args.map((a) => hqlToJs(a, interp as Interpreter, env));

    // Call the stdlib function
    const result = fn(...jsArgs);

    // Convert result back to HQL value, realizing any lazy sequences
    return jsToHql(result, MAX_SEQ_LENGTH);
  };

  // TAG the function so we can identify it later in hqlToJs
  // This enables proper calling convention conversion
  Object.defineProperty(wrapped, BUILTIN_MARKER, {
    value: true,
    enumerable: false,
    configurable: false
  });

  return wrapped;
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

  // Function handling - distinguish between BuiltinFn and regular JS functions
  // BuiltinFn signature: (args: HQLValue[], env, interp) => HQLValue
  // Regular JS signature: (...args) => result
  if (typeof value === "function") {
    // Only wrap if it's a TAGGED BuiltinFn (from stdlib)
    // This is the proper fix - use symbol marker instead of guessing
    if (isTaggedBuiltinFn(value)) {
      return (...jsArgs: unknown[]) => {
        // Convert JS args to HQL values
        const hqlArgs = jsArgs.map((a) => jsToHql(a)) as HQLValue[];

        // Safe check: verify env and interp are available before calling
        if (!env || !interp) {
          throw new Error(
            `Cannot call builtin function without interpreter context. ` +
            `Ensure hqlToJs is called with interpreter and environment parameters.`
          );
        }

        // Call the builtin with proper signature
        const result = (value as BuiltinFn)(hqlArgs, env, interp);
        // Convert result back to JS
        return hqlToJs(result, interp, env);
      };
    }
    // Regular JS function - pass through unchanged
    // This includes user callbacks, lambdas, etc.
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
  // Null/undefined → nil (nil-punning)
  if (value == null) {
    return null;
  }

  // Primitives
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }

  // LazySeq and other SEQ types -> realize to array (with limit)
  // IMPORTANT: Use take() to limit iteration BEFORE collecting, not after!
  // Array.from() on an infinite sequence will never complete.
  if (value instanceof LazySeq || (typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[SEQ])) {
    const arr: unknown[] = [];
    let count = 0;
    for (const item of value as Iterable<unknown>) {
      if (count >= maxLength) break;
      arr.push(item);
      count++;
    }
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