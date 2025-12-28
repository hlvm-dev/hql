# Loop Feature Documentation

**Implementation:** Transpiler loop transformers
**Coverage:** ✅ 100%

## Overview

HQL provides four loop constructs for iteration and recursion:

1. **`loop/recur`** - Tail-call optimization (functional recursion)
2. **`while`** - Traditional condition-based loop
3. **`repeat`** - Execute n times
4. **`for`** - Range and collection iteration
5. **`for-await-of`** - Async iteration over async iterables (v2.0)
6. **`break`/`continue`** - Loop control statements (v2.0)
7. **Labeled statements** - Named loops for multi-level control (v2.0)
8. **`range`** - Lazy number sequence generator (v2.0)

All loops support breaking early and manipulating state during iteration.

## Syntax

### Loop/Recur - Tail-Call Optimization

```lisp
; Basic loop/recur (uses [] for bindings, Clojure-style)
(loop [binding init-value ...]
  body
  (recur new-value ...))

; Example: Sum 0 to 4
(loop [i 0 sum 0]
  (if (< i 5)
    (recur (+ i 1) (+ sum i))
    sum))
; => 10 (0+1+2+3+4)

; Factorial
(loop [n 5 acc 1]
  (if (<= n 1)
    acc
    (recur (- n 1) (* acc n))))
; => 120

; Fibonacci
(loop [n 7 a 0 b 1]
  (if (=== n 0)
    a
    (recur (- n 1) b (+ a b))))
; => 13 (7th fibonacci)
```

### While Loop - Condition-Based

```lisp
; Basic while
(while condition
  body...)

; Example: Count to 5
(var count 0)
(var sum 0)
(while (< count 5)
  (= sum (+ sum count))
  (= count (+ count 1)))
sum
; => 10

; Early termination
(var i 0)
(var found false)
(while (and (< i nums.length) (not found))
  (if (isMatch (get nums i))
    (= found true)
    nil)
  (= i (+ i 1)))
```

### Dotimes Loop - Fixed Iterations (Clojure-style)

> **Note:** Named `dotimes` after Clojure's convention to avoid conflicts with
> user code and the stdlib `repeat` function.

```lisp
; Basic dotimes
(dotimes count
  body...)

; Example: Dotimes 3 times
(var result [])
(dotimes 3
  (.push result "hello"))
result
; => ["hello", "hello", "hello"]

; With counter
(var sum 0)
(var counter 0)
(dotimes 5
  (= sum (+ sum counter))
  (= counter (+ counter 1)))
sum
; => 10 (0+1+2+3+4)
```

### For Loop - Range and Collection Iteration

```lisp
; Range iterations
(for [var range]
  body...)

; Single arg: 0 to n-1
(for [i 3]
  (print i))
; Prints: 0, 1, 2

; Two args: start to end-1
(for [i 5 8]
  (print i))
; Prints: 5, 6, 7

; Three args: start to end-1 by step
(for [i 0 10 2]
  (print i))
; Prints: 0, 2, 4, 6, 8

; Named syntax: to:
(for [i to: 3]
  (print i))
; Prints: 0, 1, 2

; Named syntax: from: to:
(for [i from: 5 to: 8]
  (print i))
; Prints: 5, 6, 7

; Named syntax: from: to: by:
(for [i from: 0 to: 10 by: 2]
  (print i))
; Prints: 0, 2, 4, 6, 8

; Collection iteration
(for [x [1, 2, 3]]
  (print (* x 2)))
; Prints: 2, 4, 6
```

### For-Await-Of (v2.0) - Async Iteration

```lisp
; Iterate over async iterables
(for-await-of [item asyncIterable]
  body...)

; With async generator
(async fn* fetch-pages []
  (yield (await (fetch "/page1")))
  (yield (await (fetch "/page2"))))

(async fn process []
  (for-await-of [page (fetch-pages)]
    (print page.data)))

; With async array operations
(async fn process-urls [urls]
  (for-await-of [response (urls.map fetch)]
    (let data (await (response.json)))
    (print data)))
```

### Break Statement (v2.0)

