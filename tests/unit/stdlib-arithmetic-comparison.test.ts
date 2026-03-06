/**
 * Core arithmetic/comparison stdlib contracts.
 * Keep only first-class operator behavior and representative runtime semantics.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

// Runtime coverage only: these stdlib globals exist at execution time, but
// some current type declarations still lag variadic/operator aliases.
const runRuntime = (code: string) => run(code, { typeCheck: false });

Deno.test("Stdlib arithmetic: identity, unary, variadic, and remainder semantics", async () => {
  const result = await runRuntime(`
[
  (add)
  (add 42)
  (add 1 2 3 4)
  (sub 5)
  (sub 100 10 20 30)
  (mul)
  (mul 2 3 4)
  (div 4)
  (div 100 2 5)
  (mod 10 3)
]
`);

  assertEquals(result, [0, 42, 10, -5, 40, 1, 24, 0.25, 10, 1]);
});

Deno.test("Stdlib arithmetic: functions work as higher-order values", async () => {
  const result = await runRuntime(`
[
  (reduce add 0 [1 2 3 4 5])
  (reduce sub 100 [10 20 30])
  (reduce mul 1 [1 2 3 4 5])
  (reduce div 1000 [10 10])
  (doall (map inc [1 2 3]))
  (doall (map dec [1 2 3]))
]
`);

  assertEquals(result, [15, 40, 120, 10, [2, 3, 4], [0, 1, 2]]);
});

Deno.test("Stdlib comparison: eq and neq cover scalar and variadic equality", async () => {
  const result = await runRuntime(`
[
  (eq 1 1)
  (eq 5 5 5 5)
  (eq 5 5 5 6)
  (eq "hello" "hello")
  (neq 1 2)
  (neq 1 1)
]
`);

  assertEquals(result, [true, true, false, true, true, false]);
});

Deno.test("Stdlib comparison: deepEq handles nested and cyclic structures", async () => {
  const result = await runRuntime(`
(let nested-a [1 [2 3] {"x": 4}])
(let nested-b [1 [2 3] {"x": 4}])
(let a {"v": 1})
(js-set a "self" a)
(let b {"v": 1})
(js-set b "self" b)
(let c {"v": 2})
(js-set c "self" c)
[(deepEq nested-a nested-b) (deepEq a b) (deepEq a c)]
`);

  assertEquals(result, [true, true, false]);
});

Deno.test("Stdlib comparison: ordered comparisons preserve strict and inclusive ordering", async () => {
  const result = await runRuntime(`
[
  (lt 1 2 3 4 5)
  (lt 1 2 3 3)
  (gt 5 4 3 2 1)
  (lte 1 2 2 3)
  (lte 2 2)
  (gte 5 5 3 2)
  (gte 2 2)
]
`);

  assertEquals(result, [true, false, true, true, true, true, true]);
});
