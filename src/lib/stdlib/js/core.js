// core.js - Fundamental core functions (51 functions)
// These are the irreducible primitives - cannot be built from other functions
// Inspired by clojure.core
//
// Week 1 additions: nth, count, second, last
// Week 2 additions: mapIndexed, keepIndexed, mapcat, keep
// Week 3 additions: seq, empty, conj, into
// Week 4 additions: repeat, repeatedly, cycle
// Week 5 additions: every, notAny, notEvery, isSome
// Week 6 additions: get, getIn, assoc, assocIn, dissoc, update, updateIn, merge, vec, set

import { EMPTY_LAZY_SEQ, LazySeq, lazySeq } from "./internal/lazy-seq.js";
import { normalize } from "./internal/normalize.js";
import { rangeCore } from "./internal/range-core.js";
import {
  validateFiniteNumber,
  validateFunction,
  validateNonNegativeNumber,
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

  // Optimize for arrays
  if (Array.isArray(coll)) {
    return coll.length > 0 ? coll[0] : undefined;
  }

  // Optimize for LazySeq
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
  if (coll == null) return EMPTY_LAZY_SEQ;

  // Array fast path: indexed iteration (2-3x faster + lazy)
  if (Array.isArray(coll)) {
    if (coll.length <= 1) return EMPTY_LAZY_SEQ;
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
 * Returns a seq of the items after the first. Returns null if empty.
 *
 * Like rest, but returns null instead of empty sequence when coll has 0 or 1 items.
 * This is useful for recursive patterns where null signals termination.
 *
 * @param {Iterable|null|undefined} coll - Any iterable collection
 * @returns {LazySeq|null} Lazy sequence of remaining elements, or null if <= 1 element
 *
 * @example
 * next([1, 2, 3])  // → [2, 3]
 * next([1])        // → null
 * next([])         // → null
 * next(null)       // → null
 */
export function next(coll) {
  if (coll == null) return null;

  // Array fast path
  if (Array.isArray(coll)) {
    if (coll.length <= 1) return null;
    return lazySeq(function* () {
      for (let i = 1; i < coll.length; i++) {
        yield coll[i];
      }
    });
  }

  // LazySeq path
  if (coll instanceof LazySeq) {
    const second = coll.get(1);
    if (second === undefined) return null;
    return lazySeq(function* () {
      let i = 1;
      let val;
      while ((val = coll.get(i++)) !== undefined) {
        yield val;
      }
    });
  }

  // Generic iterable path - check if has > 1 element
  const arr = [...coll];
  if (arr.length <= 1) return null;
  return lazySeq(function* () {
    for (let i = 1; i < arr.length; i++) {
      yield arr[i];
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
  return concat([item], coll);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INDEXED ACCESS & COUNTING (Week 1)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Returns element at index, with optional fallback value
 *
 * Gets the element at zero-based index position. If index is out of bounds:
 * - With notFound arg: returns notFound value
 * - Without notFound arg: throws error
 *
 * Lazy: Realizes only up to index + 1 elements for LazySeq.
 *
 * @param {Iterable|null|undefined} coll - Collection to access
 * @param {number} index - Zero-based index (must be non-negative integer)
 * @param {*} [notFound] - Value to return if index out of bounds
 * @returns {*} Element at index, or notFound if out of bounds
 * @throws {TypeError} If index is not a non-negative integer
 * @throws {Error} If index out of bounds and notFound not provided
 *
 * @example
 * nth([10, 20, 30], 1)       // → 20
 * nth([10, 20, 30], 5, 99)   // → 99 (out of bounds, returns notFound)
 * nth([10, 20, 30], 5)       // → throws Error (out of bounds, no notFound)
 *
 * @example
 * // Works with strings
 * nth("hello", 1)  // → "e"
 *
 * @example
 * // Lazy realization
 * const lazy = map(x => x * 2, [1, 2, 3]);
 * nth(lazy, 1)  // → 4 (realizes only first 2 elements)
 */
export function nth(coll, index, notFound) {
  // Validate index: must be non-negative integer
  if (!Number.isInteger(index) || index < 0) {
    throw new TypeError(
      `nth: index must be non-negative integer, got ${index}`,
    );
  }

  // Check if notFound was explicitly provided (use arguments.length)
  const hasNotFound = arguments.length >= 3;

  // Handle nil collection
  if (coll == null) {
    if (hasNotFound) return notFound;
    throw new Error(`nth: index ${index} out of bounds for null collection`);
  }

  // Array fast path: O(1) direct index access
  if (Array.isArray(coll)) {
    if (index < coll.length) return coll[index];
    if (hasNotFound) return notFound;
    throw new Error(
      `nth: index ${index} out of bounds (length ${coll.length})`,
    );
  }

  // String fast path: O(1) character access
  if (typeof coll === "string") {
    if (index < coll.length) return coll[index];
    if (hasNotFound) return notFound;
    throw new Error(
      `nth: index ${index} out of bounds (length ${coll.length})`,
    );
  }

  // LazySeq: realize up to index + 1, then check _realized array
  if (coll instanceof LazySeq) {
    coll._realize(index + 1); // Realize up to and including index
    if (index < coll._realized.length) return coll._realized[index];
    if (hasNotFound) return notFound;
    throw new Error(`nth: index ${index} out of bounds for sequence`);
  }

  // Generic iterable: iterate with counter until index reached
  let i = 0;
  for (const item of coll) {
    if (i === index) return item;
    i++;
  }

  // Out of bounds on generic iterable
  if (hasNotFound) return notFound;
  throw new Error(`nth: index ${index} out of bounds`);
}

/**
 * Returns the count of elements in a collection
 *
 * EAGER: Forces full realization of lazy sequences.
 * This matches Clojure's behavior where count realizes the entire sequence.
 *
 * @param {Iterable|null|undefined} coll - Collection to count
 * @returns {number} Number of elements (0 for nil)
 *
 * @example
 * count([1, 2, 3])  // → 3
 * count([])         // → 0
 * count(null)       // → 0
 *
 * @example
 * // Strings
 * count("hello")  // → 5
 *
 * @example
 * // Forces full realization (EAGER!)
 * const lazy = map(x => x * 2, [1, 2, 3]);
 * count(lazy)  // → 3 (realizes all 3 elements)
 *
 * @example
 * // Use with take for finite portions of infinite sequences
 * count(take(5, iterate(x => x + 1, 0)))  // → 5
 */
export function count(coll) {
  // Nil → 0
  if (coll == null) return 0;

  // Array/string: O(1) via .length
  if (Array.isArray(coll) || typeof coll === "string") {
    return coll.length;
  }

  // Set/Map: O(1) via .size
  if (coll instanceof Set || coll instanceof Map) {
    return coll.size;
  }

  // LazySeq: FORCE FULL REALIZATION (eager!)
  if (coll instanceof LazySeq) {
    coll._realize(Infinity); // Realize all elements
    return coll._realized.length;
  }

  // Generic iterable: iterate and count O(n)
  let n = 0;
  for (const _ of coll) {
    n++;
  }
  return n;
}

/**
 * Returns the second element of a collection
 *
 * Shorthand for nth(coll, 1, null).
 * Returns null if collection has fewer than 2 elements.
 *
 * Lazy: Realizes only up to 2 elements for LazySeq.
 *
 * @param {Iterable|null|undefined} coll - Collection to access
 * @returns {*} Second element, or null if not present
 *
 * @example
 * second([1, 2, 3])  // → 2
 * second([1])        // → null
 * second([])         // → null
 * second(null)       // → null
 *
 * @example
 * // Works with strings
 * second("hello")  // → "e"
 * second("a")      // → null
 */
export function second(coll) {
  return nth(coll, 1, null);
}

/**
 * Returns the last element of a collection
 *
 * EAGER: Forces full realization of lazy sequences.
 * For arrays and strings, uses O(1) indexed access.
 * For iterables, iterates to the end.
 *
 * @param {Iterable|null|undefined} coll - Collection to access
 * @returns {*} Last element, or null if empty/nil
 *
 * @example
 * last([1, 2, 3])  // → 3
 * last([42])       // → 42
 * last([])         // → null
 * last(null)       // → null
 *
 * @example
 * // Works with strings
 * last("hello")  // → "o"
 * last("")       // → null
 *
 * @example
 * // Forces full realization (EAGER!)
 * const lazy = map(x => x * 2, [1, 2, 3]);
 * last(lazy)  // → 6 (realizes all elements)
 *
 * @example
 * // Use with take for finite portions of infinite sequences
 * last(take(5, iterate(x => x + 1, 0)))  // → 4
 */
export function last(coll) {
  // Nil → null
  if (coll == null) return null;

  // Array fast path: O(1) direct access to last index
  if (Array.isArray(coll)) {
    return coll.length > 0 ? coll[coll.length - 1] : null;
  }

  // String fast path: O(1) character access
  if (typeof coll === "string") {
    return coll.length > 0 ? coll[coll.length - 1] : null;
  }

  // LazySeq: force full realization (eager!)
  if (coll instanceof LazySeq) {
    coll._realize(Infinity); // Realize all elements
    return coll._realized.length > 0
      ? coll._realized[coll._realized.length - 1]
      : null;
  }

  // Generic iterable: iterate to end, remember last item
  let lastItem = null;
  for (const item of coll) {
    lastItem = item;
  }
  return lastItem;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEQUENCE PREDICATES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Tests if collection is empty
 *
 * Uses the internal normalize() helper for DRY - all empty-checking logic
 * is centralized in one place.
 *
 * @param {*} coll - Collection to test
 * @returns {boolean} True if empty, false otherwise
 *
 * @example
 * isEmpty([])       // → true
 * isEmpty([1,2])    // → false
 * isEmpty(null)     // → true
 * isEmpty("")       // → true
 * isEmpty(lazySeq(function* () {})) // → true
 */
export function isEmpty(coll) {
  return normalize(coll) === null;
}

/**
 * Returns the first item where predicate returns truthy value, else null
 *
 * Note: This returns the ITEM itself (JavaScript idiom), not the predicate result.
 * Differs from Clojure's `some` which returns pred(item).
 * For Clojure-compatible behavior, use: first(filter(pred, coll))
 *
 * @param {Function} pred - Predicate function
 * @param {Iterable|null|undefined} coll - Collection to search
 * @returns {*} First item where pred(item) is truthy, or null
 *
 * @example
 * some(x => x > 5, [1,2,6,3])     // → 6 (first item where x > 5)
 * some(x => x > 10, [1,2,3])      // → null (no match)
 * some(x => x === 5, [1,2,5,6])   // → 5 (found item)
 */
export function some(pred, coll) {
  validateFunction(pred, "some", "predicate");

  if (coll == null) return null;

  // Array fast path: indexed iteration (2-3x faster)
  if (Array.isArray(coll)) {
    for (let i = 0; i < coll.length; i++) {
      if (pred(coll[i])) {
        return coll[i];
      }
    }
    return null;
  }

  // Generic path for other iterables
  for (const item of coll) {
    if (pred(item)) {
      return item;
    }
  }
  return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEQUENCE OPERATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Takes first n elements from a collection
 * Returns a LazySeq (lazy evaluation)
 *
 * @param {number} n - Number of elements to take
 * @param {Iterable|null|undefined} coll - Collection to take from
 * @returns {LazySeq} Lazy sequence of first n elements
 *
 * @example
 * take(3, [1,2,3,4,5])  // → [1,2,3]
 * take(10, [1,2,3])     // → [1,2,3]
 */
export function take(n, coll) {
  validateNonNegativeNumber(n, "take");

  if (coll == null) {
    return EMPTY_LAZY_SEQ;
  }

  // Array fast path: indexed iteration (2-3x faster + no counter)
  if (Array.isArray(coll)) {
    const limit = Math.min(n, coll.length);
    if (limit === 0) return EMPTY_LAZY_SEQ;
    return lazySeq(function* () {
      for (let i = 0; i < limit; i++) {
        yield coll[i];
      }
    });
  }

  // Generic path for other iterables
  return lazySeq(function* () {
    let count = 0;
    const iterator = coll[Symbol.iterator]();
    while (count < n) {
      const { value, done } = iterator.next();
      if (done) break;
      yield value;
      count++;
    }
  });
}

/**
 * Drops first n elements from a collection
 * Returns a LazySeq (lazy evaluation)
 *
 * @param {number} n - Number of elements to drop
 * @param {Iterable|null|undefined} coll - Collection to drop from
 * @returns {LazySeq} Lazy sequence without first n elements
 */
export function drop(n, coll) {
  validateNonNegativeNumber(n, "drop");

  if (coll == null) {
    return EMPTY_LAZY_SEQ;
  }

  // Array fast path: indexed iteration (2-3x faster + no counter)
  if (Array.isArray(coll)) {
    if (n >= coll.length) return EMPTY_LAZY_SEQ;
    return lazySeq(function* () {
      for (let i = n; i < coll.length; i++) {
        yield coll[i];
      }
    });
  }

  // Generic path for other iterables
  return lazySeq(function* () {
    let count = 0;
    for (const item of coll) {
      if (count >= n) {
        yield item;
      }
      count++;
    }
  });
}

/**
 * Maps function over collection (lazy)
 *
 * @param {Function} f - Function to map
 * @param {Iterable|null|undefined} coll - Collection to map over
 * @returns {LazySeq} Lazy sequence of mapped values
 */
export function map(f, coll) {
  validateFunction(f, "map");

  if (coll == null) {
    return EMPTY_LAZY_SEQ;
  }

  // Array fast path: indexed iteration (2-3x faster)
  if (Array.isArray(coll)) {
    return lazySeq(function* () {
      for (let i = 0; i < coll.length; i++) {
        yield f(coll[i]);
      }
    });
  }

  // Generic path for other iterables
  return lazySeq(function* () {
    for (const item of coll) {
      yield f(item);
    }
  });
}

/**
 * Filters collection with predicate (lazy)
 *
 * @param {Function} pred - Predicate function
 * @param {Iterable|null|undefined} coll - Collection to filter
 * @returns {LazySeq} Lazy sequence of elements that satisfy predicate
 */
export function filter(pred, coll) {
  validateFunction(pred, "filter", "predicate");

  if (coll == null) {
    return EMPTY_LAZY_SEQ;
  }

  // Array fast path: indexed iteration (2-3x faster)
  if (Array.isArray(coll)) {
    return lazySeq(function* () {
      for (let i = 0; i < coll.length; i++) {
        if (pred(coll[i])) {
          yield coll[i];
        }
      }
    });
  }

  // Generic path for other iterables
  return lazySeq(function* () {
    for (const item of coll) {
      if (pred(item)) {
        yield item;
      }
    }
  });
}

/**
 * Reduces collection with function and initial value (EAGER)
 *
 * @param {Function} f - Reducer function
 * @param {*} init - Initial value
 * @param {Iterable|null|undefined} coll - Collection to reduce
 * @returns {*} Reduced value
 */
export function reduce(f, init, coll) {
  validateFunction(f, "reduce", "reducer");

  if (coll == null) return init;

  // Array fast path: indexed iteration (2-3x faster)
  if (Array.isArray(coll)) {
    let acc = init;
    for (let i = 0; i < coll.length; i++) {
      acc = f(acc, coll[i]);
    }
    return acc;
  }

  // Generic path for other iterables
  let acc = init;
  for (const item of coll) {
    acc = f(acc, item);
  }
  return acc;
}

/**
 * Concatenates multiple collections (lazy)
 *
 * @param {...Iterable} colls - Collections to concatenate
 * @returns {LazySeq} Lazy sequence of all elements
 */
export function concat(...colls) {
  return lazySeq(function* () {
    for (const coll of colls) {
      if (coll != null) {
        for (const item of coll) {
          yield item;
        }
      }
    }
  });
}

/**
 * Flattens nested collections one level (lazy)
 *
 * @param {Iterable|null|undefined} coll - Collection to flatten
 * @returns {LazySeq} Lazy sequence of flattened elements
 */
export function flatten(coll) {
  if (coll == null) {
    return EMPTY_LAZY_SEQ;
  }

  return lazySeq(function* flattenGenerator(currentColl = coll) {
    for (const item of currentColl) {
      // ✅ Recursively flatten any iterable (Array, LazySeq, Set, Map, etc.)
      // BUT exclude strings (strings are iterable but shouldn't be flattened)
      if (
        item != null &&
        typeof item !== "string" &&
        typeof item[Symbol.iterator] === "function"
      ) {
        // Recursive delegation to the same generator logic
        yield* flattenGenerator(item);
      } else {
        yield item;
      }
    }
  });
}

/**
 * Removes duplicate elements (lazy)
 *
 * @param {Iterable|null|undefined} coll - Collection to remove duplicates from
 * @returns {LazySeq} Lazy sequence with unique elements
 */
export function distinct(coll) {
  if (coll == null) {
    return EMPTY_LAZY_SEQ;
  }

  return lazySeq(function* () {
    const seen = new Set();
    for (const item of coll) {
      if (!seen.has(item)) {
        seen.add(item);
        yield item;
      }
    }
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAP OPERATIONS (Week 2)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Maps function over collection with index as second parameter
 *
 * Like map, but the mapping function receives (index, item) instead of just item.
 * Index is zero-based and increments for each element.
 *
 * Lazy: Returns lazy sequence that realizes elements on demand.
 *
 * @param {Function} f - Mapping function (index, item) → transformed_value
 * @param {Iterable|null|undefined} coll - Collection to map over
 * @returns {LazySeq} Lazy sequence of transformed values
 * @throws {TypeError} If f is not a function
 *
 * @example
 * mapIndexed((i, x) => [i, x], [10, 20, 30])
 * // → [[0, 10], [1, 20], [2, 30]]
 *
 * @example
 * // Use index in transformation
 * mapIndexed((i, x) => x * i, [10, 20, 30])
 * // → [0, 20, 60]
 *
 * @example
 * // Works with strings
 * mapIndexed((i, c) => c.repeat(i + 1), "abc")
 * // → ["a", "bb", "ccc"]
 */
export function mapIndexed(f, coll) {
  validateFunction(f, "mapIndexed", "indexing function");

  if (coll == null) return EMPTY_LAZY_SEQ;

  // Array fast path: indexed iteration
  if (Array.isArray(coll)) {
    return lazySeq(function* () {
      for (let i = 0; i < coll.length; i++) {
        yield f(i, coll[i]);
      }
    });
  }

  // Generic iterable: for...of with counter
  return lazySeq(function* () {
    let i = 0;
    for (const item of coll) {
      yield f(i, item);
      i++;
    }
  });
}

/**
 * Like mapIndexed, but filters out nil/undefined results
 *
 * Maps function over collection with index, keeping only non-nil results.
 * Only null and undefined are filtered - all other falsy values (0, false, "") are kept.
 *
 * Lazy: Returns lazy sequence that realizes elements on demand.
 *
 * @param {Function} f - Indexing function (index, item) → value_or_nil
 * @param {Iterable|null|undefined} coll - Collection to process
 * @returns {LazySeq} Lazy sequence with nil results filtered
 * @throws {TypeError} If f is not a function
 *
 * @example
 * // Keep elements at even indices
 * keepIndexed((i, x) => i % 2 === 0 ? x : null, ['a', 'b', 'c', 'd'])
 * // → ['a', 'c']
 *
 * @example
 * // Return indices where value > 5
 * keepIndexed((i, x) => x > 5 ? i : null, [1, 8, 3, 9])
 * // → [1, 3]
 *
 * @example
 * // Falsy values (except nil) are kept
 * keepIndexed(() => 0, [1, 2, 3])
 * // → [0, 0, 0]
 */
export function keepIndexed(f, coll) {
  validateFunction(f, "keepIndexed", "indexing function");

  if (coll == null) return EMPTY_LAZY_SEQ;

  // Array fast path
  if (Array.isArray(coll)) {
    return lazySeq(function* () {
      for (let i = 0; i < coll.length; i++) {
        const result = f(i, coll[i]);
        if (result != null) { // ✅ Only filter null/undefined
          yield result;
        }
      }
    });
  }

  // Generic iterable
  return lazySeq(function* () {
    let i = 0;
    for (const item of coll) {
      const result = f(i, item);
      if (result != null) { // ✅ Only filter null/undefined
        yield result;
      }
      i++;
    }
  });
}

/**
 * Maps function over collection and flattens results one level
 *
 * Also known as flatMap. Equivalent to flatten(map(f, coll)) but more efficient.
 * Each result must be iterable (or nil for empty).
 *
 * Lazy: Returns lazy sequence that realizes elements on demand.
 *
 * @param {Function} f - Mapping function item → iterable
 * @param {Iterable|null|undefined} coll - Collection to map over
 * @returns {LazySeq} Lazy sequence of flattened results
 * @throws {TypeError} If f is not a function or returns non-iterable
 *
 * @example
 * // Expand each element
 * mapcat(x => [x, x * 2], [1, 2, 3])
 * // → [1, 2, 2, 4, 3, 6]
 *
 * @example
 * // Variable length results
 * mapcat(x => Array(x).fill(x), [1, 2, 3])
 * // → [1, 2, 2, 3, 3, 3]
 *
 * @example
 * // Reverse nested arrays
 * mapcat(arr => arr.reverse(), [[3,2,1], [6,5,4]])
 * // → [1, 2, 3, 4, 5, 6]
 */
export function mapcat(f, coll) {
  validateFunction(f, "mapcat", "mapping function");

  if (coll == null) return EMPTY_LAZY_SEQ;

  // Implement directly (not via flatten) to handle strings properly
  return lazySeq(function* () {
    for (const item of coll) {
      const result = f(item);

      // Nil/undefined → skip
      if (result == null) continue;

      // Must be iterable
      if (typeof result[Symbol.iterator] !== "function") {
        throw new TypeError(
          `mapcat: mapping function must return iterable, got ${typeof result}`,
        );
      }

      // Yield all items from result (including string characters!)
      for (const nested of result) {
        yield nested;
      }
    }
  });
}

/**
 * Maps function over collection, filtering out nil/undefined results
 *
 * Like keepIndexed but without the index parameter.
 * Only null and undefined are filtered - all other falsy values (0, false, "") are kept.
 *
 * Lazy: Returns lazy sequence that realizes elements on demand.
 *
 * @param {Function} f - Mapping function item → value_or_nil
 * @param {Iterable|null|undefined} coll - Collection to process
 * @returns {LazySeq} Lazy sequence with nil results filtered
 * @throws {TypeError} If f is not a function
 *
 * @example
 * // Keep even numbers
 * keep(x => x % 2 === 0 ? x : null, [1, 2, 3, 4])
 * // → [2, 4]
 *
 * @example
 * // Transform and filter
 * keep(x => x > 2 ? x * 2 : null, [1, 2, 3, 4])
 * // → [6, 8]
 *
 * @example
 * // identity filters nil but keeps other falsy values
 * keep(x => x, [1, null, 2, false, 3])
 * // → [1, 2, false, 3]
 */
export function keep(f, coll) {
  validateFunction(f, "keep", "mapping function");

  if (coll == null) return EMPTY_LAZY_SEQ;

  // Array fast path
  if (Array.isArray(coll)) {
    return lazySeq(function* () {
      for (let i = 0; i < coll.length; i++) {
        const result = f(coll[i]);
        if (result != null) { // ✅ Only filter null/undefined
          yield result;
        }
      }
    });
  }

  // Generic iterable
  return lazySeq(function* () {
    for (const item of coll) {
      const result = f(item);
      if (result != null) { // ✅ Only filter null/undefined
        yield result;
      }
    }
  });
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

/**
 * Returns lazy sequence of x, f(x), f(f(x)), etc.
 * Infinite sequence by default
 *
 * @param {Function} f - Function to iterate
 * @param {*} x - Initial value
 * @returns {LazySeq} Infinite lazy sequence
 *
 * @example
 * iterate(x => x * 2, 1)  // → [1, 2, 4, 8, 16, 32, ...]
 * take(5, iterate(x => x + 1, 0))  // → [0, 1, 2, 3, 4]
 */
export function iterate(f, x) {
  validateFunction(f, "iterate", "iterator function");

  return lazySeq(function* () {
    let current = x;
    while (true) {
      yield current;
      current = f(current);
    }
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FUNCTION OPERATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Composes functions right-to-left
 * comp(f, g, h)(x) === f(g(h(x)))
 *
 * @param {...Function} fns - Functions to compose
 * @returns {Function} Composed function
 *
 * @example
 * const f = comp(x => x * 2, x => x + 1)
 * f(5)  // → 12  (5+1=6, 6*2=12)
 */
export function comp(...fns) {
  // Validate all arguments are functions
  fns.forEach((fn, i) => {
    validateFunction(fn, "comp", `argument ${i + 1}`);
  });

  if (fns.length === 0) {
    return (x) => x; // identity
  }

  if (fns.length === 1) {
    return fns[0];
  }

  return function (...args) {
    // Apply rightmost function first
    let result = fns[fns.length - 1](...args);
    // Then apply each function right-to-left
    for (let i = fns.length - 2; i >= 0; i--) {
      result = fns[i](result);
    }
    return result;
  };
}

/**
 * Partial application - returns function with some arguments pre-filled
 *
 * @param {Function} f - Function to partially apply
 * @param {...*} args - Arguments to pre-fill
 * @returns {Function} Partially applied function
 *
 * @example
 * const add5 = partial((a, b) => a + b, 5)
 * add5(10)  // → 15
 */
export function partial(f, ...args) {
  validateFunction(f, "partial", "function");

  return function (...moreArgs) {
    return f(...args, ...moreArgs);
  };
}

/**
 * Applies function to array or iterable of arguments
 *
 * @param {Function} f - Function to apply
 * @param {Iterable|null|undefined} args - Array or iterable of arguments
 * @returns {*} Result of function application
 *
 * @example
 * apply((a,b,c) => a+b+c, [1,2,3])  // → 6
 * apply(Math.max, [1,5,3,2])        // → 5
 * apply(Math.max, take(5, range())) // → 4 (works with LazySeq)
 * apply(Math.max, new Set([1,5,3])) // → 5 (works with Set)
 */
export function apply(f, args) {
  validateFunction(f, "apply", "function");

  // Accept any iterable, not just arrays
  if (args == null || typeof args[Symbol.iterator] !== "function") {
    throw new TypeError(
      `apply: second argument must be iterable, got ${typeof args}`,
    );
  }

  // Convert to array if needed (efficient for arrays, works for all iterables)
  const argsArray = Array.isArray(args) ? args : Array.from(args);
  return f(...argsArray);
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
 * Gets keys from an object
 *
 * @param {Object|null|undefined} obj - Object to get keys from
 * @returns {Array} Array of keys
 */
export function keys(obj) {
  if (obj == null) return [];
  return Object.keys(obj);
}

/**
 * Forces full evaluation of lazy sequence
 *
 * Matches Clojure semantics: "force realization", not "copy".
 * Returns arrays as-is (O(1)), not copied (O(n)).
 *
 * @param {Iterable|null|undefined} coll - Collection to realize
 * @returns {Array} Fully realized array
 */
export function doall(coll) {
  if (coll == null) return [];
  // Array fast path: Already realized, return as-is (O(1) - 100x faster!)
  // Matches Clojure: doall returns same reference for realized collections
  if (Array.isArray(coll)) return coll;
  return Array.from(coll);
}

/**
 * Checks if a LazySeq has been fully realized
 *
 * @param {*} coll - Collection to check
 * @returns {boolean} True if fully realized
 */
export function realized(coll) {
  if (coll == null) return true;
  if (coll instanceof LazySeq) {
    return coll._exhausted;
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

  // LazySeq: pass through directly (don't check isEmpty - that would realize it!)
  // Empty LazySeqs will be handled by consumers
  if (coll instanceof LazySeq) {
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

  // Plain object: check if empty, yield [key, value] entries
  if (typeof coll === "object") {
    const entries = Object.entries(coll);
    return entries.length === 0 ? null : lazySeq(function* () {
      for (const entry of entries) yield entry;
    });
  }

  throw new TypeError(`seq: Cannot create sequence from ${typeof coll}`);
}

/**
 * Return an empty collection of the same type as input
 *
 * Returns fresh instances (non-destructive).
 * Preserves collection type: array → array, Set → Set, etc.
 *
 * @param {*} coll - Collection to get empty instance of
 * @returns {*} Empty collection of same type
 *
 * @example
 * empty([1, 2, 3])           // => []
 * empty("abc")               // => ""
 * empty(new Set([1, 2]))     // => new Set()
 * empty(new Map([[1,2]]))    // => new Map()
 * empty({a: 1, b: 2})        // => {}
 * empty(null)                // => null
 */
export function empty(coll) {
  // Nil → null
  if (coll == null) return null;

  // Array → fresh empty array
  if (Array.isArray(coll)) return [];

  // String → empty string
  if (typeof coll === "string") return "";

  // LazySeq → empty LazySeq
  if (coll instanceof LazySeq) return EMPTY_LAZY_SEQ;

  // Set → new empty Set
  if (coll instanceof Set) return new Set();

  // Map → new empty Map
  if (coll instanceof Map) return new Map();

  // Plain object → fresh empty object
  if (typeof coll === "object") return {};

  throw new TypeError(`Cannot create empty collection from ${typeof coll}`);
}

/**
 * Add one or more items to a collection, preserving type
 *
 * Non-destructive: returns NEW collection with items added.
 * Arrays add to end. LazySeqs prepend to front (O(1)).
 *
 * @param {*} coll - Collection to add items to (can be null)
 * @param {...*} items - Items to add
 * @returns {*} New collection with items added
 *
 * @example
 * conj([1, 2], 3)                    // => [1, 2, 3]
 * conj([1, 2], 3, 4)                 // => [1, 2, 3, 4]
 * conj(new Set([1, 2]), 3)           // => Set{1, 2, 3}
 * conj(new Map([[1,2]]), [3, 4])    // => Map{1=>2, 3=>4}
 * conj({a: 1}, ["b", 2])             // => {a: 1, b: 2}
 * conj("ab", "c", "d")               // => "abcd"
 * conj(null, 1)                      // => [1]
 */
export function conj(coll, ...items) {
  // No items → return collection unchanged
  if (items.length === 0) {
    return coll == null ? [] : coll;
  }

  // Nil → create array
  if (coll == null) {
    return [...items];
  }

  // Array → spread and append
  if (Array.isArray(coll)) {
    return [...coll, ...items];
  }

  // String → concatenate
  if (typeof coll === "string") {
    return coll + items.join("");
  }

  // LazySeq → prepend items (cons each item to front)
  if (coll instanceof LazySeq) {
    // Prepend each item in reverse order to maintain order
    let result = coll;
    for (let i = items.length - 1; i >= 0; i--) {
      result = cons(items[i], result);
    }
    return result;
  }

  // Set → add items
  if (coll instanceof Set) {
    const result = new Set(coll);
    for (const item of items) {
      result.add(item);
    }
    return result;
  }

  // Map → add [key, value] pairs
  if (coll instanceof Map) {
    const result = new Map(coll);
    for (const item of items) {
      if (!Array.isArray(item) || item.length !== 2) {
        throw new TypeError(
          `Map entries must be [key, value] pairs, got ${typeof item}`,
        );
      }
      result.set(item[0], item[1]);
    }
    return result;
  }

  // Plain object → merge [key, value] pairs
  if (typeof coll === "object") {
    const result = { ...coll };
    for (const item of items) {
      if (!Array.isArray(item) || item.length !== 2) {
        throw new TypeError(
          `Object entries must be [key, value] pairs, got ${typeof item}`,
        );
      }
      result[item[0]] = item[1];
    }
    return result;
  }

  throw new TypeError(`Cannot conj to ${typeof coll}`);
}

/**
 * Pour all items from `from` collection into `to` collection
 *
 * Preserves type of `to` collection. Uses `conj` internally.
 * Non-destructive: returns NEW collection.
 *
 * @param {*} to - Target collection (can be null) (can be null)
 * @param {Iterable|null|undefined} from - Source collection to pour from
 * @returns {*} New collection with items from `from` added to `to`
 *
 * @example
 * into([], [1, 2, 3])                  // => [1, 2, 3]
 * into(new Set(), [1, 2, 2, 3])        // => Set{1, 2, 3}
 * into({}, [["a", 1], ["b", 2]])       // => {a: 1, b: 2}
 * into([1, 2], [3, 4])                 // => [1, 2, 3, 4]
 * into(null, [1, 2])                   // => [1, 2]
 */
export function into(to, from) {
  // Nil from → return to unchanged
  if (from == null) {
    return to == null ? [] : to;
  }

  // Use reduce to conj each item from `from` into `to`
  return reduce((acc, item) => conj(acc, item), to, from);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LAZY CONSTRUCTORS (Week 4)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Create an infinite lazy sequence of repeated value
 *
 * Returns the SAME reference every time (not copying).
 * Use with `take()` to realize finite portions.
 *
 * @param {*} x - Value to repeat infinitely
 * @returns {LazySeq} Infinite sequence of x
 *
 * @example
 * doall(take(3, repeat(5)))           // => [5, 5, 5]
 * doall(take(3, repeat({a: 1})))      // => [{a:1}, {a:1}, {a:1}] (same ref!)
 * doall(take(3, repeat(null)))        // => [null, null, null]
 */
export function repeat(x) {
  return lazySeq(function* () {
    while (true) {
      yield x;
    }
  });
}

/**
 * Create an infinite lazy sequence by calling function f repeatedly
 *
 * Function is called EACH TIME a value is realized (not cached).
 * Enables side effects and fresh object generation.
 *
 * @param {Function} f - Zero-arity function to call repeatedly
 * @returns {LazySeq} Infinite sequence of f() results
 *
 * @example
 * let counter = 0;
 * doall(take(3, repeatedly(() => counter++)))  // => [0, 1, 2]
 *
 * doall(take(3, repeatedly(() => ({id: 1}))))
 * // => [{id:1}, {id:1}, {id:1}] (fresh objects!)
 */
export function repeatedly(f) {
  validateFunction(f, "repeatedly", "generator function");

  return lazySeq(function* () {
    while (true) {
      yield f();
    }
  });
}

/**
 * Create an infinite lazy sequence by cycling through a collection
 *
 * Empty or nil collections return EMPTY_LAZY_SEQ (not infinite).
 * Collection is eagerly converted to array, then cycled infinitely.
 *
 * @param {Iterable|null|undefined} coll - Collection to cycle through
 * @returns {LazySeq} Infinite cycle through collection
 *
 * @example
 * doall(take(7, cycle([1, 2, 3])))     // => [1, 2, 3, 1, 2, 3, 1]
 * doall(take(4, cycle("ab")))          // => ["a", "b", "a", "b"]
 * cycle([])                            // => EMPTY_LAZY_SEQ
 * cycle(null)                          // => EMPTY_LAZY_SEQ
 */
export function cycle(coll) {
  // Empty/nil collection → empty sequence (NOT infinite)
  if (coll == null) return EMPTY_LAZY_SEQ;

  // Convert to array for cycling (eager realization required)
  // Note: Must realize here to cache for infinite cycling
  const items = Array.from(coll);
  if (items.length === 0) return EMPTY_LAZY_SEQ;

  return lazySeq(function* () {
    while (true) {
      for (const item of items) {
        yield item;
      }
    }
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEQUENCE PREDICATES (Week 5)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Returns true if predicate returns logical true for all items in collection
 *
 * Uses short-circuit evaluation - stops at first falsy result.
 * Empty collections return true (vacuous truth).
 *
 * @param {Function} pred - Predicate function to test each item
 * @param {Iterable|null|undefined} coll - Collection to test
 * @returns {boolean} True if all items match predicate
 *
 * @example
 * // All match
 * every(x => x % 2 === 0, [2, 4, 6])        // => true
 *
 * @example
 * // Some don't match
 * every(x => x % 2 === 0, [2, 3, 6])        // => false
 *
 * @example
 * // Empty collection (vacuous truth)
 * every(x => x > 1000, [])                   // => true
 *
 * @example
 * // Stops early on first falsy
 * let count = 0;
 * every(x => { count++; return x < 5; }, [1, 2, 3, 10, 4])
 * // count === 4 (stops at 10)
 */
export function every(pred, coll) {
  validateFunction(pred, "every", "predicate");

  if (coll == null) return true; // Vacuous truth for nil

  // Array fast path: indexed iteration (2-3x faster)
  if (Array.isArray(coll)) {
    for (let i = 0; i < coll.length; i++) {
      if (!pred(coll[i])) { // First falsy result
        return false;
      }
    }
    return true; // All passed
  }

  // Generic path for other iterables
  for (const item of coll) {
    if (!pred(item)) { // First falsy result
      return false;
    }
  }
  return true; // All passed
}

/**
 * Returns true if predicate returns logical false for all items
 *
 * Equivalent to (not (some pred coll)).
 * Uses short-circuit evaluation - stops at first truthy result.
 *
 * @param {Function} pred - Predicate function to test each item
 * @param {Iterable|null|undefined} coll - Collection to test
 * @returns {boolean} True if no items match predicate
 *
 * @example
 * // No items match
 * notAny(x => x % 2 === 0, [1, 3, 5])       // => true
 *
 * @example
 * // Some items match
 * notAny(x => x % 2 === 0, [1, 2, 5])       // => false
 *
 * @example
 * // Empty collection
 * notAny(x => x > 0, [])                     // => true
 *
 * @example
 * // Stops early on first truthy
 * let count = 0;
 * notAny(x => { count++; return x > 5; }, [1, 2, 3, 10, 4])
 * // count === 4 (stops at 10)
 */
export function notAny(pred, coll) {
  validateFunction(pred, "notAny", "predicate");

  if (coll == null) return true;

  // Array fast path: indexed iteration (2-3x faster)
  if (Array.isArray(coll)) {
    for (let i = 0; i < coll.length; i++) {
      if (pred(coll[i])) { // First truthy result
        return false;
      }
    }
    return true; // None passed
  }

  // Generic path for other iterables
  for (const item of coll) {
    if (pred(item)) { // First truthy result
      return false;
    }
  }
  return true; // None passed
}

/**
 * Returns true if predicate returns logical false for at least one item
 *
 * Equivalent to (not (every? pred coll)).
 * Uses short-circuit evaluation - stops at first falsy result.
 *
 * @param {Function} pred - Predicate function to test each item
 * @param {Iterable|null|undefined} coll - Collection to test
 * @returns {boolean} True if at least one item doesn't match predicate
 *
 * @example
 * // All match (returns false)
 * notEvery(x => x % 2 === 0, [2, 4, 6])     // => false
 *
 * @example
 * // Some don't match (returns true)
 * notEvery(x => x % 2 === 0, [2, 3, 6])     // => true
 *
 * @example
 * // Empty collection (not vacuous truth)
 * notEvery(x => x > 1000, [])                // => false
 *
 * @example
 * // Stops early on first falsy
 * let count = 0;
 * notEvery(x => { count++; return x < 5; }, [1, 2, 3, 10, 4])
 * // count === 4 (stops at 10)
 */
export function notEvery(pred, coll) {
  validateFunction(pred, "notEvery", "predicate");

  if (coll == null) return false; // not(every(pred, null)) = not(true) = false

  // Array fast path: indexed iteration (2-3x faster)
  if (Array.isArray(coll)) {
    for (let i = 0; i < coll.length; i++) {
      if (!pred(coll[i])) { // First falsy result
        return true;
      }
    }
    return false; // All passed, so NOT every is false
  }

  // Generic path for other iterables
  for (const item of coll) {
    if (!pred(item)) { // First falsy result
      return true;
    }
  }
  return false; // All passed, so NOT every is false
}

/**
 * Returns true if value is not null or undefined
 *
 * Note: This only checks for nil (null/undefined), not falsiness.
 * Values like 0, false, and "" return true.
 *
 * @param {*} x - Value to check
 * @returns {boolean} True if value is not null or undefined
 *
 * @example
 * // Nil values
 * isSome(null)           // => false
 * isSome(undefined)      // => false
 *
 * @example
 * // Falsy but not nil
 * isSome(0)              // => true
 * isSome(false)          // => true
 * isSome("")             // => true
 *
 * @example
 * // Truthy values
 * isSome([])             // => true
 * isSome({})             // => true
 * isSome("hello")        // => true
 */
export function isSome(x) {
  return x != null; // Checks both null and undefined
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WEEK 6: MAP/OBJECT OPERATIONS & TYPE CONVERSIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Returns value at key in map, or notFound if not present.
 * Works with both Map and Object. Nil-safe.
 *
 * @param {Object|Map|null|undefined} map - Map or object to access
 * @param {*} key - Key to look up
 * @param {*} [notFound=undefined] - Default value if key not found
 * @returns {*} Value at key, or notFound
 *
 * @example
 * get({a: 1, b: 2}, 'a')           // => 1
 * get({a: 1}, 'b', 'default')       // => 'default'
 * get(new Map([['x', 10]]), 'x')   // => 10
 * get(null, 'key', 'N/A')          // => 'N/A'
 *
 * @example
 * // Handles falsy values
 * get({a: 0}, 'a')                 // => 0
 * get({a: false}, 'a')             // => false
 */
export function get(map, key, notFound = undefined) {
  if (map == null) return notFound;

  if (map instanceof Map) {
    return map.has(key) ? map.get(key) : notFound;
  }

  // Works for both objects and arrays (numeric keys)
  return (key in map) ? map[key] : notFound;
}

/**
 * Returns value at nested path in map, or notFound if not present.
 * Short-circuits on first null/undefined in path.
 *
 * @param {Object|Map|null|undefined} map - Nested structure to access
 * @param {Array} path - Array of keys representing path
 * @param {*} [notFound=undefined] - Default value if path not found
 * @returns {*} Value at path, or notFound
 *
 * @example
 * getIn({user: {name: 'Alice'}}, ['user', 'name'])  // => 'Alice'
 * getIn({a: {b: {c: 3}}}, ['a', 'b', 'c'])          // => 3
 * getIn({user: null}, ['user', 'name'], 'N/A')      // => 'N/A'
 *
 * @example
 * // Works with arrays
 * getIn({items: ['a', 'b', 'c']}, ['items', 1])     // => 'b'
 */
export function getIn(map, path, notFound = undefined) {
  if (path.length === 0) return map;

  let current = map;
  for (const key of path) {
    current = get(current, key, null);
    if (current == null) return notFound;
  }
  return current;
}

/**
 * Returns new map with key mapped to value. Original unchanged.
 * Works with both Map and Object. O(n) shallow copy.
 *
 * @param {Object|Map|null|undefined} map - Map or object to update
 * @param {*} key - Key to set
 * @param {*} value - Value to associate with key
 * @returns {*} New map with key set to value
 *
 * @example
 * assoc({a: 1}, 'b', 2)                    // => {a: 1, b: 2}
 * assoc({a: 1}, 'a', 10)                   // => {a: 10}
 * assoc(new Map([['x', 1]]), 'y', 2)       // => Map{x: 1, y: 2}
 *
 * @example
 * // Immutability guaranteed
 * const orig = {a: 1};
 * const result = assoc(orig, 'b', 2);
 * // orig still {a: 1}, result is {a: 1, b: 2}
 */
export function assoc(map, key, value) {
  if (map == null) {
    // If key is numeric, create array; otherwise object
    if (typeof key === "number") {
      const arr = [];
      arr[key] = value;
      return arr;
    }
    return { [key]: value };
  }

  if (map instanceof Map) {
    const result = new Map(map);
    result.set(key, value);
    return result;
  }

  // Handle arrays
  if (Array.isArray(map)) {
    const result = [...map];
    result[key] = value;
    return result;
  }

  return { ...map, [key]: value };
}

/**
 * Returns new map with nested path set to value. Creates intermediate objects.
 * Infers structure: numeric key → array, string key → object.
 *
 * @param {Object|Map|null|undefined} map - Nested structure to update
 * @param {Array} path - Array of keys representing path
 * @param {*} value - Value to set at path
 * @returns {*} New structure with path updated
 *
 * @example
 * assocIn({user: {age: 30}}, ['user', 'age'], 31)
 * // => {user: {age: 31}}
 *
 * @example
 * // Creates missing paths
 * assocIn({}, ['user', 'name'], 'Alice')
 * // => {user: {name: 'Alice'}}
 *
 * @example
 * // Smart inference: numeric key creates array
 * assocIn({}, ['items', 0], 'first')
 * // => {items: ['first']}
 */
export function assocIn(map, path, value) {
  if (path.length === 0) return value;
  if (path.length === 1) return assoc(map, path[0], value);

  const [key, ...restPath] = path;
  const existing = get(map == null ? {} : map, key);

  let nested;
  if (existing != null && (typeof existing === "object")) {
    // Use existing object/array if it's already an object
    nested = existing;
  } else {
    // Create new structure or replace primitive values
    const nextKey = restPath[0];
    nested = (typeof nextKey === "number") ? [] : {};
  }

  return assoc(map == null ? {} : map, key, assocIn(nested, restPath, value));
}

/**
 * Returns new map without specified keys. Original unchanged.
 * Works with both Map and Object.
 *
 * @param {Object|Map|null|undefined} map - Map or object to update
 * @param {...*} keys - Keys to remove
 * @returns {*} New map without keys
 *
 * @example
 * dissoc({a: 1, b: 2, c: 3}, 'b')          // => {a: 1, c: 3}
 * dissoc({a: 1, b: 2, c: 3}, 'a', 'c')     // => {b: 2}
 *
 * @example
 * const m = new Map([['x', 1], ['y', 2]]);
 * dissoc(m, 'x')                           // => Map{y: 2}
 */
export function dissoc(map, ...keys) {
  if (map == null) return {};

  if (map instanceof Map) {
    const result = new Map(map);
    for (const key of keys) {
      result.delete(key);
    }
    return result;
  }

  // Handle arrays
  if (Array.isArray(map)) {
    const result = [...map];
    for (const key of keys) {
      delete result[key];
    }
    return result;
  }

  const result = { ...map };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

/**
 * Returns new map with value at key transformed by function.
 * Equivalent to: assoc(map, key, fn(get(map, key)))
 *
 * @param {Object|Map|null|undefined} map - Map or object to update
 * @param {*} key - Key to update
 * @param {Function} fn - Function to transform value
 * @returns {*} New map with transformed value
 *
 * @example
 * update({count: 5}, 'count', x => x + 1)
 * // => {count: 6}
 *
 * @example
 * update({name: 'alice'}, 'name', s => s.toUpperCase())
 * // => {name: 'ALICE'}
 *
 * @example
 * // Function receives undefined for missing key
 * update({a: 1}, 'b', x => (x || 0) + 10)
 * // => {a: 1, b: 10}
 */
export function update(map, key, fn) {
  validateFunction(fn, "update", "transform function");
  const currentValue = get(map, key);
  return assoc(map, key, fn(currentValue));
}

/**
 * Returns new map with value at nested path transformed by function.
 * Equivalent to: assocIn(map, path, fn(getIn(map, path)))
 *
 * @param {Object|Map|null|undefined} map - Nested structure to update
 * @param {Array} path - Array of keys representing path
 * @param {Function} fn - Function to transform value
 * @returns {*} New structure with transformed value
 *
 * @example
 * updateIn({user: {age: 30}}, ['user', 'age'], x => x + 1)
 * // => {user: {age: 31}}
 *
 * @example
 * const data = {items: [10, 20, 30]};
 * updateIn(data, ['items', 1], x => x * 2)
 * // => {items: [10, 40, 30]}
 */
export function updateIn(map, path, fn) {
  validateFunction(fn, "updateIn", "transform function");
  if (path.length === 0) return fn(map);

  const currentValue = getIn(map, path);
  return assocIn(map, path, fn(currentValue));
}

/**
 * Returns new map with all keys/values from all maps. Later values win.
 * Shallow merge. Works with both Map and Object.
 *
 * @param {...Object|Map|null|undefined} maps - Maps to merge (left to right)
 * @returns {*} New merged map
 *
 * @example
 * merge({a: 1}, {b: 2}, {c: 3})
 * // => {a: 1, b: 2, c: 3}
 *
 * @example
 * // Later values win
 * merge({a: 1, b: 2}, {b: 3, c: 4})
 * // => {a: 1, b: 3, c: 4}
 *
 * @example
 * // Nil maps ignored
 * merge({a: 1}, null, {b: 2})
 * // => {a: 1, b: 2}
 */
export function merge(...maps) {
  const nonNilMaps = maps.filter((m) => m != null);
  if (nonNilMaps.length === 0) return {};

  const firstMap = nonNilMaps[0];
  if (firstMap instanceof Map) {
    const result = new Map();
    for (const m of nonNilMaps) {
      if (m instanceof Map) {
        for (const [k, v] of m) {
          result.set(k, v);
        }
      }
    }
    return result;
  }

  return Object.assign({}, ...nonNilMaps);
}

/**
 * Converts any iterable to Array. ALWAYS returns new array (even if input is array).
 * Immutability guarantee: vec(arr) !== arr
 *
 * @param {Iterable|null|undefined} coll - Collection to convert
 * @returns {Array} New array with all elements
 *
 * @example
 * vec([1, 2, 3])                           // => [1, 2, 3] (NEW array)
 * vec(new Set([1, 2, 3]))                  // => [1, 2, 3]
 * vec("hello")                             // => ['h', 'e', 'l', 'l', 'o']
 *
 * @example
 * // Immutability safety
 * const orig = [1, 2, 3];
 * const copy = vec(orig);
 * copy !== orig                            // => true
 */
export function vec(coll) {
  if (coll == null) return [];
  return Array.from(coll); // Works for arrays too, creates new copy
}

/**
 * Converts any iterable to Set. ALWAYS returns new Set (even if input is Set).
 * Removes duplicates. Immutability guarantee: set(s) !== s
 *
 * @param {Iterable|null|undefined} coll - Collection to convert
 * @returns {Set} New Set with all unique elements
 *
 * @example
 * set([1, 2, 2, 3])                        // => Set{1, 2, 3}
 * set(new Set([1, 2, 3]))                  // => Set{1, 2, 3} (NEW Set)
 * set("hello")                             // => Set{'h', 'e', 'l', 'o'}
 *
 * @example
 * // Immutability safety
 * const orig = new Set([1, 2, 3]);
 * const copy = set(orig);
 * copy !== orig                            // => true
 */
export function set(coll) {
  if (coll == null) return new Set();
  return new Set(coll); // Works for Sets too, creates new copy
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PREDICATES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Check if value is null or undefined
 *
 * @param {*} x - Value to check
 * @returns {boolean} True if x is null or undefined
 *
 * @example
 * isNil(null)      // => true
 * isNil(undefined) // => true
 * isNil(0)         // => false
 * isNil("")        // => false
 * isNil(false)     // => false
 */
export function isNil(x) {
  return x == null;
}

/**
 * Check if a number is even.
 * @param {number} n - The number to check
 * @returns {boolean} True if n is even
 * @example
 * isEven(2)  // => true
 * isEven(3)  // => false
 * isEven(0)  // => true
 */
export function isEven(n) {
  return n % 2 === 0;
}

/**
 * Check if a number is odd.
 * @param {number} n - The number to check
 * @returns {boolean} True if n is odd
 * @example
 * isOdd(3)  // => true
 * isOdd(2)  // => false
 */
export function isOdd(n) {
  return n % 2 !== 0;
}

/**
 * Check if a number is zero.
 * @param {number} n - The number to check
 * @returns {boolean} True if n is 0
 * @example
 * isZero(0)  // => true
 * isZero(1)  // => false
 */
export function isZero(n) {
  return n === 0;
}

/**
 * Check if a number is positive (greater than zero).
 * @param {number} n - The number to check
 * @returns {boolean} True if n > 0
 * @example
 * isPositive(1)   // => true
 * isPositive(0)   // => false
 * isPositive(-1)  // => false
 */
export function isPositive(n) {
  return n > 0;
}

/**
 * Check if a number is negative (less than zero).
 * @param {number} n - The number to check
 * @returns {boolean} True if n < 0
 * @example
 * isNegative(-1)  // => true
 * isNegative(0)   // => false
 * isNegative(1)   // => false
 */
export function isNegative(n) {
  return n < 0;
}

/**
 * Check if value is a number.
 * @param {*} x - Value to check
 * @returns {boolean} True if x is a number
 */
export function isNumber(x) {
  return typeof x === "number";
}

/**
 * Check if value is a string.
 * @param {*} x - Value to check
 * @returns {boolean} True if x is a string
 */
export function isString(x) {
  return typeof x === "string";
}

/**
 * Check if value is a boolean.
 * @param {*} x - Value to check
 * @returns {boolean} True if x is a boolean
 */
export function isBoolean(x) {
  return typeof x === "boolean";
}

/**
 * Check if value is a function.
 * @param {*} x - Value to check
 * @returns {boolean} True if x is a function
 */
export function isFunction(x) {
  return typeof x === "function";
}

/**
 * Check if value is an array.
 * @param {*} x - Value to check
 * @returns {boolean} True if x is an array
 */
export function isArray(x) {
  return Array.isArray(x);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EQUALITY AND COMPARISON
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Clojure-style equality function
 *
 * Note: In HQL, the `=` operator is assignment (JS semantics).
 * Use `eq` or `==` for equality comparison.
 *
 * @param {...*} vals - Values to compare for equality
 * @returns {boolean} True if all values are equal, false otherwise
 *
 * @example
 * eq(1, 1)              // => true
 * eq(1, 2)              // => false
 * eq(1, 1, 1)           // => true (variadic)
 * eq([1, 2], [1, 2])    // => false (reference equality)
 * eq("a", "a")          // => true
 */
export function eq(...vals) {
  if (vals.length < 2) return true;
  const first = vals[0];
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] !== first) return false;
  }
  return true;
}

/**
 * Not-equal comparison (opposite of eq)
 *
 * @param {*} a - First value
 * @param {*} b - Second value
 * @returns {boolean} True if values are not equal
 *
 * @example
 * neq(1, 2)    // => true
 * neq(1, 1)    // => false
 */
export function neq(a, b) {
  return a !== b;
}

/**
 * Less-than comparison (first-class version)
 *
 * @param {...number} nums - Numbers to compare
 * @returns {boolean} True if each number is less than the next
 *
 * @example
 * lt(1, 2)        // => true
 * lt(1, 2, 3)     // => true
 * lt(1, 3, 2)     // => false
 */
export function lt(...nums) {
  if (nums.length < 2) return true;
  for (let i = 0; i < nums.length - 1; i++) {
    if (!(nums[i] < nums[i + 1])) return false;
  }
  return true;
}

/**
 * Greater-than comparison (first-class version)
 *
 * @param {...number} nums - Numbers to compare
 * @returns {boolean} True if each number is greater than the next
 *
 * @example
 * gt(2, 1)        // => true
 * gt(3, 2, 1)     // => true
 * gt(2, 3, 1)     // => false
 */
export function gt(...nums) {
  if (nums.length < 2) return true;
  for (let i = 0; i < nums.length - 1; i++) {
    if (!(nums[i] > nums[i + 1])) return false;
  }
  return true;
}

/**
 * Less-than-or-equal comparison (first-class version)
 *
 * @param {...number} nums - Numbers to compare
 * @returns {boolean} True if each number is less than or equal to the next
 */
export function lte(...nums) {
  if (nums.length < 2) return true;
  for (let i = 0; i < nums.length - 1; i++) {
    if (!(nums[i] <= nums[i + 1])) return false;
  }
  return true;
}

/**
 * Greater-than-or-equal comparison (first-class version)
 *
 * @param {...number} nums - Numbers to compare
 * @returns {boolean} True if each number is greater than or equal to the next
 */
export function gte(...nums) {
  if (nums.length < 2) return true;
  for (let i = 0; i < nums.length - 1; i++) {
    if (!(nums[i] >= nums[i + 1])) return false;
  }
  return true;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIRST-CLASS ARITHMETIC OPERATORS
// These allow operators to be used as values, e.g., (reduce add 0 [1 2 3])
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Variadic addition function (first-class version of + operator)
 *
 * @param {...number} nums - Numbers to add
 * @returns {number} Sum of all arguments, or 0 if no arguments
 *
 * @example
 * add()           // => 0
 * add(1)          // => 1
 * add(1, 2, 3)    // => 6
 * reduce(add, 0, [1, 2, 3, 4])  // => 10
 */
export function add(...nums) {
  if (nums.length === 0) return 0;
  if (nums.length === 1) return nums[0];
  return nums.reduce((a, b) => a + b, 0);
}

/**
 * Variadic subtraction function (first-class version of - operator)
 *
 * @param {...number} nums - Numbers to subtract
 * @returns {number} Result of subtraction, or 0 if no arguments
 *
 * @example
 * sub()           // => 0
 * sub(5)          // => -5 (negation)
 * sub(10, 3)      // => 7
 * sub(10, 3, 2)   // => 5
 */
export function sub(...nums) {
  if (nums.length === 0) return 0;
  if (nums.length === 1) return -nums[0];
  return nums.slice(1).reduce((a, b) => a - b, nums[0]);
}

/**
 * Variadic multiplication function (first-class version of * operator)
 *
 * @param {...number} nums - Numbers to multiply
 * @returns {number} Product of all arguments, or 1 if no arguments
 *
 * @example
 * mul()           // => 1
 * mul(5)          // => 5
 * mul(2, 3, 4)    // => 24
 * reduce(mul, 1, [1, 2, 3, 4])  // => 24
 */
export function mul(...nums) {
  if (nums.length === 0) return 1;
  if (nums.length === 1) return nums[0];
  return nums.reduce((a, b) => a * b, 1);
}

/**
 * Variadic division function (first-class version of / operator)
 *
 * @param {...number} nums - Numbers to divide
 * @returns {number} Result of division, or 1 if no arguments
 *
 * @example
 * div()           // => 1
 * div(5)          // => 0.2 (1/5)
 * div(12, 3)      // => 4
 * div(24, 2, 3)   // => 4
 */
export function div(...nums) {
  if (nums.length === 0) return 1;
  if (nums.length === 1) return 1 / nums[0];
  return nums.slice(1).reduce((a, b) => a / b, nums[0]);
}

/**
 * Modulo/remainder function (first-class version of % operator)
 *
 * @param {number} a - Dividend
 * @param {number} b - Divisor
 * @returns {number} Remainder of a / b
 *
 * @example
 * mod(10, 3)  // => 1
 * mod(7, 2)   // => 1
 */
export function mod(a, b) {
  return a % b;
}

/**
 * Increment by 1 (first-class function version)
 *
 * @param {number} x - Number to increment
 * @returns {number} x + 1
 *
 * @example
 * inc(5)      // => 6
 * map(inc, [1, 2, 3])  // => [2, 3, 4]
 */
export function inc(x) {
  return x + 1;
}

/**
 * Decrement by 1 (first-class function version)
 *
 * @param {number} x - Number to decrement
 * @returns {number} x - 1
 *
 * @example
 * dec(5)      // => 4
 * map(dec, [1, 2, 3])  // => [0, 1, 2]
 */
export function dec(x) {
  return x - 1;
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

/**
 * Reverses a collection
 * @example (reverse [1 2 3]) => [3 2 1]
 */
export function reverse(coll) {
  if (coll == null) return [];
  return [...coll].reverse();
}

/**
 * Creates a symbol from a string
 * In HQL runtime, symbols are strings (JavaScript)
 * @example (symbol "foo") => "foo"
 */
export function symbol(name) {
  return String(name);
}

/**
 * Creates a keyword from a string
 * Keywords are strings prefixed with ":"
 * @example (keyword "bar") => ":bar"
 */
export function keyword(name) {
  const s = String(name);
  return s.startsWith(":") ? s : ":" + s;
}

/**
 * Gets the name of a symbol or keyword (removes leading :)
 * @example (name :foo) => "foo"
 */
export function name(x) {
  if (typeof x !== "string") return null;
  return x.startsWith(":") ? x.slice(1) : x;
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
