# `asyncMap` — Sequential Async Map

**Status**: IMPLEMENTED
**File**: `src/hql/lib/stdlib/js/core.js` + `src/hql/lib/stdlib/js/index.js`
**Depends on**: Nothing (pure utility)

---

## What It Is

Maps an async function over a collection **sequentially** — processes one element at a time, awaiting each result before starting the next.

Essential for AI function composition because `ai` returns a Promise. HQL's built-in `map` is synchronous (lazy sequences) — it cannot await async results. `asyncMap` fills this gap.

## Why Sequential?

- **Rate-limit safe**: API providers (OpenAI, Anthropic) have rate limits. Firing 100 concurrent requests gets throttled or rejected. Sequential processing respects limits.
- **Order-dependent**: When each call depends on context from previous results.
- **Resource-friendly**: Lower memory/connection usage than concurrent.

## Signature

```
asyncMap(fn, coll) → Promise<Array>
```

| Parameter | Type                    | Description                        |
|-----------|-------------------------|------------------------------------|
| `fn`      | `(item) → Promise<any>` | Async function applied to each item |
| `coll`    | iterable                | Collection to map over             |
| **Returns** | `Promise<Array>`      | Array of resolved results, in order |

## Usage in HQL

```lisp
;; Basic: analyze reviews one at a time
(def results (await (asyncMap
  (fn [r] (ai "analyze sentiment" {data: r}))
  reviews)))
;; results = ["positive review...", "negative review...", ...]

;; With generable schema
(generable Sentiment {
  sentiment: (case "positive" "negative" "neutral")
  score:     number})

(def analyzed (await (asyncMap
  (fn [r] (ai "classify" {data: r schema: Sentiment}))
  reviews)))
;; analyzed = [{sentiment: "positive", score: 0.9}, ...]

;; Rate-limited API calls
(def translations (await (asyncMap
  (fn [text] (ai "translate to Korean" {data: text model: "gpt-4"}))
  paragraphs)))

;; Non-AI usage: any async operation
(def files (await (asyncMap
  (async fn [path] (await (readFile path)))
  filePaths)))
```

## How It Compares

```lisp
;; SYNC map — HQL built-in (lazy, cannot await)
(map inc [1 2 3])        ;; => (2 3 4) — works for sync functions

;; ASYNC map — sequential (this function)
(await (asyncMap
  (fn [x] (ai "process" {data: x}))
  items))                ;; => [result1, result2, ...] — one at a time

;; CONCURRENT map — parallel (see concurrentMap spec)
(await (concurrentMap
  (fn [x] (ai "process" {data: x}))
  items))                ;; => [result1, result2, ...] — all at once
```

## Implementation

```javascript
export async function asyncMap(fn, coll) {
  const results = [];
  for (const item of coll) {
    results.push(await fn(item));
  }
  return results;
}
```

~5 lines. Uses `for...of` to support any iterable (arrays, sets, lazy sequences realized via the iterator protocol).

### Wiring in `index.js`

No special wiring needed. `core.js` exports are auto-included:

```javascript
// index.js already has:
export * from "./core.js";
```

The module loader auto-registers all exported functions from `index.js` to the REPL state.

## Naming

`asyncMap` follows the stdlib's camelCase convention: `mapIndexed`, `groupBy`, `deepEq`, `chunkedMap`.

Alternatives considered and rejected:
- `amap` — Clojure-ism, not self-documenting
- `async-map` — kebab-case, not the stdlib convention
- `sequentialMap` — verbose, "async" already implies one-at-a-time
- `mapAsync` — reads as "map, but async" (correct), but `asyncMap` scans better as a function name

## Error Handling

If the async function throws for any element, `asyncMap` rejects immediately with that error. Already-completed results are discarded (standard Promise behavior). The caller catches with `try/catch`:

```lisp
(try
  (await (asyncMap (fn [r] (ai "analyze" {data: r})) reviews))
  (catch e (print "Failed on one review:" e.message)))
```

## Test Plan

1. `asyncMap(async fn, [1 2 3])` returns `[result1, result2, result3]`
2. Results are in order (same order as input)
3. Calls are sequential (second call starts after first resolves)
4. Works with empty collection → returns `[]`
5. Error in fn → Promise rejects
6. Works with iterables (Set, generator) not just arrays
