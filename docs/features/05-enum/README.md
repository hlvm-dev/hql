# Enum Feature Documentation

**Implementation:** `src/hql/transpiler/syntax/enum.ts` (parsing), `src/hql/transpiler/pipeline/ir-to-typescript.ts` (codegen)

## Overview

Enumerations in HQL provide groups of named constants. HQL supports three types of enums:

1. **Simple enums** - Named string constants (compiled to frozen objects)
2. **Enums with raw values** - Explicit numeric or string values (compiled to frozen objects)
3. **Enums with associated values** - Class-based with instance data

There is also a TypeScript-specific `const-enum` form.

## Syntax

### Simple Enum

```lisp
(enum Direction
  (case north)
  (case south)
  (case east)
  (case west))

Direction.north  ;; => "north"
```

Compiles to:

```js
const Direction = Object.freeze({
  north: "north",
  south: "south",
  east: "east",
  west: "west"
});
```

### Enum with Raw Values

```lisp
(enum HttpStatus
  (case ok 200)
  (case notFound 404)
  (case serverError 500))

HttpStatus.notFound  ;; => 404
```

Raw values can be any literal (number or string). Access is direct property access on the frozen object.

### Raw Type Annotation

An optional raw type can be specified either embedded with a colon or as a separate token:

```lisp
;; Colon syntax
(enum HttpStatus:Int
  (case ok 200)
  (case notFound 404))

;; Separate token syntax
(enum HttpStatus Int
  (case ok 200)
  (case notFound 404))
```

The raw type is stored in the IR but does not affect JavaScript code generation.

### Enum with Associated Values

```lisp
(enum Payment
  (case cash amount)
  (case creditCard number expiry))

;; Create instance via static factory method
(var payment (Payment.cash 100))

;; Check type
(payment.is "cash")  ;; => true

;; Access associated values via the .values property
(get payment.values "amount")  ;; => 100
```

Compiles to a class with:
- `type` and `values` instance properties
- Constructor that calls `Object.freeze(this)`
- `is(type)` instance method (returns `this.type === type`)
- Static factory methods for each case (e.g., `Payment.cash(amount)`)

### Const Enum (TypeScript)

```lisp
(const-enum Direction [North South East West])

;; With explicit values
(const-enum Status [(OK 200) (NotFound 404) (Error 500)])

;; With string values
(const-enum Color [(Red "red") (Green "green") (Blue "blue")])
```

Compiles to TypeScript `const enum` declarations. This is a separate form from `(enum ...)`.

## Dot Notation Shorthand

The syntax transformer resolves `.caseName` shorthand to `EnumName.caseName` by searching known enum definitions for a matching case:

```lisp
(enum OS
  (case macOS)
  (case linux))

;; .macOS is resolved to OS.macOS if OS is the only enum with a macOS case
(=== os .macOS)
```

This resolution happens at the syntax transformer stage before IR generation.

## Test Coverage

### Simple Enums

- Define simple enum (frozen object)
- Access enum value (returns string)
- Compare enum values with `===`
- Use in `cond` expressions

### Enums with Raw Values

- Define enum with numeric raw values (frozen object)
- Access raw value (returns number)
- Compare raw values numerically (e.g., `>=`)

### Enums with Associated Values

- Define enum (compiles to class)
- Create instance via static factory method
- Check type with `.is()` method
- Access associated values via `(get payment.values "key")`

### Dot Notation / Type Inference

- Explicit `EnumName.caseName` in function parameters and equality checks

### Const Enums (TypeScript)

- Simple declaration without values
- Declaration with numeric values
- Declaration with string values
