# Pattern Matching Specification

## Grammar

```ebnf
match-expr     ::= '(' 'match' expr clause+ ')'
clause         ::= case-clause | default-clause
case-clause    ::= '(' 'case' pattern guard? expr ')'
default-clause ::= '(' 'default' expr ')'
guard          ::= '(' 'if' expr ')'

pattern        ::= literal-pat | wildcard-pat | symbol-pat | array-pat | object-pat | or-pat
literal-pat    ::= number | string | boolean | 'null'
or-pat         ::= '(' '|' literal-pat+ ')'
wildcard-pat   ::= '_'
symbol-pat     ::= identifier
array-pat      ::= '[' (pattern (',' pattern)* (',' '&' symbol-pat)?)? ']'
object-pat     ::= '{' (key-binding (',' key-binding)*)? '}'
key-binding    ::= identifier ':' pattern
```

## Semantics

### Match Expression

```
[[match e c1 c2 ... cn]] =
  let v = [[e]]
  [[c1]]v || [[c2]]v || ... || [[cn]]v || throw "No matching pattern for value: <v>"
```

Where `[[ci]]v` means "evaluate clause ci with value v".

### Case Clause (without guard)

```
[[(case p r)]]v =
  if matches(v, p) then
    let bindings = extract(v, p)
    with bindings: [[r]]
  else
    fail
```

### Case Clause (with guard)

```
[[(case p (if g) r)]]v =
  if matches(v, p) then
    let bindings = extract(v, p)
    with bindings:
      if [[g]] then [[r]] else fail
  else
    fail
```

### Default Clause

```
[[(default r)]]v = [[r]]
```

### Pattern Matching Rules

#### Literal Pattern

```
matches(v, literal) = (v === literal)
extract(v, literal) = {}
```

#### Null Pattern

```
matches(v, null) = (v === null)
extract(v, null) = {}
```

#### Or Pattern

```
matches(v, (| p1 p2 ... pn)) = (v === p1) || (v === p2) || ... || (v === pn)
extract(v, (| p1 p2 ... pn)) = {}
```

Or-patterns do not produce bindings. They compare the value against each alternative using `===`.

#### Wildcard Pattern

```
matches(v, _) = true
extract(v, _) = {}
```

#### Symbol Pattern

```
matches(v, x) = true
extract(v, x) = {x: v}
```

#### Array Pattern (fixed length)

```
matches(v, [p1, p2, ..., pn]) =
  Array.isArray(v) &&
  v.length === n

extract(v, [p1, p2, ..., pn]) =
  JS destructuring: let [p1, p2, ..., pn] = v
```

Note: The condition checks `Array.isArray` and exact length. Binding uses JS array destructuring via an IIFE parameter.

#### Array Pattern (with rest)

```
matches(v, [p1, ..., pk, & r]) =
  Array.isArray(v) &&
  v.length >= k

extract(v, [p1, ..., pk, & r]) =
  JS destructuring: let [p1, ..., pk, ...r] = v
```

#### Object Pattern

```
matches(v, {k1: p1, k2: p2, ..., kn: pn}) =
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  k1 in v &&
  k2 in v &&
  ... &&
  kn in v
```

Object pattern matching uses the `__hql_match_obj` runtime helper which checks that the value is a non-null, non-array object and that all specified keys exist (via the `in` operator).

```
extract(v, {k1: p1, k2: p2, ..., kn: pn}) =
  JS destructuring: let {k1: p1, k2: p2, ..., kn: pn} = v
```

Binding uses JS object destructuring via an IIFE parameter. If a key exists but has value `undefined`, the binding receives `undefined`.

## Compilation Rules

### Match Expression

The `match` macro binds the value to a gensym variable (using auto-gensym `val#`) and dispatches to `__match_impl__`:

```
compile(match e c1 ... cn) =
  (let (val# e)
    (__match_impl__ val# c1 ... cn))
```

### Case Clause

`__match_impl__` processes clauses recursively. For each case clause:

```
compile-clause((case p r), val, rest) =
  condition(p, val) ?
    body(p, val, r) :
    compile-clause(rest[0], val, rest[1:])

compile-clause((case p (if g) r), val, rest) =
  condition(p, val) ?
    guarded-body(p, val, g, r, rest) :
    compile-clause(rest[0], val, rest[1:])
```

