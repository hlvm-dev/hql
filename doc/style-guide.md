# HQL Style Guide

**Version:** 1.0.0
**Last Updated:** 2025-11-13

## Philosophy

HQL embraces **maximum flexibility** while maintaining a **preferred style** for consistency. Following Clojure's proven approach (15+ years in production), HQL accepts both Lisp-style and JavaScript-style syntax without forcing one over the other.

**Core Principle:** *"Be opinionated where it matters (correctness), flexible where it doesn't (style)."*

---

## Syntax Styles

### ✅ Preferred: Pure Lisp Style

**Use this for new HQL code:**

```lisp
;; Objects/Maps - unquoted keys, no commas
{name: "Alice" age: 25 city: "NYC"}

;; Arrays - no commas
[1 2 3 4 5]

;; Function parameters - unquoted keys
(fn connect {host: "localhost" port: 8080 ssl: false}
  (+ (if ssl "https" "http") "://" host ":" port))

;; Function calls - unquoted keys
(connect {host: "api.example.com" ssl: true})

;; Destructuring - unquoted
(let {x y z} point)
(let {x: newX y: newY} point)
```

**Why Lisp style?**
- ✅ Concise and elegant
- ✅ Less visual noise (no quotes/commas)
- ✅ True to Lisp heritage
- ✅ Faster to type
- ✅ Easier to read for complex structures

---

### ✅ Also Supported: JavaScript/JSON Style

**Use this when copy-pasting from JSON or when team prefers it:**

```lisp
;; Objects/Maps - quoted keys, commas
{"name": "Alice", "age": 25, "city": "NYC"}

;; Arrays - commas
[1, 2, 3, 4, 5]

;; Function parameters - quoted keys, commas
(fn connect {"host": "localhost", "port": 8080, "ssl": false}
  (+ (if ssl "https" "http") "://" host ":" port))

;; Function calls - quoted keys, commas
(connect {"host": "api.example.com", "ssl": true})
```

**Why JSON style is supported:**
- ✅ Copy-paste from APIs works immediately
- ✅ Familiar to JavaScript developers
- ✅ No learning curve when migrating
- ✅ Compiles to identical code

---

## Style Comparison

| Feature | Lisp Style | JSON Style | Both Work? |
|---------|------------|------------|------------|
| **Map keys** | `{x: 1}` | `{"x": 1}` | ✅ Yes |
| **Commas in maps** | `{x: 1 y: 2}` | `{"x": 1, "y": 2}` | ✅ Yes |
| **Array elements** | `[1 2 3]` | `[1, 2, 3]` | ✅ Yes |
| **Function params** | `{x: 0 y: 0}` | `{"x": 0, "y": 0}` | ✅ Yes |
| **Destructuring** | `{x y}` | `{x, y}` | ✅ Yes |
| **Mixed styles** | `{x: 1, "y": 2}` | - | ✅ Yes |

---

## Recommendations by Context

### New HQL Projects
**Use:** Pure Lisp style throughout

```lisp
;; Preferred
(fn api-call {url: "" method: "GET" timeout: 30}
  (fetch url {method: method timeout: timeout}))

(api-call {url: "https://api.example.com" method: "POST"})
```

### Migrating from JavaScript
**Use:** JSON style initially, migrate gradually

```lisp
;; Start with JSON style (familiar)
(fn api-call {"url": "", "method": "GET", "timeout": 30}
  (fetch url {"method": method, "timeout": timeout}))

;; Migrate to Lisp style over time
(fn api-call {url: "" method: "GET" timeout: 30}
  (fetch url {method: method timeout: timeout}))
```

### Working with JSON APIs
**Use:** Whichever matches your data source

```lisp
;; Copy-paste JSON response directly
(let response {
  "status": 200,
  "data": {
    "users": [
      {"id": 1, "name": "Alice"},
      {"id": 2, "name": "Bob"}
    ]
  }
})

;; Or convert to Lisp style if you prefer
(let response {
  status: 200
  data: {
    users: [
      {id: 1 name: "Alice"}
      {id: 2 name: "Bob"}
    ]
  }
})
```

### Team Codebases
**Use:** Pick one style and be consistent

```lisp
;; Bad - mixed styles confuse readers
(fn process {url: ""} ...)
(fn handle {"data": []} ...)

;; Good - consistent throughout
(fn process {url: ""} ...)
(fn handle {data: []} ...)
```

---

## Naming Conventions

### Variables and Functions

```lisp
;; Use kebab-case (Lisp tradition)
(let user-name "Alice")
(fn get-user-data [] ...)
(fn parse-json-response [] ...)

;; Not camelCase
(let userName "Alice")      ;; Works but not idiomatic
```

### Constants

```lisp
;; Use SCREAMING-KEBAB-CASE
(let MAX-RETRIES 3)
(let API-TIMEOUT 30)
(let DEFAULT-HOST "localhost")
```

### Predicates (Boolean functions)

```lisp
;; End with ? for predicates
(fn empty? [coll] ...)
(fn valid-email? [email] ...)
(fn authenticated? [] ...)
```

---

## Code Organization

### Module Structure

