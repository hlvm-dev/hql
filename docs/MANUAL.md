# HQL Language Manual

**Version:** 2.0 | **JS Parity:** 100% | **TS Types:** 100%

---

## Table of Contents

- [Installation](#installation)
- [Getting Started](#getting-started)
- [Language Basics](#language-basics)
- [Functions](#functions)
- [Generators](#generators)
- [Classes](#classes)
- [Control Flow](#control-flow)
- [Type System](#type-system)
- [Macros](#macros)
- [JavaScript Interop](#javascript-interop)
- [Module System](#module-system)
- [Standard Library](#standard-library)
- [CLI Reference](#cli-reference)

---

## Installation

### Quick Install

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/hlvm-dev/hql/main/install.sh | sh
```

**Windows:**

Download the binary from [releases](https://github.com/hlvm-dev/hql/releases).

### Verify Installation

```bash
hql --version
```

---

## Getting Started

### Hello World

Create `hello.hql`:
```clojure
(print "Hello, World!")
```

Run it:
```bash
hql run hello.hql
```

### Interactive REPL

```bash
hql repl
```

```clojure
hql> (+ 1 2 3)
6
hql> (let name "HQL")
hql> (print "Hello," name)
Hello, HQL
```

---

## Language Basics

### Variables

**Immutable bindings:**
```clojure
(let x 10)
(const PI 3.14159)
```

**Mutable bindings:**
```clojure
(var counter 0)
(= counter (+ counter 1))
```

### Destructuring

```clojure
; Array destructuring
(let [a b c] [1 2 3])
(let [first & rest] [1 2 3 4])

; Object destructuring
(let {name age} person)
```

### Comments

```clojure
; Single line comment
;; Documentation comment
```

---

## Functions

### Basic Functions

```clojure
(fn add [a b]
  (+ a b))

(add 5 3)  ; → 8
```

### Typed Functions

```clojure
; ⚠️ NO SPACE after colon!
(fn add [a:number b:number] :number
  (+ a b))
```

### Arrow Functions

```clojure
; Implicit parameters ($0, $1, $2...)
(let double (=> (* $0 2)))
(double 5)  ; → 10

; Explicit parameters
(let square (=> [x] (* x x)))
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

### Tail Call Optimization (TCO)

```clojure
(fn factorial [n]
  (loop [n n acc 1]
    (if (<= n 1)
      acc
      (recur (- n 1) (* acc n)))))

(factorial 10000)  ; Works! No stack overflow
```

---

## Generators

### Generator Functions

```clojure
(fn* range [start end]
  (var i start)
  (while (< i end)
    (yield i)
    (= i (+ i 1))))

; Usage
(for-of [x (range 0 10)]
  (print x))
```

### Async Generators

```clojure
(async fn* fetchPages [urls]
  (for-of [url urls]
    (yield (await (fetch url)))))

; Consume with for-await-of
(for-await-of [page (fetchPages urls)]
  (process page))
```

### Yield Delegation

```clojure
(fn* combined []
  (yield* [1 2 3])    ; Delegate to iterable
  (yield 4))
```

---

## Classes

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
  (static let MAX 100)

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
  (#balance 0)

  (fn deposit [amount]
    (= this.#balance (+ this.#balance amount))))
```

### Inheritance (Abstract Classes)

```clojure
; Use abstract-class for inheritance:
(abstract-class Animal [
  (abstract-method speak [] :string)
])
```

---

## Control Flow

### Conditionals

```clojure
(if (> x 10)
  (print "Large")
  (print "Small"))

(cond
  ((< x 0) "Negative")
  ((=== x 0) "Zero")
  (else "Positive"))
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
```

### Pattern Matching

```clojure
(match value
  (case 1 "one")
  (case 2 "two")
  (default "other"))

; With patterns
(match point
  (case [0, 0] "origin")
  (case [x, 0] "on x-axis")
  (case [0, y] "on y-axis")
  (case [x, y] "somewhere"))

; With guards
(match n
  (case x (if (> x 0)) "positive")
  (case x (if (< x 0)) "negative")
  (default "zero"))
```

### Loops

```clojure
; Loop/recur
(loop [i 0 sum 0]
  (if (< i 5)
    (recur (+ i 1) (+ sum i))
    sum))

; For-of
(for-of [item items]
  (print item))

; For-await-of
(for-await-of [chunk stream]
  (process chunk))

; While
(while (< i 10)
  (print i)
  (= i (+ i 1)))

; Labeled statements
(label outer
  (while true
    (while true
      (when done
        (break outer)))))
```

---

## Type System

HQL has 100% TypeScript type system coverage via native syntax and string passthrough.

### Native Type Syntax

```clojure
; Type aliases
(type ID number)
(type Status (| "pending" "active" "done"))

; Union and intersection
(type StringOrNumber (| string number))
(type Combined (& A B))

; Advanced types
(type Keys (keyof Person))
(type NameType (indexed Person "name"))
(type IsString<T> (if-extends T string true false))

; Utility types
(type PartialPerson (Partial Person))
(type StringRecord (Record string number))
```

### String Passthrough (100% Coverage)

```clojure
; For complex types, use strings
(deftype EventName "`on${string}`")
(deftype "Mutable<T>" "{ -readonly [K in keyof T]: T[K] }")
```

### Type Annotations

```clojure
; ⚠️ NO SPACE after colon!
(fn add [a:number b:number] :number
  (+ a b))

(fn handle [value:string|number] :void
  (print value))
```

### Advanced Declarations

```clojure
(interface User "{ id: string; name: string }")

(abstract-class Animal [
  (abstract-method speak [] :string)
])

(const-enum Direction [North South East West])

(namespace Utils [
  (deftype ID "string")
])
```

---

## Macros

### Defining Macros

```clojure
(macro unless [condition & body]
  `(if (not ~condition)
    (do ~@body)))

(unless (valid? x)
  (throw (new Error "invalid")))
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
(isString x)          ; typeof x === "string"
(isNumber x)          ; typeof x === "number"
(isArray x)           ; Array.isArray(x)
```

---

## JavaScript Interop

### Global Access

```clojure
js/console            ; console
js/Math               ; Math
js/Date               ; Date

(js/console.log "hello")
(js/Math.floor 3.7)
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

### Modern Operators

```clojure
(?? value default)    ; value ?? default
(??= x 10)            ; x ??= 10
(&&= flag condition)  ; flag &&= condition
(||= value fallback)  ; value ||= fallback
123n                  ; BigInt
```

### Dynamic Import

```clojure
(import-dynamic "./module.js")
(await (import-dynamic "./utils.ts"))
```

---

## Module System

### Importing

```clojure
(import [foo bar] from "./module.hql")
(import utils from "./utils.hql")
(import [foo as myFoo] from "./module.hql")
(import _ from "npm:lodash")
```

### Exporting

```clojure
(export (fn add [a b] (+ a b)))
(export my-function)
(export-default my-value)
(export [foo bar])
```

---

## Standard Library

See [Standard Library Reference](./api/stdlib.md) for complete documentation.

### Sequence Operations

```clojure
(first [1 2 3])           ; → 1
(rest [1 2 3])            ; → [2 3]
(take 2 [1 2 3 4])        ; → [1 2]
(drop 2 [1 2 3 4])        ; → [3 4]
```

### Transformations

```clojure
(map (fn [x] (* x 2)) [1 2 3])     ; → [2 4 6]
(filter (fn [x] (> x 2)) [1 2 3])  ; → [3]
(reduce + 0 [1 2 3 4])             ; → 10
```

### Map Operations

```clojure
(assoc {a: 1} "b" 2)      ; → {a: 1, b: 2}
(dissoc {a: 1, b: 2} "a") ; → {b: 2}
(keys {a: 1, b: 2})       ; → ["a", "b"]
```

---

## CLI Reference

### Commands

```bash
hql run <file>        # Execute HQL file
hql run '<expr>'      # Evaluate expression
hql repl              # Start REPL
hql compile <file>    # Compile to JavaScript
hql init              # Initialize project
hql lsp               # Start Language Server
hql upgrade           # Update HQL
```

### Compile Options

```bash
hql compile app.hql                     # Dev build
hql compile app.hql --release           # Production build
hql compile app.hql --target native     # Native binary
hql compile app.hql -o myapp.js         # Custom output
```

### Global Options

```bash
--help               # Show help
--version            # Show version
--verbose            # Detailed logging
--debug              # Debug information
```

---

## Further Reading

- [Syntax Reference](./HQL-SYNTAX.md) - Complete syntax documentation
- [Type System](./TYPE-SYSTEM.md) - TypeScript type system coverage
- [API Reference](./api/) - Complete API documentation
- [Standard Library](./api/stdlib.md) - Built-in functions
- [LSP & Editor Support](./LSP.md) - Language Server Protocol

---

*Version 2.0 - Updated December 2024*
