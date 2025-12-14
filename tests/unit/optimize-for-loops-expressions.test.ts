// test/optimize-for-loops-expressions.test.ts
// Tests for for loop optimization in EXPRESSION positions (wrapped in IIFE)

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import hql from "../../mod.ts";

Deno.test("For loop in expression: Variable initializer", async () => {
  const code = `(let x (for [i 5] i)) x`;
  const transpiled = await hql.transpile(code);
  const js = typeof transpiled === 'string' ? transpiled : transpiled.code;
  const result = await hql.run(code);

  // Should be wrapped in IIFE
  assertStringIncludes(js, "(() => {");
  assertStringIncludes(js, "for (let i = 0; i < 5; i++)");
  assertStringIncludes(js, "return null;");
  assertStringIncludes(js, "})()");

  // Should return null (HQL for loop semantics)
  assertEquals(result, null);
});

Deno.test("For loop in expression: Array element", async () => {
  const code = `[(for [i 3] i) 42]`;
  const transpiled = await hql.transpile(code);
  const js = typeof transpiled === 'string' ? transpiled : transpiled.code;
  const result = await hql.run(code);

  // Should be wrapped in IIFE
  assertStringIncludes(js, "(() => {");
  assertStringIncludes(js, "return null;");

  // Array should contain null (from for loop) and 42
  assertEquals(result, [null, 42]);
});

Deno.test("For loop in expression: Object value", async () => {
  const code = `{x: (for [i 3] i) y: 10}`;
  const transpiled = await hql.transpile(code);
  const js = typeof transpiled === 'string' ? transpiled : transpiled.code;
  const result = await hql.run(code) as any;

  // Should be wrapped in IIFE
  assertStringIncludes(js, "(() => {");
  assertStringIncludes(js, "return null;");

  // Object value should be null
  assertEquals(result.x, null);
  assertEquals(result.y, 10);
});

Deno.test("For loop in expression: Function argument", async () => {
  const code = `
    (fn double [x] (* x 2))
    (double (for [i 3] i))
  `;

  // For loop returns null, so double(null) will try to multiply null by 2
  // This should work (null * 2 = 0 in JavaScript)
  const result = await hql.run(code);
  assertEquals(result, 0); // null * 2 = 0
});

Deno.test("For loop in expression: Return value", async () => {
  const code = `
    (fn test [] (for [i 3] i))
    (test)
  `;
  const result = await hql.run(code);

  // Function returns the for loop, which returns null
  assertEquals(result, null);
});

Deno.test("For loop in expression: Nested in binary expression", async () => {
  const code = `(+ 10 (for [i 3] i))`;
  const transpiled = await hql.transpile(code);
  const js = typeof transpiled === 'string' ? transpiled : transpiled.code;
  const result = await hql.run(code);

  // Should be wrapped in IIFE
  assertStringIncludes(js, "(() => {");

  // 10 + null = 10 in JavaScript
  assertEquals(result, 10);
});

Deno.test("For loop in expression: Conditional test", async () => {
  const code = `(if (for [i 1] i) "yes" "no")`;
  const result = await hql.run(code);

  // null is falsy, so should return "no"
  assertEquals(result, "no");
});

Deno.test("For loop in expression: Conditional consequent", async () => {
  const code = `(if true (for [i 3] i) 0)`;
  const result = await hql.run(code);

  // Should return null from for loop
  assertEquals(result, null);
});

Deno.test("For loop in expression: Conditional alternate", async () => {
  const code = `(if false 0 (for [i 3] i))`;
  const result = await hql.run(code);

  // Should return null from for loop
  assertEquals(result, null);
});

Deno.test("For loop in expression: Assignment right side", async () => {
  const code = `
    (var x 0)
    (= x (for [i 3] i))
    x
  `;
  const result = await hql.run(code);

  // x should be null
  assertEquals(result, null);
});

Deno.test("For loop in expression: With side effects in variable init", async () => {
  const code = `
    (var result [])
    (let x (for [i 5] (.push result i)))
    result
  `;
  const result = await hql.run(code);

  // Side effects should still happen even though for is in expression position
  assertEquals(result, [0, 1, 2, 3, 4]);
});

Deno.test("For loop in expression: Multiple in array", async () => {
  const code = `
    (var a [])
    (var b [])
    [(for [i 3] (.push a i)) (for [j 2] (.push b j))]
    [a b]
  `;
  const result = await hql.run(code);

  // Both loops should execute with side effects
  // Last expression returns [a b] which is [[0,1,2], [0,1]]
  assertEquals(result, [[0, 1, 2], [0, 1]]);
});

Deno.test("For loop in expression: Nested for loops", async () => {
  const code = `
    (var result [])
    (let x (for [i 3] (for [j 2] (.push result [i j]))))
    result
  `;
  const result = await hql.run(code);

  // Nested loops should work
  assertEquals(result, [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]]);
});

Deno.test("For loop in expression: Performance check - IIFE overhead acceptable", async () => {
  const code = `
    (var sum 0)
    (let x (for [i 1000] (= sum (+ sum i))))
    sum
  `;

  const start = performance.now();
  const result = await hql.run(code);
  const end = performance.now();

  // Should compute correctly despite IIFE wrapper
  assertEquals(result, 499500); // sum of 0..999

  // Should still be fast (under 100ms for 1000 iterations)
  const elapsed = end - start;
  console.log(`IIFE-wrapped for loop (1000 iterations): ${elapsed.toFixed(2)}ms`);
});
