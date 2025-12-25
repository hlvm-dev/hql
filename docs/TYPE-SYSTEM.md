# HQL Type System

**Version:** 2.0 | **Status:** Complete | **Coverage:** 100%

HQL implements a **complete TypeScript type system** with two approaches:
1. **Native HQL Syntax** - S-expression syntax for common types (~85% of usage)
2. **String Passthrough** - Raw TypeScript for complex/edge cases (100% coverage guarantee)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Native Type Syntax](#2-native-type-syntax)
3. [Type Alias Declaration](#3-type-alias-declaration)
4. [Union Types](#4-union-types)
5. [Intersection Types](#5-intersection-types)
6. [Keyof Operator](#6-keyof-operator)
7. [Indexed Access Types](#7-indexed-access-types)
8. [Conditional Types](#8-conditional-types)
9. [Mapped Types](#9-mapped-types)
10. [Tuple Types](#10-tuple-types)
11. [Array Types](#11-array-types)
12. [Readonly Modifier](#12-readonly-modifier)
13. [Typeof Operator](#13-typeof-operator)
14. [Infer Keyword](#14-infer-keyword)
15. [Utility Types](#15-utility-types)
16. [String Passthrough](#16-string-passthrough)
17. [Advanced Declarations](#17-advanced-declarations)
18. [Parameter Type Annotations](#18-parameter-type-annotations)
19. [Complete Reference](#19-complete-reference)

---

## 1. Overview

### Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    HQL TYPE SYSTEM - 100% COVERAGE                            │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│   ┌───────────────────────────────────┐  ┌────────────────────────────────┐  │
│   │       NATIVE HQL SYNTAX           │  │     STRING PASSTHROUGH         │  │
│   │          (~85% usage)             │  │    (100% coverage guarantee)   │  │
│   │                                   │  │                                │  │
│   │  (| A B C)      → A | B | C       │  │  (deftype X "any valid TS")   │  │
│   │  (& A B)        → A & B           │  │  (interface Y "{ ... }")      │  │
│   │  (keyof T)      → keyof T         │  │                                │  │
│   │  (indexed T K)  → T[K]            │  │  Handles:                      │  │
│   │  (if-extends..) → T extends U?X:Y │  │  - Template literal types      │  │
│   │  (mapped K..)   → { [K in..]: V } │  │  - Complex constraints         │  │
│   │  (tuple A B)    → [A, B]          │  │  - Future TS features          │  │
│   │  (array T)      → T[]             │  │                                │  │
│   │  (Partial T)    → Partial<T>      │  │                                │  │
│   └───────────────────────────────────┘  └────────────────────────────────┘  │
│                           │                          │                        │
│                           └────────────┬─────────────┘                        │
│                                        │                                      │
│                                        ▼                                      │
│                         ┌─────────────────────────────┐                      │
│                         │     100% TypeScript         │                      │
│                         │     Type Coverage           │                      │
│                         └─────────────────────────────┘                      │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Key Properties

| Property | Description |
|----------|-------------|
| **100% Coverage** | Any valid TypeScript type can be expressed |
| **Native Syntax** | S-expression syntax for common patterns |
| **Passthrough** | Raw strings for complex/edge cases |
| **Optional** | Types are never required |
| **Warning-based** | Type errors are warnings, code always runs |

---

## 2. Native Type Syntax

HQL provides native S-expression syntax for TypeScript types. These compile directly to TypeScript without needing string literals.

### Quick Reference

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

---

## 3. Type Alias Declaration

### Basic Syntax

```clojure
(type Name TypeExpression)
```

### Examples

```clojure
; Simple type alias
(type MyString string)
(type ID number)

; Output:
; type MyString = string;
; type ID = number;
```

### With Generics

```clojure
(type Container<T> T)
(type Box<T> {value: T})
(type Result<T E> (| {ok: T} {err: E}))

; Output:
; type Container<T> = T;
; type Box<T> = {value: T};
; type Result<T, E> = {ok: T} | {err: E};
```

### Backward Compatibility

```clojure
; deftype still works
(deftype MyNumber number)
; → type MyNumber = number;
```

---

## 4. Union Types

### Syntax: `(| Type1 Type2 ...)`

```clojure
(type StringOrNumber (| string number))
; → type StringOrNumber = string | number;

(type Status (| "pending" "active" "done"))
; → type Status = "pending" | "active" | "done";

(type Nullable (| string null undefined))
; → type Nullable = string | null | undefined;
```

### String Literal Types

```clojure
(type Direction (| "north" "south" "east" "west"))
; → type Direction = "north" | "south" | "east" | "west";
```

---

## 5. Intersection Types

### Syntax: `(& Type1 Type2 ...)`

```clojure
(type Combined (& A B))
; → type Combined = A & B;

(type AllTraits (& Runnable Printable Serializable))
; → type AllTraits = Runnable & Printable & Serializable;

(type AdminUser (& User AdminPermissions))
; → type AdminUser = User & AdminPermissions;
```

---

## 6. Keyof Operator

### Syntax: `(keyof Type)`

```clojure
(type PersonKeys (keyof Person))
; → type PersonKeys = keyof Person;

(type Keys<T> (keyof T))
; → type Keys<T> = keyof T;
```

---

## 7. Indexed Access Types

### Syntax: `(indexed Type Key)`

```clojure
(type NameType (indexed Person "name"))
; → type NameType = Person["name"];

(type Value<T> (indexed T (keyof T)))
; → type Value<T> = T[keyof T];

(type First<T> (indexed T 0))
; → type First<T> = T[0];
```

---

## 8. Conditional Types

### Syntax: `(if-extends T U TrueType FalseType)`

```clojure
(type IsString<T> (if-extends T string true false))
; → type IsString<T> = T extends string ? true : false;

(type UnwrapPromise<T> (if-extends T (Promise (infer U)) U T))
; → type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
```

### Nested Conditionals

```clojure
(type TypeName<T>
  (if-extends T string "string"
    (if-extends T number "number"
      (if-extends T boolean "boolean" "other"))))
; → type TypeName<T> = T extends string ? "string" :
;                       T extends number ? "number" :
;                       T extends boolean ? "boolean" : "other";
```

---

## 9. Mapped Types

### Syntax: `(mapped K Keys ValueType)`

```clojure
(type MyReadonly<T> (mapped K (keyof T) (indexed T K)))
; → type MyReadonly<T> = { [K in keyof T]: T[K] };
```

### With Readonly Modifier

```clojure
(type Immutable<T> (mapped K (keyof T) (readonly (indexed T K))))
; → type Immutable<T> = { readonly [K in keyof T]: T[K] };
```

---

## 10. Tuple Types

### Syntax: `(tuple Type1 Type2 ...)`

```clojure
(type Point (tuple number number))
; → type Point = [number, number];

(type Entry (tuple string number boolean))
; → type Entry = [string, number, boolean];

(type Point3D (tuple number number number))
; → type Point3D = [number, number, number];
```

### With Rest Elements

```clojure
(type Args (tuple string (rest (array number))))
; → type Args = [string, ...number[]];

(type Params (tuple number string (rest (array boolean))))
; → type Params = [number, string, ...boolean[]];
```

---

## 11. Array Types

### Syntax: `(array ElementType)`

```clojure
(type Numbers (array number))
; → type Numbers = number[];

(type Strings (array string))
; → type Strings = string[];
```

### Precedence Handling

```clojure
(type MixedArray (array (| string number)))
; → type MixedArray = (string | number)[];

(type CombinedArray (array (& A B)))
; → type CombinedArray = (A & B)[];
```

---

## 12. Readonly Modifier

### Syntax: `(readonly Type)`

```clojure
(type ImmutableNumbers (readonly (array number)))
; → type ImmutableNumbers = readonly number[];

(type FrozenPoint (readonly (tuple number number)))
; → type FrozenPoint = readonly [number, number];
```

---

## 13. Typeof Operator

### Syntax: `(typeof expression)`

```clojure
(type MyType (typeof myVar))
; → type MyType = typeof myVar;

(type ConfigType (typeof defaultConfig))
; → type ConfigType = typeof defaultConfig;
```

---

## 14. Infer Keyword

### Syntax: `(infer TypeVar)`

Used inside conditional types to infer types.

```clojure
(type ArrayElement<T> (if-extends T (array (infer E)) E never))
; → type ArrayElement<T> = T extends (infer E)[] ? E : never;

(type ReturnType<T> (if-extends T (fn [] (infer R)) R never))
; → type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;

(type UnwrapPromise<T> (if-extends T (Promise (infer U)) U T))
; → type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
```

---

## 15. Utility Types

### Syntax: `(UtilityName TypeArg ...)`

Built-in TypeScript utility types work natively:

```clojure
(type PartialPerson (Partial Person))
; → type PartialPerson = Partial<Person>;

(type RequiredConfig (Required Config))
; → type RequiredConfig = Required<Config>;

(type PickedPerson (Pick Person (| "name" "age")))
; → type PickedPerson = Pick<Person, "name" | "age">;

(type OmittedPerson (Omit Person "password"))
; → type OmittedPerson = Omit<Person, "password">;

(type StringRecord (Record string number))
; → type StringRecord = Record<string, number>;

(type NonNullableName (NonNullable (| string null)))
; → type NonNullableName = NonNullable<string | null>;
```

---

## 16. String Passthrough

For complex types or edge cases, use string passthrough with `deftype` or `interface`. This guarantees 100% TypeScript coverage.

### Basic Passthrough

```clojure
(deftype Complex "Record<string, number>")
; → type Complex = Record<string, number>;
```

### Template Literal Types

```clojure
(deftype EventName "`on${string}`")
; → type EventName = `on${string}`;

(deftype Getter "`get${Capitalize<string>}`")
; → type Getter = `get${Capitalize<string>}`;
```

### Complex Constraints

```clojure
(deftype "KeyValue<K extends string, V>" "{ key: K; value: V }")
; → type KeyValue<K extends string, V> = { key: K; value: V };
```

### Mapped Type Modifiers

```clojure
(deftype "Mutable<T>" "{ -readonly [K in keyof T]: T[K] }")
; → type Mutable<T> = { -readonly [K in keyof T]: T[K] };

(deftype "Required<T>" "{ [K in keyof T]-?: T[K] }")
; → type Required<T> = { [K in keyof T]-?: T[K] };
```

---

## 17. Advanced Declarations

### Interfaces

```clojure
(interface User "{ id: string; name: string }")
; → interface User { id: string; name: string }

(interface Point "{ readonly x: number; readonly y: number }")
; → interface Point { readonly x: number; readonly y: number }

(interface Config "{ debug?: boolean; port?: number }")
; → interface Config { debug?: boolean; port?: number }

(interface StringMap "{ [key: string]: string }")
; → interface StringMap { [key: string]: string }
```

### Abstract Classes

```clojure
(abstract-class Animal [
  (abstract-method speak [] :string)
])
; → abstract class Animal {
;     abstract speak(): string;
;   }

(abstract-class Container<T> [
  (abstract-method getValue [] :T)
  (abstract-method setValue "value: T" :void)
])
```

### Function Overloads

```clojure
(fn-overload process "x: string" :string)
(fn-overload process "x: number" :number)
; → function process(x: string): string;
;   function process(x: number): number;

(fn-overload "identity<T>" "x: T" :T)
; → function identity<T>(x: T): T;
```

### Namespaces

```clojure
(namespace Utils [
  (deftype ID "string")
])
; → namespace Utils {
;     type ID = string;
;   }

(namespace Models [
  (interface User "{ id: string; name: string }")
])
```

### Const Enums

```clojure
(const-enum Direction [North South East West])
; → const enum Direction { North, South, East, West }

(const-enum Status [(OK 200) (NotFound 404) (Error 500)])
; → const enum Status { OK = 200, NotFound = 404, Error = 500 }

(const-enum Color [(Red "red") (Green "green") (Blue "blue")])
; → const enum Color { Red = "red", Green = "green", Blue = "blue" }
```

### Declare Statements

```clojure
(declare function "greet(name: string): string")
; → declare function greet(name: string): string;

(declare var "globalCounter: number")
; → declare var globalCounter: number;

(declare const "PI: 3.14159")
; → declare const PI: 3.14159;

(declare module "my-module")
; → declare module my-module;
```

---

## 18. Parameter Type Annotations

### Critical Rule: NO SPACE After Colon

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ⚠️  TYPE ANNOTATION SPACING RULE                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ✓ CORRECT:   [a:number b:string]      (NO space after colon)               │
│  ✗ WRONG:     [a: number b: string]    (space breaks parsing!)              │
│                                                                              │
│  WHY: HQL's S-expression parser uses whitespace as token delimiter.         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Function Parameters

```clojure
(fn add [a:number b:number] :number
  (+ a b))
; → function add(a: number, b: number): number { return a + b; }

(fn process [items:Array<number> callback:Function]
  (map callback items))
```

### Union Types in Parameters

```clojure
(fn handle [value:string|number] :void
  (print value))
```

### Gradual Typing

```clojure
; Mix typed and untyped
(fn greet [name:string times]
  (print name times))
```

### Return Types

```clojure
(fn get-count [] :number
  42)

(async fn fetch-data [url:string] :Promise<Response>
  (await (js/fetch url)))
```

---

## 19. Complete Reference

### Native Type Operators

| HQL Syntax | TypeScript | Description |
|------------|------------|-------------|
| `(type N T)` | `type N = T` | Type alias |
| `(\| A B C)` | `A \| B \| C` | Union |
| `(& A B)` | `A & B` | Intersection |
| `(keyof T)` | `keyof T` | Keyof |
| `(indexed T K)` | `T[K]` | Indexed access |
| `(if-extends T U X Y)` | `T extends U ? X : Y` | Conditional |
| `(mapped K Keys V)` | `{ [K in Keys]: V }` | Mapped |
| `(tuple A B C)` | `[A, B, C]` | Tuple |
| `(array T)` | `T[]` | Array |
| `(readonly T)` | `readonly T` | Readonly |
| `(typeof x)` | `typeof x` | Typeof |
| `(infer T)` | `infer T` | Infer |
| `(rest T)` | `...T` | Rest |
| `(Partial T)` | `Partial<T>` | Utility |
| `(Record K V)` | `Record<K, V>` | Record |
| `(Pick T K)` | `Pick<T, K>` | Pick |

### Advanced Declarations

| HQL Syntax | TypeScript | Description |
|------------|------------|-------------|
| `(deftype N "T")` | `type N = T` | Passthrough |
| `(interface N "...")` | `interface N {...}` | Interface |
| `(abstract-class N [...])` | `abstract class N {...}` | Abstract class |
| `(fn-overload N params ret)` | `function N(...): ret;` | Overload |
| `(namespace N [...])` | `namespace N {...}` | Namespace |
| `(const-enum N [...])` | `const enum N {...}` | Const enum |
| `(declare kind "...")` | `declare kind ...;` | Ambient |

### Precedence Rules

```clojure
; Intersection inside union gets parentheses
(type T (| (& A B) C))        ; → (A & B) | C

; Union inside array gets parentheses
(type T (array (| A B)))      ; → (A | B)[]

; Intersection inside array gets parentheses
(type T (array (& A B)))      ; → (A & B)[]

; Complex nested types
(type ComplexType (| (& A B) (tuple number string) (array (| C D))))
; → (A & B) | [number, string] | (C | D)[]
```

---

## Summary

The HQL type system provides:

1. **100% TypeScript Coverage** - Any TypeScript type can be expressed
2. **Native Syntax** - Clean S-expression syntax for common patterns
3. **String Passthrough** - Raw TypeScript for complex/edge cases
4. **Gradual Typing** - Mix typed and untyped code freely
5. **Warning-based** - Type errors are warnings, code always runs

```clojure
; Native syntax for common cases
(type Keys (keyof Person))
(type Value (indexed Person "name"))
(type IsString<T> (if-extends T string true false))

; String passthrough for complex/rare cases
(deftype Complex "{ readonly [K in keyof T as `get${Capitalize<K>}`]: T[K] }")
```

---

*This document is the authoritative HQL type system reference. Version 2.0 - Updated December 2024.*
