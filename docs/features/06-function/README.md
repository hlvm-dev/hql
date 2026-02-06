# Function Feature Documentation

**Implementation:** `src/hql/transpiler/syntax/function.ts`, `src/hql/transpiler/pipeline/transform/async-generators.ts`

> See [`spec.md`](./spec.md) for the definitive reference on function parameter syntax.

## Overview

HQL provides function support with these features:

1. **Basic functions** - Named and anonymous functions via `fn`
2. **defn** - Alias for `fn` (used in REPL memory persistence)
3. **Arrow lambda shorthand** - Concise `=>` syntax with `$0, $1, $2` params
4. **Default parameters** - Optional arguments with default values in positional params `[x = 10]`
5. **Rest parameters** - Variable-length argument lists (`& rest`)
6. **JSON map parameters** - Config-style functions with `{key: default}` syntax
7. **Placeholders** - Skip arguments with `_` to use defaults (positional only)
8. **Multi-arity functions** - Different implementations per argument count
9. **Return statements** - Explicit and implicit returns
10. **Closures** - Functions capturing outer scope
11. **Higher-order functions** - Functions as arguments/return values
12. **Recursive functions** - Self-referencing functions
13. **Type annotations** - Parameter and return type annotations
14. **Generic type parameters** - `<T>` syntax on function names
15. **Destructuring parameters** - Array/object patterns in parameter lists
16. **Generator functions** - `fn*` with `yield`/`yield*`
17. **Async generators** - `async fn*` for async iteration

All functions compile to JavaScript functions with ES6+ support.

## Syntax Flexibility

HQL supports both Lisp-style and JSON-style syntax for map parameters and data literals:

### Lisp Style (Preferred)

```lisp
// Map parameters - unquoted keys, no commas
(fn connect {host: "localhost" port: 8080 ssl: false}
  (+ (if ssl "https" "http") "://" host ":" port))

// Map call - unquoted keys
(connect {host: "api.example.com" ssl: true})

// Arrays - no commas
[1 2 3 4 5]

// Hash-maps - unquoted keys, no commas
{name: "Alice" age: 25 city: "NYC"}
```

### JSON Style (Also Supported)

```lisp
// Map parameters - quoted keys, commas
(fn connect {"host": "localhost", "port": 8080, "ssl": false}
  (+ (if ssl "https" "http") "://" host ":" port))

// Map call - quoted keys, commas
(connect {"host": "api.example.com", "ssl": true})

// Arrays - commas
[1, 2, 3, 4, 5]

// Hash-maps - quoted keys, commas
{"name": "Alice", "age": 25, "city": "NYC"}
```

Both styles compile to identical JavaScript.

---

## Syntax

### Basic Functions

```lisp
// Named function
(fn add [a b]
  (+ a b))

(add 3 5)  // => 8

// Anonymous function
(let square (fn [x] (* x x)))
(square 5)  // => 25

// No parameters
(fn get-value []
  42)

// Single parameter
(fn double [x]
  (* x 2))
```

### defn (Alias for fn)

`defn` is an alias for `fn`, primarily used for REPL memory persistence:

```lisp
(defn add [a b]
  (+ a b))

// Equivalent to:
(fn add [a b]
  (+ a b))
```

### Arrow Lambda Shorthand (`=>`)

Concise arrow lambda syntax with Swift-style `$N` parameters:

```lisp
// Implicit parameters ($0, $1, $2...)
(let double (=> (* $0 2)))
(double 5)  // => 10

(let add (=> (+ $0 $1)))
(add 3 7)   // => 10

// With map/filter/reduce
(map (=> (* $0 2)) [1 2 3 4 5])        // => [2 4 6 8 10]
(filter (=> (> $0 5)) [1 3 6 8 2 9])   // => [6 8 9]
(reduce (=> (+ $0 $1)) 0 [1 2 3 4 5])  // => 15

// Member access
(let users [{name: "Alice"}, {name: "Bob"}])
(map (=> ($0.name)) users)  // => ["Alice", "Bob"]

// Explicit parameters (both bracket and paren syntax work)
(let square (=> [x] (* x x)))
(square 7)  // => 49

(let multiply (=> (x y) (* x y)))
(multiply 6 7)  // => 42

// Zero parameters
(let get-value (=> () 42))
(get-value)  // => 42
```

### Default Parameters (Positional Style)

Default values use `=` syntax inside positional parameter lists:

```lisp
(fn multiply [x = 10 y = 20]
  (* x y))

(multiply)          // => 200 (10 * 20)
(multiply 5)        // => 100 (5 * 20)
(multiply 5 3)      // => 15  (5 * 3)
(multiply _ 7)      // => 70  (10 * 7) - placeholder skips to default
```

### JSON Map Parameters

For config-style functions with many parameters, use map syntax. All keys must have defaults:

```lisp
(fn connect {host: "localhost" port: 8080 ssl: false}
  (if ssl
    (+ "https://" host ":" port)
    (+ "http://" host ":" port)))

// Call with all defaults
(connect)  // => "http://localhost:8080"

// Override specific keys
(connect {host: "api.example.com" ssl: true port: 443})
// => "https://api.example.com:443"

// Partial override
(connect {port: 3000})  // => "http://localhost:3000"

// JSON style also works
(connect {"host": "api.example.com", "ssl": true, "port": 443})
```

