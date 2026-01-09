// src/interpreter/types.ts - Type definitions for the HQL interpreter

import type { SExp } from "../s-exp/types.ts";
import { MAX_SEQ_LENGTH } from "../common/limits.ts";

/**
 * Forward declaration for InterpreterEnv (to break circular dependency)
 * Must match the public API of environment.ts InterpreterEnv class
 */
export interface InterpreterEnv {
  lookup(name: string): HQLValue;
  tryLookup(name: string): HQLValue | undefined;
  define(name: string, value: HQLValue): void;
  extend(): InterpreterEnv;
  isDefined(name: string): boolean;
  getBindings(): Map<string, HQLValue>;
  getParent(): InterpreterEnv | null;
  getDepth(): number;
}

/**
 * HQL Function definition for interpretation
 * Created when (fn [params] body) is evaluated
 */
export interface HQLFunction {
  type: "hql-function";
  name: string | null; // null for anonymous functions
  params: string[]; // Regular parameters: ["x", "y"]
  restParam: string | null; // Rest parameter: "args" in [x & args]
  body: SExp[]; // Function body expressions (unevaluated)
  closure: InterpreterEnv; // Captured environment for lexical scoping
}

/**
 * Built-in function signature
 * Receives evaluated arguments and returns HQL value
 */
export type BuiltinFn = (
  args: HQLValue[],
  env: InterpreterEnv,
  interpreter: Interpreter
) => HQLValue;

/**
 * Forward declaration for Interpreter
 */
export interface Interpreter {
  eval(expr: SExp, env: InterpreterEnv): HQLValue;
  applyHQLFunction(fn: HQLFunction, args: HQLValue[]): HQLValue;
}

/**
 * HQL Value - any value that can exist at macro-time
 */
export type HQLValue =
  | null // nil
  | boolean // true/false
  | number // 42, 3.14
  | string // "hello"
  | HQLFunction // (fn [x] ...)
  | HQLValue[] // vectors/lists as arrays
  | Map<string, HQLValue> // hash-maps
  | Set<HQLValue> // hash-sets
  | BuiltinFn // built-in functions
  | SExp; // Unevaluated S-expression (for quote)

/**
 * Interpreter configuration options
 */
export interface InterpreterConfig {
  /** Maximum call stack depth (default: 1000) */
  maxCallDepth?: number;
  /** Maximum sequence length when realizing lazy seqs (default: 10000) */
  maxSeqLength?: number;
  /** Enable debug tracing */
  enableTracing?: boolean;
}

/**
 * Type guard: Check if value is an HQL function
 */
export function isHQLFunction(value: unknown): value is HQLFunction {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as HQLFunction).type === "hql-function"
  );
}

/**
 * Type guard: Check if value is a built-in function
 */
export function isBuiltinFn(value: unknown): value is BuiltinFn {
  return (
    typeof value === "function" &&
    !isHQLFunction(value)
  );
}

/**
 * Type guard: Check if value is truthy in HQL semantics
 * Only false and nil are falsy
 */
export function isTruthy(value: HQLValue): boolean {
  return value !== false && value !== null;
}

/**
 * Type guard: Check if value is an S-expression
 */
export function isSExp(value: unknown): value is SExp {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { type?: string };
  return v.type === "symbol" || v.type === "list" || v.type === "literal";
}

/**
 * Default interpreter configuration
 */
export const DEFAULT_CONFIG: Required<InterpreterConfig> = {
  maxCallDepth: 1000,
  maxSeqLength: MAX_SEQ_LENGTH,
  enableTracing: false,
};
