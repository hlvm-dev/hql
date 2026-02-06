# Operator Feature Documentation

**Implementation:** Built-in operators (transpiler core) + macros (core.hql)

## Overview

HQL provides operators in prefix notation (Lisp-style):

1. **Arithmetic** -- `+`, `-`, `*`, `/`, `%`, `**`
2. **Comparison** -- `<`, `>`, `<=`, `>=`, `===`, `==`, `!==`, `!=`
3. **Logical** -- `and`, `or`, `not` (word-form macros) / `&&`, `||`, `!` (symbol-form) / `??` (nullish coalescing)
4. **Ternary** -- `?` (conditional expression)
5. **Bitwise** -- `&`, `|`, `^`, `~`, `<<`, `>>`, `>>>`
6. **Assignment** -- `=` (simple), compound (`+=`, `-=`, etc.), bitwise (`&=`, `|=`, etc.), logical (`??=`, `&&=`, `||=`)
7. **Type operators** -- `typeof`, `instanceof`, `in`, `delete`, `void`
8. **First-class operators** -- operators can be passed as values to higher-order functions
9. **Primitive types** -- numbers, strings, booleans, null, undefined
10. **BigInt** -- `123n` syntax for arbitrary-precision integers
11. **String operations** -- concatenation and string methods

## Syntax

### Arithmetic Operators

```lisp
(+ 10 20)           // => 30
(+ 10.5 20.3)       // => 30.8
(+ 1 2 3 4 5)       // => 15 (variadic)

(- 50 30)           // => 20
(- 100.5 50.25)     // => 50.25

(* 6 7)             // => 42
(* 2.5 4.0)         // => 10.0

(/ 100 5)           // => 20
(/ 10.0 4.0)        // => 2.5

(% 17 5)            // => 2

(** 2 10)           // => 1024
(** 3 3)            // => 27

// Unary usage
(+ 5)               // => 5 (unary plus)
(- 5)               // => -5 (unary negation)

// Nested expressions
(+ (* 2 3) (- 10 5))  // => 11
```

All arithmetic operators require at least 1 argument. With 1 argument, `+` and `-` produce unary expressions; `*` and `/` use identity element (1); `%` and `**` use identity element (0).

### Comparison Operators

```lisp
(< 5 10)            // => true
(< 10 5)            // => false
(> 10 5)            // => true
(> 5 10)            // => false
(<= 10 10)          // => true
(<= 5 10)           // => true
(>= 10 10)          // => true
(>= 15 10)          // => true

// Strict equality (=== in JS)
(=== 42 42)         // => true
(=== "hello" "hello") // => true

// Loose equality (== in JS, with type coercion)
(== 42 "42")        // => true

// Strict inequality (!== in JS)
(!== 10 20)         // => true
(!== 10 10)         // => false

// Loose inequality (!= in JS)
(!= 10 20)          // => true
```

All comparison operators require exactly 2 arguments.

> **Note:** `=` is the assignment operator in HQL. Use `===` for strict equality comparison.

### Logical Operators

Word-form macros (preferred for readability):

```lisp
(and true true)     // => true
(and true false)    // => false
(and false false)   // => false
(and a b c)         // variadic: expands to (&& a (&& b c))

(or true true)      // => true
(or true false)     // => true
(or false false)    // => false
(or a b c)          // variadic: expands to (|| a (|| b c))

(not true)          // => false
(not false)         // => true
```

Symbol-form (direct JS operators):

```lisp
(&& true true)      // => true
(|| true false)     // => true
(! true)            // => false
```

Nullish coalescing:

```lisp
(?? null "default")       // => "default"
(?? undefined "default")  // => "default"
(?? 0 "default")          // => 0 (0 is not nullish)
(?? "" "default")         // => "" (empty string is not nullish)
(?? false "default")      // => false (false is not nullish)
```

Combined:

```lisp
(and (> 10 5) (< 3 7))  // => true
```

