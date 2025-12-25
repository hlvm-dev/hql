# Operator Feature Documentation

**Implementation:** Built-in operators (transpiler core)
**Coverage:** ✅ 100%

## Overview

HQL provides a complete set of operators for:

1. **Arithmetic** - Math operations (`+`, `-`, `*`, `/`, `%`)
2. **Comparison** - Relational tests (`<`, `>`, `<=`, `>=`, `=`, `!=`)
3. **Logical** - Boolean logic (`and`, `or`, `not`)
4. **Ternary** - Conditional expressions (`?`) - **v2.0 feature**
5. **Primitive Types** - Numbers, strings, booleans, null, undefined
6. **String Operations** - Concatenation and string methods
7. **Combined Expressions** - Nested operator usage

All operators use prefix notation (Lisp-style).

## Syntax

### Arithmetic Operators

```lisp
; Addition
(+ 10 20)           ; => 30
(+ 10.5 20.3)       ; => 30.8
(+ 1 2 3 4 5)       ; => 15 (multiple operands)

; Subtraction
(- 50 30)           ; => 20
(- 100.5 50.25)     ; => 50.25

; Multiplication
(* 6 7)             ; => 42
(* 2.5 4.0)         ; => 10.0

; Division
(/ 100 5)           ; => 20
(/ 10.0 4.0)        ; => 2.5

; Modulo
(% 17 5)            ; => 2

; Nested expressions
(+ (* 2 3) (- 10 5))  ; => 11  ((2*3) + (10-5))
```

### Comparison Operators

```lisp
; Less than
(< 5 10)            ; => true
(< 10 5)            ; => false

; Greater than
(> 10 5)            ; => true
(> 5 10)            ; => false

; Less than or equal
(<= 10 10)          ; => true
(<= 5 10)           ; => true

; Greater than or equal
(>= 10 10)          ; => true
(>= 15 10)          ; => true

; Strict Equality
(=== 42 42)           ; => true
(=== "hello" "hello") ; => true

; Loose Equality
(== 42 "42")          ; => true (type coercion)

; Strict Inequality
(!== 10 20)           ; => true
(!== 10 10)           ; => false

; Loose Inequality
(!= 10 20)            ; => true
```

### Logical Operators

```lisp
; Logical AND
(and true true)     ; => true
(and true false)    ; => false
(and false false)   ; => false

; Logical OR
(or true true)      ; => true
(or true false)     ; => true
(or false false)    ; => false

; Logical NOT
(not true)          ; => false
(not false)         ; => true

; Combined
(and (> 10 5) (< 3 7))  ; => true
```

### Ternary Operator (v2.0)

The ternary operator `?` provides JavaScript-style conditional expressions:

```lisp
; Syntax: (? condition then-value else-value)

; Basic usage
(? true "yes" "no")              ; => "yes"
(? false "yes" "no")             ; => "no"

; With comparison
(? (> 5 3) "greater" "lesser")   ; => "greater"

; In expressions
(+ 10 (? true 5 3))              ; => 15

; In let binding
(let result (? (> x 5) "big" "small"))

; Nested ternaries
(? (< x 0) "negative"
  (? (== x 0) "zero" "positive"))

; With function calls
(? true (double 5) (triple 5))
```

#### Falsy Values

The ternary operator follows JavaScript truthiness:

```lisp
(? 0 "then" "else")          ; => "else" (0 is falsy)
(? "" "then" "else")         ; => "else" (empty string is falsy)
(? null "then" "else")       ; => "else" (null is falsy)
(? undefined "then" "else")  ; => "else" (undefined is falsy)
(? false "then" "else")      ; => "else" (false is falsy)

; Truthy values
(? 1 "then" "else")          ; => "then"
(? "text" "then" "else")     ; => "then"
(? [] "then" "else")         ; => "then" (empty array is truthy)
```

### Primitive Types

```lisp
; Numbers
42                  ; Integer
3.14159             ; Float
-42                 ; Negative

; Strings
"Hello, HQL!"       ; String literal
""                  ; Empty string

; Booleans
true                ; Boolean true
false               ; Boolean false

; Null and Undefined
null                ; Null value
undefined           ; Undefined value
```

### String Operations

```lisp
; Concatenation with +
(+ "Hello, " "World!")  ; => "Hello, World!"

; Length property
(var str "Hello")
str.length              ; => 5

; charAt method
(str.charAt 1)          ; => "e"
```

## Implementation Details

### Compilation Targets

#### Arithmetic Operators

```lisp
(+ 10 20)
; Compiles to:
10 + 20
```

#### Comparison Operators

```lisp
(< 5 10)
; Compiles to:
5 < 10
```

