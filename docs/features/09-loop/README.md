# Loop Feature Documentation

**Implementation:** Macros (`loop.hql`) + Transpiler primitives (`loop-recur.ts`)
**Coverage:** Tested

## Overview

HQL provides loop constructs for iteration and recursion:

1. **`loop/recur`** - Tail-call optimization (functional recursion) — transpiler primitive
2. **`while`** - Condition-based loop — macro expanding to `loop/recur`
3. **`dotimes`** - Execute n times — macro expanding to `loop/recur`
4. **`repeat`** - Alias for `dotimes`
5. **`for`** - Range and collection iteration — macro expanding to `for-of`
6. **`for-of`** - Collection iteration — transpiler primitive
7. **`for-await-of`** - Async iteration over async iterables — transpiler primitive
8. **`break`/`continue`** - Loop control statements (optional label) — transpiler primitives
9. **`label`** - Named loops for multi-level control — transpiler primitive
10. **`range`** - Lazy number sequence generator — stdlib function

## Syntax

### Loop/Recur - Tail-Call Optimization

`loop/recur` is a transpiler primitive. It uses `[]` for bindings (Clojure-style).

```lisp
// Basic loop/recur
(loop [binding init-value ...]
  body
  (recur new-value ...))

// Example: Sum 0 to 4
(loop [i 0 sum 0]
  (if (< i 5)
    (recur (+ i 1) (+ sum i))
    sum))
// => 10 (0+1+2+3+4)

// Factorial
(loop [n 5 acc 1]
  (if (<= n 1)
    acc
    (recur (- n 1) (* acc n))))
// => 120

// Fibonacci
(loop [n 7 a 0 b 1]
  (if (=== n 0)
    a
    (recur (- n 1) b (+ a b))))
// => 13 (7th fibonacci)

// Zero bindings
(var counter 0)
(loop []
  (if (< counter 3)
    (do
      (= counter (+ counter 1))
      (recur))
    counter))
// => 3
```

### While Loop - Condition-Based

`while` is a macro that expands to `loop/recur`.

```lisp
// Basic while
(while condition
  body...)

// Example: Count to 5
(var count 0)
(var sum 0)
(while (< count 5)
  (= sum (+ sum count))
  (= count (+ count 1)))
sum
// => 10

// Early termination via condition
(var i 0)
(var found false)
(while (and (< i nums.length) (not found))
  (if (isMatch (get nums i))
    (= found true)
    nil)
  (= i (+ i 1)))
```

**Macro expansion:**

```lisp
(while condition body...)
// expands to:
(loop []
  (if condition
    (do body... (recur))
    nil))
```

### Dotimes Loop - Fixed Iterations (Clojure-style)

`dotimes` is a macro that expands to `loop/recur`.

> **Note:** Named `dotimes` after Clojure's convention to avoid conflicts with
> user code and the stdlib `repeat` function.

```lisp
// Basic dotimes
(dotimes count
  body...)

// Example: 3 times
(var result [])
(dotimes 3
  (.push result "hello"))
result
// => ["hello", "hello", "hello"]

// With counter (manual)
(var sum 0)
(var counter 0)
(dotimes 5
  (= sum (+ sum counter))
  (= counter (+ counter 1)))
sum
// => 10 (0+1+2+3+4)
```

**Macro expansion:**

```lisp
(dotimes count body...)
// expands to:
(loop [i 0]
  (if (< i count)
    (do body... (recur (+ i 1)))
    nil))
```

> The internal `i` variable is NOT exposed to the body. If you need an iteration
> counter, manage one yourself.

### Repeat Loop - Alias for Dotimes

`repeat` is a macro identical to `dotimes`.

```lisp
(repeat 3
  (print "hello"))
```

### For Loop - Range and Collection Iteration

`for` is a macro that expands to `for-of` with runtime helpers (`__hql_range`, `__hql_toIterable`).

```lisp
// Single arg: 0 to n-1
(for [i 3]
  (print i))
// Prints: 0, 1, 2

// Two args: start to end-1
(for [i 5 8]
  (print i))
// Prints: 5, 6, 7

// Three args: start to end-1 by step
(for [i 0 10 2]
  (print i))
// Prints: 0, 2, 4, 6, 8

// Named syntax: to:
(for [i to: 3]
  (print i))
// Prints: 0, 1, 2

// Named syntax: from: to:
(for [i from: 5 to: 8]
  (print i))
// Prints: 5, 6, 7

// Named syntax: from: to: by:
(for [i from: 0 to: 10 by: 2]
  (print i))
// Prints: 0, 2, 4, 6, 8

// Named syntax: to: by: (without from:)
(for [i to: 10 by: 3]
  (print i))
// Prints: 0, 3, 6, 9

// Collection iteration
(for [x [1, 2, 3]]
  (print (* x 2)))
// Prints: 2, 4, 6
```

