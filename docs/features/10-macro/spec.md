# Macro System Specification

## Syntax

### Macro Definition

```
(macro <name> [<params>] <body>...)
(macro <name> [<params> & <rest-param>] <body>...)
```

- `<name>` must be a symbol
- `<params>` is a vector of symbols
- `& <rest-param>` captures remaining arguments as a list
- `<body>` is one or more expressions evaluated at macro expansion time
- The last expression's value becomes the macro's expansion result

### Quote

```
(quote <expr>)
```

- Symbols => strings
- Numbers, strings, booleans => themselves
- `null` => null
- Lists => arrays (recursive)
- Empty list => empty array

### Quasiquote

```
(quasiquote <template>)
`<template>
```

Reader transforms: `` ` `` => `quasiquote`, `~` => `unquote`, `~@` => `unquote-splicing`.

Within a quasiquote template:
- Bare symbols/lists are quoted (code as data)
- `(unquote <expr>)` or `~<expr>` evaluates the expression
- `(unquote-splicing <expr>)` or `~@<expr>` evaluates and splices elements into the enclosing list

Nesting: each nested quasiquote increments depth. Unquote decrements depth. Evaluation only occurs at depth 0.

Outside quasiquote: `~` is the bitwise NOT operator. `~@` is a parse error.

### Auto-gensym

Within a quasiquote at depth 0, symbols ending with `#` are replaced with unique generated symbols. All occurrences of the same `foo#` within the same quasiquote share the same generated symbol.

```
`(let (tmp# ~value) (use tmp#))
;; Both tmp# map to the same gensym, e.g. tmp_42
```

Nested quasiquotes get a fresh auto-gensym scope.

### Manual Gensym

```
(gensym)          ;; => GensymSymbol with name like "g_0"
(gensym "prefix") ;; => GensymSymbol with name like "prefix_1"
```

Returns a `GensymSymbol` object. When used in `(unquote ...)` within a quasiquote, becomes an S-expression symbol (not a string literal).

## Macro Expansion Process

1. **Registration pass**: All `(macro ...)` forms in the expression list are registered in the environment
2. **Iterative expansion**: Each expression is expanded. The loop repeats until a fixed point (no changes) or the iteration limit is reached (`MAX_EXPANSION_ITERATIONS`)
3. **Filtering**: Macro definitions are removed from the final output

Within a single expansion:
- If the head of a list is a known macro, its arguments are pre-expanded (nested macro calls only), then the macro function is invoked with the arguments
- The macro function creates a child environment with parameter bindings, evaluates the body, and returns the result
- The result is recursively expanded again (to support macros that expand to other macro calls)
- Source location metadata from the call site is propagated to all expanded nodes

### Expansion Depth

Maximum recursive expansion depth: 100 (configurable via `maxExpandDepth`).

### Argument Evaluation Strategy

Macro arguments use hybrid semantics:
- Arguments whose head is a **known operator** (function, macro, special form, `%`-primitive) are evaluated
- Arguments whose head is an **unknown operator** (e.g., `case`, `default`) are preserved as syntax/data

This enables both computation macros (that need evaluated args) and code-generating macros (that receive syntax).

## Macro-Time Environment

### Special Forms

`if`, `cond`, `let`, `var`, `quote`, `quasiquote` are handled as special forms during macro-time evaluation.

### Macro Primitives

Defined in `environment.ts` with `%` prefix:

| Name | Signature | Behavior |
|------|-----------|----------|
| `%first` | `(coll)` | First element; handles vector prefix |
| `%rest` | `(coll)` | Elements after first; handles vector prefix |
| `%nth` | `(coll, index)` | Element at index |
| `%length` | `(coll)` | Element count |
| `%empty?` | `(coll)` | True if empty or null |

All handle null/undefined gracefully (return nil/0/true as appropriate).

### Introspection

| Name | Signature | Behavior |
|------|-----------|----------|
| `list?` | `(value)` | True if S-expression list |
| `symbol?` | `(value)` | True if S-expression symbol |
| `name` | `(value)` | String name of a symbol |

### Interpreter Bridge

Non-primitive function calls are evaluated via a lazy singleton `Interpreter`:
1. Try interpreter environment first (has stdlib loaded)
2. Fall back to compiler environment
3. `%`-prefixed primitives go directly to compiler environment

Named function definitions (`(fn name [...] ...)`) encountered during expansion are registered in a persistent interpreter environment, making them available to subsequent macros.

## Source Location Tracking

After expansion, `updateMetaRecursively` traverses the expanded AST and updates `_meta` on each node to point to the macro call site. This ensures error messages reference the user's source location, not the macro definition.

Update criteria: no existing metadata, different source file, or same file but earlier line (macro definition before call site).

## MacroRegistry

Manages system-level macros (from embedded `.hql` files):

- `defineSystemMacro(name, fn)` -- register a system macro
- `isSystemMacro(name)` -- check if system macro
- `hasMacro(name)` -- check if any macro defined
- `getMacro(name)` -- retrieve macro function
- `importMacro(from, name, to, alias?)` -- import system macro between files
- `markFileProcessed(path)` / `hasProcessedFile(path)` -- track processed files

## Embedded Macro Libraries

Three `.hql` source files are embedded at build time via `embedded-macros.ts`:

1. **`core.hql`** -- logic, conditionals, type predicates, utility, collections, threading, pattern matching
2. **`utils.hql`** -- `doto`, `if-not`, `when-not`, `xor`, `min`, `max`, `with-gensyms`
3. **`loop.hql`** -- `while`, `dotimes`, `repeat`, `for`

These are compiled into `EMBEDDED_MACROS` object. To modify, edit the `.hql` files and run `deno run -A scripts/embed-packages.ts`.

## Quote Transpilation (quote.ts)

The transpiler handles `quote` and `quasiquote` after macro expansion:

**Quote:**
- Symbol => `IRStringLiteral`
- Number => `IRNumericLiteral`
- Boolean => `IRBooleanLiteral`
- Null => `IRNullLiteral`
- String => `IRStringLiteral`
- List => `IRArrayExpression` with recursively quoted elements

**Quasiquote:**
- Unquote at depth 0 => transform the inner expression normally
- Unquote-splicing => `.concat()` call on arrays
- Nested quasiquote => increment depth
- Other elements => quote as atoms

## Limitations

- No automatic (Scheme-style) hygiene. Macro authors must use `gensym` or auto-gensym (`foo#`) to avoid variable capture.
- `gensym` counter never resets (monotonically increasing). No practical impact.
- Macro-time `map` produces JS arrays, not S-expressions. Use recursive macros for list processing instead.
- `super.method()` calls not supported in HQL classes generated by macros (only `(super args...)` for constructors).
- `quote` produces JavaScript values at runtime (`'foo` → `"foo"`, `'(a b)` → `["a","b"]`), not Lisp symbols/lists. This is fine because macros operate on S-expressions at compile time, before quote transformation.
