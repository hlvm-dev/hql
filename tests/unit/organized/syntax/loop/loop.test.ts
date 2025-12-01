// test/organized/syntax/loop/loop.test.ts
// Tests for loop and recur constructs

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "../../../helpers.ts";

Deno.test("Loop: basic loop with recur", async () => {
  const code = `
(var sum 0)
(loop (i 0)
  (if (< i 5)
    (do
      (= sum (+ sum i))
      (recur (+ i 1)))
    sum))
`;
  const result = await run(code);
  assertEquals(result, 10); // 0+1+2+3+4
});

Deno.test("Loop: loop with multiple bindings", async () => {
  const code = `
(loop (i 0 acc 0)
  (if (< i 5)
    (recur (+ i 1) (+ acc i))
    acc))
`;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("Loop: factorial using loop/recur", async () => {
  const code = `
(loop (n 5 acc 1)
  (if (<= n 1)
    acc
    (recur (- n 1) (* acc n))))
`;
  const result = await run(code);
  assertEquals(result, 120);
});

Deno.test("Loop: fibonacci using loop/recur", async () => {
  const code = `
(loop (n 7 a 0 b 1)
  (if (=== n 0)
    a
    (recur (- n 1) b (+ a b))))
`;
  const result = await run(code);
  assertEquals(result, 13); // 7th fibonacci number
});

Deno.test("Loop: countdown using loop/recur", async () => {
  const code = `
(var result [])
(loop (i 5)
  (if (> i 0)
    (do
      (.push result i)
      (recur (- i 1)))
    result))
`;
  const result = await run(code);
  assertEquals(result, [5, 4, 3, 2, 1]);
});

Deno.test("Loop: sum of array using loop/recur", async () => {
  const code = `
(var nums [1, 2, 3, 4, 5])
(loop (i 0 sum 0)
  (if (< i nums.length)
    (recur (+ i 1) (+ sum (get nums i)))
    sum))
`;
  const result = await run(code);
  assertEquals(result, 15);
});

Deno.test("Loop: collect even numbers", async () => {
  const code = `
(var result [])
(loop (i 0)
  (if (< i 10)
    (do
      (if (=== (% i 2) 0)
        (.push result i)
        nil)
      (recur (+ i 1)))
    result))
`;
  const result = await run(code);
  assertEquals(result, [0, 2, 4, 6, 8]);
});

// FIXED: Transpiler now correctly handles nested if with mixed branches
// (one branch is expression, other is statement/recur) in loop context.
// The fix recursively detects recur in nested if expressions and generates
// proper IfStatement IR nodes with ReturnStatement wrappers for value branches.
Deno.test("Loop: find first element matching condition", async () => {
  const code = `
(var nums [1, 3, 5, 8, 9, 12])
(loop (i 0)
  (if (< i nums.length)
    (if (=== (% (get nums i) 2) 0)
      (get nums i)
      (recur (+ i 1)))
    nil))
`;
  const result = await run(code);
  assertEquals(result, 8);
});

Deno.test("Loop: tail-call optimization pattern", async () => {
  const code = `
(fn sum-to [n]
  (loop (i 1 acc 0)
    (if (<= i n)
      (recur (+ i 1) (+ acc i))
      acc)))
(sum-to 100)
`;
  const result = await run(code);
  assertEquals(result, 5050);
});

Deno.test("Loop: nested loop simulation", async () => {
  const code = `
(var result 0)
(loop (i 1)
  (if (<= i 3)
    (do
      (loop (j 1)
        (if (<= j 3)
          (do
            (= result (+ result (* i j)))
            (recur (+ j 1)))
          nil))
      (recur (+ i 1)))
    result))
`;
  const result = await run(code);
  assertEquals(result, 36); // (1+2+3) * 3 + (2+4+6) + (3+6+9)
});

// ========================================
// While Loop Tests
// ========================================

Deno.test("While: basic while loop", async () => {
  const code = `
(var count 0)
(var sum 0)
(while (< count 5)
  (= sum (+ sum count))
  (= count (+ count 1)))
sum
`;
  const result = await run(code);
  assertEquals(result, 10); // 0+1+2+3+4
});

Deno.test("While: while loop with array operations", async () => {
  const code = `
(var result [])
(var i 0)
(while (< i 3)
  (.push result i)
  (= i (+ i 1)))
result
`;
  const result = await run(code);
  assertEquals(result, [0, 1, 2]);
});

Deno.test("While: while loop early termination", async () => {
  const code = `
(var i 0)
(var found false)
(var nums [1, 3, 5, 7, 8, 9])
(while (and (< i nums.length) (not found))
  (if (=== (% (get nums i) 2) 0)
    (= found true)
    nil)
  (= i (+ i 1)))
i
`;
  const result = await run(code);
  assertEquals(result, 5); // Found even number at index 4, incremented to 5
});

// ========================================
// Dotimes Loop Tests (Clojure-style fixed iteration)
// ========================================

Deno.test("Dotimes: basic dotimes loop", async () => {
  const code = `
(var result [])
(dotimes 3
  (.push result "hello"))
result
`;
  const result = await run(code);
  assertEquals(result, ["hello", "hello", "hello"]);
});

Deno.test("Dotimes: dotimes with multiple expressions", async () => {
  const code = `
(var result [])
(dotimes 2
  (.push result "first")
  (.push result "second"))
result
`;
  const result = await run(code);
  assertEquals(result, ["first", "second", "first", "second"]);
});

Deno.test("Dotimes: dotimes with counter accumulation", async () => {
  const code = `
(var sum 0)
(var counter 0)
(dotimes 5
  (= sum (+ sum counter))
  (= counter (+ counter 1)))
sum
`;
  const result = await run(code);
  assertEquals(result, 10); // 0+1+2+3+4
});

// ========================================
// For Loop Tests
// ========================================

Deno.test("For: single arg range (0 to n-1)", async () => {
  const code = `
(var result [])
(for (i 3)
  (.push result i))
result`;
  const result = await run(code);
  assertEquals(result, [0, 1, 2]);
});

Deno.test("For: two arg range (start to end-1)", async () => {
  const code = `
(var result [])
(for (i 5 8)
  (.push result i))
result`;
  const result = await run(code);
  assertEquals(result, [5, 6, 7]);
});

Deno.test("For: three arg range with step", async () => {
  const code = `
(var result [])
(for (i 0 10 2)
  (.push result i))
result`;
  const result = await run(code);
  assertEquals(result, [0, 2, 4, 6, 8]);
});

Deno.test("For: named to: syntax", async () => {
  const code = `
(var result [])
(for (i to: 3)
  (.push result i))
result`;
  const result = await run(code);
  assertEquals(result, [0, 1, 2]);
});

Deno.test("For: named from: to: syntax", async () => {
  const code = `
(var result [])
(for (i from: 5 to: 8)
  (.push result i))
result`;
  const result = await run(code);
  assertEquals(result, [5, 6, 7]);
});

Deno.test("For: named from: to: by: syntax", async () => {
  const code = `
(var result [])
(for (i from: 0 to: 10 by: 2)
  (.push result i))
result`;
  const result = await run(code);
  assertEquals(result, [0, 2, 4, 6, 8]);
});

Deno.test("For: collection iteration", async () => {
  const code = `
(var result [])
(for (x [1 2 3])
  (.push result (* x 2)))
result`;
  const result = await run(code);
  assertEquals(result, [2, 4, 6]);
});
