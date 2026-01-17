# Macro Feature Documentation

**Implementation:** Transpiler macro system and quote transformers **Test
Count:** **Coverage:** ✅ 100%

## Overview

HQL provides a powerful macro system for metaprogramming and code generation:

1. **`quote`** - Prevent evaluation, treat code as data
2. **`quasiquote`** - Template with selective evaluation (interpolation)
3. **`unquote`** - Evaluate expression within quasiquote
4. **`unquote-splicing`** - Splice array into template
5. **Backtick syntax** - Shorthand notation (`` ` `` for quasiquote, `~` for
   unquote)
6. **`macro`** - Define compile-time transformations

All macro operations happen at **compile time**, generating code before runtime.

## Syntax

### Quote - Code as Data

```lisp
; Basic quote
(quote x)                    ; => "x" (symbol as string)
(quote 42)                   ; => 42 (number)
(quote "hello")              ; => "hello" (string)
(quote true)                 ; => true (boolean)

; Quote lists
(quote ())                   ; => [] (empty array)
(quote (a b c))              ; => ["a", "b", "c"] (symbols as strings)
(quote (a (b c) d))          ; => ["a", ["b", "c"], "d"] (nested)
```

### Quasiquote - Templates with Interpolation

```lisp
; Quasiquote without unquote (acts like quote)
(quasiquote (a b c))         ; => ["a", "b", "c"]

; Quasiquote with unquote (evaluate expression)
(var x 10)
(quasiquote (a (unquote x) c))  ; => ["a", 10, "c"]

; Multiple unquotes
(var x 5)
(var y 10)
(quasiquote ((unquote x) (unquote y) (unquote (+ x y))))
; => [5, 10, 15]

; Unquote-splicing (splice array into template)
(var nums [1, 2, 3])
(quasiquote (a (unquote-splicing nums) b))
; => ["a", 1, 2, 3, "b"]

; Multiple unquote-splicings
(var first [1, 2])
(var second [3, 4])
(quasiquote ((unquote-splicing first) (unquote-splicing second)))
; => [1, 2, 3, 4]
```

### Backtick Syntax (Shorthand)

```lisp
; Backtick for quasiquote
`(a b c)                     ; => ["a", "b", "c"]

; Tilde (~) for unquote
(var x 42)
`(result is ~x)              ; => ["result", "is", 42]

; ~@ for unquote-splicing
(var items ["apple", "banana", "cherry"])
`(fruits: ~@items)           ; => ["fruits:", "apple", "banana", "cherry"]
```

### Macros - Compile-Time Transformations

```lisp
; Define a macro
(macro when [condition body]
  `(if ~condition ~body null))

; Use the macro
(var x 10)
(when (> x 5) "x is greater than 5")  ; => "x is greater than 5"

