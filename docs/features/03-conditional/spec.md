# Conditional Feature Specification

**Implementation:** `src/hql/transpiler/syntax/conditional.ts` (if, switch, case, ?, do, return, throw), `src/hql/lib/macro/core.hql` (cond, when, unless, if-let, when-let)

## Overview

HQL provides conditional expressions for control flow:

1. **`if`** - Binary conditional (true/false branches) [transpiler]
2. **`cond`** - Multi-way conditional (nested if chains) [macro]
3. **`switch`** - JavaScript-style switch statement with case/default/fallthrough [transpiler]
4. **`case`** - Clojure-style expression switch (flat val/result pairs) [transpiler]
5. **`?`** - Ternary operator (always expression, never statement) [transpiler]
6. **`when`** - Execute body when condition is true, else nil [macro]
7. **`unless`** - Execute body when condition is false, else nil [macro]
8. **`if-let`** - Conditional binding with else branch [macro]
9. **`when-let`** - Conditional binding, single branch [macro]

Supporting forms also in `conditional.ts`:
- **`do`** - Sequence expression (comma operator or IIFE)
- **`return`** - Return statement (non-local return via throw inside IIFE)
- **`throw`** - Throw statement

All conditionals are **expressions** that return values.

## Syntax

### If Expression

```lisp
(if condition then-expr else-expr)
(if condition then-expr)           ;; else defaults to nil
```

**Compilation:** `condition ? then : else` (ConditionalExpression) or IfStatement when branches contain control flow (return, throw, break, continue, loops).

**Validation:** Requires 2 or 3 arguments (condition + then + optional else).

### Cond Expression

```lisp
;; Grouped syntax (each clause is a 2-element list)
(cond
  ((< x 5) "small")
  ((< x 15) "medium")
  (else "large"))

;; Flat syntax (alternating test/result pairs)
(cond
  (< x 5) "small"
  (< x 15) "medium"
  else "large")

;; true as fallback (equivalent to else)
(cond
  ((< 5 3) "won't match")
  (true "default"))
```

**Compilation:** Macro-expands to nested `if` expressions. The `else` keyword is recognized as an unconditional match.

**Detection:** If the first clause is a list with exactly 2 elements, grouped syntax is used. Otherwise flat syntax.

### Switch Statement

```lisp
(switch expr
  (case val1 body...)
  (case val2 :fallthrough body...)
  (default body...))
```

**Compilation:** Optimized to chained ternaries when all cases are simple (no fallthrough, single return per case). Falls back to IIFE-wrapped JS switch for complex cases (fallthrough or multiple statements).

If no `default` is provided, an implicit default returning `null` is added.

### Case Expression (Clojure-style)

```lisp
(case expr
  val1 result1
  val2 result2
  default-result)     ;; optional (odd number of args = last is default)
```

**Compilation:** Always optimized to chained ternaries: `expr === val1 ? result1 : expr === val2 ? result2 : default`. Uses `===` for comparison.

If no default is provided (even number of args after expr), unmatched cases return `null`.

### Ternary Operator

```lisp
(? condition then-expr else-expr)
```

**Compilation:** Always `condition ? then : else` (ConditionalExpression). Unlike `if`, never generates IfStatement. Requires exactly 3 arguments.

### When Expression

```lisp
(when test body...)
```

**Compilation:** Macro-expands to `(if test (do body...) nil)`.

### Unless Expression

```lisp
(unless test body...)
```

**Compilation:** Macro-expands to `(if test nil (do body...))`.

### If-Let Expression

```lisp
(if-let [name expr] then-expr else-expr)
(if-let (name expr) then-expr else-expr)
```

**Compilation:** Macro-expands to bind `name` to `expr`, then execute `then-expr` if truthy, otherwise `else-expr`. Both bracket `[]` and paren `()` binding syntax are supported.

### When-Let Expression

```lisp
(when-let [name expr] body...)
(when-let (name expr) body...)
```

**Compilation:** Macro-expands to bind `name` to `expr`, then execute body if truthy. Both bracket `[]` and paren `()` binding syntax are supported.

## Implementation Details

### If Statement vs Expression

`transformIf` decides between ConditionalExpression and IfStatement:

1. If explicitly in expression context: always ConditionalExpression
2. If in loop context with `recur` in branches: IfStatement with return wrapping
3. If branches contain control flow (return, throw, break, continue, loops): IfStatement
4. Otherwise: ConditionalExpression (ternary)

### Do Block Optimization

`transformDo` uses two strategies:

1. **SequenceExpression** (comma operator) when all children are pure expressions and no early returns
2. **IIFE** when statements or control flow are present. Handles async (await), generator (yield*), and early return (throw for non-local return).

### Switch Optimization

`transformSwitch` generates:
- Chained ternaries when all cases are simple (no fallthrough, single return)
- IIFE-wrapped JS switch when fallthrough or multiple statements exist

### Return Inside IIFE

`transformReturn` checks if inside an IIFE context. If so, it generates a throw with a special early-return object (caught by IIFE wrapper) instead of a normal return.

## Macro Implementation Details

### if-let

`if-let` macro expands to an immediately-invoked function that binds the value and checks truthiness:

```lisp
(if-let [x (expr)] then else)
;; expands to:
((fn [x] (if x then else)) (expr))
```

### when-let

`when-let` macro similarly uses an immediately-invoked function:

```lisp
(when-let [x (expr)] body...)
;; expands to:
((fn [x] (when x body...)) (expr))
```

### Aliases

- `ifLet` is an alias for `if-let`
- `whenLet` is an alias for `when-let`

## Test Coverage

### conditional.test.ts
- If true/false branch
- If with expression condition
- If with multiple statements
- Nested if
- If as expression in let
- If as return value
- Cond with multiple clauses
- Cond with else clause
- Cond with expressions
- If with comparison operators (===, !=, <=, >=)

### switch-statement.test.ts
- Switch with basic cases
- Switch with string cases
- Switch with fallthrough
- Switch with complex bodies
- Switch with return in case
- Nested switch
- Switch runtime behavior (returns correct value)
- Switch with no default (implicit null)

### expression-everywhere-iteration.test.ts
- Case returns matched value
- Case returns default when no match
- Case returns null when no match and no default
- Case can be assigned to variable
- Case with numbers
- Case in expression position
- Case optimized to native ternary
- Nested case expressions
- Case inside if
- Switch returns matched value
- Switch returns default when no match
- Switch returns null when no match and no default
- Switch can be assigned to variable
- Switch with numbers
- Switch in expression position
- Switch with multi-statement body
- Switch generates native ternary (optimized)

### syntax-ternary.test.ts
- Ternary true/false branches
- Ternary with expressions
- Nested ternaries
- Ternary in expression position
- Ternary with various falsy values

### Various test files
- When/unless in multiple test files
- When-let with bracket syntax
- If-let macro expansion
