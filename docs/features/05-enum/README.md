# Enum Feature Documentation

**Implementation:** Transpiler syntax transformers
**Coverage:** ✅ 100%

## Overview

Enumerations in HQL provide type-safe groups of named constants. HQL supports
three types of enums:

1. **Simple enums** - Named constants (object-based)
2. **Enums with raw values** - Numeric or string values
3. **Enums with associated values** - Class-based with data

## Syntax

### Simple Enum

```lisp
(enum Direction
  (case north)
  (case south)
  (case east)
  (case west))

; Access
Direction.north  ; => "north"
```

### Enum with Raw Values

```lisp
(enum HttpStatus
  (case ok 200)
  (case notFound 404)
  (case serverError 500))

; Access
HttpStatus.notFound  ; => 404
```

### Enum with Associated Values

```lisp
(enum Payment
  (case cash amount)
  (case creditCard number expiry))

; Create instance
(var payment (Payment.cash 100))

; Check type
(payment.is "cash")  ; => true

; Access values
(get payment.values "amount")  ; => 100
```

## Implementation Details

### Simple Enums

- Compiled to frozen JavaScript objects
- Each case becomes a string property
- Immutable via `Object.freeze()`

### Enums with Raw Values

- Same as simple enums but with explicit values
- Raw type declaration: `EnumName:Type`
- Values can be numbers or strings

### Enums with Associated Values

- Compiled to JavaScript classes
- Constructor is private
- Static factory methods for each case
- Instance methods: `.is(type)` and `.getValue(key)`

## Type Inference

HQL supports shorthand enum access with type inference:

```lisp
(fn install [os]
  (if (=== os .macOS)  ; .macOS inferred as OS.macOS
    "Installing on macOS"))

(install OS.macOS)  ; Explicit enum value
```

## Features Covered

✅ Simple enum definition ✅ Enum with raw values (Int, String) ✅ Enum with
associated values ✅ Dot notation access ✅ Enum comparison (`=`) ✅ Conditional
matching (`cond`) ✅ Type inference with `.caseName` ✅ Instance methods
(`.is()`, `.getValue()`) ✅ Immutability (frozen objects)

## Test Coverage



### Section 1: Simple Enums

- Define simple enum
- Access enum value
- Compare enum values
- Use in conditionals

### Section 2: Enums with Raw Values

- Define enum with Int raw type
- Access raw value
- Compare raw values numerically

### Section 3: Enums with Associated Values

- Define enum with associated values
- Create instance
- Check type with `.is()` method
- Access associated values

### Section 4: Type Inference

- Dot notation in function parameters
- Dot notation in equality checks

## Related Specs

- Complete enum specification available in project specs
- Language feature documentation

## Examples

See `examples.hql` for executable examples.

## Transform Pipeline

```
HQL Source
  ↓
S-expression Parser (reads enum syntax)
  ↓
transformEnumDeclaration (enum.ts:97)
  ↓
IR: EnumDeclaration node
  ↓
convertEnumDeclarationToJsObject (enum.ts:557)
  ↓
ESTree AST (Object.freeze or Class)
  ↓
JavaScript
```

## Edge Cases Tested

✅ Multiple enum cases ✅ Enum comparison with `=` ✅ Enum in `cond` expressions
✅ Raw value types (Int) ✅ Associated value creation ✅ Type checking with
`.is()` ✅ Value extraction from instances ✅ Type inference shortcuts

## Future Enhancements

- Pattern matching on enum cases
- Exhaustiveness checking
- More raw types (String, Double)
- Better LSP support for autocompletion
