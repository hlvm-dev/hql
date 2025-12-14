// test/optimize-for-loops.test.ts
// Unit tests for Phase 2C: For loop optimization

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import hql from "../../mod.ts";

Deno.test("For loop optimization: Basic range (0 to n)", async () => {
  const code = `(var result []) (for [i 10] (.push result i)) result`;
  const transpiled = await hql.transpile(code);
  const js = typeof transpiled === 'string' ? transpiled : transpiled.code;
  const result = await hql.run(code);

  // Verify native for loop was generated
  assertStringIncludes(js, "for (let i = 0; i < 10; i++)");

  // Verify no __hql_for_each runtime helper
  assertEquals(js.includes("__hql_for_each"), false);

  // Verify correct result
  assertEquals(result, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

Deno.test("For loop optimization: Range with start and end", async () => {
  const code = `(var result []) (for [i 5 15] (.push result i)) result`;
  const transpiled = await hql.transpile(code);
  const js = typeof transpiled === 'string' ? transpiled : transpiled.code;
  const result = await hql.run(code);

  // Verify native for loop was generated
  assertStringIncludes(js, "for (let i = 5; i < 15; i++)");

  // Verify no __hql_for_each runtime helper
  assertEquals(js.includes("__hql_for_each"), false);

  // Verify correct result
  assertEquals(result, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
});

Deno.test("For loop optimization: Range with step", async () => {
  const code = `(var result []) (for [i 0 20 2] (.push result i)) result`;
  const transpiled = await hql.transpile(code);
  const js = typeof transpiled === 'string' ? transpiled : transpiled.code;
  const result = await hql.run(code);

  // Verify native for loop was generated with step
  assertStringIncludes(js, "for (let i = 0; i < 20; i += 2)");

  // Verify no __hql_for_each runtime helper
  assertEquals(js.includes("__hql_for_each"), false);

  // Verify correct result
  assertEquals(result, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
});

Deno.test("For loop optimization: Multiple statements in body", async () => {
  const code = `
    (var sum 0)
    (var result [])
    (for [i 5]
      (= sum (+ sum i))
      (.push result i))
    result
  `;
  const transpiled = await hql.transpile(code);
  const js = typeof transpiled === 'string' ? transpiled : transpiled.code;
  const result = await hql.run(code);

  // Verify native for loop was generated
  assertStringIncludes(js, "for (let i = 0; i < 5; i++)");

  // Verify no __hql_for_each runtime helper
  assertEquals(js.includes("__hql_for_each"), false);

  // Verify correct result
  assertEquals(result, [0, 1, 2, 3, 4]);
});


Deno.test("For loop optimization: No return statement in loop body", async () => {
  const code = `
    (var result [])
    (for [i 3] (.push result i))
    result
  `;
  const transpiled = await hql.transpile(code);
  const js = typeof transpiled === 'string' ? transpiled : transpiled.code;

  // Verify no return statement inside for loop body
  const forLoopMatch = js.match(/for\s*\([^)]+\)\s*\{([^}]+)\}/);
  if (forLoopMatch) {
    const loopBody = forLoopMatch[1];
    assertEquals(loopBody.includes("return"), false, "Loop body should not contain return statement");
  }

  const result = await hql.run(code);
  assertEquals(result, [0, 1, 2]);
});

Deno.test("For loop optimization: Negative step (reverse iteration)", async () => {
  const code = `(var result []) (for [i 10 0 -1] (.push result i)) result`;
  const transpiled = await hql.transpile(code);
  const js = typeof transpiled === 'string' ? transpiled : transpiled.code;
  const result = await hql.run(code);

  // Verify native for loop with negative step uses > operator
  assertStringIncludes(js, "for (let i = 10; i > 0;");

  // Verify correct result (10 down to 1, not including 0)
  assertEquals(result, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
});

Deno.test("For loop optimization: Empty loop body", async () => {
  const code = `(var x 0) (for [i 5]) x`;
  const transpiled = await hql.transpile(code);
  const js = typeof transpiled === 'string' ? transpiled : transpiled.code;
  const result = await hql.run(code);

  // Verify native for loop was generated
  assertStringIncludes(js, "for (let i = 0; i < 5; i++)");

  // Verify correct result (x unchanged)
  assertEquals(result, 0);
});

Deno.test("For loop optimization: Accumulator pattern", async () => {
  const code = `
    (var sum 0)
    (for [i 1 11] (= sum (+ sum i)))
    sum
  `;
  const transpiled = await hql.transpile(code);
  const js = typeof transpiled === 'string' ? transpiled : transpiled.code;
  const result = await hql.run(code);

  // Verify native for loop was generated
  assertStringIncludes(js, "for (let i = 1; i < 11; i++)");

  // Verify correct result (sum of 1 to 10)
  assertEquals(result, 55);
});
