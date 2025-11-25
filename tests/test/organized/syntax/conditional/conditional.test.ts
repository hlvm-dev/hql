// test/syntax-conditional.test.ts
// Tests for if, cond, case conditionals

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "../../../helpers.ts";

Deno.test("Conditional: if true branch", async () => {
  const code = `
(if true 1 2)
`;
  const result = await run(code);
  assertEquals(result, 1);
});

Deno.test("Conditional: if false branch", async () => {
  const code = `
(if false 1 2)
`;
  const result = await run(code);
  assertEquals(result, 2);
});

Deno.test("Conditional: if with expression condition", async () => {
  const code = `
(if (> 5 3) "yes" "no")
`;
  const result = await run(code);
  assertEquals(result, "yes");
});

Deno.test("Conditional: if with multiple statements in branches", async () => {
  const code = `
(if true
  (do
    (var x 10)
    (+ x 5))
  (do
    (var y 20)
    (- y 5)))
`;
  const result = await run(code);
  assertEquals(result, 15);
});

Deno.test("Conditional: nested if", async () => {
  const code = `
(if true
  (if false 1 2)
  3)
`;
  const result = await run(code);
  assertEquals(result, 2);
});

Deno.test("Conditional: if as expression in let", async () => {
  const code = `
(let result (if (< 3 5) "less" "greater"))
result
`;
  const result = await run(code);
  assertEquals(result, "less");
});

Deno.test("Conditional: if as return value", async () => {
  const code = `
(fn check [n]
  (if (> n 0) "positive" "non-positive"))
(check 5)
`;
  const result = await run(code);
  assertEquals(result, "positive");
});

Deno.test("Conditional: cond with multiple clauses", async () => {
  const code = `
(cond
  ((< 5 3) "case1")
  ((> 5 3) "case2")
  (true "case3"))
`;
  const result = await run(code);
  assertEquals(result, "case2");
});

Deno.test("Conditional: cond with else clause", async () => {
  const code = `
(cond
  ((< 5 3) "won't match")
  (true "default"))
`;
  const result = await run(code);
  assertEquals(result, "default");
});

Deno.test("Conditional: cond with expressions", async () => {
  const code = `
(let x 10)
(cond
  ((< x 5) "small")
  ((< x 15) "medium")
  (true "large"))
`;
  const result = await run(code);
  assertEquals(result, "medium");
});

Deno.test("Conditional: if with comparison operators", async () => {
  const code = `
(if (=== 5 5) "equal" "not equal")
`;
  const result = await run(code);
  assertEquals(result, "equal");
});

Deno.test("Conditional: if with != operator", async () => {
  const code = `
(if (!= 5 3) "not equal" "equal")
`;
  const result = await run(code);
  assertEquals(result, "not equal");
});

Deno.test("Conditional: if with <= operator", async () => {
  const code = `
(if (<= 5 5) "yes" "no")
`;
  const result = await run(code);
  assertEquals(result, "yes");
});

Deno.test("Conditional: if with >= operator", async () => {
  const code = `
(if (>= 10 5) "yes" "no")
`;
  const result = await run(code);
  assertEquals(result, "yes");
});
