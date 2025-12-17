# Function Feature Documentation

**Implementation:** Transpiler function syntax transformers
**Coverage:** ✅ 100%

> **📋 Source of Truth:** See [`spec.md`](./spec.md) for the definitive THESIS on function parameter syntax (two styles: `[]` positional and `{}` JSON map).

## Overview

HQL provides comprehensive function support with modern features:

1. **Basic functions** - Named and anonymous functions
2. **Arrow lambda shorthand** - Concise `=>` syntax with `$0, $1, $2` params
3. **Default parameters** - Optional arguments with default values
4. **Rest parameters** - Variable-length argument lists (`& rest`)
5. **JSON map parameters** - Config-style functions with `{key: default}` syntax
6. **Placeholders** - Skip arguments with `_` to use defaults
7. **Return statements** - Explicit and implicit returns
8. **Closures** - Functions capturing outer scope
9. **Higher-order functions** - Functions as arguments/return values
10. **Recursive functions** - Self-referencing functions

All functions compile to JavaScript functions with full ES6 support.

## Syntax Flexibility

HQL supports **both Lisp-style and JavaScript-style syntax** for maximum compatibility:

### ✅ Preferred: Pure Lisp Style

**Use this in HQL codebases** for concise, elegant code:

```lisp
;; Map parameters - unquoted keys, no commas
(fn connect {host: "localhost" port: 8080 ssl: false}
  (+ (if ssl "https" "http") "://" host ":" port))

;; Map call - unquoted keys
(connect {host: "api.example.com" ssl: true})

;; Arrays - no commas
[1 2 3 4 5]

;; Hash-maps - unquoted keys, no commas
{name: "Alice" age: 25 city: "NYC"}
```

### ✅ Also Supported: Strict JSON Style

**Perfect for copy-pasting** from APIs or JSON configs:

```lisp
;; Map parameters - quoted keys, commas
(fn connect {"host": "localhost", "port": 8080, "ssl": false}
  (+ (if ssl "https" "http") "://" host ":" port))

;; Map call - quoted keys, commas
(connect {"host": "api.example.com", "ssl": true})

;; Arrays - commas
[1, 2, 3, 4, 5]

;; Hash-maps - quoted keys, commas
{"name": "Alice", "age": 25, "city": "NYC"}
```

### 🎨 Why Both?

Following **Clojure's proven approach** (15+ years production use):
- **Maximum compatibility:** Copy-paste JSON works immediately
- **Developer choice:** Write what feels natural
- **No cost:** Both compile to identical JavaScript
- **Best of both worlds:** Lisp elegance + JS familiarity

**Recommendation:** Use Lisp style for new code (examples below use this). JSON style works anytime for compatibility.

---

## Syntax

### Basic Functions

```lisp
; Named function
(fn add [a b]
  (+ a b))

(add 3 5)  ; → 8

; Anonymous function
(let square (fn [x] (* x x)))
(square 5)  ; → 25

; No parameters
(fn get-value []
  42)

; Single parameter
(fn double [x]
  (* x 2))
```

### Arrow Lambda Shorthand (`=>`)

HQL provides concise arrow lambda syntax with Swift-style `$N` parameters:

```lisp
; Implicit parameters ($0, $1, $2...)
(let double (=> (* $0 2)))
(double 5)  ; → 10

(let add (=> (+ $0 $1)))
(add 3 7)   ; → 10

; With map/filter/reduce
(map (=> (* $0 2)) [1 2 3 4 5])        ; → [2 4 6 8 10]
(filter (=> (> $0 5)) [1 3 6 8 2 9])   ; → [6 8 9]
(reduce (=> (+ $0 $1)) 0 [1 2 3 4 5])  ; → 15

; Member access
(let users [{name: "Alice"}, {name: "Bob"}])
(map (=> ($0.name)) users)  ; → ["Alice", "Bob"]

; Explicit parameters (traditional style)
(let square (=> [x] (* x x)))
(square 7)  ; → 49

(let multiply (=> [x y] (* x y)))
(multiply 6 7)  ; → 42

; Zero parameters
(let get-value (=> [] 42))
(get-value)  ; → 42
```

**When to use arrow lambdas:**
- ✅ Short inline lambdas in `map`/`filter`/`reduce`
- ✅ Single-expression functions
- ✅ Quick transformations

**When to use `fn`:**
- ✅ Named functions
- ✅ Multi-line bodies
- ✅ Complex logic
- ✅ When parameter names improve readability

See `arrow-lambda-examples.hql` for more examples.

### Default Parameters (Use Map Syntax)

For functions with default values, use map parameter syntax:

