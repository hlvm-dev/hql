// Shared runtime helper implementations used by both the runtime and transpiled output.
// Keeping these definitions here ensures we have a single source of truth.
//
// NOTE: Do NOT use external imports in helper implementations!
// These functions are stringified for embedding in transpiled code.
// Any external references will cause "X is not defined" errors at runtime.

import { lazySeq } from "../hql/lib/stdlib/js/stdlib.js";
import { rangeCore } from "./shared-core.ts";

// ============================================================================
// INTERNAL IDENTIFIER CONSTANTS - SINGLE SOURCE OF TRUTH
// ============================================================================
// Use these constants instead of hardcoded strings throughout the codebase.

// --- Data Structure Symbols ---
/** Symbol for vector/array literals: [1 2 3] parses as (vector 1 2 3) */
export const VECTOR_SYMBOL = "vector";

/** Symbol for empty array literals: [] parses as (empty-array) */
export const EMPTY_ARRAY_SYMBOL = "empty-array";

/** The user-facing name for hash-map in HQL source */
export const HASH_MAP_USER = "hash-map";

// --- Runtime Helper Names ---
/** The internal name for hash-map helper function (after macro expansion) */
export const HASH_MAP_INTERNAL = "__hql_hash_map";

/** Internal return value variable for early returns */
export const RETURN_VALUE_VAR = "__hql_ret__";

/** Internal early return flag variable */
export const EARLY_RETURN_FLAG = "__hql_early_return__";

/** Runtime helper for property access */
export const GET_HELPER = "__hql_get";

/** Runtime helper for numeric property access */
export const GET_NUMERIC_HELPER = "__hql_getNumeric";

/** Runtime helper for lazy sequences */
export const LAZY_SEQ_HELPER = "__hql_lazy_seq";

/** Runtime helper for delay (explicit laziness) */
export const DELAY_HELPER = "__hql_delay";

/** Runtime helper for deep freezing */
export const DEEP_FREEZE_HELPER = "__hql_deepFreeze";

/** Runtime helper for get operations (first-class) */
export const GET_OP_HELPER = "__hql_get_op";

/** Symbol for tagged generator thunks */
export const GEN_THUNK_SYMBOL = Symbol.for("__hql_gen_thunk");

export function __hql_get(
  obj: unknown,
  key: unknown,
  defaultValue?: unknown,
): unknown {
  if (
    obj &&
    typeof (obj as Record<PropertyKey, unknown>)[key as PropertyKey] !==
      "undefined"
  ) {
    return (obj as Record<PropertyKey, unknown>)[key as PropertyKey];
  }

  if (typeof obj === "function") {
    const fnResult = (obj as (arg: unknown) => unknown)(key);
    if (typeof fnResult !== "undefined") {
      return fnResult;
    }
  }

  return defaultValue;
}

export const __hql_getNumeric = __hql_get;

export function __hql_range(...args: number[]) {
  let start: number;
  let end: number | undefined;
  let step: number = 1;

  // Parse arguments
  if (args.length === 0) {
    // No arguments → infinite sequence from 0
    start = 0;
    end = undefined;
  } else if (args.length === 1) {
    // One argument → range from 0 to start
    start = 0;
    end = args[0];
  } else if (args.length === 2) {
    // Two arguments → range from start to end
    [start, end] = args;
  } else {
    // Three or more arguments → range from start to end with step
    [start, end, step] = args;
  }

  // Validate step
  if (typeof step !== "number" || step === 0) {
    step = 1;
  }

  // Validate start and end
  if (typeof start !== "number" || (end !== undefined && typeof end !== "number")) {
    return lazySeq(function* () {
      // Empty sequence
    });
  }

  // Use shared core implementation (no duplication!)
  return rangeCore(start, end, step);
}

export function __hql_toSequence(value: unknown): unknown[] {
  if (value == null) return [];  // Inline check - don't use external imports!
  if (Array.isArray(value)) return value;
  if (typeof value === "number") {
    const result: number[] = [];
    const step = value >= 0 ? 1 : -1;
    for (let i = 0; step > 0 ? i < value : i > value; i += step) {
      result.push(i);
    }
    return result;
  }
  if (typeof value === "string") {
    return value.split("");
  }
  if (
    value &&
    typeof (value as Iterable<unknown>)[Symbol.iterator] === "function"
  ) {
    return Array.from(value as Iterable<unknown>);
  }
  return [];
}

/**
 * Convert a value to an iterable for use with for-of loops.
 * - Numbers are converted to range(0, n)
 * - Iterables are returned as-is
 * - null/undefined returns empty array
 */
export function __hql_toIterable(value: unknown): Iterable<unknown> {
  if (value == null) return [];
  // If already iterable, return as-is
  if (
    typeof (value as Iterable<unknown>)[Symbol.iterator] === "function"
  ) {
    return value as Iterable<unknown>;
  }
  // Numbers become range(0, n)
  if (typeof value === "number") {
    return __hql_range(0, value);
  }
  // Fallback to empty
  return [];
}