#### Logical Operators

```lisp
(and true false)
; Compiles to:
true && false
```

### Multi-Operand Support

Some operators support multiple operands:

```lisp
(+ 1 2 3 4 5)
; Compiles to:
1 + 2 + 3 + 4 + 5
```

### Operators as First-Class Values

Operators can be passed as arguments to higher-order functions like `reduce`:

```lisp
;; Sum all numbers
(reduce + 0 [1 2 3 4 5])     ; => 15

;; Product of all numbers
(reduce * 1 [1 2 3 4 5])     ; => 120

;; Logical operations
(reduce && true [true true false])  ; => false
(reduce || false [false false true]) ; => true
```

This works with all operators: arithmetic (`+`, `-`, `*`, `/`, `%`, `**`),
comparison (`===`, `==`, `!==`, `!=`, `<`, `>`, `<=`, `>=`),
logical (`&&`, `||`), and bitwise (`&`, `|`, `^`, `<<`, `>>`, `>>>`).

**Implementation:** When an operator symbol appears in value position (not as the
first element of a call), it's converted to a function at runtime using `__hql_get_op`.

### Type Coercion

HQL follows JavaScript semantics for type coercion:

```lisp
(+ "5" 5)      ; => "55" (string concatenation)
(+ 5 5)        ; => 10 (numeric addition)
```

## Features Covered

✅ Arithmetic operators (+, -, *, /, %) ✅ Comparison operators (<, >, <=, >=,
=, !=) ✅ Logical operators (and, or, not) ✅ **Ternary operator (?) - v2.0** ✅ Integer arithmetic ✅
Floating-point arithmetic ✅ Multi-operand operations ✅ Nested expressions ✅
Primitive types (number, string, boolean, null, undefined) ✅ String
concatenation ✅ String properties and methods ✅ Combined expressions
(arithmetic + comparison + logic + ternary)

## Test Coverage



### Section 1: Arithmetic Operators

- Addition with integers
- Addition with floats
- Addition with multiple operands
- Subtraction with integers
- Subtraction with floats
- Multiplication with integers
- Multiplication with floats
- Division with integers
- Division with floats
- Modulo with integers
- Nested arithmetic expressions

### Section 2: Comparison Operators

- Less than (true and false cases)
- Greater than (true and false cases)
- Less than or equal (equal and less cases)
- Greater than or equal (equal and greater cases)
- Equality with numbers
- Equality with strings
- Inequality (true and false cases)

### Section 3: Logical Operators

- Logical AND (all combinations)
- Logical OR (all combinations)
- Logical NOT (true and false)

### Section 3.5: Ternary Operator - v2.0

- Error validation: too few/many/no arguments
- Basic operations: true/false conditions, comparisons, function calls, arithmetic
- Falsy values: false, 0, empty string, null, undefined
- Nested ternaries: nested in then/else branches, 3-level nesting, multiple in expression
- Different contexts: let binding, function return, array/object values
- Return values: null and undefined from branches
- Side effect evaluation: only then-branch or else-branch executes

### Section 4: Primitive Types

- Integer numbers
- Floating-point numbers
- Negative numbers
- String literals
- Empty strings
- Boolean true
- Boolean false
- Null value
- Undefined value

### Section 5: String Operations

- String concatenation with +
- String length property
- String charAt method

### Section 6: Combined Expressions

- Arithmetic with comparison
- Comparison with logical operators
- Complex nested expressions
- Arithmetic in variable assignment

## Operator Precedence

HQL uses explicit parentheses instead of implicit precedence:

```lisp
; JavaScript: 2 + 3 * 4 = 14 (implicit precedence)
; HQL: Must be explicit

(+ 2 (* 3 4))  ; => 14  (explicit: 2 + (3 * 4))
(* (+ 2 3) 4)  ; => 20  (explicit: (2 + 3) * 4)
```

## Related Specs

- Operators are core language features
- Implementation in transpiler core

## Examples

See `examples.hql` for executable examples.

## Transform Pipeline

```
HQL Source
  ↓
S-expression Parser
  ↓
Operator Recognition (built-in forms)
  ↓
Transpiler (infix conversion for JS)
  ↓
ESTree AST
  ↓
JavaScript
```

## Operator Semantics

### Arithmetic Operators

| Operator | HQL       | JavaScript | Arity |
| -------- | --------- | ---------- | ----- |
| `+`      | `(+ a b)` | `a + b`    | 2+    |
| `-`      | `(- a b)` | `a - b`    | 2     |
| `*`      | `(* a b)` | `a * b`    | 2     |
| `/`      | `(/ a b)` | `a / b`    | 2     |
| `%`      | `(% a b)` | `a % b`    | 2     |