```lisp
; All defaults - map params with Lisp style
(fn multiply {x: 10 y: 20}
  (* x y))

(multiply)                ; → 200 (10 * 20)
(multiply {x: 5})         ; → 100 (5 * 20)
(multiply {x: 5 y: 3})    ; → 15  (5 * 3)
(multiply {y: 7})         ; → 70  (10 * 7)

; JSON style also works (for copy-paste compatibility)
(multiply {"x": 5, "y": 3})  ; → 15 (same result)
```

### Map Parameters

For config-style functions with many parameters, use map syntax:

```lisp
; All keys have defaults - Lisp style
(fn connect {host: "localhost" port: 8080 ssl: false}
  (if ssl
    (+ "https://" host ":" port)
    (+ "http://" host ":" port)))

; Call with all defaults
(connect)  ; → "http://localhost:8080"

; Override specific keys
(connect {host: "api.example.com" ssl: true port: 443})
; → "https://api.example.com:443"

; Partial override
(connect {port: 3000})  ; → "http://localhost:3000"

; JSON style also works
(connect {"host": "api.example.com", "ssl": true, "port": 443})
; → "https://api.example.com:443" (same result)
```

### Rest Parameters

```lisp
; Rest only
(fn sum [& rest]
  (.reduce rest (fn [acc val] (+ acc val)) 0))

(sum 1 2 3 4 5)  ; → 15

; With regular params
(fn sum [x y & rest]
  (+ x y (.reduce rest (fn [acc val] (+ acc val)) 0)))

(sum 10 20 1 2 3)  ; → 36
```

### Partial Application with Maps

```lisp
; With maps, omit keys to use defaults
(fn multiply {x: 10 y: 20}
  (* x y))

(multiply {y: 5})   ; → 50 (uses x default, provides y)
(multiply {x: 3})   ; → 60 (provides x, uses y default)

; JSON style also works
(multiply {"y": 5})   ; → 50 (same result)
```

### Return Statements

```lisp
; Implicit return (last expression)
(fn double [x]
  (* x 2))

; Explicit return
(fn double [x]
  (return (* x 2)))

; Early return
(fn safe-divide [a b]
  (if (= b 0)
    (return 0)
    (/ a b)))

; Multiple return paths
(fn classify [x]
  (cond
    ((< x 0) (return "negative"))
    ((= x 0) (return "zero"))
    ((> x 0) (return "positive"))))
```

### Closures

```lisp
; Capturing outer variable
(let x 10)
(fn add-x [n]
  (+ n x))

(add-x 5)  ; → 15

; Closure with state
(fn make-counter []
  (var count 0)
  (fn []
    (= count (+ count 1))
    count))

(var counter (make-counter))
(counter)  ; → 1
(counter)  ; → 2
```

### Higher-Order Functions

```lisp
; Function returning function
(fn make-adder [n]
  (fn [x] (+ x n)))

(let add5 (make-adder 5))
(add5 10)  ; → 15

; Function as argument
(fn apply-twice [f x]
  (f (f x)))

(fn add-one [n] (+ n 1))
(apply-twice add-one 5)  ; → 7
```

### Recursive Functions

```lisp
; Factorial
(fn factorial [n]
  (if (<= n 1)
    1
    (* n (factorial (- n 1)))))

(factorial 5)  ; → 120
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

### JSON Map Parameters (with Defaults)

**HQL:**

```lisp
(fn multiply {"x": 10, "y": 20}
  (* x y))
```

**Compiled:**

```javascript
function multiply(__hql_params = {}) {
  const x = __hql_params.x ?? 10;
  const y = __hql_params.y ?? 20;
  return x * y;
}
```

### JSON Map Parameters

**HQL:**

```lisp
(fn connect {"host": "localhost", "port": 8080}
  (+ host ":" port))

(connect {"host": "api.example.com", "port": 443})
```

**Compiled:**

```javascript
function connect(__hql_params = {}) {
  const host = __hql_params.host ?? "localhost";
  const port = __hql_params.port ?? 8080;
  return host + ":" + port;
}

connect({ host: "api.example.com", port: 443 });
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

## Features Covered

