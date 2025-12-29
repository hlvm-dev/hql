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
  ArraySeq,
  NumericRange,
  Delay,
  delay as seqDelay,
  force as seqForce,
  isDelay as seqIsDelay,
  // Transducer infrastructure
  Reduced,
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
  CHUNKED,
  ArrayChunk,
  ChunkBuffer,
  ChunkedCons,
  chunkCons as seqChunkCons,
  arrayChunk as seqArrayChunk,
  isChunked as seqIsChunked,
  chunkFirst as seqChunkFirst,
  chunkRest as seqChunkRest,
  chunkSeq as seqChunkSeq,
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
// SEQ - Sequence Abstraction (Bootstrap Primitive)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Helper to create a Cons chain from an iterator.
 * Prevents O(N^2) nesting issues inherent in generator wrappers.
 */
function iteratorSeq(iter) {
  const { value, done } = iter.next();
  if (done) return null;
  // Use foundation's Cons/LazySeq for O(1) trampolining
  return seqCons(value, seqLazySeq(() => iteratorSeq(iter)));
}

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
    return seqLazySeq(() => {
      const chunk = s.chunkFirst();
      const mapped = chunk.toArray().map(f);
      const newChunk = seqArrayChunk(mapped);
      const rest = s.chunkRest();
      if (rest === SEQ_EMPTY || rest == null) {
        return seqChunkCons(newChunk, null);
      }
      return seqChunkCons(newChunk, seqLazySeq(() => chunkedMap(f, rest)));
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
    return seqLazySeq(() => {
      const chunk = s.chunkFirst();
      const filtered = chunk.toArray().filter(pred);
      const rest = s.chunkRest();

      // Create new chunk if we have filtered elements
      if (filtered.length > 0) {
        const newChunk = seqArrayChunk(filtered);
        if (rest === SEQ_EMPTY || rest == null) {
          return seqChunkCons(newChunk, null);
        }
        return seqChunkCons(newChunk, seqLazySeq(() => chunkedFilter(pred, rest)));
      }

      // No matches in this chunk, continue to rest
      if (rest === SEQ_EMPTY || rest == null) return null;
      return chunkedFilter(pred, rest);
    });
  }

  // Fall back for non-chunked
  return seqLazySeq(function filterStep() {
    let current = s;
    while (current && current !== SEQ_EMPTY && current.seq?.()) {
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
    while (current && current !== SEQ_EMPTY && current.seq?.()) {
      const chunk = current.chunkFirst();
      // Reduce within chunk
      acc = chunk.reduce(f, acc);
      if (seqIsReduced(acc)) return seqUnreduced(acc);
      current = current.chunkRest();
      // Handle LazySeq rest
      if (current instanceof SeqLazySeq) current = current._realize?.() ?? current;
    }
    return acc;
  }

  // Fall back for non-chunked
  let current = s;
  while (current && current !== SEQ_EMPTY && current.seq?.()) {
    acc = f(acc, current.first());
    if (seqIsReduced(acc)) return seqUnreduced(acc);
    current = current.rest();
  }
  return acc;
}