```lisp
; Exit loop early
(for [i 10]
  (when (=== i 5)
    (break))
  (print i))
; Prints: 0, 1, 2, 3, 4

; Break in while loop
(var i 0)
(while true
  (if (>= i 10)
    (break)
    (do
      (print i)
      (= i (+ i 1)))))

; Break with label (multi-level)
(label outer
  (for [i 3]
    (for [j 3]
      (when (and (=== i 1) (=== j 1))
        (break outer))
      (print i j))))
; Prints: 0 0, 0 1, 0 2, 1 0
```

### Continue Statement (v2.0)

```lisp
; Skip iteration
(for [i 10]
  (when (=== (% i 2) 0)
    (continue))
  (print i))
; Prints: 1, 3, 5, 7, 9

; Continue in while
(var i 0)
(while (< i 10)
  (= i (+ i 1))
  (when (=== (% i 2) 0)
    (continue))
  (print i))
; Prints: 1, 3, 5, 7, 9

; Continue with label
(label outer
  (for [i 3]
    (for [j 3]
      (when (=== j 1)
        (continue outer))
      (print i j))))
; Prints: 0 0, 1 0, 2 0
```

### Labeled Statements (v2.0)

```lisp
; Label syntax
(label name
  body...)

; Nested loops with labels
(label outer
  (for [i from: 0 to: 5]
    (label inner
      (for [j from: 0 to: 5]
        (when (=== (* i j) 6)
          (break outer))
        (print (* i j))))))

; Search with early exit
(label search
  (for [row matrix]
    (for [cell row]
      (when (=== cell target)
        (print "Found!")
        (break search)))))
```

### Range Function (v2.0)

The `range` function generates lazy sequences of numbers:

```lisp
; Basic range (0 to n-1)
(range 5)           ; => lazy seq of 0, 1, 2, 3, 4

; Range with start and end
(range 1 6)         ; => lazy seq of 1, 2, 3, 4, 5

; Range with step
(range 0 10 2)      ; => lazy seq of 0, 2, 4, 6, 8

; Negative step (countdown)
(range 10 0 -1)     ; => lazy seq of 10, 9, 8, 7, 6, 5, 4, 3, 2, 1

; Use with for loop
(for [i (range 5)]
  (print i))        ; Prints: 0, 1, 2, 3, 4

; Use with array methods
(let nums (doall (range 5)))  ; Convert to array: [0, 1, 2, 3, 4]

; Lazy evaluation (only computes what's needed)
(let first-three (take 3 (range 1000000)))
; Only generates 0, 1, 2 - not all million numbers
```

**Characteristics:**
- Lazy evaluation (generates values on demand)
- Memory efficient for large ranges
- Supports forward and reverse iteration
- Use `doall` to materialize to array

## Implementation Details

### Loop/Recur

**Compilation:**

```lisp
(loop [binding init-value]
  body
  (recur new-value))

; Compiles to:
function loop() {
  let binding = init_value;
  while (true) {
    // body
    // when recur called:
    binding = new_value;
    continue;
    // when exit:
    return result;
  }
}
loop()
```

**Characteristics:**

- ✅ Tail-call optimization (constant stack space)
- ✅ Multiple bindings supported
- ✅ `recur` must be in tail position
- ✅ Prevents stack overflow on deep recursion
- ✅ Functional programming pattern

### While Loop

**Compilation:**

```lisp
(while condition body)

; Compiles to:
while (condition) {
  body;
}
```

**Characteristics:**

- ✅ Traditional imperative loop
- ✅ Condition evaluated before each iteration
- ✅ Early termination via condition
- ✅ Requires mutable state
- ✅ No automatic counter

### Dotimes Loop (Clojure-style)

**Compilation:**

```lisp
(dotimes count body)

; Compiles to:
for (let i = 0; i < count; i++) {
  body;
}
```

**Characteristics:**

- ✅ Fixed number of iterations
- ✅ No explicit counter variable
- ✅ Simple and concise
- ✅ Counter not exposed to body
- ✅ Compiles to standard for loop

### For Loop

**Compilation:**

