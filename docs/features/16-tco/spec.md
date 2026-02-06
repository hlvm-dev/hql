# TCO Technical Specification

**Source:** `src/hql/transpiler/optimize/tco-optimizer.ts`, `src/hql/transpiler/optimize/mutual-tco-optimizer.ts`, `src/hql/transpiler/optimize/tail-position-analyzer.ts`

## Grammar

TCO applies to named `fn` declarations with self-recursive or mutually recursive tail calls:

```ebnf
fn-decl     ::= '(' 'fn' name params body ')'
fn*-decl    ::= '(' 'fn*' name params body ')'
tail-call   ::= recursive call to 'name' in tail position
mutual-call ::= tail call to a function in the same SCC group
```

## Tail Position Definition

An expression is in **tail position** if:

1. It is the argument of a `return` statement
2. It is in a branch of a conditional (`if`/ternary) that is in tail position
3. It is the last expression of a block that is in tail position
4. It is the right operand of a logical expression (`&&`, `||`) that is in tail position
5. It is the last expression of a sequence expression that is in tail position
6. It is the body of a labeled statement that is in tail position
7. For generators with `treatYieldDelegateAsTail`: the argument of `yield*` in tail position

### NOT in tail position

- Test expressions in conditionals
- Variable declaration initializers
- Bodies of `try`/`catch`/`finally`
- Bodies of `while`, `for`, `for-of` loops
- Left operand of logical expressions
- Arguments to function calls
- Operands of binary/unary expressions
- Elements of array/object literals

## Self-Recursive TCO

### Detection

Self-recursive TCO is applied per-function in `generateFnFunctionDeclaration`. It uses `checkTailRecursion()` from the shared tail-position analyzer to verify:
1. The function body contains at least one recursive call (call to its own name)
2. ALL recursive calls are in tail position

If both conditions hold, the function is transformed.

### Transformation

**Input pattern:**

```lisp
(fn name [p1 p2 ... pn]
  (if base-test
    base-value
    (name arg1 arg2 ... argn)))
```

**Output pattern:**

```javascript
function name(p1, p2, ..., pn) {
  while (true) {
    if (base-test) return base-value;
    [p1, p2, ..., pn] = [arg1, arg2, ..., argn];
  }
}
```

The transformation handles:
- `ReturnStatement` with direct recursive call -> destructuring parameter reassignment
- `ReturnStatement` with `ConditionalExpression` -> converted to `IfStatement` with branches transformed
- `IfStatement` -> both branches recursively transformed
- `BlockStatement` -> all statements recursively transformed
- Nested conditionals in tail position

### Generated Code Examples

#### Simple Tail Recursion

```lisp
(fn countdown [n]
  (if (<= n 0)
    "done"
    (countdown (- n 1))))
```

Compiles to:

```javascript
function countdown(n) {
  while (true) {
    if (n <= 0)
      return 'done';
    else
      [n] = [n - 1];
  }
}
```

#### Multiple Parameters

```lisp
(fn factorial [n acc]
  (if (<= n 1)
    acc
    (factorial (- n 1) (* n acc))))
```

Compiles to:

```javascript
function factorial(n, acc) {
  while (true) {
    if (n <= 1)
      return acc;
    else
      [n, acc] = [n - 1, n * acc];
  }
}
```

#### Multiple Tail Calls in Branches

```lisp
(fn collatz [n steps]
  (if (=== n 1)
    steps
    (if (=== (% n 2) 0)
      (collatz (/ n 2) (+ steps 1))
      (collatz (+ (* n 3) 1) (+ steps 1)))))
```

Compiles to:

```javascript
function collatz(n, steps) {
  while (true) {
    if (n === 1)
      return steps;
    else if (n % 2 === 0)
      [n, steps] = [n / 2, steps + 1];
    else
      [n, steps] = [n * 3 + 1, steps + 1];
  }
}
```

## Mutual TCO

Mutual recursion is handled by a separate optimizer (`mutual-tco-optimizer.ts`) applied at module level before individual function code generation.

### Algorithm

