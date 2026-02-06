# JavaScript Interoperability

**Source:** `src/hql/transpiler/syntax/js-interop.ts`, `src/hql/transpiler/syntax/data-structure.ts`, `src/hql/transpiler/pipeline/syntax-transformer.ts`, `src/hql/transpiler/pipeline/hql-ast-to-hql-ir.ts`

## Overview

HQL compiles to JavaScript and provides forms for interacting with JavaScript APIs:

1. **js-call** - Invoke JavaScript methods or call functions
2. **js-get** - Access JavaScript properties
3. **js-set** - Mutate JavaScript properties
4. **js-new** - Create objects with constructor (args wrapped in list)
5. **new** - Create objects with constructor (flat args)
6. **js-get-invoke** - Property access with runtime method/property check
7. **Dot notation (spaced)** - `(obj .method arg)` syntactic sugar for method chaining
8. **Dot notation (spaceless)** - `(obj.method arg)` compact form, identical behavior
9. **Optional chaining** - Safe property/method access with `?.`

## Syntax

### js-call - Method Invocation / Function Call

Two forms:

**Method call** (second arg is a string literal = method name):
```lisp
(js-call object "method" arg1 arg2)
```
Compiles to: `object["method"](arg1, arg2)` (or `object.method(arg1, arg2)` for valid identifiers).

**Direct function call** (second arg is not a string literal):
```lisp
(js-call func arg1 arg2)
```
Compiles to: `func(arg1, arg2)`.

Spread operators are supported in arguments.

Examples:
```lisp
(var str "hello world")
(js-call str "toUpperCase")          ;; => "HELLO WORLD"

(var arr [1, 2, 3, 4, 5])
(js-call arr "filter" (fn [x] (> x 2)))  ;; => [3, 4, 5]

(js-call str "split" ",")           ;; => ["hello world"]

;; Static method call
(js-call Array "from" [1, 2, 3])

;; Static method call on JSON
(js-call JSON "stringify" data)
```

### js-get - Property Access

```lisp
(js-get object "property")
```
Compiles to: `object["property"]` (or `object.property` for valid identifiers).

The property can be a string literal or an expression (for computed access).

Examples:
```lisp
(var obj {"name": "Alice", "age": 30})
(js-get obj "name")                 ;; => "Alice"

;; Nested access
(var person {"address": {"city": "NYC"}})
(var addr (js-get person "address"))
(js-get addr "city")                ;; => "NYC"

;; Array indexing
(var arr [10, 20, 30])
(js-get arr 1)                      ;; => 20

;; Undefined properties return undefined
(js-get obj "nonexistent")          ;; => undefined
```

### js-set - Property Mutation

```lisp
(js-set object "property" value)
```
Compiles to: `object["property"] = value` (or `object.property = value` for valid identifiers).

Examples:
```lisp
(var obj {"count": 0})
(js-set obj "count" 42)
(js-get obj "count")                ;; => 42

(var obj {})
(js-set obj "newProp" "value")
```

### js-new - Object Creation (Args in List)

```lisp
(js-new Constructor (arg1 arg2))
```
Compiles to: `new Constructor(arg1, arg2)`.

Arguments must be wrapped in a list (parentheses). An empty list `()` means no arguments.

Examples:
```lisp
(var date (js-new Date (2023 11 25)))
(js-call date "getFullYear")        ;; => 2023

(var arr (js-new Array (5)))
(js-get arr "length")               ;; => 5

(var map (js-new Map ()))
(js-call map "set" "key" "value")
```

### new - Object Creation (Flat Args)

```lisp
(new Constructor arg1 arg2)
```
Compiles to: `new Constructor(arg1, arg2)`.

Arguments are flat (not wrapped in a list). This is the simpler form.

Examples:
```lisp
(new Date 2023 11 25)
(new Array 5)
(new Map)
```

### js-get-invoke - Property Access with Runtime Check

```lisp
(js-get-invoke object "property")
```

