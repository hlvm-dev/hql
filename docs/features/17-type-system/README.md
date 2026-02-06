# Type System

HQL provides TypeScript type annotations and type declarations with two approaches:

1. **Native HQL Syntax** -- S-expression syntax for type operators (`|`, `&`, `keyof`, `mapped`, etc.)
2. **String Passthrough** -- Raw TypeScript strings for any type expression not covered by native syntax

## Type Annotations

Type annotations use colon syntax with **no space** after the colon (whitespace is a token delimiter in S-expressions).

### Function Parameters

```lisp
(fn add [a:number b:number] :number
  (+ a b))
```

### Return Types

```lisp
(fn get-count [] :number
  42)
```

### Variable Bindings

```lisp
(let x:number 42)
(const name:string "hello")
```

### Mixed Typed and Untyped

```lisp
(fn greet [name:string times]
  (print name times))
```

### Inline Type Syntax

The type tokenizer supports these inline forms:

- Simple types: `x:number`, `x:string`, `x:boolean`
- Generic types: `arr:Array<number>`, `m:Map<string,number>`
- Union types: `x:number|string`
- Nullable shorthand: `x:?number` (becomes `(number) | null | undefined`)
- Array shorthand: `x:string[]` (becomes `Array<string>`)
- Object types: `x:{name:string, age:number}`
- Tuple types: `x:[string, number]`
- Function types: `x:(a: number) => string`

## Type Alias Declarations

### `type` keyword (primary)

```lisp
(type MyString string)
(type ID number)
(type Container<T> T)
```

### `deftype` (backward compatible, also supports string passthrough)

```lisp
(deftype MyNumber number)
(deftype Complex "Record<string, number>")
(deftype EventName "`on${string}`")
(deftype "KeyValue<K extends string, V>" "{ key: K; value: V }")
```

## Native Type Operators

These compile from S-expression syntax directly to TypeScript:

| HQL Syntax | TypeScript Output |
|------------|-------------------|
| `(\| A B C)` | `A \| B \| C` |
| `(& A B)` | `A & B` |
| `(keyof T)` | `keyof T` |
| `(indexed T K)` | `T[K]` |
| `(if-extends T U X Y)` | `T extends U ? X : Y` |
| `(mapped K Keys V)` | `{ [K in Keys]: V }` |
| `(tuple A B C)` | `[A, B, C]` |
| `(array T)` | `T[]` |
| `(readonly T)` | `readonly T` |
| `(typeof x)` | `typeof x` |
| `(infer T)` | `infer T` |
| `(rest T)` | `...T` |

Utility types (any capitalized name) are treated as generic type application:

| HQL Syntax | TypeScript Output |
|------------|-------------------|
| `(Partial T)` | `Partial<T>` |
| `(Required T)` | `Required<T>` |
| `(Pick T K)` | `Pick<T, K>` |
| `(Omit T K)` | `Omit<T, K>` |
| `(Record K V)` | `Record<K, V>` |
| `(NonNullable T)` | `NonNullable<T>` |

### Precedence

Intersection inside union and union/intersection inside array get parentheses automatically:

```lisp
(type T (| (& A B) C))        ;; => (A & B) | C
(type T (array (| A B)))      ;; => (A | B)[]
```

## Advanced Declarations

### Interfaces

```lisp
(interface User "{ id: string; name: string }")
(interface Box<T> "{ value: T; getValue(): T }")
(interface Employee extends Person "{ salary: number }")
(interface Manager extends Person Serializable "{ department: string }")
```

### Abstract Classes

```lisp
(abstract-class Animal [
  (abstract-method speak [] :string)
])

(abstract-class Container<T> [
  (abstract-method getValue [] :T)
  (abstract-method setValue "value: T" :void)
])
```

### Function Overloads

```lisp
(fn-overload process "x: string" :string)
(fn-overload process "x: number" :number)
(fn-overload "identity<T>" "x: T" :T)
```

### Namespaces

```lisp
(namespace Utils [
  (deftype ID "string")
])
```

### Const Enums

```lisp
(const-enum Direction [North South East West])
(const-enum Status [(OK 200) (NotFound 404) (Error 500)])
(const-enum Color [(Red "red") (Green "green") (Blue "blue")])
```

### Declare Statements

```lisp
(declare function "greet(name: string): string")
(declare var "globalCounter: number")
(declare const "PI: 3.14159")
(declare module "my-module")
```

## Implementation

- Type tokenizer: `src/hql/transpiler/tokenizer/type-tokenizer.ts`
- Native type expression transforms: `src/hql/transpiler/pipeline/hql-ast-to-hql-ir.ts`
- IR type nodes: `src/hql/transpiler/type/hql_ir.ts`
- TypeScript code generation: `src/hql/transpiler/pipeline/ir-to-typescript.ts`

## Test Files

- `tests/unit/native-type-expressions.test.ts` -- 36 tests for native S-expression type operators
- `tests/unit/type-declarations.test.ts` -- type alias and interface declarations
- `tests/unit/typescript-advanced.test.ts` -- abstract classes, function overloads, namespaces, const enums, declare statements
- `tests/unit/type-annotations.test.ts` -- parameter and return type annotation parsing and execution
- `tests/unit/type-tokenizer.test.ts` -- type tokenizer unit tests (bracket depth, normalization, extraction)
- `tests/unit/type-checking.test.ts` -- type checking behavior tests

See also: [TYPE-SYSTEM.md](../../TYPE-SYSTEM.md) for additional examples.
