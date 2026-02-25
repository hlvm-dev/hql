# 23. Standard Library Reference

## Overview
The HQL standard library provides 107+ functions for functional programming. ~96% are self-hosted in HQL (`stdlib.hql`); only true primitives (first, rest, cons, seq, range) are implemented in JavaScript.

All sequence operations are **lazy by default** — elements are computed on demand.

## 1. Sequence Primitives

These are the foundational functions implemented in JavaScript (`core.js`).

| Function | Signature | Description | Lazy |
|----------|-----------|-------------|------|
| `first` | `(first coll)` | First element. O(1) for arrays. | No |
| `rest` | `(rest coll)` | All elements after first. Returns empty seq (not nil). | Yes |
| `cons` | `(cons item coll)` | Prepend item to collection. Returns Cons cell. | No |
| `seq` | `(seq coll)` | Convert to lazy seq. Returns null if empty (nil-punning). | Yes |
| `next` | `(next coll)` | Like `(seq (rest coll))`. Returns null if no more elements. | Yes |

## 2. Collection Operations

| Function | Signature | Description | Lazy |
|----------|-----------|-------------|------|
| `take` | `(take n coll)` | First n elements. | Yes |
| `drop` | `(drop n coll)` | Skip first n elements. | Yes |
| `map` | `(map f coll)` | Apply f to each element. Multi-collection: `(map f c1 c2)`. | Yes |
| `filter` | `(filter pred coll)` | Keep elements where pred is truthy. | Yes |
| `reduce` | `(reduce f init coll)` | Reduce to single value. Supports early termination via `(reduced val)`. | No |
| `concat` | `(concat & colls)` | Concatenate multiple collections. Stack-safe. | Yes |
| `flatten` | `(flatten coll)` | Recursively flatten nested collections. | Yes |
| `distinct` | `(distinct coll)` | Remove duplicates (uses Set). | Yes |
| `count` | `(count coll)` | Number of elements. O(1) for arrays/strings. | No |
| `last` | `(last coll)` | Last element. O(1) for arrays. | No |
| `nth` | `(nth coll idx)` | Element at index. Optional not-found value: `(nth coll idx default)`. | No |
| `second` | `(second coll)` | Alias for `(nth coll 1 nil)`. | No |
| `reverse` | `(reverse coll)` | Reverse a collection. | No |
| `conj` | `(conj coll & items)` | Add items to collection (end for vectors, front for seqs). | No |
| `empty` | `(empty coll)` | Return empty collection of same type. | No |
| `vec` | `(vec coll)` | Convert any collection to a concrete array. | No |
| `set` | `(set coll)` | Convert collection to a Set. | No |
| `doall` | `(doall coll)` | Force realization of entire lazy seq. Returns array. | No |

## 3. Higher-Order Functions

| Function | Signature | Description | Lazy |
|----------|-----------|-------------|------|
| `mapIndexed` | `(mapIndexed f coll)` | Map with (index, item). | Yes |
| `keepIndexed` | `(keepIndexed f coll)` | Map-filter with indices, keeps non-nil results. | Yes |
| `mapcat` | `(mapcat f coll)` | Map then flatten one level. | Yes |
| `keep` | `(keep f coll)` | Map-filter: keeps non-nil results of f. | Yes |

## 4. Conditional Lazy Operations

| Function | Signature | Description | Lazy |
|----------|-----------|-------------|------|
| `takeWhile` | `(takeWhile pred coll)` | Take while predicate is true. | Yes |
| `dropWhile` | `(dropWhile pred coll)` | Drop while predicate is true. | Yes |
| `splitWith` | `(splitWith pred coll)` | Returns `[(takeWhile pred coll) (dropWhile pred coll)]`. | No |
| `splitAt` | `(splitAt n coll)` | Returns `[(take n coll) (drop n coll)]`. | No |

## 5. Reduction Variants

| Function | Signature | Description | Lazy |
|----------|-----------|-------------|------|
| `reductions` | `(reductions f init coll)` | Lazy seq of intermediate reduce values. | Yes |
| `reduced` | `(reduced val)` | Early termination marker for reduce. | No |

