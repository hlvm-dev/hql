# HQL Standard Library

**Location:** `src/lib/stdlib/js/stdlib.js`

---

## Overview

HQL's standard library provides functional programming utilities for working
with collections, sequences, and data transformations. All functions are lazy by
default and support both arrays and lazy sequences.

---

## Sequence Primitives (Lisp Trinity)

### `first(coll)`

Returns the first element of a collection.

```lisp
(first [1 2 3])        ;; → 1
(first "hello")        ;; → "h"
(first [])             ;; → undefined
```

---

### `rest(coll)`

Returns all but the first element as a lazy sequence.

```lisp
(rest [1 2 3])         ;; → (2 3)
(rest [1])             ;; → ()
(rest [])              ;; → ()
```

**Lazy:** Yes

---

### `cons(item, coll)`

Prepends an item to a collection, returning a lazy sequence.

```lisp
(cons 1 [2 3])         ;; → (1 2 3)
(cons 0 [])            ;; → (0)
```

**Lazy:** Yes

---

## Sequence Operations

### `take(n, coll)`

Takes the first `n` elements from a collection as a lazy sequence.

```lisp
(take 3 [1 2 3 4 5])   ;; → (1 2 3)
(take 10 [1 2])        ;; → (1 2)
(take 0 [1 2])         ;; → ()
```

**Lazy:** Yes

---

### `drop(n, coll)`

Drops the first `n` elements from a collection, returning lazy sequence.

```lisp
(drop 2 [1 2 3 4 5])   ;; → (3 4 5)
(drop 10 [1 2])        ;; → ()
```

**Lazy:** Yes

---

### `concat(...colls)`

Concatenates multiple collections into a lazy sequence.

```lisp
(concat [1 2] [3 4])   ;; → (1 2 3 4)
(concat [] [1])        ;; → (1)
(concat [1] [] [2])    ;; → (1 2)
```

**Lazy:** Yes

---

### `flatten(coll)`

Flattens nested collections one level deep.

```lisp
(flatten [[1 2] [3 4]])      ;; → (1 2 3 4)
(flatten [1 [2 3] 4])        ;; → (1 2 3 4)
(flatten [[[1]] [2]])        ;; → ([1] 2) ; only one level
```

**Lazy:** Yes

---

### `distinct(coll)`

Returns lazy sequence of unique elements (preserves first occurrence).

```lisp
(distinct [1 2 2 3 1])       ;; → (1 2 3)
(distinct "hello")           ;; → ("h" "e" "l" "o")
```

**Lazy:** Yes

---

### `range([start,] end [, step])`

Generates a lazy sequence of numbers.

```lisp
(range 5)                    ;; → (0 1 2 3 4)
(range 2 5)                  ;; → (2 3 4)
(range 0 10 2)               ;; → (0 2 4 6 8)
```

**Lazy:** Yes

---

## Collection Transformations

### `map(fn, coll)`

Applies function to each element, returning lazy sequence.

```lisp
(map (fn [x] (* x 2)) [1 2 3])     ;; → (2 4 6)
(map str [1 2 3])                  ;; → ("1" "2" "3")
```

**Lazy:** Yes

---

### `filter(pred, coll)`

Returns lazy sequence of elements satisfying predicate.

```lisp
(filter even? [1 2 3 4])           ;; → (2 4)
(filter (fn [x] (> x 5)) [3 6 9])  ;; → (6 9)
```

**Lazy:** Yes

---

### `reduce(fn, init, coll)`

Reduces collection to single value.

```lisp
(reduce + 0 [1 2 3 4])             ;; → 10
(reduce * 1 [1 2 3 4])             ;; → 24
```

**Lazy:** No (must realize entire collection)

---

### `mapIndexed(fn, coll)`

Maps function receiving (index, item) over collection.

```lisp
(mapIndexed (fn [i x] [i x]) ["a" "b" "c"])
;; → ([0 "a"] [1 "b"] [2 "c"])

(mapIndexed (fn [i x] (* i x)) [10 20 30])
;; → (0 20 60)
```

