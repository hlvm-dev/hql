# HQL Loop Constructs

HQL's iteration model is built on a fundamental `loop/recur` mechanism, which
forms the core of its iteration capabilities. Higher-level looping
constructs -- `while`, `dotimes`/`repeat`, and `for` -- are implemented as macros
on top of this core. Additional transpiler primitives provide `for-of`,
`for-await-of`, `break`, `continue`, and `label`.

---

## 1. Fundamental Loop/Recur

**Implementation:** Transpiler primitive (`loop-recur.ts`: `transformLoop`, `transformRecur`)

`loop/recur` provides explicit tail-recursive iteration where loop state is passed
via bindings. Uses `[]` for bindings (Clojure-style).

```lisp
(loop [i 0]
  (when (< i 3)
    (print "Basic loop iteration:" i)
    (recur (+ i 1))))
```

**Output:**

```
Basic loop iteration: 0
Basic loop iteration: 1
Basic loop iteration: 2
```

Simple loops (single `if` body with `recur` in one branch) are optimized to native
`while` loops with arithmetic optimizations (`i++`, `i += n`). Complex loops use a
recursive function wrapped in an IIFE.

---

## 2. While Loop (Macro)

**Implementation:** Macro in `loop.hql`

The `while` macro expands to `loop/recur`:

```lisp
(while condition body...)
;; expands to:
(loop []
  (if condition
    (do body... (recur))
    nil))
```

**Example:**

```lisp
(var count 0)

(while (< count 3)
  (print "While iteration:" count)
  (= count (+ count 1)))

(print "Final count:" count)
```

**Output:**

```
While iteration: 0
While iteration: 1
While iteration: 2
Final count: 3
```

---

## 3. Dotimes Loop (Macro, Clojure-style)

**Implementation:** Macro in `loop.hql`

The `dotimes` macro expands to `loop/recur`:

```lisp
(dotimes count body...)
;; expands to:
(loop [i 0]
  (if (< i count)
    (do body... (recur (+ i 1)))
    nil))
```

> **Note:** Named `dotimes` after Clojure's convention to avoid conflicts with
> user code and the stdlib `repeat` function. The internal counter variable `i`
> is not exposed to the body.

**Example:**

```lisp
(dotimes 3
  (print "Hello!"))
```

**Output:**

```
Hello!
Hello!
Hello!
```

**Multiple Expressions:**

```lisp
(dotimes 2
  (print "First")
  (print "Second"))
```

**Output:**

```
First
Second
First
Second
```

### 3b. Repeat (Alias)

`repeat` is an identical macro to `dotimes` (uses `__repeat_i` as internal counter).

```lisp
(repeat 3
  (print "Hello!"))
```

---

## 4. Enhanced For Loop (Macro)

**Implementation:** Macro in `loop.hql`, expands to `for-of` with runtime helpers

The `for` macro dispatches based on binding spec:
- **1 arg** `(for [i n])`: `(for-of [i (__hql_toIterable n)])` -- numbers become `range(0, n)`, iterables pass through
- **2 args** `(for [i start end])`: `(for-of [i (__hql_range start end)])`
- **3 args** `(for [i start end step])`: `(for-of [i (__hql_range start end step)])`
- **Named**: `from:`, `to:`, `by:` keywords map to the same `__hql_range` calls

### Positional Parameters

```lisp
(for [i 3]
  (print "Loop 1:" i))

(for [i 5 8]
  (print "Loop 2:" i))

(for [i 0 10 2]
  (print "Loop 3:" i))
```

**Output:**

```
Loop 1: 0
Loop 1: 1
Loop 1: 2

Loop 2: 5
Loop 2: 6
Loop 2: 7

Loop 3: 0
Loop 3: 2
Loop 3: 4
Loop 3: 6
Loop 3: 8
```

### Named Parameters

```lisp
(for [i to: 3]
  (print "Named loop 1:" i))

(for [i from: 5 to: 8]
  (print "Named loop 2:" i))

(for [i from: 0 to: 10 by: 2]
  (print "Named loop 3:" i))

(for [i to: 10 by: 3]
  (print "Named loop 4:" i))
```

