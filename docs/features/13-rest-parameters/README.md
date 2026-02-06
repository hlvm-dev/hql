# Rest Parameters

Rest parameters allow functions to accept a variable number of arguments, collected into an array.

## Syntax

Two syntaxes are supported:

```lisp
;; JS-style: ...name
(fn sum [...nums]
  (.reduce nums (fn [acc val] (+ acc val)) 0))

;; Clojure-style: & name
(fn sum [& nums]
  (.reduce nums (fn [acc val] (+ acc val)) 0))
```

Both compile to JavaScript `...rest` parameters.

## Basic Usage

### Rest parameter only

```lisp
(fn sum [...nums]
  (.reduce nums (fn [acc val] (+ acc val)) 0))

(sum 1 2 3 4 5)  ;; => 15
```

### Rest with regular parameters

```lisp
(fn sum [x ...rest]
  (+ x (.reduce rest (fn [acc val] (+ acc val)) 0)))

(sum 10 1 2 3)  ;; => 16

(fn sum [x y ...rest]
  (+ x y (.reduce rest (fn [acc val] (+ acc val)) 0)))

(sum 10 20 1 2 3)  ;; => 36
```

### Empty rest arrays

When no extra arguments are passed, the rest parameter is an empty array:

```lisp
(fn getLength [...items]
  (get items "length"))

(getLength)      ;; => 0
(getLength 1 2)  ;; => 2
```

## Rest with Default Parameters

Rest parameters can follow parameters that have defaults. Rest parameters themselves cannot have defaults.

```lisp
(fn process [x = 5 ...rest]
  (+ x (.reduce rest (fn [acc val] (+ acc val)) 0)))

(process 10 1 2 3)  ;; => 16
(process _ 1 2 3)   ;; => 11 (uses default 5 for x)
```

## Rest with Destructuring Parameters

Destructuring patterns can appear before a rest parameter:

```lisp
;; Array destructuring + rest
(fn process [[a b] ...rest]
  (+ a b (.reduce rest (fn [acc x] (+ acc x)) 0)))

(process [5 10] 1 2 3)  ;; => 21

;; Object destructuring + rest
(fn process [{"x": x} ...rest]
  (+ x (.reduce rest (fn [acc val] (+ acc val)) 0)))

(process {"x": 10} 1 2 3)  ;; => 16
```

## Arrow Functions with Rest

Arrow functions support rest parameters via explicit parameter lists:

```lisp
(let sum (=> (...nums)
  (.reduce nums (fn [acc x] (+ acc x)) 0)))

(sum 1 2 3 4)  ;; => 10

(let multiply (=> (factor ...nums)
  (.map nums (fn [x] (* factor x)))))

(multiply 3 1 2 3)  ;; => [3, 6, 9]
```

## Multi-Arity with Rest

In multi-arity functions, a rest-parameter arity acts as a catch-all for argument counts not matched by fixed arities:

```lisp
(fn calculate
  ([base = 100 multiplier = 2 & rest]
    (+ (* base multiplier) (.reduce rest (fn [acc x] (+ acc x)) 0))))
```

## Spread into Rest Functions

Values can be spread into functions that accept rest parameters:

```lisp
(fn sum [...nums]
  (.reduce nums (fn [acc x] (+ acc x)) 0))

(fn average [...values]
  (/ (sum ...values) (get values "length")))

(average 10 20 30)  ;; => 20
```

## Array Operations on Rest Parameters

Rest parameters are real JavaScript arrays:

```lisp
;; Indexing
(fn getSecond [...items]
  (get items 1))

(getSecond 10 20 30)  ;; => 20

;; Length
(fn count [...items]
  (get items "length"))

(count 1 2 3 4 5)  ;; => 5

;; Array methods (.map, .filter, .reduce, .join, etc.)
(fn doubleAll [...nums]
  (.map nums (fn [n] (* n 2))))

(doubleAll 1 2 3)  ;; => [2, 4, 6]
```

## Compilation

```lisp
;; HQL
(fn sum [...nums]
  (.reduce nums (fn [a b] (+ a b)) 0))

;; Compiles to JavaScript
function sum(...nums) {
  return nums.reduce((a, b) => a + b, 0);
}
```

## Position Rules

- Rest parameter must be the **last** parameter
- Only one rest parameter per function
- Can follow zero or more regular, default, or destructured parameters
- Rest parameters cannot have default values

```lisp
;; Valid
(fn f [...rest])
(fn f [a ...rest])
(fn f [a b ...rest])
(fn f [a = 1 ...rest])
(fn f [[x y] ...rest])

;; Invalid (parser stops at first rest; anything after is ignored)
;; (fn f [...rest a])
;; (fn f [...a ...b])
```

## Limitations

- Only one rest parameter per function
- Must be the last parameter
- Rest parameters cannot have default values
- In multi-arity parsing, the parser `break`s after the first rest indicator (tokens after it are silently ignored). In single-arity `parseParameters`, there is no `break` -- extra tokens after rest are processed as additional parameters (likely producing invalid output).

## Implementation

- Source: `src/hql/transpiler/syntax/function.ts` (`parseParameters`, `transformMultiArityFn`)
- Tests: `tests/unit/syntax-rest-params.test.ts`, `tests/unit/organized/syntax/function/function.test.ts`
