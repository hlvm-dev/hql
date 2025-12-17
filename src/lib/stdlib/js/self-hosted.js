// self-hosted.js - Pre-transpiled HQL stdlib functions
// Source of truth: stdlib.hql - this JS is the bootstrap execution form

import { lazySeq, cons, SEQ } from "./internal/seq-protocol.js";
import { seq, first, rest } from "./core.js";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 1: CORE SEQUENCE OPERATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** take - Returns first n elements (lazy) */
export function take(n, coll) {
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
  return lazySeq(() => {
    let s = seq(coll);
    let remaining = n;
    while (s != null && remaining > 0) {
      s = seq(rest(s));  // Use seq() for proper nil-punning
      remaining--;
    }
    // Must return Cons structure for LazySeq protocol
    if (s != null) {
      return cons(first(s), drop(0, rest(s)));
    }
    return null;
  });
}

/** map - Maps function over collection (lazy) */
export function map(f, coll) {
  if (typeof f !== "function") {
    throw new TypeError("map: first argument must be a function, got " + typeof f);
  }
  return lazySeq(() => {
    const s = seq(coll);
    if (s != null) {
      return cons(f(first(s)), map(f, rest(s)));
    }
    return null;
  });
}

/** filter - Filters collection by predicate (lazy) */
export function filter(pred, coll) {
  if (typeof pred !== "function") {
    throw new TypeError("filter: predicate must be a function, got " + typeof pred);
  }
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

/** reduce - Reduces collection with function and initial value (EAGER) */
export function reduce(f, init, coll) {
  if (typeof f !== "function") {
    throw new TypeError("reduce: reducer must be a function, got " + typeof f);
  }
  let acc = init;
  let s = seq(coll);
  while (s != null) {
    acc = f(acc, first(s));
    s = seq(rest(s));
  }
  return acc;
}

/** concat - Concatenates multiple collections (lazy) - O(k) for k collections */
export function concat(...colls) {
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

/** distinct - Removes duplicate elements (lazy) - O(n) time */
export function distinct(coll) {
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
        xs = seq(rest(xs));
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
    s = seq(rest(s));
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
    s = seq(rest(s));
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
    s = seq(rest(s));
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
    s = seq(rest(s));
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
    s = seq(rest(s));
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
    s = seq(rest(s));
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
    s = seq(rest(s));
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 6: ARITHMETIC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function inc(x) { return x + 1; }
export function dec(x) { return x - 1; }

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

/** assoc - Associate key with value (returns new map) */
export function assoc(m, key, value) {
  if (m == null) {
    return typeof key === "number" ? ((() => { const a = []; a[key] = value; return a; })()) : { [key]: value };
  }
  if (m instanceof Map) { const r = new Map(m); r.set(key, value); return r; }
  if (Array.isArray(m)) { const r = [...m]; r[key] = value; return r; }
  return { ...m, [key]: value };
}

/** assocIn - Associate value at nested path */
export function assocIn(m, path, value) {
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
  if (path.length === 0) return fn(m);
  return assocIn(m, path, fn(getIn(m, path)));
}

/** merge - Merge multiple maps (later wins, shallow) */
export function merge(...maps) {
  const nonNil = maps.filter(m => m != null);
  if (nonNil.length === 0) return {};
  if (nonNil[0] instanceof Map) {
    const r = new Map();
    for (const m of nonNil) if (m instanceof Map) for (const [k, v] of m) r.set(k, v);
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