**Lazy:** Yes

---

### `keepIndexed(fn, coll)`

Like mapIndexed but filters nil results.

```lisp
(keepIndexed (fn [i x] (if (even? i) x nil)) ["a" "b" "c" "d"])
;; → ("a" "c")
```

**Lazy:** Yes

---

### `mapcat(fn, coll)`

Maps function then concatenates results (flat-map).

```lisp
(mapcat (fn [x] [x x]) [1 2 3])    ;; → (1 1 2 2 3 3)
(mapcat rest [[1 2 3] [4 5] [6]])  ;; → (2 3 5)
```

**Lazy:** Yes

---

### `keep(fn, coll)`

Maps function and filters nil results.

```lisp
(keep (fn [x] (if (> x 0) x nil)) [-1 0 1 2])
;; → (1 2)
```

**Lazy:** Yes

---

## Collection Protocols

### `seq(coll)`

Returns a sequence view of the collection, or nil if empty.

```lisp
(seq [1 2 3])                      ;; → (1 2 3)
(seq [])                           ;; → nil
(seq "hello")                      ;; → ("h" "e" "l" "l" "o")
```

---

### `empty(coll)`

Returns an empty collection of the same type.

```lisp
(empty [1 2 3])                    ;; → []
(empty #[1 2 3])                   ;; → #[]
```

---

### `conj(coll, item)`

Adds item to collection in type-appropriate position.

```lisp
(conj [1 2] 3)                     ;; → [1 2 3]
(conj #[1 2] 3)                    ;; → #[1 2 3]
(conj '(1 2) 0)                    ;; → (0 1 2)
```

---

### `into(to, from)`

Adds all elements from `from` into `to`.

```lisp
(into [] [1 2 3])                  ;; → [1 2 3]
(into #[] [1 2 2 3])               ;; → #[1 2 3]
(into {} [["a" 1] ["b" 2]])        ;; → {a: 1, b: 2}
```

---

## Predicates

### `isEmpty(coll)`

Returns true if collection is empty.

```lisp
(isEmpty [])                       ;; → true
(isEmpty [1])                      ;; → false
(isEmpty nil)                      ;; → true
```

---

### `some(pred, coll)`

Returns first truthy value of (pred item), or nil.

```lisp
(some even? [1 3 5])               ;; → nil
(some even? [1 2 3])               ;; → 2 (first matching item)
(some #(> % 5) [1 3 6 9])          ;; → 6
```

---

### `every(pred, coll)`

Returns true if predicate returns truthy for all elements.

```lisp
(every even? [2 4 6])              ;; → true
(every even? [2 3 4])              ;; → false
(every pos? [])                    ;; → true (vacuous truth)
```

---

### `notAny(pred, coll)`

Returns true if predicate returns false for all elements.

```lisp
(notAny even? [1 3 5])             ;; → true
(notAny even? [1 2 3])             ;; → false
```

---

### `notEvery(pred, coll)`

Returns true if predicate returns false for at least one element.

```lisp
(notEvery even? [2 4 6])           ;; → false
(notEvery even? [2 3 4])           ;; → true
```

---

### `isSome(x)`

Returns true if x is not nil (null or undefined).

```lisp
(isSome 0)                         ;; → true
(isSome false)                     ;; → true
(isSome nil)                       ;; → false
(isSome undefined)                 ;; → false
```

---

## Realization

### `doall(coll)`

Forces realization of lazy sequence, returning array.

```lisp
(doall (take 3 [1 2 3 4]))         ;; → [1 2 3]
(doall (map inc [1 2 3]))          ;; → [2 3 4]
```

**Use:** When you need an actual array instead of lazy sequence

---

### `realized(seq)`

Checks if a sequence has been realized.

```lisp
(var lazySeq (take 5 [1 2 3 4 5]))
(realized lazySeq)                 ;; → false
(doall lazySeq)
(realized lazySeq)                 ;; → true
```

---

## Higher-Order Functions

### `comp(...fns)`

