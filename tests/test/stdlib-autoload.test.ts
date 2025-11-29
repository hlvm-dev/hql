/**
 * Tests for stdlib auto-loading (functions available without import)
 */

import { assertEquals } from "jsr:@std/assert@1";
import { run } from "./helpers.ts";

Deno.test("Stdlib: take auto-loaded (no import needed)", async () => {
  const code = `
(let nums [1, 2, 3, 4, 5])
(take 3 nums)
`;
  const result = await run(code);
  // take returns LazySeq, convert to array
  const arr = Array.from(result);
  assertEquals(arr, [1, 2, 3]);
});

Deno.test("Stdlib: range auto-loaded (lazy infinite generator)", async () => {
  const code = `
(let lazy-range (range 10))
(take 5 lazy-range)
`;
  const result = await run(code);
  const arr = Array.from(result);
  assertEquals(arr, [0, 1, 2, 3, 4]);
});

Deno.test("Stdlib: map auto-loaded", async () => {
  const code = `
(let nums [1, 2, 3])
(doall (map (fn [x] (* x 2)) nums))
`;
  const result = await run(code);
  assertEquals(result, [2, 4, 6]);
});

Deno.test("Stdlib: filter auto-loaded", async () => {
  const code = `
(let nums [1, 2, 3, 4, 5, 6])
(doall (filter (fn [x] (=== (% x 2) 0)) nums))
`;
  const result = await run(code);
  assertEquals(result, [2, 4, 6]);
});

Deno.test("Stdlib: reduce auto-loaded", async () => {
  const code = `
(let nums [1, 2, 3, 4, 5])
(reduce (fn [acc x] (+ acc x)) 0 nums)
`;
  const result = await run(code);
  assertEquals(result, 15);
});

Deno.test("Stdlib: keys auto-loaded", async () => {
  const code = `
(let obj {"a": 1, "b": 2, "c": 3})
(keys obj)
`;
  const result = await run(code);
  assertEquals(result.sort(), ["a", "b", "c"]);
});

Deno.test("Stdlib: groupBy auto-loaded", async () => {
  const code = `
(let users [
  {"name": "Alice", "age": 28},
  {"name": "Bob", "age": 32},
  {"name": "Charlie", "age": 28}
])
(groupBy (fn [u] (get u "age")) users)
`;
  const result = await run(code);
  // groupBy now returns Map, keys are preserved as numbers
  assertEquals(result.get(28).length, 2);
  assertEquals(result.get(32).length, 1);
});

