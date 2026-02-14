# Binding Specification

## Binding Forms

### `let` - Block-scoped mutable binding

Compiles to JavaScript `let`. No freezing.

```
(let <name> <value>)                        ;; simple binding
(let (<name1> <val1> <name2> <val2>) body)  ;; local binding with body (IIFE)
(let [<pattern>] <value>)                   ;; destructuring binding
```

### `const` - Block-scoped immutable binding

Compiles to JavaScript `const`. Value is wrapped with `__hql_deepFreeze()`.

```
(const <name> <value>)
(const (<name1> <val1> ...) body)
(const [<pattern>] <value>)
```

### `var` - Function-scoped mutable binding

Compiles to JavaScript `var`. No freezing. Cannot be used for property assignment (use `=` instead).

```
(var <name> <value>)
(var (<name1> <val1> ...) body)
(var [<pattern>] <value>)
```

### `def` - Alias for `const`

Compiles identically to `const` (deep-frozen `const` declaration). Used for REPL memory persistence.

```
(def <name> <value>)
(def (<name1> <val1> ...) body)
(def [<pattern>] <value>)
```

## Assignment

### `=` - Assignment operator

Handled in `primitive.ts`. Valid targets: symbols, dot-notation properties, member expressions `(. obj prop)`.

```
(= <target> <value>)
(= obj.prop <value>)
(= (. obj prop) <value>)
```

Assigning to literals, `null`, `undefined`, `true`, `false`, or expression results is an error.

### Compound assignment

All 12 compound assignment operators:

```
(+= <target> <value>)   (-= <target> <value>)   (*= <target> <value>)
(/= <target> <value>)   (%= <target> <value>)   (**= <target> <value>)
(&= <target> <value>)   (|= <target> <value>)   (^= <target> <value>)
(<<= <target> <value>)  (>>= <target> <value>)  (>>>= <target> <value>)
```

### Logical assignment

3 logical assignment operators:

```
(??= <target> <value>)  ;; assign if target is null/undefined
(&&= <target> <value>)  ;; assign if target is truthy
(||= <target> <value>)  ;; assign if target is falsy
```

Targets can be symbols or member expressions (same as compound assignment).

## Destructuring

Supported in all four binding forms (`let`, `const`, `var`, `def`).

### Array destructuring

```
(let [a b c] [1 2 3])           ;; simple
(let [x & rest] [1 2 3])        ;; rest pattern
(let [_ b _] [1 2 3])           ;; skip with _
(let [[a b] [c d]] [[1 2] [3 4]])  ;; nested
(let [x (= 10)] [])             ;; default value
```

### Object destructuring

```
(let {x y} {x: 1 y: 2})        ;; simple
(let {x: newX} {x: 42})         ;; property renaming
(let {a x: y} {a: 10 x: 20})   ;; mixed
(let {data: {x y}} {data: {x: 10 y: 20}})             ;; nested
(let {outer: {middle: {inner}}} ...)                    ;; deep nested
(let {nums: [a b]} {nums: [1 2]})                      ;; object containing array
(let [{x y}] [{x: 1 y: 2}])                            ;; array containing object
```

## Type annotations

Binding names support colon-delimited type annotations, parsed by `extractAndNormalizeType`.

```
(let x:number 10)
(const name:string "Alice")
```

## Compilation table

| HQL | JavaScript |
|-----|------------|
| `(let x 10)` | `let x = 10;` |
| `(const x 10)` | `const x = __hql_deepFreeze(10);` |
| `(def x 10)` | `const x = __hql_deepFreeze(10);` |
| `(var x 10)` | `var x = 10;` |
| `(= x 20)` | `x = 20;` |
| `(+= x 5)` | `x += 5;` |
| `(??= x 10)` | `x ??= 10;` |
| `(&&= x val)` | `x &&= val;` |
| `(||= x val)` | `x \|\|= val;` |
| `(let (x 10) body)` | IIFE: `(function() { let x = 10; return body; })()` |
| `(let [a b] val)` | `let [a, b] = val;` |
| `(let {x y} val)` | `let {x, y} = val;` |

## Implementation notes

- Local binding forms with body are compiled as IIFEs. If the body contains `await`, the IIFE is `async` and wrapped in `await`. If it contains `yield`, wrapped in `yield*`.
- `var` cannot target property paths (e.g., `(var obj.prop 10)` is an error).
- Deep freeze uses `__hql_deepFreeze()` helper (defined in `common/runtime-helper-impl.ts`), not `Object.freeze`.
- `const` and `def` apply deep freeze in all binding forms: simple bindings, destructuring, and multi-pair local binding with body.
- `def` is compiled identically to `const` -- it is registered as an alias in `hql-ast-to-hql-ir.ts`.
- Destructuring patterns are parsed by `pattern-parser.ts` and converted to IR by `pattern-to-ir.ts`.
- Compound and logical assignment targets support both simple symbols and dot-notation member expressions (e.g., `obj.prop`, `arr.0`).

## Design Rationale

HQL's binding model differs from Clojure's:

| HQL        | Clojure equivalent | Behavior              |
|------------|-------------------|-----------------------|
| `const`/`def` | `def`          | Immutable (deep frozen) |
| `let`      | (no equivalent)    | Mutable, block-scoped  |
| `var`      | (no equivalent)    | Mutable, function-scoped |

Clojure's `let` creates immutable bindings. HQL's `let` creates mutable
bindings (compiles to JavaScript `let`). Users wanting Clojure-style
immutable local bindings should use `const`.

This is an intentional design choice for JavaScript interop pragmatism,
not a bug.
