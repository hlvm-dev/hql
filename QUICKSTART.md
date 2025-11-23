# HQL Quick Start Guide

**Get started with HQL in 5 minutes**

This guide will get you writing and running HQL code immediately.

---

## 1. Installation (30 seconds)

**No installation needed! Run directly with Deno:**

```bash
# Clone the repository
git clone https://github.com/hlvm/hlvm.git
cd hlvm/src/hql
```

That's it! You're ready to run HQL.

---

## 2. Hello World (1 minute)

Create `hello.hql`:

```lisp
(print "Hello, World!")
```

Run it:

```bash
deno run -A core/cli/run.ts hello.hql
```

Output:

```
Hello, World!
```

---

## 3. Variables and Math (1 minute)

Create `math.hql`:

```lisp
;; Immutable variables
(let x 10)
(let y 20)
(let sum (+ x y))

(print "x =" x)
(print "y =" y)
(print "x + y =" sum)

;; Mutable variables
(var counter 0)
(set! counter 100)
(print "Counter:" counter)
```

Run it:

```bash
deno run -A core/cli/run.ts math.hql
```

Output:

```
x = 10
y = 20
x + y = 30
Counter: 100
```

---

## 4. Functions (1 minute)

Create `functions.hql`:

```lisp
;; Simple function
(fn greet (name)
  (print "Hello," name "!"))

;; Function with default arguments
(fn add (a: 0 b: 0)
  (+ a b))

;; Call functions
(greet "Alice")
(greet "Bob")

(print "add() =" (add))
(print "add(5) =" (add a: 5))
(print "add(5, 3) =" (add a: 5 b: 3))
```

Run it:

```bash
deno run -A core/cli/run.ts functions.hql
```

Output:

```
Hello, Alice !
Hello, Bob !
add() = 0
add(5) = 5
add(5, 3) = 8
```

---

## 5. Collections (1 minute)

Create `collections.hql`:

```lisp
;; Arrays
(let numbers [1 2 3 4 5])
(print "First:" (get numbers 0))
(print "Second:" (get numbers 1))

;; Objects/Maps
(let person {:name "Alice" :age 30 :city "NYC"})
(print "Name:" (get person :name))
(print "Age:" (get person :age))

;; Working with collections
(let doubled (map (fn (x) (* x 2)) numbers))
(print "Doubled:" (doall doubled))

(let evens (filter (fn (x) (= (% x 2) 0)) numbers))
(print "Evens:" (doall evens))
```

Run it:

```bash
deno run -A core/cli/run.ts collections.hql
```

---

## 6. Interactive REPL (30 seconds)

Start the REPL:

```bash
deno run -A core/cli/cli.ts repl
```

Try these commands:

```lisp
hql> (+ 1 2 3)
6

hql> (let greet (fn (name) (print "Hello," name)))

hql> (greet "World")
Hello, World

hql> (let numbers [1 2 3 4 5])

hql> (map (fn (x) (* x 2)) numbers)
LazySeq {...}

hql> (doall (map (fn (x) (* x 2)) numbers))
[2, 4, 6, 8, 10]

hql> (reduce + 0 [1 2 3 4 5])
15
```

Exit with `Ctrl+D` or `Ctrl+C`.

---

## 7. Running Tests (30 seconds)

HQL comes with comprehensive tests. Run them to verify your installation:

```bash
# Run all tests
deno test --allow-all

# Or use the test script
./test.sh

# Run specific tests
./test.sh stdlib
./test.sh operators
./test.sh function

# Use deno tasks
deno task test
deno task test:stdlib
deno task test:watch  # Watch mode
```

Expected output:

```
ok | 962 passed | 0 failed (Xs)
```

---

## Common Tasks

### Task 1: Read a File

```lisp
;; read-file.hql
(import fs from "npm:fs/promises")

(fn main ()
  (var content (await (js-call fs.readFile "hello.hql" "utf-8")))
  (print "File content:")
  (print content))

(await (main))
```

Run:

```bash
deno run -A core/cli/run.ts read-file.hql
```

### Task 2: HTTP Request

```lisp
;; http-request.hql
(fn fetchData ()
  (var response (await (js-call fetch "https://jsonplaceholder.typicode.com/todos/1")))
  (var data (await (js-call response.json)))
  (print "Fetched data:")
  (print data))

(await (fetchData))
```

Run:

```bash
deno run -A core/cli/run.ts http-request.hql
```

### Task 3: Build a Simple Web Server

```lisp
;; server.hql
(import Deno from "ext:deno")

(fn handleRequest (req)
  (new Response "Hello from HQL!"
    {:status 200
     :headers {:content-type "text/plain"}}))

(fn main ()
  (print "Server running on http://localhost:8000")
  (js-call Deno.serve {:port 8000} handleRequest))

(main)
```

Run:

```bash
deno run -A core/cli/run.ts server.hql
```

Visit http://localhost:8000 in your browser.

### Task 4: Work with JSON

```lisp
;; json.hql
;; Parse JSON
(let jsonStr "{\"name\": \"Alice\", \"age\": 30}")
(let parsed (js-call JSON.parse jsonStr))
(print "Parsed:" parsed)

;; Create and stringify
(let person {:name "Bob" :age 25 :city "NYC"})
(let jsonOut (js-call JSON.stringify person))
(print "JSON:" jsonOut)
```

### Task 5: Use Standard Library

