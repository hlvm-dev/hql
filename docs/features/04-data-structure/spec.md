# HQL Data Structures

This document specifies the data structures available in HQL: their literal
syntax, canonical S-expression forms, parsing mechanism, and transpilation output.

## Overview

HQL provides syntactic sugar for vectors (arrays), hash maps (objects), and hash
sets. The parser transforms literal syntax into canonical S-expressions, which
are then transpiled to JavaScript.

### JSON/JavaScript Compliance

- **Arrays (`[...]`)**: Lisp style (space-separated) and JSON style (comma-separated)
- **Objects (`{...}`)**: Lisp style (`{key: value}`) and JSON style (`{"key": value}`)
- **Sets (`#[...]`)**: HQL-specific extension with optional commas (JavaScript has no Set literal)

Valid JSON is valid HQL for arrays and objects. HQL also supports Lisp-friendly
style with fewer delimiters.

## Transformation Mechanism

The HQL parser, implemented in `src/hql/transpiler/pipeline/parser.ts`, uses a
tokenizer to identify special characters that denote literal data structures.
When the tokenizer encounters `[`, `{`, or `#[`, the parser invokes specific
functions (`parseVector`, `parseMap`, `parseSet`) to read the elements and
construct the appropriate S-expression list. Commas are optional in all cases.

---

## 1. Vectors (Arrays)

- **Purpose:** Ordered collections, equivalent to JavaScript arrays.

- **Literal Syntax:** Square brackets `[]`, supporting space-separated and
  comma-separated elements.
  ```hql
  [1 2 3 4]
  [1, 2, 3, 4]
  ["apple", "banana", "cherry"]
  [] // Empty vector
  ```

- **Spread in vectors:**
  ```hql
  (var arr [1, 2])
  [0 ...arr 3]        // => [0, 1, 2, 3]
  [...a ...b]          // multiple spreads
  ```

- **Canonical S-expression:** `(vector ...)` or `(empty-array)` for `[]`.
  ```hql
  (vector 1 2 3 4)
  (vector "apple" "banana" "cherry")
  (empty-array) // Canonical form for []
  ```

- **Transpilation output:** JS array literal `[1, 2, 3, 4]`. Spread elements
  become JS spread: `[...arr, 3]`.

- **Parsing Mechanism (`parseVector`)**:
  1. Parser encounters `[` token (`TokenType.LeftBracket`), calls `parseVector`.
  2. Reads expressions until closing `]` (`TokenType.RightBracket`).
  3. Commas (`TokenType.Comma`) are optional and ignored.
  4. Constructs `SList` with `vector` as first element, followed by parsed elements.
  5. If no elements found, returns `(empty-array)`.

---

## 2. Hash Maps (Objects)

- **Purpose:** Key-value pairs, equivalent to JavaScript objects.

- **Literal Syntax:** Curly braces `{}`, supporting Lisp style and JSON style.
  Keys can be symbols (with colon) or strings.
  ```hql
  {name: "Alice" age: 30}
  {host: "localhost" port: 8080}
  { "name": "Alice", "age": 30 }
  { "host": "localhost", "port": 8080 }
  {} // Empty map
  ```

- **Spread in hash maps:**
  ```hql
  (var obj {"a": 1, "b": 2})
  {...obj, "c": 3}
  {"x": 10, ...obj, "y": 20}
  {...a, ...b, ...c}   // multiple spreads
  ```

- **Canonical S-expression:** `(hash-map key1 val1 key2 val2 ...)` or
  `(empty-map)` for `{}`.
  ```hql
  (hash-map "name" "Alice" "age" 30)
  (hash-map "host" "localhost" "port" 8080)
  (empty-map) // Canonical form for {}
  ```

