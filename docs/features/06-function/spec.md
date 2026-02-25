# HQL Function Syntax Reference

---

## Parameter Styles (Two Primary Styles)

### Style 1: Positional Parameters `[]`

```lisp
// Named functions
(fn add [x y]
  (+ x y))

(fn greet [name]
  (+ "Hello, " name))

// Anonymous functions
(fn [x y] (+ x y))
(let square (fn [x] (* x x)))

// Empty parameters
(fn get-value []
  42)

// Rest parameters
(fn sum [first & rest]
  (reduce + first rest))

(fn log [level & messages]
  (console.log level messages))

// Destructuring
(fn process [[a b] c]
  (+ a b c))

(fn swap [[x y]]
  [y x])

// Default values (= syntax)
(fn multiply [x = 10 y = 20]
  (* x y))

(fn greet [name = "World"]
  (+ "Hello, " name "!"))
```

**Rules:**
- Uses square brackets `[]`
- Parameters are positional (order matters)
- Rest parameters: `[x & rest]` - ampersand before rest name
- Destructuring: `[[a b] c]` - nested brackets
- Default values: `[x = 10]` - equals sign between name and value
- Placeholders: `_` skips argument to use default

---

### Style 2: JSON Map Parameters `{}`

```lisp
// Lisp style (preferred)
(fn connect {host: "localhost" port: 8080 ssl: false}
  (+ (if ssl "https" "http") "://" host ":" port))

(fn greet {name: "World" greeting: "Hello"}
  (+ greeting ", " name "!"))

// JSON style (also supported)
(fn connect {"host": "localhost", "port": 8080, "ssl": false}
  (+ (if ssl "https" "http") "://" host ":" port))

// Calling map functions
(connect)                            // all defaults
(connect {port: 3000})               // override one
(connect {host: "api.com" ssl: true}) // override multiple
(connect {"host": "api.com"})        // JSON style call
```

**Rules:**
- Uses curly braces `{}`
- All parameters must have defaults
- Lisp-style: `{key: value}` - no quotes, no commas (preferred)
- JSON-style: `{"key": value, ...}` - quoted keys, commas (compatible)
- Call with map: `(fn-name {key: value})`

---

## Multi-Arity Functions

Define different implementations based on argument count:

```lisp
// Named multi-arity
(fn greet
  ([] "Hello!")
  ([name] (+ "Hello, " name "!"))
  ([greeting name] (+ greeting ", " name "!")))

// Anonymous multi-arity
(let handler (fn
  ([] "no args")
  ([x] (+ "one: " x))
  ([x y] (+ "two: " x " " y))))

// Multi-arity with rest parameter (becomes default case)
(fn variadic
  ([x] (+ "one: " x))
  ([x y & rest] (+ "many: " x " " y " +" rest.length)))
```

Each clause is `([params...] body...)`. Dispatches on `arguments.length`. A clause with a rest parameter becomes the default case. If no arity matches, an error is thrown.

Destructuring patterns also work in multi-arity clauses.

---

## Async Functions

```lisp
// Async with positional params
(async fn fetch-data [url]
  (let response (await (js/fetch url)))
  (await (.json response)))

// Async with map params
(async fn fetch-with-options {url: "" timeout: 5000 retries: 3}
  (await (js/fetch url)))

// Async anonymous
(let fetcher (async fn [url] (await (js/fetch url))))

// Await usage
(let data (await (fetch-data "https://api.example.com")))
```

**Rules:**
- Prefix: `async` keyword before `fn`
- Inside body: use `await` for promises
- Same parameter rules as regular `fn`

---

## Generator Functions (`fn*`)

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
```

**Rules:**
- `fn*` creates a generator function (compiles to `function*`)
- `yield` produces a value, `yield*` delegates to another iterable
- Works with both named and anonymous forms
- Same parameter styles as regular `fn`

---

## Async Generator Functions (`async fn*`)

```lisp
// Named async generator
(async fn* fetchPages [urls]
  (for-of [url urls]
    (yield (await (fetch url)))))

