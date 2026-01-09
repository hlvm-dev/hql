// core.js - Bootstrap primitives and non-self-hosted functions
// Self-hosted functions are in self-hosted.js (transpiled from stdlib.hql)

import { rangeCore } from "./internal/range-core.js";

// Import Clojure-aligned foundation for lazy-seq support
// CONSOLIDATED: All lazy sequences use seq-protocol.js (thunk-based, O(1) rest)
import {
  lazySeq as seqLazySeq,
  chunkedLazySeq,  // For chunked operations (enables chunk propagation)
  cons as seqCons,
  EMPTY as SEQ_EMPTY,
  isSeqEnd,  // DRY helper: x == null || x === EMPTY
  isActiveSeq,  // DRY helper: !isSeqEnd(x) && x.seq?.()
  iteratorSeq,  // DRY: shared iterator-to-Cons conversion
  maybeRealize,  // DRY: realize LazySeq if needed
  SEQ,
  isCons,
  LazySeq,
  ArraySeq,
  NumericRange,
  Delay,
  delay as seqDelay,
  force as seqForce,
  isDelay as seqIsDelay,
  // Transducer infrastructure
  reduced as seqReduced,
  isReduced as seqIsReduced,
  unreduced as seqUnreduced,
  ensureReduced as seqEnsureReduced,
  toTransformer as seqToTransformer,
  completing as seqCompleting,
  TRANSDUCER_INIT,
  TRANSDUCER_STEP,
  TRANSDUCER_RESULT,
  // Chunked sequence infrastructure
  CHUNK_SIZE,
  ArrayChunk,
  ChunkBuffer,
  ChunkedCons,
  chunkCons as seqChunkCons,
  arrayChunk as seqArrayChunk,
  isChunked as seqIsChunked,
  chunkFirst as seqChunkFirst,
  chunkRest as seqChunkRest,
  toChunkedSeq as seqToChunkedSeq,
} from "./internal/seq-protocol.js";
import {
  validateFiniteNumber,
  validateFunction,
  validateNonZeroNumber,
} from "./internal/validators.js";

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

  // Array fast path: O(1) ArraySeq instead of O(n) generator
  if (Array.isArray(coll)) {
    if (coll.length <= 1) return SEQ_EMPTY;
    return new ArraySeq(coll, 1);  // O(1) count/nth operations
  }

  // Generic path: delegate to seq() to maintain optimized structure
  // This prevents re-wrapping in a new generator (O(N^2) fix)
  const s = seq(coll);
  return s ? s.rest() : SEQ_EMPTY;
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
 * Checks if a LazySeq or Delay has been fully realized
 *
 * @param {*} coll - Collection or Delay to check
 * @returns {boolean} True if fully realized
 */
export function realized(coll) {
  if (coll == null) return true;
  // Delay (explicit laziness)
  if (coll instanceof Delay) {
    return coll._realized;
  }
  // LazySeq (thunk-based, from seq-protocol.js)
  if (coll instanceof LazySeq) {
    return coll._isRealized;
  }
  return true; // Non-lazy collections are always realized
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEQ - Sequence Abstraction (Bootstrap Primitive)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NOTE: iteratorSeq is imported from seq-protocol.js (DRY)

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

  // Array: O(1) ArraySeq instead of O(n) generator
  if (Array.isArray(coll)) {
    return coll.length === 0 ? null : new ArraySeq(coll, 0);
  }

  // String: O(1) ArraySeq (treat string as array of chars)
  if (typeof coll === "string") {
    return coll.length === 0 ? null : new ArraySeq(coll, 0);
  }

  // Set: check if empty
  if (coll instanceof Set) {
    return coll.size === 0 ? null : iteratorSeq(coll[Symbol.iterator]());
  }

  // Map: check if empty, yield entries
  if (coll instanceof Map) {
    return coll.size === 0 ? null : iteratorSeq(coll[Symbol.iterator]());
  }

  // Generic iterable (generators, custom iterables): wrap in Cons chain
  if (typeof coll[Symbol.iterator] === "function") {
    return iteratorSeq(coll[Symbol.iterator]());
  }

  // Plain object: check if empty, yield [key, value] entries
  if (typeof coll === "object") {
    const entries = Object.entries(coll);
    return entries.length === 0 ? null : iteratorSeq(entries[Symbol.iterator]());
  }

  throw new TypeError(`seq: Cannot create sequence from ${typeof coll}`);
}

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
  if (value == null) return [];  // nil-punning: null or undefined → empty array
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

/**
 * Trampoline for mutual recursion TCO.
 * Executes thunks until a non-function value is returned.
 *
 * @param {function} thunk - Initial thunk to execute
 * @returns {*} Final non-function result
 *
 * @example
 * const is_even = (n) => n === 0 ? true : () => is_odd(n - 1);
 * const is_odd = (n) => n === 0 ? false : () => is_even(n - 1);
 * __hql_trampoline(() => is_even(10000)) // → true (no stack overflow)
 */