```lisp
; Range: (for [i 0 10 2] body)
for (let i = 0; i < 10; i += 2) {
  body;
}

; Collection: (for [x array] body)
for (const x of array) {
  body;
}
```

**Characteristics:**

- ✅ Range iteration (numeric)
- ✅ Collection iteration (arrays, iterables)
- ✅ Named parameter syntax (to:, from:, by:)
- ✅ Positional syntax (1, 2, or 3 args)
- ✅ Step size configurable

### For-Await-Of (v2.0)

**Compilation:**

```lisp
(for-await-of [item asyncIterable]
  (process item))

; Compiles to:
for await (const item of asyncIterable) {
  process(item);
}
```

**Characteristics:**

- ✅ Async iteration over async iterables
- ✅ Works with async generators
- ✅ Awaits each iteration automatically
- ✅ Must be inside async function

### Break Statement

**Compilation:**

```lisp
(break)       ; Compiles to: break;
(break outer) ; Compiles to: break outer;
```

**Characteristics:**

- ✅ Exits innermost loop
- ✅ Optional label for multi-level break
- ✅ Works in for, while, and switch

### Continue Statement

**Compilation:**

```lisp
(continue)       ; Compiles to: continue;
(continue outer) ; Compiles to: continue outer;
```

**Characteristics:**

- ✅ Skips to next iteration
- ✅ Optional label for outer loop continue
- ✅ Works in for and while loops

### Labeled Statements

**Compilation:**

```lisp
(label name
  (for [i 10]
    (break name)))

; Compiles to:
name: for (let i = 0; i < 10; i++) {
  break name;
}
```

**Characteristics:**

- ✅ Names loops for multi-level control
- ✅ Works with break and continue
- ✅ Labels are block-scoped

## Features Covered

✅ Loop/recur with single binding ✅ Loop/recur with multiple bindings ✅
Loop/recur for factorial calculation ✅ Loop/recur for fibonacci ✅ Loop/recur
with side effects (countdown) ✅ Loop/recur with array operations ✅ Loop/recur
for filtering (collect evens) ✅ Loop/recur for finding (first match) ✅
Loop/recur in function (tail-call pattern) ✅ Nested loop/recur ✅ While loop
basic ✅ While with array operations ✅ While with early termination ✅ Repeat
basic ✅ Repeat with multiple expressions ✅ Repeat with counter accumulation ✅
For single arg (0 to n-1) ✅ For two args (start to end-1) ✅ For three args
(with step) ✅ For with named to: syntax ✅ For with named from: to: syntax ✅
For with named from: to: by: syntax ✅ For collection iteration
✅ For-await-of (async iteration) ✅ Break statement ✅ Break with label
✅ Continue statement ✅ Continue with label ✅ Labeled statements

## Test Coverage



### Section 1: Loop/Recur

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

### Section 2: While Loop

- Basic while loop
- While loop with array operations
- While loop early termination

### Section 3: Repeat Loop

- Basic repeat loop
- Repeat with multiple expressions
- Repeat with counter accumulation

### Section 4: For Loop

- Single arg range (0 to n-1)
- Two arg range (start to end-1)
- Three arg range with step
- Named to: syntax
- Named from: to: syntax
- Named from: to: by: syntax
- Collection iteration

### Section 5: For-Await-Of (v2.0)

- Basic async iteration
- With async generators
- With Promise arrays
- Inside async functions
- Error handling in async loops

### Section 6: Break/Continue (v2.0)

- Break in for loop
- Break in while loop
- Break with label
- Continue in for loop
- Continue in while loop
- Continue with label
- Nested loops with labeled break
- Nested loops with labeled continue

### Section 7: Labeled Statements (v2.0)

- Basic labeled loops
- Nested labeled loops
- Multi-level break
- Multi-level continue
- Labels with different loop types

## Use Cases

### 1. Tail-Call Optimization (Loop/Recur)

```lisp
; Prevent stack overflow on deep recursion
(fn sum-to [n]
  (loop [i 1 acc 0]
    (if (<= i n)
      (recur (+ i 1) (+ acc i))
      acc)))

(sum-to 10000)  ; No stack overflow!
```

### 2. Stateful Iteration (While)

