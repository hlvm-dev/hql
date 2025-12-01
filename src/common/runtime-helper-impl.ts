// Shared runtime helper implementations used by both the runtime and transpiled output.
// Keeping these definitions here ensures we have a single source of truth.

import { lazySeq } from "../lib/stdlib/js/stdlib.js";
import { rangeCore } from "./shared-core.ts";
import { isNullish } from "./utils.ts";

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
  if (isNullish(value)) return [];
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

export function __hql_deepFreeze<T>(obj: T): T {
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

  // Already frozen objects can be returned as-is
  if (Object.isFrozen(obj)) {
    return obj;
  }

  // Freeze the object itself
  Object.freeze(obj);

  // Recursively freeze all property values
  Object.getOwnPropertyNames(obj).forEach((prop) => {
    const value = (obj as Record<string, unknown>)[prop];
    if (
      value !== null &&
      (typeof value === "object" || typeof value === "function")
    ) {
      __hql_deepFreeze(value);
    }
  });

  // Also freeze symbol properties
  Object.getOwnPropertySymbols(obj).forEach((sym) => {
    const value = (obj as Record<symbol, unknown>)[sym];
    if (
      value !== null &&
      (typeof value === "object" || typeof value === "function")
    ) {
      __hql_deepFreeze(value);
    }
  });

  return obj;
}

export const runtimeHelperImplementations = {
  __hql_get,
  __hql_getNumeric,
  __hql_range,
  __hql_toSequence,
  __hql_for_each,
  __hql_hash_map,
  __hql_throw,
  __hql_deepFreeze,
};

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
