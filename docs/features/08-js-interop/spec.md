# JavaScript Interoperability Documentation

**Implementation:** Transpiler JS interop transformers
**Coverage:** ✅ 100%

## Overview

HQL provides seamless bidirectional interoperability with JavaScript:

1. **js-call** - Invoke JavaScript methods
2. **js-get** - Access JavaScript properties
3. **js-set** - Mutate JavaScript properties
4. **js-new** - Create JavaScript objects
5. **Dot notation** - Syntactic sugar for property/method access
6. **Async/await** - Asynchronous JavaScript integration
7. **Error handling** - Try/catch/finally across boundaries
8. **Module system** - Import/export between HQL and JS
9. **Type mapping** - Automatic data type conversion
10. **Circular imports** - Support for circular HQL ↔ JS dependencies

All HQL code compiles to valid JavaScript with full ES6+ support.

## Syntax

### js-call - Method Invocation

```lisp
; Basic method call
(js-call object "method")

; With arguments
(js-call object "method" arg1 arg2)

; Static method
(js-call Array "from" [1, 2, 3])

; Examples
(var str "hello")
(js-call str "toUpperCase")  ; → "HELLO"

(var arr [1, 2, 3, 4, 5])
(js-call arr "filter" (fn [x] (> x 2)))  ; → [3, 4, 5]

(js-call str "split" ",")  ; → ["hello"]
```

### js-get - Property Access

```lisp
; Basic property access
(js-get object "property")

; Nested access
(var person {"address": {"city": "NYC"}})
(var addr (js-get person "address"))
(js-get addr "city")  ; → "NYC"

; Array access
(var arr [10, 20, 30])
(js-get arr 1)  ; → 20

; Undefined properties
(js-get obj "nonexistent")  ; → undefined
```

### js-set - Property Mutation

```lisp
; Set property
(js-set object "property" value)

; Example
(var obj {"count": 0})
(js-set obj "count" 42)
(js-get obj "count")  ; → 42

; Create new property
(var obj {})
(js-set obj "newProp" "value")
```

### js-new - Object Creation

```lisp
; Create object with constructor
(js-new Constructor (args...))

; Examples
(var date (js-new Date (2023 11 25)))
(js-call date "getFullYear")  ; → 2023

(var arr (js-new Array (5)))
(js-get arr "length")  ; → 5

(var map (js-new Map ()))
(js-call map "set" "key" "value")
```

### Dot Notation - Syntactic Sugar

```lisp
; Property access
(object .property)

; Method call
(object .method)
(object .method arg1 arg2)

; Chaining
(object .method1 .method2 .method3)

; Examples
(var arr [1, 2, 3])
(arr .length)  ; → 3

(var text "  hello  ")
(text .trim .toUpperCase)  ; → "HELLO"

(var str "hello,world")
(str .split ",")  ; → ["hello", "world"]
```

### Async/Await Interop

```lisp
; Async function
(async fn function-name [params]
  (await async-operation)
  result)

; Basic async
(async fn get-value []
  (await (js-call Promise "resolve" 42)))

(get-value)  ; → Promise → 42

; Multiple awaits
(async fn add-async [a b]
  (let x (await (js-call Promise "resolve" a)))
  (let y (await (js-call Promise "resolve" b)))
  (+ x y))

; Promise.all
(async fn fetch-all []
  (let promises [
    (js-call Promise "resolve" 1)
    (js-call Promise "resolve" 2)])
  (await (js-call Promise "all" promises)))

; Promise.race
(async fn race []
  (await (js-call Promise "race" [p1 p2])))
```

### Error Handling - Try/Catch/Finally

```lisp
; Basic try/catch
(try
  (throw "error-message")
  (catch e
    (+ "caught: " e)))

; With finally
(try
  risky-operation
  (catch e
    error-handler)
  (finally
    cleanup-code))

; Catching JS errors
(try
  (js-call JSON "parse" "invalid-json")
  (catch e
    "parse-error"))

; Nested error handling
(try
  (try
    (throw "inner")
    (catch e
      (throw e)))
  (catch e
    "outer-caught"))

; Async error handling
(async fn safe-operation []
  (try
    (await risky-call)
    (catch e
      "error-caught")))
```

