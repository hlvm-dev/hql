// self-hosted.js - Pre-transpiled HQL stdlib functions
// Source of truth: stdlib.hql - this JS is the bootstrap execution form

import {
  lazySeq,
  cons,
  SEQ,
  reduced,
  isReduced,
  ensureReduced,
  shouldChunk,  // DRY helper: shouldChunk(coll)
  TRANSDUCER_INIT,
  TRANSDUCER_STEP,
  TRANSDUCER_RESULT,
} from "./internal/seq-protocol.js";
import {
  seq, first, rest,
  chunkedMap, chunkedFilter, chunkedReduce,
  chunkedTake, chunkedDrop, chunkedTakeWhile, chunkedDropWhile,
  chunkedConcat, chunkedDistinct, chunkedMapIndexed, chunkedKeep,
  chunkedMapcat, chunkedPartition, chunkedInterleave, chunkedInterpose,
  chunkedReductions,
} from "./core.js";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 1: CORE SEQUENCE OPERATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** take - Returns first n elements (lazy) */
export function take(n, coll) {
  // Use chunked path for large arrays or already-chunked seqs
  // Note: Don't check instanceof LazySeq to preserve laziness for generator-based seqs
  if (shouldChunk(coll)) {
    return chunkedTake(n, coll);
  }

  return lazySeq(() => {
    if (n > 0) {
      const s = seq(coll);
      if (s != null) {
        return cons(first(s), take(n - 1, rest(s)));
      }
    }
    return null;
  });
}

/** drop - Drops first n elements (lazy) */
export function drop(n, coll) {
  // Use chunked path for large arrays or already-chunked seqs
  // Note: Don't check instanceof LazySeq to preserve laziness for generator-based seqs
  if (shouldChunk(coll)) {
    return chunkedDrop(n, coll);
  }

  return lazySeq(() => {
    let s = seq(coll);
    let remaining = n;
    while (s != null && remaining > 0) {
      s = next(s);  // Use next() for idiomatic seq traversal
      remaining--;
    }
    // Must return Cons structure for LazySeq protocol
    if (s != null) {
      return cons(first(s), drop(0, rest(s)));
    }
    return null;
  });
}

/**
 * map - Maps function over collection(s) (lazy)
 *
 * Multi-arity support like Clojure:
 * - (map f coll) - single collection
 * - (map f c1 c2) - parallel map over 2 collections
 * - (map f c1 c2 c3 ...) - parallel map over n collections
 *
 * Clojure: (map + [1 2 3] [4 5 6]) => (5 7 9)
 * Clojure: (map vector [1 2] [:a :b]) => ([1 :a] [2 :b])
 */
export function map(f, ...colls) {
  if (typeof f !== "function") {
    throw new TypeError("map: first argument must be a function, got " + typeof f);
  }

  if (colls.length === 0) {
    throw new TypeError("map: requires at least one collection");
  }

  if (colls.length === 1) {
    // Single collection
    const coll = colls[0];

    // Optimization: Use chunked path for large arrays or already-chunked seqs
    // isChunked now properly detects LazySeq with _isChunkedSource flag
    if (shouldChunk(coll)) {
      return chunkedMap(f, coll);
    }

    // Standard lazy sequence for other cases
    return lazySeq(() => {
      const s = seq(coll);
      if (s != null) {
        return cons(f(first(s)), map(f, rest(s)));
      }
      return null;
    });
  }

  // Multi-collection parallel map
  return lazySeq(() => {
    const seqs = colls.map(c => seq(c));

    // Stop when any sequence is exhausted
    if (seqs.some(s => s == null)) {
      return null;
    }

    // Apply f to first elements of all sequences
    const firsts = seqs.map(s => first(s));
    const result = f(...firsts);

    // Recur with rest of each sequence
    const rests = seqs.map(s => rest(s));
    return cons(result, map(f, ...rests));
  });
}

/** filter - Filters collection by predicate (lazy) */
export function filter(pred, coll) {
  if (typeof pred !== "function") {
    throw new TypeError("filter: predicate must be a function, got " + typeof pred);
  }

  // Optimization: Use chunked path for large arrays or already-chunked seqs
  // isChunked now properly detects LazySeq with _isChunkedSource flag
  if (shouldChunk(coll)) {
    return chunkedFilter(pred, coll);
  }

  // Standard lazy sequence for other cases
  return lazySeq(() => {
    const s = seq(coll);
    if (s != null) {
      const f = first(s);
      if (pred(f)) {
        return cons(f, filter(pred, rest(s)));
      } else {
        return filter(pred, rest(s)).seq();
      }
    }
    return null;
  });
}

/**
 * reduce - Reduces collection with function (EAGER)
 *
 * Multi-arity support like Clojure:
 * - (reduce f coll) - 2-arity, uses first element as init
 * - (reduce f init coll) - 3-arity, explicit init
 *
 * Supports early termination with Reduced:
 * - If f returns (reduced x), stops immediately and returns x
 *
 * Clojure: (reduce + [1 2 3 4]) => 10
 * Clojure: (reduce + 10 [1 2 3]) => 16
 * Clojure: (reduce (fn [acc x] (if (> acc 5) (reduced acc) (+ acc x))) [1 2 3 4 5]) => 6
 */
export function reduce(f, initOrColl, maybeColl) {
  if (typeof f !== "function") {
    throw new TypeError("reduce: reducer must be a function, got " + typeof f);
  }

  let acc, s, coll;

  if (maybeColl === undefined) {
    // 2-arity: (reduce f coll)
    coll = initOrColl;
    s = seq(coll);
    if (s == null) {
      // Empty collection - call f with no args for identity
      return f();
    }
    acc = first(s);
    s = next(s);

    // Optimization: Use chunked path for large arrays or already-chunked seqs
    // isChunked now properly detects LazySeq with _isChunkedSource flag
    if (shouldChunk(coll)) {
      // For 2-arity, skip first element (already used as init)
      const restColl = Array.isArray(coll) ? coll.slice(1) : rest(coll);
      return chunkedReduce(f, acc, restColl);
    }
  } else {
    // 3-arity: (reduce f init coll)
    acc = initOrColl;
    coll = maybeColl;
    s = seq(coll);

    // Optimization: Use chunked path for large arrays or already-chunked seqs
    // isChunked now properly detects LazySeq with _isChunkedSource flag
    if (shouldChunk(coll)) {
      return chunkedReduce(f, acc, coll);
    }
  }

  // Standard reduce loop with Reduced support
  while (s != null) {
    acc = f(acc, first(s));
    // Check for early termination
    if (isReduced(acc)) {
      return acc._val;
    }
    s = next(s);
  }
  return acc;
}

