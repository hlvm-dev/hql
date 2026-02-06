# Operator Feature Specification

**Implementation:** Built-in operators (transpiler core) + macros (core.hql)

## Overview

HQL provides operators in prefix notation (Lisp-style):

1. **Arithmetic** -- `+`, `-`, `*`, `/`, `%`, `**`
2. **Comparison** -- `<`, `>`, `<=`, `>=`, `===`, `==`, `!==`, `!=`
3. **Logical** -- `and`, `or`, `not` (word-form macros) / `&&`, `||`, `!` (symbol-form) / `??` (nullish coalescing)
4. **Ternary** -- `?` (conditional expression)
5. **Bitwise** -- `&`, `|`, `^`, `~`, `<<`, `>>`, `>>>`
6. **Assignment** -- `=` (simple) / `+=`, `-=`, `*=`, `/=`, `%=`, `**=` (compound) / `&=`, `|=`, `^=`, `<<=`, `>>=`, `>>>=` (bitwise) / `??=`, `&&=`, `||=` (logical)
7. **Type operators** -- `typeof`, `instanceof`, `in`, `delete`, `void`
8. **First-class operators** -- operators can be passed as values to higher-order functions
9. **Primitive types** -- numbers, strings, booleans, null, undefined
10. **BigInt** -- `123n` syntax for arbitrary-precision integers

## Syntax

### Arithmetic Operators

```lisp
(+ 10 20)           // => 30
(+ 10.5 20.3)       // => 30.8
(+ 1 2 3 4 5)       // => 15 (variadic)
(- 50 30)           // => 20
(* 6 7)             // => 42
(/ 100 5)           // => 20
(% 17 5)            // => 2
(** 2 10)           // => 1024

// Unary usage
(+ 5)               // => 5 (unary plus)
(- 5)               // => -5 (unary negation)

// Nested
(+ (* 2 3) (- 10 5))  // => 11
```

### Comparison Operators

```lisp
(< 5 10)              // => true
(> 10 5)              // => true
(<= 10 10)            // => true
(>= 15 10)            // => true
(=== 42 42)           // => true  (strict equality)
(== 42 "42")          // => true  (loose equality, type coercion)
(!== 10 20)           // => true  (strict inequality)
(!= 10 20)            // => true  (loose inequality)
```

All comparison operators require exactly 2 arguments.

### Logical Operators

Word-form (macros expanding to symbol-form):

```lisp
(and true true)         // => true  (expands to &&)
(and true false)        // => false
(or true false)         // => true  (expands to ||)
(or false false)        // => false
(not true)              // => false (expands to (if value false true))
(not false)             // => true
```

Symbol-form (direct operators):

```lisp
(&& true true)          // => true
(|| true false)         // => true
(! true)                // => false
```

Nullish coalescing:

```lisp
(?? null "default")       // => "default"
(?? undefined "default")  // => "default"
(?? 0 "default")          // => 0  (0 is not nullish)
(?? "" "default")         // => "" (empty string is not nullish)
(?? false "default")      // => false (false is not nullish)
```

`&&`, `||`, `??` support variadic chaining: `(&& a b c)` compiles to `a && b && c`.

### Ternary Operator

```lisp
// Syntax: (? condition then-value else-value)
(? true "yes" "no")              // => "yes"
(? (> 5 3) "greater" "lesser")   // => "greater"
(+ 10 (? true 5 3))              // => 15

// Nested
(? (< x 0) "negative"
  (? (=== x 0) "zero" "positive"))
```

Requires exactly 3 arguments (condition, then, else). Follows JavaScript truthiness rules.

### Bitwise Operators

```lisp
(& 5 3)              // => 1   (0101 & 0011 = 0001)
(| 5 3)              // => 7   (0101 | 0011 = 0111)
(^ 5 3)              // => 6   (0101 ^ 0011 = 0110)
(~ 5)                // => -6  (bitwise NOT, unary)
(<< 5 2)             // => 20
(>> 20 2)            // => 5
(>>> -1 0)           // => 4294967295
```

`~` is unary (1 argument). All others require exactly 2 arguments.

### Assignment Operators

Simple assignment:

```lisp
(= x 10)             // Assigns 10 to x
(= obj.prop 42)      // Assigns to member expression
```