export function __hql_trampoline(thunk) {
  let result = thunk();
  while (typeof result === "function") {
    result = result();
  }
  return result;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIRST-CLASS OPERATORS (single source of truth)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Operators can be passed as first-class values to HOFs:
// (reduce + 0 [1 2 3]) => __hql_get_op("+") returns the + function
// (map * [1 2 3] [4 5 6]) => __hql_get_op("*") returns the * function

const __HQL_OPERATORS = {
  // Arithmetic - variadic versions for use with apply/reduce
  "+": (...nums) => {
    let sum = 0;
    for (const n of nums) sum += n;
    return sum;
  },
  "-": (...nums) => {
    if (nums.length === 0) return 0;
    if (nums.length === 1) return -nums[0];
    let result = nums[0];
    for (let i = 1; i < nums.length; i++) result -= nums[i];
    return result;
  },
  "*": (...nums) => {
    let product = 1;
    for (const n of nums) product *= n;
    return product;
  },
  "/": (...nums) => {
    if (nums.length === 0) return 1;
    if (nums.length === 1) return 1 / nums[0];
    let result = nums[0];
    for (let i = 1; i < nums.length; i++) result /= nums[i];
    return result;
  },
  "%": (a, b) => a % b,
  "**": (a, b) => a ** b,

  // Comparison
  "===": (a, b) => a === b,
  "==": (a, b) => a == b,
  "!==": (a, b) => a !== b,
  "!=": (a, b) => a != b,
  "not=": (a, b) => a != b,  // Lisp-style word-form
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
export { seqLazySeq as lazySeq };

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DELAY/FORCE - Explicit laziness primitives
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Creates a Delay - a memoized thunk for explicit lazy evaluation.
 * The thunk is called at most once, and the result is cached.
 *
 * Unlike lazy sequences which represent collections, Delay is for
 * single deferred values that should be computed only when needed.
 *
 * @param {Function} thunk - Zero-arg function returning the delayed value
 * @returns {Delay} Delay object
 */
export const delay = seqDelay;

/**
 * Forces evaluation of a Delay, or returns the value unchanged if not a Delay.
 *
 * @param {*} x - A Delay or any other value
 * @returns {*} The realized value
 */
export const force = seqForce;

/**
 * Check if a value is a Delay.
 *
 * @param {*} x - Value to check
 * @returns {boolean} True if x is a Delay
 */
export const isDelay = seqIsDelay;

/**
 * Internal function to create a Delay (for HQL delay macro).
 */
export function __hql_delay(thunk) {
  return seqDelay(thunk);
}

// Export NumericRange for advanced users
export { NumericRange };

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TRANSDUCERS - Composable algorithmic transformations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Export transducer infrastructure
export const reduced = seqReduced;
export const isReduced = seqIsReduced;
export const unreduced = seqUnreduced;
export const ensureReduced = seqEnsureReduced;
export const toTransformer = seqToTransformer;
export const completing = seqCompleting;

// Re-export protocol keys for advanced users
export { TRANSDUCER_INIT, TRANSDUCER_STEP, TRANSDUCER_RESULT };

/**
 * transduce - Apply a transducer to a collection with a reducing function.
 *
 * A transducer is a function that takes a reducing function (rf) and
 * returns a new reducing function. Transducers allow composable, reusable
 * transformations that are independent of the source/destination.
 *
 * 3-arity: (transduce xform rf coll) - uses rf() for initial value
 * 4-arity: (transduce xform rf init coll) - explicit initial value
 *
 * @param {Function} xform - Transducer function
 * @param {Function|Object} rf - Reducing function or transformer
 * @param {*} initOrColl - Initial value (4-arity) or collection (3-arity)
 * @param {Iterable} [maybeColl] - Collection (4-arity only)
 * @returns {*} Reduced result
 */
export function transduce(xform, rf, initOrColl, maybeColl) {
  let init, coll;

  if (maybeColl === undefined) {
    // 3-arity: (transduce xform rf coll)
    coll = initOrColl;
    const transformer = seqToTransformer(rf);
    init = transformer[TRANSDUCER_INIT]();
  } else {
    // 4-arity: (transduce xform rf init coll)
    init = initOrColl;
    coll = maybeColl;
  }

  const xrf = xform(seqToTransformer(rf));
  let acc = init;

  for (const item of coll) {
    acc = xrf[TRANSDUCER_STEP](acc, item);
    if (seqIsReduced(acc)) {
      acc = seqUnreduced(acc);
      break;
    }
  }

  return xrf[TRANSDUCER_RESULT](acc);
}

/**
 * into - Pour collection through optional transducer into target.
 *
 * 2-arity: (into to from) - No transducer, just conj
 * 3-arity: (into to xform from) - Apply transducer
 *
 * @param {Array|Set|Map} to - Target collection
 * @param {Function|Iterable} xformOrFrom - Transducer (3-arity) or source (2-arity)
 * @param {Iterable} [from] - Source collection (3-arity only)
 * @returns {*} Target collection with added elements
 */
export function intoXform(to, xformOrFrom, from) {
  // Determine the conj function based on target type
  const conjFn = (acc, x) => {
    if (Array.isArray(acc)) {
      acc.push(x);
      return acc;
    }
    if (acc instanceof Set) {
      acc.add(x);
      return acc;
    }
    if (acc instanceof Map && Array.isArray(x) && x.length === 2) {
      acc.set(x[0], x[1]);
      return acc;
    }
    // Default: treat as array-like
    acc.push(x);
    return acc;
  };

  if (from === undefined) {
    // 2-arity: (into to from) - just reduce with conj
    for (const item of xformOrFrom) {
      conjFn(to, item);
    }
    return to;
  }

  // 3-arity: (into to xform from)
  const xform = xformOrFrom;
  const rf = {
    [TRANSDUCER_INIT]: () => to,
    [TRANSDUCER_STEP]: conjFn,
    [TRANSDUCER_RESULT]: (acc) => acc,
  };

  return transduce(xform, rf, to, from);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CHUNKED SEQUENCES - 32-element batch processing (like Clojure)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Export chunk size constant
export { CHUNK_SIZE };

// Export chunk classes for advanced users
export { ArrayChunk, ChunkBuffer, ChunkedCons };

/**
 * Create a ChunkedCons from a chunk and lazy rest.
 *
 * @param {ArrayChunk} chunk - The chunk of elements
 * @param {LazySeq|null} rest - Lazy rest of the sequence
 * @returns {ChunkedCons} Chunked sequence cell
 */
export const chunkCons = seqChunkCons;

/**
 * Create an ArrayChunk from an array (or slice).
 *
 * @param {Array} arr - Source array
 * @param {number} [off=0] - Start offset
 * @param {number} [end=arr.length] - End offset
 * @returns {ArrayChunk} Immutable chunk
 */
export const arrayChunk = seqArrayChunk;

/**
 * Check if a sequence supports chunked iteration.
 *
 * @param {*} x - Value to check
 * @returns {boolean} True if chunked
 */
export const isChunked = seqIsChunked;

/**
 * Get the first chunk from a chunked sequence.
 *
 * @param {ChunkedCons} s - Chunked sequence
 * @returns {ArrayChunk|null} First chunk, or null if empty
 */
export const chunkFirst = seqChunkFirst;

/**
 * Get the rest after the first chunk.
 *
 * @param {ChunkedCons} s - Chunked sequence
 * @returns {LazySeq|EMPTY} Rest of sequence
 */
export const chunkRest = seqChunkRest;

/**
 * Convert collection to chunked sequence if beneficial.
 *
 * Arrays and NumericRanges are chunked for efficient map/filter.
 * Other sequences pass through unchanged.
 *
 * @param {Iterable|null} coll - Collection to chunk
 * @returns {ChunkedCons|Seq|null} Chunked or normal sequence
 */
export const toChunkedSeq = seqToChunkedSeq;

/**
 * Chunked map - map preserving chunk boundaries.
 *
 * When the input is a chunked sequence, the output preserves
 * 32-element chunks for better performance.
 *
 * @param {Function} f - Mapping function
 * @param {Iterable} coll - Collection to map over
 * @returns {ChunkedCons|LazySeq} Chunked or lazy sequence
 */
export function chunkedMap(f, coll) {
  const s = seqToChunkedSeq(coll);
  if (s == null) return null;

  if (seqIsChunked(s)) {
    return chunkedLazySeq(() => {
      const chunk = s.chunkFirst();
      const mapped = chunk.toArray().map(f);
      const newChunk = seqArrayChunk(mapped);
      const rest = s.chunkRest();
      if (isSeqEnd(rest)) {
        return seqChunkCons(newChunk, null);
      }
      return seqChunkCons(newChunk, chunkedLazySeq(() => chunkedMap(f, rest)));
    });
  }

  // Fall back to element-wise for non-chunked
  return seqLazySeq(() => {
    const fst = s.first?.();
    if (fst === undefined && !s.seq?.()) return null;
    return seqCons(f(fst), seqLazySeq(() => chunkedMap(f, s.rest?.())));
  });
}

/**
 * Chunked filter - filter preserving chunks where possible.
 *
 * @param {Function} pred - Predicate function
 * @param {Iterable} coll - Collection to filter
 * @returns {LazySeq} Lazy sequence of matching elements
 */
export function chunkedFilter(pred, coll) {
  const s = seqToChunkedSeq(coll);
  if (s == null) return null;

  if (seqIsChunked(s)) {
    return chunkedLazySeq(() => {
      const chunk = s.chunkFirst();
      const filtered = chunk.toArray().filter(pred);
      const rest = s.chunkRest();

      // Create new chunk if we have filtered elements
      if (filtered.length > 0) {
        const newChunk = seqArrayChunk(filtered);
        if (isSeqEnd(rest)) {
          return seqChunkCons(newChunk, null);
        }
        return seqChunkCons(newChunk, chunkedLazySeq(() => chunkedFilter(pred, rest)));
      }

      // No matches in this chunk, continue to rest
      if (isSeqEnd(rest)) return null;
      return chunkedFilter(pred, rest);
    });
  }

  // Fall back for non-chunked
  return seqLazySeq(function filterStep() {
    let current = s;
    while (isActiveSeq(current)) {
      const fst = current.first();
      if (pred(fst)) {
        return seqCons(fst, seqLazySeq(() => chunkedFilter(pred, current.rest())));
      }
      current = current.rest();
    }
    return null;
  });
}

/**
 * Chunked reduce - reduce with chunk-aware batching.
 *
 * When the input is chunked, reduces each chunk efficiently
 * before moving to the next.
 *
 * @param {Function} f - Reducing function (acc, x) => acc
 * @param {*} init - Initial accumulator value
 * @param {Iterable} coll - Collection to reduce
 * @returns {*} Reduced result
 */
export function chunkedReduce(f, init, coll) {
  const s = seqToChunkedSeq(coll);
  if (s == null) return init;

  let acc = init;

  if (seqIsChunked(s)) {
    let current = s;
    while (isActiveSeq(current)) {
      const chunk = current.chunkFirst();
      // Reduce within chunk
      acc = chunk.reduce(f, acc);
      if (seqIsReduced(acc)) return seqUnreduced(acc);
      current = maybeRealize(current.chunkRest());
    }
    return acc;
  }

  // Fall back for non-chunked
  let current = s;
  while (isActiveSeq(current)) {
    acc = f(acc, current.first());
    if (seqIsReduced(acc)) return seqUnreduced(acc);
    current = current.rest();
  }
  return acc;
}

/**
 * Chunked take - take first n elements preserving chunks.
 *
 * @param {number} n - Number of elements to take
 * @param {Iterable} coll - Collection to take from
 * @returns {LazySeq} Lazy sequence of first n elements
 */
export function chunkedTake(n, coll) {
  if (n <= 0) return null;
  const s = seqToChunkedSeq(coll);
  if (s == null) return null;

  if (seqIsChunked(s)) {
    return chunkedLazySeq(() => {
      const chunk = s.chunkFirst();
      const arr = chunk.toArray();

      if (arr.length <= n) {
        // Take whole chunk, continue with rest
        const rest = s.chunkRest();
        if (isSeqEnd(rest)) {
          return seqChunkCons(chunk, null);
        }
        return seqChunkCons(chunk, chunkedLazySeq(() => chunkedTake(n - arr.length, rest)));
      } else {
        // Take partial chunk
        const taken = arr.slice(0, n);
        return seqChunkCons(seqArrayChunk(taken), null);
      }
    });
  }

  // Fall back for non-chunked
  return seqLazySeq(() => {
    const fst = s.first?.();
    if (fst === undefined && !s.seq?.()) return null;
    return seqCons(fst, seqLazySeq(() => chunkedTake(n - 1, s.rest?.())));
  });
}

/**
 * Chunked drop - drop first n elements preserving chunks.
 *
 * @param {number} n - Number of elements to drop
 * @param {Iterable} coll - Collection to drop from
 * @returns {LazySeq} Lazy sequence after dropping n elements
 */
export function chunkedDrop(n, coll) {
  if (n <= 0) return seqToChunkedSeq(coll);
  const s = seqToChunkedSeq(coll);
  if (s == null) return null;

  if (seqIsChunked(s)) {
    return chunkedLazySeq(() => {
      let current = s;
      let remaining = n;

      // Skip whole chunks
      while (isActiveSeq(current)) {
        const chunk = current.chunkFirst();
        const arr = chunk.toArray();

        if (arr.length <= remaining) {
          remaining -= arr.length;
          current = maybeRealize(current.chunkRest());
        } else {
          // Drop partial chunk
          const kept = arr.slice(remaining);
          const rest = current.chunkRest();
          if (isSeqEnd(rest)) {
            return seqChunkCons(seqArrayChunk(kept), null);
          }
          return seqChunkCons(seqArrayChunk(kept), rest);
        }
      }
      return null;
    });
  }

  // Fall back for non-chunked
  return seqLazySeq(() => {
    let current = s;
    let remaining = n;
    while (remaining > 0 && isActiveSeq(current)) {
      current = current.rest?.();
      remaining--;
    }
    return current;
  });
}

/**
 * Chunked takeWhile - take elements while predicate holds, preserving chunks.
 *
 * @param {Function} pred - Predicate function
 * @param {Iterable} coll - Collection
 * @returns {LazySeq} Lazy sequence of elements while pred is true
 */
export function chunkedTakeWhile(pred, coll) {
  const s = seqToChunkedSeq(coll);
  if (s == null) return null;

  if (seqIsChunked(s)) {
    return chunkedLazySeq(() => {
      const chunk = s.chunkFirst();
      const arr = chunk.toArray();

      // Find first element that fails predicate
      let takeCount = 0;
      for (let i = 0; i < arr.length; i++) {
        if (pred(arr[i])) {
          takeCount++;
        } else {
          break;
        }
      }

      if (takeCount === 0) {
        return null; // First element failed
      }

      if (takeCount === arr.length) {
        // Whole chunk passes, continue with rest
        const rest = s.chunkRest();
        if (isSeqEnd(rest)) {
          return seqChunkCons(chunk, null);
        }
        return seqChunkCons(chunk, chunkedLazySeq(() => chunkedTakeWhile(pred, rest)));
      } else {
        // Partial chunk
        const taken = arr.slice(0, takeCount);
        return seqChunkCons(seqArrayChunk(taken), null);
      }
    });
  }

  // Fall back for non-chunked
  return seqLazySeq(() => {
    const fst = s.first?.();
    if (fst === undefined && !s.seq?.()) return null;
    if (!pred(fst)) return null;
    return seqCons(fst, seqLazySeq(() => chunkedTakeWhile(pred, s.rest?.())));
  });
}

/**
 * Chunked dropWhile - drop elements while predicate holds, preserving chunks.
 *
 * @param {Function} pred - Predicate function
 * @param {Iterable} coll - Collection
 * @returns {LazySeq} Lazy sequence after dropping while pred is true
 */
export function chunkedDropWhile(pred, coll) {
  const s = seqToChunkedSeq(coll);
  if (s == null) return null;

  if (seqIsChunked(s)) {
    return chunkedLazySeq(() => {
      let current = s;

      while (isActiveSeq(current)) {
        const chunk = current.chunkFirst();
        const arr = chunk.toArray();

        // Find first element that fails predicate
        let dropCount = 0;
        for (let i = 0; i < arr.length; i++) {
          if (pred(arr[i])) {
            dropCount++;
          } else {
            break;
          }
        }

        if (dropCount === 0) {
          // First element fails pred, return current chunked seq
          return current;
        }

        if (dropCount < arr.length) {
          // Partial chunk - keep the rest
          const kept = arr.slice(dropCount);
          const rest = current.chunkRest();
          if (isSeqEnd(rest)) {
            return seqChunkCons(seqArrayChunk(kept), null);
          }
          return seqChunkCons(seqArrayChunk(kept), rest);
        }

        // Whole chunk dropped, continue with rest
        current = maybeRealize(current.chunkRest());
      }
      return null;
    });
  }

  // Fall back for non-chunked
  return seqLazySeq(() => {
    let current = s;
    while (isActiveSeq(current)) {
      const fst = current.first();
      if (!pred(fst)) return current;
      current = current.rest?.();
    }
    return null;
  });
}

/**
 * Chunked concat - concatenate collections preserving chunks.
 *
 * @param {...Iterable} colls - Collections to concatenate
 * @returns {LazySeq} Lazy sequence of concatenated elements
 */
export function chunkedConcat(...colls) {
  if (colls.length === 0) return chunkedLazySeq(() => null);

  function concatSeqs(seqs) {
    if (seqs.length === 0) return null;

    const first = seqToChunkedSeq(seqs[0]);
    if (first == null) {
      return concatSeqs(seqs.slice(1));
    }

    if (seqIsChunked(first)) {
      return chunkedLazySeq(() => {
        const chunk = first.chunkFirst();
        const rest = first.chunkRest();

        if (isSeqEnd(rest)) {
          // Move to next collection
          const nextConcat = concatSeqs(seqs.slice(1));
          if (nextConcat == null) {
            return seqChunkCons(chunk, null);
          }
          return seqChunkCons(chunk, nextConcat);
        }
        return seqChunkCons(chunk, chunkedLazySeq(() => {
          const restResult = concatSeqs([rest, ...seqs.slice(1)]);
          return restResult;
        }));
      });
    }

    // Non-chunked first collection
    return seqLazySeq(() => {
      const fst = first.first?.();
      if (fst === undefined && !first.seq?.()) {
        return concatSeqs(seqs.slice(1));
      }
      const restFirst = first.rest?.();
      return seqCons(fst, seqLazySeq(() => concatSeqs([restFirst, ...seqs.slice(1)])));
    });
  }

  // Always wrap in chunkedLazySeq so caller can safely call .seq()
  return chunkedLazySeq(() => concatSeqs(colls));
}

/**
 * Chunked distinct - remove duplicates preserving chunks where possible.
 *
 * @param {Iterable} coll - Collection
 * @returns {LazySeq} Lazy sequence of unique elements
 */
export function chunkedDistinct(coll) {
  const s = seqToChunkedSeq(coll);
  if (s == null) return null;

  const seen = new Set();

  function distinctStep(current) {
    if (!isActiveSeq(current)) return null;

    if (seqIsChunked(current)) {
      const chunk = current.chunkFirst();
      const arr = chunk.toArray();
      const unique = [];

      for (const x of arr) {
        if (!seen.has(x)) {
          seen.add(x);
          unique.push(x);
        }
      }

      const rest = maybeRealize(current.chunkRest());
      if (unique.length > 0) {
        if (isSeqEnd(rest)) {
          return seqChunkCons(seqArrayChunk(unique), null);
        }
        return seqChunkCons(seqArrayChunk(unique), chunkedLazySeq(() => distinctStep(rest)));
      }
      return distinctStep(rest);
    }

    // Non-chunked
    const fst = current.first();
    if (!seen.has(fst)) {
      seen.add(fst);
      return seqCons(fst, seqLazySeq(() => distinctStep(current.rest?.())));
    }
    return distinctStep(current.rest?.());
  }

  return chunkedLazySeq(() => distinctStep(s));
}

/**
 * Chunked mapIndexed - map with index preserving chunks.
 *
 * @param {Function} f - Function (index, element) => result
 * @param {Iterable} coll - Collection
 * @returns {LazySeq} Lazy sequence of mapped elements
 */
export function chunkedMapIndexed(f, coll) {
  const s = seqToChunkedSeq(coll);
  if (s == null) return null;

  let idx = 0;

  function mapIndexedStep(current) {
    if (!isActiveSeq(current)) return null;

    if (seqIsChunked(current)) {
      const chunk = current.chunkFirst();
      const arr = chunk.toArray();
      const mapped = arr.map((x) => f(idx++, x));
      const rest = maybeRealize(current.chunkRest());
      if (isSeqEnd(rest)) {
        return seqChunkCons(seqArrayChunk(mapped), null);
      }
      return seqChunkCons(seqArrayChunk(mapped), chunkedLazySeq(() => mapIndexedStep(rest)));
    }

    // Non-chunked
    const fst = current.first();
    const mapped = f(idx++, fst);
    return seqCons(mapped, seqLazySeq(() => mapIndexedStep(current.rest?.())));
  }

  return chunkedLazySeq(() => mapIndexedStep(s));
}

/**
 * Chunked keep - like filter but uses function result, preserving chunks.
 *
 * @param {Function} f - Function that returns value or null/undefined
 * @param {Iterable} coll - Collection
 * @returns {LazySeq} Lazy sequence of non-nil results
 */
export function chunkedKeep(f, coll) {
  const s = seqToChunkedSeq(coll);
  if (s == null) return null;

  if (seqIsChunked(s)) {
    return chunkedLazySeq(() => {
      const chunk = s.chunkFirst();
      const arr = chunk.toArray();
      const kept = [];

      for (const x of arr) {
        const result = f(x);
        if (result != null) {
          kept.push(result);
        }
      }

      const rest = s.chunkRest();

      if (kept.length > 0) {
        if (isSeqEnd(rest)) {
          return seqChunkCons(seqArrayChunk(kept), null);
        }
        return seqChunkCons(seqArrayChunk(kept), chunkedLazySeq(() => chunkedKeep(f, rest)));
      }

      if (isSeqEnd(rest)) return null;
      return chunkedKeep(f, rest);
    });
  }

  // Fall back for non-chunked
  return seqLazySeq(function keepStep() {
    let current = s;
    while (isActiveSeq(current)) {
      const fst = current.first();
      const result = f(fst);
      if (result != null) {
        return seqCons(result, seqLazySeq(() => chunkedKeep(f, current.rest())));
      }
      current = current.rest();
    }
    return null;
  });
}

/**
 * Chunked mapcat - map then concatenate, preserving chunks where possible.
 *
 * @param {Function} f - Function that returns a collection
 * @param {Iterable} coll - Collection
 * @returns {LazySeq} Lazy sequence of concatenated results
 */
export function chunkedMapcat(f, coll) {
  const s = seqToChunkedSeq(coll);
  if (s == null) return null;

  function mapcatStep(current, pendingResults) {
    // First exhaust pending results from previous f(x) calls
    if (pendingResults && pendingResults.length > 0) {
      const first = pendingResults[0];
      const restPending = pendingResults.slice(1);
      const firstSeq = seqToChunkedSeq(first);

      if (firstSeq == null) {
        return mapcatStep(current, restPending);
      }

      if (seqIsChunked(firstSeq)) {
        const chunk = firstSeq.chunkFirst();
        const rest = firstSeq.chunkRest();
        const newPending = !isSeqEnd(rest) ? [rest, ...restPending] : restPending;
        return seqChunkCons(chunk, chunkedLazySeq(() => mapcatStep(current, newPending)));
      }

      // Non-chunked result
      const fst = firstSeq.first?.();
      if (fst === undefined && !firstSeq.seq?.()) {
        return mapcatStep(current, restPending);
      }
      const restFirst = firstSeq.rest?.();
      const newPending = restFirst ? [restFirst, ...restPending] : restPending;
      return seqCons(fst, seqLazySeq(() => mapcatStep(current, newPending)));
    }

    // No pending, get next from source
    if (!isActiveSeq(current)) return null;

    if (seqIsChunked(current)) {
      const chunk = current.chunkFirst();
      const arr = chunk.toArray();
      const results = arr.map(f);
      const rest = maybeRealize(current.chunkRest());
      return mapcatStep(rest, results);
    }

    // Non-chunked source
    const fst = current.first();
    const result = f(fst);
    return mapcatStep(current.rest?.(), [result]);
  }

  return chunkedLazySeq(() => mapcatStep(s, []));
}

/**
 * Chunked partition - partition into groups of n, preserving chunks.
 *
 * @param {number} n - Partition size
 * @param {Iterable} coll - Collection
 * @returns {LazySeq} Lazy sequence of arrays of size n
 */
export function chunkedPartition(n, coll) {
  if (n <= 0) return null;
  const s = seqToChunkedSeq(coll);
  if (s == null) return null;

  function partitionStep(current, buffer) {
    if (!isActiveSeq(current)) {
      // Return final partition if complete
      if (buffer.length === n) {
        return seqCons(buffer, null);
      }
      return null; // Discard incomplete partition (Clojure behavior)
    }

    if (seqIsChunked(current)) {
      const chunk = current.chunkFirst();
      const arr = chunk.toArray();
      const results = [];
      let buf = buffer;

      for (const x of arr) {
        buf.push(x);
        if (buf.length === n) {
          results.push(buf);
          buf = [];
        }
      }

      const rest = maybeRealize(current.chunkRest());
      if (results.length > 0) {
        if (isSeqEnd(rest)) {
          return seqChunkCons(seqArrayChunk(results), null);
        }
        return seqChunkCons(seqArrayChunk(results), chunkedLazySeq(() => partitionStep(rest, buf)));
      }
      return partitionStep(rest, buf);
    }

    // Non-chunked
    const fst = current.first();
    buffer.push(fst);
    if (buffer.length === n) {
      return seqCons(buffer, seqLazySeq(() => partitionStep(current.rest?.(), [])));
    }
    return partitionStep(current.rest?.(), buffer);
  }

  return chunkedLazySeq(() => partitionStep(s, []));
}

/**
 * Chunked interleave - interleave collections, re-chunking output.
 *
 * @param {...Iterable} colls - Collections to interleave
 * @returns {LazySeq} Lazy sequence of interleaved elements
 */
export function chunkedInterleave(...colls) {
  if (colls.length === 0) return null;
  if (colls.length === 1) return seqToChunkedSeq(colls[0]);

  const seqs = colls.map(c => seqToChunkedSeq(c));
  if (seqs.some(s => s == null)) return null;

  function interleaveStep(currents, buffer) {
    // Check if any sequence is exhausted
    if (currents.some(c => !isActiveSeq(c))) {
      // Flush buffer as chunk
      if (buffer.length > 0) {
        return seqChunkCons(seqArrayChunk(buffer), null);
      }
      return null;
    }

    // Collect one element from each sequence
    const newBuffer = [...buffer];
    const nexts = [];

    for (const curr of currents) {
      if (seqIsChunked(curr)) {
        const chunk = curr.chunkFirst();
        const arr = chunk.toArray();
        newBuffer.push(arr[0]);

        // Create sequence from rest of chunk + chunkRest
        if (arr.length > 1) {
          const restChunk = seqArrayChunk(arr.slice(1));
          const rest = curr.chunkRest();
          nexts.push(seqChunkCons(restChunk, rest));
        } else {
          nexts.push(maybeRealize(curr.chunkRest()));
        }
      } else {
        newBuffer.push(curr.first());
        nexts.push(curr.rest?.());
      }
    }

    // Emit chunk when buffer is full
    if (newBuffer.length >= 32) {
      const chunk = seqArrayChunk(newBuffer.slice(0, 32));
      const remaining = newBuffer.slice(32);
      return seqChunkCons(chunk, chunkedLazySeq(() => interleaveStep(nexts, remaining)));
    }

    return interleaveStep(nexts, newBuffer);
  }

  return chunkedLazySeq(() => interleaveStep(seqs, []));
}

/**
 * Chunked interpose - insert separator between elements, re-chunking output.
 *
 * @param {*} sep - Separator to insert
 * @param {Iterable} coll - Collection
 * @returns {LazySeq} Lazy sequence with separators
 */
export function chunkedInterpose(sep, coll) {
  const s = seqToChunkedSeq(coll);
  if (s == null) return null;

  let isFirst = true;

  function interposeStep(current, buffer) {
    if (!isActiveSeq(current)) {
      if (buffer.length > 0) {
        return seqChunkCons(seqArrayChunk(buffer), null);
      }
      return null;
    }

    if (seqIsChunked(current)) {
      const chunk = current.chunkFirst();
      const arr = chunk.toArray();
      const newBuffer = [...buffer];

      for (const x of arr) {
        if (!isFirst) {
          newBuffer.push(sep);
        }
        newBuffer.push(x);
        isFirst = false;
      }

      const rest = maybeRealize(current.chunkRest());

      // Emit chunks when buffer is large enough
      if (newBuffer.length >= 32) {
        const chunk = seqArrayChunk(newBuffer.slice(0, 32));
        const remaining = newBuffer.slice(32);
        if (isSeqEnd(rest)) {
          if (remaining.length > 0) {
            return seqChunkCons(chunk, seqChunkCons(seqArrayChunk(remaining), null));
          }
          return seqChunkCons(chunk, null);
        }
        return seqChunkCons(chunk, chunkedLazySeq(() => interposeStep(rest, remaining)));
      }

      if (isSeqEnd(rest)) {
        if (newBuffer.length > 0) {
          return seqChunkCons(seqArrayChunk(newBuffer), null);
        }
        return null;
      }
      return interposeStep(rest, newBuffer);
    }

    // Non-chunked
    const fst = current.first();
    const newBuffer = [...buffer];
    if (!isFirst) {
      newBuffer.push(sep);
    }
    newBuffer.push(fst);
    isFirst = false;

    if (newBuffer.length >= 32) {
      const chunk = seqArrayChunk(newBuffer.slice(0, 32));
      const remaining = newBuffer.slice(32);
      return seqChunkCons(chunk, seqLazySeq(() => interposeStep(current.rest?.(), remaining)));
    }
    return interposeStep(current.rest?.(), newBuffer);
  }

  return chunkedLazySeq(() => interposeStep(s, []));
}

/**
 * Chunked reductions - like reduce but returns intermediate values, preserving chunks.
 *
 * @param {Function} f - Reducing function
 * @param {*} init - Initial value
 * @param {Iterable} coll - Collection
 * @returns {LazySeq} Lazy sequence of intermediate reduction values
 */
export function chunkedReductions(f, init, coll) {
  const s = seqToChunkedSeq(coll);

  function reductionsStep(current, acc, buffer, includeInit) {
    const newBuffer = includeInit ? [acc, ...buffer] : [...buffer];

    if (!isActiveSeq(current)) {
      if (newBuffer.length > 0) {
        return seqChunkCons(seqArrayChunk(newBuffer), null);
      }
      return null;
    }

    if (seqIsChunked(current)) {
      const chunk = current.chunkFirst();
      const arr = chunk.toArray();
      let currAcc = acc;

      for (const x of arr) {
        currAcc = f(currAcc, x);
        if (seqIsReduced(currAcc)) {
          newBuffer.push(seqUnreduced(currAcc));
          return seqChunkCons(seqArrayChunk(newBuffer), null);
        }
        newBuffer.push(currAcc);
      }

      const rest = maybeRealize(current.chunkRest());

      // Emit chunk when buffer is large enough
      if (newBuffer.length >= 32) {
        const chunk = seqArrayChunk(newBuffer.slice(0, 32));
        const remaining = newBuffer.slice(32);
        if (isSeqEnd(rest)) {
          if (remaining.length > 0) {
            return seqChunkCons(chunk, seqChunkCons(seqArrayChunk(remaining), null));
          }
          return seqChunkCons(chunk, null);
        }
        return seqChunkCons(chunk, chunkedLazySeq(() => reductionsStep(rest, currAcc, remaining, false)));
      }

      if (isSeqEnd(rest)) {
        if (newBuffer.length > 0) {
          return seqChunkCons(seqArrayChunk(newBuffer), null);
        }
        return null;
      }
      return reductionsStep(rest, currAcc, newBuffer, false);
    }

    // Non-chunked
    const fst = current.first();
    const newAcc = f(acc, fst);
    if (seqIsReduced(newAcc)) {
      newBuffer.push(seqUnreduced(newAcc));
      return seqChunkCons(seqArrayChunk(newBuffer), null);
    }
    newBuffer.push(newAcc);

    if (newBuffer.length >= 32) {
      const chunk = seqArrayChunk(newBuffer.slice(0, 32));
      const remaining = newBuffer.slice(32);
      return seqChunkCons(chunk, seqLazySeq(() => reductionsStep(current.rest?.(), newAcc, remaining, false)));
    }
    return reductionsStep(current.rest?.(), newAcc, newBuffer, false);
  }

  return chunkedLazySeq(() => reductionsStep(s, init, [], true));
}