1. **Collect functions**: Gather all top-level `fn` declarations (async functions are skipped)
2. **Build call graph**: For each function, find tail calls to other known functions using `findTailCallsToFunctions()`. For generators, self-calls are included. For sync functions, self-calls are excluded (handled by while-loop TCO).
3. **Find SCCs**: Use Tarjan's algorithm to find strongly connected components. Include groups with size > 1 (mutual recursion) or single-member groups with self-tail-calls (generator self-recursion).
4. **Transform**: For each function in an SCC group:
   - **Sync functions**: Tail calls to other group members are replaced with `return () => otherFn(args)` (thunk)
   - **Generator functions**: `yield*` tail calls are replaced with `return { [Symbol.for("__hql_gen_thunk")]: true, next: () => otherFn(args) }` (tagged thunk)
5. **Trampoline wrapping**: External call sites (calls from outside the group, or calls from within the group to a different group) are wrapped with `__hql_trampoline(() => fn(args))` for sync or `__hql_trampoline_gen(() => fn(args))` for generators.

### Additional transformations

The mutual TCO transformer also handles:
- `SequenceExpression` (from `do` blocks): transforms the last expression
- IIFE patterns (`(() => { ... return tailCall(); })()`): transforms the IIFE body
- `ConditionalExpression` branches: recursively transforms both branches

### Sync Mutual TCO Example

```lisp
(fn is-even [n]
  (if (=== n 0) true (is-odd (- n 1))))
(fn is-odd [n]
  (if (=== n 0) false (is-even (- n 1))))
```

Transforms to (conceptually):

```javascript
function is_even(n) {
  if (n === 0) return true;
  return () => is_odd(n - 1);  // thunk
}
function is_odd(n) {
  if (n === 0) return false;
  return () => is_even(n - 1);  // thunk
}
// Call site: __hql_trampoline(() => is_even(10000))
```

### Generator Mutual TCO Example

```lisp
(fn* gen-a [n] (if (=== n 0) "done" (yield* (gen-b (- n 1)))))
(fn* gen-b [n] (yield* (gen-a n)))
```

Transforms to (conceptually):

```javascript
function* gen_a(n) {
  if (n === 0) return "done";
  return { [Symbol.for("__hql_gen_thunk")]: true, next: () => gen_b(n - 1) };
}
function* gen_b(n) {
  return { [Symbol.for("__hql_gen_thunk")]: true, next: () => gen_a(n) };
}
// Call site: __hql_trampoline_gen(() => gen_a(10000))
```

## Runtime Helpers

### `__hql_trampoline(thunk)`

Executes a thunk and keeps calling the result while it remains a function:

```javascript
function __hql_trampoline(thunk) {
  let result = thunk();
  while (typeof result === "function") {
    result = result();
  }
  return result;
}
```

### `__hql_trampoline_gen(createInitial)`

Generator trampoline that handles tagged-thunk objects with `Symbol.for("__hql_gen_thunk")`.

## Invariants

1. **Parameters evaluated once per iteration** - Arguments are computed before reassignment via destructuring
2. **Original semantics preserved** - Optimized code produces identical results
3. **Stack usage constant** - O(1) stack for self-recursive TCO; O(1) for mutual TCO trampoline loop
4. **Self-TCO is compile-time only** - No runtime overhead (while-loop transformation)
5. **Mutual TCO has minimal runtime overhead** - Thunk allocation + trampoline loop per call chain
6. **Async functions are excluded** - `await` naturally breaks the call stack, no TCO needed

## Edge Cases

### Not Optimized: Non-Tail Recursion

```lisp
(fn factorial [n]
  (if (<= n 1)
    1
    (* n (factorial (- n 1)))))  // Wrapped in multiplication
```

Remains as:

```javascript
function factorial(n) {
  return n <= 1 ? 1 : n * factorial(n - 1);
}
```

### Not Optimized: Non-Recursive

```lisp
(fn add [a b]
  (+ a b))
```

No transformation applied - no recursion detected.

### Not Optimized: Calls in try/catch

Recursive calls inside `try`/`catch`/`finally` blocks are not in tail position per JavaScript semantics.

## Implementation Location

- Self-TCO: `src/hql/transpiler/optimize/tco-optimizer.ts`
- Mutual TCO (Tarjan SCC + trampoline): `src/hql/transpiler/optimize/mutual-tco-optimizer.ts`
- Tail Position Analysis: `src/hql/transpiler/optimize/tail-position-analyzer.ts`
- Runtime helpers: `src/common/runtime-helper-impl.ts`
- Integration: `src/hql/transpiler/pipeline/ir-to-typescript.ts`
- Tests: `tests/unit/tco.test.ts`