### Default Clause

```
compile-clause((default r), val, _) = r
```

### Condition Compilation

```
condition(literal, val) = (=== val literal)
condition(null, val)    = (=== val null)
condition(_, val)       = true
condition(symbol, val)  = true
condition((| p1 ... pn), val) = (__match_or_cond__ val p1 ... pn)
condition({...}, val) = (__hql_match_obj val (quote pattern))
condition([p1...pn], val) = (and (Array.isArray val) (=== (js-get val "length") n))
condition([p1...pk & r], val) = (and (Array.isArray val) (>= (js-get val "length") k))
```

### Body Compilation

```
body(literal, val, r) = r
body(null, val, r)    = r
body(_, val, r)       = r
body(symbol, val, r)  = (let (symbol val) r)
body(array-pat, val, r) = ((fn [array-pat] r) val)
body(object-pat, val, r) = ((fn [object-pat] r) val)
body((| ...), val, r) = r
```

### Guarded Body Compilation

```
guarded-body(p, val, g, r, rest) =
  body(p, val, (if g then r else compile-clause(rest[0], val, rest[1:])))
```

### Optimization

When condition is `true` (wildcard, symbol binding), the `if` wrapper is omitted:

```
// Instead of: (if true body fallback)
// Emits:      body
```

## Type Checking

Pattern matching generates the following runtime checks:

| Pattern | Condition Check |
|---------|----------------|
| `null` | `=== null` |
| `[...]` | `Array.isArray(v) && v.length === n` |
| `[... & r]` | `Array.isArray(v) && v.length >= k` |
| `{...}` | `__hql_match_obj(v, pattern)` (typeof object, not null, not array, all keys exist) |
| `(| ...)` | `v === p1 || v === p2 || ...` |
| literal | `=== literal` |
| symbol | (none - always matches) |
| `_` | (none - always matches) |

## Binding Scope

Variables bound by patterns are scoped to:
1. The guard expression (if present)
2. The result expression of the case clause

For symbol bindings, scope is created via `let`. For array/object patterns, scope is created via IIFE destructuring parameter.

```lisp
(match x
  (case [a, b]           // a, b bound here
    (if (> a b))         // a, b available in guard
    (+ a b)))            // a, b available in result
```

## Evaluation Order

1. Value expression evaluated once (bound to gensym variable)
2. Clauses checked top-to-bottom
3. Pattern condition checked first
4. If condition passes:
   - Bindings extracted (via let or IIFE destructuring)
   - Guard evaluated (if present)
   - If guard passes: result evaluated
   - If guard fails: continue to next clause
5. If condition fails: continue to next clause
6. If no clause matches: throw error with unmatched value

## Macro Implementation

The pattern matching is implemented as three macros in `src/hql/lib/macro/core.hql`:

### `match` Macro

```lisp
(macro match [value & clauses]
  `(let (val# ~value)
     (__match_impl__ val# ~@clauses)))
```

Uses auto-gensym (`val#`) for hygienic variable binding.

### `__match_impl__` Macro

Internal recursive macro that:
1. Classifies the clause kind (`case` or `default`)
2. For `case`: classifies pattern type (literal, symbol, wildcard, array, object, or-pattern)
3. Detects guards (checks if third element is `(if ...)`)
4. Generates appropriate condition
5. Generates body with bindings
6. Chains to next clause on failure via recursive `__match_impl__` call

### `__match_or_cond__` Macro

Helper for or-patterns that builds chained `===` checks recursively:

```lisp
(macro __match_or_cond__ [val-sym & pats]
  (if (%empty? pats)
      false
      (if (=== (%length pats) 1)
          `(=== ~val-sym ~(%first pats))
          `(|| (=== ~val-sym ~(%first pats))
               (__match_or_cond__ ~val-sym ~@(%rest pats))))))
```

## Invariants

1. **Value evaluated once**: The match expression value is bound to an auto-gensym variable
2. **Left-to-right evaluation**: Clauses are checked in source order
3. **Short-circuit**: Only the matching clause's result is evaluated
4. **Binding before guard**: Pattern variables are bound before guard is checked
5. **No fall-through**: Each clause is independent (unlike switch statements)
