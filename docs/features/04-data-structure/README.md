# Data Structure Feature Documentation

**Implementation:** Parser literal syntax + transpiler (data-structure.ts, get.ts)

## Overview

HQL provides syntactic sugar for common data structures:

1. **Vectors (Arrays)** - Ordered collections with `[...]` syntax
2. **Hash Maps (Objects)** - Key-value pairs with `{...}` syntax
3. **Hash Sets** - Unique values with `#[...]` syntax

Arrays and objects support both Lisp style and JavaScript/JSON style. Sets use
HQL-specific `#[...]` syntax.

## Syntax

### Vectors (Arrays)

```lisp
// Empty vector
[]

// Vector with elements (Lisp style, space-separated)
[1 2 3 4]

// Vector with elements (JavaScript/JSON style, comma-separated)
[1, 2, 3, 4]
["apple", "banana", "cherry"]

// Mixed types
[1, "hello", true, null]

// Nested vectors
[[1, 2], [3, 4]]

// Spread operator in vectors
(var arr [1, 2])
[0 ...arr 3]        // => [0, 1, 2, 3]

// Access by index
(var v ["a", "b", "c"])
(get v 1)  // => "b"

// Property access
v.length   // => 3
```

### Hash Maps (Objects)

```lisp
// Empty map
{}

// Map with key-value pairs (Lisp style, symbol keys with colon)
{name: "Alice" age: 30}
{host: "localhost" port: 8080}

// Map with key-value pairs (JavaScript/JSON style)
{"name": "Alice", "age": 30}
{"host": "localhost", "port": 8080}

// Access by key
(var m {"name": "Alice"})
(get m "name")  // => "Alice"

// Nested maps
{"user": {"name": "Bob", "id": 123}}

// Mutation
(var m {"count": 10})
(= m.newProp "added")

// Spread operator in hash maps
(var obj {"a": 1, "b": 2})
{...obj, "c": 3}           // => {"a": 1, "b": 2, "c": 3}
{"x": 10, ...obj, "y": 20} // => {"x": 10, "a": 1, "b": 2, "y": 20}
```

### Hash Sets

```lisp
// Empty set (HQL-specific syntax)
#[]

// Set with elements
#[1 2 3]
#["red" "green" "blue"]

// Automatic deduplication
(var s #[1, 2, 2, 3, 3, 3])
s.size  // => 3

// Membership check
(var colors #["red", "green", "blue"])
(colors.has "green")  // => true
```

### Constructor Calls

```lisp
// new expression
(new Set [1, 2, 3])
(new Date "2024-01-01")
(new Map)
```

## Implementation Details

### Parsing Mechanism

HQL's parser transforms literal syntax into S-expressions:

#### Vectors

- **Literal:** `[1, 2, 3]`
- **S-expression:** `(vector 1 2 3)`
- **Empty:** `[]` → `(empty-array)`
- **Parser:** `parseVector` in `src/hql/transpiler/pipeline/parser.ts`
- **Syntax:** Lisp style or JSON style (commas optional)
- **Transpiler:** `transformVector` in `data-structure.ts` → JS array literal `[1, 2, 3]`
- **Spread:** `[1 ...arr 2]` → `[1, ...arr, 2]` in JS

#### Hash Maps

- **Literal:** `{"x": 10, "y": 20}`
- **S-expression:** `(hash-map "x" 10 "y" 20)`
- **Empty:** `{}` → `(empty-map)` macro → `(hash-map)` → `__hql_hash_map()`
- **Parser:** `parseMap` in `src/hql/transpiler/pipeline/parser.ts`
- **Syntax:** Lisp style or JSON style (commas optional)
- **Transpiler without spread:** `transformHashMap` → `__hql_hash_map("x", 10, "y", 20)` runtime helper call
- **Transpiler with spread:** `transformHashMap` → JS object literal `{...obj, x: 10}`

#### Hash Sets

