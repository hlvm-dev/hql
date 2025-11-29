# HQL Standard Library

**Location:** `core/lib/stdlib/js/stdlib.js` **Tests:** 9 test files, 436 tests
**Status:** ✅ Production ready

---

## Overview

HQL's standard library provides functional programming utilities for working
with collections, sequences, and data transformations. All functions are lazy by
default and support both arrays and lazy sequences.

**Import:**

```typescript
const stdlib = await import("core/lib/stdlib/js/stdlib.js");
```

---

## Sequence Primitives (Lisp Trinity)

### `first(coll)`

Returns the first element of a collection.

```lisp
(first [1 2 3])        ;; → 1
(first "hello")        ;; → "h"
(first [])             ;; → undefined
```

**Tested:** 5 tests (arrays, strings, empty, null, lazy sequences)

---

### `rest(coll)`

Returns all but the first element as a lazy sequence.

```lisp
(rest [1 2 3])         ;; → (2 3)
(rest [1])             ;; → ()
(rest [])              ;; → ()
```

**Lazy:** Yes - returns lazy sequence **Tested:** 6 tests (arrays, empty, lazy
sequences)

---

### `cons(item, coll)`

Prepends an item to a collection, returning a lazy sequence.

```lisp
(cons 1 [2 3])         ;; → (1 2 3)
(cons 0 [])            ;; → (0)
```

**Lazy:** Yes **Tested:** 4 tests

---

## Sequence Operations

### `take(n, coll)`

Takes the first `n` elements from a collection as a lazy sequence.

```lisp
(take 3 [1 2 3 4 5])   ;; → (1 2 3)
(take 10 [1 2])        ;; → (1 2)
(take 0 [1 2])         ;; → ()
```

**Lazy:** Yes **Tested:** 5 tests (basic, empty, zero, lazy chains)

---

### `drop(n, coll)`

Drops the first `n` elements from a collection, returning lazy sequence.

```lisp
(drop 2 [1 2 3 4 5])   ;; → (3 4 5)
(drop 10 [1 2])        ;; → ()
```

**Lazy:** Yes **Tested:** 4 tests

---

### `concat(...colls)`

Concatenates multiple collections into a lazy sequence.

```lisp
(concat [1 2] [3 4])   ;; → (1 2 3 4)
(concat [] [1])        ;; → (1)
(concat [1] [] [2])    ;; → (1 2)
```

**Lazy:** Yes **Tested:** 5 tests

---

### `flatten(coll)`

Flattens nested collections one level deep.

```lisp
(flatten [[1 2] [3 4]])      ;; → (1 2 3 4)
(flatten [1 [2 3] 4])        ;; → (1 2 3 4)
(flatten [[[1]] [2]])        ;; → ([1] 2) ; only one level
```

**Lazy:** Yes **Tested:** 3 tests

---

### `distinct(coll)`

Returns lazy sequence of unique elements (preserves first occurrence).

```lisp
(distinct [1 2 2 3 1])       ;; → (1 2 3)
(distinct "hello")           ;; → ("h" "e" "l" "o")
```

**Lazy:** Yes **Tested:** 3 tests

---

### `range([start,] end [, step])`

Generates a lazy sequence of numbers.

```lisp
(range 5)                    ;; → (0 1 2 3 4)
(range 2 5)                  ;; → (2 3 4)
(range 0 10 2)               ;; → (0 2 4 6 8)
```

**Lazy:** Yes **Tested:** 4 tests

---

## Collection Transformations

### `map(fn, coll)`

Applies function to each element, returning lazy sequence.

```lisp
(map (fn [x] (* x 2)) [1 2 3])     ;; → (2 4 6)
(map str [1 2 3])                  ;; → ("1" "2" "3")
```

**Lazy:** Yes **Tested:** 87 tests (in stdlib-fundamentals)

---

### `filter(pred, coll)`

Returns lazy sequence of elements satisfying predicate.