`&&`, `||`, `??` support variadic chaining: `(&& a b c)` compiles to `a && b && c`.

### Ternary Operator

```lisp
// Syntax: (? condition then-value else-value)
(? true "yes" "no")              // => "yes"
(? false "yes" "no")             // => "no"
(? (> 5 3) "greater" "lesser")   // => "greater"
(+ 10 (? true 5 3))              // => 15
(let result (? (> x 5) "big" "small"))

// Nested ternaries
(? (< x 0) "negative"
  (? (=== x 0) "zero" "positive"))

// With function calls
(? true (double 5) (triple 5))
```

Requires exactly 3 arguments. Follows JavaScript truthiness rules:

```lisp
(? 0 "then" "else")          // => "else" (0 is falsy)
(? "" "then" "else")         // => "else" (empty string is falsy)
(? null "then" "else")       // => "else" (null is falsy)
(? undefined "then" "else")  // => "else" (undefined is falsy)
(? false "then" "else")      // => "else" (false is falsy)
(? 1 "then" "else")          // => "then"
(? "text" "then" "else")     // => "then"
(? [] "then" "else")         // => "then" (empty array is truthy)
```

### Bitwise Operators

```lisp
(& 5 3)             // => 1 (0101 & 0011 = 0001)
(| 5 3)             // => 7 (0101 | 0011 = 0111)
(^ 5 3)             // => 6 (0101 ^ 0011 = 0110)
(~ 5)               // => -6
(<< 5 2)            // => 20 (5 << 2)
(>> 20 2)           // => 5
(>>> -1 0)          // => 4294967295
```

`~` is unary (1 argument). All others require exactly 2 arguments.

### Assignment Operators

Simple assignment:

```lisp
(= x 10)            // Assigns 10 to x
(= obj.prop 42)     // Assigns to member expression
```

`=` is assignment only. Assigning to a literal or expression result is a compile error.

Compound assignment:

```lisp
(let x 10)
(+= x 5)            // x is now 15
(-= x 3)            // x is now 12
(*= x 2)            // x is now 24
(/= x 4)            // x is now 6
(%= x 4)            // x is now 2
(**= x 3)           // x is now 8
```

Bitwise assignment:

```lisp
(&= x 7)            // Bitwise AND assignment
(|= x 4)            // Bitwise OR assignment
(^= x 2)            // Bitwise XOR assignment
(<<= x 1)           // Left shift assignment
(>>= x 1)           // Right shift assignment
(>>>= x 1)          // Unsigned right shift assignment
```

Logical assignment:

```lisp
(??= x "default")   // Nullish coalescing assignment
(&&= x value)       // Logical AND assignment
(||= x fallback)    // Logical OR assignment
```

All assignment operators support simple identifiers and dot-notation member expressions (e.g., `obj.prop`, `obj.a.b.c`).

### Type Operators

```lisp
(typeof 42)           // => "number"
(typeof "hello")      // => "string"
(typeof true)         // => "boolean"
(typeof undefined)    // => "undefined"
(typeof null)         // => "object" (JS quirk)
(typeof [])           // => "object"
(typeof {})           // => "object"
(typeof (fn [] 1))    // => "function"

(instanceof date Date)       // => true
(instanceof [] Array)        // => true
(instanceof "str" String)    // => false (primitive)

(in "name" obj)              // => true if obj has "name" property
(in 0 [1 2 3])               // => true (index exists)

(delete obj.prop)            // Removes prop from obj
(void 0)                     // => undefined
```

`typeof`, `delete`, `void` are unary (1 argument). `instanceof`, `in` are binary (2 arguments).

### First-Class Operators

Operators can be used as values -- passed to higher-order functions, stored in variables, returned from functions:

```lisp
// With reduce
(reduce + 0 [1 2 3 4 5])     // => 15
(reduce * 1 [1 2 3 4 5])     // => 120
(reduce && true [true true false])  // => false
(reduce || false [false false true]) // => true

// Store in variable
(let add-fn +)
(add-fn 10 20)                // => 30

// Array of operators
(let ops [+ - * /])
(map (fn [op] (op 10 5)) ops) // => [15, 5, 50, 2]

// Pass to custom function
(fn apply-op [op a b] (op a b))
(apply-op * 6 7)              // => 42

// Return from function
(fn get-op [name]
  (cond ((=== name "add") +)
        ((=== name "mul") *)
        (else -)))
(let my-op (get-op "mul"))
(my-op 6 7)                   // => 42
```

Supported first-class operators: `+`, `-`, `*`, `/`, `%`, `**`, `===`, `==`, `!==`, `!=`, `<`, `>`, `<=`, `>=`, `&&`, `||`, `!`, `~`, `&`, `|`, `^`, `<<`, `>>`, `>>>`.

When an operator appears in value position (not as the first element of a call), it is converted to a function at runtime using `__hql_get_op`.

### Primitive Types

```lisp
42                  // Integer
3.14159             // Float
-42                 // Negative
"Hello, HQL!"       // String literal
""                  // Empty string
true                // Boolean true
false               // Boolean false
null                // Null value
undefined           // Undefined value
```

### BigInt Literals

```lisp
123n                          // => 123n
9007199254740993n             // => 9007199254740993n (beyond MAX_SAFE_INTEGER)
0n                            // => 0n
```

The parser recognizes the `NNNn` suffix and internally converts it to `(bigint-literal "NNN")`, which compiles to JavaScript `NNNn`.

### String Operations

```lisp
// Concatenation with +
(+ "Hello, " "World!")  // => "Hello, World!"

// Length property
(var str "Hello")
str.length              // => 5

// charAt method
(str.charAt 1)          // => "e"
```

## Implementation Details

### Compilation Targets

```lisp
(+ 10 20)          // => 10 + 20
(< 5 10)           // => 5 < 10
(and true false)   // => true && false  (macro expansion)
(&& true false)    // => true && false  (direct)
(! x)              // => !x
(~ x)              // => ~x
(typeof x)         // => typeof x
(instanceof a B)   // => a instanceof B
(? c t e)          // => c ? t : e
(+= x 5)          // => x += 5
(??= x 10)        // => x ??= 10
123n               // => 123n
```

### Multi-Operand Support

Arithmetic operators and logical operators support variadic arguments by chaining:

```lisp
(+ 1 2 3 4 5)      // => 1 + 2 + 3 + 4 + 5
(&& a b c)          // => a && b && c
```

### Type Coercion

HQL follows JavaScript semantics for type coercion:

```lisp
(+ "5" 5)      // => "55" (string concatenation)
(+ 5 5)        // => 10 (numeric addition)
```

## Operator Precedence

HQL uses explicit parentheses instead of implicit precedence:

```lisp
// JavaScript: 2 + 3 * 4 = 14 (implicit precedence)
// HQL: Must be explicit
(+ 2 (* 3 4))  // => 14  (explicit: 2 + (3 * 4))
(* (+ 2 3) 4)  // => 20  (explicit: (2 + 3) * 4)
```

The transpiler uses a precedence system internally (in `codegen/precedence.ts`) for correct JavaScript parenthesization in the output.

## Operator Semantics

### Arithmetic Operators

| Operator | HQL        | JavaScript | Arity |
| -------- | ---------- | ---------- | ----- |
| `+`      | `(+ a b)`  | `a + b`    | 1+    |
| `-`      | `(- a b)`  | `a - b`    | 1+    |
| `*`      | `(* a b)`  | `a * b`    | 1+    |
| `/`      | `(/ a b)`  | `a / b`    | 1+    |
| `%`      | `(% a b)`  | `a % b`    | 1+    |
| `**`     | `(** a b)` | `a ** b`   | 1+    |

