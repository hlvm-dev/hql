# TCO Technical Specification

## Grammar

TCO applies to named `fn` declarations with self-recursive tail calls:

```ebnf
fn-decl     ::= '(' 'fn' name params body ')'
tail-call   ::= recursive call to 'name' in tail position
```

## Tail Position Definition

A expression is in **tail position** if:

1. It's the return value of the function body
2. It's in a branch of a conditional that is in tail position
3. It's the last expression of a block that is in tail position

### Formal Rules

```
tail-position(return e) = e
tail-position(if test then else) =
  tail-position(then) ∧ tail-position(else)
tail-position(block s₁ s₂ ... sₙ) = tail-position(sₙ)
```

## Transformation Rules

### Input Pattern

```lisp
(fn name [p₁ p₂ ... pₙ]
  (if base-test
    base-value
    (name arg₁ arg₂ ... argₙ)))
```

### Output Pattern

```javascript
function name(p₁, p₂, ..., pₙ) {
  while (true) {
    if (base-test) return base-value;
    [p₁, p₂, ..., pₙ] = [arg₁, arg₂, ..., argₙ];
  }
}
```

## Detection Algorithm

```
function canApplyTCO(func):
  name = func.id.name
  body = func.body

  # Check if function contains any recursive calls
  if not containsRecursiveCall(body, name):
    return false

  # Check if all recursive calls are in tail position
  tailCalls = findTailCalls(body, name)
  return tailCalls.length > 0

function findTailCalls(node, funcName):
  tailCalls = []

  if node is ReturnStatement:
    if node.argument is CallExpression to funcName:
      tailCalls.push(node.argument)
    else if node.argument is ConditionalExpression:
      tailCalls.concat(findTailCallsInExpr(consequent))
      tailCalls.concat(findTailCallsInExpr(alternate))

  if node is IfStatement:
    tailCalls.concat(findTailCalls(consequent))
    if alternate: tailCalls.concat(findTailCalls(alternate))

  if node is BlockStatement:
    tailCalls.concat(findTailCalls(lastStatement))

  return tailCalls
```

## Transformation Algorithm

```
function applyTCO(func):
  name = func.id.name
  params = func.params
  body = func.body

  # Transform body to replace tail calls with assignments
  transformedBody = transformNode(body, name, params)

  # Wrap in while(true) loop
  return {
    ...func,
    body: {
      type: WhileStatement,
      test: true,
      body: transformedBody
    }
  }

function transformNode(node, funcName, params):
  if node is ReturnStatement with tail call:
    # Replace: return funcName(arg1, arg2, ...)
    # With:    [p1, p2, ...] = [arg1, arg2, ...]
    return AssignmentExpression(
      ArrayPattern(params),
      ArrayExpression(call.arguments)
    )

  if node is ConditionalExpression with tail calls:
    # Convert to IfStatement for proper control flow
    return IfStatement(
      test,
      transformBranch(consequent),
      transformBranch(alternate)
    )

  # ... handle other node types
```

## Generated Code Examples

### Simple Tail Recursion

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

### Multiple Parameters

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

### Multiple Tail Calls in Branches

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

## Invariants

1. **Parameters evaluated once per iteration** - Arguments are computed before reassignment
2. **Original semantics preserved** - Optimized code produces same results
3. **Stack usage constant** - O(1) stack regardless of recursion depth
4. **No runtime overhead** - Transformation is pure compile-time

## Edge Cases

### Not Optimized: Non-Tail Recursion

```lisp
(fn factorial [n]
  (if (<= n 1)
    1
    (* n (factorial (- n 1)))))  ; Wrapped in multiplication
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

## Implementation Location

- Detection: `src/transpiler/optimize/tco-optimizer.ts`
- Integration: `src/transpiler/pipeline/ir-to-estree.ts`
- Tests: `tests/unit/tco.test.ts`