```lisp
; Process until condition met
(var queue [1, 2, 3, 4, 5])
(var sum 0)
(while (> queue.length 0)
  (var item (.shift queue))
  (= sum (+ sum item)))
sum
```

### 3. Fixed Repetition (Dotimes)

```lisp
; Retry logic
(var attempts 0)
(var succeeded false)
(dotimes 3
  (if (not succeeded)
    (do
      (= attempts (+ attempts 1))
      (= succeeded (tryOperation)))
    nil))
```

### 4. Range Iteration (For)

```lisp
; Process numeric range
(var squares [])
(for [i from: 1 to: 11]
  (.push squares (* i i)))
squares
; => [1, 4, 9, 16, 25, 36, 49, 64, 81, 100]
```

### 5. Collection Processing (For)

```lisp
; Transform array elements
(var users [{ name: "Alice" }, { name: "Bob" }])
(var names [])
(for [user users]
  (.push names user.name))
names
; => ["Alice", "Bob"]
```

## Comparison with Other Languages

### JavaScript For Loop

```javascript
// JavaScript
for (let i = 0; i < 10; i += 2) {
  console.log(i);
}

// HQL
(for [i from: 0 to: 10 by: 2]
  (print i))
```

### JavaScript While Loop

```javascript
// JavaScript
let count = 0;
while (count < 5) {
  console.log(count);
  count++;
}

// HQL
(var count 0)
(while (< count 5)
  (print count)
  (= count (+ count 1)))
```

### JavaScript For-Of

```javascript
// JavaScript
for (const item of items) {
  console.log(item);
}

// HQL
(for [item items]
  (print item))
```

### Scheme/Clojure Loop

```scheme
; Scheme (named let)
(let loop ((i 0) (acc 0))
  (if (< i 10)
      (loop (+ i 1) (+ acc i))
      acc))

; HQL (Clojure-style with [])
(loop [i 0 acc 0]
  (if (< i 10)
    (recur (+ i 1) (+ acc i))
    acc))
```

## Related Specs

- Complete loop specification available in project specs
- Transpiler loop transformers in loop processing module
- Tail-call optimization in recur implementation

## Examples

See `examples.hql` for executable examples.

## Transform Pipeline

```
HQL Loop Syntax
  ↓
S-expression Parser
  ↓
Loop Transformers (loop, while, repeat, for)
  ↓
IR Nodes (WhileStatement, ForStatement)
  ↓
ESTree AST
  ↓
JavaScript (while, for, for-of)
```

## Best Practices

### Use Loop/Recur for Deep Recursion

```lisp
; ✅ Good: Loop/recur (tail-call optimized)
(loop [i 0 sum 0]
  (if (< i 10000)
    (recur (+ i 1) (+ sum i))
    sum))

; ❌ Bad: Regular recursion (stack overflow risk)
(fn sum-recursive [i sum]
  (if (< i 10000)
    (sum-recursive (+ i 1) (+ sum i))
    sum))
(sum-recursive 0 0)  ; Stack overflow!
```

### Use For for Range Iteration

```lisp
; ✅ Good: For loop (concise)
(for [i from: 0 to: 10]
  (print i))

; ❌ Verbose: While loop
(var i 0)
(while (< i 10)
  (print i)
  (= i (+ i 1)))
```

### Use While for Complex Conditions

```lisp
; ✅ Good: While (clear condition)
(while (and (not done) (< attempts maxAttempts))
  (processItem))

; ❌ Unclear: For loop with break
(for [i 0 to: maxAttempts]
  (if done (break) nil)
  (processItem))
```

### Use Dotimes for Fixed Count

```lisp
; ✅ Good: Dotimes (clear intent)
(dotimes 5
  (print "Hello"))

; ❌ Unnecessary: For loop
(for [i from: 0 to: 5]
  (print "Hello"))
```

## Edge Cases Tested

✅ Loop/recur with single and multiple bindings ✅ Loop/recur in tail position
✅ Loop/recur with nested conditions ✅ Loop/recur with side effects ✅ Nested
loops ✅ While with complex conditions ✅ While with early termination ✅ Repeat
with multiple expressions ✅ For with 1, 2, and 3 positional args ✅ For with
named args (to:, from:, by:) ✅ For collection iteration (for-of)

