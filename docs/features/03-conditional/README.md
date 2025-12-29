# Conditional Feature Documentation

**Implementation:** Transpiler syntax transformers
**Coverage:** ✅ 100%

## Overview

HQL v2.0 provides conditional expressions for control flow:

1. **`if`** - Binary conditional (true/false branches)
2. **`cond`** - Multi-way conditional (pattern matching style)
3. **`switch`** - JavaScript-style switch statement (v2.0)
4. **`when`** - Execute when condition is true (v2.0)
5. **`unless`** - Execute when condition is false (v2.0)
6. **`match`** - Pattern matching expression (v2.0)

All conditionals are **expressions** that return values (not statements).

## Syntax

### If Expression

```lisp
; Basic if
(if condition then-expr else-expr)

; Example
(if true 1 2)  ; => 1
(if false 1 2) ; => 2

; If with comparison
(if (> 5 3) "yes" "no")  ; => "yes"

; If with multiple statements (use do)
(if condition
  (do
    (var x 10)
    (+ x 5))
  (do
    (var y 20)
    (- y 5)))

; Nested if
(if outer-condition
  (if inner-condition result1 result2)
  result3)

; If as expression
(let result (if (< 3 5) "less" "greater"))

; If as return value
(fn check [n]
  (if (> n 0) "positive" "non-positive"))
```

### Cond Expression

```lisp
; Multi-way conditional
(cond
  (condition1 result1)
  (condition2 result2)
  (condition3 result3)
  (else default-result))

; Example with else
(cond
  ((< x 5) "small")
  ((< x 15) "medium")
  (else "large"))

; Example with true as fallback
(cond
  ((< 5 3) "won't match")
  (true "default"))

; Cond with expressions
(let x 10)
(cond
  ((< x 5) "small")
  ((< x 15) "medium")
  (true "large"))  ; => "medium"
```

### Switch Statement (v2.0)

```lisp
; Basic switch
(switch value
  (case 1 (print "one"))
  (case 2 (print "two"))
  (default (print "other")))

; Switch with string cases
(let status "active")
(switch status
  (case "active" (print "Running"))
  (case "pending" (print "Waiting"))
  (case "error" (print "Failed"))
  (default (print "Unknown")))

; Switch with fallthrough
(switch grade
  (case "A" :fallthrough)
  (case "B" (print "Good"))
  (default (print "Other")))

; Switch as expression
(let result
  (switch code
    (case 200 "OK")
    (case 404 "Not Found")
    (default "Error")))
```

### When Expression (v2.0)

```lisp
; Execute when true
(when (> x 10)
  (print "x is large")
  (do-something))

; when returns nil if condition is false
(when false
  (print "never prints"))  ; => nil

; Equivalent to (if condition (do body...) nil)
```

### Unless Expression (v2.0)

```lisp
; Execute when false
(unless (isEmpty list)
  (print "list has items")
  (process list))

; unless returns nil if condition is true
(unless true
  (print "never prints"))  ; => nil

; Equivalent to (if (not condition) (do body...) nil)
```

### If-Let Expression (v2.0)

```lisp
; Conditional binding - only execute then-branch if binding is truthy
(if-let [user (find-user id)]
  (greet user)                    ; user is bound and truthy
  (print "User not found"))       ; else branch

; Bracket or paren syntax both work
(if-let (result (compute))
  (use result)
  (handle-error))

; Common pattern for optional values
(if-let [config (load-config)]
  (apply-config config)
  (use-defaults))
```

### When-Let Expression (v2.0)

```lisp
; Conditional binding (single branch)
(when-let [data (fetch-data)]
  (process data)
  (save data))                    ; Only if data is truthy

; Useful for chained optional access
(when-let [user (get-user)]
  (when-let [email user.email]
    (send-notification email)))
```

### Match Expression (v2.0)

```lisp
; Pattern matching
(match value
  (case 1 "one")
  (case 2 "two")
  (default "other"))

; Match with destructuring
(match point
  (case [0, 0] "origin")
  (case [x, 0] (+ "on x-axis at " x))
  (case [0, y] (+ "on y-axis at " y))
  (case [x, y] (+ "at (" x ", " y ")")))

; Match with guards
(match n
  (case x (if (> x 0)) "positive")
  (case x (if (< x 0)) "negative")
  (default "zero"))

; Match as expression
(let description
  (match status-code
    (case 200 "Success")
    (case 404 "Not Found")
    (case 500 "Server Error")
    (default "Unknown")))
```

## Implementation Details

### If Expression

**Compilation:**

```lisp
(if condition then else)

; Compiles to:
condition ? then : else
```

**Characteristics:**

- ✅ Expression (returns value)
- ✅ Evaluates condition once
- ✅ Short-circuit evaluation (only evaluates taken branch)
- ✅ Can be nested
- ✅ Can be used in any expression position