### Module System - Import/Export

```lisp
; HQL importing JavaScript
(import [jsFunction] from "./module.js")
(import [default as MyClass] from "./class.js")

; HQL exporting to JavaScript
(fn myFunction [x] (* x 2))
(export [myFunction])

; JavaScript importing compiled HQL
// Compile HQL to JS first
const hql = await transpile(code);
// Using platform abstraction
import { writeTextFile } from "hql/src/platform/platform.ts";
await writeTextFile("module.mjs", hql);

// Import in JavaScript
import { myFunction } from "./module.mjs";
```

## Implementation Details

### js-call Compilation

**HQL:**

```lisp
(js-call obj "method" arg1 arg2)
```

**Compiled JavaScript:**

```javascript
obj["method"](arg1, arg2);
```

### js-get Compilation

**HQL:**

```lisp
(js-get obj "property")
```

**Compiled:**

```javascript
obj["property"];
```

### js-set Compilation

**HQL:**

```lisp
(js-set obj "key" value)
```

**Compiled:**

```javascript
obj["key"] = value;
```

### js-new Compilation

**HQL:**

```lisp
(js-new Constructor (arg1 arg2))
```

**Compiled:**

```javascript
new Constructor(arg1, arg2);
```

### Dot Notation Compilation

**HQL:**

```lisp
(obj .method arg1 arg2)
```

**Compiled:**

```javascript
obj.method(arg1, arg2);
```

### Async/Await Compilation

**HQL:**

```lisp
(async fn getData []
  (await (js-call fetch url)))
```

**Compiled:**

```javascript
async function getData() {
  return await fetch(url);
}
```

## Type Mapping

### HQL → JavaScript

| HQL Type  | JavaScript Type | Notes                 |
| --------- | --------------- | --------------------- |
| Number    | Number          | Direct mapping        |
| String    | String          | Direct mapping        |
| Boolean   | Boolean         | true/false            |
| Array     | Array           | Native arrays         |
| Object    | Object          | Native objects        |
| Function  | Function        | First-class functions |
| null      | null            | Direct mapping        |
| undefined | undefined       | Direct mapping        |

### JavaScript → HQL

All JavaScript types are accessible in HQL:

- **Primitives**: Numbers, strings, booleans
- **Objects**: Plain objects, arrays, maps, sets
- **Functions**: Functions, methods, constructors
- **Classes**: ES6 classes, prototypes
- **Promises**: Async/await support
- **Errors**: Try/catch/finally handling

## Features Covered

✅ js-call - basic invocation ✅ js-call - with arguments ✅ js-call - with
callbacks ✅ js-call - static methods ✅ js-call - array methods (map, filter,
reduce) ✅ js-get - property access ✅ js-get - nested properties ✅ js-get -
array indexing ✅ js-get - undefined properties ✅ js-set - property mutation ✅
js-set - create new properties ✅ js-new - constructor invocation ✅ js-new -
with arguments ✅ js-new - built-in constructors (Date, Array, Map) ✅ Dot
notation - property access ✅ Dot notation - method calls ✅ Dot notation -
chaining ✅ Async functions - basic ✅ Async functions - multiple awaits ✅
Async functions - Promise.all ✅ Async functions - Promise.race ✅ Async
functions - chained operations ✅ Try/catch - basic ✅ Try/catch - with finally
✅ Try/catch - nested ✅ Try/catch - async ✅ Error types - access properties ✅
Module imports - HQL → JS ✅ Module imports - JS → HQL ✅ Module exports - HQL
classes ✅ Circular imports - HQL ↔ JS

## Test Coverage



### Section 1: Basic JS Interop

- js-call method invocation
- js-get property access
- js-set property mutation
- js-new object creation
- Dot notation syntactic sugar

### Section 2: Async/Await

