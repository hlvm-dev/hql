// core.js - Bootstrap primitives and non-self-hosted functions
// Self-hosted functions are in self-hosted.js (transpiled from stdlib.hql)

import { LazySeq, lazySeq } from "./internal/lazy-seq.js";
import { rangeCore } from "./internal/range-core.js";

// Import Clojure-aligned foundation for lazy-seq support
import {
  lazySeq as seqLazySeq,
  cons as seqCons,
  EMPTY as SEQ_EMPTY,
  SEQ,
  isCons,
  LazySeq as SeqLazySeq,
} from "./internal/seq-protocol.js";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FOUNDATION BRIDGE (for HQL lazy-seq macro)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Creates a lazy sequence from a thunk (for HQL lazy-seq macro).
 * Uses Clojure-aligned seq-protocol.js foundation.
 */
export function __hql_lazy_seq(thunk) {
  return seqLazySeq(thunk);
}

/**
 * Check if a value is a Cons cell
 */
export function isConsCell(value) {
  return isCons(value);
}

import {
  validateFiniteNumber,
  validateFunction,
  validateNonZeroNumber,
} from "./internal/validators.js";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEQUENCE PRIMITIVES (The Lisp Trinity)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Returns the first element of a collection
 *
 * @param {Iterable|null|undefined} coll - Any iterable collection
 * @returns {*} First element, or undefined if empty
 *
 * @example
 * first([1, 2, 3])  // → 1
 * first([])         // → undefined
 * first(null)       // → undefined
 */
export function first(coll) {
  if (coll == null) return undefined;

  // SEQ protocol (foundation Cons/LazySeq): use first() method
  if (coll[SEQ]) {
    return coll.first();
  }

  // Optimize for arrays
  if (Array.isArray(coll)) {
    return coll.length > 0 ? coll[0] : undefined;
  }

  // Optimize for old LazySeq
  if (coll instanceof LazySeq) {
    return coll.get(0);
  }

  // General iterable
  for (const item of coll) {
    return item;
  }
  return undefined;
}

/**
 * Returns a sequence of all but the first element
 *
 * @param {Iterable|null|undefined} coll - Any iterable collection
 * @returns {LazySeq} Lazy sequence of remaining elements
 *
 * @example
 * rest([1, 2, 3])  // → [2, 3]
 * rest([1])        // → []
 * rest([])         // → []
 * rest(null)       // → []
 */
export function rest(coll) {
  if (coll == null) return SEQ_EMPTY;

  // SEQ protocol (foundation Cons/LazySeq): use rest() method
  if (coll[SEQ]) {
    return coll.rest();
  }

  // Array fast path: indexed iteration (2-3x faster + lazy)
  if (Array.isArray(coll)) {
    if (coll.length <= 1) return SEQ_EMPTY;
    return lazySeq(function* () {
      for (let i = 1; i < coll.length; i++) {
        yield coll[i];
      }
    });
  }

  // Generic path for other iterables
  return lazySeq(function* () {
    let isFirst = true;
    for (const item of coll) {
      if (isFirst) {
        isFirst = false;
        continue;
      }
      yield item;
    }
  });
}


/**
 * Returns a new sequence with element prepended
 *
 * DRY: Delegates to concat() for simplicity and consistency.
 * Functionally equivalent to yielding item then iterating coll.
 *
 * @param {*} item - Element to prepend
 * @param {Iterable|null|undefined} coll - Collection to prepend to
 * @returns {LazySeq} New lazy sequence with item first
 *
 * @example
 * cons(0, [1, 2, 3])  // → [0, 1, 2, 3]
 * cons(1, [])         // → [1]
 * cons(1, null)       // → [1]
 */
