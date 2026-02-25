# Async & Generators

**Source:** `src/hql/transpiler/pipeline/transform/async-generators.ts`

HQL provides first-class support for asynchronous programming and generators, mapping directly to JavaScript's `async`/`await` and `function*`/`yield` constructs.

## Summary

- **Async functions**: `(async fn name [params] body...)` -- compiles to `async function`
- **Await**: `(await expr)` -- wraps in `__hql_consume_async_iter` for async iterator support
- **Generator functions**: `(fn* name [params] body...)` -- compiles to `function*`
- **Yield**: `(yield value)` or `(yield)` for undefined
- **Yield delegate**: `(yield* iterable)` -- delegates to another iterator
- **Async generators**: `(async fn* name [params] body...)` -- combines both
- **For-await-of**: `(for-await-of [item iterable] body...)` -- async iteration

## Quick Examples

```lisp
;; Async function
(async fn fetch-user [id]
  (let response (await (js/fetch (+ "/api/users/" id))))
  (await (.json response)))

;; Generator function
(fn* range [start end]
  (var i start)
  (while (< i end)
    (yield i)
    (= i (+ i 1))))

;; Consume generator
(for-of [n (range 1 6)]
  (print n))  ;; prints 1 2 3 4 5

;; Async generator
(async fn* stream-pages [url]
  (var page 1)
  (while true
    (let data (await (fetch-page url page)))
    (if (isEmpty data) (return))
    (yield data)
    (= page (+ page 1))))
```

## See Also

- [spec.md](./spec.md) - Technical specification
- [examples.hql](./examples.hql) - More examples
