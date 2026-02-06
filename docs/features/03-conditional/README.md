# Conditional Feature Documentation

**Implementation:** `src/hql/transpiler/syntax/conditional.ts` (if, switch, case, ?, do, return, throw), `src/hql/lib/macro/core.hql` (cond, when, unless, if-let, when-let)

## Overview

HQL provides conditional expressions for control flow:

1. **`if`** - Binary conditional (true/false branches) [transpiler]
2. **`cond`** - Multi-way conditional (nested if chains) [macro]
3. **`switch`** - JavaScript-style switch with case/default/fallthrough [transpiler]
4. **`case`** - Clojure-style expression switch (flat val/result pairs) [transpiler]
5. **`?`** - Ternary operator (always expression) [transpiler]
6. **`when`** - Execute body when condition is true, else nil [macro]
7. **`unless`** - Execute body when condition is false, else nil [macro]
8. **`if-let`** - Conditional binding with else branch [macro]
9. **`when-let`** - Conditional binding, single branch [macro]

All conditionals are **expressions** that return values (not statements).

## Syntax

### If Expression

```lisp
// Basic if
(if condition then-expr else-expr)

// Example
(if true 1 2)  // => 1
(if false 1 2) // => 2

// If with comparison
(if (> 5 3) "yes" "no")  // => "yes"

// If without else (defaults to nil)
(if true 1)  // => 1
(if false 1) // => nil

// If with multiple statements (use do)
(if condition
  (do
    (var x 10)
    (+ x 5))
  (do
    (var y 20)
    (- y 5)))

// Nested if
(if outer-condition
  (if inner-condition result1 result2)
  result3)

// If as expression
(let result (if (< 3 5) "less" "greater"))

// If as return value
(fn check [n]
  (if (> n 0) "positive" "non-positive"))
```

### Cond Expression

```lisp
// Grouped syntax (each clause is a 2-element list)
(cond
  ((< x 5) "small")
  ((< x 15) "medium")
  (else "large"))

// Flat syntax (alternating test/result pairs)
(cond
  (< x 5) "small"
  (< x 15) "medium"
  else "large")

// true as fallback (equivalent to else)
(cond
  ((< 5 3) "won't match")
  (true "default"))

// Example with expressions
(let x 10)
(cond
  ((< x 5) "small")
  ((< x 15) "medium")
  (true "large"))  // => "medium"
```

Detection: if the first clause is a list with exactly 2 elements, grouped syntax is used. Otherwise flat syntax.

### Switch Statement

```lisp
// Basic switch
(switch value
  (case 1 "one")
  (case 2 "two")
  (default "other"))

// Switch with string cases
(let status "active")
(switch status
  (case "active" "Running")
  (case "pending" "Waiting")
  (case "error" "Failed")
  (default "Unknown"))

// Switch with fallthrough
(switch grade
  (case "A" :fallthrough)
  (case "B" "Good")
  (default "Other"))

// Switch as expression
(let result
  (switch code
    (case 200 "OK")
    (case 404 "Not Found")
    (default "Error")))

// Switch with no default (implicit null for unmatched)
(switch x
  (case 1 "one")
  (case 2 "two"))
```

Optimized to chained ternaries when all cases are simple. Falls back to IIFE-wrapped JS switch when fallthrough or multiple statements exist.

### Case Expression (Clojure-style)

```lisp
// Flat val/result pairs
(case day
  "monday" "Start of week"
  "friday" "Almost weekend"
  "Other day")                  // odd arg count = last is default

// Case as expression
(let message (case status
               "ok" "Success"
               "error" "Failed"
               "Unknown"))

// Case with numbers
(case code
  200 "OK"
  404 "Not Found"
  500 "Server Error"
  "Unknown")

// Case in expression position
(+ (case x 1 10 2 20 0)
   (case y 1 100 2 200 0))

// No default (even arg count = null for unmatched)
(case day
  "monday" "Start of week"
  "friday" "Almost weekend")    // unmatched => null
```

Uses `===` for comparison. Always compiled to chained ternaries.

### Ternary Operator

```lisp
// Always an expression, never a statement
(? true "yes" "no")     // => "yes"
(? false "yes" "no")    // => "no"

// With expressions
(? (> 5 3) "greater" "lesser")

// Nested
(? (< x 0) "negative"
  (? (== x 0) "zero"
    (? (< x 10) "small" "large")))

// In expression position
(+ 10 (? true 5 3))     // => 15

// In let binding
(let result (? (> x 5) "big" "small"))
```

