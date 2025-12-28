# HQL Language Syntax Reference

**Version:** 2.0 | **Status:** Complete | **JS Parity:** 100% | **TS Types:** 100%

HQL (Homoiconic Query Language) is a Lisp dialect that transpiles to JavaScript/TypeScript. This document is the **definitive syntax reference** covering all supported syntax.

---

## Table of Contents

1. [Quick Reference](#1-quick-reference)
2. [Lexical Elements](#2-lexical-elements)
3. [Data Types & Literals](#3-data-types--literals)
4. [Bindings](#4-bindings)
5. [Functions](#5-functions)
6. [Classes](#6-classes)
7. [Control Flow](#7-control-flow)
8. [Loops](#8-loops)
9. [Generators](#9-generators)
10. [Type System (Native)](#10-type-system-native)
11. [Type System (Advanced)](#11-type-system-advanced)
12. [Import/Export](#12-importexport)
13. [Error Handling](#13-error-handling)
14. [JavaScript Interop](#14-javascript-interop)
15. [Macros](#15-macros)
16. [Operators](#16-operators)

---

## 1. Quick Reference

### JavaScript Features (100% Parity)

| Category | Features |
|----------|----------|
| **Variables** | `let`, `var`, `const`, destructuring |
| **Functions** | `fn`, `async fn`, `fn*`, `async fn*`, `=>` |
| **Classes** | `constructor`, methods, `static`, `getter`/`setter`, `#private` |
| **Control** | `if`, `cond`, `when`, `unless`, `switch`, `match` |
| **Loops** | `loop/recur`, `for`, `for-of`, `for-await-of`, `while`, `dotimes` |
| **Labels** | `label`, `break label`, `continue label` |
| **Generators** | `fn*`, `yield`, `yield*` |
| **Async** | `async fn`, `await`, `async fn*` |
| **Operators** | `??=`, `&&=`, `\|\|=`, `?.`, `??` |
| **BigInt** | `123n` literals |
| **Dynamic Import** | `import-dynamic` |
| **Errors** | `try/catch/finally`, `throw` |

### TypeScript Type System (100% Coverage)

| Native Syntax | TypeScript Output |
|---------------|-------------------|
| `(type Name T)` | `type Name = T;` |
| `(\| A B C)` | `A \| B \| C` |
| `(& A B C)` | `A & B & C` |
| `(keyof T)` | `keyof T` |
| `(indexed T K)` | `T[K]` |
| `(if-extends T U X Y)` | `T extends U ? X : Y` |
| `(mapped K Keys V)` | `{ [K in Keys]: V }` |
| `(tuple A B)` | `[A, B]` |
| `(array T)` | `T[]` |
| `(readonly T)` | `readonly T` |
| `(typeof x)` | `typeof x` |
| `(infer T)` | `infer T` |
| `(Partial T)` | `Partial<T>` |
| String passthrough | Any TypeScript type |

---

## 2. Lexical Elements

### Comments

```clojure
; Single-line comment
;; Documentation comment (convention)
```

### Identifiers

```clojure
foo              ; Simple
my-function      ; Kebab-case (preferred)
MyClass          ; PascalCase (classes)
foo?             ; Predicate
foo!             ; Mutating
*global*         ; Earmuffs (dynamic vars)
_private         ; Private convention
```

### Reserved Symbols

```
fn let var const def if cond when unless do
loop recur for for-of for-await-of while dotimes
class new async await return throw try catch finally
import export macro match switch case default
=> & _ nil true false this
label break continue yield yield*
fn* async-fn* getter setter static
type deftype interface abstract-class namespace
const-enum declare fn-overload
```

---

## 3. Data Types & Literals

### Primitives

```clojure
; Numbers
42                ; Integer
3.14159           ; Float
-17               ; Negative
1e10              ; Scientific
123n              ; BigInt

; Strings
"hello"           ; Double-quoted
"line1\nline2"    ; Escape sequences
`template ${x}`   ; Template literal

; Booleans
true
false

; Null
nil               ; null/undefined
```

### Collections

```clojure
; Vector (Array)
[1 2 3]           ; No commas
[1, 2, 3]         ; JSON style

; Hash-map (Object)
{name: "Alice" age: 30}
{"name": "Alice", "age": 30}

; Set
#[1 2 3]

; Nested
{user: {name: "Bob" tags: ["admin" "user"]}}
```

### Collection Access

```clojure
(get arr 0)           ; arr[0]
(get arr 0 "default") ; with default
(get obj "name")      ; obj.name
obj.name              ; Dot notation
(first [1 2 3])       ; → 1
(rest [1 2 3])        ; → [2 3]
(nth [1 2 3] 1)       ; → 2
```

---

## 4. Bindings

HQL bindings have the same semantics as JavaScript:

### Block-scoped Mutable (`let`)

```clojure
(let x 10)
(= x 20)              ; Reassignment allowed

; Multiple bindings with body
(let (x 10 y 20)
  (= x 100)
  (+ x y))            ; → 120
```

### Block-scoped Immutable (`const`)

```clojure
(const PI 3.14159)
; (= PI 3.0)          ; ERROR: Cannot reassign const

; Objects/arrays are frozen (deep immutability)
(const data {"name": "Alice"})
; (= data.name "Bob") ; ERROR: Cannot mutate frozen object
```

### Function-scoped Mutable (`var`)

```clojure
(var count 0)
(= count (+ count 1)) ; Reassign

; Multiple bindings with body
(var (x 10 y 20)
  (= x 100)
  (+ x y))            ; → 120
```

### Destructuring

```clojure
; Array destructuring
(let [a b c] [1 2 3])

; With rest
(let [first & rest] [1 2 3 4])

; Skip elements
(let [a _ c] [1 2 3])

; Object destructuring
(let {name age} person)

; With defaults
(let [x (= 10)] [])   ; x = 10 if undefined
```

---

## 5. Functions

### Named Functions

```clojure
; Positional parameters
(fn add [a b]
  (+ a b))

; Map parameters (all must have defaults)
(fn connect {host: "localhost" port: 8080}
  (+ host ":" port))
```

### Type Annotations

```clojure
; ⚠️ CRITICAL: NO SPACE after colon!
(fn add [a:number b:number] :number
  (+ a b))

; Union types
(fn handle [value:string|number] :void
  (print value))
```

### Anonymous Functions

```clojure
(fn [x] (* x x))
(map (fn [x] (* x 2)) [1 2 3])
```

### Arrow Lambda (`=>`)

```clojure
; Implicit parameters ($0, $1, $2...)
(=> (* $0 2))
(=> (+ $0 $1))
(map (=> (* $0 2)) [1 2 3])

; Property access
(=> $0.name)

; Explicit parameters
(=> [x] (* x x))
(=> [x y] (+ x y))
```

### Async Functions

```clojure
(async fn fetch-data [url]
  (let response (await (js/fetch url)))
  (await (.json response)))
```

### Rest Parameters

```clojure
(fn sum [first & rest]
  (reduce + first rest))
```

### Return

```clojure
; Implicit return (last expression)
(fn double [x]
  (* x 2))

; Explicit return
(fn safe-divide [a b]
  (if (=== b 0)
    (return 0))
  (/ a b))
```

---

## 6. Classes

### Basic Class

```clojure
(class Person
  (var name "")
  (var age 0)

  (constructor [name age]
    (do
      (= this.name name)
      (= this.age age)))

  (fn greet []
    (+ "Hello, " this.name)))
```

### Static Members

```clojure
(class Counter
  (static var count 0)
  (static const MAX 100)  ; Immutable static field

  (static fn increment []
    (= Counter.count (+ Counter.count 1))))
```

### Getters and Setters

```clojure
(class Circle
  (var _radius 0)

  (getter radius []
    this._radius)

  (setter radius [value]
    (when (> value 0)
      (= this._radius value)))

  (getter area []
    (* Math.PI this._radius this._radius)))
```

### Private Fields

```clojure
(class BankAccount
  (#balance 0)           ; Private field
  (#transactions [])

  (fn deposit [amount]
    (= this.#balance (+ this.#balance amount))))
```

### Inheritance (Abstract Classes Only)

```clojure
; Regular class inheritance is not yet implemented
; Use abstract-class for inheritance patterns:
(abstract-class Animal [
  (abstract-method speak [] :string)
])

; For regular classes, use composition instead:
(class Dog
  (var animal null)
  (constructor [name]
    (= this.name name))
  (fn speak []
    "Woof!"))
```

---

## 7. Control Flow

### If Expression

```clojure
(if condition
  then-expr
  else-expr)

(if (> x 0)
  "positive"
  "non-positive")
```

### Cond Expression

```clojure
(cond
  ((< x 0) "negative")
  ((=== x 0) "zero")
  ((> x 0) "positive")
  (else "unknown"))
```

### When/Unless

```clojure
(when (> x 0)
  (print "positive")
  x)

(unless (=== x 0)
  (/ 100 x))
```

### Switch Statement

```clojure
(switch status
  (case "active" (run))
  (case "waiting" (wait))
  (default (error)))

; With fallthrough
(switch grade
  (case "A" :fallthrough)
  (case "B" (console.log "Good"))
  (default (console.log "Other")))

; String cases
(switch color
  (case "red" (setColor "#ff0000"))
  (case "green" (setColor "#00ff00"))
  (default (setColor "#000000")))
```

### Match (Pattern Matching)

```clojure
(match value
  (case 1 "one")
  (case 2 "two")
  (default "other"))

; Array patterns
(match point
  (case [0, 0] "origin")
  (case [x, 0] "on x-axis")
  (case [0, y] "on y-axis")
  (case [x, y] "somewhere"))

; Object patterns
(match user
  (case {name: n, age: a} (+ n " is " a))
  (default "Unknown"))

; With guards
(match n
  (case x (if (> x 0)) "positive")
  (case x (if (< x 0)) "negative")
  (default "zero"))

; Wildcard pattern
(match value
  (case _ "anything"))
```

### Do Block

```clojure
(do
  (print "step 1")
  (print "step 2")
  (+ 1 2))           ; Returns 3
```

---

## 8. Loops

### Loop/Recur (TCO)

```clojure
(loop [i 0 sum 0]
  (if (< i 5)
    (recur (+ i 1) (+ sum i))
    sum))             ; → 10

; Factorial
(loop [n 5 acc 1]
  (if (<= n 1)
    acc
    (recur (- n 1) (* acc n))))
```

### For Loop

```clojure
; Single arg: 0 to n-1
(for [i 3]
  (print i))          ; 0, 1, 2

; Two args: start to end-1
(for [i 5 8]
  (print i))          ; 5, 6, 7

; Three args: start to end-1 by step
(for [i 0 10 2]
  (print i))          ; 0, 2, 4, 6, 8
```

### For-Of Loop

```clojure
(for-of [item items]
  (print item))

(for-of [n numbers]
  (when (=== n 0)
    (continue))
  (when (> n 100)
    (break))
  (process n))
```

### For-Await-Of Loop

```clojure
(for-await-of [chunk stream]
  (process chunk))

(for-await-of [response responses]
  (const data (await (.json response)))
  (results.push data))
```

### While Loop

```clojure
(var count 0)
(while (< count 5)
  (print count)
  (= count (+ count 1)))
```

### Dotimes

```clojure
(dotimes 5
  (print "hello"))
```

### Labeled Statements

```clojure
(label outer
  (while true
    (while true
      (when done
        (break outer)))))

(label search
  (for-of [item items]
    (when (matches item)
      (break search))))

; Nested labels
(label outer
  (while (< i n)
    (label inner
      (while (< j m)
        (when found
          (break outer))
        (when skip
          (continue inner))))))
```

### Continue/Break

```clojure
(while (< i 10)
  (= i (+ i 1))
  (when (=== (% i 2) 0)
    (continue))
  (when (> i 50)
    (break))
  (console.log i))
```

---

## 9. Generators

### Generator Functions

```clojure
(fn* range [start end]
  (var i start)
  (while (< i end)
    (yield i)
    (= i (+ i 1))))

(fn* fibonacci []
  (var a 0)
  (var b 1)
  (while true
    (yield a)
    (var temp b)
    (= b (+ a b))
    (= a temp)))
```

### Yield and Yield*

```clojure
(fn* simple []
  (yield 1)
  (yield 2)
  (yield 3))

(fn* combined []
  (yield* [1 2 3])    ; Delegate to iterable
  (yield 4))
```

### Async Generators

```clojure
(async fn* fetchPages [urls]
  (for-of [url urls]
    (yield (await (fetch url)))))

(async fn* paginate [startPage maxPages]
  (var page startPage)
  (while (<= page maxPages)
    (const data (await (fetchPage page)))
    (yield data)
    (= page (+ page 1))))
```

---

## 10. Type System (Native)

HQL has native S-expression syntax for TypeScript types. All native type expressions compile directly to TypeScript.

### Type Alias

```clojure
(type MyString string)
(type ID number)
(type Point {x: number, y: number})

; With generics
(type Container<T> T)
(type Box<T> {value: T})
```

### Union Types

```clojure
(type StringOrNumber (| string number))
(type Status (| "pending" "active" "done"))
(type Nullable (| string null undefined))
```

### Intersection Types

```clojure
(type Combined (& A B))
(type AdminUser (& User AdminPermissions))
```

### Keyof Operator

```clojure
(type PersonKeys (keyof Person))
(type Keys<T> (keyof T))
```

### Indexed Access

```clojure
(type NameType (indexed Person "name"))     ; Person["name"]
(type Value<T> (indexed T (keyof T)))       ; T[keyof T]
```

### Conditional Types

```clojure
(type IsString<T> (if-extends T string true false))
; → T extends string ? true : false

(type UnwrapPromise<T> (if-extends T (Promise (infer U)) U T))
; → T extends Promise<infer U> ? U : T

(type Deep<T> (if-extends T string "str" (if-extends T number "num" "other")))
```

### Mapped Types

```clojure
(type MyReadonly<T> (mapped K (keyof T) (indexed T K)))
; → { [K in keyof T]: T[K] }
```

### Tuple Types

```clojure
(type Point (tuple number number))
(type Entry (tuple string number boolean))

; With rest
(type Args (tuple string (rest (array number))))
; → [string, ...number[]]
```

### Array Types

```clojure
(type Numbers (array number))
(type MixedArray (array (| string number)))  ; → (string | number)[]
```

### Readonly Modifier

```clojure
(type ImmutableNumbers (readonly (array number)))
; → readonly number[]
```

### Typeof Operator

```clojure
(type MyType (typeof myVar))
```

### Infer Keyword

```clojure
(type ArrayElement<T> (if-extends T (array (infer E)) E never))
```

### Utility Type Application

```clojure
(type PartialPerson (Partial Person))
(type RequiredConfig (Required Config))
(type PickedPerson (Pick Person (| "name" "age")))
(type StringRecord (Record string number))
```

---

## 11. Type System (Advanced)

For complex types, use string passthrough with `deftype` or `interface`.

### String Passthrough

```clojure
; Any valid TypeScript type expression
(deftype Complex "Record<string, number>")
(deftype EventName "`on${string}`")           ; Template literal types
(deftype "Mutable<T>" "{ -readonly [K in keyof T]: T[K] }")
```

### Interfaces

```clojure
(interface User "{ id: string; name: string }")
(interface Point "{ readonly x: number; readonly y: number }")
(interface Config "{ debug?: boolean; port?: number }")
(interface StringMap "{ [key: string]: string }")
```

### Abstract Classes

```clojure
(abstract-class Animal [
  (abstract-method speak [] :string)
])

(abstract-class Container<T> [
  (abstract-method getValue [] :T)
  (abstract-method setValue "value: T" :void)
])
```

### Function Overloads

```clojure
(fn-overload process "x: string" :string)
(fn-overload process "x: number" :number)
(fn-overload "identity<T>" "x: T" :T)
```

### Namespaces

```clojure
(namespace Utils [
  (deftype ID "string")
])

(namespace Models [
  (interface User "{ id: string; name: string }")
])
```

### Const Enums

```clojure
(const-enum Direction [North South East West])
(const-enum Status [(OK 200) (NotFound 404) (Error 500)])
(const-enum Color [(Red "red") (Green "green") (Blue "blue")])
```

### Declare Statements

```clojure
(declare function "greet(name: string): string")
(declare var "globalCounter: number")
(declare const "PI: 3.14159")
(declare module "my-module")
```

### Parameter Type Annotations

```clojure
; ⚠️ NO SPACE after colon!
(fn add [a:number b:number] :number
  (+ a b))

(fn process [items:Array<number> callback:Function]
  (map callback items))

(fn handle [value:string|number] :void
  (print value))

; Mixed typed and untyped (gradual typing)
(fn greet [name:string times]
  (print name times))
```

---

## 12. Import/Export

### Static Import

```clojure
(import [foo bar] from "module.hql")
(import utils from "utils.hql")
(import [foo as myFoo] from "module.hql")
(import [readFile] from "node:fs")
(import _ from "npm:lodash")
```

### Dynamic Import

```clojure
(import-dynamic "./module.js")
(await (import-dynamic "./utils.ts"))
(import-dynamic modulePath)
(import-dynamic `./modules/${name}.js`)
```

### Export

```clojure
(export (fn add [a b] (+ a b)))
(export my-function)
(export-default my-value)
(export [foo bar])
```

---

## 13. Error Handling

### Try/Catch/Finally

```clojure
(try
  (riskyOperation)
  (catch e
    (console.error e))
  (finally
    (cleanup)))
```

### Throw

```clojure
(throw (new Error "Something went wrong"))
```

---

## 14. JavaScript Interop

### Global Access

```clojure
js/console            ; console
js/Math               ; Math
js/Date               ; Date
js/JSON               ; JSON

(js/console.log "hello")
(js/Math.floor 3.7)
(js/JSON.stringify obj)
```

### Method Calls

```clojure
(.toLowerCase str)    ; str.toLowerCase()
(.push arr item)      ; arr.push(item)
(.map arr callback)   ; arr.map(callback)
```

### Property Access

```clojure
obj.property
obj.nested.prop
obj?.optionalProp     ; Optional chaining
```

### Object Construction

```clojure
(new Date)
(new Date 2024 0 1)
(new Map)
(new Set [1 2 3])
(new Promise (fn [resolve reject] ...))
```

### Await/Async

```clojure
(await promise)
(async fn fetch-data []
  (let response (await (js/fetch "/api")))
  (await (.json response)))
```

---

## 15. Macros

### Macro Definition

```clojure
(macro unless [condition & body]
  `(if (not ~condition)
    (do ~@body)))

(unless (valid? x)
  (throw (new Error "invalid")))
```

### Quoting

```clojure
'(1 2 3)              ; Quote
`(a b c)              ; Syntax quote
`(1 2 ~x)             ; Unquote
`(1 2 ~@rest)         ; Unquote-splicing
```

### Threading Macros

```clojure
; Thread-first
(-> 5
    (+ 3)
    (* 2))            ; → 16

; Thread-last
(->> [1 2 3 4 5]
     (filter (=> (> $0 2)))
     (map (=> (* $0 2))))

; Thread-as
(as-> {name: "Alice"} user
      user.name
      (str "Hello, " user))
```

### Type Predicates

```clojure
(isNull x)            ; x === null
(isUndefined x)       ; x === undefined
(isNil x)             ; x == null
(isDefined x)         ; x !== undefined
(isString x)          ; typeof x === "string"
(isNumber x)          ; typeof x === "number"
(isBoolean x)         ; typeof x === "boolean"
(isFunction x)        ; typeof x === "function"
(isArray x)           ; Array.isArray(x)
(isObject x)          ; typeof x === "object" && x !== null && !Array.isArray(x)
```

### Utility Macros

```clojure
(inc x)               ; (+ x 1)
(dec x)               ; (- x 1)
(str a b c)           ; String concatenation
(print & args)        ; console.log
(empty? coll)         ; Check if empty
(nil? x)              ; Check if nil
```

---

## 16. Operators

### Arithmetic

```clojure
(+ a b c)             ; Addition
(- a b)               ; Subtraction
(* a b c)             ; Multiplication
(/ a b)               ; Division
(% a b)               ; Modulo
(** a b)              ; Exponentiation
```

### Comparison

```clojure
; ⚠️ = is ASSIGNMENT, not comparison!
(== a b)              ; Loose equality
(=== a b)             ; Strict equality (preferred)
(!= a b)              ; Loose inequality
(!== a b)             ; Strict inequality
(< a b)               ; Less than
(> a b)               ; Greater than
(<= a b)              ; Less or equal
(>= a b)              ; Greater or equal
```

### Logical

```clojure
(and a b c)           ; Logical AND
(or a b c)            ; Logical OR
(not a)               ; Logical NOT
```

### Nullish

```clojure
(?? a b)              ; Nullish coalescing: a ?? b
obj?.prop             ; Optional chaining
```

### Logical Assignment

```clojure
(??= x 10)            ; x ??= 10
(&&= x (getValue))    ; x &&= getValue()
(||= name "default")  ; name ||= "default"
```

### Bitwise

```clojure
(bit-and a b)         ; Bitwise AND
(bit-or a b)          ; Bitwise OR
(bit-xor a b)         ; Bitwise XOR
(bit-not a)           ; Bitwise NOT
(<< a n)              ; Left shift
(>> a n)              ; Signed right shift
(>>> a n)             ; Unsigned right shift
```

---

## Appendix: Complete Syntax Table

```
┌──────────────────┬───────────────────────────────────┬──────────────────────────────┐
│ Category         │ HQL Syntax                        │ JavaScript/TypeScript        │
├──────────────────┼───────────────────────────────────┼──────────────────────────────┤
│ BINDINGS         │                                   │                              │
│ Block mutable    │ (let x 10)                        │ let x = 10                   │
│ Block immutable  │ (const x 10)                      │ const x = 10 (frozen)        │
│ Function mutable │ (var x 10)                        │ var x = 10                   │
│ Assignment       │ (= x 20)                          │ x = 20                       │
│ Destructure      │ (let [a b] arr)                   │ let [a, b] = arr             │
├──────────────────┼───────────────────────────────────┼──────────────────────────────┤
│ FUNCTIONS        │                                   │                              │
│ Named            │ (fn add [a b] (+ a b))            │ function add(a, b) {...}     │
│ Anonymous        │ (fn [x] (* x 2))                  │ function(x) { return x*2 }   │
│ Arrow            │ (=> (* $0 2))                     │ (x) => x * 2                 │
│ Async            │ (async fn f [] ...)               │ async function f() {...}     │
│ Generator        │ (fn* g [] (yield 1))              │ function* g() { yield 1 }    │
│ Async Gen        │ (async fn* g [] ...)              │ async function* g() {...}    │
│ Typed            │ (fn f [a:number] :string ...)     │ function f(a: number): str.. │
├──────────────────┼───────────────────────────────────┼──────────────────────────────┤
│ CLASSES          │                                   │                              │
│ Basic            │ (class Foo (constructor [] ...))  │ class Foo { constructor(){} }│
│ Static           │ (static fn bar [] ...)            │ static bar() {...}           │
│ Getter           │ (getter prop [] ...)              │ get prop() {...}             │
│ Setter           │ (setter prop [v] ...)             │ set prop(v) {...}            │
│ Private          │ (#field 0)                        │ #field = 0                   │
│ Extends          │ (class Bar extends Foo ...)       │ class Bar extends Foo {...}  │
├──────────────────┼───────────────────────────────────┼──────────────────────────────┤
│ CONTROL FLOW     │                                   │                              │
│ If               │ (if cond then else)               │ cond ? then : else           │
│ Switch           │ (switch x (case 1 ...) (default)) │ switch(x) { case 1: ... }    │
│ Cond             │ (cond ((c1) r1) (else r2))        │ c1 ? r1 : r2                 │
│ When             │ (when cond body)                  │ if (cond) { body }           │
├──────────────────┼───────────────────────────────────┼──────────────────────────────┤
│ LOOPS            │                                   │                              │
│ Loop/Recur       │ (loop [i 0] (recur (+ i 1)))      │ while loop (optimized)       │
│ For-Of           │ (for-of [x arr] ...)              │ for (const x of arr) {...}   │
│ For-Await-Of     │ (for-await-of [x iter] ...)       │ for await (const x of i) {}  │
│ While            │ (while cond body)                 │ while (cond) { body }        │
│ Label            │ (label name (while ...))          │ name: while (...) {...}      │
│ Break            │ (break) / (break label)           │ break / break label          │
│ Continue         │ (continue) / (continue label)     │ continue / continue label    │
├──────────────────┼───────────────────────────────────┼──────────────────────────────┤
│ GENERATORS       │                                   │                              │
│ Yield            │ (yield value)                     │ yield value                  │
│ Yield*           │ (yield* iterable)                 │ yield* iterable              │
├──────────────────┼───────────────────────────────────┼──────────────────────────────┤
│ TYPE SYSTEM      │                                   │                              │
│ Type Alias       │ (type Name T)                     │ type Name = T                │
│ Union            │ (| A B C)                         │ A | B | C                    │
│ Intersection     │ (& A B C)                         │ A & B & C                    │
│ Keyof            │ (keyof T)                         │ keyof T                      │
│ Indexed          │ (indexed T K)                     │ T[K]                         │
│ Conditional      │ (if-extends T U X Y)              │ T extends U ? X : Y          │
│ Mapped           │ (mapped K Keys V)                 │ { [K in Keys]: V }           │
│ Tuple            │ (tuple A B)                       │ [A, B]                       │
│ Array            │ (array T)                         │ T[]                          │
│ Readonly         │ (readonly T)                      │ readonly T                   │
│ Typeof           │ (typeof x)                        │ typeof x                     │
│ Infer            │ (infer T)                         │ infer T                      │
│ Utility          │ (Partial T)                       │ Partial<T>                   │
│ Passthrough      │ (deftype N "complex<T>")          │ type N = complex<T>          │
├──────────────────┼───────────────────────────────────┼──────────────────────────────┤
│ OPERATORS        │                                   │                              │
│ Nullish Coal     │ (?? a b)                          │ a ?? b                       │
│ Opt Chain        │ obj?.prop                         │ obj?.prop                    │
│ ??= &&= ||=      │ (??= x 10)                        │ x ??= 10                     │
│ BigInt           │ 123n                              │ 123n                         │
├──────────────────┼───────────────────────────────────┼──────────────────────────────┤
│ MODULES          │                                   │                              │
│ Import           │ (import [a] from "m")             │ import { a } from "m"        │
│ Dynamic Import   │ (import-dynamic "./m.js")         │ import("./m.js")             │
│ Export           │ (export x)                        │ export { x }                 │
│ Export Default   │ (export-default x)                │ export default x             │
├──────────────────┼───────────────────────────────────┼──────────────────────────────┤
│ ERROR HANDLING   │                                   │                              │
│ Try/Catch        │ (try ... (catch e ...) (finally)) │ try {...} catch(e) {} fin... │
│ Throw            │ (throw (new Error "msg"))         │ throw new Error("msg")       │
└──────────────────┴───────────────────────────────────┴──────────────────────────────┘
```

---

*This document is the authoritative HQL syntax reference. Version 2.0 - Updated December 2024.*