### Rest Parameters

```lisp
// Rest only
(fn sum [& rest]
  (.reduce rest (fn [acc val] (+ acc val)) 0))

(sum 1 2 3 4 5)  // => 15

// With regular params
(fn sum [x y & rest]
  (+ x y (.reduce rest (fn [acc val] (+ acc val)) 0)))

(sum 10 20 1 2 3)  // => 36
```

### Placeholders

Use `_` to skip arguments and use their default values (positional params with defaults only):

```lisp
(fn calc [a = 1 b = 2 c = 3 d = 4]
  (+ a b c d))

(calc _ _ 30 _)  // => 37 (a=1, b=2, c=30, d=4)
(calc _ _ _ _)   // => 10 (all defaults: 1 + 2 + 3 + 4)
```

### Multi-Arity Functions

Define different implementations based on argument count:

```lisp
// Named multi-arity
(fn greet
  ([] "Hello!")
  ([name] (+ "Hello, " name "!"))
  ([greeting name] (+ greeting ", " name "!")))

(greet)              // => "Hello!"
(greet "Alice")      // => "Hello, Alice!"
(greet "Hi" "Bob")   // => "Hi, Bob!"

// Anonymous multi-arity
(let handler (fn
  ([] "no args")
  ([x] (+ "one: " x))
  ([x y] (+ "two: " x " " y))))
```

Multi-arity functions compile to a switch on `arguments.length`. A rest parameter clause becomes the default case. If no arity matches and there is no rest clause, an error is thrown.

### Destructuring Parameters

Array and object destructuring patterns work in parameter lists:

```lisp
(fn process [[a b] c]
  (+ a b c))

(fn swap [[x y]]
  [y x])
```

### Type Annotations

Parameters and return types support TypeScript-style annotations:

```lisp
// Parameter type annotation (no space after colon)
(fn add [a:number b:number]
  (+ a b))

// Return type annotation on function name
(fn add:number [a b]
  (+ a b))

// Return type annotation after parameter list
(fn add [a b] :number
  (+ a b))

// Generic type parameters
(fn identity<T> [x:T] :T
  x)
```

### Return Statements

```lisp
// Implicit return (last expression)
(fn double [x]
  (* x 2))

// Explicit return
(fn double [x]
  (return (* x 2)))

// Early return
(fn safe-divide [a b]
  (if (=== b 0)
    (return 0)
    (/ a b)))

// Multiple return paths
(fn classify [x]
  (cond
    ((< x 0) (return "negative"))
    ((=== x 0) (return "zero"))
    ((> x 0) (return "positive"))))
```

### Closures

```lisp
// Capturing outer variable
(let x 10)
(fn add-x [n]
  (+ n x))

(add-x 5)  // => 15

// Closure with state
(fn make-counter []
  (var count 0)
  (fn []
    (= count (+ count 1))
    count))

(var counter (make-counter))
(counter)  // => 1
(counter)  // => 2
```

### Higher-Order Functions

```lisp
// Function returning function
(fn make-adder [n]
  (fn [x] (+ x n)))

(let add5 (make-adder 5))
(add5 10)  // => 15

// Function as argument
(fn apply-twice [f x]
  (f (f x)))

(fn add-one [n] (+ n 1))
(apply-twice add-one 5)  // => 7
```

### Recursive Functions

```lisp
(fn factorial [n]
  (if (<= n 1)
    1
    (* n (factorial (- n 1)))))

(factorial 5)  // => 120
```

### Generator Functions (`fn*`)

Generator functions produce iterators using `yield`:

```lisp
// Named generator
(fn* range [start end]
  (var i start)
  (while (< i end)
    (yield i)
    (= i (+ i 1))))

// Anonymous generator
(fn* []
  (yield 1)
  (yield 2)
  (yield 3))

// Yield without value
(fn* simple []
  (yield)
  (yield 42))

// yield* delegates to another iterator
(fn* combined []
  (yield* [1 2 3])
  (yield 4))

// Infinite sequence
(fn* fibonacci []
  (var a 0)
  (var b 1)
  (while true
    (yield a)
    (var temp b)
    (= b (+ a b))
    (= a temp)))
```

### Async Functions

```lisp
// Async named function
(async fn fetch-data [url]
  (let response (await (js/fetch url)))
  (await (.json response)))

// Async anonymous function
(let fetcher (async fn [url] (await (js/fetch url))))

// Async with map params
(async fn fetch-with-options {url: "" timeout: 5000}
  (await (js/fetch url)))
```

### Async Generator Functions (`async fn*`)

Combine async/await with generators:

```lisp
// Named async generator
(async fn* fetchPages [urls]
  (for-of [url urls]
    (yield (await (fetch url)))))

// Async generator with pagination
(async fn* paginate [startPage maxPages]
  (var page startPage)
  (while (<= page maxPages)
    (const data (await (fetchPage page)))
    (yield data)
    (= page (+ page 1))))

// Anonymous async generator
(async fn* []
  (yield (await (Promise.resolve 1)))
  (yield (await (Promise.resolve 2))))
```