; Macro with variadic arguments (using unquote-splicing)
(macro log-all [items]
  `(do ~@items))

(log-all ((var a 1) (var b 2) (+ a b)))  ; => 3
```

## Implementation Details

### Quote

**Compilation:**

```lisp
(quote expr)

; Compiles to:
; - Symbols → strings
; - Numbers → numbers
; - Strings → strings
; - Booleans → booleans
; - Lists → arrays (recursively quoted)
```

**Characteristics:**

- ✅ Prevents evaluation
- ✅ Converts code to data
- ✅ Symbols become strings
- ✅ Lists become arrays
- ✅ Recursive for nested structures

### Quasiquote

**Compilation:**

```lisp
(quasiquote (a (unquote x) (unquote-splicing ys)))

; Compiles to:
["a", x, ...ys]  // Spread operator for splicing
```

**Characteristics:**

- ✅ Template with selective evaluation
- ✅ `unquote` evaluates single expression
- ✅ `unquote-splicing` splices array elements
- ✅ Nestable
- ✅ Foundation for macro system

### Backtick Syntax

**Reader Transformation:**

```lisp
`(a ~x ~@ys)

; Transformed by reader to:
(quasiquote (a (unquote x) (unquote-splicing ys)))
```

**Characteristics:**

- ✅ Syntactic sugar for quasiquote
- ✅ More concise than full form
- ✅ `` ` `` → `quasiquote`
- ✅ `~` → `unquote`
- ✅ `~@` → `unquote-splicing`

### Macros

**Expansion:**

```lisp
(macro name [params]
  body)

; At compile time:
; 1. Parse macro call
; 2. Bind arguments
; 3. Evaluate body (quasiquote/unquote)
; 4. Replace call with result
; 5. Continue compilation
```

**Characteristics:**

- ✅ Compile-time code generation
- ✅ Expand before runtime
- ✅ Full language available for generation
- ✅ Hygienic (respects lexical scope)
- ✅ Composable with other macros

## Features Covered

### Quote System
✅ Quote symbols, numbers, strings, booleans, null
✅ Quote empty lists and nested lists
✅ Quasiquote without unquote (like quote)
✅ Quasiquote with unquote (evaluation)
✅ Multiple unquotes in template
✅ Unquote-splicing for array spreading
✅ Multiple unquote-splicings
✅ Backtick syntax shorthand
✅ Tilde (~) for unquote
✅ ~@ for unquote-splicing
✅ Macros using quasiquote
✅ Macros with unquote-splicing
✅ Nested quasiquotes
✅ Complex expressions in unquote

### Core Macros (from core.hql)
✅ Threading macros (`->`, `->>`, `as->`)
✅ Logic macros (`and`, `or`, `not`)
✅ Conditional macros (`when`, `unless`, `if-let`, `when-let`, `cond`)
✅ Type predicates (`isNull`, `isNil`, `isUndefined`, `isDefined`, `notNil`)
✅ Type checks (`isString`, `isNumber`, `isBoolean`, `isFunction`, `isSymbol`, `isArray`, `isObject`)
✅ Utility macros (`inc`, `dec`, `print`, `str`, `length`, `list`, `contains`)
✅ Collection macros (`hash-map`, `empty-map`, `empty-set`, `empty-array`, `hasElements`, `isEmptyList`)
✅ Pattern matching (`match` with `case`, `default`, guards)

### Utility Macros (from utils.hql)
✅ Object chaining (`doto`)
✅ Inverse conditionals (`if-not`, `when-not`)
✅ Logical XOR (`xor`)
✅ Math wrappers (`min`, `max`)

## Test Coverage



### Section 1: Quote - Preventing Evaluation

- Quote symbol returns string
- Quote number returns number
- Quote string returns string
- Quote boolean returns boolean
- Quote null literal
- Quote empty list
- Quote list of symbols
- Quote nested list

### Section 2: Quasiquote - Template with Interpolation

- Quasiquote without unquote (like quote)
- Quasiquote with unquote (evaluation)
- Multiple unquotes
- Unquote-splicing
- Multiple unquote-splicings

### Section 3: Backtick Syntax

- Backtick without tilde (like quote)
- Backtick with tilde (~) for unquote
- Backtick with ~@ for unquote-splicing

### Section 4: Quote in Macro Contexts

- Macro using quasiquote and unquote
- Macro with unquote-splicing for variadic arguments

### Section 5: Nested Quasiquotes

- Nested quasiquote with unquote
- Quasiquote with complex expression

## Use Cases

### 1. Code Generation

```lisp
; Generate repetitive code
(macro defgetter [name field]
  `(fn ~name [] this.~field))

; Expands to:
(fn getName [] this.name)
```

### 2. Control Flow Extensions

```lisp
; Custom control structures
(macro unless [condition body]
  `(if (not ~condition) ~body null))

(unless (< x 0)
  (print "x is non-negative"))
```

### 3. DSL Creation

```lisp
; Domain-specific language
(macro route [method path handler]
  `(app.~method ~path ~handler))

