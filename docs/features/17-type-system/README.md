# Type System Feature

**Implementation:** Transpiler type expression transformers
**Coverage:** 100%

## Overview

HQL v2.0 provides a complete TypeScript type system with two approaches:

1. **Native HQL Syntax** - S-expression syntax for common types (~85% of usage)
2. **String Passthrough** - Raw TypeScript for complex/edge cases (100% coverage)

## Quick Example

```lisp
; Type alias with union
(type Status (| "pending" "active" "done"))

; Typed function
(fn add [a:number b:number] :number
  (+ a b))

; String passthrough for complex types
(deftype EventName "`on${string}`")
```

## Full Documentation

See **[TYPE-SYSTEM.md](../../TYPE-SYSTEM.md)** for the complete authoritative reference covering:

- All native type operators (`|`, `&`, `keyof`, `indexed`, `if-extends`, etc.)
- Type alias declarations
- Utility types (Partial, Pick, Omit, Record, etc.)
- String passthrough for 100% TypeScript coverage
- Advanced declarations (interfaces, abstract classes, namespaces)
- Parameter type annotations
- Precedence rules

## Test Coverage

All 36 native type expressions are tested in:
- `tests/unit/native-type-expressions.test.ts`
- `tests/unit/type-declarations.test.ts`
- `tests/unit/typescript-advanced.test.ts`
- `tests/unit/type-annotations.test.ts`
