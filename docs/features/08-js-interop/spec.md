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
7. **Dot notation (spaced)** - `(obj .method arg)` legacy syntax for method chaining
8. **Dot notation (spaceless)** - `(obj.method arg)` **preferred** compact form, identical behavior
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

**Edge cases:**
- `js/` prefix is preserved (not treated as dot notation): `(js/console.log "hello")`
- Spread operators `...` are not treated as dot notation
- Numeric literals with decimals (`42.5`) are not treated as dot notation
- Bare property access works: `arr.length` evaluates to the property

**Spaceless chaining caveat:** When a method argument is a bare variable (not wrapped in parens), spaceless chaining is ambiguous:
```lisp
;; WRONG — my-fn.filter is parsed as property access on my-fn
(arr.map my-fn.filter big?)

;; CORRECT — use spaced form or threading
(arr .map my-fn .filter big?)
(->> arr (.map my-fn) (.filter big?))
```
Spaceless chaining works safely when arguments are parenthesized expressions like `(fn [x] ...)` or `(=> ...)`.

### Optional Chaining

Optional chaining allows safe property access on potentially null/undefined values. It compiles directly to JavaScript optional chaining (`?.`). This is general-purpose syntax that works anywhere — in bindings, function bodies, arrow lambdas, pipelines, and expressions.

**Property access:**
```lisp
user?.name                           ;; => user?.name
data?.user?.address?.city            ;; => data?.user?.address?.city
```

**Method calls:**
```lisp
(obj?.greet "World")                 ;; => obj?.greet("World")
(arr?.includes 2)                    ;; => arr?.includes(2)
```

**Mixed with regular access:**
```lisp
company?.ceo.name                    ;; => company?.ceo.name
```

**In arrow lambdas (with `$0`):**
```lisp
(items.map (=> $0?.name))            ;; safe access on each element
```

**Combined with nullish coalescing (`??`):**
```lisp
(?? user?.name "unknown")            ;; => user?.name ?? "unknown"
(?? a (?? b c))                      ;; nested fallback chain
```

**In function bodies:**
```lisp
(fn safe-name [x] (?? x?.name "anonymous"))
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
