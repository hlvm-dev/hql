# Binding Feature Documentation

**Implementation:** `src/hql/transpiler/syntax/binding.ts` (let, const, var), `src/hql/transpiler/syntax/primitive.ts` (assignment)

## Overview

HQL provides four binding forms and assignment operators:

1. **`let`** - Block-scoped mutable binding (compiles to JS `let`)
2. **`const`** - Block-scoped immutable binding (compiles to JS `const`, value is deep-frozen)
3. **`var`** - Function-scoped mutable binding (compiles to JS `var`)
4. **`def`** - Alias for `const` (used for REPL memory persistence)
5. **`=`** - Assignment operator
6. **Compound assignment** - `+=`, `-=`, `*=`, `/=`, `%=`, `**=`, `&=`, `|=`, `^=`, `<<=`, `>>=`, `>>>=`
7. **Logical assignment** - `??=`, `&&=`, `||=`

## Syntax

### Simple Bindings

All four forms share the same syntax: `(keyword name value)`.

```lisp
;; Mutable block-scoped binding
(let x 10)

;; Immutable binding (deep-frozen)
(const PI 3.14159)

;; Function-scoped mutable binding
(var counter 0)
```

### Local Binding with Body

When a binding list and body are provided, the form creates a scoped block (compiled as an IIFE). The last body expression is the return value.

```lisp
;; Single binding with body
(let (x 10)
  (+ x 1))  ;; => 11

;; Multiple bindings with body
(let (x 10 y 20 z 30)
  (+ x y z))  ;; => 60

;; Works with var and const too
(var (x 10 y 20)
  (= x 100)
  (+ x y))  ;; => 120
```

### Assignment (`=`)

Updates an existing binding or object property.

```lisp
;; Update variable
(var x 10)
(= x 20)
x  ;; => 20

;; Update object property (dot notation)
(var obj {"count": 0})
(= obj.count 42)
obj.count  ;; => 42

;; Update via member expression
(= (. obj count) 42)
```

### Compound Assignment

```lisp
(var x 10)
(+= x 5)    ;; x = x + 5
(-= x 3)    ;; x = x - 3
(*= x 2)    ;; x = x * 2
(/= x 4)    ;; x = x / 4
(%=  x 3)   ;; x = x % 3
(**= x 2)   ;; x = x ** 2
(&= x 0xFF) ;; bitwise AND
(|= x 0x01) ;; bitwise OR
(^= x 0xFF) ;; bitwise XOR
(<<= x 2)   ;; left shift
(>>= x 1)   ;; signed right shift
(>>>= x 1)  ;; unsigned right shift
```

### Logical Assignment

```lisp
(??= x 10)            ;; x ??= 10 (assign if x is null/undefined)
(||= name "default")  ;; name ||= "default" (assign if name is falsy)
(&&= x (getValue))    ;; x &&= getValue() (assign if x is truthy)

;; Works with member expressions
(??= config.timeout 5000)
(||= cache.data (fetchData))
```

### Destructuring

#### Array Destructuring

```lisp
;; Simple
(let [a b c] [1 2 3])
a  ;; => 1
b  ;; => 2
c  ;; => 3

;; Rest pattern
(let [first & rest] [1 2 3 4])
first  ;; => 1
rest   ;; => [2, 3, 4]

;; Skip with _
(let [_ second _] [1 2 3])
second  ;; => 2

;; Nested
(let [[a b] [c d]] [[1 2] [3 4]])
;; a=1, b=2, c=3, d=4

;; Default values
(let [x (= 10)] [])
x  ;; => 10 (default used because array is empty)

(let [x (= 10)] [5])
x  ;; => 5 (provided value used)
```

#### Object Destructuring

```lisp
;; Simple (property names become variable names)
(let {x y} {x: 1 y: 2})
x  ;; => 1
y  ;; => 2

;; Property renaming
(let {x: newX} {x: 42})
newX  ;; => 42

;; Mixed rename and direct
(let {a x: y} {a: 10 x: 20})
a  ;; => 10
y  ;; => 20

;; Nested object destructuring
(let {data: {x y}} {data: {x: 10 y: 20}})
x  ;; => 10
y  ;; => 20

;; Deep nested
(let {outer: {middle: {inner}}} {outer: {middle: {inner: 42}}})
inner  ;; => 42

;; Object containing array
(let {nums: [a b]} {nums: [1 2]})
;; a=1, b=2

;; Array containing object
(let [{x y}] [{x: 1 y: 2}])
;; x=1, y=2
```

#### Destructuring in Local Binding Form

```lisp
(let ([a b] [1 2])
  (+ a b))  ;; => 3
```

### Type Annotations

Binding names can include type annotations using colon syntax.

```lisp
(let x:number 10)
(const name:string "Alice")
```

### Immutability (`const`)

`const` bindings are deep-frozen using `__hql_deepFreeze()`. This recursively freezes nested objects and arrays, preventing any mutation.

```lisp
;; Primitives work normally
(const x 42)

;; Arrays are frozen
(const nums [1 2 3])
;; (.push nums 4)  => TypeError: frozen array

;; Objects are frozen
(const person {"name": "Alice"})
;; (= person.name "Bob")  => TypeError: frozen object

;; Nested objects are also frozen (deep freeze)
(const data {"user": {"name": "Bob"}})
;; (= data.user.name "Charlie")  => TypeError: frozen nested object
```

`let` and `var` bindings are not frozen -- arrays and objects remain mutable.

```lisp
(var nums [1 2 3])
(.push nums 4)     ;; allowed
nums.length        ;; => 4

(var person {"name": "Alice"})
(= person.age 30)  ;; allowed
```

## Compilation

| HQL | JavaScript |
|-----|------------|
| `(let x 10)` | `let x = 10;` |
| `(const x 10)` | `const x = __hql_deepFreeze(10);` |
| `(def x 10)` | `const x = __hql_deepFreeze(10);` |
| `(var x 10)` | `var x = 10;` |
| `(= x 20)` | `x = 20;` |
| `(+= x 5)` | `x += 5;` |
| `(??= x 10)` | `x ??= 10;` |
| `(let (x 10) (+ x 1))` | `(function() { let x = 10; return x + 1; })()` |

## Features

- `let`: block-scoped mutable binding
- `const`: block-scoped immutable binding with deep freeze
- `var`: function-scoped mutable binding
- `def`: alias for `const` (used for REPL memory persistence)
- Assignment with `=` (variables and properties)
- Compound assignment: `+=`, `-=`, `*=`, `/=`, `%=`, `**=`, `&=`, `|=`, `^=`, `<<=`, `>>=`, `>>>=`
- Logical assignment: `??=`, `&&=`, `||=`
- Local binding form with body (IIFE): `(let (bindings...) body...)`
- Array destructuring with rest (`&`), skip (`_`), nesting, and defaults
- Object destructuring with property renaming, nesting, and mixed array/object patterns
- Type annotations on binding names (`name:type`)
- Deep freeze for `const` and `def` (nested objects/arrays; note: not yet applied in simple destructuring forms)