- **Transpilation output:**
  - **Without spread:** `__hql_hash_map("name", "Alice", "age", 30)` runtime
    helper call. The `hash-map` macro in `core.hql` expands to
    `(__hql_hash_map ...)`. The `empty-map` macro expands to `(hash-map)`.
  - **With spread:** JS object literal `{...obj, "c": 3}`. When spread operators
    are present, `transformHashMap` generates an `ObjectExpression` IR node
    instead of the runtime helper call.

- **Parsing Mechanism (`parseMap`)**:
  1. Parser encounters `{` token (`TokenType.LeftBrace`), calls `parseMap`.
  2. Reads key-value pairs until closing `}` (`TokenType.RightBrace`).
  3. Expects `:` token (`TokenType.Colon`) between key and value.
  4. Commas (`TokenType.Comma`) are optional and ignored.
  5. Constructs `SList` with `hash-map` as first element, followed by key-value pairs.
  6. If no key-value pairs found, returns `(empty-map)`.

---

## 3. Hash Sets

- **Purpose:** Unordered collections of unique values. HQL-specific extension.

- **Literal Syntax:** `#[...]`, with optional commas.
  ```hql
  #[1 2 3]
  #[1, 2, 3]
  #["red", "green", "blue"]
  #[] // Empty set
  ```

- **Canonical S-expression:** `(hash-set ...)` or `(empty-set)` for `#[]`.
  ```hql
  (hash-set 1 2 3)
  (hash-set "red" "green" "blue")
  (empty-set) // Canonical form for #[]
  ```

- **Transpilation output:** `new Set([1, 2, 3])`. The `empty-set` macro in
  `core.hql` expands to `(hash-set)`, which transpiles to `new Set([])`.

- **Parsing Mechanism (`parseSet`)**:
  1. Parser encounters `#[` token (`TokenType.HashLeftBracket`), calls `parseSet`.
  2. Reads expressions until closing `]` (`TokenType.RightBracket`).
  3. Commas (`TokenType.Comma`) are optional and ignored.
  4. Constructs `SList` with `hash-set` as first element, followed by elements.
  5. If no elements found, returns `(empty-set)`.

---

## 4. Constructor Calls (new)

- **Purpose:** Create instances of JavaScript constructors.

- **Syntax:**
  ```hql
  (new Set [1, 2, 3])
  (new Date "2024-01-01")
  (new Map)
  ```

- **Transpilation output:** `new Set([1, 2, 3])`, `new Date("2024-01-01")`, `new Map()`.

- **Implementation:** `transformNew` in `data-structure.ts`. Requires at least
  one argument (the constructor). Additional arguments are passed as constructor
  parameters.

---

## 5. Get Operations

- **Purpose:** Uniform access across arrays, objects, and functions.

- **Syntax:**
  ```hql
  (get collection key)            // basic access
  (get collection key default)    // with default value
  ```

- **Transpilation output:** `__hql_get(collection, key)` or
  `__hql_get(collection, key, default)` runtime helper call.

- **Implementation:** `transformGet` in `get.ts`. Accepts 2-3 arguments
  (collection, key, optional default). The `__hql_get` runtime helper checks
  property access first, then falls back to function invocation for function
  objects.

---

## Summary

| Literal | S-expression | JS Output |
|---------|-------------|-----------|
| `[1, 2]` | `(vector 1 2)` | `[1, 2]` |
| `[]` | `(empty-array)` | `[]` |
| `[...a 3]` | `(vector ...a 3)` | `[...a, 3]` |
| `{"a": 1}` | `(hash-map "a" 1)` | `__hql_hash_map("a", 1)` |
| `{}` | `(empty-map)` | `__hql_hash_map()` |
| `{...o, "a": 1}` | `(hash-map ...o "a" 1)` | `{...o, "a": 1}` |
| `#[1, 2]` | `(hash-set 1 2)` | `new Set([1, 2])` |
| `#[]` | `(empty-set)` | `new Set([])` |
| `(new X a)` | `(new X a)` | `new X(a)` |
| `(get c k)` | `(get c k)` | `__hql_get(c, k)` |
