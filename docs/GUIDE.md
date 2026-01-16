# HQL Learning Guide

Complete guide from beginner to advanced.

## Prerequisites

You should know:
- Basic programming concepts
- JavaScript basics (helpful but not required)

## Installation

Install HLVM:

```bash
curl -fsSL https://raw.githubusercontent.com/hlvm-dev/hlvm/main/install.sh | sh
```

Verify:

```bash
hlvm --version
```

## Level 1: Basics (30 minutes)

### Lesson 1: Hello World

Create `hello.hql`:

```lisp
(print "Hello, World!")
```

Run:

```bash
hlvm run hello.hql
```

Output:
```
Hello, World!
```

### Lesson 2: Variables

```lisp
; Block-scoped mutable (like JS let)
(let x 10)
(let name "Alice")

(print x)      ; → 10
(print name)   ; → Alice

; Function-scoped mutable (like JS var)
(var counter 0)
(= counter 100)
(print counter)  ; → 100

; Immutable (like JS const)
(const PI 3.14159)
(print PI)     ; → 3.14159
```

### Lesson 3: Basic Math

```lisp
(+ 1 2 3)           ; → 6
(- 10 3)            ; → 7
(* 2 3 4)           ; → 24
(/ 10 2)            ; → 5
(% 10 3)            ; → 1
```

### Lesson 4: Comments

```lisp
; This is a single line comment

;; Multiple semicolons are conventional
;; for multi-line comments

(+ 1 2)  ; inline comment
```

### Practice Problems

1. Print your name
2. Create variables for age and city
3. Calculate: (5 + 3) × 2

## Level 2: Functions (45 minutes)

### Lesson 5: Defining Functions

Simple function:

```lisp
(fn greet [name]
  (print "Hello," name))

(greet "World")
; → Hello, World
```

Return values:

```lisp
(fn add [a b]
  (+ a b))

(let result (add 5 3))
(print result)  ; → 8
```

### Lesson 6: Default Parameters

```lisp
(fn greet [name = "World"]
  (print "Hello," name))

(greet)          ; → Hello, World
(greet "Alice")  ; → Hello, Alice
```

### Lesson 7: Multiple Parameters

```lisp
(fn calculate [a b op]
  (cond
    ((=== op "add") (+ a b))
    ((=== op "sub") (- a b))
    ((=== op "mul") (* a b))
    (else "Unknown")))

(calculate 10 5 "add")  ; → 15
(calculate 10 5 "mul")  ; → 50
```

### Practice Problems

1. Write `square` function
2. Write `max` function (returns larger of two numbers)
3. Write `greet-person` with name and age parameters

## Level 3: Data Structures (45 minutes)

### Lesson 8: Arrays

```lisp
(let numbers [1 2 3 4 5])

(get numbers 0)      ; → 1
(first numbers)      ; → 1
(rest numbers)       ; → [2 3 4 5]
```

### Lesson 9: Maps

```lisp
(let person {name: "Alice", age: 30, city: "NYC"})

(get person "name")  ; → "Alice"
(get person "age")   ; → 30
```

Updating maps:

```lisp
(let updated (assoc person "job" "Engineer"))
; → {name: "Alice", age: 30, city: "NYC", job: "Engineer"}

(let removed (dissoc person "city"))
; → {name: "Alice", age: 30}
```

### Lesson 10: Working with Collections

Map (transform):

```lisp
(let numbers [1 2 3 4 5])
(let doubled (map (fn [x] (* x 2)) numbers))
(print doubled)  ; → [2 4 6 8 10]
```

Filter:

```lisp
(let evens (filter (fn [x] (=== (% x 2) 0)) numbers))
(print evens)  ; → [2 4]
```

Reduce (aggregate):

```lisp
(let sum (reduce + 0 numbers))
(print sum)  ; → 15
```

### Practice Problems

1. Create array of your favorite numbers, double them
2. Create map with name, age, hobbies
3. Filter numbers greater than 10 from [5 12 8 15 3 20]

## Level 4: Control Flow (30 minutes)

### Lesson 11: Conditionals

If/else:

```lisp
(let age 20)

(if (>= age 18)
  (print "Adult")
  (print "Minor"))
```

Cond (multi-way):

```lisp
(let score 85)

(cond
  ((>= score 90) (print "A"))
  ((>= score 80) (print "B"))
  ((>= score 70) (print "C"))
  (else (print "F")))
```

Pattern matching:

```lisp
;; Match values with patterns
(match status-code
  (case 200 "OK")
  (case 404 "Not Found")
  (default "Unknown"))

;; Destructure arrays
(match point
  (case [x, y] (+ "x=" x ", y=" y))
  (default "Invalid point"))

;; Destructure objects
(match user
  (case {name: n, age: a} (+ n " is " a))
  (default "Unknown user"))

;; Guards for conditions
(match n
  (case x (if (> x 0)) "positive")
  (case x (if (< x 0)) "negative")
  (default "zero"))

;; Rest patterns for lists
(fn sum [lst]
  (match lst
    (case [] 0)
    (case [h, & t] (+ h (sum t)))))
```

### Lesson 12: Loops

For loop:

