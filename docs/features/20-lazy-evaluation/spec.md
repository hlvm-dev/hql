# Lazy Evaluation Technical Specification

**Source:** `src/hql/lib/stdlib/js/internal/seq-protocol.js`, `src/hql/lib/stdlib/js/core.js`, `src/hql/lib/stdlib/stdlib.hql`

## Grammar

```ebnf
lazy-seq  ::= '(' 'lazy-seq' body ')'
cons      ::= '(' 'cons' head tail ')'
seq       ::= '(' 'seq' coll ')'
delay     ::= '(' 'delay' expr ')'
force     ::= '(' 'force' delayed ')'
realized  ::= '(' 'realized' delayed ')'
```

## Overview

HQL implements Clojure-inspired lazy sequences built on a Symbol-based protocol system. Lazy sequences defer computation until values are needed, enable infinite data structures, and provide memory-efficient processing of large collections.

## The SEQ Protocol

The sequence protocol is defined using JavaScript Symbols:

```javascript
SEQ     = Symbol.for("hql.seq")      // ISeq: first(), rest(), seq()
COUNTED = Symbol.for("hql.counted")  // Counted: count() in O(1)
INDEXED = Symbol.for("hql.indexed")  // Indexed: nth(i) in O(1)
```

Any object implementing the `SEQ` protocol can participate in HQL's sequence operations. The protocol requires three methods:

| Method | Return | Description |
|--------|--------|-------------|
| `first()` | any | Returns the first element |
| `rest()` | seq | Returns the rest of the sequence (never null; returns EMPTY) |
| `seq()` | seq or null | Returns the sequence itself, or null if empty (nil-punning) |

## Core Types

### EMPTY

