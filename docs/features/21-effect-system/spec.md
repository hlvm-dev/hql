# Effect System Technical Specification

**Source:** `src/hql/transpiler/pipeline/effect-checker.ts`, `src/hql/transpiler/pipeline/effects/`

## Grammar

```ebnf
fx-decl  ::= '(' 'fx' name params body... ')'
```

## Overview

HQL provides a compile-time effect system for enforcing function purity. Functions declared with `fx` (instead of `fn`) are checked at compile time to ensure they contain no impure operations. This enables the compiler to reason about side effects and provides safety guarantees for functional programming.

## Effect Types

```typescript
type Effect = "Pure" | "Impure";
```

- **Pure**: No observable side effects. Same inputs always produce same outputs.
- **Impure**: May perform I/O, mutation, or other side effects.

## Pure Function Declaration (fx)

### Syntax

```clojure
;; Declare a pure function
(fx add [x y]
  (+ x y))

;; Pure function with type annotations
(fx square:number [x:number]
  (* x x))

;; Pure anonymous (via function expression with pure flag)
(let double (fx [x] (* x 2)))
```

### Compilation

`fx` compiles identically to `fn` in the output JavaScript. The purity check is purely a compile-time enforcement -- no runtime overhead.

```clojure
(fx add [x y] (+ x y))
```

Compiles to:

```javascript
function add(x, y) {
  return x + y;
}
```

## ValueKind Tracking

The effect system tracks the type of values to determine method effect:

```typescript
type ValueKind =
  | "Array" | "String" | "Number" | "Boolean"
  | "Map" | "Set" | "RegExp" | "Promise"
  | "Unknown" | "Untyped";
```

ValueKind is inferred from:
- Type annotations on parameters (e.g., `x:string` -> `String`)
- Known constructor calls (e.g., `(new Map)` -> `Map`)
- Literal values (e.g., `"hello"` -> `String`, `42` -> `Number`)

The `TYPE_NAME_TO_KIND` mapping converts TypeScript type names to ValueKind:

| Type Annotation | ValueKind |
|----------------|-----------|
| `string` | `String` |
| `number` | `Number` |
| `boolean` | `Boolean` |
| `Array`, `number[]`, `string[]` | `Array` |
| `Map` | `Map` |
| `Set` | `Set` |
| `RegExp` | `RegExp` |
| `Promise` | `Promise` |
| (untyped) | `Untyped` |
| (unknown) | `Unknown` |

## Purity Enforcement Rules

### Generators Cannot Be Pure

Generator functions use `yield`, which is an observable side effect:

```clojure
;; COMPILE ERROR: Generator function 'gen' cannot be declared pure (fx)
(fx* gen [n] (yield n))
```

### No Calls to Impure Functions

Pure functions cannot call known-impure functions:

```clojure
(fn log [msg] (console.log msg))  ;; impure

;; COMPILE ERROR: impure call in pure function
(fx process [x]
  (log x)  ;; violation
  (* x 2))
```

### No Mutations

Pure functions cannot call mutating methods on collections:

```clojure
;; COMPILE ERROR: mutation in pure function
(fx bad [arr:Array]
  (.push arr 42)  ;; Array.push is impure
  arr)
```

### Callback Purity Annotations

Parameters that are callbacks can be annotated with purity constraints:

```clojure
;; The callback parameter 'f' must be pure
(fx map-pure [f:(Pure (fn [] number)) items:Array]
  (map f items))
```

## Method Effect Resolution

The effect system uses receiver type (ValueKind) to determine if a method call is pure or impure.

### Typed Method Effects

When the receiver type is known, the system looks up typed method effects:

| Receiver | Pure Methods | Impure Methods |
|----------|-------------|----------------|
| `Array` | `at`, `concat`, `entries`, `every`, `filter`, `find`, `findIndex`, `flat`, `flatMap`, `includes`, `indexOf`, `join`, `keys`, `lastIndexOf`, `map`, `reduce`, `reduceRight`, `slice`, `some`, `toReversed`, `toSorted`, `toSpliced`, `values`, `with`, `length` | `push`, `pop`, `shift`, `unshift`, `splice`, `sort`, `reverse`, `fill`, `copyWithin` |
| `String` | `at`, `charAt`, `charCodeAt`, `codePointAt`, `concat`, `endsWith`, `includes`, `indexOf`, `lastIndexOf`, `localeCompare`, `match`, `matchAll`, `normalize`, `padEnd`, `padStart`, `repeat`, `replace`, `replaceAll`, `search`, `slice`, `split`, `startsWith`, `substring`, `toLocaleLowerCase`, `toLocaleUpperCase`, `toLowerCase`, `toUpperCase`, `trim`, `trimEnd`, `trimStart`, `length` | (none) |
| `Map` | `entries`, `forEach`, `get`, `has`, `keys`, `size`, `values` | `clear`, `delete`, `set` |
| `Set` | `entries`, `forEach`, `has`, `keys`, `size`, `values` | `add`, `clear`, `delete` |
| `Number` | `toExponential`, `toFixed`, `toLocaleString`, `toPrecision`, `toString`, `valueOf` | (none) |
| `RegExp` | `exec`, `test`, `toString` | (none) |

