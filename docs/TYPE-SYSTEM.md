# HQL Type System

**Version:** 1.0 | **Status:** Production Ready

HQL implements an **optional/gradual type system** that leverages TypeScript's type checker. Types are 100% optional - all existing untyped code continues to work exactly as before. Adding types provides compile-time type checking while preserving runtime behavior.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Core Principle: No Space After Colon](#2-core-principle-no-space-after-colon)
3. [Parameter Type Annotations](#3-parameter-type-annotations)
4. [Return Type Annotations](#4-return-type-annotations)
5. [Supported Types](#5-supported-types)
6. [Type Checking Behavior](#6-type-checking-behavior)
7. [Complete Examples](#7-complete-examples)
8. [Implementation Details](#8-implementation-details)
9. [Current Limitations](#9-current-limitations)

---

## 1. Overview

### Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         HQL TYPE SYSTEM PIPELINE                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│   HQL Source                                                                  │
│   (fn add [a:number b:number] :number (+ a b))                               │
│         │                                                                     │
│         ▼                                                                     │
│   ┌─────────────────┐                                                         │
│   │     Parser      │  Parses "a:number" as single token (no space!)         │
│   └────────┬────────┘                                                         │
│            │                                                                  │
│            ▼                                                                  │
│   ┌─────────────────┐                                                         │
│   │ Type Extractor  │  Splits "a:number" → name="a", type="number"           │
│   └────────┬────────┘                                                         │
│            │                                                                  │
│            ▼                                                                  │
│   ┌─────────────────┐                                                         │
│   │    HQL IR       │  IRIdentifier { name: "a", typeAnnotation: "number" }  │
│   └────────┬────────┘                                                         │
│            │                                                                  │
│            ▼                                                                  │
│   ┌─────────────────┐                                                         │
│   │  TS Generator   │  Emits: function add(a: number, b: number): number     │
│   └────────┬────────┘                                                         │
│            │                                                                  │
│            ▼                                                                  │
│   ┌─────────────────┐         ┌─────────────────┐                            │
│   │  TypeScript     │────────▶│   JavaScript    │                            │
│   │  Type Checker   │  pass   │   (executable)  │                            │
│   └────────┬────────┘         └─────────────────┘                            │
│            │                                                                  │
│            ▼                                                                  │
│   Type errors reported as WARNINGS (code still runs)                         │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Key Properties

| Property | Description |
|----------|-------------|
| **Optional** | Types are never required - untyped code works identically |
| **Gradual** | Mix typed and untyped parameters in the same function |
| **Additive** | Adding types to existing code never changes runtime behavior |
| **Warning-based** | Type errors are warnings - code always executes |
| **TypeScript-powered** | Full TypeScript type system available |

---

## 2. Core Principle: No Space After Colon

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ⚠️  CRITICAL SYNTAX RULE                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ✓ CORRECT:   [a:number b:string]      (NO space after colon)               │
│  ✗ WRONG:     [a: number b: string]    (space breaks parsing!)              │
│                                                                              │
│  WHY: HQL's S-expression parser uses whitespace as token delimiter.         │
│                                                                              │
│  With space "a: number" becomes TWO tokens:                                 │
│    Token 1: "a:"      (symbol with trailing colon)                          │
│    Token 2: "number"  (treated as separate parameter!)                      │
│                                                                              │
│  Without space "a:number" is ONE token:                                     │
│    Token 1: "a:number" (split later: name="a", type="number")               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Parameter Type Annotations

### Syntax

```
[paramName:Type]
```

- **No space** between parameter name and colon
- **No space** between colon and type
- Type can be any valid TypeScript type

### Examples

```clojure
; Single typed parameter
(fn square [x:number]
  (* x x))

; Multiple typed parameters
(fn add [a:number b:number]
  (+ a b))

; Mixed typed and untyped (gradual typing)
(fn greet [name:string times]
  (print name times))

; Generic array type
(fn first-item [items:Array<number>]
  (get items 0))

; Union type (no spaces around |)
(fn stringify [value:string|number]
  (str value))

; Any type
(fn identity [x:any]
  x)
```

### Generated TypeScript

| HQL | TypeScript |
|-----|------------|
| `[x:number]` | `(x: number)` |
| `[a:number b:string]` | `(a: number, b: string)` |
| `[typed:number untyped]` | `(typed: number, untyped)` |
| `[items:Array<number>]` | `(items: Array<number>)` |
| `[v:string\|number]` | `(v: string \| number)` |

---

## 4. Return Type Annotations

### Syntax

```
(fn name [params] :ReturnType body)
```

- Return type is prefixed with `:` (colon)
- Placed **after** the parameter list
- **Before** the function body
- **No space** between colon and type name

### Examples

```clojure
; Basic return type
(fn add [a:number b:number] :number
  (+ a b))

; String return
(fn greet [name:string] :string
  (+ "Hello, " name))

; Boolean return
(fn is-positive [n:number] :boolean
  (> n 0))

; Void return (no value returned)
(fn log-message [msg:string] :void
  (print msg))

; Any return
(fn identity [x:any] :any
  x)

; Return type without parameter types
(fn get-count [] :number
  42)

; Async function with Promise return
(async fn fetch-data [url:string] :Promise<Response>
  (await (js/fetch url)))
```

### Generated TypeScript

| HQL | TypeScript |
|-----|------------|
| `(fn f [] :number 42)` | `function f(): number { return 42; }` |
| `(fn f [x] :string x)` | `function f(x): string { return x; }` |
| `(fn f [] :void (print))` | `function f(): void { print(); }` |

---

## 5. Supported Types

### Primitive Types

| Type | Description | Example |
|------|-------------|---------|
| `number` | JavaScript number | `[x:number]` |
| `string` | JavaScript string | `[s:string]` |
| `boolean` | true/false | `[flag:boolean]` |
| `any` | Any type (escape hatch) | `[x:any]` |
| `void` | No return value | `:void` |
| `null` | Null value | `[x:null]` |
| `undefined` | Undefined value | `[x:undefined]` |
| `unknown` | Type-safe any | `[x:unknown]` |
| `never` | Never returns | `:never` |

### Compound Types

| Type | Syntax | Example |
|------|--------|---------|
| Array (generic) | `Array<T>` | `[items:Array<number>]` |
| Union | `T1\|T2` | `[v:string\|number]` |
| Promise | `Promise<T>` | `:Promise<Response>` |
| Function | `(params)=>R` | `[cb:(x:number)=>string]` |
| Object | `{k:T}` | `[pt:{x:number,y:number}]` |

### Type Examples in Context

```clojure
; Number
(fn double [x:number] :number
  (* x 2))

; String
(fn upper [s:string] :string
  (.toUpperCase s))

; Boolean
(fn negate [b:boolean] :boolean
  (not b))

; Array<T>
(fn sum [nums:Array<number>] :number
  (reduce + 0 nums))

; Union
(fn parse [input:string|number] :number
  (if (=== (typeof input) "string")
    (js/parseInt input)
    input))

; any (escape hatch)
(fn passthrough [x:any] :any
  x)

; void (side effects only)
(fn notify [msg:string] :void
  (js/console.log msg))

; Promise
(async fn load [url:string] :Promise<string>
  (let res (await (js/fetch url)))
  (await (.text res)))
```

---

## 6. Type Checking Behavior

### Warnings Not Errors

Type errors are reported as **warnings** - the code always executes:

```
$ ./hql run typed-code.hql
⚠️ Type checking found 1 error(s), 0 warning(s)
⚠️ Type error at typed-code.hql:5:3: Type 'string' is not assignable to type 'number'.
42       <-- code still runs and produces output
```

### Type Errors Caught

The TypeScript type checker catches:

1. **Type mismatches**
   ```clojure
   (fn add [a:number b:number] :number (+ a b))
   (add "hello" "world")  ; ⚠️ Argument of type 'string' is not assignable to type 'number'
   ```

2. **Wrong return types**
   ```clojure
   (fn get-num [] :number
     "not a number")  ; ⚠️ Type 'string' is not assignable to type 'number'
   ```

3. **Undefined access**
   ```clojure
   (fn first [arr:Array<number>] :number
     (get arr 0))  ; ⚠️ Type 'number | undefined' is not assignable to type 'number'
   ```

4. **Property access on wrong types**
   ```clojure
   (fn get-length [n:number] :number
     n.length)  ; ⚠️ Property 'length' does not exist on type 'number'
   ```

---

## 7. Complete Examples

### Example 1: Calculator Functions

```clojure
; Fully typed arithmetic functions
(fn add [a:number b:number] :number
  (+ a b))

(fn subtract [a:number b:number] :number
  (- a b))

(fn multiply [a:number b:number] :number
  (* a b))

(fn divide [a:number b:number] :number
  (/ a b))

; Usage
(print (add 10 5))       ; 15
(print (multiply 3 4))   ; 12
```

**Generated TypeScript:**
```typescript
function add(a: number, b: number): number {
  return (a + b);
}
function subtract(a: number, b: number): number {
  return (a - b);
}
function multiply(a: number, b: number): number {
  return (a * b);
}
function divide(a: number, b: number): number {
  return (a / b);
}
```

### Example 2: String Processing

```clojure
(fn greet [name:string] :string
  (+ "Hello, " name "!"))

(fn shout [msg:string] :string
  (.toUpperCase msg))

(fn whisper [msg:string] :string
  (.toLowerCase msg))

; Usage
(print (greet "World"))    ; "Hello, World!"
(print (shout "hello"))    ; "HELLO"
```

### Example 3: Array Operations

```clojure
(fn sum-array [nums:Array<number>] :number
  (reduce + 0 nums))

(fn first-element [arr:Array<any>] :any
  (get arr 0))

(fn array-length [arr:Array<any>] :number
  arr.length)

; Usage
(print (sum-array [1 2 3 4 5]))     ; 15
(print (first-element ["a" "b"]))   ; "a"
(print (array-length [1 2 3]))      ; 3
```

### Example 4: Gradual Typing (Mixed)

```clojure
; Mix typed and untyped in same function
(fn process [required:string optional]
  (print "Required:" required)
  (print "Optional:" optional))

; Untyped functions still work identically
(fn legacy-add [a b]
  (+ a b))

; Add types to existing code without changes
(fn modernized-add [a:number b:number] :number
  (+ a b))
```

### Example 5: Boolean Logic

```clojure
(fn is-positive [n:number] :boolean
  (> n 0))

(fn is-even [n:number] :boolean
  (=== (% n 2) 0))

(fn all-positive [nums:Array<number>] :boolean
  (every (fn [n] (> n 0)) nums))

; Usage
(print (is-positive 5))           ; true
(print (is-positive -3))          ; false
(print (is-even 4))               ; true
(print (all-positive [1 2 3]))    ; true
```

---

## 8. Implementation Details

### File Locations

| File | Purpose |
|------|---------|
| `src/transpiler/syntax/function.ts:950-978` | Extracts type annotations from parameters |
| `src/transpiler/syntax/function.ts:396-411` | Extracts return type annotations |
| `src/transpiler/type/hql_ir.ts:132-139` | IRIdentifier with typeAnnotation field |
| `src/transpiler/type/hql_ir.ts:208-222` | IRFunctionExpression with returnType field |
| `src/transpiler/pipeline/ir-to-typescript.ts:1178-1212` | Emits TypeScript type annotations |

### IR Structure

```typescript
// Parameter with type annotation
interface IRIdentifier {
  type: IRNodeType.Identifier;
  name: string;                    // "a"
  typeAnnotation?: string;         // "number"
}

// Function with return type
interface IRFunctionExpression {
  params: IRIdentifier[];
  returnType?: string;             // "number"
  body: IRBlockStatement;
}
```

### Type Extraction Algorithm

```typescript
// From src/transpiler/syntax/function.ts
const colonIndex = paramName.indexOf(":");
if (colonIndex > 0) {
  const name = paramName.slice(0, colonIndex);      // "a"
  const type = paramName.slice(colonIndex + 1);     // "number"
}
```

---

## 9. Current Limitations

### Working Features

| Feature | Status | Example |
|---------|--------|---------|
| Function param types | ✅ Working | `[x:number]` |
| Function return types | ✅ Working | `:number` |
| Primitive types | ✅ Working | `number`, `string`, `boolean` |
| Generic Array | ✅ Working | `Array<number>` |
| Union types | ✅ Working | `string\|number` |
| void/any/unknown | ✅ Working | `:void`, `:any` |
| Promise types | ✅ Working | `Promise<T>` |
| Mixed typed/untyped | ✅ Working | `[typed:number untyped]` |

### Known Limitations

| Feature | Status | Notes |
|---------|--------|-------|
| Array shorthand `T[]` | ❌ Not working | Use `Array<T>` instead |
| Constructor param types | ⚠️ Partial | Use untyped constructor params |
| Inline object types | ❌ Not working | `:{x:number}` in return position |
| Generic functions | ⚠️ Untested | `<T>` type parameters |
| Class method return types | ⚠️ Partial | May not emit correctly |

### Workarounds

```clojure
; Instead of T[] (doesn't work)
(fn sum [nums:number[]] ...)

; Use Array<T> (works)
(fn sum [nums:Array<number>] ...)

; Instead of typed constructor params (may fail)
(class Point
  (constructor [x:number y:number] ...))

; Use untyped constructor params (works)
(class Point
  (var x:number 0)
  (var y:number 0)
  (constructor [px py]
    (do
      (= this.x px)
      (= this.y py))))
```

---

## Summary

The HQL type system provides:

1. **100% backward compatibility** - existing code unchanged
2. **Gradual adoption** - add types incrementally
3. **TypeScript power** - full type system available
4. **Warnings not errors** - code always runs
5. **Simple syntax** - `param:Type` and `:ReturnType`

**Critical rule:** No space after colon in type annotations.

```clojure
; ✅ Correct
(fn add [a:number b:number] :number
  (+ a b))

; ❌ Wrong (spaces break parsing)
(fn add [a: number b: number] : number
  (+ a b))
```

---

*For the complete HQL syntax reference, see [HQL-SYNTAX.md](./HQL-SYNTAX.md).*