- Basic async functions
- Multiple awaits in sequence
- Promise.all and Promise.race
- Chained async operations
- Nested async calls
- Bug regression tests

### Section 3: Error Handling

- Try/catch/finally basics
- Catching JS errors
- HQL error handling
- Nested try/catch
- Async error handling
- Error property access

### Section 4: Deep Dive

- HQL importing JS modules
- Runtime API (transpile, run)
- Data type mapping
- Complex operations (JSON, arrays)
- Dot notation comprehensive tests
- Edge cases (null, undefined, this)

### Section 5: Module System

- Compile HQL to JS
- Import compiled HQL in JavaScript
- Export HQL classes to JS

### Section 6: Circular Imports (1 test)

- Circular HQL ↔ JS dependencies

## Use Cases

### 1. Using JavaScript Libraries

```lisp
; Use lodash
(import [default as _] from "https://deno.land/x/lodash/mod.ts")
(js-call _ "chunk" [1 2 3 4] 2)  ; → [[1,2], [3,4]]

; Use moment.js
(import [default as moment] from "moment")
(var now (js-call moment))
(js-call now "format" "YYYY-MM-DD")
```

### 2. DOM Manipulation (Browser)

```lisp
(var elem (js-call document "getElementById" "myDiv"))
(js-set elem "textContent" "Hello!")
(js-call elem "classList" "add" "active")
```

### 3. Async API Calls

```lisp
(async fn fetch-user [id]
  (let response (await (js-call fetch (+ "/api/users/" id))))
  (await (js-call response "json")))

(fetch-user 123)
```

### 4. Error Handling with Retry

```lisp
(async fn retry-fetch [url max-attempts]
  (var attempts 0)
  (loop []
    (= attempts (+ attempts 1))
    (try
      (return (await (js-call fetch url)))
      (catch e
        (if (>= attempts max-attempts)
          (throw e)
          (recur))))))
```

### 5. Working with JSON

```lisp
(var data {"name": "Alice", "age": 30})
(var json (js-call JSON "stringify" data))
(var parsed (js-call JSON "parse" json))
```

### 6. Array Operations

```lisp
(var numbers [1, 2, 3, 4, 5])
(var doubled (js-call numbers "map" (fn [x] (* x 2))))
(var sum (js-call doubled "reduce" (fn [acc val] (+ acc val)) 0))
```

### 7. Promise Utilities

```lisp
(async fn parallel-fetch [urls]
  (let promises (urls .map (fn [url] (js-call fetch url))))
  (await (js-call Promise "all" promises)))
```

### 8. Class Instantiation

```lisp
(var date (js-new Date ()))
(var map (js-new Map ()))
(var set (js-new Set ([1 2 3])))

(js-call map "set" "key" "value")
(js-call set "add" 4)
```

## Comparison with Other Languages

### JavaScript/TypeScript

```javascript
// JavaScript
const text = "hello";
const upper = text.toUpperCase();

const arr = [1, 2, 3];
const doubled = arr.map(x => x * 2);

async function getData() {
  const response = await fetch(url);
  return await response.json();
}

// HQL
(var text "hello")
(var upper (text .toUpperCase))

(var arr [1, 2, 3])
(var doubled (arr .map (fn [x] (* x 2))))

(async fn getData []
  (let response (await (js-call fetch url)))
  (await (js-call response "json")))
```

### ClojureScript

```clojure
;; ClojureScript
(.toUpperCase "hello")
(.map #(* % 2) [1 2 3])

;; HQL
(js-call "hello" "toUpperCase")
(js-call [1 2 3] "map" (fn [x] (* x 2)))

;; Or with dot notation
("hello" .toUpperCase)
([1 2 3] .map (fn [x] (* x 2)))
```

## Best Practices

### Use Dot Notation for Clarity

```lisp
; ✅ Good: Clear and concise
(arr .map (fn [x] (* x 2)))
(text .trim .toUpperCase)

; ❌ Avoid: Verbose
(js-call (js-call text "trim") "toUpperCase")
```

