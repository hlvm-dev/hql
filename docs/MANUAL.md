# HQL Language Manual

## Table of Contents

- [Installation](#installation)
- [Getting Started](#getting-started)
- [Language Basics](#language-basics)
- [Functions](#functions)
  - [Arrow Functions](#arrow-functions-short-syntax)
  - [Tail Call Optimization](#tail-call-optimization-tco)
- [Data Structures](#data-structures)
- [Control Flow](#control-flow)
- [Macros](#macros)
  - [Threading Macros](#threading-macros)
  - [Type Predicates](#type-predicates)
  - [Control Flow Macros](#control-flow-macros)
  - [Utility Macros](#utility-macros)
- [JavaScript Interop](#javascript-interop)
- [Module System](#module-system)
- [Standard Library](#standard-library)

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

## Getting Started

### Hello World

Create `hello.hql`:
```lisp
(print "Hello, World!")
```

Run it:
```bash
hql run hello.hql
```

### Interactive REPL

Start the REPL:
```bash
hql repl
```

Try expressions:
```lisp
hql> (+ 1 2 3)
6
hql> (let name "HQL")
hql> (print "Hello," name)
Hello, HQL
```

## Language Basics

### Variables

Immutable bindings:
```lisp
(let x 10)
(let name "Alice")
```

Mutable bindings:
```lisp
(var counter 0)
(= counter (+ counter 1))
```

### Comments

```lisp
; Single line comment

;; Multi-line comments
;; use multiple semicolons
```

## Functions

### Defining Functions

Simple function:
```lisp
(fn add [a b]
  (+ a b))

(add 5 3)  ; → 8
```

With default parameters:
```lisp
(fn greet [name = "World"]
  (print "Hello," name))

(greet)          ; → Hello, World
(greet "Alice")  ; → Hello, Alice
```

Anonymous functions:
```lisp
(let double
  (fn [x] (* x 2)))

(double 5)  ; → 10
```

### Arrow Functions (Short Syntax)

HQL provides a concise arrow function syntax `=>` with Swift-style implicit parameters:

**Implicit parameters** (`$0`, `$1`, `$2`, ...):
```lisp
(let double (=> (* $0 2)))
(double 5)  ; → 10

(let add (=> (+ $0 $1)))
(add 3 7)   ; → 10

(let sum3 (=> (+ $0 (+ $1 $2))))
(sum3 10 20 30)  ; → 60
```

**Explicit parameters**:
```lisp
(let square (=> (x) (* x x)))
(square 7)  ; → 49

(let multiply (=> (x y) (* x y)))
(multiply 6 7)  ; → 42
```

**Inline usage**:
```lisp
((=> (* $0 3)) 7)  ; → 21

(map (=> (* $0 2)) [1 2 3])  ; → [2 4 6]
```

### Tail Call Optimization (TCO)

HQL automatically optimizes tail-recursive functions at compile time, preventing stack overflow for deep recursion.

**Automatic TCO** (no explicit `recur` needed):
```lisp
(fn factorial [n acc]
  (if (<= n 1)
    acc
    (factorial (- n 1) (* n acc))))

(factorial 10000 1)  ; Works! No stack overflow
```

**Explicit loop/recur** for more control (uses `[]` for bindings, Clojure-style):
```lisp
(fn factorial [n]
  (loop [n n acc 1]
    (if (<= n 1)
      acc
      (recur (- n 1) (* acc n)))))

(factorial 5)  ; → 120
```

### Higher-Order Functions

```lisp
(let numbers [1 2 3 4 5])

(map (fn [x] (* x 2)) numbers)
; → [2 4 6 8 10]

(filter (fn [x] (> x 3)) numbers)
; → [4 5]

;; Operators can be passed as first-class values
(reduce + 0 numbers)    ; → 15 (sum)
(reduce * 1 numbers)    ; → 120 (product)
(reduce && true [true true false])  ; → false
```

## Data Structures

### Arrays

```lisp
(let arr [1 2 3 4 5])
(get arr 0)      ; → 1
(first arr)      ; → 1
(rest arr)       ; → [2 3 4 5]
```

### Maps

```lisp
(let person {name: "Alice", age: 30})
(get person "name")  ; → "Alice"

(let updated (assoc person "city" "NYC"))
(keys person)        ; → ["name", "age"]
```

### Sets

```lisp
(let unique #[1 2 3 2 1])  ; → Set {1, 2, 3}
```

## Control Flow

### Conditionals

```lisp
(if (> x 10)
  (print "Large")
  (print "Small"))
```

Multi-way conditional:
```lisp
(cond
  ((< x 0) "Negative")
  ((=== x 0) "Zero")
  (else "Positive"))
```

### Pattern Matching

Match values against patterns:
```lisp
(match value
  (case 200 "OK")
  (case 404 "Not Found")
  (default "Unknown"))
```

Destructure arrays:
```lisp
(match point
  (case [x, y] (+ x y))
  (case [x, y, z] (+ x y z))
  (default 0))
```

Destructure objects (binds property values to names):
```lisp
(match user
  (case {name: n, age: a} (+ n " is " a))
  (default "Unknown"))
```

> **Note**: Object patterns support binding (`{name: n}`) but not literal value matching (`{status: 200}`). For literal matching, use guards.

Guards for conditions:
```lisp
(match n
  (case x (if (> x 0)) "positive")
  (case x (if (< x 0)) "negative")
  (default "zero"))
```

Rest patterns:
```lisp
(fn sum [lst]
  (match lst
    (case [] 0)
    (case [h, & t] (+ h (sum t)))))
```

### Loops

For loop:
```lisp
(for [i 0 10]
  (print i))
```

While loop:
```lisp
(var i 0)
(while (< i 5)
  (print i)
  (= i (+ i 1)))
```

## Macros

Define custom syntax:
```lisp
(macro when [test & body]
  `(if ~test
     (do ~@body)))

(when (> x 10)
  (print "x is large")
  (print "Processing..."))
```

### Threading Macros

Threading macros transform nested function calls into readable pipelines with **zero runtime overhead** (compile-time transformation):

**Thread-first (`->`)** - inserts value as first argument:
```lisp
(-> 5
    (+ 3)      ; → (+ 5 3) = 8
    (* 2))     ; → (* 8 2) = 16
```

**Thread-last (`->>`)** - inserts value as last argument:
```lisp
(->> [1 2 3 4 5]
     (filter (=> (> $0 2)))   ; → [3 4 5]
     (map (=> (* $0 2))))     ; → [6 8 10]
```

**Thread-as (`as->`)** - binds value to a name for arbitrary placement:
```lisp
(as-> {:name "Alice"} user
      (get user :name)           ; → "Alice"
      (str "Hello, " user))      ; → "Hello, Alice"
```

### Type Predicates

Built-in type checking macros that compile to optimal inline JavaScript:

**Null/Undefined checks**:
```lisp
(isNull x)       ; x === null
(isUndefined x)  ; x === undefined
(isNil x)        ; x == null (catches both null and undefined)
(isDefined x)    ; x !== undefined
(notNil x)       ; x != null
```

**Type checks**:
```lisp
(isString x)     ; typeof x === "string"
(isNumber x)     ; typeof x === "number"
(isBoolean x)    ; typeof x === "boolean"
(isFunction x)   ; typeof x === "function"
(isSymbol x)     ; typeof x === "symbol"
(isArray x)      ; Array.isArray(x)
(isObject x)     ; typeof x === "object" && x !== null && !Array.isArray(x)
```

### Control Flow Macros

```lisp
(when test & body)       ; if test, execute body
(unless test & body)     ; if not test, execute body
(if-let [x val] then else)  ; bind and test in one
(when-let [x val] & body)   ; bind, test, and execute

(cond
  (test1 result1)
  (test2 result2)
  (else  default))

(and a b c)   ; short-circuit AND
(or a b c)    ; short-circuit OR
```

### Utility Macros

```lisp
(inc x)          ; (+ x 1)
(dec x)          ; (- x 1)
(str a b c)      ; string concatenation
(print & args)   ; console.log
(empty? coll)    ; check if collection is empty
(nil? x)         ; check if x is null
```

## JavaScript Interop

### Importing Modules

```lisp
(import fs from "npm:fs/promises")
(import _ from "npm:lodash")
```

### Calling JavaScript

```lisp
;; Direct dot notation (recommended)
(console.log "Hello from HQL!")
(Math.floor 3.7)           ; → 3
(Math.max 10 20 30)        ; → 30
```

### Accessing Properties

```lisp
Math.PI                    ; → 3.14159...
process.env.HOME           ; → "/Users/you"
```

### Creating Objects

```lisp
(let date (new Date))
(let regex (new RegExp "\\d+"))
```

## Module System

### Exporting

```lisp
; Export single value
(export default myFunction)

; Export multiple values
(export [helper1 helper2])
```

### Importing

```lisp
; Import default export
(import utils from "./utils.hql")

; Import named exports
(import [helper1 helper2] from "./helpers.hql")

; Import from npm
(import lodash from "npm:lodash")
```

## Standard Library

See [Standard Library Reference](./api/stdlib.md) for complete documentation.

### Sequence Operations

```lisp
(first [1 2 3])           ; → 1
(rest [1 2 3])            ; → [2 3]
(take 2 [1 2 3 4])        ; → [1 2]
(drop 2 [1 2 3 4])        ; → [3 4]
```

### Transformations

```lisp
(map (fn [x] (* x 2)) [1 2 3])     ; → [2 4 6]
(filter (fn [x] (> x 2)) [1 2 3])  ; → [3]
(reduce + 0 [1 2 3 4])             ; → 10
```

### Map Operations

```lisp
(assoc {a: 1} "b" 2)      ; → {a: 1, b: 2}
(dissoc {a: 1, b: 2} "a") ; → {b: 2}
(keys {a: 1, b: 2})       ; → ["a", "b"]
```

### Composition

```lisp
(let add-then-double
  (comp (fn [x] (* x 2))
        (fn [x] (+ x 1))))

(add-then-double 5)  ; → 12
```

## CLI Reference

### Commands

```bash
hql run <file>        # Execute HQL file
hql run '<expr>'      # Evaluate expression
hql repl              # Start REPL
hql compile <file>    # Compile to JavaScript or binary
hql init              # Initialize project
hql publish           # Publish module
hql upgrade           # Update HQL to latest version
hql uninstall         # Remove HQL from system
hql lsp               # Start Language Server for IDE support
```

### Compile Options

```bash
hql compile app.hql                     # Dev build (readable output)
hql compile app.hql --release           # Production build (minified)
hql compile app.hql --release --no-sourcemap  # Smallest output
hql compile app.hql --target native     # Compile to native binary
hql compile app.hql --target all        # Compile for all platforms
hql compile app.hql -o myapp.js         # Custom output path
```

Build modes:
- **Default (dev)**: Readable output, inline source maps, no minification
- **--release**: Minified output, inline source maps, tree-shaken

### Global Options

```bash
--help               # Show help
--version            # Show version
--verbose            # Detailed logging
--debug              # Debug information
--time               # Show timing
```

## Further Reading

- [Language Features](./features/) - Detailed feature documentation
- [API Reference](./api/) - Complete API documentation
- [Standard Library](./api/stdlib.md) - Built-in functions
- [LSP & Editor Support](./LSP.md) - Language Server Protocol for IDEs
- [Examples](./features/) - Code examples
