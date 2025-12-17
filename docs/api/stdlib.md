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

Returns true if any element satisfies predicate.

```lisp
(some even? [1 3 5])               ;; → false
(some even? [1 2 3])               ;; → true
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

### `assoc(map, key, value)`

Associates key with value in map, returning new map.

```lisp
(assoc {a: 1} "b" 2)               ;; → {a: 1, b: 2}
(assoc {} "x" 10)                  ;; → {x: 10}
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