### Handle Errors Gracefully

```lisp
; ✅ Good: Error handling
(async fn safe-fetch [url]
  (try
    (await (js-call fetch url))
    (catch e
      (console.log (+ "Error: " e))
      null)))

; ❌ Avoid: No error handling
(async fn unsafe-fetch [url]
  (await (js-call fetch url)))
```

### Use Type Guards

```lisp
; ✅ Good: Check before access
(fn get-name [obj]
  (if obj
    (js-get obj "name")
    "unknown"))

; ❌ Avoid: Unchecked access
(fn get-name [obj]
  (js-get obj "name"))  ; May throw on null
```

### Prefer Named Imports

```lisp
; ✅ Good: Named imports
(import [fetch] from "node:fetch")
(import [readFile writeFile] from "node:fs/promises")

; ❌ Avoid: Default imports with unclear naming
(import [default as f] from "node:fetch")
```

## Edge Cases Tested

✅ Null and undefined handling ✅ this binding in methods ✅ Array out-of-bounds
access ✅ Property access on non-objects ✅ Method chaining ✅ Nested error
handling ✅ Async error propagation ✅ Promise rejection handling ✅ Circular
module dependencies ✅ Constructor with multiple arguments ✅ Static method
invocation ✅ Callback function arguments ✅ JSON parse errors ✅ Property
mutation on frozen objects ✅ Async function return values

## Common Patterns

### 1. API Client

```lisp
(async fn api-get [endpoint]
  (try
    (let response (await (js-call fetch (+ API_URL endpoint))))
    (if (js-get response "ok")
      (await (js-call response "json"))
      (throw (+ "HTTP error: " (js-get response "status"))))
    (catch e
      (console.error (+ "API error: " e))
      null)))
```

### 2. Data Transformation Pipeline

```lisp
(var users [{name: "Alice", age: 25}, {name: "Bob", age: 30}])
(var names 
  (users
    .filter (fn [u] (> (js-get u "age") 20))
    .map (fn [u] (js-get u "name"))
    .join ", "))
```

### 3. Event Handler Registration

```lisp
(var button (js-call document "getElementById" "btn"))
(js-call button "addEventListener" "click" (fn [e]
  (console.log "Button clicked!")
  (js-call e "preventDefault")))
```

### 4. Lazy Loading

```lisp
(async fn lazy-load [module-path]
  (try
    (await (js-call import module-path))
    (catch e
      (console.error (+ "Failed to load: " module-path))
      null)))
```

## Performance Considerations

**Method Calls:**

- ✅ Compiled to direct JavaScript method calls
- ✅ No overhead compared to native JS
- ✅ JIT optimization applies normally

**Property Access:**

- ✅ Bracket notation for js-get/js-set
- ✅ Dot notation for property access
- ✅ Similar performance to JavaScript

**Async Operations:**

- ✅ Native Promise support
- ✅ Zero overhead async/await
- ✅ Same performance as JavaScript async functions

**Best Practices:**

- Cache property access in hot loops
- Use dot notation for better readability
- Prefer native array methods (map, filter) over manual loops
- Batch async operations with Promise.all

## Summary

HQL's JavaScript interoperability provides:

- ✅ **Seamless integration** with JavaScript APIs
- ✅ **Full async/await support** for modern async patterns
- ✅ **Error handling** with try/catch/finally
- ✅ **Module system** for bidirectional imports
- ✅ **Type mapping** between HQL and JavaScript
- ✅ **Circular imports** for complex dependencies
- ✅ **Syntactic sugar** (dot notation) for clarity
- ✅ **Zero overhead** - compiles to idiomatic JavaScript

Choose the right pattern:

- **js-call**: JavaScript method invocation
- **js-get**: Property access and indexing
- **js-set**: Property mutation
- **js-new**: Constructor invocation
- **Dot notation**: Cleaner syntax for common operations
- **Async/await**: Asynchronous operations
- **Try/catch**: Error handling across boundaries
- **Import/export**: Module integration