### Cond Expression

**Compilation:**

```lisp
(cond
  (test1 result1)
  (test2 result2)
  (else default))

; Compiles to nested ternaries:
test1 ? result1 :
test2 ? result2 :
default
```

**Characteristics:**

- ✅ Expression (returns value)
- ✅ Evaluates tests in order (top to bottom)
- ✅ Short-circuit evaluation (stops at first match)
- ✅ `else` is conventional (equivalent to `(true ...)`)
- ✅ Can be used in any expression position

## Features Covered

### Core Conditionals
✅ If expression with true/false branches
✅ If with expression conditions
✅ If with comparison operators (=, !=, <, >, <=, >=)
✅ If with multiple statements (using `do`)
✅ Nested if expressions
✅ If as expression in bindings
✅ If as return value in functions
✅ Cond with multiple clauses
✅ Cond with else clause
✅ Cond with variable expressions

### Extended Conditionals (v2.0)
✅ Switch statement with case/default
✅ Switch with fallthrough
✅ When expression (single-branch true)
✅ Unless expression (single-branch false)
✅ If-let (conditional binding with else)
✅ When-let (conditional binding, single branch)
✅ Match expression with pattern matching
✅ Match with destructuring (arrays, objects)
✅ Match with guards

## Test Coverage



### Section 1: If Expressions

- If true branch
- If false branch
- If with expression condition
- If with multiple statements
- Nested if
- If as expression in let
- If as return value

### Section 2: Cond Expressions

- Cond with multiple clauses
- Cond with else clause
- Cond with expressions

### Section 3: If with Operators

- If with `=` operator
- If with `!=` operator
- If with `<=` operator
- If with `>=` operator

## Use Cases

### Simple Conditional

```lisp
(if (> age 18) "adult" "minor")
```

### Guard Pattern

```lisp
(fn processInput [value]
  (if (=== value null)
    "no input"
    (doSomething value)))
```

### Multi-Way Branching

```lisp
(fn getGrade [score]
  (cond
    ((>= score 90) "A")
    ((>= score 80) "B")
    ((>= score 70) "C")
    ((>= score 60) "D")
    (else "F")))
```

### Ternary-Style

```lisp
(let status (if isActive "active" "inactive"))
```

## Comparison with Other Languages

### JavaScript

```javascript
// JavaScript if statement
if (x > 5) {
  return "yes";
} else {
  return "no";
}

// HQL if expression
(if (> x 5) "yes" "no")
```

### JavaScript Ternary

```javascript
// JavaScript ternary
const result = x > 5 ? "yes" : "no";

// HQL if (same concept)
(let result (if (> x 5) "yes" "no"))
```

### JavaScript Switch

```javascript
// JavaScript switch
switch(true) {
  case x < 5: return "small";
  case x < 15: return "medium";
  default: return "large";
}

// HQL cond
(cond
  ((< x 5) "small")
  ((< x 15) "medium")
  (else "large"))
```

## Related Specs

- Complete conditional specification available in project specs
- Transpiler implementation in syntax transformers

## Examples

See `examples.hql` for executable examples.

## Transform Pipeline

```
HQL Source
  ↓
S-expression Parser
  ↓
Conditional Transformers (if, cond)
  ↓
IR Nodes
  ↓
ESTree AST (ternary operators)
  ↓
JavaScript
```

## Best Practices

### Prefer Expressions Over Statements

```lisp
; ✅ Good: Expression style
(let result (if condition "yes" "no"))

; ❌ Avoid: Statement style (not idiomatic in HQL)
(var result)
(if condition
  (= result "yes")
  (= result "no"))
```

### Use Cond for Multiple Conditions

```lisp
; ✅ Good: Clear cond
(cond
  ((< x 5) "small")
  ((< x 15) "medium")
  (else "large"))

; ❌ Avoid: Nested if
(if (< x 5)
  "small"
  (if (< x 15)
    "medium"
    "large"))
```

### Always Handle Else Case

```lisp
; ✅ Good: Explicit else
(if condition "yes" "no")

(cond
  (test1 result1)
  (test2 result2)
  (else "default"))

; ⚠️ Be careful: No else (undefined if condition false)
; This is allowed but may not be what you want
```

## Edge Cases Tested

✅ True and false literal conditions ✅ Expression conditions (comparisons) ✅
Multiple statements in branches (using `do`) ✅ Nested conditionals ✅
Conditionals as expressions ✅ Conditionals as return values ✅ All comparison
operators (=, !=, <, >, <=, >=) ✅ Multiple cond clauses ✅ Cond with else
fallback

## Future Enhancements

- Exhaustiveness checking for enums in match
- Pattern matching in function parameters
- Nested pattern destructuring optimization