### Untyped Method Effects

When the receiver type is unknown, the system falls back to a general method effect table that classifies methods conservatively.

### Static Member Effects

Static method calls (e.g., `Math.floor`, `JSON.parse`) have their own effect classifications:

- **Pure**: `Math.*`, `Number.isFinite`, `Number.isNaN`, `Number.isInteger`, `Number.parseFloat`, `Number.parseInt`, `String.fromCharCode`, `String.fromCodePoint`, `Object.keys`, `Object.values`, `Object.entries`, `Object.assign`, `Object.freeze`, `Object.is`, `Object.hasOwn`, `Array.isArray`, `Array.from`, `Array.of`, `JSON.parse`, `JSON.stringify`
- **Impure**: `console.*`, `Math.random`

### Function-Level Effects

Known pure functions: `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `encodeURI`, `encodeURIComponent`, `decodeURI`, `decodeURIComponent`, `String`, `Number`, `Boolean`, `BigInt`, `Symbol.for`

Known impure functions: `fetch`, `alert`, `confirm`, `prompt`, `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `requestAnimationFrame`, `queueMicrotask`

### Constructor Effects

- **Pure**: `Array`, `Map`, `Set`, `WeakMap`, `WeakSet`, `Date`, `RegExp`, `Error`, `TypeError`, `RangeError`, `ReferenceError`, `SyntaxError`, `URIError`, `URL`, `URLSearchParams`, `Intl.NumberFormat`, `Intl.DateTimeFormat`, `Intl.Collator`, `Promise`
- **Impure**: `Worker`, `WebSocket`, `EventSource`, `BroadcastChannel`, `XMLHttpRequest`, `AbortController`, `IntersectionObserver`, `MutationObserver`, `ResizeObserver`, `PerformanceObserver`

## Signature Table

The effect checker builds a signature table mapping function names to their effect metadata:

```typescript
interface FunctionSignature {
  name: string;
  effect: Effect;
  paramCount: number;
  callableParams: Map<number, ParamEffectAnnotation>;
}
```

The signature table is built from:
1. All `FnFunctionDeclaration` nodes in the IR (pure flag from `fx`)
2. All `FunctionExpression` nodes with names
3. Built-in function/method effect tables

## Higher-Order Callback Tracking

The effect system tracks which parameters of higher-order functions are callbacks, and at which positions:

```clojure
;; Array.map's first argument (index 0) is a callback
;; Array.filter's first argument (index 0) is a callback
;; Array.reduce's first argument (index 0) is a callback
```

This enables checking that callbacks passed to pure higher-order functions are themselves pure.

## Validation Process

The `checkEffects` function performs validation in two passes:

1. **Build signature table**: Scan all function declarations and build effect metadata
2. **Check pure function bodies**: For each `fx` declaration:
   - Walk the function body AST
   - Check each function call against the signature table
   - Check each method call against typed/untyped method effect tables
   - Check constructor calls
   - Collect callable parameter info
3. **Check pure parameter call sites**: Verify that arguments passed to pure-annotated callback positions are themselves pure

## Invariants

1. **Compile-time only** -- No runtime overhead; `fx` compiles identically to `fn`
2. **Conservative** -- Unknown functions/methods default to Impure
3. **Receiver-aware** -- Method effects depend on the receiver type (ValueKind)
4. **Transitive** -- A pure function calling an impure function is a violation
5. **Generator exclusion** -- Generators cannot be declared pure

## Error Messages

Effect violations produce `EffectValidationError` with descriptive messages:

- `"Generator function 'X' cannot be declared pure (fx). Generators use 'yield' which is an effect."`
- `"Pure function 'X' calls impure function 'Y'"`
- `"Pure function 'X' calls impure method '.Y' on type Z"`

## Implementation Location

- Entry point: `src/hql/transpiler/pipeline/effect-checker.ts`
- Effect types: `src/hql/transpiler/pipeline/effects/effect-types.ts`
- Effect lattice: `src/hql/transpiler/pipeline/effects/effect-lattice.ts`
- Receiver resolution: `src/hql/transpiler/pipeline/effects/effect-receiver.ts`
- Signature tables: `src/hql/transpiler/pipeline/effects/effect-signatures.ts`
- Inference: `src/hql/transpiler/pipeline/effects/effect-infer.ts`
- Environment: `src/hql/transpiler/pipeline/effects/effect-env.ts`
- Error formatting: `src/hql/transpiler/pipeline/effects/effect-errors.ts`
- Tests: `tests/unit/effect-system.test.ts`
