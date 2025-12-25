# Binding Feature Documentation

**Implementation:** Transpiler syntax transformers
**Coverage:** ✅ 100%

## Overview

HQL v2.0 provides three types of variable bindings:

1. **`let`** - Block-scoped mutable bindings (compiles to JS `let`)
2. **`const`** - Immutable bindings (compiles to JS `const`, values are frozen)
3. **`var`** - Function-scoped mutable bindings (compiles to JS `var`)

> **Note:** In v2.0, `let` semantics changed from immutable to mutable to align with JavaScript conventions.

## Syntax

### Mutable Bindings (`let`)

```lisp
; Simple mutable binding
(let x 10)
x  ; => 10

; Reassignment allowed
(let x 10)
(= x 20)
x  ; => 20

; Multiple bindings in one let
(let (x 10 y 20 z 30)
  (+ x y z))  ; => 60

; Let with array (mutable)
(let nums [1, 2, 3])
(nums.push 4)  ; Allowed
nums.length  ; => 4
```

### Immutable Bindings (`const`)

```lisp
; Simple immutable binding
(const PI 3.14159)
PI  ; => 3.14159
; (= PI 3.0)  ; ERROR: Cannot reassign const

; Const with object (automatically frozen)
(const person {"name": "Alice", "age": 30})
person.name  ; => "Alice"
; (= person.age 31)  ; ERROR: Cannot mutate frozen object

; Const with array (automatically frozen)
(const nums [1, 2, 3])
; (nums.push 4)  ; ERROR: Cannot mutate frozen array
```

### Function-Scoped Bindings (`var`)

```lisp
; Simple function-scoped binding
(var x 10)
(= x 20)
x  ; => 20

; Var is hoisted to function scope
(fn example []
  (print x)  ; undefined (hoisted)
  (var x 10)
  (print x)) ; 10
```

### Assignment (`=`)

```lisp
; Update existing binding
(let x 10)
(= x 20)
x  ; => 20

; Update object property
(let obj {"count": 0})
(= obj.count 42)
obj.count  ; => 42

; Compound assignment
(let x 10)
(+= x 5)   ; x = x + 5
(-= x 3)   ; x = x - 3
(*= x 2)   ; x = x * 2
```

### Destructuring

```lisp
; Array destructuring
(let [a b c] [1 2 3])
a  ; => 1
b  ; => 2
c  ; => 3

; Array destructuring with rest
(let [first & rest] [1 2 3 4])
first  ; => 1
rest   ; => [2 3 4]

; Object destructuring
(let {name age} {"name": "Alice", "age": 30})
name  ; => "Alice"
age   ; => 30
```

### Type Annotations

```lisp
; Typed bindings (v2.0)
(let x:number 10)
(const name:string "Alice")

; Function with typed parameters
(fn add [a:number b:number] :number
  (+ a b))
```

## Compilation Targets

| HQL | JavaScript |
|-----|------------|
| `(let x 10)` | `let x = 10;` |
| `(const x 10)` | `const x = Object.freeze(10);` |
| `(var x 10)` | `var x = 10;` |
| `(= x 20)` | `x = 20;` |

### Deep Freeze for `const`

```lisp
(const data {"user": {"name": "Bob"}})

; Both outer and inner objects are frozen:
; Object.freeze(data)
; Object.freeze(data.user)

; Mutation attempts throw in strict mode:
; (= data.user.name "Charlie")  ; ERROR
```

## Features Covered

✅ Mutable bindings with `let`
✅ Immutable bindings with `const`
✅ Function-scoped bindings with `var`
✅ Assignment with `=`
✅ Compound assignment (`+=`, `-=`, `*=`, `/=`, etc.)
✅ Multiple bindings in single form
✅ Expression evaluation in bindings
✅ Object bindings (frozen for `const`, mutable for `let`/`var`)
✅ Array bindings (frozen for `const`, mutable for `let`/`var`)
✅ Property access and mutation
✅ Deep freeze for nested objects in `const`
✅ Array destructuring
✅ Object destructuring
✅ Rest patterns in destructuring
✅ Type annotations
✅ Nested bindings
✅ Top-level and local scopes

## Version History

- **v2.0**: `let` changed from immutable to mutable (aligns with JS semantics)
- **v2.0**: `const` added for immutable bindings with deep freeze
- **v2.0**: Type annotations added
- **v2.0**: Destructuring fully supported
