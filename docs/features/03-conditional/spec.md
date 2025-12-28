# Conditional Feature Documentation

**Implementation:** Transpiler syntax transformers
**Coverage:** ✅ 100%

## Overview

HQL provides conditional expressions for control flow:

1. **`if`** - Binary conditional (true/false branches)
2. **`cond`** - Multi-way conditional (pattern matching style)

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

✅ If expression with true/false branches ✅ If with expression conditions ✅ If
with comparison operators (=, !=, <, >, <=, >=) ✅ If with multiple statements
(using `do`) ✅ Nested if expressions ✅ If as expression in bindings ✅ If as
return value in functions ✅ Cond with multiple clauses ✅ Cond with else clause
✅ Cond with variable expressions

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
- Guards in function definitions
- Pattern matching in function parameters
