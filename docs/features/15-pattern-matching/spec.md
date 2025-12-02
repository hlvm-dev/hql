# Pattern Matching Specification

## Grammar

```ebnf
match-expr     ::= '(' 'match' expr clause+ ')'
clause         ::= case-clause | default-clause
case-clause    ::= '(' 'case' pattern guard? expr ')'
default-clause ::= '(' 'default' expr ')'
guard          ::= '(' 'if' expr ')'

pattern        ::= literal-pat | wildcard-pat | symbol-pat | array-pat | object-pat
literal-pat    ::= number | string | boolean | 'null'
wildcard-pat   ::= '_'
symbol-pat     ::= identifier
array-pat      ::= '[' (pattern (',' pattern)* (',' '&' symbol-pat)?)? ']'
object-pat     ::= '{' (key-binding (',' key-binding)*)? '}'
key-binding    ::= identifier ':' pattern
```

## Semantics

### Match Expression

```
[[match e c₁ c₂ ... cₙ]] =
  let v = [[e]]
  [[c₁]]ᵥ || [[c₂]]ᵥ || ... || [[cₙ]]ᵥ || throw "No matching pattern"
```

Where `[[cᵢ]]ᵥ` means "evaluate clause cᵢ with value v".

### Case Clause (without guard)

```
[[(case p r)]]ᵥ =
  if matches(v, p) then
    let bindings = extract(v, p)
    with bindings: [[r]]
  else
    fail
```

### Case Clause (with guard)

```
[[(case p (if g) r)]]ᵥ =
  if matches(v, p) then
    let bindings = extract(v, p)
    with bindings:
      if [[g]] then [[r]] else fail
  else
    fail
```

### Default Clause

```
[[(default r)]]ᵥ = [[r]]
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
matches(v, [p₁, p₂, ..., pₙ]) =
  Array.isArray(v) ∧
  v.length === n ∧
  matches(v[0], p₁) ∧ matches(v[1], p₂) ∧ ... ∧ matches(v[n-1], pₙ)

extract(v, [p₁, p₂, ..., pₙ]) =
  extract(v[0], p₁) ∪ extract(v[1], p₂) ∪ ... ∪ extract(v[n-1], pₙ)
```

#### Array Pattern (with rest)

```
matches(v, [p₁, ..., pₖ, & r]) =
  Array.isArray(v) ∧
  v.length >= k ∧
  matches(v[0], p₁) ∧ ... ∧ matches(v[k-1], pₖ)

extract(v, [p₁, ..., pₖ, & r]) =
  extract(v[0], p₁) ∪ ... ∪ extract(v[k-1], pₖ) ∪ {r: v.slice(k)}
```

#### Object Pattern

```
matches(v, {k₁: p₁, k₂: p₂, ..., kₙ: pₙ}) =
  typeof v === "object" ∧
  v !== null ∧
  !Array.isArray(v)

extract(v, {k₁: p₁, k₂: p₂, ..., kₙ: pₙ}) =
  {p₁: v[k₁], p₂: v[k₂], ..., pₙ: v[kₙ]}
```

Note: Object patterns use JavaScript destructuring, which extracts values even if keys don't exist (yielding `undefined`).

## Compilation Rules

### Match Expression

```
compile(match e c₁ ... cₙ) =
  ((() => {
    let $v = compile(e);
    return compile-clause(c₁, $v, [c₂...cₙ]);
  })())
```

### Case Clause

```
compile-clause((case p r), $v, rest) =
  compile-condition(p, $v) ?
    compile-body(p, $v, r) :
    compile-clause(rest[0], $v, rest[1:])

compile-clause((case p (if g) r), $v, rest) =
  compile-condition(p, $v) ?
    compile-guarded-body(p, $v, g, r, rest) :
    compile-clause(rest[0], $v, rest[1:])
```

### Default Clause

```
compile-clause((default r), $v, _) = compile(r)
```

### Condition Compilation

```
compile-condition(literal, $v) = $v === literal
compile-condition(null, $v)    = $v === null
compile-condition(_, $v)       = true
compile-condition(symbol, $v)  = true
compile-condition([p₁...pₙ], $v) =
  Array.isArray($v) && $v.length === n
compile-condition([p₁...pₖ, & r], $v) =
  Array.isArray($v) && $v.length >= k
compile-condition({...}, $v) =
  typeof $v === "object" && $v !== null && !Array.isArray($v)
```