(route GET "/api/users" handleUsers)
```

### 4. Assertion Helpers

```lisp
; Expressive test assertions
(macro assert-equals [actual expected]
  `(if (!= ~actual ~expected)
     (throw (new Error (+ "Expected " ~expected " but got " ~actual)))
     null))
```

### 5. Logging with Context

```lisp
; Auto-inject source location
(macro log-debug [message data]
  `(console.log "[DEBUG]" ~message ~data))
```

### 6. Configuration DSL

```lisp
; Environment-based config
(macro config [env settings]
  `(if (=== process.env.NODE_ENV ~env)
     ~settings
     null))
```

## Comparison with Other Languages

### Lisp-Style Quasiquote

```lisp
`(a ~x ~@ys)
```

### JavaScript Template Literals

```javascript
// JavaScript (runtime interpolation)
const x = 42;
const result = `The answer is ${x}`;  // String only

// HQL quasiquote (compile-time, code generation)
(var x 42)
`(the answer is ~x)  // => ["the", "answer", "is", 42]
```

### TypeScript Decorators

```typescript
// TypeScript decorator (limited to classes/methods)
@Log
class Service { }

// HQL macro (arbitrary code transformation)
(macro with-logging [fn-def]
  `(do
    (var original ~fn-def)
    (fn wrapper [args]
      (console.log "Calling:" original.name)
      (original ~@args))))
```

## Related Specs

- Complete macro specification available in project specs
- Transpiler macro expansion implementation in macro system
- Quote transformers in quote processing module

## Examples

See `examples.hql` for executable examples.

## Transform Pipeline

```
HQL Source with Macros
  ↓
Reader (backtick → quasiquote, tilde → unquote)
  ↓
Macro Expansion (compile-time)
  ↓
Quote Transformation (code → data)
  ↓
IR Nodes
  ↓
ESTree AST
  ↓
JavaScript
```

## Best Practices

### Use Macros Sparingly

```lisp
; ✅ Good: Simple helper function (no macro needed)
(fn unless [condition body]
  (if (not condition) body null))

; ⚠️ Overkill: Macro for simple function
(macro unless [condition body]
  `(if (not ~condition) ~body null))
```

### Quote When You Need Code as Data

```lisp
; ✅ Good: Code generation
(macro defgetter [name field]
  `(fn ~name [] this.~field))

; ❌ Wrong: Regular function (not code generation)
(fn defgetter [name field]
  (fn [] this.field))  // Loses parameterization
```

### Prefer Backtick Syntax

```lisp
; ✅ Good: Concise backtick
`(if ~condition ~then ~else)

; ❌ Verbose: Full form
(quasiquote (if (unquote condition) (unquote then) (unquote else)))
```

### Use Unquote-Splicing for Lists

```lisp
; ✅ Good: Splice array elements
`(do ~@statements)  ; => (do stmt1 stmt2 stmt3)

; ❌ Wrong: Unquote entire array
`(do ~statements)   ; => (do [stmt1, stmt2, stmt3])
```

## Edge Cases Tested

✅ Quote of primitives (numbers, strings, booleans) ✅ Quote of symbols (becomes
strings) ✅ Quote of null (becomes string "null") ✅ Quote of empty list ✅
Quote of nested lists ✅ Quasiquote without unquote (like quote) ✅ Single and
multiple unquotes ✅ Single and multiple unquote-splicings ✅ Backtick syntax
shorthand ✅ Macros with quasiquote ✅ Nested quasiquotes ✅ Complex expressions
in unquote

## Common Patterns

### 1. Conditional Code Generation

```lisp
(macro when [condition body]
  `(if ~condition ~body null))

(when (> x 5) (print "Large"))
```

### 2. Variadic Wrapper

```lisp
(macro with-timing [body]
  `(do
    (var start (Date.now))
    ~@body
    (var end (Date.now))
    (console.log "Elapsed:" (- end start))))
```

### 3. DSL for Configuration

```lisp
(macro route [method path handler]
  `(app.~method ~path ~handler))