### Comparison Operators

| Operator | HQL         | JavaScript | Description               |
| -------- | ----------- | ---------- | ------------------------- |
| `<`      | `(< a b)`   | `a < b`    | Less than                 |
| `>`      | `(> a b)`   | `a > b`    | Greater than              |
| `<=`     | `(<= a b)`  | `a <= b`   | Less or equal             |
| `>=`     | `(>= a b)`  | `a >= b`   | Greater or equal          |
| `===`    | `(=== a b)` | `a === b`  | Strict equality           |
| `==`     | `(== a b)`  | `a == b`   | Loose equality (coercion) |
| `!==`    | `(!== a b)` | `a !== b`  | Strict inequality         |
| `!=`     | `(!= a b)`  | `a != b`   | Loose inequality          |

> **Note:** `=` is the assignment operator in HQL. Use `===` for strict equality.

### Logical Operators

| Operator | HQL         | JavaScript | Description |
| -------- | ----------- | ---------- | ----------- |
| `and`    | `(and a b)` | `a && b`   | Logical AND |
| `or`     | `(or a b)`  | `a \|\| b` | Logical OR  |
| `not`    | `(not a)`   | `!a`       | Logical NOT |

### Ternary Operator (v2.0)

| Operator | HQL                   | JavaScript       | Description           | Arity |
| -------- | --------------------- | ---------------- | --------------------- | ----- |
| `?`      | `(? cond then else)` | `cond ? then : else` | Conditional expression | 3     |

**Features:**
- JavaScript-style conditional expressions
- Short-circuit evaluation (only one branch executes)
- Follows JavaScript truthiness rules
- Can be nested and composed
- Works in any expression context

## Edge Cases Tested

✅ Multiple operands for addition ✅ Floating-point precision ✅ Negative
numbers ✅ Empty strings ✅ Null and undefined values ✅ String concatenation vs
numeric addition ✅ Nested expressions with multiple operator types ✅
Comparison with equality ✅ Short-circuit evaluation (and, or, ternary) ✅
**Ternary with all falsy values (0, "", null, undefined, false)** ✅
**Nested ternaries (3+ levels)** ✅ **Ternary side-effect evaluation**

## Best Practices

### Use Explicit Parentheses

```lisp
; Good: Clear precedence
(+ (* 2 3) (/ 10 2))

; Avoid: Ambiguous (not valid HQL anyway)
; 2 * 3 + 10 / 2
```

### String Concatenation

```lisp
; Prefer explicit concatenation
(+ "Hello, " "World!")

; Works due to JS semantics but less clear
(+ "Count: " 42)  ; => "Count: 42"
```

### Comparison Chains

```lisp
; Multiple comparisons need explicit and
(and (> x 0) (< x 100))  ; x is between 0 and 100
```

### Ternary Operator Usage

```lisp
; Good: Simple, clear conditions
(? (> score 90) "A" "B")

; Good: Nested for multiple conditions
(? (< score 0) "invalid"
  (? (< score 60) "F"
    (? (< score 70) "D"
      (? (< score 80) "C"
        (? (< score 90) "B" "A")))))

; Consider: Use cond for complex multi-way branches
(cond
  ((< score 0) "invalid")
  ((< score 60) "F")
  ((< score 70) "D")
  ((< score 80) "C")
  ((< score 90) "B")
  (else "A"))

; Good: Ternary in expressions
(* quantity (? premium 1.5 1.0))
```

## Implemented in v2.0

✅ **Ternary operator (`?`)** - JavaScript-style conditional expressions

## Implemented Operators

### Bitwise Operators (implemented)

| Operator | HQL          | JavaScript  | Description           |
| -------- | ------------ | ----------- | --------------------- |
| `~`      | `(~ a)`      | `~a`        | Bitwise NOT           |
| `&`      | `(& a b)`    | `a & b`     | Bitwise AND           |
| `\|`     | `(\| a b)`   | `a \| b`    | Bitwise OR            |
| `^`      | `(^ a b)`    | `a ^ b`     | Bitwise XOR           |
| `<<`     | `(<< a b)`   | `a << b`    | Left shift            |
| `>>`     | `(>> a b)`   | `a >> b`    | Right shift           |
| `>>>`    | `(>>> a b)`  | `a >>> b`   | Unsigned right shift  |

### Exponentiation (implemented)

| Operator | HQL          | JavaScript | Description    |
| -------- | ------------ | ---------- | -------------- |
| `**`     | `(** a b)`   | `a ** b`   | Exponentiation |

## Future Enhancements

- Pipeline operator (`|>`) - Function composition
- Custom operator definitions (advanced metaprogramming)
