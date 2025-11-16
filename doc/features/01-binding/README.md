# Binding Feature Documentation

**Implementation:** Transpiler syntax transformers **Test Count:** 19 tests
**Coverage:** ✅ 100%

## Overview

HQL provides three kinds of bindings to match JavaScript semantics:

1. **`const`** - Immutable bindings (compiles to `const`, values are deep frozen)
2. **`let`** - Mutable block-scoped bindings (compiles to JavaScript `let`)
3. **`var`** - Mutable function-scoped bindings (compiles to JavaScript `var`)

Assignment is handled with the `=` operator for all mutable bindings.

The binding model ensures **true immutability** for `let` bindings by
automatically freezing reference types (objects, arrays) using deep freeze.

## Syntax

### Immutable Bindings (`const`)

```lisp
; Simple immutable binding
(const x 10)
x  ; => 10

; Immutable binding with expression
(const result (+ 5 5))
result  ; => 10

; Multiple bindings in one const
(const (x 10 y 20 z 30)
  (+ x y z))  ; => 60

; Const with object (automatically frozen)
(const person {"name": "Alice", "age": 30})
person.name  ; => "Alice"
; (= person.age 31)  ; ERROR: Cannot mutate frozen object

; Const with array (automatically frozen)
(const nums [1, 2, 3])
; (nums.push 4)  ; ERROR: Cannot mutate frozen array
```

### Block-Scoped Mutable Bindings (`let`)

```lisp
; Simple mutable binding
(let x 10)
(= x 20)
x  ; => 20

; Mutable binding with expression
(let counter 0)
(= counter (+ counter 1))
counter  ; => 1

; Multiple bindings in one var
(let (x 10 y 20)
  (= x 100)
  (+ x y))  ; => 120

; Let with object (mutable)
(let person {"name": "Alice"})
(= person.age 30)
person.age  ; => 30

; Let with array (mutable)
(let nums [1, 2, 3])
(nums.push 4)
nums.length  ; => 4
```

### Function-Scoped Mutable Bindings (`var`)

Use `var` when you need hoisted, function-scoped bindings (e.g., to mirror legacy JavaScript patterns or when targeting runtime helpers that rely on hoisting).

```lisp
; Function-scoped mutable binding
(var total 0)

(fn add (value)
  (= total (+ total value)))

(add 2)
(add 3)
total  ; => 5
```

### Assignment (`=`)

```lisp
; Update existing var binding
(var x 10)
(= x 20)
x  ; => 20

; Update object property
(var obj {"count": 0})
(= obj.count 42)
obj.count  ; => 42

; Multiple assignments
(var x 1)
(var y 2)
(= x 10)
(= y 20)
(+ x y)  ; => 30

; Assignment with expression
(var counter 0)
(= counter (+ counter 1))
(= counter (+ counter 1))
counter  ; => 2
```

## Implementation Details

### Compilation Targets

#### `let` → `const` + Freeze

```lisp
(const x [1, 2, 3])

; Compiles to:
const x = Object.freeze([1, 2, 3]);
```

#### `var` → `let`

```lisp
(var x [1, 2, 3])

; Compiles to:
let x = [1, 2, 3];
```

#### `=` → Assignment

```lisp
(= x 20)

; Compiles to:
x = 20;
```

### Deep Freeze Implementation

HQL implements **deep freeze** for `let` bindings:

```lisp
(const data {"user": {"name": "Bob"}})

; Both outer and inner objects are frozen:
; Object.freeze(data)
; Object.freeze(data.user)

; Mutation attempts throw in strict mode:
; (= data.user.name "Charlie")  ; ERROR
```

### Binding Scopes

```lisp
; Top-level bindings (global scope)
(const global 10)

; Local bindings (block scope)
(const x 10)
(const y 20)
(+ x y)

; Nested bindings
(const outer 10)
(const (inner 20)
  (+ outer inner))
```

## Features Covered

✅ Immutable bindings with `const` ✅ Mutable bindings with `let` and `var` ✅ Assignment
with `=` ✅ Multiple bindings in single form ✅ Expression evaluation in
bindings ✅ Object bindings (frozen for `const`, mutable for `let`/`var`) ✅ Array
bindings (frozen for `const`, mutable for `let`/`var`) ✅ Property access and mutation
✅ Deep freeze for nested objects ✅ Multiple assignments ✅ Nested bindings ✅
Top-level and local scopes

## Test Coverage

**Total Tests:** 19

### Section 1: Basic Bindings (7 tests)

- `const` creates immutable binding
- `let` creates mutable binding
- `const` with multiple values
- `let` with multiple values
- `=` updates existing binding
- `const` with expression
- `let` with expression

### Section 2: Nested and Scoped Bindings (3 tests)

- Nested bindings
- Assignment with property access
- Multiple assignment operations

### Section 3: Reference Type Bindings (4 tests)

- `let` with object
- `var` with array
- `let` with array (frozen)
- `let` with object (frozen)

### Section 4: Immutability Tests (3 tests)

- `let` array is frozen (mutation throws)
- `let` object is frozen (mutation throws)
- `let` freezes nested objects (deep freeze)

### Section 5: Mutability Tests (2 tests)

- `var` array is mutable
- `var` object is mutable

### Section 6: Edge Cases (2 tests)

- Top-level let with brace literal
- Top-level let with parenthesis literal

## Related Specs

- Complete binding model specification available in project specs
- Transpiler implementation in syntax transformers

## Examples

See `examples.hql` for executable examples.

## Transform Pipeline

```
HQL Source
  ↓
S-expression Parser
  ↓
transformLetBinding / transformVarBinding
  ↓
IR: LetDeclaration / VarDeclaration
  ↓
Transpiler (adds freeze for let)
  ↓
ESTree AST (const + freeze / let)
  ↓
JavaScript
```

## Binding Model Guarantees

### For `let` bindings:

1. ✅ **Compile-time:** Compiles to JavaScript `const`
2. ✅ **Runtime:** Reference types are deep-frozen with `Object.freeze()`
3. ✅ **Strict mode:** Mutation attempts throw errors
4. ✅ **Nested objects:** Deep freeze applied recursively

### For `var` bindings:

1. ✅ **Compile-time:** Compiles to JavaScript `let`
2. ✅ **Runtime:** No freezing, full mutability
3. ✅ **Updates:** Can be changed with `=`
4. ✅ **Property access:** Allows property mutation

## Edge Cases Tested

✅ Empty bindings ✅ Expression evaluation ✅ Multiple bindings ✅ Nested scopes
✅ Property mutation attempts ✅ Array mutation attempts ✅ Deep freeze
verification ✅ Top-level declarations with special literals

## Future Enhancements

- Destructuring for bindings
- Pattern matching in let/var
- Type annotations for bindings
- Shadowing rules documentation
- Performance optimizations for large frozen objects
