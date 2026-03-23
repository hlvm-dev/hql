# `concurrentMap` — Concurrent Async Map

**Status**: TODO
**File**: `src/hql/lib/stdlib/js/core.js` + `src/hql/lib/stdlib/js/index.js`
**Depends on**: Nothing (pure utility)

---

## What It Is

Maps an async function over a collection **concurrently** — fires all calls at once and waits for all to complete. Wrapper around `Promise.all` with cleaner ergonomics.

## Why Concurrent?

- **Fast**: N items processed in the time of 1 (wall-clock). All requests in-flight simultaneously.
- **Best for**: Independent operations where each call doesn't depend on the others.
- **Trade-off**: Hits API rate limits with large collections. Use `asyncMap` when rate-limiting matters.

## Signature

```
concurrentMap(fn, coll) → Promise<Array>
```

| Parameter | Type                    | Description                        |
|-----------|-------------------------|------------------------------------|
| `fn`      | `(item) → Promise<any>` | Async function applied to each item |
| `coll`    | iterable                | Collection to map over             |
| **Returns** | `Promise<Array>`      | Array of resolved results, in order |

## Usage in HQL

```lisp
;; Analyze all reviews in parallel
(generable Sentiment {
  sentiment: (case "positive" "negative" "neutral")
  score:     number})

(def analyzed (await (concurrentMap
  (fn [r] (ai "analyze" {data: r schema: Sentiment}))
  reviews)))
;; All requests fire simultaneously, results in original order

;; Translate multiple texts at once
(def translations (await (concurrentMap
  (fn [t] (ai "translate to Korean" {data: t}))
  paragraphs)))

;; Fetch multiple URLs concurrently
(def pages (await (concurrentMap
  (async fn [url] (await (fetch url)))
  urls)))

;; Full pipeline
(def reviews ["great product" "terrible service" "meh"])
(def sentiments (await (concurrentMap
  (fn [r] (ai "classify" {data: r schema: Sentiment}))
  reviews)))
(def summary (ai "summarize patterns" {data: sentiments}))
(agent "save report" {data: {sentiments: sentiments summary: summary}})
```

## How It Compares to `asyncMap`

```lisp
;; asyncMap — sequential: A→wait→B→wait→C→wait→done
;; Total time: time(A) + time(B) + time(C)
(await (asyncMap fn items))

;; concurrentMap — concurrent: A,B,C→wait→done
;; Total time: max(time(A), time(B), time(C))
(await (concurrentMap fn items))
```

| Aspect         | `asyncMap`                  | `concurrentMap`              |
|----------------|-----------------------------|------------------------------|
| Execution      | One at a time               | All at once                  |
| Speed          | Slow (sum of all)           | Fast (max of all)            |
| Rate limits    | Safe                        | Can hit limits               |
| Memory         | Low (one result at a time)  | Higher (all in-flight)       |
| When to use    | Rate-limited APIs, ordering | Independent operations, speed|

## What It Replaces

Without `concurrentMap`, users write:

```lisp
(await (Promise.all (.map reviews (fn [r] (ai "analyze" {data: r})))))
```

With `concurrentMap`:

```lisp
(await (concurrentMap (fn [r] (ai "analyze" {data: r})) reviews))
```

Same result. Cleaner. Consistent with `asyncMap`. Follows HQL's functional style (function first, collection second) instead of method-chain style (`.map`).

## Implementation

```javascript
export async function concurrentMap(fn, coll) {
  return Promise.all(Array.from(coll).map(fn));
}
```

~3 lines. `Array.from(coll)` converts any iterable to array for `.map()`. `Promise.all` waits for all.

### Wiring in `index.js`

No special wiring needed. `core.js` exports are auto-included:

```javascript
// index.js already has:
export * from "./core.js";
```

## Naming

`concurrentMap` follows the stdlib's camelCase convention: `mapIndexed`, `groupBy`, `chunkedMap`.

Alternatives considered and rejected:
- `pmap` — Clojure-ism, cryptic
- `parallelMap` — implies true thread-level parallelism (JS is single-threaded). "Concurrent" is technically accurate: multiple async operations in-flight on one thread.
- `mapConcurrent` — reads as "map, concurrently" but `concurrentMap` scans better as a function name
- `Promise.all + .map` — verbose, not functional-style argument order

## Error Handling

If ANY async function throws, `concurrentMap` rejects with the first error (standard `Promise.all` behavior). All other in-flight calls continue to completion but their results are discarded.

For "settle all, report errors separately", users can use `Promise.allSettled` directly:

```lisp
;; Fail-fast (concurrentMap)
(try
  (await (concurrentMap fn items))
  (catch e (print "One failed:" e.message)))

;; Settle all (manual)
(def results (await (Promise.allSettled (.map items fn))))
(def succeeded (.filter results (fn [r] (=== r.status "fulfilled"))))
(def failed (.filter results (fn [r] (=== r.status "rejected"))))
```

## Test Plan

1. `concurrentMap(async fn, [1 2 3])` returns `[result1, result2, result3]`
2. Results are in order (same order as input)
3. Calls are concurrent (all start before any completes)
4. Works with empty collection → returns `[]`
5. Error in any fn → Promise rejects with first error
6. Works with iterables (Set, generator) not just arrays
7. Faster than asyncMap for same workload (wall-clock)
