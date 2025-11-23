# Operator Feature Documentation

**Implementation:** Built-in operators (transpiler core) **Test Count:** 47
tests **Coverage:** ✅ 100%

## Overview

HQL provides a complete set of operators for:

1. **Arithmetic** - Math operations (`+`, `-`, `*`, `/`, `%`)
2. **Comparison** - Relational tests (`<`, `>`, `<=`, `>=`, `=`, `!=`)
3. **Logical** - Boolean logic (`and`, `or`, `not`)
4. **Primitive Types** - Numbers, strings, booleans, null, undefined
5. **String Operations** - Concatenation and string methods
6. **Combined Expressions** - Nested operator usage

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

; Equality
(= 42 42)           ; => true
(= "hello" "hello") ; => true

; Inequality
(!= 10 20)          ; => true
(!= 10 10)          ; => false
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

### Type Coercion

HQL follows JavaScript semantics for type coercion:

```lisp
(+ "5" 5)      ; => "55" (string concatenation)
(+ 5 5)        ; => 10 (numeric addition)
```

## Features Covered

✅ Arithmetic operators (+, -, *, /, %) ✅ Comparison operators (<, >, <=, >=,
=, !=) ✅ Logical operators (and, or, not) ✅ Integer arithmetic ✅
Floating-point arithmetic ✅ Multi-operand operations ✅ Nested expressions ✅
Primitive types (number, string, boolean, null, undefined) ✅ String
concatenation ✅ String properties and methods ✅ Combined expressions
(arithmetic + comparison + logic)

## Test Coverage

**Total Tests:** 47

### Section 1: Arithmetic Operators (11 tests)

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

### Section 2: Comparison Operators (12 tests)

- Less than (true and false cases)
- Greater than (true and false cases)
- Less than or equal (equal and less cases)
- Greater than or equal (equal and greater cases)
- Equality with numbers
- Equality with strings
- Inequality (true and false cases)

### Section 3: Logical Operators (8 tests)

- Logical AND (all combinations)
- Logical OR (all combinations)
- Logical NOT (true and false)

### Section 4: Primitive Types (9 tests)

- Integer numbers
- Floating-point numbers
- Negative numbers
- String literals
- Empty strings
- Boolean true
- Boolean false
- Null value
- Undefined value

### Section 5: String Operations (3 tests)

- String concatenation with +
- String length property
- String charAt method

### Section 6: Combined Expressions (4 tests)

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

| Operator | HQL        | JavaScript | Description         |
| -------- | ---------- | ---------- | ------------------- |
| `<`      | `(< a b)`  | `a < b`    | Less than           |
| `>`      | `(> a b)`  | `a > b`    | Greater than        |
| `<=`     | `(<= a b)` | `a <= b`   | Less or equal       |
| `>=`     | `(>= a b)` | `a >= b`   | Greater or equal    |
| `=`      | `(= a b)`  | `a === b`  | Equality (strict)   |
| `!=`     | `(!= a b)` | `a !== b`  | Inequality (strict) |

### Logical Operators

| Operator | HQL         | JavaScript | Description |
| -------- | ----------- | ---------- | ----------- |
| `and`    | `(and a b)` | `a && b`   | Logical AND |
| `or`     | `(or a b)`  | `a \|\| b` | Logical OR  |
| `not`    | `(not a)`   | `!a`       | Logical NOT |

## Edge Cases Tested

✅ Multiple operands for addition ✅ Floating-point precision ✅ Negative
numbers ✅ Empty strings ✅ Null and undefined values ✅ String concatenation vs
numeric addition ✅ Nested expressions with multiple operator types ✅
Comparison with equality ✅ Short-circuit evaluation (and, or)

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

## Future Enhancements

- Bitwise operators (`&`, `|`, `^`, `~`, `<<`, `>>`)
- Exponentiation operator (`**`)
- Nullish coalescing (`??`)
- Optional chaining (`?.`)
- Type checking operators (`typeof`, `instanceof`)
- Custom operator definitions (advanced metaprogramming)
