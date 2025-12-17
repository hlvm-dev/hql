# Pattern Matching Feature Documentation

**Implementation:** Core macro system (`src/lib/macro/core.hql`)

**Coverage:** 100%

## Overview

HQL provides powerful pattern matching with a Swift/Scala-style syntax:

1. **`match`** - Pattern matching expression with multiple cases
2. **`case`** - Individual pattern clause with optional guard
3. **`default`** - Fallback clause when no pattern matches

Pattern matching is implemented as a **compile-time macro** with zero runtime overhead.

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
| Literal | `42`, `"hello"`, `true`, `null` | Exact value match |
| Wildcard | `_` | Matches anything, no binding |
| Symbol | `x` | Matches anything, binds to name |
| Array | `[a, b]`, `[]` | Destructuring array match |
| Array Rest | `[h, & t]` | Head and tail destructuring |
| Object | `{name: n, age: a}` | Destructuring object match |

### Guards

```lisp
(match value
  (case pattern (if guard-condition) result)
  (default fallback))
```

Guards are checked **after** pattern binding, allowing use of bound variables.

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
  (case n (+ "value: " n)))  ; n binds to x
```

### Wildcard Pattern

```lisp
(match value
  (case 1 "one")
  (case 2 "two")
  (case _ "other"))  ; _ matches anything
```

### Array Patterns

```lisp
; Empty array
(match arr
  (case [] "empty")
  (default "not empty"))

; Fixed-length array
(match point
  (case [x, y] (+ x y))
  (default 0))

; Rest pattern (head & tail)
(match numbers
  (case [] 0)
  (case [h, & t] (+ h (sum t))))
```

### Object Patterns

```lisp
(match user
  (case {name: n, age: a} (+ n " is " a " years old"))
  (default "unknown user"))

; Single key
(match config
  (case {port: p} p)
  (default 8080))
```

### Guards

```lisp
(match n
  (case x (if (> x 0)) "positive")
  (case x (if (< x 0)) "negative")
  (default "zero"))

; Guard with array binding
(match pair
  (case [a, b] (if (> a b)) "a > b")
  (case [a, b] (if (< a b)) "a < b")
  (default "a = b"))
```

### Nested Patterns

```lisp
; Nested arrays
(match matrix
  (case [[a, b], [c, d]] (+ a b c d))
  (default 0))

; Object with array value
(match point
  (case {coords: [x, y]} (+ x y))
  (default 0))
```

### Recursive Pattern Matching

```lisp
; Sum of list
(fn sum [lst]
  (match lst
    (case [] 0)
    (case [h, & t] (+ h (sum t)))))

(sum [1, 2, 3, 4, 5])  ; => 15

; Length of list
(fn my-length [lst]
  (match lst
    (case [] 0)
    (case [_, & t] (+ 1 (my-length t)))))

(my-length [1, 2, 3, 4])  ; => 4
```

## Implementation Details

### Compilation

Pattern matching compiles to nested ternary expressions:

```lisp
(match x
  (case 42 "answer")
  (case n (+ n 1))
  (default "other"))

; Compiles to:
(() => {
  let match_0 = x;
  return match_0 === 42 ? "answer" :
         true ? (() => { let n = match_0; return n + 1; })() :
         "other";
})()
```

### Characteristics

- **Compile-time expansion** - Zero runtime overhead for pattern dispatch
- **Value binding** - Pattern variables bound via `let` or destructuring
- **Short-circuit evaluation** - Only matching branch is evaluated
- **Expression-based** - Returns a value, can be used anywhere
- **Type-safe conditions** - Array/object patterns include type checks

### Time Complexity

- **Macro expansion:** O(n) where n = number of clauses
- **Generated code:** O(n) sequential checks (optimal for pattern matching)
- **Pattern classification:** O(1) per pattern

## Test Coverage



### Section 1: Literal Matching
- Literal number match
- Literal string match
- Literal boolean match
- Literal null match
- Falls through to next case

### Section 2: Symbol Binding
- Symbol binding
- Symbol binding with default

### Section 3: Wildcard
- Wildcard matches anything
- Wildcard as fallback

### Section 4: Array Patterns
- Empty array pattern
- Single element array
- Two element array
- Array rest pattern
- Array rest pattern head
- Non-array doesn't match array pattern

### Section 5: Object Patterns
- Object binding
- Object single key binding
- Non-object doesn't match object pattern

### Section 6: Guards
- Guard passes
- Guard fails, falls through
- Multiple guards
- Guard with array binding

### Section 7: Default Clause
- Default is executed when no match
- Default can have complex expression

### Section 8: Nested Patterns
- Nested array
- Object with array value

### Section 9: Recursive Patterns
- Recursive sum
- Recursive length

### Section 10: Complex Examples
- HTTP response handler
- Event handler

### Section 11: Code Quality
- Generated code doesn't contain 'match' keyword
- Generated code doesn't contain 'case' keyword

## Use Cases

### HTTP Response Handling

```lisp
(fn handle-response [res]
  (match res
    (case {status: s}
      (if (=== s 200) "ok"
          (if (=== s 404) "not found" "error")))
    (default "unknown")))
