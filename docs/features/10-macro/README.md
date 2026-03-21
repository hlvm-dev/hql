# Macro System

**Source:** `src/hql/s-exp/macro.ts`, `src/hql/s-exp/macro-reader.ts`, `src/hql/s-exp/macro-registry.ts`, `src/hql/macroexpand.ts`, `src/hql/gensym.ts`, `src/hql/transpiler/syntax/quote.ts`
**Macro libraries:** `src/hql/lib/macro/core.hql`, `src/hql/lib/macro/utils.hql`, `src/hql/lib/macro/loop.hql`

## Overview

HQL provides a Lisp-style macro system for compile-time code transformation. Macros are defined with the `macro` keyword and expand before runtime. The system includes:

- `quote` / `syntax-quote` / `quasiquote` / `unquote` / `unquote-splicing` for code-as-data
- Backtick shorthand syntax (`` ` ``, `~`, `~@`)
- User-defined macros with `macro`
- Hygienic `syntax-quote` plus explicit raw `quasiquote`
- Hygiene helpers via `gensym` and auto-gensym (`foo#`)
- Macro primitives (`%first`, `%rest`, `%nth`, `%length`, `%empty?`, `%eval`, `%macroexpand-1`, `%macroexpand-all`) for S-expression manipulation
- Introspection functions (`list?`, `symbol?`, `name`) available at macro-time
- `&form` / `&env` pseudo-params and destructuring in macro parameter lists
- `macroexpand` / `macroexpand1` / `macroexpandAll` / `macroexpandTrace` for debugging macro expansion

## Defining Macros

```lisp
(macro name [params] body)
(macro name [params & rest-param] body)
(macro name [&form &env params] body)
```

The keyword is `macro` (not `defmacro`). Parameters use vector syntax `[...]`. Rest parameters use `&`. Macro parameter lists also support vector/map destructuring. `&form` and `&env` may appear at the front of the parameter list to access the original invocation form and the current macro environment snapshot.

```lisp
(macro when [test & body]
  `(if ~test
       (do ~@body)
       nil))

(when (> x 5) (print "big"))
;; expands to: (if (> x 5) (do (print "big")) nil)
```

## Quote

`quote` prevents evaluation and converts code to data:

```lisp
(quote x)              ;; => "x" (symbol becomes string)
(quote 42)             ;; => 42
(quote "hello")        ;; => "hello"
(quote true)           ;; => true
(quote ())             ;; => [] (empty list becomes empty array)
(quote (a b c))        ;; => ["a", "b", "c"]
(quote (a (b c) d))    ;; => ["a", ["b", "c"], "d"]
```

Symbols become strings. Lists become arrays (recursive). Primitives pass through.

## Syntax-Quote, Quasiquote, and Unquote

`syntax-quote` is the hygienic template form. It resolves non-local symbols, preserves local binding identity metadata, and still supports `unquote` / `unquote-splicing`:

```lisp
(syntax-quote (a b c))                        ;; => ["a", "b", "c"]

(var x 10)
(syntax-quote (a (unquote x) c))              ;; => ["a", 10, "c"]

(var nums [1, 2, 3])
(syntax-quote (a (unquote-splicing nums) b))  ;; => ["a", 1, 2, 3, "b"]
```

### Backtick Shorthand

The parser transforms backtick syntax into the long forms:

| Shorthand | Long form |
|-----------|-----------|
| `` `(...) `` | `(syntax-quote (...))` |
| `~expr` | `(unquote expr)` |
| `~@expr` | `(unquote-splicing expr)` |

```lisp
(var x 42)
`(result is ~x)          ;; => ["result", "is", 42]

(var items [1 2 3])
`(a ~@items b)           ;; => ["a", 1, 2, 3, "b"]
```

Outside of a quasiquote context, `~` is treated as the bitwise NOT operator. `~@` outside quasiquote is a parse error.

### Raw Quasiquote

`quasiquote` remains available as the raw, non-resolving template form. Use it when you explicitly want a template without hygienic symbol resolution.

### Nested Template Quotes

Template quotes support nesting with depth tracking. Each nested `syntax-quote` or `quasiquote` increments depth; each unquote decrements it. Only at depth 0 does unquote evaluate the expression.

## Macro Hygiene

HQL uses hygienic `syntax-quote` for symbol resolution, plus explicit gensym-based control when you need to construct fresh locals yourself. Two mechanisms are available:

### Auto-gensym (`foo#`)