- **Literal:** `#[1, 2, 3]`
- **S-expression:** `(hash-set 1 2 3)`
- **Empty:** `#[]` → `(empty-set)` macro → `(hash-set)` → `new Set([])`
- **Parser:** `parseSet` in `src/hql/transpiler/pipeline/parser.ts`
- **Syntax:** HQL extension (JS has no Set literal) - commas optional
- **Transpiler:** `transformHashSet` → `new Set([1, 2, 3])` in JS

#### Constructor Calls

- **S-expression:** `(new Constructor arg1 arg2)`
- **Transpiler:** `transformNew` in `data-structure.ts` → `new Constructor(arg1, arg2)` in JS

### Macros (core.hql)

- `(hash-map ...)` macro expands to `(__hql_hash_map ...)` runtime helper call
- `(empty-map)` macro expands to `(hash-map)` (zero-arg hash-map)
- `(empty-set)` macro expands to `(hash-set)` (zero-arg hash-set)

### JavaScript/JSON Compliance

- **Arrays and Objects:** Valid JSON is valid HQL, and Lisp style is supported
- **Sets:** HQL-specific extension using `#[...]` notation
- **Commas:** Optional (JSON style accepted)
- **Keys:** Symbols or strings (symbols are treated as string keys)

### Get Operations

The `get` function provides uniform access across collections:

```lisp
(get collection key)            // basic access
(get collection key default)    // with default value for missing keys
```

- **Implementation:** `transformGet` in `get.ts` → `__hql_get(collection, key, default?)` runtime helper
- **Supports:** arrays (numeric index), objects (string key), functions (property or call fallback)

## Test Coverage

### Section 1: Vectors

- Create empty vector
- Create vector with elements
- Vector with mixed types
- Nested vectors
- Access element by index
- Vector length property
- Push to mutable vector

### Section 2: Hash Maps

- Create empty map
- Create map with key-value pairs
- Access map value by key
- Nested maps
- Add property to mutable map
- Map with numeric keys

### Section 3: Hash Sets

- Create empty set
- Create set with elements
- Automatic deduplication
- Check membership with `.has`

### Section 4: Get Operations

- Get from vector by numeric index
- Get from map by string key
- Get with default value (non-existent key)
- Chained get operations

### Section 5: Collection Operations

- Map over vector (via `.map` JS method)
- Filter vector (via `.filter` JS method)
- Reduce vector to sum (via `.reduce` JS method)

### Spread Operators (separate test file)

- Spread in vectors: `[...arr 3 4]`, `[1 ...arr 4]`, `[1 2 ...arr]`
- Multiple spreads: `[...a ...b]`
- Spread in hash maps: `{...obj, "a": 1}`, `{"a": 1, ...obj, "d": 4}`
- Multiple object spreads: `{...a, ...b, ...c}`

## Related Specs

- Complete data structure specification: `spec.md`
- Parser implementation: `src/hql/transpiler/pipeline/parser.ts`
- Transpiler: `src/hql/transpiler/syntax/data-structure.ts`
- Get operations: `src/hql/transpiler/syntax/get.ts`
- Runtime helper: `src/common/runtime-helper-impl.ts` (`__hql_hash_map`, `__hql_get`)
- Core macros: `src/hql/lib/macro/core.hql` (`hash-map`, `empty-map`, `empty-set`)

## Examples

See `examples.hql` for executable examples demonstrating access patterns and disambiguation between property access and function calls.

## Transform Pipeline

```
HQL Source
  |
Tokenizer (identifies [, {, #[ tokens)
  |
Parser (parseVector, parseMap, parseSet)
  |
S-expression: (vector ...), (hash-map ...), (hash-set ...)
  |
Macro expansion: empty-map -> (hash-map), empty-set -> (hash-set)
  |
Transpiler (transforms to JS)
  |
JavaScript:
  - vector -> Array literal [...]
  - hash-map (no spread) -> __hql_hash_map(...) call
  - hash-map (with spread) -> Object literal {...}
  - hash-set -> new Set([...])
  - new -> new Constructor(...)
```
