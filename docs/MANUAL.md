# HQL Language Manual

**Version:** 2.0 | **JS Parity:** 100% | **TS Types:** 100%

This manual covers installation, CLI usage, and key workflows. For complete syntax, see [HQL-SYNTAX.md](./HQL-SYNTAX.md).

---

## Table of Contents

- [Installation](#installation)
- [Getting Started](#getting-started)
- [CLI Reference](#cli-reference)
- [Standard Library](#standard-library)
- [Further Reading](#further-reading)

---

## Installation

### Quick Install

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/hlvm-dev/hlvm/main/install.sh | sh
```

**Windows:**

Download the binary from [releases](https://github.com/hlvm-dev/hlvm/releases).

### Verify Installation

```bash
hlvm --version
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
hlvm run hello.hql
```

### Interactive REPL

```bash
hlvm repl
```

```clojure
hlvm> (+ 1 2 3)
6
hlvm> (let name "HQL")
hlvm> (print "Hello," name)
Hello, HQL
```

### Quick Syntax Overview

```clojure
; Variables
(let x 10)            ; Block-scoped mutable
(const PI 3.14159)    ; Immutable
(var count 0)         ; Function-scoped mutable

; Functions
(fn add [a b] (+ a b))
(fn greet [name = "World"]
  (print "Hello," name))

; Type annotations (no space after colon!)
(fn add [a:number b:number] :number
  (+ a b))

; Data structures
(let nums [1 2 3])
(let person {name: "Alice" age: 30})

; Control flow
(if (> x 10) "big" "small")
(cond
  ((< x 0) "negative")
  ((=== x 0) "zero")
  (else "positive"))
```

See [HQL-SYNTAX.md](./HQL-SYNTAX.md) for complete syntax reference.

---

## CLI Reference

### Commands

| Command | Description |
|---------|-------------|
| `hlvm run <file>` | Execute HQL file |
| `hlvm run '<expr>'` | Evaluate expression |
| `hlvm repl` | Start interactive REPL |
| `hlvm compile <file>` | Compile to JavaScript |
| `hlvm init` | Initialize new project |
| `hlvm lsp` | Start Language Server |
| `hlvm upgrade` | Update HLVM to latest |

### Compile Options

```bash
hlvm compile app.hql                     # Dev build
hlvm compile app.hql --release           # Production build
hlvm compile app.hql --target native     # Native binary
hlvm compile app.hql -o myapp.js         # Custom output
```

### Global Options

| Option | Description |
|--------|-------------|
| `--help` | Show help |
| `--version` | Show version |
| `--verbose` | Detailed logging |
| `--debug` | Debug information |

---

## Standard Library

See [Standard Library Reference](./api/stdlib.md) for complete documentation.

### Sequence Operations

```clojure
(first [1 2 3])           ; 1
(rest [1 2 3])            ; [2 3]
(take 2 [1 2 3 4])        ; [1 2]
(drop 2 [1 2 3 4])        ; [3 4]
(nth [1 2 3] 1)           ; 2
```

### Transformations

```clojure
; map and filter return lazy sequences (print as lists like Clojure)
(map (fn [x] (* x 2)) [1 2 3])     ; (2 4 6)
(filter (fn [x] (> x 2)) [1 2 3])  ; (3)

; Use vec to get a concrete array
(vec (map (fn [x] (* x 2)) [1 2 3])) ; [2 4 6]

; reduce consumes the sequence
(reduce + 0 [1 2 3 4])             ; 10
```

### Map Operations

```clojure
(assoc {a: 1} "b" 2)      ; {a: 1, b: 2}
(dissoc {a: 1, b: 2} "a") ; {b: 2}
(keys {a: 1, b: 2})       ; ["a", "b"]
(vals {a: 1, b: 2})       ; [1, 2]
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

## Further Reading

| Document | Description |
|----------|-------------|
| [HQL-SYNTAX.md](./HQL-SYNTAX.md) | Complete syntax reference (definitive) |
| [TYPE-SYSTEM.md](./TYPE-SYSTEM.md) | TypeScript type system coverage |
| [api/](./api/) | Complete API documentation |
| [api/stdlib.md](./api/stdlib.md) | Built-in functions |
| [LSP.md](./LSP.md) | Language Server Protocol support |
| [GUIDE.md](./GUIDE.md) | Learning guide from beginner to advanced |

---

*Version 2.0 - Updated December 2024*
