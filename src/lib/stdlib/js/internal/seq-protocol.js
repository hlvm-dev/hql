// seq-protocol.js - Clojure-aligned Seq Protocol (Optimized)
//
// Design principles:
// - KISS: Minimal code, maximum clarity
// - DRY: No redundancy
// - Clojure-inspired: ISeq, Counted, Indexed protocols
// - JS-idiomatic: ESM exports, Symbol protocols, iterators
//
// Time complexity guarantees:
// - first/rest/seq: O(1) for all seq types
// - count: O(1) for Counted types, O(n) fallback
// - nth: O(1) for Indexed types, O(n) fallback
// - Trampolining: O(1) stack depth for any nesting level
//
// Reference: clojure/lang/{LazySeq,Cons,ArraySeq,RT}.java

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROTOCOLS (like Clojure's interfaces)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** ISeq protocol: first(), rest(), seq() */
export const SEQ = Symbol.for("hql.seq");

/** Counted protocol: count() returns O(1) */
export const COUNTED = Symbol.for("hql.counted");

/** Indexed protocol: nth(i) returns O(1) */
export const INDEXED = Symbol.for("hql.indexed");

/** Internal sentinel for distinguishing "not found" from undefined values */
const NOT_FOUND = Symbol("not-found");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EMPTY: Singleton empty sequence
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Singleton empty sequence (like Clojure's PersistentList.EMPTY).
 * Implements all protocols with O(1) operations.
 */
export const EMPTY = Object.freeze({
  [SEQ]: true,
  [COUNTED]: true,
  [INDEXED]: true,
  first() { return undefined; },
  rest() { return this; },
  seq() { return null; },
  count() { return 0; },
  nth() { return NOT_FOUND; },  // Always out of bounds
  *[Symbol.iterator]() {},
  toString() { return "()"; },
  [Symbol.for("Deno.customInspect")]() { return "EMPTY"; },
  [Symbol.for("nodejs.util.inspect.custom")]() { return "EMPTY"; },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONS: Immutable pair (like Clojure's Cons)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Cons - Immutable pair of (first, rest).
 *
 * Time complexity:
 * - first(): O(1)
 * - rest(): O(1)
 * - seq(): O(1)
 * - Iteration: O(n) with O(1) stack via trampolining
 */
export class Cons {
  constructor(first, rest) {
    this._first = first;
    this._rest = rest;
  }

  first() { return this._first; }
  rest() { return this._rest ?? EMPTY; }
  seq() { return this; } // Cons is never empty

  *[Symbol.iterator]() {
    let s = this;
    while (s && s !== EMPTY) {
      // Trampoline: unwrap LazySeq iteratively (O(1) stack)
      while (s instanceof LazySeq) s = s._realize();
      if (!s || s === EMPTY) break;

      // Yield from SEQ types
      if (s[SEQ]) {
        yield s.first();
        s = s.rest();
      } else {
        // Delegate to other iterables (arrays, etc.)
        yield* s;
        break;
      }
    }
  }

  toArray() { return [...this]; }

  toString() {
    const items = [];
    let i = 0;
    for (const x of this) {
      if (i++ > 20) { items.push("..."); break; }
      items.push(String(x));
    }
    return `(${items.join(" ")})`;
  }

  [Symbol.for("Deno.customInspect")]() { return this.toString(); }
  [Symbol.for("nodejs.util.inspect.custom")]() { return this.toString(); }
}
Cons.prototype[SEQ] = true;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LAZYSEQ: Deferred computation (like Clojure's LazySeq)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * LazySeq - Deferred sequence computation with memoization.
 *
 * Key features:
 * - Thunk called once, result cached (memoization)
 * - Trampolining: nested LazySeqs unwrapped iteratively (O(1) stack)
 * - Realizes to Cons or null, never array
 *
 * Time complexity:
 * - first()/rest()/seq(): O(1) after realization
 * - _realize(): O(k) where k = nesting depth, but O(1) stack
 */
export class LazySeq {
  constructor(thunk) {
    this._thunk = thunk;
    this._realized = null;
    this._isRealized = false;
  }

  /**
   * Realize with trampolining (like Clojure's sval + unwrap).
   * Unwraps nested LazySeqs iteratively to prevent stack overflow.
   */
  _realize() {
    if (this._isRealized) return this._realized;

    let result = this._thunk;
    this._thunk = null; // GC: release closure

    // Call thunk
    if (typeof result === "function") result = result();

    // TRAMPOLINE: unwrap nested LazySeqs iteratively
    while (result instanceof LazySeq && !result._isRealized) {
      const nested = result._thunk;
      result._thunk = null; // GC
      result = typeof nested === "function" ? nested() : nested;
    }

    // Get cached value from realized LazySeq
    if (result instanceof LazySeq) result = result._realized;

    this._realized = result;
    this._isRealized = true;
    return result;
  }

  first() { const s = this._realize(); return s ? s.first() : undefined; }
  rest() { const s = this._realize(); return s ? s.rest() : EMPTY; }
  seq() { const s = this._realize(); return s ? s.seq() : null; }

  *[Symbol.iterator]() {
    const s = this._realize();
    if (s) yield* s;
  }

  toString() { const s = this._realize(); return s ? s.toString() : "()"; }
  [Symbol.for("Deno.customInspect")]() { return `LazySeq(${this._isRealized ? this.toString() : "..."})`; }
  [Symbol.for("nodejs.util.inspect.custom")]() { return `LazySeq(${this._isRealized ? this.toString() : "..."})`; }
}
LazySeq.prototype[SEQ] = true;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ARRAYSEQ: Efficient array sequence (like Clojure's ArraySeq)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * ArraySeq - View into array with offset (like Clojure's ArraySeq).
 *
 * Design:
 * - Holds reference to original array + index
 * - O(1) first, rest, count, nth
 * - No object creation until rest() called
 *
 * Time complexity:
 * - first(): O(1)
 * - rest(): O(1) - creates new ArraySeq with index+1
 * - count(): O(1)
 * - nth(): O(1)
 */
export class ArraySeq {
  constructor(arr, index = 0) {
    this._arr = arr;
    this._i = index;
  }

  first() { return this._arr[this._i]; }

  rest() {
    return this._i + 1 < this._arr.length
      ? new ArraySeq(this._arr, this._i + 1)
      : EMPTY;
  }

  seq() { return this; } // ArraySeq is never empty (created only for non-empty)

  count() { return this._arr.length - this._i; }

  nth(n) {
    const idx = this._i + n;
    if (idx >= 0 && idx < this._arr.length) return this._arr[idx];
    return NOT_FOUND;
  }

  *[Symbol.iterator]() {
    for (let i = this._i; i < this._arr.length; i++) {
      yield this._arr[i];
    }
  }

  toString() {
    const items = this._arr.slice(this._i, this._i + 21);
    const str = items.map(String).join(" ");
    return this._arr.length - this._i > 20 ? `(${str} ...)` : `(${str})`;
  }

  [Symbol.for("Deno.customInspect")]() { return this.toString(); }
  [Symbol.for("nodejs.util.inspect.custom")]() { return this.toString(); }
}
ArraySeq.prototype[SEQ] = true;
ArraySeq.prototype[COUNTED] = true;
ArraySeq.prototype[INDEXED] = true;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ITERATOR SEQ: Wrap iterator as seq
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Create seq from iterator.
 * Returns Cons with lazy rest, or null if exhausted.
 */
function iteratorSeq(iter) {
  const { value, done } = iter.next();
  if (done) return null;
  return new Cons(value, new LazySeq(() => iteratorSeq(iter)));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PUBLIC API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Create lazy sequence from thunk. Thunk should return Cons or null. */
export function lazySeq(thunk) {
  return new LazySeq(thunk);
}

/** Create Cons cell. */
export function cons(first, rest) {
  return new Cons(first, rest);
}

/** Convert collection to seq. Returns null for empty (nil-punning). */
export function toSeq(coll) {
  if (coll == null) return null;
  if (coll[SEQ]) return coll.seq();
  if (Array.isArray(coll)) return coll.length > 0 ? new ArraySeq(coll, 0) : null;
  const iter = coll[Symbol.iterator]?.();
  return iter ? iteratorSeq(iter) : null;
}

/** Check if value implements SEQ protocol. */
export function isSeq(value) {
  return value != null && value[SEQ] === true;
}

/** Check if value is Cons. */
export function isCons(value) {
  return value instanceof Cons;
}

/** Check if value is LazySeq. */
export function isLazySeq(value) {
  return value instanceof LazySeq;
}

/** Check if value is ArraySeq. */
export function isArraySeq(value) {
  return value instanceof ArraySeq;
}

/** Check if value implements Counted protocol. */
export function isCounted(value) {
  return value != null && value[COUNTED] === true;
}

/** Check if value implements Indexed protocol. */
export function isIndexed(value) {
  return value != null && value[INDEXED] === true;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROTOCOL-AWARE HELPERS (for use in HQL stdlib)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * O(1) count for Counted types, O(n) fallback.
 */
export function count(coll) {
  if (coll == null) return 0;
  if (coll[COUNTED]) return coll.count();
  if (Array.isArray(coll)) return coll.length;
  if (typeof coll === "string") return coll.length;
  if (coll instanceof Set || coll instanceof Map) return coll.size;
  // O(n) fallback
  let n = 0;
  for (const _ of coll) n++;
  return n;
}

/**
 * O(1) nth for Indexed types, O(n) fallback.
 * Uses NOT_FOUND sentinel to correctly handle undefined values.
 */
export function nth(coll, index, notFound) {
  const hasNotFound = arguments.length >= 3;

  if (coll == null) {
    if (hasNotFound) return notFound;
    throw new RangeError(`Index ${index} out of bounds on null`);
  }

  // O(1) for Indexed (uses NOT_FOUND sentinel to distinguish undefined values)
  if (coll[INDEXED]) {
    const result = coll.nth(index);
    if (result === NOT_FOUND) {
      if (hasNotFound) return notFound;
      throw new RangeError(`Index ${index} out of bounds`);
    }
    return result;
  }

  // O(1) for arrays
  if (Array.isArray(coll)) {
    if (index >= 0 && index < coll.length) return coll[index];
    if (hasNotFound) return notFound;
    throw new RangeError(`Index ${index} out of bounds`);
  }

  // O(1) for strings
  if (typeof coll === "string") {
    if (index >= 0 && index < coll.length) return coll[index];
    if (hasNotFound) return notFound;
    throw new RangeError(`Index ${index} out of bounds`);
  }

  // O(n) fallback for seqs (also handles negative indices)
  if (index < 0) {
    if (hasNotFound) return notFound;
    throw new RangeError(`Index ${index} out of bounds`);
  }
  let s = coll[SEQ] ? coll : toSeq(coll);
  for (let i = 0; i < index && s && s !== EMPTY; i++) {
    s = s.rest();
  }
  if (s && s !== EMPTY && s.seq()) return s.first();
  if (hasNotFound) return notFound;
  throw new RangeError(`Index ${index} out of bounds`);
}