export function __hql_for_each(
  sequence: unknown,
  iteratee: (item: unknown, index: number) => unknown,
): null {
  // Fast path for arrays
  if (Array.isArray(sequence)) {
    for (let index = 0; index < sequence.length; index++) {
      iteratee(sequence[index], index);
    }
    return null;
  }

  // Handle LazySeq and other iterables directly without allocation
  if (
    sequence &&
    typeof (sequence as Iterable<unknown>)[Symbol.iterator] === "function"
  ) {
    let index = 0;
    for (const item of sequence as Iterable<unknown>) {
      iteratee(item, index++);
    }
    return null;
  }

  // Fallback for numbers, strings, etc. via standard conversion
  const list = __hql_toSequence(sequence);
  for (let index = 0; index < list.length; index++) {
    iteratee(list[index], index);
  }
  return null;
}

export function __hql_hash_map(...entries: unknown[]): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);
  const limit = entries.length - (entries.length % 2);

  if (entries.length !== limit) {
    console.warn(
      `Incomplete key-value pair in hash-map at index ${
        entries.length - 1
      }, skipping`,
    );
  }

  for (let i = 0; i < limit; i += 2) {
    const rawKey = entries[i];
    const value = entries[i + 1];
    const normalizedKey = typeof rawKey === "symbol"
      ? rawKey.description ?? rawKey.toString()
      : String(rawKey);
    result[normalizedKey] = value;
  }

  return result;
}

export function __hql_throw(value: unknown): never {
  throw value;
}

/**
 * Check if value matches an object pattern with required keys.
 * Used by pattern matching to properly check object destructuring patterns.
 *
 * This function takes the raw pattern array from the macro and extracts keys dynamically.
 * Pattern structure: ["__hql_hash_map", key1, var1, key2, var2, ...]
 * Keys are at odd indices (1, 3, 5, ...) and are strings.
 *
 * @param val - The value to check
 * @param pattern - The pattern array from macro expansion (e.g., ["__hql_hash_map", "op", "o", "left", "l"])
 * @returns true if val is a non-null object (not array) with all required keys
 */
export function __hql_match_obj(val: unknown, pattern: unknown[]): boolean {
  if (typeof val !== "object" || val === null || Array.isArray(val)) {
    return false;
  }
  // Extract keys from odd indices (1, 3, 5, ...) and check existence
  // Pattern: [header, key1, var1, key2, var2, ...]
  for (let i = 1; i < pattern.length; i += 2) {
    const key = pattern[i];
    if (typeof key === "string" && !(key in val)) {
      return false;
    }
  }
  return true;
}

export function __hql_deepFreeze<T>(obj: T, visited?: WeakSet<object>): T {
  // Primitives and null don't need freezing
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  // Skip freezing for LazySeq objects (they need to mutate _realized, _iterating)
  if (
    (obj as { constructor?: { name?: string } }).constructor?.name ===
      "LazySeq"
  ) {
    return obj;
  }

  // Skip freezing for Generator objects (they need mutable internal state for .next())
  // deno-lint-ignore no-explicit-any
  const anyObj = obj as any;
  if (
    typeof anyObj.next === "function" &&
    typeof anyObj[Symbol.iterator] === "function" &&
    anyObj[Symbol.iterator]() === anyObj
  ) {
    return obj;
  }

  // Already frozen objects can be returned as-is
  if (Object.isFrozen(obj)) {
    return obj;
  }

  // Initialize visited set on first call, track to prevent infinite recursion on cycles
  const seen = visited ?? new WeakSet<object>();
  if (seen.has(obj as object)) {
    return obj; // Already visited - break the cycle
  }
  seen.add(obj as object);

  // Freeze the object itself
  Object.freeze(obj);

  // Recursively freeze all property values
  Object.getOwnPropertyNames(obj).forEach((prop) => {
    const value = (obj as Record<string, unknown>)[prop];
    if (
      value !== null &&
      (typeof value === "object" || typeof value === "function")
    ) {
      __hql_deepFreeze(value, seen);
    }
  });

  // Also freeze symbol properties
  Object.getOwnPropertySymbols(obj).forEach((sym) => {
    const value = (obj as Record<symbol, unknown>)[sym];
    if (
      value !== null &&
      (typeof value === "object" || typeof value === "function")
    ) {
      __hql_deepFreeze(value, seen);
    }
  });

  return obj;
}

/**
 * Trampoline for mutual recursion TCO.
 * Executes thunks until a non-function value is returned.
 *
 * Usage: Mutual recursive functions return thunks instead of making direct calls.
 * The trampoline wraps the initial call and bounces until done.
 *
 * @example
 * const is_even = (n) => n === 0 ? true : () => is_odd(n - 1);
 * const is_odd = (n) => n === 0 ? false : () => is_even(n - 1);
 * __hql_trampoline(() => is_even(10000)) // → true (no stack overflow)
 */
