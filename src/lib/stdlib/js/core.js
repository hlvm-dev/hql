// core.js - Bootstrap primitives and non-self-hosted functions
// Self-hosted functions are in self-hosted.js (transpiled from stdlib.hql)

import { EMPTY_LAZY_SEQ, LazySeq, lazySeq } from "./internal/lazy-seq.js";
import { normalize } from "./internal/normalize.js";
import { rangeCore } from "./internal/range-core.js";

// Import self-hosted functions used internally by core.js
import { reduce } from "./self-hosted.js";

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
// MAP/OBJECT OPERATIONS & TYPE CONVERSIONS
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
