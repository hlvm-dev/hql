# Error Handling

**Source:** `src/hql/transpiler/pipeline/transform/try-catch.ts`, `src/hql/transpiler/syntax/conditional.ts`

HQL provides structured error handling via `try`/`catch`/`finally`/`throw`. All error handling forms are expressions that return values, achieved through automatic IIFE wrapping.

## Summary

- `try`/`catch`/`finally` with expression semantics (returns a value)
- Auto-IIFE wrapping makes `try` blocks usable anywhere an expression is expected
- Catch clause supports named parameter `(catch e ...)` or parameterless `(catch ...)`
- Async detection: automatically wraps IIFE in `await` if body contains `await`
- Generator detection: automatically wraps IIFE in `yield*` if body contains `yield`
- `(throw expr)` for throwing errors

## Quick Example

```lisp
;; try/catch as expression
(let result (try
  (JSON.parse input)
  (catch e "default")))

;; try/catch/finally
(try
  (open-connection)
  (send-data payload)
  (catch e (log-error e))
  (finally (close-connection)))

;; throw
(throw (new Error "something went wrong"))
```

## Supported Combinations

| Form | Example |
|------|---------|
| try-only | `(try body...)` |
| try + catch | `(try body... (catch e handler...))` |
| try + finally | `(try body... (finally cleanup...))` |
| try + catch + finally | `(try body... (catch e handler...) (finally cleanup...))` |
| throw | `(throw expr)` |

## See Also

- [spec.md](./spec.md) - Technical specification
- [examples.hql](./examples.hql) - More examples
