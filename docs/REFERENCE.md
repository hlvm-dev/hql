# HQL Quick Reference Card

**Version 2.0** | **JS Parity: 100%** | **TS Types: 100%**

---

## Syntax at a Glance

### Variables
```clojure
(let x 10)                ; let x = 10 (block-scoped mutable)
(var y 20)                ; var y = 20 (function-scoped mutable)
(= x 30)                  ; x = 30 (assignment)
(const PI 3.14)           ; const PI = 3.14 (immutable, frozen)
(let [a b] [1 2])         ; destructure array
(let {x y} obj)           ; destructure object
```

### Functions
```clojure
(fn add [a b] (+ a b))           ; function add(a, b) { return a + b }
(fn add [a:number b:number] :number (+ a b))  ; typed function
(=> (* $0 2))                    ; (x) => x * 2
(=> [x y] (+ x y))               ; (x, y) => x + y
(async fn f [] (await x))        ; async function
(fn sum [& args] ...)            ; rest params
```

### Generators
```clojure
(fn* gen [] (yield 1))           ; function* gen() { yield 1 }
(yield value)                    ; yield value
(yield* iterable)                ; yield* iterable
(async fn* gen [] ...)           ; async function* gen()
```

### Classes
```clojure
(class Person                    ; class Person {
  (var name "")                  ;   name = ""
  (#private 0)                   ;   #private = 0
  (static var count 0)           ;   static count = 0
  (constructor [n] ...)          ;   constructor(n) {...}
  (fn greet [] ...)              ;   greet() {...}
  (static fn create [] ...)      ;   static create() {...}
  (getter prop [] ...)           ;   get prop() {...}
  (setter prop [v] ...))         ;   set prop(v) {...} }

(abstract-class A extends B ...) ; abstract class extends
```

### Control Flow
```clojure
(if cond then else)              ; cond ? then : else
(cond ((c1) r1) (else r2))       ; c1 ? r1 : r2
(when cond body)                 ; if (cond) { body }
(unless cond body)               ; if (!cond) { body }
(switch x (case 1 a) (default b)); switch(x) { case 1: a; default: b }
(match v (case p r) (default d)) ; pattern matching
```

### Loops
```clojure
(loop [i 0] (recur (+ i 1)))     ; while (true) { i++ }
(for [i 10] body)                ; for (i=0; i<10; i++)
(for-of [x arr] body)            ; for (const x of arr)
(for-await-of [x iter] body)     ; for await (const x of iter)
(while cond body)                ; while (cond) { body }
(dotimes n body)                 ; for (i=0; i<n; i++)
(label name (break name))        ; name: { break name }
(continue) (break)               ; continue; break;
```

### Type System (Native)
```clojure
(type Name T)                    ; type Name = T
(| A B C)                        ; A | B | C
(& A B)                          ; A & B
(keyof T)                        ; keyof T
(indexed T K)                    ; T[K]
(if-extends T U X Y)             ; T extends U ? X : Y
(mapped K Keys V)                ; { [K in Keys]: V }
(tuple A B)                      ; [A, B]
(array T)                        ; T[]
(readonly T)                     ; readonly T
(typeof x)                       ; typeof x
(infer T)                        ; infer T
(Partial T)                      ; Partial<T>
```

### Type System (Passthrough)
```clojure
(deftype Name "any TS type")     ; type Name = any TS type
(interface Name "{ ... }")       ; interface Name { ... }
(abstract-class Name [...])      ; abstract class Name
(namespace Name [...])           ; namespace Name
(const-enum Name [A B C])        ; const enum Name { A, B, C }
(fn-overload name params ret)    ; function overload
(declare kind "...")             ; declare kind ...
```

### Operators
```clojure
(+ a b) (- a b) (* a b) (/ a b)  ; arithmetic
(% a b) (** a b)                 ; modulo, exponent
(< a b) (> a b) (<= a b) (>= a b); comparison
(=== a b) (!== a b)              ; strict equality
(== a b) (!= a b)                ; loose equality
(and a b) (or a b) (not a)       ; logical
(?? a b)                         ; a ?? b
(??= x v) (&&= x v) (||= x v)    ; logical assignment
obj?.prop                        ; optional chaining
123n                             ; BigInt
```

