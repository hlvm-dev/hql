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
 * Helper: Convert an iterator/generator to a Cons chain.
 * Used for backwards compatibility with generator-based LazySeq.
 */
function iteratorToConsChain(iter) {
  const { value, done } = iter.next();
  if (done) return null;
  // Create Cons with lazy rest (will be realized on demand)
  return new Cons(value, new LazySeq(() => iteratorToConsChain(iter)));
}

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
   * Also handles generator functions for backwards compatibility.
   */
  _realize() {
    if (this._isRealized) return this._realized;

    let result = this._thunk;
    this._thunk = null; // GC: release closure

    // Call thunk (or generator function)
    if (typeof result === "function") result = result();

    // BACKWARDS COMPAT: Handle generators (convert to Cons chain)
    if (result && typeof result[Symbol.iterator] === "function" && typeof result.next === "function") {
      // It's a generator/iterator - convert to Cons chain
      result = iteratorToConsChain(result);
    }

    // TRAMPOLINE: unwrap nested LazySeqs iteratively
    while (result instanceof LazySeq && !result._isRealized) {
      const nested = result._thunk;
      result._thunk = null; // GC
      result = typeof nested === "function" ? nested() : nested;
      // Handle generators in nested thunks too
      if (result && typeof result[Symbol.iterator] === "function" && typeof result.next === "function") {
        result = iteratorToConsChain(result);
      }
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

  toArray() { return this._arr.slice(this._i); }

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
// NUMERICRANGE: O(1) operations for numeric ranges
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * NumericRange - O(1) count/nth for numeric sequences.
 *
 * JS-native optimization: No chunking, just math.
 * Unlike Clojure's Range which chunks, this provides O(1) random access.
 *
 * Time complexity:
 * - count(): O(1)
 * - nth(): O(1)
 * - first(): O(1)
 * - rest(): O(1)
 */
export class NumericRange {
  constructor(start, end, step) {
    this._start = start;
    this._end = end;
    this._step = step;
    // Precompute length for O(1) count
    this._length = end === Infinity
      ? Infinity
      : Math.max(0, Math.ceil((end - start) / step));
  }

  // O(1) - Clojure's Range needs realization to count
  count() { return this._length; }

  // O(1) - Random access without realization
  nth(n) {
    if (n < 0 || n >= this._length) return NOT_FOUND;
    return this._start + n * this._step;
  }

  first() {
    return this._length > 0 ? this._start : undefined;
  }

  rest() {
    if (this._length <= 1) return EMPTY;
    return new NumericRange(this._start + this._step, this._end, this._step);
  }

  seq() {
    return this._length > 0 ? this : null;
  }

  // JS-native iteration
  *[Symbol.iterator]() {
    const { _start, _end, _step } = this;
    if (_step > 0) {
      for (let i = _start; i < _end; i += _step) yield i;
    } else {
      for (let i = _start; i > _end; i += _step) yield i;
    }
  }

  toArray() { return [...this]; }

  toString() {
    if (this._length === 0) return "()";
    if (this._length === Infinity) {
      const items = [];
      for (let i = 0; i < 10; i++) {
        items.push(this.nth(i));
      }
      return `(${items.join(" ")} ...)`;
    }
    const items = [];
    const max = Math.min(21, this._length);
    for (let i = 0; i < max; i++) {
      items.push(this.nth(i));
    }
    return this._length > 20 ? `(${items.join(" ")} ...)` : `(${items.join(" ")})`;
  }

  [Symbol.for("Deno.customInspect")]() { return this.toString(); }
  [Symbol.for("nodejs.util.inspect.custom")]() { return this.toString(); }
}
NumericRange.prototype[SEQ] = true;
NumericRange.prototype[COUNTED] = true;
NumericRange.prototype[INDEXED] = true;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DELAY: Memoized thunk for explicit laziness
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Delay - Memoized thunk (simpler than Clojure: no synchronization needed).
 *
 * Use for explicit lazy evaluation when you don't need a sequence,
 * just a deferred value that's computed once.
 *
 * JS is single-threaded, so no locking needed unlike Clojure.
 */
export class Delay {
  constructor(thunk) {
    this._thunk = thunk;
    this._value = undefined;
    this._realized = false;
  }

  deref() {
    if (!this._realized) {
      this._value = this._thunk();
      this._thunk = null; // GC
      this._realized = true;
    }
    return this._value;
  }

  isRealized() { return this._realized; }

  toString() {
    return this._realized
      ? `#<Delay: ${this._value}>`
      : "#<Delay: pending>";
  }

  [Symbol.for("Deno.customInspect")]() { return this.toString(); }
  [Symbol.for("nodejs.util.inspect.custom")]() { return this.toString(); }
}

/** Create a Delay from a thunk function. */
export function delay(thunk) {
  return new Delay(thunk);
}

/** Force evaluation of a Delay, or return value unchanged if not a Delay. */
export function force(x) {
  return x instanceof Delay ? x.deref() : x;
}

/** Check if value is a Delay. */
export function isDelay(x) {
  return x instanceof Delay;
}

/** Check if a Delay has been realized. */
export function isRealized(x) {
  return x instanceof Delay ? x._realized : true;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REDUCED: Early termination for transducers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Reduced - Wrapper to signal early termination in transducers.
 *
 * When a reducing function returns a Reduced value, the transduction
 * process should stop immediately and unwrap the inner value.
 *
 * This is essential for:
 * - take(n) transducer
 * - takeWhile(pred) transducer
 * - Any early termination scenario
 */
export class Reduced {
  constructor(val) {
    this._val = val;
  }

  deref() { return this._val; }

  toString() { return `#<Reduced: ${this._val}>`; }
  [Symbol.for("Deno.customInspect")]() { return this.toString(); }
  [Symbol.for("nodejs.util.inspect.custom")]() { return this.toString(); }
}

/** Wrap value as Reduced for early termination. */
export function reduced(x) {
  return new Reduced(x);
}

/** Check if value is Reduced. */
export function isReduced(x) {
  return x instanceof Reduced;
}

/** Unwrap Reduced to get inner value, or return unchanged if not Reduced. */
export function unreduced(x) {
  return isReduced(x) ? x._val : x;
}

/** Ensure value is Reduced. Returns x if already Reduced, otherwise wraps it. */
export function ensureReduced(x) {
  return isReduced(x) ? x : reduced(x);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TRANSDUCER PROTOCOL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Standard transducer protocol keys (JS ecosystem compatible).
 *
 * A transducer is a function that takes a reducing function (rf) and
 * returns a new reducing function. The reducing function has 3 arities:
 *
 * - @@transducer/init: () => initial accumulator
 * - @@transducer/step: (acc, input) => new accumulator (or Reduced)
 * - @@transducer/result: (acc) => final result
 */
export const TRANSDUCER_INIT = "@@transducer/init";
export const TRANSDUCER_STEP = "@@transducer/step";
export const TRANSDUCER_RESULT = "@@transducer/result";

/**
 * Convert a 2-arity function to a transformer object.
 * Used to wrap simple functions like `conj` for use with transducers.
 */
export function toTransformer(f) {
  if (typeof f[TRANSDUCER_STEP] === "function") {
    // Already a transformer
    return f;
  }
  return {
    [TRANSDUCER_INIT]: () => { throw new Error("No init function provided"); },
    [TRANSDUCER_STEP]: (acc, x) => f(acc, x),
    [TRANSDUCER_RESULT]: (acc) => acc,
  };
}

/**
 * Create a completing transformer from a base transformer.
 * Wraps the result function with a completion function.
 */
export function completing(f, cf) {
  const transform = toTransformer(f);
  return {
    [TRANSDUCER_INIT]: () => transform[TRANSDUCER_INIT](),
    [TRANSDUCER_STEP]: (acc, x) => transform[TRANSDUCER_STEP](acc, x),
    [TRANSDUCER_RESULT]: cf || ((acc) => acc),
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CHUNKED SEQUENCES (32-element buffers like Clojure)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Chunk size - matches Clojure's chunk size exactly */
export const CHUNK_SIZE = 32;

/** IChunkedSeq protocol: chunked iteration */
export const CHUNKED = Symbol.for("hql.chunked");

/**
 * ArrayChunk - Fixed-size immutable buffer (like Clojure's ArrayChunk).
 *
 * Holds up to 32 elements for amortized iteration.
 * Immutable: slicing returns new ArrayChunk.
 *
 * Time complexity:
 * - count(): O(1)
 * - nth(): O(1)
 * - reduce(): O(n) where n = chunk size
 */
export class ArrayChunk {
  constructor(arr, off = 0, end = arr.length) {
    this._arr = arr;
    this._off = off;
    this._end = end;
  }

  // IChunk interface
  count() { return this._end - this._off; }
  nth(i) {
    const idx = this._off + i;
    if (idx >= this._off && idx < this._end) return this._arr[idx];
    return NOT_FOUND;
  }
  first() { return this._arr[this._off]; }

  dropFirst() {
    if (this._off + 1 >= this._end) return null;
    return new ArrayChunk(this._arr, this._off + 1, this._end);
  }

  reduce(f, init) {
    let acc = init;
    for (let i = this._off; i < this._end; i++) {
      acc = f(acc, this._arr[i]);
      if (isReduced(acc)) return acc;
    }
    return acc;
  }

  *[Symbol.iterator]() {
    for (let i = this._off; i < this._end; i++) {
      yield this._arr[i];
    }
  }

  toArray() { return this._arr.slice(this._off, this._end); }

  toString() {
    return `ArrayChunk(${this.count()})`;
  }
  [Symbol.for("Deno.customInspect")]() { return this.toString(); }
  [Symbol.for("nodejs.util.inspect.custom")]() { return this.toString(); }
}
ArrayChunk.prototype[COUNTED] = true;
ArrayChunk.prototype[INDEXED] = true;

/**
 * ChunkBuffer - Mutable buffer for building chunks.
 *
 * Used internally when creating chunked sequences.
 * Call chunk() when full to get immutable ArrayChunk.
 */
export class ChunkBuffer {
  constructor(capacity = CHUNK_SIZE) {
    this._arr = new Array(capacity);
    this._end = 0;
  }

  add(val) {
    this._arr[this._end++] = val;
    return this;
  }

  count() { return this._end; }
  isFull() { return this._end >= this._arr.length; }

  chunk() {
    const c = new ArrayChunk(this._arr, 0, this._end);
    this._arr = null; // Prevent further modification
    return c;
  }
}

/**
 * ChunkedCons - Chunked sequence cell (like Clojure's ChunkedCons).
 *
 * Holds a chunk (ArrayChunk) and a lazy rest.
 * Enables batch processing for better performance.
 *
 * Time complexity:
 * - chunkFirst(): O(1)
 * - chunkRest(): O(1)
 * - first(): O(1)
 * - rest(): O(1) amortized
 */
export class ChunkedCons {
  constructor(chunk, rest) {
    this._chunk = chunk;
    this._rest = rest; // LazySeq or null
  }

  // IChunkedSeq interface
  chunkFirst() { return this._chunk; }
  chunkRest() { return this._rest ?? EMPTY; }

  // ISeq interface (unwraps chunk for element access)
  first() { return this._chunk.first(); }

  rest() {
    const dropped = this._chunk.dropFirst();
    if (dropped) {
      return new ChunkedCons(dropped, this._rest);
    }
    // Chunk exhausted, return rest
    const r = this._rest;
    if (!r || r === EMPTY) return EMPTY;
    // Trampoline through LazySeq
    if (r instanceof LazySeq) return r.rest();
    return r;
  }

  seq() { return this._chunk.count() > 0 ? this : null; }

  *[Symbol.iterator]() {
    // Yield all elements from chunk
    yield* this._chunk;
    // Then iterate rest
    const r = this._rest;
    if (r && r !== EMPTY) yield* r;
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
ChunkedCons.prototype[SEQ] = true;
ChunkedCons.prototype[CHUNKED] = true;

/** Create ChunkedCons from chunk and rest. */
export function chunkCons(chunk, rest) {
  return new ChunkedCons(chunk, rest);
}

/** Create ArrayChunk from array. */
export function arrayChunk(arr, off = 0, end = arr.length) {
  return new ArrayChunk(arr, off, end);
}

/** Check if value supports chunked iteration. */
export function isChunked(x) {
  return x != null && x[CHUNKED] === true;
}

/** Get first chunk from chunked seq. */
export function chunkFirst(s) {
  if (isChunked(s)) return s.chunkFirst();
  // Non-chunked: wrap single element as chunk
  const f = s.first?.();
  return f !== undefined ? new ArrayChunk([f], 0, 1) : null;
}

/** Get rest after first chunk. */
export function chunkRest(s) {
  if (isChunked(s)) return s.chunkRest();
  // Non-chunked: rest of seq
  return s.rest?.() ?? EMPTY;
}

/**
 * Create a chunked lazy sequence from a thunk.
 *
 * The thunk should return:
 * - null for empty
 * - ChunkedCons for chunked
 * - Any seq for unchunked
 */
export function chunkSeq(thunk) {
  return new LazySeq(thunk);
}

/**
 * Convert collection to chunked sequence if beneficial.
 *
 * Arrays are chunked (efficient for map/filter).
 * Other seqs pass through unchanged.
 */
export function toChunkedSeq(coll) {
  if (coll == null) return null;
  if (isChunked(coll)) return coll;

  // Arrays benefit from chunking
  if (Array.isArray(coll) && coll.length > 0) {
    return arrayToChunkedSeq(coll, 0);
  }

  // NumericRange: already O(1), but could chunk for map/filter
  if (coll instanceof NumericRange) {
    return rangeToChunkedSeq(coll);
  }

  // Other seqs: return as-is
  return toSeq(coll);
}

/** Convert array to chunked sequence. */
function arrayToChunkedSeq(arr, offset) {
  if (offset >= arr.length) return null;
  const end = Math.min(offset + CHUNK_SIZE, arr.length);
  const chunk = new ArrayChunk(arr, offset, end);
  return new ChunkedCons(
    chunk,
    new LazySeq(() => arrayToChunkedSeq(arr, end))
  );
}

/** Convert NumericRange to chunked sequence. */
function rangeToChunkedSeq(range) {
  if (range._length === 0) return null;

  const start = range._start;
  const end = range._end;
  const step = range._step;

  function makeChunk(from) {
    const chunkEnd = step > 0
      ? Math.min(from + CHUNK_SIZE * step, end)
      : Math.max(from + CHUNK_SIZE * step, end);

    const arr = [];
    if (step > 0) {
      for (let i = from; i < chunkEnd && arr.length < CHUNK_SIZE; i += step) {
        arr.push(i);
      }
    } else {
      for (let i = from; i > chunkEnd && arr.length < CHUNK_SIZE; i += step) {
        arr.push(i);
      }
    }

    if (arr.length === 0) return null;

    const chunk = new ArrayChunk(arr, 0, arr.length);
    const nextFrom = from + arr.length * step;
    const hasMore = step > 0 ? nextFrom < end : nextFrom > end;

    if (hasMore) {
      return new ChunkedCons(chunk, new LazySeq(() => makeChunk(nextFrom)));
    }
    return new ChunkedCons(chunk, null);
  }

  return makeChunk(start);
}

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
