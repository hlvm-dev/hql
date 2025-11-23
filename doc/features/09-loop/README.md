# Loop Feature Documentation

**Implementation:** Transpiler loop transformers **Test Count:** 23 tests
**Coverage:** ✅ 100%

## Overview

HQL provides four loop constructs for iteration and recursion:

1. **`loop/recur`** - Tail-call optimization (functional recursion)
2. **`while`** - Traditional condition-based loop
3. **`repeat`** - Execute n times
4. **`for`** - Range and collection iteration

All loops support breaking early and manipulating state during iteration.

## Syntax

### Loop/Recur - Tail-Call Optimization

```lisp
; Basic loop/recur
(loop (binding init-value ...)
  body
  (recur new-value ...))

; Example: Sum 0 to 4
(loop (i 0 sum 0)
  (if (< i 5)
    (recur (+ i 1) (+ sum i))
    sum))
; => 10 (0+1+2+3+4)

; Factorial
(loop (n 5 acc 1)
  (if (<= n 1)
    acc
    (recur (- n 1) (* acc n))))
; => 120

; Fibonacci
(loop (n 7 a 0 b 1)
  (if (= n 0)
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
  (set! sum (+ sum count))
  (set! count (+ count 1)))
sum
; => 10

; Early termination
(var i 0)
(var found false)
(while (and (< i nums.length) (not found))
  (if (isMatch (get nums i))
    (set! found true)
    nil)
  (set! i (+ i 1)))
```

### Repeat Loop - Fixed Iterations

```lisp
; Basic repeat
(repeat times
  body...)

; Example: Repeat 3 times
(var result [])
(repeat 3
  (.push result "hello"))
result
; => ["hello", "hello", "hello"]

; With counter
(var sum 0)
(var counter 0)
(repeat 5
  (set! sum (+ sum counter))
  (set! counter (+ counter 1)))
sum
; => 10 (0+1+2+3+4)
```

### For Loop - Range and Collection Iteration

```lisp
; Range iterations
(for (var range)
  body...)

; Single arg: 0 to n-1
(for (i 3)
  (print i))
; Prints: 0, 1, 2

; Two args: start to end-1
(for (i 5 8)
  (print i))
; Prints: 5, 6, 7

; Three args: start to end-1 by step
(for (i 0 10 2)
  (print i))
; Prints: 0, 2, 4, 6, 8

; Named syntax: to:
(for (i to: 3)
  (print i))
; Prints: 0, 1, 2

; Named syntax: from: to:
(for (i from: 5 to: 8)
  (print i))
; Prints: 5, 6, 7

; Named syntax: from: to: by:
(for (i from: 0 to: 10 by: 2)
  (print i))
; Prints: 0, 2, 4, 6, 8

; Collection iteration
(for (x [1, 2, 3])
  (print (* x 2)))
; Prints: 2, 4, 6
```

## Implementation Details

### Loop/Recur

**Compilation:**

```lisp
(loop (binding init-value)
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

### Repeat Loop

**Compilation:**

```lisp
(repeat times body)