## Common Patterns

### 1. Factorial (Loop/Recur)

```lisp
(fn factorial [n]
  (loop [i n acc 1]
    (if (<= i 1)
      acc
      (recur (- i 1) (* acc i)))))
```

### 2. Fibonacci (Loop/Recur)

```lisp
(fn fib [n]
  (loop [i n a 0 b 1]
    (if (=== i 0)
      a
      (recur (- i 1) b (+ a b)))))
```

### 3. Array Filtering (Loop/Recur)

```lisp
(fn filter-evens [nums]
  (var result [])
  (loop [i 0]
    (if (< i nums.length)
      (do
        (if (=== (% (get nums i) 2) 0)
          (.push result (get nums i))
          nil)
        (recur (+ i 1)))
      result)))
```

### 4. Array Sum (For)

```lisp
(fn sum [nums]
  (var total 0)
  (for [n nums]
    (= total (+ total n)))
  total)
```

### 5. Retry with Limit (Dotimes)

```lisp
(fn retry-operation [op max-attempts]
  (var succeeded false)
  (var attempts 0)
  (dotimes max-attempts
    (if (not succeeded)
      (do
        (= attempts (+ attempts 1))
        (try
          (do
            (op)
            (= succeeded true))
          (catch (e)
            (print "Attempt" attempts "failed"))))
      nil))
  succeeded)
```

## Performance Considerations

### Loop/Recur vs Regular Recursion

**Loop/Recur:**

- ✅ Constant stack space (tail-call optimized)
- ✅ Can handle millions of iterations
- ✅ No stack overflow risk
- ✅ Compiles to efficient while loop

**Regular Recursion:**

- ❌ Stack frame per call
- ❌ Limited by stack size (~10k calls)
- ❌ Stack overflow risk
- ❌ Slower than iterative

### For vs While Performance

**For Loop:**

- ✅ Clear intent (iteration)
- ✅ Optimized by JS engines
- ✅ Less error-prone

**While Loop:**

- ✅ More flexible conditions
- ✅ Similar performance to for
- ❌ Requires manual counter management

## Debugging Loops

### Common Mistakes

**1. Infinite Loop**

```lisp
; ❌ Bad: Forgot to increment
(var i 0)
(while (< i 10)
  (print i))  ; Infinite! Missing (= i (+ i 1))
```

**2. Recur Not in Tail Position**

```lisp
; ❌ Bad: Recur not last expression
(loop [i 0]
  (if (< i 10)
    (+ (recur (+ i 1)) 1)  ; Not tail position!
    i))
```

**3. Off-by-One Error**

```lisp
; ❌ Bad: Loops 0-9 instead of 1-10
(for [i from: 0 to: 10]  ; Should be from: 1 to: 11
  (print i))
```

## Future Enhancements

- `for-in` for object key iteration
- `loop*` with destructuring in bindings
- `while*` with pattern matching
- `loop/recur` with guards (early exit conditions)

## Summary

HQL's loop constructs provide:

- ✅ **Tail-call optimization** (loop/recur, no stack overflow)
- ✅ **Traditional loops** (while, for)
- ✅ **Simple repetition** (dotimes)
- ✅ **Range iteration** (for with numeric range)
- ✅ **Collection iteration** (for with arrays)
- ✅ **Named parameters** (for with from:/to:/by:)
- ✅ **Functional style** (loop/recur mimics recursion)
- ✅ **Imperative style** (while, for, dotimes)
- ✅ **Async iteration** (for-await-of with async generators)
- ✅ **Loop control** (break, continue with optional labels)
- ✅ **Labeled statements** (multi-level loop control)

Choose the right loop for the task:

- **Loop/Recur:** Deep recursion, tail-call patterns
- **While:** Complex conditions, stateful iteration
- **Repeat:** Fixed count, simple repetition
- **For:** Range or collection iteration
- **For-Await-Of:** Async generators, streaming data
- **Labeled loops:** Nested loops with multi-level control