(route GET "/users" getUsers)
(route POST "/users" createUser)
```

### 4. Assertion Helpers

```lisp
(macro assert-type [value type]
  `(if (!= (typeof ~value) ~type)
     (throw (new Error (+ "Expected " ~type)))
     null))
```

## Built-in Core Macros

HQL includes a comprehensive set of core macros in `src/hql/lib/macro/core.hql`. These are automatically available in all HQL programs.

### Threading Macros

Threading macros transform nested function calls into readable linear pipelines. They are **compile-time transformations** with zero runtime overhead.

#### Thread-First (`->`)

Inserts the value as the **first argument** of each form:

```lisp
; Basic threading
(-> 5 inc inc)                    ; => 7 (same as (inc (inc 5)))

; With function calls
(-> "hello"
    (.toUpperCase)
    (.substring 0 3))             ; => "HEL"

; Complex pipeline
(-> user
    (get-profile)
    (update-name "Alice")
    (save))

; Compilation:
; (-> x (f a) (g b)) => (g (f x a) b)
```

#### Thread-Last (`->>`)

Inserts the value as the **last argument** of each form:

```lisp
; With collections
(->> [1 2 3 4 5]
     (filter isOdd)
     (map double))                ; => [2 6 10]

; String processing
(->> items
     (filter active?)
     (map get-name)
     (join ", "))

; Compilation:
; (->> x (f a) (g b)) => (g b (f a x))
```

#### Thread-As (`as->`)

Binds the value to a symbol for arbitrary placement:

```lisp
; Place value anywhere
(as-> 2 x
  (+ x 1)                         ; x is 2, result is 3
  (* 10 x)                        ; x is 3, result is 30
  (- x 5))                        ; x is 30, result is 25

; Mixed positioning
(as-> user u
  (get-id u)                      ; thread-first style
  (fetch-data u)
  (process id: u name: "test"))   ; arbitrary position
```

### Logic Macros

#### `and` - Logical AND with short-circuit

```lisp
(and)                             ; => true (identity)
(and x)                           ; => x
(and x y z)                       ; => (&& (&& x y) z)

; Short-circuit evaluation
(and (> x 0) (< x 10))           ; Only evaluates second if first is truthy
```

#### `or` - Logical OR with short-circuit

```lisp
(or)                              ; => false (identity)
(or x)                            ; => x
(or x y z)                        ; => (|| (|| x y) z)

; Default value pattern
(or user.name "Anonymous")        ; Use name or default
```

#### `not` - Logical negation

```lisp
(not true)                        ; => false
(not false)                       ; => true
(not value)                       ; => (if value false true)
```

### Conditional Macros

#### `when` - Single-branch conditional

```lisp
(when condition
  (print "It's true!")
  (do-something))                 ; Only executes if condition is truthy

; Compiles to:
; (if condition (do ...) nil)
```

#### `unless` - Inverse conditional

```lisp
(unless error
  (process data)
  (save result))                  ; Only executes if error is falsy

; Compiles to:
; (if error nil (do ...))
```

#### `if-let` - Conditional binding

```lisp
; Only execute then-branch if binding is truthy
(if-let [user (find-user id)]
  (greet user)                    ; user is bound and truthy
  (print "User not found"))       ; else branch

; Bracket or paren syntax both work
(if-let (result (compute))
  (use result)
  (handle-error))
```

#### `when-let` - Conditional binding (single branch)

```lisp
; Only execute body if binding is truthy
(when-let [data (fetch-data)]
  (process data)
  (save data))                    ; Only if data is truthy

; Useful for optional chaining
(when-let [user (get-user)]
  (when-let [email user.email]
    (send-notification email)))
```

#### `cond` - Multi-branch conditional

```lisp
; Multiple conditions
(cond
  ((< x 0) "negative")
  ((=== x 0) "zero")
  ((> x 0) "positive")
  (else "unknown"))               ; else clause is optional

; Flat syntax also supported
(cond
  (< x 0) "negative"
  (=== x 0) "zero"
  true "positive")
```

### Type Predicate Macros

All type predicates compile to **optimal inline JavaScript** with zero function call overhead.

#### Nullish Checks

```lisp
(isNull x)                        ; => (=== x null)
(isUndefined x)                   ; => (=== x undefined)
(isNil x)                         ; => (== x null)  ; catches null AND undefined
(isDefined x)                     ; => (!== x undefined)
(notNil x)                        ; => (!= x null)  ; neither null nor undefined
```

#### Type Checks

```lisp
(isString x)                      ; => (=== (typeof x) "string")
(isNumber x)                      ; => (=== (typeof x) "number")
(isBoolean x)                     ; => (=== (typeof x) "boolean")
(isFunction x)                    ; => (=== (typeof x) "function")
(isSymbol x)                      ; => (=== (typeof x) "symbol")
(isArray x)                       ; => (Array.isArray x)
(isObject x)                      ; => typeof object, not null, not array
```

### Utility Macros

#### `inc` / `dec` - Increment/Decrement

```lisp
(inc x)                           ; => (+ x 1)
(dec x)                           ; => (- x 1)

; Common usage
(var count 0)
(set count (inc count))           ; count is now 1
```

#### `print` - Console logging

```lisp
(print "Hello")                   ; => console.log("Hello")
(print "Value:" x)                ; => console.log("Value:", x)
(print a b c)                     ; => console.log(a, b, c)
```

#### `str` - String concatenation

```lisp
(str)                             ; => ""
(str x)                           ; => (+ "" x)  ; coerce to string
(str "Hello" " " name)            ; => (+ "Hello" " " name)
```

#### `length` - Collection length

```lisp
(length arr)                      ; => arr.length (null-safe)
(length null)                     ; => 0
```

#### `list` - Create array

```lisp
(list 1 2 3)                      ; => [1, 2, 3]
(list)                            ; => []
```

#### `contains` - Map/Set membership

```lisp
(contains myMap key)              ; => myMap.has(key)
(contains mySet value)            ; => mySet.has(value)
```

### Collection Macros

```lisp
(hash-map "a" 1 "b" 2)            ; => {a: 1, b: 2}
(empty-map)                       ; => {}
(empty-set)                       ; => new Set()
(empty-array)                     ; => []

(hasElements coll)                ; => (> (length coll) 0)
(isEmptyList coll)                ; => (=== (length coll) 0)
```

### Pattern Matching (`match`)

The `match` macro provides powerful pattern matching similar to Swift/Scala:

```lisp
; Basic literal matching
(match value
  (case 1 "one")
  (case 2 "two")
  (default "other"))

; Symbol binding
(match result
  (case x (print "Got:" x)))      ; x binds to result

; Wildcard pattern
(match value
  (case _ "anything"))            ; _ matches but doesn't bind

; Array destructuring
(match [1 2 3]
  (case [a b c] (+ a b c)))       ; => 6

; Rest pattern
(match [1 2 3 4 5]
  (case [h & t] (list h t)))      ; => [1, [2, 3, 4, 5]]

; Object destructuring
(match {name: "Alice", age: 30}
  (case {name age} (str name " is " age)))

; Guards
(match value
  (case n (if (> n 0)) "positive")
  (case n (if (< n 0)) "negative")
  (default "zero"))

; Complex example
(match response
  (case {status: 200, data} (process data))
  (case {status: 404} (handle-not-found))
  (case {status: s, error} (if (>= s 500)) (log-error error))
  (default (throw "Unknown response")))
```

**Supported patterns:**
- Literals: `42`, `"hello"`, `true`, `null`
- Wildcard: `_` (matches anything, no binding)
- Symbol: `x` (matches anything, binds to x)
- Array: `[a b]`, `[]`, `[h & t]` (rest pattern)
- Object: `{name age}`, `{name: n, age: a}` (with rename)

**Guards:** `(if condition)` checked after pattern match

### Utility Macros (from utils.hql)

Additional utility macros available from the utils library:

#### `doto` - Execute Forms and Return Object

Executes forms with x as the first argument, then returns x:

```lisp
; Chain method calls, return the object
(doto (new Map)
  (.set "a" 1)
  (.set "b" 2)
  (.set "c" 3))   ; => Map with 3 entries

; Object initialization
(doto {}
  (= .name "Alice")
  (= .age 30))    ; => {name: "Alice", age: 30}

; Array mutations
(doto []
  (.push 1)
  (.push 2)
  (.push 3))      ; => [1, 2, 3]
```

#### `if-not` - Inverse of If

Swaps the then and else branches:

```lisp
(if-not condition then else)
; Equivalent to: (if condition else then)

(if-not (isEmpty list)
  (process list)
  (print "empty"))
```

#### `when-not` - Inverse of When

Execute body when condition is false:

```lisp
(when-not error
  (continue-processing)
  (save-results))

; Equivalent to: (if error nil (do ...))
```

#### `xor` - Logical XOR

Exclusive OR - true if exactly one operand is truthy:

```lisp
(xor true false)   ; => true
(xor true true)    ; => false
(xor false false)  ; => false
(xor a b)          ; => (if a (not b) b)
```

#### `min` / `max` - Math Functions

Wrapper macros for JavaScript Math functions:

```lisp
(min 1 2 3)        ; => 1 (Math.min(1, 2, 3))
(max 1 2 3)        ; => 3 (Math.max(1, 2, 3))

; With expressions
(min (+ a 1) (- b 2) c)
```

## Future Enhancements

- Symbol hygiene (gensym for collision-free generated names)
- Macro debugging (expand-macro utility)
- Syntax-quote with auto-gensym
- Macro namespaces (avoid collision)
- Compile-time warnings for macro misuse

## Performance Considerations

**Compile-Time vs Runtime:**

- ✅ Macros expand at compile time (zero runtime cost)
- ✅ Quote generates literal data (no runtime interpretation)
- ✅ Quasiquote produces efficient code (no template overhead)

**Best Practices:**

- Use macros for code generation (not runtime logic)
- Avoid deeply nested quasiquotes (harder to understand)
- Test macro expansions (verify generated code)

## Debugging Macros

**Understanding Expansion:**

```lisp
; To understand what a macro generates:
; 1. Read the macro definition
; 2. Trace the quasiquote template
; 3. Substitute unquoted expressions
; 4. Verify the result makes sense

(macro when [condition body]
  `(if ~condition ~body null))