// Pagination pattern
(async fn* paginate [startPage maxPages]
  (var page startPage)
  (while (<= page maxPages)
    (const data (await (fetchPage page)))
    (yield data)
    (= page (+ page 1))))
```

**Rules:**
- Combines async/await with generator yield
- Compiles to `async function*`

---

## Arrow Lambda `=>`

```lisp
// Implicit parameters ($0, $1, $2...)
(map (=> (* $0 2)) [1 2 3])           // => [2 4 6]
(filter (=> (> $0 5)) [3 7 2 9])      // => [7 9]
(reduce (=> (+ $0 $1)) 0 [1 2 3])     // => 6

// Property access
(map (=> ($0.name)) users)              // => ["Alice", "Bob"]
(map (=> ($0.address.city)) users)      // nested access

// Explicit parameters (both [] and () work)
(map (=> [x] (* x x)) [1 2 3])        // => [1 4 9]
((=> [x y] (+ x y)) 5 7)              // => 12
((=> (a b c) (+ a b c)) 1 2 3)        // => 6

// Zero parameters
((=> [] 42))                          // => 42
((=> () 42))                          // => 42
```

**Rules:**
- `=>` creates concise inline lambdas
- Implicit: `$0`, `$1`, `$2`... (auto-detected from highest $N)
- Explicit: `(=> [params] body)` or `(=> (params) body)`
- Transforms to regular `fn` during compilation
- Max 255 implicit parameters

---

## defn (Alias for fn)

`defn` is an alias for `fn`. It is used primarily for REPL memory persistence:

```lisp
(defn add [a b]
  (+ a b))

// Equivalent to:
(fn add [a b]
  (+ a b))
```

Supports all features of `fn`: positional params, map params, multi-arity, generators, async, etc.

---

## Type Annotations

Parameters and return types support TypeScript-style annotations:

```lisp
// Parameter type annotation (no space after colon)
(fn add [a:number b:number]
  (+ a b))

// Return type on function name
(fn add:number [a b]
  (+ a b))

// Return type after parameter list
(fn add [a b] :number
  (+ a b))

// Generic type parameters
(fn identity<T> [x:T] :T
  x)

// Multiple generic parameters
(fn pair<T,U> [a:T b:U]
  [a b])
```

Type annotations are passed through to the generated TypeScript output.

---

## Return Statements

```lisp
// Implicit return (last expression)
(fn double [x]
  (* x 2))              // returns (* x 2)

// Explicit return
(fn double [x]
  (return (* x 2)))     // explicit return

// Early return
(fn safe-divide [a b]
  (if (=== b 0)
    (return 0))         // early exit
  (/ a b))              // normal path

// Multiple return paths
(fn classify [x]
  (cond
    ((< x 0) (return "negative"))
    ((=== x 0) (return "zero"))
    (else (return "positive"))))
```

**Rules:**
- Implicit: last expression is returned automatically
- Explicit: `(return expr)` for clarity or early exit
- Works in all function types: fn, async fn, =>

---

## Closures & Higher-Order Functions

```lisp
// Closure (captures outer scope)
(let multiplier 10)
(fn scale [x]
  (* x multiplier))     // captures multiplier

// Function returning function
(fn make-adder [n]
  (fn [x] (+ x n)))     // returns closure

(let add5 (make-adder 5))
(add5 10)               // => 15

// Function as argument
(fn apply-twice [f x]
  (f (f x)))

// Stateful closure
(fn make-counter []
  (var count 0)
  (fn []
    (= count (+ count 1))
    count))
```

---

## Pure Functions (fx)

`fx` declares a function as **pure**, enforced at compile time by the effect system.

```lisp
// Pure function declaration
(fx add [a:number b:number]
  (+ a b))

// Pure functions cannot contain:
// - Impure function calls (I/O, network, DOM, etc.)
// - Mutations (variable reassignment, object mutation)
// - Side effects (console.log, throwing exceptions)
// - Generator yields
```

### Callback Purity Constraints

Parameters can be annotated with purity requirements, ensuring callers pass only pure callbacks:

```lisp
(fx map-pure [f:pure items]
  (map f items))