```lisp
;; 1. Imports first
(import [helper1 helper2] from "./utils")

;; 2. Constants
(let API-BASE "https://api.example.com")
(let MAX-RETRIES 3)

;; 3. Helper functions
(fn validate-input [data] ...)
(fn format-response [res] ...)

;; 4. Main functions
(fn fetch-data {url: "" retries: MAX-RETRIES}
  ...)

;; 5. Exports last
(export [fetch-data] "./api")
```

### Function Organization

```lisp
;; Small, focused functions
(fn validate-email [email]
  (.includes email "@"))

(fn validate-user [user]
  (and
    (validate-email user.email)
    (> (.-length user.name) 0)))

;; Not one giant function
(fn process-user [user]
  ;; 100 lines of mixed concerns
  ...)
```

---

## When to Use Each Parameter Style

### Positional `[]` - Simple Functions

```lisp
;; ≤3 parameters, no defaults needed
(fn add [x y]
  (+ x y))

(fn format-name [first last]
  (+ first " " last))

(fn calculate-area [width height]
  (* width height))
```

**Use when:**
- 3 or fewer parameters
- No default values needed
- Parameter order is obvious
- Function is simple and clear

---

### Map `{}` - Config Functions

```lisp
;; Many parameters, all have defaults
(fn connect {
  host: "localhost"
  port: 8080
  ssl: false
  timeout: 30
  retries: 3
}
  ...)

;; Call with only what you need
(connect {host: "api.com" ssl: true})
```

**Use when:**
- More than 3 parameters
- Parameters have sensible defaults
- Config-style function
- Partial application useful

---

## Whitespace and Formatting

### Indentation

```lisp
;; 2 spaces per level
(fn process-data [data]
  (let cleaned (clean data))
  (let validated (validate cleaned))
  validated)

;; Align closing parens with opening line
(fn complex-logic []
  (if condition
    (do
      (action-1)
      (action-2))
    (fallback)))
```

### Line Length

```lisp
;; Prefer ≤80 characters
;; OK - fits in one line
(fn greet [name] (+ "Hello, " name "!"))

;; Better - split long lines
(fn greet [name]
  (+ "Hello, " name "!"))

;; Long function calls - break at logical points
(api-call
  {url: "https://api.example.com/v1/users"
   method: "POST"
   headers: {authorization: token}
   body: {name: "Alice" role: "admin"}})
```

---

## Comments and Documentation

### Inline Comments

```lisp
;; Use ; for single-line comments
; This is a comment

;; Prefer comments above code, not inline
(let result (+ x y))  ; Add numbers <- avoid

;; Better:
; Calculate sum of x and y
(let result (+ x y))
```

### Function Documentation

```lisp
;; Document public functions
; Fetches user data from the API
;
; Parameters:
;   user-id: The unique identifier for the user
;   options: Optional fetch configuration
;
; Returns: User object or null if not found
(fn fetch-user {user-id: 0 options: {}}
  ...)
```

---

## Error Handling

### Validate Early

```lisp
(fn divide [a b]
  (if (= b 0)
    (throw (Error "Division by zero"))
    (/ a b)))
```

### Descriptive Error Messages

```lisp
;; Bad
(throw (Error "Invalid"))

;; Good
(throw (Error "Invalid email format: expected user@domain.com"))
```

---

## Compatibility Notes

### What's Rejected (HQL1001 Error)

```lisp
;; Named-arg call-site sugar is NOT supported
(fn add [x y] (+ x y))
(add x: 10 y: 20)  ;; ❌ HQL1001 error

;; Must use map instead:
(add {x: 10 y: 20})  ;; ✅ Works (Lisp style)
(add {"x": 10, "y": 20})  ;; ✅ Works (JSON style)
```

### Loop Keywords (Exception)

```lisp
;; Loop keywords to:, from:, by: ARE allowed (special form)
(for (i to: 10) ...)
(for (i from: 0 to: 10 by: 2) ...)
```

---

## Quick Reference

### ✅ Do This (Preferred)

```lisp
;; Lisp style
{name: "Alice" age: 25}
[1 2 3]
(fn connect {host: "" port: 8080} ...)
(connect {host: "api.com"})
```

### ✅ Also Fine (Supported)

```lisp
;; JSON style
{"name": "Alice", "age": 25}
[1, 2, 3]
(fn connect {"host": "", "port": 8080} ...)
(connect {"host": "api.com"})
```

### ❌ Don't Do This

```lisp
;; Named-arg call-site syntax
(add x: 10 y: 20)  ;; ❌ HQL1001 error

;; Mixing function param styles
(fn bad [x {y: 0}] ...)  ;; ❌ Error - pick one style
```

---

## Why This Philosophy?

Following **Clojure's battle-tested approach:**

1. **Practicality over purity** - Both styles work, no artificial restrictions
2. **Developer freedom** - Write what feels natural
3. **Copy-paste friendly** - JSON integration is seamless
4. **No learning curve** - JS developers feel at home
5. **Lisp elegance** - Pure style is preferred and showcased

**Result:** Maximum compatibility without sacrificing identity as a Lisp.

---

## Further Reading

- `doc/features/06-function/README.md` - Function feature documentation
- `doc/features/06-function/spec.md` - Detailed function specification
- `test/organized/syntax/function/` - Comprehensive test examples