### Body Compilation

```
compile-body(literal, $v, r) = compile(r)
compile-body(null, $v, r)    = compile(r)
compile-body(_, $v, r)       = compile(r)
compile-body(symbol, $v, r)  = (() => { let symbol = $v; return compile(r); })()
compile-body(array-pat, $v, r) = (() => { let array-pat = $v; return compile(r); })()
compile-body(object-pat, $v, r) = (() => { let object-pat = $v; return compile(r); })()
```

### Guarded Body Compilation

```
compile-guarded-body(p, $v, g, r, rest) =
  compile-body(p, $v, (if g then r else compile-clause(rest[0], $v, rest[1:])))
```

## Type Checking

Pattern matching generates the following type checks:

| Pattern | Type Check |
|---------|-----------|
| `null` | `=== null` |
| `[...]` | `Array.isArray(v)` |
| `{...}` | `typeof v === "object" && v !== null && !Array.isArray(v)` |
| literal | `=== literal` |
| symbol | (none - always matches) |
| `_` | (none - always matches) |

## Binding Scope

Variables bound by patterns are scoped to:
1. The result expression of the case clause
2. The guard expression (if present)

```lisp
(match x
  (case [a, b]           ; a, b bound here
    (if (> a b))         ; a, b available in guard
    (+ a b)))            ; a, b available in result
```

## Evaluation Order

1. Value expression evaluated once
2. Clauses checked top-to-bottom
3. Pattern condition checked first
4. If condition passes:
   - Bindings extracted
   - Guard evaluated (if present)
   - If guard passes: result evaluated
   - If guard fails: continue to next clause
5. If condition fails: continue to next clause
6. If no clause matches: throw error

## Error Handling

### No Matching Pattern

If no clause matches and no default provided:

```lisp
(match 999
  (case 1 "one")
  (case 2 "two"))
; throws: Error("No matching pattern")
```

### Invalid Clause

If clause is not `case` or `default`:

```lisp
(match x
  (when true "yes"))  ; invalid clause type
; throws: Error("Invalid match clause")
```

## Generated Code Examples

### Simple Literal Match

```lisp
(match x
  (case 42 "answer")
  (default "other"))
```

Compiles to:

```javascript
(() => {
  let match_0 = x;
  return match_0 === 42 ? "answer" : "other";
})()
```

### Symbol Binding

```lisp
(match x
  (case n (+ n 1)))
```

Compiles to:

```javascript
(() => {
  let match_0 = x;
  return true ? (() => {
    let n = match_0;
    return n + 1;
  })() : (() => { throw new Error("No matching pattern"); })();
})()
```

### Array Pattern

```lisp
(match arr
  (case [a, b] (+ a b))
  (default 0))
```

Compiles to:

```javascript
(() => {
  let match_0 = arr;
  return (v => v ? match_0.length === 2 : v)(Array.isArray(match_0)) ?
    (() => { let [a, b] = match_0; return a + b; })() :
    0;
})()
```

### Guard

```lisp
(match n
  (case x (if (> x 0)) "positive")
  (default "non-positive"))
```

Compiles to:

```javascript
(() => {
  let match_0 = n;
  return true ? (() => {
    let x = match_0;
    return x > 0 ? "positive" : "non-positive";
  })() : "non-positive";
})()
```

## Invariants

1. **Value evaluated once**: The match expression value is bound to a gensym variable
2. **Left-to-right evaluation**: Clauses are checked in source order
3. **Short-circuit**: Only the matching clause's result is evaluated
4. **Binding before guard**: Pattern variables are bound before guard is checked
5. **No fall-through**: Each clause is independent (unlike switch statements)

## Macro Implementation

The pattern matching is implemented as two macros:

### `match` Macro

```lisp
(macro match [value & clauses]
  (let (val-sym (gensym "match"))
    `(let (~val-sym ~value)
       (%match-impl ~val-sym ~@clauses))))
```

### `%match-impl` Macro

Internal implementation macro that:
1. Classifies pattern type (literal, symbol, wildcard, array, object)
2. Generates appropriate condition
3. Generates body with bindings
4. Handles guards
5. Chains to next clause on failure

See `src/lib/macro/core.hql` for full implementation.
