# Tail Call Optimization (TCO)

HQL automatically optimizes tail-recursive functions into loops at transpile time, preventing stack overflow for deep recursion.

## Key Features

- **Automatic detection** - No special syntax needed (unlike Clojure's `recur`)
- **Zero runtime overhead** - Transformation happens at compile time
- **Stack-safe recursion** - Deep recursion without stack overflow

## Quick Example

```lisp
;; Write natural recursive code
(fn factorial [n acc]
  (if (<= n 1)
    acc
    (factorial (- n 1) (* n acc))))

;; Transpiles to efficient loop
;; function factorial(n, acc) {
;;   while (true) {
;;     if (n <= 1) return acc;
;;     [n, acc] = [n - 1, n * acc];
;;   }
;; }

(factorial 100 1)  ; Works without stack overflow
```

## What is Tail Recursion?

A function call is in **tail position** when it's the last operation before returning. Nothing happens after the recursive call - the result is returned directly.

### Tail Recursive (Optimized)

```lisp
(fn factorial [n acc]
  (if (<= n 1)
    acc
    (factorial (- n 1) (* n acc))))  ; Last operation - TAIL CALL
```

### NOT Tail Recursive (Not Optimized)

```lisp
(fn factorial [n]
  (if (<= n 1)
    1
    (* n (factorial (- n 1)))))  ; Must multiply AFTER recursive call
;                                  ; NOT a tail call
```

## Common Patterns

### Accumulator Pattern

Convert non-tail to tail by adding an accumulator parameter:

```lisp
;; Non-tail (stack grows)
(fn sum [n]
  (if (<= n 0)
    0
    (+ n (sum (- n 1)))))

;; Tail (constant stack)
(fn sum [n acc]
  (if (<= n 0)
    acc
    (sum (- n 1) (+ acc n))))
```

### GCD (Euclidean Algorithm)

```lisp
(fn gcd [a b]
  (if (=== b 0)
    a
    (gcd b (% a b))))
```

### Fibonacci with Accumulators

```lisp
(fn fib [n a b]
  (if (=== n 0)
    a
    (fib (- n 1) b (+ a b))))

(fib 50 0 1)  ; Fast, no stack overflow
```

## Tail-Call Detection

HQL auto-detects tail calls and lowers them to loops. No special form is required.

```lisp
; HQL - write normal recursion
(fn factorial [n acc]
  (if (<= n 1)
    acc
    (factorial (- n 1) (* n acc))))  ; auto-optimized
```

## Limitations

TCO only applies to:
- Self-recursive tail calls (function calling itself)
- Direct tail position (not wrapped in other operations)

NOT optimized:
- Mutual recursion (A calls B, B calls A)
- Non-tail recursive calls
- Tree recursion (multiple recursive calls)

## See Also

- [spec.md](./spec.md) - Technical specification
- [examples.hql](./examples.hql) - More examples
