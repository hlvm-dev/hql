# Error Handling Technical Specification

**Source:** `src/hql/transpiler/pipeline/transform/try-catch.ts`

## Grammar

```ebnf
try-expr    ::= '(' 'try' body... catch-clause? finally-clause? ')'
catch-clause  ::= '(' 'catch' param? body... ')'
finally-clause ::= '(' 'finally' body... ')'
throw-expr  ::= '(' 'throw' expr ')'
```

## Overview

HQL provides structured error handling via `try`/`catch`/`finally`/`throw`. All error handling forms are **expressions** that return values. This is achieved through auto-IIFE wrapping of `try` blocks.

## Try/Catch/Finally

### Syntax

```clojure
;; try-only (no catch or finally)
(try
  (risky-operation))

;; try + catch with named parameter
(try
  (risky-operation)
  (catch e
    (handle-error e)))

;; try + catch without parameter
(try
  (risky-operation)
  (catch
    (fallback-value)))

;; try + finally
(try
  (open-resource)
  (finally
    (close-resource)))

;; try + catch + finally
(try
  (open-resource)
  (do-work)
  (catch e
    (log-error e))
  (finally
    (close-resource)))
```

### Compilation

All `try` expressions are wrapped in an IIFE (Immediately Invoked Function Expression) so they can be used as expressions that return values:

```clojure
(let result (try
  (parse-json input)
  (catch e "default")))
```

Compiles to:

```javascript
const result = (() => {
  try {
    return parseJson(input);
  } catch (e) {
    return "default";
  }
})();
```

### Catch Clause

The `catch` clause binds the caught error to a named parameter:

```clojure
(catch e (handle e))     ;; named parameter
(catch (fallback))       ;; parameterless
```

- When a symbol follows `catch`, it becomes the catch parameter identifier
- When no symbol follows, the catch clause has no parameter binding
- Only one `catch` clause is allowed per `try` block (multiple catch clauses raise a `ValidationError`)
- Catch body requires at least one expression

### Finally Clause

The `finally` clause executes cleanup code regardless of whether an error occurred:

```clojure
(finally (cleanup))
```

- Only one `finally` clause is allowed per `try` block
- Finally body requires at least one expression
- The finally block does NOT contribute to the return value (standard JS semantics)

### Multiple Body Expressions

The `try` body can contain multiple expressions. All expressions before `catch`/`finally` are part of the try body:

```clojure
(try
  (step-one)
  (step-two)
  (step-three)      ;; last expression is the return value
  (catch e
    (handle e)))
```

## Async Detection

When the try block, catch body, or finally body contains `await` expressions, the IIFE wrapper is automatically made `async` and the call is wrapped in `await`:

```clojure
(try
  (await (fetch-data url))
  (catch e
    (await (log-error e))))
```

Compiles to:

```javascript
await (async () => {
  try {
    return await __hql_consume_async_iter(fetchData(url));
  } catch (e) {
    return await __hql_consume_async_iter(logError(e));
  }
})();
```

## Generator Detection

When the try block, catch body, or finally body contains `yield` expressions, the IIFE wrapper is made a generator and the call is wrapped in `yield*`:

```clojure
(fn* producer [items]
  (try
    (for-of [item items]
      (yield item))
    (catch e
      (yield "error"))))
```

Compiles to:

```javascript
function* producer(items) {
  yield* (function* () {
    try {
      for (const item of items) {
        yield item;
      }
    } catch (e) {
      yield "error";
    }
  })();
}
```

## Throw

The `throw` form throws an error:

```clojure
(throw (new Error "Something went wrong"))
(throw "string error")
(throw e)  ;; rethrow caught error
```

**Note:** `throw` is handled by `src/hql/transpiler/syntax/conditional.ts` (alongside `return`), not by `try-catch.ts`.

## Validation Rules

| Rule | Error |
|------|-------|
| `try` with no body | `"try requires a body"` |
| `try` with empty body (all clauses, no expressions) | `"try requires at least one body expression"` |
| Multiple `catch` clauses | `"Multiple catch clauses are not supported"` |
| Multiple `finally` clauses | `"Multiple finally clauses are not supported"` |
| Empty `catch` body | `"catch requires a body"` |
| Empty `finally` body | `"finally requires a body"` |
| Unknown clause (not `catch`/`finally`) | `"Unknown clause 'X' in try statement"` |

## Invariants

1. **Expression semantics** -- `try` always returns a value via IIFE wrapping
2. **Single catch/finally** -- At most one of each clause is allowed
3. **Async propagation** -- `await` in any sub-block makes the IIFE async
4. **Generator propagation** -- `yield` in any sub-block makes the IIFE a generator
5. **Body ordering** -- Body expressions must come before `catch`/`finally` clauses
6. **Source positions** -- Position metadata is propagated from the original `try` list node

## Edge Cases

### Try with no catch or finally

Valid but uncommon. The try body is still IIFE-wrapped for expression semantics:

```clojure
(let result (try (compute-value)))
```

### Nested try blocks

Each `try` gets its own IIFE wrapper:

```clojure
(try
  (try
    (inner-operation)
    (catch e1 (handle-inner e1)))
  (catch e2 (handle-outer e2)))
```

### Tail calls inside try

Recursive calls inside `try`/`catch`/`finally` are NOT in tail position (per JavaScript semantics) and will not be optimized by TCO.

## Implementation Location

- Try/catch/finally: `src/hql/transpiler/pipeline/transform/try-catch.ts`
- Throw/return: `src/hql/transpiler/syntax/conditional.ts`
- Tests: `tests/unit/error-handling.test.ts`