; Compiles to:
for (let i = 0; i < times; i++) {
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
; Range: (for (i 0 10 2) body)
for (let i = 0; i < 10; i += 2) {
  body;
}

; Collection: (for (x array) body)
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

## Test Coverage

**Total Tests:** 23

### Section 1: Loop/Recur (10 tests)

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

### Section 2: While Loop (3 tests)

- Basic while loop
- While loop with array operations
- While loop early termination

### Section 3: Repeat Loop (3 tests)

- Basic repeat loop
- Repeat with multiple expressions
- Repeat with counter accumulation

### Section 4: For Loop (7 tests)

- Single arg range (0 to n-1)
- Two arg range (start to end-1)
- Three arg range with step
- Named to: syntax
- Named from: to: syntax
- Named from: to: by: syntax
- Collection iteration

## Use Cases

### 1. Tail-Call Optimization (Loop/Recur)

```lisp
; Prevent stack overflow on deep recursion
(fn sum-to [n]
  (loop (i 1 acc 0)
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
  (set! sum (+ sum item)))
sum
```

### 3. Fixed Repetition (Repeat)

```lisp
; Retry logic
(var attempts 0)
(var succeeded false)
(repeat 3
  (if (not succeeded)
    (do
      (set! attempts (+ attempts 1))
      (set! succeeded (tryOperation)))
    nil))
```

### 4. Range Iteration (For)

```lisp
; Process numeric range
(var squares [])
(for (i from: 1 to: 11)
  (.push squares (* i i)))
squares
; => [1, 4, 9, 16, 25, 36, 49, 64, 81, 100]
```

### 5. Collection Processing (For)

```lisp
; Transform array elements
(var users [{ name: "Alice" }, { name: "Bob" }])
(var names [])
(for (user users)
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
(for (i from: 0 to: 10 by: 2)
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
  (set! count (+ count 1)))
```

### JavaScript For-Of

```javascript
// JavaScript
for (const item of items) {
  console.log(item);
}

// HQL
(for (item items)
  (print item))
```

### Scheme/Clojure Loop

```scheme
; Scheme (named let)
(let loop ((i 0) (acc 0))
  (if (< i 10)
      (loop (+ i 1) (+ acc i))
      acc))

; HQL (similar)
(loop (i 0 acc 0)
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
(loop (i 0 sum 0)
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
(for (i from: 0 to: 10)
  (print i))

; ❌ Verbose: While loop
(var i 0)
(while (< i 10)
  (print i)
  (set! i (+ i 1)))
```

### Use While for Complex Conditions

```lisp
; ✅ Good: While (clear condition)
(while (and (not done) (< attempts maxAttempts))
  (processItem))

; ❌ Unclear: For loop with break
(for (i 0 to: maxAttempts)
  (if done (break) nil)
  (processItem))
```

### Use Repeat for Fixed Count

```lisp
; ✅ Good: Repeat (clear intent)
(repeat 5
  (print "Hello"))

; ❌ Unnecessary: For loop
(for (i from: 0 to: 5)
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
  (loop (i n acc 1)
    (if (<= i 1)
      acc
      (recur (- i 1) (* acc i)))))
```

### 2. Fibonacci (Loop/Recur)

```lisp
(fn fib [n]
  (loop (i n a 0 b 1)
    (if (= i 0)
      a
      (recur (- i 1) b (+ a b)))))
```

### 3. Array Filtering (Loop/Recur)

```lisp
(fn filter-evens [nums]
  (var result [])
  (loop (i 0)
    (if (< i nums.length)
      (do
        (if (= (% (get nums i) 2) 0)
          (.push result (get nums i))
          nil)
        (recur (+ i 1)))
      result)))
```

### 4. Array Sum (For)

```lisp
(fn sum [nums]
  (var total 0)
  (for (n nums)
    (set! total (+ total n)))
  total)
```

### 5. Retry with Limit (Repeat)

```lisp
(fn retry-operation [op max-attempts]
  (var succeeded false)
  (var attempts 0)
  (repeat max-attempts
    (if (not succeeded)
      (do
        (set! attempts (+ attempts 1))
        (try
          (do
            (op)
            (set! succeeded true))
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
  (print i))  ; Infinite! Missing (set! i (+ i 1))
```

**2. Recur Not in Tail Position**

```lisp
; ❌ Bad: Recur not last expression
(loop (i 0)
  (if (< i 10)
    (+ (recur (+ i 1)) 1)  ; Not tail position!
    i))
```

**3. Off-by-One Error**

```lisp
; ❌ Bad: Loops 0-9 instead of 1-10
(for (i from: 0 to: 10)  ; Should be from: 1 to: 11
  (print i))
```

## Future Enhancements

- `break` and `continue` statements
- `for-in` for object key iteration
- `loop*` with destructuring in bindings
- `while*` with pattern matching
- `doseq` for lazy sequence iteration
- `loop/recur` with guards (early exit conditions)

## Summary

HQL's loop constructs provide:

- ✅ **Tail-call optimization** (loop/recur, no stack overflow)
- ✅ **Traditional loops** (while, for)
- ✅ **Simple repetition** (repeat)
- ✅ **Range iteration** (for with numeric range)
- ✅ **Collection iteration** (for with arrays)
- ✅ **Named parameters** (for with from:/to:/by:)
- ✅ **Functional style** (loop/recur mimics recursion)
- ✅ **Imperative style** (while, for, repeat)

Choose the right loop for the task:

- **Loop/Recur:** Deep recursion, tail-call patterns
- **While:** Complex conditions, stateful iteration
- **Repeat:** Fixed count, simple repetition
- **For:** Range or collection iteration