### Comparison Operators

| Operator | HQL          | JavaScript | Description      |
| -------- | ------------ | ---------- | ---------------- |
| `<`      | `(< a b)`    | `a < b`    | Less than        |
| `>`      | `(> a b)`    | `a > b`    | Greater than     |
| `<=`     | `(<= a b)`   | `a <= b`   | Less or equal    |
| `>=`     | `(>= a b)`   | `a >= b`   | Greater or equal |
| `===`    | `(=== a b)`  | `a === b`  | Strict equality  |
| `==`     | `(== a b)`   | `a == b`   | Loose equality   |
| `!==`    | `(!== a b)`  | `a !== b`  | Strict inequality|
| `!=`     | `(!= a b)`   | `a != b`   | Loose inequality |

### Logical Operators

| Operator | HQL          | JavaScript   | Arity | Notes          |
| -------- | ------------ | ------------ | ----- | -------------- |
| `and`    | `(and a b)`  | `a && b`     | 1+    | macro          |
| `or`     | `(or a b)`   | `a \|\| b`   | 1+    | macro          |
| `not`    | `(not a)`    | `a ? false : true` | 1     | macro (via if) |
| `&&`     | `(&& a b)`   | `a && b`     | 2+    | direct         |
| `\|\|`   | `(\|\| a b)` | `a \|\| b`   | 2+    | direct         |
| `!`      | `(! a)`      | `!a`         | 1     | direct         |
| `??`     | `(?? a b)`   | `a ?? b`     | 2+    | nullish coalescing |

### Bitwise Operators

| Operator | HQL          | JavaScript | Arity |
| -------- | ------------ | ---------- | ----- |
| `&`      | `(& a b)`    | `a & b`    | 2     |
| `\|`     | `(\| a b)`   | `a \| b`   | 2     |
| `^`      | `(^ a b)`    | `a ^ b`    | 2     |
| `~`      | `(~ a)`      | `~a`       | 1     |
| `<<`     | `(<< a b)`   | `a << b`   | 2     |
| `>>`     | `(>> a b)`   | `a >> b`   | 2     |
| `>>>`    | `(>>> a b)`  | `a >>> b`  | 2     |

### Assignment Operators

| Operator | HQL            | JavaScript   | Description                   |
| -------- | -------------- | ------------ | ----------------------------- |
| `=`      | `(= a b)`      | `a = b`      | Assignment                    |
| `+=`     | `(+= a b)`     | `a += b`     | Add and assign                |
| `-=`     | `(-= a b)`     | `a -= b`     | Subtract and assign           |
| `*=`     | `(*= a b)`     | `a *= b`     | Multiply and assign           |
| `/=`     | `(/= a b)`     | `a /= b`     | Divide and assign             |
| `%=`     | `(%= a b)`     | `a %= b`     | Remainder and assign          |
| `**=`    | `(**= a b)`    | `a **= b`    | Exponent and assign           |
| `&=`     | `(&= a b)`     | `a &= b`     | Bitwise AND assign            |
| `\|=`    | `(\|= a b)`    | `a \|= b`    | Bitwise OR assign             |
| `^=`     | `(^= a b)`     | `a ^= b`     | Bitwise XOR assign            |
| `<<=`    | `(<<= a b)`    | `a <<= b`    | Left shift assign             |
| `>>=`    | `(>>= a b)`    | `a >>= b`    | Right shift assign            |
| `>>>=`   | `(>>>= a b)`   | `a >>>= b`   | Unsigned right shift assign   |
| `??=`    | `(??= a b)`    | `a ??= b`    | Nullish coalescing assign     |
| `&&=`    | `(&&= a b)`    | `a &&= b`    | Logical AND assign            |
| `\|\|=`  | `(\|\|= a b)`  | `a \|\|= b`  | Logical OR assign             |

### Type Operators