Inside a `syntax-quote` or `quasiquote` template, symbols ending with `#` are automatically replaced with unique generated symbols. All occurrences of the same `foo#` within the same template map to the same symbol.

```lisp
(macro match [value & clauses]
  `(let (val# ~value)
     (__match_impl__ val# ~@clauses)))
;; val# is replaced with a unique symbol like val_42
```

### Manual gensym

The `gensym` function generates unique symbol names at macro expansion time:

```lisp
(macro xor [a b]
  (let (ga (gensym "xor_a")
        gb (gensym "xor_b"))
    `(let (~ga ~a
           ~gb ~b)
       (if ~ga (not ~gb) ~gb))))
```

`gensym` returns a `GensymSymbol` object. When unquoted in a macro, it becomes a symbol (not a string literal).

### `with-gensyms` Macro

A utility macro (from `utils.hql`) that binds multiple gensyms at once:

```lisp
(macro my-swap [a b]
  (with-gensyms [tmp]
    `(let (~tmp ~a)
       (= ~a ~b)
       (= ~b ~tmp))))
```

## Macro Primitives

These functions are available during macro expansion for S-expression manipulation. They use the `%` prefix convention and are defined in `environment.ts`:

| Primitive | Description |
|-----------|-------------|
| `%first` | First element of a list/vector |
| `%rest` | All elements after the first |
| `%nth` | Element at index |
| `%length` | Number of elements |
| `%empty?` | Whether collection is empty |

These operate on S-expression structures (not runtime arrays). They handle vector syntax (`[a b]` parsed as `(vector a b)`) by skipping the `vector` prefix.

## Introspection Functions

Available at macro-time for inspecting S-expression types:

| Function | Description |
|----------|-------------|
| `list?` | True if value is an S-expression list |
| `symbol?` | True if value is an S-expression symbol |
| `name` | Returns the string name of a symbol |

```lisp
(macro cond [& clauses]
  (if (%empty? clauses)
      nil
      (let (first-clause (%first clauses))
        (if (list? first-clause)
            ;; grouped syntax
            ...))))
```

## Macro-Time Evaluation

Macro bodies can use the following at expansion time:

- **`if`**, **`cond`**, **`let`**, **`var`** -- control flow and bindings
- **`quote`**, **`syntax-quote`**, **`quasiquote`** -- code construction
- **Macro primitives** (`%first`, `%rest`, etc.)
- **Arithmetic and comparison** (`+`, `-`, `===`, `>=`, etc.) via interpreter bridge
- **User-defined functions** -- named `fn` definitions are registered in a persistent interpreter environment and can be called from later macros

Macros receive raw forms by default, including nested macro calls. If you want to force macro-time execution of a raw form, use `%eval`. `%macroexpand-1` and `%macroexpand-all` expose explicit expansion from inside macro bodies.

The macro system uses a lazy singleton interpreter with a persistent environment for evaluating macro-time expressions. User-defined functions survive across macro expansions.

## Debugging Macros

### `macroexpand`

Fully expand all macros in a source string (returns array of S-expression strings):

```typescript
import { macroexpand } from "hql";
const result = await macroexpand(`(when true (print "hello"))`);
```

### `macroexpand1`

Single-step expansion (one iteration, no recursive descent):

```typescript
import { macroexpand1 } from "hql";
const result = await macroexpand1(`(when true (print "hello"))`);
```

### `macroexpandAll`

Full fixed-point expansion alias:

```typescript
import { macroexpandAll } from "hql";
const result = await macroexpandAll(`(when true (print "hello"))`);
```

### `macroexpandTrace`

Machine-readable expansion trace for tooling and debugging:

```typescript
import { macroexpandTrace } from "hql";
const result = await macroexpandTrace(`(when true (print "hello"))`);
// result.trace => [{ stage, before, after, macroName?, iteration?, ... }]
```

### Visualization

When the `macro` log namespace is enabled, macro expansions are printed with ASCII visualization showing original and expanded forms.

## Built-in Macros

### Core Macros (core.hql)

**Logic:**
- `not` -- `(not x)` => `(if x false true)`
- `and` -- short-circuit, recursive. `(and)` => `true`, `(and x)` => `x`, `(and x y z)` => `(&& x (&& y z))`
- `or` -- short-circuit, recursive. `(or)` => `false`, `(or x)` => `x`, `(or x y z)` => `(|| x (|| y z))`

**Conditionals:**
- `when` -- `(when test & body)` => `(if test (do ...body) nil)`
- `unless` -- `(unless test & body)` => `(if test nil (do ...body))`
- `if-let` -- `(if-let [name expr] then else)` -- binds name, executes then if truthy
- `when-let` -- `(when-let [name expr] & body)` -- binds name, executes body if truthy
- `cond` -- multi-branch conditional. Supports grouped syntax `((test result) ...)` and flat syntax `(test result ...)`
- `ifLet` / `whenLet` -- camelCase aliases for `if-let` / `when-let`

**Type predicates (compile to inline JS):**
- `isNull`, `isUndefined`, `isNil`, `isDefined`, `notNil`
- `isString`, `isNumber`, `isBoolean`, `isFunction`, `isSymbol`
- `isArray`, `isObject`

**Utility:**
- `inc` / `dec` -- `(inc x)` => `(+ x 1)`
- `print` -- `(print & args)` => `(console.log ...args)` (with format-print dispatch when 2 args)
- `str` -- string concatenation. `(str)` => `""`, `(str x)` => `(+ "" x)`, `(str a b)` => `(+ a b)`
- `length` -- `(length coll)` => null-safe `.length` access
- `list` -- `(list & items)` => `[...items]`
- `contains` -- `(contains coll key)` => `coll.has(key)`
- `set` -- `(set target value)` => `(= target value)`
- `method-call` -- `(method-call obj method & args)` => `(js-call obj method ...args)`
- `hasElements` -- `(hasElements coll)` => `(> (length coll) 0)`
- `isEmptyList` -- `(isEmptyList coll)` => `(=== (length coll) 0)`

**Collections:**
- `hash-map` -- `(hash-map & items)` => `(__hql_hash_map ...items)`
- `empty-map` -- `(empty-map)` => `(hash-map)` => `{}`
- `empty-set` -- `(empty-set)` => `(hash-set)` => `new Set()`
- `empty-array` -- `(empty-array)` => `(vector)` => `[]`

**Threading:**
- `->` (thread-first) -- `(-> x (f a) (g b))` => `(g (f x a) b)`
- `->>` (thread-last) -- `(->> x (f a) (g b))` => `(g b (f a x))`
- `as->` (thread-as) -- `(as-> 2 x (+ x 1) (* x 3))` -- binds value to named symbol for arbitrary placement

**Pattern matching:**
- `match` -- `(match value (case pattern result) ... (default result))`
- Supported patterns: literals, wildcard `_`, symbol binding, arrays `[a b]`, rest `[h & t]`, objects `{name age}`, or-patterns `(| p1 p2 p3)`, guards `(if condition)`

### Utility Macros (utils.hql)

- `doto` -- execute forms with object as first arg, return object
- `if-not` -- swaps then/else branches
- `when-not` -- execute body when condition is falsy
- `xor` -- logical exclusive or (uses gensym for hygiene)
- `min` / `max` -- `(min & args)` => `(Math.min ...args)`
- `with-gensyms` -- bind multiple gensyms for hygienic macro writing

### Loop Macros (loop.hql)

- `while` -- `(while condition & body)` -- built on `loop`/`recur`
- `dotimes` -- `(dotimes count & body)` -- execute body N times
- `repeat` -- alias for `dotimes`
- `for` -- enhanced iteration with multiple syntaxes: `(for (x coll) body)`, `(for (i start end) body)`, `(for (i from: 0 to: 10 by: 2) body)`

## Transform Pipeline

```
HQL Source
  |
  v
Parser (backtick => syntax-quote, ~ => unquote, ~@ => unquote-splicing)
  |
  v
Macro Expansion (compile-time, iterative fixed-point)
  |
  v
S-expression AST (macro definitions filtered out)
  |
  v
IR Nodes (quote.ts handles quote/quasiquote => IR)
  |
  v
ESTree AST
  |
  v
JavaScript
```

## Implementation Details

- Macro definitions are registered in the `Environment` and expanded iteratively to a fixed point (max iterations controlled by `MAX_EXPANSION_ITERATIONS`)
- Maximum expansion depth is 100 by default (`maxExpandDepth`)
- Maximum quasiquote nesting depth is enforced by the parser
- Source location metadata is propagated from macro call sites to expanded code via `updateMetaRecursively`, so error messages point to user code, not macro definitions
- The `MacroRegistry` class manages system-level macros (from `.hql` library files)
- Macro-time evaluation uses a lazy singleton `Interpreter` with a persistent environment (`bridgeToInterpreterEnv` copies compiler scope bindings)
