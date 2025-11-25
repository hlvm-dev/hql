# HQL Built-in Functions

HQL ships with a pragmatic set of built-in functions implemented by the runtime
(`src/environment.ts`). They are available in every program without any
imports. This document covers the most commonly used ones, their behaviour, and
examples.

> All examples assume `(import hql from "./mod.ts")` and use
> `await hql.run(...)`.

---

## Arithmetic

| Function | Signature                     | Notes                                          |
| -------- | ----------------------------- | ---------------------------------------------- |
| `+`      | `(+)`, `(number number ...)`  | Variadic; sums all arguments (0 when no args). |
| `-`      | `(number)`, `(number number)` | Unary negation or subtraction.                 |
| `*`      | `(number number ...)`         | Variadic multiplication (1 when no args).      |
| `/`      | `(number divisor)`            | Division; throws on divisor `0`.               |
| `%`      | `(number divisor)`            | Remainder; throws on divisor `0`.              |

```lisp
(+ 1 2 3)        ;; → 6
(- 10 4)         ;; → 6
(- 5)            ;; → -5
(* 2 3 4)        ;; → 24
(/ 9 3)          ;; → 3
(% 10 3)         ;; → 1
```

---

## Comparison

| Function | Signature         | Description              |
| -------- | ----------------- | ------------------------ |
| `=`      | `(value value)`   | Strict equality (`===`). |
| `!=`     | `(value value)`   | Strict inequality.       |
| `<`      | `(number number)` | Less-than.               |
| `>`      | `(number number)` | Greater-than.            |
| `<=`     | `(number number)` | Less-or-equal.           |
| `>=`     | `(number number)` | Greater-or-equal.        |

```lisp
(= 3 3)          ;; → true
(!= 3 4)         ;; → true
(< 1 2)          ;; → true
(>= 10 5)        ;; → true
```

---

## Collections & Interop

### `get`

Retrieve a value from arrays, objects, or S-expr lists. Returns the provided
`notFound` value (`null` by default) if the key is missing.

```lisp
(var arr ["a" "b" "c"])
(get arr 1)           ;; → "b"
(get arr 10 "n/a")   ;; → "n/a"
```

### `js-get`

Direct property access on JavaScript objects. Throws a `ValidationError` if the
target is `null`/`undefined`.

```lisp
(js-get Date "name") ;; → "Date"
```

### `js-call`

Invoke a method on a JavaScript object with proper `this` binding.

```lisp
(js-call "hello" "toUpperCase")   ;; → "HELLO"
(js-call Math "max" 10 20 30)       ;; → 30
```

---

## List helpers (used heavily in macros)

| Function  | Description                               |
| --------- | ----------------------------------------- |
| `%first`  | Return the first element of a list/array. |
| `%rest`   | Return all but the first element.         |
| `%length` | Number of elements.                       |
| `%empty?` | Whether the collection is empty.          |

```lisp
(%first [1 2 3])      ;; → 1
(%rest  [1 2 3])      ;; → (2 3)
(%length [1 2 3])     ;; → 3
(%empty? [])          ;; → true
```

---

## Control-flow helpers

While `if`, `cond`, `when`, etc. are implemented via macros, the runtime exposes
a convenience `throw` function that raises a `TranspilerError`.

```lisp
(try
  (do
    (throw "boom")
    "won't reach")
  (catch err
    err))          ;; → "boom"
```

---

## Notes

- Built-ins live inside each `Environment` instance; re-initializing the runtime
  (via `resetRuntime`) restores the defaults.
- Many built-ins (e.g., `%first`) intentionally return S-expression literals so
  macros can reason about code-as-data during compilation.
- Any additions to the built-in set should be documented here to keep API
  coverage accurate.
