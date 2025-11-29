# HQL Quick Start

Get started with HQL in 5 minutes.

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/hlvm-dev/hql/main/install.sh | sh
```

Verify:
```bash
hql --version
```

## Hello World

Create `hello.hql`:
```lisp
(print "Hello, World!")
```

Run it:
```bash
hql run hello.hql
```

## Variables

```lisp
; Immutable
(let x 10)
(let name "Alice")

; Mutable
(var counter 0)
(= counter 100)
```

## Functions

```lisp
(fn greet [name]
  (print "Hello," name))

(greet "World")
```

With defaults:
```lisp
(fn add [a = 0 b = 0]
  (+ a b))

(add 5 3)  ; → 8
```

## Data Structures

Arrays:
```lisp
(let numbers [1 2 3 4 5])
(get numbers 0)  ; → 1
```

Maps:
```lisp
(let person {:name "Alice" :age 30})
(get person :name)  ; → "Alice"
```

## Working with Collections

```lisp
(let numbers [1 2 3 4 5])

; Double all numbers
(map (fn [x] (* x 2)) numbers)
; → [2 4 6 8 10]

; Filter evens
(filter (fn [x] (= (% x 2) 0)) numbers)
; → [2 4]

; Sum
(reduce + 0 numbers)
; → 15
```

## Interactive REPL

```bash
hql repl
```

Try:
```lisp
hql> (+ 1 2 3)
6

hql> (let square (fn [x] (* x x)))

hql> (square 5)
25

hql> (map square [1 2 3 4])
[1 4 9 16]
```

## Next Steps

- Read the [Manual](./MANUAL.md)
- Explore [Language Features](./features/)
- Check [API Reference](./api/)