`=` is assignment only. It cannot be used for equality comparison. Assigning to a literal or expression result is an error.

Compound assignment:

```lisp
(+= x 5)             // x += 5
(-= x 3)             // x -= 3
(*= x 2)             // x *= 2
(/= x 4)             // x /= 4
(%= x 3)             // x %= 3
(**= x 2)            // x **= 2
```

Bitwise assignment:

```lisp
(&= flags 0xFF)      // flags &= 0xFF
(|= flags 0x01)      // flags |= 0x01
(^= mask 0xAA)       // mask ^= 0xAA
(<<= x 1)            // x <<= 1
(>>= x 1)            // x >>= 1
(>>>= x 1)           // x >>>= 1
```

Logical assignment:

```lisp
(??= x "default")    // x ??= "default"
(&&= x value)        // x &&= value
(||= x fallback)     // x ||= fallback
```

All assignment operators support simple identifiers and dot-notation member expressions (e.g., `obj.prop`, `obj.a.b.c`).

### Type Operators

```lisp
(typeof 42)           // => "number"
(typeof "hello")      // => "string"
(typeof true)         // => "boolean"
(typeof undefined)    // => "undefined"

(instanceof date Date)       // => true/false
(in "name" obj)              // => true/false

(delete obj.prop)            // Removes property
(void 0)                     // => undefined
```

`typeof`, `delete`, `void` are unary (1 argument). `instanceof`, `in` are binary (2 arguments).

### First-Class Operators

Operators can be used as values -- passed to higher-order functions, stored in variables, returned from functions:

```lisp
(reduce + 0 [1 2 3 4 5])     // => 15
(reduce * 1 [1 2 3 4 5])     // => 120
(reduce && true [true true false])  // => false
(reduce || false [false false true]) // => true

(let add-fn +)
(add-fn 10 20)                // => 30

(let ops [+ - * /])
(map (fn [op] (op 10 5)) ops) // => [15, 5, 50, 2]
```

Supported first-class operators: `+`, `-`, `*`, `/`, `%`, `**`, `===`, `==`, `!==`, `!=`, `<`, `>`, `<=`, `>=`, `&&`, `||`, `!`, `~`, `&`, `|`, `^`, `<<`, `>>`, `>>>`.

When an operator appears in value position (not as first element of a call), it is converted to a function at runtime using `__hql_get_op`.

### Primitive Types

```lisp
42                  // Integer
3.14159             // Float
-42                 // Negative
"Hello, HQL!"       // String
""                  // Empty string
true                // Boolean
false               // Boolean
null                // Null
undefined           // Undefined
```

### BigInt Literals

```lisp
123n                         // => 123n
9007199254740993n            // => 9007199254740993n (beyond MAX_SAFE_INTEGER)
0n                           // => 0n
```

The parser recognizes the `NNNn` suffix and internally converts it to `(bigint-literal "NNN")`, which compiles to JavaScript `NNNn`.

### String Operations

