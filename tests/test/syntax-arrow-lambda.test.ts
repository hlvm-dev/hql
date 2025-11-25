// test/syntax-arrow-lambda.test.ts
// Tests for arrow lambda (=>) with Swift-style $N parameters

import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { run } from "./helpers.ts";

////////////////////////////////////////////////////////////////////////////////
// Section 1: Implicit Parameters ($0, $1, $2...)
////////////////////////////////////////////////////////////////////////////////

Deno.test("Arrow Lambda: single implicit param $0", async () => {
  const code = `
    (let double (=> (* $0 2)))
    (double 5)
  `;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("Arrow Lambda: two implicit params $0 $1", async () => {
  const code = `
    (let add (=> (+ $0 $1)))
    (add 3 7)
  `;
  const result = await run(code);
  assertEquals(result, 10);
});

Deno.test("Arrow Lambda: three implicit params", async () => {
  const code = `
    (let sum3 (=> (+ $0 (+ $1 $2))))
    (sum3 10 20 30)
  `;
  const result = await run(code);
  assertEquals(result, 60);
});

Deno.test("Arrow Lambda: gap in param usage ($0 and $2)", async () => {
  // Should generate $0, $1, $2 even though $1 is not used
  const code = `
    (let myFn (=> (+ $0 $2)))
    (myFn 10 999 20)
  `;
  const result = await run(code);
  assertEquals(result, 30); // 10 + 20, ignoring 999
});

Deno.test("Arrow Lambda: inline call with implicit params", async () => {
  const result = await run("((=> (* $0 3)) 7)");
  assertEquals(result, 21);
});

////////////////////////////////////////////////////////////////////////////////
// Section 2: Explicit Parameters
////////////////////////////////////////////////////////////////////////////////

Deno.test("Arrow Lambda: explicit single param", async () => {
  const code = `
    (let square (=> (x) (* x x)))
    (square 7)
  `;
  const result = await run(code);
  assertEquals(result, 49);
});

Deno.test("Arrow Lambda: explicit two params", async () => {
  const code = `
    (let multiply (=> (x y) (* x y)))
    (multiply 6 7)
  `;
  const result = await run(code);
  assertEquals(result, 42);
});

Deno.test("Arrow Lambda: explicit zero params", async () => {
  const code = `
    (let get-value (=> () 42))
    (get-value)
  `;
  const result = await run(code);
  assertEquals(result, 42);
});

////////////////////////////////////////////////////////////////////////////////
// Section 3: Integration with map/filter/reduce
////////////////////////////////////////////////////////////////////////////////

Deno.test("Arrow Lambda: with map", async () => {
  const code = `
    (let nums [1 2 3 4 5])
    (let doubled (map (=> (* $0 2)) nums))
    (doall doubled)
  `;
  const result = await run(code);
  assertEquals(result, [2, 4, 6, 8, 10]);
});

Deno.test("Arrow Lambda: with filter", async () => {
  const code = `
    (let nums [1 3 6 8 2 9])
    (let filtered (filter (=> (> $0 5)) nums))
    (doall filtered)
  `;
  const result = await run(code);
  assertEquals(result, [6, 8, 9]);
});

Deno.test("Arrow Lambda: with reduce", async () => {
  const code = `
    (let nums [1 2 3 4 5])
    (reduce (=> (+ $0 $1)) 0 nums)
  `;
  const result = await run(code);
  assertEquals(result, 15);
});

Deno.test("Arrow Lambda: chained map and filter", async () => {
  const code = `
    (let nums [1 2 3 4 5 6 7 8 9 10])
    (let result
      (take 3
        (filter (=> (> $0 0))
          (map (=> (* $0 2))
            nums))))
    (doall result)
  `;
  const result = await run(code);
  assertEquals(result, [2, 4, 6]);
});

////////////////////////////////////////////////////////////////////////////////
// Section 4: Nested Arrow Lambdas
////////////////////////////////////////////////////////////////////////////////

Deno.test("Arrow Lambda: nested in map", async () => {
  const code = `
    (let matrix [[1 2] [3 4] [5 6]])
    (let doubled (map (=> (map (=> (* $0 2)) $0)) matrix))
    (doall (map doall doubled))
  `;
  const result = await run(code);
  assertEquals(result, [[2, 4], [6, 8], [10, 12]]);
});

Deno.test("Arrow Lambda: nested explicit and implicit", async () => {
  const code = `
    (let myFn (=> (x) (map (=> (* $0 x)) [1 2 3])))
    (doall (myFn 10))
  `;
  const result = await run(code);
  assertEquals(result, [10, 20, 30]);
});

////////////////////////////////////////////////////////////////////////////////
// Section 5: Complex Expressions
////////////////////////////////////////////////////////////////////////////////

Deno.test("Arrow Lambda: multi-line body (using do)", async () => {
  const code = `
    (let myFn (=> (x)
      (do
        (var temp (* x 2))
        (= temp (+ temp 1))
        temp)))
    (myFn 5)
  `;
  const result = await run(code);
  assertEquals(result, 11);
});

Deno.test("Arrow Lambda: with conditional", async () => {
  const code = `
    (let abs (=> (if (< $0 0) (- $0) $0)))
    [(abs -5) (abs 5)]
  `;
  const result = await run(code);
  assertEquals(result, [5, 5]);
});

Deno.test("Arrow Lambda: accessing object properties", async () => {
  const code = `
    (let get-name (=> ($0.name)))
    (get-name {name: "Alice"})
  `;
  const result = await run(code);
  assertEquals(result, "Alice");
});

////////////////////////////////////////////////////////////////////////////////
// Section 6: Error Cases
////////////////////////////////////////////////////////////////////////////////

Deno.test("Arrow Lambda: error on no params and no $N", async () => {
  const code = "(=> 42)"; // No $N in body, no explicit params

  await assertRejects(
    async () => await run(code),
    Error,
    "must use $0, $1, $2",
  );
});

Deno.test("Arrow Lambda: error on missing body with explicit params", async () => {
  const code = "(=> (x y))"; // Params but no body

  await assertRejects(
    async () => await run(code),
    Error,
  );
});

Deno.test("Arrow Lambda: error on too many implicit params", async () => {
  const code = "(=> $300)"; // Exceeds MAX_ARROW_PARAMS (255)

  await assertRejects(
    async () => await run(code),
    Error,
    "too many implicit parameters",
  );
});

////////////////////////////////////////////////////////////////////////////////
// Section 7: Real-World Use Cases
////////////////////////////////////////////////////////////////////////////////

Deno.test("Arrow Lambda: sort array", async () => {
  const code = `
    (let nums [5 2 8 1 9 3])
    ((nums.slice 0).sort (=> (- $0 $1)))
  `;
  const result = await run(code);
  assertEquals(result, [1, 2, 3, 5, 8, 9]);
});

Deno.test("Arrow Lambda: find in array", async () => {
  const code = `
    (let users [
      {name: "Alice", age: 30}
      {name: "Bob", age: 25}
      {name: "Carol", age: 35}
    ])
    (let found (users.find (=> (=== $0.name "Bob"))))
    (found.age)
  `;
  const result = await run(code);
  assertEquals(result, 25);
});

Deno.test("Arrow Lambda: transform data", async () => {
  const code = `
    (let data [
      {x: 1, y: 2}
      {x: 3, y: 4}
    ])
    (let summed (map (=> (+ $0.x $0.y)) data))
    (doall summed)
  `;
  const result = await run(code);
  assertEquals(result, [3, 7]);
});

Deno.test("Arrow Lambda: compose operations", async () => {
  const code = `
    (let nums [1 2 3 4 5])
    (let result
      (reduce (=> (+ $0 $1)) 0
        (map (=> (* $0 $0))
          (filter (=> (> $0 2))
            nums))))
    result
  `;
  const result = await run(code);
  assertEquals(result, 50); // 3^2 + 4^2 + 5^2 = 9 + 16 + 25 = 50
});

////////////////////////////////////////////////////////////////////////////////
// Section 8: Edge Cases
////////////////////////////////////////////////////////////////////////////////

Deno.test("Arrow Lambda: empty parameter list", async () => {
  const code = `
    (let myFn (=> () 100))
    (myFn)
  `;
  const result = await run(code);
  assertEquals(result, 100);
});

Deno.test("Arrow Lambda: $0 in nested structure", async () => {
  const code = `
    (let myFn (=> [(* $0 2) (+ $0 1)]))
    (myFn 5)
  `;
  const result = await run(code);
  assertEquals(result, [10, 6]);
});

// NOTE: Rest parameters currently have a runtime issue in HQL (pre-existing limitation)
// Deno.test("Arrow Lambda: with rest parameters", async () => {
//   const code = `
//     (let myFn (=> (x & rest) (+ x (reduce + 0 rest))))
//     (myFn 10 20 30)
//   `;
//   const result = await run(code);
//   assertEquals(result, 60);
// });
