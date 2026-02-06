# Pattern Matching

**Implementation:** Macro in `src/hql/lib/macro/core.hql` (`match`, `__match_impl__`, `__match_or_cond__`)

**Runtime helper:** `__hql_match_obj` in `src/common/runtime-helper-impl.ts` (object pattern key-existence check)

## Overview

HQL provides pattern matching via three constructs:

1. **`match`** - Pattern matching expression with multiple cases
2. **`case`** - Individual pattern clause with optional guard
3. **`default`** - Fallback clause when no pattern matches

Pattern matching is implemented as a compile-time macro that expands to nested `if` expressions and IIFEs with JS destructuring.

## Syntax

### Basic Match Expression

```lisp
(match value
  (case pattern result)
  (case pattern result)
  (default fallback))
```

### Supported Patterns

| Pattern Type | Syntax | Description |
|-------------|--------|-------------|
| Literal | `42`, `"hello"`, `true`, `null` | Exact value match (`===`) |
| Wildcard | `_` | Matches anything, no binding |
| Symbol | `x` | Matches anything, binds to name |
| Array | `[a, b]`, `[]` | Destructuring array match (checks `Array.isArray` and `.length`) |
| Array Rest | `[h, & t]` | Head and tail destructuring (checks `Array.isArray` and `.length >=`) |
| Object | `{name: n, age: a}` | Destructuring object match (checks type + key existence via `__hql_match_obj`) |
| Or-pattern | `(| 1 2 3)` | Match any of several literal values |

### Guards

```lisp
(match value
  (case pattern (if guard-condition) result)
  (default fallback))
```

Guards are checked after pattern binding, allowing use of bound variables.

## Examples

### Literal Matching

```lisp
(match status-code
  (case 200 "OK")
  (case 404 "Not Found")
  (case 500 "Server Error")
  (default "Unknown"))
```

### Symbol Binding

```lisp
(match x
  (case 0 "zero")
  (case n (+ "value: " n)))  // n binds to x
```

### Wildcard Pattern

```lisp
(match value
  (case 1 "one")
  (case 2 "two")
  (case _ "other"))  // _ matches anything
```

### Array Patterns

```lisp
// Empty array
(match arr
  (case [] "empty")
  (default "not empty"))

// Fixed-length array
(match point
  (case [x, y] (+ x y))
  (default 0))

// Rest pattern (head & tail)
(match numbers
  (case [] 0)
  (case [h, & t] (+ h (sum t))))
```

### Object Patterns

```lisp
(match user
  (case {name: n, age: a} (+ n " is " a " years old"))
  (default "unknown user"))

// Single key
(match config
  (case {port: p} p)
  (default 8080))
```

Object patterns check that the value is a non-null, non-array object and that all specified keys exist in the object (via `__hql_match_obj`). Binding uses JS destructuring, so missing keys yield `undefined`.

### Guards

```lisp
(match n
  (case x (if (> x 0)) "positive")
  (case x (if (< x 0)) "negative")
  (default "zero"))

// Guard with array binding
(match pair
  (case [a, b] (if (> a b)) "a > b")
  (case [a, b] (if (< a b)) "a < b")
  (default "a = b"))
```

### Or-Patterns

```lisp
// Match any of several values
(match status-code
  (case (| 200 201 204) "success")
  (case (| 400 422) "client error")
  (case (| 500 502 503) "server error")
  (default "unknown"))

// Works with strings
(match day
  (case (| "Saturday" "Sunday") "weekend")
  (case _ "weekday"))

// Works with null
(match value
  (case (| null undefined) "missing")
  (case x (+ "got: " x)))
```

Or-patterns do not bind variables. They expand to chained `===` checks via the `__match_or_cond__` helper macro.

### Nested Patterns

```lisp
// Nested arrays
(match matrix
  (case [[a, b], [c, d]] (+ a b c d))
  (default 0))

// Object with array value
(match point
  (case {coords: [x, y]} (+ x y))
  (default 0))
```

### Recursive Pattern Matching

```lisp
// Sum of list
(fn sum [lst]
  (match lst
    (case [] 0)
    (case [h, & t] (+ h (sum t)))))

(sum [1, 2, 3, 4, 5])  // => 15

// Length of list
(fn my-length [lst]
  (match lst
    (case [] 0)
    (case [_, & t] (+ 1 (my-length t)))))

(my-length [1, 2, 3, 4])  // => 4
```

## Implementation Details

### Macro Structure

Three macros in `src/hql/lib/macro/core.hql`:

