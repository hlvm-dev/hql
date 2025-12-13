// test/syntax-rest-params.test.ts
// Unit tests for ...rest parameters (JS-style rest syntax)
// Part of HQL v2.0 - JS syntax alignment

import { assertEquals, type assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "./helpers.ts";

////////////////////////////////////////////////////////////////////////////////
// Section 1: Basic ...rest Parameters
////////////////////////////////////////////////////////////////////////////////

Deno.test("Rest: only rest parameter", async () => {
  const result = await run(`
    (fn sum [...nums]
      (.reduce nums (fn [acc val] (+ acc val)) 0))
    (sum 1 2 3 4 5)
  `);
  assertEquals(result, 15);
});

Deno.test("Rest: rest with single regular param", async () => {
  const result = await run(`
    (fn sum [x ...rest]
      (+ x (.reduce rest (fn [acc val] (+ acc val)) 0)))
    (sum 10 1 2 3)
  `);
  assertEquals(result, 16);
});

Deno.test("Rest: rest with multiple regular params", async () => {
  const result = await run(`
    (fn sum [x y ...rest]
      (+ x y (.reduce rest (fn [acc val] (+ acc val)) 0)))
    (sum 10 20 1 2 3)
  `);
  assertEquals(result, 36);
});

////////////////////////////////////////////////////////////////////////////////
// Section 2: Empty Rest Arrays
////////////////////////////////////////////////////////////////////////////////

Deno.test("Rest: empty rest array with only rest param", async () => {
  const result = await run(`
    (fn getLength [...items]
      (get items "length"))
    (getLength)
  `);
  assertEquals(result, 0);
});

Deno.test("Rest: empty rest array with regular params", async () => {
  const result = await run(`
    (fn sum [x y ...rest]
      (+ x y (get rest "length")))
    (sum 10 20)
  `);
  assertEquals(result, 30);
});

////////////////////////////////////////////////////////////////////////////////
// Section 3: Rest Parameter Access
////////////////////////////////////////////////////////////////////////////////

Deno.test("Rest: array indexing", async () => {
  const result = await run(`
    (fn getSecond [...items]
      (get items 1))
    (getSecond 10 20 30)
  `);
  assertEquals(result, 20);
});

Deno.test("Rest: array length", async () => {
  const result = await run(`
    (fn count [...items]
      (get items "length"))
    (count 1 2 3 4 5)
  `);
  assertEquals(result, 5);
});

Deno.test("Rest: array iteration with map", async () => {
  const result = await run(`
    (fn double [...nums]
      (.map nums (fn [x] (* x 2))))
    (double 1 2 3)
  `);
  assertEquals(result, [2, 4, 6]);
});

////////////////////////////////////////////////////////////////////////////////
// Section 4: Integration with Other Features
////////////////////////////////////////////////////////////////////////////////

Deno.test("Rest: with destructuring array pattern", async () => {
  const result = await run(`
    (fn process [[a b] ...rest]
      (+ a b (.reduce rest (fn [acc x] (+ acc x)) 0)))
    (process [5 10] 1 2 3)
  `);
  assertEquals(result, 21);
});

Deno.test("Rest: with destructuring object pattern", async () => {
  const result = await run(`
    (fn process [{"x": x} ...rest]
      (+ x (.reduce rest (fn [acc val] (+ acc val)) 0)))
    (process {"x": 10} 1 2 3)
  `);
  assertEquals(result, 16);
});

Deno.test("Rest: with default parameters", async () => {
  const result = await run(`
    (fn process [x = 5 ...rest]
      (+ x (.reduce rest (fn [acc val] (+ acc val)) 0)))
    (process 10 1 2 3)
  `);
  assertEquals(result, 16);
});

Deno.test("Rest: using placeholder with rest", async () => {
  const result = await run(`
    (fn process [x = 5 ...rest]
      (+ x (.reduce rest (fn [acc val] (+ acc val)) 0)))
    (process _ 1 2 3)
  `);
  assertEquals(result, 11);
});

////////////////////////////////////////////////////////////////////////////////
// Section 5: Arrow Functions with Rest
////////////////////////////////////////////////////////////////////////////////

Deno.test("Rest: arrow function with rest", async () => {
  const result = await run(`
    (let sum (=> (...nums)
      (.reduce nums (fn [acc x] (+ acc x)) 0)))
    (sum 1 2 3 4)
  `);
  assertEquals(result, 10);
});

Deno.test("Rest: arrow function with regular and rest params", async () => {
  const result = await run(`
    (let multiply (=> (factor ...nums)
      (.map nums (fn [x] (* factor x)))))
    (multiply 3 1 2 3)
  `);
  assertEquals(result, [3, 6, 9]);
});

////////////////////////////////////////////////////////////////////////////////
// Section 6: Complex Scenarios
////////////////////////////////////////////////////////////////////////////////

Deno.test("Rest: nested function with rest", async () => {
  const result = await run(`
    (fn outer [...nums]
      ((fn inner [...moreNums]
         (+ (get nums 0) (get moreNums 0)))
       4 5 6))
    (outer 1 2 3)
  `);
  assertEquals(result, 5);
});

Deno.test("Rest: rest parameter in returned function", async () => {
  const result = await run(`
    (fn makeAdder [x]
      (fn [...nums]
        (+ x (.reduce nums (fn [acc val] (+ acc val)) 0))))
    (let add5 (makeAdder 5))
    (add5 1 2 3)
  `);
  assertEquals(result, 11);
});

Deno.test("Rest: spread values to another rest function", async () => {
  const result = await run(`
    (fn sum [...nums]
      (.reduce nums (fn [acc x] (+ acc x)) 0))
    (fn average [...values]
      (/ (sum ...values) (get values "length")))
    (average 10 20 30)
  `);
  assertEquals(result, 20);
});

////////////////////////////////////////////////////////////////////////////////
// Section 7: Edge Cases
////////////////////////////////////////////////////////////////////////////////

Deno.test("Rest: single argument to rest", async () => {
  const result = await run(`
    (fn identity [...items]
      items)
    (identity 42)
  `);
  assertEquals(result, [42]);
});

Deno.test("Rest: rest parameter with no regular params", async () => {
  const result = await run(`
    (fn createArray [...elements]
      elements)
    (createArray "a" "b" "c")
  `);
  assertEquals(result, ["a", "b", "c"]);
});

Deno.test("Rest: many arguments", async () => {
  const result = await run(`
    (fn count [...items]
      (get items "length"))
    (count 1 2 3 4 5 6 7 8 9 10)
  `);
  assertEquals(result, 10);
});
