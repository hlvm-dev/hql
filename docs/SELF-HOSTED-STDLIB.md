# HQL Self-Hosted Standard Library

## Executive Summary

HQL is building a **self-hosted standard library** where stdlib functions are written in HQL itself, not JavaScript. This is inspired by **Clojure's elegant sequence abstraction** and its self-hosted nature.

**Current Status**: 2 of ~51 functions self-hosted (`take`, `drop`)
**Foundation**: Clojure-aligned seq-protocol with LazySeq, Cons, ArraySeq
**Tests**: All 1846 tests passing

---

## Table of Contents

1. [Philosophy & Inspiration](#philosophy--inspiration)
2. [The Clojure Foundation](#the-clojure-foundation)
3. [Seq Protocol Implementation](#seq-protocol-implementation)
4. [Self-Hosting Architecture](#self-hosting-architecture)
5. [Current Self-Hosted Functions](#current-self-hosted-functions)
6. [Migration Guide](#migration-guide)
7. [Known Issues & Technical Debt](#known-issues--technical-debt)
8. [Roadmap](#roadmap)
9. [Appendix](#appendix)

---

## Philosophy & Inspiration

### Why Self-Hosting?

Self-hosting means a language's standard library is written in the language itself. Benefits:

1. **Dogfooding**: If HQL stdlib is written in HQL, it proves the language is capable
2. **Consistency**: Users read stdlib source to learn idiomatic patterns
3. **Extensibility**: Users can understand and extend stdlib easily
4. **Bootstrap**: Once compiler is stable, stdlib can be auto-generated

### Why Clojure as Inspiration?

Clojure's sequence abstraction is one of the most elegant in programming:

```clojure
;; Clojure: Everything is a sequence
(take 5 (filter even? (map inc (range 1000000))))
;; Lazy - only computes what's needed
;; Uniform - same operations work on lists, vectors, maps, strings
;; Composable - small functions combine into complex pipelines
```

**Key Clojure concepts we adopt:**

| Concept | Description | HQL Implementation |
|---------|-------------|-------------------|
| **ISeq Protocol** | `first`, `rest`, `seq` as universal interface | `seq-protocol.js` |
| **Lazy Sequences** | Computation deferred until needed | `LazySeq` class |
| **Cons Cells** | Immutable pairs for building sequences | `Cons` class |
| **Nil Punning** | Empty collections return `null` from `seq` | `seq()` returns null |
| **Trampolining** | Prevent stack overflow in deep recursion | `_realize()` method |

### The Lisp Trinity

At the heart of all Lisp sequence operations are three primitives:

```
┌─────────────────────────────────────────────────────────────────┐
│                    THE LISP TRINITY                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   first ─── Returns the first element                           │
│             (first [1 2 3]) → 1                                 │
│                                                                 │
│   rest ──── Returns everything except first                     │
│             (rest [1 2 3]) → [2 3]                              │
│                                                                 │
│   cons ──── Constructs a new sequence                           │
│             (cons 0 [1 2 3]) → [0 1 2 3]                        │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  With just these three, you can build:                          │
│  map, filter, reduce, take, drop, concat, flatten, ...          │
└─────────────────────────────────────────────────────────────────┘
```

---

## The Clojure Foundation

### Reference Implementation Study

We studied Clojure's Java source code to understand the seq protocol:

| Clojure Class | Purpose | Our Implementation |
|---------------|---------|-------------------|
| `clojure.lang.ISeq` | Interface: first(), more(), cons() | `[SEQ]` symbol protocol |
| `clojure.lang.LazySeq` | Deferred computation with memoization | `LazySeq` class |
| `clojure.lang.Cons` | Immutable pair (first, rest) | `Cons` class |
| `clojure.lang.ArraySeq` | Efficient view into array | `ArraySeq` class |
| `clojure.lang.RT` | Runtime utilities (seq, first, rest) | `core.js` functions |
| `clojure.lang.Counted` | O(1) count protocol | `[COUNTED]` symbol |
| `clojure.lang.Indexed` | O(1) nth protocol | `[INDEXED]` symbol |

### Clojure's LazySeq Behavior

```java
// Clojure's LazySeq.java (simplified)
public class LazySeq implements ISeq {
    private IFn fn;      // Thunk to compute value
    private Object sv;   // Cached result

    // Called once, result memoized
    final synchronized Object sval() {
        if (fn != null) {
            sv = fn.invoke();
            fn = null;  // Release for GC
        }
        // TRAMPOLINE: Unwrap nested LazySeqs
        if (sv instanceof LazySeq)
            sv = ((LazySeq)sv).sval();
        return sv;
    }

    public Object first() {
        seq();
        return sv == null ? null : ((ISeq)sv).first();
    }

    public ISeq rest() {
        seq();
        return sv == null ? null : ((ISeq)sv).rest();
    }
}
```

**Key insights from Clojure:**
1. **Thunk called once** - result is memoized
2. **Trampolining** - nested LazySeqs unwrapped iteratively (prevents stack overflow)
3. **GC-friendly** - thunk reference released after realization
4. **Nil punning** - `seq()` returns null for empty, enabling `(when-let [s (seq coll)] ...)`

---

## Seq Protocol Implementation

### File: `src/lib/stdlib/js/internal/seq-protocol.js`

This is our Clojure-aligned foundation. Every self-hosted function depends on this.

### Protocol Symbols

```javascript
// Like Clojure's interfaces, but using JS Symbols
export const SEQ = Symbol.for("hql.seq");        // ISeq protocol
export const COUNTED = Symbol.for("hql.counted"); // O(1) count
export const INDEXED = Symbol.for("hql.indexed"); // O(1) nth
```

### Core Classes

#### 1. EMPTY - Singleton Empty Sequence

```javascript
// Like Clojure's PersistentList.EMPTY
export const EMPTY = Object.freeze({
  [SEQ]: true,
  [COUNTED]: true,
  [INDEXED]: true,
  first() { return undefined; },
  rest() { return this; },        // rest of empty is empty
  seq() { return null; },         // NIL PUNNING: empty → null
  count() { return 0; },
  nth() { return NOT_FOUND; },
  *[Symbol.iterator]() {},
});
```

#### 2. Cons - Immutable Pair

```javascript
// Like Clojure's clojure.lang.Cons
export class Cons {
  constructor(first, rest) {
    this._first = first;
    this._rest = rest;
  }

  first() { return this._first; }
  rest() { return this._rest ?? EMPTY; }
  seq() { return this; }  // Cons is never empty

  // Trampoline iterator - O(1) stack depth
  *[Symbol.iterator]() {
    let s = this;
    while (s && s !== EMPTY) {
      // Unwrap LazySeqs iteratively
      while (s instanceof LazySeq) s = s._realize();
      if (!s || s === EMPTY) break;

      if (s[SEQ]) {
        yield s.first();
        s = s.rest();
      } else {
        yield* s;
        break;
      }
    }
  }
}
Cons.prototype[SEQ] = true;
```

#### 3. LazySeq - Deferred Computation

```javascript
// Like Clojure's clojure.lang.LazySeq
export class LazySeq {
  constructor(thunk) {
    this._thunk = thunk;
    this._realized = null;
    this._isRealized = false;
  }

  // TRAMPOLINE: Like Clojure's sval() + unwrap
  _realize() {
    if (this._isRealized) return this._realized;

    let result = this._thunk;
    this._thunk = null;  // GC: release closure

    // Call thunk
    if (typeof result === "function") result = result();

    // CRITICAL: Unwrap nested LazySeqs iteratively
    // This prevents stack overflow with deep laziness
    while (result instanceof LazySeq && !result._isRealized) {
      const nested = result._thunk;
      result._thunk = null;
      result = typeof nested === "function" ? nested() : nested;
    }

    if (result instanceof LazySeq) result = result._realized;

    this._realized = result;
    this._isRealized = true;
    return result;
  }

  first() { const s = this._realize(); return s ? s.first() : undefined; }
  rest() { const s = this._realize(); return s ? s.rest() : EMPTY; }
  seq() { const s = this._realize(); return s ? s.seq() : null; }  // NIL PUNNING
}
LazySeq.prototype[SEQ] = true;
```

#### 4. ArraySeq - Efficient Array View

```javascript
// Like Clojure's clojure.lang.ArraySeq
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
  seq() { return this; }

  // O(1) operations via protocols
  count() { return this._arr.length - this._i; }
  nth(n) {
    const idx = this._i + n;
    if (idx >= 0 && idx < this._arr.length) return this._arr[idx];
    return NOT_FOUND;
  }
}
ArraySeq.prototype[SEQ] = true;
ArraySeq.prototype[COUNTED] = true;
ArraySeq.prototype[INDEXED] = true;
```

### Time Complexity Guarantees

| Operation | ArraySeq | Cons | LazySeq |
|-----------|----------|------|---------|
| `first()` | O(1) | O(1) | O(1)* |
| `rest()` | O(1) | O(1) | O(1)* |
| `seq()` | O(1) | O(1) | O(1)* |
| `count()` | O(1) | O(n) | O(n) |
| `nth(i)` | O(1) | O(i) | O(i) |

*After realization (first call may compute)

---

## Self-Hosting Architecture

### File Structure

```
src/lib/stdlib/
├── stdlib.hql                    # HQL SOURCE OF TRUTH
│   └── Contains: (fn take ...), (fn drop ...)
│
├── js/
│   ├── core.js                   # JavaScript primitives
│   │   └── Contains: seq, first, rest, cons, map, filter, ...
│   │   └── NOTE: take, drop REMOVED (self-hosted)
│   │
│   ├── self-hosted.js            # Pre-transpiled HQL functions
│   │   └── Contains: take(), drop()
│   │   └── Imports: lazySeq, cons from seq-protocol.js
│   │   └── Imports: seq, first, rest from core.js
│   │
│   ├── index.js                  # Assembles STDLIB_PUBLIC_API
│   │   └── Excludes self-hosted from core.js
│   │   └── Adds self-hosted functions
│   │   └── Exports unified API
│   │
│   └── internal/
│       ├── seq-protocol.js       # Clojure-aligned foundation (NEW)
│       │   └── LazySeq, Cons, ArraySeq, EMPTY
│       │   └── SEQ, COUNTED, INDEXED protocols
│       │
│       └── lazy-seq.js           # Generator-based lazy seqs (OLD)
│           └── Used by range, map, filter in core.js
│           └── WILL BE DEPRECATED
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SELF-HOSTING DATA FLOW                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  stdlib.hql (HQL SOURCE OF TRUTH)                                   │    │
│  │                                                                     │    │
│  │  ;; Inspired by Clojure's clojure.core/take                         │    │
│  │  (fn take [n coll]                                                  │    │
│  │    (lazy-seq                                                        │    │
│  │      (when (> n 0)                                                  │    │
│  │        (when-let [s (seq coll)]                                     │    │
│  │          (cons (first s) (take (- n 1) (rest s)))))))               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                              │
│                              │ MANUAL TRANSPILATION                         │
│                              │ (Bootstrap - can't run HQL without stdlib)   │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  self-hosted.js (PRE-TRANSPILED JAVASCRIPT)                         │    │
│  │                                                                     │    │
│  │  import { lazySeq, cons } from "./internal/seq-protocol.js";        │    │
│  │  import { seq, first, rest } from "./core.js";                      │    │
│  │                                                                     │    │
│  │  export function take(n, coll) {                                    │    │
│  │    return lazySeq(() => {                                           │    │
│  │      if (n > 0) {                                                   │    │
│  │        const s = seq(coll);                                         │    │
│  │        if (s != null) {                                             │    │
│  │          return cons(first(s), take(n - 1, rest(s)));               │    │
│  │        }                                                            │    │
│  │      }                                                              │    │
│  │      return null;                                                   │    │
│  │    });                                                              │    │
│  │  }                                                                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                              │
│                              │ IMPORT & MERGE                               │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  index.js (STDLIB_PUBLIC_API)                                       │    │
│  │                                                                     │    │
│  │  const SELF_HOSTED_FUNCTIONS = new Set(["take", "drop"]);           │    │
│  │                                                                     │    │
│  │  // Build API: core.js - self_hosted + self-hosted.js               │    │
│  │  export const STDLIB_PUBLIC_API = ...                               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                              │
│                              │ RUNTIME INJECTION                            │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  runtime-helpers.ts → globalThis                                    │    │
│  │                                                                     │    │
│  │  for (const [name, func] of Object.entries(STDLIB_PUBLIC_API)) {    │    │
│  │    globalThis[name] = func;                                         │    │
│  │  }                                                                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  USER CODE                                                          │    │
│  │                                                                     │    │
│  │  (take 5 (drop 10 (range 1 1000000)))                               │    │
│  │  → [11, 12, 13, 14, 15]                                             │    │
│  │                                                                     │    │
│  │  LAZY: Only computes 15 elements, not 1 million!                    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why Manual Transpilation?

**The Bootstrap Problem:**
```
To run HQL code → Need HQL compiler → Need stdlib → Need to run HQL code
         ↑                                                    │
         └────────────────── CIRCULAR ────────────────────────┘
```

**Solution: Manual Bootstrap**
1. Write HQL source (stdlib.hql) - this is the SOURCE OF TRUTH
2. Manually transpile to JS (self-hosted.js) - one-time effort per function
3. JS runs without needing HQL compiler
4. Once compiler is stable, auto-generate self-hosted.js from stdlib.hql

This is how ALL self-hosted languages bootstrap (GCC was first compiled with a C compiler, etc.)

---

## Current Self-Hosted Functions

### 1. `take` - Returns first n elements (lazy)

**HQL Source (stdlib.hql):**
```hql
;; Inspired by Clojure's clojure.core/take
;; https://github.com/clojure/clojure/blob/master/src/clj/clojure/core.clj#L2876
(fn take [n coll]
  (lazy-seq
    (when (> n 0)
      (when-let [s (seq coll)]
        (cons (first s) (take (- n 1) (rest s)))))))
```

**Clojure Original:**
```clojure
(defn take [n coll]
  (lazy-seq
   (when (pos? n)
     (when-let [s (seq coll)]
       (cons (first s) (take (dec n) (rest s)))))))
```

**Transpiled JavaScript (self-hosted.js):**
```javascript
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
```

**Behavior:**
```
(take 3 [1 2 3 4 5])     → [1, 2, 3]
(take 0 [1 2 3])         → []
(take 10 [1 2])          → [1, 2]
(take -1 [1 2 3])        → []  (Clojure behavior, no error)
(take 5 (range 1 1000000)) → [1, 2, 3, 4, 5]  (lazy!)
```

### 2. `drop` - Drops first n elements (lazy)

**HQL Source (stdlib.hql):**
```hql
;; Inspired by Clojure's clojure.core/drop
;; Uses loop/recur for efficiency, then cons for seq-protocol compatibility
(fn drop [n coll]
  (lazy-seq
    (loop [s (seq coll) remaining n]
      (if (and s (> remaining 0))
        (recur (rest s) (- remaining 1))
        (when s
          (cons (first s) (drop 0 (rest s))))))))
```

**Clojure Original:**
```clojure
(defn drop [n coll]
  (let [step (fn [n coll]
               (let [s (seq coll)]
                 (if (and (pos? n) s)
                   (recur (dec n) (rest s))
                   s)))]
    (lazy-seq (step n coll))))
```

**Note:** Our version wraps result in `cons` to ensure seq-protocol compatibility (see [Known Issues](#known-issues--technical-debt)).

**Transpiled JavaScript (self-hosted.js):**
```javascript
export function drop(n, coll) {
  return lazySeq(() => {
    let s = seq(coll);
    let remaining = n;
    while (s && remaining > 0) {
      s = rest(s);
      remaining--;
    }
    if (s) {
      return cons(first(s), drop(0, rest(s)));
    }
    return null;
  });
}
```

**Behavior:**
```
(drop 2 [1 2 3 4 5])     → [3, 4, 5]
(drop 0 [1 2 3])         → [1, 2, 3]
(drop 10 [1 2])          → []
(drop -1 [1 2 3])        → [1, 2, 3]  (Clojure behavior)
(take 3 (drop 1000 (range 1 1000000))) → [1001, 1002, 1003]  (lazy!)
```

---

## Migration Guide

### How to Add a New Self-Hosted Function

#### Step 1: Study Clojure's Implementation

```bash
# Find Clojure source
# https://github.com/clojure/clojure/blob/master/src/clj/clojure/core.clj

# Example: take-while
# Line ~2900 in core.clj
```

#### Step 2: Write HQL Source in stdlib.hql

```hql
;; Add after existing self-hosted functions

;; take-while - Returns elements while predicate is true (lazy)
;; Inspired by Clojure's clojure.core/take-while
(fn take-while [pred coll]
  (lazy-seq
    (when-let [s (seq coll)]
      (when (pred (first s))
        (cons (first s) (take-while pred (rest s)))))))
```

#### Step 3: Manually Transpile to self-hosted.js

```javascript
// Add to self-hosted.js

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// take-while - Returns elements while predicate is true (lazy)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// HQL Source (from stdlib.hql):
// ┌────────────────────────────────────────────────────────────────┐
// │ (fn take-while [pred coll]                                     │
// │   (lazy-seq                                                    │
// │     (when-let [s (seq coll)]                                   │
// │       (when (pred (first s))                                   │
// │         (cons (first s) (take-while pred (rest s)))))))        │
// └────────────────────────────────────────────────────────────────┘
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function takeWhile(pred, coll) {
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
```

#### Step 4: Update index.js

```javascript
const SELF_HOSTED_FUNCTIONS = new Set([
  "take",
  "drop",
  "takeWhile",  // ADD NEW FUNCTION
]);
```

#### Step 5: Remove from core.js

Find and delete the JavaScript implementation, replace with comment:

```javascript
// NOTE: `takeWhile` is SELF-HOSTED in HQL (see src/lib/stdlib/stdlib.hql)
// Pre-transpiled version: src/lib/stdlib/js/self-hosted.js
// Source of truth: HQL, not JavaScript
```

#### Step 6: Update Tests

```javascript
// If old test expected error for edge cases:
// OLD:
Deno.test("takeWhile: throws for non-function", () => {
  assertThrows(() => takeWhile(null, [1,2,3]), TypeError);
});

// NEW (Clojure behavior - may just fail at runtime):
Deno.test("takeWhile: handles edge cases", () => {
  assertEquals(doall(takeWhile(x => x < 3, [1,2,3,4])), [1,2]);
  assertEquals(doall(takeWhile(x => x < 0, [1,2,3])), []);
});
```

#### Step 7: Verify

```bash
# Check single source
deno eval "
import * as Core from './src/lib/stdlib/js/core.js';
import * as SelfHosted from './src/lib/stdlib/js/self-hosted.js';
console.log('Core.takeWhile:', Core.takeWhile);
console.log('SelfHosted.takeWhile:', typeof SelfHosted.takeWhile);
"
# Should show: undefined, function

# Run tests
deno task test:unit
```

### Transpilation Reference

| HQL Construct | JavaScript Equivalent |
|---------------|----------------------|
| `(lazy-seq body)` | `lazySeq(() => body)` |
| `(when test body)` | `if (test) { return body; } return null;` |
| `(when-let [s (seq coll)] body)` | `const s = seq(coll); if (s != null) { return body; } return null;` |
| `(cons a b)` | `cons(a, b)` |
| `(first s)` | `first(s)` |
| `(rest s)` | `rest(s)` |
| `(seq coll)` | `seq(coll)` |
| `(> a b)` | `a > b` |
| `(- a b)` | `a - b` |
| `(and a b)` | `a && b` |
| `(if test then else)` | `test ? then : else` or `if/else` |
| `(let [x val] body)` | `let x = val; return body;` |
| `(loop [x init] body)` | `let x = init; while (...) { ... }` or recursion |
| `(recur new-x)` | `x = new-x; continue;` or tail call |
| `(fn [args] body)` | `(args) => body` or `function(args) { return body; }` |

---

## Known Issues & Technical Debt

### Issue 1: Two Incompatible LazySeq Systems

**Problem:**
```
┌────────────────────────────────────────────────────────────────┐
│  OLD: lazy-seq.js (generator-based)                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ class LazySeq {                                          │  │
│  │   constructor(producer) { this._producer = producer; }   │  │
│  │   // NO .seq() method                                    │  │
│  │   // NO .first() method                                  │  │
│  │   // NO .rest() method                                   │  │
│  │   // Uses .get(index) and iteration                      │  │
│  │ }                                                        │  │
│  │                                                          │  │
│  │ Used by: range, map, filter, reduce, etc. in core.js     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              ≠                                 │
│  NEW: seq-protocol.js (Clojure-style)                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ class LazySeq {                                          │  │
│  │   constructor(thunk) { this._thunk = thunk; }            │  │
│  │   seq() { ... }   // ✓ Has .seq()                        │  │
│  │   first() { ... } // ✓ Has .first()                      │  │
│  │   rest() { ... }  // ✓ Has .rest()                       │  │
│  │ }                                                        │  │
│  │                                                          │  │
│  │ Used by: take, drop in self-hosted.js                    │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

**Impact:**
When self-hosted functions call `seq()` on results from core.js functions (like `range`), the old LazySeq doesn't have a `.seq()` method, causing errors.

**Current Workaround:**
Self-hosted functions always return `cons` cells, never raw seqs:

```javascript
// BAD (might return old LazySeq):
return s;

// GOOD (always returns seq-protocol type):
return cons(first(s), drop(0, rest(s)));
```

**Long-term Solution:**
Migrate ALL of core.js to use seq-protocol.js, then delete lazy-seq.js.

### Issue 2: Manual Transpilation

**Problem:** Each new self-hosted function requires manual HQL → JS transpilation.

**Impact:** Error-prone, tedious, slows migration.

**Solution:** Build auto-transpiler that generates self-hosted.js from stdlib.hql.

### Issue 3: Clojure Behavior Differences

**Problem:** Self-hosted functions follow Clojure semantics, which may differ from original JS implementations.

| Scenario | Old JS Behavior | New Clojure Behavior |
|----------|-----------------|---------------------|
| `(take -1 coll)` | TypeError | Returns `[]` |
| `(drop -1 coll)` | TypeError | Returns `coll` |

**Solution:** Update tests to match Clojure behavior.

---

## Roadmap

### Phase 1: Foundation ✅ COMPLETE
- [x] Create seq-protocol.js with Clojure-aligned LazySeq, Cons, ArraySeq
- [x] Implement `take` as self-hosted
- [x] Implement `drop` as self-hosted
- [x] Prove architecture works (all tests pass)

### Phase 2: Simple Sequence Functions
Priority functions that only need `seq`, `first`, `rest`, `cons`, `lazy-seq`:

| Function | Clojure Reference | Complexity |
|----------|------------------|------------|
| `take-while` | core.clj:2900 | Low |
| `drop-while` | core.clj:2913 | Low |
| `second` | `(first (rest x))` | Trivial |
| `ffirst` | `(first (first x))` | Trivial |
| `nfirst` | `(rest (first x))` | Trivial |
| `fnext` | `(first (rest x))` | Trivial |
| `nnext` | `(rest (rest x))` | Trivial |
| `nthnext` | core.clj:3082 | Low |
| `nthrest` | core.clj:3088 | Low |

### Phase 3: Higher-Order Functions
Functions that take function arguments:

| Function | Notes | Complexity |
|----------|-------|------------|
| `map` | Single & multi-arity | Medium |
| `filter` | `(lazy-seq (when-let ...))` | Medium |
| `remove` | `(filter (complement pred) coll)` | Low |
| `keep` | Like filter but keeps non-nil results of f | Medium |
| `mapcat` | `(apply concat (map f colls))` | Medium |
| `keep-indexed` | Like keep with index | Medium |
| `map-indexed` | Like map with index | Medium |

### Phase 4: Unify LazySeq Systems
- [ ] Migrate `range` to use seq-protocol.js
- [ ] Migrate `map` to use seq-protocol.js
- [ ] Migrate `filter` to use seq-protocol.js
- [ ] Migrate remaining core.js functions
- [ ] Delete lazy-seq.js

### Phase 5: Auto-Transpilation
- [ ] Parse stdlib.hql
- [ ] Generate self-hosted.js automatically
- [ ] Integrate into build process

### Phase 6: Full Self-Hosting (~90%)
Target: All functions that CAN be expressed in HQL ARE in HQL.

**Must remain in JavaScript:**
- `seq` - needs to handle JS arrays, strings, objects
- `first`, `rest` - primitive foundation
- `assoc`, `dissoc`, `get`, `update` - JS object manipulation
- `vec`, `set` - JS type constructors
- `range` - could be HQL but needs JS number iteration

---

## Verification Commands

```bash
# 1. Verify no duplicates between core.js and self-hosted.js
grep -h "^export function" src/lib/stdlib/js/core.js src/lib/stdlib/js/self-hosted.js | \
  sed 's/export function //' | sed 's/(.*)//' | sort | uniq -d
# Should return nothing

# 2. Verify self-hosted functions are from self-hosted.js
deno eval "
import * as Core from './src/lib/stdlib/js/core.js';
import * as SelfHosted from './src/lib/stdlib/js/self-hosted.js';
import { STDLIB_PUBLIC_API } from './src/lib/stdlib/js/index.js';

const selfHosted = ['take', 'drop'];
for (const name of selfHosted) {
  console.log(\`\${name}:\`);
  console.log(\`  Core[\${name}]: \${Core[name]}\`);
  console.log(\`  SelfHosted[\${name}]: \${typeof SelfHosted[name]}\`);
  console.log(\`  API === SelfHosted: \${STDLIB_PUBLIC_API[name] === SelfHosted[name]}\`);
}
"

# 3. Verify bundle has single definition
echo '(print (take 3 [1 2 3]))' > /tmp/test.hql
deno run -A src/cli/cli.ts compile /tmp/test.hql --target js -o /tmp/test.js
echo "take count: $(grep -c 'function take' /tmp/test.js)"
echo "drop count: $(grep -c 'function drop' /tmp/test.js)"
# Both should be 1

# 4. Run all tests
deno task test:unit
# Should show: 1846 passed
```

---

## Appendix

### A. Complete File Listing

**stdlib.hql** (HQL Source of Truth):
```hql
;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
;; SELF-HOSTED STDLIB FUNCTIONS
;; These are implemented in HQL, not JavaScript!
;; Inspired by Clojure's sequence library
;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

;; take - Returns first n elements from a collection (lazy)
(fn take [n coll]
  (lazy-seq
    (when (> n 0)
      (when-let [s (seq coll)]
        (cons (first s) (take (- n 1) (rest s)))))))

;; drop - Drops first n elements from a collection (lazy)
(fn drop [n coll]
  (lazy-seq
    (loop [s (seq coll) remaining n]
      (if (and s (> remaining 0))
        (recur (rest s) (- remaining 1))
        (when s
          (cons (first s) (drop 0 (rest s))))))))
```

**self-hosted.js** (Pre-Transpiled):
```javascript
// self-hosted.js - Pre-transpiled HQL stdlib functions
// TRUE SELF-HOSTING: HQL source → Transpiled JS
// See stdlib.hql for source of truth

import { lazySeq, cons } from "./internal/seq-protocol.js";
import { seq, first, rest } from "./core.js";

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

export function drop(n, coll) {
  return lazySeq(() => {
    let s = seq(coll);
    let remaining = n;
    while (s && remaining > 0) {
      s = rest(s);
      remaining--;
    }
    if (s) {
      return cons(first(s), drop(0, rest(s)));
    }
    return null;
  });
}
```

### B. Clojure Reference Links

- [Clojure core.clj](https://github.com/clojure/clojure/blob/master/src/clj/clojure/core.clj)
- [LazySeq.java](https://github.com/clojure/clojure/blob/master/src/jvm/clojure/lang/LazySeq.java)
- [Cons.java](https://github.com/clojure/clojure/blob/master/src/jvm/clojure/lang/Cons.java)
- [RT.java](https://github.com/clojure/clojure/blob/master/src/jvm/clojure/lang/RT.java)
- [ISeq.java](https://github.com/clojure/clojure/blob/master/src/jvm/clojure/lang/ISeq.java)

### C. Key Contacts & Resources

- **Codebase**: /Users/seoksoonjang/Desktop/hql
- **Tests**: `deno task test:unit` (1846 tests)
- **Main Files**:
  - `src/lib/stdlib/stdlib.hql` - HQL source
  - `src/lib/stdlib/js/self-hosted.js` - Transpiled JS
  - `src/lib/stdlib/js/index.js` - API assembly
  - `src/lib/stdlib/js/core.js` - JS implementations
  - `src/lib/stdlib/js/internal/seq-protocol.js` - Clojure foundation