// Calling with a pure function: OK
(map-pure (fx [x] (* x 2)) [1 2 3])

// Calling with an impure function: compile-time error
(map-pure (fn [x] (console.log x)) [1 2 3])  ;; ERROR
```

### Compile-Time Enforcement

The compiler statically verifies that `fx` bodies contain no impure operations. Violations produce compile-time errors, not runtime exceptions. This enables safe optimizations like memoization and parallelization.

For full details on the effect system, purity inference, and effect annotations, see the [Effect System documentation](../21-effect-system/).

---

## Syntax Reference Table

| Category | Syntax | Example |
|----------|--------|---------|
| **Named Positional** | `(fn name [p1 p2] body)` | `(fn add [x y] (+ x y))` |
| **Named Map (Lisp)** | `(fn name {k: v} body)` | `(fn cfg {port: 8080} port)` |
| **Named Map (JSON)** | `(fn name {"k": v} body)` | `(fn cfg {"port": 8080} port)` |
| **Anonymous Positional** | `(fn [params] body)` | `(fn [x] (* x 2))` |
| **Anonymous Map** | `(fn {k: v} body)` | `(fn {x: 0} (* x 2))` |
| **Multi-Arity** | `(fn name ([] b1) ([x] b2))` | `(fn f ([] 0) ([x] x))` |
| **Async Named** | `(async fn name [p] body)` | `(async fn get [url] ...)` |
| **Async Anonymous** | `(async fn [p] body)` | `(async fn [x] (await x))` |
| **Generator** | `(fn* name [p] body)` | `(fn* gen [n] (yield n))` |
| **Async Generator** | `(async fn* name [p] body)` | `(async fn* ag [x] ...)` |
| **Arrow Implicit** | `(=> body)` | `(=> (* $0 2))` |
| **Arrow Explicit** | `(=> [params] body)` | `(=> [x y] (+ x y))` |
| **Pure Function** | `(fx name [p] body)` | `(fx add [x y] (+ x y))` |
| **defn** | `(defn name [p] body)` | `(defn add [x y] (+ x y))` |
| **Rest Params** | `[x & rest]` | `(fn f [x & rest] ...)` |
| **Defaults** | `[x = val]` | `(fn f [x = 10] x)` |
| **Destructuring** | `[[a b] c]` | `(fn f [[a b] c] ...)` |
| **Type Annotations** | `[x:type]` | `(fn f [x:number] x)` |
| **Generics** | `name<T>` | `(fn id<T> [x:T] x)` |
| **Return** | `(return expr)` | `(return (* x 2))` |

---

## Feature Support Table

| Feature             | Supported  |
| ------------------- | ---------- |
| Positional Params   | Yes |
| Map Params          | Yes |
| Default Values (positional) | Yes |
| Default Values (map) | Yes (all required) |
| Rest Parameters     | Yes |
| Placeholders (`_`)  | Yes (positional only) |
| Multi-Arity         | Yes |
| Destructuring       | Yes |
| Type Annotations    | Yes |
| Generic Type Params | Yes |
| Closures            | Yes |
| Higher-Order        | Yes |
| Generator (fn*)     | Yes |
| Async (async fn)    | Yes |
| Async Generator     | Yes |
| Pure Function (fx)  | Yes |
| defn alias          | Yes |
| Arrow Lambda (=>)   | Yes |
| Lisp Map Syntax     | Yes (preferred) |
| JSON Map Syntax     | Yes (compatible) |

## When to Use Each Style

- **Use positional `[]`** for simple functions with ordered parameters
- **Use map `{}`** for config-style functions with many optional parameters
- **Use `=>`** for short inline lambdas in map/filter/reduce
- **Use multi-arity** when a function needs different behavior per argument count
- **Use `fn*`** for lazy/streaming sequences
- **Use `async fn*`** for async streaming