✅ Simple function definition ✅ Function with single parameter ✅ Function with
no parameters ✅ Function with multiple parameters ✅ Anonymous function
expression ✅ Nested function calls ✅ Function returning function ✅ Recursive
function ✅ Function with multiple expressions ✅ Function as argument ✅
Higher-order functions ✅ Immediately invoked function (IIFE) ✅ Closure
capturing variable ✅ Arrow lambda - implicit single param ✅ Arrow lambda -
implicit multiple params ✅ Arrow lambda - gaps in params ✅ Arrow lambda -
explicit params ✅ Arrow lambda - with map/filter/reduce ✅ Arrow lambda -
nested lambdas ✅ Arrow lambda - member access ✅ Arrow lambda - error cases ✅
Default params - all defaults used ✅ Default params - override first param ✅
Default params - override with placeholder ✅ Default params - override both
params ✅ JSON map params - basic usage ✅ JSON map params - partial override ✅
JSON map params - all defaults ✅ Rest params - rest only ✅ Rest params - with
regular params ✅ Rest params - empty rest array ✅ Placeholder - multiple
placeholders ✅ Return - implicit return ✅ Return - explicit return ✅ Return -
early return ✅ Return - in conditional branches ✅ Return - in anonymous
functions ✅ Return - multiple return paths ✅ Return - in nested functions

## Test Coverage



### Section 1: Basic Functions

- Simple definition
- Parameters (none, single, multiple)
- Anonymous functions
- Nested calls
- Higher-order functions
- Recursive functions
- Closures
- IIFE

### Section 2: Arrow Lambda Shorthand

- Implicit parameters (`$0`, `$1`, `$2`)
- Single, multiple, and gaps in parameter usage
- Explicit parameters `(=> (x y) body)`
- Integration with `map`/`filter`/`reduce`
- Nested arrow lambdas
- Complex expressions (conditionals, member access)
- Error cases (missing params, missing body)
- Real-world use cases (sort, find, transform)
- Edge cases (empty params, nested structures)

### Section 3: Default Parameters

- All defaults used
- Override parameters
- Placeholder usage
- Single param defaults

### Section 4: JSON Map Parameters

- All defaults used
- Partial override
- Full override

### Section 5: Rest Parameters

- Rest only
- With regular params
- Empty rest array
- Accessing rest properties

### Section 6: Placeholders

- Multiple placeholders
- All placeholders

### Section 7: Return Statements

- Implicit returns
- Explicit returns
- Early returns
- Multiple return paths
- In nested functions
- In loops/conditionals

### Section 8: Comprehensive (1 test)

- Defaults + rest combined

## Use Cases

### 1. Simple Utilities

```lisp
(fn add [a b]
  (+ a b))

(fn square [x]
  (* x x))

(fn max [a b]
  (if (> a b) a b))
```

### 2. Optional Parameters

```lisp
(fn fetch-data {"url": "", "method": "GET", "timeout": 5000}
  ; Fetch data with optional method and timeout
  ...)

(fetch-data {"url": "https://api.example.com"})
(fetch-data {"url": "https://api.example.com", "method": "POST"})
(fetch-data {"url": "https://api.example.com", "method": "POST", "timeout": 3000})
```

### 3. Configuration Functions

```lisp
; Use JSON map parameters for config-style functions
(fn configure {"name": "app", "version": "1.0.0", "author": "Unknown", "license": "MIT"}
  [name version author license])

(configure {"name": "my-app", "author": "Alice"})
```

### 4. Variadic Functions

```lisp
(fn sum [& numbers]
  (.reduce numbers (fn [acc val] (+ acc val)) 0))

(sum 1 2 3 4 5)  ; → 15
```

### 5. Function Factories

```lisp
(fn make-multiplier [factor]
  (fn [x] (* x factor)))

(let double (make-multiplier 2))
(let triple (make-multiplier 3))

(double 5)  ; → 10
(triple 5)  ; → 15
```

### 6. Guards with Early Returns

```lisp
(fn process-data [data]
  (if (not data)
    (return null))

  (if (< data.length 0)
    (return []))

  ; Process data
  data)
```

## Comparison with Other Languages

### JavaScript/TypeScript

```javascript
// JavaScript ES6
function add(a, b) {
  return a + b;
}

const square = (x) => x * x;

// Default params
function greet(name = "World") {
  return `Hello, ${name}!`;
}

// Rest params
function sum(...numbers) {
  return numbers.reduce((a, b) => a + b, 0);
}

// HQL (same concepts)
(fn add [a b] (+ a b))
(let square (fn [x] (* x x)))
(fn greet {"name": "World"} (+ "Hello, " name "!"))
(fn sum [& numbers] (.reduce numbers (fn [a b] (+ a b)) 0))
```

### Python

```python
# Python
def add(a, b):
    return a + b

# Default params
def greet(name="World"):
    return f"Hello, {name}!"

# HQL
(fn add [a b] (+ a b))
(fn greet {"name": "World"} (+ "Hello, " name "!"))
```

### Clojure