```lisp
;; stdlib-demo.hql
;; Sequence operations
(let numbers [1 2 3 4 5 6 7 8 9 10])

(print "First 3:" (doall (take 3 numbers)))
(print "Drop 3:" (doall (drop 3 numbers)))
(print "Doubled:" (doall (map (fn (x) (* x 2)) numbers)))
(print "Evens:" (doall (filter (fn (x) (= (% x 2) 0)) numbers)))
(print "Sum:" (reduce + 0 numbers))

;; Map operations
(let person {:name "Alice" :age 30})
(let updated (assoc person :city "NYC"))
(print "Updated:" updated)
(print "Keys:" (keys updated))
(print "Values:" (vals updated))

;; Higher-order functions
(let add5 (partial + 5))
(print "5 + 10 =" (add5 10))

(let addThenDouble (comp (fn (x) (* x 2)) (fn (x) (+ x 1))))
(print "addThenDouble(5) =" (addThenDouble 5))  ;; (5 + 1) * 2 = 12
```

Run:

```bash
deno run -A core/cli/run.ts stdlib-demo.hql
```

---

## Next Steps

Now that you've got the basics, explore more:

### Learn Language Features

- **[doc/features/01-binding/](doc/features/01-binding/)** - Variables and
  bindings
- **[doc/features/06-function/](doc/features/06-function/)** - Functions and
  closures
- **[doc/features/02-class/](doc/features/02-class/)** - Classes and objects
- **[doc/features/10-macro/](doc/features/10-macro/)** - Macros
- **[doc/features/08-js-interop/](doc/features/08-js-interop/)** - JavaScript
  interop

### API References

- **[doc/api/stdlib.md](doc/api/stdlib.md)** - Standard library (40+ functions)
- **[doc/api/builtins.md](doc/api/builtins.md)** - Built-in operators
- **[doc/api/module-system.md](doc/api/module-system.md)** - Import/export
  system

### Build and Deploy

- **[doc/api/build-tool.md](doc/api/build-tool.md)** - Build tool documentation

---

## Cheat Sheet

### Basic Syntax

```lisp
;; Comments start with semicolons

;; Variables
(let x 10)              ;; Immutable
(var y 20)              ;; Mutable
(set! y 30)             ;; Mutation

;; Functions
(fn add (a b) (+ a b))
(fn greet (name: "World") (print "Hello," name))

;; Conditionals
(if condition then-expr else-expr)
(cond (case1 expr1) (case2 expr2) (else default))

;; Loops
(for (i 0 10) (print i))
(while condition (do-something))

;; Collections
[1 2 3]                 ;; Array
{:key "value"}          ;; Map
#{1 2 3}                ;; Set
```

### Common Functions

```lisp
;; Math
(+ 1 2 3)               ;; Addition
(- 10 3)                ;; Subtraction
(* 2 3)                 ;; Multiplication
(/ 10 2)                ;; Division
(% 10 3)                ;; Modulo

;; Comparison
(= a b)                 ;; Equal
(!= a b)                ;; Not equal
(> a b)                 ;; Greater than
(< a b)                 ;; Less than

;; Collections
(get coll key)          ;; Get value
(first [1 2 3])         ;; → 1
(rest [1 2 3])          ;; → (2 3)
(map fn coll)           ;; Transform
(filter pred coll)      ;; Filter
(reduce fn init coll)   ;; Reduce
```

### Running Code

```bash
# Run HQL file
deno run -A core/cli/run.ts file.hql

# Run expression
deno run -A core/cli/cli.ts run '(+ 1 2 3)'

# Start REPL
deno run -A core/cli/cli.ts repl

# Transpile to JS
deno run -A core/cli/cli.ts transpile file.hql

# Run tests
./test.sh
deno test --allow-all
```

---

## Troubleshooting

### Issue: Command not found

**Solution:** Make sure you're in the `hlvm/src/hql` directory:

```bash
cd hlvm/src/hql
pwd  # Should show: .../hlvm/src/hql
```

### Issue: Permission denied

**Solution:** Make sure test scripts are executable:

```bash
chmod +x test.sh
chmod +x verify-codebase.sh
```

### Issue: Tests failing

**Solution:** Verify your installation:

```bash
./verify-codebase.sh
# Expected: ✅ VERIFICATION PASSED
```

### Issue: Module not found

**Solution:** Check your import paths:

```lisp
;; ✅ Correct - relative path
(import utils from "./utils.hql")

;; ❌ Wrong - missing ./
(import utils from "utils.hql")
```

### Issue: REPL not starting

**Solution:** Use the correct CLI file:

```bash
# ✅ Correct
deno run -A core/cli/cli.ts repl

# ❌ Wrong
deno run -A core/cli/run.ts repl
```

---

## Quick Examples Repository

All example files mentioned in this guide:

```
examples/
├── hello.hql          - Hello World
├── math.hql           - Variables and math
├── functions.hql      - Function definitions
├── collections.hql    - Arrays, maps, transformations
├── read-file.hql      - File I/O
├── http-request.hql   - HTTP requests
├── server.hql         - Web server
├── json.hql           - JSON parsing
└── stdlib-demo.hql    - Standard library usage
```

Create an `examples/` directory and save these files for easy reference!

---

## Summary

You now know:

- ✅ How to run HQL files
- ✅ Basic HQL syntax
- ✅ Functions and variables
- ✅ Collections and transformations
- ✅ How to use the REPL
- ✅ How to run tests
- ✅ Common tasks and patterns

**Next:** Explore [README.md](README.md) for complete documentation or dive into
[doc/features/](doc/features/) for specific language features.

**Happy coding with HQL!** 🎉
