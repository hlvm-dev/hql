# Spread Operator Specification

**Source:** `src/hql/transpiler/utils/validation-helpers.ts`, `src/hql/transpiler/syntax/data-structure.ts`, `src/hql/transpiler/syntax/function.ts`, `src/hql/transpiler/syntax/js-interop.ts`, `src/hql/transpiler/pipeline/hql-ast-to-hql-ir.ts`, `src/hql/transpiler/pipeline/ir-to-typescript.ts`

## Overview

The spread operator expands arrays and objects in place. It has two syntactic forms:

1. **Symbol form:** `...identifier` -- spread a variable by name
2. **List form:** `(... expression)` -- spread an arbitrary expression

Both forms work in arrays, function calls, method calls, and objects.

## Syntax

### Symbol Form: `...identifier`

Spreads the value of a named variable.

```lisp
(let arr [1 2])
[...arr 3]          ;; => [1, 2, 3]

(fn add [x y] (+ x y))
(let args [1 2])
(add ...args)       ;; => 3
```

### List Form: `(... expression)`

Spreads the result of any expression. This allows spreading inline literals, function call results, and computed values.

```lisp
[(... [1 2]) 3]             ;; => [1, 2, 3]

(fn getItems [] [1 2])
[(... (getItems)) 3]        ;; => [1, 2, 3]

(let arr [1 2])
[(... (map (=> (* $0 2)) arr)) 99]  ;; => [2, 4, 99]
```

## Array Spread

Spread elements inside array literals (`[...]`). Supports start, middle, end positions and multiple spreads.

```lisp
[...arr 3 4]                ;; spread at start
[1 ...arr 4]                ;; spread in middle
[1 2 ...arr]                ;; spread at end
[0 ...a 3 4 ...b 7]         ;; multiple spreads
[1 ...[] 2]                 ;; empty array (no effect)
```

Compiles to JavaScript:
```javascript
[...arr, 3, 4]
```

## Function Call Spread

Spread arguments in function calls. When spread arguments are present, arity validation is skipped (checked at runtime).

```lisp
(add ...args)               ;; spread all arguments
(add 1 2 ...rest)           ;; mixed positional and spread
(sum ...a ...b)             ;; multiple spreads
```

Compiles to JavaScript:
```javascript
add(...args)
add(1, 2, ...rest)
sum(...a, ...b)
```

## Method Call Spread

Spread works in both dot-notation method calls and `js-call` form.

```lisp
;; dot notation
(arr .push ...items)
(arr .push 1 ...items 4)

;; js-call form
(js-call arr "push" ...items)
(js-call arr "push" (... [1 2 3]))
```

## Object Spread

Spread inside object literals using `hash-map` with spread. When spread is present, the transpiler generates a native JS object expression instead of a `__hql_hash_map` call.

```lisp
(hash-map "a" 1 ...obj "b" 2)          ;; => {a: 1, ...obj, b: 2}
(hash-map (... (hash-map "a" 1)) "b" 2) ;; list form in object
```

Curly-brace syntax also works:
```lisp
{...obj "a": 1}
{"a": 1 ...obj "d": 4}
{...a ...b "c": 3}
{...obj "a": 99}              ;; literal 99 overwrites obj's a
{"a": 1 ...obj}               ;; obj's a overwrites literal
```

Compiles to JavaScript:
```javascript
{ a: 1, ...obj, b: 2 }
```

## IR Representation

Two IR node types handle spread:

- `IRSpreadElement` (type `SpreadElement`): Used in arrays and function/method call arguments. Has `argument: IRNode`.
- `IRSpreadAssignment` (type `SpreadAssignment`): Used in object properties. Has `expression: IRNode`.

Both are defined in `src/hql/transpiler/type/hql_ir.ts`.

## Spread Detection and Transformation

All spread handling is centralized in `src/hql/transpiler/utils/validation-helpers.ts`:

- `isSpreadOperator(node)`: Returns true for both `...identifier` symbols and `(... expr)` lists.
- `transformSpreadOperator(node, ...)`: Returns `IRSpreadElement` for use in arrays and function calls.
- `transformObjectSpreadOperator(node, ...)`: Returns `IRSpreadAssignment` for use in objects.

These are called from:
- `data-structure.ts` (`transformVector` for array spread, `transformHashMap` for object spread)
- `function.ts` (`transformArgsWithSpread` and `transformStandardFunctionCall` for function call spread)
- `js-interop.ts` (for method call spread in dot-notation and `js-call`)
- `hql-ast-to-hql-ir.ts` (for spread in generic call expressions)

## Code Generation

In `ir-to-typescript.ts`:
- `generateSpreadElement`: Emits `...` followed by the argument expression.
- Object expression generation: Checks for `SpreadAssignment` properties and emits `...` followed by the expression.

## Limitations

- Spread creates shallow copies only. Nested structures share references.
- `...(expr)` symbol form is not supported -- use `(... (expr))` list form instead for expression spread.
- No spread in destructuring patterns.

## Test Coverage

Test file: `tests/unit/syntax-spread-operator.test.ts`

### Section 1: Array Spread - Basic
- Array at start, middle, end positions
- Multiple arrays
- Empty array
- Array of arrays (nested)

### Section 2: Function Call Spread - Basic
- Spread all arguments
- Mixed positional and spread
- Multiple spreads in call
- Spread with rest parameter
- Empty array in call

### Section 3: Array Spread - Complex
- Nested array creation
- With map transformations
- With filter operations

### Section 4: Function Call Spread - Complex
- Higher-order function with spread forwarding
- Spread in method call (`.push`)

### Section 5: Integration with Other Features
- With let binding
- With template literals
- With ternary operator

### Section 6: Edge Cases
- Single element array
- Only spreads, no literals
- Spread same array multiple times
- Deeply nested spreads

### Section 7: Object Spread - Basic
- Object at start, middle, end positions
- Multiple objects
- Property overwrite (spread after, spread before)
- Empty object
- Nested object values

### Section 8: Object Spread - Complex
- Spread with computed properties
- Spread in let binding
- Multiple spreads with overwrites

### Section 9: Inline Expression Spread (List Form)
- Inline array expression: `[(... [1 2]) 3]`
- Inline function call expression: `[(... (getItems)) 3]`
- Multiple inline expressions
- Inline expression with map
- Inline object expression: `(hash-map (... (hash-map "a" 1)) "b" 2)`
- Mixed symbol and list form
- Nested inline expressions
- Inline expression in function call

### Section 10: Method Call Spread
- `js-call` method with spread
- Dot notation method with spread
- Method call with inline expression
- Multiple spreads in method call
- Mixed regular and spread in method call
- Concat method with spread
- Method chain (filter)
- Method call with rest parameter spread