export function cons(item, coll) {
  // Use foundation's Cons cell for proper trampolining
  // This enables stack-safe deeply nested lazy sequences
  return seqCons(item, coll);
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEQUENCE GENERATORS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Creates a lazy range using JavaScript generators
 * Clojure-compatible semantics:
 *
 * range()          → 0, 1, 2, 3... ∞     (infinite from 0)
 * range(end)       → 0, 1, 2... end-1    (finite to end)
 * range(start,end) → start... end-1      (finite range)
 * range(start,end,step) → start... end-1 by step
 *
 * @param {number} [start] - Starting value
 * @param {number} [end] - Ending value (exclusive)
 * @param {number} [step=1] - Step size
 * @returns {LazySeq} Lazy sequence of numbers
 */
export function range(start, end, step = 1) {
  validateNonZeroNumber(step, "range", "step");

  // No arguments → infinite sequence from 0
  if (start === undefined) {
    return rangeCore(0, undefined, step);
  }

  // Validate start - must be finite number
  validateFiniteNumber(start, "range", "start");

  // One argument → range from 0 to start
  if (end === undefined) {
    end = start;
    start = 0;
  } else {
    // Validate end if provided - allow Infinity for infinite sequences
    if (typeof end !== "number") {
      throw new TypeError(`range: end must be a number, got ${typeof end}`);
    }
  }

  // Use shared core implementation (no duplication!)
  return rangeCore(start, end, step);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Groups collection elements by function result
 *
 * @param {Function} f - Grouping function
 * @param {Iterable|null|undefined} coll - Collection to group
 * @returns {Map} Map with grouped elements (keys preserve their types)
 */
export function groupBy(f, coll) {
  validateFunction(f, "groupBy", "key function");

  if (coll == null) return new Map();

  const result = new Map();
  for (const item of coll) {
    const key = f(item); // ✅ Preserve key type (no String conversion)
    if (!result.has(key)) {
      result.set(key, []);
    }
    result.get(key).push(item);
  }
  return result;
}

/**
 * Checks if a LazySeq has been fully realized
 *
 * @param {*} coll - Collection to check
 * @returns {boolean} True if fully realized
 */
export function realized(coll) {
  if (coll == null) return true;
  // Old generator-based LazySeq
  if (coll instanceof LazySeq) {
    return coll._exhausted;
  }
  // New seq-protocol LazySeq
  if (coll instanceof SeqLazySeq) {
    return coll._isRealized;
  }
  return true; // Non-lazy collections are always realized
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COLLECTION PROTOCOLS (Week 3)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Convert any collection to a lazy sequence, or return null for empty/nil
 *
 * Critical behavior: Empty collections return null (not empty LazySeq).
 * This enables idiomatic nil-punning: `if (seq(coll)) { ... }`
 *
 * @param {*} coll - Collection to convert to sequence
 * @returns {LazySeq|null} Lazy sequence or null if empty/nil
 *
 * @example
 * seq([1, 2, 3])           // => LazySeq([1, 2, 3])
 * seq([])                  // => null (empty!)
 * seq(null)                // => null
 * seq("abc")               // => LazySeq(["a", "b", "c"])
 * seq(new Set([1,2]))      // => LazySeq([1, 2])
 * seq({a: 1, b: 2})        // => LazySeq([["a", 1], ["b", 2]])
 */
export function seq(coll) {
  // Nil input → null
  if (coll == null) return null;

  // SEQ protocol (foundation Cons/LazySeq): use seq() method for nil-punning
  if (coll[SEQ]) {
    return coll.seq();
  }

  // Empty array → null
  if (Array.isArray(coll)) {
    return coll.length === 0 ? null : lazySeq(function* () {
      for (const item of coll) yield item;
    });
  }

  // Empty string → null
  if (typeof coll === "string") {
    return coll.length === 0 ? null : lazySeq(function* () {
      for (const char of coll) yield char;
    });
  }

  // OLD LazySeq: check if empty by realizing first element (nil-punning)
  // This is necessary for proper termination in recursive patterns like self-hosted map
  if (coll instanceof LazySeq) {
    coll._realize(1);
    if (coll._exhausted && coll._realized.length === 0) {
      return null;  // Empty → null for nil-punning
    }
    return coll;
  }

  // Set: check if empty
  if (coll instanceof Set) {
    return coll.size === 0 ? null : lazySeq(function* () {
      for (const item of coll) yield item;
    });
  }

  // Map: check if empty, yield entries
  if (coll instanceof Map) {
    return coll.size === 0 ? null : lazySeq(function* () {
      for (const entry of coll) yield entry;
    });
  }

  // Generic iterable (generators, custom iterables): wrap in lazy seq
  // Must check BEFORE plain object since generators are typeof "object"
  if (typeof coll[Symbol.iterator] === "function") {
    // Create a one-shot wrapper - generators can only be iterated once
    // We eagerly get the iterator and yield from it lazily
    const iter = coll[Symbol.iterator]();
    const first = iter.next();
    if (first.done) return null;  // Empty iterable → null
    return lazySeq(function* () {
      yield first.value;
      for (const item of { [Symbol.iterator]: () => iter }) {
        yield item;
      }
    });
  }

  // Plain object: check if empty, yield [key, value] entries
  if (typeof coll === "object") {
    const entries = Object.entries(coll);
    return entries.length === 0 ? null : lazySeq(function* () {
      for (const entry of entries) yield entry;
    });
  }

  throw new TypeError(`seq: Cannot create sequence from ${typeof coll}`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NOTE: The following functions are now self-hosted in self-hosted.js:
// - Phase 15: doall, vec, set (type conversions)
// - Phase 16: get, getIn (map access)
// - Phase 17: assoc, assocIn, dissoc, update, updateIn, merge (map mutations)
// - Phase 18: empty, conj, into (collection protocols)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RUNTIME HELPERS (used by transpiled code)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Get a property from an object, or call a function with the key.
 * Used by transpiler for property access and function calls.
 */
export function __hql_get(obj, key, defaultValue) {
  if (obj && typeof obj[key] !== "undefined") {
    return obj[key];
  }
  if (typeof obj === "function") {
    const fnResult = obj(key);
    if (typeof fnResult !== "undefined") {
      return fnResult;
    }
  }
  return defaultValue;
}

// Alias for numeric property access
export const __hql_getNumeric = __hql_get;

/**
 * Runtime helper for range generation (used by macros).
 * More lenient than the public range() function.
 */
export function __hql_range(...args) {
  let start;
  let end;
  let step = 1;

  // Parse arguments
  if (args.length === 0) {
    // No arguments → infinite sequence from 0
    start = 0;
    end = undefined;
  } else if (args.length === 1) {
    // One argument → range from 0 to args[0]
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

  // Use shared core implementation
  return rangeCore(start, end, step);
}

/**
 * Convert a value to a sequence (array).
 */
export function __hql_toSequence(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "number") {
    const result = [];
    const step = value >= 0 ? 1 : -1;
    for (let i = 0; step > 0 ? i < value : i > value; i += step) {
      result.push(i);
    }
    return result;
  }
  if (typeof value === "string") return value.split("");
  if (value && typeof value[Symbol.iterator] === "function") {
    return [...value];
  }
  return [value];
}

/**
 * For-each iteration helper.
 */
export function __hql_for_each(sequence, iteratee) {
  const list = Array.isArray(sequence) ? sequence : __hql_toSequence(sequence);
  for (let index = 0; index < list.length; index++) {
    iteratee(list[index], index);
  }
  return null;
}

/**
 * Create a hash map (plain object) from key-value pairs.
 */
export function __hql_hash_map(...entries) {
  const result = Object.create(null);
  const limit = entries.length - (entries.length % 2);
  for (let i = 0; i < limit; i += 2) {
    result[String(entries[i])] = entries[i + 1];
  }
  return result;
}

/**
 * Throw an error with the given value.
 */
export function __hql_throw(value) {
  throw value instanceof Error ? value : new Error(String(value));
}

/**
 * Deep freeze an object to make it immutable.
 */
export function __hql_deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Object.isFrozen(obj)) {
    return obj;
  }
  Object.freeze(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) {
      __hql_deepFreeze(item);
    }
  } else {
    for (const value of Object.values(obj)) {
      __hql_deepFreeze(value);
    }
  }
  return obj;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIRST-CLASS OPERATORS (single source of truth)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Operators can be passed as first-class values to HOFs:
// (reduce + 0 [1 2 3]) => __hql_get_op("+") returns the + function
// (map * [1 2 3] [4 5 6]) => __hql_get_op("*") returns the * function

const __HQL_OPERATORS = {
  // Arithmetic
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => a / b,
  "%": (a, b) => a % b,
  "**": (a, b) => a ** b,

  // Comparison
  "===": (a, b) => a === b,
  "==": (a, b) => a == b,
  "!==": (a, b) => a !== b,
  "!=": (a, b) => a != b,
  "<": (a, b) => a < b,
  ">": (a, b) => a > b,
  "<=": (a, b) => a <= b,
  ">=": (a, b) => a >= b,

  // Logical
  "&&": (a, b) => a && b,
  "||": (a, b) => a || b,
  "!": (a) => !a,

  // Bitwise
  "~": (a) => ~a,
  "&": (a, b) => a & b,
  "|": (a, b) => a | b,
  "^": (a, b) => a ^ b,
  "<<": (a, b) => a << b,
  ">>": (a, b) => a >> b,
  ">>>": (a, b) => a >>> b,
};

/**
 * Get an operator function by its symbol.
 * This is the single source of truth for all operator-as-value usage.
 * @param {string} op - The operator symbol (e.g., "+", "-", "*")
 * @returns {Function} The function that implements the operator
 */
export function __hql_get_op(op) {
  const fn = __HQL_OPERATORS[op];
  if (!fn) {
    throw new Error(`Unknown operator: ${op}`);
  }
  return fn;
}

// Export lazySeq for creating custom lazy sequences
export { lazySeq };