```lisp
(filter even? [1 2 3 4])           ;; → (2 4)
(filter (fn [x] (> x 5)) [3 6 9])  ;; → (6 9)
```

**Lazy:** Yes **Tested:** Multiple tests

---

### `reduce(fn, init, coll)`

Reduces collection to single value.

```lisp
(reduce + 0 [1 2 3 4])             ;; → 10
(reduce * 1 [1 2 3 4])             ;; → 24
```

**Lazy:** No (must realize entire collection) **Tested:** Multiple tests

---

## Predicates

### `isEmpty(coll)`

Returns true if collection is empty.

```lisp
(isEmpty [])                       ;; → true
(isEmpty [1])                      ;; → false
(isEmpty nil)                      ;; → true
```

**Tested:** 3 tests

---

### `some(pred, coll)`

Returns true if any element satisfies predicate.

```lisp
(some even? [1 3 5])               ;; → false
(some even? [1 2 3])               ;; → true
```

**Tested:** Multiple tests

---

## Realization

### `doall(coll)`

Forces realization of lazy sequence, returning array.

```lisp
(doall (take 3 [1 2 3 4]))         ;; → [1 2 3]
(doall (map inc [1 2 3]))          ;; → [2 3 4]
```

**Use:** When you need an actual array instead of lazy sequence **Tested:**
Multiple tests

---

### `realized(seq)`

Checks if a sequence has been realized.

```lisp
(var lazySeq (take 5 [1 2 3 4 5]))
(realized lazySeq)                 ;; → false
(doall lazySeq)
(realized lazySeq)                 ;; → true
```

**Tested:** Multiple tests

---

## Higher-Order Functions

### `comp(...fns)`

Composes functions right-to-left.

```lisp
(var addThenDouble (comp (fn [x] (* x 2)) (fn [x] (+ x 1))))
(addThenDouble 5)                  ;; → 12  ; (5 + 1) * 2
```

**Tested:** Multiple tests

---

### `partial(fn, ...args)`

Partially applies arguments to a function.

```lisp
(var add10 (partial + 10))
(add10 5)                          ;; → 15
(add10 20)                         ;; → 30
```

**Tested:** Multiple tests

---

### `apply(fn, args)`

Applies function to array of arguments.

```lisp
(apply + [1 2 3 4])                ;; → 10
(apply max [5 2 9 1])              ;; → 9
```

**Tested:** Multiple tests

---

## Map Operations

**Test File:** `test/stdlib-map-ops.test.ts` (93 tests)

### `assoc(map, key, value)`

Associates key with value in map, returning new map.

```lisp
(assoc {:a 1} :b 2)                ;; → {:a 1 :b 2}
(assoc {} :x 10)                   ;; → {:x 10}
```

**Immutable:** Returns new map

---

### `dissoc(map, key)`

Removes key from map, returning new map.

```lisp
(dissoc {:a 1 :b 2} :b)            ;; → {:a 1}
```

**Immutable:** Returns new map

---

### `merge(...maps)`

Merges multiple maps, later values override.

```lisp
(merge {:a 1} {:b 2})              ;; → {:a 1 :b 2}
(merge {:a 1} {:a 2})              ;; → {:a 2}
```

**Immutable:** Returns new map

---

### `keys(map)`

Returns all keys from map.

```lisp
(keys {:a 1 :b 2})                 ;; → [:a :b]
```

---

### `vals(map)`

Returns all values from map.

```lisp
(vals {:a 1 :b 2})                 ;; → [1 2]
```

---

### `select-keys(map, keys)`

Returns map with only specified keys.

```lisp
(select-keys {:a 1 :b 2 :c 3} [:a :c])   ;; → {:a 1 :c 3}
```

---

### `rename-keys(map, key-map)`

Renames keys according to key-map.

