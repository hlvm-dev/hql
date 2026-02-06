# Rest Parameters Specification

## Syntax

Two equivalent syntaxes for declaring rest parameters:

| Syntax | Example | Origin |
|--------|---------|--------|
| `...name` | `[a ...rest]` | JavaScript-style |
| `& name` | `[a & rest]` | Clojure-style |

Both compile to JavaScript `...rest` parameters.

## Grammar

```
param-list := "[" param* rest-param? "]"
rest-param := ("..." IDENTIFIER) | ("&" IDENTIFIER)
param      := IDENTIFIER | IDENTIFIER "=" default-value | destructure-pattern
```

## Rules

1. A function may have at most one rest parameter.
2. The rest parameter must be the last parameter in the list.
3. Rest parameters cannot have default values (the default-value check is silently skipped for rest params; no error is raised).
4. The rest parameter collects all remaining arguments into a JavaScript array.
5. If no remaining arguments exist, the rest parameter is an empty array `[]`.
6. In multi-arity parsing (`transformMultiArityFn`), the parser `break`s after the first rest indicator -- tokens after it are silently ignored. In single-arity parsing (`parseParameters`), there is no `break`; extra tokens after the rest param continue to be processed.

## Supported Contexts

| Context | Syntax | Tested |
|---------|--------|--------|
| Named `fn` function | `(fn name [...rest] body)` | Yes |
| Anonymous `fn` function | `(fn [...rest] body)` | Yes |
| Arrow function `=>` | `(=> (...rest) body)` | Yes |
| Multi-arity function | `(fn name ([& rest] body))` | Yes |
| With regular params | `(fn name [a b ...rest] body)` | Yes |
| With default params | `(fn name [a = 1 ...rest] body)` | Yes |
| With destructuring | `(fn name [[x y] ...rest] body)` | Yes |
| With object destructuring | `(fn name [{"k": v} ...rest] body)` | Yes |

## Compilation

### Single-arity function

```
;; Input
(fn sum [...nums] (.reduce nums (fn [a b] (+ a b)) 0))

;; Output (JavaScript)
function sum(...nums) {
  return nums.reduce((a, b) => a + b, 0);
}
```

### Multi-arity with rest

In multi-arity functions, the rest-parameter arity compiles as the `default` case in a `switch` on `__args.length`. The rest parameter is assigned via `__args.slice(arity)`.

## Array Operations

Rest parameters are standard JavaScript arrays. All array properties and methods are available: indexing (`get items 0`), `.length`, `.map`, `.filter`, `.reduce`, `.join`, etc.

## Spread into Rest

A rest-parameter array can be spread into another function call:

```
(fn sum [...nums] (.reduce nums (fn [a b] (+ a b)) 0))
(fn avg [...vs] (/ (sum ...vs) (get vs "length")))
```

## Test Files

- `tests/unit/syntax-rest-params.test.ts` -- 19 tests covering basic rest, empty arrays, array access, destructuring + rest, default + rest, arrow + rest, nested functions, spread, edge cases.
- `tests/unit/organized/syntax/function/function.test.ts` -- additional `& rest` syntax tests.

## Implementation

Source: `src/hql/transpiler/syntax/function.ts`

Key functions:
- `parseParameters()` -- handles both `&` and `...` rest syntax in single-arity functions.
- `transformMultiArityFn()` -- handles rest in multi-arity dispatch (rest arities sorted last, compiled as `default` switch case).
- `parseParametersWithDefaults()` -- delegates to `parseParameters` with `supportRest: true`.