Composes functions right-to-left.

```lisp
(var addThenDouble (comp (fn [x] (* x 2)) (fn [x] (+ x 1))))
(addThenDouble 5)                  ;; → 12  ; (5 + 1) * 2
```

---

### `partial(fn, ...args)`

Partially applies arguments to a function.

```lisp
(var add10 (partial + 10))
(add10 5)                          ;; → 15
(add10 20)                         ;; → 30
```

---

### `apply(fn, args)`

Applies function to array of arguments.

```lisp
(apply + [1 2 3 4])                ;; → 10
(apply max [5 2 9 1])              ;; → 9
```

---

## Map Operations

### `get(map, key [, notFound])`

Gets value from map by key.

```lisp
(get {a: 1, b: 2} "a")             ;; → 1
(get {a: 1} "b")                   ;; → undefined
(get {a: 1} "b" "default")         ;; → "default"
```

---

### `getIn(map, path [, notFound])`

Gets value at nested path (array of keys).

```lisp
(getIn {a: {b: {c: 1}}} ["a" "b" "c"])  ;; → 1
(getIn {a: {b: 1}} ["a" "x"] "n/a")     ;; → "n/a"
```

---

### `assoc(map, key, value)`

Associates key with value in map, returning new map.

```lisp
(assoc {a: 1} "b" 2)               ;; → {a: 1, b: 2}
(assoc {} "x" 10)                  ;; → {x: 10}
```

**Immutable:** Returns new map

---

### `assocIn(map, path, value)`

Associates value at nested path.

```lisp
(assocIn {} ["a" "b" "c"] 1)       ;; → {a: {b: {c: 1}}}
(assocIn {a: {b: 1}} ["a" "c"] 2)  ;; → {a: {b: 1, c: 2}}
```

**Immutable:** Returns new map

---

### `dissoc(map, key)`

Removes key from map, returning new map.

```lisp
(dissoc {a: 1, b: 2} "b")          ;; → {a: 1}
```

**Immutable:** Returns new map

---

### `update(map, key, fn)`

Updates value at key by applying function.

```lisp
(update {a: 1} "a" inc)            ;; → {a: 2}
(update {a: 1} "a" (fn [x] (* x 10)))  ;; → {a: 10}
```

**Immutable:** Returns new map

---

### `updateIn(map, path, fn)`

Updates value at nested path by applying function.

```lisp
(updateIn {a: {b: 1}} ["a" "b"] inc)  ;; → {a: {b: 2}}
```

**Immutable:** Returns new map

---

### `merge(...maps)`

Merges multiple maps, later values override.

```lisp
(merge {a: 1} {b: 2})              ;; → {a: 1, b: 2}
(merge {a: 1} {a: 2})              ;; → {a: 2}
```

**Immutable:** Returns new map

---

### `keys(map)`

Returns all keys from map.

```lisp
(keys {a: 1, b: 2})                ;; → ["a", "b"]
```

---

## Grouping

### `groupBy(fn, coll)`

Groups collection by result of function.

```lisp
(groupBy (fn [x] (% x 2)) [1 2 3 4 5])
;; → {0: [2, 4], 1: [1, 3, 5]}

(groupBy .length ["a" "bb" "ccc" "dd"])
;; → {1: ["a"], 2: ["bb", "dd"], 3: ["ccc"]}
```

---

## Generators

### `iterate(fn, initial)`

Generates infinite lazy sequence by repeatedly applying function.

```lisp
(take 5 (iterate (fn [x] (+ x 1)) 0))     ;; → (0 1 2 3 4)
(take 4 (iterate (fn [x] (* x 2)) 1))     ;; → (1 2 4 8)
```

**Lazy:** Yes (infinite sequence!)

---

### `repeat(x)`

Returns infinite lazy sequence of the same value.

```lisp
(take 5 (repeat "hello"))          ;; → ("hello" "hello" "hello" "hello" "hello")
(take 3 (repeat 42))               ;; → (42 42 42)
```

