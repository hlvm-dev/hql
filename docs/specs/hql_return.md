# HQL Return

This document describes the return behavior in HQL, covering how functions
defined with `fn` (both named and anonymous) handle return values. It explains
the concepts of implicit and explicit returns, early exits via `return`, and
nuances in nested functions and edge cases.

## Table of Contents

1. [Overview](#overview)
2. [Return in `fn` Functions](#return-in-fn-functions)
3. [Return in Anonymous Functions](#return-in-anonymous-functions)
4. [Nested Functions and Return](#nested-functions-and-return)
5. [Edge Cases](#edge-cases)
6. [Return in Function Arguments](#return-in-function-arguments)
7. [Function Composition with Return](#function-composition-with-return)
8. [Summary](#summary)

## Overview

HQL supports both **implicit** and **explicit** return mechanisms:

- **Implicit Return:** If a function (named or anonymous) does not include a
  `return` statement, the value of the last evaluated expression is
  automatically returned.

- **Explicit Return:** Using the `return` statement immediately exits the
  current function, returning the specified value.

These behaviors apply uniformly to both named and anonymous `fn` functions.

## Return in `fn` Functions

`fn` functions support flexible return patterns:

- **Implicit Return:** The final expression's value is returned by default.
- **Explicit Return:** Using `return` provides early exit capabilities.
- **Multiple Returns:** Functions can contain multiple `return` statements.

**Examples:**

```lisp
;; Implicit return: the last expression is automatically returned.
(fn implicit-return-fn [x]
  (let doubled (* x 2))
  doubled)

;; Explicit return: using `return` to provide a value.
(fn explicit-return-fn [x]
  (let doubled (* x 2))
  (return doubled))

;; Early return with conditional: exits early when x is negative.
(fn early-return-fn [x]
  (if (< x 0)
      (return 0)
      (* x 2)))

;; Multiple return paths:
(fn process-value [x]
  (cond
    ((< x 0) (return -1))
    ((== x 0) (return 0))
    (else (* x 2))))
```

## Return in Anonymous Functions

Anonymous `fn` functions follow the same return rules as named functions:

```lisp
;; Implicit return in anonymous function
(let add-two (fn [x] (+ x 2)))

;; Explicit return in anonymous function
(let check-positive
  (fn [x]
    (if (< x 0)
        (return false)
        true)))
```

## Nested Functions and Return

`return` statements only affect the immediately enclosing function:

```lisp
(fn outer-function [x]
  (fn inner-function [y]
    (if (< y 0)
        (return "negative")  ; Returns from inner-function only
        "positive"))

  (let result (inner-function x))
  (+ "Result: " result))  ; This still executes
```

## Edge Cases

### Void Functions

Functions without explicit return values return `undefined`:

```lisp
(fn side-effect-fn [x]
  (print "Value is:" x))  ; Returns undefined
```

### Return in Conditional Branches

All branches should have consistent return behavior:

```lisp
(fn consistent-returns [x]
  (if (< x 0)
      (return 0)    ; Explicit return
      (* x 2)))     ; Implicit return
```

## Return in Function Arguments

Return statements in function arguments are evaluated in their context:

```lisp
(fn outer []
  (some-function
    (fn []
      (if condition
          (return "early")  ; Returns from anonymous fn, not outer
          "normal"))))
```

## Function Composition with Return

When composing functions, return values flow through the composition:

```lisp
(fn compose [f g]
  (fn [x]
    (f (g x))))

(let double (fn [x] (* x 2)))
(let add-one (fn [x] (+ x 1)))
(let double-then-add (compose add-one double))

(double-then-add 5)  ; => 11
```

## Summary

HQL's return behavior is consistent across function types:

1. **Implicit returns** use the last expression's value
2. **Explicit returns** provide early exit with `return`
3. **Return scope** is limited to the immediately enclosing function
4. Both named and anonymous `fn` functions follow these rules uniformly
