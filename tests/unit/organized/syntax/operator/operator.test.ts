import { assertEquals } from "jsr:@std/assert@1";
import { run } from "../../../helpers.ts";

Deno.test("Operator syntax: arithmetic operators compose across numeric and string operands", async () => {
  const result = await run(`
[
  (+ 1 2 3)
  (+ 10.5 20.3)
  (- 50 30)
  (* 2.5 4.0)
  (/ 10.0 4.0)
  (% 17 5)
  (+ (* 2 3) (- 10 5))
  (+ "Hello, " "World!")
]
`);

  assertEquals(result, [6, 30.8, 20, 10, 2.5, 2, 11, "Hello, World!"]);
});

Deno.test("Operator syntax: comparison operators preserve boolean semantics", async () => {
  const result = await run(`
(let a 10)
(let b 20)
(let greeting "hello")
[
  (< 5 10)
  (< 10 5)
  (> 10 5)
  (<= 10 10)
  (>= 15 10)
  (=== 42 42)
  (=== greeting "hello")
  (!= a b)
  (!= a a)
]
`);

  assertEquals(result, [true, false, true, true, true, true, true, true, false]);
});

Deno.test("Operator syntax: logical operators compose with nested comparisons", async () => {
  const result = await run(`
(let y 20)
[
  (and true true)
  (and true false)
  (or false true)
  (or false false)
  (not false)
  (and (> 10 5) (or (=== y 20) (< y 10)))
]
`);

  assertEquals(result, [true, false, true, false, true, true]);
});

Deno.test("Operator syntax: primitive literals evaluate to their runtime values", async () => {
  const result = await run(`
[42 3.14159 -42 "Hello, HQL!" "" true false null undefined]
`);

  assertEquals(result, [42, 3.14159, -42, "Hello, HQL!", "", true, false, null, undefined]);
});

Deno.test("Operator syntax: operators remain first-class runtime values", async () => {
  const result = await run(`
(let ternary-op (? true + -))
[
  (reduce + 0 [1 2 3 4 5])
  ((fn [op a b] (op a b)) * 6 7)
  ((fn [op] (op 10 20)) +)
  (ternary-op 10 3)
  ((fn [cmp] (cmp 10 5)) >)
]
`);

  assertEquals(result, [15, 42, 30, 13, true]);
});