/** concat - Concatenates multiple collections (lazy) - O(k) for k collections */
export function concat(...colls) {
  // Use chunked path if any collection is large or already-chunked
  // Note: Don't check instanceof LazySeq to preserve laziness for generator-based seqs
  if (colls.some(shouldChunk)) {
    return chunkedConcat(...colls);
  }

  // Use index-based iteration to avoid array slicing
  function step(collIdx, currSeq) {
    return lazySeq(() => {
      // Continue current sequence if non-empty
      const s = currSeq != null ? seq(currSeq) : null;
      if (s != null) {
        return cons(first(s), step(collIdx, rest(s)));
      }
      // Move to next collection
      let idx = collIdx;
      while (idx < colls.length) {
        const nextSeq = seq(colls[idx]);
        idx++;
        if (nextSeq != null) {
          return cons(first(nextSeq), step(idx, rest(nextSeq)));
        }
      }
      return null;
    });
  }
  return step(0, null);
}

/** Check if a value is a collection (iterable but not a string) */
function isColl(x) {
  return x != null && typeof x !== "string" && typeof x[Symbol.iterator] === "function";
}

/** flatten - Flattens nested collections (lazy) */
export function flatten(coll) {
  return lazySeq(() => {
    const s = seq(coll);
    if (s != null) {
      const f = first(s);
      if (isColl(f)) {
        return concat(flatten(f), flatten(rest(s))).seq();
      } else {
        return cons(f, flatten(rest(s)));
      }
    }
    return null;
  });
}

/**
 * distinct - Removes duplicate elements (lazy) - O(n) time
 *
 * WARNING: For infinite sequences, this function maintains an unbounded
 * Set of seen elements which will grow indefinitely. Use with caution
 * on infinite sequences or consider using distinctT transducer with
 * bounded input.
 *
 * @param {Iterable} coll - The collection to deduplicate
 * @returns {LazySeq} Lazy sequence of unique elements
 */