```

### Event Processing

```lisp
(fn handle-event [event]
  (match event
    (case {type: t, x: x, y: y}
      (if (=== t "click")
          (+ "click at " x "," y)
          "other"))
    (default "unknown event")))
```

### Data Transformation

```lisp
(fn transform [data]
  (match data
    (case [] [])
    (case [h, & t] (cons (process h) (transform t)))))
```

### Option/Maybe Pattern

```lisp
(fn get-value [maybe]
  (match maybe
    (case null "no value")
    (case v v)))
```

## Comparison with Other Languages

### Scala

```scala
// Scala
x match {
  case 42 => "answer"
  case n if n > 0 => "positive"
  case _ => "other"
}

// HQL
(match x
  (case 42 "answer")
  (case n (if (> n 0)) "positive")
  (case _ "other"))
```

### Swift

```swift
// Swift
switch x {
case 42: return "answer"
case let n where n > 0: return "positive"
default: return "other"
}

// HQL
(match x
  (case 42 "answer")
  (case n (if (> n 0)) "positive")
  (default "other"))
```

### Clojure

```clojure
;; Clojure (core.match)
(match x
  42 "answer"
  (n :guard pos?) "positive"
  :else "other")

;; HQL
(match x
  (case 42 "answer")
  (case n (if (> n 0)) "positive")
  (default "other"))
```

### JavaScript

```javascript
// JavaScript (no native pattern matching)
if (x === 42) return "answer";
if (x > 0) return "positive";
return "other";

// HQL compiles to similar ternary chain
```

## Best Practices

### Use Specific Patterns First

```lisp
; Good: specific cases first
(match x
  (case 0 "zero")
  (case 1 "one")
  (case n (+ "number: " n)))

; Bad: catch-all first (unreachable cases)
(match x
  (case n (+ "number: " n))
  (case 0 "zero")       ; never reached!
  (case 1 "one"))       ; never reached!
```

### Always Include Default/Wildcard

```lisp
; Good: explicit fallback
(match status
  (case 200 "ok")
  (case 404 "not found")
  (default "error"))

; Risky: might throw "No matching pattern"
(match status
  (case 200 "ok")
  (case 404 "not found"))
```

### Use Guards for Complex Conditions

```lisp
; Good: guards for conditions
(match n
  (case x (if (> x 100)) "large")
  (case x (if (> x 10)) "medium")
  (case _ "small"))

; Alternative: nested match (more verbose)
(match n
  (case x (match (> x 100)
            (case true "large")
            (default (match (> x 10)
                       (case true "medium")
                       (default "small"))))))
```

### Prefer Destructuring Over Manual Access

```lisp
; Good: destructuring
(match point
  (case [x, y] (+ x y)))

; Verbose: manual access
(match point
  (case p (+ (nth p 0) (nth p 1))))
```

## Transform Pipeline

```
HQL Source with match
  |
S-expression Parser
  |
Macro Expansion (match -> %match-impl)
  |
Pattern Classification (literal/symbol/array/object)
  |
Condition Generation (type checks, length checks)
  |
Body Generation (bindings, guards)
  |
IR Nodes (nested if expressions)
  |
ESTree AST (ternary operators)
  |
JavaScript
```

## Related Features

- **`cond`** - Multi-way conditional (simpler than match)
- **`if-let`** - Conditional binding
- **`when-let`** - Conditional execution with binding
- **Destructuring** - Used by match for array/object patterns

## Edge Cases Handled

- Empty arrays `[]`
- Single-element arrays `[x]`
- Rest patterns with minimum elements `[h, & t]`
- Nested destructuring `[[a, b], [c, d]]`
- Object with array values `{coords: [x, y]}`
- Guards referencing bound variables
- Multiple guards in sequence
- Null literal pattern
- Wildcard with guard (unusual but supported)

## Limitations

- No literal value matching in object patterns (use guards instead)
- No `or` patterns like `(case (1 | 2 | 3) ...)`
- No type patterns (use guards with `typeof`)
- No exhaustiveness checking

## Future Enhancements

- Or-patterns: `(case (| 1 2 3) "small")`
- Type patterns: `(case (: x String) ...)`
- Exhaustiveness checking for enums
- View patterns: `(case (view fn pattern) ...)`
- Active patterns for custom matching logic