1. **`match`** - Entry point. Binds value to a gensym variable (`val#`), dispatches to `__match_impl__`.
2. **`__match_impl__`** - Recursive clause processor. Classifies each pattern, generates condition + body + fallback chain.
3. **`__match_or_cond__`** - Helper for or-patterns. Builds `(|| (=== val p1) (=== val p2) ...)` recursively.

### Pattern Classification

The `__match_impl__` macro classifies each pattern at macro-expansion time:

| Classification | Detection | Condition Generated |
|---------------|-----------|-------------------|
| `default` | clause starts with `default` | (none, unconditional) |
| Wildcard | symbol named `_` | `true` (always matches) |
| Symbol binding | any other symbol (not `_`, `null`) | `true` (always matches) |
| Null literal | symbol named `null` | `(=== val null)` |
| Or-pattern | list starting with `\|` | `(__match_or_cond__ val ...alternatives)` |
| Object | list starting with `hash-map` or `__hql_hash_map` | `(__hql_match_obj val (quote pattern))` |
| Array (no rest) | other list, no `&` | `(and (Array.isArray val) (=== (js-get val "length") n))` |
| Array (with rest) | list with `&` at second-to-last | `(and (Array.isArray val) (>= (js-get val "length") k))` |
| Other literal | anything else | `(=== val literal)` |

### Body Generation

| Pattern Type | Body |
|-------------|------|
| Symbol binding | `(let (sym val) result)` |
| Array/Object | `((fn [pattern] result) val)` (IIFE with destructuring parameter) |
| Or-pattern, wildcard, null, literal | `result` (no binding) |
| With guard | wraps body in `(if guard-expr result fallback)` |

### Optimization

When the condition is `true` (wildcard, symbol binding), the `if` wrapper is omitted and the body is emitted directly.

### Characteristics

- **Compile-time expansion** - Pattern dispatch logic resolved at macro expansion
- **Value binding** - Pattern variables bound via `let` or IIFE destructuring parameter
- **Short-circuit evaluation** - Only matching branch is evaluated
- **Expression-based** - Returns a value, can be used anywhere
- **Runtime type checks** - Array/object patterns include `Array.isArray`, `typeof`, and key-existence checks

## Error Handling

### No Matching Pattern

If no clause matches and no default is provided, throws an error that includes the unmatched value:

```lisp
(match 999
  (case 1 "one")
  (case 2 "two"))
// throws: Error("No matching pattern for value: 999")
```

### Invalid Clause

If a clause is not `case` or `default`:

```lisp
(match x
  (when true "yes"))  // not a valid clause type
// throws: Error("Invalid match clause")
```

## Test Coverage

Tests are in `tests/unit/pattern-matching.test.ts`.

### Literal Matching
- Number, string, boolean, null literals
- Falls through to next case on mismatch

### Symbol Binding
- Symbol binds matched value
- Symbol binding with prior literal cases

### Wildcard
- Wildcard matches anything
- Wildcard as fallback

### Array Patterns
- Empty array `[]`
- Single element `[x]`
- Two element `[a, b]`
- Rest pattern `[h, & t]` (extracts head and tail)
- Non-array value does not match array pattern

### Object Patterns
- Multi-key binding `{name: n, age: a}`
- Single key binding `{x: val}`
- Non-object (array) does not match object pattern

### Guards
- Guard passes
- Guard fails, falls through to next clause
- Multiple guards in sequence
- Guard with array binding

### Default Clause
- Default executed when no case matches
- Default with complex expression

### Nested Patterns
- Nested arrays `[[a, b], [c, d]]`
- Object with array value `{coords: [x, y]}`

### Recursive Patterns
- Recursive sum using `[h, & t]`
- Recursive length using `[_, & t]`

### Or-Patterns
- Matches first, second, third alternative
- Falls through on no match
- Works with strings
- Multi-case match with multiple or-patterns
- Or-pattern with null

### Error Messages
- Error includes unmatched value

### Code Quality
- Generated code does not contain `match` keyword
- Generated code does not contain `case` keyword

## Limitations

- No literal value matching in object patterns (e.g., `{status: 200}` is not supported; use guards instead)
- No type patterns (use guards with `typeof`)
- No exhaustiveness checking
- Or-patterns only support literal comparisons (no variable binding in or-pattern alternatives)

## Related Features

- **`cond`** - Multi-way conditional (simpler than match)
- **`if-let`** - Conditional binding
- **`when-let`** - Conditional execution with binding
- **Destructuring** - Used by match for array/object patterns
