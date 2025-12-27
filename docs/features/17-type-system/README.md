# Type System Feature Documentation

**Implementation:** Transpiler type expression transformers
**Coverage:** ✅ 100%

## Overview

HQL v2.0 provides a **complete TypeScript type system** with two approaches:

1. **Native HQL Syntax** - S-expression syntax for common types (~85% of usage)
2. **String Passthrough** - Raw TypeScript for complex/edge cases (100% coverage)

> See [TYPE-SYSTEM.md](../../TYPE-SYSTEM.md) for the complete authoritative reference.

## Quick Reference

### Type Alias Declaration

```lisp
(type Name TypeExpression)

; Examples
(type ID number)
(type Status (| "pending" "active" "done"))
(type Point (tuple number number))
```

### Union Types

```lisp
(| Type1 Type2 ...)

; Examples
(type StringOrNumber (| string number))
(type Status (| "pending" "active" "done"))
(type Nullable (| string null undefined))
```

### Intersection Types

```lisp
(& Type1 Type2 ...)

; Examples
(type Combined (& A B))
(type AdminUser (& User AdminPermissions))
```

### Keyof Operator

```lisp
(keyof Type)

; Examples
(type PersonKeys (keyof Person))
(type Keys<T> (keyof T))
```

### Indexed Access Types

```lisp
(indexed Type Key)

; Examples
(type NameType (indexed Person "name"))
(type Value<T> (indexed T (keyof T)))
```

### Conditional Types

```lisp
(if-extends T U TrueType FalseType)

; Examples
(type IsString<T> (if-extends T string true false))
(type UnwrapPromise<T> (if-extends T (Promise (infer U)) U T))
```

### Mapped Types

```lisp
(mapped K Keys ValueType)

; Examples
(type MyReadonly<T> (mapped K (keyof T) (indexed T K)))
```

### Tuple Types

```lisp
(tuple Type1 Type2 ...)

; Examples
(type Point (tuple number number))
(type Entry (tuple string number boolean))
(type Args (tuple string (rest (array number))))
```

### Array Types

```lisp
(array ElementType)

; Examples
(type Numbers (array number))
(type MixedArray (array (| string number)))
```

### Utility Types

```lisp
(UtilityName TypeArg ...)

; Examples
(type PartialPerson (Partial Person))
(type RequiredConfig (Required Config))
(type PickedPerson (Pick Person (| "name" "age")))
(type StringRecord (Record string number))
```

## String Passthrough (100% Coverage)

For complex types or edge cases, use string passthrough:

```lisp
; Basic passthrough
(deftype Complex "Record<string, number>")

; Template literal types
(deftype EventName "`on${string}`")

; Complex constraints
(deftype "KeyValue<K extends string, V>" "{ key: K; value: V }")

; Mapped type modifiers
(deftype "Mutable<T>" "{ -readonly [K in keyof T]: T[K] }")
```

## Advanced Declarations

### Interfaces

```lisp
(interface User "{ id: string; name: string }")
(interface Config "{ debug?: boolean; port?: number }")
```

### Abstract Classes

```lisp
(abstract-class Animal [
  (abstract-method speak [] :string)
])
```

### Function Overloads

```lisp
(fn-overload process "x: string" :string)
(fn-overload process "x: number" :number)
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
```

### Declare Statements

```lisp
(declare function "greet(name: string): string")
(declare var "globalCounter: number")
```

## Parameter Type Annotations

### Critical Rule: NO SPACE After Colon

```
⚠️  TYPE ANNOTATION SPACING RULE

✓ CORRECT:   [a:number b:string]      (NO space after colon)
✗ WRONG:     [a: number b: string]    (space breaks parsing!)
```

### Function Parameters

```lisp
(fn add [a:number b:number] :number
  (+ a b))

(fn process [items:Array<number> callback:Function]
  (map callback items))

; Union types in parameters
(fn handle [value:string|number] :void
  (print value))
```

### Return Types

```lisp
(fn get-count [] :number
  42)

(async fn fetch-data [url:string] :Promise<Response>
  (await (js/fetch url)))
```

## Complete Operator Reference

| HQL Syntax | TypeScript Output |
|------------|-------------------|
| `(type Name T)` | `type Name = T;` |
| `(\| A B C)` | `A \| B \| C` |
| `(& A B)` | `A & B` |
| `(keyof T)` | `keyof T` |
| `(indexed T K)` | `T[K]` |
| `(if-extends T U X Y)` | `T extends U ? X : Y` |
| `(mapped K Keys V)` | `{ [K in Keys]: V }` |
| `(tuple A B)` | `[A, B]` |
| `(array T)` | `T[]` |
| `(readonly T)` | `readonly T` |
| `(typeof x)` | `typeof x` |
| `(infer T)` | `infer T` |
| `(rest T)` | `...T` |
| `(Partial T)` | `Partial<T>` |
| `(Record K V)` | `Record<K, V>` |
| `(Pick T K)` | `Pick<T, K>` |
| `(Omit T K)` | `Omit<T, K>` |
| `(Required T)` | `Required<T>` |
| `(NonNullable T)` | `NonNullable<T>` |

## Features Covered

✅ Type aliases with `type`
✅ Union types with `|`
✅ Intersection types with `&`
✅ Keyof operator
✅ Indexed access types
✅ Conditional types with `if-extends`
✅ Mapped types
✅ Tuple types
✅ Array types
✅ Readonly modifier
✅ Typeof operator
✅ Infer keyword
✅ Rest types
✅ All TypeScript utility types
✅ String passthrough for 100% coverage
✅ Interfaces
✅ Abstract classes
✅ Function overloads
✅ Namespaces
✅ Const enums
✅ Declare statements
✅ Parameter type annotations
✅ Return type annotations
✅ Gradual typing (mix typed and untyped)

## Test Coverage

All 36 native type expressions are tested in:
- `tests/unit/native-type-expressions.test.ts`
- `tests/unit/type-declarations.test.ts`
- `tests/unit/typescript-advanced.test.ts`
- `tests/unit/type-annotations.test.ts`

## Related Documentation

- [TYPE-SYSTEM.md](../../TYPE-SYSTEM.md) - Complete authoritative reference
- [HQL-SYNTAX.md](../../HQL-SYNTAX.md) - Type syntax in context
- [REFERENCE.md](../../REFERENCE.md) - Quick reference card