## 6. Sequence Combinators

| Function | Signature | Description | Lazy |
|----------|-----------|-------------|------|
| `interpose` | `(interpose sep coll)` | Insert separator between elements. | Yes |
| `interleave` | `(interleave & colls)` | Interleave multiple sequences. | Yes |

## 7. Partition Family

| Function | Signature | Description | Lazy |
|----------|-----------|-------------|------|
| `partition` | `(partition n coll)` | Partition into groups of n. Drops incomplete. | Yes |
| `partition` | `(partition n step coll)` | With explicit step size. | Yes |
| `partitionAll` | `(partitionAll n coll)` | Like partition but includes incomplete final group. | Yes |
| `partitionBy` | `(partitionBy f coll)` | Partition when function result changes. O(n). | Yes |

## 8. Predicates

| Function | Signature | Description | Lazy |
|----------|-----------|-------------|------|
| `isEmpty` | `(isEmpty coll)` | True if collection is empty. | No |
| `some` | `(some pred coll)` | First truthy result of pred, or nil. | No |
| `every` | `(every pred coll)` | True if pred is truthy for all items. | No |
| `notAny` | `(notAny pred coll)` | True if pred is false for all items. | No |
| `notEvery` | `(notEvery pred coll)` | True if pred is false for at least one item. | No |
| `isSome` | `(isSome x)` | True if x is not nil. | No |
| `deepEq` | `(deepEq a b)` | Deep structural equality (recursive). | No |

## 9. Type Predicates

| Function | Signature | Description |
|----------|-----------|-------------|
| `isNil` | `(isNil x)` | `(== x null)` |
| `isEven` | `(isEven n)` | `(=== (% n 2) 0)` |
| `isOdd` | `(isOdd n)` | `(!== (% n 2) 0)` |
| `isZero` | `(isZero n)` | `(=== n 0)` |
| `isPositive` | `(isPositive n)` | `(> n 0)` |
| `isNegative` | `(isNegative n)` | `(< n 0)` |
| `isNumber` | `(isNumber x)` | `(=== (typeof x) "number")` |
| `isString` | `(isString x)` | `(=== (typeof x) "string")` |
| `isBoolean` | `(isBoolean x)` | `(=== (typeof x) "boolean")` |
| `isFunction` | `(isFunction x)` | `(=== (typeof x) "function")` |
| `isArray` | `(isArray x)` | `(Array.isArray x)` |
| `isObject` | `(isObject x)` | Plain objects (not arrays, not nil) |

## 10. Delay and Force

| Function | Signature | Description |
|----------|-----------|-------------|
| `delay` | `(delay expr)` | Create deferred computation. |
| `force` | `(force d)` | Realize a delayed value. |
| `realized` | `(realized d)` | Check if delay has been forced. |
| `isDelay` | `(isDelay x)` | Check if x is a Delay. |

## 11. Lazy Constructors

| Function | Signature | Description | Lazy |
|----------|-----------|-------------|------|
| `range` | `(range)` | 0, 1, 2, ... infinity | Yes |
| `range` | `(range end)` | 0 to end-1 | Yes |
| `range` | `(range start end)` | start to end-1 | Yes |
| `range` | `(range start end step)` | With custom step | Yes |
| `repeat` | `(repeat x)` | x, x, x, ... infinity | Yes |
| `cycle` | `(cycle coll)` | Repeat collection infinitely | Yes |
| `iterate` | `(iterate f x)` | x, f(x), f(f(x)), ... | Yes |
| `repeatedly` | `(repeatedly f)` | f(), f(), f(), ... infinity | Yes |
| `lazy-seq` | `(lazy-seq body)` | Create lazy sequence from thunk | Yes |

## 12. Transducers

| Function | Signature | Description |
|----------|-----------|-------------|
| `transduce` | `(transduce xform rf init coll)` | Transform and reduce in one pass. |
| `into` | `(into to xform from)` | Transform and collect into target collection. |
| `reduced` | `(reduced val)` | Early termination for reduce/transduce. |
| `isReduced` | `(isReduced x)` | Check if value is reduced. |
| `unreduced` | `(unreduced x)` | Unwrap reduced value. |