### For-Of - Direct Collection Iteration

`for-of` is a transpiler primitive. It returns `null` (expression-everywhere semantics, like Clojure's `doseq`).

```lisp
(for-of [x [1 2 3]]
  (print x))
// Prints: 1, 2, 3
// Returns: null

// Can be used in expression position
(let result (for-of [x [1 2 3]] (print x)))
// result => null
```

### For-Await-Of - Async Iteration

`for-await-of` is a transpiler primitive for iterating over async iterables.

```lisp
// Iterate over async iterables
(for-await-of [item asyncIterable]
  body...)

// With async generator
(async fn* fetch-pages []
  (yield (await (fetch "/page1")))
  (yield (await (fetch "/page2"))))

(async fn process []
  (for-await-of [page (fetch-pages)]
    (print page.data)))
```

### Break Statement

`break` is a transpiler primitive. It exits the innermost loop. Supports optional label.

```lisp
// Exit loop early
(for [i 10]
  (when (=== i 5)
    (break))
  (print i))
// Prints: 0, 1, 2, 3, 4

// Break in while loop
(var i 0)
(while true
  (if (>= i 10)
    (break)
    (do
      (print i)
      (= i (+ i 1)))))

// Break with label (multi-level)
(label outer
  (for [i 3]
    (for [j 3]
      (when (and (=== i 1) (=== j 1))
        (break outer))
      (print i j))))
// Prints: 0 0, 0 1, 0 2, 1 0
```

### Continue Statement

`continue` is a transpiler primitive. It skips to the next iteration. Supports optional label.

```lisp
// Skip iteration
(for [i 10]
  (when (=== (% i 2) 0)
    (continue))
  (print i))
// Prints: 1, 3, 5, 7, 9

// Continue with label
(label outer
  (for-of [x [1 2 3 4 5]]
    (if (=== x 3)
      (continue outer)
      (results.push x))))
// results => [1, 2, 4, 5]
```

### Labeled Statements

`label` is a transpiler primitive. It names a loop so `break`/`continue` can target it.

```lisp
// Label syntax
(label name
  body...)

// Nested loops with labels
(label outer
  (for-of [x [1 2 3]]
    (for-of [y ["a" "b" "c"]]
      (if (and (=== x 2) (=== y "b"))
        (break outer)
        (results.push (str x y))))))
// results => ["1a", "1b", "1c", "2a"]

// Labeled for-of inside do block
(label outer
  (do
    (results.push "start")
    (for-of [x [1 2 3]]
      (if (=== x 2) (break outer))
      (results.push x))))
// results => ["start", 1]
```

### Range Function

`range` is a stdlib function that generates lazy sequences of numbers.

```lisp
// Basic range (0 to n-1)
(range 5)           // => lazy seq of 0, 1, 2, 3, 4

// Range with start and end
(range 1 6)         // => lazy seq of 1, 2, 3, 4, 5

// Range with step
(range 0 10 2)      // => lazy seq of 0, 2, 4, 6, 8

// Negative step (countdown)
(range 10 0 -1)     // => lazy seq of 10, 9, 8, 7, 6, 5, 4, 3, 2, 1

// Use with for loop
(for [i (range 5)]
  (print i))        // Prints: 0, 1, 2, 3, 4

// Use with doall to materialize
(let nums (doall (range 5)))  // => [0, 1, 2, 3, 4]
```

## Implementation Details

### Loop/Recur

Simple loops (single `if` body with `recur` in one branch) are optimized to native `while` loops. Complex loops use a recursive function with an IIFE wrapper.

**Simple loop optimization:**

```lisp
(loop [i 0 sum 0]
  (if (< i 100)
    (recur (+ i 1) (+ sum i))
    sum))

// Compiles to (simplified):
((__init_0, __init_1) => {
  let i = __init_0;
  let sum = __init_1;
  while (i < 100) {
    const __hql_temp_sum = sum + i;
    i++;
    sum = __hql_temp_sum;
  }
  return sum;
})(0, 0)
```

**Complex loop (recursive function):**

```lisp
(loop [i 0]
  (when (< i 3)
    (print i)
    (recur (+ i 1))))

// Compiles to (simplified):
((__init_0) => {
  function loop_0(i) {
    if (i < 3) {
      console.log(i);
      return loop_0(i + 1);
    }
  }
  return loop_0(__init_0);
})(0)
```

Arithmetic updates are optimized: `(+ i 1)` becomes `i++`, `(- i 1)` becomes `i--`, `(+ i n)` becomes `i += n` (when safe).

### While Loop

Macro that expands to `loop [] (if condition (do body (recur)) nil)`. The loop/recur then gets optimized to a native while loop.

### Dotimes / Repeat

Macros that expand to `loop [i 0] (if (< i count) (do body (recur (+ i 1))) nil)`. The internal counter variable is not exposed to the body (`dotimes` uses `i`, `repeat` uses `__repeat_i`).

### For Loop

Macro that dispatches based on binding spec:
- **1 arg** `(for [i 3])`: expands to `(for-of [i (__hql_toIterable 3)])` — numbers become `range(0, n)`
- **2 args** `(for [i 5 8])`: expands to `(for-of [i (__hql_range 5 8)])`
- **3 args** `(for [i 0 10 2])`: expands to `(for-of [i (__hql_range 0 10 2)])`
- **Named** `(for [i from: 0 to: 10 by: 2])`: expands to `(for-of [i (__hql_range 0 10 2)])`
- **Collection** `(for [x coll])`: same as 1-arg, `__hql_toIterable` passes iterables through

### For-Of

Transpiler primitive. Generates `for (const x of collection) { ... }` wrapped in an IIFE that returns `null` (expression-everywhere semantics).

When the body contains `return` statements, the IIFE wrapper is omitted so `return` escapes to the outer function. When used with labeled `break`/`continue`, the label's transform handles the IIFE wrapping.

### For-Await-Of

Same as `for-of` but generates `for await (const x of collection) { ... }` with an async IIFE wrapper.

### Break / Continue

Transpiler primitives. Generate `break;` / `continue;` or `break label;` / `continue label;`.

`break` and `continue` require being inside a loop context (enforced at compile time).

### Label

Transpiler primitive. Generates `label: statement`. When a `for-of` inside the label targets it with `break`/`continue`, the label wraps everything in an IIFE so the label works correctly with the for-of IIFE.

## Test Coverage

### Loop/Recur
- Basic loop with recur
- Loop with multiple bindings
- Factorial using loop/recur
- Fibonacci using loop/recur
- Countdown using loop/recur
- Sum of array using loop/recur
- Collect even numbers
- Find first element matching condition
- Tail-call optimization pattern
- Nested loop simulation
- Empty bracket syntax (zero bindings)

### While Loop
- Basic while loop
- While loop with array operations
- While loop early termination

### Dotimes Loop
- Basic dotimes loop
- Dotimes with multiple expressions
- Dotimes with counter accumulation

### For Loop
- Single arg range (0 to n-1)
- Two arg range (start to end-1)
- Three arg range with step
- Named to: syntax
- Named from: to: syntax
- Named from: to: by: syntax
- Collection iteration
- Large range without OOM (1,000,000 iterations)

### For-Of
- Basic iteration
- Multiple statements in body
- With continue and break
- Returns null (expression semantics)
- In expression position
- In if branches
- In function body
- IIFE wrapper generation

### For-Await-Of
- Basic async iteration
- Async iteration with await inside
- Iterate over async generator
- Async IIFE generation

### Break / Continue
- Break in while loop
- Continue in while loop
- Together in while loop
- In loop/recur optimized to while
- In for-of

### Labeled Statements
- Basic labeled while loop
- Break to outer label
- Continue to outer label
- Labeled for-of loop
- Nested labeled loops
- Labeled break with for-of (IIFE handling)
- Labeled continue with for-of
- Nested for-of loops with labeled break
- For-of inside do block with label
- For-of inside if branch with label
- For-of inside when macro with label
- Multiple nested labels (both targeted)
- Deeply nested structure returns null

## Best Practices

### Use Loop/Recur for Deep Recursion

```lisp
// Loop/recur (tail-call optimized, constant stack space)
(loop [i 0 sum 0]
  (if (< i 10000)
    (recur (+ i 1) (+ sum i))
    sum))
```

### Use For for Range Iteration

```lisp
(for [i from: 0 to: 10]
  (print i))
```

### Use While for Complex Conditions

```lisp
(while (and (not done) (< attempts maxAttempts))
  (processItem))
```

### Use Dotimes for Fixed Count

```lisp
(dotimes 5
  (print "Hello"))
```

## Summary

HQL's loop constructs:

- **loop/recur**: Tail-call optimized functional recursion. Transpiler primitive. Simple loops optimize to native while.
- **while**: Condition-based loop. Macro expanding to loop/recur.
- **dotimes** / **repeat**: Fixed iteration count. Macros expanding to loop/recur.
- **for**: Range and collection iteration. Macro expanding to for-of with runtime range helpers.
- **for-of**: Direct collection iteration. Transpiler primitive. Returns null (expression semantics).
- **for-await-of**: Async iteration. Transpiler primitive.
- **break** / **continue**: Loop control with optional label targeting. Transpiler primitives.
- **label**: Named loops for multi-level break/continue. Transpiler primitive.
- **range**: Lazy number sequence generator. Stdlib function.