## Implementation Details

### Function Compilation

**HQL:**

```lisp
(fn add [a b]
  (+ a b))
```

**Compiled JavaScript:**

```javascript
function add(a, b) {
  return a + b;
}
```

### Anonymous Functions

**HQL:**

```lisp
(let square (fn [x] (* x x)))
```

**Compiled:**

```javascript
const square = (x) => x * x;
```

Anonymous functions that reference `this` compile to regular `function` expressions instead of arrow functions.

### JSON Map Parameters (with Defaults)

**HQL:**

```lisp
(fn multiply {"x": 10, "y": 20}
  (* x y))
```

**Compiled:**

```javascript
function multiply({ x = 10, y = 20 } = {}) {
  return x * y;
}
```

### Rest Parameters

**HQL:**

```lisp
(fn sum [x y & rest]
  (+ x y (.reduce rest (fn [acc val] (+ acc val)) 0)))
```

**Compiled:**

```javascript
function sum(x, y, ...rest) {
  return x + y + rest.reduce((acc, val) => acc + val, 0);
}
```

### Multi-Arity Functions

**HQL:**

```lisp
(fn greet
  ([] "Hello!")
  ([name] (+ "Hello, " name "!")))
```

**Compiled:**

```javascript
function greet(...__args) {
  switch (__args.length) {
    case 0: {
      return "Hello!";
    }
    case 1: {
      const name = __args[0];
      return "Hello, " + name + "!";
    }
    default:
      throw new Error("No matching arity for function 'greet' with " + __args.length + " arguments");
  }
}
```

### Generator Functions

**HQL:**

```lisp
(fn* range [start end]
  (var i start)
  (while (< i end)
    (yield i)
    (= i (+ i 1))))
```

**Compiled:**

```javascript
function* range(start, end) {
  let i = start;
  while (i < end) {
    yield i;
    i = i + 1;
  }
}
```

### Async Generator Functions

**HQL:**

```lisp
(async fn* fetchItems [urls]
  (for-of [url urls]
    (yield (await (fetch url)))))
```

**Compiled:**

```javascript
async function* fetchItems(urls) {
  for (const url of urls) {
    yield await fetch(url);
  }
}
```

## Test Coverage

### Section 1: Basic Functions (15 tests)

- Simple definition, parameters (none, single, multiple)
- Anonymous functions, nested calls
- Higher-order functions, recursive functions
- Closures, IIFE, function as argument

### Section 2: Default Parameters (6 tests)

- All defaults used, override first/second/both
- Single param defaults, placeholder usage

### Section 3: Rest Parameters (4 tests)

- Rest only, with regular params
- Empty rest array, accessing rest properties

### Section 4: JSON Map Parameters (6 tests)

- Basic definition, all defaults used
- Partial/full override, computed access, nested values

### Section 5: Placeholders (2 tests)

- Multiple placeholders, all placeholders

### Section 6: Comprehensive (1 test)

- Defaults + rest combined

### Section 7: Return Statements (15 tests)

- Implicit/explicit returns, early returns
- Multiple return paths, in nested functions
- In do blocks, conditionals

### Section 8: Validation & Errors (2 tests)

- Named arguments rejected with helpful error
- Error mentions migration options

### Section 9: Syntax Flexibility (16 tests)

- Lisp-style and JSON-style map parameters
- Mixed styles, cross-style calls
- Positional params with/without commas
- Array/hash-map literals in both styles

### Arrow Lambda Tests (26 tests in syntax-arrow-lambda.test.ts)

- Implicit parameters ($0, $1, $2), gaps
- Explicit parameters with both `()` and `[]`
- Integration with map/filter/reduce
- Nested lambdas, complex expressions
- Error cases (no params, missing body, too many params)
- Real-world use cases (sort, find, transform)

### Generator Tests (5 tests in generators.test.ts)

- Anonymous/named generators
- yield with/without value
- yield* delegation
- Iterator usage pattern (fibonacci)

### Async Generator Tests (5 tests in async-generators.test.ts)

- Anonymous/named async generators
- yield* delegation with await
- Pagination pattern, async iteration source

## Summary

HQL functions provide:

- **Named and anonymous functions** via `fn` (and `defn` alias)
- **Arrow lambda shorthand** (`=>` with `$0, $1, $2` params)
- **Default parameters** (`[x = 10 y = 20]` with `_` placeholders)
- **JSON map parameters** (config-style with `{key: default}`)
- **Rest parameters** (`& rest`, like JavaScript `...args`)
- **Multi-arity functions** (dispatch on argument count)
- **Type annotations** (`:type` on params and return)
- **Generic type parameters** (`<T>` on function names)
- **Destructuring parameters** (array/object patterns)
- **Explicit/implicit returns**
- **Closures** (capturing outer scope)
- **Higher-order functions** (functions as values)
- **Recursion** (self-referencing functions)
- **Generator functions** (`fn*` with `yield`/`yield*`)
- **Async functions** (`async fn`)
- **Async generators** (`async fn*`)