Transducer-producing functions (pass 0 args for xform): `map`, `filter`, `take`, `drop`, `takeWhile`, `dropWhile`, `distinct`, `mapcat`, `keep`, `partition`, `partitionAll`, `interpose`.

## 13. Map/Object Operations

| Function | Signature | Description |
|----------|-----------|-------------|
| `keys` | `(keys m)` | Get all keys. |
| `vals` | `(vals m)` | Get all values. |
| `assoc` | `(assoc m k v)` | Associate key with value (returns new map). |
| `dissoc` | `(dissoc m k)` | Remove key (returns new map). |
| `merge` | `(merge & maps)` | Merge maps (later wins). |
| `get` | `(get m k)` | Get value by key. |
| `getIn` | `(getIn m path)` | Get nested value by path. |
| `assocIn` | `(assocIn m path v)` | Set nested value. |
| `updateIn` | `(updateIn m path f)` | Update nested value with function. |
| `update` | `(update m key f)` | Update value at key with function. |
| `zipmap` | `(zipmap keys vals)` | Create map from parallel key and value sequences. |

## 14. Sorting and Grouping

| Function | Signature | Description |
|----------|-----------|-------------|
| `sort` | `(sort coll)` | Sort with natural ordering. |
| `sortBy` | `(sortBy f coll)` | Sort by key function. |
| `groupBy` | `(groupBy f coll)` | Group elements by function result. |

## 15. Other Utilities

| Function | Signature | Description |
|----------|-----------|-------------|
| `identity` | `(identity x)` | Returns x unchanged. |
| `constantly` | `(constantly x)` | Returns function that always returns x. |
| `comp` | `(comp & fns)` | Compose functions (right to left). |
| `partial` | `(partial f & args)` | Partially apply arguments. |
| `juxt` | `(juxt & fns)` | Juxtapose: apply multiple fns, return vector of results. |
| `apply` | `(apply f args)` | Apply function to argument list. |
| `symbol` | `(symbol n)` | Convert to symbol string. |
| `keyword` | `(keyword n)` | Convert to keyword string (`:` prefix). |
| `name` | `(name x)` | Get name of symbol/keyword (without `:` prefix). |

## 16. Arithmetic Wrappers

First-class function versions of operators for use with `map`, `reduce`, etc.

| Function | Signature | Description |
|----------|-----------|-------------|
| `abs` | `(abs x)` | Absolute value. |
| `add` | `(add & nums)` | Addition as function. |
| `sub` | `(sub & nums)` | Subtraction as function. |
| `mul` | `(mul & nums)` | Multiplication as function. |
| `div` | `(div & nums)` | Division as function. |
| `mod` | `(mod a b)` | Modulo as function. |
| `lt` | `(lt a b)` | Less-than as function. |
| `gt` | `(gt a b)` | Greater-than as function. |
| `lte` | `(lte a b)` | Less-than-or-equal as function. |
| `gte` | `(gte a b)` | Greater-than-or-equal as function. |

## Implementation

- **Self-hosted (HQL):** `src/hql/lib/stdlib/stdlib.hql` -- 107+ functions
- **JS primitives:** `src/hql/lib/stdlib/js/core.js` -- first, rest, cons, seq, range, chunked operations
- **Seq protocol:** `src/hql/lib/stdlib/js/internal/seq-protocol.js` -- Cons, LazySeq, toSeq

## Self-Hosting Architecture

~96% of the standard library is implemented in HQL itself. Only true primitives that require direct JavaScript for performance or bootstrapping remain in JS:

| Layer | Language | Functions |
|-------|----------|-----------|
| **Primitives** | JavaScript | first, rest, cons, seq, range, lazy-seq, chunked* |
| **Core** | HQL | map, filter, reduce, take, drop, concat, ... |
| **Extended** | HQL | partition, groupBy, transducers, ... |
| **Predicates** | HQL | isNil, isEven, isEmpty, some, every, ... |
