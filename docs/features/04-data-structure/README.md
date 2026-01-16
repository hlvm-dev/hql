# Data Structure Feature Documentation

**Implementation:** S-expression parser (literal syntax)
**Coverage:** ✅ 100%

## Overview

HQL provides syntactic sugar for common data structures:

1. **Vectors (Arrays)** - Ordered collections with `[...]` syntax
2. **Hash Maps (Objects)** - Key-value pairs with `{...}` syntax
3. **Hash Sets** - Unique values with `#[...]` syntax

All data structures follow JavaScript/JSON syntax (arrays and objects) or
HQL-specific extensions (sets).

## Syntax

### Vectors (Arrays)

```lisp
; Empty vector
[]

; Vector with elements (JavaScript/JSON syntax)
[1, 2, 3, 4]
["apple", "banana", "cherry"]

; Mixed types
[1, "hello", true, null]

; Nested vectors
[[1, 2], [3, 4]]

; Access by index
(var v ["a", "b", "c"])
(get v 1)  ; => "b"

; Property access
v.length   ; => 3
```

### Hash Maps (Objects)

```lisp
; Empty map
{}

; Map with key-value pairs (JavaScript/JSON syntax)
{"name": "Alice", "age": 30}
{"host": "localhost", "port": 8080}

; Access by key
(var m {"name": "Alice"})
(get m "name")  ; => "Alice"

; Nested maps
{"user": {"name": "Bob", "id": 123}}

; Mutation
(var m {"count": 10})
(= m.newProp "added")
```

### Hash Sets

```lisp
; Empty set (HQL-specific syntax)
#[]

; Set with elements
#[1, 2, 3]
#["red", "green", "blue"]

; Automatic deduplication
(var s #[1, 2, 2, 3, 3, 3])
s.size  ; => 3

; Membership check
(var colors #["red", "green", "blue"])
(colors.has "green")  ; => true
```

## Implementation Details

### Parsing Mechanism

HQL's parser transforms literal syntax into S-expressions:

#### Vectors

- **Literal:** `[1, 2, 3]`
- **S-expression:** `(vector 1 2 3)`
- **Empty:** `[]` → `(empty-array)`
- **Parser:** `parseVector` in `src/hql/s-exp/parser.ts`
- **Syntax:** Exact JavaScript/JSON - requires commas

#### Hash Maps

- **Literal:** `{"x": 10, "y": 20}`
- **S-expression:** `(hash-map "x" 10 "y" 20)`
- **Empty:** `{}` → `(empty-map)`
- **Parser:** `parseMap` in `src/hql/s-exp/parser.ts`
- **Syntax:** Exact JavaScript/JSON - requires colons and commas

#### Hash Sets

- **Literal:** `#[1, 2, 3]`
- **S-expression:** `(hash-set 1 2 3)`
- **Empty:** `#[]` → `(empty-set)`
- **Parser:** `parseSet` in `src/hql/s-exp/parser.ts`
- **Syntax:** HQL extension (JS has no Set literal) - requires commas

### JavaScript/JSON Compliance

- **Arrays and Objects:** Valid JSON is valid HQL
- **Sets:** HQL-specific extension using `#[...]` notation
- **Commas:** Required between all elements (like JavaScript)
- **Keys:** Must be strings in maps

## Features Covered

✅ Vector creation (empty and with elements) ✅ Vector element access by index
✅ Vector property access (`.length`) ✅ Vector mutation (`.push`) ✅ Map
creation (empty and with pairs) ✅ Map value access by key ✅ Map property
mutation (`=`) ✅ Nested maps and vectors ✅ Set creation (empty and with
elements) ✅ Set deduplication ✅ Set membership testing (`.has`) ✅ Get
operations with defaults ✅ Chained get operations ✅ Collection operations
(map, filter, reduce)

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
- Get with default value
- Chained get operations

### Section 5: Collection Operations

- Map over vector
- Filter vector
- Reduce vector to sum

## Related Specs

- Complete data structure specification available in project specs
- Parser implementation in S-expression module

## Examples

See `examples.hql` for executable examples.

## Transform Pipeline

```
HQL Source
  ↓
Tokenizer (identifies [, {, #[ tokens)
  ↓
Parser (parseVector, parseMap, parseSet)
  ↓
S-expression: (vector ...), (hash-map ...), (hash-set ...)
  ↓
Transpiler (transforms to JS)
  ↓
JavaScript (Array, Object, Set)
```

## Edge Cases Tested

✅ Empty collections ([], {}, #[]) ✅ Mixed types in vectors ✅ Nested
structures (maps in maps, vectors in vectors) ✅ Numeric keys in maps ✅ Set
deduplication ✅ Non-existent keys (get with default) ✅ Chained access (deep
nesting) ✅ Higher-order functions (map, filter, reduce)

## Future Enhancements

- Better type inference for nested structures
- Record types with compile-time shape validation