```lisp
(+ "Hello, " "World!")  // => "Hello, World!" (string concatenation)

(var str "Hello")
str.length              // => 5
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

Arithmetic operators (`+`, `-`, `*`, `/`, `%`, `**`) and logical operators (`&&`, `||`, `??`) support variadic arguments by chaining:

```lisp
(+ 1 2 3 4 5)      // => 1 + 2 + 3 + 4 + 5
(&& a b c)          // => a && b && c
```

### Type Coercion

HQL follows JavaScript semantics:

```lisp
(+ "5" 5)      // => "55" (string concatenation)
(+ 5 5)        // => 10 (numeric addition)
```

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

With 1 argument: `+` and `-` produce unary expressions; `*` and `/` use identity element (1); `%` and `**` use identity element (0).

### Comparison Operators

| Operator | HQL          | JavaScript | Description     |
| -------- | ------------ | ---------- | --------------- |
| `<`      | `(< a b)`    | `a < b`    | Less than       |
| `>`      | `(> a b)`    | `a > b`    | Greater than    |
| `<=`     | `(<= a b)`   | `a <= b`   | Less or equal   |
| `>=`     | `(>= a b)`   | `a >= b`   | Greater or equal|
| `===`    | `(=== a b)`  | `a === b`  | Strict equality |
| `==`     | `(== a b)`   | `a == b`   | Loose equality  |
| `!==`    | `(!== a b)`  | `a !== b`  | Strict inequality|
| `!=`     | `(!= a b)`   | `a != b`   | Loose inequality|

All require exactly 2 arguments.

### Logical Operators

| Operator | HQL          | JavaScript | Arity |
| -------- | ------------ | ---------- | ----- |
| `and`    | `(and a b)`  | `a && b`   | 1+    |
| `or`     | `(or a b)`   | `a \|\| b` | 1+   |
| `not`    | `(not a)`    | `a ? false : true` | 1  |
| `&&`     | `(&& a b)`   | `a && b`   | 2+    |
| `\|\|`   | `(\|\| a b)` | `a \|\| b` | 2+   |
| `!`      | `(! a)`      | `!a`       | 1     |
| `??`     | `(?? a b)`   | `a ?? b`   | 2+    |

`and` and `or` are macros (variadic, expand recursively). `not` is a macro that expands to `(if value false true)`, which compiles to `value ? false : true`.

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

| Operator | HQL            | JavaScript   | Description             |
| -------- | -------------- | ------------ | ----------------------- |
| `=`      | `(= a b)`      | `a = b`      | Assignment              |
| `+=`     | `(+= a b)`     | `a += b`     | Add and assign          |
| `-=`     | `(-= a b)`     | `a -= b`     | Subtract and assign     |
| `*=`     | `(*= a b)`     | `a *= b`     | Multiply and assign     |
| `/=`     | `(/= a b)`     | `a /= b`     | Divide and assign       |
| `%=`     | `(%= a b)`     | `a %= b`     | Remainder and assign    |
| `**=`    | `(**= a b)`    | `a **= b`    | Exponent and assign     |
| `&=`     | `(&= a b)`     | `a &= b`     | Bitwise AND assign      |
| `\|=`    | `(\|= a b)`    | `a \|= b`    | Bitwise OR assign       |
| `^=`     | `(^= a b)`     | `a ^= b`     | Bitwise XOR assign      |
| `<<=`    | `(<<= a b)`    | `a <<= b`    | Left shift assign       |
| `>>=`    | `(>>= a b)`    | `a >>= b`    | Right shift assign      |
| `>>>=`   | `(>>>= a b)`   | `a >>>= b`   | Unsigned right shift assign |
| `??=`    | `(??= a b)`    | `a ??= b`    | Nullish coalescing assign |
| `&&=`    | `(&&= a b)`    | `a &&= b`    | Logical AND assign      |
| `\|\|=`  | `(\|\|= a b)`  | `a \|\|= b`  | Logical OR assign       |

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

## Operator Precedence

HQL uses explicit parentheses -- there is no implicit precedence:

```lisp
(+ 2 (* 3 4))  // => 14  (explicit: 2 + (3 * 4))
(* (+ 2 3) 4)  // => 20  (explicit: (2 + 3) * 4)
```

The transpiler uses a precedence system internally for correct JavaScript parenthesization (defined in `codegen/precedence.ts`).

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

## Source Locations

- Operator sets: `src/hql/transpiler/keyword/primitives.ts` (PRIMITIVE_OPS, FIRST_CLASS_OPERATORS) and `src/hql/transpiler/syntax/primitive.ts` (COMPOUND_ASSIGN_OPS_SET)
- Operator transforms: `src/hql/transpiler/syntax/primitive.ts` (transformArithmeticOp, transformComparisonOp, transformLogicalOp, transformBitwiseOp, transformTypeOp, transformCompoundAssignment, transformLogicalAssignment, transformEqualsOperator)
- Ternary: `src/hql/transpiler/syntax/conditional.ts` (transformTernary)
- BigInt: `src/hql/transpiler/pipeline/hql-ast-to-hql-ir.ts` (bigint-literal handler)
- First-class: `__hql_get_op` runtime helper
- Macros: `src/hql/lib/macro/core.hql` (and, or, not)
- Codegen: `src/hql/transpiler/pipeline/ir-to-typescript.ts` (generateBinaryExpression, generateUnaryExpression, etc.)
- Precedence: `src/hql/transpiler/codegen/precedence.ts`