```clojure
;; Clojure
(defn add [a b]
  (+ a b))

;; Multi-arity
(defn greet
  ([] (greet "World"))
  ([name] (str "Hello, " name "!")))

;; HQL (JSON map params instead of multi-arity)
(fn add [a b] (+ a b))
(fn greet {"name": "World"} (+ "Hello, " name "!"))
```

## Best Practices

### Use Descriptive Names

```lisp
; ✅ Good: Clear purpose
(fn calculate-total-price [items tax-rate]
  (* (sum-prices items) (+ 1 tax-rate)))

; ❌ Avoid: Unclear abbreviations
(fn calc [i t]
  (* (sp i) (+ 1 t)))
```

### Use JSON Maps for Config-Style Functions

```lisp
; ✅ Good: JSON map for many optional params
(fn create-user {"email": "", "password": "", "name": "", "age": 0}
  ...)

(create-user {"email": "alice@example.com", "name": "Alice", "age": 30})

; ✅ Also good: Positional for simple cases
(fn add [a b]
  (+ a b))
```

### Use Early Returns for Guards

```lisp
; ✅ Good: Early returns
(fn process [data]
  (if (not data) (return null))
  (if (empty? data) (return []))
  ; Main logic
  data)

; ❌ Avoid: Deep nesting
(fn process [data]
  (if data
    (if (not (empty? data))
      ; Main logic
      data
      [])
    null))
```

### Keep Functions Small

```lisp
; ✅ Good: Single responsibility
(fn validate-email [email]
  (contains? email "@"))

(fn validate-user [user]
  (and (validate-email user.email)
       (>= user.age 18)))

; ❌ Avoid: Doing too much
(fn validate-user [user]
  (and (contains? user.email "@")
       (>= user.age 18)
       (< user.age 120)
       (not (empty? user.name))
       ...))
```

## Edge Cases Tested

✅ Function with no parameters ✅ Function with single parameter ✅ Function
with multiple parameters ✅ Anonymous functions ✅ Immediately invoked functions
(IIFE) ✅ Nested function calls ✅ Recursive functions ✅ Functions returning
functions ✅ Functions as arguments ✅ Closures capturing variables ✅ Default
parameters (all combinations) ✅ Placeholder with defaults ✅ JSON map
parameters (all keys, partial, empty) ✅ Rest parameters (empty and non-empty)
✅ Error: Duplicate parameters ✅ Implicit returns ✅ Explicit returns ✅ Early
returns ✅ Multiple return paths ✅ Returns in conditionals ✅ Returns in nested
functions ✅ Returns in loops/do blocks

## Common Patterns

### 1. Callback Functions

```lisp
(var numbers [1, 2, 3, 4, 5])
(numbers.map (fn [n] (* n 2)))
```

### 2. Predicate Functions

```lisp
(fn is-even? [n]
  (= (% n 2) 0))

(fn is-positive? [n]
  (> n 0))
```

### 3. Reducer Functions

```lisp
(fn sum-reducer [acc val]
  (+ acc val))

(nums.reduce sum-reducer 0)
```

### 4. Partial Application

```lisp
(fn add [a b]
  (+ a b))

(fn make-adder [n]
  (fn [x] (add n x)))

(let add10 (make-adder 10))
```

## Performance Considerations

**Function Calls:**

- ✅ Compiled to native JavaScript function calls
- ✅ Inline optimization possible for simple functions
- ✅ Closures have minimal overhead

**Best Practices:**

- Avoid deeply nested function calls in hot loops
- Use closures sparingly in performance-critical code
- Prefer iteration over deep recursion (stack limits)
- JSON map parameters have slight overhead vs positional

## Summary

HQL's function system provides:

- ✅ **Named and anonymous functions**
- ✅ **Arrow lambda shorthand** (`=>` with `$0, $1, $2` params)
- ✅ **Default parameters** (like Python, JavaScript)
- ✅ **JSON map parameters** (config-style with `{key: default}`)
- ✅ **Rest parameters** (`& rest`, like JavaScript `...args`)
- ✅ **Placeholders** (`_` for skipping args)
- ✅ **Explicit/implicit returns**
- ✅ **Closures** (capturing outer scope)
- ✅ **Higher-order functions** (functions as values)
- ✅ **Recursion** (self-referencing functions)

Choose the right pattern:

- **Inline callbacks**: Arrow lambdas `(=> (* $0 2))`
- **Simple utilities**: Basic named functions `(fn add [a b] ...)`
- **Optional params**: JSON map parameters `{"x": 10, "y": 20}`
- **Config functions**: JSON map parameters `{"host": "localhost", "port": 8080}`
- **Variable length**: Rest parameters `[& rest]`
- **Factories**: Functions returning functions
- **Guards**: Early returns with conditionals
