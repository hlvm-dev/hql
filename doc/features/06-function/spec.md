# HQL fn Function Documentation

## Overview

The `fn` construct in HQL defines general-purpose functions with maximum
flexibility for building applications.

> **Note:** HQL supports both **Lisp-style** (preferred) and **JSON-style** syntax.
> Examples below use Lisp style for terseness. See "Syntax Flexibility" section.

## 1. Basic Syntax

### Basic Form

```lisp
(fn function-name [param1 param2 ...]
  body...)
```

### Map Parameters (with Defaults)

**Lisp style (preferred):**
```lisp
(fn function-name {param1: default1 param2: default2}
  body...)
```

**JSON style (also works):**
```lisp
(fn function-name {"param1": default1, "param2": default2}
  body...)
```

## 2. Function Calls

### Positional Arguments

```lisp
(function-name arg1 arg2 ...)
```

### JSON Map Call

```lisp
(function-name {"param1": value1, "param2": value2})
```

### With Defaults

```lisp
(function-name arg1)  ; Second parameter uses default value
(function-name)       ; All parameters use default values
```

## 3. In-depth Examples

### Example 1: Simple Function

```lisp
(fn add [x y]
  (+ x y))

;; Usage
(add 3 4)  ;; => 7
```

### Example 2: Function with Map Parameters

```lisp
(fn greet {name: "World" greeting: "Hello"}
  (+ greeting ", " name "!"))

;; Usage
(greet)                           ;; => "Hello, World!"
(greet {name: "Jane"})            ;; => "Hello, Jane!"
(greet {name: "Jane" greeting: "Hi"})  ;; => "Hi, Jane!"

;; JSON style also works
(greet {"name": "Jane", "greeting": "Hi"})  ;; => "Hi, Jane!"
```

### Example 3: Map Parameters for Config

```lisp
(fn connect {host: "localhost" port: 8080 ssl: false}
  (if ssl
    (+ "https://" host ":" port)
    (+ "http://" host ":" port)))

;; Usage
(connect)  ;; => "http://localhost:8080"
(connect {host: "api.example.com" ssl: true port: 443})
;; => "https://api.example.com:443"
(connect {port: 3000})  ;; => "http://localhost:3000"
```

### Example 4: Function with Rest Parameters

```lisp
(fn sum [x y & rest]
  (+ x y (reduce + 0 rest)))

;; Usage
(sum 1 2)        ;; => 3
(sum 1 2 3 4 5)  ;; => 15
```

### Example 5: Using Map Parameters

```lisp
(fn configure {host: "localhost" port: 8080 protocol: "http"}
  (+ protocol "://" host ":" (str port)))

;; Usage
(configure {protocol: "https"})      ;; => "https://localhost:8080"
(configure {host: "example.com"})    ;; => "http://example.com:8080"
```

## 4. Side Effects

`fn` functions can have side effects:

```lisp
(var counter 0)

(fn increment-counter {amount: 1}
  (set! counter (+ counter amount))
  counter)

(increment-counter)           ;; => 1
(increment-counter {amount: 5})  ;; => 6
```

## 5. Common Use Cases

- API endpoints that need to perform I/O
- Event handlers
- Functions that modify shared state
- Functions with side effects like logging
- Utility functions for data transformation

## 6. Best Practices

- Use `[]` notation for simple functions with positional parameters
- Use map `{}` notation for config-style functions with many defaults
- **Prefer Lisp style** ({x: 0}) for new code - more concise
- **JSON style also works** ({"x": 0}) - use for copy-paste compatibility
- Prefer default values to make functions more flexible
- Use descriptive parameter names for readability
- Keep functions small and focused on a single responsibility

---

# HQL Function Model Documentation

## Overview

HQL provides the `fn` construct for defining functions with flexible parameter
styles.

## Function Definition (fn)

### Purpose

The `fn` construct defines general-purpose functions that:

- **Allow Side Effects:** Can freely access and modify external state
- **Flexible Parameters:** Supports positional `[]` and JSON map `{}` styles
- **Maximum Flexibility:** Can be used for all function use cases

### Syntax

**Positional Form (no defaults):**

```lisp
(fn function-name [param1 param2]
  body...)
```

**Map Form (with defaults):**

```lisp
;; Lisp style (preferred)
(fn function-name {param1: default1 param2: default2}
  body...)

;; JSON style (also works)
(fn function-name {"param1": default1, "param2": default2}
  body...)
```

### Key Characteristics

