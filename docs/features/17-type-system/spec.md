# Type System Specification

HQL implements a complete TypeScript type system with two approaches:
1. **Native HQL Syntax** -- S-expression syntax for common type operators (~85% of usage)
2. **String Passthrough** -- Raw TypeScript strings for any type expression (100% coverage guarantee)

Types are optional and warning-based: type errors produce warnings but code always compiles and runs.

---

## Type Annotations

**Critical Rule: NO SPACE after the colon.** HQL's S-expression parser uses whitespace as a token delimiter, so `a:number` is one token but `a: number` is two separate tokens and breaks parsing.

```
CORRECT:   [a:number b:string]
WRONG:     [a: number b: string]    -- space breaks parsing!
```

### Variable Annotations

```lisp
(let x:number 10)
(const name:string "hello")
(var count:number 0)
```

### Parameter Annotations

```lisp
(fn add [a:number b:number]
  (+ a b))

;; Mixed typed and untyped
(fn greet [name:string times]
  (print name times))
```

### Return Type Annotations

Two forms are supported:

```lisp
;; Colon form (after parameter list)
(fn add [a b] :number
  (+ a b))

;; Arrow form
(fn add [a b] -> number
  (+ a b))

;; On the function name
(fn add:number [a b]
  (+ a b))
```

### Inline Type Syntax

The type tokenizer supports these inline forms without needing S-expression operators:

| Inline Syntax | Meaning |
|---------------|---------|
| `x:number` | Simple type |
| `arr:Array<number>` | Generic type |
| `x:number\|string` | Union type |
| `x:?number` | Nullable (`number \| null \| undefined`) |
| `x:string[]` | Array shorthand |
| `x:{name:string, age:number}` | Object type |
| `x:[string, number]` | Tuple type |
| `x:(a: number) => string` | Function type |

---

## Type Aliases

### `type` (primary)

```lisp
(type Name TypeExpr)
```

Compiles to `type Name = TypeExpr;`.

```lisp
(type MyString string)
(type ID number)
(type Container<T> T)
```

### `deftype` (backward compatible)

```lisp
(deftype MyNumber number)
```

Also supports string passthrough:

```lisp
(deftype Complex "Record<string, number>")
(deftype EventName "`on${string}`")
(deftype "KeyValue<K extends string, V>" "{ key: K; value: V }")
```

---

## Type Operators (Native HQL Syntax)

| HQL | TypeScript | Description |
|-----|-----------|-------------|
| `(\| A B C)` | `A \| B \| C` | Union |
| `(& A B)` | `A & B` | Intersection |
| `(keyof T)` | `keyof T` | Keyof |
| `(indexed T K)` | `T[K]` | Indexed access |
| `(if-extends T U X Y)` | `T extends U ? X : Y` | Conditional |
| `(mapped K Keys V)` | `{ [K in Keys]: V }` | Mapped |
| `(tuple A B)` | `[A, B]` | Tuple |
| `(array T)` | `T[]` | Array |
| `(readonly T)` | `readonly T` | Readonly |
| `(typeof x)` | `typeof x` | Typeof |
| `(infer T)` | `infer T` | Infer |
| `(rest T)` | `...T` | Rest (in tuples) |

### Union Types

```lisp
(type StringOrNumber (| string number))
;; => type StringOrNumber = string | number;

(type Status (| "pending" "active" "done"))
;; => type Status = "pending" | "active" | "done";
```

### Intersection Types

```lisp
(type AdminUser (& User AdminPermissions))
;; => type AdminUser = User & AdminPermissions;
```

### Conditional Types

```lisp
(type IsString<T> (if-extends T string true false))
;; => type IsString<T> = T extends string ? true : false;

(type UnwrapPromise<T> (if-extends T (Promise (infer U)) U T))
;; => type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
```

### Mapped Types

```lisp
(type MyReadonly<T> (mapped K (keyof T) (indexed T K)))
;; => type MyReadonly<T> = { [K in keyof T]: T[K] };
```

### Tuple Types

```lisp
(type Point (tuple number number))
;; => type Point = [number, number];

;; With rest elements
(type Args (tuple string (rest (array number))))
;; => type Args = [string, ...number[]];
```

### Utility Types

Any capitalized name is treated as a generic type application:

```lisp
(type PartialPerson (Partial Person))       ;; => Partial<Person>
(type RequiredConfig (Required Config))     ;; => Required<Config>
(type PickedPerson (Pick Person (| "name" "age")))  ;; => Pick<Person, "name" | "age">
(type StringRecord (Record string number))  ;; => Record<string, number>
```

