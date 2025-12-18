# HQL Language Syntax Reference

**Version:** 1.0 | **For:** LSP Development & AI Agents | **Status:** Official

This document is the **definitive syntax reference** for HQL (Homoiconic Query Language), a Lisp dialect that transpiles to JavaScript via TypeScript.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Compilation Pipeline](#2-compilation-pipeline)
3. [Lexical Elements](#3-lexical-elements)
4. [Data Types & Literals](#4-data-types--literals)
5. [Bindings](#5-bindings)
6. [Functions](#6-functions)
7. [Type Annotations](#7-type-annotations)
8. [Classes](#8-classes)
9. [Control Flow](#9-control-flow)
10. [Loops](#10-loops)
11. [Pattern Matching](#11-pattern-matching)
12. [Enums](#12-enums)
13. [Import/Export](#13-importexport)
14. [JavaScript Interop](#14-javascript-interop)
15. [Macros](#15-macros)
16. [Operators](#16-operators)
17. [Complete Syntax Reference Table](#17-complete-syntax-reference-table)

---

## 1. Overview

### What is HQL?

HQL is a **homoiconic Lisp dialect** that compiles to JavaScript. It features:

- **S-expression syntax** - Code as data (Lisp-style)
- **TypeScript integration** - Optional type annotations
- **JS interoperability** - Seamless JavaScript/TypeScript access
- **Functional + OOP** - Both paradigms supported
- **Macro system** - Compile-time code transformation

### Design Philosophy

```
┌─────────────────────────────────────────────────────────────────┐
│                         HQL DESIGN                               │
├─────────────────────────────────────────────────────────────────┤
│  ✓ Lisp power         - Macros, homoiconicity, simplicity       │
│  ✓ JavaScript target  - Runs anywhere JS runs                   │
│  ✓ TypeScript types   - Optional static typing                  │
│  ✓ Modern features    - Async/await, classes, destructuring     │
│  ✓ Clojure-inspired   - Familiar to Clojure developers          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Compilation Pipeline

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        HQL COMPILATION PIPELINE                           │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│   .hql Source File                                                        │
│         │                                                                 │
│         ▼                                                                 │
│   ┌─────────────────┐                                                     │
│   │  Lexer/Parser   │  Tokenize → Parse → S-expressions (SExp)           │
│   └────────┬────────┘                                                     │
│            │                                                              │
│            ▼                                                              │
│   ┌─────────────────┐                                                     │
│   │ Macro Expansion │  Expand macros at compile time                     │
│   └────────┬────────┘                                                     │
│            │                                                              │
│            ▼                                                              │
│   ┌─────────────────┐                                                     │
│   │ Syntax Transform│  SExp → HQL IR (intermediate representation)       │
│   └────────┬────────┘                                                     │
│            │                                                              │
│            ▼                                                              │
│   ┌─────────────────┐                                                     │
│   │  IR → TypeScript│  HQL IR → TypeScript source code                   │
│   └────────┬────────┘                                                     │
│            │                                                              │
│            ▼                                                              │
│   ┌─────────────────┐                                                     │
│   │   tsc Compiler  │  TypeScript → JavaScript (type checking)           │
│   └────────┬────────┘                                                     │
│            │                                                              │
│            ▼                                                              │
│      .js Output                                                           │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

### S-Expression Types

```typescript
// Core S-expression types (from src/s-exp/types.ts)
type SExp = SSymbol | SList | SLiteral;

interface SSymbol { type: "symbol"; name: string; }
interface SList   { type: "list"; elements: SExp[]; }
interface SLiteral { type: "literal"; value: string | number | boolean | null; }
```

---

## 3. Lexical Elements

### 3.1 Comments

```lisp
; Single-line comment (semicolon to end of line)

;; Documentation comment (double semicolon convention)
```

### 3.2 Identifiers

```lisp
; Valid identifiers
foo
my-function       ; Kebab-case (preferred for functions)
myVariable        ; camelCase (valid)
MyClass           ; PascalCase (for classes)
foo?              ; Predicate (ends with ?)
foo!              ; Mutating (ends with !)
*global*          ; Earmuffs (dynamic vars)
_private          ; Underscore prefix
__internal__      ; Double underscore

; Special identifiers
nil               ; null value
true              ; boolean true
false             ; boolean false
this              ; current instance (in classes)
```

### 3.3 Reserved Symbols

```
fn       ; Function definition
let      ; Immutable binding
var      ; Mutable binding
if       ; Conditional
cond     ; Multi-branch conditional
when     ; Single-branch when true
unless   ; Single-branch when false
do       ; Block expression
loop     ; Loop with recur
recur    ; Tail-call in loop
for      ; For loop
while    ; While loop
dotimes  ; Repeat n times
class    ; Class definition
enum     ; Enum definition
import   ; Import module
export   ; Export binding
macro    ; Macro definition
return   ; Early return
throw    ; Throw exception
try      ; Try/catch/finally
catch    ; Catch clause
finally  ; Finally clause
new      ; Object instantiation
await    ; Await promise
async    ; Async function
match    ; Pattern matching
=>       ; Arrow lambda
&        ; Rest parameter marker
_        ; Placeholder/skip pattern
```

---

## 4. Data Types & Literals

### 4.1 Primitives

```lisp
; Numbers
42                ; Integer
3.14159           ; Float
-17               ; Negative
1e10              ; Scientific notation

; Strings
"hello"           ; Double-quoted string
"line1\nline2"    ; Escape sequences: \n \t \\ \"
`template ${x}`   ; Template literal (backticks)

; Booleans
true
false

; Null
nil               ; Represents null/undefined
```

### 4.2 Collections

```lisp
; Vector (Array)
[1 2 3]           ; Lisp style (no commas)
[1, 2, 3]         ; JSON style (with commas)
[]                ; Empty vector

; Hash-map (Object)
{name: "Alice" age: 30}           ; Lisp style (unquoted keys)
{"name": "Alice", "age": 30}      ; JSON style (quoted keys)
{}                                 ; Empty map

; Nested structures
{
  user: {
    name: "Bob"
    tags: ["admin" "user"]
  }
}
```

### 4.3 Collection Access

```lisp
; Get element by index
(get arr 0)           ; arr[0]
(get arr 0 "default") ; arr[0] or "default" if nil

; Get property
(get obj "name")      ; obj["name"] or obj.name
obj.name              ; Dot notation (shorthand)

; First/rest (list functions)
(first [1 2 3])       ; → 1
(rest [1 2 3])        ; → [2 3]
(nth [1 2 3] 1)       ; → 2
```

---

## 5. Bindings

### 5.1 Immutable Binding (`let`)

```lisp
; Simple binding (compiles to const + Object.freeze for reference types)
(let x 10)
(let name "Alice")

; With expression
(let sum (+ 1 2 3))

; Multiple bindings with body
(let (x 10 y 20 z 30)
  (+ x y z))          ; → 60

; Object/array bindings are deep-frozen
(let data [1 2 3])    ; Cannot mutate
(let obj {a: 1})      ; Cannot mutate
```

### 5.2 Mutable Binding (`var`)

```lisp
; Simple mutable binding (compiles to let)
(var count 0)
(var items [])

; Multiple bindings with body
(var (x 10 y 20)
  (= x 100)
  (+ x y))            ; → 120
```

### 5.3 Assignment (`=`)

```lisp
; Update variable
(= count 10)

; Update property
(= obj.name "Bob")
(= arr[0] 100)

; Compound (not directly supported, use explicit form)
(= count (+ count 1))
```

### 5.4 Destructuring

```lisp
; Array destructuring
(let [a b c] [1 2 3])
a                     ; → 1
b                     ; → 2

; With rest
(let [first & rest] [1 2 3 4])
first                 ; → 1
rest                  ; → [2 3 4]

; Skip elements
(let [a _ c] [1 2 3])
a                     ; → 1 (skipped 2)
c                     ; → 3

; Object destructuring
(let {name age} person)
name                  ; → person.name
age                   ; → person.age

; With defaults
(let [x (= 10)] [])   ; x = 10 if undefined
```

---

## 6. Functions

### 6.1 Named Functions (`fn`)

**Two parameter styles - no exceptions:**

```lisp
; STYLE 1: Positional parameters [brackets]
(fn add [x y]
  (+ x y))

; STYLE 2: Map parameters {braces} - ALL must have defaults
(fn connect {host: "localhost" port: 8080}
  (+ host ":" port))
```

#### Positional Parameters

```lisp
; No parameters
(fn get-value []
  42)

; Single parameter
(fn double [x]
  (* x 2))

; Multiple parameters
(fn add [a b c]
  (+ a b c))

; Rest parameters (variadic)
(fn sum [first & rest]
  (reduce + first rest))

; Destructuring parameters
(fn process [[a b] c]
  (+ a b c))
```

#### Map Parameters (Config-style)

```lisp
; All parameters must have defaults
(fn configure {name: "app" version: "1.0" debug: false}
  (print name version debug))

; Calling map functions
(configure)                        ; All defaults
(configure {name: "myapp"})        ; Override one
(configure {debug: true})          ; Override another

; JSON style also works
(configure {"name": "myapp", "debug": true})
```

> **Note:** Map parameters generate JavaScript object destructuring with defaults.
> The transpiler API generates correct code, but there may be runtime edge cases
> in the CLI pipeline. Use positional parameters `[x y]` for critical code paths.

### 6.2 Anonymous Functions

```lisp
; With positional params
(fn [x] (* x x))

; With map params
(fn {x: 0 y: 0} (+ x y))

; As argument
(map (fn [x] (* x 2)) [1 2 3])
```

### 6.3 Arrow Lambda (`=>`)

```lisp
; Implicit parameters ($0, $1, $2...)
(=> (* $0 2))              ; Single param
(=> (+ $0 $1))             ; Two params
(=> (+ $0 $1 $2))          ; Three params

; Property access
(=> $0.name)               ; Get name property
(=> $0.user.email)         ; Nested access

; Explicit parameters
(=> [x] (* x x))
(=> [x y] (+ x y))
(=> [] 42)                 ; Zero params

; Use cases
(map (=> (* $0 2)) [1 2 3])         ; → [2 4 6]
(filter (=> (> $0 5)) [3 7 2 9])    ; → [7 9]
(reduce (=> (+ $0 $1)) 0 [1 2 3])   ; → 6
```

### 6.4 Async Functions

```lisp
; Async named function
(async fn fetch-data [url]
  (let response (await (js/fetch url)))
  (await (.json response)))

; Async with map params
(async fn fetch-with-options {url: "" timeout: 5000}
  (await (js/fetch url)))

; Async anonymous
(let fetcher (async fn [url] (await (js/fetch url))))
```

### 6.5 Return Statements

```lisp
; Implicit return (last expression)
(fn double [x]
  (* x 2))                 ; Returns (* x 2)

; Explicit return
(fn double [x]
  (return (* x 2)))

; Early return
(fn safe-divide [a b]
  (if (=== b 0)
    (return 0))            ; Early exit
  (/ a b))
```

---

## 7. Type Annotations

HQL supports **optional TypeScript-style type annotations** that are preserved through the IR and emitted in the generated TypeScript.

### CRITICAL: No Space After Colon

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️  TYPE ANNOTATION SPACING RULE                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ✓ CORRECT:   [a:number b:string]     (NO space after colon)       │
│  ✗ WRONG:     [a: number b: string]   (space breaks parsing!)      │
│                                                                     │
│  The S-expression parser uses whitespace as a delimiter.            │
│  With "a: number", the space creates TWO separate tokens:           │
│    - "a:" (symbol with trailing colon)                              │
│    - "number" (treated as separate parameter!)                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.1 Parameter Type Annotations

```lisp
; Syntax: paramName:Type (NO SPACE after colon!)
(fn add [a:number b:number]
  (+ a b))

; With complex types
(fn process [items:string[] callback:Function]
  (map callback items))

; Union types (no spaces around |)
(fn handle [value:string|number]
  (print value))

; Generic types
(fn identity [x:T]
  x)

; Mixed typed and untyped
(fn greet [name:string age]
  (print name age))
```

### 7.2 Return Type Annotations

```lisp
; Syntax: (fn name [params] :ReturnType body)
; Note: Return type uses : prefix, also NO space
(fn add [a:number b:number] :number
  (+ a b))

; Complex return types
(fn get-users [] :User[]
  users)

; Promise return types
(async fn fetch [url:string] :Promise<Response>
  (await (js/fetch url)))

; Union return types
(fn parse [input:string] :number|nil
  (js/parseInt input))
```

### 7.3 Class Field Type Annotations

```lisp
(class User
  (let name:string "")
  (var age:number 0)

  (constructor [name:string age:number]
    (do
      (= this.name name)
      (= this.age age))))
```

**Note:** Class method return types are not yet implemented in the compiler.

### 7.4 Variable Type Annotations

```lisp
; IR supports typeAnnotation on identifiers
(let count:number 0)
(var items:string[] [])
```

### 7.5 Type Annotation Summary

```
┌────────────────────────────────────────────────────────────────────┐
│                    TYPE ANNOTATION SYNTAX                          │
├────────────────────────────────────────────────────────────────────┤
│  ⚠️  NO SPACE after colon - this is CRITICAL!                      │
├────────────────────────────────────────────────────────────────────┤
│  Parameter:    [paramName:Type]        (e.g., [x:number])          │
│  Return:       (fn name [p] :Type body) (e.g., :number)            │
│  Class Field:  (let name:Type val)     (e.g., (let x:number 0))    │
│  Generic:      [T, U] (in typeParameters)                          │
├────────────────────────────────────────────────────────────────────┤
│  SUPPORTED TYPES:                                                  │
│  - Primitives: number, string, boolean, null, undefined, void      │
│  - Arrays: Type[], Array<Type>                                     │
│  - Objects: {key:Type}, Record<K,V>                                │
│  - Union: Type1|Type2 (no spaces)                                  │
│  - Intersection: Type1&Type2                                       │
│  - Generic: T, T extends Base                                      │
│  - Function: (x:T)=>R                                              │
│  - Promise: Promise<T>                                             │
│  - Any: any, unknown                                               │
└────────────────────────────────────────────────────────────────────┘
```

---

## 8. Classes

### 8.1 Basic Class

```lisp
; Empty class
(class MyClass)

; With constructor
(class Person
  (constructor [name age]
    (do
      (= this.name name)
      (= this.age age))))

; Instantiation
(var p (new Person "Alice" 30))
p.name                ; → "Alice"
```

### 8.2 Fields

```lisp
(class Counter
  ; Mutable field (var)
  (var count 0)

  ; Immutable field (let)
  (let maxCount 100)

  (constructor [initial]
    (= this.count initial)))
```

### 8.3 Methods

```lisp
(class Calculator
  (constructor []
    (= this.value 0))

  ; Method without params
  (fn getValue []
    this.value)

  ; Method with params
  (fn add [x y]
    (+ x y))

  ; Method with map params
  (fn configure {precision: 2 rounding: "half"}
    (do
      (= this.precision precision)
      (= this.rounding rounding)))

  ; Method calling other method
  (fn doubleValue []
    (this.add this.value this.value)))
```

### 8.4 Complete Class Example

```lisp
(class BankAccount
  (let bankName "MyBank")       ; Constant
  (var balance 0)               ; Mutable state

  (constructor [accountNumber initialBalance]
    (do
      (= this.accountNumber accountNumber)
      (= this.balance initialBalance)))

  (fn deposit [amount]
    (do
      (= this.balance (+ this.balance amount))
      this.balance))

  (fn withdraw [amount]
    (if (< this.balance amount)
      (return nil))
    (do
      (= this.balance (- this.balance amount))
      this.balance))

  (fn getBalance []
    this.balance))

; Usage
(var account (new BankAccount "ACC123" 1000))
(account.deposit 500)    ; → 1500
(account.withdraw 200)   ; → 1300
```

---

## 9. Control Flow

### 9.1 If Expression

```lisp
; Basic if (always returns value)
(if condition
  then-expr
  else-expr)

; Examples
(if (> x 0)
  "positive"
  "non-positive")

; Nested if
(if (> x 0)
  "positive"
  (if (< x 0)
    "negative"
    "zero"))
```

### 9.2 Cond Expression

```lisp
; Multi-branch conditional
(cond
  (condition1 result1)
  (condition2 result2)
  (else default-result))

; Example
(cond
  ((< x 0) "negative")
  ((=== x 0) "zero")
  ((> x 0) "positive")
  (else "unknown"))
```

### 9.3 When/Unless

```lisp
; When - execute if true
(when (> x 0)
  (print "positive")
  x)

; Unless - execute if false
(unless (=== x 0)
  (/ 100 x))
```

### 9.4 Do Block

```lisp
; Sequential expressions, returns last
(do
  (print "step 1")
  (print "step 2")
  (+ 1 2))           ; → 3
```

### 9.5 And/Or

```lisp
; Logical and (short-circuit)
(and a b c)          ; Returns first falsy or last value

; Logical or (short-circuit)
(or a b c)           ; Returns first truthy or last value

; Examples
(and true true)      ; → true
(and true false)     ; → false
(or false true)      ; → true
(or nil "default")   ; → "default"
```

---

## 10. Loops

### 10.1 Loop/Recur (Tail-Call Optimization)

```lisp
; Basic syntax
(loop [binding init-value ...]
  body
  (recur new-value ...))

; Sum 0 to 4
(loop [i 0 sum 0]
  (if (< i 5)
    (recur (+ i 1) (+ sum i))
    sum))             ; → 10

; Factorial
(loop [n 5 acc 1]
  (if (<= n 1)
    acc
    (recur (- n 1) (* acc n))))  ; → 120

; Fibonacci
(loop [n 7 a 0 b 1]
  (if (=== n 0)
    a
    (recur (- n 1) b (+ a b))))  ; → 13
```

### 10.2 For Loop

```lisp
; Single arg: 0 to n-1
(for [i 3]
  (print i))          ; 0, 1, 2

; Two args: start to end-1
(for [i 5 8]
  (print i))          ; 5, 6, 7

; Three args: start to end-1 by step
(for [i 0 10 2]
  (print i))          ; 0, 2, 4, 6, 8

; Named syntax
(for [i to: 3] ...)
(for [i from: 5 to: 8] ...)
(for [i from: 0 to: 10 by: 2] ...)

; Collection iteration
(for [x [1 2 3]]
  (print (* x 2)))    ; 2, 4, 6
```

### 10.3 While Loop

```lisp
(while condition
  body...)

; Example
(var count 0)
(while (< count 5)
  (print count)
  (= count (+ count 1)))
```

### 10.4 Dotimes (Repeat)

```lisp
; Execute n times
(dotimes 5
  (print "hello"))

; With side effects
(var result [])
(dotimes 3
  (.push result "item"))
result                ; → ["item" "item" "item"]
```

---

## 11. Pattern Matching

### 11.1 Match Expression

```lisp
(match value
  pattern1 result1
  pattern2 result2
  _ default-result)

; Literal matching
(match x
  1 "one"
  2 "two"
  _ "other")

; With guards
(match point
  [0 0] "origin"
  [x 0] "on x-axis"
  [0 y] "on y-axis"
  [x y] "somewhere")
```

---

## 12. Enums

### 12.1 Simple Enum

```lisp
(enum Direction
  (case north)
  (case south)
  (case east)
  (case west))

; Access - returns auto-incrementing numbers (TypeScript-style)
Direction.north       ; → 0
Direction.south       ; → 1
Direction.east        ; → 2
Direction.west        ; → 3
```

### 12.2 Enum with Raw Values

```lisp
(enum HttpStatus
  (case ok 200)
  (case notFound 404)
  (case serverError 500))

HttpStatus.notFound   ; → 404
```

### 12.3 Enum with Associated Values

```lisp
(enum Payment
  (case cash amount)
  (case creditCard number expiry))

; Create instance
(var payment (Payment.cash 100))

; Check type
(payment.is "cash")   ; → true

; Access values
(get payment.values "amount")  ; → 100
```

---

## 13. Import/Export

### 13.1 Import

```lisp
; Named imports
(import [foo bar] from "module.hql")

; Namespace import
(import utils from "utils.hql")

; With alias
(import [foo :as myFoo] from "module.hql")

; JavaScript module
(import [readFile] from "node:fs")
```

### 13.2 Export

```lisp
; Export definition
(export (fn add [a b] (+ a b)))

; Export existing
(export my-function)

; Export default
(export-default my-value)

; Named export
(export [foo bar])
```

---

## 14. JavaScript Interop

### 14.1 JS Global Access

```lisp
; Access global objects
js/console            ; console
js/Math               ; Math
js/Date               ; Date
js/JSON               ; JSON
js/window             ; window (browser)
js/process            ; process (Node.js)

; Call global methods
(js/console.log "hello")
(js/Math.floor 3.7)
(js/JSON.stringify obj)
```

### 14.2 Method Calls

```lisp
; Dot notation for methods
(.toLowerCase str)    ; str.toLowerCase()
(.push arr item)      ; arr.push(item)
(.map arr callback)   ; arr.map(callback)

; Property access
obj.property          ; obj.property
obj.nested.prop       ; obj.nested.prop

; Dynamic property
(get obj "key")       ; obj["key"]
```

### 14.3 Object Construction

```lisp
; New instance
(new Date)
(new Date 2024 0 1)
(new Map)
(new Set [1 2 3])
(new Promise (fn [resolve reject] ...))
```

### 14.4 Await/Async

```lisp
; Await expression
(await promise)

; In async function
(async fn fetch-data []
  (let response (await (js/fetch "/api")))
  (await (.json response)))
```

---

## 15. Macros

### 15.1 Macro Definition

```lisp
(macro my-macro [args...]
  ; Transform code at compile time
  body...)

; Example: unless macro
(macro unless [condition & body]
  `(if (not ~condition)
    (do ~@body)))
```

### 15.2 Quoting

```lisp
; Quote - prevent evaluation
'(1 2 3)              ; List literal
'symbol               ; Symbol literal

; Syntax quote (quasi-quote)
`(a b c)

; Unquote - evaluate inside syntax quote
`(1 2 ~x)             ; x is evaluated

; Unquote-splicing - splice collection
`(1 2 ~@rest)         ; rest elements spliced in
```

---

## 16. Operators

### 16.1 Arithmetic

```lisp
(+ a b)               ; Addition
(- a b)               ; Subtraction
(* a b)               ; Multiplication
(/ a b)               ; Division
(% a b)               ; Modulo (remainder)
(** a b)              ; Exponentiation
```

### 16.2 Comparison

```lisp
; IMPORTANT: = is for ASSIGNMENT, not comparison!
; Use == or === for equality checks

(== a b)              ; Loose equality (uses JS ==)
(=== a b)             ; Strict equality (uses JS ===) - PREFERRED
(!= a b)              ; Loose inequality (uses JS !=)
(!== a b)             ; Strict inequality (uses JS !==)
(< a b)               ; Less than
(> a b)               ; Greater than
(<= a b)              ; Less or equal
(>= a b)              ; Greater or equal
```

### 16.3 Logical

```lisp
(and a b)             ; Logical AND
(or a b)              ; Logical OR
(not a)               ; Logical NOT
```

### 16.4 Bitwise

```lisp
; Uses JavaScript operator symbols (not Clojure-style names)
(& a b)               ; Bitwise AND
(| a b)               ; Bitwise OR
(^ a b)               ; Bitwise XOR
(~ a)                 ; Bitwise NOT (unary)
(<< a n)              ; Left shift
(>> a n)              ; Signed right shift
(>>> a n)             ; Unsigned right shift
```

---

## 17. Complete Syntax Reference Table

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         HQL SYNTAX QUICK REFERENCE                          │
├────────────────────────────────────────────────────────────────────────────┤
│ CATEGORY        │ SYNTAX                           │ EXAMPLE               │
├─────────────────┼──────────────────────────────────┼───────────────────────┤
│ BINDINGS        │                                  │                       │
│ Immutable       │ (let name value)                 │ (let x 10)            │
│ Mutable         │ (var name value)                 │ (var count 0)         │
│ Assignment      │ (= target value)                 │ (= x 20)              │
│ Destructure     │ (let [a b] arr)                  │ (let [x y] [1 2])     │
├─────────────────┼──────────────────────────────────┼───────────────────────┤
│ FUNCTIONS       │                                  │                       │
│ Named (pos)     │ (fn name [params] body)          │ (fn add [a b] (+ a b))│
│ Named (map)     │ (fn name {k: v} body)            │ (fn cfg {x: 0} x)     │
│ Anonymous       │ (fn [params] body)               │ (fn [x] (* x 2))      │
│ Arrow           │ (=> body) / (=> [p] body)        │ (=> (* $0 2))         │
│ Async           │ (async fn name [p] body)         │ (async fn f [] ...)   │
│ Return          │ (return value)                   │ (return 42)           │
├─────────────────┼──────────────────────────────────┼───────────────────────┤
│ TYPE ANNOT.     │ ⚠️ NO SPACE after colon!         │                       │
│ Parameter       │ [name:Type]                      │ [x:number]            │
│ Return          │ (fn n [p] :Type body)            │ (fn f [] :number 42)  │
│ Field           │ (let name:Type val)              │ (let x:number 0)      │
├─────────────────┼──────────────────────────────────┼───────────────────────┤
│ CLASSES         │                                  │                       │
│ Definition      │ (class Name ...)                 │ (class Person ...)    │
│ Constructor     │ (constructor [p] body)           │ (constructor [n] ...) │
│ Method          │ (fn name [p] body)               │ (fn greet [] ...)     │
│ Field (mut)     │ (var name value)                 │ (var count 0)         │
│ Field (imm)     │ (let name value)                 │ (let MAX 100)         │
│ Instantiate     │ (new Class args)                 │ (new Person "Bob")    │
├─────────────────┼──────────────────────────────────┼───────────────────────┤
│ CONTROL FLOW    │                                  │                       │
│ If              │ (if cond then else)              │ (if (> x 0) "+" "-")  │
│ Cond            │ (cond (c1 r1) (c2 r2) ...)       │ (cond ((< x 0) ..))   │
│ When            │ (when cond body)                 │ (when ok (process))   │
│ Unless          │ (unless cond body)               │ (unless err (run))    │
│ Do              │ (do expr1 expr2 ...)             │ (do (a) (b) (c))      │
├─────────────────┼──────────────────────────────────┼───────────────────────┤
│ LOOPS           │                                  │                       │
│ Loop/Recur      │ (loop [b v] body (recur v'))     │ (loop [i 0] ...)      │
│ For (range)     │ (for [i n] body)                 │ (for [i 10] ...)      │
│ For (coll)      │ (for [x coll] body)              │ (for [x arr] ...)     │
│ While           │ (while cond body)                │ (while (< i 10) ...)  │
│ Dotimes         │ (dotimes n body)                 │ (dotimes 5 ...)       │
├─────────────────┼──────────────────────────────────┼───────────────────────┤
│ DATA            │                                  │                       │
│ Vector          │ [a b c]                          │ [1 2 3]               │
│ Hash-map        │ {k: v}                           │ {name: "Alice"}       │
│ Get             │ (get coll key)                   │ (get arr 0)           │
│ First/Rest      │ (first coll) (rest coll)         │ (first [1 2 3])       │
├─────────────────┼──────────────────────────────────┼───────────────────────┤
│ ENUM            │                                  │                       │
│ Simple          │ (enum N (case c1) (case c2))     │ (enum Dir (case n))   │
│ Raw value       │ (enum N (case c1 val))           │ (case ok 200)         │
│ Associated      │ (enum N (case c1 fields))        │ (case cash amount)    │
├─────────────────┼──────────────────────────────────┼───────────────────────┤
│ IMPORT/EXPORT   │                                  │                       │
│ Import          │ (import [a b] from "mod")        │ (import [x] from "m") │
│ Namespace       │ (import ns from "mod")           │ (import u from "u")   │
│ Export          │ (export expr)                    │ (export my-fn)        │
├─────────────────┼──────────────────────────────────┼───────────────────────┤
│ JS INTEROP      │                                  │                       │
│ Global          │ js/name                          │ js/Math               │
│ Method call     │ (.method obj args)               │ (.push arr x)         │
│ Property        │ obj.prop                         │ user.name             │
│ New             │ (new Class args)                 │ (new Date)            │
│ Await           │ (await promise)                  │ (await (fetch url))   │
├─────────────────┼──────────────────────────────────┼───────────────────────┤
│ ERROR HANDLING  │                                  │                       │
│ Try             │ (try body (catch e h) (finally)) │ (try ... (catch e))   │
│ Throw           │ (throw expr)                     │ (throw (new Error))   │
├─────────────────┼──────────────────────────────────┼───────────────────────┤
│ MACROS          │                                  │                       │
│ Define          │ (macro name [args] body)         │ (macro unless ...)    │
│ Quote           │ 'expr                            │ '(1 2 3)              │
│ Syntax quote    │ `expr                            │ `(a ~b ~@c)           │
│ Unquote         │ ~expr                            │ ~x                    │
│ Splice          │ ~@expr                           │ ~@rest                │
├─────────────────┼──────────────────────────────────┼───────────────────────┤
│ OPERATORS       │                                  │                       │
│ Arithmetic      │ (+ - * / % **)                   │ (+ 1 2), (% 10 3)     │
│ Comparison      │ (== === != !== < > <= >=)        │ (=== a b), (< x 5)    │
│ Logical         │ (and or not)                     │ (and a b), (not x)    │
│ Bitwise         │ (& | ^ ~ << >> >>>)              │ (& 5 3), (<< 1 4)     │
│ IMPORTANT       │ = is ASSIGNMENT, not equality!   │ (= x 10) assigns      │
└─────────────────┴──────────────────────────────────┴───────────────────────┘
```

---

## IR Type Summary (for LSP Development)

The HQL IR (Intermediate Representation) has the following key type annotation fields:

```typescript
// From src/transpiler/type/hql_ir.ts

interface IRIdentifier {
  type: IRNodeType.Identifier;
  name: string;
  typeAnnotation?: string;  // e.g., "number", "string[]"
}

interface IRFunctionExpression {
  params: (IRIdentifier | IRArrayPattern | IRObjectPattern)[];
  returnType?: string;        // e.g., "number", "Promise<T>"
  typeParameters?: string[];  // e.g., ["T", "U extends string"]
}

interface IRFnFunctionDeclaration {
  returnType?: string;
  typeParameters?: string[];
}

interface IRClassField {
  name: string;
  mutable: boolean;
  typeAnnotation?: string;
}

interface IRClassMethod {
  returnType?: string;
  typeParameters?: string[];
}

interface IRVariableDeclarator {
  typeAnnotation?: string;
}
```

---

## Internal Identifiers (SSOT Constants)

HQL uses these internal identifiers (from `src/common/runtime-helper-impl.ts`):

```typescript
// Data structure markers
VECTOR_SYMBOL = "vector"
EMPTY_ARRAY_SYMBOL = "empty-array"
HASH_MAP_USER = "hash-map"
HASH_MAP_INTERNAL = "__hql_hash_map"

// Runtime helpers
RETURN_VALUE_VAR = "__hql_ret__"
EARLY_RETURN_FLAG = "__hql_early_return__"
GET_HELPER = "__hql_get"
GET_NUMERIC_HELPER = "__hql_getNumeric"
RANGE_HELPER = "__hql_range"
LAZY_SEQ_HELPER = "__hql_lazy_seq"
FOR_EACH_HELPER = "__hql_for_each"
TO_SEQUENCE_HELPER = "__hql_toSequence"
THROW_HELPER = "__hql_throw"
DEEP_FREEZE_HELPER = "__hql_deepFreeze"
MATCH_OBJ_HELPER = "__hql_match_obj"
GET_OP_HELPER = "__hql_get_op"
```

---

## File Extensions

- `.hql` - HQL source files
- `.ts` - Generated TypeScript (intermediate)
- `.js` - Final JavaScript output

---

*This document is the authoritative reference for HQL syntax. For implementation details, see the source code in `src/transpiler/`.*