Deno.test("Stdlib: lazy chaining works", async () => {
  const code = `
(let nums [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
(let result (take 3 (filter (fn [x] (=== (% x 2) 0)) nums)))
result
`;
  const result = await run(code);
  const arr = Array.from(result);
  assertEquals(arr, [2, 4, 6]);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tests for the 9 new fundamental functions (HQL integration)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deno.test("Stdlib: first auto-loaded", async () => {
  const code = `
(let nums [1 2 3])
(first nums)
`;
  const result = await run(code);
  assertEquals(result, 1);
});

Deno.test("Stdlib: first with empty array", async () => {
  const code = `
(let nums [])
(first nums)
`;
  const result = await run(code);
  assertEquals(result, undefined);
});

Deno.test("Stdlib: rest auto-loaded", async () => {
  const code = `
(let nums [1 2 3])
(doall (rest nums))
`;
  const result = await run(code);
  assertEquals(result, [2, 3]);
});

Deno.test("Stdlib: cons auto-loaded", async () => {
  const code = `
(let nums [1 2 3])
(doall (cons 0 nums))
`;
  const result = await run(code);
  assertEquals(result, [0, 1, 2, 3]);
});

Deno.test("Stdlib: isEmpty auto-loaded", async () => {
  const code = `
(let nums [])
(isEmpty nums)
`;
  const result = await run(code);
  assertEquals(result, true);
});

Deno.test("Stdlib: isEmpty with non-empty", async () => {
  const code = `
(let nums [1])
(isEmpty nums)
`;
  const result = await run(code);
  assertEquals(result, false);
});

Deno.test("Stdlib: some auto-loaded", async () => {
  const code = `
(fn greaterThan5 [x] (> x 5))
(some greaterThan5 [1 2 6 3])
`;
  const result = await run(code);
  assertEquals(result, 6);
});

Deno.test("Stdlib: some returns null when no match", async () => {
  const code = `
(fn greaterThan10 [x] (> x 10))
(some greaterThan10 [1 2 3])
`;
  const result = await run(code);
  assertEquals(result, null);
});

Deno.test("Stdlib: comp auto-loaded (function composition)", async () => {
  const code = `
(fn double [x] (* x 2))
(fn add1 [x] (+ x 1))
(let composed (comp add1 double))
(composed 5)
`;
  const result = await run(code);
  assertEquals(result, 11); // (5 * 2) + 1 = 11
});

Deno.test("Stdlib: partial auto-loaded (partial application)", async () => {
  const code = `
(fn add [a b] (+ a b))
(let add5 (partial add 5))
(add5 10)
`;
  const result = await run(code);
  assertEquals(result, 15);
});

Deno.test("Stdlib: apply auto-loaded", async () => {
  const code = `
(fn maximum [& args] (args.reduce (fn [a b] (if (> a b) a b))))
(apply maximum [1 5 3 9 2])
`;
  const result = await run(code);
  assertEquals(result, 9);
});

Deno.test("Stdlib: iterate auto-loaded (infinite sequence)", async () => {
  const code = `
(fn increment [x] (+ x 1))
(doall (take 5 (iterate increment 0)))
`;
  const result = await run(code);
  assertEquals(result, [0, 1, 2, 3, 4]);
});

Deno.test("Stdlib: integration - Lisp trinity (first + rest + cons)", async () => {
  const code = `
(let list [1 2 3 4 5])
(let head (first list))
(let tail (rest list))
(doall (cons 0 (cons head tail)))
`;
  const result = await run(code);
  assertEquals(result, [0, 1, 2, 3, 4, 5]);
});

Deno.test("Stdlib: integration - comp with partial", async () => {
  const code = `
(fn add [a b] (+ a b))
(fn double [x] (* x 2))
(let add5ThenDouble (comp double (partial add 5)))
(add5ThenDouble 10)
`;
  const result = await run(code);
  assertEquals(result, 30); // (10 + 5) * 2 = 30
});

Deno.test("Stdlib: integration - chaining with new functions", async () => {
  const code = `
(fn isEven [x] (=== (% x 2) 0))
(fn double [x] (* x 2))
(let nums (iterate (fn [x] (+ x 1)) 0))
(doall (take 5 (filter isEven (map double nums))))
`;
  const result = await run(code);
  assertEquals(result, [0, 2, 4, 6, 8]);
});

Deno.test("Stdlib: isEmpty handles LazySeq with undefined element", async () => {
  const code = `
(let seq (iterate (fn [x] (if (=== x 0) undefined (- x 1))) 2))
(let taken (take 3 seq))
(isEmpty taken)
`;
  const result = await run(code);
  assertEquals(result, false); // Has elements, not empty!
});

Deno.test("Stdlib: groupBy preserves key types (Map-based)", async () => {
  const code = `
(let nums [1 2 3 4 5 6])
(groupBy (fn [x] (% x 3)) nums)
`;
  const result = await run(code);
  // groupBy now returns Map, not Object
  assertEquals(result instanceof Map, true);
  // Numeric keys should be preserved (not converted to strings)
  assertEquals(result.get(0), [3, 6]);
  assertEquals(result.get(1), [1, 4]);
  assertEquals(result.get(2), [2, 5]);
});

Deno.test("Stdlib: flatten handles Set", async () => {
  const code = `
(let data [[1 2] (new Set [3 4]) [5]])
(doall (flatten data))
`;
  const result = await run(code);
  assertEquals(result, [1, 2, 3, 4, 5]);
});

Deno.test("Stdlib: flatten handles Map (iterates entries)", async () => {
  const code = `
(let data [[1 2] (new Map [["a" 3] ["b" 4]])])
(doall (flatten data))
`;
  const result = await run(code);
  // Map iterates as [key, value] entries
  assertEquals(result, [1, 2, ["a", 3], ["b", 4]]);
});

Deno.test("Stdlib: flatten does NOT flatten strings", async () => {
  const code = `
(let data [[1 2] "hello" [3 4]])
(doall (flatten data))
`;
  const result = await run(code);
  // Strings should not be flattened into individual characters
  assertEquals(result, [1, 2, "hello", 3, 4]);
});