Requires exactly 3 arguments. Unlike `if`, always compiles to ConditionalExpression (never IfStatement).

### When Expression

```lisp
// Execute when true
(when (> x 10)
  (print "x is large")
  (do-something))

// Returns nil if condition is false
(when false
  (print "never prints"))  // => nil
```

Macro-expands to `(if test (do body...) nil)`.

### Unless Expression

```lisp
// Execute when false
(unless (isEmpty list)
  (print "list has items")
  (process list))

// Returns nil if condition is true
(unless true
  (print "never prints"))  // => nil
```

Macro-expands to `(if test nil (do body...))`.

### If-Let Expression

```lisp
// Conditional binding - execute then-branch if binding is truthy
(if-let [user (find-user id)]
  (greet user)                    // user is bound and truthy
  (print "User not found"))       // else branch

// Paren syntax also works
(if-let (result (compute))
  (use result)
  (handle-error))
```

Macro-expands to bind the variable and check truthiness. Both bracket `[]` and paren `()` binding syntax are supported. Alias: `ifLet`.

### When-Let Expression

```lisp
// Conditional binding (single branch)
(when-let [data (fetch-data)]
  (process data)
  (save data))                    // Only if data is truthy

// Chained
(when-let [user (get-user)]
  (when-let [email user.email]
    (send-notification email)))
```

Macro-expands to bind the variable and check truthiness. Both bracket `[]` and paren `()` binding syntax are supported. Alias: `whenLet`.

## Implementation Details

### If Expression

**Compilation:**

```lisp
(if condition then else)

// Compiles to (when branches are pure expressions):
condition ? then : else

// Compiles to (when branches contain control flow):
if (condition) { then } else { else }
```

**Characteristics:**

- Expression (returns value)
- Evaluates condition once
- Short-circuit evaluation (only evaluates taken branch)
- Can be nested
- Can be used in any expression position
- Else branch defaults to nil if omitted

### Cond Expression

**Compilation:**

```lisp
(cond
  (test1 result1)
  (test2 result2)
  (else default))

// Macro-expands to nested ifs:
(if test1 result1 (if test2 result2 default))
```

**Characteristics:**

- Expression (returns value)
- Evaluates tests in order (top to bottom)
- Short-circuit evaluation (stops at first match)
- `else` is conventional (equivalent to `(true ...)`)
- Can be used in any expression position
- Supports both grouped and flat syntax

### Switch Statement

**Compilation (simple cases):**

```lisp
(switch x (case 1 "one") (case 2 "two") (default "other"))

// Compiles to chained ternaries:
x === 1 ? "one" : x === 2 ? "two" : "other"
```

**Compilation (with fallthrough):**

```lisp
(switch x
  (case 1 :fallthrough)
  (case 2 "one or two")
  (default "other"))

// Compiles to IIFE-wrapped switch:
(() => { switch(x) { case 1: case 2: return "one or two"; default: return "other"; } })()
```

### Case Expression

**Compilation:**

```lisp
(case x 1 "one" 2 "two" "other")

// Always compiles to chained ternaries:
x === 1 ? "one" : x === 2 ? "two" : "other"
```

## Transform Pipeline

```
HQL Source
  |
S-expression Parser
  |
Macro Expansion (cond, when, unless, if-let, when-let)
  |
Conditional Transformers (if, switch, case, ?, do, return, throw)
  |
IR Nodes (ConditionalExpression, IfStatement, SwitchStatement)
  |
ESTree AST
  |
JavaScript
```

## Related Forms

The `do`, `return`, and `throw` forms are also implemented in `conditional.ts`:

- **`do`** - Sequence expression. Uses comma operator (`SequenceExpression`) when all children are pure expressions. Falls back to IIFE when statements or control flow are present. Handles async (`await`), generator (`yield*`), and early return (`throw` for non-local return inside IIFE).
- **`return`** - Return statement. Inside an IIFE context, generates a throw with a special early-return object (caught by IIFE wrapper). Otherwise, generates a normal `ReturnStatement`.
- **`throw`** - Throw statement. Requires exactly one argument.