Generates an IIFE that checks at runtime whether the property is a function (method) or a value, and acts accordingly. Used internally by dot-chain transformations when it is ambiguous whether a chained element is a method call or property access.

### Dot Notation (Spaced) - Method Chaining

```lisp
(object .method1 arg1 .method2 arg2)
```

The syntax transformer groups `.method` symbols and their following arguments into nested method calls. This is the primary way to chain methods in HQL.

Examples:
```lisp
(var arr [1, 2, 3])
(arr .length)                        ;; => 3

(var text "  hello  ")
(text .trim .toUpperCase)            ;; => "HELLO"

(var str "hello,world")
(str .split ",")                     ;; => ["hello", "world"]

;; Chaining with arguments
(var text "  Hello World  ")
(text .trim .toLowerCase .split " ") ;; => ["hello", "world"]

;; Pipeline style (multiline)
(arr
  .filter (fn [x] (> x 3))
  .map (fn [x] (* x 2))
  .slice 0 3)
```

Optional chaining in spaced dot notation uses `.?`:
```lisp
(obj .?method arg1)                  ;; => obj?.method(arg1)
```

### Dot Notation (Spaceless) - Compact Form

```lisp
(obj.method1.method2 arg)
```

Dots in the first symbol split it into object and method chain. Both spaced and spaceless generate identical JavaScript.

Examples:
```lisp
(text.trim.toUpperCase)              ;; same as (text .trim .toUpperCase)
(arr.filter (fn [x] (> x 3)).map (fn [x] (* x 2)))
(str.split ",")
```

**Equivalence:**

Spaceless normalization only applies to the **first symbol** in a list. Arguments are left unchanged. This means full spaceless chains require dot-prefixed method names for subsequent methods:

```lisp
;; These produce identical JavaScript:
(data.filter isEven .map double .slice 0 5)  ;; first method spaceless, rest spaced
(data .filter isEven .map double .slice 0 5) ;; fully spaced
(data                                         ;; multiline
  .filter isEven
  .map double
  .slice 0 5)

;; All generate: data.filter(isEven).map(double).slice(0, 5)
```

Nested spaceless chains also work when wrapped in sub-expressions:
```lisp
(arr.filter (fn [x] (> x 3)).map (fn [x] (* x 2)))
;; Equivalent to: (arr .filter (fn [x] (> x 3)) .map (fn [x] (* x 2)))
```

**Edge cases:**
- `js/` prefix is preserved (not treated as dot notation): `(js/console.log "hello")`
- Spread operators `...` are not treated as dot notation
- Numeric literals with decimals (`42.5`) are not treated as dot notation
- Bare property access works: `arr.length` evaluates to the property

### Optional Chaining

Optional chaining allows safe property access on potentially null/undefined values. It compiles directly to JavaScript optional chaining (`?.`).

**Property access (bare symbol form):**
```lisp
user?.name                           ;; => user?.name
data?.user?.address?.city            ;; => data?.user?.address?.city
```

**Method calls (spaceless form):**
```lisp
(obj?.greet "World")                 ;; => obj?.greet("World")
```

**Method calls (spaced dot notation):**
```lisp
(obj .?greet "World")                ;; => obj?.greet("World")
```

**Mixed with regular access:**
```lisp
company?.ceo.name                    ;; => company?.ceo.name
```

## Implementation Details

### js-call Compilation

| HQL | JavaScript |
|-----|-----------|
| `(js-call obj "method" arg1 arg2)` | `obj.method(arg1, arg2)` |
| `(js-call func arg1)` | `func(arg1)` |

When the method name string is a valid JS identifier, dot notation is used. Otherwise bracket notation is used.

### js-get Compilation

| HQL | JavaScript |
|-----|-----------|
| `(js-get obj "property")` | `obj.property` |
| `(js-get obj expr)` | `obj[expr]` |

### js-set Compilation

| HQL | JavaScript |
|-----|-----------|
| `(js-set obj "key" value)` | `obj.key = value` |

### js-new Compilation