export function __hql_trampoline<T>(thunk: () => T | (() => T)): T {
  let result = thunk();
  while (typeof result === "function") {
    result = (result as () => T | (() => T))();
  }
  return result;
}

/**
 * Generator trampoline for mutual recursion TCO.
 * Handles generators that return tagged thunks instead of using yield*.
 *
 * Usage: Mutual recursive generators return { [Symbol.for("__hql_gen_thunk")]: true, next: () => gen() }
 * instead of using yield* (which would grow the stack).
 *
 * @example
 * const gen_a = function*(n) {
 *   if (n === 0) return "done";
 *   return { [Symbol.for("__hql_gen_thunk")]: true, next: () => gen_b(n - 1) };
 * };
 * for (const v of __hql_trampoline_gen(() => gen_a(10000))) { ... }
 */
export function* __hql_trampoline_gen<T>(
  createInitial: () => Generator<T, T, unknown>
): Generator<T, T, unknown> {
  // Use GEN_THUNK_SYMBOL exported at top of file (Single Source of Truth)
  let current = createInitial();
  while (true) {
    const result = current.next();
    if (result.done) {
      // Check if return value is a generator thunk
      const val = result.value as unknown;
      if (
        val !== null &&
        typeof val === "object" &&
        (val as Record<symbol, unknown>)[GEN_THUNK_SYMBOL]
      ) {
        current = ((val as { next: () => Generator<T, T, unknown> }).next)();
        continue;
      }
      return result.value;
    }
    // Check if yielded value is a generator thunk
    const yieldVal = result.value as unknown;
    if (
      yieldVal !== null &&
      typeof yieldVal === "object" &&
      (yieldVal as Record<symbol, unknown>)[GEN_THUNK_SYMBOL]
    ) {
      current = ((yieldVal as { next: () => Generator<T, T, unknown> }).next)();
      continue;
    }
    yield result.value;
  }
}

/**
 * Consume async iterator and return concatenated result.
 *
 * This is the core of HQL's enhanced await semantics:
 * - (await async-gen) → consumes all yields, returns concatenated string
 * - (async-gen) → returns the iterator for streaming
 *
 * This enables ONE function to support both completion and streaming modes,
 * determined by how the caller uses it.
 *
 * @example
 * // In HQL:
 * (ask "hello")         ; → Returns async iterator, REPL streams live
 * (await (ask "hello")) ; → Consumes iterator, returns full string "Hello..."
 */
export async function __hql_consume_async_iter(value: unknown): Promise<unknown> {
  // First await the value (handles Promises that resolve to async iterators)
  const awaited = await value;

  // Check if it's an async iterator
  if (
    awaited !== null &&
    typeof awaited === "object" &&
    Symbol.asyncIterator in awaited
  ) {
    // Consume the async iterator and concatenate results
    let result = "";
    const iter = awaited as AsyncIterable<unknown>;
    for await (const chunk of iter) {
      // Convert each chunk to string and concatenate
      result += String(chunk);
    }
    return result;
  }

  // Not an async iterator - return as-is
  return awaited;
}

export const runtimeHelperImplementations = {
  __hql_get,
  __hql_getNumeric,
  __hql_range,
  __hql_toSequence,
  __hql_toIterable,
  __hql_for_each,
  __hql_hash_map,
  __hql_throw,
  __hql_deepFreeze,
  __hql_match_obj,
  __hql_trampoline,
  __hql_trampoline_gen,
  __hql_consume_async_iter,
};

/**
 * All runtime helper names - SINGLE SOURCE OF TRUTH.
 * Used by ir-to-typescript.ts to detect which helpers are used.
 */
export const RUNTIME_HELPER_NAMES = Object.keys(runtimeHelperImplementations) as RuntimeHelperName[];

/**
 * Set version for O(1) lookup - use this for .has() checks instead of Array.includes()
 */
export const RUNTIME_HELPER_NAMES_SET: ReadonlySet<string> = new Set(RUNTIME_HELPER_NAMES);

export type RuntimeHelperName = keyof typeof runtimeHelperImplementations;

export function getRuntimeHelperSource(name: RuntimeHelperName): string {
  const implementation = runtimeHelperImplementations[name];
  if (typeof implementation !== "function") {
    return JSON.stringify(implementation);
  }

  // Note: mod.ts wraps the result in `const ${name} = ${result};`
  // So we just return the function expression (not declaration)
  return implementation.toString();
}

// Special function to get __hql_range with its dependency
export function getRangeHelperWithDependency(): string {
  // Return both rangeCore and __hql_range as function declarations
  // This won't be wrapped by mod.ts's `const` pattern
  const rangeCoreStr = rangeCore.toString();
  const rangeImplStr = runtimeHelperImplementations.__hql_range.toString();

  return `const rangeCore = ${rangeCoreStr};\nconst __hql_range = ${rangeImplStr};`;
}