```lisp
(for [i 0 5]
  (print "Count:" i))
```

While loop:

```lisp
(var i 0)
(while (< i 5)
  (print i)
  (= i (+ i 1)))
```

### Practice Problems

1. Write FizzBuzz (1-20)
2. Print multiplication table for 5
3. Find sum of even numbers 1-100

## Level 5: JavaScript Interop (30 minutes)

### Lesson 13: Calling JavaScript

```lisp
;; Direct dot notation
(console.log "Hello from HQL!")
(Math.floor 3.7)            ; → 3
(Math.random)               ; → random number
```

### Lesson 14: Accessing Properties

```lisp
Math.PI                     ; → 3.14159...
```

### Lesson 15: Creating Objects

```lisp
(let date (new Date))
(date.toISOString)

(let arr (new Array 1 2 3))
(print arr)                 ; → [1, 2, 3]
```

### Lesson 16: Importing Modules

```lisp
(import fs from "npm:fs/promises")

(let content (await (fs.readFile "./hello.hql" "utf-8")))
(print content)
```

### Practice Problems

1. Use Math.max with HQL numbers
2. Create Date object and get current year
3. Import lodash and use _.chunk

## Level 6: Macros (Advanced, 60 minutes)

### Lesson 17: Understanding Macros

Macros transform code at compile time:

```lisp
(macro when [test & body]
  `(if ~test
     (do ~@body)))

; Use it
(when (> x 10)
  (print "x is large")
  (print "Processing..."))

; Expands to:
; (if (> x 10)
;   (do
;     (print "x is large")
;     (print "Processing...")))
```

### Lesson 18: Quoting and Unquoting

```lisp
; Quote (`) - creates template
; Unquote (~) - inserts value
; Unquote-splicing (~@) - inserts list items

(macro log [expr]
  `(do
     (print "Evaluating:" '~expr)
     (let result ~expr)
     (print "Result:" result)
     result))

(log (+ 1 2))
; Evaluating: (+ 1 2)
; Result: 3
; → 3
```

### Lesson 19: Real-World Macros

Unless macro:

```lisp
(macro unless [test & body]
  `(if (not ~test)
     (do ~@body)))

(unless (< age 18)
  (print "Access granted"))
```

Time macro:

```lisp
(macro time [& body]
  `(do
     (let start (Date.now))
     (let result (do ~@body))
     (let end (Date.now))
     (print "Took:" (- end start) "ms")
     result))

(time
  (let sum (reduce + 0 (range 0 1000000))))
```

### Practice Problems

1. Write `debug` macro that prints expression and result
2. Write `dotimes` macro: `(dotimes 3 (print "Hi"))` (note: HQL already has this built-in)
3. Write `assert` macro for testing

## Level 7: Building Projects (45 minutes)

### Lesson 20: Project Structure

```
my-project/
├── main.hql           # Entry point
├── src/
│   ├── utils.hql      # Utilities
│   └── core.hql       # Core logic
└── test/
    └── test.hql       # Tests
```

### Lesson 21: Modules

Export from `utils.hql`:

```lisp
(fn add [a b]
  (+ a b))

(fn multiply [a b]
  (* a b))

(export [add multiply])
```

Import in `main.hql`:

```lisp
(import [add multiply] from "./src/utils.hql")

(print (add 5 3))       ; → 8
(print (multiply 4 2))  ; → 8
```

### Lesson 22: Building a CLI Tool

Create `todo.hql`:

```lisp
(let todos [])

(fn add-todo [text]
  (todos.push text)
  (print "Added:" text))

(fn list-todos []
  (for [i 0 todos.length]
    (print (+ i 1) "." (get todos i))))

(fn main []
  (add-todo "Learn HQL")
  (add-todo "Build project")
  (list-todos))

(main)
```

Run:

```bash
hlvm run todo.hql
```

### Lesson 23: Web Server

Create `server.hql`:

```lisp
(fn handle-request [req]
  (let url req.url)
  (new Response
    (+ "You visited: " url)
    {status: 200,
     headers: {"content-type": "text/plain"}}))

(print "Server on http://localhost:8000")
(Deno.serve {port: 8000} handle-request)
```

Run:

```bash
hlvm run server.hql
```

### Final Projects

1. **Calculator CLI** - Add, subtract, multiply, divide
2. **File Reader** - Read and display file contents
3. **JSON Processor** - Parse and transform JSON
4. **Todo Manager** - Add, list, remove todos
5. **HTTP API** - REST API with multiple routes

## Testing Your Code

Run HQL's test suite:

```bash
make test
```

See [Testing Guide](./TESTING.md) for writing your own tests.

## Building from Source

```bash
make build
```

See [Build Guide](./BUILD.md) for details.

## Next Steps

- [API Reference](./api/) - Complete API documentation
- [Standard Library](./api/stdlib.md) - Built-in functions
- [Feature Examples](./features/) - Detailed feature examples

## Getting Help

- Read the [Manual](./MANUAL.md)
- Ask in [GitHub Discussions](https://github.com/hlvm-dev/hlvm/discussions)
- Report bugs in [Issues](https://github.com/hlvm-dev/hlvm/issues)