Singleton empty sequence (like Clojure's `PersistentList.EMPTY`):

- Implements all three protocols (SEQ, COUNTED, INDEXED)
- `first()` returns `undefined`
- `rest()` returns itself
- `seq()` returns `null`
- `count()` returns `0`
- Frozen (immutable)

### Cons

Immutable pair of `(first, rest)`:

```clojure
(cons 1 (cons 2 (cons 3 null)))
;; => (1 2 3)
```

**Time complexity:**
- `first()`: O(1)
- `rest()`: O(1)
- `seq()`: O(1)
- Iteration: O(n) with O(1) stack via trampolining

```clojure
;; Prepend to a sequence
(cons 0 [1 2 3])       ;; => (0 1 2 3)

;; Build a list
(cons 1 (cons 2 null)) ;; => (1 2)
```

### LazySeq

Lazy sequence that defers computation until first access:

```clojure
(lazy-seq
  (cons (compute-head)
        (lazy-seq (compute-rest))))
```

**Properties:**
- **Memoized**: Body thunk is evaluated at most once; result is cached
- **Trampolined**: Handles deeply nested lazy sequences without stack overflow
- **Nil-punning**: `seq()` returns `null` for empty lazy sequences

**Time complexity:**
- `first()`: O(1) amortized (first call evaluates thunk)
- `rest()`: O(1)
- `seq()`: O(1) amortized

### ArraySeq

Efficient sequence view over a JavaScript array:

```clojure
(seq [1 2 3])  ;; => ArraySeq wrapping [1, 2, 3]
```

**Properties:**
- Implements COUNTED and INDEXED protocols
- `count()`: O(1)
- `nth(i)`: O(1)
- Zero-copy: shares the underlying array

### ChunkedCons / ArrayChunk / ChunkBuffer

Chunked sequences for batch optimization:

- **ArrayChunk**: Fixed-size chunk of pre-computed values
- **ChunkBuffer**: Mutable buffer for building chunks (default capacity: 32)
- **ChunkedCons**: Cons cell with a chunk as `first` and a lazy seq as `rest`

Chunked processing amortizes the overhead of lazy thunk evaluation across multiple elements.

## The `seq` Function

Converts collections to lazy sequences with nil-punning:

```clojure
(seq [1 2 3])    ;; => ArraySeq
(seq "hello")    ;; => seq over characters
(seq #{1 2 3})   ;; => seq over Set values
(seq {a: 1})     ;; => seq over [key, value] entries
(seq [])         ;; => null (nil-punning)
(seq null)       ;; => null
```

**Supported input types:**
- Arrays -> ArraySeq
- Strings -> ArraySeq over characters
- Sets -> ArraySeq from `Array.from(set)`
- Maps -> ArraySeq from `Array.from(map)`
- Objects -> ArraySeq from `Object.entries()`
- SEQ protocol objects -> delegates to `.seq()`
- Iterators/Iterables -> lazy sequence via thunk chain
- null/undefined -> null

## Delay / Force / Realized

### delay

Wraps an expression in a deferred computation:

```clojure
(let d (delay (expensive-computation)))
;; computation not yet executed
```

### force

Forces evaluation of a delayed value:

```clojure
(force d)  ;; => evaluates and caches the result
(force d)  ;; => returns cached result (no recomputation)
```

### realized

Checks if a delay has been forced:

```clojure
(let d (delay 42))
(realized d)  ;; => false
(force d)     ;; => 42
(realized d)  ;; => true
```

Non-delay values always return `true` for `realized`.

## Lazy Constructors

### range

Generates a lazy sequence of numbers:

```clojure
(range)         ;; => 0, 1, 2, 3, ... (infinite)
(range 5)       ;; => 0, 1, 2, 3, 4
(range 2 8)     ;; => 2, 3, 4, 5, 6, 7
(range 0 10 2)  ;; => 0, 2, 4, 6, 8
```

### repeat

Creates an infinite lazy sequence of a single value:

```clojure
(take 3 (repeat "x"))  ;; => ("x" "x" "x")
```

### cycle

Creates an infinite lazy sequence by cycling through a collection:

```clojure
(take 7 (cycle [1 2 3]))  ;; => (1 2 3 1 2 3 1)
```

### iterate

Creates an infinite lazy sequence by repeatedly applying a function:

```clojure
(take 5 (iterate inc 0))        ;; => (0 1 2 3 4)
(take 5 (iterate (fn [x] (* x 2)) 1))  ;; => (1 2 4 8 16)
```

## Sequence Operations (Lazy)

These operations return lazy sequences:

| Operation | Description | Example |
|-----------|-------------|---------|
| `map` | Transform each element | `(map inc [1 2 3])` => `(2 3 4)` |
| `filter` | Keep matching elements | `(filter isOdd [1 2 3])` => `(1 3)` |
| `take` | First n elements | `(take 3 (range))` => `(0 1 2)` |
| `drop` | Skip first n elements | `(drop 2 [1 2 3 4])` => `(3 4)` |
| `takeWhile` | Take while predicate holds | `(takeWhile isEven [2 4 5])` => `(2 4)` |
| `dropWhile` | Drop while predicate holds | `(dropWhile isEven [2 4 5])` => `(5)` |
| `concat` | Concatenate sequences | `(concat [1 2] [3 4])` => `(1 2 3 4)` |
| `mapcat` | Map then concatenate | `(mapcat (fn [x] [x x]) [1 2])` => `(1 1 2 2)` |
| `interpose` | Insert separator | `(interpose ", " ["a" "b"])` => `("a" ", " "b")` |
| `interleave` | Interleave sequences | `(interleave [1 2] [3 4])` => `(1 3 2 4)` |
| `distinct` | Remove duplicates | `(distinct [1 2 1 3])` => `(1 2 3)` |
| `flatten` | Flatten nested seqs | `(flatten [[1 2] [3]])` => `(1 2 3)` |
| `partition` | Group into fixed-size chunks | `(partition 2 [1 2 3 4])` => `((1 2) (3 4))` |
| `partitionAll` | Like partition, keep remainder | `(partitionAll 2 [1 2 3])` => `((1 2) (3))` |
| `partitionBy` | Group by predicate changes | `(partitionBy isOdd [1 3 2 4])` => `((1 3) (2 4))` |

## Sequence Operations (Eager)

These operations force evaluation:

| Operation | Description | Example |
|-----------|-------------|---------|
| `reduce` | Fold left | `(reduce + 0 [1 2 3])` => `6` |
| `count` | Count elements | `(count [1 2 3])` => `3` |
| `first` | First element | `(first [1 2 3])` => `1` |
| `last` | Last element | `(last [1 2 3])` => `3` |
| `nth` | Element at index | `(nth [10 20 30] 1)` => `20` |
| `some` | First truthy result | `(some isEven [1 2 3])` => `true` |
| `every` | All match predicate | `(every isPositive [1 2 3])` => `true` |
| `into` | Collect into target | `(into [] (range 5))` => `[0 1 2 3 4]` |

## Invariants

1. **Nil-punning** -- Empty sequences return `null` from `seq()`, enabling `(if (seq coll) ...)` idiom
2. **Immutability** -- Cons cells and lazy sequences are immutable once created
3. **Memoization** -- LazySeq thunks are evaluated at most once; the result is cached
4. **Trampolining** -- Deeply nested lazy sequences use trampolining to avoid stack overflow
5. **O(1) primitives** -- `first`, `rest`, `seq` are O(1) for all sequence types
6. **Protocol dispatch** -- Any object implementing the SEQ symbol protocol can participate in sequence operations

## Edge Cases

### Infinite Sequences

Infinite sequences must be consumed with `take`, `takeWhile`, or similar bounded operations:

```clojure
;; CORRECT: bounded consumption
(take 10 (range))

;; DANGER: infinite loop
;; (reduce + (range))  -- never terminates
```

### Empty Sequence Handling

```clojure
(first [])    ;; => undefined
(rest [])     ;; => EMPTY (not null)
(seq [])      ;; => null
(count [])    ;; => 0
```

### Lazy Side Effects

Side effects in lazy sequences are deferred:

```clojure
;; Side effects happen only when the sequence is consumed
(let logged (map (fn [x] (print x) x) [1 2 3]))
;; Nothing printed yet
(reduce + 0 logged)  ;; Prints 1, 2, 3, returns 6
```

## Implementation Location

- Seq protocol: `src/hql/lib/stdlib/js/internal/seq-protocol.js`
- Core operations: `src/hql/lib/stdlib/js/core.js`
- Self-hosted operations: `src/hql/lib/stdlib/stdlib.hql`
- Transducers: `src/hql/lib/stdlib/js/transducers.js`
- Tests: `tests/unit/stdlib.test.ts`, `tests/unit/lazy-seq.test.ts`