- **Two Parameter Styles:** Positional `[]` or JSON map `{}`
- **Default Values:** Parameters can have default values in both styles
- **Rest Parameters:** Use `& rest` for variadic functions
- **Placeholders:** Use `_` to skip arguments and use defaults
- **Side Effects:** Functions can perform I/O and modify state

### Examples

**Basic Function:**

```lisp
(fn add [x y]
  (+ x y))

;; Usage with positional arguments
(add 5 10)  ;; => 15
```

**Function with Map Parameters:**

```lisp
(fn add {x: 10 y: 20}
  (+ x y))

;; Usage with partial arguments
(add {x: 5})  ;; => 25
(add)         ;; => 30
```

**Map Function for Config:**

```lisp
(fn connect {host: "localhost" port: 8080 ssl: false}
  (+ (if ssl "https" "http") "://" host ":" port))

;; Usage
(connect {host: "api.example.com" ssl: true})  ;; => "https://api.example.com:8080"
(connect)  ;; => "http://localhost:8080"
```

## Function Features

| Feature             | Supported  |
| ------------------- | ---------- |
| Positional Params   | ✅ Yes     |
| Map Params          | ✅ Yes     |
| Default Values      | ✅ Yes     |
| Rest Parameters     | ✅ Yes     |
| Placeholders        | ✅ Yes     |
| Side Effects        | ✅ Allowed |
| Lisp Syntax         | ✅ Preferred |
| JSON Syntax         | ✅ Supported |

## When to Use Each Style

- **Use positional `[]`** for simple functions with ≤3 parameters
- **Use map `{}`** for config-style functions with many defaults
- **Prefer Lisp style** ({x: 0}) for new code - concise and elegant
- **JSON style works** ({"x": 0}) for copy-paste compatibility
- Default values make functions more flexible and easier to call

## 7. Arrow Lambda Shorthand: `=>`

HQL provides a concise syntax for anonymous functions using the `=>` construct with Swift-style `$N` parameters.

### Syntax

**Implicit Parameters:**

```lisp
(=> body...)
```

Uses `$0`, `$1`, `$2`... for positional parameters. Arity is automatically detected from the highest `$N` found in the body.

**Explicit Parameters:**

```lisp
(=> [param1 param2 ...] body...)
```

Traditional parameter list with named parameters.

### Examples

**Implicit Single Parameter:**

```lisp
; With map
(map (=> (* $0 2)) [1 2 3 4 5])
;; → [2 4 6 8 10]

; Inline call
((=> (* $0 3)) 7)
;; → 21
```

**Implicit Multiple Parameters:**

```lisp
; With reduce
(reduce (=> (+ $0 $1)) 0 [1 2 3 4 5])
;; → 15

; Sort array
((nums.slice 0).sort (=> (- $0 $1)))
```

**Member Access:**

```lisp
; Accessing properties
(map (=> ($0.name)) users)

; Nested properties
(map (=> ($0.user.email)) data)
```

**Explicit Parameters:**

```lisp
; Named parameters
(map (=> [x] (* x x)) [1 2 3])
;; → [1 4 9]

; Multiple parameters
((=> [x y] (+ x y)) 5 7)
;; → 12

; Zero parameters
((=> [] 42))
;; → 42
```

**Chaining Operations:**

```lisp
(take 5
  (filter (=> (> $0 0))
    (map (=> (* $0 2))
      numbers)))
```

**Gap in Parameters:**

```lisp
; Using $0 and $2 generates $0, $1, $2
((=> (+ $0 $2)) 10 999 20)
;; → 30 (ignores $1)
```

### Comparison with `fn`

```lisp
; Arrow lambda (concise for inline use)
(map (=> (* $0 2)) numbers)

; Regular fn (better for complex logic)
(fn calculate-tax {amount: 0 rate: 0.1}
  (let base (* amount rate))
  (if (> amount 1000)
    (* base 1.1)
    base))
```

### When to Use

✅ **Use `=>` for:**
- Short inline lambdas in map/filter/reduce
- Single-expression functions
- Quick transformations

✅ **Use `fn` for:**
- Named functions
- Multi-line bodies
- Complex logic
- When parameter names improve readability

### Implementation Details

- Arrow lambdas transform to regular `fn` functions during compilation
- Parameter scanning detects `$N` patterns including member access (`$0.name`)
- Generates all parameters from `$0` to highest `$N` found
- Supports explicit parameters with same features as `fn` (except defaults currently)

### Limitations

- Anonymous `fn` with default values has a pre-existing issue (loses defaults)
- This affects arrow lambdas: `(=> (x = 10) body)` - defaults not preserved
- Use workaround: Provide defaults at call site or use named `fn`