### Modules
```clojure
(import [a b] from "mod")        ; import { a, b } from "mod"
(import x from "mod")            ; import x from "mod"
(import * as x from "mod")       ; import * as x from "mod"
(import-dynamic "./mod.js")      ; import("./mod.js")
(export x)                       ; export { x }
(export-default x)               ; export default x
```

### Error Handling
```clojure
(try body (catch e ...) (finally ...))  ; try/catch/finally
(throw (new Error "msg"))               ; throw new Error("msg")
```

### JavaScript Interop
```clojure
js/console                       ; console
(.method obj arg)                ; obj.method(arg)
obj.property                     ; obj.property
(new Class arg)                  ; new Class(arg)
(await expr)                     ; await expr
```

### Macros
```clojure
(macro name [args] body)         ; define macro
'expr                            ; quote
`expr                            ; syntax-quote
~x                               ; unquote
~@rest                           ; unquote-splicing
(-> x (f) (g))                   ; thread-first
(->> x (f) (g))                  ; thread-last
(as-> x sym (f sym))             ; thread-as
```

---

## Complete Feature Matrix

### JavaScript Runtime (100%)

| Category | Features | Status |
|----------|----------|--------|
| Variables | `let`, `var`, `const`, destructuring | ✅ |
| Functions | `fn`, `async fn`, rest params | ✅ |
| Generators | `fn*`, `yield`, `yield*`, `async fn*` | ✅ |
| Classes | constructor, methods, static, private (#) | ✅ |
| Classes | getters, setters, abstract-class extends | ✅ |
| Control | `if`, `cond`, `when`, `unless`, `switch`, `match` | ✅ |
| Loops | `loop/recur`, `for`, `for-of`, `while`, `dotimes` | ✅ |
| Loops | `for-await-of`, `label`, `break`, `continue` | ✅ |
| Operators | `??`, `?.`, `??=`, `&&=`, `\|\|=` | ✅ |
| Operators | All arithmetic, comparison, logical, bitwise | ✅ |
| BigInt | `123n` literals | ✅ |
| Modules | `import`, `export`, `import-dynamic` | ✅ |
| Errors | `try/catch/finally`, `throw` | ✅ |

### TypeScript Types (100%)

| Category | Native Syntax | Passthrough | Status |
|----------|---------------|-------------|--------|
| Type Alias | `(type Name T)` | `(deftype ...)` | ✅ |
| Union | `(\| A B C)` | String | ✅ |
| Intersection | `(& A B)` | String | ✅ |
| Keyof | `(keyof T)` | String | ✅ |
| Indexed | `(indexed T K)` | String | ✅ |
| Conditional | `(if-extends ...)` | String | ✅ |
| Mapped | `(mapped K Keys V)` | String | ✅ |
| Tuple | `(tuple A B)` | String | ✅ |
| Array | `(array T)` | String | ✅ |
| Readonly | `(readonly T)` | String | ✅ |
| Typeof | `(typeof x)` | String | ✅ |
| Infer | `(infer T)` | String | ✅ |
| Utility | `(Partial T)` | String | ✅ |
| Interface | - | `(interface ...)` | ✅ |
| Abstract | - | `(abstract-class ...)` | ✅ |
| Namespace | - | `(namespace ...)` | ✅ |
| Const Enum | - | `(const-enum ...)` | ✅ |
| Overloads | - | `(fn-overload ...)` | ✅ |
| Declare | - | `(declare ...)` | ✅ |
| Template Literal | - | String | ✅ |

---

## Critical Rules

### Type Annotation Spacing

```
⚠️  NO SPACE after colon in type annotations!

✓ CORRECT:   [a:number b:string]
✗ WRONG:     [a: number b: string]
```

### Assignment vs Equality

```
⚠️  = is ASSIGNMENT, not equality!

(= x 10)       ; x = 10 (assignment)
(=== x 10)     ; x === 10 (comparison)
```

---

## Documentation Files

| File | Purpose |
|------|---------|
| `HQL-SYNTAX.md` | Complete syntax reference |
| `TYPE-SYSTEM.md` | Type system details |
| `MANUAL.md` | Language manual |
| `REFERENCE.md` | Quick reference (this file) |
| `QUICKSTART.md` | Getting started guide |

---

*Version 2.0 - December 2024*
