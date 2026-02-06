# Spread Operator

**Status:** Implemented
**Source:** `src/hql/transpiler/utils/validation-helpers.ts`, `src/hql/transpiler/syntax/data-structure.ts`, `src/hql/transpiler/syntax/function.ts`, `src/hql/transpiler/syntax/js-interop.ts`

## Overview

The spread operator expands arrays and objects in place. HQL supports two syntactic forms:

1. **Symbol form:** `...identifier` -- spread a named variable
2. **List form:** `(... expression)` -- spread any expression (inline literals, function results, etc.)

Both forms work in arrays, function calls, method calls, and objects.

## Array Spread

### Symbol Form

```lisp
(let arr [1 2])
[...arr 3 4]                     ;; => [1, 2, 3, 4]

(let arr [2 3])
[1 ...arr 4]                     ;; => [1, 2, 3, 4]

(let arr [3 4])
[1 2 ...arr]                     ;; => [1, 2, 3, 4]

;; multiple spreads
(let a [1 2])
(let b [5 6])
[0 ...a 3 4 ...b 7]              ;; => [0, 1, 2, 3, 4, 5, 6, 7]

;; empty array (no effect)
(let arr [])
[1 ...arr 2]                     ;; => [1, 2]
```

### List Form

```lisp
[(... [1 2]) 3]                  ;; => [1, 2, 3]

(fn getItems [] [1 2])
[(... (getItems)) 3]             ;; => [1, 2, 3]

(let arr [1 2])
[(... (map (=> (* $0 2)) arr)) 99]  ;; => [2, 4, 99]

;; mixed symbol and list form
(let arr1 [1 2])
[...arr1 (... [3 4]) 5]         ;; => [1, 2, 3, 4, 5]

;; nested inline expressions
[(... [(... [1]) 2]) 3]          ;; => [1, 2, 3]
```

### Compilation

```lisp
;; HQL
[1 ...arr 2]

;; Compiles to JavaScript
[1, ...arr, 2]
```

## Function Call Spread

When spread arguments are present, compile-time arity validation is skipped.

```lisp
;; spread all arguments
(fn add [x y z] (+ x y z))
(let args [1 2 3])
(add ...args)                    ;; => 6

;; mixed positional and spread
(fn add [w x y z] (+ w x y z))
(let rest [3 4])
(add 1 2 ...rest)                ;; => 10

;; multiple spreads
(fn sum [...nums]
  (.reduce nums (fn [a b] (+ a b)) 0))
(let a [1 2])
(let b [3 4])
(sum ...a ...b)                  ;; => 10

;; spread with rest parameter
(fn sum [first ...rest]
  (+ first (.reduce rest (fn [a b] (+ a b)) 0)))
(let nums [2 3 4])
(sum 1 ...nums)                  ;; => 10

;; higher-order function with spread forwarding
(fn apply [f ...args]
  (f ...args))
(fn add [x y z] (+ x y z))
(apply add 1 2 3)                ;; => 6

;; list form in function call
(fn makeArray [...nums] nums)
(makeArray (... [1 2 3 4]))      ;; => [1, 2, 3, 4]
```

### Compilation

```lisp
;; HQL
(func ...args)

;; Compiles to JavaScript
func(...args)
```

## Method Call Spread

Spread works in both dot-notation method calls and `js-call` form.

```lisp
;; dot notation with spread
(let items [1 2 3])
(let arr [])
(arr .push ...items)
arr                              ;; => [1, 2, 3]

;; mixed regular and spread
(let items [2 3])
(let arr [])
(arr .push 1 ...items 4)
arr                              ;; => [1, 2, 3, 4]

;; js-call form with spread
(let items [1 2 3])
(let arr [])
(js-call arr "push" ...items)
arr                              ;; => [1, 2, 3]

;; list form in method call
(let arr [])
(js-call arr "push" (... [1 2 3]))
arr                              ;; => [1, 2, 3]

;; multiple spreads in method call
(let arr1 [1 2])
(let arr2 [3 4])
(let result [])
(js-call result "push" ...arr1 ...arr2)
result                           ;; => [1, 2, 3, 4]

;; spread rest parameter into method call
(fn doMany [...items]
  (let arr [])
  (js-call arr "push" ...items)
  arr)
(doMany 1 2 3)                   ;; => [1, 2, 3]
```

## Object Spread

Object spread uses curly-brace syntax or `hash-map` form. When spread is present, the transpiler generates a native JS object expression instead of a `__hql_hash_map` call.

### Curly-Brace Syntax

```lisp
;; spread at start
(let obj {"b": 2 "c": 3})
{...obj "a": 1}                  ;; => {b: 2, c: 3, a: 1}

;; spread in middle
(let obj {"b": 2 "c": 3})
{"a": 1 ...obj "d": 4}           ;; => {a: 1, b: 2, c: 3, d: 4}

;; spread at end
(let obj {"b": 2 "c": 3})
{"a": 1 ...obj}                  ;; => {a: 1, b: 2, c: 3}

;; multiple objects
(let a {"a": 1})
(let b {"b": 2})
{...a ...b "c": 3}               ;; => {a: 1, b: 2, c: 3}

;; property overwriting (last wins)
(let obj {"a": 1 "b": 2})
{...obj "a": 99}                 ;; => {a: 99, b: 2}
{"a": 1 ...obj}                  ;; => {a: 99, b: 2} (obj's a overwrites)

;; empty object
(let obj {})
{"a": 1 ...obj "b": 2}           ;; => {a: 1, b: 2}

;; with computed values
(let obj {"a": 1 "b": 2})
(let merged {...obj "c": (+ 1 2)})
merged                            ;; => {a: 1, b: 2, c: 3}

;; multiple spreads with overwrites
(let a {"x": 1 "y": 2})
(let b {"y": 99 "z": 3})
{...a ...b}                       ;; => {x: 1, y: 99, z: 3}
```

### Hash-Map Form

```lisp
(hash-map "a" 1 ...obj "b" 2)
;; => {a: 1, ...obj, b: 2}

;; list form in object
(hash-map (... (hash-map "a" 1)) "b" 2)
;; => {a: 1, b: 2}
```

### Compilation

```lisp
;; HQL
{"a": 1 ...obj "b": 2}

;; Compiles to JavaScript
{ "a": 1, ...obj, "b": 2 }
```

## Limitations

- **Shallow copy only** -- Nested structures share references.
- **No `...(expr)` symbol form** -- Use `(... (expr))` list form for expression spread.
- **No spread in destructuring** -- Destructuring rest uses `...name` in parameter lists only.

## Implementation Location

- Spread detection/transform: `src/hql/transpiler/utils/validation-helpers.ts` (`isSpreadOperator`, `transformSpreadOperator`, `transformObjectSpreadOperator`)
- Array spread: `src/hql/transpiler/syntax/data-structure.ts` (`transformVector`)
- Object spread: `src/hql/transpiler/syntax/data-structure.ts` (`transformHashMap`)
- Function call spread: `src/hql/transpiler/syntax/function.ts` (`transformArgsWithSpread`, `transformStandardFunctionCall`)
- Method call spread: `src/hql/transpiler/syntax/js-interop.ts`, `src/hql/transpiler/pipeline/hql-ast-to-hql-ir.ts`
- Code generation: `src/hql/transpiler/pipeline/ir-to-typescript.ts` (`generateSpreadElement`, object expression generation)
- IR types: `src/hql/transpiler/type/hql_ir.ts` (`IRSpreadElement`, `IRSpreadAssignment`)
- Tests: `tests/unit/syntax-spread-operator.test.ts`
