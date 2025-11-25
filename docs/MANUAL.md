# HQL Language Manual

## Table of Contents

- [Installation](#installation)
- [Getting Started](#getting-started)
- [Language Basics](#language-basics)
- [Functions](#functions)
- [Data Structures](#data-structures)
- [Control Flow](#control-flow)
- [Macros](#macros)
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
# HQL CLI version 0.1.0
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
(set! counter (+ counter 1))
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

### Higher-Order Functions

```lisp
(let numbers [1 2 3 4 5])

(map (fn [x] (* x 2)) numbers)
; → [2 4 6 8 10]

(filter (fn [x] (> x 3)) numbers)
; → [4 5]

(reduce + 0 numbers)
; → 15
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
(let person {:name "Alice" :age 30})
(get person :name)  ; → "Alice"

(let updated (assoc person :city "NYC"))
(keys person)       ; → [:name :age]
(vals person)       ; → ["Alice" 30]
```

### Sets

```lisp
(let unique #{1 2 3 2 1})  ; → #{1 2 3}
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
  [(< x 0) "Negative"]
  [(= x 0) "Zero"]
  [else    "Positive"])
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
  (set! i (+ i 1)))
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

## JavaScript Interop

### Importing Modules

```lisp
(import fs from "npm:fs/promises")
(import _ from "npm:lodash")
```

### Calling JavaScript

```lisp
(js-call console.log "Hello from HQL!")
(js-call Math.floor 3.7)  ; → 3
```

### Accessing Properties

```lisp
(js-get Math.PI)           ; → 3.14159...
(js-get process.env.HOME)  ; → "/Users/you"
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

See [Standard Library Reference](../doc/api/stdlib.md) for complete documentation.

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
(assoc {:a 1} :b 2)       ; → {:a 1 :b 2}
(dissoc {:a 1 :b 2} :a)   ; → {:b 2}
(keys {:a 1 :b 2})        ; → [:a :b]
(vals {:a 1 :b 2})        ; → [1 2]
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
hql transpile <file>  # Transpile to JavaScript
hql init              # Initialize project
hql publish           # Publish module
```

### Options

```bash
--help               # Show help
--version            # Show version
--verbose            # Detailed logging
--debug              # Debug information
--time               # Show timing
```

## Further Reading

- [Language Features](../doc/features/) - Detailed feature documentation
- [API Reference](../doc/api/) - Complete API documentation
- [Standard Library](../doc/api/stdlib.md) - Built-in functions
- [Examples](../doc/features/) - Code examples