**Lazy:** Yes (infinite sequence!)

---

### `repeatedly(fn)`

Returns infinite lazy sequence calling function each time.

```lisp
(take 3 (repeatedly (fn [] (Math.random))))  ;; → (0.123 0.456 0.789)
(take 4 (repeatedly (fn [] (Date.now))))     ;; → timestamps
```

**Lazy:** Yes (infinite sequence!)

---

### `cycle(coll)`

Returns infinite lazy sequence cycling through collection.

```lisp
(take 7 (cycle [1 2 3]))           ;; → (1 2 3 1 2 3 1)
(take 5 (cycle "ab"))              ;; → ("a" "b" "a" "b" "a")
```

**Lazy:** Yes (infinite sequence!)

---

## Utilities

### `count(coll)`

Returns count of elements in collection.

```lisp
(count [1 2 3])                    ;; → 3
(count "hello")                    ;; → 5
(count [])                         ;; → 0
```

**Note:** Forces realization of lazy sequences

---

### `nth(coll, n [, notFound])`

Returns element at index n.

```lisp
(nth [1 2 3] 1)                    ;; → 2
(nth [1 2 3] 10)                   ;; → undefined
(nth [1 2 3] 10 "n/a")             ;; → "n/a"
```

---

### `last(coll)`

Returns last element of collection.

```lisp
(last [1 2 3])                     ;; → 3
(last [])                          ;; → undefined
```

**Note:** Forces realization of lazy sequences

---

### `second(coll)`

Returns second element of collection.

```lisp
(second [1 2 3])                   ;; → 2
(second [1])                       ;; → undefined
```

---

### `next(coll)`

Returns (seq (rest coll)), or nil if empty.

```lisp
(next [1 2 3])                     ;; → (2 3)
(next [1])                         ;; → nil
(next [])                          ;; → nil
```

**Note:** Unlike `rest` which returns empty seq, `next` returns nil.

---

### `reverse(coll)`

Reverses a collection.

```lisp
(reverse [1 2 3])                  ;; → [3 2 1]
(reverse "hello")                  ;; → ["o" "l" "l" "e" "h"]
```

---

### `vec(coll)`

Converts collection to vector (array).

```lisp
(vec (take 3 [1 2 3 4]))           ;; → [1 2 3]
(vec "hello")                      ;; → ["h" "e" "l" "l" "o"]
```

**Same as:** `doall`

---

### `set(coll)`

Converts collection to set (unique values).

```lisp
(set [1 2 2 3 1])                  ;; → Set{1, 2, 3}
```

---

## Conversions

### String Conversions

- `str(x)` - Convert to string
- `int(x)` - Convert to integer
- `float(x)` - Convert to float
- `bool(x)` - Convert to boolean

### Collection Conversions

- `vec(coll)` - Convert to vector/array
- `set(coll)` - Convert to set
- `list(coll)` - Convert to list

---

## Performance Notes

### Lazy by Default

Most stdlib functions return lazy sequences that are only realized when needed:

```lisp
;; This doesn't compute anything yet
(var lazyResult (map (fn [x] (* x 2)) (range 1000000)))

;; This realizes only first 5 elements
(take 5 lazyResult)   ;; Efficient!
```

### Force Realization

Use `doall` or `vec` to force realization:

```lisp
(doall (map inc [1 2 3]))          ;; → [2 3 4] (array)
```

### Infinite Sequences

Some operations create infinite sequences - always limit them:

```lisp
(take 10 (iterate inc 0))          ;; ✅ Safe
(doall (iterate inc 0))            ;; ❌ NEVER DO THIS - infinite loop!
```

---

## Testing

Run stdlib tests:

```bash
deno task test:unit
```

---

## Summary

All stdlib functions are:

- Lazy by default (where applicable)
- Immutable (return new values, don't mutate)
- Composable (work well together)

---

**See Also:**

- [Built-in Functions](./builtins.md) - Runtime built-ins (+, -, *, get, js-call)
- [Runtime API](./runtime.md) - HQL runtime environment