; Call:
(when (> x 5) (print "yes"))

; Expands to:
(if (> x 5) (print "yes") null)
```

**Common Mistakes:**

- Forgetting unquote (binding not evaluated)
- Wrong splice (unquote-splicing on non-array)
- Hygiene issues (generated names collide)

## Security Considerations

**Code Injection:**

- ✅ Macros are compile-time only (no runtime eval)
- ✅ Cannot inject code from user input at runtime
- ✅ All expansion happens during compilation

**Safe Usage:**

- Macros transform AST nodes (not strings)
- No string concatenation for code generation
- Hygiene prevents variable capture

## Related Features

- **Functions**: Runtime abstraction (vs macros: compile-time)
- **Conditionals**: If/cond (macros can generate them)
- **Loops**: For/while (macros can generate them)
- **Classes**: Macros can generate class definitions

## Learning Path

1. **Start with quote**: Understand code as data
2. **Learn quasiquote**: Template with interpolation
3. **Practice backtick**: More convenient syntax
4. **Write simple macros**: when, unless, etc.
5. **Advanced patterns**: DSLs, code generation

## Summary

HQL's macro system enables:

- ✅ **Compile-time code generation** (zero runtime cost)
- ✅ **Metaprogramming** (code that writes code)
- ✅ **DSL creation** (domain-specific languages)
- ✅ **Control flow extension** (new constructs)
- ✅ **Boilerplate reduction** (generate repetitive code)

All with the full power of the HQL language at compile time.
