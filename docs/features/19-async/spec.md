# Async & Generators Technical Specification

**Source:** `src/hql/transpiler/pipeline/transform/async-generators.ts`

## Grammar

```ebnf
async-fn      ::= '(' 'async' 'fn' name? params body... ')'
async-gen-fn  ::= '(' 'async' 'fn*' name? params body... ')'
gen-fn        ::= '(' 'fn*' name? params body... ')'
await-expr    ::= '(' 'await' expr ')'
yield-expr    ::= '(' 'yield' expr? ')'
yield-star    ::= '(' 'yield*' expr ')'
for-await     ::= '(' 'for-await-of' '[' binding iterable ']' body... ')'
```

## Overview

HQL provides first-class support for asynchronous programming and generators, mapping directly to JavaScript's `async`/`await`, `function*`/`yield`, and `async function*` constructs.

## Async Functions

### Syntax

```clojure
;; Named async function
(async fn fetch-data [url]
  (let response (await (js/fetch url)))
  (await (.json response)))

;; Anonymous async function
(let fetcher (async fn [url]
  (await (js/fetch url))))

;; Async with map parameters
(async fn connect {host: "localhost" port: 8080}
  (await (establish-connection host port)))
```

### Compilation

```clojure
(async fn fetch-data [url]
  (let response (await (js/fetch url)))
  (await (.json response)))
```

Compiles to:

```javascript
async function fetchData(url) {
  const response = await __hql_consume_async_iter(fetch(url));
  return await __hql_consume_async_iter(response.json());
}
```

### How `async` Works

The `async` keyword is a modifier that:
1. Validates the next form is `fn` or `fn*`
2. Delegates to the appropriate transformer (`transformFn` or `transformGeneratorFn`)
3. Sets the `async` flag on the resulting IR function node via `_setAsyncFlag()`

## Await

### Syntax

```clojure
(await promise-expr)
```

### Compilation

`await` wraps its argument in `__hql_consume_async_iter()`, a runtime helper that:
1. Awaits the value (handles Promises)
2. If the result is an async iterator, consumes it and returns concatenated string
3. Otherwise returns the awaited value unchanged

```clojure
(await (fetch-data url))
```

Compiles to:

```javascript
await __hql_consume_async_iter(fetchData(url))
```

### Validation

`await` requires exactly one argument. Zero or multiple arguments raise a `ValidationError`.

## Generator Functions

### Syntax

```clojure
;; Named generator
(fn* range-gen [start end]
  (var i start)
  (while (< i end)
    (yield i)
    (= i (+ i 1))))

;; Anonymous generator
(let nums (fn* []
  (yield 1)
  (yield 2)
  (yield 3)))
```

### Compilation

```clojure
(fn* countdown [n]
  (while (> n 0)
    (yield n)
    (= n (- n 1))))
```

Compiles to:

```javascript
function* countdown(n) {
  while (n > 0) {
    yield n;
    n = n - 1;
  }
}
```

### How `fn*` Works

The `fn*` form:
1. Delegates to `transformFn` (regular function transformation)
2. Sets the `generator` flag on the resulting IR node
3. Handles all function node types: `FunctionExpression`, `FunctionDeclaration`, `FnFunctionDeclaration`, `VariableDeclaration` (with function init)

## Yield

### Syntax

```clojure
(yield value)     ;; yield a value
(yield)           ;; yield undefined
```

### Compilation

```clojure
(yield 42)
```

Compiles to:

```javascript
yield 42
```

```clojure
(yield)
```

Compiles to:

```javascript
yield
```

### Validation

`yield` takes at most one argument. More than one argument raises a `ValidationError`.

## Yield Delegate (yield*)

### Syntax

```clojure
(yield* iterator-expr)
```

### Compilation

```clojure
(yield* [1 2 3])
```

Compiles to:

```javascript
yield* [1, 2, 3]
```

### Use Cases

- Delegating to another generator
- Yielding all values from an iterable

```clojure
(fn* combined []
  (yield* (range-gen 1 5))
  (yield* [10 20 30]))
```

### Validation

`yield*` requires exactly one argument.

## Async Generator Functions

### Syntax

```clojure
(async fn* fetch-pages [urls]
  (for-of [url urls]
    (let response (await (js/fetch url)))
    (yield (await (.json response)))))
```

### Compilation

```clojure
(async fn* paginate [start max-pages]
  (var page start)
  (while (<= page max-pages)
    (let data (await (fetch-page page)))
    (yield data)
    (= page (+ page 1))))
```

Compiles to:

```javascript
async function* paginate(start, maxPages) {
  let page = start;
  while (page <= maxPages) {
    const data = await __hql_consume_async_iter(fetchPage(page));
    yield data;
    page = page + 1;
  }
}
```

## For-Await-Of

### Syntax

```clojure
(for-await-of [item async-iterable]
  body...)
```

### Compilation

```clojure
(for-await-of [page (paginate 1 10)]
  (process-page page))
```

Compiles to:

```javascript
for await (const page of paginate(1, 10)) {
  processPage(page);
}
```

## Validation Rules

| Rule | Error |
|------|-------|
| `async` with no argument | `"async requires a function form"` |
| `async` with non-fn/fn* | `"async currently supports 'fn' and 'fn*' definitions"` |
| `await` with != 1 argument | `"await requires exactly one argument"` |
| `yield` with > 1 argument | `"yield takes at most one argument"` |
| `yield*` with != 1 argument | `"yield* requires exactly one argument"` |

## Invariants

1. **Async IIFE detection** -- `try` blocks containing `await` automatically get async IIFE wrappers
2. **Generator IIFE detection** -- `try` blocks containing `yield` automatically get generator IIFE wrappers
3. **Await wrapping** -- All `await` arguments pass through `__hql_consume_async_iter` for async iterator handling
4. **Position propagation** -- Source positions are copied from HQL nodes to IR nodes
5. **Parameter compatibility** -- Async and generator functions support all parameter styles (positional, map, multi-arity, destructuring)

## Feature Support Table

| Feature | `fn` | `async fn` | `fn*` | `async fn*` |
|---------|------|------------|-------|-------------|
| Named | Yes | Yes | Yes | Yes |
| Anonymous | Yes | Yes | Yes | Yes |
| Positional params | Yes | Yes | Yes | Yes |
| Map params | Yes | Yes | Yes | Yes |
| Multi-arity | Yes | Yes | Yes | Yes |
| Type annotations | Yes | Yes | Yes | Yes |
| TCO (self) | Yes | No | No | No |
| TCO (mutual) | Yes | No | Yes | No |
| `yield` | No | No | Yes | Yes |
| `yield*` | No | No | Yes | Yes |
| `await` | No | Yes | No | Yes |

## Implementation Location

- Async/generator transforms: `src/hql/transpiler/pipeline/transform/async-generators.ts`
- Function base: `src/hql/transpiler/pipeline/transform/function.ts`
- Runtime helper: `__hql_consume_async_iter` in `src/common/runtime-helper-impl.ts`
- Tests: `tests/unit/async.test.ts`, `tests/unit/generator.test.ts`