export function distinct(coll) {
  // Handle null/undefined input
  if (coll == null) return lazySeq(() => null);

  // Use chunked path for large arrays or already-chunked seqs
  // Note: Don't check instanceof LazySeq to preserve laziness for generator-based seqs
  if (shouldChunk(coll)) {
    return chunkedDistinct(coll);
  }

  const seen = new Set();  // Single mutable set per distinct() call
  function step(s) {
    return lazySeq(() => {
      let xs = seq(s);
      // Skip already-seen elements in a single pass
      while (xs != null) {
        const f = first(xs);
        if (!seen.has(f)) {
          seen.add(f);
          return cons(f, step(rest(xs)));
        }
        xs = next(xs);
      }
      return null;
    });
  }
  return step(coll);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 2: INDEXED OPERATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** next - Returns seq of rest, or null if rest is empty */
export function next(coll) {
  return seq(rest(coll));
}

/** nth - Returns element at index with optional not-found value */
export function nth(coll, index, notFound) {
  if (!Number.isInteger(index) || index < 0) {
    throw new TypeError(`nth: index must be non-negative integer, got ${index}`);
  }
  const hasNotFound = arguments.length >= 3;
  if (coll == null) {
    if (hasNotFound) return notFound;
    throw new Error(`nth: index ${index} out of bounds for null collection`);
  }
  // Array/string fast path
  if (Array.isArray(coll) || typeof coll === "string") {
    if (index >= 0 && index < coll.length) return coll[index];
    if (hasNotFound) return notFound;
    throw new Error(`nth: index ${index} out of bounds (length ${coll.length})`);
  }
  // Generic seq path
  let s = seq(coll);
  let i = 0;
  while (s != null) {
    if (i === index) return first(s);
    s = next(s);
    i++;
  }
  if (hasNotFound) return notFound;
  throw new Error(`nth: index ${index} out of bounds`);
}

/** second - Returns second element of collection */
export function second(coll) {
  return nth(coll, 1, null);
}

/** count - Returns count of elements (EAGER) */
export function count(coll) {
  if (coll == null) return 0;
  if (Array.isArray(coll) || typeof coll === "string") return coll.length;
  if (coll instanceof Set || coll instanceof Map) return coll.size;
  // Direct iterable path for efficiency
  if (typeof coll[Symbol.iterator] === "function") {
    let n = 0;
    for (const _ of coll) n++;
    return n;
  }
  // Generic seq path for LazySeq
  let s = seq(coll);
  let n = 0;
  while (s != null) {
    n++;
    s = next(s);
  }
  return n;
}

/** last - Returns last element (EAGER) */
export function last(coll) {
  if (coll == null) return null;
  if (Array.isArray(coll)) return coll.length > 0 ? coll[coll.length - 1] : null;
  if (typeof coll === "string") return coll.length > 0 ? coll[coll.length - 1] : null;
  let s = seq(coll);
  let result = null;
  while (s != null) {
    result = first(s);
    s = next(s);
  }
  return result;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 3: MAP OPERATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** mapIndexed - Maps function (index, item) over collection (lazy) */
export function mapIndexed(f, coll) {
  if (typeof f !== "function") {
    throw new TypeError("mapIndexed: first argument must be a function, got " + typeof f);
  }

  // Use chunked path for large arrays or already-chunked seqs
  // Note: Don't check instanceof LazySeq to preserve laziness for generator-based seqs
  if (shouldChunk(coll)) {
    return chunkedMapIndexed(f, coll);
  }

  function step(s, idx) {
    return lazySeq(() => {
      const xs = seq(s);
      if (xs != null) {
        return cons(f(idx, first(xs)), step(rest(xs), idx + 1));
      }
      return null;
    });
  }
  return step(coll, 0);
}

/** keepIndexed - Like mapIndexed but filters nil results (lazy) */
export function keepIndexed(f, coll) {
  if (typeof f !== "function") {
    throw new TypeError("keepIndexed: first argument must be a function, got " + typeof f);
  }
  function step(s, idx) {
    return lazySeq(() => {
      const xs = seq(s);
      if (xs != null) {
        const result = f(idx, first(xs));
        if (result != null) {
          return cons(result, step(rest(xs), idx + 1));
        } else {
          return step(rest(xs), idx + 1).seq();
        }
      }
      return null;
    });
  }
  return step(coll, 0);
}

/** mapcat - Maps function then flattens one level (lazy) */
export function mapcat(f, coll) {
  if (typeof f !== "function") {
    throw new TypeError("mapcat: first argument must be a function, got " + typeof f);
  }

  // Use chunked path for large arrays or already-chunked seqs
  // Note: Don't check instanceof LazySeq to preserve laziness for generator-based seqs
  if (shouldChunk(coll)) {
    return chunkedMapcat(f, coll);
  }

  return lazySeq(() => {
    const s = seq(coll);
    if (s != null) {
      const mapped = f(first(s));
      return concat(mapped, mapcat(f, rest(s))).seq();
    }
    return null;
  });
}

/** keep - Maps function and filters nil results (lazy) */
export function keep(f, coll) {
  if (typeof f !== "function") {
    throw new TypeError("keep: first argument must be a function, got " + typeof f);
  }

  // Use chunked path for large arrays or already-chunked seqs
  // Note: Don't check instanceof LazySeq to preserve laziness for generator-based seqs
  if (shouldChunk(coll)) {
    return chunkedKeep(f, coll);
  }

  return lazySeq(() => {
    const s = seq(coll);
    if (s != null) {
      const result = f(first(s));
      if (result != null) {
        return cons(result, keep(f, rest(s)));
      } else {
        return keep(f, rest(s)).seq();
      }
    }
    return null;
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 4: PREDICATES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** isEmpty - Tests if collection is empty */
export function isEmpty(coll) {
  return seq(coll) == null;
}

/** some - Returns first item where predicate returns truthy, or null */
export function some(pred, coll) {
  if (typeof pred !== "function") {
    throw new TypeError("some: predicate must be a function, got " + typeof pred);
  }
  let s = seq(coll);
  while (s != null) {
    const f = first(s);
    if (pred(f)) return f;
    s = next(s);
  }
  return null;
}

/** every - Returns true if predicate returns truthy for all items */
export function every(pred, coll) {
  if (typeof pred !== "function") {
    throw new TypeError("every: predicate must be a function, got " + typeof pred);
  }
  let s = seq(coll);
  while (s != null) {
    if (!pred(first(s))) return false;
    s = next(s);
  }
  return true;
}

/** notAny - Returns true if predicate returns false for all items */
export function notAny(pred, coll) {
  if (typeof pred !== "function") {
    throw new TypeError("notAny: predicate must be a function, got " + typeof pred);
  }
  let s = seq(coll);
  while (s != null) {
    if (pred(first(s))) return false;
    s = next(s);
  }
  return true;
}

/** notEvery - Returns true if predicate returns false for at least one item */
export function notEvery(pred, coll) {
  if (typeof pred !== "function") {
    throw new TypeError("notEvery: predicate must be a function, got " + typeof pred);
  }
  let s = seq(coll);
  while (s != null) {
    if (!pred(first(s))) return true;
    s = next(s);
  }
  return false;
}

/** isSome - Returns true if value is not nil (null or undefined) */
export function isSome(x) {
  return x != null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 5: TYPE PREDICATES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function isNil(x) { return x == null; }
export function isEven(n) { return n % 2 === 0; }
export function isOdd(n) { return n % 2 !== 0; }
export function isZero(n) { return n === 0; }
export function isPositive(n) { return n > 0; }
export function isNegative(n) { return n < 0; }
export function isNumber(x) { return typeof x === "number"; }
export function isString(x) { return typeof x === "string"; }
export function isBoolean(x) { return typeof x === "boolean"; }
export function isFunction(x) { return typeof x === "function"; }
export function isArray(x) { return Array.isArray(x); }
export function isObject(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }

// Lisp-style predicate aliases (with ? suffix)
// These map `nil?` -> `nil_QMARK_` via sanitizeIdentifier
export { isNil as nil_QMARK_ };
export { isNumber as number_QMARK_ };
export { isString as string_QMARK_ };
export { isBoolean as boolean_QMARK_ };
export { isArray as array_QMARK_ };
export { isObject as object_QMARK_ };
export { isFunction as fn_QMARK_ };
export { isEmpty as empty_QMARK_ };

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 6: ARITHMETIC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function inc(x) { return x + 1; }
export function dec(x) { return x - 1; }
export function abs(x) { return Math.abs(x); }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 7: COMPARISON
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function eq(...vals) {
  if (vals.length < 2) return true;
  const fst = vals[0];
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] !== fst) return false;
  }
  return true;
}

export function neq(a, b) { return a !== b; }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 8: LAZY CONSTRUCTORS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** repeat - Infinite sequence of the same value */
export function repeat(x) {
  return lazySeq(() => cons(x, repeat(x)));
}

/** repeatedly - Infinite sequence calling f each time */
export function repeatedly(f) {
  if (typeof f !== "function") {
    throw new TypeError("repeatedly: argument must be a function");
  }
  return lazySeq(() => cons(f(), repeatedly(f)));
}

/** cycle - Infinite sequence cycling through collection */
export function cycle(coll) {
  const xs = seq(coll);
  if (xs == null) return null;
  function step(s) {
    return lazySeq(() => {
      const curr = seq(s);
      if (curr != null) {
        return cons(first(curr), step(rest(curr)));
      }
      return step(xs).seq();
    });
  }
  return step(xs);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 9: FUNCTION OPERATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** iterate - Returns x, f(x), f(f(x)), ... */
export function iterate(f, x) {
  if (typeof f !== "function") {
    throw new TypeError("iterate: iterator function must be a function");
  }
  return lazySeq(() => cons(x, iterate(f, f(x))));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 10: UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** keys - Get keys from an object */
export function keys(obj) {
  if (obj == null) return [];
  return Object.keys(obj);
}

/** reverse - Reverse a collection */
export function reverse(coll) {
  if (coll == null) return [];
  return Array.from(coll).reverse();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 11: FUNCTION OPERATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** comp - Compose functions right-to-left: (comp f g h)(x) = f(g(h(x))) */
export function comp(...fns) {
  for (let i = 0; i < fns.length; i++) {
    if (typeof fns[i] !== "function") {
      throw new TypeError(`comp: argument ${i + 1} must be a function`);
    }
  }
  if (fns.length === 0) return x => x;
  if (fns.length === 1) return fns[0];
  return function(...args) {
    let result = fns[fns.length - 1](...args);
    for (let i = fns.length - 2; i >= 0; i--) result = fns[i](result);
    return result;
  };
}

/** partial - Partial function application: (partial f a b)(c) = f(a, b, c) */
export function partial(f, ...args) {
  if (typeof f !== "function") {
    throw new TypeError("partial: function must be a function");
  }
  return function(...moreArgs) {
    return f(...args, ...moreArgs);
  };
}

/** apply - Apply function to args collection: (apply f [a b c]) = f(a, b, c) */
export function apply(f, args) {
  if (typeof f !== "function") {
    throw new TypeError("apply: function must be a function");
  }
  if (args == null || typeof args[Symbol.iterator] !== "function") {
    throw new TypeError("apply: args must be iterable");
  }
  const arr = Array.isArray(args) ? args : Array.from(args);
  return f(...arr);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 12: COMPARISON (variadic chain semantics)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** lt - Less than: (< a b c) = (a < b) && (b < c) */
export function lt(...nums) {
  for (let i = 0; i < nums.length - 1; i++) {
    if (!(nums[i] < nums[i + 1])) return false;
  }
  return true;
}

/** gt - Greater than: (> a b c) = (a > b) && (b > c) */
export function gt(...nums) {
  for (let i = 0; i < nums.length - 1; i++) {
    if (!(nums[i] > nums[i + 1])) return false;
  }
  return true;
}

/** lte - Less than or equal: (<= a b c) = (a <= b) && (b <= c) */
export function lte(...nums) {
  for (let i = 0; i < nums.length - 1; i++) {
    if (!(nums[i] <= nums[i + 1])) return false;
  }
  return true;
}

/** gte - Greater than or equal: (>= a b c) = (a >= b) && (b >= c) */
export function gte(...nums) {
  for (let i = 0; i < nums.length - 1; i++) {
    if (!(nums[i] >= nums[i + 1])) return false;
  }
  return true;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 13: ARITHMETIC (variadic with identity semantics)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** add - Sum: (+) = 0, (+ a) = a, (+ a b c) = a + b + c */
export function add(...nums) {
  let sum = 0;
  for (const n of nums) sum += n;
  return sum;
}

/** sub - Subtract: (-) = 0, (- a) = -a, (- a b c) = a - b - c */
export function sub(...nums) {
  if (nums.length === 0) return 0;
  if (nums.length === 1) return -nums[0];
  let result = nums[0];
  for (let i = 1; i < nums.length; i++) result -= nums[i];
  return result;
}

/** mul - Multiply: (*) = 1, (* a) = a, (* a b c) = a * b * c */
export function mul(...nums) {
  let product = 1;
  for (const n of nums) product *= n;
  return product;
}

/** div - Divide: (/) = 1, (/ a) = 1/a, (/ a b c) = a / b / c */
export function div(...nums) {
  if (nums.length === 0) return 1;
  if (nums.length === 1) return 1 / nums[0];
  let result = nums[0];
  for (let i = 1; i < nums.length; i++) result /= nums[i];
  return result;
}

/** mod - Modulo: (mod a b) = a % b */
export function mod(a, b) {
  return a % b;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 14: SYMBOL/KEYWORD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** symbol - Create symbol from string */
export function symbol(name) {
  return String(name);
}

/** keyword - Create keyword (string with : prefix) */
export function keyword(name) {
  const s = String(name);
  return s.startsWith(":") ? s : ":" + s;
}

/** name - Get name part (removes : prefix from keywords) */
export function name(x) {
  if (x == null) return null;
  const s = String(x);
  return s.startsWith(":") ? s.slice(1) : s;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 15: TYPE CONVERSIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** vec - Convert collection to array (always new copy) */
export function vec(coll) {
  if (coll == null) return [];
  return Array.from(coll);
}

/** set - Convert collection to Set (always new copy) */
export function set(coll) {
  if (coll == null) return new Set();
  return new Set(coll);
}

/** doall - Force realization of lazy sequence */
export function doall(coll) {
  if (coll == null) return [];
  if (Array.isArray(coll)) return coll; // O(1) - already realized
  return Array.from(coll);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 16: MAP ACCESS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** get - Get value at key from map/object, with optional default */
export function get(m, key, notFound) {
  if (m == null) return notFound;
  if (m instanceof Map) return m.has(key) ? m.get(key) : notFound;
  return (key in m) ? m[key] : notFound;
}

/** getIn - Get value at nested path */
export function getIn(m, path, notFound) {
  // Validate path is array-like
  if (path == null || typeof path.length !== "number") {
    throw new TypeError("getIn: path must be an array, got " + (path == null ? "null" : typeof path));
  }
  if (path.length === 0) return m;
  let current = m;
  for (const key of path) {
    current = get(current, key, null);
    if (current == null) return notFound;
  }
  return current;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 17: MAP MUTATIONS (immutable)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** assoc - Associate key with value (returns new map)
 * For arrays: index must be 0 <= key <= length (Clojure semantics)
 * Use key === length to append, 0 <= key < length to replace
 */
export function assoc(m, key, value) {
  if (m == null) {
    // nil + numeric key: create single-element array at index 0 only
    // For Clojure compatibility, only index 0 is valid on nil
    if (typeof key === "number") {
      if (key !== 0) {
        throw new RangeError(`assoc: index ${key} out of bounds for nil (only 0 is valid)`);
      }
      return [value];
    }
    return { [key]: value };
  }
  if (m instanceof Map) { const r = new Map(m); r.set(key, value); return r; }
  if (Array.isArray(m)) {
    // Clojure semantics: index must be 0 <= key <= length
    if (typeof key === "number") {
      if (key < 0 || key > m.length) {
        throw new RangeError(`assoc: index ${key} out of bounds for array of length ${m.length}`);
      }
    }
    const r = [...m]; r[key] = value; return r;
  }
  return { ...m, [key]: value };
}

/** assocIn - Associate value at nested path */
export function assocIn(m, path, value) {
  // Validate path is array-like
  if (path == null || typeof path.length !== "number") {
    throw new TypeError("assocIn: path must be an array, got " + (path == null ? "null" : typeof path));
  }
  if (path.length === 0) return value;
  if (path.length === 1) return assoc(m, path[0], value);
  const [key, ...restPath] = path;
  const existing = get(m == null ? {} : m, key);
  const nested = (existing != null && typeof existing === "object")
    ? existing
    : (typeof restPath[0] === "number" ? [] : {});
  return assoc(m == null ? {} : m, key, assocIn(nested, restPath, value));
}

/** dissoc - Remove keys from map (returns new map) */
export function dissoc(m, ...keys) {
  if (m == null) return {};
  if (m instanceof Map) {
    const r = new Map(m);
    for (const k of keys) r.delete(k);
    return r;
  }
  if (Array.isArray(m)) {
    const r = [...m];
    for (const k of keys) delete r[k];
    return r;
  }
  const r = { ...m };
  for (const k of keys) delete r[k];
  return r;
}

/** update - Transform value at key with function */
export function update(m, key, fn) {
  if (typeof fn !== "function") throw new TypeError("update: transform function must be a function");
  return assoc(m, key, fn(get(m, key)));
}

/** updateIn - Transform value at nested path with function */
export function updateIn(m, path, fn) {
  if (typeof fn !== "function") throw new TypeError("updateIn: transform function must be a function");
  // Validate path is array-like
  if (path == null || typeof path.length !== "number") {
    throw new TypeError("updateIn: path must be an array, got " + (path == null ? "null" : typeof path));
  }
  if (path.length === 0) return fn(m);
  return assocIn(m, path, fn(getIn(m, path)));
}

/** merge - Merge multiple maps (later wins, shallow) */
export function merge(...maps) {
  const nonNil = maps.filter(m => m != null);
  if (nonNil.length === 0) return {};

  if (nonNil[0] instanceof Map) {
    const r = new Map();
    for (const m of nonNil) {
      if (m instanceof Map) {
        for (const [k, v] of m) r.set(k, v);
      } else if (typeof m === "object") {
        // Coerce plain objects into Map entries
        for (const [k, v] of Object.entries(m)) r.set(k, v);
      }
      // Skip non-object types silently (matches Clojure behavior)
    }
    return r;
  }

  return Object.assign({}, ...nonNil);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 18: COLLECTION PROTOCOLS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** empty - Return empty collection of same type */
export function empty(coll) {
  if (coll == null) return null;
  if (Array.isArray(coll)) return [];
  if (typeof coll === "string") return "";
  if (coll[SEQ]) return null; // LazySeq -> null (empty lazy seq)
  if (coll instanceof Set) return new Set();
  if (coll instanceof Map) return new Map();
  if (typeof coll === "object") return {};
  throw new TypeError(`Cannot create empty collection from ${typeof coll}`);
}

/** conj - Add item(s) to collection (type-preserving) */
export function conj(coll, ...items) {
  if (items.length === 0) return coll == null ? [] : coll;
  if (coll == null) return [...items];
  if (Array.isArray(coll)) return [...coll, ...items];
  if (typeof coll === "string") return coll + items.join("");
  if (coll[SEQ]) {
    // LazySeq: prepend items (reverse order for correct result)
    let result = coll;
    for (let i = items.length - 1; i >= 0; i--) result = cons(items[i], result);
    return result;
  }
  if (coll instanceof Set) {
    const r = new Set(coll);
    for (const item of items) r.add(item);
    return r;
  }
  if (coll instanceof Map) {
    const r = new Map(coll);
    for (const item of items) {
      if (!Array.isArray(item) || item.length !== 2) throw new TypeError("Map entries must be [key, value] pairs");
      r.set(item[0], item[1]);
    }
    return r;
  }
  if (typeof coll === "object") {
    const r = { ...coll };
    for (const item of items) {
      if (!Array.isArray(item) || item.length !== 2) throw new TypeError("Object entries must be [key, value] pairs");
      r[item[0]] = item[1];
    }
    return r;
  }
  throw new TypeError(`Cannot conj to ${typeof coll}`);
}

/** into - Pour collection into target - O(n) optimized */
export function into(to, from) {
  if (from == null) return to == null ? [] : to;
  // Fast paths to avoid O(n²) from repeated conj
  if (to == null) {
    return Array.from(from);
  }
  if (Array.isArray(to)) {
    const arr = [...to];
    for (const item of from) arr.push(item);
    return arr;
  }
  if (to instanceof Set) {
    const result = new Set(to);
    for (const item of from) result.add(item);
    return result;
  }
  if (to instanceof Map) {
    const result = new Map(to);
    for (const item of from) {
      if (Array.isArray(item) && item.length === 2) result.set(item[0], item[1]);
    }
    return result;
  }
  // Fallback for other types (strings, objects, etc.)
  return reduce((acc, item) => conj(acc, item), to, from);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 19: CONDITIONAL LAZY FUNCTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * takeWhile - Returns elements while predicate is true (lazy)
 * Clojure: (take-while pos? [1 2 3 0 -1]) => (1 2 3)
 */
export function takeWhile(pred, coll) {
  if (typeof pred !== "function") {
    throw new TypeError("takeWhile: predicate must be a function, got " + typeof pred);
  }

  // Use chunked path for large arrays or already-chunked seqs
  // Note: Don't check instanceof LazySeq to preserve laziness for generator-based seqs
  if (shouldChunk(coll)) {
    return chunkedTakeWhile(pred, coll);
  }

  return lazySeq(() => {
    const s = seq(coll);
    if (s != null) {
      const f = first(s);
      if (pred(f)) {
        return cons(f, takeWhile(pred, rest(s)));
      }
    }
    return null;
  });
}

/**
 * dropWhile - Drops elements while predicate is true (lazy)
 * Clojure: (drop-while pos? [1 2 3 0 -1 2]) => (0 -1 2)
 */
export function dropWhile(pred, coll) {
  if (typeof pred !== "function") {
    throw new TypeError("dropWhile: predicate must be a function, got " + typeof pred);
  }

  // Use chunked path for large arrays or already-chunked seqs
  // Note: Don't check instanceof LazySeq to preserve laziness for generator-based seqs
  if (shouldChunk(coll)) {
    return chunkedDropWhile(pred, coll);
  }

  return lazySeq(() => {
    let s = seq(coll);
    // Skip while predicate is true
    while (s != null && pred(first(s))) {
      s = next(s);
    }
    // Return remaining elements
    if (s != null) {
      return cons(first(s), rest(s));
    }
    return null;
  });
}

/**
 * splitWith - Returns [(takeWhile pred coll) (dropWhile pred coll)]
 * Clojure: (split-with pos? [1 2 -1 3]) => [(1 2) (-1 3)]
 */
export function splitWith(pred, coll) {
  if (typeof pred !== "function") {
    throw new TypeError("splitWith: predicate must be a function, got " + typeof pred);
  }
  return [doall(takeWhile(pred, coll)), doall(dropWhile(pred, coll))];
}

/**
 * splitAt - Returns [(take n coll) (drop n coll)]
 * Clojure: (split-at 2 [1 2 3 4 5]) => [(1 2) (3 4 5)]
 */
export function splitAt(n, coll) {
  if (!Number.isInteger(n) || n < 0) {
    throw new TypeError("splitAt: n must be non-negative integer, got " + n);
  }
  return [doall(take(n, coll)), doall(drop(n, coll))];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 20: REDUCTION VARIANTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * reductions - Returns lazy seq of intermediate reduce values
 * Clojure: (reductions + [1 2 3 4]) => (1 3 6 10)
 * Clojure: (reductions + 0 [1 2 3]) => (0 1 3 6)
 */
export function reductions(f, initOrColl, maybeColl) {
  if (typeof f !== "function") {
    throw new TypeError("reductions: reducer must be a function, got " + typeof f);
  }

  // 2-arity: (reductions f coll) - use first element as init
  if (maybeColl === undefined) {
    const coll = initOrColl;
    return lazySeq(() => {
      const s = seq(coll);
      if (s != null) {
        return reductionsWithInit(f, first(s), rest(s)).seq();
      }
      return null;
    });
  }

  // 3-arity: (reductions f init coll)
  // Use chunked path for large arrays or already-chunked seqs
  // Note: Don't check instanceof LazySeq to preserve laziness for generator-based seqs
  if (shouldChunk(maybeColl)) {
    return chunkedReductions(f, initOrColl, maybeColl);
  }

  return reductionsWithInit(f, initOrColl, maybeColl);
}

/** Helper: reductions with explicit init */
function reductionsWithInit(f, init, coll) {
  return cons(init, lazySeq(() => {
    const s = seq(coll);
    if (s != null) {
      const newAcc = f(init, first(s));
      return reductionsWithInit(f, newAcc, rest(s)).seq();
    }
    return null;
  }));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 21: SEQUENCE COMBINATORS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * interleave - Interleaves multiple sequences (lazy)
 * Stops when shortest sequence is exhausted.
 * Clojure: (interleave [1 2 3] [:a :b :c]) => (1 :a 2 :b 3 :c)
 */
export function interleave(...colls) {
  if (colls.length === 0) return lazySeq(() => null);
  if (colls.length === 1) return lazySeq(() => seq(colls[0]));

  // Use chunked path if any collection is large or already-chunked
  // Note: Don't check instanceof LazySeq to preserve laziness for generator-based seqs
  if (colls.some(shouldChunk)) {
    return chunkedInterleave(...colls);
  }

  return lazySeq(() => {
    // Get seqs of all collections
    const seqs = colls.map(c => seq(c));

    // If any seq is null, stop
    if (seqs.some(s => s == null)) {
      return null;
    }

    // Yield first from each, then recur with rests
    const firsts = seqs.map(s => first(s));
    const rests = seqs.map(s => rest(s));

    // Build result: first elements, then interleave of rests
    let result = interleave(...rests);
    for (let i = firsts.length - 1; i >= 0; i--) {
      result = cons(firsts[i], result);
    }
    return result.seq();
  });
}

/**
 * interpose - Inserts separator between elements (lazy)
 * Clojure: (interpose :x [1 2 3]) => (1 :x 2 :x 3)
 */
export function interpose(sep, coll) {
  // Use chunked path for large arrays or already-chunked seqs
  // Note: Don't check instanceof LazySeq to preserve laziness for generator-based seqs
  if (shouldChunk(coll)) {
    return chunkedInterpose(sep, coll);
  }

  return lazySeq(() => {
    const s = seq(coll);
    if (s == null) return null;

    const f = first(s);
    const r = rest(s);

    // First element, then [sep, elem] for each remaining
    return cons(f, interposeRest(sep, r));
  });
}

/** Helper: interpose for remaining elements */
function interposeRest(sep, coll) {
  return lazySeq(() => {
    const s = seq(coll);
    if (s == null) return null;
    return cons(sep, cons(first(s), interposeRest(sep, rest(s))));
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 22: PARTITION FAMILY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * partition - Partitions collection into groups of n (lazy)
 * Drops incomplete trailing groups.
 *
 * 2-arity: (partition n coll) - step defaults to n
 * 3-arity: (partition n step coll) - explicit step
 *
 * Clojure: (partition 3 [1 2 3 4 5 6 7]) => ((1 2 3) (4 5 6))
 * Clojure: (partition 3 1 [1 2 3 4 5]) => ((1 2 3) (2 3 4) (3 4 5))
 */
export function partition(n, stepOrColl, maybeColl) {
  if (typeof n !== "number" || n < 1) {
    throw new TypeError("partition: n must be a positive number");
  }

  // Determine arity
  let step, coll;
  if (maybeColl === undefined) {
    // 2-arity: partition(n, coll)
    step = n;
    coll = stepOrColl;
  } else {
    // 3-arity: partition(n, step, coll)
    step = stepOrColl;
    coll = maybeColl;
  }

  if (typeof step !== "number" || step < 1) {
    throw new TypeError("partition: step must be a positive number");
  }

  // Use chunked path for simple case (step = n) with large arrays or already-chunked seqs
  // Note: Don't check instanceof LazySeq to preserve laziness for generator-based seqs
  if (step === n && (shouldChunk(coll))) {
    return chunkedPartition(n, coll);
  }

  return lazySeq(() => {
    const s = seq(coll);
    if (s == null) return null;

    // Take n elements
    const p = doall(take(n, s));

    // Only include if we got exactly n elements
    if (count(p) === n) {
      return cons(p, partition(n, step, drop(step, s)));
    }
    return null;
  });
}

/**
 * partitionAll - Like partition, but includes incomplete trailing groups (lazy)
 *
 * 2-arity: (partition-all n coll) - step defaults to n
 * 3-arity: (partition-all n step coll) - explicit step
 *
 * Clojure: (partition-all 3 [1 2 3 4 5 6 7]) => ((1 2 3) (4 5 6) (7))
 */
export function partitionAll(n, stepOrColl, maybeColl) {
  if (typeof n !== "number" || n < 1) {
    throw new TypeError("partitionAll: n must be a positive number");
  }

  // Determine arity
  let step, coll;
  if (maybeColl === undefined) {
    // 2-arity: partitionAll(n, coll)
    step = n;
    coll = stepOrColl;
  } else {
    // 3-arity: partitionAll(n, step, coll)
    step = stepOrColl;
    coll = maybeColl;
  }

  if (typeof step !== "number" || step < 1) {
    throw new TypeError("partitionAll: step must be a positive number");
  }

  return lazySeq(() => {
    const s = seq(coll);
    if (s == null) return null;

    // Take n elements (or whatever's left)
    const p = doall(take(n, s));

    // Include even if incomplete
    return cons(p, partitionAll(n, step, drop(step, s)));
  });
}

/**
 * partitionBy - Partitions when function result changes (lazy)
 *
 * Clojure: (partition-by odd? [1 1 2 2 3]) => ((1 1) (2 2) (3))
 */
export function partitionBy(f, coll) {
  if (typeof f !== "function") {
    throw new TypeError("partitionBy: f must be a function");
  }

  return lazySeq(() => {
    const s = seq(coll);
    if (s == null) return null;

    const fst = first(s);
    const fv = f(fst);

    // Take all elements with same f result
    const run = doall(cons(fst, takeWhile((x) => {
      const xv = f(x);
      // Use === for Clojure's = semantics (strict equality)
      return fv === xv;
    }, rest(s))));

    const runCount = count(run);
    return cons(run, partitionBy(f, drop(runCount, s)));
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 23: TRANSDUCERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * mapT - Returns a mapping transducer.
 * When used with transduce, transforms each element by f.
 *
 * Clojure: (transduce (map inc) + [1 2 3]) => 9
 */
export function mapT(f) {
  if (typeof f !== "function") {
    throw new TypeError("mapT: f must be a function");
  }
  return (rf) => ({
    [TRANSDUCER_INIT]: () => rf[TRANSDUCER_INIT](),
    [TRANSDUCER_STEP]: (result, input) => rf[TRANSDUCER_STEP](result, f(input)),
    [TRANSDUCER_RESULT]: (result) => rf[TRANSDUCER_RESULT](result),
  });
}

/**
 * filterT - Returns a filtering transducer.
 * When used with transduce, only passes elements where pred returns truthy.
 *
 * Clojure: (transduce (filter even?) conj [] [1 2 3 4]) => [2 4]
 */
export function filterT(pred) {
  if (typeof pred !== "function") {
    throw new TypeError("filterT: pred must be a function");
  }
  return (rf) => ({
    [TRANSDUCER_INIT]: () => rf[TRANSDUCER_INIT](),
    [TRANSDUCER_STEP]: (result, input) =>
      pred(input) ? rf[TRANSDUCER_STEP](result, input) : result,
    [TRANSDUCER_RESULT]: (result) => rf[TRANSDUCER_RESULT](result),
  });
}

/**
 * takeT - Returns a take transducer.
 * When used with transduce, takes at most n elements.
 *
 * Clojure: (transduce (take 3) conj [] [1 2 3 4 5]) => [1 2 3]
 */
export function takeT(n) {
  if (typeof n !== "number" || n < 0) {
    throw new TypeError("takeT: n must be a non-negative number");
  }
  return (rf) => {
    let taken = 0;
    return {
      [TRANSDUCER_INIT]: () => rf[TRANSDUCER_INIT](),
      [TRANSDUCER_STEP]: (result, input) => {
        if (taken < n) {
          taken++;
          const r = rf[TRANSDUCER_STEP](result, input);
          // If we've taken enough, signal early termination
          return taken >= n ? ensureReduced(r) : r;
        }
        return ensureReduced(result);
      },
      [TRANSDUCER_RESULT]: (result) => rf[TRANSDUCER_RESULT](result),
    };
  };
}

/**
 * dropT - Returns a drop transducer.
 * When used with transduce, drops first n elements.
 *
 * Clojure: (transduce (drop 2) conj [] [1 2 3 4 5]) => [3 4 5]
 */
export function dropT(n) {
  if (typeof n !== "number" || n < 0) {
    throw new TypeError("dropT: n must be a non-negative number");
  }
  return (rf) => {
    let dropped = 0;
    return {
      [TRANSDUCER_INIT]: () => rf[TRANSDUCER_INIT](),
      [TRANSDUCER_STEP]: (result, input) => {
        if (dropped < n) {
          dropped++;
          return result;
        }
        return rf[TRANSDUCER_STEP](result, input);
      },
      [TRANSDUCER_RESULT]: (result) => rf[TRANSDUCER_RESULT](result),
    };
  };
}

/**
 * takeWhileT - Returns a take-while transducer.
 * Takes elements while pred returns truthy, then stops.
 *
 * Clojure: (transduce (take-while pos?) conj [] [1 2 -1 3]) => [1 2]
 */
export function takeWhileT(pred) {
  if (typeof pred !== "function") {
    throw new TypeError("takeWhileT: pred must be a function");
  }
  return (rf) => ({
    [TRANSDUCER_INIT]: () => rf[TRANSDUCER_INIT](),
    [TRANSDUCER_STEP]: (result, input) =>
      pred(input) ? rf[TRANSDUCER_STEP](result, input) : reduced(result),
    [TRANSDUCER_RESULT]: (result) => rf[TRANSDUCER_RESULT](result),
  });
}

/**
 * dropWhileT - Returns a drop-while transducer.
 * Drops elements while pred returns truthy, then takes the rest.
 *
 * Clojure: (transduce (drop-while neg?) conj [] [-1 -2 3 4]) => [3 4]
 */
export function dropWhileT(pred) {
  if (typeof pred !== "function") {
    throw new TypeError("dropWhileT: pred must be a function");
  }
  return (rf) => {
    let dropping = true;
    return {
      [TRANSDUCER_INIT]: () => rf[TRANSDUCER_INIT](),
      [TRANSDUCER_STEP]: (result, input) => {
        if (dropping) {
          if (pred(input)) {
            return result;
          }
          dropping = false;
        }
        return rf[TRANSDUCER_STEP](result, input);
      },
      [TRANSDUCER_RESULT]: (result) => rf[TRANSDUCER_RESULT](result),
    };
  };
}

/**
 * distinctT - Returns a distinct transducer.
 * Removes duplicate elements.
 *
 * Clojure: (transduce (distinct) conj [] [1 2 1 3 2]) => [1 2 3]
 */
export function distinctT() {
  return (rf) => {
    const seen = new Set();
    return {
      [TRANSDUCER_INIT]: () => rf[TRANSDUCER_INIT](),
      [TRANSDUCER_STEP]: (result, input) => {
        if (seen.has(input)) {
          return result;
        }
        seen.add(input);
        return rf[TRANSDUCER_STEP](result, input);
      },
      [TRANSDUCER_RESULT]: (result) => rf[TRANSDUCER_RESULT](result),
    };
  };
}

/**
 * partitionAllT - Returns a partition-all transducer.
 * Partitions input into groups of n, including incomplete final group.
 *
 * Clojure: (transduce (partition-all 2) conj [] [1 2 3 4 5]) => [[1 2] [3 4] [5]]
 */
export function partitionAllT(n) {
  if (typeof n !== "number" || n < 1) {
    throw new TypeError("partitionAllT: n must be a positive number");
  }
  return (rf) => {
    let buffer = [];
    return {
      [TRANSDUCER_INIT]: () => rf[TRANSDUCER_INIT](),
      [TRANSDUCER_STEP]: (result, input) => {
        buffer.push(input);
        if (buffer.length === n) {
          const chunk = buffer;
          buffer = [];
          return rf[TRANSDUCER_STEP](result, chunk);
        }
        return result;
      },
      [TRANSDUCER_RESULT]: (result) => {
        // Flush any remaining elements
        if (buffer.length > 0) {
          result = rf[TRANSDUCER_STEP](result, buffer);
          buffer = [];
        }
        return rf[TRANSDUCER_RESULT](isReduced(result) ? result._val : result);
      },
    };
  };
}

/**
 * composeTransducers - Compose multiple transducers left-to-right.
 * This is the opposite of function composition since transducers
 * are applied in reverse order when composed with rf.
 *
 * Usage: composeTransducers(mapT(inc), filterT(even?))
 * Equivalent to: (comp (map inc) (filter even?)) in Clojure
 */
export function composeTransducers(...xforms) {
  if (xforms.length === 0) return (rf) => rf;
  if (xforms.length === 1) return xforms[0];

  // Compose right-to-left to get left-to-right application
  return (rf) => {
    let composed = rf;
    for (let i = xforms.length - 1; i >= 0; i--) {
      composed = xforms[i](composed);
    }
    return composed;
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 24: FUNCTION UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** identity - Returns its argument unchanged */
export function identity(x) {
  return x;
}

/** constantly - Returns a function that always returns x, ignoring any arguments */
export function constantly(x) {
  return function(..._args) {
    return x;
  };
}

/** vals - Get values from an object/map */
export function vals(m) {
  if (m == null) return [];
  if (m instanceof Map) return Array.from(m.values());
  return Object.values(m);
}

/**
 * juxt - Juxtaposition: returns a fn that calls all fns on same args
 * Returns a vector of results.
 * Clojure: ((juxt inc dec) 5) => [6 4]
 */
export function juxt(...fns) {
  for (let i = 0; i < fns.length; i++) {
    if (typeof fns[i] !== "function") {
      throw new TypeError(`juxt: argument ${i + 1} must be a function`);
    }
  }
  return function(...args) {
    return fns.map(f => f(...args));
  };
}

/**
 * zipmap - Create map from keys and values
 * Clojure: (zipmap [:a :b :c] [1 2 3]) => {:a 1, :b 2, :c 3}
 */
export function zipmap(ks, vs) {
  const result = {};
  const keys = ks == null ? [] : Array.from(ks);
  const values = vs == null ? [] : Array.from(vs);
  const len = Math.min(keys.length, values.length);
  for (let i = 0; i < len; i++) {
    result[keys[i]] = values[i];
  }
  return result;
}
