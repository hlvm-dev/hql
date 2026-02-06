# Tail Call Optimization (TCO)

**Source:** `src/hql/transpiler/optimize/tco-optimizer.ts`, `src/hql/transpiler/optimize/mutual-tco-optimizer.ts`, `src/hql/transpiler/optimize/tail-position-analyzer.ts`

HQL automatically optimizes tail-recursive functions into loops at transpile time, preventing stack overflow for deep recursion.

## Summary

- Automatic detection -- no special syntax needed (unlike Clojure's `recur`)
- Self-recursive TCO is a compile-time while-loop transformation (no runtime overhead)
- Mutual recursion is optimized via trampoline (minimal runtime overhead from thunk allocation)
- Mutually recursive generators are optimized via tagged-thunk trampoline (`__hql_trampoline_gen`)

## Quick Example

```lisp
// Write natural recursive code
(fn factorial [n acc]
  (if (<= n 1)
    acc
    (factorial (- n 1) (* n acc))))

// Transpiles to efficient loop
// function factorial(n, acc) {
//   while (true) {
//     if (n <= 1) return acc;
//     [n, acc] = [n - 1, n * acc];
//   }
// }

(factorial 100 1)  // Works without stack overflow
```

## What is Tail Recursion?

A function call is in **tail position** when it's the last operation before returning. Nothing happens after the recursive call - the result is returned directly.

### Tail Recursive (Optimized)

```lisp
(fn factorial [n acc]
  (if (<= n 1)
    acc
    (factorial (- n 1) (* n acc))))  // Last operation - TAIL CALL
```

### NOT Tail Recursive (Not Optimized)

```lisp
(fn factorial [n]
  (if (<= n 1)
    1
    (* n (factorial (- n 1)))))  // Must multiply AFTER recursive call
//                                  NOT a tail call
```

## Common Patterns

### Accumulator Pattern

Convert non-tail to tail by adding an accumulator parameter:

```lisp
// Non-tail (stack grows)
(fn sum [n]
  (if (<= n 0)
    0
    (+ n (sum (- n 1)))))

// Tail (constant stack)
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

(fib 50 0 1)  // Fast, no stack overflow
```

## Self-Recursive TCO

HQL auto-detects self-recursive tail calls in `fn` declarations and transforms them into `while(true)` loops with destructuring parameter reassignment. No special form is required.

```lisp
// HQL - write normal recursion
(fn factorial [n acc]
  (if (<= n 1)
    acc
    (factorial (- n 1) (* n acc))))  // auto-optimized to while loop
```

## Mutual Recursion

HQL optimizes mutually recursive functions using Tarjan's SCC algorithm and a trampoline pattern:

```lisp
(fn is-even [n]
  (if (=== n 0) true
      (is-odd (- n 1))))

(fn is-odd [n]
  (if (=== n 0) false
      (is-even (- n 1))))

(is-even 10000)  // => true (no stack overflow)
```

The transpiler:
1. Builds a call graph of all top-level `fn` declarations
2. Finds strongly connected components (groups of functions that call each other) using Tarjan's algorithm
3. Transforms tail calls within each group to return thunks (`() => otherFn(args)`)
4. Wraps external call sites with `__hql_trampoline()` to drive execution

Three-or-more function cycles are also supported:

```lisp
(fn step-a [n]
  (if (=== n 0) "done-a" (step-b (- n 1))))
(fn step-b [n]
  (if (=== n 0) "done-b" (step-c (- n 1))))
(fn step-c [n]
  (if (=== n 0) "done-c" (step-a (- n 1))))

(step-a 9999)  // => "done-a" (no stack overflow)
```

### Generator Mutual Recursion

Mutually recursive generator functions (`fn*`) use a tagged-thunk pattern with `__hql_trampoline_gen` instead of the plain thunk used for sync functions. The `yield*` delegate calls in tail position are detected and transformed. This feature is implemented (`transformGenToThunks` in `mutual-tco-optimizer.ts`) but currently has no test coverage.

## Limitations

TCO only applies to:
- Named `fn` declarations (not anonymous functions or lambdas)
- Self-recursive tail calls (transformed to while loops)
- Mutually recursive tail calls between top-level `fn` declarations (transformed to trampoline)
- Direct tail position calls (not wrapped in other operations)

NOT optimized:
- Non-tail recursive calls (recursive call not in last position)
- Tree recursion (multiple recursive calls in non-tail position)
- Async functions (skipped by mutual TCO; `await` naturally breaks the call stack)
- Anonymous functions / lambdas
- Calls through variables or higher-order functions
- Recursive calls inside `try`/`catch`/`finally` blocks

## See Also

- [spec.md](./spec.md) - Technical specification
- [examples.hql](./examples.hql) - More examples