**Output:**

```
Named loop 1: 0
Named loop 1: 1
Named loop 1: 2

Named loop 2: 5
Named loop 2: 6
Named loop 2: 7

Named loop 3: 0
Named loop 3: 2
Named loop 3: 4
Named loop 3: 6
Named loop 3: 8

Named loop 4: 0
Named loop 4: 3
Named loop 4: 6
Named loop 4: 9
```

### Collection Iteration

```lisp
(for [x [1 2 3]]
  (print (* x 2)))
```

**Output:**

```
2
4
6
```

---

## 5. For-Of (Transpiler Primitive)

**Implementation:** `loop-recur.ts`: `transformForOf`

Direct collection iteration with expression-everywhere semantics (returns `null`, like Clojure's `doseq`). Wrapped in an IIFE that returns `null`.

```lisp
(for-of [x [1 2 3]]
  (print x))
// Returns: null

(let result (for-of [x [1 2 3]] (print x)))
// result => null
```

When the body contains `return` statements, the IIFE wrapper is omitted so `return` escapes to the outer function.

---

## 6. For-Await-Of (Transpiler Primitive)

**Implementation:** `loop-recur.ts`: `transformForAwaitOf`

Async iteration. Generates `for await (const x of collection) { ... }` with an async IIFE wrapper.

```lisp
(for-await-of [chunk stream]
  (process chunk))
```

---

## 7. Break and Continue (Transpiler Primitives)

**Implementation:** `loop-recur.ts`: `transformBreak`, `transformContinue`

Loop control statements with optional label targeting. Require being inside a loop context (enforced at compile time).

```lisp
(break)         // break;
(break outer)   // break outer;
(continue)      // continue;
(continue outer) // continue outer;
```

---

## 8. Labeled Statements (Transpiler Primitive)

**Implementation:** `loop-recur.ts`: `transformLabel`

Names a loop for multi-level `break`/`continue`. When a `for-of` inside the label targets it, the label wraps everything in an IIFE for correct semantics.

```lisp
(label outer
  (for-of [x [1 2 3]]
    (for-of [y ["a" "b" "c"]]
      (if (and (=== x 2) (=== y "b"))
        (break outer)
        (results.push (str x y))))))
// results => ["1a", "1b", "1c", "2a"]
```

---

## 9. Range (Stdlib Function)

**Implementation:** `stdlib/js/core.js`: `range` (stdlib function); `runtime-helper-impl.ts`: `__hql_range` (runtime helper used by `for` macro)

Lazy sequence generator. Used internally by the `for` macro.

```lisp
(range 5)           // lazy seq: 0, 1, 2, 3, 4
(range 1 6)         // lazy seq: 1, 2, 3, 4, 5
(range 0 10 2)      // lazy seq: 0, 2, 4, 6, 8
(range 10 0 -1)     // lazy seq: 10, 9, ..., 1

(doall (range 5))   // materialize to array: [0, 1, 2, 3, 4]
```

---

## Summary

| Construct | Type | Implementation |
|-----------|------|---------------|
| `loop/recur` | Transpiler primitive | `loop-recur.ts` |
| `while` | Macro | Expands to `loop/recur` |
| `dotimes` | Macro | Expands to `loop/recur` |
| `repeat` | Macro | Alias for `dotimes` |
| `for` | Macro | Expands to `for-of` + `__hql_range`/`__hql_toIterable` |
| `for-of` | Transpiler primitive | `loop-recur.ts`, returns null |
| `for-await-of` | Transpiler primitive | `loop-recur.ts`, async IIFE |
| `break` | Transpiler primitive | `loop-recur.ts`, optional label |
| `continue` | Transpiler primitive | `loop-recur.ts`, optional label |
| `label` | Transpiler primitive | `loop-recur.ts` |
| `range` | Stdlib function | `stdlib/js/core.js` |
