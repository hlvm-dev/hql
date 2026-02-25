# Effect System

**Source:** `src/hql/transpiler/pipeline/effect-checker.ts`, `src/hql/transpiler/pipeline/effects/`

HQL provides a compile-time effect system for enforcing function purity. Functions declared with `fx` are checked at compile time to ensure they contain no impure operations.

## Summary

- **`fx`**: Declare a pure function (compile-time checked, zero runtime overhead)
- **Effect types**: `Pure` or `Impure`
- **ValueKind tracking**: Receiver type inference for method effect resolution
- **Purity rules**: No impure calls, no mutations, no generators
- **Receiver-aware**: `.push()` on Array is impure; `.length` on String is pure
- **Transitive**: A pure function calling an impure function is a violation

## Quick Examples

```lisp
;; Pure function -- compile-time checked
(fx add [x y]
  (+ x y))

;; Pure with typed method resolution
(fx uppercase [s:string]
  (.toUpperCase s))          ;; OK: String.toUpperCase is pure

;; Pure array operations (non-mutating only)
(fx double-all [nums:Array]
  (.map nums (fn [x] (* x 2))))  ;; OK: Array.map is pure

;; COMPILE ERROR: mutation in pure function
;; (fx bad [arr:Array]
;;   (.push arr 42))        ;; Array.push is impure
```

## What Gets Checked

| Check | Example Violation |
|-------|-------------------|
| Impure function calls | `(console.log x)` in `fx` body |
| Impure method calls | `(.push arr 42)` in `fx` body |
| Impure static calls | `(Math.random)` in `fx` body |
| Generator declaration | `(fx* gen [n] ...)` |
| Impure constructors | `(new WebSocket url)` in `fx` body |

## See Also

- [spec.md](./spec.md) - Technical specification with complete method effect tables
- [examples.hql](./examples.hql) - More examples