---

## Generics

Generic type parameters use angle bracket syntax on the function or type name:

```lisp
(fn identity<T> [x:T] :T
  x)
;; => function identity<T>(x: T): T { return x; }

(fn pair<T,U> [a:T b:U]
  [a b])

(type Container<T> T)
;; => type Container<T> = T;
```

---

## Swift Collection Shorthand

HQL supports Swift-inspired shorthand for common collection types:

| HQL Shorthand | TypeScript Output | Description |
|---------------|-------------------|-------------|
| `[Int]` | `Int[]` | Array type |
| `[String: Int]` | `Record<string, number>` | Dictionary/map type |
| `(Int, String)` | `[Int, String]` | Tuple type |

```lisp
(fn sum [numbers:[number]]
  (reduce + 0 numbers))

(let scores:[string: number] {})
```

---

## Interfaces

```lisp
(interface User "{ id: string; name: string }")
;; => interface User { id: string; name: string }

;; With generics
(interface Box<T> "{ value: T; getValue(): T }")

;; With extends
(interface Employee extends Person "{ salary: number }")
(interface Manager extends Person Serializable "{ department: string }")
```

---

## Enums and Const Enums

```lisp
;; Regular enum
(enum Color Red Green Blue)
;; => enum Color { Red, Green, Blue }

;; Const enum (inlined at compile time)
(const-enum Direction [North South East West])
;; => const enum Direction { North, South, East, West }

;; With explicit values
(const-enum Status [(OK 200) (NotFound 404) (Error 500)])
;; => const enum Status { OK = 200, NotFound = 404, Error = 500 }

;; With string values
(const-enum Color [(Red "red") (Green "green") (Blue "blue")])
;; => const enum Color { Red = "red", Green = "green", Blue = "blue" }
```

---

## Namespaces

```lisp
(namespace Utils [
  (deftype ID "string")
])
;; => namespace Utils { type ID = string; }

(namespace Models [
  (interface User "{ id: string; name: string }")
])
```

---

## Function Overloads

```lisp
(fn-overload process "x: string" :string)
(fn-overload process "x: number" :number)
;; => function process(x: string): string;
;;    function process(x: number): number;

(fn-overload "identity<T>" "x: T" :T)
;; => function identity<T>(x: T): T;
```

---

## Declare Statements

Ambient declarations for external code:

```lisp
(declare function "greet(name: string): string")
(declare var "globalCounter: number")
(declare const "PI: 3.14159")
(declare module "my-module")
```

---

## String Passthrough (100% TypeScript Coverage)

For any TypeScript type expression not directly supported by native syntax, use string passthrough with `deftype` or `interface`. This guarantees that every valid TypeScript type can be expressed in HQL.

```lisp
;; Template literal types
(deftype EventName "`on${string}`")

;; Complex constraints
(deftype "KeyValue<K extends string, V>" "{ key: K; value: V }")

;; Mapped type modifiers
(deftype "Mutable<T>" "{ -readonly [K in keyof T]: T[K] }")
```

---

## Precedence Handling

The compiler automatically adds parentheses where needed:

```lisp
;; Intersection inside union
(type T (| (& A B) C))
;; => (A & B) | C

;; Union inside array
(type T (array (| A B)))
;; => (A | B)[]

;; Intersection inside array
(type T (array (& A B)))
;; => (A & B)[]

;; Complex nested types
(type ComplexType (| (& A B) (tuple number string) (array (| C D))))
;; => (A & B) | [number, string] | (C | D)[]
```

---

## Implementation

| Component | Source File |
|-----------|------------|
| Type tokenizer | `src/hql/transpiler/tokenizer/type-tokenizer.ts` |
| Native type transforms | `src/hql/transpiler/pipeline/hql-ast-to-hql-ir.ts` |
| IR type nodes | `src/hql/transpiler/type/hql_ir.ts` |
| TypeScript codegen | `src/hql/transpiler/pipeline/ir-to-typescript.ts` |

## Test Files

| Test | Coverage |
|------|----------|
| `native-type-expressions.test.ts` | 36 tests for native S-expression type operators |
| `type-declarations.test.ts` | Type alias and interface declarations |
| `typescript-advanced.test.ts` | Abstract classes, overloads, namespaces, const enums, declare |
| `type-annotations.test.ts` | Parameter and return type annotation parsing |
| `type-tokenizer.test.ts` | Bracket depth, normalization, extraction |
| `type-checking.test.ts` | Type checking behavior |

See also: [TYPE-SYSTEM.md](../../TYPE-SYSTEM.md) for additional examples.