| Operator     | HQL                    | JavaScript           | Arity |
| ------------ | ---------------------- | -------------------- | ----- |
| `typeof`     | `(typeof a)`           | `typeof a`           | 1     |
| `instanceof` | `(instanceof a Type)`  | `a instanceof Type`  | 2     |
| `in`         | `(in key obj)`         | `key in obj`         | 2     |
| `delete`     | `(delete obj.prop)`    | `delete obj.prop`    | 1     |
| `void`       | `(void expr)`          | `void expr`          | 1     |

### Ternary Operator

| Operator | HQL                  | JavaScript           | Arity |
| -------- | -------------------- | -------------------- | ----- |
| `?`      | `(? cond then else)` | `cond ? then : else` | 3     |

## Best Practices

### Use Explicit Parentheses

```lisp
// Good: Clear precedence
(+ (* 2 3) (/ 10 2))
```

### String Concatenation

```lisp
// Prefer explicit concatenation
(+ "Hello, " "World!")

// Works due to JS semantics but less clear
(+ "Count: " 42)  // => "Count: 42"
```

### Comparison Chains

```lisp
// Multiple comparisons need explicit and
(and (> x 0) (< x 100))  // x is between 0 and 100
```

### Ternary vs cond

```lisp
// Good: Simple conditions
(? (> score 90) "A" "B")

// Better for multi-way: use cond
(cond
  ((< score 60) "F")
  ((< score 70) "D")
  ((< score 80) "C")
  ((< score 90) "B")
  (else "A"))
```

## Test Coverage

### Section 1: Arithmetic Operators

- Addition with integers, floats, multiple operands
- Subtraction with integers and floats
- Multiplication with integers and floats
- Division with integers and floats
- Modulo with integers
- Exponentiation
- Nested arithmetic expressions

### Section 2: Comparison Operators

- Less than (true and false cases)
- Greater than (true and false cases)
- Less than or equal (equal and less cases)
- Greater than or equal (equal and greater cases)
- Strict equality with numbers and strings
- Inequality (true and false cases)

### Section 3: Logical Operators

- Logical AND (all combinations)
- Logical OR (all combinations)
- Logical NOT (true and false)

### Section 4: Ternary Operator

- Error validation: too few/many/no arguments
- Basic operations: true/false conditions, comparisons, function calls, arithmetic
- Falsy values: false, 0, empty string, null, undefined
- Nested ternaries: nested in then/else branches, 3-level nesting
- Different contexts: let binding, function return, array/object values
- Side effect evaluation: only then-branch or else-branch executes

### Section 5: Primitive Types

- Integer, float, negative numbers
- String literals, empty strings
- Boolean true and false
- Null and undefined values

### Section 6: String Operations

- String concatenation with +
- String length property
- String charAt method

### Section 7: Combined Expressions

- Arithmetic with comparison
- Comparison with logical operators
- Complex nested expressions
- Arithmetic in variable assignment

### Section 8: First-Class Operators

- reduce with +, *, -, /, &&, ||
- Store operator in variable
- Array of operators with map
- Pass operator to/return from functions
- Bitwise operators in reduce
- Comparison operator stored in variable
- Mixed normal and first-class usage

### Section 9: Compound Assignment

- Arithmetic assignment (+=, -=, *=, /=, %=, **=)
- Bitwise assignment (&=, |=, ^=, <<=, >>=, >>>=)
- Logical assignment (??=, &&=, ||=)
- Member expression targets (obj.prop)

### Section 10: BigInt Literals

- Basic literal, large numbers, zero, negative
- In variable declarations
- In expressions

## Transform Pipeline

```
HQL Source
  |
S-expression Parser (tokenizes 123n as BigInt)
  |
Macro Expansion (and/or/not -> &&/||/if)
  |
AST-to-IR (operator recognition in primitive.ts)
  |
IR-to-TypeScript (infix conversion, precedence)
  |
JavaScript/TypeScript Output
```