| HQL | JavaScript |
|-----|-----------|
| `(js-new Constructor (arg1 arg2))` | `new Constructor(arg1, arg2)` |
| `(js-new Constructor ())` | `new Constructor()` |

### new Compilation

| HQL | JavaScript |
|-----|-----------|
| `(new Constructor arg1 arg2)` | `new Constructor(arg1, arg2)` |

### Dot Notation Compilation

| HQL | JavaScript |
|-----|-----------|
| `(obj .method arg1 arg2)` | `obj.method(arg1, arg2)` |
| `(obj .prop)` | Runtime check IIFE: calls `obj.prop()` if function, else returns `obj.prop` |
| `(obj.method arg)` | `obj.method(arg)` |

### Optional Chaining Compilation

| HQL | JavaScript |
|-----|-----------|
| `user?.name` | `user?.name` |
| `(obj?.greet "World")` | `obj?.greet("World")` |
| `(obj .?method arg)` | `obj?.method(arg)` |

## Test Coverage

### Tests: `tests/unit/organized/syntax/js-interop/js-interop.test.ts` (59 tests)

**Section 1: Basic JS Interop (10 tests)**
- js-call basic method invocation
- js-call with arguments
- js-call on array with filter
- js-get basic property access
- js-get nested property access
- js-set property assignment
- js-new create Date object
- js-new create Array
- dot notation property access
- dot notation method chaining

**Section 2: Async/Await (12 tests)**
- Basic async function with await
- Multiple awaits in sequence
- Await with actual delay
- Promise.all with multiple promises
- Promise.race
- Chained async operations
- Async function returning computed values
- Async with array operations
- Promise rejection with catch
- Nested async calls
- Regression: js-new Promise with setTimeout
- Regression: js-new Promise with immediate resolve

**Section 3: Error Handling (16 tests)**
- Basic try/catch with throw
- Try/catch with throw
- Try/catch/finally all execute
- Finally executes even without error
- Catch gets error object
- Catch synchronous JS errors
- Catch JS method throwing error (JSON.parse)
- Array access out of bounds returns undefined
- HQL function throws, catches internally
- HQL catches then returns value
- Nested try/catch blocks
- Catch in inner, rethrow to outer
- Async function with try/catch
- Async function with finally
- Catch and access error properties
- Access error message property

**Section 4: Deep Dive (17 tests)**
- HQL imports JS function
- HQL imports JS variadic function
- HQL imports JS constant
- HQL imports and uses JS class
- transpile() produces valid JavaScript
- run() executes and returns result
- HQL arrays are JS arrays
- HQL objects are JS objects
- HQL functions are JS functions
- HQL closures work like JS closures
- Using Promise.resolve
- Array destructuring and spread
- JSON manipulation
- Dot notation with multiple chaining
- Dot notation with property and method mix
- Null and undefined handling
- this binding in methods

**Section 5: Module System (3 tests)**
- Compile HQL and verify exports
- Write, import, and use compiled HQL module
- Complex HQL module with classes

**Section 6: Circular Imports (1 test)**
- Circular HQL-JS dependencies

### Tests: `tests/unit/syntax-dot-notation-spaceless.test.ts` (23 tests)

**Section 1: Equivalence (spaced vs spaceless)**
- Method chain no args
- Method chain with args
- Single method call
- Multiple args per method
- Complex chain with multiple args

**Section 2: Spaceless functionality**
- Simple chain no args
- Chain with arguments
- Triple chain
- Long chain

**Section 3: Edge cases**
- js/ prefix not normalized
- Prefix dot syntax unchanged
- Numeric literal with decimal
- Arguments with dots stay as property access
- Consecutive dots normalized away
- Property access in arguments (via js-get)

**Section 4: Regression**
- Bare property access
- Spaced chains
- Complex spaced chains with args
- Mixed property and method access
- Multiline spaced notation

**Section 5: Real-world patterns**
- Data pipeline spaceless
- String manipulation
- Array operations