```lisp
(rename-keys {:a 1 :b 2} {:a :x :b :y})  ;; → {:x 1 :y 2}
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

**Tested:** Multiple tests

---

## Generators

### `iterate(fn, initial)`

Generates infinite lazy sequence by repeatedly applying function.

```lisp
(take 5 (iterate (fn [x] (+ x 1)) 0))     ;; → (0 1 2 3 4)
(take 4 (iterate (fn [x] (* x 2)) 1))     ;; → (1 2 4 8)
```

**Lazy:** Yes (infinite sequence!) **Tested:** Multiple tests

---

## Utilities

### `count(coll)`

Returns count of elements in collection.

```lisp
(count [1 2 3])                    ;; → 3
(count "hello")                    ;; → 5
(count [])                         ;; → 0
```

**Note:** Forces realization of lazy sequences **Tested:** Multiple tests

---

### `nth(coll, n [, notFound])`

Returns element at index n.

```lisp
(nth [1 2 3] 1)                    ;; → 2
(nth [1 2 3] 10)                   ;; → undefined
(nth [1 2 3] 10 "n/a")             ;; → "n/a"
```

**Tested:** Multiple tests

---

### `last(coll)`

Returns last element of collection.

```lisp
(last [1 2 3])                     ;; → 3
(last [])                          ;; → undefined
```

**Note:** Forces realization of lazy sequences **Tested:** Multiple tests

---

### `second(coll)`

Returns second element of collection.

```lisp
(second [1 2 3])                   ;; → 2
(second [1])                       ;; → undefined
```

**Tested:** Multiple tests

---

### `vec(coll)`

Converts collection to vector (array).

```lisp
(vec (take 3 [1 2 3 4]))           ;; → [1 2 3]
(vec "hello")                      ;; → ["h" "e" "l" "l" "o"]
```

**Same as:** `doall` **Tested:** Multiple tests

---

### `set(coll)`

Converts collection to set (unique values).

```lisp
(set [1 2 2 3 1])                  ;; → Set{1, 2, 3}
```

**Tested:** Multiple tests

---

## Conversions

**Test File:** `test/stdlib-conversions.test.ts` (20 tests)

### String Conversions

- `str(x)` - Convert to string
- `int(x)` - Convert to integer
- `float(x)` - Convert to float
- `bool(x)` - Convert to boolean

### Collection Conversions

- `vec(coll)` - Convert to vector/array
- `set(coll)` - Convert to set
- `list(coll)` - Convert to list

**Tested:** 20 tests covering all conversions

---

## Autoloading

**Test File:** `test/stdlib-autoload.test.ts` (28 tests)

The stdlib supports automatic loading and initialization:

- Functions are available without explicit imports
- Lazy sequences are auto-realized when needed
- Performance optimization for repeated calls

**Tested:** 28 tests

---

## Week-by-Week Coverage

Additional functions documented across weekly test files:

### Week 1 (45 tests)

- Basic sequence operations
- Collection fundamentals
- Predicate functions

### Week 2 (54 tests)

- Advanced transformations
- Nested operations
- Error handling

### Week 3 (49 tests)

- Map operations deep-dive
- Immutability patterns
- Performance tests

### Week 4 (30 tests)

- Higher-order functions
- Function composition
- Currying patterns

### Week 5 (30 tests)

- Lazy evaluation edge cases
- Memory efficiency
- Stream processing

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
# All stdlib tests (436 tests)
deno task test:stdlib

# Individual test files
deno test --allow-all test/stdlib-fundamentals.test.ts
deno test --allow-all test/stdlib-map-ops.test.ts
```

---

## Summary

**Total Functions:** 40+ documented **Test Coverage:** 436 tests across 9 test
files **Paradigm:** Functional, lazy, immutable **Status:** ✅ Production ready

All stdlib functions are:

- ✅ Tested with comprehensive test suite
- ✅ Lazy by default (where applicable)
- ✅ Immutable (return new values, don't mutate)
- ✅ Composable (work well together)
- ✅ Performance-optimized

---

**See Also:**

- [Built-in Functions](./builtins.md) - Runtime built-ins (+, -, *, get,
  js-call)
- [Runtime API](./runtime.md) - HQL runtime environment
