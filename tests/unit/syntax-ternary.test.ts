// test/syntax-ternary.test.ts
// Unit tests for ternary operator (? cond then else)
// Part of HQL v2.0 - JS syntax alignment

import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "./helpers.ts";

////////////////////////////////////////////////////////////////////////////////
// Section 1: Error Validation
////////////////////////////////////////////////////////////////////////////////

Deno.test("Ternary: error on too few arguments", async () => {
  await assertRejects(
    async () => await run('(? true "yes")'),
    Error,
    "? requires exactly 3 arguments",
  );
});

Deno.test("Ternary: error on too many arguments", async () => {
  await assertRejects(
    async () => await run('(? true "yes" "no" "extra")'),
    Error,
    "? requires exactly 3 arguments",
  );
});

Deno.test("Ternary: error on no arguments", async () => {
  await assertRejects(
    async () => await run('(?)'),
    Error,
    "? requires exactly 3 arguments",
  );
});

////////////////////////////////////////////////////////////////////////////////
// Section 2: Basic Operations
////////////////////////////////////////////////////////////////////////////////

Deno.test("Ternary: true condition returns then-branch", async () => {
  const result = await run('(? true "yes" "no")');
  assertEquals(result, "yes");
});

Deno.test("Ternary: false condition returns else-branch", async () => {
  const result = await run('(? false "yes" "no")');
  assertEquals(result, "no");
});

Deno.test("Ternary: comparison operator in condition", async () => {
  const result = await run('(? (> 5 3) "greater" "lesser")');
  assertEquals(result, "greater");
});

Deno.test("Ternary: function calls in branches", async () => {
  const code = `
    (fn double [x] (* x 2))
    (fn triple [x] (* x 3))
    (? true (double 5) (triple 5))
  `;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("Ternary: in arithmetic expression", async () => {
  const result = await run('(+ 10 (? true 5 3))');
  assertEquals(result, 15);
});

////////////////////////////////////////////////////////////////////////////////
// Section 3: Falsy Values as Condition
////////////////////////////////////////////////////////////////////////////////

Deno.test("Ternary: false as condition", async () => {
  const result = await run('(? false "then" "else")');
  assertEquals(result, "else");
});

Deno.test("Ternary: 0 as falsy condition", async () => {
  const result = await run('(? 0 "then" "else")');
  assertEquals(result, "else");
});

Deno.test("Ternary: empty string as falsy condition", async () => {
  const result = await run('(? "" "then" "else")');
  assertEquals(result, "else");
});

Deno.test("Ternary: null as falsy condition", async () => {
  const result = await run('(? null "then" "else")');
  assertEquals(result, "else");
});

Deno.test("Ternary: undefined as falsy condition", async () => {
  const result = await run('(? undefined "then" "else")');
  assertEquals(result, "else");
});

////////////////////////////////////////////////////////////////////////////////
// Section 4: Nested Ternaries
////////////////////////////////////////////////////////////////////////////////

Deno.test("Ternary: nested in then-branch", async () => {
  const result = await run('(? true (? true "A" "B") "C")');
  assertEquals(result, "A");
});

Deno.test("Ternary: nested in else-branch", async () => {
  const result = await run('(? false "A" (? true "B" "C"))');
  assertEquals(result, "B");
});

Deno.test("Ternary: 3-level nesting", async () => {
  const code = `
    (let x 15)
    (? (< x 0) "negative"
      (? (== x 0) "zero"
        (? (< x 10) "small" "large")))
  `;
  const result = await run(code);
  assertEquals(result, "large");
});

Deno.test("Ternary: multiple ternaries in expression", async () => {
  const result = await run('(* (? (> 5 3) 2 3) (? (< 1 2) 4 5))');
  assertEquals(result, 8); // 2 * 4
});

////////////////////////////////////////////////////////////////////////////////
// Section 5: Different Contexts
////////////////////////////////////////////////////////////////////////////////

Deno.test("Ternary: in let binding", async () => {
  const code = `
    (let x 10)
    (let result (? (> x 5) "big" "small"))
    result
  `;
  const result = await run(code);
  assertEquals(result, "big");
});

Deno.test("Ternary: in function return", async () => {
  const code = `
    (fn classify [x] (? (> x 0) "positive" "negative"))
    (classify 10)
  `;
  const result = await run(code);
  assertEquals(result, "positive");
});

Deno.test("Ternary: with array values", async () => {
  const result = await run('(? true [1 2 3] [4 5 6])');
  assertEquals(result, [1, 2, 3]);
});

Deno.test("Ternary: with object values", async () => {
  const result = await run('(? false {"a": 1} {"b": 2})') as Record<string, number>;
  assertEquals(result.b, 2);
});

////////////////////////////////////////////////////////////////////////////////
// Section 6: Return Values
////////////////////////////////////////////////////////////////////////////////

Deno.test("Ternary: returns null from then-branch", async () => {
  const result = await run('(? true null "value")');
  assertEquals(result, null);
});

Deno.test("Ternary: returns null from else-branch", async () => {
  const result = await run('(? false "value" null)');
  assertEquals(result, null);
});

Deno.test("Ternary: returns undefined from then-branch", async () => {
  const result = await run('(? true undefined "value")');
  assertEquals(result, undefined);
});

////////////////////////////////////////////////////////////////////////////////
// Section 7: Side Effect Evaluation
////////////////////////////////////////////////////////////////////////////////

Deno.test("Ternary: only then-branch executes", async () => {
  const code = `
    (var count 0)
    (fn increment [] (= count (+ count 1)) count)
    (? true (increment) (increment))
    count
  `;
  const result = await run(code);
  assertEquals(result, 1); // Only one increment happened
});

Deno.test("Ternary: only else-branch executes", async () => {
  const code = `
    (var count 0)
    (fn increment [] (= count (+ count 1)) count)
    (? false (increment) (increment))
    count
  `;
  const result = await run(code);
  assertEquals(result, 1); // Only one increment happened
});
