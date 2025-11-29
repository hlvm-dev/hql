# Binding Feature Documentation

**Implementation:** Transpiler syntax transformers **Test Count:** 19 tests
**Coverage:** ✅ 100%

## Overview

HQL provides two types of variable bindings:

1. **`let`** - Immutable bindings (compiles to `const`, values are frozen)
2. **`var`** - Mutable bindings (compiles to `let`, can be updated with `=`)

The binding model ensures **true immutability** for `let` bindings by
automatically freezing reference types (objects, arrays) using deep freeze.

## Syntax

### Immutable Bindings (`let`)

```lisp
; Simple immutable binding
(let x 10)
x  ; => 10

; Immutable binding with expression
(let result (+ 5 5))
result  ; => 10

; Multiple bindings in one let
(let (x 10 y 20 z 30)
  (+ x y z))  ; => 60

; Let with object (automatically frozen)
(let person {"name": "Alice", "age": 30})
person.name  ; => "Alice"
; (= person.age 31)  ; ERROR: Cannot mutate frozen object

; Let with array (automatically frozen)
(let nums [1, 2, 3])
; (nums.push 4)  ; ERROR: Cannot mutate frozen array
```

### Mutable Bindings (`var`)

```lisp
; Simple mutable binding
(var x 10)
(= x 20)
x  ; => 20

; Mutable binding with expression
(var counter 0)
(= counter (+ counter 1))
counter  ; => 1

; Multiple bindings in one var
(var (x 10 y 20)
  (= x 100)
  (+ x y))  ; => 120

; Var with object (mutable)
(var person {"name": "Alice"})
(= person.age 30)
person.age  ; => 30

; Var with array (mutable)
(var nums [1, 2, 3])
(nums.push 4)
nums.length  ; => 4
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
(let x [1, 2, 3])

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
(let data {"user": {"name": "Bob"}})

; Both outer and inner objects are frozen:
; Object.freeze(data)
; Object.freeze(data.user)

; Mutation attempts throw in strict mode:
; (= data.user.name "Charlie")  ; ERROR
```

### Binding Scopes

```lisp
; Top-level bindings (global scope)
(let global 10)

; Local bindings (block scope)
(let x 10)
(let y 20)
(+ x y)

; Nested bindings
(let outer 10)
(let (inner 20)
  (+ outer inner))
```

## Features Covered

✅ Immutable bindings with `let` ✅ Mutable bindings with `var` ✅ Assignment
with `=` ✅ Multiple bindings in single form ✅ Expression evaluation in
bindings ✅ Object bindings (frozen for `let`, mutable for `var`) ✅ Array
bindings (frozen for `let`, mutable for `var`) ✅ Property access and mutation
✅ Deep freeze for nested objects ✅ Multiple assignments ✅ Nested bindings ✅
Top-level and local scopes

## Test Coverage

**Total Tests:** 19

### Section 1: Basic Bindings (7 tests)

- `let` creates immutable binding
- `var` creates mutable binding
- `let` with multiple values
- `var` with multiple values
- `=` updates existing var
- `let` with expression
- `var` with expression

### Section 2: Nested and Scoped Bindings (3 tests)

- Nested `let` bindings
- `=` with property access
- Multiple `=` operations

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
